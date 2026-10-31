-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of 20261103090000_oral_formula_v2.sql and
-- 20261103090100_journal_direct_writes.sql on the local chain (supabase/tests/local/oral_journal_sweep_run.sh builds it;
-- the users A and B and their materials are baseline.sql's). Runs as role authenticated with request.jwt.claim.sub = A,
-- in one transaction that rolls back; a failure raises, success prints JOURNAL DIRECT WRITES PASSED. NULL-safe checks.
-- Checks:
--   * direct inserts of A: a self-rating and a peek in the site's shape (api/learning.ts) are kept; an exam_answer, an
--     oral_point, a quiz_answer and a card_review are refused (42501), and so is a self-rating with a grade, a score, a
--     session, fragments or a malformed key, and a peek with a confidence; A's row for B is still refused;
--   * the three journal functions still write as A: review_flashcard, record_quiz_attempt, record_oral_attempt (whose
--     protocol now says formula v2), and right after each the flag is off again, so a direct exam_answer in the same
--     transaction is refused;
--   * the flag cannot be left on by a function that returns early (record_oral_attempt's retry answer).
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);

do $t$
declare
  A uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  B uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  MAT_A uuid := '11111111-1111-1111-1111-111111111111';
  C1 uuid := 'c0000000-0000-0000-0000-000000000001';
  HASH text := pg_catalog.md5('вопрос для оценки');
  RUBRIC text := 'e0000000-0000-4000-8000-000000000001';
  r jsonb;
  n integer;
  v_exam uuid;
  v_q uuid;
  v_sess uuid;
  v_refused boolean;
  v_case record;
begin
  -- 1. What the site writes directly.
  insert into public.learning_events (kind, item_key, confidence, client_event_id, local_date, material_id, payload)
    values ('self_rating', 'q:' || HASH, 3, 'dw-rating-0001', current_date, MAT_A, '{"v": 1}');
  insert into public.learning_events (kind, item_key, client_event_id, local_date, payload)
    values ('sheet_peek', 'peek:' || RUBRIC || ':p2', 'dw-peek-00001', current_date, jsonb_build_object('v', 1, 'question_hash', HASH, 'point_id', 'p2'));
  select count(*) into n from public.learning_events where client_event_id in ('dw-rating-0001', 'dw-peek-00001');
  if n is distinct from 2 then raise exception 'a rating and a peek are kept: %', n; end if;

  -- 2. What only the journal functions write, and malformed ratings and peeks.
  for v_case in
    select * from (values
      ('exam_answer', 'q:' || HASH, null::boolean, null::real, null::smallint, null::uuid, '{}'::text[], 'an exam answer'),
      ('oral_point', 'oral:' || RUBRIC || ':p1', true, 1::real, null, null, '{}', 'an oral point'),
      ('quiz_answer', 'quiz:none:' || HASH, true, 1, null, null, '{}', 'a quiz answer'),
      ('card_review', 'card:' || C1::text, true, 1, null, null, '{}', 'a card review'),
      ('self_rating', 'q:' || HASH, true, null, 3, null, '{}', 'a rating with a grade'),
      ('self_rating', 'q:' || HASH, null, 1, 3, null, '{}', 'a rating with a score'),
      ('self_rating', 'q:' || HASH, null, null, 3, 'd0000000-0000-0000-0000-0000000000aa'::uuid, '{}', 'a rating with a session'),
      ('self_rating', 'q:' || HASH, null, null, 3, null, '{S01}', 'a rating with fragments'),
      ('self_rating', 'q:not-a-hash', null, null, 3, null, '{}', 'a rating with a malformed key'),
      ('self_rating', 'q:' || HASH, null, null, null, null, '{}', 'a rating without a confidence'),
      ('sheet_peek', 'peek:' || RUBRIC || ':p2', null, null, 2, null, '{}', 'a peek with a confidence'),
      ('sheet_peek', 'sheet:' || HASH || ':p1', null, null, null, null, '{}', 'a peek with a malformed key')
    ) as c(kind, item_key, correct, score, confidence, session_id, source_ids, what)
  loop
    v_refused := false;
    begin
      insert into public.learning_events (kind, item_key, correct, score, confidence, session_id, source_ids, client_event_id, local_date)
        values (v_case.kind, v_case.item_key, v_case.correct, v_case.score, v_case.confidence, v_case.session_id, v_case.source_ids,
                'dw-refused-' || pg_catalog.md5(v_case.what), current_date);
    exception when insufficient_privilege then v_refused := true;
    end;
    if not v_refused then raise exception 'a direct write was kept: %', v_case.what; end if;
  end loop;
  v_refused := false;
  begin
    insert into public.learning_events (user_id, kind, item_key, confidence, client_event_id)
      values (B, 'self_rating', 'q:' || HASH, 2, 'dw-for-b-00001');
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then raise exception 'A wrote a rating for B'; end if;

  -- 3. The journal functions write as before, and the flag is off right after each.
  r := public.review_flashcard(C1, 5, 'dw-review-0001', current_date, null);
  if (r ->> 'duplicate')::boolean is distinct from false then raise exception 'review: %', r; end if;
  if coalesce(pg_catalog.current_setting('meldy.journal_rpc', true), '') <> '' then raise exception 'the flag is on after review_flashcard'; end if;
  r := public.record_quiz_attempt(jsonb_build_object(
    'session_id', 'd0000000-0000-4000-8000-0000000000d1', 'material_id', MAT_A, 'local_date', current_date::text,
    'answers', jsonb_build_array(jsonb_build_object('index', 0, 'question', 'Что такое ВВП?', 'correct', true),
                                 jsonb_build_object('index', 1, 'question', 'Что такое инфляция?', 'correct', false))));
  if (r ->> 'events')::int is distinct from 2 then raise exception 'quiz: %', r; end if;
  if coalesce(pg_catalog.current_setting('meldy.journal_rpc', true), '') <> '' then raise exception 'the flag is on after record_quiz_attempt'; end if;

  insert into public.exams (title, exam_date) values ('Право', current_date + 10) returning id into v_exam;
  insert into public.exam_questions (exam_id, position, label, text) values (v_exam, 1, '1', 'Понятие права.') returning id into v_q;
  r := public.record_oral_attempt(jsonb_build_object(
    'attempt_id', 'dw-oral-000001', 'local_date', current_date::text, 'exam_question_id', v_q, 'material_id', MAT_A,
    'score', 80, 'grade', 4, 'input', 'text',
    'points', jsonb_build_array(jsonb_build_object('id', 'p1', 'title', 'Норма', 'essential', true, 'status', 'covered'),
                                jsonb_build_object('id', 'p2', 'title', 'Система', 'essential', true, 'status', 'missing'))));
  if (r ->> 'events')::int is distinct from 3 then raise exception 'oral: %', r; end if;
  v_sess := (r ->> 'session_id')::uuid;
  if coalesce(pg_catalog.current_setting('meldy.journal_rpc', true), '') <> '' then raise exception 'the flag is on after record_oral_attempt'; end if;
  select pg_catalog.count(*) into n from public.exam_sessions s
   where s.id = v_sess and s.kind = 'oral_ticket' and s.questions_json -> 0 ->> 'formula' = 'v2';
  if n is distinct from 1 then raise exception 'the protocol says formula v2'; end if;
  -- A retry answers before any insert: the flag is not left on either.
  r := public.record_oral_attempt(jsonb_build_object('attempt_id', 'dw-oral-000001', 'exam_question_id', v_q, 'score', 80, 'grade', 4,
                                                    'points', '[{"id": "p1", "status": "covered"}]'::jsonb));
  if (r ->> 'duplicate')::boolean is not true then raise exception 'oral retry: %', r; end if;
  if coalesce(pg_catalog.current_setting('meldy.journal_rpc', true), '') <> '' then raise exception 'the flag is on after a retry'; end if;

  -- 4. After the functions, in the same transaction: a direct exam answer is still refused.
  v_refused := false;
  begin
    insert into public.learning_events (kind, item_key, correct, client_event_id) values ('exam_answer', 'q:' || HASH, true, 'dw-after-00001');
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then raise exception 'a direct exam answer was kept after the functions ran'; end if;

  select count(*) into n from public.learning_events
   where user_id = A and (client_event_id like 'dw-%' or session_id = 'd0000000-0000-4000-8000-0000000000d1');
  -- the rating, the peek, one review, two quiz answers, the oral answer and its two points
  if n is distinct from 8 then raise exception 'rows of this test: %', n; end if;
  raise notice 'JOURNAL DIRECT WRITES PASSED';
end
$t$;
rollback;
