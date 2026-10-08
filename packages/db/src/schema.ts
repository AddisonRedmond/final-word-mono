import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * MIGRATION OWNERSHIP
 * -------------------
 * Drizzle owns ALL table structure and migrations for this project. Every
 * table below is created and evolved via `drizzle-kit` (see the committed
 * baseline under ./drizzle). Add or change tables here, then run
 * `pnpm db:generate` to produce a new migration.
 *
 * Supabase-specific concerns that Drizzle cannot express — Row Level Security
 * policies, `supabase_realtime` publication membership, and replica identity —
 * are tracked SEPARATELY as plain SQL migrations under `supabase/migrations/`.
 * Those run AFTER the Drizzle tables exist.
 */

/**
 * Aggregate Battle Royale statistics — ONE row per user (userId is the PK).
 *
 * When a match finishes, the realtime game server (apps/server) upserts each
 * REAL player's row (bots excluded), incrementing the running totals with that
 * match's outcome. There is no per-match history table; everything here is a
 * maintained aggregate.
 *
 * `averagePlacement` is stored as a running average (bounded between 1 and the
 * max lobby size) rather than a growing sum, updated each game as:
 *   newAvg = (oldAvg * oldGamesPlayed + placement) / (oldGamesPlayed + 1)
 * Other rates are still derived on read:
 *   - win rate = wins / gamesPlayed
 *   - losses   = gamesPlayed - wins - draws
 * (gamesPlayed is guaranteed > 0 for any row that exists, since a row is only
 * created on a player's first completed match.)
 */
export const battleRoyaleStats = pgTable("battle_royale_stats", {
  // One row per user — the aggregate key.
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  gamesPlayed: integer("games_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  // Running average finishing placement (1 = won). Bounded, updated per game.
  averagePlacement: real("average_placement").notNull().default(0),
  // Best (lowest) placement ever achieved; 1 means at least one win.
  bestPlacement: integer("best_placement"),
  // Running totals across all matches, for lifetime figures and averages.
  totalGuesses: integer("total_guesses").notNull().default(0),
  totalCorrectGuesses: integer("total_correct_guesses").notNull().default(0),
  // Consecutive wins ending at the most recent game, and the best ever run.
  currentWinStreak: integer("current_win_streak").notNull().default(0),
  bestWinStreak: integer("best_win_streak").notNull().default(0),
  // Whether the user's most recently completed match was a win. Overwritten
  // every game (not accumulated) so the UI can react to the latest result.
  wonLastGame: boolean("won_last_game").notNull().default(false),
  lastPlayedAt: timestamp("last_played_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * Aggregate Race_Mode statistics — ONE row per user (userId is the PK).
 *
 * Mirrors {@link battleRoyaleStats} exactly, retargeted to the round-based
 * elimination race. When a match finishes, the realtime game server upserts
 * each REAL player's row (bots excluded), incrementing the running totals with
 * that match's outcome. There is no per-match history table; everything here is
 * a maintained aggregate.
 *
 * `averagePlacement` is stored as a running average (bounded between 1 and the
 * max lobby size) rather than a growing sum, updated each game as:
 *   newAvg = (oldAvg * oldGamesPlayed + placement) / (oldGamesPlayed + 1)
 * Other rates are still derived on read:
 *   - win rate = wins / gamesPlayed
 *   - losses   = gamesPlayed - wins - draws
 * (gamesPlayed is guaranteed > 0 for any row that exists, since a row is only
 * created on a player's first completed match.)
 */
export const raceStats = pgTable("race_stats", {
  // One row per user — the aggregate key.
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  gamesPlayed: integer("games_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  // Running average finishing placement (1 = won). Bounded, updated per game.
  averagePlacement: real("average_placement").notNull().default(0),
  // Best (lowest) placement ever achieved; 1 means at least one win.
  bestPlacement: integer("best_placement"),
  // Running totals across all matches, for lifetime figures and averages.
  totalGuesses: integer("total_guesses").notNull().default(0),
  totalCorrectGuesses: integer("total_correct_guesses").notNull().default(0),
  // Consecutive wins ending at the most recent game, and the best ever run.
  currentWinStreak: integer("current_win_streak").notNull().default(0),
  bestWinStreak: integer("best_win_streak").notNull().default(0),
  // Whether the user's most recently completed match was a win. Overwritten
  // every game (not accumulated) so the UI can react to the latest result.
  wonLastGame: boolean("won_last_game").notNull().default(false),
  lastPlayedAt: timestamp("last_played_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const duels = pgTable("duels", {
  id: uuid("id").defaultRandom().primaryKey(),
  initiatedBy: uuid("initiated_by")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  completed: boolean().default(false).notNull(),
  participants: text("participants").array().notNull(),
  winner: uuid("winner").references(() => profiles.id, {
    onDelete: "set null",
  }),
  // The duel this one was spawned from via "Rematch" (retention Phase 1).
  // Null for an original (non-rematch) duel. Self-reference lets a rivalry be
  // traced as a chain. `set null` so deleting an old duel doesn't cascade-
  // destroy the newer one — the newer duel just loses its backward link.
  rematchOfDuelId: uuid("rematch_of_duel_id").references(
    (): AnyPgColumn => duels.id,
    { onDelete: "set null" },
  ),
});

/**
 * The answer word for a duel, deliberately split out of the `duels` table so
 * it never reaches the browser.
 *
 * The client reads `duels` / `duel_participants` directly via Supabase
 * realtime (anon key, subject to RLS), and those payloads would otherwise
 * carry the word for still-active games. Keeping the secret in its own table
 * with NO client-facing RLS SELECT policy (see supabase/migrations) means the
 * anon/authenticated roles cannot read it at all. Server-side tRPC uses a
 * privileged pooler connection that bypasses RLS, so grading and post-game
 * reveal still work.
 */
export const duelSecrets = pgTable("duel_secrets", {
  duelId: uuid("duel_id")
    .primaryKey()
    .references(() => duels.id, { onDelete: "cascade" }),
  word: text("word").notNull(),
});

export const duelParticipants = pgTable(
  "duel_participants",
  {
    duelId: uuid("duel_id")
      .notNull()
      .references(() => duels.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    startTime: timestamp("start_time", { withTimezone: true }),
    endTime: timestamp("end_time", { withTimezone: true }),
    totalGuesses: integer("total_guesses").notNull().default(0),
    success: boolean("success").notNull().default(false),
    guesses: text("guesses").array().notNull().default([]),
    accepted: boolean(),
    // True when the participant ended their own game by forfeiting (gave up)
    // rather than playing to a result. Distinguishes a forfeit from a normal
    // loss (ran out of guesses) — both have endTime set and success=false — so
    // the UI can show them as separate statuses. `accepted` stays true on
    // forfeit; it only means "accepted/started the duel".
    forfeited: boolean("forfeited").notNull().default(false),
    completed_game_acknowledged: boolean().default(false),
  },
  (t) => [primaryKey({ columns: [t.duelId, t.userId] })],
);

export const friendStatusEnum = pgEnum("friend_status", [
  "pending",
  "accepted",
]);

/**
 * A single row represents a directed friend relationship from `requesterId`
 * to `addresseeId`.
 *
 * Cascade behaviour:
 *   - Deleting either referenced user (via Supabase auth.users) removes the row.
 *   - When a friendship is accepted it remains a single row. If either party
 *     removes the friend we DELETE the row, which is handled at the
 *     application layer (the query deletes whichever direction the row exists).
 *
 * To prevent one-sided "ghost" friendships, the application must always
 * DELETE the row regardless of which user initiates the removal — the
 * composite primary key (requesterId, addresseeId) guarantees uniqueness and
 * the ON DELETE CASCADE on both FK columns ensures orphaned rows are cleaned
 * up automatically if a user account is removed.
 */
export const friendships = pgTable(
  "friendships",
  {
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: friendStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // Composite PK — one row per ordered pair
    primaryKey({ columns: [t.requesterId, t.addresseeId] }),
  ],
);

/**
 * Minimal profiles table that mirrors Supabase auth.users.
 * Supabase's auth schema is not directly referenceable from public tables
 * in all setups, so we keep a thin shadow table that is populated via a
 * database trigger on auth.users INSERT.
 */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // matches auth.users.id
  email: text("email"), // mirrors auth.users.email
  name: text("name"), // mirrors auth.users user_metadata.full_name
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  // --- Polar (polar.sh) premium billing state --------------------------------
  // Populated by the Polar webhook handler; see
  // apps/client/src/pages/api/webhooks/polar.ts. These fields are TRACKED but
  // intentionally NOT enforced anywhere yet — the whole game stays free. When
  // we start paywalling, read premium status via the `billing` tRPC router and
  // branch on the derived `isPremium`.
  //
  // Polar customer id for this user, set once they go through checkout. Lets us
  // match incoming webhooks and open the customer portal.
  polarCustomerId: text("polar_customer_id"),
  // Latest Polar subscription status string (e.g. "active", "canceled",
  // "past_due"). Null when the user has never subscribed.
  premiumStatus: text("premium_status"),
  // When the current premium entitlement runs through. Null when not premium.
  premiumUntil: timestamp("premium_until", { withTimezone: true }),
});

/**
 * Per-user, per-day realtime-game usage counter — the backing store for the
 * free-tier realtime play limit (free accounts: 3 realtime games per UTC day,
 * SHARED across Battle Royale and Race; premium: unlimited).
 *
 * Keyed by (userId, day) where `day` is a UTC calendar date string
 * ("YYYY-MM-DD", see {@link utcDayKey}). One row per user per UTC day; `count`
 * is incremented when a realtime match starts. The limit therefore resets at
 * UTC midnight simply because a new day gets a fresh (absent) row — there is no
 * sweep/reset job. Old rows are harmless and can be pruned later if desired.
 *
 * This exists because the aggregate `*_stats.gamesPlayed` counters are LIFETIME
 * totals that never reset, so they cannot express a per-day limit. The usage
 * row is independent of stats: it counts starts for gating, not outcomes.
 */
export const realtimeGameUsage = pgTable(
  "realtime_game_usage",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // UTC calendar day, "YYYY-MM-DD". A plain text key (not a date column) so
    // the composite PK is trivial and the server computes it with utcDayKey().
    day: text("day").notNull(),
    // Realtime matches this user started on this UTC day, across all modes.
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
);

/**
 * Unified, mode-extensible, season-aware aggregate stats — the Phase 1
 * retention foundation. ONE row per (userId, mode, scope).
 *
 *   - `mode`  : a GameMode value as plain text (see GAME_MODES). Text, not a
 *               pg enum, so adding a new mode (e.g. "classic") needs NO
 *               migration — add it to GAME_MODES and start writing.
 *   - `scope` : either LIFETIME_SCOPE ("lifetime") for all-time totals, or a
 *               season key "YYYY-MM" (see seasonKey) for that month's totals.
 *               A single completed game updates BOTH the lifetime row and the
 *               current-season row for that user+mode.
 *
 * This collapses the old table-per-mode shape (battleRoyaleStats, raceStats)
 * and the lifetime-vs-seasonal split into rows. The existing per-mode tables
 * are intentionally retained during the transition (additive migration); the
 * server write paths move onto this table separately.
 *
 * Derived-on-read (not stored): win rate = wins/gamesPlayed; losses =
 * gamesPlayed - wins - draws; avg guesses = totalGuesses/gamesPlayed; avg solve
 * = totalSolveMs/solveCount. Mode-specific columns are NULL when a mode has no
 * concept of them (placement for duel/classic; solve timing for BR/race) — null
 * means "not tracked by this mode", not zero.
 */
export const playerModeStats = pgTable(
  "player_mode_stats",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // A GameMode value; plain text at the DB level (no pg enum — see above).
    mode: text("mode").notNull(),
    // "lifetime" or a season key "YYYY-MM".
    scope: text("scope").notNull(),

    // --- Core outcome counters (every mode) ---
    gamesPlayed: integer("games_played").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    draws: integer("draws").notNull().default(0),

    // --- Streaks (consecutive wins ending at the most recent game) ---
    currentWinStreak: integer("current_win_streak").notNull().default(0),
    bestWinStreak: integer("best_win_streak").notNull().default(0),
    wonLastGame: boolean("won_last_game").notNull().default(false),

    // --- Guess economy (every mode records guesses) ---
    totalGuesses: integer("total_guesses").notNull().default(0),
    totalCorrectGuesses: integer("total_correct_guesses").notNull().default(0),

    // --- Placement (multiplayer modes only; null for duel/classic) ---
    // Running average finishing placement (1 = won); null until first placed game.
    averagePlacement: real("average_placement"),
    bestPlacement: integer("best_placement"),

    // --- Solve timing in ms (modes that time a solve; null otherwise) ---
    solveCount: integer("solve_count").notNull().default(0),
    totalSolveMs: integer("total_solve_ms").notNull().default(0),
    fastestSolveMs: integer("fastest_solve_ms"),

    // --- Season_Points (Apex-style scoring). SEASONAL + SCORED MODES ONLY:
    //     meaningful only where `scope` is a season key AND `mode` is in
    //     SCORED_MODES (battle_royale/race). Stays 0 on lifetime rows and on
    //     duel/classic rows — there is deliberately no lifetime points total.
    //     The leaderboard sorts a season's rows by seasonPoints DESC. ---
    seasonPoints: integer("season_points").notNull().default(0),
    // Best single-match points for this scope (personal best); 0 until first
    // scored match. Also only populated on seasonal scored rows.
    bestMatchPoints: integer("best_match_points").notNull().default(0),

    lastPlayedAt: timestamp("last_played_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // One aggregate per player, per mode, per scope.
    primaryKey({ columns: [t.userId, t.mode, t.scope] }),
    // Leaderboard scan: "all rows for this mode+scope, ranked".
    index("pms_mode_scope_idx").on(t.mode, t.scope),
  ],
);

/**
 * Per-participant duel fact table — one immutable row per participant per
 * COMPLETED duel. Written only for participants who actually finished (have an
 * endTime); an invitee who never played gets no row. Powers head-to-head
 * records and duel history, and feeds the duel stats pipeline. Never stores the
 * secret word.
 *
 * `completedAt` + `season` are denormalized (= the duel's completion moment and
 * its season key) so history / H2H / seasonal filtering never join `duels`.
 * Friendship deletion does NOT touch this table — historical records survive an
 * unfriend.
 */
export const duelResults = pgTable(
  "duel_results",
  {
    duelId: uuid("duel_id")
      .notNull()
      .references(() => duels.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // Did THIS participant win the duel (userId === duels.winner)? A draw is
    // won=false for everyone with isDraw=true.
    won: boolean("won").notNull(),
    isDraw: boolean("is_draw").notNull().default(false),
    // Did they solve the word at all (independent of winning)?
    solved: boolean("solved").notNull(),
    guesses: integer("guesses").notNull(),
    // Solve duration ms (endTime - startTime); null if never finished a timed
    // attempt.
    solveMs: integer("solve_ms"),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    // Season key "YYYY-MM" at completion.
    season: text("season").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.duelId, t.userId] }),
    // Duel history for a user, newest first.
    index("duel_results_user_completed_idx").on(t.userId, t.completedAt),
  ],
);

/**
 * Archived final season standings — one row per (userId, mode, season) with the
 * player's FINAL placement, written once when a season is archived. The
 * underlying seasonal playerModeStats rows are retained regardless, so this is
 * a fast-read snapshot and archival is reproducible from those aggregates.
 * Makes "October 2026 — #47" a single indexed read.
 */
export const seasonPlacements = pgTable(
  "season_placements",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    season: text("season").notNull(), // "YYYY-MM"
    placement: integer("placement").notNull(), // 1 = best
    // Snapshot of headline figures at archival so the archive renders without
    // recomputing. `rankingValue` is the metric it was ranked by (seasonPoints
    // for scored modes).
    gamesPlayed: integer("games_played").notNull(),
    wins: integer("wins").notNull(),
    rankingValue: real("ranking_value").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.mode, t.season] }),
    // "my placement history across seasons".
    index("season_placements_user_idx").on(t.userId, t.mode, t.season),
    // "this season's archived board, ranked".
    index("season_placements_board_idx").on(t.mode, t.season, t.placement),
  ],
);

export type BattleRoyaleStats = typeof battleRoyaleStats.$inferSelect;
export type NewBattleRoyaleStats = typeof battleRoyaleStats.$inferInsert;

export type RaceStats = typeof raceStats.$inferSelect;
export type NewRaceStats = typeof raceStats.$inferInsert;

export type Duel = typeof duels.$inferSelect;
export type NewDuel = typeof duels.$inferInsert;

export type DuelSecret = typeof duelSecrets.$inferSelect;
export type NewDuelSecret = typeof duelSecrets.$inferInsert;

export type DuelParticipant = typeof duelParticipants.$inferSelect;
export type NewDuelParticipant = typeof duelParticipants.$inferInsert;

export type Friendship = typeof friendships.$inferSelect;
export type NewFriendship = typeof friendships.$inferInsert;

export type Profile = typeof profiles.$inferSelect;

export type RealtimeGameUsage = typeof realtimeGameUsage.$inferSelect;
export type NewRealtimeGameUsage = typeof realtimeGameUsage.$inferInsert;

export type PlayerModeStats = typeof playerModeStats.$inferSelect;
export type NewPlayerModeStats = typeof playerModeStats.$inferInsert;

export type DuelResult = typeof duelResults.$inferSelect;
export type NewDuelResult = typeof duelResults.$inferInsert;

export type SeasonPlacement = typeof seasonPlacements.$inferSelect;
export type NewSeasonPlacement = typeof seasonPlacements.$inferInsert;

/*
 * PREMIUM ENTITLEMENT + FREE/PREMIUM TIER LIMITS
 * ----------------------------------------------
 * Single source of truth, shared by apps/client (billing router, UI) and
 * apps/server (realtime match-start gate). Kept in the db package because it's
 * the one dependency both apps already share, so the "what counts as premium"
 * rule and the per-tier limits can never drift between client and server.
 */

/**
 * Polar subscription statuses that currently grant premium access. `trialing`
 * counts so active trials are treated as premium.
 */
export const PREMIUM_ACTIVE_STATUSES = new Set(["active", "trialing"]);

/**
 * Pure predicate: is a user premium right now, given the raw Polar status and
 * entitlement end recorded on their `profiles` row?
 *
 * Premium iff the latest status is an entitling one AND (if an end date is
 * known) it hasn't passed — belt-and-suspenders against a missed "revoked"
 * webhook. `now` is injectable for testing; defaults to the current time.
 */
export const isPremiumEntitlement = (
  status: string | null | undefined,
  premiumUntil: Date | null | undefined,
  now: Date = new Date(),
): boolean => {
  if (status == null || !PREMIUM_ACTIVE_STATUSES.has(status)) {
    return false;
  }
  return !premiumUntil || premiumUntil.getTime() > now.getTime();
};

/**
 * Free vs premium tier limits. The one place these numbers live.
 *   - duelInvitees: additional players a user can invite to a duel (NOT
 *     counting themselves). Free 2 (3 total incl. self); premium 4 (5 total).
 *   - activeDuels: concurrent in-progress duels. Free 2; premium 5.
 *   - realtimeGamesPerDay: realtime matches per UTC day, shared across modes.
 *     Free 3; premium `null` = unlimited.
 */
export const TIER_LIMITS = {
  free: {
    duelInvitees: 2,
    activeDuels: 2,
    realtimeGamesPerDay: 3 as number | null,
  },
  premium: {
    duelInvitees: 4,
    activeDuels: 5,
    realtimeGamesPerDay: null as number | null,
  },
} as const;

/** Limits for a given tier, selected by the derived premium flag. */
export const tierLimits = (isPremium: boolean) =>
  isPremium ? TIER_LIMITS.premium : TIER_LIMITS.free;

/**
 * The UTC calendar-day key ("YYYY-MM-DD") used to bucket realtime usage. Shared
 * so the server's counter writes and any reads agree on the day boundary (UTC
 * midnight). `now` is injectable for testing.
 */
export const utcDayKey = (now: Date = new Date()): string =>
  now.toISOString().slice(0, 10);

/*
 * STATS FOUNDATION — SHARED CONSTANTS & SCORING (retention Phase 1)
 * -----------------------------------------------------------------
 * Single source of truth shared by apps/client (stats/leaderboard reads) and
 * apps/server (stats writes), kept here so the "what is a mode / season / point"
 * rules can never drift between client and server. Mirrors how TIER_LIMITS and
 * utcDayKey already live in this file.
 */

/**
 * The game modes that can produce stats. `playerModeStats.mode` is plain text
 * (NOT a pg enum) guarded by this union — so adding a mode (e.g. a future
 * "classic") is a one-line change here with NO database migration.
 */
export const GAME_MODES = [
  "battle_royale",
  "race",
  "duel",
  "classic",
] as const;
export type GameMode = (typeof GAME_MODES)[number];

/**
 * The reserved non-season scope value for all-time aggregates. Every other
 * scope value is a season key ("YYYY-MM").
 */
export const LIFETIME_SCOPE = "lifetime" as const;

/** A stats scope: lifetime, or a season key "YYYY-MM". */
export type StatsScope = typeof LIFETIME_SCOPE | (string & {});

/**
 * Season key = UTC calendar MONTH ("YYYY-MM"). One shared helper so client
 * reads and server writes agree on the month boundary (UTC midnight on the
 * 1st). `now` is injectable for testing. Mirrors {@link utcDayKey}.
 */
export const seasonKey = (now: Date = new Date()): string =>
  now.toISOString().slice(0, 7);

/**
 * Modes that participate in the Phase 1 competitive points system. `duel` is
 * intentionally excluded (duel competitive ranking is a later phase); only
 * these modes accrue Season_Points.
 */
export const SCORED_MODES = ["battle_royale", "race"] as const;
export type ScoredMode = (typeof SCORED_MODES)[number];

/** Narrowing guard: does this mode participate in the points system? */
export const isScoredMode = (mode: string): mode is ScoredMode =>
  (SCORED_MODES as readonly string[]).includes(mode);

/**
 * Apex-style scoring config — the single source of truth for how one completed
 * realtime match awards points. Tunable WITHOUT a migration (points are stored,
 * not the inputs): change these numbers and redeploy.
 */
export const SCORING_CONFIG = {
  /**
   * placementPoints by finishing-placement tier. Evaluated best-tier-first; a
   * player receives the points of the best tier their placement satisfies
   * (e.g. placement 1 → 10, placement 4 → 4, placement 20 → 0).
   */
  placementTiers: [
    { maxPlacement: 1, points: 10 },
    { maxPlacement: 3, points: 6 },
    { maxPlacement: 5, points: 4 },
    { maxPlacement: 10, points: 2 },
  ],
  /** Flat bonus added only when the player's placement is 1. */
  winBonus: 12,
  /** combatPoints = min(combatInput * perGuess, cap). */
  combatPointsPerGuess: 1,
  combatPointsCap: 15,
} as const;

export type ScoringConfig = typeof SCORING_CONFIG;

/**
 * Pure Match_Points function: points one player earns for one completed scored
 * match = placementPoints + winBonus + combatPoints.
 *
 * `combatInput` is the swappable combat proxy. Phase 1 passes the player's
 * `correctGuesses`; when a real "eliminations/kills" stat exists later, pass
 * that here instead — NOTHING else changes (same formula, same columns, same
 * leaderboard). Negative inputs are clamped to 0 so the result is always ≥ 0.
 */
export const matchPoints = (
  placement: number,
  combatInput: number,
  config: ScoringConfig = SCORING_CONFIG,
): number => {
  const tier = config.placementTiers.find(
    (t) => placement <= t.maxPlacement,
  );
  const placementPoints = tier?.points ?? 0;
  const winBonus = placement === 1 ? config.winBonus : 0;
  const combatPoints = Math.min(
    Math.max(0, combatInput) * config.combatPointsPerGuess,
    config.combatPointsCap,
  );
  return placementPoints + winBonus + combatPoints;
};
