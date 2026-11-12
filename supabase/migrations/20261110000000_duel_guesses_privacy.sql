-- Guess privacy: keep every player's guess words out of the browser.
--
-- WHY: a player's final correct guess IS the secret word. `duel_participants` is
-- readable by every participant (RLS filters rows, not columns) and streamed over
-- realtime as whole rows, so guesses stored there reach opponents. They now live
-- in `duel_guesses`, which clients cannot read at all. The tRPC server (a
-- privileged connection that bypasses RLS) reads it and returns an opponent's
-- guesses only after the requesting player's own game has ended.
--
-- OWNERSHIP: the table structure and the data backfill are in the Drizzle
-- migration (packages/db/drizzle/0014_duel_guesses.sql). Run that FIRST, then
-- this file. Idempotent and order-forgiving, like the other duel migrations.

do $$
begin
  if to_regclass('public.duel_guesses') is not null then
    -- RLS on with NO select policy: anon/authenticated can read nothing, exactly
    -- like duel_secrets.
    execute 'alter table public.duel_guesses enable row level security';

    -- Belt and braces: Supabase grants table privileges to these roles by
    -- default; with RLS and no policy they are already blocked, but remove the
    -- grants so a future permissive policy can't expose the table by accident.
    execute 'revoke all on table public.duel_guesses from anon, authenticated';

    -- Never stream this table over realtime. Drop it if it was ever added.
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'duel_guesses'
    ) then
      execute 'alter publication supabase_realtime drop table public.duel_guesses';
    end if;
  end if;
end $$;
