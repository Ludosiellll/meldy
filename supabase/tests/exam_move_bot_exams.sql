-- Run once after migration 20261018120000_exam_move_bot_exams.sql (release 47): the read-only check of that apply. A DO
-- block that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does
-- not. Catalog only: the two columns of public.container_plans and their check; the six new API functions (SECURITY
-- DEFINER, an empty search_path; the site's three for authenticated and not anon, the bot's three for the service role
-- only, gated first); the new cores and helpers closed to clients; the replaced functions carry the own date and the
-- per-exam switch (their sources). Behaviour: supabase/tests/local/exam_move_bot_exams_run.sh.
DO $check$
DECLARE
  v_fn regprocedure;
  v_src text;
  v_sig text;
  v_pair text[];
BEGIN
  -- 1. The columns.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'container_plans' AND c.column_name = 'own_exam_date'
                    AND c.data_type = 'date' AND c.is_nullable = 'YES') THEN
    RAISE EXCEPTION 'own_exam_date_column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'container_plans' AND c.column_name = 'tg_remind'
                    AND c.data_type = 'boolean' AND c.is_nullable = 'NO' AND c.column_default = 'true') THEN
    RAISE EXCEPTION 'tg_remind_column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.container_plans'::regclass AND k.conname = 'container_plans_own_exam_date_check'
                    AND k.convalidated) THEN
    RAISE EXCEPTION 'own_exam_date_range';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.container_plans'::regclass) THEN
    RAISE EXCEPTION 'container_plans_row_security';
  END IF;

  -- 2. The site's functions: SECURITY DEFINER, empty search_path, authenticated yes, anon no.
  FOREACH v_sig IN ARRAY ARRAY['exam_date_move(uuid,date,text,uuid)', 'exam_remind_set(uuid,boolean)', 'telegram_exams()'] LOOP
    v_fn := pg_catalog.to_regprocedure('public.' || v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'site_function_missing %', v_sig;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef
                      AND p.proconfig IS NOT NULL AND pg_catalog.array_to_string(p.proconfig, ',') IN ('search_path=""', 'search_path=')) THEN
      RAISE EXCEPTION 'site_function_definer_search_path %', v_sig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'site_function_grants %', v_sig;
    END IF;
  END LOOP;

  -- 3. The bot's functions: SECURITY DEFINER, empty search_path, the service-role gate first, the service role only.
  FOREACH v_sig IN ARRAY ARRAY['bot_exams(bigint)', 'bot_exam_remind(bigint,uuid,boolean)', 'bot_exam_move(bigint,uuid,date,text)'] LOOP
    v_fn := pg_catalog.to_regprocedure('public.' || v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'bot_function_missing %', v_sig;
    END IF;
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef
                      AND pg_catalog.array_to_string(p.proconfig, ',') IN ('search_path=""', 'search_path=')) THEN
      RAISE EXCEPTION 'bot_function_definer_search_path %', v_sig;
    END IF;
    IF pg_catalog.substr(v_src, pg_catalog.regexp_instr(v_src, '\mbegin\M', 1, 1, 0, 'i'))
       !~* '^begin\s+perform\s+meldy_private\.require_service_role\(\s*\)\s*;' THEN
      RAISE EXCEPTION 'bot_function_gate_first %', v_sig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'bot_function_grants %', v_sig;
    END IF;
  END LOOP;

  -- 4. The cores and the helpers: present, empty search_path, closed to clients.
  FOREACH v_sig IN ARRAY ARRAY['meldy_private.exam_date_move_for(uuid,uuid,date,text,uuid,date)',
                                'meldy_private.exam_remind_set_for(uuid,uuid,boolean)', 'bot.remind_on(uuid,uuid)',
                                'bot.remind_any(uuid)', 'bot.last_date(uuid,uuid)', 'bot.exams_list(uuid,date)'] LOOP
    v_fn := pg_catalog.to_regprocedure(v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'helper_missing %', v_sig;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn
                      AND pg_catalog.array_to_string(p.proconfig, ',') IN ('search_path=""', 'search_path=')) THEN
      RAISE EXCEPTION 'helper_search_path %', v_sig;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'helper_closed %', v_sig;
    END IF;
  END LOOP;

  -- 5. The replaced functions take the own date and the switch (a marker of each change in its source).
  FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
      ARRAY['meldy_private.plan_inputs_for(uuid,date,uuid)', 'coalesce(cs.own_date, s.exam_date, cs.exam_date) as test_date'],
      ARRAY['meldy_private.plan_inputs_for(uuid,date,uuid)', '''exam_date'', coalesce(cs.own_date, cs.exam_date)'],
      ARRAY['meldy_private.container_summary_for(uuid,uuid,date)', '''own_exam_date'', v_own, ''author_exam_date'', v_c.exam_date'],
      ARRAY['meldy_private.container_summary_for(uuid,uuid,date)', '''exam_date'', coalesce(v_own, s.exam_date, v_c.exam_date)'],
      ARRAY['meldy_private.containers_overview_for(uuid,date)', '''own_exam_date'', cp.own_exam_date, ''author_exam_date'', c.exam_date'],
      ARRAY['meldy_private.record_test_answers_for(uuid,jsonb,text,integer,text,uuid)', 'coalesce(p.own_exam_date, s.exam_date, c.exam_date) into v_exam'],
      ARRAY['bot.exams_json(uuid)', '''tg_remind'', coalesce(p.tg_remind, true)'],
      ARRAY['bot.after_date_json(uuid,uuid,date)', '''role'', meldy_private.role_in(p_user, c.id)'],
      ARRAY['bot.tick_due(timestamptz)', 'bot.remind_on(l.user_id, c.id)'],
      ARRAY['public.bot_claim_reminders(integer,timestamptz)', 'and bot.remind_any(a.user_id)'],
      ARRAY['public.bot_reminder_context(bigint)', 'not bot.remind_any(v_l.user_id) then ''off'''],
      ARRAY['public.bot_reminder_context(bigint)', '''exam_list'', bot.exams_list(v_l.user_id, v_d.local_day)'],
      ARRAY['public.bot_today(bigint)', '''exam_list'', bot.exams_list(v_l.user_id, v_day)'],
      ARRAY['public.bot_claim_after_date(integer,timestamptz)', 'where bot.remind_on(r.user_id, c.id)'],
      ARRAY['public.bot_claim_after_date(integer,timestamptz)', 'and d.local_day > e.last_date'],
      ARRAY['public.bot_oral_inputs(bigint)', 'coalesce(p.own_exam_date, e.exam_date) as exam_date']] LOOP
    v_fn := pg_catalog.to_regprocedure(v_pair[1]);
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
    IF v_fn IS NULL OR pg_catalog.strpos(v_src, v_pair[2]) = 0 THEN
      RAISE EXCEPTION 'replaced % (%)', v_pair[1], v_pair[2];
    END IF;
  END LOOP;
END
$check$;
