'
# Final Word — Play With Friends Feature Outline

Let friends play together instead of being dropped into separate public fields.

This is split into two tiers. **v1 is the near-term, detailed design and is ready to build.** v2 is a sketch whose details are deliberately deferred until we start it.

- **v1 — Share a room code to join the same public game.** A player shares the code for the public game they're in; a friend enters it and is routed into that same room instead of a random one. Best-effort, no staging area, no new infrastructure.
- **v2 — Configurable private lobbies.** A host-owned staging room friends gather in before anyone commits, with friends-only / fill-with-bots / convert-to-public launch modes. Details to be ironed out when we pick it up.

This document is an outline/design, not an implementation. It is written against the current architecture so the build reuses existing patterns rather than inventing new ones.

---

## Background: how matchmaking works today

Matchmaking is implicit. A joining socket calls `getOrCreateGame` (Battle Royale) or `getOrCreateLobby` (Race), which scan the in-memory room Map and drop the player into the *first open, not-yet-started* room, else mint a fresh one keyed by `randomUUID()`. There is **no addressable, host-controlled waiting space** — the room exists before a match starts, but it has no shareable handle, no owner, and no "wait for my friends" control. v1 adds the shareable handle; v2 adds the owner and controls.

Key facts that shape v1:

- A public room arms `startTime = Date.now() + Max_Wait_Time` the moment the first player joins. `Max_Wait_Time` is **45 seconds** (`apps/server/src/games/battle-royale/logic/battle-royale.ts`). When it expires, bots fill the field and the match starts.
- A started room is excluded from join (`!game.room.isStarted` is the gate). So the friend-join window is "until the room starts."
- Current player base is effectively zero, so **capacity contention is a non-issue** — a shared room won't fill with strangers. The only real race in v1 is against the 45s start timer, not against capacity. This is why slot reservation is NOT needed in v1.

Relevant existing code:

- `apps/server/src/games/battle-royale/handlers.ts` — `join` / `leave` / `guess` handlers; the `join` handler is where the code branch goes.
- `apps/server/src/games/battle-royale/logic/battle-royale.ts` — `getOrCreateGame` (the scan to bypass with a code), `Max_Wait_Time` (45s), `handleAddBots`.
- `apps/server/src/games/race/` — same shape on the `/race` namespace (`getOrCreateLobby`, `scheduleLobbyStart`).
- `apps/client/src/pages/index.tsx` — `handlePlay` / `handlePlayRace`, how a game is entered and mounted.

---

# v1 — Share a room code to join the same public game

## Goal

A player in a public game can share a short room code. A friend enters that code and is placed into the **same** public room (bypassing the random-room scan), as long as it hasn't started yet. If it has started, they fall back to normal matchmaking with a clear message.

Best-effort by design. It does not hold a room open indefinitely, own it, or persist a party — those are v2.

## Scope

### In scope

- [ ] Expose the current room's id as a short, shareable code (derive a friendly code from `lobbyId`, or add a short code with a code -> `lobbyId` lookup Map)
- [ ] "Join with code" entry on the home screen
- [ ] Code-join branch in the socket `join` flow: join *that* room instead of running `getOrCreateGame`, if it exists and `!isStarted`
- [ ] Extend/refresh the 45s start timer when a room is shared or a friend code-joins, so the join window isn't a pure race (free of downside at ~0 players — no strangers are waiting on the timer)
- [ ] Graceful fallback when the room already started or is not found: message the user and drop them into normal matchmaking
- [ ] Battle Royale first; Race can follow the same pattern (same `join`/scan shape on its namespace)

### Out of scope for v1 (moved to v2)

- Any staging/lobby UI, host, ready state, or member list
- Launch control ("wait for my friends", start on command)
- Friends-only matches, bots toggle, convert-to-public
- Persistent party across games
- Realtime invite notifications (v1 shares the code manually — chat, call, etc.)
- Slot reservation (not needed until there's capacity contention)

## Mechanics

```text
Player A is in (or starts) a public BR room
   -> UI shows a shareable code for A's room
   -> A sends the code to friends however they like (no in-app invite needed)

Player B enters the code and plays
   -> socket join carries the code
   -> server resolves code -> lobbyId
        - room exists and !isStarted -> join THAT room (skip getOrCreateGame),
          refresh/extend the 45s start timer
        - room started or not found -> fallback: normal getOrCreateGame + notice
   -> both play the same public match; field fills with bots on timer as usual
```

Notes:

- The room's `lobbyId` already exists (the `randomUUID()` from `getOrCreateGame`); v1 only needs to surface it and add a lookup + one join branch.
- Timer handling is the one real reliability lever in v1. 45s is enough for a friend poised to join on a call, but not for async sharing; refreshing the timer on share/join covers both. With ~0 other players, extending the start costs nobody anything.
- Everything downstream (start, bot-fill, stats) is unchanged — a code-joined player is just a normal player who entered a specific room.

## Rough build order (v1)

1. [ ] Surface the room code in the game UI + a code -> room lookup on the server
2. [ ] "Join with code" entry on the home screen, threaded into the existing connect flow
3. [ ] Code branch in the `join` handler (join specific room, else fallback)
4. [ ] Start-timer refresh/extension on share/code-join
5. [ ] Fallback UX for started/not-found rooms
6. [ ] (Optional) mirror onto Race

---

# v2 — Configurable private lobbies (sketch, details deferred)

A host-owned staging room friends gather in before anyone commits to a match. This is the complete version that removes v1's raceiness and adds what a shared code fundamentally cannot do: hold a room open, own it, and configure how it launches. **The details below are intentionally high-level; we'll iron them out when we start v2.**

## Intended shape

- Host creates a private lobby, connects to the socket, and gets a code.
- Friends enter the code, connect, and **wait** in the lobby (the staging area the app lacks today).
- Host configures and launches one of:
  - **Friends only** — e.g. 10 friends join -> an 11-person game, no bots, no randos.
  - **Fill with bots** — the human party plus bots topping up the field.
  - **Convert to public** — inject the lobby's members into the public pool as a *prefilled* game object, then behave like a normal public room: arm the 45s timer and start when it expires (bot-fill) or when randos fill it.

## Decisions already made (carry into v2)

- **Lobby/party state lives in the game server, in-memory** — not Firebase, not the database. It reuses the existing in-memory room structures and the `join`/`lobby:update` socket contract. Rationale: the lobby's end state is a live match (which is in-memory on the game server), so staging it anywhere else creates a split source of truth and a hand-off at launch. DB/Firebase buy durability we don't want for a party that is defined to die on disconnect.
- **Party lifecycle is connection-scoped** — persists across games (don't tear down on match start; re-gather on match end) but dies on leave / kick / last-member disconnect. These are all events the game server already observes on the socket (it distinguishes retain-on-disconnect from remove-on-explicit-leave).
- **Invites:** v2 can add Supabase-realtime invite notifications (mirroring the Duels pattern: `useDuelRealtime` + app-root `duel-notifications.tsx`) to reach friends who aren't connected. Code-sharing still works as the baseline. Friend validation reuses the accepted-friend check from `duels.ts` `sendDuel` + the `friendships` table.
- **Multi-instance scaling** (if/when there are several game-server nodes): use a Redis-backed Socket.IO adapter so the game server stays the single source of truth across nodes — not a move to Firebase/DB for party state.

## Open items to resolve when we start v2

- [ ] "Convert to public" requires the prefilled game to be **discoverable by the normal matchmaking scan** — i.e. registered into the same `games` Map `getOrCreateGame` iterates, as a not-started room, with the privacy flag dropped. This is the one place private and public state must merge. Design this carefully.
- [ ] **Race small-field config:** `RACE_CONFIG` is tuned for 99 players (round 0 eliminates 50%, etc.). A friends-only / bots-off Race (e.g. 11 players) needs either a small-field round config or a v2 rule that Race always fills with bots / goes public. Battle Royale degrades to small fields naturally.
- [ ] Host migration vs. teardown when the host leaves
- [ ] Max party size (public-together co-location, if revisited)
- [ ] Guest policy for lobbies (registered-only like Duels/friends, via `guestProtectedProcedure`?)
- [ ] Whether a bots-off private match can start with a single human
- [ ] Code generation/collision strategy and stale-lobby TTL sweep
- [ ] Interaction with `installSingleConnection` when moving from lobby to match on the same socket
- [ ] Per-member `canStartMatch` enforcement at launch (guest/daily limits), surfacing existing `join:error` reasons

## Reuse summary (v2)

| Need | Reuse |
| --- | --- |
| Room/broadcast | `socket.join(roomId)` + `io.to(roomId).emit(...)`, coalesced like `scheduleLobbyUpdate` |
| Match structures | Existing in-memory `Game` / `RaceMatch` + `serverOnlyData` / `serverOnlyBotData` |
| Bot fill | `handleAddBots` (BR) / Race bot-fill seam, gated by the bots toggle |
| Convert-to-public | Register the lobby's `Game` into the public `games` Map, arm the standard 45s timer |
| Friend validation | `friendships` table + accepted-friend check from `duels.ts` `sendDuel` |
| Invite notifications | Duels pattern: `useDuelRealtime` + app-root `duel-notifications.tsx` |
| Match-start limits | `canStartMatch` + `join:error` reasons (`guest-mode-limit` / `daily-limit`) |
| Client match mount | `handlePlay` / `handlePlayRace` + `<BattleRoyale />` / `<Race />` in `index.tsx` |

---

## Why this split

v1 is cheap and ships now because the player base is ~0, so there's no capacity contention — the only risk is the 45s timer, which a timer refresh handles. It delivers the core "play with my friend" value with a small, surgical change (surface a code, add a join branch, nudge the timer).

v2 is the full experience and is worth doing once there's a player base and a need to hold rooms open, own them, and configure launches — things a shared code structurally cannot do. v1 and v2 are complementary, not competing: v1 is the near-term win, v2 is the complete version.
