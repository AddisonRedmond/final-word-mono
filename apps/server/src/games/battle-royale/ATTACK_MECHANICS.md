# Battle Royale — Attack Mechanics

This document describes the attack system in Battle Royale: how it works today,
the exact rules and tuning values, where each piece lives in the code, and a set
of proposed improvements for competitive depth.

> Scope note: everything under **Current Behavior** reflects the code as
> implemented (see file references). Everything under **Proposed Improvements**
> is design, not yet built, and is clearly marked as such.

---

## 1. Overview

Battle Royale is a real-time, server-authoritative survival race for up to
`MAX_PLAYERS = 99` (humans + bots). Each player solves their own stream of
5-letter words against a draining **life** timer. Solving words buys life;
running out of life eliminates you. Last player standing wins (a 10-minute hard
cap, `MATCH_TIME_LIMIT_MS`, resolves by score if time runs out).

**The attack system is the only player-to-player interaction.** When you solve
your current word, you may launch an attack at another player. An attack does
two things to the target:

1. **Queues your solved word onto their board** — they must solve it before
   returning to their own random words.
2. **Reveals scrambled letters on their board** — cosmetic/however-distracting
   hints that get injected into their reveal display queue.

Attacking is what turns a parallel race into a competitive fight.

---

## 2. Current Behavior

### 2.1 Launching an attack

- An attack is produced as a **side effect of a correct guess**. There is no
  separate "attack" action — solving your word *is* the attack trigger.
- The attack only fires if your **current word is not itself an attack word**
  (you can't chain an attack off a word someone attacked you with). This is
  gated by `currentWordIsAttack`.
- The attacker chooses a **target mode** via the on-screen picker: `first`,
  `last`, or `random`. (A direct player id is also supported by the server but
  the UI currently exposes only the three modes.)

Code:
- Trigger + wiring: `handlers.ts` → `socket.on("guess", ...)`, inside the
  `result.isMatch` branch.
- Target resolution: `determineTarget()` in `logic/battle-royale.ts`.
- Attack application: `applyAttack()` in `logic/battle-royale.ts`.
- Attack-word reward (surviving an incoming attack): `applyCorrectGuessReward()`
  in `logic/battle-royale.ts`.
- UI target picker: `components/game-components/attack-picker.tsx`.
- Bonus/life preview: `components/game-components/bonus-preview.tsx`.

### 2.2 Target selection (`determineTarget`)

Targets are chosen from **active, non-self** players. The resolver prefers
players whose attack queue still has room (`isAttackable`) so a maxed-out queue
doesn't silently swallow attacks:

| Mode     | Picks                                                            |
| -------- | --------------------------------------------------------------- |
| `first`  | Highest `life` (closest to winning), attackable preferred       |
| `last`   | Lowest `life` (closest to elimination), attackable preferred    |
| `random` | Random among attackable actives, else any active                |
| id       | That specific player if active + attackable, else random        |

Fallbacks: if the preferred (attackable) pool is empty it falls back to the full
active pool; if there are no active opponents it returns `""` (no attack).

### 2.3 What an attack does to the target (`applyAttack`)

Given a successful attack with `guessedWord` (the attacker's solved word) and
`guessCount` (how many attempts the attacker took):

1. **Attacker attribution** — `target.lastAttackerName` is set so the results
   screen can show "Eliminated by X".
2. **Queue the attack word** — if the target's attack queue has room
   (`queue.length < Max_Attack_Words`, i.e. `< 3`), the attacker's word is
   pushed onto `targetServerData.queue`, and the attacker name is pushed onto
   `attackerQueue` in lockstep so the per-word badge shows the right attacker
   when that word is later consumed.
   - If the queue is **full**, the word is **not** queued, but letter reveals
     still happen.
3. **Reveal letters** — the number of letters revealed scales with how fast the
   attacker solved:

   | Attacker's `guessCount` | Letters revealed |
   | ----------------------- | ---------------- |
   | ≤ 3                     | 2                |
   | 4–7                     | 3                |
   | ≥ 8                     | 4                |

   Revealed positions are chosen via a Fisher-Yates shuffle over the word's
   indices, then pushed into the target's `display_queue` (capped at 4 entries).
   When the display queue is already full, the system instead *removes* letters
   from the entries that currently reveal the most, spreading the pressure.

### 2.4 Attack queue limits

- `Max_Attack_Words = 3` — the hard cap on queued attack words per player.
- Enforced both at target selection (`isAttackable`) and at application
  (`attackQueueIsFull`).

### 2.5 Receiving an attack word

- When a player finishes their current word, the next item is pulled from their
  `queue`. If one exists, `currentWordIsAttack` becomes `true` and
  `currentWordAttackerName` is set from `attackerQueue` for badging.
- Solving an **attack word** grants a flat `ATTACK_WORD_BONUS_MS = 10_000` (10s)
  of life — *not* the normal guess-based bonus — and does **not** let the
  survivor launch an attack of their own.

### 2.6 Life / reward tuning (context for attacks)

Attacks matter because life is the scarce resource. Normal correct guesses award
life based on attempt count (`lifeMap` / `getGuessBonusMs` in
`packages/shared/src/battle-royale.ts`):

| Guesses to solve | Life awarded |
| ---------------- | ------------ |
| 1–2              | 60s          |
| 3–4              | 45s          |
| 5–6              | 30s          |
| 7–8              | 15s          |
| 9+               | 15s (floor)  |

- `ATTACK_WORD_BONUS_MS = 10s` — flat, for surviving an incoming attack word.
- Life is clamped to `Max_Life_Timer = 90s` ahead of now.
- `MATCH_TIME_LIMIT_MS = 10min` — hard cap; score tiebreak then applies.

### 2.7 Bots and attacks

Bots use the identical `applyAttack` / `determineTarget` path, so bot attacks are
mechanically indistinguishable from player attacks. Bot target mode defaults to
`"random"`. See `logic/battle-royale-bots.ts`.

---

## 3. Current Mechanics Summary (quick reference)

| Property                | Value / Rule                                      | Source |
| ----------------------- | ------------------------------------------------- | ------ |
| Attack trigger          | Correct guess on a non-attack word                | `handlers.ts` |
| Target modes (UI)       | first / random / last                             | `attack-picker.tsx` |
| Target modes (server)   | first / last / random / specific id               | `determineTarget` |
| Max queued attack words | 3 (`Max_Attack_Words`)                            | `logic/battle-royale.ts` |
| Letters revealed        | 2 / 3 / 4 by attacker speed (≤3 / 4–7 / ≥8)       | `applyAttack` |
| Reveal display cap      | 4 entries in `display_queue`                      | `applyAttack` |
| Survive-attack bonus    | +10s flat (`ATTACK_WORD_BONUS_MS`)                | `shared/battle-royale.ts` |
| Can attack off an attack word? | No (`currentWordIsAttack` gate)            | `applyCorrectGuessReward` |
| Attribution             | `lastAttackerName`, per-word `attackerQueue`      | `applyAttack` |

---

## 4. Proposed Improvements (idea menu — not yet implemented)

These address the biggest competitive gap: at high level, play converges on one
dominant strategy ("always hit first place") with little counterplay. The goal
is more decisions, more counterplay, and more risk/reward.

> **This section is an idea menu.** The **decided direction** is in §5
> ("Tetris 99 but Wordle"), which promotes, reworks, or supersedes several
> items below (e.g. shield, reflect, targeting depth, overkill protection).
> Read §5 for what we actually intend to build; §4 is kept as the broader
> option space.

### 4.1 Counterplay: defense and interception

- **Shield / block charge** — let a player bank a shield (earned by, e.g., a
  1–2 guess solve) that absorbs the next incoming attack word. Adds a reason to
  solve fast beyond life gain.
- **Reflect** — solving an attack word in 1 guess bounces it back to the sender
  instead of (or in addition to) the current flat bonus. Rewards clutch defense.
- **Cleanse** — spend banked life to clear one queued attack word. Introduces a
  life-vs-safety tradeoff.

### 4.2 Attack variety (beyond "queue a word + reveal letters")

- **Letter lock** — temporarily disable a key on the target's keyboard for N
  seconds.
- **Fog** — hide the target's previous-guess feedback (colors) for their next
  guess.
- **Time drain** — a direct small life subtraction instead of a word, as an
  alternative attack choice with its own cost.

Each alternative should be a *choice* at attack time (pick effect + target),
turning the attack picker into a small tactical decision rather than target-only.

### 4.3 Risk/reward on attacking

- **Attack cost** — launching an attack costs a sliver of your own life or a
  short cooldown, so spamming attacks has a tradeoff versus banking time.
- **Overkill protection** — diminishing returns when many attackers pile the
  same target, so dog-piling first place isn't strictly optimal.
- **Bounty** — eliminating the current leader grants a reward (life/shield),
  making "hunt first" high-risk high-reward rather than free.

### 4.4 Targeting depth

- Expose the server-supported **specific-player target** in the UI (click an
  opponent to target them) with the queue-full fallback already implemented.
- **Smart "first/last"** that accounts for queue pressure already exists; extend
  with a "most-attacked" or "about-to-win" heuristic surfaced to the player.

### 4.5 Readability / feedback (needed before adding depth)

- Clear in-game indication of **who is attacking you right now** and **how many
  words are queued** against you (data exists: `attackerQueue`,
  `currentWordAttackerName`, `queue.length`).
- Attack log / kill feed so players understand cause and effect — essential for
  a competitive meta to form and for clip-worthy moments.

### 4.6 Tuning levers to expose

Centralize these as named constants (several already live in
`packages/shared/src/battle-royale.ts`) so balance can be iterated without code
spelunking: `Max_Attack_Words`, reveal-count thresholds, `ATTACK_WORD_BONUS_MS`,
plus any new shield/cooldown/cost values.

---

## 5. Prioritized Design — "Tetris 99 but Wordle" (not yet implemented)

**Design goal:** make the mode competitive the way Tetris 99 is, instead of
devolving into "everyone attacks whoever is in first." The current attack system
has one structural flaw: **attacks are risk-free, one-way damage, and the only
reason to pick a target is life standing.** That funnels all fire onto first
place and gives the leader no counterplay.

Tetris 99 avoids this with two mechanics we are adopting (adapted to Wordle):

1. **A pending attack with a visible timer that the defender can cancel before
   it lands** — incoming garbage sits in a delayed queue and clearing your own
   lines cancels it, with surplus bouncing back to the attacker
   ([shapes.inc](https://shapes.inc/games/cheatsheets/tetris-99-cheatsheet),
   [TetrisWiki — Garbage](https://tetris.wiki/Garbage)). This makes attacking a
   strong solver *risky*, which breaks the first-place pile-on.
2. **Threat tied to kills, not standing ("badges")** — KO'ing players raises your
   attack power, and attacking a power-holder lets you steal some of it
   ([TetrisWiki — Tetris 99](https://tetris.wiki/Tetris_99)). The dangerous
   player becomes "whoever is racking up kills," and targeting modes let fire be
   aimed at *them* rather than always at first place.
   *(Content rephrased for licensing compliance.)*

> See §5.5 for why the earlier ideas (life multiplier for the leader, bigger
> queue, passive index reveal) were superseded — they didn't address the
> pile-on, and in two cases made it worse.

### 5.1 Pending attack with a cancel timer (the core change)

**Decision:** an attack word does **not** land on the target instantly. It
arrives as a **pending attack** with a visible countdown. While it is pending the
defender can **cancel/offset it through their own play** before it is applied to
their active queue.

**Lifecycle of an incoming attack:**
1. Attacker solves → an attack word becomes **pending** on the target with a
   countdown (`ATTACK_PENDING_MS`). The client shows the word slot filling /
   color-shifting as it nears landing (mirrors Tetris's "active set changes
   colour as it nears spawning").
2. **Before the timer expires**, the defender can neutralize it (see 5.2). A
   neutralized pending attack never enters their real `queue`.
3. **If the timer expires** uncancelled, the pending word is committed to the
   defender's `queue` exactly as attacks work today (subject to
   `Max_Attack_Words`).

**Why a timer (not instant):** the delay is the entire source of counterplay and
tension. It gives the defender a window to react, makes *fast* defensive solving
valuable, and lets a besieged leader fight back instead of just absorbing damage.

**Implementation touch-points:**
- New per-player **pending list** separate from `queue` (raw words today):
  `{ word, attackerId, attackerName, landsAt }[]`. Store server-side alongside
  `playerData` / bot data.
- A sweep (reuse the existing `gameTimer` tick in `handleStartGame`, which
  already runs every 1s — or a finer interval for snappier timers) moves expired
  pendings into `queue` and emits a `lobby:update`.
- `applyAttack` (`logic/battle-royale.ts`) pushes to the **pending list** instead
  of directly to `queue`.
- Client: render pending words with their countdown near the active board
  (`guess-container.tsx` / `bonus-preview.tsx` area).

### 5.2 Cancel / offset by solving (defender counterplay)

**Decision:** the defender neutralizes pending attacks by **solving words**.
Each correct solve removes/offsets pending attack load before it lands. If the
defender out-solves the incoming pressure, the **surplus bounces back** to the
most recent attacker as a new pending attack against *them*.

**Model (Tetris cancelling, adapted):**
- Track incoming **pending count** and outgoing **offset** generated by the
  defender's solves. A correct guess produces offset (scaled by solve speed — a
  1–2 guess solve offsets more, consistent with the existing `getGuessBonusMs`
  speed tiers).
- Offset first **cancels** pending attacks (newest or oldest — decide; Tetris
  cancels against the active/incoming set first).
- Any **leftover offset** after all pendings are cancelled is **sent back** to
  the last attacker as a pending attack (the "counterattack surplus"
  [TetrisWiki — Garbage](https://tetris.wiki/Garbage)). Cap the bounce so chains
  can't explode.

**This is the decided evolution of the old "passive index reveal" idea** — same
intent (active play defends), but modeled as cancel-and-bounce instead of a slow
letter leak, because bounce-back is what creates attacker risk.

**Implementation touch-points:**
- Hook into the `result.isMatch` branch in `handlers.ts` (and the bot correct
  path) to compute offset and resolve it against the pending list before awarding
  the normal reward.
- Reuse solve-speed tiers (`currentWordGuesses` → bonus) for offset sizing so it
  stays consistent with life rewards.
- Bounce = create a pending attack on the attacker via the same path as 5.1.

### 5.3 Attack power from kills + stealing ("badges")

**Decision:** eliminations grant **attack power**. Higher power = your attacks
land as **stronger pending attacks** (e.g. more pending words, longer land timer
for the victim, or harder-to-cancel). Attacking a high-power player and getting
value lets you **steal** a portion of their power. This ties threat to
**aggression**, not to being in first place.

**How it reshapes targeting (see 5.4):** the scary player is the kill-leader, so
a "target highest power" mode (Tetris's "Badges") points fire at aggressors, and
an "attackers" mode auto-targets whoever is currently attacking you — enabling
immediate retaliation. The leader-by-survival is no longer the default sink.

**Relationship to the old life-multiplier idea:** this replaces it. A life
multiplier rewarded whoever was *already* solving fastest (usually first place),
making the pile-on worse. Attack power instead rewards *kills* and is
*stealable*, so leads are contestable.

**Implementation touch-points:**
- Add `attackPower` + `kills` to player display/server data.
- Requires real **kill attribution** (still the hard part — see 5.6): credit the
  attacker whose pending/queued word was responsible when a player expires.
- `applyAttack` scales pending strength by the attacker's `attackPower`.
- On a credited kill (or a landed attack on a powerful target), transfer a
  fraction of power to the attacker.
- Surface power/kills in UI and the kill feed (§4.5).

### 5.4 Targeting modes (replaces first/random/last)

**Decision:** adopt Tetris 99's four-mode targeting so fire can be aimed
tactically rather than always at first place
([shapes.inc](https://shapes.inc/games/cheatsheets/tetris-99-cheatsheet)):

| Mode (proposed)   | Targets                                                   | Wordle mapping |
| ----------------- | --------------------------------------------------------- | -------------- |
| **KO** (finish)   | Players closest to elimination (lowest life)              | ≈ current `last` |
| **Attackers**     | Whoever currently has a pending attack on you (retaliate) | new — needs pending-source tracking |
| **Random**        | Spread across random opponents                            | ≈ current `random` |
| **Power/Badges**  | Highest `attackPower` / most kills                        | new — needs 5.3 |

**Implementation touch-points:**
- Extend `determineTarget` (`logic/battle-royale.ts`) with `attackers` and
  `power` modes; `KO`/`random` map onto existing `last`/`random`.
- `attackers` mode reads the pending list's `attackerId`s (from 5.1).
- Update the UI picker (`attack-picker.tsx`) from 3 buttons to 4 modes.

### 5.5 Superseded ideas (kept for the reasoning trail)

These were documented earlier, then superseded once the goal was clarified as
"Tetris 99 but Wordle." They are recorded so the reasoning isn't lost:

- **Growing life multiplier for kills** → *superseded by 5.3 (attack power).* The
  multiplier scaled the life bonus, which is largest for the fastest solver —
  usually first place — so it **rewarded the player already winning** and made
  the pile-on worse. Attack power ties strength to kills and is stealable.
- **Raise `Max_Attack_Words` 3 → 4** → *superseded / reversed.* The complaint is
  that queued words are **too strong**; a bigger queue makes one-way damage
  stronger. Under the new model the cap still matters, but as a *cancelable
  buffer* (5.1/5.2), not a bigger hammer. Revisit the exact cap during tuning.
- **Passive index-match reveal** → *folded into 5.2.* Same intent (active play
  defends) but reworked as cancel-and-bounce, which creates attacker risk; a
  passive letter leak does not.
- **Earned shield** → *still optional, lower priority.* A banked charge that
  absorbs one incoming attack. Partially redundant with cancel/offset (5.2);
  revisit only if defense still feels too weak after 5.1–5.4.

### 5.6 Kill attribution (shared prerequisite for 5.3)

The server does **not** currently credit a specific killer. Elimination happens
in the life-expiry sweeps — `gameTimer` in `handleStartGame`
(`logic/battle-royale.ts`) for humans and the bot ticker
(`logic/battle-royale-bots.ts`) for bots — because `now >= player.life`, not
because "player X killed them." `target.lastAttackerName` exists for the results
screen but is a display name set on *every* attack, not a stable id for the fatal
blow.

To support attack power (5.3), store a stable **attacker id** with each
pending/landed word and, at the moment of expiry, credit the attacker whose word
most recently landed within `KILL_CREDIT_WINDOW_MS`.

### 5.7 New tuning constants (to centralize in `packages/shared`)

| Constant (proposed)       | Meaning                                                      |
| ------------------------- | ----------------------------------------------------------- |
| `ATTACK_PENDING_MS`       | Countdown before a pending attack lands (cancel window)     |
| `OFFSET_PER_SOLVE`        | Pending load a solve cancels, by solve-speed tier           |
| `MAX_BOUNCE`              | Cap on surplus offset bounced back to an attacker           |
| `ATTACK_POWER_PER_KILL`   | Attack power gained per credited kill                       |
| `ATTACK_POWER_STEAL_PCT`  | Fraction of a target's power stolen on a landed/killing hit |
| `KILL_CREDIT_WINDOW_MS`   | Max time since a word landed to credit a killer             |
| `Max_Attack_Words`        | Committed-queue cap — revisit under the cancelable model     |

---

## 6. Open Questions

- Should surviving an attack word grant guess-based life (like normal words)
  instead of a flat 10s, to reward hard-fought defenses?
- Should attack words count toward `correctGuesses` for the end-of-match
  score tiebreak? (They currently do via `applyCorrectGuessReward`.)
- Do we want elimination *order* recorded? Stats placement currently
  approximates it (see `stats.ts`); real attack-driven kills would be more
  meaningful with true ordering.

---

## 7. Roadmap / Build Order

The agreed sequencing. Each phase has a dependency reason, not just a nice-to-have
order.

1. **Game modes + attack rework (§5)** — build the Tetris-99-style attack loop
   (pending/cancel/bounce + attack power). Ship a **minimal playtest UI
   alongside the logic** (visible pending words with countdowns, who's attacking
   you) — the cancel-timer feel can only be tuned by playing it, not on paper.
2. **Responsive / polished UI** — treat the 99-board mobile view as a *design*
   decision (condensed opponent view, not 98 tiny boards), not a pure styling
   pass.
3. **Ranked / MMR + progression (§8)** — the retention "grind." Comes before
   Polar because it is likely the thing Polar attaches to (season pass, ranked
   tiers) and must be validated as fun first.
4. **Polar** — monetization last, on top of a loop proven sticky. **Decide the
   monetization model before the UI phase**, since cosmetics vs. season-pass vs.
   gameplay boosts each pull in different earlier systems. Avoid anything
   pay-to-win in a competitive mode.

**Hard prerequisite for ranked having value:** matches must be real, skill-sorted
players. Today lobbies fill with bots (`bot0…botN`) and losing to a bot counts as
2nd (`stats.ts`). Rating against a mostly-bot field measures bot RNG, not skill.
Resolve via enough concurrency and/or skill-calibrated bots + MMR-aware
matchmaking **before** charging for ranked.

---

## 8. Ranked / Progression Design (deferred — build before Polar)

Decided direction for the competitive grind, recorded here so it survives until
the ranked phase. **Not yet built.** Two layers that do different jobs:

- **Seasonal rating ladder** = the competitive grind (skill, resets, climb). The
  retention engine; what Polar should attach to.
- **Cumulative achievement tracks** = the casual grind (always-climbing numbers:
  accuracy tiers, total kills, daily play streak via existing `lastPlayedAt`).

### 8.1 Why not rank on existing stats

`battleRoyaleStats` is a lifetime aggregate and must stay the **career profile**,
not the ladder:
- `averagePlacement` is a never-resetting running average — after many games it
  freezes and *punishes* playing more. The opposite of a grind.
- No rating/MMR → ranking by placement/wins rewards hours, not skill.
- Placement is approximate (no true elimination order; losing to a bot = 2nd).

Add a dedicated rating layer on top; leave the existing table alone.

### 8.2 Recommended tables (three, separating three concerns)

Follow project conventions: Drizzle owns structure (`packages/db/src/schema.ts`,
`pnpm db:generate`); RLS/realtime tracked separately in `supabase/migrations/`.

1. **`br_seasons`** — resettable windows (one active at a time). Columns:
   `id`, `name`, `startsAt`, `endsAt`, `isActive`, `createdAt`.
2. **`br_season_ratings`** — the ladder; one row per `(seasonId, userId)`
   composite PK (mirrors `duelParticipants`). Columns: `rating` (`real`, default
   1000), `peakRating`, optional derived `tier`, `gamesPlayed`, `isPlacement`
   (provisional swing), `wins`, `kills`, `bestPlacement`, `currentWinStreak`,
   `lastPlayedAt`, `updatedAt`. Single-table read for leaderboards.
3. **`br_match_results`** — append-only per-match history (the current gap).
   Columns: `id`, `seasonId`, `userId`, `lobbyId`, `placement`, `kills`,
   `totalGuesses`, `correctGuesses`, `ratingBefore`, `ratingAfter`,
   `ratingDelta`, `createdAt`. Indexes on `(userId, seasonId)` and `lobbyId`.
   Enables match history UI, rating audits, cheat/boost detection, and
   recomputation if the formula changes.

### 8.3 Open decisions for the ranked phase

- **Store vs. derive `tier`** — derive from rating thresholds in code (rebalance
  without migration) unless freezing end-of-season tier for rewards.
- **Rating formula** — for 99 players, Elo-pairwise is overkill; use a
  **placement-points curve** (top 1 big gain → bottom third loss) with a larger
  K-factor while `isPlacement`. Once attack power lands, add a small **kill
  bonus** so aggression also moves rank (keeps attack + ranked coherent).
- **Integration point** — `persistBattleRoyaleStats` (`stats.ts`) already runs
  once per finished match with final placements: look up active season → read
  current ratings → compute deltas → write `br_match_results` + upsert
  `br_season_ratings`, while keeping the existing lifetime upsert.
