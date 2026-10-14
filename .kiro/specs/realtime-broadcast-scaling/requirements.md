# Requirements Document

## Introduction

Realtime_Broadcast_Scaling reduces the cost of the realtime server's state broadcasts so a single Node process can carry far more concurrent REAL players (as opposed to today's bot-primary games), and gives the operator a clear signal for when a process is strained enough to warrant a bigger box (or, eventually, an EC2 split).

The realtime server currently broadcasts the **entire room snapshot** to every socket in a room on each coalesced update tick — `emitRaceUpdate` / `emitLobbyUpdate`, scheduled through `scheduleRaceUpdate` / `scheduleLobbyUpdate` roughly every `updateWindowMs` / `GAME_UPDATE_DELAY` (≈250 ms). This is cheap when a room is one human plus bots, but a full 99-human game fans a growing whole-room payload out to ~99 clients ~4×/sec, and broadcast fan-out — not CPU or bot simulation — becomes the binding constraint on the event loop.

This feature delivers two things:

- **Delta_Broadcasts**: send only what changed since each client last heard, using keyframes, per-room sequence numbers, and a client resync path. Payloads carry only client-rendered fields (a payload trim that is part of building deltas, since both keyframes and delta records benefit). This is the primary scaling win and is implemented outright.
- **Strain_Telemetry**: a standing signal of process health — event-loop lag and memory — reported continuously so the operator can tell when a process is strained and decide to scale the server up (bigger Hetzner box, later EC2). This is a monitoring signal, not a gate on the delta work.

Two things are explicitly **out of scope**: dynamically changing the broadcast tick interval under load (the Update_Window stays fixed at its current value), and any process-split / multi-process architecture (that is a future infra decision the Strain_Telemetry informs).

The feature changes only HOW room state is serialized and transmitted. It must not change gameplay, scoring, timing, lobby formation, bot behavior, or the authoritative server state. Both realtime modes — Battle Royale and Round-Based Elimination Race — share the full-snapshot pattern and must be updated symmetrically.

## Glossary

- **Realtime_Broadcast_Scaling**: The feature specified by this document — Delta_Broadcasts plus Strain_Telemetry.
- **Realtime_Server**: The Socket.IO game server in `apps/server` that hosts Battle Royale and Race as `GameModule`s on their own namespaces.
- **Room_Snapshot**: The full client-facing state of one game room currently sent on every broadcast tick — `ClientRaceMatch` for Race (via `serializeRaceMatch`) and the serialized `Game` for Battle Royale (via `emitLobbyUpdate`).
- **Broadcast_Tick**: One coalesced state broadcast for a room, emitted at most once per `updateWindowMs` (Race) / `GAME_UPDATE_DELAY` (Battle Royale) by the trailing-edge scheduler (`scheduleRaceUpdate` / `scheduleLobbyUpdate`).
- **Update_Window**: The fixed coalescing interval that bounds how often a room may broadcast — `config.updateWindowMs` for Race, `GAME_UPDATE_DELAY` for Battle Royale. This feature leaves it unchanged.
- **UI_Field**: A field of the Room_Snapshot (room-level or per-player) that the client actually renders. The complement — fields never read by the client UI — are Non_UI_Fields.
- **Trimmed_Snapshot**: A Room_Snapshot serialized to carry only UI_Fields.
- **Keyframe**: A full Trimmed_Snapshot sent as a complete base the client can apply later deltas onto (on join, reconnect, round transition, forced-keyframe cadence, or resync).
- **Delta**: A Broadcast_Tick payload that carries only the room-level fields and per-player records that changed since the previous Broadcast_Tick for that room, rather than the whole Trimmed_Snapshot.
- **Sequence_Number**: A per-room, monotonically increasing integer stamped on every Keyframe and Delta so a client can detect missed or out-of-order payloads.
- **Resync**: The client-initiated recovery when it detects a Sequence_Number gap — it requests, and the server sends, a fresh Keyframe to rebase on.
- **Authoritative_State**: The server-owned in-memory game state (`matches` / `serverOnlyData` / `serverOnlyBotData`, `games` for Battle Royale). The broadcast changes never alter this.
- **Strain_Telemetry**: The standing process-health signal — event-loop lag (via `perf_hooks.monitorEventLoopDelay`) and RSS — reported continuously so the operator can tell when a process is strained.

## Requirements

### Requirement 1: Strain telemetry (process-health signal)

**User Story:** As the operator, I want a continuous signal of each realtime process's event-loop and memory pressure, so that I can tell when a process is strained and decide to move to a bigger server.

#### Acceptance Criteria

1. THE Realtime_Server SHALL sample event-loop lag using `perf_hooks.monitorEventLoopDelay` and report it (at least mean and p99) at a bounded, configurable interval.
2. THE Realtime_Server SHALL sample process resident set size (RSS) and report it at the same bounded interval.
3. THE Realtime_Server SHALL report, on the same interval, aggregate broadcast cost since the last report — total Broadcast_Ticks, total bytes sent, max single-payload bytes, and total fan-out (socket-sends) — so broadcast pressure is attributable.
4. THE Strain_Telemetry SHALL be reported through the existing structured logger in the project's `event`-keyed shape, so it is greppable and consumable by the observability work (Feature 5).
5. THE Strain_Telemetry SHALL aggregate/sample rather than log every tick synchronously, so measuring does not materially add to the load being measured.
6. THE Strain_Telemetry SHALL NOT alter Authoritative_State, gameplay, scoring, or timing, and a telemetry failure SHALL NOT break or drop a Broadcast_Tick.
7. THE Strain_Telemetry SHALL be a standing signal, not a one-off measurement — it runs continuously in production so strain is observable whenever it occurs.

### Requirement 2: Trimmed broadcast payloads

**User Story:** As a platform maintainer, I want each broadcast to carry only the fields the client renders, so that keyframes and deltas are as small as possible.

#### Acceptance Criteria

1. THE Realtime_Server SHALL serialize every Keyframe and Delta from a Trimmed_Snapshot containing only UI_Fields.
2. THE set of UI_Fields SHALL be derived from what the client actually renders for each mode, and documented so the trim is auditable.
3. WHERE a field is server-only or never read by the client UI, THE Trimmed_Snapshot SHALL omit it.
4. THE trim SHALL NOT remove or alter any field from the Authoritative_State; it SHALL only reduce what is serialized onto the wire.
5. THE Trimmed_Snapshot SHALL preserve the exact rendered behavior of both modes — the client SHALL display identical board, keyboard, opponents, timers, placements, and result state as before.
6. THE trim SHALL be applied symmetrically to Battle Royale and Race.
7. THE join snapshot and the per-tick broadcast SHALL serialize through the same Trimmed_Snapshot shape so the client applies one shape.

### Requirement 3: Versioned keyframes and deltas (server)

**User Story:** As a platform maintainer, I want broadcasts to carry only what changed since the client last heard, so that per-tick cost scales with the delta size rather than the field size for human-primary games.

#### Acceptance Criteria

1. THE Realtime_Server SHALL stamp every Keyframe and Delta for a room with a per-room, monotonically increasing Sequence_Number.
2. WHEN a client joins, reconnects, or a round transition occurs, THE Realtime_Server SHALL send a Keyframe (a full Trimmed_Snapshot) rather than a Delta.
3. WHEN a Broadcast_Tick fires between keyframes, THE Realtime_Server SHALL send a Delta containing only the room-level fields and per-player records that changed since the previous Broadcast_Tick for that room.
4. THE Delta SHALL be able to represent a player that joined, a player whose fields changed, and a player that was removed, so applying deltas reproduces the authoritative player set.
5. THE Keyframe/Delta model SHALL build on the existing trailing-edge coalescing scheduler — diff accumulated changes at the trailing edge of the (unchanged) Update_Window and emit one payload — preserving the at-most-one-tick-per-window-per-room contract.
6. THE Realtime_Server SHALL force a Keyframe at a bounded maximum interval (or after a bounded number of deltas) so client drift is bounded even if a delta is mis-applied.
7. THE Keyframe/Delta model SHALL be applied symmetrically to Battle Royale and Race.
8. WHEN no room-level field and no player record changed since the previous Broadcast_Tick, THE Realtime_Server SHALL be able to skip the tick (an empty delta need not be sent), further reducing idle fan-out.

### Requirement 4: Client delta application and resync

**User Story:** As a player, I want my game view to stay correct even if an update is dropped or arrives out of order, so that broadcast optimization never shows me stale or wrong state.

#### Acceptance Criteria

1. WHEN the client receives a Keyframe, THE client SHALL replace its local room state with the Keyframe and record its Sequence_Number as the current base.
2. WHEN the client receives a Delta whose Sequence_Number is exactly one greater than its current base, THE client SHALL apply the Delta onto its local room state and advance its base.
3. WHEN the client receives a Delta whose Sequence_Number is NOT exactly one greater than its current base (a gap or out-of-order payload), THE client SHALL NOT apply it and SHALL initiate a Resync.
4. WHEN the client initiates a Resync, THE Realtime_Server SHALL respond with a fresh Keyframe, and THE client SHALL rebase on it.
5. WHILE awaiting a Resync Keyframe, THE client SHALL continue rendering its last known-good state rather than blanking or rendering a partially-applied Delta.
6. WHEN a Delta removes a player, THE client SHALL remove that player from its local state so the opponents view matches the authoritative field.
7. THE applied result of a Keyframe followed by any valid sequence of Deltas SHALL be identical to the full Trimmed_Snapshot the server holds at the same Sequence_Number.
8. THE client SHALL have at most one Resync request in flight at a time, so a burst of out-of-order payloads cannot cause a request storm.

### Requirement 5: No gameplay or protocol regressions

**User Story:** As an existing player, I want Battle Royale and Race to play exactly as before, so that broadcast changes are invisible to gameplay.

#### Acceptance Criteria

1. THE feature SHALL NOT change gameplay rules, scoring, placements, round timing, lobby formation, bot behavior, or stats.
2. THE feature SHALL NOT change Authoritative_State shape or the per-room state maps, and SHALL NOT change the Update_Window interval.
3. THE existing non-state lifecycle events (`join:ack`, `round:transition`, `eliminated`, `match:result`, `guess:ack`, `join:error`, `join:notice`) SHALL be preserved; this feature changes only the state-snapshot broadcast (`race:update` / `lobby:update`) into keyframe/delta messages and adds the resync message.
4. WHEN a client joins mid-match, it SHALL reach a correct, complete view via the join Keyframe and subsequent Deltas, with no reliance on having seen earlier deltas.
5. THE delta model SHALL ship behind a config switch so it can be rolled back to full (trimmed) snapshots without reverting the trim or the telemetry, bounding the risk of a diff/apply bug in production.
