-- Run once after migration 20261016140000_quiz_result_order.sql (release 46.1): the read-only check of that apply. A DO
-- block that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does
-- not. Catalog only: meldy_private.quiz_result_json gives shuffle_options and each item's keep_order, keeps the key behind
-- the review (v_review = 'answers'), and stays closed to clients. Behaviour: supabase/tests/local/quizzes_run.sh.
DO $check$
DECLARE
  v_fn regprocedure := pg_catalog.to_regprocedure('meldy_private.quiz_result_json(uuid)');
  v_src text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'quiz_result_json';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF pg_catalog.strpos(v_src, '''shuffle_options'', v_q.shuffle_options') = 0 THEN
    RAISE EXCEPTION 'result_shuffle_options';
  END IF;
  IF pg_catalog.strpos(v_src, '''keep_order'', i.keep_order') = 0 THEN
    RAISE EXCEPTION 'result_items_keep_order';
  END IF;
  IF pg_catalog.strpos(v_src, '''key'', case when v_review = ''answers''') = 0 THEN
    RAISE EXCEPTION 'result_key_behind_review';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'quiz_result_json_private';
  END IF;
  IF pg_catalog.to_regprocedure('public.quiz_result(uuid)') IS NULL
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.quiz_result(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'quiz_result';
  END IF;
END
$check$;
