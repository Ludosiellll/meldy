-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261021140000_learn_left.sql
-- («Осталось выучить») on the scratch database of learn_left_run.sh: who may call what, public.learn_left on a small
-- fixture (kinds, states, the lecture of each question, sections, the zone, another user's rows), and
-- public.bot_learn_left (the parts, the topic titles, the facts in the link's zone). The equivalence of the line rule
-- with the site's on many cases is the .sh's (contracts/learn_left/vectors.json). One transaction, rolled back. A failure
-- raises (FAILED: …); success prints LEARN LEFT CHECKS PASSED. Roles as PostgREST sets them; postgres for the fixture.
\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.expect_error(p_sql text, p_states text[], p_what text)
returns void language plpgsql as $fn$
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_states;
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if not (sqlstate = any (p_states)) then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_states;
    end if;
end;
$fn$;
create or replace function pg_temp.as_role(p_role text, p_sub uuid default null)
returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  perform set_config('request.jwt.claim.role', '', true);
  if p_role = 'postgres' then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', p_sub)::text, true);
    execute format('set local role %I', p_role);
  end if;
end;
$fn$;
create or replace function pg_temp.check(p_ok boolean, p_what text, p_got text default null)
returns void language plpgsql as $fn$
begin
  if p_ok is not true then
    raise exception 'FAILED: %', p_what || coalesce(' — got ' || p_got, '');
  end if;
end;
$fn$;
grant execute on function pg_temp.expect_error(text, text[], text), pg_temp.as_role(text, uuid), pg_temp.check(boolean, text, text)
  to anon, authenticated, service_role;

-- 1. The fixture: U's exam «Базы данных» with two lectures and five questions; O's exam; a container with U's exam as the
--    oral part of a subject with the file's topics; U linked to the bot.
do $f$
declare
  u uuid := 'e2100000-0000-4000-8000-000000000001';
  o uuid := 'e2100000-0000-4000-8000-000000000002';
  e uuid := 'e2400000-0000-4000-8000-000000000001';
  eo uuid := 'e2400000-0000-4000-8000-000000000002';
  l1 uuid := 'e2500000-0000-4000-8000-000000000001';
  l2 uuid := 'e2500000-0000-4000-8000-000000000002';
  c uuid := 'e2800000-0000-4000-8000-000000000001';
  s1 uuid := 'e2800000-0000-4000-8000-000000000011';
  q record;
  v_key text;
begin
  insert into auth.users (id) values (u), (o);
  insert into public.materials (id, user_id, title) values (l1, u, 'Реляционная модель'), (l2, u, 'Язык SQL');
  insert into public.exams (id, user_id, title, exam_date, ticket_layout)
  values (e, u, 'Базы данных', '2026-12-23', '{"mode": "random", "per_ticket": 2}'),
         (eo, o, 'Чужой', null, '{"mode": "random", "per_ticket": 2, "section_titles": ["Раздел"]}');
  insert into public.exam_materials (exam_id, material_id, user_id, added_at)
  values (e, l1, u, '2026-12-01 10:00+00'), (e, l2, u, '2026-12-01 11:00+00');
  insert into public.exam_questions (id, exam_id, user_id, position, label, section, text, coverage, coverage_method, evidence) values
    ('e2600000-0000-4000-8000-000000000001', e, u, 1, '1.', 2, 'Ключи отношения', 'full', 'llm',
     jsonb_build_array(jsonb_build_object('material_id', l1, 'source_id', 'S1'), jsonb_build_object('material_id', l1, 'source_id', 'S2'),
                       jsonb_build_object('material_id', l2, 'source_id', 'S3'))),
    ('e2600000-0000-4000-8000-000000000002', e, u, 2, '', null, 'Оператор SELECT', 'full', 'llm',
     jsonb_build_array(jsonb_build_object('material_id', l2, 'source_id', 'S1'), jsonb_build_object('material_id', l1, 'source_id', 'S5'))),
    ('e2600000-0000-4000-8000-000000000003', e, u, 3, '', null, 'Хранимые процедуры', 'none', 'llm', '[]'),
    ('e2600000-0000-4000-8000-000000000004', e, u, 4, '', null, 'Соединения таблиц', 'full', 'llm', '[]'),
    ('e2600000-0000-4000-8000-000000000005', e, u, 5, '', null, 'Индексы', null, null, '[]'),
    ('e2600000-0000-4000-8000-000000000011', eo, o, 1, '', 1, 'Ключи отношения', 'full', 'llm', '[]');
  for q in select x.*, (select coalesce(array_agg(m.material_id::text order by m.added_at, m.material_id), '{}')
                          from public.exam_materials m where m.exam_id = x.exam_id and m.user_id = x.user_id) as lectures
             from public.exam_questions x where x.exam_id = e and x.position in (1, 2) loop
    v_key := meldy_private.oral_rubric_key(q.materials_fingerprint, q.lectures, q.evidence, q.coverage_method);
    insert into public.oral_rubrics (user_id, question_hash, source_key, material_id, question, rubric, created_at)
    values (u, q.question_hash, v_key, l1, q.text,
            jsonb_build_object('coverage', 'full', 'coverage_note', '',
                               'materials', jsonb_build_array(jsonb_build_object('key', 'M1', 'material_id', l1, 'title', 'Реляционная модель')),
                               'points', case when q.position = 1
                                 then '[{"id": "p1", "title": "Первичный ключ", "essential": true, "source_quote": "цитата", "source_ids": ["M1:S1"]},
                                        {"id": "p2", "title": "Пример таблицы", "essential": false, "source_quote": "цитата", "source_ids": []}]'::jsonb
                                 else '[{"id": "p1", "title": "SELECT выбирает строки", "essential": false, "source_quote": "цитата", "source_ids": []}]'::jsonb end),
            '2026-12-01 12:00+00');
  end loop;
  -- The journal (no trigger: the moments and days are the fixture's). Question 1: its main point named on two days
  -- (learned; the other point is not a main one). Question 2: named once (waiting). O's naming of U's hash counts for nobody.
  perform set_config('session_replication_role', 'replica', true);
  insert into public.learning_events (id, user_id, created_at, local_date, kind, item_key, correct, session_id, client_event_id, payload)
  select ('e2700000-0000-4000-8000-0000000000' || lpad(x.n::text, 2, '0'))::uuid, x.usr, x.at, x.day, 'oral_point', 'oral:r:' || x.point,
         true, ('e2900000-0000-4000-8000-0000000000' || lpad(x.n::text, 2, '0'))::uuid, 'learn-left-' || x.n,
         jsonb_build_object('question_hash', public.meldy_question_hash(x.qtext), 'point_id', x.point, 'title', x.title, 'status', 'covered')
    from (values
      (1, u, timestamptz '2026-12-08 10:00+00', date '2026-12-08', 'p1', 'Первичный ключ', 'Ключи отношения'),
      (2, u, timestamptz '2026-12-09 09:00+00', date '2026-12-09', 'p1', 'первичный КЛЮЧ.', 'Ключи отношения'),
      (3, u, timestamptz '2026-12-09 09:30+00', date '2026-12-09', 'p1', 'SELECT выбирает строки', 'Оператор SELECT'),
      (4, o, timestamptz '2026-12-08 10:00+00', date '2026-12-08', 'p1', 'SELECT выбирает строки', 'Оператор SELECT'),
      (5, o, timestamptz '2026-12-09 10:00+00', date '2026-12-09', 'p1', 'SELECT выбирает строки', 'Оператор SELECT')
    ) as x(n, usr, at, day, point, title, qtext);
  perform set_config('session_replication_role', 'origin', true);
  insert into public.containers (id, owner_id, title, exam_date) values (c, u, 'Осенняя сессия', '2026-12-24');
  insert into public.container_subjects (id, container_id, owner_id, position, title, exam_id, topics)
  values (s1, c, u, 1, 'Базы данных', e, '["Реляционная модель", "Язык SQL"]');
  insert into bot.links (user_id, tg_user_id, chat_id, tz) values (u, 70201, 70201, 'Asia/Novosibirsk');
end
$f$;

-- 2. Who may call what.
do $t$
begin
  perform pg_temp.as_role('anon');
  perform pg_temp.expect_error('select public.learn_left()', array['42501'], 'anon runs learn_left');
  perform pg_temp.expect_error('select public.bot_learn_left(70201)', array['42501'], 'anon runs bot_learn_left');
  perform pg_temp.as_role('authenticated', null);
  perform pg_temp.expect_error('select public.learn_left()', array['28000'], 'learn_left without a user');
  perform pg_temp.as_role('authenticated', 'e2100000-0000-4000-8000-000000000001');
  perform pg_temp.expect_error('select public.bot_learn_left(70201)', array['42501'], 'authenticated runs bot_learn_left');
  perform pg_temp.expect_error($q$select meldy_private.learn_left_for('e2100000-0000-4000-8000-000000000001', null, 'UTC')$q$,
                               array['42501'], 'authenticated reaches meldy_private.learn_left_for');
  perform pg_temp.expect_error('select public.learn_left((select array_agg(gen_random_uuid()) from generate_series(1, 101)))',
                               array['22023'], 'learn_left with 101 ids');
  perform pg_temp.as_role('postgres');
end
$t$;

-- 3. The signed-in user's exam.
do $t$
declare
  v jsonb;
  x jsonb;
  q jsonb;
begin
  perform pg_temp.as_role('authenticated', 'e2100000-0000-4000-8000-000000000001');
  v := public.learn_left(array['e2400000-0000-4000-8000-000000000001'::uuid], 'Europe/Minsk');
  perform pg_temp.check(v ->> 'tz' = 'Europe/Minsk' and (v ->> 'v')::int = 1, 'the envelope', v::text);
  perform pg_temp.check(jsonb_array_length(v -> 'exams') = 1, 'one exam', (v -> 'exams')::text);
  x := v -> 'exams' -> 0;
  perform pg_temp.check(x ->> 'title' = 'Базы данных' and x -> 'section_titles' = '[]'::jsonb, 'title and no sections', x::text);
  perform pg_temp.check(x -> 'lectures' = jsonb_build_array(jsonb_build_array('e2500000-0000-4000-8000-000000000001', 'Реляционная модель'),
                                                            jsonb_build_array('e2500000-0000-4000-8000-000000000002', 'Язык SQL')),
                        'the lectures in the exam''s order', (x -> 'lectures')::text);
  perform pg_temp.check(jsonb_array_length(x -> 'q') = 5, 'five questions', (x -> 'q')::text);
  -- [id, position, label, section, lecture, kind, state, named, of, learned_at, ready_at, missed]
  q := x -> 'q' -> 0;
  perform pg_temp.check(q = jsonb_build_array('e2600000-0000-4000-8000-000000000001', 1, '1.', 2, 0, 'lines', 3, 1, 1,
                                              extract(epoch from timestamptz '2026-12-09 09:00+00')::bigint, null, 0),
                        'question 1: learned, the lecture with most fragments', q::text);
  q := x -> 'q' -> 1;
  -- Named on 9 December 9:30 UTC: 20 hours later is 10 December 5:30 UTC; Minsk's next midnight is 9 December 21:00 UTC.
  perform pg_temp.check(q = jsonb_build_array('e2600000-0000-4000-8000-000000000002', 2, '', null, 0, 'lines', 2, 1, 1, null,
                                              extract(epoch from timestamptz '2026-12-10 05:30+00')::bigint, 0),
                        'question 2: waiting, a tie of fragments goes to the earlier lecture; O''s namings do not count', q::text);
  perform pg_temp.check((x -> 'q' -> 2 ->> 5) = 'none' and (x -> 'q' -> 3 ->> 5) = 'unwritten' and (x -> 'q' -> 4 ->> 5) = 'unmapped',
                        'kinds none, unwritten, unmapped', (x -> 'q')::text);
  perform pg_temp.check((x ->> 'to_write')::int = 1, 'to_write from the sheet', x::text);
  -- A zone it cannot read: Minsk. No ids: every exam of the user (O's is not among them).
  v := public.learn_left(null, 'Nowhere/Zone');
  perform pg_temp.check(v ->> 'tz' = 'Europe/Minsk' and jsonb_array_length(v -> 'exams') = 1, 'no ids, a bad zone', v::text);
  -- O asks for U's exam: nothing.
  perform pg_temp.as_role('authenticated', 'e2100000-0000-4000-8000-000000000002');
  v := public.learn_left(array['e2400000-0000-4000-8000-000000000001'::uuid], null);
  perform pg_temp.check(v -> 'exams' = '[]'::jsonb, 'another user''s exam', v::text);
  v := public.learn_left(array['e2400000-0000-4000-8000-000000000002'::uuid], 'UTC');
  perform pg_temp.check(v -> 'exams' -> 0 -> 'section_titles' = '["Раздел"]'::jsonb
                        and (v -> 'exams' -> 0 -> 'q' -> 0 ->> 3)::int = 1 and (v -> 'exams' -> 0 -> 'q' -> 0 ->> 4) is null,
                        'O''s own exam: sections, no lectures', v::text);
  perform pg_temp.as_role('postgres');
end
$t$;

-- 4. The bot.
do $t$
declare
  v jsonb;
  q jsonb;
begin
  perform pg_temp.as_role('service_role');
  v := public.bot_learn_left(70299);
  perform pg_temp.check(v = '{"linked": false}'::jsonb, 'an unlinked Telegram user', v::text);
  v := public.bot_learn_left(70201);
  perform pg_temp.check((v -> 'linked')::boolean and v -> 'parts' = jsonb_build_array(jsonb_build_object(
                          'container_id', 'e2800000-0000-4000-8000-000000000001', 'subject_id', 'e2800000-0000-4000-8000-000000000011',
                          'exam_id', 'e2400000-0000-4000-8000-000000000001')), 'the bot''s parts', v::text);
  perform pg_temp.check(v -> 'subjects' = jsonb_build_array(jsonb_build_object('id', 'e2800000-0000-4000-8000-000000000011',
                                                                                'topics', '["Реляционная модель", "Язык SQL"]'::jsonb)),
                        'the subjects'' topic titles', (v -> 'subjects')::text);
  -- Novosibirsk (UTC+7): the next midnight after 9 December is 9 December 17:00 UTC; 20 hours still lead.
  q := v -> 'exams' -> 0 -> 'q' -> 1;
  perform pg_temp.check((q ->> 6)::int = 2 and (q ->> 10)::bigint = extract(epoch from timestamptz '2026-12-10 05:30+00')::bigint,
                        'the bot''s facts', q::text);
  perform pg_temp.as_role('postgres');
end
$t$;

\echo LEARN LEFT CHECKS PASSED
rollback;
