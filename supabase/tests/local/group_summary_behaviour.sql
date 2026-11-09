-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261109090000_group_summary.sql on a
-- scratch database with the live order up to it (supabase/tests/local/group_summary_run.sh builds it).
-- Covered: who may call public.container_group_summary (the exam's author; a member, a stranger and a call without an
-- account are refused, anon and the service role cannot run it); 4 members → only {members, min_members}, whatever
-- they answered; 5 members → the numbers, each counted by hand below; the windows' edges (167 and 169 hours, 337
-- hours, 719 and 721 hours) under a session zone that is not UTC; what is not a member's own activity (the author's
-- answers, the rows quiz_send_mistakes writes); the share of learned questions as the plan counts it (a question
-- without a key, a question set aside by an open doubt, a state of an older key); the topics (5 different members and
-- 30 answers, a topic 4 members answered never shows, «Нажали не туда?», a repeat, an older key and an answer older
-- than 30 days do not count, a topic without a title, questions without a topic, the top 3); members who left or were
-- removed (their numbers go, a topic that loses its fifth member goes); the pause after the author removes a member (no
-- number and the day they come back; «Вернуть» brings the same numbers back at once; 167 and 169 hours; two removals;
-- a member who left on their own starts none; under five there is nothing to pause); an exam without a question that
-- counts; and that nothing in the answer is an account id or a name.
-- One transaction, rolled back. A failure raises (FAILED: …); success prints GROUP SUMMARY CHECKS PASSED. Roles as
-- PostgREST sets them: authenticated (request.jwt.claim.sub); postgres for the fixtures (answers of a known age and
-- learned states cannot be made through the functions: they stamp now()).
\set ON_ERROR_STOP 1
begin;
set local timezone = 'Pacific/Kiritimati';

create temp table ctx (k text primary key, v text);
grant all on ctx to anon, authenticated, service_role;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from ctx where k = p_k
$fn$;
create or replace function pg_temp.check(p_ok boolean, p_what text, p_detail jsonb default null)
returns void language plpgsql as $fn$
begin
  if p_ok is not true then raise exception 'FAILED: % %', p_what, coalesce(p_detail::text, ''); end if;
end;
$fn$;
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_what text)
returns void language plpgsql as $fn$
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_state;
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if sqlstate <> p_state then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_state;
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
-- The author reads the summary of the exam `c`.
create or replace function pg_temp.summary() returns jsonb language plpgsql as $fn$
declare
  r jsonb;
begin
  perform pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
  r := public.container_group_summary(pg_temp.c('c')::uuid);
  perform pg_temp.as_role('postgres');
  return r;
end;
$fn$;
-- A person comes in by the exam's link.
create or replace function pg_temp.join(p_who text) returns void language plpgsql as $fn$
begin
  perform pg_temp.as_role('authenticated', pg_temp.c(p_who)::uuid);
  perform public.container_join(pg_temp.c('code'));
  perform pg_temp.as_role('postgres');
end;
$fn$;
-- p_n answers of p_who to the question p_item, the first p_wrong of them wrong, made p_age ago. p_day moves the
-- device's day against the server's (the answer core allows one day each way); p_rev is the key they were given under.
create or replace function pg_temp.answers(p_who text, p_item text, p_n integer, p_wrong integer, p_age interval,
                                           p_source text default 'web', p_flag text default null,
                                           p_rev integer default null, p_day integer default 0)
returns void language sql as $fn$
  insert into public.test_answers (user_id, client_event_id, created_at, local_date, container_id, subject_id, item_id,
                                   item_rev, kind, source, correct, misclick, retry, step)
  select pg_temp.c(p_who)::uuid, 'fx-' || replace(gen_random_uuid()::text, '-', ''), now() - p_age,
         ((now() - p_age) at time zone 'utc')::date + p_day, i.container_id, i.subject_id, i.id,
         coalesce(p_rev, i.rev), i.kind, p_source, g > p_wrong, coalesce(p_flag = 'misclick', false),
         coalesce(p_flag = 'retry', false), case when g > p_wrong then 'start' else 'miss' end
    from public.test_items i, generate_series(1, p_n) g
   where i.id = pg_temp.c(p_item)::uuid
$fn$;
-- p_who has learned the question p_item (right on two days) under the key p_rev (the current one when null).
create or replace function pg_temp.learned(p_who text, p_item text, p_rev integer default null)
returns void language sql as $fn$
  insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev, seen, right_count,
                                       first_seen_at, first_seen_day, last_answer_at, last_answer_day, last_result,
                                       streak_at, streak_day, two_days_at, two_days_day, named_at, clean_ok_at)
  select pg_temp.c(p_who)::uuid, i.id, i.container_id, i.subject_id, coalesce(p_rev, i.rev), 2, 2,
         now() - interval '3 days', current_date - 3, now() - interval '1 day', current_date - 1, 'right',
         now() - interval '3 days', current_date - 3, now() - interval '1 day', current_date - 1,
         now() - interval '1 day', now() - interval '1 day'
    from public.test_items i where i.id = pg_temp.c(p_item)::uuid
$fn$;
-- The author removes a member of the exam `c` («Убрать»), or takes them back («Вернуть»).
create or replace function pg_temp.remove(p_who text, p_restore boolean default false) returns void language plpgsql as $fn$
begin
  perform pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
  perform public.container_member_remove(pg_temp.c('c')::uuid, pg_temp.c(p_who)::uuid, p_restore);
  perform pg_temp.as_role('postgres');
end;
$fn$;
-- Time passes: p_who was removed p_age ago.
create or replace function pg_temp.removed_ago(p_who text, p_age interval) returns void language sql as $fn$
  update public.container_members set removed_at = now() - p_age
   where container_id = pg_temp.c('c')::uuid and user_id = pg_temp.c(p_who)::uuid
$fn$;
-- The answer during a pause: p_members in the exam, the numbers back 168 hours after a removal made p_age ago, said
-- as the Europe/Minsk day of that moment (counted here on its own: the session's zone is another one).
create or replace function pg_temp.paused(p_members integer, p_age interval) returns jsonb language sql stable as $fn$
  select jsonb_build_object('members', p_members, 'min_members', 5, 'paused_until',
           to_char((now() - p_age + interval '168 hours') at time zone 'Europe/Minsk', 'YYYY-MM-DD'))
$fn$;
-- The hard topics of an answer as text: «Предмет/Тема answers wrong_pct», in the answer's order.
create or replace function pg_temp.topics(p_r jsonb) returns text language sql as $fn$
  select coalesce(string_agg(format('%s/%s %s %s', t.x ->> 'subject', coalesce(t.x ->> 'topic', '(весь предмет)'),
                                    t.x ->> 'answers', t.x ->> 'wrong_pct'), '; ' order by t.ord), '')
    from jsonb_array_elements(p_r -> 'hard_topics') with ordinality as t(x, ord)
$fn$;
-- The numbers of an answer as text: «members week prev ever learned».
create or replace function pg_temp.numbers(p_r jsonb) returns text language sql as $fn$
  select concat_ws(' ', p_r ->> 'members', p_r ->> 'studied_7d', p_r ->> 'studied_prev_7d', p_r ->> 'studied_ever',
                   coalesce(p_r ->> 'learned_pct', 'null'))
$fn$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- The people (invented): A the author, S a stranger, M1…M8 who come in by the link.
insert into auth.users (id) values
  ('9a000000-0000-4000-8000-00000000000a'), ('9a000000-0000-4000-8000-00000000000b'),
  ('9a000000-0000-4000-8000-000000000001'), ('9a000000-0000-4000-8000-000000000002'),
  ('9a000000-0000-4000-8000-000000000003'), ('9a000000-0000-4000-8000-000000000004'),
  ('9a000000-0000-4000-8000-000000000005'), ('9a000000-0000-4000-8000-000000000006'),
  ('9a000000-0000-4000-8000-000000000007'), ('9a000000-0000-4000-8000-000000000008')
  on conflict do nothing;
insert into public.profiles (id, full_name) values
  ('9a000000-0000-4000-8000-00000000000a', 'Автор Примеров'), ('9a000000-0000-4000-8000-00000000000b', 'Посторонний Примеров'),
  ('9a000000-0000-4000-8000-000000000001', 'Первая Выдуманная'), ('9a000000-0000-4000-8000-000000000002', 'Второй Выдуманный'),
  ('9a000000-0000-4000-8000-000000000003', 'Третья Выдуманная'), ('9a000000-0000-4000-8000-000000000004', 'Четвёртый Выдуманный'),
  ('9a000000-0000-4000-8000-000000000005', 'Пятая Выдуманная'), ('9a000000-0000-4000-8000-000000000006', 'Шестой Выдуманный'),
  ('9a000000-0000-4000-8000-000000000007', 'Седьмая Выдуманная'), ('9a000000-0000-4000-8000-000000000008', 'Восьмой Выдуманный')
  on conflict (id) do update set full_name = excluded.full_name;
select pg_temp.put('a', '9a000000-0000-4000-8000-00000000000a'), pg_temp.put('s', '9a000000-0000-4000-8000-00000000000b');
select pg_temp.put('m' || n, '9a000000-0000-4000-8000-00000000000' || n) from generate_series(1, 8) n;

-- 1. The exam: «Базы данных» with the topics «Транзакции», «Индексы» and a third without a title; «Сети» without
--    topics. 14 questions with a key and one without. The key of one question of «Индексы» (t2d) is changed once.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare
  r jsonb;
  v_db uuid;
  v_net uuid;
begin
  r := public.container_create('Сессия группы', current_date + 20, jsonb_build_array(
         jsonb_build_object('title', 'Базы данных', 'topics', jsonb_build_array('Транзакции', 'Индексы', '')),
         jsonb_build_object('title', 'Сети')));
  perform pg_temp.put('c', r ->> 'container_id');
  v_db := (r -> 'subjects' -> 0 ->> 'id')::uuid;
  v_net := (r -> 'subjects' -> 1 ->> 'id')::uuid;
  perform public.container_items_add(v_db, (
    select jsonb_agg(jsonb_build_object('ref', 'fx:' || x.ref, 'stem', 'Вопрос ' || x.ref, 'options', jsonb_build_array('да', 'нет'),
                                        'correct', jsonb_build_array(0), 'topic', x.topic))
      from (values ('t1a', 1), ('t1b', 1), ('t1c', 1), ('t1d', 1), ('t2a', 2), ('t2b', 2), ('t2c', 2), ('t2d', 2),
                   ('t3a', 3), ('t3b', 3)) as x(ref, topic)));
  perform public.container_items_add(v_net, (
    select jsonb_agg(jsonb_build_object('ref', 'fx:' || x.ref, 'stem', 'Вопрос ' || x.ref, 'options', jsonb_build_array('да', 'нет'),
                                        'correct', case when x.ref = 'x' then '[]'::jsonb else jsonb_build_array(0) end))
      from (values ('n1'), ('n2'), ('n3'), ('n4'), ('x')) as x(ref)));
  perform pg_temp.put(replace(i.import_ref, 'fx:', ''), i.id::text)
     from public.test_items i where i.container_id = (r ->> 'container_id')::uuid;
  perform public.container_item_update(pg_temp.c('t2d')::uuid, '{"correct": [1]}');
  r := public.container_link_create((r ->> 'container_id')::uuid);
  perform pg_temp.put('code', r ->> 'code');
end;
$t$;
select pg_temp.as_role('postgres');
select pg_temp.check((select count(*) filter (where keyed) = 14 and count(*) = 15 from public.test_items
                       where container_id = pg_temp.c('c')::uuid), 'fixture: 14 questions with a key, 15 in all');
select pg_temp.check((select rev from public.test_items where id = pg_temp.c('t2d')::uuid) = 2, 'fixture: the changed key is rev 2');

-- 2. Four members, with everything they will ever answer here. The author studies the exam too.
--    Ages: M1 an hour ago and 10 days ago; M2 167 hours ago (inside the last 7 days); M3 169 hours ago (the 7 days
--    before) and once 721 hours ago (older than 30 days); M4 337 hours ago (older than both weeks) and 20 days ago.
select pg_temp.join('m1'), pg_temp.join('m2'), pg_temp.join('m3'), pg_temp.join('m4');
-- «Транзакции»: 8 answers each (M5's 8 come later).
select pg_temp.answers('m1', 't1a', 4, 1, '10 days'), pg_temp.answers('m1', 't1b', 4, 1, '10 days'),
       pg_temp.answers('m2', 't1a', 8, 4, '167 hours'), pg_temp.answers('m3', 't1c', 8, 4, '169 hours'),
       pg_temp.answers('m4', 't1d', 8, 4, '20 days');
-- «Индексы»: 10 answers each of the four, 30 of the 40 wrong. Five more of M1 under the key the author changed since.
select pg_temp.answers('m1', 't2a', 10, 6, '10 days'), pg_temp.answers('m2', 't2b', 10, 8, '167 hours'),
       pg_temp.answers('m3', 't2a', 10, 8, '169 hours'), pg_temp.answers('m4', 't2c', 10, 8, '20 days'),
       pg_temp.answers('m1', 't2d', 5, 5, '10 days', p_rev => 1);
-- The third topic (no title): 6 answers each.
select pg_temp.answers('m1', 't3a', 6, 0, '10 days'), pg_temp.answers('m2', 't3a', 6, 3, '167 hours'),
       pg_temp.answers('m3', 't3b', 6, 3, '169 hours'), pg_temp.answers('m4', 't3b', 6, 3, '337 hours');
-- «Сети» (no topics): M1 9, the others 5 each. Not counted there: «Нажали не туда?», a repeat, a row the author's
-- «send the mistakes» wrote, an answer older than 30 days, the author's own answers.
select pg_temp.answers('m1', 'n1', 1, 0, '1 hour'), pg_temp.answers('m1', 'n2', 8, 4, '10 days'),
       pg_temp.answers('m2', 'n1', 5, 4, '167 hours'), pg_temp.answers('m3', 'n3', 5, 4, '169 hours'),
       pg_temp.answers('m4', 'n4', 5, 4, '20 days'),
       pg_temp.answers('m1', 'n2', 1, 1, '10 days', p_flag => 'misclick'),
       pg_temp.answers('m1', 'n2', 1, 1, '10 days', p_flag => 'retry'),
       pg_temp.answers('m2', 'n1', 1, 1, '167 hours', p_source => 'quiz'),
       pg_temp.answers('m3', 'n3', 1, 1, '721 hours'),
       pg_temp.answers('a', 'n1', 3, 3, '1 hour'), pg_temp.answers('a', 't1a', 3, 3, '1 hour');
-- Learned: M1 7 of 14; M2 3 of the 13 left after the question they set aside (learned too, and not counted);
-- M3 2 of 14 and one more under the older key; M4 none; the author all 14.
select pg_temp.learned('m1', x) from unnest(array['t1a', 't1b', 't1c', 't1d', 't2a', 't2b', 't2c']) x;
select pg_temp.learned('m2', x) from unnest(array['t1a', 't1b', 't1c', 'n4']) x;
select pg_temp.learned('m3', 't1a'), pg_temp.learned('m3', 't1b'), pg_temp.learned('m3', 't2d', 1);
select pg_temp.learned('a', i.import_ref) from (select replace(import_ref, 'fx:', '') as import_ref from public.test_items
                                                 where container_id = pg_temp.c('c')::uuid and keyed) i;
-- Doubts: M2's open one sets n4 aside; M1's on the question without a key and M1's withdrawn one change nothing.
select pg_temp.as_role('authenticated', pg_temp.c('m2')::uuid);
select public.test_key_doubt(pg_temp.c('n4')::uuid);
select pg_temp.as_role('authenticated', pg_temp.c('m1')::uuid);
select public.test_key_doubt(pg_temp.c('x')::uuid), public.test_key_doubt(pg_temp.c('t1a')::uuid);
select public.test_key_doubt_withdraw(pg_temp.c('t1a')::uuid);
select pg_temp.as_role('postgres');

-- 3. Who may read it.
select pg_temp.as_role('authenticated', pg_temp.c('s')::uuid);
select pg_temp.expect_error($$select public.container_group_summary(pg_temp.c('c')::uuid)$$, 'P0002', 'a stranger is refused');
select pg_temp.as_role('authenticated', pg_temp.c('m1')::uuid);
select pg_temp.expect_error($$select public.container_group_summary(pg_temp.c('c')::uuid)$$, 'P0002', 'a member is refused');
select pg_temp.as_role('authenticated', null);
select pg_temp.expect_error($$select public.container_group_summary(pg_temp.c('c')::uuid)$$, '28000', 'no account: refused');
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
select pg_temp.expect_error($$select public.container_group_summary(gen_random_uuid())$$, 'P0002', 'an exam that does not exist');
select pg_temp.as_role('anon');
select pg_temp.expect_error($$select public.container_group_summary(pg_temp.c('c')::uuid)$$, '42501', 'anon cannot run it');
select pg_temp.as_role('service_role');
select pg_temp.expect_error($$select public.container_group_summary(pg_temp.c('c')::uuid)$$, '42501', 'the service role cannot run it');
select pg_temp.as_role('postgres');

-- 4. Four members: no number about the group, though all four have answered and learned.
select pg_temp.check(pg_temp.summary() = '{"members": 4, "min_members": 5}'::jsonb, '4 members: only members and min_members', pg_temp.summary());

-- 5. The fifth member comes in (answers 25 days ago; one 719 hours ago kept on the device's day before the server's).
select pg_temp.join('m5');
select pg_temp.answers('m5', 't1b', 7, 4, '25 days'), pg_temp.answers('m5', 't1b', 1, 0, '719 hours', p_day => -1),
       pg_temp.answers('m5', 't3a', 6, 3, '25 days'), pg_temp.answers('m5', 'n2', 5, 4, '25 days');
do $t$
declare
  r jsonb := pg_temp.summary();
begin
  -- By hand. In the last 7 days: M1 (an hour ago), M2 (167 h) = 2. The 7 days before: M1 (10 days), M3 (169 h) = 2;
  -- M4's 337 h is older. Ever: all 5. Learned: (7/14 + 3/13 + 2/14 + 0 + 0) / 5 = 0.8736 / 5 = 0.1747 → 17.
  perform pg_temp.check(pg_temp.numbers(r) = '5 2 2 5 17', '5 members: members, the two weeks, ever, learned', r);
  perform pg_temp.check((r ->> 'min_members')::integer = 5, 'min_members is 5', r);
  -- «Транзакции»: 8 × 5 = 40 answers, 2 + 4 + 4 + 4 + 4 = 18 wrong → 45 %. The third topic: 6 × 5 = 30, 12 wrong → 40 %.
  -- «Индексы» has the highest share (30 of 40) but only 4 members answered: never shown. «Сети»: 29 answers: not yet.
  perform pg_temp.check(pg_temp.topics(r) = 'Базы данных/Транзакции 40 45; Базы данных/Тема 3 30 40',
                        '5 members: the hard topics, a topic of 4 members left out', r);
  perform pg_temp.check((select array_agg(k order by k) from jsonb_object_keys(r) k)
                        = array['hard_topics', 'learned_pct', 'members', 'min_members', 'studied_7d', 'studied_ever', 'studied_prev_7d'],
                        'the answer has these keys and no other', r);
end;
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
select pg_temp.check((public.container_summary(pg_temp.c('c')::uuid) -> 'owner' ->> 'members') = '5',
                     'members is the number container_summary gives its author');
select pg_temp.as_role('postgres');

-- 6. The thirtieth answer of «Сети» and a fifth member in «Индексы»: both show, and the list stops at three.
select pg_temp.answers('m5', 'n3', 1, 0, '25 days'), pg_temp.answers('m5', 't2c', 1, 0, '25 days');
select pg_temp.check(pg_temp.topics(pg_temp.summary())
                     = 'Базы данных/Индексы 41 73; Сети/(весь предмет) 30 67; Базы данных/Транзакции 40 45',
                     'a fifth member and a thirtieth answer bring their topics in; three at most', pg_temp.summary());
select pg_temp.check(pg_temp.summary() -> 'hard_topics' -> 1 -> 'topic' = 'null'::jsonb, 'questions without a topic: topic is null', pg_temp.summary());

-- 7. A sixth member who never answered: only a row the author's «send the mistakes» wrote for them.
select pg_temp.join('m6');
select pg_temp.answers('m6', 'n1', 1, 1, '1 hour', p_source => 'quiz');
-- Learned: 0.8736 / 6 = 0.1456 → 15. «Сети» still has 30 answers: the quiz row is not one.
select pg_temp.check(pg_temp.numbers(pg_temp.summary()) = '6 2 2 5 15', '6 members: the one who never answered counts as a member only', pg_temp.summary());
select pg_temp.check(pg_temp.topics(pg_temp.summary())
                     = 'Базы данных/Индексы 41 73; Сети/(весь предмет) 30 67; Базы данных/Транзакции 40 45',
                     'a row written by the author''s press is not an answer of the member', pg_temp.summary());

-- 8. A seventh member studies and counts; then leaves and counts no more.
select pg_temp.join('m7');
select pg_temp.answers('m7', 'n1', 3, 0, '1 hour');
select pg_temp.learned('m7', i.import_ref) from (select replace(import_ref, 'fx:', '') as import_ref from public.test_items
                                                  where container_id = pg_temp.c('c')::uuid and keyed) i;
-- Learned: (0.8736 + 1) / 7 = 0.2677 → 27. «Сети»: 33 answers, 20 wrong → 61 %.
select pg_temp.check(pg_temp.numbers(pg_temp.summary()) = '7 3 2 6 27', '7 members: the seventh counts', pg_temp.summary());
select pg_temp.check(pg_temp.topics(pg_temp.summary())
                     = 'Базы данных/Индексы 41 73; Сети/(весь предмет) 33 61; Базы данных/Транзакции 40 45',
                     '7 members: their answers are in the topic', pg_temp.summary());
-- 8a. Nothing in the answer says who: no account id (of anyone), no name, no key that could carry one.
do $t$
declare
  r jsonb := pg_temp.summary();
  v_text text := r::text;
  v_hit text;
begin
  select u.id::text into v_hit from auth.users u where position(u.id::text in v_text) > 0 limit 1;
  perform pg_temp.check(v_hit is null, 'no account id in the answer', r);
  perform pg_temp.check(v_text !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', 'no uuid of any kind in the answer', r);
  select p.full_name into v_hit from public.profiles p
   where btrim(coalesce(p.full_name, '')) <> ''
     and (position(p.full_name in v_text) > 0 or position(split_part(p.full_name, ' ', 1) in v_text) > 0) limit 1;
  perform pg_temp.check(v_hit is null, 'no name in the answer', r);
  perform pg_temp.check(v_text !~* 'user|name|email|joined|who', 'no key that could say who', r);
  perform pg_temp.check((select bool_and((select array_agg(k order by k) from jsonb_object_keys(t.x) k)
                                         = array['answers', 'subject', 'topic', 'wrong_pct'])
                           from jsonb_array_elements(r -> 'hard_topics') t(x)),
                        'a hard topic has subject, topic, answers, wrong_pct and no other key', r);
  perform pg_temp.check((select bool_and(jsonb_typeof(e.value) in ('number', 'null', 'array')) from jsonb_each(r) e),
                        'every value is a number, null or the list of topics', r);
end;
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('m7')::uuid);
select public.container_leave(pg_temp.c('c')::uuid);
select pg_temp.as_role('postgres');
select pg_temp.check(pg_temp.numbers(pg_temp.summary()) = '6 2 2 5 15', 'a member who left is not counted', pg_temp.summary());
-- Leaving is the member's own: it starts no pause (the numbers above came at once).
select pg_temp.check(not (pg_temp.summary() ? 'paused_until'), 'a member who left on their own starts no pause', pg_temp.summary());
select pg_temp.check(pg_temp.topics(pg_temp.summary())
                     = 'Базы данных/Индексы 41 73; Сети/(весь предмет) 30 67; Базы данных/Транзакции 40 45',
                     'their answers leave the topics', pg_temp.summary());

-- 9. The pause. An eighth member studies and counts; then the author removes them.
select pg_temp.put('before_m8', pg_temp.summary()::text);
select pg_temp.join('m8');
select pg_temp.answers('m8', 't1a', 4, 4, '1 hour');
select pg_temp.learned('m8', 't1a'), pg_temp.learned('m8', 't1b'), pg_temp.learned('m8', 't1c');
-- Learned: (0.8736 + 3/14) / 7 = 0.1554 → 16.
select pg_temp.check(pg_temp.numbers(pg_temp.summary()) = '7 3 2 6 16', '7 members again: the eighth counts', pg_temp.summary());
select pg_temp.put('with_m8', pg_temp.summary()::text);
-- 9a. «Убрать»: no number at all, only how many are in and the day the numbers come back, 7 days from the removal.
--     Before and after would differ by M8 alone: 3 and 2 this week, 6 and 5 ever.
select pg_temp.remove('m8');
select pg_temp.check(pg_temp.summary() = pg_temp.paused(6, '0 hours'), 'a member removed: no numbers, the day they come back', pg_temp.summary());
select pg_temp.check((pg_temp.summary() ->> 'paused_until') ~ '^\d{4}-\d{2}-\d{2}$', 'paused_until is a day', pg_temp.summary());
-- 9b. «Вернуть»: the numbers are back at once and are what they were. Remove, read, restore shows nothing.
select pg_temp.remove('m8', true);
select pg_temp.check(pg_temp.summary()::text = pg_temp.c('with_m8'), 'the member restored: the same numbers as before the removal', pg_temp.summary());
-- 9c. Removed again, and time passes. 167 hours: still no numbers, the same day as the removal set. 169 hours and 8
--     days: the numbers, without the removed member — exactly those of the group before M8 came in.
select pg_temp.remove('m8');
select pg_temp.removed_ago('m8', '167 hours');
select pg_temp.check(pg_temp.summary() = pg_temp.paused(6, '167 hours'), 'removed 167 hours ago: still paused, until the same day', pg_temp.summary());
-- The day is the Europe/Minsk day of the moment the pause ends: one that ends at 22:30 UTC ends on the next day there
-- (01:30). The removal is put 168 hours before the next 22:30 UTC, so it is always inside the pause.
do $t$
declare
  v_end timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc' + interval '22 hours 30 minutes';
begin
  if v_end <= now() then v_end := v_end + interval '24 hours'; end if;
  update public.container_members set removed_at = v_end - interval '168 hours'
   where container_id = pg_temp.c('c')::uuid and user_id = pg_temp.c('m8')::uuid;
  perform pg_temp.check(pg_temp.summary() ->> 'paused_until' = to_char((v_end at time zone 'utc')::date + 1, 'YYYY-MM-DD'),
                        'the day is counted in Europe/Minsk, not in UTC and not in the session''s zone', pg_temp.summary());
end;
$t$;
select pg_temp.removed_ago('m8', '169 hours');
select pg_temp.check(pg_temp.summary()::text = pg_temp.c('before_m8'), 'removed 169 hours ago: the numbers, the removed member not counted', pg_temp.summary());
select pg_temp.removed_ago('m8', '8 days');
select pg_temp.check(pg_temp.numbers(pg_temp.summary()) = '6 2 2 5 15' and not (pg_temp.summary() ? 'paused_until'),
                     'a removal 8 days ago: no pause, a removed member is not counted', pg_temp.summary());
-- 9d. Two removals: the day is the later one's. M8 three days ago, then M5 now (the fifth member of every topic).
select pg_temp.removed_ago('m8', '72 hours');
select pg_temp.remove('m5');
select pg_temp.check(pg_temp.summary() = pg_temp.paused(5, '0 hours'), 'two removals: paused until 7 days from the later one', pg_temp.summary());
-- M5's removal grows old first: M8's still holds the pause, until its own day.
select pg_temp.removed_ago('m5', '8 days');
select pg_temp.check(pg_temp.summary() = pg_temp.paused(5, '72 hours'), 'the older removal still pauses, until its own day', pg_temp.summary());
select pg_temp.removed_ago('m8', '8 days');
-- M1…M4 and M6 are left: 5 members, 4 of them ever answered. Learned: 0.8736 / 5 → 17. No topic has a fifth member.
select pg_temp.check(pg_temp.numbers(pg_temp.summary()) = '5 2 2 4 17', 'without M5: 5 members, 4 ever', pg_temp.summary());
select pg_temp.check(pg_temp.summary() -> 'hard_topics' = '[]'::jsonb, 'a topic that lost its fifth member is not shown', pg_temp.summary());
select pg_temp.remove('m5', true);
select pg_temp.check(pg_temp.summary()::text = pg_temp.c('before_m8'), 'M5 is back: the numbers of the six', pg_temp.summary());

-- 10. The group falls under five again: the numbers go. Leaving on one's own pauses nothing on the way.
select pg_temp.as_role('authenticated', pg_temp.c('m6')::uuid);
select public.container_leave(pg_temp.c('c')::uuid);
select pg_temp.as_role('postgres');
select pg_temp.check(pg_temp.numbers(pg_temp.summary()) = '5 2 2 5 17' and not (pg_temp.summary() ? 'paused_until'),
                     '5 members after one left on their own: still the numbers, no pause', pg_temp.summary());
-- Under five there is nothing to pause: a removal that leaves 4 gives members and min_members only, and the member
-- restored brings the five's numbers back.
select pg_temp.remove('m5');
select pg_temp.check(pg_temp.summary() = '{"members": 4, "min_members": 5}'::jsonb, '4 members after a removal: no numbers, no day', pg_temp.summary());
select pg_temp.remove('m5', true);
select pg_temp.check(pg_temp.numbers(pg_temp.summary()) = '5 2 2 5 17', 'restored: the five again', pg_temp.summary());
select pg_temp.as_role('authenticated', pg_temp.c('m1')::uuid);
select public.container_leave(pg_temp.c('c')::uuid);
select pg_temp.as_role('postgres');
select pg_temp.check(pg_temp.summary() = '{"members": 4, "min_members": 5}'::jsonb, 'back to 4 members: no numbers', pg_temp.summary());

-- 11. An exam with five members and no question that counts: learned_pct is null, nothing else breaks.
insert into public.containers (id, owner_id, title) values ('9a000000-0000-4000-8000-0000000000c2', pg_temp.c('a')::uuid, 'Без ключей');
insert into public.container_subjects (id, container_id, owner_id, title)
values ('9a000000-0000-4000-8000-0000000000d2', '9a000000-0000-4000-8000-0000000000c2', pg_temp.c('a')::uuid, 'Вопросы');
insert into public.test_items (container_id, subject_id, position, stem, options)
values ('9a000000-0000-4000-8000-0000000000c2', '9a000000-0000-4000-8000-0000000000d2', 1, 'Без ответа', '["да", "нет"]');
insert into public.container_members (container_id, user_id)
select '9a000000-0000-4000-8000-0000000000c2', pg_temp.c('m' || n)::uuid from generate_series(1, 5) n;
select pg_temp.put('c', '9a000000-0000-4000-8000-0000000000c2');
select pg_temp.check(pg_temp.summary() = '{"members": 5, "min_members": 5, "studied_7d": 0, "studied_prev_7d": 0, "studied_ever": 0, "learned_pct": null, "hard_topics": []}'::jsonb,
                     'no question that counts: learned_pct null, zeros, no topics', pg_temp.summary());

select 'GROUP SUMMARY CHECKS PASSED';
rollback;
