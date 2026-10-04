-- Run once after migration *_pro_interest.sql: the read-only check of that apply.
-- ONE SELECT returning ONE JSON object. It never raises: a missing table or policy reads as false,
-- so the report always comes back. Catalog only (pg_catalog, pg_policies); it reads no user rows.
-- contract_ok is true when every check holds; failed names the checks that do not.
-- Checks (what «Сообщить, когда появится» in the PRO window depends on):
--   * the table exists with RLS on; user_id is the primary key and references auth.users with
--     ON DELETE CASCADE; reason is NOT NULL with the pricing/limit/meter check; created_at defaults;
--   * exactly two policies, both for authenticated: SELECT own row, INSERT own row (auth.uid()
--     against user_id); no UPDATE, DELETE or ALL policy;
--   * authenticated may SELECT and INSERT user_id and reason but not created_at, and may not
--     UPDATE or DELETE; anon has no privilege at all.
WITH
tbl AS (
  SELECT c.oid, c.relrowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'pro_interest' AND c.relkind IN ('r', 'p')
),
pol AS (
  SELECT p.policyname::text AS policy_name, p.permissive, p.roles::text[] AS roles, p.cmd, p.qual, p.with_check
    FROM pg_catalog.pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'pro_interest'
),
con AS (
  SELECT x.conname::text AS name, x.contype::text AS kind, pg_catalog.pg_get_constraintdef(x.oid) AS definition
    FROM pg_catalog.pg_constraint x
   WHERE x.conrelid = (SELECT oid FROM tbl)
),
col AS (
  SELECT a.attname::text AS name, a.attnotnull, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
         pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS default_expr
    FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = (SELECT oid FROM tbl) AND a.attnum > 0 AND NOT a.attisdropped
),
checks (ord, name, ok) AS (
  VALUES
    (1, 'table_exists', EXISTS (SELECT 1 FROM tbl)),
    (2, 'rls_on', (SELECT relrowsecurity FROM tbl)),
    (3, 'user_id_primary_key', EXISTS (SELECT 1 FROM con WHERE kind = 'p' AND definition = 'PRIMARY KEY (user_id)')),
    (4, 'user_id_cascades_from_auth_users', EXISTS (
       SELECT 1 FROM con WHERE kind = 'f' AND definition ILIKE 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')),
    (5, 'reason_check', EXISTS (
       SELECT 1 FROM con WHERE kind = 'c' AND definition ILIKE '%reason%pricing%limit%meter%')),
    (6, 'reason_not_null', (SELECT attnotnull FROM col WHERE name = 'reason')),
    (7, 'created_at_defaults_to_now', (SELECT attnotnull AND default_expr = 'now()' FROM col WHERE name = 'created_at')),
    (8, 'two_policies', (SELECT count(*) = 2 FROM pol)),
    (9, 'select_own_policy', EXISTS (
       SELECT 1 FROM pol WHERE cmd = 'SELECT' AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']
          AND qual ILIKE '%auth.uid()%' AND qual ILIKE '%user_id%')),
    (10, 'insert_own_policy', EXISTS (
       SELECT 1 FROM pol WHERE cmd = 'INSERT' AND permissive = 'PERMISSIVE' AND roles = ARRAY['authenticated']
          AND with_check ILIKE '%auth.uid()%' AND with_check ILIKE '%user_id%')),
    (11, 'no_write_policies', NOT EXISTS (SELECT 1 FROM pol WHERE cmd IN ('UPDATE', 'DELETE', 'ALL'))),
    (12, 'authenticated_select', (SELECT pg_catalog.has_table_privilege('authenticated', oid, 'SELECT') FROM tbl)),
    (13, 'authenticated_insert_user_id_reason', (SELECT pg_catalog.has_column_privilege('authenticated', oid, 'user_id', 'INSERT')
                                                        AND pg_catalog.has_column_privilege('authenticated', oid, 'reason', 'INSERT') FROM tbl)),
    (14, 'authenticated_no_created_at_insert', (SELECT NOT pg_catalog.has_column_privilege('authenticated', oid, 'created_at', 'INSERT') FROM tbl)),
    (15, 'authenticated_no_update_delete', (SELECT NOT pg_catalog.has_table_privilege('authenticated', oid, 'UPDATE')
                                                   AND NOT pg_catalog.has_any_column_privilege('authenticated', oid, 'UPDATE')
                                                   AND NOT pg_catalog.has_table_privilege('authenticated', oid, 'DELETE')
                                                   AND NOT pg_catalog.has_table_privilege('authenticated', oid, 'TRUNCATE') FROM tbl)),
    (16, 'anon_nothing', (SELECT NOT pg_catalog.has_any_column_privilege('anon', oid, 'SELECT')
                                 AND NOT pg_catalog.has_any_column_privilege('anon', oid, 'INSERT')
                                 AND NOT pg_catalog.has_any_column_privilege('anon', oid, 'UPDATE')
                                 AND NOT pg_catalog.has_table_privilege('anon', oid, 'DELETE') FROM tbl))
)
SELECT pg_catalog.json_build_object(
  'contract_ok', (SELECT pg_catalog.bool_and(ok IS TRUE) FROM checks),
  'failed', (SELECT coalesce(pg_catalog.json_agg(name ORDER BY ord), '[]'::json) FROM checks WHERE ok IS NOT TRUE),
  'checks', (SELECT pg_catalog.json_object_agg(name, ok IS TRUE ORDER BY ord) FROM checks),
  'policies', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object(
                        'policyname', policy_name, 'permissive', permissive, 'roles', roles, 'cmd', cmd,
                        'qual', qual, 'with_check', with_check) ORDER BY policy_name), '[]'::json) FROM pol),
  'constraints', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('name', name, 'definition', definition)
                                                         ORDER BY name), '[]'::json) FROM con)
) AS pro_interest;
