-- Run once after migration 20261018130000_quiz_guards.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog
-- only, plus the number of rows of the secret table (never the secret).
-- Checks: pgcrypto's hmac and gen_random_bytes in schema extensions; meldy_private.quiz_ip_secret (one row of 32 bytes
-- by its checks, row security on, no policy, no grant to anon, authenticated or service_role); quiz_ip_hash reads the
-- first x-forwarded-for and hashes it with extensions.hmac under that secret (no fixed prefix); quiz_start_for prunes the
-- throttle rows older than two minutes before it counts, keeps 30 a minute per address and 120 a minute per quiz;
-- meldy_private.quiz_practice_ready (private) reads every quiz of the exam through quiz_state; quiz_practice_join refuses
-- with MC018 open after the offer check and the author's exam, before the exam row is locked; the result's practice
-- carries ready by the same helper, and the release-47 pins of the result still hold; the grants of the replaced
-- functions are as release 47 left them.
-- The behaviour is rehearsed locally: supabase/tests/local/quiz_guards_run.sh.
DO $check$
DECLARE
  v_rel regclass;
  v_fn regprocedure;
  v_src text;
  v_sig text;
BEGIN
  -- 1. pgcrypto where the functions call it.
  IF pg_catalog.to_regprocedure('extensions.hmac(bytea,bytea,text)') IS NULL
     OR pg_catalog.to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'pgcrypto_in_extensions';
  END IF;

  -- 2. The secret: private, closed, one row of 32 bytes.
  v_rel := pg_catalog.to_regclass('meldy_private.quiz_ip_secret');
  IF v_rel IS NULL THEN
    RAISE EXCEPTION 'secret_table';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_rel)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = v_rel)
     OR pg_catalog.has_table_privilege('anon', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_table_privilege('service_role', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
                 WHERE c.oid = v_rel AND a.grantee = 0) THEN
    RAISE EXCEPTION 'secret_table_closed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = v_rel AND k.conname = 'quiz_ip_secret_one_row' AND pg_catalog.pg_get_constraintdef(k.oid) = 'CHECK (id)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                     WHERE k.conrelid = v_rel AND k.conname = 'quiz_ip_secret_length'
                       AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%octet_length(secret) = 32%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = v_rel AND k.contype = 'p') THEN
    RAISE EXCEPTION 'secret_table_checks';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM meldy_private.quiz_ip_secret) <> 1 THEN
    RAISE EXCEPTION 'secret_one_row';
  END IF;

  -- 3. The address hash and the throttle.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_ip_hash()');
  IF v_src IS NULL OR pg_catalog.strpos(v_src, 'extensions.hmac(') = 0 OR pg_catalog.strpos(v_src, 'meldy_private.quiz_ip_secret') = 0
     OR pg_catalog.strpos(v_src, '''sha256''') = 0 OR pg_catalog.strpos(v_src, 'meldy-quiz-ip:') > 0
     OR pg_catalog.strpos(v_src, '''x-forwarded-for'', '','', 1)') = 0 THEN
    RAISE EXCEPTION 'ip_hash_hmac_of_the_first_address';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_start_for(text,text,uuid,text)');
  IF v_src IS NULL
     OR pg_catalog.strpos(v_src, 'delete from meldy_private.quiz_guest_starts s where s.started_at <= pg_catalog.now() - interval ''2 minutes''') = 0
     OR pg_catalog.strpos(v_src, 'delete from meldy_private.quiz_guest_starts s where s.started_at <= pg_catalog.now() - interval ''2 minutes''')
        > pg_catalog.strpos(v_src, 'v_ip := meldy_private.quiz_ip_hash()')
     OR pg_catalog.strpos(v_src, 'interval ''1 minute'') >= 30') = 0
     OR pg_catalog.strpos(v_src, 'interval ''1 minute'') >= 120') = 0
     OR v_src ~ 'interval ''1 minute'';' THEN
    RAISE EXCEPTION 'throttle_prune_at_the_check';
  END IF;

  -- 4. Practice: the helper, the join, the result.
  v_fn := pg_catalog.to_regprocedure('meldy_private.quiz_practice_ready(uuid)');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'helper_quiz_practice_ready';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                 WHERE p.oid = v_fn AND a.grantee = 0)
     OR (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) IS NULL THEN
    RAISE EXCEPTION 'helper_quiz_practice_ready_private';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF pg_catalog.strpos(v_src, 'meldy_private.quiz_state(z) in (''open'', ''not_yet'')') = 0
     OR pg_catalog.strpos(v_src, 'z.container_id = p_container') = 0 THEN
    RAISE EXCEPTION 'practice_ready_rule';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.quiz_practice_join(text)');
  IF v_src IS NULL OR pg_catalog.strpos(v_src, 'detail = ''open''') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.quiz_practice_ready(v_q.container_id)') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.quiz_practice_ready(v_q.container_id)') < pg_catalog.strpos(v_src, 'detail = ''practice''')
     OR pg_catalog.strpos(v_src, 'meldy_private.quiz_practice_ready(v_q.container_id)') < pg_catalog.strpos(v_src, 'c.owner_id = v_user')
     OR pg_catalog.strpos(v_src, 'meldy_private.quiz_practice_ready(v_q.container_id)') > pg_catalog.strpos(v_src, 'for update')
     OR pg_catalog.strpos(v_src, 'meldy_private.quiz_practice_ready(v_q.container_id)') > pg_catalog.strpos(v_src, 'insert into') THEN
    RAISE EXCEPTION 'practice_join_waits_for_the_closing';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_result_json(uuid)');
  IF v_src IS NULL OR pg_catalog.strpos(v_src, '''ready'', meldy_private.quiz_practice_ready(v_q.container_id)') = 0
     OR pg_catalog.strpos(v_src, '''explanation'', case when v_review = ''answers''') = 0
     OR pg_catalog.strpos(v_src, '''key'', case when v_review = ''answers''') = 0
     OR pg_catalog.strpos(v_src, '''accent''') = 0 THEN
    RAISE EXCEPTION 'result_practice_ready';
  END IF;

  -- 5. Grants of the replaced functions as release 47 left them: practice for an account only; the helpers private.
  v_fn := pg_catalog.to_regprocedure('public.quiz_practice_join(text)');
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef AND 'search_path=""' = ANY (p.proconfig))
     OR NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'practice_join_grants';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY['quiz_ip_hash()', 'quiz_start_for(text,text,uuid,text)', 'quiz_result_json(uuid)'] LOOP
    v_fn := pg_catalog.to_regprocedure('meldy_private.' || v_sig);
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND NOT p.prosecdef AND 'search_path=""' = ANY (p.proconfig))
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'helper_private_%', v_sig;
    END IF;
  END LOOP;
  -- The throttle table stays private.
  v_rel := pg_catalog.to_regclass('meldy_private.quiz_guest_starts');
  IF v_rel IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_rel)
     OR pg_catalog.has_table_privilege('anon', v_rel, 'SELECT,INSERT,UPDATE,DELETE')
     OR pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'throttle_table_private';
  END IF;
END
$check$;
