-- Run once after migration *_oral_answer_texts.sql: the read-only check of that apply.
-- ONE SELECT returning ONE JSON object. It never raises: a missing table or policy reads as false, so the report
-- always comes back. Catalog only (pg_catalog, pg_policies); it reads no user rows.
-- contract_ok is true when every check holds; failed names the checks that do not.
-- Checks (what «Текст ответа с согласия» depends on):
--   * both tables exist with RLS on; consent: user_id primary key cascading from auth.users, updated_at set by
--     the trigger; texts: user_id cascading from auth.users, exam_id → exams ON DELETE SET NULL, session_id →
--     exam_sessions ON DELETE CASCADE, one text per (user_id, attempt_id), the hash / attempt / input / length /
--     version checks, created_at defaulting to now();
--   * consent: four policies for authenticated (read, add, change, delete own); texts: exactly three (read own,
--     add own with a granted consent of the same version, delete own) and no UPDATE or ALL policy;
--   * authenticated: texts — SELECT, DELETE and INSERT of the eight client columns only (not id, not created_at),
--     no UPDATE at all; consent — SELECT, DELETE, INSERT (user_id, granted, version), UPDATE (granted, version),
--     never updated_at; anon has no privilege on either table;
--   * the trigger function has a fixed empty search_path.
WITH
tbl AS (
  SELECT c.relname::text AS name, c.oid, c.relrowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname IN ('oral_answer_consent', 'oral_answer_texts') AND c.relkind IN ('r', 'p')
),
pol AS (
  SELECT p.tablename::text AS table_name, p.policyname::text AS policy_name, p.permissive, p.roles::text[] AS roles,
         p.cmd, p.qual, p.with_check
    FROM pg_catalog.pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename IN ('oral_answer_consent', 'oral_answer_texts')
),
con AS (
  SELECT t.name AS table_name, x.contype::text AS kind, pg_catalog.pg_get_constraintdef(x.oid) AS definition
    FROM pg_catalog.pg_constraint x
    JOIN tbl t ON t.oid = x.conrelid
),
col AS (
  SELECT t.name AS table_name, a.attname::text AS name, a.attnotnull,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expr
    FROM pg_catalog.pg_attribute a
    JOIN tbl t ON t.oid = a.attrelid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attnum > 0 AND NOT a.attisdropped
),
consent AS (SELECT oid FROM tbl WHERE name = 'oral_answer_consent'),
texts AS (SELECT oid FROM tbl WHERE name = 'oral_answer_texts'),
fn AS (
  SELECT p.proconfig
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'oral_answer_consent_set_updated_at'
),
checks (ord, name, ok) AS (
  VALUES
    (1, 'tables_exist', (SELECT count(*) = 2 FROM tbl)),
    (2, 'rls_on', (SELECT count(*) = 2 AND bool_and(relrowsecurity) FROM tbl)),
    (3, 'consent_user_id_primary_key', EXISTS (
       SELECT 1 FROM con WHERE table_name = 'oral_answer_consent' AND kind = 'p' AND definition = 'PRIMARY KEY (user_id)')),
    (4, 'consent_cascades_from_auth_users', EXISTS (
       SELECT 1 FROM con WHERE table_name = 'oral_answer_consent' AND kind = 'f'
          AND definition ILIKE 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')),
    (5, 'consent_updated_at_by_trigger', EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger g
        WHERE g.tgrelid = (SELECT oid FROM consent) AND g.tgname = 'oral_answer_consent_set_updated_at'
          AND NOT g.tgisinternal)),
    (6, 'texts_cascade_from_auth_users', EXISTS (
       SELECT 1 FROM con WHERE table_name = 'oral_answer_texts' AND kind = 'f'
          AND definition ILIKE 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')),
    (7, 'texts_exam_set_null', EXISTS (
       SELECT 1 FROM con WHERE table_name = 'oral_answer_texts' AND kind = 'f'
          AND definition ILIKE 'FOREIGN KEY (exam_id) REFERENCES %exams(id) ON DELETE SET NULL')),
    (8, 'texts_session_cascade', EXISTS (
       SELECT 1 FROM con WHERE table_name = 'oral_answer_texts' AND kind = 'f'
          AND definition ILIKE 'FOREIGN KEY (session_id) REFERENCES %exam_sessions(id) ON DELETE CASCADE')),
    (9, 'texts_one_per_attempt', EXISTS (
       SELECT 1 FROM con WHERE table_name = 'oral_answer_texts' AND kind = 'u' AND definition = 'UNIQUE (user_id, attempt_id)')),
    (10, 'texts_checks', (SELECT count(*) = 5 FROM con WHERE table_name = 'oral_answer_texts' AND kind = 'c'
                            AND (definition ILIKE '%question_hash%[0-9a-f]{32}%'
                                 OR definition ILIKE '%attempt_id%[A-Za-z0-9_-]{8,64}%'
                                 OR definition ILIKE '%input%speech%text%mixed%'
                                 OR definition ILIKE '%char_length(text) <= 20000%'
                                 OR definition ILIKE '%consent_version >= 1%consent_version <= 100%'))),
    (11, 'texts_created_at_defaults_to_now', (SELECT attnotnull AND default_expr = 'now()' FROM col
                                              WHERE table_name = 'oral_answer_texts' AND name = 'created_at')),
    (12, 'consent_four_own_policies', (SELECT count(*) = 4 AND bool_and(roles = ARRAY['authenticated'] AND permissive = 'PERMISSIVE')
                                              AND count(*) FILTER (WHERE cmd IN ('SELECT', 'DELETE') AND qual ILIKE '%auth.uid()%') = 2
                                              AND count(*) FILTER (WHERE cmd = 'INSERT' AND with_check ILIKE '%auth.uid()%') = 1
                                              AND count(*) FILTER (WHERE cmd = 'UPDATE' AND qual ILIKE '%auth.uid()%'
                                                                   AND with_check ILIKE '%auth.uid()%') = 1
                                         FROM pol WHERE table_name = 'oral_answer_consent')),
    (13, 'texts_three_policies', (SELECT count(*) = 3 AND bool_and(roles = ARRAY['authenticated'] AND permissive = 'PERMISSIVE')
                                    FROM pol WHERE table_name = 'oral_answer_texts')),
    (14, 'texts_read_and_delete_own', (SELECT count(*) = 2 FROM pol WHERE table_name = 'oral_answer_texts'
                                         AND cmd IN ('SELECT', 'DELETE') AND qual ILIKE '%auth.uid()%' AND qual ILIKE '%user_id%')),
    (15, 'texts_add_needs_granted_consent', EXISTS (
       SELECT 1 FROM pol WHERE table_name = 'oral_answer_texts' AND cmd = 'INSERT'
          AND with_check ILIKE '%auth.uid()%' AND with_check ILIKE '%oral_answer_consent%'
          AND with_check ILIKE '%granted%' AND with_check ILIKE '%consent_version%'
          AND with_check ILIKE '%exams%' AND with_check ILIKE '%exam_sessions%')),
    (16, 'texts_no_update_policy', NOT EXISTS (
       SELECT 1 FROM pol WHERE table_name = 'oral_answer_texts' AND cmd IN ('UPDATE', 'ALL'))),
    (17, 'authenticated_texts_privileges', (
       SELECT pg_catalog.has_table_privilege('authenticated', oid, 'SELECT')
          AND pg_catalog.has_table_privilege('authenticated', oid, 'DELETE')
          AND pg_catalog.has_column_privilege('authenticated', oid, 'text', 'INSERT')
          AND pg_catalog.has_column_privilege('authenticated', oid, 'attempt_id', 'INSERT')
          AND pg_catalog.has_column_privilege('authenticated', oid, 'session_id', 'INSERT')
          AND pg_catalog.has_column_privilege('authenticated', oid, 'consent_version', 'INSERT')
          AND NOT pg_catalog.has_column_privilege('authenticated', oid, 'created_at', 'INSERT')
          AND NOT pg_catalog.has_column_privilege('authenticated', oid, 'id', 'INSERT')
          AND NOT pg_catalog.has_table_privilege('authenticated', oid, 'UPDATE')
          AND NOT pg_catalog.has_any_column_privilege('authenticated', oid, 'UPDATE')
          AND NOT pg_catalog.has_table_privilege('authenticated', oid, 'TRUNCATE') FROM texts)),
    (18, 'authenticated_consent_privileges', (
       SELECT pg_catalog.has_table_privilege('authenticated', oid, 'SELECT')
          AND pg_catalog.has_table_privilege('authenticated', oid, 'DELETE')
          AND pg_catalog.has_column_privilege('authenticated', oid, 'granted', 'INSERT')
          AND pg_catalog.has_column_privilege('authenticated', oid, 'granted', 'UPDATE')
          AND pg_catalog.has_column_privilege('authenticated', oid, 'version', 'UPDATE')
          AND NOT pg_catalog.has_column_privilege('authenticated', oid, 'updated_at', 'INSERT')
          AND NOT pg_catalog.has_column_privilege('authenticated', oid, 'updated_at', 'UPDATE')
          AND NOT pg_catalog.has_column_privilege('authenticated', oid, 'user_id', 'UPDATE')
          AND NOT pg_catalog.has_table_privilege('authenticated', oid, 'TRUNCATE') FROM consent)),
    (19, 'anon_nothing', (SELECT count(*) = 2 AND bool_and(
                                   NOT pg_catalog.has_any_column_privilege('anon', oid, 'SELECT')
                               AND NOT pg_catalog.has_any_column_privilege('anon', oid, 'INSERT')
                               AND NOT pg_catalog.has_any_column_privilege('anon', oid, 'UPDATE')
                               AND NOT pg_catalog.has_table_privilege('anon', oid, 'DELETE')) FROM tbl)),
    (20, 'trigger_function_search_path', (SELECT proconfig @> ARRAY['search_path=""'] FROM fn))
)
SELECT pg_catalog.json_build_object(
  'contract_ok', (SELECT pg_catalog.bool_and(ok IS TRUE) FROM checks),
  'failed', (SELECT coalesce(pg_catalog.json_agg(name ORDER BY ord), '[]'::json) FROM checks WHERE ok IS NOT TRUE),
  'checks', (SELECT pg_catalog.json_object_agg(name, ok IS TRUE ORDER BY ord) FROM checks),
  'policies', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object(
                        'table', table_name, 'policyname', policy_name, 'cmd', cmd, 'roles', roles,
                        'qual', qual, 'with_check', with_check) ORDER BY table_name, policy_name), '[]'::json) FROM pol),
  'constraints', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('table', table_name, 'definition', definition)
                                                         ORDER BY table_name, definition), '[]'::json) FROM con)
) AS oral_answer_texts;
