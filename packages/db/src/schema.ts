import {
  boolean,
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
