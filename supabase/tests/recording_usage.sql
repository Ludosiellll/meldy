-- Run once after migration 20261026090000_recording_usage.sql (the day's total of lecture recordings): the read-only
-- check of that apply. A DO block that raises nothing when every check holds (supabase/migrate.py); it raises the name
-- of the first one that does not. Catalog only: the table with RLS on and no client grant at all, the two functions
-- SECURITY DEFINER with an empty search_path, callable by authenticated and not by anon. Behaviour:
-- supabase/tests/local/recording_usage_behaviour.sql.
DO $check$
DECLARE
  v_fn regprocedure;
  v_sig text;
BEGIN
  IF pg_catalog.to_regclass('public.recording_charges') IS NULL THEN
    RAISE EXCEPTION 'recording_charges_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = 'public.recording_charges'::regclass AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'recording_charges_rls_off';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.recording_charges', 'SELECT,INSERT,UPDATE,DELETE')
     OR pg_catalog.has_table_privilege('anon', 'public.recording_charges', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'recording_charges_client_grant';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY['public.consume_recording_seconds(integer)', 'public.refund_recording_seconds(uuid)'] LOOP
    v_fn := pg_catalog.to_regprocedure(v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'recording_function_missing: %', v_sig;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef
                      AND pg_catalog.array_to_string(p.proconfig, ',') IN ('search_path=""', 'search_path=')) THEN
      RAISE EXCEPTION 'recording_function_definer_search_path: %', v_sig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'recording_function_grants: %', v_sig;
    END IF;
  END LOOP;
END
$check$;
