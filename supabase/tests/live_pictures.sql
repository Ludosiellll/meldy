-- Run once after migration 20261030090000_live_pictures.sql: the read-only check of that apply (run live_game.sql,
-- live_stand.sql, live_mixed.sql too). A DO block that raises nothing when every check holds (supabase/migrate.py); it
-- raises the name of the first one that does not. Catalog only, plus pure calls of quiz_live_media_paths that read no row
-- (malformed or missing arguments) and one that reads a game that does not exist.
-- Checks: live_questions takes 2–6 options and live_answers a choice 0–5; live_questions.pictures (jsonb, null by
-- default) with its shape check; the BEFORE INSERT trigger live_questions_pictures runs
-- meldy_private.live_question_pictures(); meldy_private.live_playable(test_items, boolean) exists, private, keeps the old
-- rule for «not wide»; live_create draws with the wide rule only for a battle without movement rounds; live_base_json and
-- live_review add pictures only when a question has them; public.quiz_live_media_paths(uuid, text, text[]) is stable,
-- SECURITY DEFINER with search_path = '', returns jsonb, executable by service_role only, and answers [] for a bad call.
-- The behaviour (a five-option game, pictures in the shown order, what a player and the host may read and when, a stand
-- and a mixed game unchanged) is rehearsed locally: supabase/tests/local/live_game_run.sh (live_pictures_behaviour.sql).
DO $check$
DECLARE
  v_fn record;
  v_src text;
BEGIN
  -- 1. The checks and the column.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.live_questions'::regclass AND k.conname = 'live_questions_options_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%>= 2)%' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%<= 6)%') THEN
    RAISE EXCEPTION 'options_2_to_6';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.live_answers'::regclass AND k.conname = 'live_answers_choice_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%<= 5)%') THEN
    RAISE EXCEPTION 'choice_0_to_5';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'live_questions' AND c.column_name = 'pictures'
                    AND c.data_type = 'jsonb' AND c.is_nullable = 'YES' AND c.column_default IS NULL) THEN
    RAISE EXCEPTION 'pictures_column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.live_questions'::regclass AND k.conname = 'live_questions_pictures_check') THEN
    RAISE EXCEPTION 'pictures_check';
  END IF;

  -- 2. The trigger and the playable rule.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.live_questions'::regclass AND t.tgname = 'live_questions_pictures' AND NOT t.tgisinternal
                    AND t.tgenabled = 'O'
                    AND t.tgfoid = 'meldy_private.live_question_pictures()'::regprocedure
                    AND pg_catalog.pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT ON public.live_questions FOR EACH ROW%') THEN
    RAISE EXCEPTION 'pictures_trigger';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_question_pictures()'::regprocedure;
  IF pg_catalog.strpos(v_src, 'pg_catalog.unnest(new.shown) with ordinality as s(f, n)') = 0
     OR pg_catalog.strpos(v_src, 'new.pictures := null;') = 0 THEN
    RAISE EXCEPTION 'pictures_in_shown_order';
  END IF;
  SELECT p.oid, p.prosrc INTO v_fn FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.live_playable(public.test_items, boolean)');
  IF v_fn.oid IS NULL THEN
    RAISE EXCEPTION 'playable_wide_exists';
  END IF;
  IF pg_catalog.strpos(v_fn.prosrc, 'between 2 and 6') = 0
     OR pg_catalog.strpos(v_fn.prosrc, 'else meldy_private.live_playable(p_item) end') = 0 THEN
    RAISE EXCEPTION 'playable_wide_rule';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'playable_wide_private';
  END IF;
  IF pg_catalog.to_regprocedure('meldy_private.live_playable(public.test_items)') IS NULL THEN
    RAISE EXCEPTION 'playable_old_rule_kept';
  END IF;

  -- 3. Create and the screens.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_create(jsonb,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'v_wide := v_mode = ''boss'' and v_every = 0;') = 0
     OR (pg_catalog.length(v_src) - pg_catalog.length(pg_catalog.replace(v_src, 'meldy_private.live_playable(i, v_wide)', '')))
        / pg_catalog.length('meldy_private.live_playable(i, v_wide)') <> 3
     OR pg_catalog.strpos(v_src, 'meldy_private.live_playable(i)') > 0 THEN
    RAISE EXCEPTION 'create_wide_for_battle_only';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_base_json(public.live_games)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'case when v_q.pictures is not null then pg_catalog.jsonb_build_object(''pictures'', v_q.pictures) else ''{}''::jsonb end') = 0
     OR pg_catalog.strpos(v_src, '''picture'', null') = 0 THEN
    RAISE EXCEPTION 'question_pictures_only_when_any';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_review(uuid,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'case when q.pictures is not null then pg_catalog.jsonb_build_object(''pictures'', q.pictures) else ''{}''::jsonb end') = 0 THEN
    RAISE EXCEPTION 'review_pictures_only_when_any';
  END IF;

  -- 4. quiz_live_media_paths: the Edge Function's only.
  SELECT p.oid, p.prosecdef, p.provolatile, p.prorettype, pg_catalog.array_to_string(p.proconfig, ',') AS cfg
    INTO v_fn FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.quiz_live_media_paths(uuid, text, text[])');
  IF v_fn.oid IS NULL THEN
    RAISE EXCEPTION 'media_paths_exists';
  END IF;
  IF v_fn.prorettype <> 'jsonb'::regtype OR v_fn.provolatile <> 's' OR NOT v_fn.prosecdef
     OR v_fn.cfg NOT IN ('search_path=""', 'search_path=') THEN
    RAISE EXCEPTION 'media_paths_stable_definer_empty_search_path';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                 WHERE p.oid = v_fn.oid AND a.grantee = 0) THEN
    RAISE EXCEPTION 'media_paths_service_role_only';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn.oid;
  IF pg_catalog.strpos(v_src, 'v_last := case when v_g.state = ''lobby'' then -1 else v_g.qi end;') = 0
     OR pg_catalog.strpos(v_src, 'p.kicked_at is null') = 0
     OR pg_catalog.strpos(v_src, 'interval ''7 days''') = 0 THEN
    RAISE EXCEPTION 'media_paths_shown_questions_only';
  END IF;
  IF public.quiz_live_media_paths(null, null, null) <> '[]'::jsonb
     OR public.quiz_live_media_paths('00000000-0000-4000-8000-000000000000', 'short', array['a']) <> '[]'::jsonb
     OR public.quiz_live_media_paths('00000000-0000-4000-8000-000000000000', pg_catalog.repeat('a', 43),
                                array['00000000-0000-4000-8000-000000000000/' || pg_catalog.repeat('a', 64) || '.png']) <> '[]'::jsonb THEN
    RAISE EXCEPTION 'media_paths_bad_calls_get_nothing';
  END IF;
END
$check$;
