-- Run once after migration 20261102090200_live_ranges.sql: the read-only check of that apply (run the other live_*.sql
-- too; live_numbers.sql's «a number only where a text answer may» and «create keeps numbers off the rounds» are what this
-- migration changes on purpose). A DO block that raises nothing when every check holds (supabase/migrate.py); it raises
-- the name of the first one that does not. Catalog only, plus pure calls of the new private functions (no row is read).
-- Checks: the column live_questions.bounds and the checks that let a number question have ranges (2–6 options, a key,
-- keys of several right ranges, bounds one fewer than the options); live_ranges and live_range_text private and their
-- numbers; live_more draws a number in «Встань на ответ» too; live_create draws it as ranges on a round's place and keeps
-- only text answers off the rounds; the close leaves tops and spread to typed numbers; the question says ranges, the
-- result and the room's result carry the true value; the review says ranges. The behaviour is rehearsed locally:
-- supabase/tests/local/live_game_run.sh (live_ranges_behaviour.sql).
DO $check$
DECLARE
  v_src text;
  v_fn record;
  v_r jsonb;
  v_item public.test_items;
BEGIN
  -- 1. The column and the checks.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'live_questions' AND c.column_name = 'bounds'
                    AND c.is_nullable = 'YES' AND c.column_default IS NULL AND c.data_type = 'ARRAY' AND c.udt_name = '_numeric') THEN
    RAISE EXCEPTION 'bounds_column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_questions'::regclass
                    AND k.conname = 'live_questions_options_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%kind = ''number''::text%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_questions'::regclass
                       AND k.conname = 'live_questions_key_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%cardinality(shown) = 0%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_questions'::regclass
                       AND k.conname = 'live_questions_keys_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''number''%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_questions'::regclass
                       AND k.conname = 'live_questions_number_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%cardinality(bounds) = (jsonb_array_length(options) - 1)%') THEN
    RAISE EXCEPTION 'checks_of_a_range_question';
  END IF;

  -- 2. The ranges: private, pure, and their numbers.
  FOR v_fn IN SELECT x.sig, pg_catalog.to_regprocedure(x.sig) AS oid FROM pg_catalog.unnest(array[
      'meldy_private.live_ranges(text[],numeric,integer,integer)', 'meldy_private.live_range_text(numeric)']) x(sig) LOOP
    IF v_fn.oid IS NULL THEN
      RAISE EXCEPTION 'ranges_exist: %', v_fn.sig;
    END IF;
    IF (SELECT p.prosecdef OR p.provolatile <> 'i' FROM pg_catalog.pg_proc p WHERE p.oid = v_fn.oid)
       OR pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'ranges_private: %', v_fn.sig;
    END IF;
  END LOOP;
  v_r := meldy_private.live_ranges('{343}', 10, 4, 1);
  IF pg_catalog.replace((v_r -> 'options')::text, pg_catalog.chr(160), ' ') <> '["меньше 300", "300–400", "400–500", "больше 500"]'
     OR v_r -> 'bounds' <> '[300, 400, 500]'::jsonb OR v_r -> 'keys' <> '[1]'::jsonb THEN
    RAISE EXCEPTION 'ranges_of_343';
  END IF;
  v_r := meldy_private.live_ranges('{-12}', 0.5, 4, 2);
  IF pg_catalog.replace((v_r -> 'options')::text, pg_catalog.chr(160), ' ') <> '["меньше −20", "от −20 до −15", "от −15 до −10", "больше −10"]'
     OR v_r -> 'keys' <> '[2]'::jsonb THEN
    RAISE EXCEPTION 'ranges_of_a_negative';
  END IF;
  IF meldy_private.live_range_text(12500.5) <> '12' || pg_catalog.chr(160) || '500,5' OR meldy_private.live_range_text(-0.25) <> '−0,25'
     OR meldy_private.live_ranges('{5}', NULL, 4, 4) IS NOT NULL OR meldy_private.live_ranges('{"5,0"}', NULL, 4, 0) IS NOT NULL THEN
    RAISE EXCEPTION 'range_text_and_refusals';
  END IF;

  -- 3. Which questions play, and create.
  v_item := pg_catalog.jsonb_populate_record(null::public.test_items, pg_catalog.jsonb_build_object(
              'kind', 'number', 'options', '[]'::jsonb, 'correct', '{}', 'answers', '{42}'));
  IF meldy_private.live_more(v_item, false) IS DISTINCT FROM 'number' OR meldy_private.live_more(v_item, true) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'more_number_everywhere';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_create(jsonb,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'meldy_private.live_ranges(v_item.answers, v_item.tolerance, 4, pg_catalog.floor(pg_catalog.random() * 4)::integer)') = 0
     OR pg_catalog.strpos(v_src, 'v_mode = ''stand'' or (v_every > 0 and meldy_private.live_stand_round(v_every, v_g.q_count, v_ord))') = 0
     OR pg_catalog.strpos(v_src, 'pg_catalog.array_agg(i.kind = ''short'' order by x.ord)') = 0 THEN
    RAISE EXCEPTION 'create_draws_ranges_on_the_rounds';
  END IF;

  -- 4. The close and what leaves.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_close(uuid)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'elsif v_q.kind = ''number'' and pg_catalog.jsonb_array_length(v_q.options) = 0 then') = 0 THEN
    RAISE EXCEPTION 'tops_of_typed_numbers_only';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_base_json(public.live_games)'::regprocedure;
  IF pg_catalog.strpos(v_src, '''{"ranges": true}''::jsonb') = 0 THEN
    RAISE EXCEPTION 'question_says_ranges';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_closed_json(public.live_games)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'pg_catalog.jsonb_build_object(''ranges'', true, ''forms''') = 0 OR pg_catalog.strpos(v_src, 'q.closed_at is not null') = 0 THEN
    RAISE EXCEPTION 'result_of_a_range_question';
  END IF;
  FOR v_fn IN SELECT x.sig FROM pg_catalog.unnest(array['meldy_private.live_stand_result(uuid,integer,boolean)',
                                                        'meldy_private.live_mixed_result(uuid,integer,boolean)']) x(sig) LOOP
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn.sig::regprocedure;
    IF pg_catalog.strpos(v_src, 'pg_catalog.jsonb_build_object(''num'', pg_catalog.jsonb_build_object(''forms''') = 0
       OR pg_catalog.strpos(v_src, 'case when q.keys is not null then pg_catalog.jsonb_build_object(''keys''') = 0
       OR pg_catalog.strpos(v_src, 'q.closed_at is not null') = 0 THEN
      RAISE EXCEPTION 'room_reads_the_true_value: %', v_fn.sig;
    END IF;
  END LOOP;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_review(uuid,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'pg_catalog.jsonb_build_object(''ranges'', true)') = 0 THEN
    RAISE EXCEPTION 'review_says_ranges';
  END IF;
END
$check$;
