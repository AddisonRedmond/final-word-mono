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

## Feature 4 — Scale the realtime broadcast for human-primary games

**Full spec:** `.kiro/specs/realtime-broadcast-scaling/` (requirements / design / tasks, plus `UI_FIELDS.md`). The summary below is the roadmap-level framing; the spec is authoritative.

**Problem:** Today the realtime server broadcasts the **full room snapshot** to every socket in a room on each coalesced update tick (`scheduleRaceUpdate` → `emitRaceUpdate` every `updateWindowMs` ≈ 250 ms; Battle Royale mirrors this). That's cheap when a game is mostly bots (one real socket to send to), but it does not scale to **human-primary games**, which is the goal. A full 99-human game would fan out a whole-room payload to ~99 clients 4×/sec (~392 messages/sec per game), and the snapshot itself grows with the number of real players. Broadcast fan-out — not CPU or bot simulation — becomes the binding constraint on a single Node event loop as real players replace bots.

**Scope (decided):** implement **trimmed, versioned delta broadcasts** outright, plus a standing **strain-telemetry** signal. Two things are explicitly out of scope: dynamically changing the tick interval under load (the broadcast window stays fixed — scaling is handled by sizing the server), and any process-split architecture (a future infra decision the telemetry informs). Earlier framing split this into "trim + adaptive window" then "deltas"; that is superseded — deltas are the implementation and the trim is folded into them.

**Efficiency reality:** a `RacePlayer` serializes to ~300 bytes, so a 99-player field is a ~30 KB snapshot — ~120 KB/sec/client, ~12 MB/sec/game fanned to 99 clients, plus 99× `JSON.stringify` of 30 KB every tick. But in any 250 ms window only a handful of players actually change (they guessed, or got a hint), so a per-player delta carries ~6 of 99 records → **~10–20× reduction in per-tick bytes and serialization for a full human field**, improving as the field grows. Caveats, for honesty: it does **~nothing today** (rooms are bot-primary, one real socket), so this is a scaling investment, not a present-day win; and round transitions reset every player, so a few keyframe ticks per match pay full price regardless.

**Delta broadcasts:**
- Per-room, monotonically-versioned updates: each broadcast carries a sequence number and only the fields/players that changed since the previous broadcast. The client applies deltas onto its local room state. An empty tick (nothing changed) is skipped.
- **Keyframe** (full trimmed snapshot) on join / reconnect / round transition / a forced-keyframe cadence / resync — the client needs a complete base. Reuse the existing `join:ack` snapshot path.
- Diff at the trailing edge of the existing (fixed) coalescing window (`scheduleRaceUpdate` / `updateWindowMs`).
- **Resync:** if a client detects a sequence gap, it holds its last-good state and requests a fresh keyframe rather than rendering stale/partial state.
- **Payload trim is part of this:** keyframes and per-player delta records carry only client-rendered fields. The trimmed DTO is a **TypeScript `Pick` projection of the authoritative type** (the type is the source of truth, not a doc), so a new authoritative field is server-only by default and the delta diff can only iterate rendered fields. The keep/drop rationale and the resolved re-evaluate items live in the spec's `UI_FIELDS.md`.
- Ships behind a config flag (instant rollback to full trimmed snapshots) and applies symmetrically to Battle Royale and Race.

**Strain telemetry (standing signal, not a gate):** event-loop lag (`perf_hooks.monitorEventLoopDelay`) + RSS + aggregate broadcast byte/fan-out counters, reported continuously in the `event`-keyed log shape (feeds Feature 5). Its purpose is operational: tell the operator when a process is strained so the response — a bigger Hetzner box now, EC2 later — is a sizing decision backed by real numbers.

**Related infra direction (not this feature, but informs it):** longer-term the realtime server may move off a single Hetzner box toward **per-game isolation on EC2** (worker-threads or a process pool). Game state is already self-contained per room (`matches` / `serverOnlyData` / `serverOnlyBotData` keyed by room id, no cross-game shared state), so games are cleanly relocatable. That split would require a lobby/routing front door, cross-process socket handoff (direct connect or a Socket.IO Redis adapter), and moving lobby discovery (`shareCodes` + open-lobby scan) into a shared store. Deltas are per-room, so they travel with a game to whatever process hosts it — this work composes with a future split rather than conflicting with it.

---

## Feature 5 — Observability & paging (logs → monitors → on-call)

**Problem:** The app already emits structured, server-side logs (pino, one JSON line per event, `service:` tag, stable dot-namespaced `event` field — see `apps/client/src/server/logger.ts`), and the payment path deliberately logs its "silent black hole" failure modes. But **nothing turns those logs into an alert.** Several of the most dangerous failures are invisible by design — they return 200/4xx to the caller and never surface as a user complaint — so without paging, a misconfigured webhook secret or an unmatched paying customer can go unnoticed for days. This is the gap flagged in the pre-launch security/payments review.

**Goal:** Ship logs from BOTH apps to a queryable pipeline, define monitors keyed on the `event` field, and route them to an on-call channel with severity tiers — so money- and security-impacting failures page a human, while fail-open/by-design events stay on a dashboard.

**Severity tiers (map to the actual emitted events):**

- **P1 — page immediately (money / security, silent by design):**
  - `polar.webhook.signature_invalid` — webhook secret wrong/rotated; EVERY premium grant is silently failing (Polar does not retry 4xx). The single highest-value alert.
  - `polar.webhook.user_unmatched` — a subscription event couldn't be mapped to a user; a paying customer may never get premium.
  - `polar.webhook.profile_not_found` — resolved a user id that matched no profile row; premium not applied.
  - `polar.webhook.handler_error` (sustained) — handler throwing; retries failing too.
  - `billing.reconcile.polar_error` — the webhook's safety-net reconciliation is also broken.
- **P2 — notify (Slack/email), review within hours:**
  - A *spike* in `polar.webhook.handler_error`, or in the game server's premium/usage DB-read failures (currently logged as free-text: "isPremiumUser read failed…", "getRealtimeUsage read failed…"). Transient blips are expected; a sustained spike means an outage degrading the paywall.
- **P3 — dashboard only, no page:**
  - Fail-OPEN-by-design events (guest-gate / daily-limit read failures, stats write swallow). Worst case is a free extra game; chart them, don't page.

**Rough approach:**
- Pick a low-cost pipeline with built-in alerting (Better Stack / Axiom free tier to start; Datadog is the documented upgrade path — the logger already sets a `service:` facet for it). Point BOTH apps' stdout at it.
- Create the ~4 P1 monitors on the `event` values above, routed to a channel that reaches a phone (PagerDuty/Opsgenie, or Better Stack on-call for a solo operator). Alert on `event`, never on the free-text message (the message can change; the event name is the contract — this convention is already documented in `logger.ts`).
- **Absence/heartbeat alert:** error-paging can't catch total silence (Polar can't reach the endpoint at all — DNS, deploy, 500 loop). Add a "no `polar.webhook.applied` in N hours during active hours" absence alert, or an uptime check hitting the webhook URL. This is the one failure mode error-logs cannot surface.
- **Ship the game server's logs (`apps/server`, on Hetzner).** Unlike a managed platform, a bare box won't auto-collect stdout — needs a log shipper (the pipeline's agent, or configure pino's output to its ingest endpoint). Otherwise realtime-side errors (premium read failures, game crashes) never reach a monitor.

**Prerequisite cleanup (small, in-repo):** `apps/server`'s pino call sites log **free-text messages**, not the structured `{ event: "…" }` convention `apps/client` uses — so server-side failures can't be alerted on cleanly by event name. Normalize the server logger to the same `event`-keyed shape (e.g. `games.premium.read_failed`, `games.realtime_usage.read_failed`) before wiring monitors, so both apps share one alertable contract.

**Open questions:** which pipeline/pager (cost vs features at current volume); exact P1 escalation policy (how long before escalate, quiet hours vs money-critical always-on); what "sustained" means per event (rate threshold + window); whether to add light APM / event-loop-lag + RSS sampling here too (overlaps with Feature 4's "measure first").

---

## Feature 6 — Champion's privilege: season winner/loser taunt messages

**Problem / concept:** Give the seasonal leaderboard a social, retention-driving payoff. At the end of each season (one UTC calendar month), the **#1 player per scored mode** earns the right to write two short messages for the NEXT season of that mode: a **winner message** (shown to / celebrating the new season's leader) and a **loser message** (a good-natured taunt shown to the bottom of the board). It's a crown with a voice — a reason to fight for #1 beyond the ranking number, and a bit of personality carried mode-to-mode, month-to-month.

**Why it fits cleanly:** the hard part — deciding who won and who lost — is already solved. `archiveSeason` (packages/db/src/season-archival.ts) snapshots final standings into `season_placements` per `(userId, mode, season)`, with `placement = 1` for the winner and the max placement for the bottom. This feature reads those existing placements; it does not need any new ranking logic.

**Scope (spitball, tunable):**
- **Who earns the privilege:** `placement = 1` in `season_placements` for a given `(mode, season)` once that season is archived. Per mode — Battle Royale's champion and Race's champion each pick their own mode's messages. Duel is excluded (not a scored/leaderboarded mode, R2A.8).
- **What they set:** two short text messages (winner + loser), length-capped, for the UPCOMING season of that mode. A one-time authoring window after a season closes (e.g. the first N days of the new month, or until first set).
- **Where they show:** the winner message on the current season's leaderboard header / new leader's row; the loser message on the bottom-ranked row (or a "wooden spoon" callout). Exact placement TBD with the leaderboard UI.
- **Defaults & gaps:** if last season had no qualifying champion (empty board, or a mode with no games), fall back to a neutral default message so the UI always has copy.

**Hard requirements (safety — this is user-authored text shown to others):**
- **Moderation.** These strings are displayed to other players, so they need profanity/abuse filtering and likely a report + takedown path. This is the main risk of the feature and should be designed in from the start, not bolted on. Consider a server-side filter + a manual override/clear for admins.
- **Length + format limits.** Hard character cap, plain text only (no markup/links/HTML), server-validated — never trust the client length.
- **Server-authored ownership check.** Only the archived `placement = 1` user for that `(mode, prevSeason)` may set the next season's messages; enforced in a tRPC mutation scoped to `ctx.user.id`, not the client.

**Rough approach:**
- New table (Drizzle) for season messages, e.g. `season_messages(mode, season, winnerMessage, loserMessage, authorUserId, createdAt)`, keyed by `(mode, season)` — the season the messages are shown IN.
- tRPC: a mutation to set them (gated: caller must be the prior season's `placement = 1` for that mode, within the authoring window; moderated + length-validated); a query the leaderboard reads to render current-season messages.
- Reuse `season_placements` to resolve "who may author" and "who is the current loser to show the taunt against."
- Decide the authoring-window + archival trigger alongside Feature 4-adjacent season rollover (archival is currently trigger-agnostic — scheduled job or lazy-on-first-read).

**Open questions:** authoring window length and what happens if the champion never sets a message (default vs carry-over vs skip); whether messages are public to everyone or only shown to the relevant top/bottom players; moderation stack (automated filter vs. manual review vs. both) and the report/takedown flow; whether a premium tier interacts (e.g. longer messages / styling for premium); how ties for #1 resolve authoring rights (the ranking comparator already breaks ties deterministically down to `userId`, so there is always exactly one #1 — reuse that).

---

## Feature 7 — In-match items / power-ups

**Problem / concept:** Add a layer of in-match **items** players can deploy during a live game to change the flow — a new gameplay system across the realtime modes (Battle Royale, Race, and potentially Duels). The intent is a fun, tactical layer on top of raw guessing speed/accuracy: offensive items a player throws at opponents, defensive/utility items a player uses on themselves. Direction is a spitball and tunable.

**Concept (tunable):**
- **Utility (self):** a hint (reveal a letter / mark a known-absent letter), a short time extension, an extra guess, or a "peek" at the board.
- **Offensive (opponents):** obscure/scramble an opponent's keyboard briefly, inject a decoy/attack word, slow their input (reuses the Race "sluggish input" penalty mechanic as a weapon), or blur their tiles for a beat.
- **Acquisition:** how items are earned/held is the big open question — earned through play (streaks, round wins), granted per-match from a shared pool, or tied to Premium. Avoid pay-to-win: lean toward earned-through-play with Premium affecting cosmetics/convenience, not raw power.

**Why it's non-trivial (server-authoritative):** items mutate live match state and affect *other* players, so acquisition, inventory, and every item effect MUST be validated and applied **server-side** on the realtime server (`apps/server/src/games`), never trusted from the client. This mirrors how the games already own match state server-side (`matches` / `serverOnlyData` keyed by room id). An item use is a new client→server event; the server validates the player owns/can afford it, applies the effect to the authoritative room state, and the result flows out through the normal broadcast path.

**Feature interactions:**
- **Feature 4 (broadcast scaling):** item effects are per-player state changes, so they ride the same per-room delta model — another reason item state should live in the authoritative room snapshot, not a side channel. Any item field a client renders must be added to the trimmed DTO's keep-list (Feature 4's `Pick` projection) so it ships and diffs; a purely server-side item field stays off the wire by default.
- **Feature 1 (Premium):** decide early whether items touch the paywall at all. Strong recommendation: items are NOT a Premium power lever (pay-to-win risk); any Premium tie-in is cosmetic (item skins) or convenience only.
- **Feature 3 (Race) + Battle Royale:** the offensive "sluggish input" item is literally Race's existing anti-spam debounce repurposed as a targeted weapon — reuse that mechanic rather than inventing a new one.
- **Stats:** consider whether item usage/outcomes feed the per-mode stats aggregates (parallel to `battleRoyaleStats` / Race stats) or stay out of ranking entirely.

**Rough approach:**
- Define an item catalog as **config/schema** (id, kind: offensive/utility, effect params, cost/rarity) — same config-driven spirit as the Race rules, so items can be tuned without code changes.
- Server-authoritative item engine in `apps/server`: validate ownership/affordability, apply effect to the room's authoritative state, enforce cooldowns/targeting rules. New `item:use` socket event in; effects surface through the existing update/broadcast tick.
- Client UI for an item tray/inventory, targeting (pick an opponent for offensive items), and clear feedback when an item hits you (so a scrambled keyboard reads as an attack, not a bug).
- Persistence only if items are earned/held across matches — new Drizzle table for per-user inventory; purely per-match pools need no schema.
- Anti-abuse: rate-limit item use, validate targets are live players in the same room, and make every effect time-bounded so a disconnect can't leave a player permanently debuffed.

**Open questions:** acquisition model (earned vs per-match pool vs Premium) and the pay-to-win line; which modes get items (all realtime modes, or Battle Royale/Race only, Duels excluded like it is for scoring?); do items persist across matches or reset each game; targeting rules (random opponent vs chosen vs AoE) and whether bots can hold/use items; cooldowns and max inventory size; whether item outcomes count toward stats/leaderboard; accessibility of disruptive effects (reduced-motion / don't make an effect indistinguishable from a real malfunction).

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

**Feature 4 — Scale the realtime broadcast** (trimmed delta broadcasts + strain telemetry; full spec in `.kiro/specs/realtime-broadcast-scaling/`) is demand-driven rather than fixed in this order: schedule it as real-player concurrency starts stressing a single process. The strain telemetry can land independently and early (it feeds Feature 5 and tells you when to size up the server); the delta work pairs naturally with Feature 2 (mobile clients benefit most from reduced bandwidth) and should land before any per-game process/EC2 split, since it lowers per-connection cost no matter where the process runs. If items (Feature 6) ship around the same time, land the trim/delta shape first so item fields start out in the trimmed DTO.

**Feature 5 — Observability & paging** should land BEFORE real (non-sandbox) payments go live — i.e. as part of or just ahead of Feature 1's premium launch. Its P1 alerts guard exactly the silent payment-failure modes Feature 1 introduces into production. The small prerequisite (normalizing the game server's logs to the `event`-keyed shape) can be done any time and is independent of the rest.

Beta messaging is live from Feature 3 through the launch of Feature 1.
