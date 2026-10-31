-- Run once after migration 20261103090000_oral_formula_v2.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog only.
-- Checks: public.record_oral_attempt(jsonb) and meldy_private.record_oral_attempt_for(uuid, jsonb) write «formula: v2»
-- into the protocol and no longer «v1»; the bot's copy is still the site's function but the line that reads the user
-- (the drift check of supabase/tests/telegram_bot.sql); the site's function is still SECURITY INVOKER with an empty
-- search_path, executable by authenticated and not by anon; the bot's copy is executable by no client role.
-- The behaviour (a saved answer's protocol says v2, from the site and from the bot) is rehearsed locally:
-- supabase/tests/local/oral_journal_sweep_run.sh.
DO $check$
DECLARE
  v_site oid := pg_catalog.to_regprocedure('public.record_oral_attempt(jsonb)');
  v_core oid := pg_catalog.to_regprocedure('meldy_private.record_oral_attempt_for(uuid,jsonb)');
  v_site_src text;
  v_core_src text;
BEGIN
  IF v_site IS NULL OR v_core IS NULL THEN
    RAISE EXCEPTION 'functions_exist';
  END IF;
  SELECT pg_catalog.replace(p.prosrc, E'\r\n', E'\n') INTO v_site_src FROM pg_catalog.pg_proc p WHERE p.oid = v_site;
  SELECT pg_catalog.replace(p.prosrc, E'\r\n', E'\n') INTO v_core_src FROM pg_catalog.pg_proc p WHERE p.oid = v_core;
  IF pg_catalog.strpos(v_site_src, '''formula'', ''v2''') = 0 OR pg_catalog.strpos(v_site_src, '''formula'', ''v1''') > 0 THEN
    RAISE EXCEPTION 'site_writes_formula_v2';
  END IF;
  IF pg_catalog.strpos(v_core_src, '''formula'', ''v2''') = 0 OR pg_catalog.strpos(v_core_src, '''formula'', ''v1''') > 0 THEN
    RAISE EXCEPTION 'bot_writes_formula_v2';
  END IF;
  IF pg_catalog.replace(v_core_src, 'v_user uuid := p_user;', 'v_user uuid := auth.uid();') IS DISTINCT FROM v_site_src THEN
    RAISE EXCEPTION 'bot_copy_is_the_site_function';
  END IF;
  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_site)
     OR NOT coalesce((SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc p WHERE p.oid = v_site), false)
     OR NOT pg_catalog.has_function_privilege('authenticated', v_site, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_site, 'EXECUTE') THEN
    RAISE EXCEPTION 'site_function_flags_and_grants';
  END IF;
  IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_core)
     OR pg_catalog.has_function_privilege('authenticated', v_core, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_core, 'EXECUTE') THEN
    RAISE EXCEPTION 'bot_copy_flags_and_grants';
  END IF;
END
$check$;
