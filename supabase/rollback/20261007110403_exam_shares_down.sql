-- Rollback of 20261007110403_exam_shares.sql. NOT applied by any package or agent; the owner runs it by hand only if
-- «группа по ссылке» has to go entirely. Deploy the backend without exam_shares.py first (the invitation page and the
-- «Пригласить группу» button then answer «пока нельзя»), otherwise joins fail with 503.
-- In one transaction it drops the six functions and the three tables (their policies and indexes go with them):
--   * every link and seat is gone; the copies classmates already made STAY — they are the classmates' own exams,
--     lectures, questions and answer points, untouched by this rollback;
--   * the record of answer points that did not pass the quote check (oral_rubric_failures) is gone: a link could not
--     be made with such a question until the record is written again (the next failed build writes it).
begin;
drop function if exists public.exam_share_join(text, jsonb);
drop function if exists public.exam_share_bundle(text);
drop function if exists public.exam_share_preview(text);
drop function if exists public.exam_share_claim(text);
drop function if exists public.exam_share_bind(uuid, uuid);
drop function if exists public.exam_share_revoke(uuid);
-- The create policy of exam_shares reads exam_share_members, which in turn points at exam_shares: the policy first.
drop policy if exists "Exam shares: create for own exam" on public.exam_shares;
drop table if exists public.exam_share_members;
drop table if exists public.exam_shares;
drop table if exists public.oral_rubric_failures;
commit;
