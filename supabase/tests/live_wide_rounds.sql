-- Run once after migration 20261031090000_live_wide_rounds.sql: the read-only check of that apply (run live_pictures.sql,
-- live_game.sql, live_stand.sql, live_mixed.sql too). A DO block that raises nothing when every check holds
-- (supabase/migrate.py); it raises the name of the first one that does not. Catalog only.
-- Checks: live_create draws with the wide rule (one right option of 2–6, pictures allowed) for every game — a battle, a
-- battle with movement rounds and «Встань на ответ» — in its three draws, never with the old four-option rule; it stays
-- SECURITY DEFINER with search_path = '' and executable by anon and authenticated (it checks the caller itself); the
-- room's write of a round (live_stand_close) takes the zones 0–5, still below the question's option count. The behaviour
-- (a stand game and a mixed game take the five- and six-option questions; a round's write with Д and Е) is rehearsed
-- locally: supabase/tests/local/live_game_run.sh.
DO $check$
DECLARE
  v_fn record;
  v_src text;
BEGIN
  SELECT p.oid, p.prosrc, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS cfg INTO v_fn
    FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.live_create(jsonb, jsonb)');
  IF v_fn.oid IS NULL THEN
    RAISE EXCEPTION 'create_exists';
  END IF;
  v_src := v_fn.prosrc;
  IF pg_catalog.strpos(v_src, 'v_wide := true;') = 0 OR pg_catalog.strpos(v_src, 'v_wide := v_mode') > 0 THEN
    RAISE EXCEPTION 'create_wide_for_every_game';
  END IF;
  IF (pg_catalog.length(v_src) - pg_catalog.length(pg_catalog.replace(v_src, 'meldy_private.live_playable(i, v_wide)', '')))
       / pg_catalog.length('meldy_private.live_playable(i, v_wide)') <> 3
     OR pg_catalog.strpos(v_src, 'meldy_private.live_playable(i)') > 0 THEN
    RAISE EXCEPTION 'create_draws_with_the_wide_rule';
  END IF;
  IF NOT v_fn.prosecdef OR v_fn.cfg NOT IN ('search_path=""', 'search_path=') THEN
    RAISE EXCEPTION 'create_definer_empty_search_path';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'create_grants';
  END IF;
  IF pg_catalog.to_regprocedure('meldy_private.live_playable(public.test_items, boolean)') IS NULL THEN
    RAISE EXCEPTION 'playable_wide_exists';
  END IF;
  -- the room's write of a round takes the zones Д and Е, still below the question's option count, as the definer it was
  SELECT p.oid, p.prosrc, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS cfg INTO v_fn
    FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.live_stand_close(uuid, text, integer, jsonb)');
  IF v_fn.oid IS NULL OR pg_catalog.strpos(v_fn.prosrc, '(e ->> ''c'') !~ ''^[0-5]$''') = 0
     OR pg_catalog.strpos(v_fn.prosrc, '^[0-3]$') > 0 OR pg_catalog.strpos(v_fn.prosrc, '(e ->> ''c'')::integer >= v_n') = 0 THEN
    RAISE EXCEPTION 'stand_close_takes_six_zones';
  END IF;
  IF NOT v_fn.prosecdef OR v_fn.cfg NOT IN ('search_path=""', 'search_path=')
     OR NOT pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'stand_close_definer_and_grants';
  END IF;
END
$check$;
