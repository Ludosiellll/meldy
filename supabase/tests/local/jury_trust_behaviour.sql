-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour test of *_jury_trust_reads.sql on the
-- local baseline: supabase/tests/local/baseline.sql, then 20260924062645_secure_group_weekly_scores,
-- 20261003083154_hackathon_journal_exams_oral and the migration. Teacher T owns group G with
-- students A and B; O is in no group. Runs as role authenticated with request.jwt.claim.sub
-- switching between them, and finally as anon. Everything happens in one transaction that rolls
-- back; a failure raises an exception, success prints JURY TRUST PASSED. Every assertion is
-- NULL-safe (IS DISTINCT FROM, IS NOT TRUE): a missing row or value fails instead of passing as NULL.
-- Checks:
--   * exam_sessions: T still reads A's professor sessions through the approximated live policy
--     «Teachers can read exam sessions of their students», but none of the oral_ticket sessions,
--     neither the fixtures nor the ones record_oral_attempt writes. That policy matches on user_id
--     only, so the ticket answers it no longer returns are hidden by the restrictive policy alone.
--     A reads all own rows; classmate B and outsider O read none of A's rows.
--   * mistake_diary: the live table has no teacher policy, so a temporary permissive one is added
--     (rolled back with everything else). T then reads A's professor mistake but not the
--     oral_ticket ones, whose student_answer quotes the answer; A reads both kinds.
--   * The owner's write paths still work under both policies: record_oral_attempt (INSERT ...
--     RETURNING, the open-mistake ON CONFLICT DO UPDATE, a retry), resolving a ticket mistake, and
--     the previous client's inserts with RETURNING (kind and origin default to 'professor').
--   * get_group_weekly_scores counts completed professor sessions of the last 7 days only: an
--     oral_ticket session adds 0, for the teacher and for a member; an outsider gets no rows;
--     anon cannot execute it.
begin;

-- Fixtures, written by the superuser that runs this file.
insert into auth.users values ('dddddddd-0000-0000-0000-000000000004'), ('eeeeeeee-0000-0000-0000-000000000005');
insert into public.groups (id, teacher_id, name)
  values ('99999999-0000-0000-0000-000000000009', 'dddddddd-0000-0000-0000-000000000004', 'Группа 101');
insert into public.group_members (group_id, student_id) values
  ('99999999-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('99999999-0000-0000-0000-000000000009', 'bbbbbbbb-0000-0000-0000-000000000002');
insert into public.exam_sessions (id, user_id, subject, kind, status, score, completed_at) values
  -- A: one professor session counts this week; too old, unfinished and ticket answers do not
  ('e5000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Макроэкономика', 'professor', 'completed', 80, now() - interval '1 day'),
  ('e5000000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'Макроэкономика', 'professor', 'completed', 70, now() - interval '10 days'),
  ('e5000000-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000001', 'Макроэкономика', 'professor', 'in_progress', 0, null),
  ('e5000000-0000-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-000000000001', 'Макроэкономика', 'oral_ticket', 'completed', 90, now() - interval '1 hour'),
  ('e5000000-0000-0000-0000-0000000000a5', 'aaaaaaaa-0000-0000-0000-000000000001', 'Макроэкономика', 'oral_ticket', 'completed', 40, now() - interval '2 days'),
  -- B: one professor session and one ticket answer this week
  ('e5000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000002', 'Физика', 'professor', 'completed', 60, now() - interval '3 days'),
  ('e5000000-0000-0000-0000-0000000000b2', 'bbbbbbbb-0000-0000-0000-000000000002', 'Физика', 'oral_ticket', 'completed', 50, now() - interval '3 days');
insert into public.mistake_diary (id, user_id, exam_session_id, question, correct_answer, student_answer, origin) values
  ('d1a00000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-0000000000a1',
   'Что такое ставка?', 'Цена денег', 'Не помню', 'professor'),
  ('d1a00000-0000-0000-0000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'e5000000-0000-0000-0000-0000000000a4',
   'Денежный рынок', 'Спрос на деньги. Лекция: «Спрос на деньги зависит от ставки»', 'ну там спрос и предложение', 'oral_ticket');
insert into public.study_sessions (user_id, date, cards_reviewed, materials_added) values
  ('aaaaaaaa-0000-0000-0000-000000000001', current_date - 1, 10, 1),   -- 10 * 2 + 1 * 50 = 70 XP
  ('bbbbbbbb-0000-0000-0000-000000000002', current_date - 8, 5, 0);    -- outside the 7-day window

-- Temporary permissive teacher policy on mistake_diary (the live table has none; rolled back below).
create policy "Temporary: teachers read their students' mistakes" on public.mistake_diary for select
  using (exists (select 1 from public.group_members gm join public.groups g on g.id = gm.group_id
                  where gm.student_id = mistake_diary.user_id and g.teacher_id = auth.uid()));

set local role authenticated;

do $t$
declare
  A uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  B uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  T uuid := 'dddddddd-0000-0000-0000-000000000004';
  O uuid := 'eeeeeeee-0000-0000-0000-000000000005';
  G uuid := '99999999-0000-0000-0000-000000000009';
  MAT_A uuid := '11111111-1111-1111-1111-111111111111';
  A_PROF_1 uuid := 'e5000000-0000-0000-0000-0000000000a1';
  A_PROF_OLD uuid := 'e5000000-0000-0000-0000-0000000000a2';
  A_PROF_OPEN uuid := 'e5000000-0000-0000-0000-0000000000a3';
  A_TICKET uuid := 'e5000000-0000-0000-0000-0000000000a4';
  A_TICKET_2 uuid := 'e5000000-0000-0000-0000-0000000000a5';
  A_PROF_MISTAKE uuid := 'd1a00000-0000-0000-0000-0000000000a1';
  A_TICKET_MISTAKE uuid := 'd1a00000-0000-0000-0000-0000000000a2';
  n integer;
  v_xp bigint;
  v_exam uuid;
  v_q uuid;
  v_sess uuid;
  v_sess2 uuid;
  v_old uuid;
  v_old_mistake uuid;
  v_text text;
  r jsonb;
begin
  -- 1. The teacher of the group.
  perform set_config('request.jwt.claim.sub', T::text, true);
  select count(*) into n from public.exam_sessions where id in (A_PROF_1, A_PROF_OLD, A_PROF_OPEN);
  if n is distinct from 3 then raise exception 'teacher must still read the student''s professor sessions: sees %, expected 3', n; end if;
  select count(*) into n from public.exam_sessions where user_id = B and kind = 'professor';
  if n is distinct from 1 then raise exception 'teacher must read the second student''s professor session: sees %', n; end if;
  select count(*) into n from public.exam_sessions where kind = 'oral_ticket';
  if n is distinct from 0 then raise exception 'teacher reads % ticket answers of the students', n; end if;
  if exists (select 1 from public.exam_sessions where id = A_TICKET) then
    raise exception 'teacher reads the student''s ticket protocol by id';
  end if;
  if not exists (select 1 from public.mistake_diary where id = A_PROF_MISTAKE) then
    raise exception 'the temporary teacher policy must expose the student''s professor mistake';
  end if;
  select count(*) into n from public.mistake_diary where origin = 'oral_ticket';
  if n is distinct from 0 then raise exception 'teacher reads % ticket mistakes (quotes of the answer)', n; end if;
  select count(*) into n from public.get_group_weekly_scores(G);
  if n is distinct from 2 then raise exception 'teacher gets % weekly rows, expected 2', n; end if;
  select s.weekly_xp into v_xp from public.get_group_weekly_scores(G) s where s.student_id = A;
  if v_xp is distinct from 170::bigint then
    raise exception 'weekly XP of A is %, expected 170 (70 study + 100 for one completed professor session; ticket answers add 0)', v_xp;
  end if;
  select s.weekly_xp into v_xp from public.get_group_weekly_scores(G) s where s.student_id = B;
  if v_xp is distinct from 100::bigint then
    raise exception 'weekly XP of B is %, expected 100 (one professor session; the ticket answer adds 0)', v_xp;
  end if;

  -- 2. The student reads and writes every own row.
  perform set_config('request.jwt.claim.sub', A::text, true);
  select count(*) into n from public.exam_sessions where id in (A_PROF_1, A_PROF_OLD, A_PROF_OPEN, A_TICKET, A_TICKET_2);
  if n is distinct from 5 then raise exception 'student reads % own sessions, expected 5', n; end if;
  select count(*) into n from public.exam_sessions where kind = 'oral_ticket' and id in (A_TICKET, A_TICKET_2);
  if n is distinct from 2 then raise exception 'student reads % own ticket answers, expected 2', n; end if;
  select count(*) into n from public.mistake_diary where id in (A_PROF_MISTAKE, A_TICKET_MISTAKE);
  if n is distinct from 2 then raise exception 'student reads % of the two own mistakes', n; end if;

  insert into public.exams (title, exam_date) values ('Макроэкономика', current_date + 10) returning id into v_exam;
  insert into public.exam_questions (exam_id, position, label, text)
    values (v_exam, 1, '1', 'Денежный рынок и ставка процента') returning id into v_q;
  r := public.record_oral_attempt(jsonb_build_object(
    'attempt_id', 'jury-trust-0001', 'exam_question_id', v_q, 'material_id', MAT_A,
    'local_date', current_date::text, 'score', 45, 'grade', 3, 'input', 'speech',
    'points', jsonb_build_array(
      jsonb_build_object('id', 'p1', 'title', 'Спрос на деньги', 'essential', true, 'status', 'missing', 'credit', 0,
                         'material_id', MAT_A, 'source_quote', 'Спрос на деньги зависит от ставки'),
      jsonb_build_object('id', 'p2', 'title', 'Предложение денег', 'status', 'covered', 'credit', 1,
                         'student_quote', 'центральный банк управляет предложением'))));
  v_sess := (r->>'session_id')::uuid;
  if v_sess is null or (r->>'duplicate')::boolean is distinct from false or (r->>'mistakes_added')::int is distinct from 1 then
    raise exception 'record_oral_attempt under the restrictive policies: %', r;
  end if;
  select kind into v_text from public.exam_sessions where id = v_sess;
  if v_text is distinct from 'oral_ticket' then raise exception 'student cannot read the protocol just written (kind %)', v_text; end if;
  -- the same missing point again: the open mistake is updated through ON CONFLICT DO UPDATE
  r := public.record_oral_attempt(jsonb_build_object(
    'attempt_id', 'jury-trust-0002', 'exam_question_id', v_q, 'material_id', MAT_A, 'score', 50, 'grade', 3,
    'points', jsonb_build_array(
      jsonb_build_object('id', 'p1', 'title', 'Спрос на деньги', 'essential', true, 'status', 'missing', 'credit', 0,
                         'student_quote', 'про спрос не сказал'))));
  v_sess2 := (r->>'session_id')::uuid;
  if v_sess2 is null or (r->>'mistakes_added')::int is distinct from 0 or (r->>'mistakes_existing')::int is distinct from 1 then
    raise exception 'second attempt on the same open mistake: %', r;
  end if;
  r := public.record_oral_attempt(jsonb_build_object(
    'attempt_id', 'jury-trust-0001', 'exam_question_id', v_q, 'score', 45, 'grade', 3,
    'points', '[{"id":"p1","title":"Спрос на деньги","status":"missing"}]'::jsonb));
  if (r->>'duplicate')::boolean is not true or (r->>'session_id')::uuid is distinct from v_sess then
    raise exception 'retry of the first attempt: %', r;
  end if;
  select count(*) into n from public.mistake_diary where origin = 'oral_ticket' and not is_resolved;
  if n is distinct from 2 then raise exception 'student reads % open ticket mistakes, expected 2', n; end if;
  update public.mistake_diary set is_resolved = true, resolved_at = now() where id = A_TICKET_MISTAKE;
  get diagnostics n = row_count;
  if n is distinct from 1 then raise exception 'student cannot resolve an own ticket mistake (% rows)', n; end if;
  -- the previous client: direct inserts with RETURNING, kind and origin left to their defaults
  insert into public.exam_sessions (user_id, subject, questions_json, total_questions, score, status, completed_at)
    values (A, 'Старый экзамен', '[]', 3, 72, 'completed', now()) returning id, kind into v_old, v_text;
  if v_old is null or v_text is distinct from 'professor' then raise exception 'old client session insert returned % %', v_old, v_text; end if;
  insert into public.mistake_diary (user_id, question, correct_answer, exam_session_id)
    values (A, 'Старый вопрос', 'Ответ', v_old) returning id, origin into v_old_mistake, v_text;
  if v_old_mistake is null or v_text is distinct from 'professor' then
    raise exception 'old client mistake insert returned % %', v_old_mistake, v_text;
  end if;
  select s.weekly_xp into v_xp from public.get_group_weekly_scores(G) s where s.student_id = A;
  if v_xp is distinct from 270::bigint then
    raise exception 'weekly XP of A seen by A is %, expected 270 (two professor sessions, two more ticket answers add 0)', v_xp;
  end if;

  -- 3. The teacher again: the protocols record_oral_attempt wrote stay hidden, the old exam shows.
  perform set_config('request.jwt.claim.sub', T::text, true);
  if exists (select 1 from public.exam_sessions where id in (v_sess, v_sess2)) then
    raise exception 'teacher reads a protocol written by record_oral_attempt';
  end if;
  if not exists (select 1 from public.exam_sessions where id = v_old) then
    raise exception 'teacher must read the old client''s exam session';
  end if;
  select count(*) into n from public.mistake_diary where user_id = A and origin = 'oral_ticket';
  if n is distinct from 0 then raise exception 'teacher reads % ticket mistakes written by the RPC', n; end if;
  select count(*) into n from public.mistake_diary where id in (A_PROF_MISTAKE, v_old_mistake);
  if n is distinct from 2 then raise exception 'teacher reads % of A''s two professor mistakes (fixture, old client)', n; end if;
  select s.weekly_xp into v_xp from public.get_group_weekly_scores(G) s where s.student_id = A;
  if v_xp is distinct from 270::bigint then raise exception 'weekly XP of A seen by the teacher is %, expected 270', v_xp; end if;

  -- 4. A classmate reads none of A's rows but sees the group's weekly scores.
  perform set_config('request.jwt.claim.sub', B::text, true);
  select count(*) into n from public.exam_sessions where user_id = A;
  if n is distinct from 0 then raise exception 'classmate reads % of A''s sessions', n; end if;
  select count(*) into n from public.mistake_diary where user_id = A;
  if n is distinct from 0 then raise exception 'classmate reads % of A''s mistakes', n; end if;
  select count(*) into n from public.get_group_weekly_scores(G);
  if n is distinct from 2 then raise exception 'member gets % weekly rows, expected 2', n; end if;

  -- 5. Someone outside the group gets nothing.
  perform set_config('request.jwt.claim.sub', O::text, true);
  select count(*) into n from public.get_group_weekly_scores(G);
  if n is distinct from 0 then raise exception 'outsider gets % weekly rows', n; end if;
  select count(*) into n from public.exam_sessions;
  if n is distinct from 0 then raise exception 'outsider reads % sessions', n; end if;

  -- 6. anon cannot execute the weekly scores.
  set local role anon;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.get_group_weekly_scores(G);
    raise exception 'anon executed get_group_weekly_scores';
  exception when insufficient_privilege then null;
  end;

  raise notice 'JURY TRUST PASSED';
end
$t$;
rollback;
