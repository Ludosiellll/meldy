-- Run once after migration 20261107090700_item_points.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog only.
-- Checks: public.test_items.points is smallint, not null, default 1, with test_items_points_check 1..100 (validated);
-- meldy_private.quiz_item_points(uuid[]) gives the drawn questions' points (null when all are 1) and no API role may run
-- it; meldy_private.quiz_start_for stores it for a quiz of subjects and the blocks' points for a design quiz; the readers
-- of a score still weigh by quiz_attempts.item_points (quiz_result_json, quiz_results, quiz_score); public.container_items_add
-- takes points (22023 «item <n>: points») and writes the column; public.container_item_update takes points (22023
-- 'points'), writes it without touching rev or the AI's mark and returns it; both are still SECURITY DEFINER with an
-- empty search_path, executable by authenticated and not by anon; no API role may insert into or update
-- public.test_items, on the table or on any column. The behaviour is rehearsed locally:
-- supabase/tests/local/item_points_run.sh.
DO $check$
DECLARE
  v_start text := pg_catalog.pg_get_functiondef('meldy_private.quiz_start_for(text, text, uuid, text)'::regprocedure);
  v_add text := pg_catalog.pg_get_functiondef('public.container_items_add(uuid, jsonb)'::regprocedure);
  v_update text := pg_catalog.pg_get_functiondef('public.container_item_update(uuid, jsonb)'::regprocedure);
  v_fn text;
  v_role text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'test_items' AND c.column_name = 'points'
                    AND c.data_type = 'smallint' AND c.is_nullable = 'NO' AND c.column_default = '1') THEN
    RAISE EXCEPTION 'test_items_points_column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.test_items'::regclass AND k.conname = 'test_items_points_check' AND k.convalidated
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%(points >= 1)%'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%(points <= 100)%') THEN
    RAISE EXCEPTION 'test_items_points_check';
  END IF;
  IF pg_catalog.to_regprocedure('meldy_private.quiz_item_points(uuid[])') IS NULL
     OR (SELECT p.prorettype FROM pg_catalog.pg_proc p
          WHERE p.oid = 'meldy_private.quiz_item_points(uuid[])'::regprocedure) <> 'smallint[]'::regtype
     OR pg_catalog.strpos(pg_catalog.pg_get_functiondef('meldy_private.quiz_item_points(uuid[])'::regprocedure),
                          'i.points <> 1') = 0 THEN
    RAISE EXCEPTION 'quiz_item_points';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = v_role)
       AND pg_catalog.has_function_privilege(v_role, 'meldy_private.quiz_item_points(uuid[])', 'EXECUTE') THEN
      RAISE EXCEPTION 'quiz_item_points_private: %', v_role;
    END IF;
  END LOOP;
  IF pg_catalog.strpos(v_start, 'coalesce(case when v_q.design then meldy_private.quiz_doc_points(v_q.container_id, v_items) end,') = 0
     OR pg_catalog.strpos(v_start, 'meldy_private.quiz_item_points(v_items)),') = 0
     OR pg_catalog.strpos(v_start, 'insert into public.quiz_attempts (quiz_id, user_id, guest_hash, name, n, item_ids, item_points') = 0 THEN
    RAISE EXCEPTION 'quiz_start_stores_the_points';
  END IF;
  -- The readers weigh by the attempt's points (nothing new: they must still do so).
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef('meldy_private.quiz_result_json(uuid)'::regprocedure),
                       'coalesce(v_a.item_points[g.ord], 1)') = 0
     OR pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.quiz_results(uuid)'::regprocedure),
                          'coalesce(a.item_points[g.ord], 1)') = 0
     OR pg_catalog.strpos(pg_catalog.pg_get_functiondef('meldy_private.quiz_score(uuid)'::regprocedure),
                          'coalesce(a.item_points[g.ord], 1)') = 0 THEN
    RAISE EXCEPTION 'scores_weigh_by_item_points';
  END IF;
  IF pg_catalog.strpos(v_add, 'then ''points''') = 0
     OR pg_catalog.strpos(v_add, 'tolerance, unit, partial, material_ids, points)') = 0
     OR pg_catalog.strpos(v_add, 'then (n.x ->> ''points'')::smallint else 1 end') = 0 THEN
    RAISE EXCEPTION 'items_add_takes_points';
  END IF;
  IF pg_catalog.strpos(v_update, 'detail = ''points''') = 0
     OR pg_catalog.strpos(v_update, 'points = case when p_patch ? ''points'' then (p_patch ->> ''points'')::smallint else i.points end') = 0
     OR pg_catalog.strpos(v_update, '''points'', v_new.points') = 0
     OR pg_catalog.strpos(v_update, '''ai_key'', ''ai_key'' = any (v_new.flags)') = 0
     OR pg_catalog.strpos(v_update, 'insert into public.test_item_key_changes') = 0 THEN
    RAISE EXCEPTION 'item_update_takes_points';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.container_items_add(uuid, jsonb)', 'public.container_item_update(uuid, jsonb)'] LOOP
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure)
       OR NOT coalesce((SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc p WHERE p.oid = v_fn::regprocedure), false) THEN
      RAISE EXCEPTION 'definer_search_path: %', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'authenticated')
       AND NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'granted_to_authenticated: %', v_fn;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'anon')
       AND pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'not_anon: %', v_fn;
    END IF;
  END LOOP;
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
