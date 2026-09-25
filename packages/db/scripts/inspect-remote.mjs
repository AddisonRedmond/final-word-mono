/*
 * READ-ONLY inspection of a target database's migration + stats-table state.
 * Runs only SELECTs. Use it to confirm what a database (e.g. prod) currently
 * has BEFORE applying migrations.
 *
 * Usage (from packages/db, or repo root):
 *   DATABASE_URL="<target-url>" node scripts/inspect-remote.mjs
 */
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

let host = "(unparseable)";
try {
  host = new URL(url).host;
} catch {}
console.log(`Target host: ${host}\n`);

const sql = postgres(url, { prepare: false });

try {
  // Drizzle migration history (may not exist if prod was set up via db:push).
  const history = await sql`
    select to_regclass('drizzle.__drizzle_migrations') as tbl`;
  if (!history[0]?.tbl) {
    console.log(
      "Drizzle migration history: NONE (drizzle.__drizzle_migrations missing).",
    );
    console.log(
      "  -> prod likely was NOT set up via drizzle migrate. Stop and review",
      "before running db:migrate, or the baseline may collide with existing tables.",
    );
  } else {
    const applied = await sql`
      select created_at from drizzle.__drizzle_migrations order by created_at`;
    console.log(`Drizzle migrations applied: ${applied.length}`);
  }

  const tableState = async (name) =>
    (await sql`select to_regclass(${`public.${name}`}) as t`)[0].t ? "yes" : "no";

  console.log(`\nTable presence:`);
  console.log(`  game_player_stats exists:   ${await tableState("game_player_stats")}`);
  console.log(`  battle_royale_stats exists: ${await tableState("battle_royale_stats")}`);

  const cols = await sql`
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'battle_royale_stats'
    order by ordinal_position`;
  if (cols.length > 0) {
    console.log(`\nbattle_royale_stats columns:`);
    for (const c of cols) {
      console.log(`  ${c.column_name} (${c.data_type})`);
    }
  }
} catch (e) {
  console.error("INSPECT ERROR:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
