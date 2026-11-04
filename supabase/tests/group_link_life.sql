-- Run once after migration 20261107090200_group_link_life.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog only.
-- Checks: the new RPC container_link_extend (SECURITY DEFINER, empty search_path, authenticated yes, anon no); the
-- helper and the two trigger functions (empty search_path, the trigger functions SECURITY DEFINER, executable by no API
-- role); the three triggers (links_follow_date AFTER UPDATE OF exam_date on public.containers and AFTER INSERT OR UPDATE
-- OF exam_date on public.container_subjects, copies_follow_date AFTER UPDATE OF exam_date on public.exams; row level,
-- enabled); container_link_create ends a link by link_date_end and 120 days (no «+ 2» left) with its grants as they
-- were; container_link_preview says the author's link state and still runs for anon. The behaviour is rehearsed
-- locally: supabase/tests/local/group_link_life_run.sh.
DO $check$
DECLARE
  v_fn regprocedure;
  v_sig text;
  v_role text;
  v_trg record;
BEGIN
  -- 1. The new functions.
  FOREACH v_sig IN ARRAY ARRAY['public.container_link_extend(uuid)', 'meldy_private.link_date_end(uuid)',
                               'meldy_private.links_follow_date()', 'meldy_private.copies_follow_date()'] LOOP
    v_fn := pg_catalog.to_regprocedure(v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'function_missing %', v_sig;
    END IF;
    IF NOT coalesce((SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc p WHERE p.oid = v_fn), false) THEN
      RAISE EXCEPTION 'empty_search_path %', v_sig;
    END IF;
    IF v_sig <> 'meldy_private.link_date_end(uuid)'
       AND NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) THEN
      RAISE EXCEPTION 'security_definer %', v_sig;
    END IF;
  END LOOP;

  -- 2. Who runs them: the RPC for authenticated only; the helper and the trigger functions for no API role.
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.container_link_extend(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'extend_for_authenticated';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.container_link_extend(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'extend_not_for_anon';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY['meldy_private.link_date_end(uuid)', 'meldy_private.links_follow_date()',
                               'meldy_private.copies_follow_date()'] LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = v_role)
         AND pg_catalog.has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'no_grant % %', v_sig, v_role;
      END IF;
    END LOOP;
  END LOOP;

  -- 3. The triggers.
  FOR v_trg IN
    SELECT * FROM (VALUES
      ('public.containers', 'links_follow_date', 'meldy_private.links_follow_date()', '%AFTER UPDATE OF exam_date ON public.containers FOR EACH ROW%'),
      ('public.container_subjects', 'links_follow_date', 'meldy_private.links_follow_date()',
       '%AFTER INSERT OR UPDATE OF exam_date ON public.container_subjects FOR EACH ROW%'),
      ('public.exams', 'copies_follow_date', 'meldy_private.copies_follow_date()', '%AFTER UPDATE OF exam_date ON public.exams FOR EACH ROW%')
    ) AS x(rel, name, fn, def)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                    WHERE t.tgrelid = v_trg.rel::regclass AND t.tgname = v_trg.name AND NOT t.tgisinternal
                      AND t.tgenabled = 'O' AND t.tgfoid = v_trg.fn::regprocedure
                      AND pg_catalog.pg_get_triggerdef(t.oid) LIKE v_trg.def) THEN
      RAISE EXCEPTION 'trigger % on %', v_trg.name, v_trg.rel;
    END IF;
  END LOOP;

  -- 4. The replaced functions: the new end, the link state, the grants they had.
  v_fn := 'public.container_link_create(uuid,integer,text)'::regprocedure;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef
                   AND p.prosrc LIKE '%meldy_private.link_date_end(p_container_id)%' AND p.prosrc LIKE '%120 days%'
                   AND p.prosrc NOT LIKE '%v_last + 2%') THEN
    RAISE EXCEPTION 'link_create_end';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'link_create_grants';
  END IF;
  v_fn := 'public.container_link_preview(text)'::regprocedure;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef
                   AND p.prosrc LIKE '%jsonb_build_object(''link'',%') THEN
    RAISE EXCEPTION 'link_preview_state';
  END IF;
  IF NOT pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'link_preview_grants';
  END IF;
END
$check$;
