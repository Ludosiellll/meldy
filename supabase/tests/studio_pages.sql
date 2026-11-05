-- Run once after migration 20261107090500_studio_pages.sql (the studio's page holds every question of the exam): the
-- read-only check of that apply. A DO block that raises nothing when every check holds (supabase/migrate.py); it raises
-- the name of the first one that does not. Catalog only, plus calls of the rule function on documents made here (no
-- question block: nothing of the database is read), for a made-up exam id: nothing is written.
-- Checks: public.test_docs keeps at most 524288 bytes of doc text (test_docs_doc_check, validated or NOT VALID); the rule
-- function returns text, stays private and takes at most 2100 blocks (the colour's and the video's rules kept);
-- test_doc_save stays SECURITY DEFINER with an empty search_path, for authenticated only, refuses more than 524288
-- bytes and calls the rules; quiz_doc_items takes every question of the page (no [1:200]; essays kept); quiz_draw and
-- quiz_draw_count of a design quiz take the whole page up to 200 and item_count of it (quiz_fixed) past 200; the quiz
-- helpers stay private; a page of 401 and of 2100 blocks is valid, 2101 is «blocks».
-- The parity with the client (contracts/studio/test_doc_pages_cases.json) and the behaviour are rehearsed locally:
-- supabase/tests/local/studio_pages_run.sh.
DO $check$
DECLARE
  v_ok regprocedure := pg_catalog.to_regprocedure('meldy_private.test_doc_ok(jsonb,uuid)');
  v_fn regprocedure;
  v_sig text;
  v_src text;
  v_dir text := '00000000-0000-4000-8000-000000000000';
  v_doc jsonb;
  v_why text;
  v_n integer;
BEGIN
  -- 1. The table's size check.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.test_docs'::regclass AND k.conname = 'test_docs_doc_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE 'CHECK ((octet_length((doc)::text) <= 524288))%') THEN
    RAISE EXCEPTION 'test_docs_size_512_kb';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint k
       WHERE k.conrelid = 'public.test_docs'::regclass AND k.contype = 'c' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%octet_length%') <> 1 THEN
    RAISE EXCEPTION 'test_docs_one_size_check';
  END IF;

  -- 2. The rule function: there, text, private; 2100 blocks; the colour and the video kept.
  IF v_ok IS NULL THEN
    RAISE EXCEPTION 'test_doc_ok_missing';
  END IF;
  IF pg_catalog.pg_get_function_result(v_ok) <> 'text' THEN
    RAISE EXCEPTION 'test_doc_ok_returns_text';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_ok;
  IF pg_catalog.strpos(v_src, 'pg_catalog.jsonb_array_length(p_doc -> ''blocks'') > 2100 then') = 0
     OR pg_catalog.strpos(v_src, '> 400 then') > 0 THEN
    RAISE EXCEPTION 'test_doc_ok_2100_blocks';
  END IF;
  IF pg_catalog.strpos(v_src, 'when v_bg -> ''kind'' = ''"color"''::jsonb') = 0
     OR pg_catalog.strpos(v_src, 'c_video constant text := ''^https://(?:(?:www[.]|m[.])?youtube[.]com/') = 0 THEN
    RAISE EXCEPTION 'test_doc_ok_rules_kept';
  END IF;

  -- 3. test_doc_save: the author's door, 512 KB, the rules.
  v_fn := pg_catalog.to_regprocedure('public.test_doc_save(uuid,jsonb,integer)');
  IF v_fn IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                                  WHERE p.oid = v_fn AND p.prosecdef AND 'search_path=""' = ANY (p.proconfig)) THEN
    RAISE EXCEPTION 'test_doc_save_definer';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                 WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'test_doc_save_authenticated_only';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF pg_catalog.strpos(v_src, 'if pg_catalog.octet_length(p_doc::text) > 524288 then') = 0
     OR pg_catalog.strpos(v_src, '204800') > 0
     OR pg_catalog.strpos(v_src, 'meldy_private.test_doc_ok(p_doc, p_container_id)') = 0 THEN
    RAISE EXCEPTION 'test_doc_save_512_kb';
  END IF;

  -- 4. The quiz side: the whole page in the pool; the draw of a design quiz past 200.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_doc_items(uuid)');
  IF v_src IS NULL OR pg_catalog.strpos(v_src, '[1:200]') > 0
     OR pg_catalog.strpos(v_src, 'select coalesce(pg_catalog.array_agg(x.id order by x.ord), ''{}''::uuid[])') = 0
     OR pg_catalog.strpos(v_src, '(i.keyed or i.kind = ''essay'')') = 0 THEN
    RAISE EXCEPTION 'quiz_doc_items_whole_page';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_draw(public.quizzes)');
  IF v_src IS NULL OR pg_catalog.strpos(v_src, 'v_pool := meldy_private.quiz_doc_items(p_q.container_id);') = 0
     OR pg_catalog.strpos(v_src, 'if pg_catalog.cardinality(v_pool) > 200 then
      return meldy_private.quiz_fixed(p_q, v_pool);') = 0 THEN
    RAISE EXCEPTION 'quiz_draw_design_sample';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_draw_count(public.quizzes)');
  IF v_src IS NULL OR pg_catalog.strpos(v_src, 'case when d.n > 200 then least(p_q.item_count::integer, d.n) else d.n end') = 0 THEN
    RAISE EXCEPTION 'quiz_draw_count_design_sample';
  END IF;
  FOREACH v_sig IN ARRAY ARRAY['meldy_private.test_doc_ok(jsonb,uuid)', 'meldy_private.quiz_doc_items(uuid)',
                               'meldy_private.quiz_draw(public.quizzes)', 'meldy_private.quiz_draw_count(public.quizzes)',
                               'meldy_private.quiz_fixed(public.quizzes,uuid[])'] LOOP
    v_fn := pg_catalog.to_regprocedure(v_sig);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'missing_%', v_sig;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                   WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'private_%', v_sig;
    END IF;
  END LOOP;

  -- 5. Pages of 401, 2100 and 2101 blocks (dividers: nothing of the database is read).
  FOREACH v_n IN ARRAY ARRAY[401, 2100, 2101] LOOP
    v_doc := pg_catalog.jsonb_build_object(
      'v', 1, 'title', 'Длинный тест',
      'theme', pg_catalog.jsonb_build_object('accent', 'blue', 'background', pg_catalog.jsonb_build_object('kind', 'plain'),
                 'font', 'onest', 'radius', 'soft', 'density', 'airy', 'answers', 'list', 'buttons', 'pill'),
      'layout', 'pages',
      'blocks', (SELECT pg_catalog.jsonb_agg(CASE WHEN i % 400 = 1 AND i > 1
                                                  THEN pg_catalog.jsonb_build_object('type', 'page', 'id', 'page' || pg_catalog.lpad(i::text, 6, '0'), 'title', '')
                                                  ELSE pg_catalog.jsonb_build_object('type', 'divider', 'id', 'line' || pg_catalog.lpad(i::text, 6, '0')) END
                                             ORDER BY i)
                   FROM pg_catalog.generate_series(1, v_n) i),
      'results', pg_catalog.jsonb_build_object('bands', '[]'::jsonb, 'cta', null));
    v_why := meldy_private.test_doc_ok(v_doc, v_dir::uuid);
    IF v_why IS DISTINCT FROM (CASE WHEN v_n > 2100 THEN 'blocks' END) THEN
      RAISE EXCEPTION 'test_doc_ok_blocks_%: %', v_n, coalesce(v_why, 'valid');
    END IF;
  END LOOP;
END
$check$;
