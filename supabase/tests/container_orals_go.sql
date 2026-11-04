-- Run once after migration 20261107090000_container_orals_go.sql: the read-only check of that apply. A DO block that
-- raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not.
-- Catalog only, plus a count of the 2026-11-04 leftovers the clean-up was to delete.
-- Checks: the BEFORE DELETE FOR EACH ROW trigger containers_take_orals on public.containers, enabled, running
-- meldy_private.take_container_orals() (SECURITY DEFINER, empty search_path, executable by no API role), firing after
-- containers_guard_delete (names in order: a delete refused for members deletes nothing); none of the leftovers remain.
-- The behaviour (a deleted container takes its owner's oral exams, keeps everyone else's, a refused delete keeps them)
-- is rehearsed locally: supabase/tests/local/container_orals_go_run.sh.
DO $check$
DECLARE
  v_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.containers'::regclass AND t.tgname = 'containers_take_orals'
                    AND NOT t.tgisinternal AND t.tgenabled = 'O'
                    AND t.tgfoid = 'meldy_private.take_container_orals()'::regprocedure
                    AND pg_catalog.pg_get_triggerdef(t.oid) LIKE '%BEFORE DELETE ON public.containers FOR EACH ROW%') THEN
    RAISE EXCEPTION 'trigger_before_delete_each_row';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.containers'::regclass AND t.tgname = 'containers_guard_delete' AND NOT t.tgisinternal)
     OR NOT ('containers_guard_delete' < 'containers_take_orals') THEN
    RAISE EXCEPTION 'guard_fires_first';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.take_container_orals()'::regprocedure)
     OR NOT coalesce((SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc p
                       WHERE p.oid = 'meldy_private.take_container_orals()'::regprocedure), false) THEN
    RAISE EXCEPTION 'trigger_function_flags';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = v_role)
       AND pg_catalog.has_function_privilege(v_role, 'meldy_private.take_container_orals()', 'EXECUTE') THEN
      RAISE EXCEPTION 'trigger_function_no_grant: %', v_role;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.exams e
              WHERE e.title ~ '^Предмет [0-9]+$' AND e.source_kind = 'file'
                AND e.created_at >= '2026-11-04 05:50:00+00' AND e.created_at < '2026-11-04 05:51:00+00'
                AND (SELECT count(*) FROM public.exam_questions q WHERE q.exam_id = e.id) = 1
                AND EXISTS (SELECT 1 FROM public.exam_questions q WHERE q.exam_id = e.id
                             AND q.text LIKE 'Задание на выполнение контрольной%')
                AND NOT EXISTS (SELECT 1 FROM public.container_subjects s WHERE s.exam_id = e.id)
                AND NOT EXISTS (SELECT 1 FROM public.container_member_exams m WHERE m.exam_id = e.id)
                AND NOT EXISTS (SELECT 1 FROM public.exam_shares x WHERE x.exam_id = e.id)) THEN
    RAISE EXCEPTION 'leftovers_of_2026_11_04_deleted';
  END IF;
END
$check$;
