# Design Document: Game Loop

## Overview

Final Word is a Wordle-style battle royale where players race to solve secret 5-letter words under a continuous health timer. Solving words extends health and dispatches attack words to opponents; failing to solve deducts health. The last player standing wins.

This document covers the server-side game engine, shared type extensions, client state management, and React component breakdown needed to implement the full game loop on top of the existing lobby/WebSocket infrastructure.

---

## Architecture

The system follows a client-server architecture over WebSocket. The server is the single source of truth for all game state. Clients render state received via messages and send only user intent (guesses, target selection).

```
Browser (Next.js)
  useWebSocket -> useWsStore -> useGameStore
  GameBoard  GameKeyboard  OpponentPanel
  AttackQueueIndicator  TargetSelector  GameOverScreen

        |  WebSocket (JSON messages)

Hono + Node.js Server
  routeMessage -> GameEngine
  LobbyRegistry (in-memory)
    games: Map<lobbyId, Game>
    health tick loop (setInterval 1s)
    bot simulation loops
```

### Key Design Decisions

- **Server authority**: All game logic (feedback, health, attacks, word assignment) runs server-side. The client never computes feedback independently.
- **Absolute deadline timestamps**: Health is stored as `healthDeadlineMs = Date.now() + healthMs`. On each tick the server recomputes `healthMs = healthDeadlineMs - Date.now()`. This avoids drift from `setInterval` imprecision.
- **Active word abstraction**: A player always has exactly one `activeWord`. The server manages transitions between secret words and attack queue entries transparently.
- **Zustand split**: `useWsStore` remains the transport layer. A new `useGameStore` holds game-specific state (grid, feedback, health, attack queue) to keep concerns separated.

---

## Components and Interfaces

### Server: GameEngine

A stateless module of pure functions called by `LobbyRegistry` and `routeMessage`.

```typescript
// apps/server/src/ws/gameEngine.ts

type LetterFeedback = "correct" | "present" | "absent"

function computeFeedback(guess: string, secret: string): LetterFeedback[]
function assignWord(wordList: string[]): string
function processGuess(game: Game, userId: string, guess: string, wordList: string[]): ProcessGuessResult
function dispatchAttack(game: Game, attackerId: string, wordList: string[]): AttackDispatchResult | null
function advanceActiveWord(game: Game, userId: string, wordList: string[]): void
function computeRevealedCount(guessesUsed: number): number  // 1-2->3, 3-4->2, 5-6->1
function selectTarget(game: Game, attackerId: string, mode: TargetMode, specificTargetId?: string): string | null
```

### Server: LobbyRegistry extensions

`LobbyRegistry` gains two new interval loops per active game:

- **Health tick** (`setInterval` 1 000 ms): decrements health, eliminates players at 0, broadcasts `player_health_update`, checks game-over condition.
- **Bot loop** (per-bot `setTimeout` with random 3-8 s delay): picks a word from the word list, calls `processGuess`, reschedules itself if the bot is still active.

### Client: useGameStore

New Zustand store for in-game state:

```typescript
// apps/client/src/state/useGameStore.ts

interface GuessRow {
  letters: string[]
  feedback: LetterFeedback[] | null  // null = not yet submitted
}

interface AttackQueueEntry {
  word: string
  revealedPositions: number[]
  fromUserId: string
}

interface OpponentState {
  userId: string
  guessCount: number
  won: boolean
  eliminated: boolean
  healthMs: number
}

interface GameState {
  lobbyId: string | null
  activeWord: string | null
  isAttackWord: boolean
  revealedPositions: number[]
  rows: GuessRow[]                   // always 6 rows
  currentInput: string               // letters typed so far (max 5)
  keyboardState: Record<string, LetterFeedback | "unplayed">
  attackQueue: AttackQueueEntry[]
  healthMs: number
  opponents: OpponentState[]
  targetMode: TargetMode
  targetUserId: string | null
  gameOver: GameOverPayload | null
}
```

### React Components

| Component | Responsibility |
|---|---|
| `GameBoard` | 6x5 grid; renders GuessRow[]; animates tile flip on feedback |
| `GameKeyboard` | On-screen QWERTY; keys colored by keyboardState; fires input/submit/delete |
| `OpponentPanel` | List of opponent cards; shows guessCount, health bar, won/eliminated badges |
| `TargetSelector` | Dropdown for Random/First/Last/Specific modes; in Specific mode clicking an opponent card sends set_target |
| `AttackQueueIndicator` | Badge showing queue depth (0-4); pulses on new entry |
| `GameOverScreen` | Overlay showing win/loss, each player's secret word, "Play Again" button |
| `BattleRoyale` (updated) | Orchestrator; switches between lobby countdown, gameplay, and game-over views |

---

## Data Models

### Extended `Game` type (`packages/types/src/game.ts`)

```typescript
export type TargetMode = "random" | "first" | "last" | "specific"

export interface AttackQueueEntry {
  word: string
  revealedPositions: number[]  // indices 0-4 that are pre-revealed
  fromUserId: string
}

export interface PlayerState {
  word: string               // current secret word
  guesses: string[]          // guesses for the current active word
  endTimeStamp: number
  backlog: string[]
  backlogGuesses: string[]
  isBot?: boolean
  // new fields
  healthMs: number           // derived: healthDeadlineMs - Date.now()
  healthDeadlineMs: number   // absolute timestamp when health expires
  activeWord: string         // the word currently being solved
  attackQueue: AttackQueueEntry[]
  targetMode: TargetMode
  targetUserId: string | null
  wordsSolved: number
}

export interface Game {
  lobbyId: string
  createdAt: number
  started: boolean
  winner: string
  players: Record<string, PlayerState>
  beginAtCountdown: number
  maxPlayers: number
  minPlayers: number
}
```

### New WebSocket message types (`packages/types/src/ws.ts`)

**Server -> Client (new)**

```typescript
{ type: "guess_result"; lobbyId: string; guess: string; feedback: Array<"correct" | "present" | "absent"> }

{ type: "game_state_update"; lobbyId: string; players: Array<{
    userId: string; guessCount: number; won: boolean; eliminated: boolean; healthMs: number
  }>
}

{ type: "game_over"; lobbyId: string; winner: string; players: Array<{
    userId: string; secretWord: string; guesses: string[]; won: boolean
  }>
}

{ type: "attack_word"; lobbyId: string; fromUserId: string; word: string; revealedPositions: number[] }

{ type: "player_health_update"; lobbyId: string; players: Array<{ userId: string; healthMs: number }> }
```

**Client -> Server (new)**

```typescript
{ type: "submit_guess"; lobbyId: string; guess: string }
{ type: "set_target"; lobbyId: string; targetUserId: string }
```

---

## Key Algorithms

### `computeFeedback(guess, secret)`

Standard Wordle two-pass algorithm:

```
Pass 1 - mark correct positions:
  for i in 0..4:
    if guess[i] == secret[i]:
      feedback[i] = "correct"
      mark secret[i] as consumed

Pass 2 - mark present/absent:
  for i in 0..4:
    if feedback[i] == "correct": continue
    if guess[i] exists in unconsumed letters of secret:
      feedback[i] = "present"
      consume that occurrence
    else:
      feedback[i] = "absent"
```

This correctly handles duplicate letters (e.g. guess "SPEED" against secret "CREEP").

### Health Management

```
On game start:
  player.healthDeadlineMs = Date.now() + 120_000

Health tick (every 1 000 ms):
  for each non-eliminated player:
    player.healthMs = max(0, player.healthDeadlineMs - Date.now())
    if player.healthMs == 0:
      eliminate(player)

On word solved:
  player.healthDeadlineMs = min(
    player.healthDeadlineMs + 30_000,
    Date.now() + 180_000
  )

On 6th failed guess:
  player.healthDeadlineMs -= 15_000
  if healthDeadlineMs < Date.now(): eliminate immediately
```

Using `healthDeadlineMs` as the source of truth means the tick loop never accumulates drift.

### Word Flow State Machine

```
States: SOLVING_SECRET | SOLVING_ATTACK | ELIMINATED | WON

SOLVING_SECRET / SOLVING_ATTACK:
  on correct guess:
    add 30_000ms health (cap 180_000)
    dispatch attack word to target
    advanceActiveWord()
  on 6th wrong guess:
    deduct 15_000ms health
    advanceActiveWord()
  on health = 0:
    -> ELIMINATED

advanceActiveWord():
  if attackQueue.length > 0:
    activeWord = attackQueue.shift().word
    guesses = []
  else:
    activeWord = assignWord(wordList)
    guesses = []
```

### Attack Dispatch

```
computeRevealedCount(guessesUsed):
  1-2 -> 3
  3-4 -> 2
  5-6 -> 1

dispatchAttack(game, attackerId):
  targetId = selectTarget(...)
  if targetId == null: return null

  revealedCount = computeRevealedCount(attacker.guesses.length)
  revealedPositions = [0, 1, ..., revealedCount - 1]
  entry = { word: attacker.activeWord, revealedPositions, fromUserId: attackerId }

  if target.attackQueue.length < 4:
    target.attackQueue.push(entry)
  else:
    // overflow: reduce revealed count by 1, replace oldest
    entry.revealedPositions = entry.revealedPositions.slice(0, max(0, revealedCount - 1))
    target.attackQueue.shift()
    target.attackQueue.push(entry)

  send attack_word to targetId
```

### Target Selection

```
selectTarget(game, attackerId, mode, specificTargetId):
  activePlayers = players where !eliminated && userId != attackerId

  switch mode:
    "random"   -> pick random from activePlayers
    "first"    -> pick player with highest healthMs
    "last"     -> pick player with lowest healthMs
    "specific" -> if specificTargetId in activePlayers: return specificTargetId
                  else: fall back to "random"
```

### Message Flow

**Guess submission:**

```
Client                          Server
  |                               |
  |-- submit_guess -------------->|
  |                               | validate length + word list
  |                               | computeFeedback(guess, activeWord)
  |                               | append to player.guesses
  |<-- guess_result --------------|  (to submitting player only)
  |                               |
  |                               | check win/fail condition
  |                               | update health
  |                               | advanceActiveWord if needed
  |                               | dispatchAttack if solved
  |                               |
  |<-- game_state_update ---------|  (broadcast to all)
  |<-- attack_word ---------------|  (to target player, if attack dispatched)
```

**Health tick (every 1 000 ms):**

```
Server
  for each active player:
    healthMs = healthDeadlineMs - Date.now()
    if healthMs <= 0: eliminate player
  broadcast player_health_update to all
  if all players done: determine winner, broadcast game_over
```

---

## Error Handling

| Condition | Server response |
|---|---|
| Guess length != 5 | `error: "invalid_guess_length"` |
| Guess not in word list | `error: "invalid_guess_word"` |
| Player already won/eliminated | `error: "game_already_ended"` |
| No active word context | `error: "no_active_word"` |
| `set_target` for unknown userId | silently ignored |
| Attack to eliminated target | fall back to random targeting |
| Attack queue overflow | reduce revealedPositions by 1, replace oldest entry |
| Word list smaller than player count | allow duplicate assignments |

All errors are caught in `routeMessage`'s try/catch and returned as `{ type: "error", reason: string }` to the sending connection only.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system - essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Word assignment validity

*For any* game start with N players, every player (human and bot) should have an `activeWord` that is a non-empty string present in the Word_List.

**Validates: Requirements 1.1**

### Property 2: Secret word non-disclosure

*For any* `game_state_update` or `player_health_update` message broadcast during an active game, none of the message fields should contain any player's secret word.

**Validates: Requirements 1.3, 6.3**

### Property 3: Guess length validation

*For any* string of length != 5 submitted as a guess, the server should reject it with `error: "invalid_guess_length"` and the player's guesses array should remain unchanged.

**Validates: Requirements 2.1, 2.3**

### Property 4: Guess word-list validation

*For any* 5-character string not present in the Word_List submitted as a guess, the server should reject it with `error: "invalid_guess_word"` and the player's guesses array should remain unchanged.

**Validates: Requirements 2.2, 2.4**

### Property 5: Valid guess is appended

*For any* valid guess (correct length, in word list, player active), after `processGuess` the player's `guesses` array should contain that guess as its last element.

**Validates: Requirements 2.6**

### Property 6: Feedback array length

*For any* (guess, secret) pair where both are 5-letter strings, `computeFeedback` should return an array of exactly 5 elements, each being `"correct"`, `"present"`, or `"absent"`.

**Validates: Requirements 3.6**

### Property 7: Feedback correctness

*For any* (guess, secret) pair, `computeFeedback` should satisfy: every position where `guess[i] == secret[i]` is marked `"correct"`; the total count of `"present"` + `"correct"` marks for a letter L never exceeds the count of L in the secret word; every remaining position is marked `"absent"`.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 8: Health range invariant

*For any* sequence of health-modifying operations (game start, word solved, word failed, time elapsed), a player's effective health should always remain within [0, 180 000] milliseconds.

**Validates: Requirements 12.7, 4.3**

### Property 9: Health deduction on failure

*For any* player who exhausts 6 guesses without solving, their `healthDeadlineMs` should decrease by exactly 15 000 ms (subject to the floor of elimination at 0).

**Validates: Requirements 4.2, 12.4**

### Property 10: Winner determination

*For any* set of player outcomes (guessCount, endTimeStamp, won), the winner should be the player with the fewest guesses among those who solved; ties broken by earliest `endTimeStamp`; if no player solved, winner is `""`.

**Validates: Requirements 5.1, 5.2**

### Property 11: game_state_update structure

*For any* valid guess submission, the resulting `game_state_update` broadcast should include an entry for every player in the lobby, each containing `userId`, `guessCount`, `won`, `eliminated`, and `healthMs`.

**Validates: Requirements 6.1, 6.2**

### Property 12: Bot guesses are valid words

*For any* bot player's simulated guess, the guess should be a string present in the Word_List.

**Validates: Requirements 7.3**

### Property 13: Message round-trip

*For any* valid instance of a new message type (`submit_guess`, `guess_result`, `game_state_update`, `game_over`, `set_target`, `attack_word`, `player_health_update`), serializing then deserializing via the Zod schemas should produce an object deeply equal to the original.

**Validates: Requirements 8.8**

### Property 14: Keyboard state reflects best feedback

*For any* sequence of guess results for a given letter, the keyboard state for that letter should reflect the highest-priority feedback seen (`correct` > `present` > `absent` > `"unplayed"`), never downgrading a letter's state.

**Validates: Requirements 9.3**

### Property 15: Health initialization

*For any* game start, every player's effective `healthMs` should be initialized to exactly 120 000 ms.

**Validates: Requirements 12.1**

### Property 16: Revealed count mapping

*For any* guess count in [1, 6], `computeRevealedCount` should return 3 for counts 1-2, 2 for counts 3-4, and 1 for counts 5-6.

**Validates: Requirements 13.5**

### Property 17: Revealed positions are valid indices

*For any* attack word dispatch, every index in `revealedPositions` should be in [0, 4] and the letter at that index in the attack word should match the letter at that index in the original solved word.

**Validates: Requirements 13.6**

### Property 18: Attack queue capacity

*For any* sequence of attack word deliveries to a player, the player's `attackQueue.length` should never exceed 4.

**Validates: Requirements 14.1**

### Property 19: Attack queue append (non-full)

*For any* player whose `attackQueue.length < 4`, receiving an attack word should increase the queue length by exactly 1 and the new entry should be at the end.

**Validates: Requirements 14.2**

### Property 20: Attack queue overflow handling

*For any* player whose `attackQueue.length == 4`, receiving an attack word should result in the oldest entry being removed, the new entry appended with `revealedPositions.length` decremented by 1 (minimum 0), and queue length remaining at 4.

**Validates: Requirements 14.3**

### Property 21: Active word progression

*For any* player who completes their active word, their next `activeWord` should be the word from the front of their `attackQueue` if non-empty, otherwise a newly assigned word from the Word_List; and their `guesses` array should be reset to empty.

**Validates: Requirements 14.4, 14.5, 15.1**

---

## Testing Strategy

### Dual Testing Approach

Both unit tests and property-based tests are required. Unit tests cover specific examples, integration points, and edge cases. Property tests verify universal correctness across randomized inputs.

**Property-based testing library**: `fast-check` (compatible with the Vitest setup used across the monorepo).

Each property test should run a minimum of 100 iterations (`numRuns: 100` in fast-check).

### Unit Tests

- `computeFeedback` with known (guess, secret) pairs including duplicate-letter edge cases
- `processGuess` rejecting invalid guesses with correct error reasons
- `processGuess` accepting valid guesses and updating state
- `dispatchAttack` with each targeting mode
- `advanceActiveWord` with non-empty and empty attack queues
- `selectTarget` fallback when specific target is eliminated
- Health tick eliminating a player when `healthDeadlineMs` is in the past
- Game-over detection when all players are done
- `game_over` message contains each player's secret word
- `BattleRoyale` component transitions from countdown to game view on `game_started`
- `GameOverScreen` renders winner and secret words from `game_over` payload

### Property Tests

Each property test must include a comment tag:
`// Feature: game-loop, Property N: <property text>`

| Property | Test description | fast-check arbitraries |
|---|---|---|
| P6: Feedback array length | random 5-char string pairs | `fc.stringOf(fc.char(), {minLength:5, maxLength:5})` |
| P7: Feedback correctness | random (guess, secret) 5-char pairs | same as P6 |
| P8: Health range invariant | random sequences of health ops | `fc.array(fc.oneof(...ops))` |
| P9: Health deduction | random starting health values | `fc.integer({min:0, max:180000})` |
| P10: Winner determination | random arrays of player outcomes | `fc.array(fc.record({...}))` |
| P13: Message round-trip | random valid message instances | `fc.oneof(...messageArbitraries)` |
| P14: Keyboard state | random sequences of feedback per letter | `fc.array(fc.constantFrom("correct","present","absent"))` |
| P16: Revealed count mapping | all integers 1-6 | `fc.integer({min:1, max:6})` |
| P17: Revealed positions validity | random (word, guessCount) pairs | `fc.tuple(fc.stringOf(...), fc.integer({min:1,max:6}))` |
| P18: Queue capacity | random sequences of attack deliveries | `fc.array(fc.record({...}))` |
| P19: Queue append | random queue states with length < 4 | `fc.array(..., {maxLength:3})` |
| P20: Queue overflow | fixed queue of length 4 + new entry | `fc.record({...})` |
| P21: Active word progression | random (queue, wordList) combinations | `fc.tuple(fc.array(...), fc.array(...))` |

### Test File Locations

```
apps/server/src/__tests__/gameEngine.property.test.ts   -- P6, P7, P8, P9, P10, P16, P17, P18, P19, P20, P21
apps/server/src/__tests__/gameEngine.unit.test.ts       -- unit tests for server logic
packages/types/src/__tests__/ws.property.test.ts        -- P13 (extends existing file)
apps/client/src/__tests__/gameStore.property.test.ts    -- P14
apps/client/src/__tests__/gameStore.unit.test.ts        -- client unit tests
```
