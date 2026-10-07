# Requirements Document — Retention Foundation (Phase 1)

## Introduction

Final Word's long-term retention depends less on new core gameplay and more on
progression, competition, and social relationships built around a simple core
game. This spec covers **Phase 1 — the Retention Foundation**: the stats
infrastructure, a player statistics page, a global leaderboard, monthly
competitive seasons (archived, never reset), duel rematch, and duel history /
head-to-head records.

The guiding product loop:

> **Stats** (see progress) → **Leaderboard / Seasons** (something to compete
> for) → **Duels / Rivalries** (people to compete against)

This document defines WHAT the Phase 1 systems must do. The companion
`design.md` defines HOW — and intentionally designs the **database schema in
full first**, since the schema is the keystone every later feature builds on
and is the hardest thing to change after the fact.

---

## Scope

**In scope (Phase 1):**

1. Stats infrastructure — a mode-extensible, season-aware stats model.
2. Player statistics page (`/stats`).
3. Global leaderboard (`/leaderboard`).
4. Monthly competitive seasons — archival + per-user placement history.
5. Duel rematch — one-click re-challenge of the same opponents.
6. Duel history / head-to-head — per-opponent W/L/D records and rivalry streaks.

**Out of scope (later phases, but the schema must not block them):**

- Ranked/MMR mode, additional game modes, rotating-mode system, daily challenge.
- Achievements, advanced analytics, seasonal rewards/badges, profile cosmetics.
- Public `/road-map` and `/changelog` pages (built after the data foundation).
- Premium gating of advanced stats (schema should allow it; enforcement later).

---

## Glossary

- **Mode**: A distinct game type that produces stats. Today: `battle_royale`,
  `race`, `duel`. Reserved for the future: `classic` (not yet implemented — the
  model must accept it without a schema change).
- **Lifetime_Stats**: A player's all-time aggregate for a mode. Never resets.
- **Season**: A named competitive period, one calendar **month in UTC**,
  identified by a `YYYY-MM` key (e.g. `2026-10`).
- **Seasonal_Stats**: A player's aggregate for one mode within one season.
- **Season_Archive**: A completed season's final, immutable standings, retained
  permanently so historical placements can always be shown.
- **Placement**: A player's rank within a season's leaderboard (1 = best).
- **Leaderboard**: An ordered ranking of players by a mode's ranking metric,
  for the current season (default) or a past archived season.
- **Ranking_Metric**: The value a leaderboard sorts by for a mode (see design;
  e.g. wins, then win-rate, then average solve, with explicit tiebreakers).
- **Duel_Result**: The recorded outcome of one completed duel for stats and
  head-to-head purposes (winner, per-participant success/guesses/time).
- **Rematch**: A new duel created from a completed duel, reusing the same set of
  participants, with a fresh secret word.
- **Head_to_Head** (H2H): The directed record between the current user and one
  other player across all their completed duels: wins, losses, draws, current
  streak, and recent results.
- **Rivalry_Streak**: The count of consecutive duel outcomes with the same
  result between two players, ending at the most recent completed duel.
- **Stats_Pipeline**: The server-side write path that records a completed
  game's outcome into the stats tables (lifetime + seasonal).
- **isRealPlayer**: The existing eligibility predicate (a UUID check); bots are
  excluded from stats. Guests are included.

---

## Requirements

### Requirement 1: Stats Infrastructure (Foundation)

**User Story:** As the product, I want a durable, mode-extensible, season-aware
stats model so that every later retention feature (stats page, leaderboard,
seasons, head-to-head) reads from one consistent foundation.

#### Acceptance Criteria

1. THE stats model SHALL record statistics per `(userId, mode)` for lifetime
   aggregates and per `(userId, mode, season)` for seasonal aggregates.
2. THE stats model SHALL support the modes `battle_royale`, `race`, and `duel`,
   AND SHALL accept a new mode value (e.g. `classic`) WITHOUT a schema change.
3. THE Stats_Pipeline SHALL only persist stats for players where
   `isRealPlayer(userId)` is true; bots SHALL be excluded; guests SHALL be
   included.
4. WHEN a game of any supported mode completes for a real player, THE
   Stats_Pipeline SHALL update that player's Lifetime_Stats AND their
   Seasonal_Stats for the current UTC-month season in the same operation.
5. THE Stats_Pipeline SHALL be idempotent per completed game per player: a given
   game outcome SHALL be counted exactly once for a given player.
6. THE Season assignment for a completed game SHALL be derived from the game's
   completion time in UTC (`YYYY-MM`), consistent across client reads and server
   writes (one shared helper).
7. THE stats model SHALL preserve the existing `battle_royale_stats` and
   `race_stats` behavior (lifetime aggregates) so no current data or write path
   is lost by the migration.
8. THE Stats_Pipeline SHALL NOT throw into the game loop; any persistence
   failure SHALL be logged and swallowed (matching the current pattern).

### Requirement 2: Player Statistics Page

**User Story:** As a player, I want a page that shows how I'm doing and how I'm
improving so that I have a reason to keep playing.

#### Acceptance Criteria

1. THE application SHALL provide a `/stats` page reachable from the navbar for a
   registered (non-guest) user.
2. THE `/stats` page SHALL display, per mode the user has played: games played,
   wins, losses, draws, win rate, current streak, and best streak.
3. WHERE a mode records solve data, THE `/stats` page SHALL display average
   guesses and, where available, average/fastest solve time.
4. THE `/stats` page SHALL let the user view **Lifetime** stats and **current
   season** stats, clearly distinguished.
5. THE `/stats` page SHALL display the user's current-season placement per mode
   where a leaderboard exists for that mode.
6. WHILE stats are loading, THE `/stats` page SHALL show a loading state; WHEN a
   user has no games in a mode, THE page SHALL show an empty state rather than
   zeros that imply a bug.
7. WHERE a stat is designated advanced/premium (design-defined), THE page SHALL
   render it gated behind premium status without breaking the free layout.
8. THE `/stats` page SHALL be read-only and SHALL NOT expose any other player's
   private data beyond what the leaderboard already shows publicly.

### Requirement 3: Global Leaderboard

**User Story:** As a competitive player, I want a global leaderboard so that I
have something to climb and a reason to return.

#### Acceptance Criteria

1. THE application SHALL provide a `/leaderboard` page reachable from the navbar.
2. THE `/leaderboard` SHALL rank players for a selected mode by that mode's
   Ranking_Metric with deterministic tiebreakers (design-defined), 1 = best.
3. THE `/leaderboard` SHALL default to the **current season** and SHALL allow
   selecting a **past archived season**.
4. THE `/leaderboard` SHALL be paginated or capped to a top-N with the current
   user's own row surfaced even when outside the visible range.
5. THE `/leaderboard` SHALL display, per ranked player: placement, display name,
   and the mode's headline metrics.
6. THE `/leaderboard` SHALL only include real players (guests included, bots
   excluded) who have at least one qualifying game in the selected season/mode.
7. THE `/leaderboard` SHALL be available to free players; WHERE expanded columns
   are premium (per the existing roadmap), those columns SHALL be gated without
   hiding the core ranking from free users.

### Requirement 4: Monthly Competitive Seasons

**User Story:** As a player, I want monthly seasons that archive rather than
wipe so that I can build an ongoing competitive track record.

#### Acceptance Criteria

1. THE system SHALL define a season as one UTC calendar month, keyed `YYYY-MM`.
2. WHEN a new UTC month begins, Seasonal_Stats SHALL accumulate under the new
   season key automatically, WITHOUT deleting or resetting any prior season's
   data.
3. THE system SHALL retain every completed season's standings permanently as a
   Season_Archive; historical placements SHALL remain queryable indefinitely.
4. THE system SHALL expose a per-user seasonal placement history, e.g.
   "October 2026 — #47", "November 2026 — #12", ordered by season.
5. THE archival of a completed season SHALL be deterministic and reproducible
   from the retained Seasonal_Stats (archiving records final placement; it does
   not discard the underlying aggregates).
6. THE current season's leaderboard SHALL be computed live from Seasonal_Stats;
   a past season's leaderboard SHALL be read from its Season_Archive.
7. No destructive reset of player progress SHALL occur at any season boundary.

### Requirement 5: Duel Rematch

**User Story:** As a player who just finished a duel, I want to re-challenge the
same opponents in one click so that a single game can turn into a rivalry.

#### Acceptance Criteria

1. WHERE a duel is completed and the current user participated, THE duel result
   UI SHALL offer a "Rematch" action.
2. WHEN the user triggers a Rematch, THE server SHALL create a NEW duel with the
   same participant set as the source duel and a fresh random secret word.
3. THE Rematch SHALL be subject to the same creation rules as a normal duel
   (friendship checks, active-duel cap, invitee cap per the user's tier).
4. WHERE a Rematch would exceed the user's active-duel cap, THE server SHALL
   reject it with a clear, tier-aware message (consistent with `sendDuel`).
5. THE system SHALL record the linkage from a Rematch duel back to the duel it
   was created from, so a rivalry can be traced as a chain.
6. WHEN a Rematch is created, THE Duels_Page SHALL surface it the same way a
   normal new duel appears (active list / invitations).
7. A Rematch SHALL only reuse participants who are still valid opponents
   (still friends); IF a former participant is no longer eligible, THE server
   SHALL reject with a clear message rather than silently dropping them.

### Requirement 6: Duel History / Head-to-Head

**User Story:** As a player, I want to see my record against each person I've
dueled so that rivalries feel real and pull me back.

#### Acceptance Criteria

1. THE system SHALL record a Duel_Result for every completed duel sufficient to
   derive per-opponent records (who won, each participant's success/guesses/
   time, draw status).
2. THE system SHALL expose, for the current user and a given other player, a
   Head_to_Head record: total games, the current user's wins, the opponent's
   wins, draws.
3. THE Head_to_Head SHALL include a Rivalry_Streak and a short list of recent
   results (most recent first), e.g. "Sarah has won the last 2 games."
4. THE system SHALL expose a duel history list for the current user: completed
   duels with opponent(s), outcome, date, newest first.
5. Head_to_Head and duel history SHALL only reflect duels the current user
   actually participated in; THE system SHALL NOT expose other players'
   unrelated duels.
6. THE Head_to_Head SHALL be reachable from a completed duel's result view and/
   or the duel history list, alongside the Rematch action (R5), to make
   "see our record → rematch" a single flow.
7. Deleting a friendship SHALL NOT delete historical Duel_Results; past records
   SHALL remain for both players.

---

## Non-Functional / Cross-Cutting Requirements

### Requirement 7: Data Integrity & Migration Safety

1. ALL table structure SHALL be owned by Drizzle and introduced via generated
   migrations under `packages/db/drizzle` (never ad-hoc SQL for table shape).
2. Supabase-specific concerns (RLS, realtime publication, replica identity)
   SHALL be tracked as separate SQL under `supabase/migrations`, applied after
   the Drizzle tables exist — matching the current project convention.
3. The migration SHALL be additive and backward-compatible: existing
   `battle_royale_stats` and `race_stats` rows and write paths SHALL continue to
   function throughout the transition (no data loss, no breaking rename without
   a backfill).
4. The single source of truth for season keys, mode identifiers, and tier
   limits SHALL live in `packages/db` so client and server cannot drift.

### Requirement 8: Privacy, Eligibility & Fairness

1. Stats and leaderboards SHALL exclude bots and SHALL never leak a duel's
   secret word or another player's private, non-leaderboard data.
2. Guest sessions SHALL accrue stats (consistent with existing eligibility) but
   registered-only surfaces (profile/stats management) MAY remain gated as they
   are today.
3. Leaderboard placement SHALL be computed only from qualifying games to avoid
   trivially-ranked empty rows.

---

## Review Checkpoint

Per the agreed workflow: once this document and the **schema section of
`design.md`** are approved, implementation begins with the **schema/migration
only**. The remaining design (routers, pages, pipeline wiring) is reviewed and
built after the schema is accepted.
