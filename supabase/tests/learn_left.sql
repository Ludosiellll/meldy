-- Run once after migration 20261021140000_learn_left.sql («Осталось выучить»): the read-only check of that apply. A DO
-- block that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does
-- not. Catalog only: public.learn_left (SECURITY DEFINER, an empty search_path, authenticated and not anon),
-- public.bot_learn_left (the same, the service role only, gated first), the three cores closed to clients, and the
-- partial index of the journal. Behaviour and the equivalence with the site's rule: supabase/tests/local/learn_left_run.sh.
DO $check$
DECLARE
  v_fn regprocedure;
  v_sig text;
  v_src text;
  v_def text;
BEGIN
  -- 1. The site's function.
  v_fn := pg_catalog.to_regprocedure('public.learn_left(uuid[],text)');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'learn_left_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef
                    AND pg_catalog.array_to_string(p.proconfig, ',') IN ('search_path=""', 'search_path=')) THEN
    RAISE EXCEPTION 'learn_left_definer_search_path';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'learn_left_grants';
  END IF;

  -- 2. The bot's function: the service role only, its gate first.
  v_fn := pg_catalog.to_regprocedure('public.bot_learn_left(bigint)');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'bot_learn_left_missing';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef
                    AND pg_catalog.array_to_string(p.proconfig, ',') IN ('search_path=""', 'search_path=')) THEN
    RAISE EXCEPTION 'bot_learn_left_definer_search_path';
  END IF;
  IF pg_catalog.strpos(v_src, 'perform meldy_private.require_service_role();') = 0 THEN
    RAISE EXCEPTION 'bot_learn_left_gate';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'bot_learn_left_grants';
  END IF;

  -- 3. The cores: an empty search_path, no client may call them.
  FOREACH v_sig IN ARRAY ARRAY['norm_point_title(text)', 'learn_left_facts(jsonb,jsonb,timestamp with time zone,text)',
                               'learn_left_for(uuid,uuid[],text,timestamp with time zone)'] LOOP
    v_fn := pg_catalog.to_regprocedure('meldy_private.' || v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'core_missing %', v_sig;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND NOT p.prosecdef
                      AND pg_catalog.array_to_string(p.proconfig, ',') IN ('search_path=""', 'search_path=')) THEN
      RAISE EXCEPTION 'core_search_path %', v_sig;
    END IF;
    IF pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'core_grants %', v_sig;
    END IF;
  END LOOP;

  -- 4. normalizeTitle on a known line (the words the journal is matched by).
  IF meldy_private.norm_point_title('Ёмкость: P>MC, «связь»!') IS DISTINCT FROM 'емкость p > mc связь' THEN
    RAISE EXCEPTION 'norm_point_title';
  END IF;

  -- 5. The journal's index by question hash, partial on the two kinds, valid.
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'learning_events_user_qhash_idx' AND i.indrelid = 'public.learning_events'::regclass AND i.indisvalid;
  IF v_def IS NULL OR pg_catalog.strpos(v_def, 'question_hash') = 0 OR pg_catalog.strpos(v_def, 'oral_point') = 0
     OR pg_catalog.strpos(v_def, 'sheet_peek') = 0 THEN
    RAISE EXCEPTION 'journal_index';
  END IF;
END
$check$;
