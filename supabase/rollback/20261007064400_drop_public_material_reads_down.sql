-- Rollback of 20261007064400_drop_public_material_reads.sql. NOT applied by any package or agent; the owner runs it by
-- hand only if every signed-in user must again read public materials whole (original_text included) — finding F5 —
-- and students again read the materials assigned to their groups (the teacher section is gone from the app).
-- The share link does not need it: /shared reads through public.shared_material().
-- The definitions are the ones the live database had on 2026-10-05.
CREATE POLICY "Public materials are viewable by everyone" ON public.materials FOR SELECT USING (is_public = true);
CREATE POLICY "public_read_public_materials" ON public.materials FOR SELECT USING (is_public = true);
CREATE POLICY "Students can view assigned materials" ON public.materials FOR SELECT USING (id IN (SELECT
  assignments.material_id FROM assignments WHERE assignments.group_id IN (SELECT group_members.group_id FROM
  group_members WHERE group_members.student_id = auth.uid())));
