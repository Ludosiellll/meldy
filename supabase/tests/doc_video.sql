-- Run once after migration 20261019110000_doc_video.sql (the studio's video block): the read-only check of that apply.
-- A DO block that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that
-- does not. Catalog only, plus calls of the rule function on documents made here (no question block: nothing of the
-- database is read), for a made-up exam id: nothing is written.
-- Checks: meldy_private.test_doc_ok still returns text and stays private (no EXECUTE for anon, authenticated or PUBLIC);
-- its body holds the video pattern of frontend/src/types/testDoc.ts (DOC_VIDEO_PATTERN) and test_doc_save still calls
-- it; a page with a video of each of the three hosts is valid; a video's broken link (another host, http, a lookalike
-- host, an id of the wrong length, HTML, over 300 characters, not a string, missing) is block:<n>:url, a caption over
-- 300 characters or missing is block:<n>:caption, an extra key is block:<n>:type (after the fields), a repeated id is
-- block:<n>:id; the other blocks' rules hold as before (a picture of another exam is still block:<n>:path).
-- The parity with the client (every case of contracts/studio/test_doc_cases.json) and the behaviour are rehearsed
-- locally: supabase/tests/local/test_docs_run.sh.
DO $check$
DECLARE
  v_fn regprocedure := pg_catalog.to_regprocedure('meldy_private.test_doc_ok(jsonb,uuid)');
  v_src text;
  v_dir text := '00000000-0000-4000-8000-000000000000';
  v_yt text := 'dQw4w9WgXcQ';
  v_rt text := 'c6cc4d620b1d4338901770a44b3e82f4';
  v_doc jsonb;
  v_case record;
BEGIN
  -- 1. The rule function: there, text, private.
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'test_doc_ok_missing';
  END IF;
  IF pg_catalog.pg_get_function_result(v_fn) <> 'text' THEN
    RAISE EXCEPTION 'test_doc_ok_returns_text';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                 WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'test_doc_ok_private';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF pg_catalog.strpos(v_src, 'c_video constant text := ''^https://(?:(?:www[.]|m[.])?youtube[.]com/') = 0
     OR pg_catalog.strpos(v_src, '''image'', ''video'', ''note''') = 0
     OR pg_catalog.strpos(v_src, 'array[''type'', ''id'', ''url'', ''caption'']') = 0 THEN
    RAISE EXCEPTION 'test_doc_ok_video_rules';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.test_doc_save(uuid,jsonb,integer)');
  IF v_src IS NULL OR pg_catalog.strpos(v_src, 'meldy_private.test_doc_ok(p_doc, p_container_id)') = 0 THEN
    RAISE EXCEPTION 'test_doc_save_checks_the_rules';
  END IF;

  -- 2. A page with a video of each host (and a picture block of this exam) is valid.
  v_doc := pg_catalog.jsonb_build_object(
    'v', 1, 'title', 'Видео',
    'theme', pg_catalog.jsonb_build_object('accent', 'blue', 'background', pg_catalog.jsonb_build_object('kind', 'plain'),
               'font', 'onest', 'radius', 'soft', 'density', 'airy', 'answers', 'list', 'buttons', 'pill'),
    'layout', 'one_page',
    'blocks', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('type', 'video', 'id', 'video0001', 'url', 'https://www.youtube.com/watch?v=' || v_yt || '&t=42s',
                                    'caption', 'Опыт'),
      pg_catalog.jsonb_build_object('type', 'video', 'id', 'video0002', 'url', 'https://youtu.be/' || v_yt, 'caption', ''),
      pg_catalog.jsonb_build_object('type', 'video', 'id', 'video0003', 'url', 'https://rutube.ru/video/' || v_rt || '/',
                                    'caption', pg_catalog.repeat('в', 300)),
      pg_catalog.jsonb_build_object('type', 'video', 'id', 'video0004', 'url', 'https://vk.com/video-22822305_456242110',
                                    'caption', ''),
      pg_catalog.jsonb_build_object('type', 'video', 'id', 'video0005',
                                    'url', 'https://vkvideo.ru/video_ext.php?oid=-22822305&id=456242110&hash=8d2c4e1a', 'caption', ''),
      pg_catalog.jsonb_build_object('type', 'image', 'id', 'image0001', 'path', v_dir || '/' || pg_catalog.repeat('0a', 32) || '.png',
                                    'caption', '', 'width', 'wide')),
    'results', pg_catalog.jsonb_build_object('bands', '[]'::jsonb, 'cta', null));
  IF meldy_private.test_doc_ok(v_doc, v_dir::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'test_doc_ok_valid_videos: %', meldy_private.test_doc_ok(v_doc, v_dir::uuid);
  END IF;

  -- 3. Broken videos: the first broken rule of the first broken block.
  FOR v_case IN SELECT * FROM (VALUES
      (pg_catalog.jsonb_set(v_doc, '{blocks,0,url}', '"https://vimeo.com/76979871"'), 'block:0:url'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,1,url}', pg_catalog.to_jsonb('http://youtu.be/' || v_yt)), 'block:1:url'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,1,url}', pg_catalog.to_jsonb('https://youtube.com.evil.example/watch?v=' || v_yt)), 'block:1:url'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,1,url}', pg_catalog.to_jsonb('https://youtu.be/' || pg_catalog.left(v_yt, 10))), 'block:1:url'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,1,url}', pg_catalog.to_jsonb('<iframe src="https://youtu.be/' || v_yt || '"></iframe>')), 'block:1:url'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,1,url}', pg_catalog.to_jsonb('https://youtu.be/' || v_yt || '?x=' || pg_catalog.repeat('a', 300))), 'block:1:url'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,2,url}', pg_catalog.to_jsonb('https://rutube.ru/video/' || pg_catalog.left(v_rt, 31) || '/')), 'block:2:url'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,3,url}', '"https://vk.com/wall-1_2"'), 'block:3:url'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,0,url}', '5'), 'block:0:url'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,0}', (v_doc #> '{blocks,0}') - 'url'), 'block:0:url'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,2,caption}', pg_catalog.to_jsonb(pg_catalog.repeat('в', 301))), 'block:2:caption'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,0}', (v_doc #> '{blocks,0}') - 'caption'), 'block:0:caption'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,0,width}', '"wide"'), 'block:0:type'),
      (pg_catalog.jsonb_set(pg_catalog.jsonb_set(v_doc, '{blocks,0,width}', '"wide"'), '{blocks,0,url}', '"https://vimeo.com/1"'), 'block:0:url'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,1,id}', '"video0001"'), 'block:1:id'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,5,path}', pg_catalog.to_jsonb('11111111-1111-4111-8111-111111111111/' || pg_catalog.repeat('0a', 32) || '.png')), 'block:5:path'),
      (pg_catalog.jsonb_set(v_doc, '{blocks,4,type}', '"film"'), 'block:4:type')) c(doc, rule) LOOP
    IF meldy_private.test_doc_ok(v_case.doc, v_dir::uuid) IS DISTINCT FROM v_case.rule THEN
      RAISE EXCEPTION 'test_doc_ok_rule_% (got %)', v_case.rule, meldy_private.test_doc_ok(v_case.doc, v_dir::uuid);
    END IF;
  END LOOP;
END
$check$;
