-- Run once after migration 20261020120000_quiz_protection.sql («Защита от списывания»): the read-only check of that
-- apply (catalog only). A DO block that raises nothing when every check holds (supabase/migrate.py); it raises the name
-- of the first one that does not.
-- Checks: quizzes.protection ('off' | 'normal' | 'strict', default 'off') and protection_limit (1..20, default 3);
-- quiz_attempts.guard_count (0..500, default 0) and finish_reason 'protection'; public.quiz_events (the key
-- attempt_id + cid, cascade with the attempt, the seven kinds, RLS on, no policy, no grant to a client role); the
-- helpers private; quiz_events_add for accounts, quiz_guest_events_add for anyone, quiz_attempt_events for accounts;
-- quiz_events_for keeps 50 a call and 500 an attempt and ends a strict attempt at the limit; quiz_settle ends the
-- attempts over the limit; quiz_update locks both settings after the start; what leaves the server carries the new
-- fields and the attempt still no key; the touched functions answer «not found» as HTTP 404 (PGRST) and no longer raise
-- a bare P0002; the grants of the replaced functions are as before.
-- The behaviour is rehearsed locally: supabase/tests/local/quiz_protection_run.sh.
DO $check$
DECLARE
  v_rel regclass := pg_catalog.to_regclass('public.quiz_events');
  v_fn regprocedure;
  v_src text;
  v_sig text;
BEGIN
  -- 1. The settings and the count.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'quizzes'
                    AND c.column_name = 'protection' AND c.data_type = 'text' AND c.is_nullable = 'NO'
                    AND c.column_default = '''off''::text')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'quizzes'
                       AND c.column_name = 'protection_limit' AND c.data_type = 'smallint' AND c.is_nullable = 'NO'
                       AND c.column_default = '3')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'quiz_attempts'
                       AND c.column_name = 'guard_count' AND c.data_type = 'smallint' AND c.is_nullable = 'NO'
                       AND c.column_default = '0') THEN
    RAISE EXCEPTION 'protection_columns';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.quizzes'::regclass
                    AND k.conname = 'quizzes_protection_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%off%normal%strict%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.quizzes'::regclass
                       AND k.conname = 'quizzes_protection_limit_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%>= 1%<= 20%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.quiz_attempts'::regclass
                       AND k.conname = 'quiz_attempts_guard_count_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%<= 500%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.quiz_attempts'::regclass
                       AND k.conname = 'quiz_attempts_finish_reason_check'
                       AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%sent%time%closed%protection%') THEN
    RAISE EXCEPTION 'protection_checks';
  END IF;

  -- 2. The events: closed to the clients, one row an event id of an attempt, gone with the attempt.
  IF v_rel IS NULL THEN
    RAISE EXCEPTION 'quiz_events_table';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_rel)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = v_rel)
     OR pg_catalog.has_table_privilege('anon', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
                 WHERE c.oid = v_rel AND a.grantee = 0) THEN
    RAISE EXCEPTION 'quiz_events_closed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = v_rel AND k.contype = 'p'
                    AND pg_catalog.pg_get_constraintdef(k.oid) = 'PRIMARY KEY (attempt_id, cid)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = v_rel AND k.contype = 'f'
                       AND k.confrelid = 'public.quiz_attempts'::regclass AND k.confdeltype = 'c')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = v_rel AND k.conname = 'quiz_events_kind_check'
                       AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%hidden%blur%split%fullscreen%copy%paste%reload%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = v_rel AND k.conname = 'quiz_events_cid_check') THEN
    RAISE EXCEPTION 'quiz_events_constraints';
  END IF;

  -- 3. Who calls what: the helpers are private; the participant's two calls and the author's timeline.
  FOREACH v_sig IN ARRAY ARRAY['meldy_private.quiz_guard_counted(text)', 'meldy_private.quiz_guard_rank(text)',
      'meldy_private.quiz_events_for(uuid,uuid,text,jsonb)'] LOOP
    v_fn := pg_catalog.to_regprocedure(v_sig);
    IF v_fn IS NULL OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                   WHERE p.oid = v_fn AND a.grantee = 0) THEN
      RAISE EXCEPTION 'helper_private_%', v_sig;
    END IF;
  END LOOP;
  FOREACH v_sig IN ARRAY ARRAY['public.quiz_events_add(uuid,jsonb)', 'public.quiz_attempt_events(uuid)'] LOOP
    v_fn := pg_catalog.to_regprocedure(v_sig);
    IF v_fn IS NULL OR NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) THEN
      RAISE EXCEPTION 'account_call_%', v_sig;
    END IF;
  END LOOP;
  v_fn := pg_catalog.to_regprocedure('public.quiz_guest_events_add(uuid,text,jsonb)');
  IF v_fn IS NULL OR NOT pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn)
     OR pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = v_fn), 'meldy_private.quiz_token_hash(p_token)') = 0 THEN
    RAISE EXCEPTION 'guest_call';
  END IF;

  -- 4. The rules of the events and of the end.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_events_for(uuid,uuid,text,jsonb)');
  IF pg_catalog.strpos(v_src, 'not between 1 and 50') = 0 OR pg_catalog.strpos(v_src, 'v_have < 500') = 0
     OR pg_catalog.strpos(v_src, 'finish_reason = ''protection''') = 0
     OR pg_catalog.strpos(v_src, 'v_count >= v_q.protection_limit') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.quiz_settle(v_a.quiz_id)') = 0
     OR pg_catalog.strpos(v_src, 'interval ''10 minutes''') = 0 THEN
    RAISE EXCEPTION 'events_rules';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_settle(uuid)');
  IF pg_catalog.strpos(v_src, 'a.guard_count >= v_q.protection_limit') = 0 OR pg_catalog.strpos(v_src, 'finish_reason = ''protection''') = 0 THEN
    RAISE EXCEPTION 'settle_ends_over_the_limit';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.quiz_update(uuid,jsonb)');
  IF pg_catalog.strpos(v_src, 'errcode = ''MC011'', detail = ''protection''') = 0
     OR pg_catalog.strpos(v_src, 'errcode = ''MC011'', detail = ''protection_limit''') = 0
     OR pg_catalog.strpos(v_src, 'protection = v_new.protection, protection_limit = v_new.protection_limit') = 0 THEN
    RAISE EXCEPTION 'update_locks_protection';
  END IF;
  IF pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p
                         WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_apply(public.quizzes,jsonb)')),
                       'quiz_int(p_settings, ''protection_limit'', 1, 20, false)') = 0
     OR pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p
                            WHERE p.oid = pg_catalog.to_regprocedure('public.quiz_create(uuid,jsonb)')), 'v_q.protection := ''off''') = 0 THEN
    RAISE EXCEPTION 'apply_and_create';
  END IF;
  IF pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p
                         WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_start_for(text,text,uuid,text)')),
                       '''reload''') = 0 THEN
    RAISE EXCEPTION 'start_records_reload';
  END IF;

  -- 5. What leaves the server.
  IF pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p
                         WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_row(public.quizzes)')),
                       '''protection'', p_q.protection, ''protection_limit'', p_q.protection_limit') = 0
     OR pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p
                            WHERE p.oid = pg_catalog.to_regprocedure('public.quiz_preview(text,text)')),
                          '''protection'', v_q.protection, ''protection_limit'', v_q.protection_limit') = 0
     OR pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p
                            WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_result_json(uuid)')), '''guard'', case') = 0
     OR pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p
                            WHERE p.oid = pg_catalog.to_regprocedure('public.quiz_results(uuid)')), '''flagged''') = 0 THEN
    RAISE EXCEPTION 'shapes_carry_protection';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_attempt_json(public.quiz_attempts,public.quizzes)');
  IF v_src ~ 'explanation|i\.correct|i\.answers' OR pg_catalog.strpos(v_src, '''taker_name'', p_a.name') = 0
     OR pg_catalog.strpos(v_src, '''guard_count'', p_a.guard_count') = 0 THEN
    RAISE EXCEPTION 'attempt_without_key_with_guard';
  END IF;

  -- 6. «Not found» as HTTP 404 in every function this migration wrote; none raises a bare P0002.
  FOREACH v_sig IN ARRAY ARRAY['public.quiz_create(uuid,jsonb)', 'public.quiz_update(uuid,jsonb)', 'public.quiz_results(uuid)',
      'meldy_private.quiz_start_for(text,text,uuid,text)', 'meldy_private.quiz_events_for(uuid,uuid,text,jsonb)',
      'public.quiz_attempt_events(uuid)'] LOOP
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_sig);
    IF v_src IS NULL OR pg_catalog.strpos(v_src, 'errcode = ''P0002''') > 0
       OR pg_catalog.strpos(v_src, 'raise sqlstate ''PGRST''') = 0
       OR pg_catalog.strpos(v_src, '''{"status":404,"headers":{}}''') = 0
       OR pg_catalog.strpos(v_src, '"code":"P0002"') = 0 THEN
      RAISE EXCEPTION 'not_found_is_404_%', v_sig;
    END IF;
  END LOOP;

  -- 7. The replaced functions kept their grants.
  IF NOT pg_catalog.has_function_privilege('anon', 'public.quiz_preview(text,text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.quiz_results(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.quiz_results(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.quiz_create(uuid,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.quiz_update(uuid,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'meldy_private.quiz_settle(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'meldy_private.quiz_start_for(text,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'replaced_grants';
  END IF;
END
$check$;
