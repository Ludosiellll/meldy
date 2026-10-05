-- shared_material_read
-- Written on 2026-10-05 (finding F5 in 30_Tech/Codebase_Map of the notes). Applied by the orchestrator on 2026-10-05 through
-- apply_migration (version 20261005043821); checked as anon: no original_text, a private material gives NULL.
--
-- A material opened by its link («Поделиться» → /shared/<id>) is read through this function, not from the table:
-- it returns only the title, the subject, the date and the summary's own content and cheat sheet — never the lecture's
-- original text — and only while the author keeps the material public. With it, the broad policies that let anyone
-- read whole public rows (original_text included) can go: supabase/pending/2026-10-05_drop_public_material_reads.sql,
-- run by the owner (the Supabase connector holds statements that drop policies until a human confirms them).
--
-- Additive and re-runnable: one new function; its REVOKE names only that function.

CREATE OR REPLACE FUNCTION public.shared_material(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
           'id', m.id,
           'title', m.title,
           'subject', m.subject,
           'created_at', m.created_at,
           'summary_json',
             CASE pg_catalog.jsonb_typeof(m.summary_json)
               WHEN 'object' THEN pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                 'content', m.summary_json -> 'content',
                 'raw', m.summary_json -> 'raw',
                 'cheatsheet', m.summary_json -> 'cheatsheet'))
               ELSE NULL
             END)
    FROM public.materials m
   WHERE m.id = p_id AND m.is_public IS TRUE;
$fn$;

COMMENT ON FUNCTION public.shared_material(uuid) IS
  'A public material for its share link: title, subject, date, summary content and cheat sheet; never original_text. NULL when the material is not public.';

REVOKE ALL ON FUNCTION public.shared_material(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shared_material(uuid) TO anon, authenticated;
