-- Run once after migration *_quizzes.sql («Контрольная», release 46): the read-only check of that apply. A DO block that
-- raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not.
-- Nothing is written and no row is read: catalog only.
-- Checks: the three tables exist with row security on, no policy and no right for anon / authenticated; the columns the
-- functions rely on (code, time_limit_s, fixed_item_ids, deadline_at, chosen / text); one attempt number per person
-- (unique quiz_id, user_id, n); the foreign keys covered by indexes; every function of the data contract
-- (docs/superpowers/plans/2026-10-16-quiz.md) exists, is SECURITY DEFINER with an empty search_path, authenticated may
-- run it and anon only quiz_preview; meldy_private.quiz_settle exists and meldy_private stays closed to clients; the
-- storage policy «Test item images: quiz takers read» reads through my_quiz_container_ids(); my_container_ids() does not
-- know quizzes. The behaviour is rehearsed locally: supabase/tests/local/quizzes_run.sh.
DO $check$
DECLARE
  v_t text;
  v_sig text;
  v_preview text;
  v_fn regprocedure;
  v_rel regclass;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['quizzes', 'quiz_attempts', 'quiz_answers'] LOOP
    v_rel := pg_catalog.to_regclass('public.' || v_t);
    IF v_rel IS NULL THEN
      RAISE EXCEPTION 'table_%', v_t;
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_rel) THEN
      RAISE EXCEPTION 'row_security_%', v_t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = v_rel) THEN
      RAISE EXCEPTION 'no_policies_%', v_t;
    END IF;
    IF pg_catalog.has_table_privilege('anon', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'no_client_rights_%', v_t;
    END IF;
  END LOOP;

  IF (SELECT pg_catalog.count(*) FROM information_schema.columns c
       WHERE c.table_schema = 'public'
         AND (c.table_name, c.column_name, c.data_type) IN (
               ('quizzes', 'code', 'text'), ('quizzes', 'time_limit_s', 'integer'), ('quizzes', 'fixed_item_ids', 'ARRAY'),
               ('quizzes', 'subject_ids', 'ARRAY'), ('quizzes', 'attempts_allowed', 'smallint'), ('quizzes', 'closed_at', 'timestamp with time zone'),
               ('quiz_attempts', 'item_ids', 'ARRAY'), ('quiz_attempts', 'deadline_at', 'timestamp with time zone'),
               ('quiz_attempts', 'finish_reason', 'text'), ('quiz_attempts', 'name', 'text'),
               ('quiz_answers', 'chosen', 'ARRAY'), ('quiz_answers', 'text', 'text'))) <> 12 THEN
    RAISE EXCEPTION 'columns';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.quiz_attempts'::regclass AND k.contype = 'u'
                    AND pg_catalog.pg_get_constraintdef(k.oid) = 'UNIQUE (quiz_id, user_id, n)') THEN
    RAISE EXCEPTION 'one_attempt_number_per_person';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.quizzes'::regclass AND k.contype = 'u'
                    AND pg_catalog.pg_get_constraintdef(k.oid) = 'UNIQUE (code)') THEN
    RAISE EXCEPTION 'unique_code';
  END IF;
  -- Foreign keys covered: the first column of some index of the table is the key column.
  IF (SELECT pg_catalog.count(*) FROM (VALUES ('quizzes', 'container_id'), ('quizzes', 'owner_id'),
                                              ('quiz_attempts', 'quiz_id'), ('quiz_attempts', 'user_id'),
                                              ('quiz_answers', 'attempt_id'), ('quiz_answers', 'item_id')) f(t, col)
       WHERE EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                      JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
                     WHERE i.indrelid = ('public.' || f.t)::regclass AND a.attname = f.col)) <> 6 THEN
    RAISE EXCEPTION 'foreign_keys_indexed';
  END IF;

  -- release 47 (20261018100000_test_builder) replaced quiz_preview(text) by quiz_preview(text, text default null)
  v_preview := CASE WHEN pg_catalog.to_regprocedure('public.quiz_preview(text,text)') IS NOT NULL
                    THEN 'quiz_preview(text,text)' ELSE 'quiz_preview(text)' END;
  FOREACH v_sig IN ARRAY ARRAY['quiz_create(uuid,jsonb)', 'quiz_update(uuid,jsonb)', 'quiz_close(uuid)', 'quiz_delete(uuid)',
      'quiz_list(uuid)', 'quiz_results(uuid)', 'quiz_marks(uuid)', 'quiz_attempt_answers(uuid)', 'quiz_attempt_reset(uuid)',
      v_preview, 'quiz_start(text,text)', 'quiz_answer(uuid,jsonb)', 'quiz_finish(uuid)', 'quiz_result(uuid)',
      'my_quiz_container_ids()'] LOOP
    v_fn := pg_catalog.to_regprocedure('public.' || v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'function_%', v_sig;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_fn AND p.prosecdef AND 'search_path=""' = ANY (p.proconfig)) THEN
      RAISE EXCEPTION 'definer_with_empty_search_path_%', v_sig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated_runs_%', v_sig;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') <> (v_sig = v_preview) THEN
      RAISE EXCEPTION 'anon_runs_only_the_preview_%', v_sig;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.pg_get_function_result(pg_catalog.to_regprocedure('public.my_quiz_container_ids()'))) <> 'SETOF uuid' THEN
    RAISE EXCEPTION 'my_quiz_container_ids_setof_uuid';
  END IF;
  IF pg_catalog.to_regprocedure('meldy_private.quiz_settle(uuid)') IS NULL THEN
    RAISE EXCEPTION 'quiz_settle';
  END IF;
  IF pg_catalog.has_schema_privilege('anon', 'meldy_private', 'USAGE')
     OR pg_catalog.has_schema_privilege('authenticated', 'meldy_private', 'USAGE') THEN
    RAISE EXCEPTION 'private_schema_closed_to_clients';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                  WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
                    AND p.policyname = 'Test item images: quiz takers read' AND p.cmd = 'SELECT'
                    AND p.roles = ARRAY['authenticated']::name[]
                    AND p.qual LIKE '%test-item-images%' AND p.qual LIKE '%my_quiz_container_ids()%') THEN
    RAISE EXCEPTION 'storage_policy_quiz_takers_read';
  END IF;
  IF (SELECT pg_catalog.strpos(p.prosrc, 'quiz') FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.my_container_ids()')) <> 0 THEN
    RAISE EXCEPTION 'my_container_ids_untouched';
  END IF;
END
$check$;
