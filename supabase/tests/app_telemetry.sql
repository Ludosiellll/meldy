-- Run once after migration *_app_telemetry.sql: the single read-only check of that apply.
-- ONE SELECT returning ONE JSON object (column app_telemetry). It never raises: a missing table, function, schema
-- or view reads as false or null, so the report always comes back. Catalog only (pg_catalog, pg_policies,
-- pg_db_role_setting, supabase_migrations.schema_migrations); it reads no rows of app_events or of any user table.
-- contract_ok is true when every check holds; failed names the checks that do not.
-- Checks (what «свои ошибки и статистика» depends on):
--   * public.log_app_events(jsonb) is the only function of that name, returns integer, is SECURITY DEFINER with
--     search_path='' and may be executed by anon and authenticated but not by PUBLIC;
--   * public.app_events: the columns and their types, created_at defaults to now(), the nine CHECK constraints,
--     user_id references auth.users with ON DELETE SET NULL, the four indexes, RLS on, no policy at all, no
--     privilege of any kind for anon or authenticated (nor on its identity sequence), and the role that owns the
--     function is not held by the table's row security;
--   * schema analytics: exists, no USAGE or CREATE for PUBLIC, anon or authenticated, not listed in the
--     authenticator role's pgrst.db_schemas (when that setting is stored as a role setting);
--   * its four views exist, are security_invoker, and anon / authenticated have no privilege on them.
-- Report: the last 3 schema_migrations rows; the function's owner, flags, config and ACL; the table's owner,
-- grants and policies; the views and their options.
WITH
fn AS (
  SELECT p.oid, p.prosecdef, p.proconfig, p.proacl::text AS acl, p.proowner,
         pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,
         pg_catalog.pg_get_function_result(p.oid) AS result
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.log_app_events(jsonb)')
),
fn_overloads AS (
  SELECT pg_catalog.count(*) AS n
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'log_app_events'
),
tbl AS (
  SELECT c.oid, c.relrowsecurity, c.relforcerowsecurity, c.relowner,
         pg_catalog.pg_get_userbyid(c.relowner)::text AS owner
    FROM pg_catalog.pg_class c
   WHERE c.oid = pg_catalog.to_regclass('public.app_events') AND c.relkind IN ('r', 'p')
),
cols (ord, column_name, type_name) AS (
  VALUES (1, 'id', 'bigint'), (2, 'created_at', 'timestamp with time zone'), (3, 'kind', 'text'), (4, 'name', 'text'),
         (5, 'route', 'text'), (6, 'session', 'text'), (7, 'user_id', 'uuid'), (8, 'device', 'text'),
         (9, 'app_version', 'text'), (10, 'props', 'jsonb'), (11, 'message', 'text'), (12, 'stack', 'text')
),
col_state AS (
  SELECT c.ord, c.column_name, c.type_name,
         (SELECT pg_catalog.format_type(a.atttypid, a.atttypmod)
            FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = pg_catalog.to_regclass('public.app_events') AND a.attname = c.column_name
             AND NOT a.attisdropped AND a.attnum > 0) AS actual
    FROM cols c
),
created_default AS (
  SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS expr
    FROM pg_catalog.pg_attrdef d
    JOIN pg_catalog.pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = pg_catalog.to_regclass('public.app_events') AND a.attname = 'created_at'
),
checks_expected (conname) AS (
  VALUES ('app_events_kind_check'), ('app_events_name_check'), ('app_events_route_check'), ('app_events_session_check'),
         ('app_events_device_check'), ('app_events_app_version_check'), ('app_events_props_check'),
         ('app_events_message_check'), ('app_events_stack_check')
),
user_fk AS (
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint k
     WHERE k.conrelid = pg_catalog.to_regclass('public.app_events') AND k.contype = 'f'
       AND k.confrelid = pg_catalog.to_regclass('auth.users') AND k.confdeltype = 'n'
  ) AS ok
),
idx_expected (index_name) AS (
  VALUES ('app_events_created_idx'), ('app_events_user_created_idx'), ('app_events_anon_created_idx'),
         ('app_events_error_id_idx')
),
pol AS (
  SELECT p.policyname::text AS policy_name, p.cmd, p.roles::text[] AS roles, p.qual, p.with_check
    FROM pg_catalog.pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'app_events'
),
privs (role_name, priv) AS (
  SELECT r, p FROM (VALUES ('anon'), ('authenticated')) AS roles (r),
                   (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS ps (p)
),
table_privs AS (
  SELECT pr.role_name, pr.priv, pg_catalog.has_table_privilege(pr.role_name, t.oid, pr.priv) AS granted
    FROM tbl t CROSS JOIN privs pr
),
seq AS (
  SELECT pg_catalog.to_regclass(pg_catalog.pg_get_serial_sequence('public.app_events', 'id')) AS oid
),
seq_privs AS (
  SELECT r.role_name, sp.priv, pg_catalog.has_sequence_privilege(r.role_name, s.oid, sp.priv) AS granted
    FROM seq s
   CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r (role_name)
   CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS sp (priv)
   WHERE s.oid IS NOT NULL
),
definer AS (
  SELECT (SELECT r.rolsuper OR r.rolbypassrls
                 OR (pg_catalog.pg_has_role(r.oid, t.relowner, 'USAGE') AND NOT t.relforcerowsecurity)
            FROM pg_catalog.pg_roles r WHERE r.oid = (SELECT proowner FROM fn)) AS free
    FROM tbl t
),
schema_row AS (
  SELECT n.oid, pg_catalog.pg_get_userbyid(n.nspowner)::text AS owner, n.nspacl::text AS acl
    FROM pg_catalog.pg_namespace n
   WHERE n.nspname = 'analytics'
),
schema_privs AS (
  SELECT r.role_name, sp.priv, pg_catalog.has_schema_privilege(r.role_name, s.oid, sp.priv) AS granted
    FROM schema_row s
   CROSS JOIN (VALUES ('public'), ('anon'), ('authenticated')) AS r (role_name)
   CROSS JOIN (VALUES ('USAGE'), ('CREATE')) AS sp (priv)
),
pgrst_schemas AS (
  SELECT pg_catalog.string_agg(cfg, '; ') AS setting
    FROM pg_catalog.pg_db_role_setting s
    JOIN pg_catalog.pg_roles r ON r.oid = s.setrole
   CROSS JOIN LATERAL pg_catalog.unnest(s.setconfig) AS cfg
   WHERE r.rolname = 'authenticator' AND cfg LIKE 'pgrst.db_schemas=%'
),
views_expected (ord, view_name) AS (
  VALUES (1, 'daily_funnel'), (2, 'retention'), (3, 'top_errors'), (4, 'events_daily')
),
view_state AS (
  SELECT v.ord, v.view_name, c.oid, c.reloptions,
         COALESCE(c.reloptions @> ARRAY['security_invoker=true'], false) AS invoker
    FROM views_expected v
    LEFT JOIN pg_catalog.pg_class c
      ON c.oid = pg_catalog.to_regclass('analytics.' || v.view_name) AND c.relkind = 'v'
),
view_privs AS (
  SELECT v.view_name, r.role_name, pv.priv, pg_catalog.has_table_privilege(r.role_name, v.oid, pv.priv) AS granted
    FROM view_state v
   CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r (role_name)
   CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS pv (priv)
   WHERE v.oid IS NOT NULL
),
checks (ord, name, ok) AS (
  SELECT 1, 'fn_log_app_events',
         (SELECT f.oid IS NOT NULL AND f.prosecdef AND f.result = 'integer'
                 AND f.proconfig @> ARRAY['search_path=""']
                 AND pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE')
                 AND pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
                 AND NOT pg_catalog.has_function_privilege('public', f.oid, 'EXECUTE')
            FROM fn f)
  UNION ALL
  SELECT 2, 'fn_single_signature', (SELECT n = 1 FROM fn_overloads)
  UNION ALL
  SELECT 3, 'app_events_columns', EXISTS (SELECT 1 FROM tbl)
         AND NOT EXISTS (SELECT 1 FROM col_state WHERE actual IS DISTINCT FROM type_name)
  UNION ALL
  SELECT 4, 'app_events_created_at_server_time', EXISTS (SELECT 1 FROM created_default WHERE expr ILIKE '%now()%')
  UNION ALL
  SELECT 5, 'app_events_checks', NOT EXISTS (
    SELECT 1 FROM checks_expected e
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                        WHERE k.conrelid = pg_catalog.to_regclass('public.app_events') AND k.contype = 'c'
                          AND k.conname = e.conname AND k.convalidated))
  UNION ALL
  SELECT 6, 'app_events_user_fk_set_null', (SELECT ok FROM user_fk)
  UNION ALL
  SELECT 7, 'app_events_indexes', NOT EXISTS (
    SELECT 1 FROM idx_expected e
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i
                        WHERE i.indrelid = pg_catalog.to_regclass('public.app_events') AND i.indisvalid
                          AND i.indexrelid = pg_catalog.to_regclass('public.' || e.index_name)))
  UNION ALL
  SELECT 8, 'app_events_rls_on', (SELECT relrowsecurity FROM tbl)
  UNION ALL
  SELECT 9, 'app_events_no_policies', EXISTS (SELECT 1 FROM tbl) AND NOT EXISTS (SELECT 1 FROM pol)
  UNION ALL
  SELECT 10, 'app_events_no_client_privileges', EXISTS (SELECT 1 FROM tbl)
         AND NOT EXISTS (SELECT 1 FROM table_privs WHERE granted)
  UNION ALL
  SELECT 11, 'app_events_sequence_no_client_privileges', (SELECT oid IS NOT NULL FROM seq)
         AND NOT EXISTS (SELECT 1 FROM seq_privs WHERE granted)
  UNION ALL
  SELECT 12, 'definer_not_held_by_app_events_rls', (SELECT free FROM definer)
  UNION ALL
  SELECT 13, 'analytics_schema_owner_only', EXISTS (SELECT 1 FROM schema_row)
         AND NOT EXISTS (SELECT 1 FROM schema_privs WHERE granted)
  UNION ALL
  SELECT 14, 'analytics_not_exposed_by_role_setting',
         COALESCE((SELECT setting FROM pgrst_schemas) NOT ILIKE '%analytics%', true)
  UNION ALL
  SELECT 15, 'analytics_views_invoker', NOT EXISTS (SELECT 1 FROM view_state WHERE oid IS NULL OR NOT invoker)
  UNION ALL
  SELECT 16, 'analytics_views_no_client_privileges', EXISTS (SELECT 1 FROM view_state WHERE oid IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM view_privs WHERE granted)
)
SELECT pg_catalog.json_build_object(
  'contract_ok', (SELECT pg_catalog.bool_and(ok IS TRUE) FROM checks),
  'failed', (SELECT COALESCE(pg_catalog.json_agg(name ORDER BY ord), '[]'::json) FROM checks WHERE ok IS NOT TRUE),
  'checks', (SELECT pg_catalog.json_object_agg(name, ok IS TRUE ORDER BY ord) FROM checks),
  'migrations', (SELECT COALESCE(pg_catalog.json_agg(pg_catalog.json_build_object('version', m.version, 'name', m.name)
                                                     ORDER BY m.version DESC), '[]'::json)
                   FROM (SELECT s.version, s.name FROM supabase_migrations.schema_migrations s
                          ORDER BY s.version DESC LIMIT 3) m),
  'function', (SELECT pg_catalog.json_build_object('exists', true, 'owner', owner, 'result', result,
                                                   'security_definer', prosecdef, 'config', proconfig, 'acl', acl)
                 FROM fn),
  'table', (SELECT pg_catalog.json_build_object(
                     'owner', t.owner, 'rls_enabled', t.relrowsecurity, 'rls_forced', t.relforcerowsecurity,
                     'granted', (SELECT COALESCE(pg_catalog.json_agg(tp.role_name || ':' || tp.priv
                                                                     ORDER BY tp.role_name, tp.priv), '[]'::json)
                                   FROM table_privs tp WHERE tp.granted),
                     'missing_or_wrong_columns', (SELECT COALESCE(pg_catalog.json_agg(cs.column_name || ':' || COALESCE(cs.actual, 'missing')
                                                                                      ORDER BY cs.ord), '[]'::json)
                                                    FROM col_state cs WHERE cs.actual IS DISTINCT FROM cs.type_name),
                     'policies', (SELECT COALESCE(pg_catalog.json_agg(pg_catalog.json_build_object(
                                    'policyname', p.policy_name, 'cmd', p.cmd, 'roles', p.roles) ORDER BY p.policy_name), '[]'::json)
                                    FROM pol p))
              FROM tbl t),
  'analytics_schema', (SELECT pg_catalog.json_build_object('owner', s.owner, 'acl', s.acl,
                                                           'pgrst_db_schemas', (SELECT setting FROM pgrst_schemas))
                         FROM schema_row s),
  'views', (SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
                     'view', 'analytics.' || v.view_name, 'exists', v.oid IS NOT NULL, 'options', v.reloptions)
                   ORDER BY v.ord) FROM view_state v)
) AS app_telemetry;
