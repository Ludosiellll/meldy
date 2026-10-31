-- Run once after migration 20261102090100_live_numbers.sql: the read-only check of that apply (run live_game.sql,
-- live_stand.sql, live_mixed.sql, live_pin.sql, live_pictures.sql, live_wide_rounds.sql and live_kinds_teams.sql too).
-- A DO block that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that
-- does not. Catalog only, plus pure calls of the new private reading (no row is read).
-- Checks: the columns live_questions.tolerance / unit / spread and the checks that let a question be 'number' (no
-- options, key -1, forms = the accepted numbers, tops; tolerance ≥ 0, a unit of 1–20 characters, a spread of at most 60
-- values only on a number question); live_more draws a number where a text answer may be; live_create keeps its
-- tolerance and unit and never puts it on a movement round; the close grades it by public.meldy_number_right and keeps
-- its tops and spread; live_answer refuses it, live_submit takes its text; the unit leaves with the question, the
-- accepted numbers, the tolerance, the tops only from a closed question, the spread only in the host's; the review and
-- live_practice carry it; meldy_private.live_number_value is private and reads a number as meldy_number_right does.
-- Once 20261102090200_live_ranges.sql is applied, the two checks of «a number only where a text answer may» (live_more
-- in «Встань на ответ», live_create keeping numbers off the rounds) are left to live_ranges.sql: that file plays a number
-- there as ranges on purpose. The file holds before and after it.
-- The behaviour (a battle of number questions, the review, practice, a mixed and a stand game) is rehearsed locally:
-- supabase/tests/local/live_game_run.sh (live_numbers_behaviour.sql and the shared number vectors).
DO $check$
DECLARE
  v_src text;
  -- 20261102090200_live_ranges.sql plays a number on a movement round's place (and in «Встань на ответ») as ranges:
  -- once it is applied, «no number there» and «numbers kept off the rounds» are its rule's to check (live_ranges.sql)
  v_ranges boolean := pg_catalog.to_regprocedure('meldy_private.live_ranges(text[],numeric,integer,integer)') IS NOT NULL;
  v_oid oid;
  v_item public.test_items;
BEGIN
  -- 1. Columns and checks.
  IF (SELECT pg_catalog.count(*) FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'live_questions' AND c.is_nullable = 'YES' AND c.column_default IS NULL
         AND ((c.column_name = 'tolerance' AND c.data_type = 'numeric') OR (c.column_name = 'unit' AND c.data_type = 'text')
              OR (c.column_name = 'spread' AND c.data_type = 'jsonb'))) <> 3 THEN
    RAISE EXCEPTION 'columns';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.live_questions'::regclass AND k.conname = 'live_questions_kind_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''number''%' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''short''%'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''multiple''%' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''single''%') THEN
    RAISE EXCEPTION 'kind_number';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint k
       WHERE k.conrelid = 'public.live_questions'::regclass
         AND k.conname IN ('live_questions_options_check', 'live_questions_key_check', 'live_questions_forms_check', 'live_questions_tops_check')
         AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''number''%' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''short''%') <> 4 THEN
    RAISE EXCEPTION 'a_number_is_typed_like_a_text';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.live_questions'::regclass AND k.conname = 'live_questions_number_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%tolerance >= %0%'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%char_length(unit) >= 1%'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%jsonb_array_length(spread) <= 60%') THEN
    RAISE EXCEPTION 'number_check';
  END IF;

  -- 2. The reading: private, and the rule's.
  v_oid := pg_catalog.to_regprocedure('meldy_private.live_number_value(text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'reading_exists';
  END IF;
  IF (SELECT p.prosecdef OR p.provolatile <> 'i' FROM pg_catalog.pg_proc p WHERE p.oid = v_oid)
     OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'reading_private';
  END IF;
  IF meldy_private.live_number_value(' 1 000,50 м', 'м') <> 1000.5 OR meldy_private.live_number_value('−.5', NULL) <> -0.5
     OR meldy_private.live_number_value('3.140', NULL)::text <> '3.14' OR meldy_private.live_number_value('5 см', 'м') IS NOT NULL
     OR meldy_private.live_number_value('1e3', NULL) IS NOT NULL OR meldy_private.live_number_value(NULL, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'reading_values';
  END IF;
  IF (SELECT pg_catalog.bool_or(NOT (public.meldy_number_right(x.t, x.a, x.tol, x.u)
                                     = coalesce((SELECT pg_catalog.bool_or(pg_catalog.abs(meldy_private.live_number_value(x.t, x.u) - f::numeric) <= coalesce(x.tol, 0))
                                                   FROM pg_catalog.unnest(x.a) f), false)))
        FROM (VALUES ('9,75 м/с²', '{9.8}'::text[], 0.1, 'м/с²'), ('1.1', '{1}', 0.1, NULL), ('1.1000001', '{1}', 0.1, NULL),
                     ('50', '{10,49}', 1, NULL), ('5 м м', '{5}', NULL, 'м'), ('12 KG', '{12}', NULL, 'kg'), ('-0', '{0}', NULL, NULL)) x(t, a, tol, u)) THEN
    RAISE EXCEPTION 'reading_is_the_rule';
  END IF;

  -- 3. Which questions play, and create.
  v_item := pg_catalog.jsonb_populate_record(null::public.test_items, pg_catalog.jsonb_build_object(
              'kind', 'number', 'options', '[]'::jsonb, 'correct', '{}', 'answers', '{42}'));
  IF meldy_private.live_more(v_item, true) IS DISTINCT FROM 'number'
     OR (NOT v_ranges AND meldy_private.live_more(v_item, false) IS NOT NULL) THEN
    RAISE EXCEPTION 'more_number_not_in_stand';
  END IF;
  v_item := pg_catalog.jsonb_populate_record(null::public.test_items, pg_catalog.jsonb_build_object(
              'kind', 'order', 'options', '["a", "b", "c"]'::jsonb, 'correct', '{0,1,2}', 'answers', '{}'));
  IF meldy_private.live_more(v_item, true) IS NOT NULL THEN
    RAISE EXCEPTION 'more_no_order';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_create(jsonb,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'if v_kind in (''short'', ''number'') then') = 0
     OR pg_catalog.strpos(v_src, 'case when v_kind = ''number'' then v_item.tolerance end') = 0
     OR pg_catalog.strpos(v_src, 'case when v_kind = ''number'' then nullif(pg_catalog.btrim(v_item.unit), '''') end') = 0
     OR (NOT v_ranges AND pg_catalog.strpos(v_src, 'pg_catalog.array_agg(i.kind in (''short'', ''number'') order by x.ord)') = 0) THEN
    RAISE EXCEPTION 'create_keeps_the_number_off_the_rounds';
  END IF;

  -- 4. The engine.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_close(uuid)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'public.meldy_number_right(v_a.typed, v_q.forms, v_q.tolerance, v_q.unit)') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.live_number_value(a.typed, v_q.unit)') = 0
     OR pg_catalog.strpos(v_src, 'spread = v_spread') = 0
     OR pg_catalog.strpos(v_src, 'public.meldy_short_norm(v_a.typed) = any (coalesce(v_norms, ''{}''::text[]))') = 0 THEN
    RAISE EXCEPTION 'close_grades_the_number';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_answer(uuid,text,integer,integer)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'if v_kind in (''short'', ''number'') then') = 0 THEN
    RAISE EXCEPTION 'no_tap_on_a_number';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_submit(uuid,text,integer,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'if v_kind not in (''short'', ''number'') then') = 0
     OR pg_catalog.strpos(v_src, 'if v_kind in (''short'', ''number'') then') = 0 THEN
    RAISE EXCEPTION 'submit_takes_a_number_text';
  END IF;

  -- 5. What leaves, and when: the unit with the question; the numbers, the tolerance and the tops once closed; the
  --    spread only in the host's result.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public', 'meldy_private')
                AND p.proname IN ('live_base_json', 'live_player_json', 'live_answer', 'live_submit')
                AND p.prosrc ~ '''(tolerance|spread)''') THEN
    RAISE EXCEPTION 'no_tolerance_or_spread_elsewhere';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_base_json(public.live_games)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'pg_catalog.jsonb_build_object(''kind'', ''number'', ''unit'', v_q.unit)') = 0 THEN
    RAISE EXCEPTION 'question_kind_and_unit';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_closed_json(public.live_games)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'when q.kind = ''number'' then') = 0 OR pg_catalog.strpos(v_src, '''tolerance'', q.tolerance') = 0
     OR pg_catalog.strpos(v_src, 'q.closed_at is not null') = 0 THEN
    RAISE EXCEPTION 'numbers_after_close';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_host_json(public.live_games)'::regprocedure;
  IF pg_catalog.strpos(v_src, '''spread'', coalesce(v_q.spread, ''[]''::jsonb)') = 0
     OR pg_catalog.strpos(v_src, 'if v_closed is not null then') = 0 THEN
    RAISE EXCEPTION 'spread_in_the_hosts_result';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_player_json(public.live_games,uuid)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'when v_kind in (''short'', ''number'') then pg_catalog.jsonb_build_object(''typed'', v_a.typed)') = 0 THEN
    RAISE EXCEPTION 'own_number_text';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_review(uuid,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'pg_catalog.jsonb_build_object(''kind'', ''number'', ''forms''') = 0 THEN
    RAISE EXCEPTION 'review_number';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_practice(uuid,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'case when q.kind in (''short'', ''number'') then pg_catalog.jsonb_build_object(''text'', a.typed)') = 0 THEN
    RAISE EXCEPTION 'practice_number_text';
  END IF;
END
$check$;
