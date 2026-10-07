-- Run once after migration *_exam_shares.sql: the single read-only check of that apply.
-- ONE SELECT returning ONE JSON object (column exam_shares). It never raises: a missing table or function reads as
-- false or null, so the report always comes back. Catalog only (pg_catalog, supabase_migrations.schema_migrations),
-- plus three counts (links, seats, rubric failures); no row content leaves the database.
-- contract_ok is true when every check holds; failed names the checks that do not.
-- Checks (what backend/exam_shares.py and the page /join/<code> depend on):
--   * the three tables exist with row security on;
--   * exam_shares: read own and create own only (no UPDATE or DELETE policy — a link is revoked by the function), the
--     create policy refuses a copy (it names exam_share_members), code_hash is unique, max_members defaults to 80;
--   * exam_share_members: read own only (seats are written by exam_share_claim / exam_share_bind);
--   * oral_rubric_failures: read own and add own, one row per (user, question, key, version);
--   * the functions: preview, bundle, claim, bind and revoke are SECURITY DEFINER, join is SECURITY INVOKER, every one
--     with an empty search_path; authenticated may run all six, anon the preview.
-- Local rehearsal of the behaviour: supabase/tests/local/exam_shares_behaviour.sql.
WITH
tables AS (
  SELECT c.relname, c.oid, c.relrowsecurity
    FROM pg_catalog.pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND c.relname IN ('exam_shares', 'exam_share_members', 'oral_rubric_failures')
),
policies AS (
  SELECT p.tablename, p.policyname, p.cmd, p.roles, coalesce(p.with_check, '') AS with_check
    FROM pg_catalog.pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename IN ('exam_shares', 'exam_share_members', 'oral_rubric_failures')
),
functions AS (
  SELECT p.proname, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS config, p.oid
    FROM pg_catalog.pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('exam_share_preview', 'exam_share_bundle', 'exam_share_claim', 'exam_share_bind', 'exam_share_join',
                       'exam_share_revoke')
),
max_default AS (
  SELECT (SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid)
            FROM pg_catalog.pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum) AS expr
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = (SELECT oid FROM tables WHERE relname = 'exam_shares') AND a.attname = 'max_members' AND NOT a.attisdropped
),
-- Row counts through query_to_xml, each only when its table exists: a missing table reads as null, not an error.
counts AS (
  SELECT
    CASE WHEN EXISTS (SELECT 1 FROM tables WHERE relname = 'exam_shares') THEN
      ((pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml('select count(*) as n from public.exam_shares', false, true, '')))[1])::text::bigint
    END AS links,
    CASE WHEN EXISTS (SELECT 1 FROM tables WHERE relname = 'exam_share_members') THEN
      ((pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml('select count(*) as n from public.exam_share_members', false, true, '')))[1])::text::bigint
    END AS seats,
    CASE WHEN EXISTS (SELECT 1 FROM tables WHERE relname = 'oral_rubric_failures') THEN
      ((pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml('select count(*) as n from public.oral_rubric_failures', false, true, '')))[1])::text::bigint
    END AS failures
),
checks (ord, name, ok) AS (
  SELECT 1, 'tables_with_row_security',
         (SELECT pg_catalog.count(*) FROM tables WHERE relrowsecurity) = 3
  UNION ALL
  SELECT 2, 'exam_shares_policies',
         (SELECT pg_catalog.array_agg(cmd ORDER BY cmd) FROM policies WHERE tablename = 'exam_shares')
           = ARRAY['INSERT', 'SELECT']::text[]
         AND EXISTS (SELECT 1 FROM policies WHERE tablename = 'exam_shares' AND cmd = 'INSERT'
                      AND with_check ILIKE '%exam_share_members%' AND with_check ILIKE '%members = 0%'
                      AND roles = ARRAY['authenticated']::name[])
  UNION ALL
  SELECT 3, 'exam_share_members_policies',
         (SELECT pg_catalog.array_agg(cmd ORDER BY cmd) FROM policies WHERE tablename = 'exam_share_members')
           = ARRAY['SELECT']::text[]
  UNION ALL
  SELECT 4, 'oral_rubric_failures_policies',
         (SELECT pg_catalog.array_agg(cmd ORDER BY cmd) FROM policies WHERE tablename = 'oral_rubric_failures')
           = ARRAY['INSERT', 'SELECT']::text[]
  UNION ALL
  SELECT 5, 'code_hash_unique',
         EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = (SELECT oid FROM tables WHERE relname = 'exam_shares')
                    AND k.conname = 'exam_shares_code_hash_key' AND k.contype = 'u')
  UNION ALL
  SELECT 6, 'max_members_default_80', (SELECT expr FROM max_default) = '80'
  UNION ALL
  SELECT 7, 'failures_unique',
         EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = (SELECT oid FROM tables WHERE relname = 'oral_rubric_failures')
                    AND k.conname = 'oral_rubric_failures_unique' AND k.contype = 'u')
  UNION ALL
  SELECT 8, 'definer_functions',
         (SELECT pg_catalog.count(*) FROM functions
           WHERE prosecdef AND proname IN ('exam_share_preview', 'exam_share_bundle', 'exam_share_claim', 'exam_share_bind',
                                           'exam_share_revoke')) = 5
  UNION ALL
  SELECT 9, 'join_is_invoker',
         EXISTS (SELECT 1 FROM functions WHERE proname = 'exam_share_join' AND NOT prosecdef)
  UNION ALL
  SELECT 10, 'empty_search_path',
         (SELECT pg_catalog.count(*) FROM functions WHERE config IN ('search_path=""', 'search_path=')) = 6
  UNION ALL
  SELECT 11, 'authenticated_may_run',
         (SELECT pg_catalog.bool_and(pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')) FROM functions)
         AND (SELECT pg_catalog.count(*) FROM functions) = 6
  UNION ALL
  SELECT 12, 'anon_may_preview',
         EXISTS (SELECT 1 FROM functions
                  WHERE proname = 'exam_share_preview' AND pg_catalog.has_function_privilege('anon', oid, 'EXECUTE'))
)
SELECT pg_catalog.json_build_object(
  'contract_ok', (SELECT pg_catalog.bool_and(ok IS TRUE) FROM checks),
  'failed', (SELECT coalesce(pg_catalog.json_agg(name ORDER BY ord), '[]'::json) FROM checks WHERE ok IS NOT TRUE),
  'checks', (SELECT pg_catalog.json_object_agg(name, ok IS TRUE ORDER BY ord) FROM checks),
  'policies', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('table', tablename, 'name', policyname, 'cmd', cmd)
                                                   ORDER BY tablename, policyname), '[]'::json) FROM policies),
  'functions', (SELECT coalesce(pg_catalog.json_object_agg(proname, CASE WHEN prosecdef THEN 'definer' ELSE 'invoker' END), '{}'::json)
                  FROM functions),
  'links', (SELECT links FROM counts),
  'seats', (SELECT seats FROM counts),
  'rubric_failures', (SELECT failures FROM counts),
  'migrations', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('version', m.version, 'name', m.name)
                                                     ORDER BY m.version DESC), '[]'::json)
                   FROM (SELECT s.version, s.name FROM supabase_migrations.schema_migrations s
                          ORDER BY s.version DESC LIMIT 3) m)
) AS exam_shares;
