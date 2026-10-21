-- Run once after migration 20261022090000_live_stand.sql: the read-only check of that apply (run live_game.sql too). A DO
-- block that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does
-- not. Catalog only, plus the pure numbers (no row is read or written).
-- Checks: live_games.mode takes 'boss' and 'stand' only, boss_kind 'clock' | 'skeleton' (default clock), a stand game's
-- time is 15, 20 or 30 and a battle's 10, 20 or 30; live_answers.dmg up to 1400; the tables still closed to the API
-- roles; public.live_stand_close is SECURITY DEFINER with search_path = '', executable by anon and authenticated (not
-- PUBLIC), authorised by the host token, closing through live_close; the new helpers are private; live_answer refuses a
-- stand game; live_close hands a stand game to live_close_stand; an open stand question waits 8 s; live_advance ends a
-- stand game only after its last question; the key leaves only from a closed question; the worked numbers of
-- docs/live/MODE_STAND.md §6.
-- The behaviour is rehearsed locally: supabase/tests/local/live_game_run.sh (live_stand_behaviour.sql).
DO $check$
DECLARE
  v_src text;
  v_fn record;
  v_g public.live_games;
BEGIN
  -- 1. Columns and checks.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'live_games' AND c.column_name = 'boss_kind'
                    AND c.data_type = 'text' AND c.is_nullable = 'NO' AND c.column_default = '''clock''::text') THEN
    RAISE EXCEPTION 'boss_kind_column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_games'::regclass AND k.conname = 'live_games_mode_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((mode = ANY (ARRAY[''boss''::text, ''stand''::text])))') THEN
    RAISE EXCEPTION 'mode_boss_or_stand';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_games'::regclass AND k.conname = 'live_games_boss_kind_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK ((boss_kind = ANY (ARRAY[''clock''::text, ''skeleton''::text])))') THEN
    RAISE EXCEPTION 'boss_clock_or_skeleton';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_games'::regclass AND k.conname = 'live_games_time_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''stand''%ARRAY[15, 20, 30]%ARRAY[10, 20, 30]%') THEN
    RAISE EXCEPTION 'time_by_mode';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_answers'::regclass AND k.conname = 'live_answers_dmg_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%(dmg <= 1400)%') THEN
    RAISE EXCEPTION 'points_up_to_1400';
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.live_games', 'SELECT,INSERT,UPDATE,DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.live_answers', 'SELECT,INSERT,UPDATE,DELETE')
     OR pg_catalog.has_column_privilege('anon', 'public.live_games', 'boss_kind', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid IN ('public.live_games'::regclass, 'public.live_answers'::regclass)) THEN
    RAISE EXCEPTION 'tables_closed';
  END IF;

  -- 2. The room's write.
  SELECT p.oid, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS cfg, p.prosrc INTO v_fn
    FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.live_stand_close(uuid,text,integer,jsonb)');
  IF v_fn.oid IS NULL THEN
    RAISE EXCEPTION 'live_stand_close_signature';
  END IF;
  IF NOT v_fn.prosecdef OR v_fn.cfg NOT IN ('search_path=""', 'search_path=') THEN
    RAISE EXCEPTION 'live_stand_close_definer_and_empty_search_path';
  END IF;
  IF NOT pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') OR NOT pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid = v_fn.oid AND a.grantee = 0) THEN
    RAISE EXCEPTION 'live_stand_close_for_anon_and_authenticated_only';
  END IF;
  IF pg_catalog.strpos(v_fn.prosrc, 'meldy_private.live_host_game(p_game, p_host_token, true)') = 0
     OR pg_catalog.strpos(v_fn.prosrc, 'perform meldy_private.live_close(p_game);') = 0
     OR pg_catalog.strpos(v_fn.prosrc, 'p.kicked_at is null and p.joined_at <= v_g.q_opens_at') = 0
     OR pg_catalog.strpos(v_fn.prosrc, 'jsonb_array_length(p_answers) > 300') = 0 THEN
    RAISE EXCEPTION 'live_stand_close_host_token_lock_close_and_limits';
  END IF;
  FOR v_fn IN SELECT p.oid, p.proname, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS cfg
                FROM pg_catalog.pg_proc p
               WHERE p.oid IN (pg_catalog.to_regprocedure('meldy_private.live_stand_points(integer,integer,integer,boolean,boolean)'),
                               pg_catalog.to_regprocedure('meldy_private.live_close_stand(uuid)'),
                               pg_catalog.to_regprocedure('meldy_private.live_stand_result(uuid,integer,boolean)')) LOOP
    IF v_fn.prosecdef OR v_fn.cfg NOT IN ('search_path=""', 'search_path=')
       OR pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid = v_fn.oid AND a.grantee = 0) THEN
      RAISE EXCEPTION 'stand_helpers_private: %', v_fn.proname;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'meldy_private' AND p.proname IN ('live_stand_points', 'live_close_stand', 'live_stand_result')) <> 3 THEN
    RAISE EXCEPTION 'stand_helpers_exist';
  END IF;

  -- 3. The engine's stand branch.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_answer(uuid,text,integer,integer)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'if v_g.mode = ''stand'' then') = 0 OR pg_catalog.strpos(v_src, 'live_fail(''ML004'', ''stand'')') = 0 THEN
    RAISE EXCEPTION 'no_taps_in_a_stand_game';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_close(uuid)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'perform meldy_private.live_close_stand(p_game);') = 0 THEN
    RAISE EXCEPTION 'stand_closes_its_own_way';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_advance(uuid)'::regprocedure;
  IF pg_catalog.strpos(v_src, '(v_g.mode = ''boss'' and v_g.hp = 0) or v_g.qi >= v_g.q_count - 1') = 0 THEN
    RAISE EXCEPTION 'stand_podium_after_the_last_question';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_countdown(uuid,integer)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'if p_qi = 0 and v_g.mode = ''boss'' then') = 0 THEN
    RAISE EXCEPTION 'no_hp_in_a_stand_game';
  END IF;
  v_g := pg_catalog.jsonb_populate_record(null::public.live_games, pg_catalog.jsonb_build_object(
           'state', 'open', 'mode', 'stand', 'created_at', pg_catalog.now(), 'q_closes_at', pg_catalog.now() - interval '7.9 seconds'));
  IF meldy_private.live_due(v_g, pg_catalog.now()) THEN
    RAISE EXCEPTION 'stand_waits_8_s_for_the_room';
  END IF;
  v_g.q_closes_at := pg_catalog.now() - interval '8.1 seconds';
  IF NOT meldy_private.live_due(v_g, pg_catalog.now()) THEN
    RAISE EXCEPTION 'stand_closes_by_time_after_8_s';
  END IF;
  v_g.mode := 'boss';
  v_g.q_closes_at := pg_catalog.now() - interval '1.6 seconds';
  IF NOT meldy_private.live_due(v_g, pg_catalog.now()) THEN
    RAISE EXCEPTION 'battle_still_1_5_s';
  END IF;

  -- 4. The key leaves only from a closed question.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_stand_result(uuid,integer,boolean)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'q.qi = p_qi and q.closed_at is not null') = 0 THEN
    RAISE EXCEPTION 'stand_key_only_after_close';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public', 'meldy_private') AND p.proname IN ('live_base_json', 'live_host_json', 'live_player_json', 'live_answer')
                AND p.prosrc ~ '''key''') THEN
    RAISE EXCEPTION 'no_key_elsewhere';
  END IF;

  -- 5. The worked numbers (MODE_STAND.md §6).
  IF meldy_private.live_stand_points(3000, 15, 1, true, false) <> 900 OR meldy_private.live_stand_points(6000, 15, 3, true, false) <> 960
     OR meldy_private.live_stand_points(4321, 15, 2, true, false) <> 940 OR meldy_private.live_stand_points(0, 15, 5, true, false) <> 1400
     OR meldy_private.live_stand_points(0, 15, 9, true, false) <> 1400 OR meldy_private.live_stand_points(15000, 15, 1, true, false) <> 500
     OR meldy_private.live_stand_points(7500, 15, 1, true, true) <> 380 OR meldy_private.live_stand_points(3000, 15, 1, true, true) <> 450
     OR meldy_private.live_stand_points(15000, 15, 1, true, true) <> 250 OR meldy_private.live_stand_points(9000, 15, 1, false, false) <> 1000 THEN
    RAISE EXCEPTION 'stand_points';
  END IF;
END
$check$;
