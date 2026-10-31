-- Run once after migration 20261101090300_question_kinds_bot.sql (release 48, part 4; docs/kinds/CONTRACT.md §4): the
-- read-only check of that apply. A DO block that raises nothing when every check holds (supabase/migrate.py); it raises
-- the name of the first one that does not. Catalog only. Checks: the bot's three functions know the new kinds (number and
-- a one-gap cloze asked, in_app, grade_item, the forms and the explanation in the review), stay SECURITY DEFINER with an
-- empty search_path where they were, and the session calls stay closed to anon and authenticated.
-- Behaviour: supabase/tests/local/question_kinds_run.sh.
DO $check$
DECLARE
  v_fn regprocedure;
  v_src text;
BEGIN
  v_src := pg_catalog.pg_get_functiondef('public.bot_session_items(bigint, uuid, uuid[])'::regprocedure);
  IF v_src NOT LIKE '%''number''%' OR v_src NOT LIKE '%in_app%' OR v_src NOT LIKE '%i.images = ''{}''::jsonb%' THEN
    RAISE EXCEPTION 'bot_session_items_kinds';
  END IF;
  v_src := pg_catalog.pg_get_functiondef('public.bot_session_answer(bigint, text, integer, jsonb)'::regprocedure);
  IF v_src NOT LIKE '%meldy_private.grade_item(v_item, v_el)%' OR v_src NOT LIKE '%(''short'', ''number'', ''cloze'')%' THEN
    RAISE EXCEPTION 'bot_session_answer_kinds';
  END IF;
  v_src := pg_catalog.pg_get_functiondef('bot.session_view_json(bot.sessions)'::regprocedure);
  IF v_src NOT LIKE '%explanation%' OR v_src NOT LIKE '%v_item.unit%' THEN
    RAISE EXCEPTION 'bot_session_view_kinds';
  END IF;
  FOR v_fn IN SELECT unnest(ARRAY['public.bot_session_items(bigint, uuid, uuid[])'::regprocedure,
                                  'public.bot_session_answer(bigint, text, integer, jsonb)'::regprocedure]) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef AND p.proconfig = ARRAY['search_path=""'])
       OR pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'bot_calls_closed: %', v_fn;
    END IF;
  END LOOP;
END
$check$;
