-- Run once after migration 20261107090300_ai_key_flag.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog only.
-- Checks: public.container_item_update(uuid, jsonb) takes ai_key (refused as 22023 'ai_key' when it is not a boolean,
-- true without a non-empty correct or on a question that is not single or multiple choice; as 22023 'keyed' when the
-- question has a key already) and writes flags (adds 'ai_key' once, takes it out on false, a key change or any other
-- change that moves rev) and returns ai_key; it is still SECURITY DEFINER with an empty search_path, executable by
-- authenticated and not by anon; bot.session_view_json(bot.sessions) gives ai_key in the review; bot.group_item_ok
-- leaves out a key from the AI; no API role may insert into or update public.test_items, on the table or on any column
-- (only the owner's functions write flags). The behaviour is rehearsed locally: supabase/tests/local/ai_key_flag_run.sh.
DO $check$
DECLARE
  v_update text := pg_catalog.pg_get_functiondef('public.container_item_update(uuid, jsonb)'::regprocedure);
  v_view text := pg_catalog.pg_get_functiondef('bot.session_view_json(bot.sessions)'::regprocedure);
  v_group text := pg_catalog.pg_get_functiondef('bot.group_item_ok(public.test_items)'::regprocedure);
  v_role text;
BEGIN
  IF v_update NOT LIKE '%detail = ''ai_key''%'
     OR v_update NOT LIKE '%jsonb_typeof(p_patch -> ''ai_key'') <> ''boolean''%'
     OR v_update NOT LIKE '%and not p_patch ? ''correct''%' THEN
    RAISE EXCEPTION 'item_update_checks_ai_key';
  END IF;
  IF v_update NOT LIKE '%v_kind not in (''single'', ''multiple'')%'
     OR v_update NOT LIKE '%pg_catalog.jsonb_array_length(p_patch -> ''correct'') = 0%'
     OR v_update NOT LIKE '%if v_old.keyed then%detail = ''keyed''%' THEN
    RAISE EXCEPTION 'item_update_ai_key_only_for_a_keyless_choice';
  END IF;
  IF v_update NOT LIKE '%v_new.rev <> v_old.rev and p_patch -> ''ai_key'' is distinct from ''true''::jsonb%'
     OR v_update NOT LIKE '%''ai_key'', ''ai_key'' = any (v_new.flags)%' THEN
    RAISE EXCEPTION 'item_update_drops_the_mark_on_rev_and_returns_it';
  END IF;
  IF v_update NOT LIKE '%flags = case when p_patch -> ''ai_key'' = ''true''::jsonb%'
     OR v_update NOT LIKE '%pg_catalog.array_append(pg_catalog.array_remove(i.flags, ''ai_key''), ''ai_key'')%'
     OR v_update NOT LIKE '%then pg_catalog.array_remove(i.flags, ''ai_key'')%' THEN
    RAISE EXCEPTION 'item_update_writes_flags';
  END IF;
  IF v_update NOT LIKE '%c.owner_id = v_user%' OR v_update NOT LIKE '%meldy_private.kind_keys_bad(p_patch, v_user)%'
     OR v_update NOT LIKE '%insert into public.test_item_key_changes%' THEN
    RAISE EXCEPTION 'item_update_keeps_its_checks';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = 'public.container_item_update(uuid, jsonb)'::regprocedure)
     OR NOT coalesce((SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc p
                       WHERE p.oid = 'public.container_item_update(uuid, jsonb)'::regprocedure), false) THEN
    RAISE EXCEPTION 'item_update_definer_search_path';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'authenticated')
     AND NOT pg_catalog.has_function_privilege('authenticated', 'public.container_item_update(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'item_update_granted_to_authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'anon')
     AND pg_catalog.has_function_privilege('anon', 'public.container_item_update(uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'item_update_not_anon';
  END IF;
  IF v_view NOT LIKE '%''key_source'', v_item.key_source,%''ai_key'', ''ai_key'' = any (v_item.flags),%' THEN
    RAISE EXCEPTION 'bot_view_gives_ai_key';
  END IF;
  IF v_group NOT LIKE '%and not (''ai_key'' = any (p_i.flags))%' OR v_group NOT LIKE '%not (''has_image'' = any (p_i.flags))%'
     OR v_group NOT LIKE '%p_i.images = ''{}''::jsonb%' OR v_group NOT LIKE '%test_key_doubts%' THEN
    RAISE EXCEPTION 'group_question_not_from_the_ai';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = v_role)
       AND (pg_catalog.has_table_privilege(v_role, 'public.test_items', 'INSERT')
            OR pg_catalog.has_table_privilege(v_role, 'public.test_items', 'UPDATE')
            OR pg_catalog.has_any_column_privilege(v_role, 'public.test_items', 'INSERT')
            OR pg_catalog.has_any_column_privilege(v_role, 'public.test_items', 'UPDATE')) THEN
      RAISE EXCEPTION 'test_items_not_written_by: %', v_role;
    END IF;
  END LOOP;
END
$check$;
