-- Run once after migration 20261105090100_quiz_telegram.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog only.
-- Checks: bot.quiz_watch (mode each | digest | off, default off), bot.quiz_sends and bot.quiz_notices exist with row
-- security on, no policy and no grant to a client role or service_role; the private helpers quiz_score, quiz_tg_state,
-- quiz_of_author and quiz_tg_row are executable by no client role; telegram_quiz_state / _notice / _share are SECURITY
-- DEFINER with an empty search_path, check the author, and are executable by authenticated only; bot_quiz_notices is
-- SECURITY DEFINER with an empty search_path, checks the service role first, and is executable by service_role only.
-- The behaviour is rehearsed locally: supabase/tests/local/quiz_stats_telegram_run.sh (quiz_telegram_behaviour.sql);
-- the bot's step: supabase/functions/_shared/bot/quiz.test.ts.
DO $check$
DECLARE
  v_t text;
  v_fn text;
  v_role text;
  v_src text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['bot.quiz_watch', 'bot.quiz_sends', 'bot.quiz_notices'] LOOP
    IF pg_catalog.to_regclass(v_t) IS NULL THEN
      RAISE EXCEPTION 'table_exists: %', v_t;
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = pg_catalog.to_regclass(v_t))
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname || '.' || p.tablename = v_t) THEN
      RAISE EXCEPTION 'row_security_without_policy: %', v_t;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF pg_catalog.has_table_privilege(v_role, v_t, 'SELECT') OR pg_catalog.has_table_privilege(v_role, v_t, 'INSERT')
         OR pg_catalog.has_table_privilege(v_role, v_t, 'UPDATE') OR pg_catalog.has_table_privilege(v_role, v_t, 'DELETE') THEN
        RAISE EXCEPTION 'table_no_grant: % %', v_t, v_role;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'bot.quiz_watch'::regclass
                  AND k.conname = 'quiz_watch_mode_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%each%digest%off%')
     OR (SELECT column_default FROM information_schema.columns
          WHERE table_schema = 'bot' AND table_name = 'quiz_watch' AND column_name = 'mode') IS DISTINCT FROM '''off''::text' THEN
    RAISE EXCEPTION 'watch_modes_default_off';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname = 'bot' AND indexname = 'quiz_notices_done_key'
                  AND indexdef LIKE 'CREATE UNIQUE INDEX%(attempt_id) WHERE (kind = ''done''::text)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname = 'bot' AND indexname = 'quiz_notices_close_key'
                     AND indexdef LIKE 'CREATE UNIQUE INDEX%(quiz_id) WHERE (kind = ''close''::text)') THEN
    RAISE EXCEPTION 'one_notice_an_attempt_one_close_a_quiz';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY['meldy_private.quiz_score(uuid)', 'meldy_private.quiz_tg_state(public.quizzes,uuid)',
                              'meldy_private.quiz_of_author(uuid,uuid)', 'meldy_private.quiz_tg_row(bigint)'] LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION 'helper_exists: %', v_fn;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'helper_no_grant: %', v_fn;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY['public.telegram_quiz_state(uuid)', 'public.telegram_quiz_notice(uuid,text)',
                              'public.telegram_quiz_share(uuid,bigint)', 'public.bot_quiz_notices(integer,timestamptz)'] LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION 'function_exists: %', v_fn;
    END IF;
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn);
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn))
       OR NOT coalesce((SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc p
                         WHERE p.oid = pg_catalog.to_regprocedure(v_fn)), false) THEN
      RAISE EXCEPTION 'definer_empty_search_path: %', v_fn;
    END IF;
    IF v_fn LIKE 'public.bot_%' THEN
      IF pg_catalog.strpos(v_src, 'perform meldy_private.require_service_role();') = 0
         OR NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
         OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'bot_function_service_role_only: %', v_fn;
      END IF;
    ELSE
      IF pg_catalog.strpos(v_src, 'meldy_private.quiz_of_author(p_quiz_id, v_user)') = 0 OR pg_catalog.strpos(v_src, 'auth.uid()') = 0
         OR NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
         OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') OR pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
        RAISE EXCEPTION 'site_function_author_only: %', v_fn;
      END IF;
    END IF;
  END LOOP;
END
$check$;
