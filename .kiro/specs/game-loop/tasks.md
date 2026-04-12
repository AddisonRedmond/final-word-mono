# Implementation Plan: Game Loop

## Overview

Implement the core Wordle-style battle royale game loop: word assignment, guess submission, feedback computation, health timers, attack mechanics, and all client UI components. Tasks build incrementally from shared types → server pure functions → server stateful logic → client state → client UI.

## Tasks

- [x] 1. Extend shared types package with new WS message types and updated game types
  - [x] 1.1 Add new ServerMessage variants to `packages/types/src/ws.ts`
    - Add `submit_guess` with fields `lobbyId: string`, `guess: string`
    - Add `set_target` with fields `lobbyId: string`, `targetUserId: string`
    - Extend `ServerMessageSchema` with matching Zod schemas
    - _Requirements: 8.1, 8.5, 8.9_
  - [x] 1.2 Add new ClientMessage variants to `packages/types/src/ws.ts`
    - Add `guess_result` with fields `lobbyId`, `guess`, `feedback: Array<"correct"|"present"|"absent">`
    - Add `game_state_update` with fields `lobbyId` and `players` array (userId, guessCount, won, eliminated, healthMs)
    - Add `game_over` with fields `lobbyId`, `winner`, and `players` array (userId, secretWord, guesses, won)
    - Add `attack_word` with fields `lobbyId`, `fromUserId`, `word`, `revealedPositions: number[]`
    - Add `player_health_update` with fields `lobbyId` and `players` array (userId, healthMs)
    - Extend `ClientMessageSchema` with matching Zod schemas
    - _Requirements: 8.2, 8.3, 8.4, 8.6, 8.7, 8.9_
  - [x] 1.3 Update `packages/types/src/game.ts` Player and Game interfaces
    - Add `healthMs: number`, `activeWord: string`, `activeWordGuesses: string[]`, `targetMode: "random"|"first"|"last"|"specific"`, `targetUserId: string`, `attackQueue: Array<{ word: string; revealedPositions: number[] }>` to the per-player record
    - _Requirements: 12.1, 13.2, 14.1_
  - [x] 1.4 Write property test for WS message round-trips
    - **Property: Serialize → deserialize produces equivalent object for all new message types**
    - **Validates: Requirements 8.8**
    - Add to `packages/types/src/__tests__/ws.property.test.ts`

- [x] 2. Implement GameEngine pure functions on the server
  - [x] 2.1 Create `apps/server/src/ws/gameEngine.ts` with `computeFeedback`
    - Implement correct/present/absent logic with proper duplicate-letter accounting
    - Export `computeFeedback(guess: string, secret: string): Array<"correct"|"present"|"absent">`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6_
  - [x] 2.2 Write property tests for `computeFeedback`
    - **Property 1: Output length is always 5 for any 5-letter input pair**
    - **Property 2: All-correct when guess === secret**
    - **Property 3: Correct-position letters are always marked `correct`**
    - **Validates: Requirements 3.2, 3.3, 3.6**
    - Add to `apps/server/src/__tests__/gameEngine.property.test.ts`
  - [x] 2.3 Add `assignWords` and `computeRevealedPositions` to `gameEngine.ts`
    - `assignWords(playerIds: string[], wordList: string[]): Record<string, string>` — random assignment per player
    - `computeRevealedPositions(word: string, guessCount: number): number[]` — 3/2/1 revealed based on guess count
    - _Requirements: 1.1, 1.2, 1.4, 13.5, 13.6_
  - [x] 2.4 Add `dispatchAttack` pure function to `gameEngine.ts`
    - `dispatchAttack(attackerGuessCount: number, word: string, queue: AttackQueue): { revealedPositions: number[]; updatedQueue: AttackQueue }` 
    - Handles queue capacity (max 4), overflow penalty (decrement revealed by 1, min 0), and appending
    - _Requirements: 14.1, 14.2, 14.3_
  - [x] 2.5 Write property tests for `dispatchAttack`
    - **Property 4: Queue length never exceeds 4 after any dispatch**
    - **Property 5: Overflow penalty reduces revealedPositions count by 1 (min 0)**
    - **Validates: Requirements 14.1, 14.2, 14.3**
  - [x] 2.6 Add health mutation helpers to `gameEngine.ts`
    - `applyHealthTick(healthMs: number, deltaMs: number): number` — clamps to [0, 180_000]
    - `applyWordSolvedBonus(healthMs: number): number` — +30_000, capped at 180_000
    - `applyFailurePenalty(healthMs: number): number` — -15_000, floored at 0
    - _Requirements: 4.2, 4.3, 12.4, 12.5, 12.7_
  - [x] 2.7 Write property tests for health helpers
    - **Property 6: Health always stays within [0, 180_000] after any operation**
    - **Validates: Requirements 12.7**

- [x] 3. Checkpoint — ensure all GameEngine tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Extend LobbyRegistry with game-loop state management
  - [x] 4.1 Update `fillBotsAndStart` in `lobbyRegistry.ts` to assign words and initialize health
    - Call `assignWords` for all players (human + bot)
    - Set `healthMs = 120_000`, `activeWord`, `activeWordGuesses = []`, `attackQueue = []`, `targetMode = "random"` for each player
    - _Requirements: 1.1, 1.3, 12.1_
  - [x] 4.2 Add health tick loop to `LobbyRegistry`
    - Start a `setInterval` at 500 ms when game starts; decrement each non-eliminated player's `healthMs` by 500
    - Eliminate players whose `healthMs` reaches 0 (set `endTimeStamp`, mark eliminated)
    - Broadcast `player_health_update` every tick (≤1000 ms interval satisfies req 12.6)
    - Broadcast `game_state_update` when any player is eliminated
    - Check win condition after each elimination
    - _Requirements: 12.2, 12.3, 12.6, 4.4, 6.1_
  - [x] 4.3 Add `processGuess(lobbyId, userId, guess)` method to `LobbyRegistry`
    - Validate game active, player not eliminated, guess length, guess in word list
    - Compute feedback via `computeFeedback`
    - Append guess to `activeWordGuesses`; send `guess_result` to submitting player
    - On solve: apply health bonus, dispatch attack to target, transition active word
    - On 6th failed guess: apply health penalty, transition active word
    - Broadcast `game_state_update` after each valid guess
    - Check and handle game-over condition
    - _Requirements: 2.1–2.6, 3.5, 4.1–4.6, 5.1–5.4, 6.1–6.4, 13.1, 14.4, 14.5, 15.1–15.3_
  - [x] 4.4 Add `receiveAttack(lobbyId, targetUserId, attackEntry)` method to `LobbyRegistry`
    - Use `dispatchAttack` to enqueue; send `attack_word` message to target
    - _Requirements: 13.7, 14.2, 14.3_
  - [x] 4.5 Add `setTarget(lobbyId, userId, targetUserId)` method to `LobbyRegistry`
    - Update player's `targetMode = "specific"` and `targetUserId`
    - _Requirements: 13.3_
  - [x] 4.6 Update bot simulation to use `processGuess` and respect new timing
    - Bot interval 3–8 s; select random word from word list; call `processGuess` internally
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 5. Extend WS router with new message handlers
  - [x] 5.1 Add `submit_guess` case to `apps/server/src/ws/router.ts`
    - Delegate to `registry.processGuess(msg.lobbyId, conn.uid, msg.guess)`
    - Return null (registry sends targeted/broadcast messages directly)
    - _Requirements: 2.1, 2.3, 2.4, 2.5_
  - [x] 5.2 Add `set_target` case to `apps/server/src/ws/router.ts`
    - Delegate to `registry.setTarget(msg.lobbyId, conn.uid, msg.targetUserId)`
    - _Requirements: 13.3_

- [x] 6. Checkpoint — ensure server tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Create client useGameStore Zustand store
  - Create `apps/client/src/state/useGameStore.ts`
  - State: `lobbyId`, `myUserId`, `guesses: string[]`, `feedbacks`, `currentInput: string`, `activeWordIsAttack: boolean`, `revealedPositions: number[]`, `attackQueueSize: number`, `opponents: OpponentState[]`, `targetMode`, `targetUserId`, `gameOver: GameOverPayload | null`, `error: string | null`
  - Actions: `setInput`, `submitGuess` (sends WS message), `setTarget`, `applyGuessResult`, `applyGameStateUpdate`, `applyHealthUpdate`, `applyAttackWord`, `applyGameOver`, `reset`
  - _Requirements: 9.1, 9.4, 9.5, 9.6, 9.11, 9.12, 10.1, 10.5, 11.4_

- [x] 8. Implement GameBoard component
  - Create `apps/client/src/components/game/GameBoard.tsx`
  - Render 6×5 grid; color tiles by feedback (correct=green, present=yellow, absent=gray, empty=white/border)
  - Current input row shows typed letters; pre-filled revealed positions render in distinct style
  - Attack-word mode: different border color + "⚔ Attack Word" label
  - Animate row reveal on `guess_result` (flip tiles sequentially)
  - _Requirements: 9.2, 9.7, 9.9, 9.10_

- [x] 9. Implement GameKeyboard component
  - Create `apps/client/src/components/game/GameKeyboard.tsx`
  - Render QWERTY layout; color each key by best feedback seen (correct > present > absent > unplayed)
  - Handle click → append letter to input; Enter → submit; Delete/Backspace → remove last letter
  - Wire physical keyboard events via `useEffect` on `keydown`
  - _Requirements: 9.3, 9.4, 9.5, 9.6_

- [x] 10. Implement OpponentPanel component
  - Create `apps/client/src/components/game/OpponentPanel.tsx`
  - Show each opponent: userId, guess count, health timer (countdown display), status badge (Playing/Won/Out)
  - Won opponents: crown icon or "Won" label; eliminated: strikethrough or "Out" label
  - In Specific targeting mode: clicking an opponent row sends `set_target` and highlights selection
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_

- [x] 11. Implement TargetSelector and AttackQueueIndicator components
  - Create `apps/client/src/components/game/TargetSelector.tsx`
    - Render four mode buttons: Random, First, Last, Specific
    - On mode change update store `targetMode`; Specific mode enables click-to-target in OpponentPanel
    - _Requirements: 9.12, 13.2_
  - Create `apps/client/src/components/game/AttackQueueIndicator.tsx`
    - Display count of pending attack words (e.g. "⚔ 2 incoming")
    - _Requirements: 9.11_

- [x] 12. Implement GameOverScreen component
  - Create `apps/client/src/components/game/GameOverScreen.tsx`
  - Show win/lose result for local player; display winner userId and each player's secret word
  - "Play Again" button sends `find_or_create_lobby` and calls `reset()` on game store
  - While shown, keyboard input for guesses is disabled (store `gameOver !== null` gates submission)
  - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 13. Wire up BattleRoyale component to handle game_started and gameplay
  - Update `apps/client/src/components/game/battle-royale.tsx`
  - On `game_started` message: populate `useGameStore` with lobbyId + players, transition view from countdown to gameplay
  - On `guess_result`: call `applyGuessResult`; on `game_state_update`: call `applyGameStateUpdate`; on `player_health_update`: call `applyHealthUpdate`; on `attack_word`: call `applyAttackWord`; on `game_over`: call `applyGameOver`
  - Gameplay view renders: `<GameBoard>`, `<GameKeyboard>`, `<OpponentPanel>`, `<TargetSelector>`, `<AttackQueueIndicator>`
  - When `gameOver !== null` render `<GameOverScreen>` instead
  - _Requirements: 9.1, 9.7, 9.8, 10.5, 15.4_

- [x] 14. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness invariants; unit tests validate specific examples
- Checkpoints ensure incremental validation before moving to the next layer
