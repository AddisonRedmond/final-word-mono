# Implementation Plan: Anonymous Sign-In (Play as Guest)

## Overview

This plan converts the finalized design into an incremental, test-driven build. It
starts with pure, unit-testable seams (name generation, anonymous resolution, the
cap counter, the per-mode gate), then wires them into the tRPC sign-in endpoint and
the socket layer, then stamps the per-match flag, then adds the match-start gating,
then feature-gates duels/friends on server and client, then builds the client
"Play as guest" UX, and finally delivers the `pg_cron` cleanup SQL as an installable
artifact.

Property-based tests (fast-check, `numRuns: 100`, Vitest) cover the 13 correctness
properties from the design. Each PBT sub-task is marked optional with `*` and tagged
with its design property and the requirements clause it validates. Every new surface
carries a `guest`/`anon` identifier so the feature is greppable and removable in one
pass (R9).

The pg_cron cleanup is explicitly NOT application code — it is delivered as a SQL
migration artifact; installing/scheduling it in Supabase is a manual step called out
below.

## Tasks

- [x] 1. Guest display-name generation (pure seam)
  - [x] 1.1 Implement `generateGuestDisplayName` in `apps/client/src/utils/guest-name.ts`
    - Export `GUEST_NAME_PREFIX = "Player#"`, `GUEST_NAME_FALLBACK = "Player"`, the `[A-Z0-9]` alphabet, and min/max length (4–6)
    - Pure function `generateGuestDisplayName(rng = Math.random)`: returns `Player#` + 4–6 chars from `[A-Z0-9]`; on any empty/out-of-bounds result return the fallback `"Player"`; never throw; not unique by design
    - _Requirements: 3.1, 3.4, 3.5_
  - [x] 1.2 Write property test for display-name generator in `apps/client/src/utils/guest-name.test.ts`
    - **Property 2: Display-name generator is total and well-formed**
    - Assert output matches `^Player#[A-Z0-9]{4,6}$` or equals `"Player"`, never empty, never throws, across adversarial rng sequences (fast-check, numRuns: 100)
    - _Validates: Requirements 3.1, 3.4_

- [x] 2. Server-side anonymous detection seam (pure)
  - [x] 2.1 Implement `apps/server/src/socket/anonymous.ts`
    - Export `ANON_FAIL_SAFE = true`
    - `resolveIsAnonymous(user)`: returns `false` only when `is_anonymous === false`; `true` for `true`, `undefined`, `null`, or absent (nullish fail-safe)
    - `resolveDisplayName(user)`: returns `user_metadata.full_name` when it is a string with ≥1 non-whitespace char, else `"Player"`
    - _Requirements: 4.1, 4.4, 3.2, 3.3_
  - [x] 2.2 Write property test for anonymous resolution in `apps/server/src/socket/anonymous.test.ts`
    - **Property 1: Anonymous resolution truth table**
    - Across `is_anonymous` ∈ {true, false, undefined, null, absent}, assert `resolveIsAnonymous` is `false` iff strictly `false`, else `true` (fast-check, numRuns: 100)
    - _Validates: Requirements 4.2, 4.3, 4.4_
  - [x] 2.3 Write property test for display-name resolution in `apps/server/src/socket/anonymous.test.ts`
    - **Property 3: Display-name resolution prefers a non-blank full_name**
    - For any `full_name`, returns it when it has a non-whitespace char, else `"Player"` for absent/empty/whitespace-only (fast-check, numRuns: 100)
    - _Validates: Requirements 3.2, 3.3_

- [x] 3. Guest per-mode gate seam (pure decision over a mocked stats read)
  - [x] 3.1 Implement `apps/server/src/games/guest-mode-gate.ts`
    - Export `GUEST_MODE_LIMIT_REASON = "guest-mode-limit"`
    - `guestModeGate(userId, table)`: reads the guest's `Mode_Stats` row for the given mode table; returns `true` (ALLOW) when no row exists or `gamesPlayed < 1`, `false` (BLOCK) when a row exists with `gamesPlayed >= 1`; fail-open (any DB error resolves to `true`)
    - _Requirements: 6.2, 6.3_
  - [x] 3.2 Write property test for the per-mode gate decision in `apps/server/src/games/guest-mode-gate.test.ts`
    - **Property 10: Guest per-mode gate decision**
    - Over any stats-row state, ALLOW when absent or `gamesPlayed < 1`, BLOCK (and the join flow would emit `guest-mode-limit`) when `gamesPlayed >= 1` (fast-check, numRuns: 100, mocked stats read)
    - _Validates: Requirements 6.1, 6.3_
  - [x] 3.3 Write property test for cross-mode independence in `apps/server/src/games/guest-mode-gate.test.ts`
    - **Property 11: Per-mode gating is independent across modes**
    - For any `(raceGamesPlayed, brGamesPlayed)`, the race decision depends only on race stats and the BR decision only on BR stats (fast-check, numRuns: 100)
    - _Validates: Requirements 6.4_

- [x] 4. Anonymous account cap counter (pure over mocked admin pagination)
  - [x] 4.1 Implement `apps/client/src/server/api/guest-cap.ts`
    - Export `ANON_ACCOUNT_CAP = 100`
    - `countAnonymousUsers(admin)`: paginate the full `auth.users` set via the service-role admin client, summing `is_anonymous === true`; throw if any page fetch fails so the caller can surface `COUNT_FAILED` distinctly
    - _Requirements: 2.1, 2.2_
  - [x] 4.2 Write property test for the counter in `apps/client/src/server/api/guest-cap.test.ts`
    - **Property 4: Anonymous count is correct regardless of pagination**
    - For any user set partitioned into arbitrary page sizes, result equals the number of `is_anonymous === true` users (fast-check, numRuns: 100, mocked admin)
    - _Validates: Requirements 2.1_

- [x] 5. Checkpoint — pure seams
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. tRPC guest sign-in endpoint
  - [x] 6.1 Implement `guestRouter.signIn` in `apps/client/src/server/api/routers/guest.ts`
    - Define `GuestSignInError = "CAP_REACHED" | "COUNT_FAILED" | "SIGN_IN_FAILED"` and `GuestSignInSession = { accessToken: string }`
    - `publicProcedure.mutation` using a service-role Supabase admin client only (never the anon/cookie client): order is count → cap → create. Count failure → `COUNT_FAILED` (no create); count `>= 100` → `CAP_REACHED` (no create); else `signInAnonymously()`, on provider failure or token-less result → `SIGN_IN_FAILED`; on success set `user_metadata.full_name = generateGuestDisplayName()` and return `{ accessToken }` (guaranteed non-empty)
    - _Requirements: 1.2, 1.3, 1.5, 1.8, 2.2, 2.3, 2.4, 3.1_
  - [x] 6.2 Register the `guest` router in `apps/client/src/server/api/root.ts`
    - Add the single-line `guest: guestRouter` registration to `appRouter`
    - _Requirements: 1.2_
  - [x] 6.3 Write property test for the count-failure path in `apps/client/src/server/api/routers/guest.test.ts`
    - **Property 5: Counting failure never creates an account and is distinctly reported**
    - For any page-fetch failure, assert no account-creation call is made and `COUNT_FAILED` is returned, distinguishable from `CAP_REACHED` (fast-check, numRuns: 100, mocked admin)
    - _Validates: Requirements 2.2_
  - [x] 6.4 Write property test for the cap boundary in `apps/client/src/server/api/routers/guest.test.ts`
    - **Property 6: Cap boundary governs account creation at 100**
    - For any count `n`, exactly one account created when `n < 100`; no account and distinguishable `CAP_REACHED` when `n >= 100` (fast-check, numRuns: 100, mocked admin)
    - _Validates: Requirements 2.3, 2.4_
  - [x] 6.5 Write property test for token-on-success in `apps/client/src/server/api/routers/guest.test.ts`
    - **Property 7: Sign-in result carries a token exactly on success**
    - Non-empty token returned iff `signInAnonymously` succeeded; every failure (incl. token-less "success") → `SIGN_IN_FAILED`, no token (fast-check, numRuns: 100, mocked admin)
    - _Validates: Requirements 1.3, 1.8_
  - [x] 6.6 Write integration test for service-role usage and endpoint wiring in `apps/client/src/server/api/routers/guest.integration.test.ts`
    - Assert the resolver uses the service-role admin client (not the anon/cookie client) and is reachable as an unauthenticated `publicProcedure`
    - _Requirements: 1.2, 1.5_

- [x] 7. Socket auth: set `socket.data.isAnonymous`
  - [x] 7.1 Extend socket data type and wire `apps/server/src/socket/auth.ts`
    - Add `isAnonymous: boolean` to the socket data type
    - After `getUser` resolves, set `socket.data.name = resolveDisplayName(user)` and `socket.data.isAnonymous = resolveIsAnonymous(user)` with no extra DB/network call (reuse the already-fetched user)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 3.2, 3.3_
  - [x] 7.2 Write integration test for no-extra-query anonymous read in `apps/server/src/socket/auth.test.ts`
    - Assert `is_anonymous` is read off the resolved user with no additional query, and `socket.data.isAnonymous` is set from `resolveIsAnonymous`
    - _Requirements: 4.1_

- [x] 8. Stamp `isAnonymous` on the per-match player record (both modes)
  - [x] 8.1 Add `isAnonymous` to the Race player record in `apps/server/src/games/race/handlers.ts`
    - Add `isAnonymous` to `RacePlayer` type and set it from `socket.data.isAnonymous` when the player joins a match
    - _Requirements: 4.5, 4.6_
  - [x] 8.2 Add `isAnonymous` to the Battle Royale player record in `apps/server/src/games/battle-royale/handlers.ts`
    - Add `isAnonymous` to the BR player type and set it from `socket.data.isAnonymous` when the player joins a match
    - _Requirements: 4.5, 4.6_
  - [x] 8.3 Write unit tests for the stamp propagation (both modes)
    - Assert `socket.data.isAnonymous === true` → player record `isAnonymous === true`, and `false` → `false`, for Race and Battle Royale
    - _Requirements: 4.5, 4.6_

- [x] 9. Confirm stats path stays unchanged (no guest branch)
  - [x] 9.1 Write property test asserting eligibility is `isRealPlayer` alone in `apps/server/src/games/stats-eligibility.guest.test.ts`
    - **Property 8: Stats eligibility is `isRealPlayer` alone**
    - For any player id (UUID or bot key) and any `isAnonymous` flag value, eligibility equals `isRealPlayer(id)`; the `isAnonymous` flag has zero effect (fast-check, numRuns: 100)
    - _Validates: Requirements 5.1, 5.2_
  - [x] 9.2 Write property test asserting persisted stats are guest-independent in `apps/server/src/games/stats-eligibility.guest.test.ts`
    - **Property 9: Persisted stats are independent of guest status**
    - For any outcome (win/loss/leaver/eliminated) and otherwise identical inputs, the persisted stats row is identical whether the player is flagged guest or registered (fast-check, numRuns: 100)
    - _Validates: Requirements 5.3, 5.4, 5.5_

- [x] 10. Checkpoint — endpoint, auth, stamp, stats
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Per-mode one-game gate behind the daily-limit seam (both modes)
  - [x] 11.1 Extend Race `canStartMatch` in `apps/server/src/games/race/daily-limit.ts`
    - Extend signature to `canStartMatch(userId, isAnonymous)`: registered users (`!isAnonymous`) return `true` without reading stats; guests delegate to `guestModeGate(userId, raceStats)`; update call sites
    - _Requirements: 6.1, 6.2, 6.8_
  - [x] 11.2 Create the Battle Royale daily-limit seam in `apps/server/src/games/battle-royale/daily-limit.ts`
    - New seam mirroring Race, reading `battleRoyaleStats`: `canStartMatch(userId, isAnonymous)` returns `true` for registered users, delegates to `guestModeGate(userId, battleRoyaleStats)` for guests
    - _Requirements: 6.1, 6.2, 6.4, 6.8_
  - [x] 11.3 Emit the guest-mode `join:error` from the Race join handler
    - In `apps/server/src/games/race/handlers.ts`, call `canStartMatch(userId, socket.data.isAnonymous)`; on block emit `join:error { reason: socket.data.isAnonymous ? GUEST_MODE_LIMIT_REASON : "daily-limit" }` and do not place the player in a lobby
    - _Requirements: 6.3, 6.5_
  - [x] 11.4 Wire the daily-limit call and `join:error` into the Battle Royale join handler
    - In `apps/server/src/games/battle-royale/handlers.ts`, add the (new) `canStartMatch` call and the same guest-reason `join:error` emission (additive — BR had no daily-limit seam before)
    - _Requirements: 6.3, 6.4, 6.5_
  - [x] 11.5 Write property test for registered-user bypass in `apps/server/src/games/daily-limit.guest.test.ts`
    - **Property 12: Registered users bypass the gate without reading stats**
    - For any stats state, a non-anonymous user is permitted and the gate performs no `Mode_Stats` read (spy asserts no read) (fast-check, numRuns: 100)
    - _Validates: Requirements 6.8_
  - [x] 11.6 Write integration test for the leaver → next-start-blocked sequence
    - Guest plays, leaves/disconnects → `persistLeaverAsLoss` writes `gamesPlayed >= 1` → a subsequent start in that mode is rejected by the seam; also assert single-connection guard blocks a concurrent second game
    - _Requirements: 6.6, 6.7_
  - [x] 11.7 Write integration test for per-mode table selection
    - Assert Race reads `race_stats` and Battle Royale reads `battle_royale_stats`, and a block in one mode leaves the other startable
    - _Requirements: 6.2, 6.4_

- [x] 12. Guest feature gating on server (duels + friends)
  - [x] 12.1 Add `guestProtectedProcedure` in `apps/client/src/server/api/trpc.ts`
    - Extend `protectedProcedure` to throw `TRPCError({ code: "FORBIDDEN" })` when `ctx.user.is_anonymous === true`, before any resolver runs
    - _Requirements: 7.1, 7.2_
  - [x] 12.2 Swap duels/friends procedures to `guestProtectedProcedure`
    - Replace every `protectedProcedure` with `guestProtectedProcedure` in `apps/client/src/server/api/routers/duels.ts` and `friends.ts`; registered-user paths unchanged
    - _Requirements: 7.1, 7.2, 7.6_
  - [x] 12.3 Write integration test for guest rejection with zero DB access
    - Assert a guest invoking duels/friends is rejected with an authorization error and no persisted state is read/written; a registered user returns an observable success
    - _Requirements: 7.1, 7.2, 7.6_

- [x] 13. Guest feature gating on client (hide UI entry points)
  - [x] 13.1 Add a `useIsGuest()` selector
    - Centralize the read of `useAuthStore().user?.is_anonymous` in one small selector so removal is a single edit
    - _Requirements: 7.3, 7.4_
  - [x] 13.2 Hide duels and friends entry points for guests
    - In the `Navbar`, do not render the Friends link when `useIsGuest()` is true; on the home screen, do not render the duels entry point (`HeadToHeadCard`) for a guest; keep the realtime game cards (Battle Royale, Race) visible as the single permitted exception
    - _Requirements: 7.3, 7.4, 7.5_
  - [x] 13.3 Write unit tests for UI hiding
    - Assert Friends/duels entry points are hidden when guest, visible when registered, and the realtime game cards remain for guests
    - _Requirements: 7.3, 7.4, 7.5_

- [x] 14. Client "Play as guest" UX
  - [x] 14.1 Implement `useGuestSession` hook in `apps/client/src/hooks/useGuestSession.ts`
    - Wrap the `guest.signIn` mutation and session handoff: expose `signInAsGuest()`, `isPending`, and `error: null | "cap" | "other"`; disable/ignore repeat activations while pending; enforce a 5s client timeout; on success hand the session to the existing `index.tsx` play flow (socket connects via the existing contract); on timeout/failure do NOT connect the socket
    - _Requirements: 1.4, 1.6, 1.7, 2.5, 2.6_
  - [x] 14.2 Implement `GuestPlayButton` in `apps/client/src/components/guest/guest-play-button.tsx`
    - Render the "Play as guest" control; while in flight disable it and show a loading indicator and ignore extra activations; map `error === "cap"` → "guest play temporarily unavailable" and `error === "other"` → generic non-cap failure message
    - _Requirements: 1.1, 1.6, 1.7, 2.5, 2.6_
  - [x] 14.3 Implement `GuestSignUpPrompt` in `apps/client/src/components/guest/guest-sign-up-prompt.tsx`
    - Render when a `join:error` with reason `guest-mode-limit` arrives (via the existing `useRaceSocket`/BR socket handling); invite the guest to sign up and offer a navigable action to `/sign-in`
    - _Requirements: 6.5_
  - [x] 14.4 Write unit tests for the guest-play UX
    - Cover: control present (R1.1); disabled + spinner + ignored re-clicks in flight (R1.6); timeout/failure re-enables, drops spinner, shows error, no socket connect (R1.7); cap vs non-cap message mapping (R2.5, R2.6); sign-up prompt renders and navigates on `guest-mode-limit` (R6.5)
    - _Requirements: 1.1, 1.6, 1.7, 2.5, 2.6, 6.5_

- [x] 15. Checkpoint — gating and UI
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. pg_cron cleanup SQL artifact (deliverable, not app code)
  - [x] 16.1 Create `supabase/migrations/<timestamp>_guest_cleanup.sql`
    - `create extension if not exists pg_cron`; `cleanup_anonymous_accounts()` deletes `auth.users` where `is_anonymous = true AND now() - created_at > interval '24 hours'`; idempotent (re)schedule via `cron.unschedule`/`cron.schedule` to run every 24h; rely on the existing `onDelete: cascade` (profiles → race_stats/battle_royale_stats) with NO separate stats-deletion statement
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [x] 16.2 Write property test for the cleanup predicate in `apps/server/src/games/guest-cleanup-predicate.test.ts`
    - **Property 13: Cleanup predicate selects only aged anonymous accounts**
    - Model the SQL `WHERE` as a pure filter `is_anonymous === true && ageHours > 24`; over mixed `is_anonymous` (true/false/null) and arbitrary `created_at`, assert only aged anonymous rows are selected and no false/null row ever is (fast-check, numRuns: 100)
    - _Validates: Requirements 8.2_
  - [x] 16.3 Write integration test for cascade + cleanup-failure atomicity
    - Against a seeded DB, run the real SQL: deleting an aged anonymous `auth.users` row removes its `profiles` and per-mode stats via cascade (no orphans); on failure no rows change and the run is recorded in `cron.job_run_details`
    - _Requirements: 8.5, 8.7_
  - [x] 16.4 Write smoke/architecture check for scheduling and no-app-code cleanup
    - Assert the schedule cadence is 24h and that cleanup exists only as the SQL artifact (no application-code cleanup path)
    - _Requirements: 8.3, 8.4, 8.6_

> MANUAL STEP (non-coding): Installing/scheduling the `pg_cron` job in Supabase is
> performed by the operator (apply the migration / run the SQL in the Supabase
> dashboard). Cleanup is explicitly NOT application code (R8.4); the task above only
> delivers the SQL artifact and its tests.

- [x] 17. Removability / isolation smoke check
  - Confirm all guest surfaces carry a `guest`/`anon` identifier; a repo-wide search for `guest`, `isAnonymous`, `guestModeGate`, `guestProtectedProcedure`, `generateGuestDisplayName`, `resolveIsAnonymous`, `guest-mode-limit`, `countAnonymousUsers` returns matches only in guest files; the pre-existing suite (sign-in, matchmaking, stats, duels, friends) passes unchanged
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 18. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests and the final isolation smoke check) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirement sub-clauses for traceability; property-test sub-tasks name their design property number and the requirements they validate.
- Property-based tests use **fast-check** with **`numRuns: 100`** per the design, run under Vitest, and each is tagged `// Feature: anonymous-sign-in, Property N: <text>`.
- No new tables: the feature reuses `auth.users`, `profiles`, `race_stats`, `battle_royale_stats`.
- The stats path is deliberately left untouched (R5/R9.5); tasks 9.1/9.2 lock in that guests flow through `isRealPlayer` with no guest branch.
- pg_cron cleanup is a delivered SQL artifact, not application code (R8.4); scheduling it is a manual operator step.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "3.2", "3.3", "4.2", "6.1"] },
    { "id": 2, "tasks": ["6.2", "6.3", "6.4", "6.5", "6.6", "7.1"] },
    { "id": 3, "tasks": ["7.2", "8.1", "8.2", "9.1", "9.2", "11.1", "11.2", "12.1", "13.1", "16.1"] },
    { "id": 4, "tasks": ["8.3", "11.3", "11.4", "11.5", "12.2", "13.2", "14.1", "16.2", "16.3", "16.4"] },
    { "id": 5, "tasks": ["11.6", "11.7", "12.3", "13.3", "14.2", "14.3"] },
    { "id": 6, "tasks": ["14.4", "17"] }
  ]
}
```
