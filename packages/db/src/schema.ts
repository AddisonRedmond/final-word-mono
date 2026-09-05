import {
  boolean,
  integer,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const gamePlayerStats = pgTable("game_player_stats", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id").notNull(),
  userId: uuid("user_id").notNull(),
  isBot: boolean("is_bot").notNull().default(false),
  placement: integer("placement"),
  totalGuesses: integer("total_guesses").notNull(),
  correctGuesses: integer("correct_guesses").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type GamePlayerStats = typeof gamePlayerStats.$inferSelect;
export type NewGamePlayerStats = typeof gamePlayerStats.$inferInsert;
