-- Duel Row Level Security + realtime configuration.
--
-- OWNERSHIP: Table STRUCTURE (duels, duel_participants, duel_secrets and every
-- other table) is owned by Drizzle — see packages/db/drizzle. This migration
-- tracks ONLY the Supabase-specific concerns Drizzle cannot express:
--   * Row Level Security policies
--   * supabase_realtime publication membership
--   * REPLICA IDENTITY FULL
--
-- ORDERING: this must run AFTER the Drizzle baseline creates the duel tables.
-- Every block is guarded on the table existing (to_regclass) and every object
-- is created conditionally, so the migration is:
--   * order-forgiving — if it runs before Drizzle (e.g. a bare `supabase db
--     reset` where the Drizzle migrate step has not happened yet) it simply
--     no-ops instead of erroring; re-run it after Drizzle to apply.
--   * idempotent — safe to run more than once.

-- ---------------------------------------------------------------------------
-- Realtime publication membership
-- ---------------------------------------------------------------------------
-- Only tables in the supabase_realtime publication stream postgres_changes.
-- duel_secrets is intentionally NEVER added — the answer word must not reach
-- the browser.
do $$
begin
  if to_regclass('public.duels') is not null
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'duels'
     )
  then
    alter publication supabase_realtime add table public.duels;
  end if;

  if to_regclass('public.duel_participants') is not null
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'duel_participants'
     )
  then
    alter publication supabase_realtime add table public.duel_participants;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Replica identity
-- ---------------------------------------------------------------------------
-- The client realtime hook inspects payload.old (e.g. detecting a participant
-- transitioning into a finished state, and old.user_id on delete). Postgres
-- only includes old column values in the WAL when replica identity is FULL.
do $$
begin
  if to_regclass('public.duels') is not null then
    alter table public.duels replica identity full;
  end if;
  if to_regclass('public.duel_participants') is not null then
    alter table public.duel_participants replica identity full;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Realtime respects RLS: a client only receives a row's change if its SELECT
-- policy would let that client read the row. auth.uid() requires the client to
-- subscribe with the logged-in user's JWT (the SSR/auth-aware Supabase client).

-- duels: readable only by listed participants. participants is text[], so the
-- uuid from auth.uid() is cast to text for the membership check.
do $$
begin
  if to_regclass('public.duels') is not null then
    execute 'alter table public.duels enable row level security';

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'duels'
        and policyname = 'duels_select_participant'
    ) then
      execute $policy$
        create policy "duels_select_participant"
        on public.duels
        for select
        to authenticated
        using ((auth.uid())::text = any (participants))
      $policy$;
    end if;
  end if;
end $$;

-- duel_participants: readable only when you are a participant of that duel.
do $$
begin
  if to_regclass('public.duel_participants') is not null then
    execute 'alter table public.duel_participants enable row level security';

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'duel_participants'
        and policyname = 'duel_participants_select_participant'
    ) then
      execute $policy$
        create policy "duel_participants_select_participant"
        on public.duel_participants
        for select
        to authenticated
        using (
          exists (
            select 1 from public.duels d
            where d.id = duel_participants.duel_id
              and (auth.uid())::text = any (d.participants)
          )
        )
      $policy$;
    end if;
  end if;
end $$;

-- duel_secrets: RLS on, with NO select policy for anon/authenticated. Clients
-- can never read it. The tRPC server uses a privileged pooler connection that
-- bypasses RLS, so grading and post-game reveal still work.
do $$
begin
  if to_regclass('public.duel_secrets') is not null then
    execute 'alter table public.duel_secrets enable row level security';
  end if;
end $$;
