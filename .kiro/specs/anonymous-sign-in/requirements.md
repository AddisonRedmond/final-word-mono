# Requirements Document

## Introduction

This feature adds a low-friction "play as guest" path using Supabase anonymous sign-in. A guest obtains a temporary Supabase account (a real UUID, no email) that authenticates against the existing socket layer with no change to the auth contract. Guest accounts are capped in number, short-lived, limited to one realtime game per game mode, and have no access to social features (duels, friends). Guests DO participate in stats persistence identically to registered users; that stats signal is reused to enforce the one-game-per-mode limit.

The feature is explicitly temporary and intended to be removed later, so every requirement favors additive, isolated changes placed behind clearly named helpers and seams that can be torn out in a single pass without touching registered-user flows.

### Scope decisions carried from the brief

- **Display name**: `Player#<random>` (e.g. `Player#4821`), generated at sign-in because anonymous users have no `user_metadata.full_name`. Names are cosmetic; uniqueness is NOT required (resolves Open Question 5).
- **Account cap**: at most 100 anonymous accounts may exist at any one time, enforced server-side with the service-role key. The cap is a soft limit — the count-then-create check is not atomic, which is acceptable for a soft cap (resolves Open Question 2).
- **Lifetime / cleanup**: anonymous accounts older than 24 hours are deleted by a Supabase `pg_cron` job scheduled every 24 hours. Cleanup is NOT implemented in application code; the SQL is delivered as an installable artifact (a Non-Goal is building a custom cron/worker in app code).
- **Stats**: guest stats ARE persisted, using the exact same persistence path as registered users (`persistRaceStats`, `persistLeaverAsLoss`, `persistEliminatedAsLoss`). This keeps friction low and provides the signal reused to enforce the one-game-per-mode limit. The shared eligibility helper is based only on `isRealPlayer(userId)` (a UUID check); guests have real UUIDs, so they qualify and need no guest-specific branching in the stats path.
- **One game per mode**: a guest may play one realtime game in EACH game mode (one Race game and one Battle Royale game), not one game total. "Already played a game in a mode" is derived from the guest's per-mode stats row: a guest is blocked from starting a new game in a mode WHEN a stats row exists for that guest in that mode's stats table with `gamesPlayed >= 1`. Consumption is recorded at match OUTCOME via the normal stats write (finish, elimination, or leaver-loss), so a disconnect or leave mid-game still records the game (leaver-loss) and consumes that mode's single game (resolves Open Question 1). The per-mode gate means playing one mode does not block the other mode.
- **Mid-game protection**: a second concurrent game is prevented by the existing single-connection guard (`apps/server/src/socket/single-connection.ts`, one socket per user), and the stats-derived gate blocks the next attempt once the leaver-loss write lands. No separate in-progress tracking is needed.
- **Anonymous detection**: Supabase exposes `is_anonymous` on the user object and JWT claims, so the socket layer reads it from the already-fetched user without an extra DB lookup (resolves Open Question 3).
- **Feature gating granularity**: both server and client — the server rejects anonymous users on duel and friends procedures AND the client hides those UI entry points (resolves Open Question 4).
- **One-game limit location**: the per-mode one-game gate lives behind the existing `daily-limit.ts` seam (`canStartMatch` reads the mode's stats for guests), keeping all match-start gating in one place (resolves Open Question 6).
- **Cleanup cascade**: deleting an aged anonymous `auth.users` row cascades through `profiles` (`onDelete: cascade`) to the per-mode stats rows (`race_stats`, `battle_royale_stats`), so guest stats are removed automatically with no separate stats-deletion statement.

### Out of scope (Non-Goals)

- Upgrading or linking an anonymous session to a real email or OAuth account.
- Any change to behavior for existing registered users.
- Implementing cleanup logic in application code (handled by Supabase `pg_cron`).

## Glossary

- **Guest / Anonymous_User**: A user authenticated through Supabase anonymous sign-in. Has a real Supabase UUID, `is_anonymous = true`, and no email.
- **Registered_User**: A user authenticated through a normal (email/OAuth) Supabase account, `is_anonymous = false`.
- **Anon_SignIn_Endpoint**: The server endpoint (service-role) that enforces the cap and performs anonymous sign-in.
- **Account_Cap**: The maximum number of anonymous accounts allowed to exist concurrently (100).
- **Socket_Auth**: The Supabase-JWT socket authentication middleware at `apps/server/src/socket/auth.ts`.
- **Daily_Limit_Seam**: The match-start gating module at `apps/server/src/games/race/daily-limit.ts` (`canStartMatch` / `recordMatchStart`). For guests, `canStartMatch` now reads the mode's Mode_Stats row to enforce the one-game-per-mode gate.
- **Stats_Persistence**: The three stats entry points (`persistRaceStats`, `persistLeaverAsLoss`, `persistEliminatedAsLoss`) that write at match outcome, used identically for guests and Registered_Users.
- **Mode_Stats**: The per-game-mode aggregate stats table (`race_stats` or `battle_royale_stats`), holding ONE row per user keyed by `userId` with a `gamesPlayed` counter. A row is created on a user's first completed match in that mode.
- **Real_Player_Check**: The shared eligibility helper `isRealPlayer(userId)`, a UUID check that returns true for any real account (guests included) and false for bots. It is the sole basis for stats-persistence eligibility.
- **Protected_Procedure**: The authenticated tRPC middleware at `apps/client/src/server/api/trpc.ts` that guards duel and friends procedures.
- **Realtime_Game**: A single Race match played over the socket layer.
- **Display_Name**: The name shown for a player, in the form `Player#<random>` for a Guest.
- **Cleanup_Job**: The Supabase `pg_cron` scheduled job that deletes aged anonymous accounts.

## Requirements

### Requirement 1: Guest sign-in entry point

**User Story:** As a visitor, I want to start playing with a single click as a guest, so that I can play immediately without creating an account.

#### Acceptance Criteria

1. THE Client SHALL present a "Play as guest" control that initiates anonymous sign-in.
2. WHEN a visitor activates the "Play as guest" control, THE Anon_SignIn_Endpoint SHALL perform Supabase anonymous sign-in server-side using the service-role key.
3. WHEN anonymous sign-in succeeds within 5 seconds, THE Anon_SignIn_Endpoint SHALL return a session containing a non-empty access token to the Client.
4. WHEN the Client receives a guest session, THE Client SHALL authenticate the socket connection using the returned access token through the existing Socket_Auth, with no change to the auth contract.
5. THE Anon_SignIn_Endpoint SHALL execute the account count check and the anonymous sign-in call only server-side with the service-role key.
6. WHILE an anonymous sign-in request initiated from the "Play as guest" control is in flight, THE Client SHALL disable the "Play as guest" control and display a loading indicator, and SHALL ignore any additional activations of that control until the in-flight request resolves.
7. IF the anonymous sign-in request fails or does not resolve within 5 seconds, THEN THE Client SHALL re-enable the "Play as guest" control, remove the loading indicator, and display an error message indicating that guest sign-in could not be completed, without establishing a socket connection.
8. IF the Anon_SignIn_Endpoint's anonymous sign-in call fails, THEN THE Anon_SignIn_Endpoint SHALL return an error response indicating sign-in failure to the Client and SHALL NOT return an access token.

### Requirement 2: Concurrent account cap

**User Story:** As the system operator, I want a hard ceiling on concurrent guest accounts, so that abuse of anonymous sign-in is limited.

#### Acceptance Criteria

1. WHEN a guest sign-in is requested, THE Anon_SignIn_Endpoint SHALL count all existing accounts where `is_anonymous` is `true` by paginating through the full set of auth users before creating a new account.
2. IF counting the existing anonymous accounts fails or does not complete, THEN THE Anon_SignIn_Endpoint SHALL reject the request without creating an account and SHALL return an error identifying the count failure as the reason, distinct from the cap-rejection error.
3. IF the current anonymous account count is at or above the Account_Cap of 100 accounts, THEN THE Anon_SignIn_Endpoint SHALL reject the request without creating an account and SHALL return a cap-rejection error that identifies the cap as the reason and is distinguishable from all other failure errors.
4. WHEN the current anonymous account count is below the Account_Cap of 100 accounts, THE Anon_SignIn_Endpoint SHALL proceed with anonymous sign-in and create exactly one new anonymous account.
5. WHEN the Client receives a cap-rejection error, THE Client SHALL display a message explaining that guest play is temporarily unavailable.
6. IF the Client receives a count-failure error or any non-cap sign-in error, THEN THE Client SHALL display a message indicating sign-in failed for a reason other than the guest cap.

### Requirement 3: Guest display name

**User Story:** As a guest, I want a recognizable display name, so that I appear as a named player in a game instead of a blank or duplicate identity.

#### Acceptance Criteria

1. WHEN a guest account is created, THE System SHALL generate a display name composed of a fixed prefix followed by a random identifier of 4 to 6 characters drawn from the character set [A-Z0-9].
2. WHILE resolving a guest's display name during socket connection, THE System SHALL use the value of user_metadata.full_name when it is present and contains at least 1 non-whitespace character.
3. IF user_metadata.full_name is absent, empty, or contains only whitespace during socket resolution, THEN THE System SHALL assign the fallback display name "Player".
4. IF display name generation produces an empty value or a value outside the defined character set and length bounds, THEN THE System SHALL assign the fallback display name "Player" and SHALL NOT reject the account creation.
5. THE System SHALL treat the guest display name as cosmetic and SHALL NOT enforce uniqueness of the display name across accounts.

### Requirement 4: Server-side anonymous detection

**User Story:** As a developer, I want the socket layer to know whether a connected user is a guest, so that downstream logic can sandbox guests without an extra database lookup.

#### Acceptance Criteria

1. WHEN Socket_Auth validates an access token, THE Socket_Auth SHALL read the `is_anonymous` value from the already-resolved user object without performing an additional database query.
2. WHEN Socket_Auth resolves a user whose `is_anonymous` value equals `true`, THE Socket_Auth SHALL set `socket.data.isAnonymous` to `true`.
3. WHEN Socket_Auth resolves a user whose `is_anonymous` value equals `false`, THE Socket_Auth SHALL set `socket.data.isAnonymous` to `false`.
4. IF the resolved user object is missing the `is_anonymous` value or its value is `undefined` or `null`, THEN THE Socket_Auth SHALL set `socket.data.isAnonymous` to `true`.
5. WHEN a socket whose `socket.data.isAnonymous` equals `true` joins a Realtime_Game, THE Race_Join_Handler SHALL set the `isAnonymous` field on that socket's player record for the match to `true`.
6. WHEN a socket whose `socket.data.isAnonymous` equals `false` joins a Realtime_Game, THE Race_Join_Handler SHALL set the `isAnonymous` field on that socket's player record for the match to `false`.

### Requirement 5: Guest stats persistence

**User Story:** As a guest, I want my game result recorded like any player, so that play stays low-friction and the system has a reliable signal for the one-game-per-mode limit.

#### Acceptance Criteria

1. THE System SHALL determine stats-persistence eligibility for a player using the single shared Real_Player_Check helper, which returns eligible when `isRealPlayer(userId)` is true, with no branch on `isAnonymous`.
2. WHEN `isRealPlayer(userId)` returns true for a Guest player, THE System SHALL treat that Guest as eligible for stats persistence.
3. WHEN persistRaceStats, persistLeaverAsLoss, or persistEliminatedAsLoss is invoked for a Guest player, THE System SHALL persist that Guest's Mode_Stats row using the identical persistence path applied to a Registered_User.
4. WHEN a match contains both Guest and Registered_User players, THE System SHALL persist Guest and Registered_User rows through the same path with no Guest-specific branching.
5. WHEN a Guest player's match outcome is win, loss, leaver, or eliminated, THE System SHALL persist that Guest player's Mode_Stats for that outcome exactly as it does for a Registered_User.

### Requirement 6: One realtime game per guest per game mode

**User Story:** As a guest, I want to play one game in each game mode, so that I can try each mode, after which I am prompted to sign up to continue.

#### Acceptance Criteria

1. WHEN a Guest requests to start a Realtime_Game in a game mode for which no Mode_Stats row exists for that Guest, THE Daily_Limit_Seam SHALL permit the match start within 2 seconds of receiving the request.
2. WHEN the Daily_Limit_Seam evaluates `canStartMatch` for a Guest, THE Daily_Limit_Seam SHALL read that Guest's Mode_Stats row for the requested game mode to decide whether a prior game has been played in that mode.
3. IF a Mode_Stats row exists for the Guest in the requested mode's stats table with `gamesPlayed` greater than or equal to 1, THEN THE Daily_Limit_Seam SHALL reject the start for that mode, and the join flow SHALL emit an error whose reason identifies the one-game-per-mode limit.
4. WHEN the Daily_Limit_Seam rejects a Guest start for one game mode, THE Daily_Limit_Seam SHALL permit that Guest to start a Realtime_Game in a different game mode for which no Mode_Stats row with `gamesPlayed` greater than or equal to 1 exists.
5. WHEN the Client receives the one-game-per-mode rejection, THE Client SHALL display a prompt that invites the Guest to sign up to continue playing and that offers a navigable action to begin sign-up.
6. WHILE a Guest's game is in progress, THE System SHALL prevent a second concurrent Realtime_Game for that Guest through the single-connection guard.
7. WHEN a Guest leaves or disconnects from an in-progress Realtime_Game, THE System SHALL record that game via persistLeaverAsLoss into the mode's Mode_Stats, such that a subsequent start request in that mode is rejected by the Daily_Limit_Seam.
8. WHEN a Registered_User requests to start a Realtime_Game, THE Daily_Limit_Seam SHALL permit the match start without reading Mode_Stats or evaluating the one-game-per-mode limit.

### Requirement 7: Social and database features disabled for guests

**User Story:** As the system operator, I want guests blocked from social and persistent features, so that temporary accounts cannot create or read durable application data.

#### Acceptance Criteria

1. IF a Guest invokes a duels procedure, THEN THE System SHALL reject the request with an authorization error and SHALL NOT create, modify, or read any persisted duel state.
2. IF a Guest invokes a friends procedure, THEN THE System SHALL reject the request with an authorization error and SHALL NOT create, modify, or read any persisted friends state.
3. WHILE a Guest session is active, THE System SHALL hide the duels user interface entry points from the Guest.
4. WHILE a Guest session is active, THE System SHALL hide the friends user interface entry points from the Guest.
5. WHERE a feature is a realtime game session that does not write durable application data, THE System SHALL permit Guest participation as the only exception to Guest social and database restrictions.
6. WHEN a Registered_User invokes a duels or friends procedure, THE System SHALL execute the nominal path unchanged and SHALL return an observable success result.

### Requirement 8: Scheduled cleanup of aged guest accounts

**User Story:** As the system operator, I want aged guest accounts removed automatically, so that temporary accounts do not accumulate.

#### Acceptance Criteria

1. THE System SHALL compute the age of each guest account as the difference between the current time and the account's created_at timestamp.
2. WHEN the scheduled cleanup runs, THE System SHALL delete only accounts where is_anonymous is true and SHALL NOT delete accounts where is_anonymous is false or null.
3. THE System SHALL execute the guest cleanup on a schedule that runs every 24 hours via pg_cron.
4. THE System SHALL implement the cleanup as a scheduled database job via pg_cron and SHALL NOT implement it in application code.
5. WHEN the scheduled cleanup deletes an anonymous auth.users row, THE System SHALL remove that account's profiles row and its per-mode Mode_Stats rows (race_stats, battle_royale_stats) through the existing onDelete cascade, leaving no orphaned guest stats.
6. THE System SHALL rely on the existing onDelete cascade for stats removal and SHALL NOT include a separate stats-deletion statement in the cleanup job.
7. IF the scheduled cleanup fails, THEN THE System SHALL leave all guest account rows and their cascaded stats rows unchanged and SHALL record the failure as an observable entry in the pg_cron run history.

### Requirement 9: Removable, isolated feature

**User Story:** As a developer, I want the guest feature isolated behind named seams, so that I can remove it later in one pass without affecting registered-user flows.

#### Acceptance Criteria

1. THE Feature SHALL implement all guest-specific behavior as additive changes located behind named helpers, flags, or seams, such that no existing Registered_User code path is modified in place.
2. WHEN all guest-specific code is removed in a single pass, THE System SHALL retain unchanged runtime behavior for Registered_User sign-in, matchmaking, stats, duels, and friends, verified by the pre-existing test suite passing with zero failures.
3. IF guest-specific code is removed and any Registered_User test in sign-in, matchmaking, stats, duels, or friends fails, THEN THE System SHALL be treated as not meeting the isolation requirement, with the failing test identified as the isolation violation.
4. THE Feature SHALL confine guest match-start gating exclusively to the Daily_Limit_Seam per-mode guest gate, such that removing that single gate disables one-game-per-mode enforcement without any edit to Match or Round logic.
5. THE Feature SHALL add no guest-specific branching to the Stats_Persistence path or the Real_Player_Check helper, such that removing all guest-specific code leaves the shared stats path untouched and stats persistence continues unchanged for every real player.
6. WHEN guest-specific code is removed, THE System SHALL leave zero residual references to guest helpers, flags, or seams, verified by a repository-wide search for the guest seam identifiers returning no matches outside removed files.
