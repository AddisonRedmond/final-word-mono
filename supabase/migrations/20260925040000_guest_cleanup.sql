-- Scheduled cleanup of aged anonymous (guest) accounts.
--
-- DELIVERED ARTIFACT, NOT APPLICATION CODE (R8.4): this cleanup is a scheduled
-- database job, deliberately NOT implemented anywhere in the app runtime. The
-- app never deletes guest accounts; this SQL is the single source of that
-- behavior so the whole feature stays greppable and removable in one pass (R9).
--
-- MANUAL OPERATOR STEP: installing/scheduling this job is performed by the
-- operator — apply this migration (or run the SQL in the Supabase SQL editor)
-- against the target project. pg_cron is available on Supabase; enabling it the
-- first time may require the operator to turn the extension on for the project.
--
-- OWNERSHIP: table STRUCTURE (profiles, race_stats, battle_royale_stats, and the
-- auth.users rows this touches) is owned elsewhere — Drizzle for the public
-- tables, Supabase for auth. This migration tracks ONLY the pg_cron job and the
-- cleanup function it calls.
--
-- CASCADE, NOT EXPLICIT STATS DELETE (R8.5/R8.6): deleting an auth.users row
-- cascades through profiles -> race_stats / battle_royale_stats via the existing
  -- `onDelete: cascade` foreign keys, so this job removes guest stats automatically
  -- and contains NO separate stats-deletion statement.
--
-- ATOMICITY / OBSERVABILITY (R8.7): the DELETE is a single atomic statement, so a
-- failing run leaves every guest row and its cascaded stats unchanged, and pg_cron
-- records the run (including failures) in cron.job_run_details.
--
-- IDEMPOTENT: safe to run more than once — the extension and function use
-- create-if-not-exists / create-or-replace, and the schedule is torn down and
-- recreated below.

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Cleanup function
-- ---------------------------------------------------------------------------
-- Deletes anonymous auth.users older than 24h. ONLY is_anonymous = true is ever
-- touched; false/null rows are never selected (R8.1/R8.2). Age is computed as
-- now() - created_at (R8.1). No stats DELETE here — the FK cascade handles it
-- (R8.5/R8.6).
create or replace function public.cleanup_anonymous_accounts()
returns void
language sql
security definer
set search_path = public
as $$
  delete from auth.users
  where is_anonymous = true
    and now() - created_at > interval '24 hours';
$$;

-- ---------------------------------------------------------------------------
-- Idempotent (re)scheduling
-- ---------------------------------------------------------------------------
-- Unschedule any prior copy first so re-running this migration does not create a
-- duplicate job, then (re)schedule to run every 24 hours (R8.3). The unschedule
-- is guarded on the job existing so the first install does not error.
do $$
begin
  perform cron.unschedule('cleanup_anonymous_accounts')
  where exists (
    select 1 from cron.job where jobname = 'cleanup_anonymous_accounts'
  );
end
$$;

-- Every 24h — daily at 00:00 UTC — satisfies "runs every 24 hours" (R8.3). If an
-- exact 24h-from-install cadence is preferred over a fixed wall-clock time, swap
-- this cron expression for an interval-based schedule; the delete predicate is
-- unchanged.
select cron.schedule(
  'cleanup_anonymous_accounts',
  '0 0 * * *',
  $$select public.cleanup_anonymous_accounts();$$
);
