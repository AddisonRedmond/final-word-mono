# Final Word — Private Lobbies Feature Outline

Let friends play together instead of being dropped into separate public fields. A host creates a lobby, shares a short code, friends join, and the host launches either:

- **Public-together** — the party is routed into a normal public match as a group, filling the rest of the field with other players/bots as usual.
- **Private match** — a closed room only reachable with the lobby code, with a host-controlled **enable bots** toggle to fill or not fill empty slots.

This document is an outline/design, not an implementation. It is written against the current architecture so the eventual build reuses existing patterns rather than inventing new ones.

---

## 1. Why this is a new concept

The server has no notion of a private or invite-only room today. Matchmaking is implicit: a joining socket calls `getOrCreateGame` (Battle Royale) or `getOrCreateLobby` (Race), which scan the in-memory room Map and drop the player into the *first open, not-yet-started* room, else mint a fresh one keyed by `randomUUID()`.

A private lobby is fundamentally **"skip that open-lobby scan and join a specific keyed room instead,"** plus host control over when the match starts and whether bots fill the field.

Relevant existing code:

- `apps/server/src/games/battle-royale/handlers.ts` — `join` / `leave` / `guess` handlers, bot-fill on start timer, reconnect logic.
- `apps/server/src/games/battle-royale/logic/battle-royale.ts` — `getOrCreateGame` (the scan to bypass), `handleAddBots` (the bot-fill seam).
- `apps/server/src/games/race/` — the same shape on the `/race` namespace (`getOrCreateLobby`, `scheduleLobbyStart`).
- `apps/server/src/index.ts` — Socket.IO setup, per-namespace auth, game-module registration.
- `apps/client/src/server/api/routers/duels.ts` — the existing friend-invite-to-a-game flow (closest analogue).
- `apps/client/src/hooks/useDuelRealtime.tsx` + `components/duel-notifications.tsx` — the Supabase-realtime invite/notification pattern.
- `packages/db/src/schema.ts` — persistence model and friends table.

---

## 2. Scope

### In scope

- [ ] Create a lobby and get a short, shareable join code
- [ ] Join a lobby by code
- [ ] Invite accepted friends directly from the lobby (reuse the Duels friend-invite pattern)
- [ ] Lobby member list with host indicator and ready/connected state
- [ ] Host picks the game mode (Battle Royale or Race to start)
- [ ] Host launches **public-together** (party routed into a public match)
- [ ] Host launches **private match** (closed room, code required to join)
- [ ] **Enable bots** toggle for private matches (host-controlled)
- [ ] Host can kick a member
- [ ] Host migration or lobby teardown when the host leaves
- [ ] Leave lobby

### Out of scope (initial release)

- Duels in a lobby (Duels is async/turn-based and not socket-backed; a lobby targets the realtime modes). Could be a follow-up.
- Cross-mode lobby persistence across app restarts (lobbies are ephemeral, see §4).
- Spectator-only joins.
- Mobile: realtime modes are desktop-only today (see §9); lobbies inherit that constraint initially.

### Open questions

- [ ] Max party size for **public-together** — the public field is 99. A party should be capped well below that (e.g. 8) so it stays a "squad," not a lobby takeover. Decide the cap.
- [ ] For public-together, do we guarantee the whole party lands in the *same* public room, or best-effort? (True guarantee requires reserving slots — see §6.)
- [ ] Invite transport: Supabase realtime (works when invitee is offline/elsewhere, mirrors Duels) vs. pure Socket.IO (simpler, only reaches connected friends). Recommendation in §7.
- [ ] Should a private match with bots disabled be allowed to start with a single human? (Likely yes for testing; confirm.)
- [ ] Guests: can anonymous users create/join lobbies, or is this registered-only like Duels/friends? (`guestProtectedProcedure` is the existing gate.)

---

## 3. User flows

### 3a. Host creates a lobby

```text
Home screen
   -> "Play with friends"
   -> Create lobby
   -> Server mints lobby + join code (e.g. "FROG-72")
   -> Host lands in lobby room (host badge, empty member list + self)
   -> Host sees: mode selector, invite friends, share code,
      [public-together | private match] launch options,
      enable-bots toggle (private only)
```

### 3b. Friend joins

```text
Friend receives invite (toast/notification) OR is given the code
   -> Enter code / click invite
   -> Server validates code + lobby not started + capacity
   -> Friend joins lobby room, member list updates for everyone
```

### 3c. Launch — public together

```text
Host picks mode (Battle Royale / Race)
   -> Host clicks "Play public together"
   -> Server routes every connected lobby member into ONE public match
      of that mode (reserve/claim a shared public room)
   -> Normal public rules apply: field fills with other humans + bots,
      standard start timer, stats persist as normal
   -> Lobby dissolves once the party is placed
```

### 3d. Launch — private match

```text
Host picks mode + toggles "enable bots" on/off
   -> Host clicks "Start private match"
   -> Server converts the lobby room into a started private match:
        - bots ON  -> fill remaining slots via handleAddBots (as public does)
        - bots OFF -> start with only the humans present
   -> Only members already in the lobby play; the code no longer admits joiners
      once started (or admits as spectators/late — decide, see open questions)
```

---

## 4. Server data model

Lobbies are **ephemeral and in-memory**, exactly like the existing `games` / `matches` Maps. They do not need a DB table to function — only the invite records (if we persist invites, §7) touch the DB.

New in-memory structure (server), one per live lobby:

```ts
type LobbyMode = "battle-royale" | "race";

type LobbyLaunch =
  | { kind: "public-together" }
  | { kind: "private"; enableBots: boolean };

interface Lobby {
  code: string;            // short, human-shareable, collision-checked
  lobbyId: string;         // randomUUID(), the socket.io room id
  hostUserId: string;
  mode: LobbyMode;         // host-selected; defaults to battle-royale
  members: Map<string, LobbyMember>; // keyed by Supabase user UUID
  createdAt: number;
  isLaunched: boolean;     // true once a match has been started/routed
}

interface LobbyMember {
  userId: string;
  name: string;
  isAnonymous: boolean;    // mirrors socket.data.isAnonymous
  isHost: boolean;
  isReady: boolean;        // optional ready-up gate before host can launch
  connected: boolean;      // retained on disconnect for brief reconnect window
}
```

Notes:

- `lobbyId` doubles as the Socket.IO room name (`socket.join(lobbyId)` + `io.to(lobbyId).emit(...)`), matching how BR/Race already broadcast.
- `code` -> `lobbyId` needs a lookup Map so a join-by-code resolves fast.
- A **private match**, once started, is just a normal in-memory `Game` / `RaceMatch` created from the lobby's members — reusing the existing room structures and the `join:ack` / `lobby:update` contract. The difference from public is only *how players got in* (code-gated, no open-lobby scan) and *whether bots fill* (the toggle).

A `GameMode` discriminator does not exist today (modes are identified by module id + namespace). The lobby introduces `LobbyMode`; keep it in `packages/shared` so client and server agree, following the Zod-validated shared-config pattern already used by `packages/shared/src/race.ts`.

---

## 5. Socket contract additions

Keep the existing gameplay contract (`join` / `leave` / `guess`, `join:ack` / `lobby:update` / `join:error` / `guess:ack`) untouched. Add a small lobby contract. These can live on the default namespace alongside Battle Royale, or on a dedicated `/lobby` namespace (auth must be re-installed per namespace, as Race does).

Client -> server:

```text
lobby:create   { mode }                       -> ack { code, lobbyId }
lobby:join     { code }                        -> ack { ok, lobbyId } | error { reason }
lobby:leave                                    -> ack { ok }
lobby:setMode  { mode }                        (host only)
lobby:setBots  { enableBots }                  (host only)
lobby:ready    { isReady }
lobby:kick     { userId }                      (host only)
lobby:launch   { launch: LobbyLaunch }         (host only)
```

Server -> client:

```text
lobby:update   { lobby snapshot (members serialized like players) }
lobby:error    { reason }   // code-not-found | lobby-started | lobby-full |
                            // not-host | guest-not-allowed | daily/guest limit
lobby:launched { mode, roomId }   // tells clients to transition into the match
```

On `lobby:launched`, the client mounts the mode's existing game component against the already-connected socket (BR) or hands the token to `<Race />` (Race), reusing the current `handlePlay` / `handlePlayRace` wiring in `apps/client/src/pages/index.tsx`.

Reuse `scheduleLobbyUpdate`'s coalescing idea (one broadcast per ~250ms) for `lobby:update` to avoid chatty member-list churn.

---

## 6. Launch mechanics (the two paths)

### Public-together

The hard part is landing the whole party in one public room. Options, cheapest first:

1. **Best-effort co-location** — the first party member runs the normal `getOrCreateGame`, then the server pins that `roomId` and routes the rest of the party into the same room *as long as it hasn't started and has capacity*. Simple; can split the party if the room starts or fills mid-route.
2. **Slot reservation** — extend the room with a reserved-count so the open-lobby scan accounts for incoming party members before they socket-join. Guarantees co-location up to the party cap; more invasive to `getOrCreateGame`.

Recommendation: start with (1) behind the party-size cap (§2 open question); revisit (2) if splitting proves common. Either way, standard start-timer, bot-fill, and stats rules apply unchanged once placed.

### Private match

Convert the lobby directly into a started room:

- Build a `Game` / `RaceMatch` from `lobby.members` instead of accumulating via the public `join` scan.
- **Bots ON:** call the existing `handleAddBots(MAX_PLAYERS - humanCount)` (BR) / Race's bot-fill seam — identical to how a short public lobby tops up today.
- **Bots OFF:** start with only the humans; skip the fill. Confirm the mode's start/elimination logic tolerates a small field (Race's rounds are tuned for 99 — a 2-player private Race needs the round config to degrade gracefully; flag for the Race path specifically).
- Mark `isLaunched`, stop admitting new code-joins (or admit as late/spectator per the open question), and from here the match is indistinguishable from any other in-memory room.

Bots never persist stats and are never crowned (existing invariant via the UUID-vs-`bot${i}` id check in `handlers.ts` / `stats.ts`) — this carries over for free.

---

## 7. Invites & notifications

Two viable transports; they are not exclusive (code-sharing always works regardless):

- **Supabase Postgres realtime (mirrors Duels)** — persist a lightweight `lobby_invites` row; the invitee's app-root subscription (like `useDuelRealtime` + `duel-notifications.tsx`) raises a toast with a join button. Reaches friends who aren't on the home screen. Requires a small table + migration + RLS/publication, following the Duels precedent.
- **Pure Socket.IO** — emit an invite event to the friend's connected socket. No DB, but only reaches friends currently connected to the socket server.

Recommendation: **share-code first (no dependency), plus Socket.IO invites for connected friends.** Add Supabase-realtime invites as a fast-follow if we want offline-reachable invites matching the Duels experience.

Friend validation reuses the `friendships` table and the exact accepted-friend check in `duels.ts` `sendDuel` (both-directions `requesterId`/`addresseeId`, status `accepted`). Gate invites behind `guestProtectedProcedure` if lobbies are registered-only.

---

## 8. Edge cases & lifecycle

- [ ] Host disconnects in the lobby (pre-launch): migrate host to the next member, or tear down if empty. Reuse the retain-on-disconnect / remove-on-explicit-leave distinction already in BR's `disconnect` vs `leave`.
- [ ] Last member leaves a lobby -> tear it down (mirror the "last human left" cleanup in `handlers.ts`).
- [ ] Member disconnects mid-lobby: keep a short reconnect window (as gameplay already does), show as `connected: false`.
- [ ] Code collisions: generate and collision-check against the active-lobby code set.
- [ ] Stale lobbies: TTL sweep for lobbies that never launch (e.g. created and abandoned).
- [ ] `installSingleConnection` already rejects a second socket per user — confirm lobby + game transitions don't trip it when moving from lobby to match on the same socket.
- [ ] Match-start gate: `canStartMatch(userId, isAnonymous)` must still run per member at launch so guest one-game-per-mode and future daily limits are enforced; a blocked member surfaces `lobby:error` with the existing `guest-mode-limit` / `daily-limit` reasons.
- [ ] Private Race with bots OFF and few humans: verify `RACE_CONFIG` round math (`eliminationCount`, `qualifyingCount`) behaves for small fields, or define a small-field config.

---

## 9. Client surface

- [ ] Home screen entry point: a "Play with friends" card/button next to the existing mode cards in `apps/client/src/pages/index.tsx`.
- [ ] Lobby screen: member list, host controls (mode selector, bots toggle, kick, launch), share-code UI, invite-friends picker (reuse friends list components).
- [ ] Transition into the match on `lobby:launched`, reusing `<BattleRoyale />` / `<Race />` mounting already in `index.tsx`.
- [ ] Desktop-only: realtime modes are gated behind `isDesktop`/`hydrated` today, with a "Desktop only" notice on small screens. Lobbies inherit this initially — decide whether the lobby *shell* (create/join/invite) can exist on mobile even if the match itself can't start there.
- [ ] Guest gating: match the chosen policy (Duels/friends are registered-only via `useIsGuest` + `guestProtectedProcedure`).

---

## 10. Rough build order

1. [ ] Shared `LobbyMode` + `LobbyLaunch` types and any Zod config in `packages/shared`.
2. [ ] In-memory lobby registry + code generation/lookup on the server.
3. [ ] Lobby socket contract (`create` / `join` / `leave` / `update`) — create, join-by-code, member list.
4. [ ] Host controls (mode, bots toggle, kick, ready) + host migration/teardown.
5. [ ] Private-match launch (bots on/off) by converting a lobby into a started room — the self-contained path, no public-matchmaking changes.
6. [ ] Public-together launch (best-effort co-location first).
7. [ ] Client lobby screen + home entry point + match transition.
8. [ ] Socket.IO friend invites; (optional fast-follow) Supabase-realtime invites.
9. [ ] Edge cases: reconnect, stale sweep, single-connection interaction, match-start gate per member.
10. [ ] QA across both modes, guest/registered, small private fields, and party co-location.

---

## 11. Reuse summary

| Need | Reuse |
| --- | --- |
| Room/broadcast | `socket.join(lobbyId)` + `io.to(lobbyId).emit(...)`, coalesced like `scheduleLobbyUpdate` |
| Match structures | Existing in-memory `Game` / `RaceMatch` + `serverOnlyData` / `serverOnlyBotData` |
| Bot fill | `handleAddBots` (BR) and Race's bot-fill seam, gated by the enable-bots toggle |
| Friend validation | `friendships` table + the accepted-friend check from `duels.ts` `sendDuel` |
| Invite notifications | Duels pattern: `useDuelRealtime` + app-root `duel-notifications.tsx` |
| Match-start limits | `canStartMatch` + `join:error` reasons (`guest-mode-limit` / `daily-limit`) |
| Client match mount | `handlePlay` / `handlePlayRace` + `<BattleRoyale />` / `<Race />` in `index.tsx` |
| Guest/registered gate | `useIsGuest` (client) + `guestProtectedProcedure` (tRPC) |

The feature is mostly new orchestration (lobby registry, code, host controls, launch routing) layered on top of mechanisms that already exist. The only genuinely new primitives are the lobby room keyed by a shareable code, the host/launch state machine, and a `LobbyMode` discriminator.
