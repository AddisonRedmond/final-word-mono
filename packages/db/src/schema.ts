import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
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
 * Averages are stored as (sum, count) pairs rather than a single running
 * average, because a running average cannot be updated correctly without the
 * count and loses precision over time. Consumers derive the average on read:
 *   - average placement  = placementSum / gamesPlayed
 *   - win rate           = wins / gamesPlayed
 *   - losses             = gamesPlayed - wins - draws
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
  // Running sum of placements (1 = won). average = placementSum / gamesPlayed.
  placementSum: integer("placement_sum").notNull().default(0),
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
});

export type BattleRoyaleStats = typeof battleRoyaleStats.$inferSelect;
export type NewBattleRoyaleStats = typeof battleRoyaleStats.$inferInsert;

export type Duel = typeof duels.$inferSelect;
export type NewDuel = typeof duels.$inferInsert;

export type DuelSecret = typeof duelSecrets.$inferSelect;
export type NewDuelSecret = typeof duelSecrets.$inferInsert;

export type DuelParticipant = typeof duelParticipants.$inferSelect;
export type NewDuelParticipant = typeof duelParticipants.$inferInsert;

export type Friendship = typeof friendships.$inferSelect;
export type NewFriendship = typeof friendships.$inferInsert;

export type Profile = typeof profiles.$inferSelect;
