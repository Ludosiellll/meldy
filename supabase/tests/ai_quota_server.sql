-- Run once after migration *_ai_quota_server.sql: the single read-only check of that apply.
-- ONE SELECT returning ONE JSON object (column ai_quota_server). It never raises: a missing table,
-- function or policy reads as false or null, so the report always comes back. Catalog only
-- (pg_catalog, pg_policies, supabase_migrations.schema_migrations); it reads no user rows.
-- contract_ok is true when every check holds; failed names the checks that do not.
-- Checks (what «дневной лимит ИИ на сервере» depends on):
--   * the five functions exist with these signatures, are SECURITY DEFINER with
--     search_path=public, pg_temp, anon and PUBLIC cannot execute them, authenticated can;
--   * there is no refund_ai_units(integer, text): a refund without a server-only receipt id would
--     let every user zero their own counter;
--   * ai_usage: RLS on; anon has no privilege; authenticated has SELECT and nothing else; a valid,
--     non-partial unique index on exactly (user_id, date); no INSERT or UPDATE policy left; an own-row
--     SELECT policy; and the role that owns the functions is not held by ai_usage's row security;
--   * ai_charges: RLS on, no privilege for anon or authenticated;
--   * ai_calls: RLS on, authenticated may only SELECT, anon nothing, the own-row SELECT policy, and
--     user_id references auth.users with ON DELETE CASCADE.
-- Report: the last 3 schema_migrations rows; per function: owner, flags, config and ACL; grants and
-- policies of the three tables; the unique indexes of ai_usage.
WITH
fns (ord, signature) AS (
  VALUES (1, 'public.ai_daily_limit(boolean)'),
         (2, 'public.ai_quota_status()'),
         (3, 'public.consume_ai_units(integer,text)'),
         (4, 'public.refund_ai_units(integer,text,uuid)'),
         (5, 'public.log_ai_call(text,integer,text,text,boolean,integer)')
),
fn AS (
  SELECT f.ord, f.signature, p.oid, p.prosecdef, p.proconfig, p.proacl::text AS acl,
         pg_catalog.pg_get_userbyid(p.proowner)::text AS owner, p.proowner,
         pg_catalog.pg_get_function_result(p.oid) AS result
    FROM fns f
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure(f.signature)
),
tbl AS (
  SELECT c.oid, c.relname::text AS table_name, c.relrowsecurity, c.relforcerowsecurity, c.relowner,
         pg_catalog.pg_get_userbyid(c.relowner)::text AS owner
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname IN ('ai_usage', 'ai_charges', 'ai_calls')
),
pol AS (
  SELECT p.tablename::text AS table_name, p.policyname::text AS policy_name, p.permissive, p.roles::text[] AS roles,
         p.cmd, p.qual, p.with_check
    FROM pg_catalog.pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename IN ('ai_usage', 'ai_charges', 'ai_calls')
),
usage_unique AS (
  SELECT i.indexrelid::pg_catalog.regclass::text AS index_name, i.indisvalid, i.indpred IS NULL AS whole_table,
         (SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attname::text)
            FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::smallint[])) AS columns
    FROM pg_catalog.pg_index i
   WHERE i.indrelid = pg_catalog.to_regclass('public.ai_usage') AND i.indisunique
),
privs (role_name, priv) AS (
  SELECT r, p FROM (VALUES ('anon'), ('authenticated')) AS roles (r),
                   (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS ps (p)
),
table_privs AS (
  SELECT t.table_name, pr.role_name, pr.priv, pg_catalog.has_table_privilege(pr.role_name, t.oid, pr.priv) AS granted
    FROM tbl t CROSS JOIN privs pr
),
calls_fk AS (
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint k
     WHERE k.conrelid = pg_catalog.to_regclass('public.ai_calls') AND k.contype = 'f'
       AND k.confrelid = pg_catalog.to_regclass('auth.users') AND k.confdeltype = 'c'
  ) AS ok
),
definer AS (
  SELECT (SELECT r.rolsuper OR r.rolbypassrls
                 OR (pg_catalog.pg_has_role(r.oid, t.relowner, 'USAGE') AND NOT t.relforcerowsecurity)
            FROM pg_catalog.pg_roles r WHERE r.oid = (SELECT proowner FROM fn WHERE ord = 3)) AS free
    FROM tbl t WHERE t.table_name = 'ai_usage'
),
checks (ord, name, ok) AS (
  SELECT f.ord, 'fn_' || pg_catalog.split_part(pg_catalog.split_part(f.signature, '(', 1), '.', 2),
         f.oid IS NOT NULL AND f.prosecdef
         AND f.proconfig @> ARRAY['search_path=public, pg_temp']
         AND NOT pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE')
         AND NOT pg_catalog.has_function_privilege('public', f.oid, 'EXECUTE')
         AND pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
    FROM fn f
  UNION ALL
  SELECT 10, 'no_two_argument_refund', pg_catalog.to_regprocedure('public.refund_ai_units(integer,text)') IS NULL
  UNION ALL
  SELECT 11, 'ai_usage_rls_on', (SELECT relrowsecurity FROM tbl WHERE table_name = 'ai_usage')
  UNION ALL
  SELECT 12, 'ai_usage_anon_nothing', NOT EXISTS (
    SELECT 1 FROM table_privs WHERE table_name = 'ai_usage' AND role_name = 'anon' AND granted)
         AND EXISTS (SELECT 1 FROM tbl WHERE table_name = 'ai_usage')
  UNION ALL
  SELECT 13, 'ai_usage_authenticated_select_only', EXISTS (
    SELECT 1 FROM table_privs WHERE table_name = 'ai_usage' AND role_name = 'authenticated' AND priv = 'SELECT' AND granted)
         AND NOT EXISTS (
    SELECT 1 FROM table_privs WHERE table_name = 'ai_usage' AND role_name = 'authenticated' AND priv <> 'SELECT' AND granted)
  UNION ALL
  SELECT 14, 'ai_usage_unique_user_day', EXISTS (
    SELECT 1 FROM usage_unique WHERE indisvalid AND whole_table AND columns = ARRAY['date', 'user_id'])
  UNION ALL
  SELECT 15, 'ai_usage_no_client_write_policies', NOT EXISTS (
    SELECT 1 FROM pol WHERE table_name = 'ai_usage' AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL'))
  UNION ALL
  SELECT 16, 'ai_usage_own_select_policy', EXISTS (
    SELECT 1 FROM pol WHERE table_name = 'ai_usage' AND cmd = 'SELECT' AND permissive = 'PERMISSIVE'
       AND qual ILIKE '%auth.uid()%' AND qual ILIKE '%user_id%')
  UNION ALL
  SELECT 17, 'definer_not_held_by_ai_usage_rls', (SELECT free FROM definer)
  UNION ALL
  SELECT 18, 'ai_charges_rls_on_no_client_privileges', (SELECT relrowsecurity FROM tbl WHERE table_name = 'ai_charges')
         AND NOT EXISTS (SELECT 1 FROM table_privs WHERE table_name = 'ai_charges' AND granted)
  UNION ALL
  SELECT 19, 'ai_calls_rls_on_select_only', (SELECT relrowsecurity FROM tbl WHERE table_name = 'ai_calls')
         AND EXISTS (SELECT 1 FROM table_privs WHERE table_name = 'ai_calls' AND role_name = 'authenticated'
                        AND priv = 'SELECT' AND granted)
         AND NOT EXISTS (SELECT 1 FROM table_privs WHERE table_name = 'ai_calls'
                            AND (role_name = 'anon' OR priv <> 'SELECT') AND granted)
  UNION ALL
  SELECT 20, 'ai_calls_own_select_policy', EXISTS (
    SELECT 1 FROM pol WHERE table_name = 'ai_calls' AND policy_name = 'AI calls: owner reads own' AND cmd = 'SELECT'
       AND qual ILIKE '%auth.uid()%' AND qual ILIKE '%user_id%')
  UNION ALL
  SELECT 21, 'ai_calls_user_fk_cascade', (SELECT ok FROM calls_fk)
)
SELECT pg_catalog.json_build_object(
  'contract_ok', (SELECT pg_catalog.bool_and(ok IS TRUE) FROM checks),
  'failed', (SELECT coalesce(pg_catalog.json_agg(name ORDER BY ord), '[]'::json) FROM checks WHERE ok IS NOT TRUE),
  'checks', (SELECT pg_catalog.json_object_agg(name, ok IS TRUE ORDER BY ord) FROM checks),
  'migrations', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('version', m.version, 'name', m.name)
                                                     ORDER BY m.version DESC), '[]'::json)
                   FROM (SELECT s.version, s.name FROM supabase_migrations.schema_migrations s
                          ORDER BY s.version DESC LIMIT 3) m),
  'functions', (SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
                          'signature', signature, 'exists', oid IS NOT NULL, 'owner', owner, 'result', result,
                          'security_definer', prosecdef, 'config', proconfig, 'acl', acl)
                        ORDER BY ord) FROM fn),
  'tables', (SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
                       'table', t.table_name, 'owner', t.owner, 'rls_enabled', t.relrowsecurity,
                       'rls_forced', t.relforcerowsecurity,
                       'granted', (SELECT coalesce(pg_catalog.json_agg(tp.role_name || ':' || tp.priv
                                                                       ORDER BY tp.role_name, tp.priv), '[]'::json)
                                     FROM table_privs tp WHERE tp.table_name = t.table_name AND tp.granted))
                     ORDER BY t.table_name) FROM tbl t),
  'policies', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object(
                        'table', table_name, 'policyname', policy_name, 'permissive', permissive, 'roles', roles,
                        'cmd', cmd, 'qual', qual, 'with_check', with_check)
                      ORDER BY table_name, policy_name), '[]'::json) FROM pol),
  'ai_usage_unique_indexes', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object(
                                       'index', index_name, 'valid', indisvalid, 'whole_table', whole_table,
                                       'columns', columns) ORDER BY index_name), '[]'::json) FROM usage_unique)
) AS ai_quota_server;
