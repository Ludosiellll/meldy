-- Run once after migration 20261103090200_picture_sweep.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog only.
-- Checks: the queue meldy_private.picture_sweep (container_id the key, row security on, no grant to a client role or to
-- service_role); the AFTER DELETE FOR EACH ROW trigger containers_queue_picture_sweep on public.containers, enabled,
-- running meldy_private.queue_picture_sweep() (SECURITY DEFINER, empty search_path, executable by no client role);
-- public.bot_picture_sweep(integer, timestamptz) and public.bot_picture_swept(uuid): SECURITY DEFINER with an empty
-- search_path, the service-role check first, executable by service_role and by neither anon nor authenticated.
-- The behaviour (a delete queues its folder, a refused delete queues nothing, the bot takes and clears folders) is
-- rehearsed locally: supabase/tests/local/oral_journal_sweep_run.sh (picture_sweep_behaviour.sql); the step itself:
-- supabase/functions/_shared/bot/sweep.test.ts.
DO $check$
DECLARE
  v_fn text;
  v_role text;
  v_src text;
BEGIN
  IF pg_catalog.to_regclass('meldy_private.picture_sweep') IS NULL THEN
    RAISE EXCEPTION 'queue_exists';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'meldy_private.picture_sweep'::regclass)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname = 'meldy_private' AND p.tablename = 'picture_sweep') THEN
    RAISE EXCEPTION 'queue_row_security_without_policy';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'meldy_private.picture_sweep'::regclass AND k.contype = 'p'
                    AND pg_catalog.pg_get_constraintdef(k.oid) = 'PRIMARY KEY (container_id)') THEN
    RAISE EXCEPTION 'queue_key_is_the_container';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF pg_catalog.has_table_privilege(v_role, 'meldy_private.picture_sweep', 'SELECT')
       OR pg_catalog.has_table_privilege(v_role, 'meldy_private.picture_sweep', 'INSERT')
       OR pg_catalog.has_table_privilege(v_role, 'meldy_private.picture_sweep', 'UPDATE')
       OR pg_catalog.has_table_privilege(v_role, 'meldy_private.picture_sweep', 'DELETE') THEN
      RAISE EXCEPTION 'queue_no_grant: %', v_role;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.containers'::regclass AND t.tgname = 'containers_queue_picture_sweep'
                    AND NOT t.tgisinternal AND t.tgenabled = 'O'
                    AND t.tgfoid = 'meldy_private.queue_picture_sweep()'::regprocedure
                    AND pg_catalog.pg_get_triggerdef(t.oid) LIKE '%AFTER DELETE ON public.containers FOR EACH ROW%') THEN
    RAISE EXCEPTION 'trigger_after_delete_each_row';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.queue_picture_sweep()'::regprocedure)
     OR NOT coalesce((SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc p
                       WHERE p.oid = 'meldy_private.queue_picture_sweep()'::regprocedure), false)
     OR pg_catalog.has_function_privilege('anon', 'meldy_private.queue_picture_sweep()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'meldy_private.queue_picture_sweep()', 'EXECUTE') THEN
    RAISE EXCEPTION 'trigger_function_flags_and_grants';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY['public.bot_picture_sweep(integer,timestamptz)', 'public.bot_picture_swept(uuid)'] LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION 'bot_function_exists: %', v_fn;
    END IF;
    SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn);
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn))
       OR NOT coalesce((SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc p
                         WHERE p.oid = pg_catalog.to_regprocedure(v_fn)), false)
       OR pg_catalog.strpos(v_src, 'perform meldy_private.require_service_role();') = 0 THEN
      RAISE EXCEPTION 'bot_function_definer_service_role_first: %', v_fn;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'bot_function_service_role_only: %', v_fn;
    END IF;
  END LOOP;
END
$check$;
