# Final Word — Feature Roadmap

**Purpose:** A living document capturing planned features at a descriptive level. Each feature will be revisited and expanded into a full spec (`requirements.md`, `design.md`, `tasks.md`) under its own `.kiro/specs/` folder when it graduates to implementation.

**Status:** Planning / not yet scheduled. Descriptions are intentionally high-level; details TBD per feature.

## Codebase context (shared across features)

- **Monorepo:** pnpm + Turbo. `apps/client` (Next.js, hosts tRPC API + UI), `apps/server` (realtime game server on Hetzner, has `games/`, `socket/`, `utils/`), `packages/db` (Drizzle schema/migrations), `packages/shared`, `packages/types`, `packages/ui`, plus Supabase.
- **DB (Drizzle owns tables; Supabase owns RLS/realtime SQL):** `profiles`, `duels`, `duelSecrets`, `duelParticipants`, `friendships`, `battleRoyaleStats` (aggregate, one row per user; includes `wonLastGame`).
- **tRPC routers:** `apps/client/src/server/api/routers/` — `duels` (has `MAX_INVITEES = 4`, `sendDuel`, `startOrResumeDuel`, etc.), `friends`, `post`.
- **Existing game modes:** Battle Royale (realtime, aggregated into `battleRoyaleStats`) and Duels (invite-based, realtime via Supabase channels + `apps/server`).
- **No subscription/entitlement or per-day usage concept exists today** — introduced by Feature 1.

---

## Feature 1 — Polar Subscriptions (Free vs Premium)

**Problem:** Monetize with a Polar-backed subscription that gates usage limits and unlocks premium features and cosmetics.

**Tiers:**

| Capability | Free | Premium |
|---|---|---|
| Realtime games / day | 3 | Unlimited |
| Active duels at once | 2 | 5 |
| Additional opponents invitable per duel | 1 | 4 |
| Leaderboard | Basic | Expanded (more self + other-player stats) |
| Champion cosmetics (see below) | No | Yes |

**Trial:** Free 1-week premium trial.

**Downgrade/lapse behavior:** Existing in-flight duels play out normally; creating *new* duels beyond the free limits is blocked once premium ends.

**Champion cosmetic (premium-only):** If a premium user won their last Battle Royale game (`battleRoyaleStats.wonLastGame`), show: a crown on their opponent-facing UI element, sparkles on the "Final Word" hero section, and gold tiles.

**Entry points / UX:** Upgrade option in the top-right user-icon dropdown; a dedicated subscription management page; contextual upgrade prompts when a free user hits a limit.

**Rough approach:**
- Integrate Polar (checkout, webhooks, customer/subscription state).
- New entitlement/subscription state tied to `profiles` (tier, status, trial end, current period).
- Usage tracking for daily realtime game count (new; not tracked today) — enforced across game modes.
- Enforce limits at creation points: duel active-count and invite-count (extend `duels` router / `MAX_INVITEES` logic), daily game cap at game start.
- Expanded leaderboard reads more `battleRoyaleStats` columns for premium.
- Cosmetic layer reads `wonLastGame` + premium status.

**Open questions:** Pricing/plan IDs; monthly vs annual; exact "expanded leaderboard" stat set; where the daily counter resets (timezone) and whether it's per-mode or global.

---

## Feature 2 — Mobile: Responsiveness + React Native

**Primary goal:** Make the game playable on phones and tablets, with app-store distribution.

### 2a. Responsive web client (foundational)

Make the existing Next.js `apps/client` fully responsive across phone/tablet/desktop. Prerequisite that the RN effort and any PWA fallback build on.

### 2b. React Native app (chosen path)

New RN app in the monorepo for native phone/tablet distribution, reusing shared logic from `packages/shared` and `packages/types` (game rules, word lists, tRPC types, realtime auth patterns). PWA is noted as a lighter-weight fallback option, not the plan.

**Rough approach:**
- Land responsiveness first as its own milestone.
- Add an `apps/mobile` (Expo/React Native) app; wire it to the same tRPC API and Supabase realtime.
- Rebuild UI natively while sharing non-UI logic; reconcile auth/session and realtime socket token handling for mobile.

**Open questions:** Expo vs bare RN; how much of `packages/ui` is reusable vs native re-implementation; auth/deep-link strategy on mobile; store accounts/CI for builds.

---

## Feature 3 — Third Realtime Game Mode: Round-Based Elimination Race

**Problem:** Add a third realtime mode alongside Battle Royale and Duels, running on the existing Hetzner realtime server (`apps/server`) with different, config-driven rules.

**Concept (spitball, tunable):**
- **Round 1:** ~2 min. Guess 5 four-letter words to qualify. Slowest bottom X% eliminated.
- **Round 2:** Guess 3 five-letter words. Bottom X% eliminated.
- **Final round:** 1 six-letter word. Fastest correct guess wins the match.
- **Anti-spam penalty:** If a player guesses too fast, debounce their keypresses so input feels deliberately sluggish (encourages deliberate guessing).

**Design intent:** Rules driven by **configuration** rather than hardcoded logic — round count, per-round timers, word lengths, words-per-round, elimination percentages, and penalty thresholds all configurable.

**Data:** New stats table for this mode's aggregates (parallel to `battleRoyaleStats`).

**Feature 1 interaction:** Counts against the daily game limit — but this enforcement is dormant until Feature 1 ships. During beta everything is unlimited free.

**Rough approach:**
- New game module under `apps/server/src/games` with a round/elimination state machine and a shared config schema.
- New Drizzle stats table + upsert-on-finish flow mirroring the Battle Royale aggregate pattern.
- Client UI for lobby, round transitions, elimination feedback, and the sluggish-input penalty.
- Hook game start into the daily usage counter from Feature 1 (when it exists).

**Open questions:** Exact elimination percentages and min/max lobby size; matchmaking/lobby formation; tie-breaking; penalty tuning (threshold + debounce amount); premium interaction beyond the daily cap.

---

## Feature 4 — Realtime delta broadcasts (scale the realtime server for human-primary games)

**Problem:** Today the realtime server broadcasts the **full room snapshot** to every socket in a room on each coalesced update tick (`scheduleRaceUpdate` → `emitRaceUpdate` every `updateWindowMs` ≈ 250 ms; Battle Royale mirrors this). That's cheap when a game is mostly bots (one real socket to send to), but it does not scale to **human-primary games**, which is the goal. A full 99-human game would fan out a whole-room payload to ~99 clients 4×/sec (~392 messages/sec per game), and the snapshot itself grows with the number of real players. Broadcast fan-out — not CPU or bot simulation — becomes the binding constraint on a single Node event loop as real players replace bots.

**Goal:** Send only **what changed** since each client last heard, instead of the entire room state every tick, so per-tick bytes and serialization cost scale with the *delta size* rather than the *field size*. This keeps a single realtime process viable for far more concurrent human players and directly reduces client bandwidth on mobile (ties into Feature 2).

**Rough approach:**
- Introduce a per-room, monotonically-versioned update model: each broadcast carries a sequence number and only the fields/players that changed since the previous broadcast. The client applies deltas onto its local room state.
- Keep an initial **full snapshot** on join / reconnect / round transition (the client needs a complete base to apply deltas to), then stream deltas in between. Reuse the existing `join:ack` snapshot path as the base.
- Build on the broadcast coalescing already in place (`scheduleRaceUpdate` / `updateWindowMs`) — the trailing-edge batch window is the natural place to diff accumulated changes and emit one delta.
- Trim the broadcast payload to only UI-rendered fields while doing this (a cheaper, independent win that compounds with deltas).
- Add a resync path: if a client detects a gap in sequence numbers (missed/out-of-order delta), it requests a fresh full snapshot rather than rendering stale state.
- Apply symmetrically to Battle Royale and Race, since both share the full-snapshot pattern.

**Related infra direction (not this feature, but informs it):** longer-term the realtime server may move off a single Hetzner box toward **per-game isolation on EC2** (worker-threads or a process pool, with new games assigned to the least-loaded worker; possibly one process per game for crash isolation). Game state is already self-contained per room (`matches` / `serverOnlyData` / `serverOnlyBotData` keyed by room id, no cross-game shared state), so games are cleanly relocatable. That split would require a lobby/routing front door, cross-process socket handoff (direct connect or a Socket.IO Redis adapter), and moving lobby discovery (`shareCodes` + open-lobby scan) into a shared store. Delta broadcasts reduce per-connection cost regardless of where the process runs, so this feature is worth doing first and independently.

**Measure first:** before (and after) this work, instrument the server with event-loop-lag (`perf_hooks.monitorEventLoopDelay`) + RSS sampling and record the full-snapshot payload size for a full game, so the win is quantified and the "when to split processes" decision is driven by real numbers rather than estimates.

**Open questions:** delta encoding/shape (per-field patch vs per-player diff vs JSON Patch); how often to force a keyframe (full snapshot) to bound drift; whether to raise `updateWindowMs` under load as a complementary lever; client-side apply/resync complexity vs the bandwidth saved; interaction with the future per-game process model (deltas are per-room, so they travel with a game to whatever process hosts it).

---

## Cross-cutting — Beta messaging

**What:** A persistent chyron/crawl fixed to the bottom of the app indicating the product is in beta, currently unlimited and free, with a premium tier planned. Serves as expectation-setting during the pre-premium period.

**Rough approach:** Global UI element in the web client (and mirrored in the RN app once it exists). Ideally toggleable via config/flag so it can be turned off when premium launches. Copy is placeholder for now.

**Interaction:** Displayed during the beta window (Features 3 and 2 ship under it). Comes down or changes when Feature 1 (premium) goes live.

---

## Suggested sequencing

1. **Feature 3 — Round-Based Elimination Race** first. Delivers immediate new gameplay value while everything is unlimited free. Note: its "counts against the daily game limit" behavior is dormant until Feature 1 ships.
2. **Feature 2a (responsiveness), then 2b (React Native)** — make the growing game set playable on phones/tablets.
3. **Feature 1 — Polar Subscriptions** last. Introduces the daily usage counter and enforcement, activates Feature 3's daily-limit interaction, and retires/updates the beta chyron.

**Feature 4 — Realtime delta broadcasts** is demand-driven rather than fixed in this order: schedule it once real-player concurrency (not bots) starts stressing a single realtime process — the telemetry it recommends is the trigger. It pairs naturally with Feature 2 (mobile clients benefit most from the reduced bandwidth) and should land before any per-game process/EC2 split, since it lowers per-connection cost no matter where the process runs.

Beta messaging is live from Feature 3 through the launch of Feature 1.
