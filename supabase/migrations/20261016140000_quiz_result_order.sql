-- The review shows the options as the participant saw them (release 46.1; owner's request 2026-10-16, spec meldy-notes
-- 10_Project/Quiz_and_Editor_Spec_2026-10-16.md §2.2). The attempt's option order is not stored: the participant's page
-- derives it from the attempt id, the question id, the quiz's shuffle_options and the question's keep_order
-- (frontend lib/quizzes/quizModel.ts quizOrder). quiz_result now carries those two, so the review can order and letter
-- the options the same way; before this the review stood in the file's order and the letters could differ.
-- Only meldy_private.quiz_result_json changes: two fields more, nothing else. The key still leaves the server only when
-- the review allows it. Re-runnable; CREATE OR REPLACE keeps the grants (none: the helper stays private).
-- Check: supabase/tests/quiz_result_order.sql. Rehearsal: supabase/tests/local/quizzes_run.sh (applies this after
-- 20261016120000_quizzes.sql). Rollback: supabase/rollback/20261016140000_quiz_result_order_down.sql.

create or replace function meldy_private.quiz_result_json(p_attempt uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_a public.quiz_attempts%rowtype;
  v_q public.quizzes%rowtype;
  v_total integer;
  v_correct integer;
  v_percent integer;
  v_review text;
  v_used integer;
  v_items jsonb := '[]'::jsonb;
begin
  select a.* into v_a from public.quiz_attempts a where a.id = p_attempt;
  select q.* into v_q from public.quizzes q where q.id = v_a.quiz_id;
  select pg_catalog.count(*)::integer, (pg_catalog.count(*) filter (where g.correct))::integer into v_total, v_correct
    from meldy_private.quiz_graded(null, p_attempt) g;
  v_percent := case when v_total > 0 then pg_catalog.round(100.0 * v_correct / v_total)::integer else 0 end;
  v_review := case when v_q.review <> 'mistakes_then_answers' then v_q.review
                   when meldy_private.quiz_state(v_q) = 'closed' then 'answers'
                   else 'mistakes' end;
  select pg_catalog.count(*)::integer into v_used
    from public.quiz_attempts a where a.quiz_id = v_q.id and a.user_id = v_a.user_id;
  if v_review <> 'score' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', i.id, 'kind', i.kind, 'stem', i.stem, 'options', i.options, 'code', i.code, 'images', i.images,
             'keep_order', i.keep_order,
             'chosen', pg_catalog.to_jsonb(g.chosen), 'text', g.typed, 'right', g.correct,
             'key', case when v_review = 'answers' and i.kind <> 'short' then pg_catalog.to_jsonb(i.correct) end,
             'forms', case when v_review = 'answers' and i.kind = 'short' then pg_catalog.to_jsonb(i.answers) end)
             order by g.ord), '[]'::jsonb)
      into v_items
      from meldy_private.quiz_graded(null, p_attempt) g
      join public.test_items i on i.id = g.item_id;
  end if;
  return pg_catalog.jsonb_build_object(
    'attempt_id', v_a.id, 'n', v_a.n, 'quiz_title', v_q.title, 'code', v_q.code, 'started_at', v_a.started_at,
    'finished_at', v_a.finished_at, 'finish_reason', v_a.finish_reason, 'correct', v_correct, 'total', v_total,
    'percent', v_percent, 'pass_percent', v_q.pass_percent, 'shuffle_options', v_q.shuffle_options,
    'passed', case when v_q.pass_percent is not null then v_percent >= v_q.pass_percent end,
    'review_now', v_review,
    'answers_after', case when v_q.review = 'mistakes_then_answers' and v_review = 'mistakes'
                          then coalesce(v_q.closed_at, v_q.closes_at) end,
    'attempts_left', case when v_q.attempts_allowed is not null then greatest(v_q.attempts_allowed - v_used, 0) end,
    'can_retry', meldy_private.quiz_block(v_q, v_a.user_id) is null
                 and not exists (select 1 from public.quiz_attempts a
                                  where a.quiz_id = v_q.id and a.user_id = v_a.user_id and a.finished_at is null),
    'items', v_items);
end;
$fn$;
