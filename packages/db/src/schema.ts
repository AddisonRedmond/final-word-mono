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

export const gamePlayerStats = pgTable("game_player_stats", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull(),
  userId: uuid("user_id").notNull(),
  placement: integer("placement"),
  totalGuesses: integer("total_guesses").notNull(),
  correctGuesses: integer("correct_guesses").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const duels = pgTable("duels", {
  id: uuid("id").defaultRandom().primaryKey(),
  initiatedBy: uuid("initiated_by")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  word: text("word").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  completed: boolean().default(false).notNull(),
  participants: text("participants").array().notNull(),
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
 *
 * There is also a CHECK constraint enforced via a unique index that prevents
 * duplicate inverse rows (A→B and B→A at the same time) — see the
 * `uniqueIndex` below.
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

export type GamePlayerStats = typeof gamePlayerStats.$inferSelect;
export type NewGamePlayerStats = typeof gamePlayerStats.$inferInsert;

export type Duel = typeof duels.$inferSelect;
export type NewDuel = typeof duels.$inferInsert;

export type DuelParticipant = typeof duelParticipants.$inferSelect;
export type NewDuelParticipant = typeof duelParticipants.$inferInsert;

export type Friendship = typeof friendships.$inferSelect;
export type NewFriendship = typeof friendships.$inferInsert;

export type Profile = typeof profiles.$inferSelect;
