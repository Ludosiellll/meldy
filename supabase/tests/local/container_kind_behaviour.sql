-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261019090000_container_kind.sql on a
-- scratch database with the exam container, the Telegram bot's packages and every later migration up to
-- 20261018140000 (supabase/tests/local/container_kind_run.sh builds it).
-- Covered: a new exam is 'exam'; the author writes 'test' (and back) as the site does — a direct update under row
-- security — while a member and a stranger touch no row and another value is refused (23514); the summary and the
-- overview say the kind to the author and to a member; the read of every exam (plan_inputs without an exam) leaves out
-- the author's own test and keeps it for a member, one exam by its id is read for both; the profile's Telegram card
-- (telegram_exams) and the bot's «Экзамены» (bot_exams), bot_today's plan and exam_list leave it out for the author
-- only; bot.remind_on / bot.remind_any: the author's own test is off (an author with only a test is not claimed, the
-- context of a claim made before the switch skips «off»), a member's is on; K3 never comes for the author's own test
-- and comes for the member's; tick_due agrees; «Это экзамен» brings everything back.
-- One transaction, rolled back. A failure raises (FAILED: …); success prints CONTAINER KIND CHECKS PASSED. Roles as
-- PostgREST sets them: authenticated (request.jwt.claim.sub), service_role (request.jwt.claims); postgres for fixtures.
\set ON_ERROR_STOP 1
begin;
-- The site's «today» (current_date) and the bot's (the Minsk link's local day) are one day at any hour of the run.
set local timezone = 'Europe/Minsk';

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
create or replace function pg_temp.at(p_day date, p_time text) returns timestamptz language sql immutable as $fn$
  select (p_day + p_time::time) at time zone 'Europe/Minsk'
$fn$;
-- The ids of a jsonb array of objects (by key), sorted.
create or replace function pg_temp.ids(p_list jsonb, p_key text default 'id') returns text[] language sql immutable as $fn$
  select coalesce(array_agg(x ->> p_key order by x ->> p_key), '{}') from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) x
$fn$;
-- The kind of one exam in an overview.
create or replace function pg_temp.kind_in(p_overview jsonb, p_id text) returns text language sql immutable as $fn$
  select x ->> 'kind' from jsonb_array_elements(p_overview -> 'containers') x where x ->> 'id' = p_id
$fn$;

-- The people: A the author, M a member who joined A's test to train, T a teacher with only a test, S a stranger.
insert into auth.users (id) values
  ('c4d00000-0000-4000-8000-00000000000a'), ('c4d00000-0000-4000-8000-00000000000b'),
  ('c4d00000-0000-4000-8000-00000000000c'), ('c4d00000-0000-4000-8000-00000000000d')
  on conflict do nothing;
select pg_temp.put('a', 'c4d00000-0000-4000-8000-00000000000a'), pg_temp.put('m', 'c4d00000-0000-4000-8000-00000000000b'),
       pg_temp.put('t', 'c4d00000-0000-4000-8000-00000000000c'), pg_temp.put('s', 'c4d00000-0000-4000-8000-00000000000d');

-- 1. A's test, made the «Новый тест» way (one subject «Вопросы», no date, questions by hand), and A's exam with a date.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare
  r jsonb;
begin
  r := public.container_create('Кислоты и основания', null, '[{"title": "Вопросы"}]');
  perform pg_temp.put('test', r ->> 'container_id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid,
    '[{"ref": "man:1", "stem": "Какая кислота сильная?", "options": ["Серная", "Угольная"], "correct": [0]},
      {"ref": "man:2", "stem": "Щёлочь окрашивает фенолфталеин", "options": ["Верно", "Неверно"], "correct": [0]}]');
  r := public.container_create('Осенняя сессия', current_date + 30, '[{"title": "Химия"}]');
  perform pg_temp.put('exam', r ->> 'container_id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid,
    '[{"ref": "imp-x:1", "stem": "Формула воды", "options": ["H2O", "CO2"], "correct": [0]}]');
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('t')::uuid);
do $t$
declare
  r jsonb;
begin
  r := public.container_create('Тест для 9 «Б»', null, '[{"title": "Вопросы"}]');
  perform pg_temp.put('t_test', r ->> 'container_id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid,
    '[{"ref": "man:1", "stem": "Столица Франции", "options": ["Париж", "Лион"], "correct": [0]}]');
end
$t$;
-- M joined A's test (membership, as container_join leaves it).
select pg_temp.as_role('postgres');
insert into public.container_members (container_id, user_id) values (pg_temp.c('test')::uuid, pg_temp.c('m')::uuid);

-- 2. The default: every exam is 'exam', and the reads say so.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare
  r jsonb;
begin
  perform pg_temp.check((select array_agg(distinct c.kind) from public.containers c
                          where c.id in (pg_temp.c('test')::uuid, pg_temp.c('exam')::uuid)) = array['exam'], 'default: exam');
  r := public.container_summary(pg_temp.c('test')::uuid, null);
  perform pg_temp.check(r ->> 'kind' = 'exam', 'summary: kind exam by default', r - 'subjects');
  r := public.containers_overview(null);
  perform pg_temp.check(pg_temp.kind_in(r, pg_temp.c('test')) = 'exam' and pg_temp.kind_in(r, pg_temp.c('exam')) = 'exam',
                        'overview: kind exam by default', r);
  r := public.plan_inputs(null, null);
  perform pg_temp.check(pg_temp.ids(r -> 'containers') @> array[pg_temp.c('test'), pg_temp.c('exam')], 'plan: an exam is planned', r -> 'containers');
end
$t$;

-- 3. The author writes 'test' as the site does (a direct update under row security; the trigger touches updated_at).
do $t$
declare
  n integer;
begin
  with u as (update public.containers set kind = 'test' where id = pg_temp.c('test')::uuid returning id) select count(*) into n from u;
  perform pg_temp.check(n = 1, 'the author writes test');
  perform pg_temp.expect_error(format('update public.containers set kind = %L where id = %L', 'quiz', pg_temp.c('test')),
                               '23514', 'kind: only exam or test');
  perform pg_temp.expect_error(format('update public.containers set kind = null where id = %L', pg_temp.c('test')),
                               '23502', 'kind: never empty');
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('t')::uuid);
do $t$
declare
  n integer;
begin
  with u as (update public.containers set kind = 'test' where id = pg_temp.c('t_test')::uuid returning id) select count(*) into n from u;
  perform pg_temp.check(n = 1, 'the teacher writes test');
end
$t$;
-- A member and a stranger touch no row.
select pg_temp.as_role('authenticated', pg_temp.c('m')::uuid);
do $t$
declare
  n integer;
  r jsonb;
begin
  with u as (update public.containers set kind = 'exam' where id = pg_temp.c('test')::uuid returning id) select count(*) into n from u;
  perform pg_temp.check(n = 0, 'a member cannot write the kind');
  r := public.container_summary(pg_temp.c('test')::uuid, null);
  perform pg_temp.check(r ->> 'kind' = 'test' and r ->> 'role' = 'member', 'summary: the member reads test', r - 'subjects');
  r := public.containers_overview(null);
  perform pg_temp.check(pg_temp.kind_in(r, pg_temp.c('test')) = 'test', 'overview: the member reads test', r);
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('s')::uuid);
do $t$
declare
  n integer;
begin
  with u as (update public.containers set kind = 'exam' where id = pg_temp.c('test')::uuid returning id) select count(*) into n from u;
  perform pg_temp.check(n = 0, 'a stranger cannot write the kind');
end
$t$;
select pg_temp.as_role('postgres');
do $t$
begin
  perform pg_temp.check((select kind from public.containers where id = pg_temp.c('test')::uuid) = 'test', 'still test');
end
$t$;

-- 4. The reads for the author: the kind; the read of every exam leaves the test out, the exam stays; by its id it is read.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare
  r jsonb;
begin
  r := public.container_summary(pg_temp.c('test')::uuid, null);
  perform pg_temp.check(r ->> 'kind' = 'test' and r ->> 'role' = 'owner', 'summary: the author reads test', r - 'subjects');
  perform pg_temp.check(public.container_summary(pg_temp.c('exam')::uuid, null) ->> 'kind' = 'exam', 'summary: the exam stays exam');
  r := public.containers_overview(null);
  perform pg_temp.check(pg_temp.kind_in(r, pg_temp.c('test')) = 'test' and pg_temp.kind_in(r, pg_temp.c('exam')) = 'exam',
                        'overview: both, each with its kind', r);
  r := public.plan_inputs(null, null);
  perform pg_temp.check(pg_temp.ids(r -> 'containers') = array[pg_temp.c('exam')], 'plan of every exam: not the own test', r -> 'containers');
  perform pg_temp.check(jsonb_array_length(r -> 'subjects') = 1 and jsonb_array_length(r -> 'items') = 1,
                        'plan of every exam: the exam''s subject and question only', r - 'containers');
  r := public.plan_inputs(null, pg_temp.c('test')::uuid);
  perform pg_temp.check(pg_temp.ids(r -> 'containers') = array[pg_temp.c('test')] and jsonb_array_length(r -> 'items') = 2,
                        'plan of the test by its id: read as before', r - 'states');
  r := public.telegram_exams();
  perform pg_temp.check(pg_temp.ids(r, 'container_id') = array[pg_temp.c('exam')], 'telegram_exams: not the own test', r);
end
$t$;
-- ... and for the member: everything as before.
select pg_temp.as_role('authenticated', pg_temp.c('m')::uuid);
do $t$
declare
  r jsonb;
begin
  r := public.plan_inputs(null, null);
  perform pg_temp.check(pg_temp.ids(r -> 'containers') = array[pg_temp.c('test')] and jsonb_array_length(r -> 'items') = 2,
                        'member: the test is planned', r - 'states');
  r := public.telegram_exams();
  perform pg_temp.check(pg_temp.ids(r, 'container_id') = array[pg_temp.c('test')] and r -> 0 ->> 'tg_remind' = 'true',
                        'member: telegram_exams has the test', r);
end
$t$;

-- 5. The bot. A is 9401, M 9402, T 9403 (Minsk), linked.
select pg_temp.as_role('postgres');
insert into bot.links (user_id, tg_user_id, chat_id, tz, remind_at, linked_at, last_seen_at) values
  (pg_temp.c('a')::uuid, 9401, 9401, 'Europe/Minsk', '20:00', now() - interval '30 days', now() - interval '30 days'),
  (pg_temp.c('m')::uuid, 9402, 9402, 'Europe/Minsk', '20:00', now() - interval '30 days', now() - interval '30 days'),
  (pg_temp.c('t')::uuid, 9403, 9403, 'Europe/Minsk', '20:00', now() - interval '30 days', now() - interval '30 days');
select pg_temp.as_role('service_role');
do $t$
declare
  r jsonb;
begin
  r := public.bot_today(9401);
  perform pg_temp.check(pg_temp.ids(r -> 'plan' -> 'containers') = array[pg_temp.c('exam')], 'bot_today: the author''s card plans the exam only', r -> 'plan' -> 'containers');
  perform pg_temp.check(pg_temp.ids(r -> 'exam_list', 'container_id') = array[pg_temp.c('exam')], 'bot_today: exam_list without the own test', r -> 'exam_list');
  perform pg_temp.check(pg_temp.kind_in(r -> 'overview', pg_temp.c('test')) = 'test', 'bot_today: the overview names the kind', r -> 'overview');
  r := public.bot_exams(9401);
  perform pg_temp.check(r ->> 'status' = 'ok' and pg_temp.ids(r -> 'exams', 'container_id') = array[pg_temp.c('exam')], 'bot_exams: not the own test', r);
  r := public.bot_today(9402);
  perform pg_temp.check(pg_temp.ids(r -> 'plan' -> 'containers') = array[pg_temp.c('test')]
                        and pg_temp.ids(r -> 'exam_list', 'container_id') = array[pg_temp.c('test')], 'bot_today: the member plans the test', r - 'overview');
  r := public.bot_today(9403);
  perform pg_temp.check(jsonb_array_length(r -> 'plan' -> 'containers') = 0 and jsonb_array_length(r -> 'exam_list') = 0,
                        'bot_today: a teacher with only a test has nothing planned', r - 'overview');
end
$t$;
select pg_temp.as_role('postgres');
do $t$
begin
  perform pg_temp.check(not bot.remind_on(pg_temp.c('a')::uuid, pg_temp.c('test')::uuid), 'remind_on: the own test is off');
  perform pg_temp.check(bot.remind_on(pg_temp.c('a')::uuid, pg_temp.c('exam')::uuid), 'remind_on: the exam is on');
  perform pg_temp.check(bot.remind_on(pg_temp.c('m')::uuid, pg_temp.c('test')::uuid), 'remind_on: the member''s test is on');
  perform pg_temp.check(bot.remind_any(pg_temp.c('a')::uuid), 'remind_any: the author with an exam on');
  perform pg_temp.check(not bot.remind_any(pg_temp.c('t')::uuid), 'remind_any: a teacher with only a test is off');
  perform pg_temp.check(bot.remind_any(pg_temp.c('m')::uuid), 'remind_any: the member');
  perform pg_temp.check(bot.remind_any(pg_temp.c('s')::uuid), 'remind_any: no exam at all, as before');
end
$t$;

-- 6. The reminders on a day 100 days ahead at 20:01 in Minsk: A (the exam) and M are claimed, T is not; A's context plans
--    the exam only. Then A takes the exam out of the plan after a claim: the context skips «off» (only the own test left).
select pg_temp.put('day', ((now() at time zone 'utc')::date + 100)::text);
select pg_temp.as_role('service_role');
do $t$
declare
  d date := pg_temp.c('day')::date;
  chats bigint[] := '{}';
  a_delivery bigint;
  r jsonb;
  row record;
begin
  for row in select * from public.bot_claim_reminders(50, pg_temp.at(d, '20:01')) c where c.chat_id in (9401, 9402, 9403) order by c.chat_id loop
    chats := chats || row.chat_id;
    if row.chat_id = 9401 then a_delivery := row.delivery_id; end if;
  end loop;
  perform pg_temp.check(chats = array[9401::bigint, 9402::bigint], 'claim: the author and the member; not the teacher with only a test', to_jsonb(chats));
  r := public.bot_reminder_context(a_delivery);
  perform pg_temp.check(r ->> 'card' = 'K1' and pg_temp.ids(r -> 'plan' -> 'containers') = array[pg_temp.c('exam')]
                        and pg_temp.ids(r -> 'exam_list', 'container_id') = array[pg_temp.c('exam')], 'context: the author''s card plans the exam only',
                        r - 'overview' - 'link');
  chats := '{}';
  for row in select * from public.bot_claim_reminders(50, pg_temp.at(d + 1, '20:01')) c where c.chat_id = 9401 loop
    chats := chats || row.chat_id;
    a_delivery := row.delivery_id;
  end loop;
  perform pg_temp.check(chats = array[9401::bigint], 'claim: the author again the next day', to_jsonb(chats));
  perform public.bot_exam_remind(9401, pg_temp.c('exam')::uuid, false);
  r := public.bot_reminder_context(a_delivery);
  perform pg_temp.check(r ->> 'card' = 'skip' and r ->> 'reason' = 'off', 'context: the exam off, the own test does not count → skip off', r);
  chats := '{}';
  for row in select * from public.bot_claim_reminders(50, pg_temp.at(d + 2, '20:01')) c where c.chat_id in (9401, 9402, 9403) order by c.chat_id loop
    chats := chats || row.chat_id;
  end loop;
  perform pg_temp.check(chats = array[9402::bigint], 'claim: with the exam off the author is left out, the member stays', to_jsonb(chats));
end
$t$;

-- 7. K3: the test's date passed the day before d + 10 (the author gave it a date). Never for the author; for the member.
select pg_temp.as_role('postgres');
update bot.deliveries set status = 'sent' where chat_id in (9401, 9402, 9403) and status = 'claimed';
update public.containers set exam_date = pg_temp.c('day')::date + 9 where id = pg_temp.c('test')::uuid;
update public.containers set exam_date = pg_temp.c('day')::date + 9 where id = pg_temp.c('t_test')::uuid;
select pg_temp.as_role('service_role');
do $t$
declare
  d date := pg_temp.c('day')::date;
  got text[];
begin
  select coalesce(array_agg(x.chat_id || ':' || x.container_id::text order by x.chat_id), '{}') into got
    from public.bot_claim_after_date(50, pg_temp.at(d + 10, '20:05')) x where x.chat_id in (9401, 9402, 9403);
  perform pg_temp.check(got = array['9402:' || pg_temp.c('test')], 'K3: the member''s, never the authors'' own tests', to_jsonb(got));
end
$t$;
-- tick_due agrees: with the member's test off too nothing is due that day (the cards are out, the K3 rows closed).
select pg_temp.as_role('postgres');
do $t$
declare
  d date := pg_temp.c('day')::date;
begin
  update bot.deliveries set status = 'sent' where chat_id in (9401, 9402, 9403) and status = 'claimed';
  insert into bot.deliveries (kind, chat_id, link_id, local_day, status)
  select 'reminder', l.chat_id, l.id, d + 12, 'sent' from bot.links l where l.tg_user_id in (9401, 9402, 9403);
  update public.containers set exam_date = d + 11 where id in (pg_temp.c('test')::uuid, pg_temp.c('t_test')::uuid);
  perform pg_temp.check(bot.tick_due(pg_temp.at(d + 12, '20:05')), 'tick_due: the member''s K3 is due');
  perform meldy_private.exam_remind_set_for(pg_temp.c('m')::uuid, pg_temp.c('test')::uuid, false);
  perform pg_temp.check(not bot.tick_due(pg_temp.at(d + 12, '20:05')), 'tick_due: nothing for the authors'' own tests');
  perform meldy_private.exam_remind_set_for(pg_temp.c('m')::uuid, pg_temp.c('test')::uuid, true);
  perform meldy_private.exam_remind_set_for(pg_temp.c('a')::uuid, pg_temp.c('exam')::uuid, true);
end
$t$;

-- 8. «Это экзамен»: the author switches it back, and the test is planned again everywhere.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare
  n integer;
  r jsonb;
begin
  with u as (update public.containers set kind = 'exam' where id = pg_temp.c('test')::uuid returning id) select count(*) into n from u;
  perform pg_temp.check(n = 1, 'the author writes exam');
  r := public.plan_inputs(null, null);
  perform pg_temp.check(pg_temp.ids(r -> 'containers') @> array[pg_temp.c('test'), pg_temp.c('exam')], 'plan: the test is studied again', r -> 'containers');
  perform pg_temp.check(public.container_summary(pg_temp.c('test')::uuid, null) ->> 'kind' = 'exam', 'summary: exam again');
  perform pg_temp.check(pg_temp.ids(public.telegram_exams(), 'container_id') @> array[pg_temp.c('test')], 'telegram_exams: the exam again');
end
$t$;
select pg_temp.as_role('postgres');
do $t$
begin
  perform pg_temp.check(bot.remind_on(pg_temp.c('a')::uuid, pg_temp.c('test')::uuid), 'remind_on: on again');
end
$t$;

select pg_temp.as_role('postgres');
select 'CONTAINER KIND CHECKS PASSED';
rollback;
