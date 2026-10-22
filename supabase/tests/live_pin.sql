-- Run once after migration 20261025090000_live_pin.sql: the read-only check of that apply (run live_game.sql too). A DO
-- block that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does
-- not. Catalog only, plus pure calls (a malformed PIN, a malformed token, the empty name: no row is read or written).
-- Checks: public.live_pin(text, text) is the only live_pin, returns jsonb, is volatile, SECURITY DEFINER with
-- search_path = '', executable by anon and authenticated and not by PUBLIC (as live_join); its body is live_join with
-- the empty name inside a block that catches live_fail's refusal (sqlstate PGRST) and nothing else, writes no table
-- itself, answers ML006 as «open» with the game's mode and every other refusal as «refused» with live_join's code,
-- details, HTTP status and Retry-After, and a join as «joined»; live_join and live_join_as are as
-- 20261021090000_live_game.sql made them where live_pin relies on them (the take-back before every new-player check,
-- the name checked after the PIN, the state, the limits, members only and the 300 players, and before the insert); the
-- empty name is refused (ML006 length), so the check never makes a player; a malformed PIN answers 200 with
-- {"status": "refused", "code": "P0002", "detail": "pin", "http": 404} and a malformed token with 22023/token/400.
-- The behaviour (wrong PIN, finished game, members only, kicked, already joined by token and by account, open game, no
-- row written by the check) is rehearsed locally: supabase/tests/local/live_game_run.sh (live_pin_behaviour.sql).
DO $check$
DECLARE
  v_fn record;
  v_src text;
  v_r jsonb;
  v_code text;
BEGIN
  -- 1. The function.
  SELECT p.oid, p.prosecdef, p.provolatile, p.prorettype, pg_catalog.array_to_string(p.proconfig, ',') AS cfg
    INTO v_fn FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.live_pin(text, text)');
  IF v_fn.oid IS NULL THEN
    RAISE EXCEPTION 'live_pin_exists';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE p.proname = 'live_pin') <> 1 THEN
    RAISE EXCEPTION 'one_live_pin';
  END IF;
  IF v_fn.prorettype <> 'jsonb'::regtype OR v_fn.provolatile <> 'v' THEN
    RAISE EXCEPTION 'live_pin_volatile_jsonb';
  END IF;
  IF NOT v_fn.prosecdef OR v_fn.cfg NOT IN ('search_path=""', 'search_path=') THEN
    RAISE EXCEPTION 'live_pin_definer_and_empty_search_path';
  END IF;
  IF NOT pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                 WHERE p.oid = v_fn.oid AND a.grantee = 0) THEN
    RAISE EXCEPTION 'live_pin_for_anon_and_authenticated_not_public';
  END IF;

  -- 2. Its body: live_join with the empty name, refusals as data, nothing written of its own.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn.oid;
  IF pg_catalog.strpos(v_src, 'v_joined := public.live_join(p_pin, '''', p_token, null);') = 0
     OR pg_catalog.strpos(v_src, 'when sqlstate ''PGRST'' then') = 0
     OR pg_catalog.strpos(v_src, 'get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail;') = 0 THEN
    RAISE EXCEPTION 'live_pin_is_live_join_with_the_empty_name';
  END IF;
  IF v_src ~* '\mwhen\s+others\M' OR v_src ~* '\m(insert\s+into|update\s+public|delete\s+from|perform)\M' THEN
    RAISE EXCEPTION 'live_pin_catches_only_refusals_and_writes_nothing_itself';
  END IF;
  IF pg_catalog.strpos(v_src, 'pg_catalog.jsonb_build_object(''status'', ''joined'') || v_joined') = 0
     OR pg_catalog.strpos(v_src, 'if v_body ->> ''code'' = ''ML006'' then') = 0
     OR pg_catalog.strpos(v_src, '(select g.mode from public.live_games g where g.id = meldy_private.live_game_of_pin(p_pin))') = 0
     OR pg_catalog.strpos(v_src, '''http'', (v_http ->> ''status'')::integer') = 0
     OR pg_catalog.strpos(v_src, '''retry_after'', (v_http -> ''headers'' ->> ''Retry-After'')::integer') = 0 THEN
    RAISE EXCEPTION 'live_pin_open_joined_refused';
  END IF;

  -- 3. What it relies on in live_join and live_join_as (20261021090000_live_game.sql).
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_join(text,text,text,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''22023'', ''token'');') = 0
     OR pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''P0002'', ''pin'', 404);') = 0
     OR pg_catalog.strpos(v_src, 'v_g := meldy_private.live_settle(v_id, true);') = 0
     OR pg_catalog.strpos(v_src, 'return meldy_private.live_join_as(v_g, v_user, null, case when v_user is null then v_hash end, v_hash, p_name, p_look,') = 0 THEN
    RAISE EXCEPTION 'live_join_as_the_live_game_migration_made_it';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'meldy_private.live_join_as(public.live_games,uuid,bigint,text,text,text,jsonb,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'if found then') = 0
     OR pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''42501'', ''kicked'', 403);') = 0
     OR pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''42501'', ''kicked'', 403);') > pg_catalog.strpos(v_src, 'update public.live_players p')
     OR pg_catalog.strpos(v_src, 'if found then') > pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''ML003'', ''members'', 403);') THEN
    RAISE EXCEPTION 'join_as_takes_back_the_same_identity_first';
  END IF;
  -- The name comes after every refusal of a new player and before anything is written for one.
  IF pg_catalog.strpos(v_src, 'v_name := meldy_private.live_name_check(p_name);') = 0
     OR pg_catalog.strpos(v_src, 'v_name := meldy_private.live_name_check(p_name);') < pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''ML003'', ''members'', 403);')
     OR pg_catalog.strpos(v_src, 'v_name := meldy_private.live_name_check(p_name);') < pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''ML001'', null);')
     OR pg_catalog.strpos(v_src, 'v_name := meldy_private.live_name_check(p_name);') < pg_catalog.strpos(v_src, 'p.joined_at > pg_catalog.now() - interval ''1 minute'') >= 120')
     OR pg_catalog.strpos(v_src, 'v_name := meldy_private.live_name_check(p_name);') > pg_catalog.strpos(v_src, 'insert into public.live_players')
     OR pg_catalog.strpos(v_src, 'v_name := meldy_private.live_name_check(p_name);') > pg_catalog.strpos(v_src, 'insert into meldy_private.live_join_hits')
     OR pg_catalog.strpos(v_src, 'v_name := meldy_private.live_name_check(p_name);') > pg_catalog.strpos(v_src, 'update public.live_games g') THEN
    RAISE EXCEPTION 'join_as_checks_the_name_after_the_room_and_before_writing';
  END IF;

  -- 4. Pure calls: the empty name is refused; a malformed PIN or token answers as data (no row is read).
  BEGIN
    PERFORM meldy_private.live_name_check('');
    v_code := 'none';
  EXCEPTION
    WHEN sqlstate 'PGRST' THEN
      v_code := (SQLERRM::jsonb ->> 'code') || '/' || (SQLERRM::jsonb ->> 'details');
  END;
  IF v_code IS DISTINCT FROM 'ML006/length' THEN
    RAISE EXCEPTION 'the_empty_name_is_refused: %', v_code;
  END IF;
  v_r := public.live_pin('12ab56', 'tok' || pg_catalog.repeat('0', 40));
  IF v_r IS DISTINCT FROM '{"status": "refused", "code": "P0002", "detail": "pin", "http": 404, "retry_after": null}'::jsonb THEN
    RAISE EXCEPTION 'malformed_pin_refused_as_data: %', v_r;
  END IF;
  v_r := public.live_pin('123456', 'short');
  IF v_r IS DISTINCT FROM '{"status": "refused", "code": "22023", "detail": "token", "http": 400, "retry_after": null}'::jsonb THEN
    RAISE EXCEPTION 'malformed_token_refused_as_data: %', v_r;
  END IF;
END
$check$;
