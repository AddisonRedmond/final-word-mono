-- Guess privacy, CONTRACT step A. Run MANUALLY, ONLY AFTER the guess-privacy
-- code (server + client) is deployed and live. Not a migration on purpose:
-- running it too early would blank guesses that older still-running code reads.
--
-- Until this runs, `duel_participants.guesses` still holds the old plaintext
-- guesses and remains readable by participants through realtime/PostgREST, so
-- the leak is NOT closed until this is applied. Run it promptly after deploy.
--
-- Safe for older clients: they still SELECT the column, they just get empty
-- arrays (their own board is driven by tRPC responses, not this column).
-- A later "contract B" release drops the column entirely.

-- Sanity check first: every row with legacy guesses must already be in
-- duel_guesses. This should return 0 rows.
select dp.duel_id, dp.user_id
from public.duel_participants dp
left join public.duel_guesses dg
  on dg.duel_id = dp.duel_id and dg.user_id = dp.user_id
where cardinality(dp.guesses) > 0
  and (dg.user_id is null or cardinality(dg.guesses) < cardinality(dp.guesses));

-- If the query above returned no rows:
update public.duel_participants
set guesses = '{}'
where cardinality(guesses) > 0;
