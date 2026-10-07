-- drop_public_material_reads. Written on 2026-10-05 as supabase/pending/2026-10-05_drop_public_material_reads.sql,
-- to run after release 21 (its /shared page reads through public.shared_material(), migration
-- 20261005043821_shared_material_read.sql). The owner ran it in the Supabase SQL Editor on 2026-10-07; the agent then
-- recorded version 20261007064400 in supabase_migrations.schema_migrations and checked: materials keeps only its four
-- own-row policies, and shared_material() still answers a signed-out visitor (title, subject, summary; no
-- original_text). Re-runnable.
--
-- Why: a public material (5 rows of 4 authors on 2026-10-05) was readable whole — the lecture's original text
-- included — by anyone signed in, through two duplicate policies (finding F5). The teachers' policy below served the
-- removed teacher section; for signed-out visitors it even broke every read of materials («permission denied for table
-- groups»). After this, a material row is readable only by its author; a share link shows the title and the summary
-- through the function.
--
-- The Supabase connector holds DROP POLICY until a human confirms it, so the agent did not run this itself.
-- Rollback: supabase/rollback/20261007064400_drop_public_material_reads_down.sql.

-- was: CREATE POLICY "Public materials are viewable by everyone" ON public.materials FOR SELECT USING (is_public = true);
DROP POLICY IF EXISTS "Public materials are viewable by everyone" ON public.materials;
-- was: CREATE POLICY "public_read_public_materials" ON public.materials FOR SELECT USING (is_public = true);
DROP POLICY IF EXISTS "public_read_public_materials" ON public.materials;
-- was: CREATE POLICY "Students can view assigned materials" ON public.materials FOR SELECT USING (id IN (SELECT
--      assignments.material_id FROM assignments WHERE assignments.group_id IN (SELECT group_members.group_id FROM
--      group_members WHERE group_members.student_id = auth.uid())));
DROP POLICY IF EXISTS "Students can view assigned materials" ON public.materials;

-- Check: only the author's own policies remain on materials.
SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'materials' ORDER BY policyname;
