/*
 * Applies the Supabase RLS/realtime migration directly against the database in
 * DATABASE_URL. The migration file is the single source of truth; this just
 * executes it (it is guarded + idempotent, so re-running is safe).
 *
 * Use this after the Drizzle tables exist — e.g. locally after `db:migrate`,
 * where running the migration through the Supabase CLI is awkward because the
 * CLI tracks its own history.
 *
 * Usage (from packages/db):
 *   node scripts/apply-rls.mjs
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(
  __dirname,
  "../../../supabase/migrations/20260925030000_duel_rls_and_realtime.sql",
);

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const ddl = readFileSync(migrationPath, "utf8");
const sql = postgres(url, { prepare: false });

try {
  console.log(`Applying ${migrationPath}...`);
  await sql.unsafe(ddl);
  console.log("RLS/realtime migration applied.");
} catch (e) {
  console.error("APPLY ERROR:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
