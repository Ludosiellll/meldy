-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. RPC behaviour regression test of
-- *_hackathon_journal_exams_oral.sql on the local baseline (supabase/tests/local/baseline.sql):
-- question normalisation, review_flashcard SM-2 / idempotency / ownership, record_quiz_attempt
-- retake detection / mistake dedupe / foreign-material nulling, the «Билеты» tables through RLS,
-- record_oral_attempt cleaning, retries, mistakes and the follow-up card, direct journal writes,
-- append-only RLS, the old client's paths (f3b94ba) and anon. Everything runs inside transactions
-- that roll back; a failure raises an exception, success prints ALL BEHAVIOUR CHECKS PASSED and
-- ANON CHECKS PASSED. Every assertion is NULL-safe (IS DISTINCT FROM, IS NOT TRUE, IS DISTINCT FROM
-- false): a missing key, row or default fails the test instead of passing as NULL.
-- Runs as role authenticated with request.jwt.claim.sub switching between users A and B.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);

do $t$
declare
  A uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  B uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  MAT_A uuid := '11111111-1111-1111-1111-111111111111';
  MAT_B uuid := '22222222-2222-2222-2222-222222222222';
  C1 uuid := 'c0000000-0000-0000-0000-000000000001';
  C2 uuid := 'c0000000-0000-0000-0000-000000000002';
  r jsonb;
  n integer;
  v_exam uuid;
  v_q uuid;
  v_q2 uuid;
  v_hash text;
  v_sess uuid;
  v_text text;
  v_row record;
  v_ok boolean;
begin
  -- 1. Normalisation vectors (contract 1.1)
  if public.meldy_normalize_question('17. Денежно-кредитная политика ЦБ: цели, инструменты!') is distinct from 'денежно кредитная политика цб цели инструменты' then raise exception 'vector 1'; end if;
  if public.meldy_normalize_question('Вопрос 3) Ёлка и ЕЛЬ') is distinct from 'елка и ель' then raise exception 'vector 2'; end if;
  if public.meldy_normalize_question('  1.2. Предмет и метод макроэкономики.') is distinct from 'предмет и метод макроэкономики' then raise exception 'vector 3'; end if;
  if public.meldy_normalize_question('1917 год: революция') is distinct from '1917 год революция' then raise exception 'vector 4'; end if;
  if public.meldy_normalize_question('5.Инфляция: виды') is distinct from 'инфляция виды' then raise exception 'vector 5'; end if;
  if public.meldy_normalize_question('Вопрос №12. Рынок труда') is distinct from 'рынок труда' then raise exception 'vector 6: %', public.meldy_normalize_question('Вопрос №12. Рынок труда'); end if;
  if public.meldy_question_hash('Предмет и метод макроэкономики') is distinct from public.meldy_question_hash('1. ПРЕДМЕТ и метод макроэкономики!') then raise exception 'hash equality'; end if;
  if length(public.meldy_question_hash('x y z')) is distinct from 32 then raise exception 'hash length'; end if;
  raise notice 'vectors ok: %', public.meldy_question_hash('Предмет и метод макроэкономики');

  -- 2. review_flashcard: SM-2, idempotency, item mismatch, ownership
  r := public.review_flashcard(C1, 5, 'evt-review-0001', current_date, null);
  if (r->>'repetitions')::int is distinct from 1 or (r->>'interval_days')::int is distinct from 1 or (r->>'duplicate')::boolean is distinct from false then raise exception 'review 1: %', r; end if;
  r := public.review_flashcard(C1, 4, 'evt-review-0002');
  if (r->>'repetitions')::int is distinct from 2 or (r->>'interval_days')::int is distinct from 6 then raise exception 'review 2: %', r; end if;
  r := public.review_flashcard(C1, 3, 'evt-review-0003');
  if (r->>'repetitions')::int is distinct from 3 or (r->>'interval_days')::int is distinct from 16 or (abs((r->>'ease_factor')::float - 2.46) > 1e-6) is not false then raise exception 'review 3: %', r; end if;
  r := public.review_flashcard(C1, 3, 'evt-review-0003');
  if (r->>'duplicate')::boolean is not true or (r->>'repetitions')::int is distinct from 3 then raise exception 'review duplicate: %', r; end if;
  begin
    r := public.review_flashcard(C2, 5, 'evt-review-0003');
    raise exception 'review mismatch did not raise';
  exception when sqlstate '22023' then null;
  end;
  -- a card that points at someone else's material is reviewed; its event links no material
  insert into public.flashcard_progress (id, user_id, material_id, question, answer)
    values ('c0000000-0000-0000-0000-0000000000f1', A, MAT_B, 'Чужая лекция?', 'Да');
  r := public.review_flashcard('c0000000-0000-0000-0000-0000000000f1', 4, 'evt-review-f001');
  if (r->>'repetitions')::int is distinct from 1 then raise exception 'foreign-material card review: %', r; end if;
  select count(*) into n from public.learning_events where client_event_id = 'evt-review-f001' and material_id is null;
  if n is distinct from 1 then raise exception 'foreign material linked to a card_review event'; end if;
  r := public.review_flashcard(C1, 1, 'evt-review-0004');
  if (r->>'repetitions')::int is distinct from 0 or (r->>'interval_days')::int is distinct from 1 then raise exception 'review fail: %', r; end if;
  select count(*) into n from public.learning_events where kind = 'card_review';
  if n is distinct from 5 then raise exception 'card_review events %', n; end if;
  select last_reviewed_at is not null into v_ok from public.flashcard_progress where id = C1;
  if v_ok is not true then raise exception 'last_reviewed_at not set'; end if;
  begin
    r := public.review_flashcard(C1, 9, 'evt-review-0005');
    raise exception 'quality 9 did not raise';
  exception when sqlstate '22023' then null;
  end;

  -- 3. record_quiz_attempt
  r := public.record_quiz_attempt(jsonb_build_object(
    'session_id', 'd0000000-0000-0000-0000-000000000001', 'material_id', MAT_A, 'local_date', current_date::text,
    'retake', false, 'surface', 'analysis', 'topic', 'Макроэкономика',
    'answers', jsonb_build_array(
      jsonb_build_object('index', 0, 'question', 'Что такое ВВП?', 'chosen', 'A', 'chosen_text', 'A) Сумма', 'expected', 'A', 'expected_text', 'A) Сумма', 'correct', true, 'source_ids', jsonb_build_array('S01'), 'options', 4),
      jsonb_build_object('index', 1, 'question', 'Что такое инфляция?', 'chosen', 'B', 'chosen_text', 'B) Падение цен', 'expected', 'C', 'expected_text', 'C) Рост цен', 'correct', false, 'explanation', 'Инфляция — рост цен', 'source_ids', jsonb_build_array('S02', 'M1:S03', 'bad'), 'options', 4),
      jsonb_build_object('index', 2, 'question', 'Что такое ставка?', 'chosen', null, 'correct', null, 'options', 4))));
  if (r->>'events')::int is distinct from 3 or (r->>'mistakes_added')::int is distinct from 1 or (r->>'retake')::boolean is distinct from false then raise exception 'quiz 1: %', r; end if;
  r := public.record_quiz_attempt(jsonb_build_object(
    'session_id', 'd0000000-0000-0000-0000-000000000001', 'material_id', MAT_A, 'retake', false,
    'answers', jsonb_build_array(jsonb_build_object('index', 1, 'question', 'Что такое инфляция?', 'correct', false))));
  if (r->>'events')::int is distinct from 0 or (r->>'duplicate')::boolean is not true then raise exception 'quiz retry: %', r; end if;
  r := public.record_quiz_attempt(jsonb_build_object(
    'session_id', 'd0000000-0000-0000-0000-000000000002', 'material_id', MAT_A, 'retake', false,
    'answers', jsonb_build_array(jsonb_build_object('index', 1, 'question', 'Что такое инфляция?', 'correct', false, 'chosen_text', 'D) Не знаю'))));
  if (r->>'events')::int is distinct from 1 or (r->>'retake')::boolean is not true or (r->>'mistakes_existing')::int is distinct from 1 or (r->>'mistakes_added')::int is distinct from 0 then raise exception 'quiz seen-before: %', r; end if;
  select payload into r from public.learning_events where session_id = 'd0000000-0000-0000-0000-000000000002';
  if (r->>'seen_before')::boolean is not true or (r->>'retake')::boolean is not true then raise exception 'quiz payload: %', r; end if;
  select count(*) into n from public.mistake_diary where origin = 'quiz' and not is_resolved;
  if n is distinct from 1 then raise exception 'quiz mistakes %', n; end if;
  select student_answer into v_text from public.mistake_diary where origin = 'quiz';
  if v_text is distinct from 'D) Не знаю' then raise exception 'quiz mistake update %', v_text; end if;
  select item_key into v_text from public.mistake_diary where origin = 'quiz';
  if coalesce(v_text, '') not like 'quiz:11111111-1111-1111-1111-111111111111:%' then raise exception 'quiz key %', v_text; end if;
  select source_ids::text into v_text from public.learning_events where client_event_id = 'd0000000-0000-0000-0000-000000000001:1';
  if v_text is distinct from '{S02}' then raise exception 'quiz source ids filtered %', v_text; end if;
  -- foreign material is dropped, not linked
  r := public.record_quiz_attempt(jsonb_build_object(
    'session_id', 'd0000000-0000-0000-0000-000000000003', 'material_id', MAT_B,
    'answers', jsonb_build_array(jsonb_build_object('index', 0, 'question', 'Чужой вопрос?', 'correct', false))));
  select count(*) into n from public.learning_events where session_id = 'd0000000-0000-0000-0000-000000000003' and material_id is null and item_key like 'quiz:none:%';
  if n is distinct from 1 then raise exception 'quiz foreign material not nulled'; end if;
  select count(*) into n from public.mistake_diary where item_key like 'quiz:none:%' and material_id is null;
  if n is distinct from 1 then raise exception 'quiz foreign mistake'; end if;

  -- 4. Tickets tables through RLS
  insert into public.exams (title, exam_date) values ('Макроэкономика', current_date + 12) returning id into v_exam;
  insert into public.exam_materials (exam_id, material_id) values (v_exam, MAT_A);
  begin
    insert into public.exam_materials (exam_id, material_id) values (v_exam, MAT_B);
    raise exception 'foreign material attached';
  exception when insufficient_privilege then null;
  end;
  insert into public.exam_questions (exam_id, position, label, text) values (v_exam, 1, '1', 'Предмет и метод макроэкономики.') returning id, question_hash into v_q, v_hash;
  insert into public.exam_questions (exam_id, position, label, text) values (v_exam, 2, '2', 'Денежный рынок и ставка') returning id into v_q2;
  if v_hash is distinct from public.meldy_question_hash('Предмет и метод макроэкономики.') then raise exception 'generated hash'; end if;
  begin
    insert into public.exam_questions (exam_id, position, text, question_hash) values (v_exam, 3, 'Текст вопроса', 'x');
    raise exception 'question_hash insert allowed';
  exception when generated_always then null;
  end;
  update public.exam_questions set coverage = 'full', coverage_method = 'llm',
    evidence = jsonb_build_array(jsonb_build_object('material_id', MAT_A, 'source_id', 'S01', 'excerpt', 'Текст лекции'))
   where id = v_q;
  begin
    insert into public.oral_rubrics (question_hash, source_key, material_id, question, rubric) values (v_hash, 'k0000000', MAT_B, 'q??', '{}');
    raise exception 'rubric for foreign material';
  exception when insufficient_privilege then null;
  end;
  insert into public.oral_rubrics (question_hash, source_key, material_id, question, rubric) values (v_hash, 'k0000000', MAT_A, 'Предмет и метод', '{"v":1,"points":[]}');
  insert into public.oral_rubrics (question_hash, source_key, material_id, question, rubric) values (v_hash, 'k0000000', MAT_A, 'Предмет и метод', '{"v":1}') on conflict do nothing;
  select count(*) into n from public.oral_rubrics;
  if n is distinct from 1 then raise exception 'rubric unique %', n; end if;

  -- 5. record_oral_attempt
  r := public.record_oral_attempt(jsonb_build_object(
    'attempt_id', 'att-0000000001', 'local_date', current_date::text, 'exam_question_id', v_q,
    'rubric_id', 'e0000000-0000-0000-0000-000000000001', 'material_id', MAT_A, 'duration_seconds', 18,
    'input', 'speech', 'score', 67, 'grade', 4, 'confidence', 3, 'verdict', 'Хорошо по сути.',
    'question', 'IGNORED CLIENT TEXT', 'question_hash', '00000000000000000000000000000000',
    'points', jsonb_build_array(
      jsonb_build_object('id', 'p1', 'title', 'Пункт один', 'essential', true, 'status', 'covered', 'credit', 1, 'student_quote', repeat('я', 400), 'source_ids', jsonb_build_array('S01', 'M1:S02'), 'material_id', MAT_A, 'source_quote', 'Текст лекции', 'source_label', '«Денежный рынок», фрагмент 1', 'live', true),
      jsonb_build_object('id', 'p2', 'title', 'Пункт два', 'essential', true, 'status', 'covered', 'credit', 1, 'material_id', MAT_B),
      jsonb_build_object('id', 'p3', 'title', 'Пункт три', 'essential', true, 'status', 'partial', 'credit', 0.5, 'material_id', MAT_A, 'source_quote', 'Цитата три'),
      jsonb_build_object('id', 'p4', 'title', 'Пункт четыре', 'essential', true, 'status', 'missing', 'credit', 0, 'material_id', MAT_A, 'source_quote', 'Цитата четыре', 'source_ids', jsonb_build_array('S04')),
      jsonb_build_object('id', 'p5', 'title', 'Пункт пять', 'essential', false, 'status', 'covered', 'credit', 1),
      jsonb_build_object('id', 'p5', 'title', 'Дубль', 'status', 'covered'),
      jsonb_build_object('id', 'x9', 'title', 'Мусор', 'status', 'covered')),
    'followup', jsonb_build_object('point_id', 'p4', 'question', 'А что будет, если взять слишком большую скорость обучения?', 'expected', 'Осцилляции', 'status', 'missing', 'chosen_by', 'check'),
    'errors', jsonb_build_array(jsonb_build_object('point_id', 'p3', 'student_quote', repeat('о', 500), 'correction', 'верно'), jsonb_build_object('point_id', 'p9', 'student_quote', 'x', 'correction', 'y')),
    'make_card', true));
  if (r->>'duplicate')::boolean is distinct from false or (r->>'events')::int is distinct from 6 or (r->>'mistakes_added')::int is distinct from 2 or (r->>'card_added')::boolean is not true then raise exception 'oral 1: %', r; end if;
  v_sess := (r->>'session_id')::uuid;
  select * into v_row from public.exam_sessions where id = v_sess;
  if v_row.kind is distinct from 'oral_ticket' or v_row.score is distinct from 67 or v_row.subject is distinct from 'Макроэкономика' or v_row.duration_seconds is distinct from 18 then raise exception 'oral session %', row_to_json(v_row); end if;
  if v_row.questions_json->0->>'question' is distinct from 'Предмет и метод макроэкономики.' then raise exception 'oral question not from row'; end if;
  if jsonb_array_length(v_row.questions_json->0->'points') is distinct from 5 then raise exception 'oral points clean %', v_row.questions_json->0->'points'; end if;
  if char_length(v_row.questions_json->0->'points'->0->>'student_quote') is distinct from 160 then raise exception 'quote cap'; end if;
  if v_row.questions_json->0->'points'->1->>'material_id' is not null then raise exception 'foreign point material kept'; end if;
  if jsonb_array_length(v_row.questions_json->0->'errors') is distinct from 1 or char_length(v_row.questions_json->0->'errors'->0->>'student_quote') is distinct from 160 then raise exception 'errors clean %', v_row.questions_json->0->'errors'; end if;
  if (v_row.questions_json->0->'points'->0->'source_ids')::text is distinct from '["S01"]' then raise exception 'point source ids %', v_row.questions_json->0->'points'->0->'source_ids'; end if;
  select item_key into v_text from public.learning_events where client_event_id = 'att-0000000001:answer';
  if v_text is distinct from 'q:' || v_hash then raise exception 'exam_answer key %', v_text; end if;
  select count(*) into n from public.learning_events where session_id = v_sess and kind = 'oral_point';
  if n is distinct from 5 then raise exception 'oral_point events %', n; end if;
  select count(*) into n from public.mistake_diary where exam_session_id = v_sess and origin = 'oral_ticket';
  if n is distinct from 2 then raise exception 'oral mistakes %', n; end if;
  select count(*) into n from public.flashcard_progress where origin = 'oral_followup' and material_id = MAT_A and next_review > now();
  if n is distinct from 1 then raise exception 'oral card %', n; end if;
  r := public.record_oral_attempt(jsonb_build_object(
    'attempt_id', 'att-0000000001', 'exam_question_id', v_q, 'score', 67, 'grade', 4,
    'points', jsonb_build_array(jsonb_build_object('id', 'p1', 'title', 'Пункт один', 'status', 'covered'))));
  if (r->>'duplicate')::boolean is not true or (r->>'session_id')::uuid is distinct from v_sess then raise exception 'oral retry: %', r; end if;
  -- second attempt on the same question: open mistakes are not duplicated, follow-up recovered
  r := public.record_oral_attempt(jsonb_build_object(
    'attempt_id', 'att-0000000002', 'exam_question_id', v_q, 'material_id', MAT_A, 'score', 89, 'grade', 5,
    'points', jsonb_build_array(
      jsonb_build_object('id', 'p3', 'title', 'Пункт три', 'essential', true, 'status', 'partial', 'material_id', MAT_A),
      jsonb_build_object('id', 'p4', 'title', 'Пункт четыре', 'essential', true, 'status', 'missing', 'material_id', MAT_A)),
    'followup', jsonb_build_object('point_id', 'p4', 'question', 'А что будет, если взять слишком большую скорость обучения?', 'status', 'covered', 'chosen_by', 'client'),
    'make_card', true));
  if (r->>'mistakes_added')::int is distinct from 0 or (r->>'mistakes_existing')::int is distinct from 1 or (r->>'card_added')::boolean is distinct from false then raise exception 'oral 2: %', r; end if;
  begin
    r := public.record_oral_attempt(jsonb_build_object('attempt_id', 'att-0000000003', 'exam_question_id', v_q, 'score', 101, 'grade', 4, 'points', '[{"id":"p1"}]'::jsonb));
    raise exception 'score 101 accepted';
  exception when sqlstate '22023' then null;
  end;

  -- 6. Journal direct writes and RLS
  insert into public.learning_events (kind, item_key, confidence, client_event_id, local_date, created_at, payload)
    values ('self_rating', 'q:' || v_hash, 3, 'self-000000001', date '2000-01-01', '2000-01-01', '{"v":1}');
  select local_date = (now() at time zone 'utc')::date and created_at > now() - interval '1 minute' into v_ok
    from public.learning_events where client_event_id = 'self-000000001';
  if v_ok is not true then raise exception 'server fields'; end if;
  begin
    insert into public.learning_events (kind, item_key, client_event_id, material_id) values ('self_rating', 'q:x', 'self-000000002', MAT_B);
    raise exception 'foreign material event allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.learning_events set correct = true;
    raise exception 'update allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.learning_events;
    raise exception 'delete allowed';
  exception when insufficient_privilege then null;
  end;

  -- 7. Old client paths keep working
  insert into public.exam_sessions (user_id, subject, questions_json, total_questions, score, status, completed_at)
    values (A, 'Старый экзамен', '[]', 3, 72, 'completed', now()) returning id into v_sess;
  select kind into v_text from public.exam_sessions where id = v_sess;
  if v_text is distinct from 'professor' then raise exception 'old session kind %', v_text; end if;
  insert into public.mistake_diary (user_id, question, correct_answer) values (A, 'q', 'a');
  select count(*) into n from public.mistake_diary where origin = 'professor';
  if n < 2 then raise exception 'old mistake origin'; end if;
  update public.flashcard_progress set last_reviewed_at = null where id = C2;
  update public.flashcard_progress set repetitions = 1, interval_days = 1, next_review = now() + interval '1 day' where id = C2;
  select last_reviewed_at is not null into v_ok from public.flashcard_progress where id = C2;
  if v_ok is not true then raise exception 'old client update did not set last_reviewed_at'; end if;

  -- 8. User B sees nothing of A and cannot use A's rows
  perform set_config('request.jwt.claim.sub', B::text, true);
  select count(*) into n from public.learning_events;
  if n is distinct from 0 then raise exception 'B sees A events %', n; end if;
  select count(*) into n from public.exams;
  if n is distinct from 0 then raise exception 'B sees A exams'; end if;
  begin
    r := public.review_flashcard(C1, 5, 'evt-b-0000001');
    raise exception 'B reviewed A card';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    r := public.record_oral_attempt(jsonb_build_object('attempt_id', 'att-b-00000001', 'exam_question_id', v_q, 'score', 50, 'grade', 3, 'points', '[{"id":"p1"}]'::jsonb));
    raise exception 'B recorded on A question';
  exception when sqlstate 'P0002' then null;
  end;
  raise notice 'ALL BEHAVIOUR CHECKS PASSED';
end
$t$;
rollback;

-- anon has no access at all
begin;
set local role anon;
do $t$
begin
  begin
    perform 1 from public.learning_events;
    raise exception 'anon read learning_events';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_quiz_attempt('{}'::jsonb);
    raise exception 'anon executed rpc';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.exams;
    raise exception 'anon read exams';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ANON CHECKS PASSED';
end
$t$;
rollback;
