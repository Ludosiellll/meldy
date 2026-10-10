-- Package T11's block for supabase/tests/telegram_bot.sql (T1's read-only contract check; T1 owns that file). Two
-- insertions, each between its marker lines below; oral_plan_inputs_equivalence.sh splices them into a scratch copy of
-- telegram_bot.sql and requires contract_ok: true (and every T11 check true) on the scratch cluster.
--   [bot_fns]  into the list bot_fns, after the line «  -- T9: , ('T9', 'bot_file_offer(…)'), ('T9', 'bot_file_redeem(…)')»:
--              the bot's read then gets checks 5–8 (SECURITY DEFINER, search_path empty, the service-role gate first,
--              closed to anon and authenticated, run by service_role).
--   [checks]   into checks, after the line «  -- ── T9: 70–89 ──»: T11's range 90–99.
-- >>> bot_fns
  , ('T11', 'bot_oral_inputs(bigint)')
-- <<< bot_fns
-- >>> checks
  -- ── T11: 90–99 ── (20261010120007_oral_plan_inputs.sql: the oral part of the plan for the bot)
  UNION ALL
  SELECT 90, 'oral_cores_private',
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
  SELECT 91, 'oral_inputs_read_only_through_the_link',
         coalesce((SELECT p.provolatile = 's' AND p.prosrc ~ 'bot\.active_link\(' AND p.prosrc ~ 'meldy_private\.oral_sheet_for\('
                          AND p.prosrc ~ 'meldy_private\.oral_events_json\('
                     FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.bot_oral_inputs(bigint)')), false)
-- <<< checks
