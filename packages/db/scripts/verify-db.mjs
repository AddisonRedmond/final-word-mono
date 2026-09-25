/*
 * READ-ONLY database verification. Runs only SELECTs — never modifies anything.
 * Confirms the schema + RLS/realtime setup matches what we expect on any target
 * database (local or prod).
 *
 * Usage (from repo root or packages/db):
 *   DATABASE_URL="<target-url>" node packages/db/scripts/verify-db.mjs
 *
 * Exit code is non-zero if any expectation fails, so it is CI-friendly.
 */
import "dotenv/config";
import postgres from "postgres";

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false });

const EXPECTED_TABLES = [
  "duel_participants",
  "duel_secrets",
  "duels",
  "friendships",
  "battle_royale_stats",
  "profiles",
];

let ok = true;
const check = (label, pass, detail) => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) ok = false;
};

try {
  const tables = (
    await sql`select tablename from pg_tables where schemaname='public' order by tablename`
  ).map((t) => t.tablename);
  const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t));
  check("all 6 tables exist", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : tables.join(", "));

  const rls = await sql`
    select relname, relrowsecurity, relreplident from pg_class
    where relname in ('duels','duel_participants','duel_secrets') order by relname`;
  const rlsMap = Object.fromEntries(rls.map((r) => [r.relname, r]));
  check("RLS enabled on duels", rlsMap.duels?.relrowsecurity === true);
  check("RLS enabled on duel_participants", rlsMap.duel_participants?.relrowsecurity === true);
  check("RLS enabled on duel_secrets", rlsMap.duel_secrets?.relrowsecurity === true);

  check("REPLICA IDENTITY FULL on duels", rlsMap.duels?.relreplident === "f");
  check("REPLICA IDENTITY FULL on duel_participants", rlsMap.duel_participants?.relreplident === "f");

  const pol = await sql`
    select tablename, policyname from pg_policies
    where schemaname='public' and tablename like 'duel%' order by tablename`;
  const polByTable = pol.reduce((acc, p) => {
    (acc[p.tablename] ??= []).push(p.policyname);
    return acc;
  }, {});
  check("duels has a select policy", (polByTable.duels ?? []).length > 0, (polByTable.duels ?? []).join(", "));
  check(
    "duel_participants has a select policy",
    (polByTable.duel_participants ?? []).length > 0,
    (polByTable.duel_participants ?? []).join(", "),
  );
  check(
    "duel_secrets has NO policy (word stays private)",
    (polByTable.duel_secrets ?? []).length === 0,
    (polByTable.duel_secrets ?? []).join(", ") || "none",
  );

  const pub = (
    await sql`
      select tablename from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename like 'duel%'
      order by tablename`
  ).map((r) => r.tablename);
  check("realtime includes duels", pub.includes("duels"));
  check("realtime includes duel_participants", pub.includes("duel_participants"));
  check("realtime EXCLUDES duel_secrets", !pub.includes("duel_secrets"), pub.join(", ") || "none");
} catch (e) {
  console.error("VERIFY ERROR:", e?.message ?? e);
  ok = false;
} finally {
  await sql.end();
}

process.exit(ok ? 0 : 1);
