-- Package T11's block for supabase/tests/telegram_bot.sql (T1's read-only contract check; T1 owns that file). Three
-- insertions, each between its marker lines below, into the file's T11 slots (each goes right after the slot's comment
-- line quoted here); oral_plan_inputs_equivalence.sh splices them into a scratch copy of telegram_bot.sql and requires
-- contract_ok: true and packages.T11 = {applied: true, ok: true, failed: []} with the migration, and T11's own checks as
-- the only failures without it.
--   [packages] after «  -- T11 slot (20261010120007_oral_plan_inputs.sql, bot_oral_inputs): , ('T11', '20261010120007', 80, 89)»
--   [bot_fns]  after «  -- T11 slot (20261010120007): , ('T11', 'bot_oral_inputs(bigint)')»: the bot's read then gets the checks
--              over every listed function (5–8: SECURITY DEFINER, search_path empty, the service-role gate first, closed
--              to anon and authenticated, run by service_role) and makes T11 count as applied;
--   [checks]   after «  --    UNION ALL SELECT 80, '<name>', <boolean> …» (the T11 slot's range 80–89).
-- >>> packages
  , ('T11', '20261010120007', 80, 89)
-- <<< packages
-- >>> bot_fns
  , ('T11', 'bot_oral_inputs(bigint)')
-- <<< bot_fns
-- >>> checks
  UNION ALL
  SELECT 80, 'oral_cores_private',
         coalesce((SELECT pg_catalog.bool_and(p.oid IS NOT NULL AND NOT p.prosecdef
                     AND pg_catalog.array_to_string(p.proconfig, ',') LIKE 'search_path=%'
                     AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                     AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                     FROM (VALUES ('oral_sheet_for(uuid,uuid)'), ('oral_events_for(uuid,text[])'),
                                  ('oral_events_json(uuid,text[],text[])'),
                                  ('oral_rubric_key(text,text[],jsonb,text)'), ('oral_clean_points(jsonb)'),
                                  ('oral_clean_materials(jsonb)'), ('oral_sheet_short(jsonb,timestamptz,text)'), ('py_str(jsonb)'),
                                  ('py_repr(jsonb)'), ('py_repr_text(text)'), ('py_float_repr(text)')) s(sig)
                     LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure('meldy_private.' || s.sig)), false)
  UNION ALL
  SELECT 81, 'oral_inputs_read_only_through_the_link',
         coalesce((SELECT p.provolatile = 's' AND p.prosrc ~ 'bot\.active_link\(' AND p.prosrc ~ 'meldy_private\.oral_sheet_for\('
                          AND p.prosrc ~ 'meldy_private\.oral_events_json\('
                     FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.bot_oral_inputs(bigint)')), false)
-- <<< checks
