-- Split the duel answer word out of `duels` into a client-inaccessible
-- `duel_secrets` table, so it can never reach the browser via realtime or the
-- Data API.
--
-- This migration MUST run before 20260925021405_enable_duel_realtime.sql,
-- which enables RLS on duel_secrets — hence the earlier timestamp.
--
-- It is idempotent and covers both starting states:
--   (A) A database that already has `duels.word` (e.g. an older prod DB) —
--       the word is copied into duel_secrets and the column is dropped.
--   (B) A database where the duel tables were created already in the split
--       shape (e.g. via Drizzle's create-table migration) — the guards make
--       every step a no-op.
--
-- NOTE ON OWNERSHIP: table structure is normally owned by Drizzle. This lives
-- in a Supabase migration because the local dev DB received the split via an
-- ad-hoc `db:push` that produced no committed migration, leaving no reproducible
-- source of truth for prod. Keeping it here guarantees prod can be rebuilt.

-- 1. Create duel_secrets if it does not already exist. Requires `duels` to
--    exist first (FK target); guard on that so a truly fresh DB where the
--    duel tables have not yet been created skips cleanly rather than erroring.
do $$
begin
  if to_regclass('public.duels') is not null
     and to_regclass('public.duel_secrets') is null
  then
    create table public.duel_secrets (
      duel_id uuid primary key references public.duels(id) on delete cascade,
      word text not null
    );
  end if;
end $$;

-- 2. If `duels` still has a `word` column, backfill existing rows into
--    duel_secrets, then drop the column. Skipped entirely once the column is
--    already gone.
do $$
begin
  if to_regclass('public.duels') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'duels'
         and column_name = 'word'
     )
  then
    insert into public.duel_secrets (duel_id, word)
    select id, word from public.duels
    on conflict (duel_id) do nothing;

    alter table public.duels drop column word;
  end if;
end $$;
