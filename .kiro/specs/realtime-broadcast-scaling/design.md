# Design Document: Realtime Broadcast Scaling

## Overview

This design delivers **trimmed, versioned delta broadcasts** for the realtime server, plus a standing **Strain_Telemetry** signal so the operator knows when a process is strained enough to move to a bigger box. It changes only how room state is serialized and transmitted — never the Authoritative_State, gameplay, scoring, or timing.

Scope decisions baked in:

- **Deltas are the implementation**, not a gated phase. Every state broadcast becomes a keyframe or a delta.
- **Payload trim is part of deltas** — keyframes and per-player delta records both serialize only client-rendered fields.
- **Tick interval stays fixed.** The Update_Window keeps its current value; there is no adaptive/throttling controller. If a process is strained, the operator scales the server (bigger Hetzner, later EC2) — informed by Strain_Telemetry.
- **No process-split work.** Single-process today; the telemetry is the trigger for a future infra decision, which is out of scope.

Grounded in the existing broadcast path (symmetric across both modes):

- **Race** (`apps/server/src/games/race/lobby.ts`): `serializeRaceMatch(match)` → `ClientRaceMatch`; `emitRaceUpdate` emits `race:update`; `scheduleRaceUpdate` coalesces to one emit per `config.updateWindowMs` via `timers.updateTicker` (trailing-edge).
- **Battle Royale** (`apps/server/src/games/battle-royale/lobby.ts`): `emitLobbyUpdate(io, roomId, game)` emits `lobby:update` with `{ ...game, players: Object.fromEntries(game.players) }`; `scheduleLobbyUpdate` coalesces per `GAME_UPDATE_DELAY`.
- **Client** (`apps/client/src/hooks/useRaceSocket.tsx`, and the Battle Royale socket hook): both `join:ack` and `race:update` / `lobby:update` currently **replace** local state wholesale (`setMatch(payload)`). This design upgrades that wholesale-replace into keyframe-rebase + delta-apply with gap detection.

The dispatch/coalescing seam and the join-vs-update distinction already exist; this design layers a per-room version + diff at the trailing edge of the existing scheduler and makes the client sequence-aware.

## Architecture

```
            Authoritative_State (unchanged)
     matches / serverOnlyData / serverOnlyBotData (Race)
     games   / serverOnlyData / serverOnlyBotData (BR)
                        │
          Broadcast_Tick (trailing edge of the FIXED Update_Window)
                        │
   serialize via UI_Fields  ──►  Trimmed_Snapshot
                        │
   diff Trimmed_Snapshot vs last-sent per room  (behind delta enable flag)
                        │
           ┌────────────┴─────────────┐
           │ Keyframe (seq, full)     │  join / reconnect / round / forced
           │ Delta    (seq, changed)  │  between keyframes (skip if empty)
           └────────────┬─────────────┘
                        ▼
                 clients in room
                        │
   client: keyframe → replace+rebase; delta(seq=base+1) → apply;
           gap → hold last-good + request Resync → keyframe

   Strain_Telemetry (independent): monitorEventLoopDelay histogram + RSS,
   plus broadcast byte/fan-out counters, flushed on a bounded interval to logs.
```

Strain_Telemetry is independent of the delta pipeline — it observes the emit (byte/fan-out counters) and the process (loop lag, RSS), and reports continuously. The delta model sits behind a config flag so it can be rolled back to full trimmed snapshots without touching the trim or telemetry.

## Components and Interfaces

### Strain_Telemetry (Requirement 1)

A single process-level telemetry module in `apps/server` (e.g. `src/telemetry/strain.ts`), mode-agnostic and independent of the delta work:

- **Loop lag + RSS sampler**: a `monitorEventLoopDelay` histogram started once at boot; on a bounded interval (e.g. 5–10 s) it reads `mean`/`p99` lag and `process.memoryUsage().rss`, logs them in the project's `event`-keyed shape, then resets the histogram. One interval timer for the process, not per room (Req 1.1, 1.2, 1.5, 1.7).
- **Broadcast counters**: `recordBroadcast({ mode, roomId, bytes, recipients })`, called from inside the emit after the payload is serialized. It accumulates tick count, total/max bytes, and total fan-out, and flushes an aggregate on the same interval as the sampler — it never logs per tick (Req 1.3, 1.5). It swallows its own errors so a telemetry fault can never drop a Broadcast_Tick (Req 1.6).
- **Byte measurement**: measure `Buffer.byteLength(serialized)` once at emit time and reuse the serialized string for the send so serialization isn't doubled. `recipients` = the room's socket count.

Wired into the two emit choke points (`emitRaceUpdate`, `emitLobbyUpdate`). Touches no Authoritative_State. Because it is a standing production signal, its output feeds directly into the Feature 5 observability work — the operator watches loop-lag p99 and RSS trend to decide when to size up.

### Trimmed_Snapshot (Requirement 2)

**The trimmed DTO type is the source of truth — not a markdown list.** The DTO is expressed as a TypeScript **projection of the authoritative type** (a `Pick` over an explicit keep-list union), so the compiler keeps field shapes in lockstep with the authoritative type and the delta diff can only ever iterate `keyof` the trimmed type. The `UI_FIELDS.md` audit in this spec folder is the **rationale** for each keep/drop (and the list of "re-evaluate" items), not the authority — once a re-evaluate item is confirmed it is resolved into the union, not left in prose.

- **Projection types** (in shared `types`/`shared` so client and server share one definition):
  ```ts
  // Authoritative type is the source for field SHAPES; the DTO is the keep-list
  // expressed as a type, so adding a field to RacePlayer is server-only BY
  // DEFAULT (it won't appear on the wire until added to the union).
  type RacePlayerUIFields =
    | "name" | "isEliminated" | "isAnonymous"
    | "completedWords" | "qualified" | "totalGuesses"
    | "correctGuesses" | "placement" | "revealedWord" | "hintRevealed";
  export type ClientRacePlayer = Pick<RacePlayer, RacePlayerUIFields>;
  // Battle Royale analogously: ClientBattleRoyalePlayer = Pick<PlayerDisplay, …>.
  ```
  The exact unions come from `UI_FIELDS.md` with its four re-evaluate items resolved (Req 2.2). Room-level DTOs are `Pick`s of `RaceRoom` / `Room` the same way.
- **Projection function**: `serializeRaceMatch` (and the BR `emitLobbyUpdate` projection) build the DTO by copying exactly the keep-list fields and return the typed DTO, so the builder is compiler-checked against the type (Req 2.1, 2.3). It reads Authoritative_State and returns a new object; it never mutates live objects (Req 2.4).
- **One shape for join + tick** (Req 2.7): the join snapshot and the per-tick broadcast serialize through the SAME projection.
- **Render-contract guard** (closes the gap `Pick` can't see): TypeScript can't tell whether a kept field is actually rendered or whether a newly-rendered field was omitted. Add a lightweight test asserting the keep-list union matches the fields the components read — at minimum an exhaustiveness/`satisfies` check that every keep-list key exists on the authoritative type (so dropping an authoritative field that's still kept fails to compile), plus the trim shape test (task 3.3) that every field each component reads is present. This keeps "what the UI needs" and "what we send/diff" provably aligned (Req 2.5).

### Keyframes, Deltas, Sequence_Numbers (Requirement 3)

Add a per-room broadcast version record (server-only, stored next to the room's other server-only state): `{ seq, ticksSinceKeyframe, lastSent }` where `lastSent` is the previous Trimmed_Snapshot used to diff against. Cleared in the existing cleanup paths (`cleanupMatch` / `cleanupGame`).

- **Keyframe** — a full Trimmed_Snapshot plus `{ seq, type: "keyframe" }`. Emitted on join/reconnect (the `join:ack` snapshot now carries `seq`), on round transition (a natural reset where every player changes anyway), on the forced-keyframe cadence (Req 3.6), and in response to a Resync (Req 4.4). Increments `seq`, resets `ticksSinceKeyframe`, stores `lastSent`.
- **Delta** — emitted at the trailing edge of the (fixed) Update_Window where `emitRaceUpdate` runs today, computed by diffing the current Trimmed_Snapshot against `lastSent`:
  ```
  { seq, type: "delta",
    room?: Partial<RoomFields>,        // only changed room-level fields
    players?: { [id]: Partial<ClientPlayer> },  // only changed/added players
    removedPlayers?: string[] }         // players no longer in the field
  ```
  Represents add / change / remove so applying it reproduces the authoritative player set (Req 3.4). Increments `seq`, bumps `ticksSinceKeyframe`, updates `lastSent`.
- **Empty-tick skip** — if the diff is empty (no room field and no player changed), emit nothing and do not advance `seq` (Req 3.8), so an idle room costs zero fan-out.
- **Per-player granularity** — a player appears in `players` only if any UI_Field changed; otherwise omitted. This is the cheap, effective unit given most players don't change per tick. Field-level sub-diffing is an available later refinement, not required.
- **Forced keyframe** — when `ticksSinceKeyframe` reaches a configured bound, the next tick is a Keyframe (Req 3.6), bounding drift.
- **Symmetry + flag** — identical model for both modes (Req 3.7); behind a config enable flag → off emits full Trimmed_Snapshots (still trimmed, still telemetered), on emits keyframes/deltas (Req 5.5). The flag is the production rollback for a diff bug.

### Client apply + Resync (Requirement 4)

Upgrade the client socket hooks (`useRaceSocket`, Battle Royale's hook) from wholesale-replace to a small sequence-keyed reducer:

- Track `baseSeq` alongside `match`. **Keyframe** → replace `match`, set `baseSeq = seq` (Req 4.1). **Delta with `seq === baseSeq + 1`** → apply onto a copy of `match` (merge changed room fields; merge/add each entry in `players`; delete `removedPlayers`), set `baseSeq = seq` (Req 4.2, 4.6). **Delta with any other `seq`** → do NOT apply; keep rendering last-good; request a Resync (Req 4.3, 4.5).
- **Resync** → server replies with a Keyframe to rebase on (Req 4.4); at most one resync in flight at a time (Req 4.8).
- **Equivalence invariant** — keyframe-then-valid-deltas equals the server's Trimmed_Snapshot at the same `seq` (Req 4.7); the core property the tests assert.
- Mid-match join is a complete base from the join Keyframe alone (Req 5.4).

## Data Models

- **Broadcast DTOs** (new, client-facing): `ClientRacePlayer` / `ClientBattleRoyalePlayer` as `Pick<Authoritative, keepListUnion>` **projections** (the source of truth for the wire shape and the delta surface), plus the envelope types `{ seq, type: "keyframe" | "delta", ... }`. Live in shared `types`/`shared` so client and server share one definition. The delta diff iterates `keyof ClientRacePlayer` so it is mechanically impossible to diff a non-trimmed field.
- **Per-room broadcast version** (new, server-only): `{ seq, ticksSinceKeyframe, lastSent }` next to the room's existing server-only data; cleared on cleanup.
- **Config additions**: Strain_Telemetry report interval + loop-lag/RSS thresholds for logging, forced-keyframe bound, delta enable flag. (No Update_Window changes.)
- **Authoritative_State**: unchanged (Req 5.1, 5.2).

## Error Handling

- **Telemetry failures** never break a broadcast — the recorder swallows its own errors (mirrors the stats/daily-limit fail-safe pattern).
- **Diff correctness is safety-critical**: a wrong diff silently corrupts the client view. Mitigations: forced-keyframe cadence bounds how long corruption can persist; property tests assert the equivalence invariant; the delta enable flag is an instant production rollback to full snapshots.
- **Out-of-order / dropped payloads**: handled by gap-detection + resync. Socket.IO is ordered per connection, but reconnects make explicit sequence checking the robust choice.
- **Resync storms**: one outstanding resync per client; server treats resync as idempotent (always answerable with a fresh keyframe).

## Testing Strategy

- **Strain_Telemetry**: unit-test the recorder's aggregation (byte/fan-out counters, flush) with a fake clock; assert it never throws into the emit path.
- **Trim**: shape tests that the Trimmed_Snapshot contains exactly the audited UI_Fields and omits Non_UI_Fields for both modes; a client-level check that every field each component reads is still present.
- **Deltas (property tests, the core)**: for a random sequence of authoritative-state mutations, assert `keyframe + applyDelta*` on a simulated client equals the server Trimmed_Snapshot at each `seq` (Req 4.7); assert player add/change/remove round-trip (Req 3.4, 4.6); assert empty diffs are skipped (Req 3.8); assert a dropped/reordered delta triggers resync and the keyframe restores equivalence (Req 4.3–4.5); assert the forced-keyframe cadence fires (Req 3.6). Apply to both modes.
- **Regression**: existing Battle Royale and Race suites stay green (gameplay/scoring/timing unchanged, Req 5.1); non-state lifecycle events untouched (Req 5.3).

## Alternatives Considered

- **Adaptive tick interval under load**: considered and explicitly dropped per the operator's call — the tick stays fixed; scaling is handled by sizing the server, with Strain_Telemetry as the trigger. Keeping the tick fixed also removes a moving part from the delta correctness surface.
- **JSON Patch (RFC 6902) for deltas**: more general but heavier to produce/apply and larger on the wire for this shape; a per-player object diff matches the data (the churn unit is a player). JSON Patch remains a fallback if field-level diffing is later needed.
- **Socket.IO Redis adapter / per-room binary encoding / process split**: orthogonal future scaling levers, out of scope. Deltas are per-room and travel with a game to whatever process hosts it, so this work composes with a future EC2 split rather than conflicting with it.
