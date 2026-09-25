/*
 * DESTRUCTIVE remote database reset. Drops this project's public app tables and
 * clears both migration-history tables so the Drizzle baseline can rebuild the
 * schema from scratch. Intended for a NON-local database (e.g. prod) that you
 * have deliberately chosen to wipe.
 *
 * It does NOT touch the auth schema — Supabase login accounts (auth.users)
 * survive; only the public.profiles shadow rows are removed.
 *
 * DELIBERATE FRICTION: this refuses to run unless you pass --i-understand,
 * because it is irreversible. There is no localhost guard here (that is the
 * whole point — this is the remote counterpart to reset-local.mjs), so read the
 * host it prints before confirming.
 *
 * Usage (from repo root):
 *   DATABASE_URL="<remote-url>" node packages/db/scripts/reset-remote.mjs --i-understand
 */
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!process.argv.includes("--i-understand")) {
  let host = "(unparseable)";
  try {
    host = new URL(url).host;
  } catch {}
  console.error(
    "Refusing to run without confirmation.\n" +
      `This will DROP all app tables on: ${host}\n` +
      "Re-run with --i-understand if that is really what you want.",
  );
  process.exit(1);
}

let host = "(unparseable)";
try {
  host = new URL(url).host;
} catch {}
console.log(`Target host: ${host}`);

const sql = postgres(url, { prepare: false });

try {
  console.log("Dropping app public tables (CASCADE)...");
  await sql.unsafe(`
    drop table if exists
      public.duel_participants,
      public.duel_secrets,
      public.duels,
      public.friendships,
      public.game_player_stats,
      public.profiles
    cascade;
    drop type if exists public.friend_status;
  `);

  console.log("Clearing Drizzle migration history...");
  await sql
    .unsafe(`truncate table drizzle.__drizzle_migrations;`)
    .catch((e) => console.log("  (skipped)", e?.code ?? ""));

  console.log("Clearing Supabase migration history...");
  await sql
    .unsafe(`delete from supabase_migrations.schema_migrations;`)
    .catch((e) => console.log("  (skipped)", e?.code ?? ""));

  console.log(
    "Remote reset complete. Next (same DATABASE_URL):\n" +
      "  pnpm --filter db exec drizzle-kit migrate --config=drizzle.config.ts\n" +
      "  node packages/db/scripts/apply-rls.mjs\n" +
      "  node packages/db/scripts/verify-db.mjs",
  );
} catch (e) {
  console.error("RESET ERROR:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
