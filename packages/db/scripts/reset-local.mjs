/*
 * LOCAL-ONLY database reset helper.
 *
 * Drops the app's public tables and both migration-history records so the
 * Drizzle baseline (drizzle/0000_baseline.sql) can apply cleanly to a DB that
 * previously received tables via ad-hoc `db:push`.
 *
 * SAFETY: refuses to run unless DATABASE_URL points at localhost/127.0.0.1.
 * This never touches a remote/prod database.
 *
 * Usage (from packages/db):
 *   node scripts/reset-local.mjs
 * Then:
 *   pnpm run db:migrate                 # Drizzle creates all tables
 *   node scripts/apply-rls.mjs          # applies the Supabase RLS/realtime SQL
 */
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
if (!isLocal) {
  console.error(
    `Refusing to run: DATABASE_URL does not look local (${url || "(empty)"}).\n` +
      "This script only operates on a local database.",
  );
  process.exit(1);
}

const sql = postgres(url, { prepare: false });

try {
  console.log("Dropping app public tables (CASCADE)...");
  await sql.unsafe(`
    drop table if exists
      public.duel_participants,
      public.duel_secrets,
      public.duels,
      public.friendships,
      public.battle_royale_stats,
      public.profiles
    cascade;
    drop type if exists public.friend_status;
  `);

  console.log("Clearing Drizzle migration history...");
  await sql.unsafe(`truncate table drizzle.__drizzle_migrations;`).catch((e) => {
    console.log("  (drizzle.__drizzle_migrations not present — skipping)", e?.code ?? "");
  });

  console.log("Clearing Supabase migration history...");
  await sql
    .unsafe(`delete from supabase_migrations.schema_migrations;`)
    .catch((e) => {
      console.log("  (supabase_migrations.schema_migrations not present — skipping)", e?.code ?? "");
    });

  console.log("Local reset complete. Next: pnpm run db:migrate, then node scripts/apply-rls.mjs");
} catch (e) {
  console.error("RESET ERROR:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
