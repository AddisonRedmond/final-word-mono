# Implementation Plan: Realtime Broadcast Scaling

## Overview

Deliver **trimmed, versioned delta broadcasts** for both realtime modes, plus a standing **Strain_Telemetry** signal. The tick interval is left fixed (no adaptive window); scaling is handled by sizing the server, with telemetry as the trigger.

Work bottom-up: shared types/config first, then the pure projection/diff/apply logic (heavily tested), then the impure emit/scheduler wiring, then the client. Reference `apps/server/src/games/race/lobby.ts` and `apps/server/src/games/battle-royale/lobby.ts` as the broadcast choke points, and `apps/client/src/hooks/useRaceSocket.tsx` as the client pattern. Apply every server change symmetrically to both modes.

Do NOT change Authoritative_State, gameplay, scoring, timing, or the Update_Window interval in any task.

## Strain telemetry (independent, can land first)

- [x] 1. Process-health + broadcast-cost signal
  - [x] 1.1 Loop-lag + RSS sampler
    - Create `apps/server/src/telemetry/strain.ts` with a `monitorEventLoopDelay` histogram started once at boot and a bounded-interval sampler that logs mean/p99 lag and `process.memoryUsage().rss` in the project's `event`-keyed shape, then resets the histogram; one timer per process
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.7_
  - [x] 1.2 Broadcast counters with aggregate flush
    - Add `recordBroadcast({ mode, roomId, bytes, recipients })` accumulating tick count, total/max bytes, and total fan-out, flushing an aggregate on the sampler interval; never log per tick; swallow its own errors
    - _Requirements: 1.3, 1.5, 1.6_
  - [x] 1.3 Wire into both emit choke points
    - Call `recordBroadcast` inside `emitRaceUpdate` and `emitLobbyUpdate`, measuring `Buffer.byteLength` of the serialized payload once and reusing it for the send; recipients = the room's socket count
    - _Requirements: 1.3, 1.6_

## Trimmed broadcast payloads

- [x] 2. Trimmed broadcast DTOs (type is the source of truth)
  - [x] 2.1 Resolve the four re-evaluate items in `UI_FIELDS.md`
    - The keep/drop audit is already written in `.kiro/specs/realtime-broadcast-scaling/UI_FIELDS.md`. Confirm the four flagged items by grepping the consuming components: Race `lastFeedback` (ack-only?), Race `isBot` (branched on for display?), BR `partialMatches`/`noMatch` (read off the player for the self-board?), BR `endTimeStamp` (used for display or only server-side?). Fold each resolution INTO the keep-list, not back into prose
    - _Requirements: 2.2_
  - [x] 2.2 Define DTOs as `Pick` projections of the authoritative types
    - In shared `types`/`shared`, define `ClientRacePlayer = Pick<RacePlayer, …keepList>` and `ClientBattleRoyalePlayer = Pick<PlayerDisplay, …keepList>` (and room DTOs as `Pick`s of `RaceRoom` / `Room`), with the keep-list unions from 2.1. The authoritative type stays the source for field shapes; the DTO is the keep-list as a type, so a new authoritative field is server-only by default. Shared by client and server
    - _Requirements: 2.1, 2.3_
  - [x] 2.3 Render-contract guard
    - Add the compile-time/`satisfies` check that every keep-list key exists on the authoritative type (dropping a still-kept authoritative field fails to compile). This plus the trim shape test (3.3) keeps "what the UI renders" and "what we send/diff" provably aligned
    - _Requirements: 2.5_

- [x] 3. Apply the trim (both modes, join + tick share one shape)
  - [x] 3.1 Race projection
    - Reimplement `serializeRaceMatch` to project `RaceMatch` → trimmed `ClientRaceMatch` (new DTO, never mutating Authoritative_State); ensure `join:ack` and `race:update` both serialize through it
    - _Requirements: 2.1, 2.3, 2.4, 2.6, 2.7_
  - [x] 3.2 Battle Royale projection
    - Replace `emitLobbyUpdate`'s `{ ...game, players }` spread with a projection to the trimmed DTO; ensure the BR join snapshot uses the same projection
    - _Requirements: 2.1, 2.3, 2.4, 2.6, 2.7_
  - [x] 3.3 Trim shape tests
    - Assert the Trimmed_Snapshot contains exactly the audited UI_Fields and omits Non_UI_Fields for both modes; assert every field each client component reads is still present (rendered behavior preserved)
    - _Requirements: 2.5_

## Versioned deltas (server)

- [x] 4. Envelope types + per-room version state
  - [x] 4.1 Keyframe/Delta envelope + enable flag
    - Add shared `{ seq, type: "keyframe" | "delta", ... }` envelope types (delta carries `room?`, `players?`, `removedPlayers?`) and a delta enable flag in config
    - _Requirements: 3.1, 3.3, 3.4, 5.5_
  - [x] 4.2 Per-room broadcast version record
    - Store `{ seq, ticksSinceKeyframe, lastSent }` in each room's server-only state; clear it in `cleanupMatch` / `cleanupGame`
    - _Requirements: 3.1, 5.2_

- [x] 5. Pure diff + apply logic (heavily tested)
  - [x] 5.1 Trimmed-snapshot diff
    - Pure `diffSnapshot(prev, next)` returning changed room fields, changed/added players, and `removedPlayers`; a player is included only if a UI_Field changed; an all-empty diff is representable as "no change"
    - _Requirements: 3.3, 3.4, 3.8_
  - [x] 5.2 Pure client apply
    - Pure `applyDelta(state, delta)` merging room fields, merging/adding players, deleting `removedPlayers`
    - _Requirements: 4.2, 4.6_
  - [x] 5.3 Property test: equivalence invariant
    - For a random sequence of authoritative mutations, `keyframe + applyDelta*` on a simulated client equals the server Trimmed_Snapshot at each `seq`; player add/change/remove round-trip; empty diffs are skipped
    - _Requirements: 3.4, 3.8, 4.6, 4.7_

- [x] 6. Server emit: keyframes + deltas
  - [x] 6.1 Keyframe emission points
    - Emit a Keyframe (full Trimmed_Snapshot + `seq`) on join/reconnect, round transition, forced-keyframe cadence, and resync response; increment `seq`, reset `ticksSinceKeyframe`, store `lastSent`
    - _Requirements: 3.2, 3.6_
  - [x] 6.2 Delta emission at the trailing edge
    - At the fixed Update_Window trailing edge, diff current vs `lastSent`; emit one Delta (`seq`) when non-empty, skip when empty; bump `ticksSinceKeyframe`, update `lastSent`; when the flag is off, emit a full Trimmed_Snapshot
    - _Requirements: 3.3, 3.5, 3.6, 3.7, 3.8, 5.5_
  - [x] 6.3 Resync endpoint
    - Handle a client `resync` request by replying with a fresh Keyframe; idempotent
    - _Requirements: 4.4, 4.8_

## Client apply + resync

- [x] 7. Sequence-aware client (both hooks)
  - [x] 7.1 Sequence-aware reducer
    - Track `baseSeq`; keyframe → replace + rebase; delta `seq === baseSeq+1` → apply + advance; any other seq → hold last-good, request resync (one in-flight at a time)
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.8_
  - [x] 7.2 Resync wiring + removal handling
    - Send `resync` on gap; rebase on the keyframe reply; apply `removedPlayers` so the opponents view matches the field
    - _Requirements: 4.4, 4.6_
  - [x] 7.3 Client apply/resync tests
    - In-order deltas apply; a dropped/reordered delta triggers resync and the keyframe restores a correct view; mid-match join reaches a complete view from the join keyframe alone
    - _Requirements: 4.3, 4.4, 4.5, 4.7, 5.4_

## Symmetry + regression

- [x] 8. Both modes, no regressions
  - [x] 8.1 Both modes behind the flag
    - Confirm Battle Royale and Race share the keyframe/delta/resync model and the enable flag; flag off restores full trimmed snapshots exactly
    - _Requirements: 3.7, 5.5_
  - [x] 8.2 Regression + lifecycle events intact
    - Full BR + Race suites green; `join:ack`/`round:transition`/`eliminated`/`match:result`/`guess:ack`/`join:error`/`join:notice` unchanged; gameplay/scoring/timing/Update_Window unchanged
    - _Requirements: 5.1, 5.2, 5.3_
