-- Run once after migration 20261018100000_test_builder.sql (release 47): the read-only check of that apply. A DO block
-- that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not.
-- Catalog only, plus the one configuration row of the bucket quiz-covers; no user data is read.
-- Checks: test_items.explanation (text, not null, default '', ≤ 2000 by test_items_explanation_check); the quiz
-- settings guests (default true) / cover_path / accent (default blue) / offer_practice (default false) with their checks
-- (members_only never with guests); quiz_attempts: user_id nullable, guest_hash, exactly one of the two, attempt numbers
-- unique per token, the (quiz_id, guest_hash) index; the throttle table private and closed; every function of the data
-- contract (docs/superpowers/plans/2026-10-18-test-builder-r47.md) SECURITY DEFINER with an empty search_path; anon runs
-- the preview and the four guest calls, never claim / practice / reorder; quiz_preview(text) is gone; the person helpers
-- exist and stay private; the attempt JSON carries no key or explanation; the result shows the explanation only with
-- the answers; the bucket quiz-covers is public (3 MB, four image types) and only an exam's owner writes its folder;
-- no storage policy lets anon read test-item-images; quiz_guest_media_paths (a guest attempt's picture paths, for the
-- Edge Function that signs them) runs for service_role only; no listing function or meldy_storage schema is left.
-- The behaviour is rehearsed locally: supabase/tests/local/test_builder_run.sh.
DO $check$
DECLARE
  v_sig text;
  v_fn regprocedure;
  v_src text;
  v_rel regclass;
  v_b record;
  -- the owner's folder, as the deparsed policy reads with or without «public.» (it depends on the reader's search_path)
  v_owner_folder constant text := '%foldername(name))[1]%containers c%owner_id = ( SELECT auth.uid()%';
BEGIN
  -- 1. Explanations.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'test_items' AND c.column_name = 'explanation'
                    AND c.data_type = 'text' AND c.is_nullable = 'NO' AND c.column_default LIKE '''''::text%') THEN
    RAISE EXCEPTION 'test_items_explanation_column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.test_items'::regclass AND k.conname = 'test_items_explanation_check'
                    AND k.convalidated AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%char_length(explanation) <= 2000%') THEN
    RAISE EXCEPTION 'test_items_explanation_check';
  END IF;

  -- 2. Quiz settings.
  IF (SELECT pg_catalog.count(*) FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'quizzes'
         AND ((c.column_name = 'guests' AND c.data_type = 'boolean' AND c.is_nullable = 'NO' AND c.column_default = 'true')
           OR (c.column_name = 'cover_path' AND c.data_type = 'text' AND c.is_nullable = 'YES' AND c.column_default IS NULL)
           OR (c.column_name = 'accent' AND c.data_type = 'text' AND c.is_nullable = 'NO' AND c.column_default LIKE '''blue''%')
           OR (c.column_name = 'offer_practice' AND c.data_type = 'boolean' AND c.is_nullable = 'NO'
               AND c.column_default = 'false'))) <> 4 THEN
    RAISE EXCEPTION 'quizzes_columns';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.quizzes'::regclass AND k.conname = 'quizzes_guests_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%NOT (members_only AND guests)%') THEN
    RAISE EXCEPTION 'quizzes_guests_check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.quizzes'::regclass AND k.conname = 'quizzes_cover_path_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%(png|jpg|gif|webp)%'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%split_part(cover_path%(container_id)::text%') THEN
    RAISE EXCEPTION 'quizzes_cover_path_check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.quizzes'::regclass AND k.conname = 'quizzes_accent_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%blue%green%orange%violet%pink%graphite%') THEN
    RAISE EXCEPTION 'quizzes_accent_check';
  END IF;

  -- 3. Attempts of guests.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'quiz_attempts' AND c.column_name = 'user_id'
                    AND c.is_nullable = 'YES')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns c
                     WHERE c.table_schema = 'public' AND c.table_name = 'quiz_attempts' AND c.column_name = 'guest_hash'
                       AND c.data_type = 'text') THEN
    RAISE EXCEPTION 'quiz_attempts_columns';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.quiz_attempts'::regclass AND k.conname = 'quiz_attempts_person_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%(user_id IS NULL) <> (guest_hash IS NULL)%') THEN
    RAISE EXCEPTION 'quiz_attempts_exactly_one_person';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.quiz_attempts'::regclass AND k.conname = 'quiz_attempts_guest_hash_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%[0-9a-f]{64}%') THEN
    RAISE EXCEPTION 'quiz_attempts_guest_hash_check';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i
                  WHERE i.schemaname = 'public' AND i.tablename = 'quiz_attempts'
                    AND i.indexdef LIKE 'CREATE UNIQUE INDEX %quiz_attempts USING btree (quiz_id, guest_hash, n) WHERE (guest_hash IS NOT NULL)%') THEN
    RAISE EXCEPTION 'quiz_attempts_guest_n_unique';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i
                  WHERE i.schemaname = 'public' AND i.tablename = 'quiz_attempts'
                    AND i.indexdef LIKE 'CREATE INDEX %quiz_attempts USING btree (quiz_id, guest_hash)%') THEN
    RAISE EXCEPTION 'quiz_attempts_guest_index';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.quiz_attempts'::regclass AND k.contype = 'u'
                    AND pg_catalog.pg_get_constraintdef(k.oid) = 'UNIQUE (quiz_id, user_id, n)') THEN
    RAISE EXCEPTION 'one_attempt_number_per_user';
  END IF;

  -- 4. The throttle table: private schema, row security on, no policy, no client right.
  v_rel := pg_catalog.to_regclass('meldy_private.quiz_guest_starts');
  IF v_rel IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_rel)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = v_rel)
     OR pg_catalog.has_table_privilege('anon', v_rel, 'SELECT,INSERT,UPDATE,DELETE')
     OR pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'throttle_table_private';
  END IF;
  IF pg_catalog.has_schema_privilege('anon', 'meldy_private', 'USAGE')
     OR pg_catalog.has_schema_privilege('authenticated', 'meldy_private', 'USAGE') THEN
    RAISE EXCEPTION 'private_schema_closed_to_clients';
  END IF;

  -- 5. Functions: SECURITY DEFINER, empty search_path, who runs them.
  IF pg_catalog.to_regprocedure('public.quiz_preview(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'old_quiz_preview_dropped';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY['quiz_preview(text,text)', 'quiz_guest_start(text,text,text)',
      'quiz_guest_answer(uuid,text,jsonb)', 'quiz_guest_finish(uuid,text)', 'quiz_guest_result(uuid,text)',
      'quiz_guest_claim(text,text)', 'quiz_practice_join(text)',
      'container_items_reorder(uuid,uuid[])', 'container_items_add(uuid,jsonb)', 'container_item_update(uuid,jsonb)',
      'quiz_create(uuid,jsonb)', 'quiz_update(uuid,jsonb)', 'quiz_list(uuid)', 'quiz_results(uuid)',
      'quiz_start(text,text)', 'quiz_answer(uuid,jsonb)', 'quiz_finish(uuid)', 'quiz_result(uuid)'] LOOP
    v_fn := pg_catalog.to_regprocedure('public.' || v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'function_%', v_sig;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_fn AND p.prosecdef AND 'search_path=""' = ANY (p.proconfig)) THEN
      RAISE EXCEPTION 'definer_with_empty_search_path_%', v_sig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated_runs_%', v_sig;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       <> (v_sig IN ('quiz_preview(text,text)', 'quiz_guest_start(text,text,text)', 'quiz_guest_answer(uuid,text,jsonb)',
                     'quiz_guest_finish(uuid,text)', 'quiz_guest_result(uuid,text)')) THEN
      RAISE EXCEPTION 'anon_runs_only_the_guest_calls_%', v_sig;
    END IF;
  END LOOP;
  IF (SELECT pg_catalog.pg_get_function_result(pg_catalog.to_regprocedure('public.container_items_reorder(uuid,uuid[])'))) <> 'void' THEN
    RAISE EXCEPTION 'function_results';
  END IF;
  -- A guest's pictures: quiz_guest_media_paths for the Edge Function's service key only (no grant to PUBLIC, anon or
  -- authenticated); no listing function of an earlier draft anywhere.
  v_fn := pg_catalog.to_regprocedure('public.quiz_guest_media_paths(uuid,text,text[])');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'function_quiz_guest_media_paths';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                  WHERE p.oid = v_fn AND p.prosecdef AND 'search_path=""' = ANY (p.proconfig)) THEN
    RAISE EXCEPTION 'media_paths_definer_with_empty_search_path';
  END IF;
  IF pg_catalog.pg_get_function_result(v_fn) <> 'text[]' THEN
    RAISE EXCEPTION 'media_paths_returns_text_array';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) IS NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                 WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'media_paths_service_role_only';
  END IF;
  IF pg_catalog.to_regprocedure('public.guest_quiz_picture_paths()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.nspname = 'meldy_storage') THEN
    RAISE EXCEPTION 'no_picture_listing_function';
  END IF;
  IF (SELECT pg_catalog.pg_get_function_arguments(pg_catalog.to_regprocedure('public.quiz_preview(text,text)')))
     <> 'p_code text, p_token text DEFAULT NULL::text' THEN
    RAISE EXCEPTION 'quiz_preview_token_optional';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY['quiz_block_for(public.quizzes,uuid,text)', 'quiz_token_hash(text)', 'quiz_ip_hash()',
      'quiz_me(public.quizzes,uuid,text)', 'quiz_start_for(text,text,uuid,text)', 'quiz_answer_for(uuid,uuid,text,jsonb)',
      'quiz_finish_for(uuid,uuid,text)', 'quiz_result_for(uuid,uuid,text)', 'quiz_result_json(uuid)',
      'quiz_attempt_json(public.quiz_attempts,public.quizzes)', 'quiz_row(public.quizzes)', 'quiz_apply(public.quizzes,jsonb)',
      'quiz_started(public.quizzes)'] LOOP
    v_fn := pg_catalog.to_regprocedure('meldy_private.' || v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'helper_%', v_sig;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'helper_private_%', v_sig;
    END IF;
  END LOOP;
  -- The token is kept as its sha256, never as given.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_token_hash(text)');
  IF pg_catalog.strpos(v_src, 'sha256') = 0 THEN
    RAISE EXCEPTION 'token_hashed';
  END IF;

  -- 6. What leaves the server: the attempt carries no key and no explanation; the result shows the explanation (like the
  --    key) only when the review shows the answers; QuizRow and the preview carry the new settings.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_attempt_json(public.quiz_attempts,public.quizzes)');
  IF v_src ~ 'explanation|i\.correct|i\.answers' THEN
    RAISE EXCEPTION 'attempt_without_key_or_explanation';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_result_json(uuid)');
  IF pg_catalog.strpos(v_src, '''explanation'', case when v_review = ''answers''') = 0
     OR pg_catalog.strpos(v_src, '''key'', case when v_review = ''answers''') = 0
     OR pg_catalog.strpos(v_src, '''practice''') = 0 OR pg_catalog.strpos(v_src, '''accent''') = 0 THEN
    RAISE EXCEPTION 'result_explanation_behind_review';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_row(public.quizzes)');
  IF pg_catalog.strpos(v_src, '''guests''') = 0 OR pg_catalog.strpos(v_src, '''cover_path''') = 0
     OR pg_catalog.strpos(v_src, '''accent''') = 0 OR pg_catalog.strpos(v_src, '''offer_practice''') = 0 THEN
    RAISE EXCEPTION 'quiz_row_settings';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.quiz_results(uuid)');
  IF pg_catalog.strpos(v_src, '''guest'', a.guest_hash is not null') = 0 THEN
    RAISE EXCEPTION 'results_guest_flag';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.container_item_update(uuid,jsonb)');
  IF pg_catalog.strpos(v_src, 'explanation = case when p_patch ? ''explanation''') = 0
     OR pg_catalog.strpos(v_src, 'images = case when p_patch ? ''images''') = 0 THEN
    RAISE EXCEPTION 'item_update_explanation';
  END IF;
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.container_items_add(uuid,jsonb)'::regprocedure),
                       'then ''explanation''') = 0 THEN
    RAISE EXCEPTION 'items_add_explanation';
  END IF;

  -- 7. Storage: the covers bucket and its policies; anon reads no question picture.
  SELECT b.public, b.file_size_limit, b.allowed_mime_types INTO v_b FROM storage.buckets b WHERE b.id = 'quiz-covers';
  IF NOT FOUND OR v_b.public IS NOT TRUE OR v_b.file_size_limit IS DISTINCT FROM 3145728
     OR (SELECT pg_catalog.array_agg(m ORDER BY m) FROM pg_catalog.unnest(v_b.allowed_mime_types) m)
        IS DISTINCT FROM ARRAY['image/gif', 'image/jpeg', 'image/png', 'image/webp'] THEN
    RAISE EXCEPTION 'bucket_quiz_covers';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_policies p
       WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND p.roles = ARRAY['authenticated']::name[]
         AND ((p.policyname = 'Quiz covers: owner uploads' AND p.cmd = 'INSERT' AND p.qual IS NULL
               AND p.with_check LIKE '%quiz-covers%' AND p.with_check LIKE v_owner_folder)
           OR (p.policyname = 'Quiz covers: owner reads' AND p.cmd = 'SELECT'
               AND p.qual LIKE '%quiz-covers%' AND p.qual LIKE v_owner_folder)
           OR (p.policyname = 'Quiz covers: owner updates' AND p.cmd = 'UPDATE'
               AND p.qual LIKE '%quiz-covers%' AND p.qual LIKE v_owner_folder
               AND p.with_check LIKE '%quiz-covers%' AND p.with_check LIKE v_owner_folder)
           OR (p.policyname = 'Quiz covers: owner deletes' AND p.cmd = 'DELETE'
               AND p.qual LIKE '%quiz-covers%' AND p.qual LIKE v_owner_folder))) <> 4 THEN
    RAISE EXCEPTION 'storage_policies_quiz_covers';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
              WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND 'anon' = ANY (p.roles)
                AND coalesce(p.qual, '') || coalesce(p.with_check, '') LIKE '%quiz-covers%') THEN
    RAISE EXCEPTION 'anon_never_writes_covers';
  END IF;
  -- No storage policy lets anon (or PUBLIC, which includes anon) at the question pictures: a guest's pictures come as
  -- URLs signed by the Edge Function, so the Storage API's list endpoint has nothing to show anon.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
              WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
                AND ('anon' = ANY (p.roles) OR 'public' = ANY (p.roles))
                AND coalesce(p.qual, '') || coalesce(p.with_check, '') LIKE '%test-item-images%') THEN
    RAISE EXCEPTION 'anon_reads_no_item_pictures';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                  WHERE p.schemaname = 'storage' AND p.policyname = 'Test item images: quiz takers read'
                    AND p.qual LIKE '%my_quiz_container_ids()%') THEN
    RAISE EXCEPTION 'storage_policy_quiz_takers_read_kept';
  END IF;
END
$check$;
