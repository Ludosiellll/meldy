-- Run once after migration 20261107090200_group_link_life.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog only.
-- Checks: the new RPC container_link_extend (SECURITY DEFINER, empty search_path, authenticated yes, anon no); the
-- helper and the trigger functions (empty search_path, the writing ones SECURITY DEFINER, executable by no API role);
-- the triggers (exam_date_in_range BEFORE INSERT OR UPDATE OF exam_date on public.containers and
-- public.container_subjects and BEFORE UPDATE OF exam_date on public.exams; links_follow_date AFTER UPDATE OF exam_date
-- on the three; copies_follow_date AFTER UPDATE OF exam_date on public.exams; row level, enabled); the column
-- container_member_exams.follows_author; the replaced functions: container_link_create ends a link by link_date_end and
-- 120 days, container_link_preview says the author's link state and still runs for anon, exam_share_claim,
-- exam_share_bundle and exam_share_preview check a container's members (the preview still runs for anon),
-- take_container_orals closes a deleted exam's links' oral shares, exam_date_move_for and container_subjects_guard take
-- the exam's row FOR NO KEY UPDATE; their grants as they were. The behaviour is rehearsed locally:
-- supabase/tests/local/group_link_life_run.sh.
DO $check$
DECLARE
  v_fn regprocedure;
  v_sig text;
  v_role text;
  v_trg record;
BEGIN
  -- 1. The new functions.
  FOREACH v_sig IN ARRAY ARRAY['public.container_link_extend(uuid)', 'meldy_private.link_date_end(uuid)',
                               'meldy_private.links_follow_date()', 'meldy_private.copies_follow_date()',
                               'meldy_private.exam_date_in_range()'] LOOP
    v_fn := pg_catalog.to_regprocedure(v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'function_missing %', v_sig;
    END IF;
    IF NOT coalesce((SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc p WHERE p.oid = v_fn), false) THEN
      RAISE EXCEPTION 'empty_search_path %', v_sig;
    END IF;
    IF v_sig IN ('public.container_link_extend(uuid)', 'meldy_private.links_follow_date()', 'meldy_private.copies_follow_date()')
       AND NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) THEN
      RAISE EXCEPTION 'security_definer %', v_sig;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = 'meldy_private.link_date_end(uuid)'::regprocedure AND p.prosrc LIKE '%760 days%'
                    AND p.prosrc LIKE '%2100-12-31%' AND p.prosrc LIKE '%public.exams e%') THEN
    RAISE EXCEPTION 'link_date_end_range_cap_oral';
  END IF;

  -- 2. Who runs them: the RPC for authenticated only; the helper and the trigger functions for no API role.
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.container_link_extend(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'extend_for_authenticated';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.container_link_extend(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'extend_not_for_anon';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY['meldy_private.link_date_end(uuid)', 'meldy_private.links_follow_date()',
                               'meldy_private.copies_follow_date()', 'meldy_private.exam_date_in_range()'] LOOP
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
      ('public.containers', 'exam_date_in_range', 'meldy_private.exam_date_in_range()',
       '%BEFORE INSERT OR UPDATE OF exam_date ON public.containers FOR EACH ROW%'),
      ('public.container_subjects', 'exam_date_in_range', 'meldy_private.exam_date_in_range()',
       '%BEFORE INSERT OR UPDATE OF exam_date ON public.container_subjects FOR EACH ROW%'),
      ('public.exams', 'exam_date_in_range', 'meldy_private.exam_date_in_range()',
       '%BEFORE UPDATE OF exam_date ON public.exams FOR EACH ROW%'),
      ('public.containers', 'links_follow_date', 'meldy_private.links_follow_date()', '%AFTER UPDATE OF exam_date ON public.containers FOR EACH ROW%'),
      ('public.container_subjects', 'links_follow_date', 'meldy_private.links_follow_date()',
       '%AFTER UPDATE OF exam_date ON public.container_subjects FOR EACH ROW%'),
      ('public.exams', 'links_follow_date', 'meldy_private.links_follow_date()', '%AFTER UPDATE OF exam_date ON public.exams FOR EACH ROW%'),
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

  -- 4. The column.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'container_member_exams' AND c.column_name = 'follows_author'
                    AND c.data_type = 'boolean' AND c.is_nullable = 'NO' AND c.column_default = 'true') THEN
    RAISE EXCEPTION 'follows_author_column';
  END IF;

  -- 5. The replaced functions: what changed in them, and the grants they had.
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
  FOREACH v_sig IN ARRAY ARRAY['public.exam_share_claim(text)', 'public.exam_share_bundle(text)', 'public.exam_share_preview(text)'] LOOP
    v_fn := v_sig::regprocedure;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef
                     AND p.prosrc LIKE '%l.oral_share_ids%' AND p.prosrc LIKE '%meldy_private.role_in(v_user, l.container_id) = ''member''%') THEN
      RAISE EXCEPTION 'members_check %', v_sig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR (v_sig <> 'public.exam_share_preview(text)' AND pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE'))
       OR (v_sig = 'public.exam_share_preview(text)' AND NOT pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')) THEN
      RAISE EXCEPTION 'share_grants %', v_sig;
    END IF;
  END LOOP;
  -- A deleted exam closes its links' oral shares first (the trigger of 20261107090000, its function replaced).
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = 'meldy_private.take_container_orals()'::regprocedure AND p.prosecdef
                    AND p.prosrc LIKE '%update public.exam_shares sh set revoked_at%' AND p.prosrc LIKE '%l.oral_share_ids%'
                    AND p.prosrc LIKE '%delete from public.exams e%') THEN
    RAISE EXCEPTION 'take_container_orals_closes_shares';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY['meldy_private.exam_date_move_for(uuid,uuid,date,text,uuid,date)', 'public.container_subjects_guard()'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_sig::regprocedure
                     AND p.prosrc LIKE '%for no key update;%' AND p.prosrc NOT LIKE '%c.id = % for update;%') THEN
      RAISE EXCEPTION 'no_key_update %', v_sig;
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.exam_date_move(uuid,date,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'exam_date_move_grants';
  END IF;
END
$check$;
