-- Rollback of 20261016120000_quizzes.sql («Контрольная», release 46): the storage policy, the functions (public and
-- meldy_private; my_container_ids() was never touched), then the tables with every quiz, attempt and answer in them.
-- Pictures in the bucket stay (they belong to the exams). Re-runnable.
drop policy if exists "Test item images: quiz takers read" on storage.objects;

drop function if exists public.quiz_create(uuid, jsonb);
drop function if exists public.quiz_update(uuid, jsonb);
drop function if exists public.quiz_close(uuid);
drop function if exists public.quiz_delete(uuid);
drop function if exists public.quiz_list(uuid);
drop function if exists public.quiz_results(uuid);
drop function if exists public.quiz_marks(uuid);
drop function if exists public.quiz_attempt_answers(uuid);
drop function if exists public.quiz_attempt_reset(uuid);
drop function if exists public.quiz_preview(text);
drop function if exists public.quiz_start(text, text);
drop function if exists public.quiz_answer(uuid, jsonb);
drop function if exists public.quiz_finish(uuid);
drop function if exists public.quiz_result(uuid);
drop function if exists public.my_quiz_container_ids();

-- The helpers: the ones that take a row of the tables go before the tables (their argument types depend on them).
do $do$
begin
  if pg_catalog.to_regclass('public.quizzes') is not null then
    drop function if exists meldy_private.quiz_state(public.quizzes);
    drop function if exists meldy_private.quiz_started(public.quizzes);
    drop function if exists meldy_private.quiz_row(public.quizzes);
    drop function if exists meldy_private.quiz_fixed(public.quizzes, uuid[]);
    drop function if exists meldy_private.quiz_draw(public.quizzes);
    drop function if exists meldy_private.quiz_draw_count(public.quizzes);
    drop function if exists meldy_private.quiz_deadline(timestamptz, public.quizzes);
    drop function if exists meldy_private.quiz_apply(public.quizzes, jsonb);
    drop function if exists meldy_private.quiz_block(public.quizzes, uuid);
    if pg_catalog.to_regclass('public.quiz_attempts') is not null then
      drop function if exists meldy_private.quiz_attempt_json(public.quiz_attempts, public.quizzes);
    end if;
  end if;
end;
$do$;
drop function if exists meldy_private.quiz_pool(uuid, uuid[]);
drop function if exists meldy_private.quiz_end_reason(timestamptz, timestamptz, integer);
drop function if exists meldy_private.quiz_settle(uuid);
drop function if exists meldy_private.quiz_int(jsonb, text, integer, integer, boolean);
drop function if exists meldy_private.quiz_bool(jsonb, text);
drop function if exists meldy_private.quiz_time(jsonb, text);
drop function if exists meldy_private.quiz_graded(uuid, uuid);
drop function if exists meldy_private.quiz_result_json(uuid);

drop table if exists public.quiz_answers;
drop table if exists public.quiz_attempts;
drop table if exists public.quizzes;
