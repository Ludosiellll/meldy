-- Run once after migration 20261019090000_container_kind.sql (release 47.3): the read-only check of that apply. A DO block
-- that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not.
-- Catalog only: the column public.containers.kind (text, not null, default 'exam') and its check; the author writes it
-- as the title (authenticated may update the table, «Containers: update own» decides, nobody else's row); the six
-- replaced functions carry the change (a marker of each in its source) and stay closed to clients. Behaviour:
-- supabase/tests/local/container_kind_run.sh.
DO $check$
DECLARE
  v_fn regprocedure;
  v_src text;
  v_sig text;
  v_pair text[];
BEGIN
  -- 1. The column and its check.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'containers' AND c.column_name = 'kind'
                    AND c.data_type = 'text' AND c.is_nullable = 'NO' AND c.column_default = '''exam''::text') THEN
    RAISE EXCEPTION 'kind_column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.containers'::regclass AND k.conname = 'containers_kind_check' AND k.contype = 'c'
                    AND k.convalidated
                    AND pg_catalog.pg_get_constraintdef(k.oid) ~ 'exam' AND pg_catalog.pg_get_constraintdef(k.oid) ~ 'test') THEN
    RAISE EXCEPTION 'kind_check';
  END IF;

  -- 2. The author's write: the table under row security, UPDATE for authenticated, the owner's policy, nothing for anon.
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.containers'::regclass) THEN
    RAISE EXCEPTION 'containers_row_security';
  END IF;
  IF NOT pg_catalog.has_column_privilege('authenticated', 'public.containers', 'kind', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.containers', 'UPDATE') THEN
    RAISE EXCEPTION 'kind_write_grants';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                  WHERE p.schemaname = 'public' AND p.tablename = 'containers' AND p.policyname = 'Containers: update own'
                    AND p.cmd = 'UPDATE' AND p.roles = '{authenticated}'
                    AND p.qual ~ 'owner_id' AND p.with_check ~ 'owner_id') THEN
    RAISE EXCEPTION 'kind_write_policy';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename = 'containers' AND p.cmd IN ('UPDATE', 'ALL')) <> 1 THEN
    RAISE EXCEPTION 'kind_write_one_policy';
  END IF;

  -- 3. The replaced functions carry the change.
  FOREACH v_pair SLICE 1 IN ARRAY ARRAY[
      ARRAY['meldy_private.plan_inputs_for(uuid,date,uuid)', 'and (p_container_id is not null or c.owner_id <> p_user or c.kind <> ''test'')'],
      ARRAY['meldy_private.plan_inputs_for(uuid,date,uuid)', 'coalesce(cs.own_date, s.exam_date, cs.exam_date) as test_date'],
      ARRAY['meldy_private.container_summary_for(uuid,uuid,date)', '''title'', v_c.title, ''kind'', v_c.kind'],
      ARRAY['meldy_private.container_summary_for(uuid,uuid,date)', '''own_exam_date'', v_own, ''author_exam_date'', v_c.exam_date'],
      ARRAY['meldy_private.containers_overview_for(uuid,date)', '''title'', c.title, ''kind'', c.kind'],
      ARRAY['meldy_private.containers_overview_for(uuid,date)', '''own_exam_date'', cp.own_exam_date, ''author_exam_date'', c.exam_date'],
      ARRAY['bot.remind_on(uuid,uuid)', 'c.id = p_container and c.owner_id = p_user and c.kind = ''test'''],
      ARRAY['bot.remind_any(uuid)', 'coalesce(p.tg_remind, true) and not (c.owner_id = p_user and c.kind = ''test'')'],
      ARRAY['bot.exams_list(uuid,date)', 'and not (c.owner_id = p_user and c.kind = ''test'')']] LOOP
    v_fn := pg_catalog.to_regprocedure(v_pair[1]);
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
    IF v_fn IS NULL OR pg_catalog.strpos(v_src, v_pair[2]) = 0 THEN
      RAISE EXCEPTION 'replaced % (%)', v_pair[1], v_pair[2];
    END IF;
  END LOOP;

  -- 4. Closed to clients (a client reaches none: no USAGE on its schema, or no EXECUTE on it), an empty search_path (as
  --    before: CREATE OR REPLACE kept the grants).
  FOREACH v_sig IN ARRAY ARRAY['meldy_private.plan_inputs_for(uuid,date,uuid)', 'meldy_private.container_summary_for(uuid,uuid,date)',
                                'meldy_private.containers_overview_for(uuid,date)', 'bot.remind_on(uuid,uuid)',
                                'bot.remind_any(uuid)', 'bot.exams_list(uuid,date)'] LOOP
    v_fn := pg_catalog.to_regprocedure(v_sig);
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn
                      AND pg_catalog.array_to_string(p.proconfig, ',') IN ('search_path=""', 'search_path=')) THEN
      RAISE EXCEPTION 'replaced_search_path %', v_sig;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                 CROSS JOIN (VALUES ('anon'), ('authenticated')) r(role)
                WHERE p.oid = v_fn
                  AND pg_catalog.has_schema_privilege(r.role, n.oid, 'USAGE')
                  AND pg_catalog.has_function_privilege(r.role, p.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'replaced_closed %', v_sig;
    END IF;
  END LOOP;
END
$check$;
