/*
 * SCHEMA BARREL — MIGRATION OWNERSHIP NOTE
 * ----------------------------------------
 * This file re-exports the full schema for application code (the tRPC server,
 * the Supabase client typings, etc.). It is split across two files by
 * migration ownership:
 *
 *   - `schema.drizzle.ts` — tables Drizzle owns and generates migrations for
 *     (`profiles`, `friendships`, `game_player_stats`). This is the file
 *     `drizzle.config.ts` points at.
 *
 *   - `schema.duels.ts` — the duel tables (`duels`, `duel_participants`,
 *     `duel_secrets`), defined for TypeScript types ONLY. Their DDL is owned by
 *     the Supabase migrations under `supabase/migrations/`.
 *
 * Because `drizzle.config.ts` targets `schema.drizzle.ts` (not this barrel),
 * `drizzle-kit generate` / `push` / `pull` cannot see the duel tables and
 * cannot emit a colliding CREATE migration. Evolve the duel schema by adding a
 * new file under `supabase/migrations/` — never by running drizzle-kit.
 */

export * from "./schema.drizzle.js";
export * from "./schema.duels.js";
