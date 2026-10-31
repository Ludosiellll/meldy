-- Run once after migration 20261101090000_question_kinds.sql (release 48, part 1; docs/kinds/CONTRACT.md §1): the
-- read-only check of that apply. A DO block that raises nothing when every check holds (supabase/migrate.py); it raises
-- the name of the first one that does not. Catalog only, plus pure functions on literals; no user data is read.
-- Checks: the four columns of test_items (types, defaults); the checks take the eight kinds (test_items, test_answers)
-- and the per-kind rules; meldy_number_right exists with its fixed signature, immutable, an empty search_path, and gives
-- the contract's answers on a few cases; meldy_cloze_gaps; the validators keep their old answers for the old kinds;
-- kind_key and the write helpers are private; the item writes are SECURITY DEFINER with an empty search_path and know
-- the new keys; test_items_guard knows the new kinds. The behaviour is rehearsed locally:
-- supabase/tests/local/question_kinds_run.sh.
DO $check$
DECLARE
  v_fn regprocedure;
  v_src text;
BEGIN
  -- 1. Columns.
  IF (SELECT pg_catalog.count(*) FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'test_items'
         AND ((c.column_name = 'tolerance' AND c.data_type = 'numeric' AND c.is_nullable = 'YES' AND c.column_default IS NULL)
           OR (c.column_name = 'unit' AND c.data_type = 'text' AND c.is_nullable = 'YES' AND c.column_default IS NULL)
           OR (c.column_name = 'partial' AND c.data_type = 'boolean' AND c.is_nullable = 'NO' AND c.column_default = 'false')
           OR (c.column_name = 'material_ids' AND c.data_type = 'ARRAY' AND c.udt_name = '_uuid' AND c.is_nullable = 'NO'
               AND c.column_default LIKE '''{}''::uuid[]%'))) <> 4 THEN
    RAISE EXCEPTION 'test_items_new_columns';
  END IF;

  -- 2. Checks.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.test_items'::regclass AND k.conname = 'test_items_kind_check' AND k.convalidated
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%single%multiple%short%number%order%match%cloze%essay%') THEN
    RAISE EXCEPTION 'test_items_kind_check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.test_answers'::regclass AND k.conname = 'test_answers_kind_check' AND k.convalidated
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%single%multiple%short%number%order%match%cloze%essay%') THEN
    RAISE EXCEPTION 'test_answers_kind_check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.test_items'::regclass AND k.conname = 'test_items_options_check' AND k.convalidated
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%short%number%cloze%essay%meldy_options_ok(options)%') THEN
    RAISE EXCEPTION 'test_items_options_check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.test_items'::regclass AND k.conname = 'test_items_kind_fields_check' AND k.convalidated
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%tolerance >= %'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%meldy_cloze_gaps(stem)%'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%material_ids%') THEN
    RAISE EXCEPTION 'test_items_kind_fields_check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.test_items'::regclass AND k.conname = 'test_items_correct_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%meldy_key_ok(correct, jsonb_array_length(options), kind)%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                     WHERE k.conrelid = 'public.test_items'::regclass AND k.conname = 'test_items_answers_check'
                       AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%meldy_answers_ok(answers, kind)%') THEN
    RAISE EXCEPTION 'test_items_key_checks_kept';
  END IF;

  -- 3. The number rule (fixed: the live game builds on it).
  v_fn := pg_catalog.to_regprocedure('public.meldy_number_right(text, text[], numeric, text)');
  IF v_fn IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                                  WHERE p.oid = v_fn AND p.provolatile = 'i' AND p.prorettype = 'boolean'::regtype
                                    AND p.proconfig = ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'meldy_number_right_signature';
  END IF;
  IF NOT (public.meldy_number_right('9,75 м/с²', ARRAY['9.8'], 0.1, 'м/с²')
          AND public.meldy_number_right(' 1 000 ', ARRAY['1000'], NULL, NULL)
          AND public.meldy_number_right('1.1', ARRAY['1'], 0.1, NULL)
          AND public.meldy_number_right('5 М', ARRAY['5'], NULL, 'м')
          AND NOT public.meldy_number_right('1.1000001', ARRAY['1'], 0.1, NULL)
          AND NOT public.meldy_number_right('5 м', ARRAY['5'], NULL, NULL)
          AND NOT public.meldy_number_right('пять', ARRAY['5'], NULL, NULL)
          AND NOT public.meldy_number_right('1e3', ARRAY['1000'], NULL, NULL)
          AND NOT public.meldy_number_right(NULL, ARRAY['5'], NULL, NULL)) THEN
    RAISE EXCEPTION 'meldy_number_right_cases';
  END IF;
  IF public.meldy_cloze_gaps('Один ___ два _____ три __') <> 2 THEN
    RAISE EXCEPTION 'meldy_cloze_gaps';
  END IF;

  -- 4. The validators: the old kinds answer as before; the new kinds by the contract.
  IF NOT (public.meldy_key_ok('{1}', 3, 'single') AND NOT public.meldy_key_ok('{0,1}', 3, 'single')
          AND public.meldy_key_ok('{0,2}', 3, 'multiple') AND public.meldy_key_ok('{}', 0, 'short')
          AND NOT public.meldy_key_ok('{0}', 1, 'short') AND public.meldy_answers_ok('{Москва}', 'short')
          AND NOT public.meldy_answers_ok('{a}', 'single') AND public.meldy_answers_ok('{}', 'multiple')) THEN
    RAISE EXCEPTION 'validators_old_kinds';
  END IF;
  IF NOT (public.meldy_key_ok('{0,1,2}', 3, 'order') AND NOT public.meldy_key_ok('{2,1,0}', 3, 'order')
          AND public.meldy_key_ok('{}', 2, 'match') AND public.meldy_answers_ok('{9.8,-1}', 'number')
          AND NOT public.meldy_answers_ok('{+1}', 'number') AND public.meldy_answers_ok(ARRAY[E'a\nб', 'в'], 'cloze')
          AND NOT public.meldy_answers_ok('{x,X}', 'match') AND public.meldy_answers_ok('{}', 'essay')) THEN
    RAISE EXCEPTION 'validators_new_kinds';
  END IF;

  -- 5. Private helpers and the writes.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
              WHERE p.oid IN (pg_catalog.to_regprocedure('meldy_private.kind_key(text, jsonb, text[], numeric, text)'),
                              pg_catalog.to_regprocedure('meldy_private.cloze_forms(text)'),
                              pg_catalog.to_regprocedure('meldy_private.kind_keys_bad(jsonb, uuid)'))
                AND (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     OR pg_catalog.to_regprocedure('meldy_private.kind_keys_bad(jsonb, uuid)') IS NULL
     OR pg_catalog.to_regprocedure('meldy_private.kind_key(text, jsonb, text[], numeric, text)') IS NULL
     OR pg_catalog.to_regprocedure('meldy_private.cloze_forms(text)') IS NULL THEN
    RAISE EXCEPTION 'kinds_private_helpers';
  END IF;
  FOR v_fn IN SELECT unnest(ARRAY['public.container_items_add(uuid, jsonb)'::regprocedure,
                                  'public.container_item_update(uuid, jsonb)'::regprocedure]) LOOP
    SELECT pg_catalog.pg_get_functiondef(v_fn) INTO v_src;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef AND p.proconfig = ARRAY['search_path=""'])
       OR v_src NOT LIKE '%tolerance%' OR v_src NOT LIKE '%material_ids%' OR v_src NOT LIKE '%kind_keys_bad%' THEN
      RAISE EXCEPTION 'item_writes_new_keys: %', v_fn;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'item_writes_not_for_anon: %', v_fn;
    END IF;
  END LOOP;
  SELECT pg_catalog.pg_get_functiondef('public.test_items_guard()'::regprocedure) INTO v_src;
  IF v_src NOT LIKE '%meldy_private.kind_key(new.kind%' THEN
    RAISE EXCEPTION 'test_items_guard_new_kinds';
  END IF;
END
$check$;
