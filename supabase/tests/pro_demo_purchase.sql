-- Run once after migration *_pro_demo_purchase.sql: the single read-only check of that apply.
-- ONE SELECT returning ONE JSON object (column pro_demo_purchase). It never raises: a missing column or function
-- reads as false or null, so the report always comes back. Catalog only (pg_catalog,
-- supabase_migrations.schema_migrations), plus two counts over public.profiles (PRO flags without pro_since, and
-- accounts on the demo); no row content leaves the database.
-- contract_ok is true when every check holds; failed names the checks that do not.
-- Checks (what «Купить PRO» and «Отключить PRO» in the PRO window depend on):
--   * profiles.pro_since exists: timestamptz, nullable, no default;
--   * public.start_pro_demo() and public.stop_pro_demo(): one function of each name, returning jsonb, SECURITY DEFINER
--     with search_path=public, pg_temp, executable by authenticated; each body reads auth.uid() and raises when it is
--     NULL — that guard, not a REVOKE, keeps anon out (start_pro_demo may instead be the kill switch, a body that
--     raises 'PRO demo closed' for everyone);
--   * the role that owns them is not held by the row security of profiles (else their UPDATE would find no row);
--   * clients still cannot write PRO: neither anon nor authenticated may INSERT or UPDATE is_pro or pro_since, and
--     anon cannot read pro_since;
--   * the data fix held: no profile has is_pro without pro_since.
-- Report: demo_open (false once the kill switch replaced start_pro_demo), the number of accounts on the demo, whether
-- anon and PUBLIC may execute the functions (expected true: Supabase's defaults; the guard refuses them), each
-- function's owner, config and ACL, the column, and the last 3 schema_migrations rows.
WITH
prof AS (
  SELECT c.oid, c.relowner, c.relforcerowsecurity
    FROM pg_catalog.pg_class c
   WHERE c.oid = pg_catalog.to_regclass('public.profiles') AND c.relkind IN ('r', 'p')
),
since_col AS (
  SELECT a.attnum, a.attnotnull, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
         (SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid)
            FROM pg_catalog.pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum) AS default_expr
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = (SELECT oid FROM prof) AND a.attname = 'pro_since' AND a.attnum > 0 AND NOT a.attisdropped
),
fns (ord, fname, signature) AS (
  VALUES (1, 'start_pro_demo', 'public.start_pro_demo()'),
         (2, 'stop_pro_demo', 'public.stop_pro_demo()')
),
fn AS (
  SELECT f.ord, f.fname, f.signature, p.oid, p.prosecdef, p.proconfig, p.proacl::text AS acl, p.proowner, p.prosrc,
         pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,
         pg_catalog.pg_get_function_result(p.oid) AS result,
         (SELECT pg_catalog.count(*)
            FROM pg_catalog.pg_proc q
            JOIN pg_catalog.pg_namespace n ON n.oid = q.pronamespace
           WHERE n.nspname = 'public' AND q.proname = f.fname) AS overloads
    FROM fns f
    LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure(f.signature)
),
fn_state AS (
  SELECT fn.*,
         (fn.prosrc ILIKE '%auth.uid()%' AND fn.prosrc ~* 'is\s+null' AND fn.prosrc ~* 'raise\s+exception') AS uid_guard,
         (fn.prosrc ILIKE '%PRO demo closed%') AS closed
    FROM fn
),
definer AS (
  SELECT (SELECT r.rolsuper OR r.rolbypassrls
                 OR (pg_catalog.pg_has_role(r.oid, t.relowner, 'USAGE') AND NOT t.relforcerowsecurity)
            FROM pg_catalog.pg_roles r WHERE r.oid = (SELECT proowner FROM fn WHERE ord = 1)) AS free
    FROM prof t
),
-- Column privileges only when the column exists (has_column_privilege raises on a missing one).
col_privs AS (
  SELECT
    (SELECT pg_catalog.has_column_privilege('anon', oid, 'is_pro', 'INSERT')
         OR pg_catalog.has_column_privilege('anon', oid, 'is_pro', 'UPDATE')
         OR pg_catalog.has_column_privilege('authenticated', oid, 'is_pro', 'INSERT')
         OR pg_catalog.has_column_privilege('authenticated', oid, 'is_pro', 'UPDATE') FROM prof) AS is_pro_writable,
    CASE WHEN EXISTS (SELECT 1 FROM since_col) THEN
      (SELECT pg_catalog.has_column_privilege('anon', oid, 'pro_since', 'INSERT')
           OR pg_catalog.has_column_privilege('anon', oid, 'pro_since', 'UPDATE')
           OR pg_catalog.has_column_privilege('authenticated', oid, 'pro_since', 'INSERT')
           OR pg_catalog.has_column_privilege('authenticated', oid, 'pro_since', 'UPDATE') FROM prof)
    END AS pro_since_writable,
    CASE WHEN EXISTS (SELECT 1 FROM since_col) THEN
      (SELECT pg_catalog.has_column_privilege('anon', oid, 'pro_since', 'SELECT') FROM prof)
    END AS pro_since_anon_readable
),
-- Through to_jsonb, so a missing pro_since reads as NULL instead of failing the statement.
plans AS (
  SELECT pg_catalog.count(*) FILTER (WHERE (pg_catalog.to_jsonb(p) ->> 'is_pro')::boolean
                                       AND (pg_catalog.to_jsonb(p) ->> 'pro_since') IS NULL) AS pro_without_since,
         pg_catalog.count(*) FILTER (WHERE (pg_catalog.to_jsonb(p) ->> 'pro_since') IS NOT NULL) AS on_demo
    FROM public.profiles p
),
checks (ord, name, ok) AS (
  SELECT 1, 'pro_since_column', EXISTS (
    SELECT 1 FROM since_col WHERE type = 'timestamp with time zone' AND NOT attnotnull AND default_expr IS NULL)
  UNION ALL
  SELECT 1 + f.ord, 'fn_' || f.fname,
         f.oid IS NOT NULL AND f.overloads = 1 AND f.result = 'jsonb' AND f.prosecdef
         AND f.proconfig @> ARRAY['search_path=public, pg_temp']
         AND pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE')
    FROM fn_state f
  UNION ALL
  SELECT 4, 'start_guarded_or_closed', (SELECT uid_guard OR closed FROM fn_state WHERE ord = 1)
  UNION ALL
  SELECT 5, 'stop_guarded', (SELECT uid_guard FROM fn_state WHERE ord = 2)
  UNION ALL
  SELECT 6, 'definer_not_held_by_profiles_rls', (SELECT free FROM definer)
  UNION ALL
  SELECT 7, 'clients_cannot_write_is_pro', (SELECT NOT is_pro_writable FROM col_privs)
  UNION ALL
  SELECT 8, 'clients_cannot_write_pro_since', (SELECT NOT pro_since_writable FROM col_privs)
  UNION ALL
  SELECT 9, 'anon_cannot_read_pro_since', (SELECT NOT pro_since_anon_readable FROM col_privs)
  UNION ALL
  SELECT 10, 'no_pro_without_pro_since', (SELECT pro_without_since = 0 FROM plans)
)
SELECT pg_catalog.json_build_object(
  'contract_ok', (SELECT pg_catalog.bool_and(ok IS TRUE) FROM checks),
  'failed', (SELECT coalesce(pg_catalog.json_agg(name ORDER BY ord), '[]'::json) FROM checks WHERE ok IS NOT TRUE),
  'checks', (SELECT pg_catalog.json_object_agg(name, ok IS TRUE ORDER BY ord) FROM checks),
  'demo_open', (SELECT oid IS NOT NULL AND NOT closed FROM fn_state WHERE ord = 1),
  'accounts_on_demo', (SELECT on_demo FROM plans),
  'pro_without_since', (SELECT pro_without_since FROM plans),
  'column', (SELECT pg_catalog.json_build_object('type', type, 'not_null', attnotnull, 'default', default_expr) FROM since_col),
  'functions', (SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
                          'signature', signature, 'exists', oid IS NOT NULL, 'overloads', overloads, 'owner', owner,
                          'result', result, 'security_definer', prosecdef, 'config', proconfig, 'acl', acl,
                          'uid_guard', uid_guard, 'closed', closed,
                          'anon_execute', CASE WHEN oid IS NOT NULL THEN pg_catalog.has_function_privilege('anon', oid, 'EXECUTE') END,
                          'public_execute', CASE WHEN oid IS NOT NULL THEN pg_catalog.has_function_privilege('public', oid, 'EXECUTE') END)
                        ORDER BY ord) FROM fn_state),
  'migrations', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('version', m.version, 'name', m.name)
                                                     ORDER BY m.version DESC), '[]'::json)
                   FROM (SELECT s.version, s.name FROM supabase_migrations.schema_migrations s
                          ORDER BY s.version DESC LIMIT 3) m)
) AS pro_demo_purchase;
