-- Run once after migration 20261105090000_quiz_stats.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog only.
-- Checks: public.quiz_analysis(uuid), public.quiz_send_mistakes(uuid) and public.test_item_percents(uuid) exist, return
-- jsonb, are SECURITY DEFINER with an empty search_path, read auth.uid() and check the author (containers.owner_id),
-- and are executable by authenticated only (not by anon, PUBLIC or service_role); quiz_send_mistakes records through
-- meldy_private.record_test_answers_for with the qz: event ids. The behaviour is rehearsed locally:
-- supabase/tests/local/quiz_stats_telegram_run.sh (quiz_stats_behaviour.sql).
DO $check$
DECLARE
  v_fn text;
  v_src text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.quiz_analysis(uuid)', 'public.quiz_send_mistakes(uuid)', 'public.test_item_percents(uuid)'] LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION 'function_exists: %', v_fn;
    END IF;
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn);
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn))
       OR NOT coalesce((SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc p
                         WHERE p.oid = pg_catalog.to_regprocedure(v_fn)), false)
       OR (SELECT p.prorettype FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn)) <> 'jsonb'::regtype THEN
      RAISE EXCEPTION 'definer_empty_search_path_jsonb: %', v_fn;
    END IF;
    IF pg_catalog.strpos(v_src, 'auth.uid()') = 0 OR pg_catalog.strpos(v_src, 'c.owner_id = v_user') = 0 THEN
      RAISE EXCEPTION 'author_only: %', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) x
                   WHERE p.oid = pg_catalog.to_regprocedure(v_fn) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated_only: %', v_fn;
    END IF;
  END LOOP;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.quiz_send_mistakes(uuid)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'meldy_private.record_test_answers_for(') = 0 OR pg_catalog.strpos(v_src, '''qz:''') = 0
     OR pg_catalog.strpos(v_src, '''learn''') = 0 THEN
    RAISE EXCEPTION 'send_mistakes_through_the_core_with_qz_ids';
  END IF;
END
$check$;
