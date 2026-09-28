# Requirements Document

## Introduction

Round-Based Elimination Race is a third realtime game mode for Final Word, alongside Battle Royale and Duels. It runs on the existing Hetzner realtime server (`apps/server`) as a self-contained game module and follows the established `GameModule` contract, in-memory room state, and Socket.IO event conventions used by Battle Royale.

A match is a sequence of timed rounds. In each round every surviving player races to correctly guess a configured number of words of a configured length. When a round's timer expires, the slowest bottom percentage of players is eliminated. Play continues into progressively harder rounds (longer words, fewer words to guess) until a final round in which the fastest correct guess wins the match. To discourage brute-force spam guessing, a player who submits guesses faster than a configured threshold has their keypress input debounced so that entry feels deliberately sluggish.

Every gameplay parameter — number of rounds, per-round timer, word length, words-per-round, elimination percentage, lobby size bounds, and anti-spam penalty thresholds — is supplied by a single configuration object rather than hardcoded, so the mode can be retuned without code changes.

When a match finishes, the server upserts a per-user aggregate statistics row into a new Drizzle table (parallel to `battleRoyaleStats`), mirroring the upsert-on-finish flow used by Battle Royale.

This mode is intended to count against the Feature 1 daily realtime-game limit. That enforcement is dormant until Feature 1 ships; during the beta period the mode is unlimited and free. This document specifies a well-defined seam for that future enforcement without depending on Feature 1 existing yet.

## Glossary

- **Race_Mode**: The Round-Based Elimination Race game mode as a whole.
- **Race_Server**: The realtime game module hosted in `apps/server/src/games` that owns Race_Mode state and Socket.IO handlers, registered via `games/registry.ts`.
- **Race_Client**: The Next.js client UI for Race_Mode (`apps/client`), including lobby, in-round board, round-transition, and elimination screens.
- **Race_Config**: The single configuration object that supplies every tunable Race_Mode parameter (round count, per-round timers, word lengths, words-per-round, elimination percentages, lobby-size bounds, and penalty thresholds), defined in a shared schema.
- **Match**: A single instance of Race_Mode play, from lobby start through the final round to a resolved winner or draw.
- **Round**: One timed phase within a Match, characterized by its own timer duration, word length, and words-to-qualify count as read from Race_Config.
- **Final_Round**: The last Round in a Match, in which the first player to submit a correct guess wins the Match.
- **Player**: A real authenticated human participant, keyed by Supabase auth UUID.
- **Bot**: A server-controlled filler participant, keyed by a non-UUID identifier, whose statistics are never persisted.
- **Lobby**: The pre-Match grouping of Players (and Bots) waiting for a Match to start.
- **Qualifying_Count**: The number of words a Player must correctly guess within a Round to be safe from elimination, as read from Race_Config for that Round.
- **Elimination_Percentage**: The configured proportion of surviving Players removed at the end of a Round, as read from Race_Config for that Round.
- **Survivor**: A Player who is not eliminated at the current point in the Match.
- **Penalty_Threshold**: The configured minimum time between accepted keypresses below which anti-spam debouncing applies, as read from Race_Config.
- **Debounce_Amount**: The configured input delay applied to a Player's keypresses while the anti-spam penalty is active, as read from Race_Config.
- **Race_Stats**: The Drizzle table holding one aggregate statistics row per Player for Race_Mode, parallel to `battleRoyaleStats`.
- **Daily_Game_Counter**: The Feature 1 daily realtime-game usage count. It does not exist yet; Race_Mode exposes a seam to increment and check it once Feature 1 ships.

## Requirements

### Requirement 1: Game module registration

**User Story:** As a platform maintainer, I want Race_Mode to be a self-contained game module, so that it plugs into the existing realtime server the same way Battle Royale and Duels do.

#### Acceptance Criteria

1. THE Race_Server SHALL expose a single GameModule with a unique identifier of "round-based-elimination-race".
2. WHEN the realtime server starts, THE Race_Server SHALL register its Socket.IO connection and event handlers via the shared game registry.
3. THE Race_Server SHALL own its Race_Mode room state in server memory, separately from Battle Royale and Duels state.
4. WHERE a socket connects without a valid Supabase access token, THE Race_Server SHALL reject the connection before any Race_Mode handler runs.

### Requirement 2: Configuration-driven rules

**User Story:** As a game designer, I want every Race_Mode rule to come from configuration, so that I can retune the mode without changing code.

#### Acceptance Criteria

1. THE Race_Config SHALL define the total number of Rounds in a Match.
2. THE Race_Config SHALL define, for each Round, the Round timer duration in milliseconds, the word length, the Qualifying_Count, and the Elimination_Percentage.
3. THE Race_Config SHALL define the minimum Lobby size and the maximum Lobby size.
4. THE Race_Config SHALL define the Penalty_Threshold and the Debounce_Amount.
5. THE Race_Config SHALL be defined in a shared schema so that Race_Server and Race_Client reference the same parameter definitions.
6. WHEN the Race_Server reads Race_Config at startup, THE Race_Server SHALL apply the configured values to Match behavior instead of hardcoded constants.
7. IF the Race_Config fails schema validation at startup, THEN THE Race_Server SHALL log a descriptive error and refuse to register Race_Mode.
8. THE Race_Config SHALL define the final Round such that its Qualifying_Count equals 1 word.

### Requirement 3: Lobby formation and matchmaking

**User Story:** As a Player, I want to be placed into a Match with other players, so that I can start racing without manually arranging opponents.

#### Acceptance Criteria

1. WHEN a Player joins Race_Mode, THE Race_Server SHALL place the Player into an open Lobby that has not yet started and has fewer Players than the maximum Lobby size.
2. IF no open Lobby exists when a Player joins, THEN THE Race_Server SHALL create a new Lobby and place the Player into it.
3. WHEN a Lobby reaches the maximum Lobby size, THE Race_Server SHALL start the Match immediately.
4. WHEN the Lobby countdown reaches zero AND the Lobby holds at least the minimum Lobby size of Players, THE Race_Server SHALL start the Match.
5. IF the Lobby countdown reaches zero AND the Lobby holds fewer than the minimum Lobby size of Players, THEN THE Race_Server SHALL add Bots until the Lobby holds the minimum Lobby size, THEN start the Match.
6. WHEN a Player joins a Lobby, THE Race_Server SHALL broadcast the updated Lobby membership to every Player in that Lobby.
7. WHILE a Match is in progress, THE Race_Server SHALL exclude that Match's Lobby from receiving newly joining Players.

### Requirement 4: Round lifecycle and word assignment

**User Story:** As a Player, I want each round to present words to guess within a time limit, so that I can race to qualify.

#### Acceptance Criteria

1. WHEN a Round begins, THE Race_Server SHALL assign each Survivor a word whose length equals the configured word length for that Round.
2. WHEN a Round begins, THE Race_Server SHALL start a Round timer set to the configured Round timer duration for that Round.
3. WHEN a Survivor submits a guess whose length equals the current word length, THE Race_Server SHALL grade the guess against that Survivor's assigned word and return per-letter match feedback.
4. WHEN a Survivor correctly guesses the assigned word AND the Survivor's completed-word count for the Round is below the Qualifying_Count, THE Race_Server SHALL assign the Survivor a new word of the configured length and increment the Survivor's completed-word count.
5. WHEN a Survivor's completed-word count for the Round reaches the Qualifying_Count, THE Race_Server SHALL mark the Survivor as qualified for that Round and record the time at which qualification occurred.
6. IF a Survivor submits a guess whose length does not equal the current word length, THEN THE Race_Server SHALL reject the guess without incrementing the Survivor's guess count.
7. WHILE a Round timer is running, THE Race_Server SHALL broadcast Round progress updates to Players, coalescing broadcasts to at most one per update window per Lobby.
8. THE Race_Server SHALL reject any guess from a Player who is eliminated.

### Requirement 5: Elimination at round end

**User Story:** As a Player, I want the slowest players eliminated at the end of each round, so that the field narrows toward a winner.

#### Acceptance Criteria

1. WHEN a Round timer expires, THE Race_Server SHALL rank the Round's Survivors by qualification: Survivors who reached the Qualifying_Count rank ahead of those who did not.
2. WHEN ranking Survivors who reached the Qualifying_Count, THE Race_Server SHALL order them by earliest qualification time first.
3. WHEN ranking Survivors who did not reach the Qualifying_Count, THE Race_Server SHALL order them by highest completed-word count first, then by fewest total guesses.
4. WHEN a Round ends that is not the Final_Round, THE Race_Server SHALL eliminate the slowest-ranked Survivors equal to the Elimination_Percentage of the Round's Survivor count, rounded to the configured rounding rule.
5. WHEN the Race_Server eliminates a Survivor, THE Race_Server SHALL record the Survivor's finishing placement and the time of elimination.
6. WHEN a Round ends that is not the Final_Round AND at least two Survivors remain, THE Race_Server SHALL begin the next Round with the remaining Survivors.
7. IF a Round ends that is not the Final_Round AND one Survivor remains, THEN THE Race_Server SHALL declare that Survivor the winner and finish the Match.
8. IF a Round ends AND no Survivors remain, THEN THE Race_Server SHALL finish the Match as a draw with no winner.
9. WHEN elimination is applied, THE Race_Server SHALL broadcast each eliminated Player's elimination outcome to that Player's Lobby.

### Requirement 6: Final round and match resolution

**User Story:** As a Player, I want the final round decided by the fastest correct guess, so that a single clear winner emerges.

#### Acceptance Criteria

1. WHEN the Final_Round begins, THE Race_Server SHALL assign each Survivor a word whose length equals the configured word length for the Final_Round.
2. WHEN a Survivor submits the first correct guess of the Final_Round word, THE Race_Server SHALL declare that Survivor the winner and finish the Match.
3. WHEN the Race_Server declares a Final_Round winner, THE Race_Server SHALL record every other Final_Round Survivor's placement in ranking order behind the winner.
4. IF the Final_Round timer expires with no correct guess, THEN THE Race_Server SHALL declare the winner as the Survivor with the highest completed-word count, broken by fewest total guesses, and finish the Match.
5. IF the Final_Round timer expires with no correct guess AND no Survivor has any qualifying progress that distinguishes a leader, THEN THE Race_Server SHALL finish the Match as a draw with no winner.
6. WHEN a Match finishes, THE Race_Server SHALL broadcast the final result, including the winner and each Player's placement, to the Match's Lobby.

### Requirement 7: Anti-spam input penalty

**User Story:** As a Player, I want fast spam guessing to feel deliberately sluggish, so that guessing rewards deliberation over brute force.

#### Acceptance Criteria

1. WHILE a Player's most recent accepted keypress interval is below the Penalty_Threshold, THE Race_Client SHALL delay that Player's subsequent keypress registration by the Debounce_Amount.
2. WHILE the anti-spam penalty is active for a Player, THE Race_Client SHALL display a visible indication that input is being slowed.
3. WHEN a Player's keypress interval returns to or above the Penalty_Threshold, THE Race_Client SHALL remove the input delay and the slowed-input indication.
4. THE Race_Server SHALL enforce that guesses accepted for grading do not exceed the rate implied by the Penalty_Threshold, so that a modified Race_Client cannot bypass the penalty.

### Requirement 8: Aggregate statistics persistence

**User Story:** As a Player, I want my Race_Mode results recorded, so that my lifetime performance is tracked like Battle Royale.

#### Acceptance Criteria

1. THE Race_Stats table SHALL hold one aggregate row per Player, keyed by the Player's Supabase auth UUID.
2. WHEN a Match finishes, THE Race_Server SHALL upsert each real Player's Race_Stats row, incrementing running totals with that Match's outcome.
3. WHEN the Race_Server upserts an existing Race_Stats row, THE Race_Server SHALL increment totals in SQL so that concurrent writes do not overwrite each other's values.
4. THE Race_Server SHALL exclude Bots from Race_Stats persistence.
5. WHEN a Match finishes, THE Race_Server SHALL record for each real Player at least: games played, wins, final placement as a running average, best placement, total guesses, total correct guesses, current win streak, best win streak, whether the last game was won, and last played time.
6. IF a Player leaves a Match that is already in progress, THEN THE Race_Server SHALL persist that Player's result as a loss with a placement reflecting the field size at the moment of leaving.
7. IF a Player leaves a Lobby before the Match has started, THEN THE Race_Server SHALL NOT persist any Race_Stats for that Player.
8. IF Race_Stats persistence fails, THEN THE Race_Server SHALL log the failure and complete Match cleanup without propagating the error into the game loop.

### Requirement 9: Disconnect, reconnect, and leave handling

**User Story:** As a Player, I want an accidental disconnect to be recoverable while an intentional leave counts as forfeit, so that connection blips do not unfairly cost me a game.

#### Acceptance Criteria

1. WHEN a Player's socket disconnects during a Match, THE Race_Server SHALL retain that Player's Match state so the Player can reconnect to the same Match.
2. WHEN a Player reconnects while their Match is still in progress and they are not eliminated, THE Race_Server SHALL rejoin the Player to the same Match and send the current Match state.
3. WHEN a Player explicitly leaves a Match that is in progress, THE Race_Server SHALL remove the Player from the Match and apply the in-progress-leave loss described in Requirement 8.
4. WHEN the last Player leaves a Lobby or Match, THE Race_Server SHALL clean up that room's state and clear its timers.
5. IF a reconnecting Player was already eliminated from their previous Match, THEN THE Race_Server SHALL route the Player into a new Lobby rather than the finished or in-progress Match.

### Requirement 10: Client user interface

**User Story:** As a Player, I want clear UI for the lobby, rounds, transitions, and elimination, so that I always understand the state of the Match.

#### Acceptance Criteria

1. WHILE a Player is in a Lobby, THE Race_Client SHALL display the current Lobby membership and the countdown to Match start.
2. WHILE a Round is in progress, THE Race_Client SHALL display the current Round number, the Round timer, the current word length, and the Player's progress toward the Qualifying_Count.
3. WHEN a Round ends, THE Race_Client SHALL display a Round-transition view indicating which Players advanced and which were eliminated.
4. WHEN a Player is eliminated, THE Race_Client SHALL display an elimination view showing the Player's final placement.
5. WHEN a Match finishes, THE Race_Client SHALL display the winner and the Player's own final placement.
6. WHEN a Player submits a correctly-lengthed guess, THE Race_Client SHALL display per-letter match feedback returned by the Race_Server.

### Requirement 11: Daily game limit integration seam

**User Story:** As a product owner, I want Race_Mode wired to count against the future daily game limit, so that enforcement activates when Feature 1 ships without a later rewrite.

#### Acceptance Criteria

1. WHEN a Match starts for a real Player, THE Race_Server SHALL invoke the Daily_Game_Counter usage-increment seam for that Player.
2. WHERE the Daily_Game_Counter enforcement is not yet available, THE Race_Server SHALL treat every Match start as permitted so that the mode remains unlimited during beta.
3. WHERE the Daily_Game_Counter enforcement is available AND a real Player has reached the daily limit, THE Race_Server SHALL prevent that Player from starting a new Match.
4. THE Race_Server SHALL isolate the Daily_Game_Counter interaction behind a single seam so that enabling enforcement requires no change to Match or Round logic.

## Open Questions

These items are called out in the roadmap as undecided. They are captured here so they can be resolved during design or via follow-up before implementation. Reasonable defaults are proposed for each so the design can proceed if a decision is not made immediately.

1. **Elimination percentages and rounding rule.** Exact Elimination_Percentage per Round and how fractional eliminations round (e.g. floor, ceil, or nearest). Proposed default: configured per Round with ceil rounding, guaranteeing at least one elimination when the field is larger than one.
2. **Lobby size bounds.** Minimum and maximum Lobby size. Proposed default: minimum small enough to fill quickly with Bots, maximum aligned with Battle Royale's practical ceiling; final values set in Race_Config.
3. **Tie-breaking.** Whether the qualification-time and completed-word tie-breaks in Requirements 5 and 6 are the final tie-break policy, and how exact simultaneous ties are resolved. Proposed default: total guesses as the final tie-break, with a stable ordering fallback.
4. **Penalty tuning.** Concrete Penalty_Threshold and Debounce_Amount values, and whether the penalty escalates with sustained fast input or is a flat delay. Proposed default: flat Debounce_Amount above a single Penalty_Threshold.
5. **Premium interaction beyond the daily cap.** Whether premium status affects Race_Mode beyond the daily game limit (e.g. cosmetics parallel to the Battle Royale champion crown). Proposed default: no additional premium interaction in this feature; revisit alongside Feature 1.
6. **Word source and length coverage.** Whether Race_Mode reuses the Battle Royale five-letter word list and needs additional four- and six-letter word lists to satisfy the configured word lengths. Proposed default: add per-length word lists sized to the configured Round word lengths.
