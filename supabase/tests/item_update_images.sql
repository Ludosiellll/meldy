-- Run once after migration *_item_update_images.sql: the read-only check of that apply. A DO block that raises nothing
-- when every check holds; it raises the name of the first one that does not. Nothing is written: it reads the catalog.
-- Checks: container_item_update takes «images» (its source sets the column and refuses extra option lists), is still
-- SECURITY DEFINER with an empty search_path, and anon cannot run it. The behaviour is rehearsed locally:
-- supabase/tests/local/item_update_images_run.sh.
DO $check$
DECLARE
  v_fn regprocedure := 'public.container_item_update(uuid, jsonb)'::regprocedure;
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF v_src NOT LIKE '%images = case when p_patch ? ''images''%' THEN
    RAISE EXCEPTION 'update_sets_images';
  END IF;
  IF v_src NOT LIKE '%detail = ''images''%' THEN
    RAISE EXCEPTION 'update_refuses_extra_option_lists';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND 'search_path=""' = ANY (p.proconfig)) THEN
    RAISE EXCEPTION 'update_definer_and_search_path';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'execute') THEN
    RAISE EXCEPTION 'anon_cannot_update';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'execute') THEN
    RAISE EXCEPTION 'authenticated_can_update';
  END IF;
END
$check$;
