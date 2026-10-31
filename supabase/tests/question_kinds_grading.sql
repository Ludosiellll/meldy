-- Run once after migration 20261101090100_question_kinds_grading.sql (release 48, part 2; docs/kinds/CONTRACT.md §2):
-- the read-only check of that apply. A DO block that raises nothing when every check holds (supabase/migrate.py); it
-- raises the name of the first one that does not. Catalog only, plus the pure grading function on literals.
-- Checks: meldy_private.grade_item exists, private, immutable with an empty search_path, and grades a case of each
-- kind as the contract says (partial credit too); the answer core and «Как на экзамене» call it; grade_answer is kept
-- unchanged for the callers that still use it. The behaviour is rehearsed locally: supabase/tests/local/question_kinds_run.sh.
DO $check$
DECLARE
  v_fn regprocedure := pg_catalog.to_regprocedure('meldy_private.grade_item(public.test_items, jsonb)');
  v_g record;
BEGIN
  IF v_fn IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                                  WHERE p.oid = v_fn AND p.provolatile = 'i' AND p.proconfig = ARRAY['search_path=""'])
     OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'grade_item_catalog';
  END IF;
  SELECT * INTO v_g FROM meldy_private.grade_item(pg_catalog.jsonb_populate_record(NULL::public.test_items,
           '{"kind":"number","options":[],"correct":[],"answers":["9.8"],"tolerance":0.1,"unit":"м","partial":false}'),
           '{"text":"9,85 м"}');
  IF NOT (v_g.o_valid AND v_g.o_correct AND v_g.o_credit = 1) THEN RAISE EXCEPTION 'grade_item_number'; END IF;
  SELECT * INTO v_g FROM meldy_private.grade_item(pg_catalog.jsonb_populate_record(NULL::public.test_items,
           '{"kind":"order","options":["a","b","c","d"],"correct":[0,1,2,3],"answers":[],"partial":true}'),
           '{"chosen":[1,0,2,3]}');
  IF NOT (v_g.o_valid AND NOT v_g.o_correct AND v_g.o_credit = 0.8333 AND v_g.o_chosen = '{1,0,2,3}') THEN
    RAISE EXCEPTION 'grade_item_order';
  END IF;
  SELECT * INTO v_g FROM meldy_private.grade_item(pg_catalog.jsonb_populate_record(NULL::public.test_items,
           '{"kind":"match","options":["a","b"],"correct":[],"answers":["1","2","3"],"partial":true}'),
           '{"chosen":[0,2]}');
  IF NOT (v_g.o_valid AND NOT v_g.o_correct AND v_g.o_credit = 0.5) THEN RAISE EXCEPTION 'grade_item_match'; END IF;
  SELECT * INTO v_g FROM meldy_private.grade_item(pg_catalog.jsonb_populate_record(NULL::public.test_items,
           '{"kind":"cloze","options":[],"correct":[],"answers":["Москва\nмосква-град","1147"],"partial":false}'),
           '{"texts":["москва-град","1147"]}');
  IF NOT (v_g.o_valid AND v_g.o_correct AND v_g.o_text = E'москва-град\n1147') THEN RAISE EXCEPTION 'grade_item_cloze'; END IF;
  SELECT * INTO v_g FROM meldy_private.grade_item(pg_catalog.jsonb_populate_record(NULL::public.test_items,
           '{"kind":"multiple","options":["a","b","c","d"],"correct":[0,2],"answers":[],"partial":true}'),
           '{"chosen":[0]}');
  IF NOT (v_g.o_valid AND NOT v_g.o_correct AND v_g.o_credit = 0.5) THEN RAISE EXCEPTION 'grade_item_multiple_partial'; END IF;
  SELECT * INTO v_g FROM meldy_private.grade_item(pg_catalog.jsonb_populate_record(NULL::public.test_items,
           '{"kind":"multiple","options":["a","b","c","d"],"correct":[0,2],"answers":[],"partial":false}'),
           '{"chosen":[0]}');
  IF NOT (v_g.o_valid AND NOT v_g.o_correct AND v_g.o_credit = 0) THEN RAISE EXCEPTION 'grade_item_multiple_all_or_nothing'; END IF;
  IF pg_catalog.pg_get_functiondef('meldy_private.record_test_answers_for(uuid, jsonb, text, integer, text, uuid)'::regprocedure)
     NOT LIKE '%meldy_private.grade_item(v_item, v_a)%' THEN
    RAISE EXCEPTION 'answer_core_grades_with_grade_item';
  END IF;
  IF pg_catalog.pg_get_functiondef('public.container_mock_finish(jsonb)'::regprocedure) NOT LIKE '%a ? ''texts''%' THEN
    RAISE EXCEPTION 'mock_counts_empty_cloze';
  END IF;
  IF pg_catalog.to_regprocedure('meldy_private.grade_answer(text, integer, smallint[], text[], jsonb)') IS NULL THEN
    RAISE EXCEPTION 'grade_answer_kept';
  END IF;
END
$check$;
