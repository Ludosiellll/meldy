-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261105090000_quiz_stats.sql
-- (release 49, part B) on the scratch database of quiz_stats_telegram_run.sh. One transaction, rolled back.
-- A = the author aaaa…1; B and C are members of the exam, D an account outside it, E starts and never finishes, a guest
-- takes the quiz with a token. Covers: quiz_analysis (finished attempts of others only, the cells' credit — partial
-- included — and seconds from the server's save times, member, sent, the questions in the exam's order, another quiz of
-- the same exam with its own counts; refusals for B, anon and a quiz that is not there); quiz_send_mistakes (only the
-- members' latest attempts, wrong, partial and unanswered questions through the study core with qz: ids, a second press
-- writes nothing, a new attempt sends its own mistakes, guests and outsiders counted); test_item_percents (over every
-- quiz of the exam, the author's own tries left out, refusals).
-- A failure raises; success prints QUIZ STATS BEHAVIOUR PASSED.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_what text)
returns void language plpgsql as $fn$
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_state;
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if sqlstate = 'PGRST' and p_state = 'P0002' and (sqlerrm::jsonb ->> 'code') = 'P0002' then return; end if;
    if sqlstate is distinct from p_state then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_state;
    end if;
end;
$fn$;
create or replace function pg_temp.ok(p boolean, p_what text) returns void language plpgsql as $fn$
begin
  if p is distinct from true then raise exception 'FAILED: %', p_what; end if;
end;
$fn$;
create temp table ctx (k text primary key, v text);
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = p_k
$fn$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into pg_temp.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
create or replace function pg_temp.tok(p_n integer) returns text language sql immutable as $fn$
  select 'tok' || lpad(p_n::text, 8, '0') || repeat('Z', 32)
$fn$;
-- a question's id by its ref (kept in ctx while the author reads them: others may not read the exam)
create or replace function pg_temp.id(p_ref text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = 'id:' || p_ref
$fn$;
-- as a signed-in user ('' = anon)
create or replace function pg_temp.as_user(p_user text) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', p_user, true);
  perform set_config('role', case when p_user = '' then 'anon' else 'authenticated' end, true);
end;
$fn$;
grant all on ctx to authenticated, anon;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- 1. A's exam: four questions; two quizzes of it.
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('s', (public.container_create('Статистика', null, '[{"title":"Вопросы"}]') -> 'subjects' -> 0 ->> 'id'));
select pg_temp.put('x', (select container_id::text from public.container_subjects where id = pg_temp.c('s')::uuid));
select public.container_items_add(pg_temp.c('s')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'q:1', 'kind', 'single', 'stem', 'Один', 'options', jsonb_build_array('да', 'нет', 'может'), 'correct', jsonb_build_array(0)),
  jsonb_build_object('ref', 'q:2', 'kind', 'multiple', 'stem', 'Несколько', 'options', jsonb_build_array('a', 'b', 'c', 'd'),
                     'correct', jsonb_build_array(0, 2), 'partial', true),
  jsonb_build_object('ref', 'q:3', 'kind', 'short', 'stem', 'Столица Франции', 'answers', jsonb_build_array('Париж')),
  jsonb_build_object('ref', 'q:4', 'kind', 'number', 'stem', 'g', 'answers', jsonb_build_array('9.8'), 'tolerance', 0.1)));
select pg_temp.put('id:' || i.import_ref, i.id::text) from public.test_items i where i.subject_id = pg_temp.c('s')::uuid;
select pg_temp.put('qobj', public.quiz_create(pg_temp.c('x')::uuid, jsonb_build_object(
  'title', 'Контрольная 9А', 'subject_ids', jsonb_build_array(pg_temp.c('s')), 'item_count', 4, 'shuffle_items', false,
  'shuffle_options', false, 'same_set', true, 'attempts', null, 'offer_practice', true))::text);
select pg_temp.put('q2obj', public.quiz_create(pg_temp.c('x')::uuid, jsonb_build_object(
  'title', 'Контрольная 9Б', 'subject_ids', jsonb_build_array(pg_temp.c('s')), 'item_count', 4, 'shuffle_items', false,
  'shuffle_options', false, 'same_set', true, 'attempts', null))::text);
select pg_temp.put('q', pg_temp.c('qobj')::jsonb ->> 'id'), pg_temp.put('code', pg_temp.c('qobj')::jsonb ->> 'code');
select pg_temp.put('q2', pg_temp.c('q2obj')::jsonb ->> 'id'), pg_temp.put('code2', pg_temp.c('q2obj')::jsonb ->> 'code');
reset role;
insert into public.container_members (container_id, user_id) values
  (pg_temp.c('x')::uuid, 'bbbbbbbb-0000-0000-0000-000000000002'), (pg_temp.c('x')::uuid, 'cccccccc-0000-0000-0000-000000000003');

-- 2. The attempts.
-- B: right, partly right (a of a+c), wrong, no answer.
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.put('b1', public.quiz_start(pg_temp.c('code'), 'Борис Б') ->> 'attempt_id');
select public.quiz_answer(pg_temp.c('b1')::uuid, jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.id('q:1'), 'chosen', jsonb_build_array(0)),
  jsonb_build_object('item_id', pg_temp.id('q:2'), 'chosen', jsonb_build_array(0)),
  jsonb_build_object('item_id', pg_temp.id('q:3'), 'text', 'Лондон')));
select public.quiz_finish(pg_temp.c('b1')::uuid);
-- B in the other quiz: all right.
select pg_temp.put('b9', public.quiz_start(pg_temp.c('code2'), 'Борис Б') ->> 'attempt_id');
select public.quiz_answer(pg_temp.c('b9')::uuid, jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.id('q:1'), 'chosen', jsonb_build_array(0)),
  jsonb_build_object('item_id', pg_temp.id('q:2'), 'chosen', jsonb_build_array(0, 2)),
  jsonb_build_object('item_id', pg_temp.id('q:3'), 'text', 'париж'),
  jsonb_build_object('item_id', pg_temp.id('q:4'), 'text', '9,8')));
select public.quiz_finish(pg_temp.c('b9')::uuid);
-- C: all right but the first (one mistake).
select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.put('c1', public.quiz_start(pg_temp.c('code'), 'Вера В') ->> 'attempt_id');
select public.quiz_answer(pg_temp.c('c1')::uuid, jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.id('q:1'), 'chosen', jsonb_build_array(1)),
  jsonb_build_object('item_id', pg_temp.id('q:2'), 'chosen', jsonb_build_array(0, 2)),
  jsonb_build_object('item_id', pg_temp.id('q:3'), 'text', 'Париж'),
  jsonb_build_object('item_id', pg_temp.id('q:4'), 'text', '9.75')));
select public.quiz_finish(pg_temp.c('c1')::uuid);
-- D (not in the exam): all wrong.
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.put('d1', public.quiz_start(pg_temp.c('code'), 'Дмитрий Д') ->> 'attempt_id');
select public.quiz_answer(pg_temp.c('d1')::uuid, jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.id('q:1'), 'chosen', jsonb_build_array(2)),
  jsonb_build_object('item_id', pg_temp.id('q:3'), 'text', 'Рим')));
select public.quiz_finish(pg_temp.c('d1')::uuid);
-- E: starts, never finishes.
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.put('e1', public.quiz_start(pg_temp.c('code'), 'Ещё Е') ->> 'attempt_id');
-- the author tries the quiz.
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('a1', public.quiz_start(pg_temp.c('code'), 'Автор') ->> 'attempt_id');
select public.quiz_finish(pg_temp.c('a1')::uuid);
-- a guest: the first right.
select pg_temp.as_user('');
select pg_temp.put('g1', public.quiz_guest_start(pg_temp.c('code'), 'Гость', pg_temp.tok(1)) ->> 'attempt_id');
select public.quiz_guest_answer(pg_temp.c('g1')::uuid, pg_temp.tok(1), jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.id('q:1'), 'chosen', jsonb_build_array(0))));
select public.quiz_guest_finish(pg_temp.c('g1')::uuid, pg_temp.tok(1));
reset role;
-- The server's times of B's saves (one transaction: now() never moves): 10 s, then 15 s, then 45 s.
update public.quiz_attempts set started_at = now() - interval '5 minutes' where id = pg_temp.c('b1')::uuid;
update public.quiz_answers w set answered_at = now() - interval '5 minutes' + (case w.item_id::text
         when pg_temp.id('q:1') then interval '10 seconds' when pg_temp.id('q:2') then interval '25 seconds'
         else interval '70 seconds' end)
 where w.attempt_id = pg_temp.c('b1')::uuid;

-- 3. The analysis.
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
do $do$
declare
  r jsonb := public.quiz_analysis(pg_temp.c('q')::uuid);
  items jsonb := r -> 'items';
  b jsonb;
  k1 integer; k2 integer; k3 integer; k4 integer;
begin
  perform pg_temp.ok((select string_agg(k, ',' order by k) from jsonb_object_keys(r) k) = 'attempts,items,others,quiz_id,server_now',
                     'analysis keys');
  perform pg_temp.ok(jsonb_array_length(items) = 4, 'four questions');
  select o - 1 into k1 from jsonb_array_elements_text(items) with ordinality x(v, o) where v = pg_temp.id('q:1');
  select o - 1 into k2 from jsonb_array_elements_text(items) with ordinality x(v, o) where v = pg_temp.id('q:2');
  select o - 1 into k3 from jsonb_array_elements_text(items) with ordinality x(v, o) where v = pg_temp.id('q:3');
  select o - 1 into k4 from jsonb_array_elements_text(items) with ordinality x(v, o) where v = pg_temp.id('q:4');
  perform pg_temp.ok(array[k1, k2, k3, k4] = array[0, 1, 2, 3], 'the exam''s order');
  perform pg_temp.ok((select array_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(r -> 'attempts') x)
                     = (select array_agg(v order by v) from unnest(array[pg_temp.c('b1'), pg_temp.c('c1'), pg_temp.c('d1'), pg_temp.c('g1')]) v),
                     'finished attempts of others only (not the author''s, not the unfinished one)');
  select x into b from jsonb_array_elements(r -> 'attempts') x where x ->> 'id' = pg_temp.c('b1');
  perform pg_temp.ok(b -> 'cells' = jsonb_build_array(jsonb_build_array(0, 1, 10), jsonb_build_array(1, 0.5, 15),
                                                      jsonb_build_array(2, 0, 45), jsonb_build_array(3, 0, null)),
                     format('B''s cells: credit (partial 0.5) and seconds from the saves, null for no answer: %s', b -> 'cells'));
  perform pg_temp.ok((b ->> 'member')::boolean and not (b ->> 'guest')::boolean and not (b ->> 'sent')::boolean
                     and (b ->> 'n')::integer = 1 and length(b ->> 'person') = 16, 'B: a member, nothing sent');
  perform pg_temp.ok(((select x from jsonb_array_elements(r -> 'attempts') x where x ->> 'id' = pg_temp.c('d1')) ->> 'member') = 'false',
                     'D is not a member');
  perform pg_temp.ok(((select x from jsonb_array_elements(r -> 'attempts') x where x ->> 'id' = pg_temp.c('g1')) ->> 'guest') = 'true'
                     and ((select x from jsonb_array_elements(r -> 'attempts') x where x ->> 'id' = pg_temp.c('g1')) ->> 'member') = 'false',
                     'the guest');
  perform pg_temp.ok(jsonb_array_length(r -> 'others') = 1 and r -> 'others' -> 0 ->> 'id' = pg_temp.c('q2')
                     and (r -> 'others' -> 0 ->> 'attempts')::integer = 1 and r -> 'others' -> 0 ->> 'title' = 'Контрольная 9Б'
                     and r -> 'others' -> 0 -> 'items' = '[[0, 1, 1], [1, 1, 1], [2, 1, 1], [3, 1, 1]]'::jsonb,
                     format('the other quiz: %s', r -> 'others'));
  perform pg_temp.ok(r::text not like '%Борис%' and r::text not like '%Лондон%', 'no names or answers in the analysis');
end;
$do$;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.expect_error(format('select public.quiz_analysis(%L)', pg_temp.c('q')), 'P0002', 'B reads A''s analysis');
select pg_temp.expect_error(format('select public.quiz_send_mistakes(%L)', pg_temp.c('q')), 'P0002', 'B sends A''s mistakes');
select pg_temp.expect_error(format('select public.test_item_percents(%L)', pg_temp.c('x')), 'P0002', 'B reads A''s percents');
select pg_temp.as_user('');
select pg_temp.expect_error(format('select public.quiz_analysis(%L)', pg_temp.c('q')), '42501', 'anon');
select pg_temp.expect_error(format('select public.quiz_send_mistakes(%L)', pg_temp.c('q')), '42501', 'anon sends');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_error('select public.quiz_analysis(''00000000-0000-4000-8000-000000000000'')', 'P0002', 'no such quiz');

-- 4. The mistakes into training (sent as A; what landed is read as the database's owner: RLS keeps B's answers from A).
select pg_temp.put('send1', public.quiz_send_mistakes(pg_temp.c('q')::uuid)::text);
select pg_temp.put('send2', public.quiz_send_mistakes(pg_temp.c('q')::uuid)::text);
select pg_temp.put('sent_b1', (select x ->> 'sent' from jsonb_array_elements(public.quiz_analysis(pg_temp.c('q')::uuid) -> 'attempts') x
                                 where x ->> 'id' = pg_temp.c('b1')));
reset role;
do $do$
declare
  r jsonb := pg_temp.c('send1')::jsonb;
  n integer;
begin
  perform pg_temp.ok(r = '{"people": 2, "answers": 4, "again": 0, "clean": 0, "outside": 1, "guests": 1, "practice": true}'::jsonb,
                     format('the first send: %s', r));
  select count(*) into n from public.test_answers t
   where t.user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and t.client_event_id like 'qz:%' and t.mode = 'learn' and not t.correct;
  perform pg_temp.ok(n = 3, format('B''s three mistakes in training (%s)', n));
  perform pg_temp.ok(exists (select 1 from public.test_answers t
                              where t.user_id = 'bbbbbbbb-0000-0000-0000-000000000002'
                                and t.client_event_id = 'qz:' || replace(pg_temp.c('b1'), '-', '') || ':' || replace(pg_temp.id('q:3'), '-', '')
                                and t.answer_text = 'Лондон'),
                     'the wrong text as B gave it, under its qz id');
  perform pg_temp.ok((select s.wrong_count from public.test_item_states s
                       where s.user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and s.item_id = pg_temp.id('q:4')::uuid) = 1,
                     'the question left without an answer is a mistake in the plan');
  perform pg_temp.ok((select count(*) from public.test_answers t where t.client_event_id like 'qz:%'
                         and t.user_id = 'cccccccc-0000-0000-0000-000000000003') = 1, 'C''s one mistake');
  perform pg_temp.ok(not exists (select 1 from public.test_answers t where t.client_event_id like 'qz:%'
                                    and t.user_id in ('dddddddd-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001')),
                     'nothing for D (outside) or the author');
  r := pg_temp.c('send2')::jsonb;
  perform pg_temp.ok(r ->> 'people' = '0' and r ->> 'answers' = '0' and r ->> 'again' = '2', format('a second press writes nothing: %s', r));
  perform pg_temp.ok((select count(*) from public.test_answers t where t.client_event_id like 'qz:%') = 4, 'still four');
  perform pg_temp.ok(pg_temp.c('sent_b1') = 'true', 'the analysis says B''s went');
end;
$do$;
-- B again: the first wrong now; the new attempt's mistakes go, the old ones stay once.
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.put('b2', public.quiz_start(pg_temp.c('code'), 'Борис Б') ->> 'attempt_id');
select public.quiz_answer(pg_temp.c('b2')::uuid, jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.id('q:1'), 'chosen', jsonb_build_array(1)),
  jsonb_build_object('item_id', pg_temp.id('q:2'), 'chosen', jsonb_build_array(0, 2)),
  jsonb_build_object('item_id', pg_temp.id('q:3'), 'text', 'Париж'),
  jsonb_build_object('item_id', pg_temp.id('q:4'), 'text', '9.8')));
select public.quiz_finish(pg_temp.c('b2')::uuid);
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('send3', public.quiz_send_mistakes(pg_temp.c('q')::uuid)::text);
reset role;
do $do$
declare
  r jsonb := pg_temp.c('send3')::jsonb;
begin
  perform pg_temp.ok(r ->> 'people' = '1' and r ->> 'answers' = '1' and r ->> 'again' = '1', format('the new attempt: %s', r));
  perform pg_temp.ok(exists (select 1 from public.test_answers t
                              where t.client_event_id = 'qz:' || replace(pg_temp.c('b2'), '-', '') || ':' || replace(pg_temp.id('q:1'), '-', '')),
                     'its mistake under its own id');
  perform pg_temp.ok((select count(*) from public.test_answers t where t.client_event_id like 'qz:%') = 5, 'five in all');
end;
$do$;
-- C leaves the exam: nothing more for C, said as outside.
update public.container_members set left_at = now() where user_id = 'cccccccc-0000-0000-0000-000000000003';
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok((public.quiz_send_mistakes(pg_temp.c('q')::uuid) ->> 'outside') = '2', 'C after leaving is outside');

-- 5. The canvas's percents: every quiz of the exam, finished attempts of others.
do $do$
declare
  r jsonb := public.test_item_percents(pg_temp.c('x')::uuid);
  q1 jsonb := (select x from jsonb_array_elements(r -> 'items') x where x ->> 'item_id' = pg_temp.id('q:1'));
  q2 jsonb := (select x from jsonb_array_elements(r -> 'items') x where x ->> 'item_id' = pg_temp.id('q:2'));
begin
  -- q:1 — B1 right, B9 right, B2 wrong, C wrong, D wrong, the guest right: 6 shown, 3 right (the author's and E's left out)
  perform pg_temp.ok((r ->> 'attempts')::integer = 6, format('six attempts: %s', r ->> 'attempts'));
  perform pg_temp.ok((q1 ->> 'shown')::integer = 6 and (q1 ->> 'credit')::numeric = 3, format('q:1 %s', q1));
  -- q:2 — B1 0.5, B9 1, B2 1, C 1, D 0, guest 0
  perform pg_temp.ok((q2 ->> 'shown')::integer = 6 and (q2 ->> 'credit')::numeric = 3.5, format('q:2 %s', q2));
end;
$do$;

rollback;
\echo QUIZ STATS BEHAVIOUR PASSED
