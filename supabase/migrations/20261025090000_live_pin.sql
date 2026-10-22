-- live_pin (the phone's PIN step: is there a game to join with this PIN, answered as data)
-- Repo file: supabase/migrations/20261025090000_live_pin.sql. Base: 20261021090000_live_game.sql (public.live_join and
-- meldy_private.live_join_as as that file made them; no later migration changes either). Independent of
-- 20261022090000_live_stand.sql, 20261023090000_live_stand_phone.sql and 20261024090000_live_mixed.sql.
-- Contract: docs/live/CONTRACT.md §8 (Player). Check after the apply: supabase/tests/live_pin.sql (catalog and pure
-- calls; read-only). Local rehearsal (never live): supabase/tests/local/live_game_run.sh, its PIN stage
-- (live_pin_behaviour.sql, real.ts end to end). Rollback: supabase/rollback/20261025090000_live_pin_down.sql.
--
-- The phone's «Дальше» on the PIN called live_join with an empty name and read the refusal, so every join logged a 400
-- on rpc/live_join in the browser. public.live_pin(p_pin, p_token) makes that same call inside the database:
-- live_join(p_pin, '', p_token, null) in a block that catches its refusal (sqlstate PGRST, meldy_private.live_fail) and
-- returns it as JSON, so the browser gets 200 for every expected outcome:
--   {"status": "open", "mode": "boss" | "stand"}      the empty name was the first thing refused (ML006): a game this
--                                                      caller may join; the client shows the character next;
--   {"status": "joined", …JoinResult}                 this identity (the same token, or the same signed-in account) is
--                                                      in the game already: live_join took it back with this token, as
--                                                      it always did; the client goes straight to the game;
--   {"status": "refused", "code", "detail", "http", "retry_after"}   any other refusal, with live_join's code, details,
--                                                      HTTP status and Retry-After seconds (ML005, else null), so the
--                                                      client keeps its texts (P0002 pin, ML002, ML003, ML001, ML005,
--                                                      42501 kicked, 22023 token).
-- One source of truth: every check (the token, the PIN, the game's state and its 3 hours, the joins a minute per address
-- and per game, members only, 300 players, kicked) and the take-back are live_join's and meldy_private.live_join_as's,
-- called here, not copied. A refusal rolls the block back (live_settle's lazy time moves, the throttle's pruning): the
-- check writes nothing and counts no join, and the name '' never passes meldy_private.live_name_check, so it makes no
-- player. Only the take-back writes (the new token's hash), exactly what live_join writes for that identity.
-- No new limit: live_join refuses a wrong PIN before any limit, and so does this; it exposes nothing live_join did not.
-- anon and authenticated, SECURITY DEFINER, search_path = ''. live_join is unchanged: clients that still call it work.
-- Re-runnable: OR REPLACE. The whole file is one request (supabase/migrate.py).

do $do$
begin
  if pg_catalog.to_regprocedure('public.live_join(text, text, text, jsonb)') is null
     or pg_catalog.to_regprocedure('meldy_private.live_game_of_pin(text)') is null
     or pg_catalog.to_regprocedure('meldy_private.live_fail(text, text, integer, integer)') is null then
    raise exception 'the base is expected: 20261021090000_live_game.sql';
  end if;
end;
$do$;

-- The PIN step. live_fail's message is the body {code, message, details}; its detail is {status, headers}.
create or replace function public.live_pin(p_pin text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_joined jsonb;
  v_body jsonb;
  v_http jsonb;
  v_message text;
  v_detail text;
begin
  begin
    v_joined := public.live_join(p_pin, '', p_token, null);
  exception
    when sqlstate 'PGRST' then
      get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail;
      v_body := v_message::jsonb;
      v_http := v_detail::jsonb;
  end;
  if v_body is null then
    return pg_catalog.jsonb_build_object('status', 'joined') || v_joined;
  end if;
  if v_body ->> 'code' = 'ML006' then
    return pg_catalog.jsonb_build_object('status', 'open', 'mode',
             (select g.mode from public.live_games g where g.id = meldy_private.live_game_of_pin(p_pin)));
  end if;
  return pg_catalog.jsonb_build_object('status', 'refused', 'code', v_body ->> 'code', 'detail', v_body -> 'details',
                                       'http', (v_http ->> 'status')::integer,
                                       'retry_after', (v_http -> 'headers' ->> 'Retry-After')::integer);
end;
$fn$;

-- ─────────────────────────────────────────── Grants ───────────────────────────────────────────
-- Supabase gives new public functions to anon and authenticated and PostgreSQL to PUBLIC: taken back, then given as
-- live_join is.
revoke all on function public.live_pin(text, text) from public, anon, authenticated;
grant execute on function public.live_pin(text, text) to anon, authenticated;
