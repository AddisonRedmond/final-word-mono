# Requirements Document

## Introduction

This feature implements the core game loop for Final Word — a Wordle-style battle royale. Once the lobby countdown ends and `game_started` is broadcast, each player receives a secret 5-letter word and must guess it in up to 6 attempts. Per-letter feedback (correct/present/absent) is computed on the server and broadcast to all players after each guess. The game ends for a player when they guess correctly or exhaust all attempts. The last player standing (or the first to guess correctly, depending on mode) is declared the winner. The client renders a Wordle-style grid, a color-coded keyboard, and a live opponent-progress panel.

## Glossary

- **Game_Server**: The Hono WebSocket server responsible for game state management
- **Game_Client**: The Next.js browser client participating in a game
- **Game**: An active match associated with a lobby, containing all player state
- **Player**: A human or bot participant in a Game identified by a unique `userId`
- **Secret_Word**: The 5-letter target word assigned to a Player at game start; unknown to that Player
- **Guess**: A 5-letter word submitted by a Player as an attempt to match their Secret_Word
- **Feedback**: An array of 5 per-letter results, each being `correct`, `present`, or `absent`
- **Tile**: A single letter cell in the guess grid, colored according to its Feedback value
- **Keyboard**: The on-screen keyboard whose key colors reflect the best Feedback seen for each letter
- **Word_List**: The canonical set of valid 5-letter words in `packages/words/five_letter_words.ts`
- **Guess_Result**: A server→client message carrying the Feedback for a submitted Guess
- **Game_State_Update**: A server→client message broadcasting anonymized progress of all Players
- **Game_Over**: A server→client message sent when the Game ends, carrying the winner and final standings
- **Submit_Guess**: A client→server message carrying a Player's Guess
- **LobbyRegistry**: The in-memory registry on the server that manages lobbies and games
- **Health**: A per-Player countdown timer (in milliseconds) representing remaining time before elimination
- **Attack_Word**: A Secret_Word solved by an attacker and sent to a target Player's queue as an additional word to solve
- **Attack_Queue**: An ordered list of Attack_Words pending for a Player, with a maximum capacity of 4
- **Revealed_Letters**: Letters in an Attack_Word that are pre-filled at their correct positions, reducing the target's solving difficulty
- **Active_Word**: The word a Player is currently solving — either their Secret_Word or the front of their Attack_Queue
- **Target**: The opponent a Player has selected to receive their next Attack_Word upon solving their Active_Word
- **Set_Target**: A client→server message specifying the Player's chosen Target
- **Attack_Word_Message**: A server→client message delivering an Attack_Word to the targeted Player
- **Player_Health_Update**: A server→client broadcast carrying current Health values for all Players

## Requirements

### Requirement 1: Word Assignment at Game Start

**User Story:** As a player, I want to be assigned a secret word when the game starts, so that I have a target to guess.

#### Acceptance Criteria

1. WHEN `game_started` is broadcast, THE Game_Server SHALL assign each Player (human and bot) a randomly selected Secret_Word from the Word_List
2. THE Game_Server SHALL assign Secret_Words independently per Player, so different Players may receive different words
3. THE Game_Server SHALL store each Player's Secret_Word server-side only and SHALL NOT include it in any message sent to other Players
4. IF the Word_List contains fewer than the number of Players in the Game, THEN THE Game_Server SHALL allow duplicate Secret_Word assignments across Players

---

### Requirement 2: Guess Submission

**User Story:** As a player, I want to submit a 5-letter word as my guess, so that I can receive feedback and progress toward solving my secret word.

#### Acceptance Criteria

1. WHEN a Player submits a `submit_guess` message, THE Game_Server SHALL validate that the Guess is exactly 5 characters long
2. WHEN a Player submits a `submit_guess` message, THE Game_Server SHALL validate that the Guess exists in the Word_List (case-insensitive)
3. IF the Guess fails length validation, THEN THE Game_Server SHALL respond with an `error` message with reason `"invalid_guess_length"`
4. IF the Guess fails word-list validation, THEN THE Game_Server SHALL respond with an `error` message with reason `"invalid_guess_word"`
5. IF a Player submits a Guess after their game has already ended (won or exhausted attempts), THEN THE Game_Server SHALL respond with an `error` message with reason `"game_already_ended"`
6. WHEN a valid Guess is accepted, THE Game_Server SHALL append the Guess to that Player's `guesses` array in the Game state

---

### Requirement 3: Feedback Computation

**User Story:** As a player, I want to receive per-letter feedback on my guess, so that I can narrow down the secret word.

#### Acceptance Criteria

1. WHEN a valid Guess is accepted, THE Game_Server SHALL compute Feedback by comparing each letter of the Guess against the Player's Secret_Word
2. THE Game_Server SHALL mark a letter as `correct` when the letter matches the Secret_Word at the same position
3. THE Game_Server SHALL mark a letter as `present` when the letter appears in the Secret_Word but at a different position, and has not already been accounted for by a `correct` or earlier `present` match
4. THE Game_Server SHALL mark a letter as `absent` when the letter does not appear in the Secret_Word, or all occurrences have already been accounted for
5. WHEN Feedback is computed, THE Game_Server SHALL send a `guess_result` message to the submitting Player containing the Guess and its Feedback array
6. FOR ALL valid (Guess, Secret_Word) pairs, the Feedback array SHALL have exactly 5 elements

---

### Requirement 4: Win and Elimination Detection

**User Story:** As a player, I want the game to detect when I've won or run out of guesses, so that the game can progress to a conclusion.

#### Acceptance Criteria

1. WHEN all 5 letters of a Guess are marked `correct`, THE Game_Server SHALL record that Player as having solved their Active_Word
2. WHEN a Player's `guesses` array for their Active_Word reaches 6 entries without a fully-correct Guess, THE Game_Server SHALL deduct 15 000 milliseconds from that Player's Health
3. WHEN a Player solves their Active_Word, THE Game_Server SHALL add 30 000 milliseconds to that Player's Health, up to a maximum of 180 000 milliseconds (3 minutes)
4. WHEN a Player's Health reaches 0 milliseconds, THE Game_Server SHALL record that Player as eliminated and set their `endTimeStamp`
5. WHILE a Player has neither won nor been eliminated, THE Game_Server SHALL continue accepting Guess submissions from that Player
6. WHEN a Player is eliminated, THE Game_Server SHALL broadcast a `game_state_update` message to all Players in the lobby reflecting the updated standings

---

### Requirement 5: Game Over

**User Story:** As a player, I want to know when the game has ended and who won, so that I can see the final result.

#### Acceptance Criteria

1. WHEN all Players have either won or been eliminated, THE Game_Server SHALL set `game.winner` to the `userId` of the Player who guessed correctly in the fewest attempts; in the event of a tie in attempts, the Player with the earlier `endTimeStamp` wins
2. IF no Player guessed correctly, THEN THE Game_Server SHALL set `game.winner` to an empty string indicating no winner
3. WHEN `game.winner` is determined, THE Game_Server SHALL broadcast a `game_over` message to all Players containing the winner `userId`, each Player's Secret_Word, and final standings
4. WHEN `game_over` is broadcast, THE Game_Server SHALL mark `game.started` as `false` to prevent further Guess submissions

---

### Requirement 6: Game State Broadcast

**User Story:** As a player, I want to see other players' progress in real time, so that I know how the match is going.

#### Acceptance Criteria

1. WHEN any Player submits a valid Guess, THE Game_Server SHALL broadcast a `game_state_update` message to all Players in the lobby
2. THE `game_state_update` message SHALL include, for each Player: their `userId`, number of guesses made, whether they have won, whether they have been eliminated, and their current `healthMs` (remaining Health in milliseconds)
3. THE `game_state_update` message SHALL NOT include any Player's Secret_Word or the content of their Guesses (to prevent cheating)
4. WHEN a bot Player's turn is simulated, THE Game_Server SHALL also broadcast a `game_state_update` after each bot Guess

---

### Requirement 7: Bot Gameplay

**User Story:** As a player, I want bots to play automatically, so that games can proceed even with fewer than the maximum number of human players.

#### Acceptance Criteria

1. WHEN the Game starts and a bot Player is present, THE Game_Server SHALL simulate bot Guesses automatically without requiring client input
2. THE Game_Server SHALL submit bot Guesses at a randomized interval between 3 and 8 seconds per Guess, to simulate human-like pacing
3. THE Game_Server SHALL select bot Guesses from the Word_List; bot strategy MAY be random word selection
4. WHEN a bot wins or is eliminated, THE Game_Server SHALL apply the same win/elimination logic as for human Players

---

### Requirement 8: WebSocket Message Protocol Extensions

**User Story:** As a developer, I want the new game-loop messages added to the shared type package, so that both client and server remain type-safe.

#### Acceptance Criteria

1. THE `packages/types` package SHALL export a `submit_guess` ServerMessage type with fields `lobbyId: string` and `guess: string`
2. THE `packages/types` package SHALL export a `guess_result` ClientMessage type with fields `lobbyId: string`, `guess: string`, and `feedback: Array<"correct" | "present" | "absent">`
3. THE `packages/types` package SHALL export a `game_state_update` ClientMessage type with fields `lobbyId: string` and `players: Array<{ userId: string; guessCount: number; won: boolean; eliminated: boolean; healthMs: number }>`
4. THE `packages/types` package SHALL export a `game_over` ClientMessage type with fields `lobbyId: string`, `winner: string`, and `players: Array<{ userId: string; secretWord: string; guesses: string[]; won: boolean }>`
5. THE `packages/types` package SHALL export a `set_target` ServerMessage type with fields `lobbyId: string` and `targetUserId: string`
6. THE `packages/types` package SHALL export an `attack_word` ClientMessage type with fields `lobbyId: string`, `fromUserId: string`, `word: string`, and `revealedPositions: number[]`
7. THE `packages/types` package SHALL export a `player_health_update` ClientMessage type with fields `lobbyId: string` and `players: Array<{ userId: string; healthMs: number }>`
8. FOR ALL new message types, serializing then deserializing SHALL produce an equivalent object (round-trip property)
9. THE Zod schemas for all new message types SHALL be added to `ServerMessageSchema` and `ClientMessageSchema` respectively

---

### Requirement 9: Client Gameplay UI

**User Story:** As a player, I want a Wordle-style game interface in the browser, so that I can play the game visually.

#### Acceptance Criteria

1. WHEN `game_started` is received, THE Game_Client SHALL transition from the lobby countdown view to the gameplay view
2. THE Game_Client SHALL render a 6×5 grid of Tiles showing the Player's submitted Guesses and their Feedback colors
3. THE Game_Client SHALL render an on-screen Keyboard where each key is colored with the best Feedback seen for that letter (`correct` > `present` > `absent` > unplayed)
4. WHEN the Player types a letter (physical or on-screen keyboard), THE Game_Client SHALL display it in the current active row
5. WHEN the Player presses Enter or the on-screen Enter key, THE Game_Client SHALL send a `submit_guess` message to the server
6. WHEN the Player presses Backspace or the on-screen delete key, THE Game_Client SHALL remove the last typed letter from the current row
7. WHEN a `guess_result` message is received, THE Game_Client SHALL animate the Tile row to reveal the Feedback colors
8. IF a `guess_result` contains an error (invalid word or length), THE Game_Client SHALL display an inline error message for 2 seconds without advancing the row
9. WHEN the Active_Word is an Attack_Word, THE Game_Client SHALL visually distinguish the grid with a different border color or label indicating it is an attack word
10. WHEN an Attack_Word contains Revealed_Letters, THE Game_Client SHALL render those Tiles in a distinct pre-filled style (e.g. already-flipped tiles) at their correct positions
11. THE Game_Client SHALL display a queue indicator showing the number of Attack_Words currently pending in the Player's Attack_Queue
12. THE Game_Client SHALL display a targeting mode selector with options: Random, First (most Health), Last (least Health), and Specific (click to select opponent)

---

### Requirement 10: Opponent Progress Panel

**User Story:** As a player, I want to see other players' progress without seeing their guesses, so that I can gauge competition without spoilers.

#### Acceptance Criteria

1. WHEN a `game_state_update` is received, THE Game_Client SHALL render a panel showing each opponent's guess count, status (playing / won / eliminated), and Health timer
2. THE Game_Client SHALL NOT display the content of opponents' Guesses or their Secret_Words during an active Game
3. WHEN an opponent wins, THE Game_Client SHALL visually distinguish that opponent's panel (e.g. a crown or "Won" label)
4. WHEN an opponent is eliminated, THE Game_Client SHALL visually distinguish that opponent's panel (e.g. a strikethrough or "Out" label)
5. WHEN a `player_health_update` is received, THE Game_Client SHALL update each opponent's displayed Health timer in real time
6. WHEN the Player's targeting mode is Specific, THE Game_Client SHALL allow the Player to click an opponent's panel entry to send a `set_target` message designating that opponent as the Target

---

### Requirement 11: Win / Lose Screen

**User Story:** As a player, I want to see a win or lose screen when the game ends, so that I know the outcome and can return to the lobby.

#### Acceptance Criteria

1. WHEN a `game_over` message is received, THE Game_Client SHALL display a result screen showing whether the local Player won or lost
2. THE Game_Client SHALL display the winner's `userId` and each Player's Secret_Word on the result screen
3. THE Game_Client SHALL provide a button that, when clicked, sends a `find_or_create_lobby` message and returns the Player to the matchmaking flow
4. WHEN the result screen is shown, THE Game_Client SHALL stop accepting keyboard input for Guess submission

---

### Requirement 12: Per-Player Health Timer

**User Story:** As a player, I want a countdown health timer that I can extend by solving words and lose time on failures, so that the game creates continuous pressure and rewards fast solving.

#### Acceptance Criteria

1. WHEN `game_started` is broadcast, THE Game_Server SHALL initialize each Player's Health to 120 000 milliseconds (2 minutes)
2. WHILE a Game is active, THE Game_Server SHALL decrement each non-eliminated Player's Health continuously in real time and SHALL NOT pause the timer for any reason, including while the Player is solving an Attack_Word
3. WHEN a Player's Health reaches 0 milliseconds, THE Game_Server SHALL eliminate that Player and set their `endTimeStamp`
4. WHEN a Player fails to solve their Active_Word within 6 guesses, THE Game_Server SHALL deduct 15 000 milliseconds from that Player's Health immediately after the sixth failed Guess
5. WHEN a Player solves their Active_Word, THE Game_Server SHALL add 30 000 milliseconds to that Player's Health, capped at a maximum of 180 000 milliseconds (3 minutes)
6. THE Game_Server SHALL broadcast a `player_health_update` message to all Players in the lobby at an interval of no greater than 1 000 milliseconds, containing each non-eliminated Player's current `healthMs`
7. FOR ALL Players, Health SHALL remain within the range [0, 180 000] milliseconds at all times

---

### Requirement 13: Targeting System

**User Story:** As a player, I want to choose which opponent receives my attack word when I solve a word, so that I can apply strategic pressure.

#### Acceptance Criteria

1. WHEN a Player solves their Active_Word, THE Game_Server SHALL send an Attack_Word to the Player's currently selected Target
2. THE Game_Server SHALL support four targeting modes: Random (a randomly selected active opponent), First (the active opponent with the highest `healthMs`), Last (the active opponent with the lowest `healthMs`), and Specific (an opponent explicitly designated via `set_target`)
3. WHEN a `set_target` message is received, THE Game_Server SHALL update that Player's Target to the specified `targetUserId`
4. IF the designated Target has been eliminated at the time of attack, THEN THE Game_Server SHALL fall back to Random targeting for that attack
5. THE Game_Server SHALL compute the number of Revealed_Letters for the Attack_Word based on the number of guesses the attacker used to solve the word:
   - 1 or 2 guesses → 3 Revealed_Letters
   - 3 or 4 guesses → 2 Revealed_Letters
   - 5 or 6 guesses → 1 Revealed_Letter
6. THE Game_Server SHALL place Revealed_Letters at their correct positions within the Attack_Word (matching the positions in the original Secret_Word)
7. WHEN an Attack_Word is dispatched, THE Game_Server SHALL send an `attack_word` message to the Target containing the word, the attacker's `userId`, and the `revealedPositions` array

---

### Requirement 14: Attack Word Queue

**User Story:** As a player, I want incoming attack words to queue up so I must clear them before receiving a new secret word, creating a backlog mechanic similar to Tetris 99.

#### Acceptance Criteria

1. THE Game_Server SHALL maintain an ordered Attack_Queue per Player with a maximum capacity of 4 Attack_Words
2. WHEN an Attack_Word is received for a Player whose Attack_Queue has fewer than 4 entries, THE Game_Server SHALL append the Attack_Word to the end of that Player's Attack_Queue
3. WHEN an Attack_Word is received for a Player whose Attack_Queue already contains 4 entries, THE Game_Server SHALL decrement the Revealed_Letters count of the incoming Attack_Word by 1 (minimum 0) before appending it, replacing the oldest entry if the queue remains at capacity
4. WHEN a Player finishes their Active_Word (by solving or exhausting 6 guesses), THE Game_Server SHALL set the next Active_Word to the front of the Attack_Queue if the queue is non-empty
5. WHEN a Player finishes their Active_Word and the Attack_Queue is empty, THE Game_Server SHALL assign a new Secret_Word from the Word_List as the next Active_Word
6. THE Game_Server SHALL track which word is the Active_Word for each Player at all times and SHALL NOT allow a Player to skip Attack_Words in their queue

---

### Requirement 15: Word Flow

**User Story:** As a player, I want a clear and enforced word progression so I always know what I'm solving and cannot bypass attack words.

#### Acceptance Criteria

1. THE Game_Server SHALL ensure that each Player's Active_Word is at all times either their current Secret_Word or the front entry of their Attack_Queue
2. THE Game_Server SHALL reject any `submit_guess` message whose `lobbyId` and `userId` do not correspond to the Player's current Active_Word context, responding with an `error` message with reason `"no_active_word"`
3. WHEN a Player completes their Active_Word, THE Game_Server SHALL immediately transition the Active_Word to the next queued Attack_Word or a new Secret_Word without requiring any additional client action
4. THE Game_Client SHALL display the Active_Word grid immediately upon receiving an `attack_word` message or a new Secret_Word assignment, with no intermediate idle state
