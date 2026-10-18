-- Run once after migration 20261019100000_test_docs.sql (release 47.1, «Студия теста»): the read-only check of that
-- apply. A DO block that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one
-- that does not. Catalog only, plus calls of the rule function on documents made here, for a made-up exam id: nothing is
-- written, and the only row it looks for (the question of a made-up id) does not exist.
-- Checks: public.test_docs (container_id the key, referencing containers on delete cascade; doc jsonb not null; rev
-- integer not null default 1; updated_at timestamptz not null default now(); at most 204800 bytes of doc text) with row
-- security on, no policy and no client right; quizzes.design (boolean not null default false); test_doc_get and
-- test_doc_save SECURITY DEFINER with an empty search_path, for authenticated only (not anon, not PUBLIC); the rule
-- function and the quiz helpers exist and stay private; test_doc_ok answers null for a valid document and the rule for
-- broken ones; quiz_row, quiz_apply, quiz_update (MC011 design), quiz_draw, quiz_draw_count, the attempt, the preview and
-- the result know design; the result carries band; the attempt still carries no key or explanation, the result shows
-- them only with the answers. The behaviour is rehearsed locally: supabase/tests/local/test_docs_run.sh.
DO $check$
DECLARE
  v_rel regclass := pg_catalog.to_regclass('public.test_docs');
  v_fn regprocedure;
  v_sig text;
  v_src text;
  v_doc jsonb;
  v_dir text := '00000000-0000-4000-8000-000000000000';
  v_case record;
BEGIN
  -- 1. The table.
  IF v_rel IS NULL THEN
    RAISE EXCEPTION 'table_test_docs';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'test_docs'
         AND ((c.column_name = 'container_id' AND c.data_type = 'uuid' AND c.is_nullable = 'NO')
           OR (c.column_name = 'doc' AND c.data_type = 'jsonb' AND c.is_nullable = 'NO')
           OR (c.column_name = 'rev' AND c.data_type = 'integer' AND c.is_nullable = 'NO' AND c.column_default = '1')
           OR (c.column_name = 'updated_at' AND c.data_type = 'timestamp with time zone' AND c.is_nullable = 'NO'
               AND c.column_default = 'now()'))) <> 4
     OR (SELECT pg_catalog.count(*) FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = 'test_docs') <> 4 THEN
    RAISE EXCEPTION 'test_docs_columns';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = v_rel AND k.contype = 'p' AND pg_catalog.pg_get_constraintdef(k.oid) = 'PRIMARY KEY (container_id)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                     WHERE k.conrelid = v_rel AND k.contype = 'f' AND k.confrelid = 'public.containers'::regclass
                       AND k.confdeltype = 'c' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE 'FOREIGN KEY (container_id)%') THEN
    RAISE EXCEPTION 'test_docs_key_per_exam';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = v_rel AND k.conname = 'test_docs_doc_check' AND k.convalidated
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%octet_length((doc)::text) <= 204800%') THEN
    RAISE EXCEPTION 'test_docs_size_check';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_rel)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = v_rel)
     OR pg_catalog.has_table_privilege('anon', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
                 WHERE c.oid = v_rel AND a.grantee = 0) THEN
    RAISE EXCEPTION 'test_docs_closed_to_clients';
  END IF;

  -- 2. quizzes.design.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'quizzes' AND c.column_name = 'design'
                    AND c.data_type = 'boolean' AND c.is_nullable = 'NO' AND c.column_default = 'false') THEN
    RAISE EXCEPTION 'quizzes_design_column';
  END IF;

  -- 3. The author's functions: SECURITY DEFINER, empty search_path, authenticated only.
  FOREACH v_sig IN ARRAY ARRAY['test_doc_get(uuid)', 'test_doc_save(uuid,jsonb,integer)'] LOOP
    v_fn := pg_catalog.to_regprocedure('public.' || v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'function_%', v_sig;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_fn AND p.prosecdef AND 'search_path=""' = ANY (p.proconfig)) THEN
      RAISE EXCEPTION 'definer_with_empty_search_path_%', v_sig;
    END IF;
    IF pg_catalog.pg_get_function_result(v_fn) <> 'jsonb' THEN
      RAISE EXCEPTION 'returns_jsonb_%', v_sig;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                   WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated_only_%', v_sig;
    END IF;
  END LOOP;
  IF pg_catalog.pg_get_function_arguments(pg_catalog.to_regprocedure('public.test_doc_save(uuid,jsonb,integer)'))
     <> 'p_container_id uuid, p_doc jsonb, p_rev integer' THEN
    RAISE EXCEPTION 'test_doc_save_arguments';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.test_doc_save(uuid,jsonb,integer)');
  IF pg_catalog.strpos(v_src, 'errcode = ''MC020'', detail = ''stale''') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.test_doc_ok(p_doc, p_container_id)') = 0
     OR pg_catalog.strpos(v_src, 'c.owner_id = v_user for update') = 0 THEN
    RAISE EXCEPTION 'test_doc_save_rules';
  END IF;

  -- 4. The private helpers.
  FOREACH v_sig IN ARRAY ARRAY['test_doc_ok(jsonb,uuid)', 'test_doc_str(jsonb,integer,integer)', 'test_doc_enum(jsonb,text[])',
      'test_doc_int(jsonb,integer,integer)', 'test_doc_keys(jsonb,text[])', 'test_doc_image(jsonb,uuid,boolean)',
      'quiz_doc_items(uuid)', 'quiz_design(public.quizzes)', 'quiz_row(public.quizzes)', 'quiz_apply(public.quizzes,jsonb)',
      'quiz_draw(public.quizzes)', 'quiz_draw_count(public.quizzes)', 'quiz_attempt_json(public.quiz_attempts,public.quizzes)',
      'quiz_result_json(uuid)'] LOOP
    v_fn := pg_catalog.to_regprocedure('meldy_private.' || v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'helper_%', v_sig;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'helper_private_%', v_sig;
    END IF;
  END LOOP;
  IF pg_catalog.pg_get_function_result('meldy_private.test_doc_ok(jsonb,uuid)'::regprocedure) <> 'text' THEN
    RAISE EXCEPTION 'test_doc_ok_returns_text';
  END IF;

  -- 5. The rules answer: a valid document (no question block: nothing of the database is read) → null; broken ones →
  --    the rule, the first one in the order of the plan.
  v_doc := pg_catalog.jsonb_build_object(
    'v', 1, 'title', 'Проверка',
    'theme', pg_catalog.jsonb_build_object('accent', pg_catalog.jsonb_build_object('custom', '#1a2b3c'),
               'background', pg_catalog.jsonb_build_object('kind', 'image', 'dim', 40,
                                                           'path', v_dir || '/' || pg_catalog.repeat('0a', 32) || '.png'),
               'font', 'onest', 'radius', 'soft', 'density', 'airy', 'answers', 'list', 'buttons', 'pill'),
    'layout', 'pages',
    'blocks', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('type', 'cover', 'id', 'cover0001', 'title', 'Тест', 'subtitle', '', 'image', null, 'align', 'center'),
      pg_catalog.jsonb_build_object('type', 'note', 'id', 'note00001', 'tone', 'tip', 'text', '**Удачи**'),
      pg_catalog.jsonb_build_object('type', 'divider', 'id', 'divider01')),
    'results', pg_catalog.jsonb_build_object(
      'bands', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('from', 0, 'to', 49, 'title', 'Ещё раз', 'text', '', 'image', null),
        pg_catalog.jsonb_build_object('from', 50, 'to', 100, 'title', 'Хорошо', 'text', '', 'image', null)),
      'cta', pg_catalog.jsonb_build_object('label', 'Дальше', 'url', 'https://example.org/')));
  IF meldy_private.test_doc_ok(v_doc, v_dir::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'test_doc_ok_valid_document: %', meldy_private.test_doc_ok(v_doc, v_dir::uuid);
  END IF;
  FOR v_case IN SELECT * FROM (VALUES
      (v_doc || '{"v": 2}', 'version'), (v_doc || '{"extra": 1}', 'version'), ('[]'::jsonb, 'version'),
      (v_doc || '{"title": " "}', 'title'),
      (pg_catalog.jsonb_set(v_doc, '{theme,accent}', '"red"'), 'theme'),
      (pg_catalog.jsonb_set(v_doc, '{theme,background,path}', pg_catalog.to_jsonb('11111111-1111-4111-8111-111111111111/' || pg_catalog.repeat('0a', 32) || '.png')), 'theme'),
      (v_doc || '{"layout": "grid"}', 'layout'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,1,id}', '"Note00001"'), 'block:1:id'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,2,id}', '"cover0001"'), 'block:2:id'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,2}', pg_catalog.jsonb_build_object('type', 'question', 'id', 'question1',
         'item_id', v_dir, 'points', 1, 'required', false)), 'block:2:item_id'),
      (pg_catalog.jsonb_set(v_doc, '{results,bands,1,from}', '49'), 'results'),
      (pg_catalog.jsonb_set(v_doc, '{results,cta,url}', '"http://example.org/"'), 'results')) c(doc, rule) LOOP
    IF meldy_private.test_doc_ok(v_case.doc, v_dir::uuid) IS DISTINCT FROM v_case.rule THEN
      RAISE EXCEPTION 'test_doc_ok_rule_%', v_case.rule;
    END IF;
  END LOOP;

  -- 6. Quizzes «как в студии»: the settings, the lock, the draw, and what leaves the server.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_row(public.quizzes)');
  IF pg_catalog.strpos(v_src, '''design'', p_q.design') = 0 OR pg_catalog.strpos(v_src, '''accent''') = 0 THEN
    RAISE EXCEPTION 'quiz_row_design';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_apply(public.quizzes,jsonb)');
  IF pg_catalog.strpos(v_src, 'quiz_bool(p_settings, ''design'')') = 0 THEN
    RAISE EXCEPTION 'quiz_apply_design';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.quiz_update(uuid,jsonb)');
  IF pg_catalog.strpos(v_src, 'errcode = ''MC011'', detail = ''design''') = 0
     OR pg_catalog.strpos(v_src, 'design = v_new.design') = 0 THEN
    RAISE EXCEPTION 'quiz_update_design_locked';
  END IF;
  IF pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p
                         WHERE p.oid = pg_catalog.to_regprocedure('public.quiz_create(uuid,jsonb)')), 'v_q.design := false') = 0 THEN
    RAISE EXCEPTION 'quiz_create_design_default';
  END IF;
  IF pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p
                         WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_draw(public.quizzes)')),
                       'meldy_private.quiz_doc_items(p_q.container_id)') = 0
     OR pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p
                            WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_draw_count(public.quizzes)')),
                          'meldy_private.quiz_doc_items(p_q.container_id)') = 0 THEN
    RAISE EXCEPTION 'quiz_draw_design';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_attempt_json(public.quiz_attempts,public.quizzes)');
  IF v_src ~ 'explanation|i\.correct|i\.answers' OR pg_catalog.strpos(v_src, '''design'', meldy_private.quiz_design(p_q)') = 0 THEN
    RAISE EXCEPTION 'attempt_design_without_key';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_design(public.quizzes)');
  IF v_src ~ 'test_items|correct|answers|explanation' THEN
    RAISE EXCEPTION 'design_holds_no_key';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.quiz_preview(text,text)');
  IF pg_catalog.strpos(v_src, '''design'', meldy_private.quiz_design(v_q)') = 0 THEN
    RAISE EXCEPTION 'preview_design';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_result_json(uuid)');
  IF pg_catalog.strpos(v_src, '''design'', v_design') = 0 OR pg_catalog.strpos(v_src, '''band'', v_band') = 0
     OR pg_catalog.strpos(v_src, '''key'', case when v_review = ''answers''') = 0
     OR pg_catalog.strpos(v_src, '''explanation'', case when v_review = ''answers''') = 0 THEN
    RAISE EXCEPTION 'result_design_band_key_behind_review';
  END IF;
END
$check$;
