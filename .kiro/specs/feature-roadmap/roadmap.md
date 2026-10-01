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

## Cross-cutting — Beta messaging

**What:** A persistent chyron/crawl fixed to the bottom of the app indicating the product is in beta, currently unlimited and free, with a premium tier planned. Serves as expectation-setting during the pre-premium period.

**Rough approach:** Global UI element in the web client (and mirrored in the RN app once it exists). Ideally toggleable via config/flag so it can be turned off when premium launches. Copy is placeholder for now.

**Interaction:** Displayed during the beta window (Features 3 and 2 ship under it). Comes down or changes when Feature 1 (premium) goes live.

---

## Suggested sequencing

1. **Feature 3 — Round-Based Elimination Race** first. Delivers immediate new gameplay value while everything is unlimited free. Note: its "counts against the daily game limit" behavior is dormant until Feature 1 ships.
2. **Feature 2a (responsiveness), then 2b (React Native)** — make the growing game set playable on phones/tablets.
3. **Feature 1 — Polar Subscriptions** last. Introduces the daily usage counter and enforcement, activates Feature 3's daily-limit interaction, and retires/updates the beta chyron.

Beta messaging is live from Feature 3 through the launch of Feature 1.


TODO: add anonymous sign in option
TODO: add cron for games that are 24 hours over due. Give duel initiator the ability to remove
a user who hasn't declined or accepted a duel so the results can be calculated/clear up the maximum duels