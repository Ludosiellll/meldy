-- Rollback of supabase/migrations/20261106090100_live_challenge.sql (LOCAL rehearsal: supabase/tests/local/live_game_run.sh).
-- The migration only added: its functions and its four tables go (with every challenge, run and answer), and the address
-- throttle of starts. Nothing it did not make is touched. Re-runnable.

-- one request, one transaction: a table lock held by a busy game must not queue everything behind it
set local lock_timeout = '5s';

drop function if exists public.challenge_create(jsonb, jsonb);
drop function if exists public.challenge_close(uuid);
drop function if exists public.challenge_remove(uuid, uuid);
drop function if exists public.challenge_results(uuid);
drop function if exists public.challenges_mine(uuid);
drop function if exists public.challenge_info(text);
drop function if exists public.challenge_join(text, text, text, jsonb);
drop function if exists public.challenge_state(text, text);
drop function if exists public.challenge_next(text, text, integer);
drop function if exists public.challenge_answer(text, text, integer, jsonb);
drop function if exists public.challenge_board(text, text);
drop function if exists public.challenge_review(text, text);
drop function if exists public.challenge_practice(text, text);

do $do$
begin
  -- the functions that take the tables' row types go before the tables
  if pg_catalog.to_regclass('public.live_challenges') is not null then
    drop function if exists meldy_private.live_challenge_owned(uuid, boolean);
    drop function if exists meldy_private.live_challenge_board_json(public.live_challenges, uuid);
    drop function if exists meldy_private.live_run_json(public.live_challenges, public.live_runs);
    drop function if exists meldy_private.live_challenge_json(public.live_challenges);
    drop function if exists meldy_private.live_run_place(public.live_runs);
    drop function if exists meldy_private.live_run_of(public.live_challenges, text, boolean);
    drop function if exists meldy_private.live_challenge_sweep_due(public.live_challenges);
    drop function if exists meldy_private.live_challenge_end_at(public.live_challenges);
    drop function if exists meldy_private.live_challenge_over(public.live_challenges);
    drop function if exists meldy_private.live_challenge_share(public.live_challenge_questions, smallint, smallint[], text);
  end if;
end;
$do$;
drop function if exists meldy_private.live_challenge_of(text, boolean);
drop function if exists meldy_private.live_challenge_sweep(uuid);
drop function if exists meldy_private.live_run_settle(uuid);
drop function if exists meldy_private.live_run_score(uuid, integer, smallint, smallint[], text, timestamptz);
drop function if exists meldy_private.live_challenge_kind(public.test_items);
drop function if exists meldy_private.live_run_perm(uuid, integer, integer, boolean);

drop table if exists public.live_run_answers;
drop table if exists public.live_runs;
drop table if exists public.live_challenge_questions;
drop table if exists public.live_challenges;
drop table if exists meldy_private.live_challenge_hits;
