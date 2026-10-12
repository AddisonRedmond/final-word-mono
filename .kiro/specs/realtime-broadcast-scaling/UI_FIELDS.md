# UI_Fields audit — what the client actually renders

Source of truth for the broadcast trim (spec Requirement 2) and the delta diff
surface (Requirement 3): the trimmed broadcast and the delta diff must cover
**exactly** these fields — the ones a client component reads to render — and
nothing else. A field not listed under "keep" must not be serialized onto the
wire and must not trigger a delta.

This audit was done by tracing the client components that consume the broadcast
state. Line references are indicative; re-verify against the components if they
move. When in doubt, a field is only "keep" if a client component demonstrably
reads it for rendering.

Method: for each mode, (1) list the broadcast type's fields, (2) mark keep/drop
with the consuming component, (3) note anything server-only that must never ship.

---

## Race

Broadcast type today: `ClientRaceMatch = { room: RaceRoom; players: Record<id, RacePlayer> }`
(`serializeRaceMatch`). Consumers: `useRaceSocket`, `round-board.tsx`,
`race-opponents.tsx`, `result-view.tsx`, `elimination-view.tsx`, `lobby-view.tsx`,
plus `MatchTimer` / `QualifiedSpots` / `ProgressBars` fed by those.

### `RaceRoom` (room-level) — all currently rendered; KEEP

| field | keep? | rendered by |
| --- | --- | --- |
| `matchId` | keep | room identity; socket room join, result keys |
| `shareCode` | keep | `lobby-view` ShareCode (invite friends) |
| `phase` | keep | Race root switches view on `room.phase` |
| `currentRoundIndex` | keep | `round-board` reads round config; opponents progress |
| `roundEndsAt` | keep | `round-board` MatchTimer countdown |
| `nextRoundStartsAt` | keep | `round-transition` intermission countdown |
| `lobbyDeadline` | keep | `lobby-view` "Game Starting" countdown |
| `winnerId` | keep | `result-view` winner resolution |
| `isDraw` | keep | `result-view` draw branch |
| `createdAt` | **drop** | not read by any client component |

### `RacePlayer` (per-player)

| field | keep? | rendered by / reason to drop |
| --- | --- | --- |
| `name` | keep | opponents initials, result/elimination name |
| `isEliminated` | keep | opponents filter active, root elimination gate |
| `isAnonymous` | keep | guest styling/flagging in roster |
| `completedWords` | keep | `round-board` progress bars, opponents progress |
| `qualified` | keep | opponents "Qualified" tick, round-board "Qualified!" |
| `qualifiedAt` | **drop** | server-only ranking key; UI never reads it |
| `roundGuesses` | **drop** | server-only tie-break; UI never reads it |
| `totalGuesses` | keep | elimination card "Guesses" stat |
| `correctGuesses` | keep | elimination card "Correct" stat |
| `correctLetters` | **drop** | server-only elimination-placement key; not rendered |
| `correctPositionsFound` | **drop** | server-only final tie-break; not rendered |
| `placement` | keep | elimination/result "finished Nth" |
| `eliminatedAt` | **drop** | server-only survival ordering; not rendered |
| `revealedWord` | keep | elimination + result "the word was X" |
| `hintRevealed` | keep | `round-board` merges into green letters (final-round helper) |
| `lastFeedback` | keep | `round-board` word-length fallback — `player?.lastFeedback?.length` (round-board.tsx:74) when `roundConfig.wordLength` and the last ack are unavailable. Keyboard colouring is ack-driven, but length still reads this off the broadcast player, so it is a UI_Field |
| `statsPersisted` | **drop** | server-only; explicitly "read only by the server" |
| `isBot` | **drop** | no client component reads it — the only `isBot` reference in `apps/client/src` is `race-views.test.tsx` fixtures; no roster/opponents/display code branches on it |

Keyboard hint sets for the player's OWN board (`revealedLetters` / `partialMatches`
/ `noMatch`) travel on the **`guess:ack`** path, NOT on the broadcast player — they
are not `RacePlayer` fields, so they are out of scope for this trim. Leave the
ack path alone.

Server-only, never on the wire (already excluded — keep excluded): the assigned
`word` and all of `RacePlayerServerData` (`revealedLetters`, `partialMatches`,
`noMatch`, `foundPositions`, `hintPositions`, `lastAcceptedGuessAt`).

---

## Battle Royale

Broadcast type today: `ClientGame = { room: Room; players: Record<id, PlayerDisplay> }`
(`emitLobbyUpdate`'s `{ ...game, players }`). Consumers: `battle-royale.tsx`,
`opponents.tsx`, `guess-container.tsx`, `bonus-preview.tsx`, `health.tsx`,
`winner.tsx`, `eliminated.tsx`, `match-timer.tsx`, `attack-picker.tsx`,
`share-code.tsx`.

### `Room` (room-level)

| field | keep? | rendered by / reason to drop |
| --- | --- | --- |
| `lobbyId` | keep | room identity |
| `shareCode` | keep | ShareCode before start |
| `startTime` | keep | CountDownTimer "Game Starting"; survival-time base in Winner/Eliminated |
| `isStarted` | keep | gates board vs lobby, keyboard enable |
| `isFinished` | keep | Winner overlay gate |
| `winnerId` | keep | Winner gate (`winnerId === userId`) |
| `isDraw` | keep | result branch |
| `matchEndTime` | keep | `MatchTimer` countdown |
| `createdAt` | **drop** | not read by any client component |

### `PlayerDisplay` (per-player)

| field | keep? | rendered by / reason to drop |
| --- | --- | --- |
| `name` | keep | opponents initials, winner/eliminated name, attacker badges |
| `isAnonymous` | keep | guest styling |
| `revealed_letters` | keep | opponents revealed tiles; self board full matches |
| `partialMatches` | keep | self keyboard colouring — `battle-royale.tsx:310` passes `players[userId]?.partialMatches` to the keyboard `partialMatch`. Unlike Race, the BR self-board reads this off the broadcast player |
| `noMatch` | keep | self keyboard colouring — `battle-royale.tsx:311` passes `players[userId]?.noMatch` to the keyboard `noMatch`. Read off the broadcast player like `partialMatches` |
| `display_queue` | keep | opponents hopper + self `GuessContainer` queue |
| `endTimeStamp` | **drop** | not read anywhere in `apps/client` (zero matches). Winner (winner.tsx:29) and Eliminated (eliminated.tsx:30) both compute survival time as `userData.life - gameStartTimestamp`, never `endTimeStamp` |
| `isEliminated` | keep | opponents filter, self eliminated gate |
| `life` | keep | `Health` timer, `OpponentTimer`, survival time in Winner/Eliminated |
| `totalGuesses` | keep | Winner/Eliminated "Guesses" stat |
| `correctGuesses` | keep | Winner/Eliminated "Correct" stat |
| `currentWordGuesses` | keep | `GuessContainer` / `BonusPreview` bonus preview |
| `statsPersisted` | **drop** | server-only; "read only by the server" |
| `lastAttackerName` | keep | Eliminated "Eliminated by X" |
| `currentWordIsAttack` | keep | `GuessContainer` attack badge, `BonusPreview` +0s |
| `currentWordAttackerName` | keep | `GuessContainer` attacker initials badge |
| `attackQueueView` | keep | `GuessContainer` pending/cemented slots |
| `attackCementAt` | keep | `GuessContainer` batch cement countdown |

Server-only, never on the wire (keep excluded): `PlayerServerData` /
`BotServerData` (`word`, `currentWordIsAttack` server copy, attack queue
`pending`/`cemented`/`cementAt`, bot `level`/`target`/`guessTimeStamp`/`botGuesses`).

---

## Resolved "re-evaluate" items (task 2.1)

The four previously-ambiguous fields were resolved by grepping the consuming
components under `apps/client/src`. Each resolution is folded into the keep-list
tables above; recorded here for traceability:

1. **Race `lastFeedback`** → **keep**. Read off the broadcast player at
   `round-board.tsx:74` (`player?.lastFeedback?.length`) as the word-length
   fallback. Keyboard colouring is ack-driven, but length still reads this
   field, so it is a UI_Field.
2. **Race `isBot`** → **drop**. No client component reads it. The only `isBot`
   reference in `apps/client/src` is in `race-views.test.tsx` fixtures; no
   roster/opponents/display code branches on it.
3. **BR `partialMatches` / `noMatch`** → **keep** (both). The BR self-board reads
   them off the broadcast player at `battle-royale.tsx:310-311`, feeding the
   keyboard's `partialMatch` / `noMatch` colouring (unlike Race, which uses the
   ack path).
4. **BR `endTimeStamp`** → **drop**. Zero matches anywhere in `apps/client`.
   Winner (`winner.tsx:29`) and Eliminated (`eliminated.tsx:30`) both compute
   survival time as `userData.life - gameStartTimestamp`, never `endTimeStamp`.

## Diff-surface rule (ties to Requirement 3)

The delta diff compares the **trimmed** snapshot only. Dropping the server-only
churny fields above (`roundGuesses`, `correctLetters`, `correctPositionsFound`,
`qualifiedAt`, `eliminatedAt`, `statsPersisted`, …) is what makes deltas small:
those fields change constantly server-side but, being excluded from the trimmed
shape, never cause a player to appear in a delta. A player should appear in a
delta only when a **rendered** field of theirs changed.
