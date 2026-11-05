-- Run once after migration 20261107090600_live_no_ai_keys.sql (a question whose key the AI picked plays in no game,
-- duel or challenge): the read-only check of that apply. A DO block that raises nothing when every check holds
-- (supabase/migrate.py); it raises the name of the first one that does not. Catalog only, plus calls of the three
-- filter functions on question rows made in memory here: nothing is read from or written to a table.
-- Checks: the three functions are there, private (no EXECUTE for anon, authenticated or PUBLIC) and name ai_key; a
-- choice question with one right option of 2–6, a question with two right options, a text answer and a number play as
-- before (live_playable true / live_more 'multiple', 'short', 'number' / live_challenge_kind 'single', 'multiple',
-- 'short', 'number'), and the same questions with 'ai_key' in their flags play nowhere (false / null / null); another
-- flag beside it changes nothing; a picture still keeps a question out of a challenge; «Вопрос дня» still skips ai_key.
-- The games, duels and challenges made from a real exam are rehearsed locally: supabase/tests/local/live_no_ai_keys_run.sh.
DO $check$
DECLARE
  v_fns regprocedure[] := array[pg_catalog.to_regprocedure('meldy_private.live_playable(public.test_items,boolean)'),
                                pg_catalog.to_regprocedure('meldy_private.live_more(public.test_items,boolean)'),
                                pg_catalog.to_regprocedure('meldy_private.live_challenge_kind(public.test_items)')];
  v_fn regprocedure;
  v_one public.test_items;
  v_two public.test_items;
  v_short public.test_items;
  v_num public.test_items;
  v_pic public.test_items;
BEGIN
  -- 1. The functions: there, private, and each names the flag.
  FOREACH v_fn IN ARRAY v_fns LOOP
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'live_filter_missing';
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                   WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'live_filter_private: %', v_fn;
    END IF;
    IF pg_catalog.strpos((SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = v_fn), '''ai_key'' = any (p_item.flags)') = 0 THEN
      RAISE EXCEPTION 'live_filter_ai_key: %', v_fn;
    END IF;
  END LOOP;
  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef('bot.group_item_ok(public.test_items)'::regprocedure), 'ai_key') = 0 THEN
    RAISE EXCEPTION 'group_item_ok_ai_key';
  END IF;

  -- 2. Questions made in memory: one right option of three, two right of four, a text answer, a number, a picture.
  v_one.kind := 'single'; v_one.options := '["а", "б", "в"]'::jsonb; v_one.correct := array[1]::smallint[];
  v_one.answers := '{}'::text[]; v_one.flags := '{}'::text[]; v_one.images := null;
  v_two := v_one; v_two.kind := 'multiple'; v_two.options := '["а", "б", "в", "г"]'::jsonb; v_two.correct := array[0, 2]::smallint[];
  v_short := v_one; v_short.kind := 'short'; v_short.options := '[]'::jsonb; v_short.correct := '{}'::smallint[];
  v_short.answers := array['Париж'];
  v_num := v_short; v_num.kind := 'number'; v_num.answers := array['42'];
  v_pic := v_one; v_pic.images := '{"stem": ["exam/pic.webp"]}'::jsonb;

  -- 3. Without the flag: as before.
  IF NOT meldy_private.live_playable(v_one, true) THEN RAISE EXCEPTION 'plays_one_right'; END IF;
  IF meldy_private.live_more(v_two, true) IS DISTINCT FROM 'multiple' THEN RAISE EXCEPTION 'plays_two_right'; END IF;
  IF meldy_private.live_more(v_short, true) IS DISTINCT FROM 'short' THEN RAISE EXCEPTION 'plays_short'; END IF;
  IF meldy_private.live_more(v_short, false) IS NOT NULL THEN RAISE EXCEPTION 'stand_skips_short'; END IF;
  IF meldy_private.live_more(v_num, false) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'plays_number'; END IF;
  IF meldy_private.live_challenge_kind(v_one) IS DISTINCT FROM 'single'
     OR meldy_private.live_challenge_kind(v_two) IS DISTINCT FROM 'multiple'
     OR meldy_private.live_challenge_kind(v_short) IS DISTINCT FROM 'short'
     OR meldy_private.live_challenge_kind(v_num) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'challenge_kinds';
  END IF;
  IF meldy_private.live_challenge_kind(v_pic) IS NOT NULL OR NOT meldy_private.live_playable(v_pic, true) THEN
    RAISE EXCEPTION 'picture_rules';
  END IF;
  -- another flag changes nothing
  v_one.flags := array['doubt']; v_two.flags := array['doubt'];
  IF NOT meldy_private.live_playable(v_one, true) OR meldy_private.live_more(v_two, true) IS DISTINCT FROM 'multiple'
     OR meldy_private.live_challenge_kind(v_one) IS DISTINCT FROM 'single' THEN
    RAISE EXCEPTION 'other_flag';
  END IF;

  -- 4. With the flag (beside another one): nowhere.
  v_one.flags := array['doubt', 'ai_key']; v_two.flags := array['ai_key'];
  IF meldy_private.live_playable(v_one, true) OR meldy_private.live_playable(v_one, false) THEN
    RAISE EXCEPTION 'ai_key_one_plays';
  END IF;
  IF meldy_private.live_more(v_one, true) IS NOT NULL OR meldy_private.live_more(v_two, true) IS NOT NULL
     OR meldy_private.live_more(v_two, false) IS NOT NULL THEN
    RAISE EXCEPTION 'ai_key_more_plays';
  END IF;
  IF meldy_private.live_challenge_kind(v_one) IS NOT NULL OR meldy_private.live_challenge_kind(v_two) IS NOT NULL THEN
    RAISE EXCEPTION 'ai_key_challenge_plays';
  END IF;
END;
$check$;
