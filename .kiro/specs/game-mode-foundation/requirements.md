# Requirements Document

## Introduction

Game_Mode_Foundation is the Phase 0 groundwork that lets Final Word add new game modes (Category Clash, Letter Scramble, Word Ladder) and, crucially, **cycle modes in and out over time** without running them all simultaneously and without breaking games already played in a mode that is later retired.

Final Word already has the building blocks a new mode needs: a `GameModule` registry on the realtime server (`apps/server/src/games/registry.ts`), a migration-free `GAME_MODES` string union as the single source of truth for mode identity (`packages/db/src/schema.ts`), and a unified `player_mode_stats` table keyed on `(userId, mode, scope)` that already partitions stats per mode. What does NOT exist today is any notion of a mode being **available or unavailable** for new games: a mode is "live" purely because it is hardcoded in the `gameModules` array and offered by the client. There is no single place that answers "which modes can a player start right now?", and nothing guarantees that disabling a mode leaves its in-flight and historical games intact.

The asynchronous modes (today's `duel`/`classic` word game, and the future Category Clash, Letter Scramble, and Word Ladder modes) all live on the existing `/duels` page (`apps/client/src/pages/duels.tsx`), which already provides friends, invitations, archive, and realtime subscriptions. These new modes are therefore **duel variants** rather than a separate surface: the existing "New Duel" flow (`apps/client/src/components/duels/new-duel.tsx`) gains a mode picker (Classic, Scramble, etc.), the chosen mode travels with the invitation through the existing `onSendDuel` → `sendDuelMutation` path, and the server kicks off the duel in that mode. The existing duel creation gate (invitee and active-duel caps, whose messages already surface to the user) is where the mode-availability check also lands. Realtime modes (Battle Royale, Race) keep their own entry points and are unaffected by the duels surface.

This feature introduces a **Mode_Registry** — one authoritative, shared description of every known mode and whether it is currently selectable — plus the enforcement and client-discovery wiring around it. It deliberately does NOT implement any new game's rules; it builds the seam those modes plug into. Existing modes (Battle Royale, Race, Duel) must keep working unchanged, and reimplementing them against the registry must be a no-op from a player's perspective.

This document specifies the registry, the create-time availability gate, the rotation-safety guarantees for in-flight and historical games, and the client discovery surface. It introduces no new gameplay and no scoring rules.

## Glossary

- **Game_Mode_Foundation**: The Phase 0 feature specified by this document — the Mode_Registry and the availability, rotation-safety, and discovery wiring around it.
- **Game_Mode**: A distinct way to play Final Word, identified by a stable string id that is a member of the `GAME_MODES` union in `packages/db/src/schema.ts` (today: `battle_royale`, `race`, `duel`, `classic`).
- **Mode_Registry**: The single authoritative, shared definition listing every known Game_Mode and its Availability_State and metadata. The one place both server and client consult to answer "which modes exist and which are selectable right now?".
- **Mode_Descriptor**: One entry in the Mode_Registry describing a single Game_Mode: its id, a human-readable display name, its Availability_State, and whether it is a realtime or asynchronous mode.
- **Availability_State**: The lifecycle state of a Game_Mode for the purpose of starting NEW games. One of: `enabled` (selectable by all eligible players), `beta` (selectable only by a restricted audience), or `disabled` (not selectable for new games).
- **Mode_Dispatch**: The existing mechanism by which the server routes a game to the correct mode implementation — the `GameModule` registry (`games/registry.ts`) for realtime modes, and the duel code path for asynchronous Duel.
- **Create_Gate**: The server-side check, consulted at game-creation / match-join time, that permits starting a new game in a Game_Mode only when that mode's Availability_State allows it for the requesting player.
- **In_Flight_Game**: A game that has been created or started but not yet completed, in any Game_Mode.
- **Historical_Game**: A game that has already completed and whose stored result and stats are immutable.
- **Rotation**: The act of changing a Game_Mode's Availability_State over time (e.g. moving a seasonal mode from `enabled` to `disabled` and bringing another from `disabled` to `enabled`).
- **Mode_Discovery**: The client-facing surface that reads the Mode_Registry to decide which modes to offer the player for starting a new game.
- **New_Duel_Flow**: The existing client flow on the `/duels` page for creating a duel — the `NewDuel` component (`apps/client/src/components/duels/new-duel.tsx`), its `onSendDuel` callback, and the `handleSendDuel` → `sendDuelMutation` create path in `apps/client/src/pages/duels.tsx`. All asynchronous (duel-variant) modes are started from here.
- **Mode_Picker**: The control added to the New_Duel_Flow that lets the player choose which asynchronous mode (Classic, Scramble, etc.) the duel will be played in before inviting players and sending the duel.
- **Async_Mode**: A Game_Mode whose `kind` is asynchronous and which is played as a duel variant on the `/duels` page (today `duel`/`classic`; future Category Clash, Letter Scramble, Word Ladder). Started via the New_Duel_Flow and the Mode_Picker.
- **Realtime_Mode**: A Game_Mode whose `kind` is realtime and which runs on the Socket.IO server with its own entry point (today `battle_royale`, `race`). Not started from the `/duels` page.

## Requirements

### Requirement 1: Authoritative Mode Registry

**User Story:** As a platform maintainer, I want one authoritative definition of every game mode and whether it is selectable, so that server enforcement and client UI can never disagree about which modes exist or are available.

#### Acceptance Criteria

1. THE Mode_Registry SHALL define exactly one Mode_Descriptor per Game_Mode in the `GAME_MODES` union.
2. THE Mode_Registry SHALL be defined in a package shared by both `apps/server` and `apps/client` so that server enforcement and client discovery reference the same definition.
3. Each Mode_Descriptor SHALL carry the Game_Mode's id, a human-readable display name, its Availability_State, and whether the mode is realtime or asynchronous.
4. THE Mode_Registry SHALL constrain each Mode_Descriptor's id to a member of the `GAME_MODES` union so that a descriptor cannot reference an unknown mode.
5. IF a Game_Mode in the `GAME_MODES` union has no Mode_Descriptor, OR a Mode_Descriptor references an id outside the union, THEN validation of the Mode_Registry SHALL fail with a descriptive error.
6. THE Availability_State of a Game_Mode SHALL be one of `enabled`, `beta`, or `disabled`.
7. WHEN a maintainer changes a Game_Mode's Availability_State in the Mode_Registry, THE change SHALL take effect without a database migration.

### Requirement 2: Availability gate on starting new games

**User Story:** As a platform maintainer, I want the server to refuse new games in a mode that is not currently available, so that disabling a mode actually stops new games in it.

#### Acceptance Criteria

1. WHEN a player attempts to start a new game in a Game_Mode, THE Create_Gate SHALL permit it only if that mode's Availability_State is `enabled`, or `beta` and the player is in the beta audience.
2. IF a player attempts to start a new game in a Game_Mode whose Availability_State is `disabled`, THEN THE Create_Gate SHALL reject the attempt with a reason indicating the mode is unavailable.
3. IF a player attempts to start a new game in a Game_Mode whose Availability_State is `beta` AND the player is not in the beta audience, THEN THE Create_Gate SHALL reject the attempt with a reason indicating the mode is unavailable.
4. THE Create_Gate SHALL be enforced on the server for every entry point that starts a new game, for both Realtime_Modes (match join / lobby creation) and Async_Mode duel creation (the server handler behind the New_Duel_Flow's `sendDuelMutation`).
5. THE Create_Gate SHALL be the authoritative decision; a client that offers an unavailable mode SHALL NOT cause a new game to start.
6. WHERE a Game_Mode's id is not present in the Mode_Registry, THE Create_Gate SHALL treat it as unavailable.
7. WHEN an Async_Mode duel is created via the New_Duel_Flow, THE requested Game_Mode SHALL be sent to the server with the invitation, and THE Create_Gate SHALL validate that mode's availability for the requesting player before any duel is created.
8. IF the New_Duel_Flow sends a request without a recognized Async_Mode, THEN THE server SHALL treat the mode as unavailable and reject creation.
9. WHEN the Create_Gate rejects an Async_Mode duel creation, THE rejection reason SHALL be surfaced through the same duel-creation error channel the existing invitee / active-duel cap messages already use.

### Requirement 3: Rotation safety for in-flight and historical games

**User Story:** As a player partway through a game, I want my game to finish normally even if the mode is retired, so that rotating modes never strands or corrupts games.

#### Acceptance Criteria

1. WHEN a Game_Mode's Availability_State changes to `disabled`, THE server SHALL continue to process, resolve, and record every In_Flight_Game in that mode to a normal completion.
2. THE server SHALL route an In_Flight_Game or a result read to its mode implementation via Mode_Dispatch based on the game's stored mode, independently of that mode's current Availability_State.
3. WHEN a result is read for a Historical_Game whose mode is now `disabled`, THE server SHALL return the stored result unchanged.
4. Changing a Game_Mode's Availability_State SHALL NOT modify any stored result, statistic, or `player_mode_stats` row for that mode.
5. WHERE a mode is `disabled`, THE per-mode statistics for that mode SHALL remain readable and SHALL continue to be displayed in history and profile surfaces.
6. THE Mode_Dispatch SHALL require that every mode present in stored games has a registered implementation, regardless of its Availability_State, so that a disabled mode's games can still be resolved and read.

### Requirement 4: Client mode discovery

**User Story:** As a player, I want to see and start only the modes that are currently available to me, so that I am never offered a mode I cannot play.

#### Acceptance Criteria

1. THE client SHALL determine which modes to offer for starting a new game by reading the Mode_Registry.
2. THE New_Duel_Flow SHALL present a Mode_Picker whose options are the startable Async_Modes, derived from the Mode_Registry.
3. WHEN an Async_Mode's Availability_State is `disabled`, THE Mode_Picker SHALL NOT offer it as a startable option.
4. WHEN an Async_Mode's Availability_State is `beta`, THE Mode_Picker SHALL offer it only to players in the beta audience.
5. WHEN the player sends a duel from the New_Duel_Flow, THE selected Async_Mode SHALL be included in the create request sent to the server.
6. WHERE exactly one startable Async_Mode exists, THE New_Duel_Flow MAY preselect it so the existing single-mode experience is unchanged.
7. THE client SHALL render history, archive, and results for a Historical_Game in any mode that has a Mode_Descriptor, including modes that are currently `disabled`.
8. IF the server rejects a duel creation via the Create_Gate with the unavailable-mode reason, THEN THE client SHALL surface that reason to the player (reusing the existing duel-creation error toast) rather than failing silently.
9. THE Realtime_Mode entry points SHALL continue to determine availability from the Mode_Registry independently of the `/duels` surface.

### Requirement 5: Rematch behavior under rotation

**User Story:** As a player, I want rematches to respect mode availability, so that a retired mode is not reintroduced through the rematch path.

#### Acceptance Criteria

1. WHEN a player requests a rematch of a game whose Game_Mode is currently `enabled` (or `beta` and the player is in the beta audience), THE server SHALL permit the rematch via the normal Create_Gate.
2. IF a player requests a rematch of a game whose Game_Mode is currently `disabled`, THEN THE server SHALL reject the rematch with the unavailable-mode reason.
3. An existing In_Flight_Game created before its mode became `disabled` SHALL be unaffected by Requirement 5.2 and SHALL complete normally.

### Requirement 6: Existing modes reimplemented with no behavior change

**User Story:** As an existing player, I want Battle Royale, Race, and Duel to behave exactly as before, so that introducing the foundation changes nothing I can observe.

#### Acceptance Criteria

1. THE Mode_Registry SHALL include Mode_Descriptors for `battle_royale`, `race`, and `duel`, each with Availability_State `enabled`.
2. WHEN the realtime server starts, THE existing `battle_royale` and `race` GameModules SHALL register through the existing registry exactly as they do today.
3. THE introduction of the Create_Gate SHALL NOT change the behavior of starting, playing, or completing a game in any mode whose Availability_State is `enabled`.
4. THE introduction of the Mode_Registry SHALL NOT change the shape of any stored result or `player_mode_stats` row.
5. THE `classic` entry in `GAME_MODES` SHALL have a Mode_Descriptor whose Availability_State reflects whether it is currently startable, without implying any new gameplay is added by this feature.

### Requirement 7: Mode-specific statistics convention

**User Story:** As a developer adding a future mode, I want a documented place to put mode-specific aggregates, so that new modes can record their own statistics without schema churn or per-mode UI.

#### Acceptance Criteria

1. THE feature SHALL document the convention by which a Game_Mode records mode-specific aggregates within the existing `player_mode_stats` structure without adding per-mode tables.
2. THE documented convention SHALL preserve the rule that a statistic a mode does not track is left untracked rather than written as zero.
3. THE documented convention SHALL NOT require a database migration to add a new mode's statistics.
4. THE documented convention SHALL be consistent with the existing `(userId, mode, scope)` keying and the lifetime-plus-season dual-write already performed on game completion.
