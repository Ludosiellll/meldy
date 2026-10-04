-- Run once after migration *_jury_trust_reads.sql: the single read-only check of that apply.
-- ONE SELECT returning ONE JSON object (column jury_trust_reads). It never raises: a missing
-- table, function or policy reads as false or null, so the report always comes back. Catalog only
-- (pg_catalog, pg_policies, supabase_migrations.schema_migrations); it reads no user rows.
-- contract_ok is true when every check holds; failed names the checks that do not.
-- Checks (what the stage answer «Протоколы видите только вы» depends on):
--   * RLS is on for exam_sessions and mistake_diary, and both new policies exist as RESTRICTIVE,
--     SELECT, roles {public}, their qual naming kind 'professor' (or origin 'oral_ticket'),
--     auth.uid() and user_id;
--   * get_group_weekly_scores(uuid) keeps its signature and result, is SECURITY DEFINER with
--     search_path '', counts exam.kind = 'professor' only, its normalised body md5 is the one the
--     migration installs, the weekly-score checks of supabase/tests/core_rls.sql still hold
--     (teacher_id...auth.uid, group_members...student_id...auth.uid, study_sessions, exam_sessions),
--     anon cannot execute it and authenticated can.
-- Report: the last 3 schema_migrations rows (version, name); RLS flags, owner and SELECT grants of
-- exam_sessions, mistake_diary, flashcard_progress and materials; every pg_policies row of those
-- four tables (policyname, permissive, roles, cmd, qual, with_check); whether a permissive owner
-- policy still lets students read their own sessions and mistakes; the function's flags, grants and
-- live body md5 next to the two known ones; and the ways around RLS for the two ticket tables:
-- views built on them, SECURITY DEFINER functions whose body names them, and their triggers.
-- Normalised body md5 = md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))):
--   028762d316d74dda911d80395b55a155  20260924062645_secure_group_weekly_scores
--   af42156e5f26e938b09ee99ed07e654a  jury_trust_reads (the same body plus AND exam.kind = 'professor')
WITH
tbl AS (
  SELECT c.oid, c.relname::text AS table_name, c.relrowsecurity, c.relforcerowsecurity,
         pg_catalog.pg_get_userbyid(c.relowner)::text AS owner
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND c.relname IN ('exam_sessions', 'mistake_diary', 'flashcard_progress', 'materials')
),
pol AS (
  SELECT p.tablename::text AS table_name, p.policyname::text AS policy_name, p.permissive,
         p.roles::text[] AS roles, p.cmd, p.qual, p.with_check
    FROM pg_catalog.pg_policies p
   WHERE p.schemaname = 'public'
     AND p.tablename IN ('exam_sessions', 'mistake_diary', 'flashcard_progress', 'materials')
),
fn AS (
  SELECT p.oid, p.prosecdef, p.proconfig, p.provolatile::text AS volatility, l.lanname::text AS language,
         pg_catalog.pg_get_userbyid(p.proowner)::text AS owner,
         pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
         pg_catalog.pg_get_function_result(p.oid) AS result,
         pg_catalog.pg_get_functiondef(p.oid) AS definition,
         pg_catalog.md5(pg_catalog.btrim(pg_catalog.regexp_replace(p.prosrc, '\s+', ' ', 'g'))) AS body_md5,
         p.proacl::text AS acl
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
   WHERE p.oid = pg_catalog.to_regprocedure('public.get_group_weekly_scores(uuid)')
),
checks (ord, name, ok) AS (
  VALUES
    (1, 'exam_sessions_rls_on', (SELECT relrowsecurity FROM tbl WHERE table_name = 'exam_sessions')),
    (2, 'mistake_diary_rls_on', (SELECT relrowsecurity FROM tbl WHERE table_name = 'mistake_diary')),
    (3, 'exam_sessions_ticket_policy', EXISTS (
       SELECT 1 FROM pol
        WHERE table_name = 'exam_sessions' AND policy_name = 'Exam sessions: ticket answers only for the owner'
          AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT' AND roles = ARRAY['public']
          AND qual ILIKE '%kind = ''professor''%' AND qual ILIKE '%auth.uid()%' AND qual ILIKE '%user_id%')),
    (4, 'mistake_diary_ticket_policy', EXISTS (
       SELECT 1 FROM pol
        WHERE table_name = 'mistake_diary' AND policy_name = 'Mistake diary: ticket answers only for the owner'
          AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT' AND roles = ARRAY['public']
          AND qual ILIKE '%origin <> ''oral_ticket''%' AND qual ILIKE '%auth.uid()%' AND qual ILIKE '%user_id%')),
    (5, 'fn_exists', EXISTS (SELECT 1 FROM fn)),
    (6, 'fn_signature_unchanged', (SELECT language = 'sql' AND arguments = 'p_group_id uuid'
                                          AND result = 'TABLE(student_id uuid, weekly_xp bigint)' FROM fn)),
    (7, 'fn_security_definer', (SELECT prosecdef FROM fn)),
    (8, 'fn_search_path_empty', (SELECT proconfig @> ARRAY['search_path=""'] FROM fn)),
    (9, 'fn_counts_only_professor', (SELECT definition ILIKE '%exam.kind = ''professor''%' FROM fn)),
    (10, 'fn_body_md5_is_new', (SELECT body_md5 = 'af42156e5f26e938b09ee99ed07e654a' FROM fn)),
    (11, 'fn_core_rls_weekly_checks', (SELECT definition ILIKE '%teacher_id%auth.uid%'
                                              AND definition ILIKE '%group_members%student_id%auth.uid%'
                                              AND definition ILIKE '%study_sessions%'
                                              AND definition ILIKE '%exam_sessions%' FROM fn)),
    (12, 'fn_anon_cannot_execute', (SELECT NOT pg_catalog.has_function_privilege('anon', oid, 'EXECUTE') FROM fn)),
    (13, 'fn_authenticated_can_execute', (SELECT pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE') FROM fn))
),
owner_read AS (
  SELECT t.table_name, EXISTS (
           SELECT 1 FROM pol
            WHERE pol.table_name = t.table_name AND permissive = 'PERMISSIVE' AND cmd IN ('ALL', 'SELECT')
              AND roles && ARRAY['public', 'authenticated']
              AND pg_catalog.regexp_replace(qual, '[[:space:]()]', '', 'g') IN
                  ('auth.uid=user_id', 'user_id=auth.uid', 'SELECTauth.uidASuid=user_id', 'user_id=SELECTauth.uidASuid')
         ) AS ok
    FROM (VALUES ('exam_sessions'), ('mistake_diary')) AS t (table_name)
),
ticket_tables AS (
  SELECT oid FROM tbl WHERE table_name IN ('exam_sessions', 'mistake_diary')
)
SELECT pg_catalog.json_build_object(
  'contract_ok', (SELECT pg_catalog.bool_and(ok IS TRUE) FROM checks),
  'failed', (SELECT coalesce(pg_catalog.json_agg(name ORDER BY ord), '[]'::json) FROM checks WHERE ok IS NOT TRUE),
  'checks', (SELECT pg_catalog.json_object_agg(name, ok IS TRUE ORDER BY ord) FROM checks),
  'migrations', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object('version', m.version, 'name', m.name)
                                                     ORDER BY m.version DESC), '[]'::json)
                   FROM (SELECT s.version, s.name FROM supabase_migrations.schema_migrations s
                          ORDER BY s.version DESC LIMIT 3) m),
  'tables', (SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
                      'table', table_name, 'rls_enabled', relrowsecurity, 'rls_forced', relforcerowsecurity,
                      'owner', owner,
                      'anon_select', pg_catalog.has_table_privilege('anon', oid, 'SELECT'),
                      'authenticated_select', pg_catalog.has_table_privilege('authenticated', oid, 'SELECT'))
                    ORDER BY table_name) FROM tbl),
  'policies', (SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
                        'table', table_name, 'policyname', policy_name, 'permissive', permissive, 'roles', roles,
                        'cmd', cmd, 'qual', qual, 'with_check', with_check)
                      ORDER BY table_name, policy_name) FROM pol),
  'owner_read', (SELECT pg_catalog.json_object_agg(table_name, ok ORDER BY table_name) FROM owner_read),
  'function', (SELECT pg_catalog.json_build_object(
                        'signature', 'public.get_group_weekly_scores(' || arguments || ')', 'result', result,
                        'language', language, 'owner', owner, 'security_definer', prosecdef, 'config', proconfig,
                        'volatility', volatility, 'acl', acl,
                        'anon_execute', pg_catalog.has_function_privilege('anon', oid, 'EXECUTE'),
                        'authenticated_execute', pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE'),
                        'public_execute', pg_catalog.has_function_privilege('public', oid, 'EXECUTE'),
                        'body_md5', body_md5,
                        'known_md5', pg_catalog.json_build_object(
                          '20260924062645_secure_group_weekly_scores', '028762d316d74dda911d80395b55a155',
                          'jury_trust_reads', 'af42156e5f26e938b09ee99ed07e654a'))
                 FROM fn),
  'around_rls', pg_catalog.json_build_object(
    'views', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object(
                         'view', v.oid::pg_catalog.regclass::text, 'kind', v.relkind::text,
                         'owner', pg_catalog.pg_get_userbyid(v.relowner)::text, 'options', v.reloptions)
                       ORDER BY v.oid::pg_catalog.regclass::text), '[]'::json)
                FROM pg_catalog.pg_class v
               WHERE v.oid IN (SELECT r.ev_class
                                 FROM pg_catalog.pg_depend d
                                 JOIN pg_catalog.pg_rewrite r ON r.oid = d.objid
                                WHERE d.classid = 'pg_catalog.pg_rewrite'::pg_catalog.regclass
                                  AND d.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
                                  AND d.refobjid IN (SELECT oid FROM ticket_tables))
                 AND v.oid NOT IN (SELECT oid FROM ticket_tables)),
    'definer_functions', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object(
                                   'function', p.oid::pg_catalog.regprocedure::text,
                                   'owner', pg_catalog.pg_get_userbyid(p.proowner)::text,
                                   'anon_execute', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
                                   'authenticated_execute', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                                 ORDER BY p.oid::pg_catalog.regprocedure::text), '[]'::json)
                            FROM pg_catalog.pg_proc p
                            JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                           WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                             AND (p.prosrc ILIKE '%exam_sessions%' OR p.prosrc ILIKE '%mistake_diary%')),
    'triggers', (SELECT coalesce(pg_catalog.json_agg(pg_catalog.json_build_object(
                          'table', t.tgrelid::pg_catalog.regclass::text, 'trigger', t.tgname::text,
                          'function', t.tgfoid::pg_catalog.regprocedure::text, 'security_definer', f.prosecdef,
                          'enabled', t.tgenabled::text)
                        ORDER BY t.tgrelid::pg_catalog.regclass::text, t.tgname), '[]'::json)
                   FROM pg_catalog.pg_trigger t
                   JOIN pg_catalog.pg_proc f ON f.oid = t.tgfoid
                  WHERE NOT t.tgisinternal AND t.tgrelid IN (SELECT oid FROM ticket_tables)))
) AS jury_trust_reads;
