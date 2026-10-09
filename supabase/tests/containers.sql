-- Run once after migration *_containers.sql (and again after *_containers_revokes.sql): the single read-only check of
-- that apply. ONE SELECT returning ONE JSON object (column containers). It never raises: a missing table, column,
-- schema or function reads as false or null, so the report always comes back (also before the migration). Catalog only
-- (pg_catalog, information_schema, supabase_migrations.schema_migrations) plus three counts; no row content leaves the
-- database.
-- contract_ok is true when every check holds; failed names the checks that do not. Between the two files exactly four
-- checks fail — the default privileges Supabase gives NEW objects, which the revokes file takes back (safety does not
-- depend on them: RLS has no anon policy and every function checks its caller): anon_runs_only_the_preview,
-- anon_reads_no_table, clients_never_write_log_states_items, link_salt_hidden.
-- Checks (what frontend/src/api/containers.ts, the plan and the bot depend on):
--   * the twelve tables and analytics.excluded_accounts exist with row security on;
--   * the RPCs: SECURITY DEFINER ones and the three INVOKER ones (container_create, container_subject_add,
--     test_answer_days), every one with an empty search_path; authenticated may run them all, anon only the preview;
--   * the private cores and the rule exist in meldy_private, which anon and authenticated cannot use;
--   * clients never write the log, the states or the items, never read the link salt; anon reads no table;
--   * the rule's columns (named_at, checks, was_two_days, clean_ok_at; no next_due_day / check_stage), the steps
--     miss | misclick | training | start | too_early | two_days | check | early | late, short items (answers text[]);
--   * the oral path is untouched: the six journal kinds, no new column on exams / exam_questions / learning_events /
--     exam_shares.
-- Local rehearsal of the behaviour: supabase/tests/local/containers_run_all.sh.
WITH
tables(name) AS (VALUES ('containers'), ('container_subjects'), ('test_items'), ('test_item_key_changes'),
  ('test_item_states'), ('test_answers'), ('test_key_doubts'), ('test_mock_runs'), ('container_plans'),
  ('container_links'), ('container_members'), ('container_member_exams')),
rels AS (
  SELECT t.name, c.oid, c.relrowsecurity
    FROM tables t
    LEFT JOIN pg_catalog.pg_class c ON c.relname = t.name AND c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
),
excluded AS (
  SELECT c.oid, c.relrowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'analytics' AND c.relname = 'excluded_accounts' AND c.relkind = 'r'
),
api(sig, definer) AS (VALUES
  ('record_test_answers(jsonb)', true), ('container_mock_finish(jsonb)', true), ('container_items_add(uuid,jsonb)', true),
  ('container_item_update(uuid,jsonb)', true), ('test_key_doubt(uuid,jsonb,text)', true), ('test_key_doubt_withdraw(uuid)', true),
  ('container_doubts(uuid)', true), ('container_doubt_keep(uuid)', true), ('containers_overview(text)', true),
  ('container_summary(uuid,text)', true), ('plan_inputs(text,uuid)', true), ('container_link_create(uuid,integer,text)', true),
  ('container_link_revoke(uuid)', true), ('container_link_preview(text)', true), ('container_join(text)', true),
  ('container_oral_codes(uuid)', true), ('container_bind_copy(uuid,uuid)', true), ('container_leave(uuid)', true),
  ('container_members_list(uuid)', true), ('container_member_remove(uuid,uuid,boolean)', true), ('my_container_ids()', true),
  ('container_create(text,date,jsonb)', false), ('container_subject_add(uuid,jsonb)', false), ('test_answer_days(date)', false)),
fns AS (
  SELECT a.sig, a.definer, p.oid, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS config
    FROM api a LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure('public.' || a.sig)
),
private_schema AS (SELECT n.oid FROM pg_catalog.pg_namespace n WHERE n.nspname = 'meldy_private'),
cores(sig) AS (VALUES ('record_test_answers_for(uuid,jsonb,text,integer,text,uuid)'), ('containers_overview_for(uuid,date)'),
  ('container_summary_for(uuid,uuid,date)'), ('plan_inputs_for(uuid,date,uuid)'), ('test_key_doubt_for(uuid,uuid,jsonb,text)'),
  ('test_key_doubt_withdraw_for(uuid,uuid)'), ('role_in(uuid,uuid)'),
  ('rule_step(public.test_item_states,integer,timestamptz,date,text,boolean,boolean,date)'),
  ('grade_answer(text,integer,smallint[],text[],jsonb)'), ('due_at(timestamptz,integer,date,date)')),
-- to_regprocedure reads a missing schema or a missing argument type as null, never as an error.
core_fns AS (SELECT c.sig, pg_catalog.to_regprocedure('meldy_private.' || c.sig) AS oid FROM cores c),
columns AS (
  SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name IN ('test_items', 'test_item_states', 'test_answers')
),
step_con AS (
  SELECT pg_catalog.pg_get_constraintdef(k.oid) AS def FROM pg_catalog.pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM rels WHERE name = 'test_answers') AND k.conname = 'test_answers_step_check'
),
kind_con AS (
  SELECT pg_catalog.pg_get_constraintdef(k.oid) AS def FROM pg_catalog.pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM rels WHERE name = 'test_items') AND k.conname = 'test_items_kind_check'
),
journal_kinds AS (
  SELECT pg_catalog.pg_get_constraintdef(k.oid) AS def FROM pg_catalog.pg_constraint k
   WHERE k.conrelid = pg_catalog.to_regclass('public.learning_events') AND k.conname = 'learning_events_kind_check'
),
salt AS (
  SELECT a.attnum FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = (SELECT oid FROM rels WHERE name = 'container_links') AND a.attname = 'oral_salt' AND NOT a.attisdropped
),
-- Row counts through query_to_xml, each only when its table exists: a missing table reads as null, not an error.
counts AS (
  SELECT
    CASE WHEN (SELECT oid FROM rels WHERE name = 'containers') IS NOT NULL THEN
      ((pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml('select count(*) as n from public.containers', false, true, '')))[1])::text::bigint
    END AS containers,
    CASE WHEN (SELECT oid FROM rels WHERE name = 'test_items') IS NOT NULL THEN
      ((pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml('select count(*) as n from public.test_items', false, true, '')))[1])::text::bigint
    END AS items,
    CASE WHEN (SELECT oid FROM rels WHERE name = 'container_members') IS NOT NULL THEN
      ((pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml('select count(*) as n from public.container_members where left_at is null and removed_at is null', false, true, '')))[1])::text::bigint
    END AS members
),
checks (ord, name, ok) AS (
  SELECT 1, 'tables_with_row_security',
         (SELECT pg_catalog.count(*) FROM rels WHERE relrowsecurity) = 12
         AND coalesce((SELECT relrowsecurity FROM excluded), false)
  UNION ALL
  SELECT 2, 'definers_with_empty_search_path',
         coalesce((SELECT pg_catalog.bool_and(oid IS NOT NULL AND prosecdef AND config IN ('search_path=""', 'search_path='))
                     FROM fns WHERE definer), false)
  UNION ALL
  SELECT 3, 'invokers_with_empty_search_path',
         coalesce((SELECT pg_catalog.bool_and(oid IS NOT NULL AND NOT prosecdef AND config IN ('search_path=""', 'search_path='))
                     FROM fns WHERE NOT definer), false)
  UNION ALL
  SELECT 4, 'authenticated_runs_the_api',
         coalesce((SELECT pg_catalog.bool_and(oid IS NOT NULL AND pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE'))
                     FROM fns), false)
  UNION ALL
  SELECT 5, 'anon_runs_only_the_preview',
         coalesce((SELECT pg_catalog.bool_and(oid IS NOT NULL AND pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')
                                              = (sig = 'container_link_preview(text)'))
                     FROM fns), false)
  UNION ALL
  SELECT 6, 'private_cores_present',
         (SELECT pg_catalog.bool_and(oid IS NOT NULL) FROM core_fns)
  UNION ALL
  SELECT 7, 'private_schema_closed_to_clients',
         EXISTS (SELECT 1 FROM private_schema)
         AND NOT pg_catalog.has_schema_privilege('anon', (SELECT oid FROM private_schema), 'USAGE')
         AND NOT pg_catalog.has_schema_privilege('authenticated', (SELECT oid FROM private_schema), 'USAGE')
  UNION ALL
  SELECT 8, 'anon_reads_no_table',
         (SELECT pg_catalog.count(*) FROM rels WHERE oid IS NOT NULL) = 12
         AND NOT EXISTS (SELECT 1 FROM rels WHERE oid IS NOT NULL AND pg_catalog.has_table_privilege('anon', oid, 'SELECT'))
  UNION ALL
  SELECT 9, 'clients_never_write_log_states_items',
         (SELECT pg_catalog.count(*) FROM rels WHERE oid IS NOT NULL) = 12
         AND NOT EXISTS (SELECT 1 FROM rels r, (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
                          WHERE r.name IN ('test_answers', 'test_item_states') AND pg_catalog.has_table_privilege('authenticated', r.oid, p.priv))
         AND NOT EXISTS (SELECT 1 FROM rels r, (VALUES ('INSERT'), ('UPDATE')) p(priv)
                          WHERE r.name = 'test_items' AND pg_catalog.has_table_privilege('authenticated', r.oid, p.priv))
  UNION ALL
  SELECT 10, 'link_salt_hidden',
         EXISTS (SELECT 1 FROM salt)
         AND NOT pg_catalog.has_column_privilege('authenticated', (SELECT oid FROM rels WHERE name = 'container_links'),
                                                 (SELECT attnum FROM salt), 'SELECT')
  UNION ALL
  SELECT 11, 'answer_idempotency_key',
         EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = (SELECT oid FROM rels WHERE name = 'test_answers')
                    AND k.conname = 'test_answers_client_event_key' AND k.contype = 'u')
  UNION ALL
  SELECT 12, 'rule_columns',
         (SELECT pg_catalog.count(*) FROM columns WHERE table_name = 'test_item_states'
             AND column_name IN ('named_at', 'checks', 'was_two_days', 'clean_ok_at', 'streak_at', 'two_days_at', 'peek_day')) = 7
         AND NOT EXISTS (SELECT 1 FROM columns WHERE table_name = 'test_item_states' AND column_name IN ('next_due_day', 'check_stage'))
  UNION ALL
  SELECT 13, 'rule_steps',
         coalesce((SELECT pg_catalog.bool_and((SELECT def FROM step_con) LIKE '%''' || s || '''%')
                     FROM pg_catalog.unnest(ARRAY['miss', 'misclick', 'training', 'start', 'too_early', 'two_days', 'check',
                                                  'early', 'late']) s), false)
         AND (SELECT def FROM step_con) NOT LIKE '%''streak''%'
  UNION ALL
  SELECT 14, 'short_answers',
         EXISTS (SELECT 1 FROM columns WHERE table_name = 'test_items' AND column_name = 'answers' AND data_type = 'ARRAY')
         AND coalesce((SELECT def FROM kind_con) LIKE '%''short''%', false)
         AND EXISTS (SELECT 1 FROM columns WHERE table_name = 'test_answers' AND column_name IN ('answer_text'))
         AND EXISTS (SELECT 1 FROM columns WHERE table_name = 'test_answers' AND column_name IN ('cls'))
  UNION ALL
  -- The oral path is untouched: the six journal kinds, no new column on exams / exam_questions / learning_events.
  SELECT 15, 'journal_kinds_unchanged',
         coalesce((SELECT def FROM journal_kinds) LIKE '%quiz_answer%' AND (SELECT def FROM journal_kinds) LIKE '%sheet_peek%'
                  AND (SELECT def FROM journal_kinds) NOT LIKE '%test%', false)
  UNION ALL
  SELECT 16, 'oral_tables_without_new_columns',
         NOT EXISTS (SELECT 1 FROM information_schema.columns c
                      WHERE c.table_schema = 'public' AND c.table_name IN ('exams', 'exam_questions', 'learning_events', 'exam_shares')
                        AND c.column_name IN ('mode', 'choice', 'container_id', 'subject_id', 'answers'))
  UNION ALL
  SELECT 17, 'item_limits_validated',
         coalesce((SELECT pg_catalog.bool_and(k.convalidated) FROM pg_catalog.pg_constraint k
                    WHERE k.conrelid = (SELECT oid FROM rels WHERE name = 'test_items') AND k.contype = 'c'), false)
)
SELECT pg_catalog.json_build_object(
  'contract_ok', (SELECT pg_catalog.bool_and(ok IS TRUE) FROM checks),
  'failed', (SELECT coalesce(pg_catalog.json_agg(name ORDER BY ord), '[]'::json) FROM checks WHERE ok IS NOT TRUE),
  'checks', (SELECT pg_catalog.json_object_agg(name, ok IS TRUE ORDER BY ord) FROM checks),
  'containers', (SELECT containers FROM counts),
  'items', (SELECT items FROM counts),
  'active_members', (SELECT members FROM counts),
  'migrations', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('version', m.version, 'name', m.name)
                                                     ORDER BY m.version DESC), '[]'::json)
                   FROM (SELECT s.version, s.name FROM supabase_migrations.schema_migrations s
                          ORDER BY s.version DESC LIMIT 3) m)
) AS containers;
