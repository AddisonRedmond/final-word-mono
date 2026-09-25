import { boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { profiles } from "./schema.drizzle.js";

/*
 * SUPABASE-OWNED DUEL TABLES — TYPES ONLY
 * ---------------------------------------
 * The duel tables (`duels`, `duel_participants`, `duel_secrets`) are defined
 * here purely so the app has TypeScript types. Their DDL and evolution are
 * owned by the Supabase migrations under `supabase/migrations/`
 * (create → word split → realtime/RLS), because prod already has these tables
 * and needs idempotent, ALTER-style migrations rather than Drizzle's full
 * CREATE.
 *
 * These definitions are deliberately kept OUT of the schema entrypoint that
 * `drizzle.config.ts` points at (`schema.drizzle.ts`). That means
 * `drizzle-kit generate` / `push` / `pull` cannot see them and therefore cannot
 * emit a colliding CREATE TABLE migration. Manage duel schema changes by adding
 * a new file to `supabase/migrations/` — never by running drizzle-kit.
 */

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
 * with NO client-facing RLS SELECT policy means the anon/authenticated roles
 * cannot read it at all. Server-side tRPC uses a privileged pooler connection
 * that bypasses RLS, so grading and post-game reveal still work.
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

export type Duel = typeof duels.$inferSelect;
export type NewDuel = typeof duels.$inferInsert;

export type DuelSecret = typeof duelSecrets.$inferSelect;
export type NewDuelSecret = typeof duelSecrets.$inferInsert;

export type DuelParticipant = typeof duelParticipants.$inferSelect;
export type NewDuelParticipant = typeof duelParticipants.$inferInsert;
