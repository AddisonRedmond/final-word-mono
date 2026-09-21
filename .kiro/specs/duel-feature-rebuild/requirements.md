# Requirements Document

## Introduction

The Duel Feature is an asynchronous, turn-independent word-guessing mode in the Final Word app. Each duel challenges two or more friends to solve the same secret 5-letter word with up to 6 guesses. Players complete their attempts independently (at different times); a shared real-time dashboard shows each participant's coloured status as they join, play, and finish. The rebuild cleans up existing gaps: missing forfeit wiring, hardcoded `MAX_GUESSES` mismatches (router uses 6, UI shows 5 rows), absent word-validation guard, no post-game result view, and a non-functional `handleForfeit` stub.

---

## Glossary

- **Duel**: A single asynchronous word-guessing challenge shared among 2–5 participants that uses one secret word.
- **Duels_Page**: The `/duels` Next.js page that lists all active and recently completed duels for the current user.
- **Duel_Board**: The modal game board component where a participant enters guesses for an active duel.
- **Duel_Ribbon**: The compact list-item component on the Duels_Page representing one duel.
- **Participant**: A user who has been invited to or has created a duel and has a row in `duel_participants`.
- **Invitation_Roster**: The immutable set of user IDs recorded on a duel when it is created. It includes pending Guests who do not yet have a `duel_participants` row and is the source of truth for duel membership and completion checks.
- **Initiator**: The participant whose `userId` matches `duels.initiatedBy`; always treated as having accepted.
- **Guest**: Any non-Initiator participant.
- **Pending_State**: A duel where a Guest has not yet responded (no `duel_participants` row or `accepted = null`).
- **Active_State**: A duel where the Participant's `accepted = true` and `endTime IS NULL`.
- **Finished_State**: A duel where the Participant has an `endTime` set (success or exhausted guesses).
- **Forfeit_State**: A duel where the Participant's `accepted` is explicitly set to `false` after having previously accepted.
- **Declined_State**: A duel where a Guest sets `accepted = false` before ever playing.
- **Completed_Duel**: A duel where `duels.completed = true`, meaning every invited participant has finished, forfeited, or declined; it also includes a duel cancelled because every Guest declined.
- **Word_Validator**: The server-side utility that checks whether a submitted 5-letter string is a known valid word.
- **Match_Engine**: The `calculateMatchObj` utility that scores a guess against a target word using a two-pass Wordle algorithm.
- **Keyboard_State**: The derived per-letter colour map (`correct`, `present`, `absent`) built from all prior guesses.
- **Realtime_Hook**: The `useDuelRealtime` hook that subscribes to Supabase Postgres change events for `duel_participants`.
- **MAX_GUESSES**: The canonical limit of **6** guesses per participant per duel (must be consistent across all layers).
- **WORD_LENGTH**: Always **5** characters.
- **Solved**: A participant submitted the target word within MAX_GUESSES. More than one participant may solve a duel; this feature does not declare a single duel winner or rank participants.

---

## Requirements

### Requirement 1: Duel List Page

**User Story:** As a logged-in user, I want to see all my duels in a single list so that I know which ones need my attention.

#### Acceptance Criteria

1. THE Duels_Page SHALL fetch and display all duels where the current user is a participant and has not acknowledged a completed duel.
2. WHEN the Duels_Page is loaded, THE Duels_Page SHALL exclude duels where the current user's `accepted = false` from the list.
3. WHEN the Duels_Page is loaded, THE Duels_Page SHALL exclude duels where the current user has `completed_game_acknowledged = true` and the duel is marked `completed = true`.
4. THE Duels_Page SHALL display a legend row of status badges showing the meaning of each colour (started, completed, declined, forfeit, pending).
5. WHEN a duel list is empty, THE Duels_Page SHALL display a "No duels" empty-state message.
6. WHILE a duel fetch is in progress, THE Duels_Page SHALL display a loading indicator in place of the duel list.
7. THE Duels_Page SHALL automatically refetch duel metadata every 30 seconds.
8. THE Duels_Page SHALL subscribe via the Realtime_Hook so that participant status changes appear without a manual refresh.
9. THE Duels_Page SHALL NOT receive or render a duel's secret word while the current user's game is active.

---

### Requirement 2: Duel Ribbon (List Item)

**User Story:** As a user, I want each duel in the list to show me its opponents' status and the right action buttons so I can act without opening the duel.

#### Acceptance Criteria

1. THE Duel_Ribbon SHALL display a coloured avatar badge for every non-current-user member of the Invitation_Roster using the colour that reflects their individual state (pending, started, done, forfeit, declined).
2. THE Duel_Ribbon SHALL display the duel's creation date.
3. WHEN the current user has not yet responded and is not the Initiator, THE Duel_Ribbon SHALL show both a "Decline" button and a "Start" button.
4. WHEN the current user has accepted (`accepted = true`) and has not finished (`endTime IS NULL`), THE Duel_Ribbon SHALL show a "Forfeit" button and a "Resume" button.
5. WHEN the current user has finished the duel (`endTime IS NOT NULL`), THE Duel_Ribbon SHALL hide action buttons and display a "Finished" label instead.
6. WHEN the duel is marked `completed = true`, THE Duel_Ribbon SHALL hide action buttons and display a "Completed" label.
7. WHEN the Initiator views an Active_State duel they have not yet started, THE Duel_Ribbon SHALL show only a "Start" button.
8. WHEN the current user's `accepted = false`, THE Duels_Page SHALL remove that duel from the current user's list; its forfeit or decline badge SHALL remain visible to other roster members.
9. WHEN the current user has finished and the duel is marked `completed = true`, THE Duel_Ribbon SHALL provide a "View result" action in addition to the "Completed" label so the user can acknowledge the completed duel.

---

### Requirement 3: Creating a New Duel

**User Story:** As a user, I want to challenge one or more friends to a duel so that we can compete on the same word.

#### Acceptance Criteria

1. THE Duels_Page SHALL provide a "New Duel" button that opens a duel-creation modal.
2. THE Duels_Page SHALL only display accepted friends as candidates in the creation modal.
3. WHEN a user submits a new duel, THE Duels_Router SHALL validate that all invitees are accepted friends of the current user.
4. WHEN a user submits a new duel, THE Duels_Router SHALL reject the request if the current user already has 5 or more active (non-completed) duels.
5. WHEN a user submits a new duel with 1–4 invitees, THE Duels_Router SHALL create a `duels` row with a random secret word and participant list, and create a `duel_participants` row for the Initiator with `accepted = true` and `startTime` set.
6. WHEN a user submits a new duel with 0 invitees, THE Duels_Router SHALL return a `BAD_REQUEST` error.
7. WHEN a new duel is successfully created, THE Duels_Page SHALL close the creation modal and refetch the duel list.
8. THE Duels_Router SHALL reject duplicate invitees, the current user as an invitee, and invitees outside the 1–4 invitee limit with a `BAD_REQUEST` error.
9. THE Duels_Router SHALL create the duel, its Invitation_Roster, and the Initiator's participant row atomically.

---

### Requirement 4: Accepting and Declining a Duel

**User Story:** As an invited user, I want to accept or decline a duel invitation so that I can manage my active duels.

#### Acceptance Criteria

1. WHEN a Guest clicks "Start" on a Pending_State duel, THE Duels_Router SHALL upsert a `duel_participants` row with `accepted = true` and `startTime = now()`.
2. WHEN a Guest clicks "Decline" on a Pending_State duel, THE Duels_Router SHALL insert a `duel_participants` row with `accepted = false`.
3. WHEN all Guests in the Invitation_Roster have declined, THE Duels_Router SHALL mark the duel `completed = true` as cancelled, even though the Initiator has not finished.
4. WHEN a Guest declines a duel, THE Duels_Page SHALL immediately remove the duel from the visible list for that user.

---

### Requirement 5: Forfeiting an Active Duel

**User Story:** As a participant, I want to forfeit a duel I've already started so that opponents know I will not complete it.

#### Acceptance Criteria

1. WHEN a Participant who has accepted and not finished clicks "Forfeit", THE Duels_Router SHALL set `accepted = false` and `endTime = now()` on that participant's row.
2. WHEN a Participant forfeits, THE Duels_Router SHALL evaluate whether all participants have now finished or forfeited and, if so, mark the duel `completed = true`.
3. WHEN a Participant forfeits, THE Duel_Board modal SHALL close and the Duels_Page SHALL refetch the duel list.
4. WHEN a Participant forfeits, THE Duel_Ribbon SHALL update the forfeiting participant's avatar badge to the forfeit colour.
5. THE Duels_Router SHALL reject a forfeit unless the caller owns the participant row and that row has `accepted = true` and `endTime IS NULL`.

---

### Requirement 6: Playing a Duel (Game Board)

**User Story:** As a participant, I want to play my turn on the duel board so that I can guess the secret word.

#### Acceptance Criteria

1. WHEN a Participant opens the Duel_Board, THE Duel_Board SHALL display all previously submitted guesses with correct tile colouring.
2. WHEN a Participant opens the Duel_Board, THE Duel_Board SHALL display a stopwatch timer counting up from the participant's `startTime`.
3. THE Duel_Board SHALL enforce a WORD_LENGTH of 5 characters; THE Duel_Board SHALL ignore additional key input once 5 letters are entered.
4. WHEN a Participant presses Enter with fewer than 5 characters, THE Duel_Board SHALL not submit the guess.
5. WHEN a Participant submits a 5-character guess, THE Duels_Router SHALL validate that the guess is a known word in the word list before recording it; IF the guess is not a known word, THEN THE Duels_Router SHALL return a `BAD_REQUEST` error without consuming a guess.
6. WHEN a valid guess is submitted, THE Duels_Router SHALL record the guess and return updated `matchResults` and `keyboardState` so the Duel_Board can update without a second request.
7. THE Duel_Board SHALL display exactly MAX_GUESSES (6) guess rows at all times, filling unfilled rows with empty tiles.
8. THE Duel_Board SHALL render a Keyboard component that colours keys using the cumulative Keyboard_State.
9. WHEN a Participant submits a correct guess, THE Duels_Router SHALL set `success = true` and `endTime = now()` on the participant's row.
10. WHEN a Participant exhausts all MAX_GUESSES without a correct guess, THE Duels_Router SHALL set `success = false` and `endTime = now()` on the participant's row.
11. WHEN a Participant's game ends (success or exhausted guesses), THE Duel_Board SHALL transition to a result view rather than closing immediately.
12. THE Duels_Router SHALL reject a guess unless the caller belongs to the Invitation_Roster and owns an accepted, unfinished participant row for the duel.
13. THE Duels_Router SHALL atomically enforce MAX_GUESSES when recording a guess so concurrent submissions cannot record more than six guesses or overwrite an end state.
14. THE Duels_Router SHALL return the secret word only to a caller whose own game has ended, or when returning a completed-duel result view to a roster member.

---

### Requirement 7: Post-Game Result View

**User Story:** As a participant who has just finished a duel, I want to see my result and how I compared to my opponents so that the game feels complete.

#### Acceptance Criteria

1. WHEN a Participant's game ends, THE Duel_Board SHALL display a result summary showing whether the participant solved the word or did not solve it, the secret word, the number of guesses used, and elapsed time.
2. WHEN a Participant's game ends, THE Duel_Board SHALL show each opponent's current completion status using the same colour coding as the Duel_Ribbon.
3. THE Duel_Board SHALL provide a "Close" button that dismisses the result view and returns to the Duels_Page.
4. WHEN a Participant closes the result view after the duel is `completed = true`, THE Duels_Router SHALL set `completed_game_acknowledged = true` on that participant's row.
5. WHEN `completed_game_acknowledged` is set, THE Duels_Page SHALL remove the duel from the list on next load.

---

### Requirement 8: Match Engine Correctness

**User Story:** As a developer, I want the word-matching logic to handle repeated letters correctly so that players receive accurate feedback.

#### Acceptance Criteria

1. THE Match_Engine SHALL implement a two-pass algorithm: pass 1 locks exact-position (green) matches and decrements the letter's remaining count; pass 2 marks yellow for unaccounted occurrences and grey otherwise.
2. WHEN the guess contains a repeated letter that appears once in the target word and one occurrence is green, THE Match_Engine SHALL mark the other occurrence grey, not yellow.
3. WHEN the guess contains a repeated letter that appears twice in the target word and one occurrence is green, THE Match_Engine SHALL mark the other occurrence yellow.
4. FOR ALL valid 5-letter target words W and valid 5-letter guess strings G, THE Match_Engine SHALL produce a MatchResult where the count of green + yellow occurrences of any letter L does not exceed the count of L in W (round-trip invariant).
5. THE Match_Engine SHALL accept only uppercase strings; THE Match_Engine SHALL not normalise case internally.

---

### Requirement 9: Word Validation (Parser)

**User Story:** As a developer, I want all guess submissions validated against the canonical word list so that players cannot submit arbitrary strings.

#### Acceptance Criteria

1. THE Word_Validator SHALL accept a single 5-character uppercase string and return a boolean indicating whether it is present in the word list.
2. WHEN a guess passes through the Duels_Router, THE Duels_Router SHALL invoke the Word_Validator before recording the guess.
3. IF the Word_Validator returns false, THEN THE Duels_Router SHALL return a `BAD_REQUEST` error with a descriptive message and SHALL NOT update the participant's guess list.
4. THE Word_Validator SHALL perform a case-insensitive lookup internally even when the input is already normalised.
5. FOR ALL strings S of length 5, the result of `Word_Validator(S.toUpperCase())` SHALL equal `Word_Validator(S.toLowerCase())` (case-normalisation round-trip property).
6. THE Duels_Router SHALL normalise a submitted guess to uppercase before invoking the Word_Validator and Match_Engine.

---

### Requirement 10: Real-time Opponent Status

**User Story:** As a participant viewing the duel list, I want opponent status badges to update in real time without refreshing the page so that I can see when friends finish.

#### Acceptance Criteria

1. THE Realtime_Hook SHALL subscribe to all Postgres `INSERT`, `UPDATE`, and `DELETE` events on the `duel_participants` table scoped to the current user's visible duel IDs.
2. WHEN a participant row is inserted, THE Realtime_Hook SHALL add the new participant to the local state for the corresponding duel.
3. WHEN a participant row is updated, THE Realtime_Hook SHALL replace the corresponding entry in local state with the updated values.
4. WHEN a participant row is deleted, THE Realtime_Hook SHALL remove the entry from local state.
5. WHEN the list of duel IDs changes, THE Realtime_Hook SHALL unsubscribe from the previous channel and create a new subscription.
6. WHEN the component using the Realtime_Hook unmounts, THE Realtime_Hook SHALL unsubscribe from the Supabase channel to prevent memory leaks.
7. THE Duels_Page SHALL refetch duel metadata when a relevant participant event is received so changes to `duels.completed` and the Invitation_Roster are reflected promptly.

---

### Requirement 11: Duel Completion and Acknowledgement

**User Story:** As a participant, I want completed duels to disappear from my list once I've seen the result so that old duels do not clutter my view.

#### Acceptance Criteria

1. Except for the all-Guests-declined cancellation path, THE Duels_Router SHALL set `duels.completed = true` when every user in the Invitation_Roster has either finished (has an `endTime`) or declined (`accepted = false`). A missing participant row is pending and SHALL prevent completion.
2. THE Duels_Router SHALL expose an `acknowledgeDuel` procedure that sets `completed_game_acknowledged = true` on the current user's `duel_participants` row.
3. WHEN `acknowledgeDuel` is called, THE Duels_Router SHALL verify the duel is `completed = true` before setting the acknowledgement; IF the duel is not completed, THEN THE Duels_Router SHALL return a `BAD_REQUEST` error.
4. THE Duels_Page SHALL call `acknowledgeDuel` when the user closes a result view for a completed duel.
5. THE Duels_Page SHALL refetch after `acknowledgeDuel` resolves so the acknowledged duel is removed from the list.
6. WHEN a finished participant opens a completed duel through "View result", THE Duel_Board SHALL display the result view and SHALL allow acknowledgement on close.
