-- Run once after migration *_cheat_sheet.sql: the single read-only check of that apply.
-- ONE SELECT returning ONE JSON object (column cheat_sheet). It never raises: a missing column or constraint reads as
-- false or null, so the report always comes back. Catalog only (pg_catalog, supabase_migrations.schema_migrations),
-- plus two counts (rubric rows that have short lines, journal peeks); no row content leaves the database.
-- contract_ok is true when every check holds; failed names the checks that do not.
-- Checks (what GET/POST /api/oral/sheet and the client's «подсмотреть» depend on):
--   * oral_rubrics.sheet exists: jsonb, nullable, no default;
--   * oral_rubrics_sheet_check is validated and limits sheet to NULL or a JSON object of at most 8192 bytes;
--   * learning_events_kind_check is validated and allows exactly quiz_answer, card_review, exam_answer, oral_point,
--     self_rating and sheet_peek;
--   * the owner can still write the column (UPDATE on oral_rubrics.sheet for authenticated, policy «Oral rubrics:
--     update own»), anon can neither read nor write it, and row security is on for both tables.
-- Report: the column, both constraint definitions, the allowed kinds, the two counts and the last 3 schema_migrations rows.
WITH
rubrics AS (
  SELECT c.oid, c.relrowsecurity FROM pg_catalog.pg_class c
   WHERE c.oid = pg_catalog.to_regclass('public.oral_rubrics') AND c.relkind IN ('r', 'p')
),
journal AS (
  SELECT c.oid, c.relrowsecurity FROM pg_catalog.pg_class c
   WHERE c.oid = pg_catalog.to_regclass('public.learning_events') AND c.relkind IN ('r', 'p')
),
sheet_col AS (
  SELECT a.attnum, a.attnotnull, pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
         (SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid)
            FROM pg_catalog.pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum) AS default_expr
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = (SELECT oid FROM rubrics) AND a.attname = 'sheet' AND a.attnum > 0 AND NOT a.attisdropped
),
sheet_con AS (
  SELECT k.convalidated, pg_catalog.pg_get_constraintdef(k.oid) AS def
    FROM pg_catalog.pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM rubrics) AND k.conname = 'oral_rubrics_sheet_check' AND k.contype = 'c'
),
kind_con AS (
  SELECT k.convalidated, pg_catalog.pg_get_constraintdef(k.oid) AS def
    FROM pg_catalog.pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM journal) AND k.conname = 'learning_events_kind_check' AND k.contype = 'c'
),
kinds AS (
  SELECT coalesce(pg_catalog.array_agg(DISTINCT m[1] ORDER BY m[1]), '{}'::text[]) AS allowed
    FROM kind_con, pg_catalog.regexp_matches(kind_con.def, '''([a-z_]+)''', 'g') AS m
),
-- Column privileges only when the column exists (has_column_privilege raises on a missing one).
privs AS (
  SELECT
    CASE WHEN EXISTS (SELECT 1 FROM sheet_col) THEN
      (SELECT pg_catalog.has_column_privilege('authenticated', oid, 'sheet', 'UPDATE') FROM rubrics)
    END AS owner_can_write,
    CASE WHEN EXISTS (SELECT 1 FROM sheet_col) THEN
      (SELECT pg_catalog.has_column_privilege('anon', oid, 'sheet', 'SELECT')
           OR pg_catalog.has_column_privilege('anon', oid, 'sheet', 'UPDATE') FROM rubrics)
    END AS anon_can_touch
),
update_policy AS (
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
     WHERE schemaname = 'public' AND tablename = 'oral_rubrics' AND policyname = 'Oral rubrics: update own'
       AND cmd = 'UPDATE' AND roles = ARRAY['authenticated']::name[]) AS present
),
-- Through to_jsonb, so a missing sheet column reads as no lines instead of failing the statement.
counts AS (
  SELECT
    (SELECT pg_catalog.count(*) FILTER (WHERE pg_catalog.jsonb_typeof(pg_catalog.to_jsonb(r) -> 'sheet') = 'object')
       FROM public.oral_rubrics r) AS rubrics_with_lines,
    (SELECT pg_catalog.count(*) FROM public.learning_events e WHERE e.kind = 'sheet_peek') AS peeks
),
checks (ord, name, ok) AS (
  SELECT 1, 'sheet_column', EXISTS (
    SELECT 1 FROM sheet_col WHERE type = 'jsonb' AND NOT attnotnull AND default_expr IS NULL)
  UNION ALL
  SELECT 2, 'sheet_check', EXISTS (
    SELECT 1 FROM sheet_con
     WHERE convalidated AND def ILIKE '%sheet IS NULL%' AND def ILIKE '%jsonb_typeof(sheet)%' AND def ILIKE '%object%'
       AND def ILIKE '%octet_length%' AND def LIKE '%8192%')
  UNION ALL
  SELECT 3, 'kind_check', EXISTS (SELECT 1 FROM kind_con WHERE convalidated)
         AND (SELECT allowed FROM kinds)
             = ARRAY['card_review', 'exam_answer', 'oral_point', 'quiz_answer', 'self_rating', 'sheet_peek']::text[]
  UNION ALL
  SELECT 4, 'owner_can_write_sheet', (SELECT owner_can_write FROM privs) AND (SELECT present FROM update_policy)
  UNION ALL
  SELECT 5, 'anon_cannot_touch_sheet', (SELECT NOT anon_can_touch FROM privs)
  UNION ALL
  SELECT 6, 'row_security_on', (SELECT relrowsecurity FROM rubrics) AND (SELECT relrowsecurity FROM journal)
)
SELECT pg_catalog.json_build_object(
  'contract_ok', (SELECT pg_catalog.bool_and(ok IS TRUE) FROM checks),
  'failed', (SELECT coalesce(pg_catalog.json_agg(name ORDER BY ord), '[]'::json) FROM checks WHERE ok IS NOT TRUE),
  'checks', (SELECT pg_catalog.json_object_agg(name, ok IS TRUE ORDER BY ord) FROM checks),
  'column', (SELECT pg_catalog.json_build_object('type', type, 'not_null', attnotnull, 'default', default_expr) FROM sheet_col),
  'sheet_check', (SELECT def FROM sheet_con),
  'kind_check', (SELECT def FROM kind_con),
  'kinds', (SELECT allowed FROM kinds),
  'rubrics_with_lines', (SELECT rubrics_with_lines FROM counts),
  'sheet_peeks', (SELECT peeks FROM counts),
  'migrations', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('version', m.version, 'name', m.name)
                                                     ORDER BY m.version DESC), '[]'::json)
                   FROM (SELECT s.version, s.name FROM supabase_migrations.schema_migrations s
                          ORDER BY s.version DESC LIMIT 3) m)
) AS cheat_sheet;
