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
| `lastFeedback` | **re-evaluate** | the board's keyboard colouring now comes from `guess:ack` (server-accumulated hints), NOT from `player.lastFeedback`. Confirm no component reads `lastFeedback` off the broadcast; if none, **drop**. (It is set server-side but may be ack-only.) |
| `statsPersisted` | **drop** | server-only; explicitly "read only by the server" |
| `isBot` | **re-evaluate** | check whether any roster/opponents code branches on it for display; if not, drop |

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
| `partialMatches` | **re-evaluate** | self keyboard colouring — confirm the BR board reads this off the player (it may, unlike Race). Keep if read; the audit must verify |
| `noMatch` | **re-evaluate** | same as `partialMatches` |
| `display_queue` | keep | opponents hopper + self `GuessContainer` queue |
| `endTimeStamp` | **re-evaluate** | survival ordering is server-side; check if Winner/Eliminated reads it for display. Winner uses `life - startTime`, not `endTimeStamp` — likely **drop** |
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

## Open "re-evaluate" items (resolve during task 2.1 implementation)

These are the only ambiguous fields; the agent should confirm each by grepping
the consuming components before finalizing keep/drop:

1. **Race `lastFeedback`** — is it read off the broadcast player anywhere, or is
   all keyboard colouring driven by `guess:ack`? If ack-only → drop.
2. **Race `isBot`** — does any display code branch on it? If not → drop.
3. **BR `partialMatches` / `noMatch`** — does the BR self-board read these off the
   player (vs. an ack path like Race)? Keep only if read for rendering.
4. **BR `endTimeStamp`** — confirm Winner/Eliminated use `life`, not
   `endTimeStamp`, for survival time; if unused for display → drop.

## Diff-surface rule (ties to Requirement 3)

The delta diff compares the **trimmed** snapshot only. Dropping the server-only
churny fields above (`roundGuesses`, `correctLetters`, `correctPositionsFound`,
`qualifiedAt`, `eliminatedAt`, `statsPersisted`, …) is what makes deltas small:
those fields change constantly server-side but, being excluded from the trimmed
shape, never cause a player to appear in a delta. A player should appear in a
delta only when a **rendered** field of theirs changed.
