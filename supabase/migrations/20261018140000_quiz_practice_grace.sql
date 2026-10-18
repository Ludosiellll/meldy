-- quiz_practice_grace (release 47 security fixes, after 20261018130000_quiz_guards.sql): «Тренироваться» waits for the
-- answer grace of a quiz closed by time.
-- Repo file: supabase/migrations/20261018140000_quiz_practice_grace.sql. Base: 20261018130000_quiz_guards.sql.
-- Check after the apply: supabase/tests/quiz_practice_grace.sql (quiz_guards.sql still holds). Local rehearsal (never
-- live): supabase/tests/local/quiz_guards_run.sh, part 2. Rollback: supabase/rollback/20261018140000_quiz_practice_grace_down.sql.
--
-- A quiz reads closed at its closes_at (meldy_private.quiz_state), but an attempt whose deadline is that closing still
-- saves answers for 20 seconds after it (quiz_answer_for) and is settled only then (quiz_settle). Joining the exam in
-- those 20 seconds would show the key while someone can still answer. So practice is ready only when no quiz of the exam
-- is open or not yet open, and every quiz closed by time (closed_at empty) closed at least 20 seconds ago. A quiz the
-- author closed (closed_at set) counts at once: its attempts end with the closing.
--
-- Redefined (CREATE OR REPLACE keeps its grants: private, no client): meldy_private.quiz_practice_ready(uuid). Its
-- callers (quiz_practice_join, quiz_result_json) stay as 20261018130000 wrote them. Re-runnable; one request.

create or replace function meldy_private.quiz_practice_ready(p_container uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select not exists (select 1 from public.quizzes z
                      where z.container_id = p_container
                        and (meldy_private.quiz_state(z) in ('open', 'not_yet')
                             or (z.closed_at is null and z.closes_at is not null
                                 and pg_catalog.now() < z.closes_at + interval '20 seconds')))
$fn$;
