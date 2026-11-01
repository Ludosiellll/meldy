-- Rollback of supabase/migrations/20261106090200_live_duel.sql (LOCAL rehearsal: supabase/tests/local/live_game_run.sh).
-- The migration only added: its functions and its four tables go (with every duel, seat, question and answer), and the
-- address throttle. Nothing it did not make is touched. Re-runnable.

-- one request, one transaction: a lock held by a busy game must not queue everything behind it
set local lock_timeout = '2s';

drop function if exists public.duel_create(jsonb, jsonb, text, text, jsonb);
drop function if exists public.duel_info(text);
drop function if exists public.duel_join(text, text, text, jsonb);
drop function if exists public.duel_state(text, text, bigint);
drop function if exists public.duel_ready(text, text);
drop function if exists public.duel_answer(text, text, integer, jsonb);
drop function if exists public.duel_next(text, text, integer);
drop function if exists public.duel_rematch(text, text);
drop function if exists public.duel_review(text, text);
drop function if exists public.duel_practice(text, text);

do $do$
begin
  -- the functions that take the tables' row types go before the tables
  if pg_catalog.to_regclass('public.live_duels') is not null then
    drop function if exists meldy_private.live_duel_json(public.live_duels, public.live_duel_seats);
    drop function if exists meldy_private.live_duel_info_json(public.live_duels);
    drop function if exists meldy_private.live_duel_key(public.live_duel_questions, smallint[]);
    drop function if exists meldy_private.live_duel_side(public.live_duel_answers, smallint[], boolean);
    drop function if exists meldy_private.live_duel_insert(public.live_duels);
    drop function if exists meldy_private.live_duel_rev(public.live_duels);
    drop function if exists meldy_private.live_duel_reveal_end(public.live_duel_questions);
    drop function if exists meldy_private.live_duel_share(public.live_duel_questions, smallint, smallint[], text);
  end if;
end;
$do$;
drop function if exists meldy_private.live_duel_rematch_make(uuid);
drop function if exists meldy_private.live_duel_fill(uuid, uuid[]);
drop function if exists meldy_private.live_duel_limits(uuid, text, boolean);
drop function if exists meldy_private.live_duel_enter(text, text);
drop function if exists meldy_private.live_duel_of(text);
drop function if exists meldy_private.live_duel_settle(uuid, uuid);
drop function if exists meldy_private.live_duel_end(uuid, text, timestamptz, smallint);
drop function if exists meldy_private.live_duel_close(uuid, timestamptz);
drop function if exists meldy_private.live_duel_open(uuid, integer, timestamptz);
drop function if exists meldy_private.live_duel_bump(uuid);
drop function if exists meldy_private.live_duel_here(timestamptz, timestamptz);
drop function if exists meldy_private.live_duel_rude(text);
drop function if exists meldy_private.live_duel_winner(integer, integer, integer, integer);
drop function if exists meldy_private.live_duel_points(integer, boolean, double precision, integer, integer, boolean, boolean);

drop table if exists public.live_duel_answers;
drop table if exists public.live_duel_seats;
drop table if exists public.live_duel_questions;
drop table if exists public.live_duels;
drop table if exists meldy_private.live_duel_hits;
