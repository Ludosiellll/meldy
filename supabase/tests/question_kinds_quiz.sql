-- Run once after migration 20261101090200_question_kinds_quiz.sql (release 48, part 3; docs/kinds/CONTRACT.md §3): the
-- read-only check of that apply. A DO block that raises nothing when every check holds (supabase/migrate.py); it raises
-- the name of the first one that does not. Catalog only, plus the pure permutation function on literals.
-- Checks: quiz_answers.text takes 6000 characters; quiz_essay_marks with its checks, RLS on and no client right;
-- quiz_graded gives credit and pending; the new private helpers exist and are closed; quiz_perm is fixed and never the
-- identity; the attempt, saving, the result, the stats, the preview's «me», quiz_list and the author's attempt view use
-- the new pieces; the pool and a design quiz take essays; quiz_essay_task / quiz_essay_mark are SECURITY DEFINER with an
-- empty search_path, the author's (authenticated), never anon's. Behaviour: supabase/tests/local/question_kinds_run.sh.
DO $check$
DECLARE
  v_fn regprocedure;
  v_src text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.quiz_answers'::regclass AND k.conname = 'quiz_answers_text_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%char_length(text) <= 6000%') THEN
    RAISE EXCEPTION 'quiz_answers_text_check';
  END IF;
  IF pg_catalog.to_regclass('public.quiz_essay_marks') IS NULL
     OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.quiz_essay_marks'::regclass)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'quiz_essay_marks')
     OR pg_catalog.has_table_privilege('anon', 'public.quiz_essay_marks', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.quiz_essay_marks', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.quiz_essay_marks', 'INSERT') THEN
    RAISE EXCEPTION 'quiz_essay_marks_closed';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint k
       WHERE k.conrelid = 'public.quiz_essay_marks'::regclass
         AND k.conname IN ('quiz_essay_marks_verdict_check', 'quiz_essay_marks_quote_check', 'quiz_essay_marks_source_check')) <> 3 THEN
    RAISE EXCEPTION 'quiz_essay_marks_checks';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_graded(uuid, uuid)')
                    AND 'credit' = ANY (p.proargnames) AND 'pending' = ANY (p.proargnames)) THEN
    RAISE EXCEPTION 'quiz_graded_credit';
  END IF;
  FOR v_fn IN SELECT pg_catalog.to_regprocedure(x) FROM pg_catalog.unnest(ARRAY[
      'meldy_private.quiz_perm(text, integer)', 'meldy_private.quiz_permuted(jsonb, smallint[])',
      'meldy_private.quiz_item_perm(public.test_items, uuid)', 'meldy_private.quiz_kind_json(public.test_items, uuid)',
      'meldy_private.quiz_shown(public.test_items, uuid, smallint[])',
      'meldy_private.quiz_answer_shown(public.test_items, uuid, smallint[], text)',
      'meldy_private.quiz_answer_file(public.test_items, uuid, jsonb)', 'meldy_private.quiz_answer_json(text, smallint[], text)',
      'meldy_private.quiz_review_json(public.test_items, uuid, smallint[], text, numeric, boolean)',
      'meldy_private.quiz_graded(uuid, uuid)']) x LOOP
    IF v_fn IS NULL OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'quiz_kind_helpers_private: %', coalesce(v_fn::text, 'missing');
    END IF;
  END LOOP;
  IF meldy_private.quiz_perm('seed', 4) IS DISTINCT FROM meldy_private.quiz_perm('seed', 4)
     OR meldy_private.quiz_perm('seed', 4) = '{0,1,2,3}'
     OR (SELECT pg_catalog.array_agg(x ORDER BY x) FROM pg_catalog.unnest(meldy_private.quiz_perm('seed', 4)) x) <> '{0,1,2,3}'
     OR EXISTS (SELECT 1 FROM pg_catalog.generate_series(1, 200) s
                 WHERE meldy_private.quiz_perm('s' || s::text, 2) = '{0,1}') THEN
    RAISE EXCEPTION 'quiz_perm';
  END IF;
  -- the readers use the new pieces
  IF pg_catalog.pg_get_functiondef('meldy_private.quiz_attempt_json(public.quiz_attempts, public.quizzes)'::regprocedure) NOT LIKE '%quiz_kind_json%'
     OR pg_catalog.pg_get_functiondef('meldy_private.quiz_attempt_json(public.quiz_attempts, public.quizzes)'::regprocedure) NOT LIKE '%quiz_answer_shown%'
     OR pg_catalog.pg_get_functiondef('meldy_private.quiz_answer_for(uuid, uuid, text, jsonb)'::regprocedure) NOT LIKE '%quiz_answer_file%'
     OR pg_catalog.pg_get_functiondef('meldy_private.quiz_result_json(uuid)'::regprocedure) NOT LIKE '%g.credit%'
     OR pg_catalog.pg_get_functiondef('meldy_private.quiz_result_json(uuid)'::regprocedure) NOT LIKE '%quiz_review_json%'
     OR pg_catalog.pg_get_functiondef('public.quiz_results(uuid)'::regprocedure) NOT LIKE '%g0.credit%'
     OR pg_catalog.pg_get_functiondef('meldy_private.quiz_me(public.quizzes, uuid, text)'::regprocedure) NOT LIKE '%g.credit%'
     OR pg_catalog.pg_get_functiondef('public.quiz_list(uuid)'::regprocedure) NOT LIKE '%g.credit%'
     OR pg_catalog.pg_get_functiondef('public.quiz_attempt_answers(uuid)'::regprocedure) NOT LIKE '%quiz_essay_marks%'
     OR pg_catalog.pg_get_functiondef('meldy_private.quiz_pool(uuid, uuid[])'::regprocedure) NOT LIKE '%essay%'
     OR pg_catalog.pg_get_functiondef('meldy_private.quiz_doc_items(uuid)'::regprocedure) NOT LIKE '%essay%' THEN
    RAISE EXCEPTION 'quiz_readers_new_kinds';
  END IF;
  FOR v_fn IN SELECT unnest(ARRAY['public.quiz_essay_task(uuid, uuid)'::regprocedure,
                                  'public.quiz_essay_mark(uuid, uuid, text, text, text)'::regprocedure]) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef AND p.proconfig = ARRAY['search_path=""'])
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'quiz_essay_calls: %', v_fn;
    END IF;
  END LOOP;
END
$check$;
