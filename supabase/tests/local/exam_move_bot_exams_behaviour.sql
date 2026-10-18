-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261018120000_exam_move_bot_exams.sql
-- on a scratch database with the exam container, the Telegram bot's packages and every later migration
-- (supabase/tests/local/exam_move_bot_exams_run.sh builds it).
-- Covered: the defaults (no own date, the plan in Telegram on); a member's own date overrides every subject's date for
-- them only (plan_inputs, container_summary with own_exam_date and author_exam_date, containers_overview, bot_today,
-- bot_whoami, bot_oral_inputs) while the author and another member keep theirs; clearing it; exam_date_move — 'all' by
-- the author (a subject and its oral exam; the exam with its passed subjects and passed oral dates, today included,
-- future subject dates kept), a member for everyone (42501), past, too far, null for everyone, a bad «for» (22023), a
-- stranger and a foreign subject (P0002), 730 days ahead accepted; exam_remind_set and telegram_exams (states, dates,
-- order, the switch, a stranger); the bot's bot_exams, bot_exam_remind and bot_exam_move (statuses, the user seen);
-- the reminders' claim leaves out a user whose exams are all off and the context skips «off» when they turn it off
-- after the claim; the context and bot_today hand over exam_list; K3 never for an exam that is off, by the own date, and
-- again after a move (once per date).
-- One transaction, rolled back. A failure raises (FAILED: …); success prints EXAM MOVE BOT EXAMS CHECKS PASSED. Roles
-- as PostgREST sets them: authenticated (request.jwt.claim.sub), service_role (request.jwt.claims); postgres for
-- fixtures.
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
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_what text, p_message text default null)
returns void language plpgsql as $fn$
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_state;
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if sqlstate <> p_state or (p_message is not null and sqlerrm <> p_message) then
      raise exception 'FAILED: % — SQLSTATE % (%), expected % %', p_what, sqlstate, sqlerrm, p_state, coalesce(p_message, '');
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
-- Each subject's date in a jsonb array of {id, exam_date} / {id, test_date}, by subject id.
create or replace function pg_temp.dates(p_list jsonb, p_key text) returns jsonb language sql immutable as $fn$
  select coalesce(jsonb_object_agg(x ->> 'id', x -> p_key), '{}'::jsonb) from jsonb_array_elements(p_list) x
$fn$;
create or replace function pg_temp.today() returns date language sql stable as $fn$ select current_date $fn$;

-- The people: A the author, M and N members, S a stranger.
insert into auth.users (id) values
  ('e7e70000-0000-4000-8000-00000000000a'), ('e7e70000-0000-4000-8000-00000000000b'),
  ('e7e70000-0000-4000-8000-00000000000c'), ('e7e70000-0000-4000-8000-00000000000d')
  on conflict do nothing;
select pg_temp.put('a', 'e7e70000-0000-4000-8000-00000000000a'), pg_temp.put('m', 'e7e70000-0000-4000-8000-00000000000b'),
       pg_temp.put('n', 'e7e70000-0000-4000-8000-00000000000c'), pg_temp.put('s', 'e7e70000-0000-4000-8000-00000000000d');
-- The author's oral exams: «Базы» (a date ahead) and «ОС» (a date that passed yesterday).
insert into public.exams (id, user_id, title, exam_date) values
  ('e7e70000-0000-4000-8000-0000000000e1', 'e7e70000-0000-4000-8000-00000000000a', 'Базы устно', current_date + 20),
  ('e7e70000-0000-4000-8000-0000000000e2', 'e7e70000-0000-4000-8000-00000000000a', 'ОС устно', current_date - 1);

-- 1. The author's exams. «Осенняя сессия» (in 10 days): «Сети» passed 2 days ago, «Базы» in 20 days with an oral exam,
--    «ОС» with no date of its own and an oral exam whose date passed, «Матан» today.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare
  r jsonb;
  d date := current_date;
begin
  r := public.container_create('Осенняя сессия', d + 10, jsonb_build_array(
         jsonb_build_object('title', 'Сети', 'exam_date', d - 2),
         jsonb_build_object('title', 'Базы', 'exam_date', d + 20, 'exam_id', 'e7e70000-0000-4000-8000-0000000000e1'),
         jsonb_build_object('title', 'ОС', 'exam_id', 'e7e70000-0000-4000-8000-0000000000e2'),
         jsonb_build_object('title', 'Матан', 'exam_date', d)));
  perform pg_temp.put('c', r ->> 'container_id');
  perform pg_temp.put('s_net', r -> 'subjects' -> 0 ->> 'id');
  perform pg_temp.put('s_db', r -> 'subjects' -> 1 ->> 'id');
  perform pg_temp.put('s_os', r -> 'subjects' -> 2 ->> 'id');
  perform pg_temp.put('s_math', r -> 'subjects' -> 3 ->> 'id');
  r := public.container_create('Зимняя сессия', d + 40, '[{"title": "История"}]');
  perform pg_temp.put('c_winter', r ->> 'container_id');
  r := public.container_create('Летняя сессия', d - 3, '[{"title": "Физика"}]');
  perform pg_temp.put('c_summer', r ->> 'container_id');
  r := public.container_create('Без даты', null, '[{"title": "Химия"}]');
  perform pg_temp.put('c_nodate', r ->> 'container_id');
  r := public.container_create('Зачёт сегодня', d, '[{"title": "Право"}]');
  perform pg_temp.put('c_today', r ->> 'container_id');
end
$t$;
-- M and N join «Осенняя сессия» (membership, as container_join leaves it).
select pg_temp.as_role('postgres');
insert into public.container_members (container_id, user_id) values
  (pg_temp.c('c')::uuid, pg_temp.c('m')::uuid), (pg_temp.c('c')::uuid, pg_temp.c('n')::uuid);

-- 2. The defaults: no own date, the plan in Telegram on; the summary names both dates.
select pg_temp.as_role('authenticated', pg_temp.c('m')::uuid);
do $t$
declare
  r jsonb;
  c uuid := pg_temp.c('c')::uuid;
  d date := current_date;
begin
  r := public.container_summary(c, null);
  perform pg_temp.check(r ? 'own_exam_date' and r -> 'own_exam_date' = 'null'::jsonb, 'summary: own_exam_date null by default', r - 'subjects');
  perform pg_temp.check((r ->> 'author_exam_date')::date = d + 10 and (r ->> 'exam_date')::date = d + 10, 'summary: the author''s date', r - 'subjects');
  perform pg_temp.check(pg_temp.dates(r -> 'subjects', 'exam_date') = jsonb_build_object(
    pg_temp.c('s_net'), d - 2, pg_temp.c('s_db'), d + 20, pg_temp.c('s_os'), d + 10, pg_temp.c('s_math'), d), 'summary: subject dates', r -> 'subjects');
  perform pg_temp.check(public.telegram_exams() -> 0 ->> 'tg_remind' = 'true', 'telegram_exams: on by default', public.telegram_exams());
end
$t$;

-- 3. M's own date: every subject of the exam for M only.
do $t$
declare
  r jsonb;
  c uuid := pg_temp.c('c')::uuid;
  d date := current_date;
  own jsonb;
begin
  r := public.exam_date_move(c, d + 30, 'me');
  perform pg_temp.check(r ?& array['for', 'container_id', 'exam_date', 'own_exam_date', 'subjects']
                        and (select count(*) from jsonb_object_keys(r)) = 5, 'exam_date_move: the keys', r);
  perform pg_temp.check(r ->> 'for' = 'me' and (r ->> 'container_id')::uuid = c and (r ->> 'exam_date')::date = d + 10
                        and (r ->> 'own_exam_date')::date = d + 30, 'me: the answer', r);
  perform pg_temp.check((select bool_and((x ->> 'exam_date')::date = d + 30) and count(*) = 4 from jsonb_array_elements(r -> 'subjects') x),
                        'me: every subject of the answer', r -> 'subjects');
  perform pg_temp.check(r ->> 'own_exam_date' ~ '^\d{4}-\d{2}-\d{2}$', 'dates as YYYY-MM-DD', r);
  own := to_jsonb(d + 30);
  r := public.plan_inputs(null, c);
  perform pg_temp.check(r -> 'containers' -> 0 -> 'exam_date' = own, 'M plan_inputs: the exam', r -> 'containers');
  perform pg_temp.check((select bool_and(x -> 'test_date' = own) and count(*) = 4 from jsonb_array_elements(r -> 'subjects') x),
                        'M plan_inputs: every subject', r -> 'subjects');
  r := public.container_summary(c, null);
  perform pg_temp.check(r -> 'exam_date' = own and r -> 'own_exam_date' = own and (r ->> 'author_exam_date')::date = d + 10,
                        'M summary: own date over the author''s', r - 'subjects');
  perform pg_temp.check((select bool_and(x -> 'exam_date' = own) from jsonb_array_elements(r -> 'subjects') x), 'M summary: subjects', r -> 'subjects');
  r := (select x from jsonb_array_elements(public.containers_overview(null) -> 'containers') x where x ->> 'id' = c::text);
  perform pg_temp.check(r -> 'exam_date' = own and r -> 'own_exam_date' = own and (r ->> 'author_exam_date')::date = d + 10
                        and (select bool_and(s -> 'exam_date' = own) from jsonb_array_elements(r -> 'subjects') s), 'M overview', r);
  perform pg_temp.check((select (p.minutes_per_day, p.study_weekdays, p.tempo, p.tg_remind) = (60::smallint, 127::smallint, 'date', true)
                           from public.container_plans p where p.user_id = pg_temp.c('m')::uuid and p.container_id = c),
                        'M''s row written with the defaults');
end
$t$;
-- The author and N keep their dates.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare
  r jsonb;
  c uuid := pg_temp.c('c')::uuid;
  d date := current_date;
begin
  r := public.plan_inputs(null, c);
  perform pg_temp.check((r -> 'containers' -> 0 ->> 'exam_date')::date = d + 10, 'A plan_inputs: the exam unchanged', r -> 'containers');
  perform pg_temp.check(pg_temp.dates(r -> 'subjects', 'test_date') = jsonb_build_object(
    pg_temp.c('s_net'), d - 2, pg_temp.c('s_db'), d + 20, pg_temp.c('s_os'), d + 10, pg_temp.c('s_math'), d), 'A plan_inputs: subjects unchanged', r -> 'subjects');
  r := public.container_summary(c, null);
  perform pg_temp.check(r -> 'own_exam_date' = 'null'::jsonb and (r ->> 'exam_date')::date = d + 10, 'A summary unchanged', r - 'subjects');
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('n')::uuid);
do $t$
declare
  r jsonb;
  d date := current_date;
begin
  r := public.plan_inputs(null, pg_temp.c('c')::uuid);
  perform pg_temp.check(pg_temp.dates(r -> 'subjects', 'test_date') = jsonb_build_object(
    pg_temp.c('s_net'), d - 2, pg_temp.c('s_db'), d + 20, pg_temp.c('s_os'), d + 10, pg_temp.c('s_math'), d), 'N plan_inputs unchanged', r -> 'subjects');
end
$t$;

-- 4. The rules: a member never for everyone; past, too far, null for everyone, a bad «for»; a stranger, a foreign subject.
select pg_temp.as_role('authenticated', pg_temp.c('m')::uuid);
select pg_temp.expect_error(format('select public.exam_date_move(%L, current_date + 5, ''all'')', pg_temp.c('c')), '42501', 'a member for everyone');
select pg_temp.expect_error(format('select public.exam_date_move(%L, current_date - 1, ''me'')', pg_temp.c('c')), '22023', 'a past date', 'date');
select pg_temp.expect_error(format('select public.exam_date_move(%L, current_date + 731, ''me'')', pg_temp.c('c')), '22023', 'more than 730 days', 'date');
select pg_temp.expect_error(format('select public.exam_date_move(%L, null, ''all'')', pg_temp.c('c')), '22023', 'null for everyone', 'date');
select pg_temp.expect_error(format('select public.exam_date_move(%L, current_date + 5, ''everyone'')', pg_temp.c('c')), '22023', 'a bad «for»', 'for');
select pg_temp.expect_error(format('select public.exam_date_move(%L, current_date + 5, ''me'', %L)', pg_temp.c('c'), pg_temp.c('c_winter')),
                            'P0002', 'a subject of another exam');
do $t$
declare
  r jsonb;
begin
  r := public.exam_date_move(pg_temp.c('c')::uuid, current_date + 730, 'me');
  perform pg_temp.check((r ->> 'own_exam_date')::date = current_date + 730, '730 days ahead is fine', r);
  -- Clearing: back to the author's dates.
  r := public.exam_date_move(pg_temp.c('c')::uuid, null, 'me');
  perform pg_temp.check(r -> 'own_exam_date' = 'null'::jsonb, 'cleared', r);
  r := public.container_summary(pg_temp.c('c')::uuid, null);
  perform pg_temp.check(r -> 'own_exam_date' = 'null'::jsonb and (r ->> 'exam_date')::date = current_date + 10, 'cleared: the author''s date', r - 'subjects');
  -- Today is a date too (the exam day).
  r := public.exam_date_move(pg_temp.c('c')::uuid, current_date, 'me');
  perform pg_temp.check((r ->> 'own_exam_date')::date = current_date, 'today accepted', r);
  -- M's own date for the rest of the test.
  r := public.exam_date_move(pg_temp.c('c')::uuid, current_date + 30, 'me');
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('s')::uuid);
select pg_temp.expect_error(format('select public.exam_date_move(%L, current_date + 5, ''me'')', pg_temp.c('c')), 'P0002', 'a stranger moves nothing');
select pg_temp.expect_error(format('select public.exam_remind_set(%L, false)', pg_temp.c('c')), 'P0002', 'a stranger switches nothing');
select pg_temp.as_role('anon');
select pg_temp.expect_error('select public.telegram_exams()', '42501', 'anon: telegram_exams');
select pg_temp.expect_error(format('select public.exam_date_move(%L, current_date + 5, ''me'')', pg_temp.c('c')), '42501', 'anon: exam_date_move');

-- 5. The author moves for everyone: one subject (and its oral exam), then the whole exam.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare
  r jsonb;
  c uuid := pg_temp.c('c')::uuid;
  d date := current_date;
begin
  r := public.exam_date_move(c, d + 5, 'all', pg_temp.c('s_db')::uuid);
  perform pg_temp.check(r ->> 'for' = 'all' and (r ->> 'exam_date')::date = d + 10, 'a subject: the exam''s date stays', r);
  perform pg_temp.check(pg_temp.dates(r -> 'subjects', 'exam_date') = jsonb_build_object(
    pg_temp.c('s_net'), d - 2, pg_temp.c('s_db'), d + 5, pg_temp.c('s_os'), d + 10, pg_temp.c('s_math'), d), 'a subject: only it moves', r -> 'subjects');
  perform pg_temp.check((select e.exam_date from public.exams e where e.id = 'e7e70000-0000-4000-8000-0000000000e1') = d + 5,
                        'a subject: its oral exam moves with it');
  r := public.exam_date_move(c, d + 14, 'all');
  perform pg_temp.check((r ->> 'exam_date')::date = d + 14 and r -> 'own_exam_date' = 'null'::jsonb, 'the exam: its date', r);
  -- «Сети» (passed) and «Матан» (today) move; «Базы» (ahead) stays; «ОС» follows the exam.
  perform pg_temp.check(pg_temp.dates(r -> 'subjects', 'exam_date') = jsonb_build_object(
    pg_temp.c('s_net'), d + 14, pg_temp.c('s_db'), d + 5, pg_temp.c('s_os'), d + 14, pg_temp.c('s_math'), d + 14), 'the exam: passed subjects move', r -> 'subjects');
  perform pg_temp.check((select s.exam_date from public.container_subjects s where s.id = pg_temp.c('s_os')::uuid) is null,
                        'a subject that follows the exam keeps no date of its own');
  perform pg_temp.check((select e.exam_date from public.exams e where e.id = 'e7e70000-0000-4000-8000-0000000000e2') = d + 14,
                        'the oral exam of a subject that follows the exam, passed: moved');
  perform pg_temp.check((select e.exam_date from public.exams e where e.id = 'e7e70000-0000-4000-8000-0000000000e1') = d + 5,
                        'the oral exam of a subject still ahead: kept');
end
$t$;
-- M's own date still wins for M; N sees the author's new dates.
select pg_temp.as_role('authenticated', pg_temp.c('m')::uuid);
do $t$
declare
  r jsonb := public.container_summary(pg_temp.c('c')::uuid, null);
begin
  perform pg_temp.check((r ->> 'exam_date')::date = current_date + 30 and (r ->> 'author_exam_date')::date = current_date + 14,
                        'M keeps the own date after the author''s move', r - 'subjects');
  perform pg_temp.check((select bool_and((x ->> 'exam_date')::date = current_date + 30) from jsonb_array_elements(r -> 'subjects') x), 'M: subjects', r -> 'subjects');
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('n')::uuid);
do $t$
declare
  r jsonb := public.container_summary(pg_temp.c('c')::uuid, null);
  d date := current_date;
begin
  perform pg_temp.check((r ->> 'exam_date')::date = d + 14 and r -> 'own_exam_date' = 'null'::jsonb, 'N sees the author''s move', r - 'subjects');
  perform pg_temp.check(pg_temp.dates(r -> 'subjects', 'exam_date') = jsonb_build_object(
    pg_temp.c('s_net'), d + 14, pg_temp.c('s_db'), d + 5, pg_temp.c('s_os'), d + 14, pg_temp.c('s_math'), d + 14), 'N: subjects', r -> 'subjects');
end
$t$;

-- 6. The plan in Telegram per exam: exam_remind_set and telegram_exams (states, dates, order).
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare
  r jsonb;
  d date := current_date;
begin
  r := public.exam_remind_set(pg_temp.c('c_winter')::uuid, false);
  perform pg_temp.check(r = jsonb_build_object('container_id', pg_temp.c('c_winter'), 'tg_remind', false), 'exam_remind_set: the answer', r);
  perform pg_temp.expect_error(format('select public.exam_remind_set(%L, null)', pg_temp.c('c')), '22023', 'p_on null');
  r := public.telegram_exams();
  -- a date ahead or today first, by it («Осенняя сессия»: its nearest, «Базы» in 5 days), then no date, then passed
  perform pg_temp.check((select array_agg(x ->> 'container_id' order by o) from jsonb_array_elements(r) with ordinality t(x, o))
                        = array[pg_temp.c('c_today'), pg_temp.c('c'), pg_temp.c('c_winter'), pg_temp.c('c_nodate'), pg_temp.c('c_summer')],
                        'telegram_exams: nearest first', r);
  perform pg_temp.check((select array_agg(x ->> 'state' order by o) from jsonb_array_elements(r) with ordinality t(x, o))
                        = array['exam_today', 'study', 'study', 'no_date', 'after'], 'telegram_exams: states', r);
  perform pg_temp.check((select array_agg(x ->> 'exam_date' order by o) from jsonb_array_elements(r) with ordinality t(x, o))
                        = array[d::text, (d + 5)::text, (d + 40)::text, null, (d - 3)::text], 'telegram_exams: dates', r);
  perform pg_temp.check((select array_agg((x ->> 'tg_remind')::boolean order by o) from jsonb_array_elements(r) with ordinality t(x, o))
                        = array[true, true, false, true, true], 'telegram_exams: the switch', r);
  perform pg_temp.check(r -> 1 ->> 'role' = 'owner' and (r -> 1 ->> 'members')::integer = 2 and r -> 1 ->> 'title' = 'Осенняя сессия',
                        'telegram_exams: role and members', r -> 1);
  perform pg_temp.check((select bool_and(x ?& array['container_id', 'title', 'exam_date', 'state', 'tg_remind']) from jsonb_array_elements(r) x),
                        'telegram_exams: the keys', r);
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('m')::uuid);
do $t$
declare
  r jsonb := public.telegram_exams();
begin
  perform pg_temp.check(jsonb_array_length(r) = 1 and r -> 0 ->> 'role' = 'member' and r -> 0 -> 'members' = 'null'::jsonb
                        and (r -> 0 ->> 'exam_date')::date = current_date + 30, 'telegram_exams: the member''s own date', r);
end
$t$;

-- 7. The bot. A is 9101, M 9102 (Minsk), both linked.
select pg_temp.as_role('postgres');
insert into bot.links (user_id, tg_user_id, chat_id, tz, remind_at, linked_at, last_seen_at) values
  (pg_temp.c('a')::uuid, 9101, 9101, 'Europe/Minsk', '20:00', now() - interval '30 days', now() - interval '30 days'),
  (pg_temp.c('m')::uuid, 9102, 9102, 'Europe/Minsk', '20:00', now() - interval '30 days', now() - interval '30 days');
select pg_temp.as_role('service_role');
do $t$
declare
  r jsonb;
  c uuid := pg_temp.c('c')::uuid;
  v_day date := (now() at time zone 'Europe/Minsk')::date;
begin
  r := public.bot_exams(9102);
  perform pg_temp.check(r ->> 'status' = 'ok' and (r ->> 'local_day')::date = v_day and jsonb_array_length(r -> 'exams') = 1
                        and r -> 'exams' -> 0 ->> 'container_id' = c::text, 'bot_exams', r);
  perform pg_temp.check(public.bot_exams(424242) = '{"status": "unlinked"}'::jsonb, 'bot_exams: unlinked');
  r := public.bot_exam_remind(9102, c, false);
  perform pg_temp.check(r ->> 'status' = 'ok' and r ->> 'tg_remind' = 'false' and r -> 'exams' -> 0 ->> 'tg_remind' = 'false', 'bot_exam_remind off', r);
  perform pg_temp.check(public.bot_exam_remind(9102, pg_temp.c('c_winter')::uuid, true) = '{"status": "gone"}'::jsonb, 'bot_exam_remind: not M''s exam');
  perform pg_temp.check(public.bot_exam_remind(9102, c, null) = '{"status": "invalid"}'::jsonb, 'bot_exam_remind: null');
  perform pg_temp.check(public.bot_exam_remind(424242, c, true) = '{"status": "unlinked"}'::jsonb, 'bot_exam_remind: unlinked');
  -- moves
  perform pg_temp.check(public.bot_exam_move(9102, c, v_day + 7, 'all') = '{"status": "forbidden"}'::jsonb, 'bot: a member for everyone');
  r := public.bot_exam_move(9102, c, v_day + 7, 'me');
  perform pg_temp.check(r ->> 'status' = 'ok' and r ->> 'title' = 'Осенняя сессия' and (r ->> 'own_exam_date')::date = v_day + 7
                        and r ->> 'for' = 'me', 'bot: a member for themselves', r);
  perform pg_temp.check(public.bot_exam_move(9101, c, v_day - 1, 'all') = '{"status": "invalid", "reason": "past"}'::jsonb, 'bot: past');
  perform pg_temp.check(public.bot_exam_move(9101, c, v_day + 731, 'all') = '{"status": "invalid", "reason": "far"}'::jsonb, 'bot: far');
  perform pg_temp.check(public.bot_exam_move(9101, c, null, 'all') = '{"status": "invalid", "reason": "date"}'::jsonb, 'bot: null for everyone');
  perform pg_temp.check(public.bot_exam_move(9101, c, v_day + 7, 'x') = '{"status": "invalid", "reason": "for"}'::jsonb, 'bot: a bad «for»');
  perform pg_temp.check(public.bot_exam_move(9102, pg_temp.c('c_winter')::uuid, v_day + 7, 'me') = '{"status": "gone"}'::jsonb, 'bot: not M''s exam');
  perform pg_temp.check(public.bot_exam_move(424242, c, v_day + 7, 'me') = '{"status": "unlinked"}'::jsonb, 'bot: unlinked');
  r := public.bot_exam_move(9101, c, v_day + 21, 'all');
  perform pg_temp.check(r ->> 'status' = 'ok' and (r ->> 'exam_date')::date = v_day + 21, 'bot: the author for everyone', r);
  -- M's exams through the bot's reads: the own date, the switch
  r := public.bot_whoami(9102) -> 'exams' -> 0;
  perform pg_temp.check((r ->> 'exam_date')::date = v_day + 7 and (r ->> 'last_date')::date = v_day + 7 and r ->> 'tg_remind' = 'false',
                        'bot_whoami: the own date and the switch', r);
  r := public.bot_today(9102);
  perform pg_temp.check((r -> 'plan' -> 'containers' -> 0 ->> 'exam_date')::date = v_day + 7
                        and (select bool_and((x ->> 'test_date')::date = v_day + 7) from jsonb_array_elements(r -> 'plan' -> 'subjects') x),
                        'bot_today: M''s plan by the own date', r -> 'plan' -> 'subjects');
  perform pg_temp.check(r -> 'exam_list' -> 0 ->> 'tg_remind' = 'false' and r -> 'exam_list' -> 0 ->> 'state' = 'study', 'bot_today: exam_list', r -> 'exam_list');
end
$t$;
-- The bot's three mark the user as seen (an action in the bot), as bot_whoami does.
select pg_temp.as_role('postgres');
do $t$
begin
  perform pg_temp.check((select l.last_seen_at = now() from bot.links l where l.tg_user_id = 9102), 'bot: M seen');
end
$t$;
-- The oral parts the bot plans take the own date too (the author's own date here; then cleared).
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
select public.exam_date_move(pg_temp.c('c')::uuid, current_date + 9, 'me') is not null;
select pg_temp.as_role('service_role');
do $t$
declare
  r jsonb := public.bot_oral_inputs(9101);
begin
  perform pg_temp.check(jsonb_array_length(r -> 'parts') = 2
                        and (select bool_and((x ->> 'exam_date')::date = current_date + 9) from jsonb_array_elements(r -> 'parts') x),
                        'bot_oral_inputs: the own date', r);
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
select public.exam_date_move(pg_temp.c('c')::uuid, null, 'me') is not null;
select pg_temp.as_role('service_role');
do $t$
declare
  r jsonb := public.bot_oral_inputs(9101);
begin
  perform pg_temp.check((select array_agg((x ->> 'exam_date')::date order by x ->> 'exam_id') from jsonb_array_elements(r -> 'parts') x)
                        = array[current_date + 5, current_date + 14], 'bot_oral_inputs: the oral exams'' own dates again', r);
end
$t$;

-- 8. The reminders: on a day 100 days ahead at 20:01 in Minsk. M's only exam is off: M is not claimed; A is.
select pg_temp.as_role('postgres');
select pg_temp.put('day', ((now() at time zone 'utc')::date + 100)::text);
select pg_temp.as_role('service_role');
do $t$
declare
  d date := pg_temp.c('day')::date;
  chats bigint[] := '{}';
  x bigint;
  r jsonb;
  row record;
begin
  for row in select * from public.bot_claim_reminders(50, pg_temp.at(d, '20:01')) c where c.chat_id in (9101, 9102) order by c.chat_id loop
    chats := chats || row.chat_id;
    x := row.delivery_id;
  end loop;
  perform pg_temp.check(chats = array[9101::bigint], 'claim: a user whose exams are all off is left out', to_jsonb(chats));
  r := public.bot_reminder_context(x);
  perform pg_temp.check(r ->> 'card' = 'K1' and jsonb_array_length(r -> 'exam_list') = 5, 'context: K1 with exam_list', r - 'plan' - 'overview');
  perform pg_temp.check((select array_agg((e ->> 'tg_remind')::boolean order by e ->> 'container_id') from jsonb_array_elements(r -> 'exam_list') e)
                        = (select array_agg(p.flag order by p.id) from (values (pg_temp.c('c'), true), (pg_temp.c('c_winter'), false),
                             (pg_temp.c('c_summer'), true), (pg_temp.c('c_nodate'), true), (pg_temp.c('c_today'), true)) p(id, flag)),
                        'context: the switches', r -> 'exam_list');
  -- M on again, claimed the next day; then every exam off before the context: skip «off»
  perform public.bot_exam_remind(9102, pg_temp.c('c')::uuid, true);
  chats := '{}';
  for row in select * from public.bot_claim_reminders(50, pg_temp.at(d + 1, '20:01')) c where c.chat_id in (9101, 9102) order by c.chat_id loop
    chats := chats || row.chat_id;
    if row.chat_id = 9102 then x := row.delivery_id; end if;
  end loop;
  perform pg_temp.check(chats = array[9101::bigint, 9102::bigint], 'claim: on again', to_jsonb(chats));
  perform public.bot_exam_remind(9102, pg_temp.c('c')::uuid, false);
  r := public.bot_reminder_context(x);
  perform pg_temp.check(r ->> 'card' = 'skip' and r ->> 'reason' = 'off', 'context: every exam off → skip off', r);
  perform pg_temp.put('m_delivery', x::text);
end
$t$;
-- Schema bot is the migration role's: its rows and helpers are read as postgres.
select pg_temp.as_role('postgres');
do $t$
begin
  perform pg_temp.check((select error from bot.deliveries where id = pg_temp.c('m_delivery')::bigint) = 'off', 'the row closed as off');
  -- no exam at all: claimed as before (the card says there is no exam)
  perform pg_temp.check(bot.remind_any(pg_temp.c('s')::uuid), 'no exam: claimed as before');
  perform pg_temp.check(not bot.remind_any(pg_temp.c('m')::uuid) and bot.remind_any(pg_temp.c('a')::uuid), 'remind_any');
end
$t$;

-- 9. K3: by the own date, never for an exam that is off, once per exam and date (again after a move).
select pg_temp.as_role('postgres');
do $t$
declare
  d date := pg_temp.c('day')::date;
begin
  -- A: «Зимняя сессия» (off) and «Летняя сессия» (on) both passed the day before d + 10; M: the own date d + 8.
  update public.containers set exam_date = d + 9 where id in (pg_temp.c('c_winter')::uuid, pg_temp.c('c_summer')::uuid);
  update public.container_plans set own_exam_date = d + 8, tg_remind = true
   where user_id = pg_temp.c('m')::uuid and container_id = pg_temp.c('c')::uuid;
end
$t$;
select pg_temp.as_role('service_role');
do $t$
declare
  d date := pg_temp.c('day')::date;
  got text[] := '{}';
  m_exam jsonb;
  a_exam jsonb;
  row record;
  n integer;
begin
  for row in select * from public.bot_claim_after_date(50, pg_temp.at(d + 10, '20:05')) x where x.chat_id in (9101, 9102)
             order by x.chat_id, x.container_id loop
    got := got || (row.chat_id || ':' || row.container_id::text);
    if row.chat_id = 9102 then m_exam := row.exam; else a_exam := row.exam; end if;
  end loop;
  perform pg_temp.check(got = array['9101:' || pg_temp.c('c_summer'), '9102:' || pg_temp.c('c')],
                        'K3: the exam that is on (A), and by M''s own date (M); not the one that is off', to_jsonb(got));
  perform pg_temp.check(m_exam ->> 'role' = 'member' and (m_exam ->> 'exam_date')::date = d + 8 and (m_exam ->> 'last_date')::date = d + 8
                        and (m_exam ->> 'own_exam_date')::date = d + 8 and (m_exam ->> 'members')::integer = 0, 'K3: the member''s exam', m_exam);
  perform pg_temp.check(a_exam ->> 'role' = 'owner' and (a_exam ->> 'last_date')::date = d + 9 and (a_exam ->> 'members')::integer = 0
                        and a_exam -> 'own_exam_date' = 'null'::jsonb, 'K3: the author''s exam', a_exam);
  select count(*) into n from public.bot_claim_after_date(50, pg_temp.at(d + 11, '20:05')) x where x.chat_id in (9101, 9102);
  perform pg_temp.check(n = 0, 'K3: once');
end
$t$;
select pg_temp.as_role('postgres');
do $t$
begin
  perform pg_temp.check((bot.after_date_json(pg_temp.c('a')::uuid, pg_temp.c('c')::uuid, pg_temp.c('day')::date) ->> 'members')::integer = 2,
                        'K3: the author''s active members');
end
$t$;
select pg_temp.as_role('postgres');
update public.containers set exam_date = pg_temp.c('day')::date + 20 where id = pg_temp.c('c_summer')::uuid;
select pg_temp.as_role('service_role');
do $t$
declare
  d date := pg_temp.c('day')::date;
  got text[];
begin
  select array_agg(x.chat_id || ':' || x.container_id::text) into got
    from public.bot_claim_after_date(50, pg_temp.at(d + 21, '20:05')) x where x.chat_id = 9101;
  perform pg_temp.check(got = array['9101:' || pg_temp.c('c_summer')], 'K3 again after a move, for the new date', to_jsonb(got));
  select array_agg(x.chat_id || ':' || x.container_id::text) into got
    from public.bot_claim_after_date(50, pg_temp.at(d + 22, '20:05')) x where x.chat_id = 9101;
  perform pg_temp.check(got is null, 'and once for it', to_jsonb(got));
end
$t$;
-- tick_due's K3 test agrees with the claim: due on the day after the new date while the exam is on, not once it is off.
-- (The day cards of that day are already out and the K3 rows closed, so only K3 can make the minute due.)
select pg_temp.as_role('postgres');
do $t$
declare
  d date := pg_temp.c('day')::date;
begin
  update bot.deliveries set status = 'sent' where chat_id in (9101, 9102) and status = 'claimed';
  insert into bot.deliveries (kind, chat_id, link_id, local_day, status)
  select 'reminder', l.chat_id, l.id, d + 31, 'sent' from bot.links l where l.tg_user_id in (9101, 9102);
  update public.containers set exam_date = d + 30 where id = pg_temp.c('c_summer')::uuid;
  perform pg_temp.check(bot.tick_due(pg_temp.at(d + 31, '20:05')), 'tick_due: K3 of the new date is due');
  perform meldy_private.exam_remind_set_for(pg_temp.c('a')::uuid, pg_temp.c('c_summer')::uuid, false);
  perform pg_temp.check(not bot.tick_due(pg_temp.at(d + 31, '20:05')), 'tick_due: not for an exam that is off');
  perform pg_temp.check((select count(*) from public.bot_claim_after_date(50, pg_temp.at(d + 31, '20:05')) x where x.chat_id = 9101) = 0,
                        'K3: off before its day, never sent');
end
$t$;

select pg_temp.as_role('postgres');
select 'EXAM MOVE BOT EXAMS CHECKS PASSED';
rollback;
