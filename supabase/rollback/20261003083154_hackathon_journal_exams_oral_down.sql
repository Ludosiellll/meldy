-- Behavioural rollback of hackathon_journal_exams_oral. NOT applied by any package or agent;
-- the owner runs it by hand only if the new journal paths misbehave on the live project.
-- It removes the trigger that touches the old client's flashcard UPDATE and the three RPCs.
-- Tables, columns, rows, policies and the hash functions stay: no user data is dropped, and
-- exam_questions.question_hash depends on the hash functions. Re-applying the migration restores
-- everything removed here.
begin;
drop trigger if exists flashcard_progress_touch_reviewed on public.flashcard_progress;
drop function if exists public.flashcard_progress_touch_reviewed();
drop function if exists public.review_flashcard(uuid, integer, text, date, uuid);
drop function if exists public.record_quiz_attempt(jsonb);
drop function if exists public.record_oral_attempt(jsonb);
commit;
