-- Run once after migration 20261107090400_studio_color_bg.sql (the studio's own background colour): the read-only
-- check of that apply. A DO block that raises nothing when every check holds (supabase/migrate.py); it raises the name of
-- the first one that does not. Catalog only, plus calls of the rule function on documents made here (no question block:
-- nothing of the database is read), for a made-up exam id: nothing is written.
-- Checks: meldy_private.test_doc_ok still returns text and stays private (no EXECUTE for anon, authenticated or PUBLIC);
-- its body holds the colour rule beside the video's (20261019110000 kept) and test_doc_save still calls it; a page with
-- {kind: "color", color: "#rrggbb"} is valid, for any lower-case hex; a colour in capitals, of three digits, without
-- the hash, a name, not a string, missing, or with another key beside it is «theme»; the other backgrounds (plain, soft,
-- a picture of this exam) are valid as before and a soft tone or a picture's dim out of range is still «theme»; a
-- video's broken link is still block:<n>:url.
-- The parity with the client (contracts/studio/test_doc_cases.json and test_doc_color_cases.json) and the behaviour
-- are rehearsed locally: supabase/tests/local/studio_color_bg_run.sh.
DO $check$
DECLARE
  v_fn regprocedure := pg_catalog.to_regprocedure('meldy_private.test_doc_ok(jsonb,uuid)');
  v_src text;
  v_dir text := '00000000-0000-4000-8000-000000000000';
  v_doc jsonb;
  v_case record;
  v_why text;
BEGIN
  -- 1. The rule function: there, text, private; the colour beside the video.
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
  IF pg_catalog.strpos(v_src, 'when v_bg -> ''kind'' = ''"color"''::jsonb') = 0
     OR pg_catalog.strpos(v_src, 'array[''kind'', ''color'']') = 0
     OR pg_catalog.strpos(v_src, '(v_bg ->> ''color'') ~ ''^#[0-9a-f]{6}$''') = 0 THEN
    RAISE EXCEPTION 'test_doc_ok_color_rule';
  END IF;
  IF pg_catalog.strpos(v_src, 'c_video constant text := ''^https://(?:(?:www[.]|m[.])?youtube[.]com/') = 0
     OR pg_catalog.strpos(v_src, '''image'', ''video'', ''note''') = 0 THEN
    RAISE EXCEPTION 'test_doc_ok_video_kept';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.test_doc_save(uuid,jsonb,integer)');
  IF v_src IS NULL OR pg_catalog.strpos(v_src, 'meldy_private.test_doc_ok(p_doc, p_container_id)') = 0 THEN
    RAISE EXCEPTION 'test_doc_save_checks_the_rules';
  END IF;

  -- 2. A page on the author's colour (and a video, a picture of this exam) is valid.
  v_doc := pg_catalog.jsonb_build_object(
    'v', 1, 'title', 'Свой фон',
    'theme', pg_catalog.jsonb_build_object('accent', 'orange',
               'background', pg_catalog.jsonb_build_object('kind', 'color', 'color', '#f3e3c3'),
               'font', 'onest', 'radius', 'soft', 'density', 'airy', 'answers', 'list', 'buttons', 'pill'),
    'layout', 'one_by_one',
    'blocks', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('type', 'cover', 'id', 'cover0001', 'title', 'Аккредитация', 'subtitle', '', 'image', null, 'align', 'left'),
      pg_catalog.jsonb_build_object('type', 'video', 'id', 'video0001', 'url', 'https://youtu.be/dQw4w9WgXcQ', 'caption', ''),
      pg_catalog.jsonb_build_object('type', 'image', 'id', 'image0001', 'path', v_dir || '/' || pg_catalog.repeat('0a', 32) || '.png',
                                    'caption', '', 'width', 'wide')),
    'results', pg_catalog.jsonb_build_object('bands', '[]'::jsonb, 'cta', null));
  v_why := meldy_private.test_doc_ok(v_doc, v_dir::uuid);
  IF v_why IS NOT NULL THEN
    RAISE EXCEPTION 'test_doc_ok_valid_color: %', v_why;
  END IF;
  FOR v_case IN SELECT * FROM (VALUES ('#000000'), ('#ffffff'), ('#0b121c'), ('#2b3a55'), ('#abcdef')) AS t(c) LOOP
    v_why := meldy_private.test_doc_ok(pg_catalog.jsonb_set(v_doc, '{theme,background,color}', pg_catalog.to_jsonb(v_case.c)), v_dir::uuid);
    IF v_why IS NOT NULL THEN
      RAISE EXCEPTION 'test_doc_ok_valid_color %: %', v_case.c, v_why;
    END IF;
  END LOOP;

  -- 3. Broken colours: «theme».
  FOR v_case IN SELECT * FROM (VALUES
      ('{"kind": "color", "color": "#F3E3C3"}'::jsonb, 'capitals'),
      ('{"kind": "color", "color": "#fff"}'::jsonb, 'three digits'),
      ('{"kind": "color", "color": "f3e3c3"}'::jsonb, 'no hash'),
      ('{"kind": "color", "color": "red"}'::jsonb, 'a name'),
      ('{"kind": "color", "color": "#f3e3c3 "}'::jsonb, 'a space after'),
      ('{"kind": "color", "color": "#f3e3c3\n"}'::jsonb, 'a line break after'),
      ('{"kind": "color", "color": "#f3e3c3ff"}'::jsonb, 'eight digits'),
      ('{"kind": "color", "color": 15983555}'::jsonb, 'a number'),
      ('{"kind": "color", "color": null}'::jsonb, 'null'),
      ('{"kind": "color"}'::jsonb, 'missing'),
      ('{"kind": "color", "color": "#f3e3c3", "dim": 20}'::jsonb, 'another key'),
      ('{"kind": "color", "color": "#f3e3c3", "tone": "blue"}'::jsonb, 'a tone beside it'),
      ('{"kind": "colour", "color": "#f3e3c3"}'::jsonb, 'another kind'),
      ('{"kind": "soft", "tone": "red"}'::jsonb, 'a soft tone out of the six'),
      ('{"kind": "image", "path": "x", "dim": 40}'::jsonb, 'a picture of nowhere')) AS t(bg, what) LOOP
    v_why := meldy_private.test_doc_ok(pg_catalog.jsonb_set(v_doc, '{theme,background}', v_case.bg), v_dir::uuid);
    IF v_why IS DISTINCT FROM 'theme' THEN
      RAISE EXCEPTION 'test_doc_ok_broken_color (%): %', v_case.what, coalesce(v_why, 'valid');
    END IF;
  END LOOP;

  -- 4. The other backgrounds as before; a video's rule as before.
  FOR v_case IN SELECT * FROM (VALUES
      ('{"kind": "plain"}'::jsonb),
      ('{"kind": "soft", "tone": "orange"}'::jsonb),
      (pg_catalog.jsonb_build_object('kind', 'image', 'path', v_dir || '/' || pg_catalog.repeat('0b', 32) || '.jpg', 'dim', 40))) AS t(bg) LOOP
    v_why := meldy_private.test_doc_ok(pg_catalog.jsonb_set(v_doc, '{theme,background}', v_case.bg), v_dir::uuid);
    IF v_why IS NOT NULL THEN
      RAISE EXCEPTION 'test_doc_ok_other_backgrounds %: %', v_case.bg, v_why;
    END IF;
  END LOOP;
  v_why := meldy_private.test_doc_ok(pg_catalog.jsonb_set(v_doc, '{theme,background}',
             pg_catalog.jsonb_build_object('kind', 'image', 'path', v_dir || '/' || pg_catalog.repeat('0b', 32) || '.jpg', 'dim', 85)), v_dir::uuid);
  IF v_why IS DISTINCT FROM 'theme' THEN
    RAISE EXCEPTION 'test_doc_ok_dim_still_checked: %', coalesce(v_why, 'valid');
  END IF;
  v_why := meldy_private.test_doc_ok(pg_catalog.jsonb_set(v_doc, '{blocks,1,url}', '"https://vimeo.com/76979871"'), v_dir::uuid);
  IF v_why IS DISTINCT FROM 'block:1:url' THEN
    RAISE EXCEPTION 'test_doc_ok_video_still_checked: %', coalesce(v_why, 'valid');
  END IF;
END
$check$;
