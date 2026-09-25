/*
 * Backfill public.profiles from auth.users.
 *
 * profiles is a thin shadow of auth.users (see packages/db/src/schema.ts):
 *   id    = auth.users.id
 *   email = auth.users.email
 *   name  = full_name / name from raw_user_meta_data
 *
 * Normally a trigger on auth.users INSERT keeps this in sync, but that only
 * fires for NEW signups. After a schema reset (which drops public.profiles but
 * leaves auth.users intact) existing users have no profile row until this
 * backfill runs. Idempotent: existing profiles are left untouched.
 *
 * It also reports whether the auth.users insert trigger exists, so you can tell
 * if new signups will be synced going forward.
 *
 * Test/service accounts listed in EXCLUDED_EMAILS are skipped — they never get
 * a profile row.
 *
 * Usage (from repo root):
 *   DATABASE_URL="<target-url>" node packages/db/scripts/sync-profiles.mjs
 */
import "dotenv/config";
import postgres from "postgres";

// Accounts that should never be mirrored into public.profiles (test/service
// users). Compared case-insensitively against auth.users.email.
const EXCLUDED_EMAILS = ["jwttest@example.com"];

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false });

try {
  const [{ n: authCount }] = await sql`select count(*)::int as n from auth.users`;
  const [{ n: beforeCount }] = await sql`select count(*)::int as n from public.profiles`;
  console.log(`auth.users: ${authCount} | profiles before: ${beforeCount}`);

  // Backfill. name pulls full_name first, then name, from user metadata.
  // Excluded (test/service) accounts are skipped via a case-insensitive email
  // match. lower(...) on both sides keeps the comparison predictable.
  const excludedLower = EXCLUDED_EMAILS.map((e) => e.toLowerCase());
  const inserted = await sql`
    insert into public.profiles (id, email, name)
    select
      u.id,
      u.email,
      coalesce(
        u.raw_user_meta_data ->> 'full_name',
        u.raw_user_meta_data ->> 'name'
      )
    from auth.users u
    where u.email is null
       or lower(u.email) <> all(${sql.array(excludedLower)})
    on conflict (id) do nothing
    returning id
  `;
  console.log(
    `Inserted ${inserted.length} missing profile(s)` +
      (excludedLower.length ? ` (excluded: ${EXCLUDED_EMAILS.join(", ")}).` : "."),
  );

  const [{ n: afterCount }] = await sql`select count(*)::int as n from public.profiles`;
  console.log(`profiles after: ${afterCount}`);

  // Report whether the insert trigger exists on auth.users.
  const triggers = await sql`
    select tgname, proname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
    order by tgname
  `;
  if (triggers.length === 0) {
    console.log(
      "\nWARNING: no user-defined trigger found on auth.users.\n" +
        "New signups will NOT be auto-synced into profiles. If profiles used to\n" +
        "be populated by a trigger, it was likely dropped and should be restored\n" +
        "as a migration.",
    );
  } else {
    console.log("\nauth.users triggers present:");
    for (const t of triggers) console.log(`  ${t.tgname} -> ${t.proname}()`);
  }
} catch (e) {
  console.error("SYNC ERROR:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await sql.end();
}
