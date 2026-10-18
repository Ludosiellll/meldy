-- Run once after migration 20261018140000_quiz_practice_grace.sql: the read-only check of that apply (catalog only). A
-- DO block that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that
-- does not. Checks: meldy_private.quiz_practice_ready still reads every quiz of the exam through quiz_state (open, not
-- yet open) and also waits 20 seconds after a closing by time (closed_at empty); it stays private; its callers
-- (quiz_practice_join, quiz_result_json) still call it. supabase/tests/quiz_guards.sql still holds after this apply.
-- The behaviour is rehearsed locally: supabase/tests/local/quiz_guards_run.sh (quiz_practice_grace_behaviour.sql).
DO $check$
DECLARE
  v_fn regprocedure := pg_catalog.to_regprocedure('meldy_private.quiz_practice_ready(uuid)');
  v_src text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'helper_quiz_practice_ready';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF pg_catalog.strpos(v_src, 'meldy_private.quiz_state(z) in (''open'', ''not_yet'')') = 0
     OR pg_catalog.strpos(v_src, 'z.container_id = p_container') = 0
     OR pg_catalog.strpos(v_src, 'z.closed_at is null and z.closes_at is not null') = 0
     OR pg_catalog.strpos(v_src, 'pg_catalog.now() < z.closes_at + interval ''20 seconds''') = 0 THEN
    RAISE EXCEPTION 'practice_ready_waits_for_the_answer_grace';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                 WHERE p.oid = v_fn AND a.grantee = 0)
     OR (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) IS NULL THEN
    RAISE EXCEPTION 'helper_quiz_practice_ready_private';
  END IF;
  IF pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p
                         WHERE p.oid = pg_catalog.to_regprocedure('public.quiz_practice_join(text)')),
                       'meldy_private.quiz_practice_ready(v_q.container_id)') = 0
     OR pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p
                            WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_result_json(uuid)')),
                          '''ready'', meldy_private.quiz_practice_ready(v_q.container_id)') = 0 THEN
    RAISE EXCEPTION 'practice_ready_callers';
  END IF;
END
$check$;
