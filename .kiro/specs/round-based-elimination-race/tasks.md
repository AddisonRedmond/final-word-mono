# Implementation Plan: Round-Based Elimination Race

## Overview

This plan implements Race_Mode as a self-contained `GameModule` on the existing realtime server, mirroring the Battle Royale module layout (`index.ts`, `handlers.ts`, `state.ts`, `lobby.ts`, `stats.ts`, `logic/`). Work proceeds bottom-up: shared config + types + DB schema first, then the pure logic core (heavily property-tested against the 14 correctness properties), then the impure match lifecycle, socket wiring, and stats persistence, and finally the client UI wired to the `/race` namespace.

Reference the Battle Royale module (`apps/server/src/games/battle-royale/`) as the implementation pattern for every server-side task, and `packages/shared/src/battle-royale.ts` for the shared-config pattern.

## Tasks

- [x] 1. Shared Race_Config schema and shared types
  - [x] 1.1 Create the Race_Config Zod schema and validated default
    - Create `packages/shared/src/race.ts` with `roundConfigSchema`, `raceConfigSchema`, the `.refine` invariants (`minLobbySize <= maxLobbySize`, final round `qualifyingCount === 1`), inferred `RoundConfig`/`RaceConfig` types, the `eliminationCount(survivors, pct)` ceil-rounding helper, and the parsed `RACE_CONFIG` default constant
    - Export from the shared package entry so both server and client import from `shared/race.js`
    - Follow the pattern in `packages/shared/src/battle-royale.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.8_

  - [x] 1.2 Write property test for Race_Config validity
    - **Property 1: Config validity captures all invariants**
    - **Validates: Requirements 2.7, 2.8**
    - Generate arbitrary valid and invalid config objects; assert `safeParse` succeeds iff all invariants hold
    - Add `fast-check` as a dev dependency in the shared package

  - [x] 1.3 Create shared Race_Mode types
    - Create `packages/types/src/race.types.ts` defining `RacePhase`, `LetterFeedback`, `RacePlayer`, `RaceRoom`, `RaceMatch`, `ClientRaceMatch`, and `RacePlayerServerData`
    - `RacePlayerServerData` holds ONLY `{ word, lastAcceptedGuessAt }` — Race is a solo race-to-qualify with independent per-player words; do NOT include any attack queue, `currentWordIsAttack`, `currentWordAttackerName`, `lastAttackerName`, or attack-related fields carried over from Battle Royale
    - Export from the types package entry
    - _Requirements: 2.5, 4.4, 4.5, 5.2, 5.3, 5.5_

- [x] 2. raceStats Drizzle table and migration
  - [x] 2.1 Add the raceStats table to the DB schema
    - Add the `raceStats` pgTable to `packages/db/src/schema.ts` keyed by `userId` UUID (FK to `profiles.id`, cascade delete), with `gamesPlayed`, `wins`, `draws`, `averagePlacement`, `bestPlacement`, `totalGuesses`, `totalCorrectGuesses`, `currentWinStreak`, `bestWinStreak`, `wonLastGame`, `lastPlayedAt`, `createdAt`, `updatedAt`, plus `RaceStats`/`NewRaceStats` inferred types
    - Mirror the existing `battleRoyaleStats` table exactly
    - _Requirements: 8.1, 8.5_

  - [x] 2.2 Generate and review the race_stats migration
    - Run `pnpm db:generate` to emit the migration under `packages/db/drizzle`
    - Review the generated SQL for correctness before it is applied
    - _Requirements: 8.1_

- [x] 3. Pure logic core: round grading, ranking, and elimination
  - [x] 3.1 Relocate existing word lists to shared and expose per-length word assignment
    - Do NOT create brand-new 4/5/6-letter lists. Reuse the existing word arrays that currently live in the client: `apps/client/src/utils/four-letter-words.ts` (default export `FOUR_LETTER_WORDS`), `apps/client/src/utils/words.ts` (five-letter list), and `apps/client/src/utils/six-letter-words.ts` (default export `SIX_LETTER_WORDS`)
    - Move the four-, five-, and six-letter word arrays into a shared location (e.g. `packages/shared/src/words.ts`, exported from the shared package entry) so both client and server import them without duplication; update the existing client imports to point at the shared module
    - Create `apps/server/src/games/race/logic/words.ts` with `getRandomWord(length)` that selects from the correct per-length shared list (importing from `shared/words.js`); no attack-word bonus lists
    - If a shared move is out of scope, the fallback is to reference the same source data (import from the existing client files) rather than hand-duplicating a new list
    - _Requirements: 4.1_

  - [x] 3.2 Implement pure round grading and length checks
    - Create `apps/server/src/games/race/logic/round.ts` with `assignWord(length)`, `gradeGuess(guess, target)` returning `{ isMatch, perLetter }`, and `isCorrectLength(guess, length)`
    - _Requirements: 4.3, 4.6_

  - [x] 3.3 Write property test for grading feedback consistency
    - **Property 2: Grading feedback is consistent with the target**
    - **Validates: Requirements 4.3**

  - [x] 3.4 Implement qualification progression on correct guess (pure)
    - Add a pure guess-application helper to `logic/round.ts` that, for a non-eliminated survivor whose guess length matches, increments `completedWords`, assigns a new word of configured length, and latches `qualified`/`qualifiedAt` exactly once when `completedWords` reaches `qualifyingCount`; rejects wrong-length and eliminated-player guesses without mutating counts or word
    - _Requirements: 4.4, 4.5, 4.6, 4.8_

  - [x] 3.5 Write property test for wrong-length and eliminated-player rejection
    - **Property 3: Wrong-length and eliminated-player guesses are rejected without side effects**
    - **Validates: Requirements 4.6, 4.8**

  - [x] 3.6 Write property test for qualification progression
    - **Property 4: Qualification progression is monotonic and latches once**
    - **Validates: Requirements 4.4, 4.5**

  - [x] 3.7 Implement survivor ranking and elimination selection (pure)
    - Add `rankSurvivors(survivors)` (qualified before non-qualified; qualified by earliest `qualifiedAt`; non-qualified by highest `completedWords` then fewest `roundGuesses`; stable for exact ties) and `selectEliminated(ranked, pct, config)` using `eliminationCount` to pick the lowest-ranked suffix, to `logic/round.ts`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 3.8 Write property test for survivor ranking total order
    - **Property 5: Survivor ranking is a total order over the tie-break policy**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [x] 3.9 Write property test for elimination count and suffix selection
    - **Property 6: Elimination count follows the configured percentage with ceil rounding**
    - **Validates: Requirements 5.4**

  - [x] 3.10 Implement final-round resolution (pure)
    - Add `resolveFinalRound(survivors)` to `logic/round.ts` returning the leader by highest `completedWords` broken by fewest total guesses with others ranked behind, or a draw when no progress distinguishes a leader
    - _Requirements: 6.3, 6.4, 6.5_

  - [x] 3.11 Write property test for final-round resolution
    - **Property 9: Final-round resolution picks the leader or declares a draw, others ranked behind**
    - **Validates: Requirements 6.3, 6.4, 6.5**

- [x] 4. Pure server-side rate gate
  - [x] 4.1 Implement the guess rate gate
    - Create `apps/server/src/games/race/logic/rate-limit.ts` with pure `acceptGuess(lastAcceptedAt, now, thresholdMs)` returning `false` when `now - lastAcceptedAt < thresholdMs`
    - _Requirements: 7.4_

  - [x] 4.2 Write property test for the rate gate bound
    - **Property 10: Server rate gate bounds the accepted-guess rate**
    - **Validates: Requirements 7.4**

- [x] 5. Checkpoint - Ensure all logic-core tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. In-memory state and config load
  - [x] 6.1 Create Race module state containers and config load
    - Create `apps/server/src/games/race/state.ts` holding `matches: Map<string, RaceMatch>`, `serverOnlyData` (per-player `RacePlayerServerData` + per-room `RaceRoomTimers`), and bot data, plus loading/validating `RACE_CONFIG`
    - Mirror `battle-royale/state.ts` for the structure/pattern ONLY (separation of display state and server-only secrets); key real players by Supabase UUID and bots by `bot0`, `bot1`, … The per-player `RacePlayerServerData` holds only `{ word, lastAcceptedGuessAt }` — exclude any attack queue or attack flags from the Battle Royale state
    - _Requirements: 1.3, 2.6_

- [x] 7. Match lifecycle and matchmaking (impure)
  - [x] 7.1 Implement lobby selection, creation, and bot fill
    - Create `apps/server/src/games/race/logic/race.ts` with `getOrCreateLobby(matches, config)` (only returns a `lobby`-phase room below `maxLobbySize`, else creates one), `findMatchForUser`, and bot-fill to `minLobbySize` on countdown zero
    - Create `apps/server/src/games/race/logic/bots.ts` for bot fill + bot guess simulation ticker
    - Reference `battle-royale/logic/battle-royale.ts` and `battle-royale-bots.ts` for the lifecycle/bot-fill structure/pattern ONLY; bot guessing races independent per-player words and must NOT include attack/targeting logic (no `applyAttack`, `determineTarget`, attack queues, or attack-word bonuses)
    - _Requirements: 3.1, 3.2, 3.5, 3.7_

  - [x] 7.2 Write property test for lobby selection safety
    - **Property 13: Lobby selection never returns a started match**
    - **Validates: Requirements 3.1, 3.2, 3.7**

  - [x] 7.3 Write property test for bot-fill to minimum
    - **Property 14: Bot-fill brings a short lobby up to exactly the minimum**
    - **Validates: Requirements 3.5**

  - [x] 7.4 Implement match start with lobby timer and start conditions
    - Add `startMatch(match, nsp, config, deps)` invoking the daily-limit seam per real player, starting the match immediately at `maxLobbySize`, or on countdown zero when `>= minLobbySize` (else after bot fill)
    - _Requirements: 3.3, 3.4, 3.5, 11.1_

  - [x] 7.5 Implement round begin/end with elimination and continuation
    - Add `beginRound` (assign words of configured length, start round timer) and `endRound` (rank via `rankSurvivors`, eliminate via `selectEliminated`, record placement + `eliminatedAt`, then continue to next round with `>= 2` survivors, declare winner with exactly one, or draw with none)
    - _Requirements: 4.1, 4.2, 5.1, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 7.6 Write property test for eliminated placement assignment
    - **Property 7: Eliminated players receive a placement and elimination time**
    - **Validates: Requirements 5.5**

  - [x] 7.7 Write property test for post-elimination continuation
    - **Property 8: Post-elimination continuation matches the survivor count**
    - **Validates: Requirements 5.6, 5.7, 5.8**

  - [x] 7.8 Implement final-round win and match finish
    - Add final-round first-correct-guess win, and `finishMatch(match, nsp, winnerId?)` setting `phase = finished`, recording all placements behind the winner, and triggering broadcast/stats/cleanup
    - _Requirements: 6.1, 6.2, 6.3, 6.6_

  - [x] 7.9 Write unit test for first-correct-guess win in the final round
    - Ordered submissions; assert the earliest correct guesser wins
    - _Requirements: 6.2_

  - [x] 7.10 Implement match cleanup and timer teardown
    - Add `cleanupMatch(matchId, matches, serverOnlyData, botData)` clearing all room timers (`lobbyCountdown`, `roundTimer`, `intermissionTimer`, `botTicker`, `updateTicker`) before deleting state
    - _Requirements: 9.4_

  - [x] 7.11 Write unit test for cleanup clearing timers and state
    - Assert last leaver clears all timers and deletes room state
    - _Requirements: 9.4_

- [x] 8. Daily-limit seam
  - [x] 8.1 Implement the dormant daily-limit seam
    - Create `apps/server/src/games/race/daily-limit.ts` with `canStartMatch(userId)` (beta: always `true`) and `recordMatchStart(userId)` (beta: no-op), documenting the fail-open policy for the future enforcing impl
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 8.2 Write unit test for the daily-limit seam
    - Assert `startMatch` invokes `recordMatchStart` per real player and beta `canStartMatch` permits start; a stubbed enforcing impl blocks a limit-reached player without touching Match/Round logic
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 9. Broadcast layer
  - [x] 9.1 Implement coalesced state broadcasts
    - Create `apps/server/src/games/race/lobby.ts` that emits `race:update` (serializing `RaceMatch` players `Map` → `Record`) and schedules broadcasts coalesced to at most one per `updateWindowMs` per lobby, plus lobby-membership broadcast on join
    - Reference `battle-royale/lobby.ts` for the coalesced-broadcast structure/pattern ONLY; the serialized payload carries no attack-related fields
    - _Requirements: 3.6, 4.7, 10.1, 10.2_

  - [x] 9.2 Write unit test for broadcast coalescing
    - Use fake timers to assert at most one `race:update` per `updateWindowMs`
    - _Requirements: 3.6, 4.7_

- [x] 10. Stats persistence
  - [x] 10.1 Implement placement ranking and upsert-on-finish
    - Create `apps/server/src/games/race/stats.ts` with `rankPlayers(match)` (winner placement 1; others by `eliminatedAt` then tie-break; draw → all placement 1, no win; bots ordered but excluded from persistence), `upsertPlayerStat` using `onConflictDoUpdate` with SQL increments/running-average/streak math, and fire-and-forget `persistRaceStats` wrapped in try/catch
    - Mirror `persistBattleRoyaleStats` for the upsert-on-finish structure/pattern ONLY, retargeted to `raceStats`; placement derives from ranking/elimination, not from any "eliminated by X" / attack-word logic
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.8_

  - [x] 10.2 Write property test for real-player-only persistence
    - **Property 11: Only real players are persisted**
    - **Validates: Requirements 8.4**

  - [x] 10.3 Implement in-progress leaver-as-loss persistence
    - Add `persistLeaverAsLoss(match, userId)` that snapshots placement from alive-count at the moment of leaving, records a loss for a real player leaving an in-progress match, and no-ops for bots and lobby leavers
    - _Requirements: 8.6, 8.7_

  - [x] 10.4 Write property test for leaver placement
    - **Property 12: In-progress leaver placement reflects the field size at the moment of leaving**
    - **Validates: Requirements 8.6, 8.7**

  - [x] 10.5 Write unit tests for stats field payload and failure resilience
    - Mock the DB to assert the upsert value shape (Req 8.5) and that a throwing DB does not break cleanup (Req 8.8)
    - _Requirements: 8.5, 8.8_

- [x] 11. Checkpoint - Ensure all server logic and stats tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Namespace registration and socket auth
  - [x] 12.1 Make socket auth installable on a namespace
    - Refactor `apps/server/src/socket/auth.ts` so the Supabase auth middleware can be applied to a specific namespace, then apply it to `io.of("/race")` while leaving the default-namespace install for Battle Royale unchanged
    - _Requirements: 1.4_

  - [x] 12.2 Create the Race GameModule and register it
    - Create `apps/server/src/games/race/index.ts` exporting a `GameModule` with id `"round-based-elimination-race"` whose `register(io)` validates `RACE_CONFIG` (logging and skipping registration on failure), installs auth on `/race`, and attaches connection handlers; add `race` to `gameModules` in `games/registry.ts`
    - _Requirements: 1.1, 1.2, 1.3, 2.7_

  - [x] 12.3 Write integration/smoke tests for registration and auth
    - Assert the module exposes id `"round-based-elimination-race"` on the `/race` namespace with isolated state, and that a `/race` connection without a valid token is rejected before any handler runs
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 13. Socket event handlers
  - [x] 13.1 Implement join/reconnect handler
    - Create `apps/server/src/games/race/handlers.ts` wiring the `/race` connection: `join` places new players into an open lobby, reconnects a not-eliminated in-progress player to the same match (`join:ack` with current state), and routes an already-eliminated reconnecting player into a fresh lobby; emit `join:error` when the daily limit blocks (future)
    - Reference `battle-royale/handlers.ts` for the socket-wiring structure/pattern ONLY; do NOT wire any attack/targeting handlers or attack-related fields
    - _Requirements: 3.1, 3.2, 9.2, 9.5, 11.3_

  - [x] 13.2 Implement guess handler with rate gate and grading
    - Wire `guess`: guard on match existence, player presence, `phase === round`/final round, non-eliminated status, and correct length; enforce `acceptGuess` (reply `guess:ack { throttled: true }` and skip counts when rate-gated); grade and apply qualification; emit `guess:ack` with per-letter feedback
    - Structure/pattern reference ONLY from `battle-royale/handlers.ts`; do NOT copy any attack/targeting logic. The server-only per-player data (`RacePlayerServerData`) holds only `{ word, lastAcceptedGuessAt }` — no attack queue, `currentWordIsAttack`, `currentWordAttackerName`, `lastAttackerName`, or any attack flags
    - _Requirements: 4.3, 4.6, 4.8, 7.4, 10.6_

  - [x] 13.3 Write property test for the rate gate under the handler path
    - **Property 3 reuse — verify wrong-length/eliminated guesses stay side-effect-free through the handler**
    - Assert rate-gated and rejected guesses do not increment guess counts
    - _Requirements: 4.6, 4.8, 7.4_

  - [x] 13.4 Implement leave and disconnect handlers
    - Wire `leave` (in-progress → `persistLeaverAsLoss` then remove; lobby → free) and `disconnect` (retain match state for reconnect); clean up the room when the last player leaves; emit `round:transition`, `eliminated`, and `match:result` at the appropriate lifecycle points
    - _Requirements: 5.9, 6.6, 8.6, 8.7, 9.1, 9.3, 9.4, 10.3, 10.4, 10.5_

  - [x] 13.5 Write unit tests for reconnect routing and leave handling
    - Disconnect retains state; reconnect returns the same match; eliminated reconnect yields a fresh lobby; in-progress leave forfeits and empty room cleans up
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 14. Checkpoint - Ensure all server tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Client socket hook and anti-spam input
  - [x] 15.1 Implement the Race socket hook
    - Create a `useRaceSocket` hook (paralleling `useBattleRoyaleSocket`) that connects to the `/race` namespace (`io(`${base}/race`, { auth: { token } })`), emits `join` on mount, and subscribes to `join:ack`, `race:update`, `round:transition`, `eliminated`, `match:result`, and `guess:ack`
    - Parallel `useBattleRoyaleSocket` for the hook structure/pattern ONLY; subscribe to no attack-related events and hold no attack-related client state
    - _Requirements: 10.1, 10.6_

  - [x] 15.2 Implement the anti-spam input hook and indicator
    - Create `useAntiSpamInput` driven by `penaltyThresholdMs`/`debounceAmountMs` from `shared/race`, delaying keypress registration while intervals are below threshold and clearing the delay when they return to/above threshold; create `race/anti-spam-indicator.tsx` for the slowed-input indication
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 15.3 Write unit tests for the anti-spam input hook
    - Use fake timers to assert fast intervals apply the delay and show the indicator; slow intervals clear both
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 16. Client UI views
  - [x] 16.1 Implement the Race root component
    - Turn `apps/client/src/components/games/race.tsx` into the Race_Mode root: hold `ClientRaceMatch` state from the hook and switch sub-views on `room.phase`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 16.2 Implement lobby and round views
    - Create `race/lobby-view.tsx` (membership + countdown) and `race/round-board.tsx` (round number, server-clock-corrected timer, word length, progress toward Qualifying_Count, per-letter feedback from `guess:ack`/`race:update`)
    - _Requirements: 10.1, 10.2, 10.6_

  - [x] 16.3 Implement transition, elimination, and result views
    - Create `race/round-transition.tsx` (advanced vs eliminated), `race/elimination-view.tsx` (this player's placement), and `race/result-view.tsx` (winner + own placement); wire them into the root switch
    - _Requirements: 10.3, 10.4, 10.5_

  - [x] 16.4 Write component tests for the client views
    - Component/snapshot tests per phase (lobby, round, transition, elimination, result)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP.
- Each task references specific requirements for traceability; every incomplete leaf task appears in the dependency graph below.
- Checkpoints ensure incremental validation.
- Property tests validate the 14 universal correctness properties against the pure logic core (`logic/round.ts`, `logic/rate-limit.ts`, `shared/race.ts`, and the `rankPlayers`/leaver logic in `stats.ts`); unit, integration, and component tests cover wiring, timing, auth, DB concurrency, and UI.
- Use `fast-check` with `vitest` for property tests (min 100 runs), tagging each with `// Feature: round-based-elimination-race, Property {n}: {text}`.
- **Battle Royale is reused as a structural/layout pattern ONLY** (module file layout, state separation, coalesced broadcasts, upsert-on-finish stats, bot-fill, socket wiring). Race is a solo race-to-qualify with independent per-player words and elimination by ranking — there is no targeting or attack mechanic. The Race implementation MUST NOT include or copy any of the following from `battle-royale/`: `applyAttack`, `determineTarget`, `Max_Attack_Words`, attack queues (`queue`/`attackerQueue`), `currentWordIsAttack`, `currentWordAttackerName`, `lastAttackerName`, or "eliminated by X" / attack-word bonus logic. The server-only per-player `RacePlayerServerData` holds only `{ word, lastAcceptedGuessAt }`.
- Word lists are reused, not recreated: the four-, five-, and six-letter arrays already exist in the client (`apps/client/src/utils/four-letter-words.ts`, `words.ts`, `six-letter-words.ts`) and are relocated to a shared location so both client and server import them without duplication.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.2", "4.1", "8.1", "12.1"] },
    { "id": 2, "tasks": ["3.3", "3.4", "3.7", "3.10", "4.2", "6.1"] },
    { "id": 3, "tasks": ["3.5", "3.6", "3.8", "3.9", "3.11", "7.1", "9.1", "10.1"] },
    { "id": 4, "tasks": ["7.2", "7.3", "7.4", "9.2", "10.2", "10.3", "15.1", "15.2"] },
    { "id": 5, "tasks": ["7.5", "7.8", "7.10", "8.2", "10.4", "10.5", "15.3", "16.1"] },
    { "id": 6, "tasks": ["7.6", "7.7", "7.9", "7.11", "12.2", "16.2", "16.3"] },
    { "id": 7, "tasks": ["12.3", "13.1", "13.4", "16.4"] },
    { "id": 8, "tasks": ["13.2"] },
    { "id": 9, "tasks": ["13.3", "13.5"] }
  ]
}
```
