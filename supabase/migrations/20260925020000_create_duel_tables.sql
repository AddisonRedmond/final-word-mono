-- Base duel tables: `duels` and `duel_participants`.
--
-- These tables were originally created outside version control (via an ad-hoc
-- `db:push`), so no committed migration reproduced them. This migration makes
-- the duel schema self-contained so a fresh database (e.g. a new prod project)
-- can be rebuilt from migrations alone.
--
-- Ordering: this runs FIRST (earliest timestamp), before
--   20260925021000_split_duel_word_into_secrets.sql   (adds duel_secrets)
--   20260925021405_enable_duel_realtime.sql           (publication + RLS)
--
-- `duels` is intentionally created WITHOUT a `word` column: the answer word
-- lives in duel_secrets (created by the split migration). On a database that
-- predates the split and still has `duels.word`, this migration is a no-op
-- (the table already exists) and the split migration handles the column.
--
-- Both tables reference `profiles`, which is created by the Drizzle baseline
-- migration (0000). The FK creation is guarded on `profiles` existing so a
-- database where profiles is not yet present skips cleanly rather than
-- erroring; the split/realtime migrations remain guarded too.

-- duels ----------------------------------------------------------------------
create table if not exists public.duels (
  id uuid primary key default gen_random_uuid() not null,
  initiated_by uuid not null,
  created_at timestamp with time zone default now() not null,
  completed boolean default false not null,
  participants text[] not null,
  winner uuid
);

-- duel_participants ----------------------------------------------------------
create table if not exists public.duel_participants (
  duel_id uuid not null,
  user_id uuid not null,
  start_time timestamp with time zone,
  end_time timestamp with time zone,
  total_guesses integer default 0 not null,
  success boolean default false not null,
  guesses text[] default '{}' not null,
  accepted boolean,
  completed_game_acknowledged boolean default false,
  constraint duel_participants_duel_id_user_id_pk primary key (duel_id, user_id)
);

-- Foreign keys (added separately so we can guard on referenced tables and
-- reuse the exact constraint names Drizzle expects, keeping fresh databases
-- byte-identical to existing ones). Each is guarded against duplicate creation.
do $$
begin
  if to_regclass('public.profiles') is not null
     and not exists (
       select 1 from pg_constraint
       where conname = 'duels_initiated_by_profiles_id_fk'
     )
  then
    alter table public.duels
      add constraint duels_initiated_by_profiles_id_fk
      foreign key (initiated_by) references public.profiles(id) on delete cascade;
  end if;

  if to_regclass('public.profiles') is not null
     and not exists (
       select 1 from pg_constraint
       where conname = 'duels_winner_profiles_id_fk'
     )
  then
    alter table public.duels
      add constraint duels_winner_profiles_id_fk
      foreign key (winner) references public.profiles(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'duel_participants_duel_id_duels_id_fk'
  )
  then
    alter table public.duel_participants
      add constraint duel_participants_duel_id_duels_id_fk
      foreign key (duel_id) references public.duels(id) on delete cascade;
  end if;

  if to_regclass('public.profiles') is not null
     and not exists (
       select 1 from pg_constraint
       where conname = 'duel_participants_user_id_profiles_id_fk'
     )
  then
    alter table public.duel_participants
      add constraint duel_participants_user_id_profiles_id_fk
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;
