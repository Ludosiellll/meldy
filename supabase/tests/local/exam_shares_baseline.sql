-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Brings supabase/tests/local/baseline.sql to the live state that
-- *_exam_shares.sql meets: since 20261007064400_drop_public_material_reads a lecture row is readable only by its
-- author (the baseline still lets anyone read a public one), and a third account C for the seat checks.
-- Order: baseline.sql, 20261003083154_hackathon_journal_exams_oral.sql, 20261005143420_cheat_sheet.sql, this file,
-- 20261007093200_exam_shares.sql (twice, to prove it is re-runnable), exam_shares_behaviour.sql, then
-- supabase/tests/exam_shares.sql (the contract check).
drop policy if exists "Users can read own materials" on public.materials;
create policy "Users can read own materials" on public.materials for select using ((select auth.uid()) = user_id);
insert into auth.users values ('cccccccc-0000-0000-0000-000000000003') on conflict do nothing;
