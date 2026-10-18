-- Rollback of 20261018140000_quiz_practice_grace.sql back to 20261018130000_quiz_guards.sql: the readiness of practice
-- exactly as that file wrote it (CREATE OR REPLACE keeps its grants). Re-runnable.
-- What changes back: a quiz closed by time counts as closed at its closes_at, inside the 20 seconds its attempts still
-- save answers.

-- 1a. Ready: no quiz of the exam is open or not yet open.
create or replace function meldy_private.quiz_practice_ready(p_container uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select not exists (select 1 from public.quizzes z
                      where z.container_id = p_container and meldy_private.quiz_state(z) in ('open', 'not_yet'))
$fn$;
