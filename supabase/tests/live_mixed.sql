-- Run once after migration 20261024090000_live_mixed.sql: the read-only check of that apply (run live_game.sql and
-- live_stand.sql too). A DO block that raises nothing when every check holds (supabase/migrate.py); it raises the name
-- of the first one that does not. Catalog only, plus the pure rule and numbers (no row is read or written).
-- Checks: live_games.stand_every 0 | 3 | 5 | 10, default 0, non-zero only in a battle game; live_questions.room_at; the
-- tables still closed to the API roles; meldy_private.live_stand_round (which question is a movement round) and
-- live_mixed_result are private; no new public function; live_stand_close takes a mixed game's movement round only
-- (ML004 tap), marks it the room's and closes it through live_close; live_answer refuses a movement round; live_close
-- freezes «no zone» in a movement round in any phase and leaves a void one alone; an open movement round waits 8 s for
-- the room; the key leaves only from a closed question; the worked example of docs/live/MODE_MIXED.md §5.
-- The behaviour is rehearsed locally: supabase/tests/local/live_game_run.sh (live_mixed_behaviour.sql, the room end to end).
DO $check$
DECLARE
  v_src text;
  v_fn record;
  v_g public.live_games;
  v_rounds text;
BEGIN
  -- 1. Columns and checks.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'live_games' AND c.column_name = 'stand_every'
                    AND c.data_type = 'smallint' AND c.is_nullable = 'NO' AND c.column_default = '0') THEN
    RAISE EXCEPTION 'stand_every_column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_games'::regclass AND k.conname = 'live_games_stand_every_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%ARRAY[0, 3, 5, 10]%'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%(stand_every = 0) OR (mode = ''boss''::text)%') THEN
    RAISE EXCEPTION 'stand_every_0_3_5_10_battle_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'live_questions' AND c.column_name = 'room_at'
                    AND c.data_type = 'timestamp with time zone' AND c.is_nullable = 'YES') THEN
    RAISE EXCEPTION 'room_at_column';
  END IF;
  IF pg_catalog.has_table_privilege('anon', 'public.live_games', 'SELECT,INSERT,UPDATE,DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.live_questions', 'SELECT,INSERT,UPDATE,DELETE')
     OR pg_catalog.has_column_privilege('anon', 'public.live_games', 'stand_every', 'SELECT')
     OR pg_catalog.has_column_privilege('authenticated', 'public.live_questions', 'room_at', 'SELECT')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid IN ('public.live_games'::regclass, 'public.live_questions'::regclass)) THEN
    RAISE EXCEPTION 'tables_closed';
  END IF;

  -- 2. The rule: every Nth question; the last one when the game is shorter than N; nothing without N.
  SELECT pg_catalog.string_agg(x.case_name || '=' || coalesce((SELECT pg_catalog.string_agg(s::text, ',' ORDER BY s)
                                                                 FROM pg_catalog.generate_series(0, x.q - 1) s
                                                                WHERE meldy_private.live_stand_round(x.n, x.q, s)), '-'), ' ' ORDER BY x.ord)
    INTO v_rounds
    FROM (VALUES (1, '3of6', 3, 6), (2, '3of7', 3, 7), (3, '5of12', 5, 12), (4, '10of30', 10, 30), (5, '10of6', 10, 6),
                 (6, '5of4', 5, 4), (7, '3of1', 3, 1), (8, '0of6', 0, 6), (9, 'nullof6', NULL, 6), (10, '3of3', 3, 3)) AS x(ord, case_name, n, q);
  IF v_rounds <> '3of6=2,5 3of7=2,5 5of12=4,9 10of30=9,19,29 10of6=5 5of4=3 3of1=0 0of6=- nullof6=- 3of3=2' THEN
    RAISE EXCEPTION 'stand_round_rule: %', v_rounds;
  END IF;
  IF meldy_private.live_stand_round(3, 6, -1) OR meldy_private.live_stand_round(3, 6, 8) OR meldy_private.live_stand_round(3, NULL, 2) THEN
    RAISE EXCEPTION 'stand_round_out_of_range';
  END IF;

  -- 3. The helpers are private; no new public function (18 of live_game.sql + live_stand_close).
  FOR v_fn IN SELECT p.oid, p.proname, p.prosecdef, p.provolatile, pg_catalog.array_to_string(p.proconfig, ',') AS cfg
                FROM pg_catalog.pg_proc p
               WHERE p.oid IN (pg_catalog.to_regprocedure('meldy_private.live_stand_round(integer,integer,integer)'),
                               pg_catalog.to_regprocedure('meldy_private.live_mixed_result(uuid,integer,boolean)')) LOOP
    IF v_fn.prosecdef OR v_fn.cfg NOT IN ('search_path=""', 'search_path=')
       OR pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid = v_fn.oid AND a.grantee = 0) THEN
      RAISE EXCEPTION 'mixed_helpers_private: %', v_fn.proname;
    END IF;
    IF v_fn.proname = 'live_stand_round' AND v_fn.provolatile <> 'i' THEN
      RAISE EXCEPTION 'stand_round_immutable';
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'meldy_private' AND p.proname IN ('live_stand_round', 'live_mixed_result')) <> 2 THEN
    RAISE EXCEPTION 'mixed_helpers_exist';
  END IF;
  -- 19 (live_game's 18 and live_stand_close), and live_pin once 20261025090000_live_pin.sql is applied.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND (p.proname LIKE 'live\_%' OR p.proname LIKE 'bot\_live\_%'))
     <> 19 + (CASE WHEN pg_catalog.to_regprocedure('public.live_pin(text,text)') IS NULL THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'no_new_public_function';
  END IF;

  -- 4. The room's write takes a mixed game's movement round and closes it through the battle's close.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_stand_close(uuid,text,integer,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'v_mixed := v_g.mode = ''boss'' and v_g.stand_every > 0;') = 0
     OR pg_catalog.strpos(v_src, 'if v_mixed and not meldy_private.live_stand_round(v_g.stand_every, v_g.q_count, p_qi) then') = 0
     OR pg_catalog.strpos(v_src, 'live_fail(''ML004'', ''tap'')') = 0
     OR pg_catalog.strpos(v_src, 'set room_at = pg_catalog.now() where q.game_id = p_game and q.qi = v_g.qi;') = 0
     OR pg_catalog.strpos(v_src, 'perform meldy_private.live_close(p_game);') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.live_mixed_result(p_game, p_qi, false)') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.live_host_game(p_game, p_host_token, true)') = 0 THEN
    RAISE EXCEPTION 'stand_close_takes_movement_rounds';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_mixed_result(uuid,integer,boolean)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'q.qi = p_qi and q.closed_at is not null') = 0 THEN
    RAISE EXCEPTION 'mixed_key_only_after_close';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_answer(uuid,text,integer,integer)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'if meldy_private.live_stand_round(v_g.stand_every, v_g.q_count, v_g.qi) then
    perform meldy_private.live_fail(''ML004'', ''stand'');') = 0 THEN
    RAISE EXCEPTION 'no_taps_in_a_movement_round';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_close(uuid)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'v_void := v_stand and v_q.room_at is null;') = 0
     OR pg_catalog.strpos(v_src, 'set streak = 0, frozen = p.frozen or v_q.phase >= 1 or v_stand') = 0
     OR pg_catalog.strpos(v_src, 'if not v_void and v_q.phase = 2 and v_hp > 0') = 0
     OR pg_catalog.strpos(v_src, 'v_dmg := meldy_private.live_damage(v_a.elapsed_ms, v_g.time_s, v_p.streak + 1, v_g.speed);') = 0 THEN
    RAISE EXCEPTION 'one_close_for_taps_and_movement';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_create(jsonb,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'live_fail(''22023'', ''stand_every'')') = 0
     OR pg_catalog.strpos(v_src, 'not in (''0'', ''3'', ''5'', ''10'')') = 0 THEN
    RAISE EXCEPTION 'create_takes_stand_every';
  END IF;

  -- 5. An open movement round waits 8 s for the room; a button question of the same game 1.5 s.
  v_g := pg_catalog.jsonb_populate_record(null::public.live_games, pg_catalog.jsonb_build_object(
           'state', 'open', 'mode', 'boss', 'stand_every', 3, 'q_count', 6, 'qi', 2, 'created_at', pg_catalog.now(),
           'q_closes_at', pg_catalog.now() - interval '7.9 seconds'));
  IF meldy_private.live_due(v_g, pg_catalog.now()) THEN
    RAISE EXCEPTION 'movement_round_waits_8_s';
  END IF;
  v_g.q_closes_at := pg_catalog.now() - interval '8.1 seconds';
  IF NOT meldy_private.live_due(v_g, pg_catalog.now()) THEN
    RAISE EXCEPTION 'movement_round_closes_by_time_after_8_s';
  END IF;
  v_g.qi := 1;
  v_g.q_closes_at := pg_catalog.now() - interval '1.6 seconds';
  IF NOT meldy_private.live_due(v_g, pg_catalog.now()) THEN
    RAISE EXCEPTION 'button_question_still_1_5_s';
  END IF;

  -- 6. The key leaves only from a closed question.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public', 'meldy_private') AND p.proname IN ('live_base_json', 'live_host_json', 'live_player_json', 'live_answer')
                AND p.prosrc ~ '''key''') THEN
    RAISE EXCEPTION 'no_key_elsewhere';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_closed_json(public.live_games)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'q.closed_at is not null') = 0 OR pg_catalog.strpos(v_src, '''reveal'', ''leaderboard'', ''podium'', ''ended''') = 0 THEN
    RAISE EXCEPTION 'key_only_after_close';
  END IF;

  -- 7. The worked example (MODE_MIXED.md §5): T 20 s, phase 2, hp 430 of 1320, four players.
  IF meldy_private.live_damage(2500, 20, 3, true) <> 141 OR meldy_private.live_damage(2500, 20, 3, false) <> 150
     OR meldy_private.live_heal(1320) <> 66 OR meldy_private.live_right_needed(4) <> 3
     OR meldy_private.live_phase_for(430 - 141 + 66, 1320) <> 2 THEN
    RAISE EXCEPTION 'worked_example';
  END IF;
END
$check$;
