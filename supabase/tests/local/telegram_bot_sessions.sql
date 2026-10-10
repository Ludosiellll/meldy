-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of the «занятие» in the chat (package T5:
-- supabase/migrations/20261010120003_telegram_bot_sessions.sql) on a scratch database that has the exam container and
-- T1's bot migrations (20261010120000–02, cron and net stubbed), then this migration. Spec §8.2 «Занятие» entirely:
-- верно → a test_answers row with source 'bot' and tg:<sid>:<pos>, a replay → duplicate; неверно → no row until
-- «Дальше»; misclick → wrong does not grow, peek_day = today (for «Не знаю» too); the flush after 30 minutes; the doubt
-- → test_key_doubt_for and the answer recorded; a foreign sid, an old position, out of range → refused; the site and
-- the bot on one question; stale; gone; one open session per user. Plus: the gate, the option order and the masks, the
-- short answer's normalisation, the queue of afterAnswer and its checks, the double tap (the first wins), «Закончить»
-- and «Продолжить», a session's day, the figure, the tick's hook and T1's readers (bot_today, bot.session_message).
-- Part 1 is one transaction, rolled back: a failure raises (FAILED: …); success prints TELEGRAM BOT SESSIONS CHECKS
-- PASSED. Part 2 (true concurrency through dblink, skipped with a notice when the extension is not available) commits
-- its own fixtures under fresh accounts and deletes them at the end; success prints TELEGRAM BOT SESSIONS CONCURRENCY
-- PASSED. Roles: anon, authenticated (request.jwt.claim.sub) and service_role as PostgREST sets them
-- (request.jwt.claims); postgres for fixtures and for reading schema bot. Runs under the migration's own grants.
\set ON_ERROR_STOP 1
begin;

-- ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────────
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
create temp table ctx (k text primary key, v text);
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from ctx where k = p_k
$fn$;
create or replace function pg_temp.u(p_k text) returns uuid language sql stable as $fn$
  select v::uuid from ctx where k = p_k
$fn$;
-- Reads and writes of schema bot and of the answer log run as the migration role (the API roles have no way in).
create or replace function pg_temp.sq(p_sql text) returns text
language plpgsql security definer set search_path = '' as $fn$
declare v text;
begin
  execute p_sql into v;
  return v;
end;
$fn$;
create or replace function pg_temp.sj(p_sql text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare v jsonb;
begin
  execute p_sql into v;
  return v;
end;
$fn$;
create or replace function pg_temp.sx(p_sql text) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  execute p_sql;
end;
$fn$;
create or replace function pg_temp.check(p_ok boolean, p_what text, p_detail jsonb default null)
returns void language plpgsql as $fn$
begin
  if p_ok is not true then
    raise exception 'FAILED: % %', p_what, coalesce(p_detail::text, '');
  end if;
end;
$fn$;
-- One answer row of the log by its event id, as jsonb (null when there is none).
create or replace function pg_temp.row_of(p_event text) returns jsonb language sql as $fn$
  select pg_temp.sj(format($q$select to_jsonb(a) from public.test_answers a where a.client_event_id = %L$q$, p_event))
$fn$;
create or replace function pg_temp.rows_of(p_event text) returns integer language sql as $fn$
  select pg_temp.sq(format($q$select count(*) from public.test_answers a where a.client_event_id = %L$q$, p_event))::integer
$fn$;
-- A queue for bot_session_resolve: [[key, retry, shown?], …] → [{id, retry, shown?}].
create or replace function pg_temp.q(p_entries jsonb) returns jsonb language sql stable as $fn$
  select jsonb_agg(jsonb_build_object('id', pg_temp.c(e ->> 0), 'retry', (e ->> 1)::integer)
                   || case when jsonb_array_length(e) > 2 then jsonb_build_object('shown', e -> 2) else '{}'::jsonb end
                   order by o)
    from jsonb_array_elements(p_entries) with ordinality x(e, o)
$fn$;
-- A queue for bot_session_start: [[key, shown, cls?], …] → [{id, shown, cls?}].
create or replace function pg_temp.sq0(p_entries jsonb) returns jsonb language sql stable as $fn$
  select jsonb_agg(jsonb_build_object('id', pg_temp.c(e ->> 0), 'shown', e -> 1)
                   || case when jsonb_array_length(e) > 2 then jsonb_build_object('cls', e -> 2) else '{}'::jsonb end
                   order by o)
    from jsonb_array_elements(p_entries) with ordinality x(e, o)
$fn$;
grant all on ctx to anon, authenticated, service_role;
grant execute on function pg_temp.expect_error(text, text[], text), pg_temp.as_role(text, uuid), pg_temp.put(text, text),
  pg_temp.c(text), pg_temp.u(text), pg_temp.sq(text), pg_temp.sj(text), pg_temp.sx(text),
  pg_temp.check(boolean, text, jsonb), pg_temp.row_of(text), pg_temp.rows_of(text), pg_temp.q(jsonb), pg_temp.sq0(jsonb)
  to anon, authenticated, service_role;

-- ── fixtures: the exam «Осенняя сессия» (spec §3's invented example) ─────────────────────────────────────────────────
-- A = the author (Telegram 3001, a far zone whose date differs from UTC's right now: Pago Pago before 11:00 UTC,
-- Kiritimati after), B = a member through the group link (3002, Minsk), C = a stranger (3003), E = a second member
-- (3005). Questions of the spec's §4 and a few more invented for these checks.
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$
declare r jsonb;
begin
  r := public.container_create('Осенняя сессия', (now() at time zone 'utc')::date + 24,
         '[{"title":"Компьютерные сети","topics":["Протоколы","Адресация"]},
           {"title":"Базы данных","topics":["Модели данных","SQL","Транзакции"]}]');
  perform pg_temp.put('c', r ->> 'container_id');
  perform pg_temp.put('s1', r -> 'subjects' -> 0 ->> 'id');
  perform pg_temp.put('s2', r -> 'subjects' -> 1 ->> 'id');
  perform public.container_items_add(pg_temp.u('s1'), '[
    {"ref":"net:1","file_no":"12","topic":1,"stem":"Какой протокол передаёт веб-страницы в зашифрованном виде?","options":["HTTP","FTP","HTTPS","SMTP","Telnet"],"correct":[2],"key_source":"bold"},
    {"ref":"net:2","file_no":"13","topic":2,"stem":"Какие адреса относятся к частным диапазонам IPv4?","options":["10.4.0.9","172.20.1.1","192.168.3.7","8.8.4.4"],"correct":[0,1,2],"key_source":"bold"},
    {"ref":"net:3","file_no":"14","topic":2,"kind":"short","stem":"Сколько бит в адресе IPv4?","answers":["32","тридцать два"],"key_source":"answer_line"},
    {"ref":"net:4","file_no":"15","topic":1,"stem":"Какой протокол выдаёт устройству IP-адрес при подключении к сети?","options":["DNS","DHCP","ARP","NAT"],"correct":[1],"key_source":"bold"},
    {"ref":"net:5","file_no":"16","topic":1,"code":true,"stem":"Что выведет программа?\nint x = 7;\nint y = x++ + ++x;\nConsole.WriteLine(y);","options":["14","15","16","17"],"correct":[2],"key_source":"bold"},
    {"ref":"net:6","file_no":"17","topic":1,"stem":"Какой порт по умолчанию у HTTPS?","options":["80","443","21","25"],"correct":[1],"key_source":"bold"},
    {"ref":"net:7","file_no":"18","topic":1,"stem":"Какой уровень модели OSI отвечает за маршрутизацию?","options":["Канальный","Сетевой","Транспортный","Прикладной"],"correct":[1],"key_source":"bold"},
    {"ref":"net:8","file_no":"19","topic":1,"stem":"Что делает служба DNS?","options":["Находит IP-адрес по имени","Шифрует трафик","Выдаёт IP-адреса","Передаёт почту"],"correct":[0],"key_source":"bold"}]');
  perform public.container_items_add(pg_temp.u('s2'), '[
    {"ref":"db:1","file_no":"57","topic":3,"stem":"Что гарантирует изолированность — буква I в ACID?","options":["Изменения завершённой транзакции сохраняются даже после сбоя","Параллельные транзакции не видят промежуточных изменений друг друга","Транзакция выполняется целиком или не выполняется совсем","После транзакции данные удовлетворяют всем ограничениям целостности"],"correct":[1],"key_source":"bold"},
    {"ref":"db:2","file_no":"58","topic":3,"stem":"Какой уровень изоляции не допускает фантомного чтения?","options":["Read committed","Repeatable read","Serializable","Read uncommitted"],"correct":[2],"key_source":"bold"},
    {"ref":"db:3","file_no":"59","topic":2,"stem":"Какой оператор SQL удаляет таблицу целиком?","options":["DELETE","DROP TABLE","TRUNCATE","REMOVE"],"correct":[1],"key_source":"bold"},
    {"ref":"db:4","file_no":"60","topic":2,"stem":"Какое ключевое слово сортирует результат запроса?","options":["GROUP BY","ORDER BY","HAVING","SORT"],"correct":[1],"key_source":"bold"},
    {"ref":"db:5","file_no":"61","topic":1,"code":true,"stem":"Какое объявление позволяет переопределить метод в классе-наследнике?","options":["public static void Draw()","public virtual void Draw()","public new void Draw()","private void Draw()"],"correct":[1],"key_source":"bold"}]');
  r := public.container_link_create(pg_temp.u('c'), 60);
  perform pg_temp.put('code', r ->> 'code');
end
$t$;
select pg_temp.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
do $t$ begin
  perform pg_temp.check((public.container_join(pg_temp.c('code')) ->> 'joined')::boolean, 'B joins');
end $t$;
select pg_temp.as_role('authenticated', 'eeeeeeee-0000-0000-0000-000000000005');
do $t$ begin
  perform pg_temp.check((public.container_join(pg_temp.c('code')) ->> 'joined')::boolean, 'E joins');
end $t$;
select pg_temp.as_role('postgres');
insert into ctx select replace(i.import_ref, ':', ''), i.id::text from public.test_items i
 where i.container_id = (select v::uuid from ctx where k = 'c');
insert into bot.links (user_id, tg_user_id, chat_id, tz) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 3001, 3001,
   case when extract(hour from now() at time zone 'utc') < 11 then 'Pacific/Pago_Pago' else 'Pacific/Kiritimati' end),
  ('bbbbbbbb-0000-0000-0000-000000000002', 3002, 3002, 'Europe/Minsk'),
  ('cccccccc-0000-0000-0000-000000000003', 3003, 3003, 'Europe/Minsk'),
  ('eeeeeeee-0000-0000-0000-000000000005', 3005, 3005, 'Europe/Minsk');
select pg_temp.put('minsk', ((now() at time zone 'Europe/Minsk')::date)::text);
select pg_temp.put('far', ((now() at time zone (select l.tz from bot.links l where l.tg_user_id = 3001))::date)::text);
do $t$ begin
  perform pg_temp.check(pg_temp.c('far')::date <> (now() at time zone 'utc')::date, 'the far zone''s date differs from UTC''s');
end $t$;

-- ── 0. The gate: every session function refuses anon and authenticated with 42501; the helpers too ─────────────────
create temp table t5_calls (sql text);
insert into t5_calls values
  ($$select public.bot_session_items(3002, gen_random_uuid(), array[gen_random_uuid()])$$),
  ($$select public.bot_session_start(3002, 'zz000000', gen_random_uuid(), gen_random_uuid(), 'plan', '[]')$$),
  ($$select public.bot_session_view(3002, 'zz000000')$$),
  ($$select public.bot_session_answer(3002, 'zz000000', 0, '{"i": 0}')$$),
  ($$select public.bot_session_resolve(3002, 'zz000000', 0, 'next')$$),
  ($$select public.bot_session_finish(3002, 'zz000000')$$),
  ($$select public.bot_session_move(3002, 'zz000000', 1)$$),
  ($$select public.bot_key_doubt(3002, 'zz000000', 0)$$),
  ($$select public.bot_flush_pending()$$);
grant select on t5_calls to anon, authenticated;
select pg_temp.as_role('anon');
do $t$
declare q text;
begin
  for q in select sql from t5_calls loop
    perform pg_temp.expect_error(q, array['42501'], 'anon: ' || q);
  end loop;
  perform pg_temp.expect_error('select bot.tick_due_sessions(now())', array['42501'], 'anon: bot.tick_due_sessions');
  perform pg_temp.expect_error('select count(*) from bot.sessions', array['42501'], 'anon reads bot.sessions');
end
$t$;
select pg_temp.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
do $t$
declare q text;
begin
  for q in select sql from t5_calls loop
    perform pg_temp.expect_error(q, array['42501'], 'authenticated: ' || q);
  end loop;
  perform pg_temp.expect_error('select bot.session_order_ok(''[0]'', 1)', array['42501'], 'authenticated: a helper');
  perform pg_temp.expect_error('select count(*) from bot.sessions', array['42501'], 'authenticated reads bot.sessions');
end
$t$;

-- ── 1. bot_session_items: what optionOrder needs, never the key ────────────────────────────────────────────────────
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_session_items(3002, pg_temp.u('c'),
         array[pg_temp.u('net1'), pg_temp.u('net3'), pg_temp.u('db1'), gen_random_uuid()]);
  perform pg_temp.check(r ->> 'status' = 'ok' and jsonb_array_length(r -> 'items') = 3, 'items: three of four', r);
  perform pg_temp.check(r -> 'items' -> 0 -> 'options' = '["HTTP","FTP","HTTPS","SMTP","Telnet"]'::jsonb
                        and r -> 'items' -> 0 ->> 'kind' = 'single' and r -> 'items' -> 1 ->> 'kind' = 'short'
                        and r -> 'items' -> 0 ->> 'id' = pg_temp.c('net1'), 'items: file order, kinds', r);
  perform pg_temp.check(r::text not like '%"correct"%' and r::text not like '%"answers"%' and r::text not like '%"32"%',
                        'items: no key, no accepted forms', r);
  perform pg_temp.check(public.bot_session_items(3003, pg_temp.u('c'), array[pg_temp.u('net1')]) ->> 'status' = 'unavailable',
                        'items: a stranger');
  perform pg_temp.check(public.bot_session_items(9999, pg_temp.u('c'), array[pg_temp.u('net1')]) ->> 'status' = 'unlinked',
                        'items: not linked');
  perform pg_temp.check(public.bot_session_items(3002, pg_temp.u('c'), '{}'::uuid[]) ->> 'status' = 'invalid'
                        and public.bot_session_items(3002, pg_temp.u('c'), null) ->> 'status' = 'invalid', 'items: empty');
end
$t$;

-- ── 2. bot_session_start: the queue, the orders and the classes from the function ─────────────────────────────────
do $t$
declare r jsonb; q jsonb;
begin
  q := pg_temp.sq0('[["net1",[2,0,1,3,4],"new_floor"],["net2",[3,2,1,0],"new_floor"],["net3",[],"relearn"],["net4",[1,0,3,2],"confirm"]]');
  -- refusals first (nothing is created)
  perform pg_temp.check(public.bot_session_start(3002, 'B1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan', q) ->> 'reason' = 'arguments', 'start: sid format');
  perform pg_temp.check(public.bot_session_start(3002, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'exam', q) ->> 'reason' = 'arguments', 'start: kind');
  perform pg_temp.check(public.bot_session_start(3002, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan', '[]') ->> 'reason' = 'arguments', 'start: empty queue');
  perform pg_temp.check(public.bot_session_start(3002, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
                          (select jsonb_agg(q -> 0) from generate_series(1, 21))) ->> 'reason' = 'arguments', 'start: 21 entries');
  perform pg_temp.check(public.bot_session_start(3002, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan', q, 0) ->> 'reason' = 'arguments', 'start: message 0');
  perform pg_temp.check(public.bot_session_start(3002, 'b1000000', pg_temp.u('c'), gen_random_uuid(), 'plan', q) ->> 'reason' = 'subject', 'start: foreign subject');
  perform pg_temp.check(public.bot_session_start(3002, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
                          jsonb_build_array(q -> 0, q -> 0)) ->> 'reason' = 'queue', 'start: a question twice');
  perform pg_temp.check(public.bot_session_start(3002, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
                          jsonb_build_array((q -> 0) || '{"retry": 1}')) ->> 'reason' = 'queue', 'start: a repeat');
  perform pg_temp.check(public.bot_session_start(3002, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
                          jsonb_build_array((q -> 0) || '{"shown": [0,0,1,2,3]}')) ->> 'reason' = 'shown', 'start: a broken order');
  perform pg_temp.check(public.bot_session_start(3002, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
                          jsonb_build_array(jsonb_build_object('id', pg_temp.c('net1')))) ->> 'reason' = 'shown', 'start: no order');
  perform pg_temp.check(public.bot_session_start(3002, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
                          pg_temp.sq0('[["db1",[0,1,2,3]]]')) ->> 'status' = 'empty', 'start: another subject''s question only');
  r := public.bot_session_start(3003, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan', q);
  perform pg_temp.check(r ->> 'status' = 'unavailable' and r ->> 'exam_title' = 'Осенняя сессия', 'start: a stranger', r);
  perform pg_temp.check(public.bot_session_start(9999, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan', q) ->> 'status' = 'unlinked', 'start: not linked');
  perform pg_temp.check(pg_temp.sq('select count(*) from bot.sessions') = '0', 'start: refusals created nothing');

  r := public.bot_session_start(3002, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan', q, 501,
                                '{"in_plan": 13, "two_days": 0}');
  perform pg_temp.put('r_start', r::text);
  perform pg_temp.check(r ->> 'status' = 'ok' and not (r ->> 'resumed')::boolean and r -> 'replaced' = 'null'::jsonb,
                        'start: ok', r);
  perform pg_temp.check(r -> 'session' ->> 'sid' = 'b1000000' and (r -> 'session' ->> 'position')::integer = 0
                        and (r -> 'session' ->> 'length')::integer = 4 and r -> 'session' ->> 'local_day' = pg_temp.c('minsk')
                        and (r -> 'session' ->> 'chat_id')::bigint = 3002 and (r -> 'session' ->> 'message_id')::bigint = 501
                        and r -> 'session' ->> 'role' = 'member' and r -> 'session' ->> 'kind' = 'plan'
                        and r -> 'session' ->> 'status' = 'open' and r -> 'session' ->> 'exam_title' = 'Осенняя сессия'
                        and r -> 'session' ->> 'subject_title' = 'Компьютерные сети'
                        and r -> 'session' -> 'queue' = pg_temp.q('[["net1",0],["net2",0],["net3",0],["net4",0]]')
                        and r -> 'session' -> 'figure' ->> 'in_plan' = '13' and r -> 'session' -> 'figure' ->> 'now' = '0',
                        'start: the session', r -> 'session');
  perform pg_temp.check(r -> 'view' -> 'options' = '["HTTPS","HTTP","FTP","SMTP","Telnet"]'::jsonb
                        and r -> 'view' -> 'order' = '[2,0,1,3,4]'::jsonb and (r -> 'view' ->> 'pos')::integer = 0
                        and r -> 'view' -> 'review' = 'null'::jsonb and r -> 'view' ->> 'file_no' = '12'
                        and r -> 'view' ->> 'topic_title' = 'Протоколы' and (r -> 'view' ->> 'retry')::integer = 0
                        and r -> 'view' ->> 'kind' = 'single' and not (r -> 'view' ->> 'code')::boolean,
                        'start: the first question in the function''s order', r -> 'view');
  perform pg_temp.check(r::text not like '%"key"%' and r::text not like '%"correct"%' and r::text not like '%"answers"%',
                        'start: no key before the answer', r);
  -- the row as stored (and as T1 reads it)
  perform pg_temp.check(pg_temp.sq($q$select row(s.user_id, s.status, s.position, s.cls::text, s.kind, s.shown_at[1] is not null,
                                              s.shown -> 0 ->> 'r', s.session_uuid = md5('tg:b1000000')::uuid,
                                              s.link_id = (select l.id from bot.links l where l.tg_user_id = 3002))::text
                                     from bot.sessions s where s.sid = 'b1000000'$q$)
                        = '(bbbbbbbb-0000-0000-0000-000000000002,open,0,"{new_floor,new_floor,relearn,confirm}",plan,t,1,t,t)',
                        'start: the stored row');
  perform pg_temp.check(public.bot_today(3002) -> 'session' ->> 'sid' = 'b1000000'
                        and not (public.bot_today(3002) -> 'session' ? 'user_id'), 'T1 bot_today reads the open session');
  perform pg_temp.check(pg_temp.sq('select bot.session_message(3002, 501)') = 'true'
                        and pg_temp.sq('select bot.session_message(3002, 999)') = 'false', 'T1 night close sees the session''s message');
  -- the same card pressed twice (a new sid drawn): the session already there; the same sid by someone else: conflict
  r := public.bot_session_start(3002, 'b1000009', pg_temp.u('c'), pg_temp.u('s1'), 'plan', q, 501);
  perform pg_temp.check(r ->> 'status' = 'ok' and (r ->> 'resumed')::boolean and r -> 'session' ->> 'sid' = 'b1000000',
                        'start: «Начать» twice on one card', r - 'view');
  perform pg_temp.check(public.bot_session_start(3002, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan', q) ->> 'resumed' = 'true',
                        'start: the same call again');
  perform pg_temp.check(public.bot_session_start(3001, 'b1000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan', q) ->> 'status' = 'conflict',
                        'start: a taken sid');
  perform pg_temp.check(pg_temp.sq('select count(*) from bot.sessions') = '1', 'start: one session');
end
$t$;

-- ── 3. Right answer: recorded at once (spec §6.3), the next question in the same reply; a replay → duplicate ─────────
do $t$
declare r jsonb; a jsonb;
begin
  perform pg_temp.sx('update bot.links set last_seen_at = null where tg_user_id = 3002');
  r := public.bot_session_answer(3002, 'b1000000', 0, '{"i": 0}');   -- shown 0 = file 2 = HTTPS
  perform pg_temp.check(pg_temp.sq('select last_seen_at = now() from bot.links where tg_user_id = 3002') = 'true',
                        'a press marks the user as seen (the day card waits 30 minutes, K2''s silence ends)');
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'answer' ->> 'status' = 'saved'
                        and (r -> 'answer' ->> 'correct')::boolean and r -> 'answer' ->> 'step' = 'start', 'right: saved', r -> 'answer');
  perform pg_temp.check((r -> 'view' ->> 'pos')::integer = 1 and r -> 'view' -> 'review' = 'null'::jsonb
                        and r -> 'view' -> 'options' = '["8.8.4.4","192.168.3.7","172.20.1.1","10.4.0.9"]'::jsonb,
                        'right: the next question in the same reply', r -> 'view');
  perform pg_temp.check(r -> 'session' -> 'counts' ->> 'questions' = '1' and r -> 'session' -> 'counts' ->> 'right' = '1'
                        and r -> 'session' -> 'figure' ->> 'started' = '1', 'right: counts', r -> 'session');
  a := pg_temp.row_of('tg:b1000000:0');
  perform pg_temp.check(a ->> 'source' = 'bot' and (a ->> 'correct')::boolean and a -> 'chosen' = '[2]'::jsonb
                        and a -> 'shown_order' = '[2,0,1,3,4]'::jsonb and a ->> 'local_date' = pg_temp.c('minsk')
                        and (a ->> 'ms')::integer between 0 and 180000 and a ->> 'cls' = 'new_floor'
                        and not (a ->> 'retry')::boolean and not (a ->> 'misclick')::boolean and a ->> 'step' = 'start'
                        and a ->> 'mode' = 'learn' and (a ->> 'item_rev')::integer = 1
                        and (a ->> 'session_id')::uuid = md5('tg:b1000000')::uuid and a ->> 'item_id' = pg_temp.c('net1'),
                        'right: the log row (source bot, tg:<sid>:<pos>, local day, ms, cls, retry, session)', a);
  -- the same press again («Повторить» after a lost reply): old + what was recorded; a double tap with another option
  r := public.bot_session_answer(3002, 'b1000000', 0, '{"i": 0}');
  perform pg_temp.check(r ->> 'status' = 'old' and r -> 'answer' ->> 'status' = 'duplicate'
                        and (r -> 'answer' ->> 'correct')::boolean and (r -> 'view' ->> 'pos')::integer = 1,
                        'replay: old with the recorded outcome', r - 'session');
  r := public.bot_session_answer(3002, 'b1000000', 0, '{"i": 3}');
  perform pg_temp.check(r ->> 'status' = 'old', 'double tap after a right answer: refused', r - 'session');
  perform pg_temp.check(pg_temp.rows_of('tg:b1000000:0') = 1 and pg_temp.row_of('tg:b1000000:0') -> 'chosen' = '[2]'::jsonb,
                        'double tap: one row, the first answer');
end
$t$;

-- ── 4. Wrong answer: pending until «Дальше»; the queue of afterAnswer and its checks ────────────────────────────────
do $t$
declare r jsonb; a jsonb;
begin
  r := public.bot_session_answer(3002, 'b1000000', 1, '{"mask": 1}');   -- shown 0 = file 3 = 8.8.4.4
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'answer' ->> 'status' = 'pending'
                        and not (r -> 'answer' ->> 'correct')::boolean and not (r -> 'answer' ->> 'dont_know')::boolean,
                        'wrong: pending', r -> 'answer');
  perform pg_temp.check(r -> 'view' -> 'review' -> 'key' = '[1,2,3]'::jsonb and r -> 'view' -> 'review' -> 'choice' = '[0]'::jsonb
                        and not (r -> 'view' -> 'review' ->> 'recorded')::boolean
                        and not (r -> 'view' -> 'review' ->> 'correct')::boolean
                        and (r -> 'session' ->> 'answered')::boolean and (r -> 'view' ->> 'pos')::integer = 1,
                        'wrong: the review carries the key in shown indices', r -> 'view');
  perform pg_temp.check(pg_temp.rows_of('tg:b1000000:1') = 0, 'wrong: no row before «Дальше»');
  perform pg_temp.check(pg_temp.sq($q$select pending_at is not null from bot.sessions where sid = 'b1000000'$q$) = 'true',
                        'wrong: pending_at set');
  -- a double tap with other marks: the first answer stands
  r := public.bot_session_answer(3002, 'b1000000', 1, '{"mask": 6}');
  perform pg_temp.check(r ->> 'status' = 'repeat' and r -> 'view' -> 'review' -> 'choice' = '[0]'::jsonb,
                        'double tap on a wrong answer: repeat, the first stands', r - 'session');
  -- the tick's hook: due only after 30 minutes
  perform pg_temp.check(pg_temp.sq('select bot.tick_due_sessions(now())') = 'false'
                        and pg_temp.sq($q$select bot.tick_due_sessions(now() + interval '29 minutes')$q$) = 'false'
                        and pg_temp.sq($q$select bot.tick_due_sessions(now() + interval '31 minutes')$q$) = 'true',
                        'tick_due_sessions: a pending answer older than 30 minutes');
  -- «Дальше» without the queue: the miss comes back, so afterAnswer's queue is required (session and view come along)
  r := public.bot_session_resolve(3002, 'b1000000', 1, 'next');
  perform pg_temp.check(r ->> 'status' = 'invalid' and r ->> 'reason' = 'queue' and r -> 'session' ? 'queue'
                        and r -> 'view' -> 'order' = '[3,2,1,0]'::jsonb, 'next: queue required', r - 'session');
  -- queues that do not fit change nothing
  perform pg_temp.check(public.bot_session_resolve(3002, 'b1000000', 1, 'next',
    pg_temp.q('[["net2",0],["net1",0],["net3",0],["net4",0],["net2",1,[0,1,2,3]]]')) ->> 'reason' = 'queue', 'queue: the answered part moved');
  perform pg_temp.check(public.bot_session_resolve(3002, 'b1000000', 1, 'next',
    pg_temp.q('[["net1",0],["net2",1,[0,1,2,3]],["net2",0],["net3",0],["net4",0]]')) ->> 'reason' = 'queue', 'queue: a repeat before the question');
  perform pg_temp.check(public.bot_session_resolve(3002, 'b1000000', 1, 'next',
    pg_temp.q('[["net1",0],["net2",0],["net3",0],["net4",0],["net5",1,[0,1,2,3]]]')) ->> 'reason' = 'queue', 'queue: a foreign question');
  perform pg_temp.check(public.bot_session_resolve(3002, 'b1000000', 1, 'next',
    pg_temp.q('[["net1",0],["net2",0],["net3",0],["net4",0],["net2",1]]')) ->> 'reason' = 'queue', 'queue: a repeat without its order');
  perform pg_temp.check(public.bot_session_resolve(3002, 'b1000000', 1, 'next',
    pg_temp.q('[["net1",0],["net2",0],["net4",0],["net2",1,[0,1,2,3]]]')) ->> 'reason' = 'queue', 'queue: another question dropped');
  perform pg_temp.check(public.bot_session_resolve(3002, 'b1000000', 1, 'next',
    pg_temp.q('[["net1",0],["net2",0],["net4",0],["net3",0],["net2",1,[0,1,2,3]]]')) ->> 'reason' = 'queue', 'queue: order changed');
  perform pg_temp.check(public.bot_session_resolve(3002, 'b1000000', 1, 'next',
    pg_temp.q('[["net2",0],["net3",0],["net4",0],["net2",1,[0,1,2,3]]]')) ->> 'reason' = 'queue', 'queue: an answered question dropped');
  perform pg_temp.check(public.bot_session_resolve(3002, 'b1000000', 1, 'next', '{"id": 1}') ->> 'reason' = 'queue', 'queue: not an array');
  perform pg_temp.check(pg_temp.rows_of('tg:b1000000:1') = 0, 'refused queues recorded nothing');
  -- afterAnswer's queue (3–5 later, here at the end): recorded as given, the repeat in, the next question
  r := public.bot_session_resolve(3002, 'b1000000', 1, 'next',
         pg_temp.q('[["net1",0],["net2",0],["net3",0],["net4",0],["net2",1,[0,1,2,3]]]'));
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'answer' ->> 'status' = 'saved' and r -> 'answer' ->> 'step' = 'miss'
                        and (r -> 'view' ->> 'pos')::integer = 2 and r -> 'view' ->> 'kind' = 'short'
                        and r -> 'view' -> 'options' = '[]'::jsonb and (r -> 'session' ->> 'length')::integer = 5
                        and r -> 'session' -> 'queue' -> 4 = jsonb_build_object('id', pg_temp.c('net2'), 'retry', 1)
                        and r -> 'session' -> 'counts' ->> 'wrong' = '1', 'next: recorded, repeat queued', r);
  a := pg_temp.row_of('tg:b1000000:1');
  perform pg_temp.check(not (a ->> 'correct')::boolean and not (a ->> 'misclick')::boolean and a -> 'chosen' = '[3]'::jsonb
                        and a -> 'shown_order' = '[3,2,1,0]'::jsonb and a ->> 'step' = 'miss', 'next: the log row as given', a);
  perform pg_temp.check(pg_temp.sq($q$select bot.tick_due_sessions(now() + interval '31 minutes')$q$) = 'false',
                        'tick_due_sessions: nothing pending any more');
end
$t$;

-- ── 5. Short answer typed as a message: the container's normalisation; stays with its result until «Дальше» ────────
do $t$
declare r jsonb; a jsonb;
begin
  r := public.bot_session_answer(3002, null, null, '{"text": " 32. "}');
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'answer' ->> 'status' = 'saved' and (r -> 'answer' ->> 'correct')::boolean
                        and (r -> 'view' ->> 'pos')::integer = 2 and (r -> 'view' -> 'review' ->> 'correct')::boolean
                        and (r -> 'view' -> 'review' ->> 'recorded')::boolean and r -> 'view' -> 'review' ->> 'text' = ' 32. '
                        and r -> 'view' -> 'review' -> 'answers' = '["32","тридцать два"]'::jsonb,
                        'short: typed, normalised, recorded at once, the result stays', r -> 'view');
  a := pg_temp.row_of('tg:b1000000:2');
  perform pg_temp.check((a ->> 'correct')::boolean and a ->> 'answer_text' = ' 32. ' and a -> 'chosen' = '[]'::jsonb
                        and a -> 'shown_order' = 'null'::jsonb and a ->> 'cls' = 'relearn', 'short: the log row', a);
  perform pg_temp.check(public.bot_session_answer(3002, null, null, '{"text": "33"}') ->> 'status' = 'repeat',
                        'short: a second message, the first stands');
  perform pg_temp.check(public.bot_session_resolve(3002, 'b1000000', 2, 'misclick') ->> 'status' = 'invalid',
                        'short: no «Нажали не туда?» after a typed answer');
  r := public.bot_session_resolve(3002, 'b1000000', 2, 'next');
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'answer' = 'null'::jsonb and (r -> 'view' ->> 'pos')::integer = 3
                        and r -> 'view' -> 'options' = '["DHCP","DNS","NAT","ARP"]'::jsonb, 'short: «Дальше»', r -> 'view');
  perform pg_temp.check(public.bot_session_answer(3002, null, null, '{"text": "DHCP"}') ->> 'status' = 'no_question',
                        'a typed message under a question with options');
end
$t$;

-- ── 6. «Не знаю» and «Нажали не туда?»: recorded as misclick, wrong does not grow, peek_day = today ────────────────
do $t$
declare r jsonb; a jsonb; st jsonb;
begin
  r := public.bot_session_answer(3002, 'b1000000', 3, '{"dont_know": true}');
  perform pg_temp.check(r -> 'answer' ->> 'status' = 'pending' and (r -> 'answer' ->> 'dont_know')::boolean
                        and r -> 'view' -> 'review' -> 'key' = '[0]'::jsonb and r -> 'view' -> 'review' -> 'choice' = '[]'::jsonb,
                        '«Не знаю»: pending with the key', r -> 'view');
  r := public.bot_session_resolve(3002, 'b1000000', 3, 'misclick');
  perform pg_temp.check(r ->> 'status' = 'ok' and (r -> 'answer' ->> 'misclick')::boolean and r -> 'answer' ->> 'step' = 'misclick'
                        and (r -> 'view' -> 'review' ->> 'misclick')::boolean and (r -> 'view' -> 'review' ->> 'recorded')::boolean
                        and (r -> 'view' ->> 'pos')::integer = 3, 'misclick: recorded, the question stays (Z9)', r);
  a := pg_temp.row_of('tg:b1000000:3');
  perform pg_temp.check((a ->> 'misclick')::boolean and a -> 'chosen' = '[]'::jsonb and not (a ->> 'correct')::boolean
                        and a ->> 'step' = 'misclick' and a ->> 'cls' = 'confirm', 'misclick: the log row', a);
  st := pg_temp.sj(format($q$select to_jsonb(s) from public.test_item_states s
                              where s.user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and s.item_id = %L$q$, pg_temp.c('net4')));
  perform pg_temp.check((st ->> 'wrong_count')::integer = 0 and st ->> 'peek_day' = pg_temp.c('minsk') and st ->> 'last_result' is null,
                        'misclick: wrong does not grow, peek_day = today', st);
  perform pg_temp.check(public.bot_session_resolve(3002, 'b1000000', 3, 'misclick') ->> 'reason' = 'recorded',
                        'misclick twice: refused');
  r := public.bot_session_resolve(3002, 'b1000000', 3, 'next');
  perform pg_temp.check(r ->> 'status' = 'ok' and (r -> 'view' ->> 'pos')::integer = 4 and (r -> 'view' ->> 'retry')::integer = 1
                        and r -> 'view' -> 'options' = '["10.4.0.9","172.20.1.1","192.168.3.7","8.8.4.4"]'::jsonb
                        and (r -> 'session' ->> 'length')::integer = 5, 'misclick: no repeat; the repeat of net2 comes', r -> 'view');
  -- the repeat, right (all three marked): recorded with retry, training; the queue is done
  r := public.bot_session_answer(3002, 'b1000000', 4, '{"mask": 7}');
  perform pg_temp.check(r -> 'answer' ->> 'status' = 'saved' and r -> 'answer' ->> 'step' = 'training'
                        and r -> 'session' ->> 'status' = 'finished' and r -> 'view' = 'null'::jsonb,
                        'repeat: training, the session finished', r);
  perform pg_temp.check(r -> 'session' -> 'counts' = '{"questions": 4, "right": 2, "wrong": 1, "dont_know": 0, "misclick": 1,
                          "retries": 1, "skipped": 0, "gone": 0, "stale": 0, "doubted": 0}'::jsonb, 'summary counts', r -> 'session');
  a := pg_temp.row_of('tg:b1000000:4');
  perform pg_temp.check((a ->> 'retry')::boolean and (a ->> 'correct')::boolean and a -> 'chosen' = '[0,1,2]'::jsonb
                        and a -> 'shown_order' = '[0,1,2,3]'::jsonb, 'repeat: the log row', a);
  perform pg_temp.check(public.bot_today(3002) -> 'session' = 'null'::jsonb, 'finished: bot_today has no open session');
  r := public.bot_session_finish(3002, 'b1000000');
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'session' ->> 'status' = 'finished', '«Закончить» on a finished session', r);
  r := public.bot_session_answer(3002, 'b1000000', 4, '{"mask": 7}');
  perform pg_temp.check(r ->> 'status' = 'ended' and r -> 'answer' ->> 'status' = 'duplicate', 'a press on a finished session', r);
end
$t$;

-- ── 7. stale (the author fixed the key after the show), gone (deleted), skip (over 4096), gone while waiting ────────
do $t$
declare r jsonb;
begin
  r := public.bot_session_start(3002, 'b2000000', pg_temp.u('c'), pg_temp.u('s2'), 'plan',
         pg_temp.sq0('[["db1",[1,0,2,3]],["db2",[0,1,2,3]],["db3",[3,2,1,0]],["db4",[0,1,2,3]]]'), 502);
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'view' ->> 'topic_title' = 'Транзакции'
                        and r -> 'view' -> 'options' ->> 0 = 'Параллельные транзакции не видят промежуточных изменений друг друга',
                        'start S2', r -> 'view');
end
$t$;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$ begin
  perform pg_temp.check((public.container_item_update(pg_temp.u('db1'), '{"correct": [2]}') ->> 'rev_changed')::boolean,
                        'the author fixes the key of № 57');
  delete from public.test_items where id = pg_temp.u('db2');
end $t$;
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_session_answer(3002, 'b2000000', 0, '{"i": 0}');
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'answer' ->> 'status' = 'stale' and (r -> 'view' ->> 'pos')::integer = 2
                        and r -> 'session' -> 'counts' ->> 'stale' = '1' and r -> 'session' -> 'counts' ->> 'gone' = '1',
                        'stale: not recorded, the next question (the deleted one stepped over)', r);
  perform pg_temp.check(pg_temp.rows_of('tg:b2000000:0') = 0, 'stale: no row');
end
$t$;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$ begin
  delete from public.test_items where id = pg_temp.u('db3');   -- the question on screen now
end $t$;
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_session_answer(3002, 'b2000000', 2, '{"i": 0}');
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'answer' ->> 'status' = 'gone' and (r -> 'view' ->> 'pos')::integer = 3
                        and r -> 'session' -> 'counts' ->> 'gone' = '2', 'gone: not recorded, the next question', r);
  perform pg_temp.check(pg_temp.rows_of('tg:b2000000:2') = 0, 'gone: no row');
  r := public.bot_session_resolve(3002, 'b2000000', 3, 'skip');
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'session' ->> 'status' = 'finished'
                        and r -> 'session' -> 'counts' ->> 'skipped' = '1', 'skip: counted, the queue done', r);
end
$t$;
-- restore the subject's questions for the later checks (as the author)
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$
declare r jsonb;
begin
  r := public.container_items_add(pg_temp.u('s2'), '[
    {"ref":"db:3b","file_no":"59","topic":2,"stem":"Какой оператор SQL удаляет таблицу целиком?","options":["DELETE","DROP TABLE","TRUNCATE","REMOVE"],"correct":[1],"key_source":"bold"}]');
  perform pg_temp.put('db3', r -> 'items' -> 0 ->> 'id');
end
$t$;

-- ── 8. The flush after 30 minutes; «Закончить» keeps the session; «Продолжить» moves it ─────────────────────────────
select pg_temp.as_role('service_role');
do $t$
declare r jsonb; a jsonb;
begin
  r := public.bot_session_start(3002, 'b3000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
         pg_temp.sq0('[["net5",[3,2,1,0]],["net6",[1,0,2,3]],["net7",[0,1,2,3]]]'), 601);
  perform pg_temp.check(r ->> 'status' = 'ok' and (r -> 'view' ->> 'code')::boolean
                        and r -> 'view' -> 'options' = '["17","16","15","14"]'::jsonb, 'start S3 (code)', r -> 'view');
  r := public.bot_session_answer(3002, 'b3000000', 0, '{"i": 0}');   -- 17: wrong
  perform pg_temp.check(r -> 'answer' ->> 'status' = 'pending' and r -> 'view' -> 'review' -> 'key' = '[1]'::jsonb, 'S3 wrong', r);
  r := public.bot_flush_pending(now() + interval '29 minutes');
  perform pg_temp.check(r ->> 'status' = 'ok' and (r ->> 'flushed')::integer = 0 and pg_temp.rows_of('tg:b3000000:0') = 0,
                        'flush: not before 30 minutes', r);
  r := public.bot_flush_pending(now() + interval '31 minutes');
  perform pg_temp.check((r ->> 'flushed')::integer = 1, 'flush: after 30 minutes', r);
  a := pg_temp.row_of('tg:b3000000:0');
  perform pg_temp.check(not (a ->> 'correct')::boolean and not (a ->> 'misclick')::boolean and a ->> 'step' = 'miss'
                        and a ->> 'local_date' = pg_temp.c('minsk'), 'flush: recorded as given', a);
  r := public.bot_session_view(3002, 'b3000000', 0);
  perform pg_temp.check(r ->> 'status' = 'ok' and (r -> 'view' -> 'review' ->> 'recorded')::boolean
                        and (r -> 'view' ->> 'pos')::integer = 0, 'flush: the question stays with its review', r -> 'view');
  perform pg_temp.check(public.bot_session_resolve(3002, 'b3000000', 0, 'misclick') ->> 'reason' = 'recorded',
                        'flush: «Нажали не туда?» no longer possible');
  perform pg_temp.check((public.bot_flush_pending(now() + interval '31 minutes') ->> 'flushed')::integer = 0,
                        'flush: once');
  perform pg_temp.check(public.bot_session_resolve(3002, 'b3000000', 0, 'next') ->> 'reason' = 'queue',
                        'flushed miss: «Дальше» still needs the repeat');
  r := public.bot_session_resolve(3002, 'b3000000', 0, 'next',
         pg_temp.q('[["net5",0],["net6",0],["net7",0],["net5",1,[0,1,2,3]]]'));
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'answer' = 'null'::jsonb and (r -> 'view' ->> 'pos')::integer = 1
                        and pg_temp.rows_of('tg:b3000000:0') = 1, '«Дальше» after the flush: nothing recorded twice', r);
  -- «Закончить» with nothing waiting: the session stays open for «Продолжить»
  r := public.bot_session_finish(3002, 'b3000000');
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'session' ->> 'status' = 'open' and (r -> 'session' ->> 'position')::integer = 1
                        and r -> 'answer' = 'null'::jsonb, '«Закончить»: open, position kept', r);
  perform pg_temp.check(public.bot_session_finish(3002, 'b3000000') -> 'session' ->> 'status' = 'open', '«Закончить» twice');
  perform pg_temp.check(public.bot_today(3002) -> 'session' ->> 'sid' = 'b3000000', 'bot_today: the interrupted session');
  -- «Продолжить» from /today's card: the session moves to that message
  r := public.bot_session_move(3002, 'b3000000', 602);
  perform pg_temp.check(r ->> 'status' = 'ok' and (r ->> 'prev_message_id')::bigint = 601
                        and (r -> 'session' ->> 'message_id')::bigint = 602 and (r -> 'view' ->> 'pos')::integer = 1,
                        'move: to the card, the old message to delete', r - 'session');
  perform pg_temp.check(pg_temp.sq('select bot.session_message(3002, 602)') = 'true', 'move: T1 sees the new message');
  perform pg_temp.check(public.bot_session_move(3002, 'b3000000', 602) -> 'prev_message_id' = 'null'::jsonb,
                        'move: the same message (I2 «Продолжить»)');
  perform pg_temp.check(public.bot_session_move(3002, 'b3000000', 0) ->> 'status' = 'invalid', 'move: a bad message id');
end
$t$;

-- ── 9. The doubt: the answer recorded as given and test_key_doubt_for; its repeat leaves the session ───────────────
do $t$
declare r jsonb; a jsonb;
begin
  r := public.bot_session_start(3002, 'b4000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
         pg_temp.sq0('[["net8",[0,1,2,3]],["net4",[1,0,2,3]]]'), 701);
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'replaced' ->> 'sid' = 'b3000000'
                        and (r -> 'replaced' ->> 'message_id')::bigint = 602, 'start S4 replaces the open S3', r - 'view');
  perform pg_temp.check(pg_temp.sq($q$select status from bot.sessions where sid = 'b3000000'$q$) = 'abandoned', 'S3 abandoned');
  perform pg_temp.check(public.bot_key_doubt(3002, 'b4000000', 0) ->> 'reason' = 'no_answer', 'doubt before an answer');
  r := public.bot_session_answer(3002, 'b4000000', 0, '{"i": 1}');   -- «Шифрует трафик»: wrong
  perform pg_temp.check(r -> 'answer' ->> 'status' = 'pending', 'S4 wrong');
  r := public.bot_key_doubt(3002, 'b4000000', 0);
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'answer' ->> 'status' = 'saved'
                        and (r -> 'view' -> 'review' ->> 'doubt')::boolean and (r -> 'view' -> 'review' ->> 'recorded')::boolean
                        and r -> 'session' -> 'counts' ->> 'doubted' = '1', 'doubt: recorded and set aside', r);
  a := pg_temp.row_of('tg:b4000000:0');
  perform pg_temp.check(not (a ->> 'correct')::boolean and not (a ->> 'misclick')::boolean and a -> 'chosen' = '[1]'::jsonb,
                        'doubt: the answer recorded as given', a);
  perform pg_temp.check(pg_temp.sq(format($q$select row(proposed, note, resolved_at is null, item_rev)::text from public.test_key_doubts
                                            where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and item_id = %L$q$, pg_temp.c('net8')))
                        = '({1},"",t,1)', 'doubt: test_key_doubt_for, the chosen option proposed');
  r := public.bot_key_doubt(3002, 'b4000000', 0);
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'answer' = 'null'::jsonb and r -> 'session' -> 'counts' ->> 'doubted' = '1',
                        'doubt twice: nothing new', r);
  r := public.bot_session_resolve(3002, 'b4000000', 0, 'next',
         pg_temp.q('[["net8",0],["net4",0],["net8",1,[3,2,1,0]]]'));
  perform pg_temp.check(r ->> 'status' = 'ok' and (r -> 'session' ->> 'length')::integer = 2 and (r -> 'view' ->> 'pos')::integer = 1,
                        'doubt: «Дальше» leaves its repeat out', r -> 'session');
end
$t$;

-- ── 10. One open session per user: a new one closes the old, its waiting answer recorded as given ─────────────────
do $t$
declare r jsonb; a jsonb;
begin
  r := public.bot_session_start(3002, 'b5000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
         pg_temp.sq0('[["net1",[0,1,2,3,4]],["net6",[0,1,2,3]]]'), 801);
  perform pg_temp.check(r -> 'replaced' ->> 'sid' = 'b4000000', 'start S5 replaces S4');
  perform pg_temp.check(public.bot_session_answer(3002, 'b5000000', 0, '{"i": 0}') -> 'answer' ->> 'status' = 'pending', 'S5 wrong');
  r := public.bot_session_start(3002, 'b6000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
         pg_temp.sq0('[["net7",[0,1,2,3]],["net1",[2,0,1,3,4]],["net6",[0,1,2,3]]]'), 802);
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'replaced' ->> 'sid' = 'b5000000', 'start S6 replaces S5', r - 'view');
  a := pg_temp.row_of('tg:b5000000:0');
  perform pg_temp.check(a is not null and not (a ->> 'correct')::boolean and not (a ->> 'misclick')::boolean,
                        'replaced: the waiting answer recorded as given', a);
  perform pg_temp.check(pg_temp.sq($q$select count(*) from bot.sessions
                                     where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and status = 'open'$q$) = '1',
                        'one open session per user');
  perform pg_temp.check(public.bot_session_answer(3002, 'b5000000', 1, '{"i": 0}') ->> 'status' = 'ended', 'a press on S5: ended');
  perform pg_temp.expect_error($q$select pg_temp.sx('insert into bot.sessions (sid, user_id, chat_id, container_id, subject_id,
                                   local_day, items, retry, cls, shown, shown_at)
                                 select ''b6000001'', user_id, chat_id, container_id, subject_id, local_day, items, retry, cls,
                                        shown, shown_at from bot.sessions where sid = ''b6000000''')$q$,
                               array['23505'], 'a second open session (unique index)');
end
$t$;

-- ── 11. Refusals: a foreign sid, an old or future position, out of range, malformed data ──────────────────────────
do $t$
declare r jsonb; v jsonb;
begin
  perform pg_temp.check(public.bot_session_answer(3003, 'b6000000', 0, '{"i": 0}') ->> 'status' = 'not_found', 'a stranger presses S6');
  perform pg_temp.check(public.bot_session_answer(3001, 'b6000000', 0, '{"i": 0}') ->> 'status' = 'not_found', 'the author presses S6');
  perform pg_temp.check(public.bot_session_view(3001, 'b6000000') ->> 'status' = 'not_found'
                        and public.bot_session_resolve(3003, 'b6000000', 0, 'next') ->> 'status' = 'not_found'
                        and public.bot_session_finish(3003, 'b6000000') ->> 'status' = 'not_found'
                        and public.bot_session_move(3003, 'b6000000', 5) ->> 'status' = 'not_found'
                        and public.bot_key_doubt(3003, 'b6000000', 0) ->> 'status' = 'not_found', 'every call: someone else''s sid');
  perform pg_temp.check(public.bot_session_answer(3002, 'zzz', 0, '{"i": 0}') ->> 'status' = 'not_found'
                        and public.bot_session_answer(3002, 'b600000', 0, '{"i": 0}') ->> 'status' = 'not_found'
                        and public.bot_session_answer(3002, 'b6000009', 0, '{"i": 0}') ->> 'status' = 'not_found', 'unknown sids');
  perform pg_temp.check(public.bot_session_answer(9999, 'b6000000', 0, '{"i": 0}') ->> 'status' = 'unlinked'
                        and public.bot_session_view(9999, 'b6000000') ->> 'status' = 'unlinked'
                        and public.bot_session_answer(9999, null, null, '{"text": "x"}') ->> 'status' = 'unlinked', 'not linked');
  r := public.bot_session_answer(3002, 'b6000000', 2, '{"i": 0}');
  perform pg_temp.check(r ->> 'status' = 'old' and r -> 'answer' = 'null'::jsonb and (r -> 'view' ->> 'pos')::integer = 0,
                        'a future position: old', r - 'session');
  perform pg_temp.check(public.bot_session_answer(3002, 'b6000000', -1, '{"i": 0}') ->> 'status' = 'old'
                        and public.bot_session_answer(3002, 'b6000000', null, '{"i": 0}') ->> 'status' = 'old', 'odd positions');
  for v in select x from jsonb_array_elements('[{"i": 4}, {"i": 7}, {"i": 8}, {"i": "1"}, {"i": 1.5}, {"i": -1}, {"mask": 1},
                                                {"text": "Сетевой"}, {"i": 0, "dont_know": true}, {}, {"dont_know": false},
                                                {"dont_know": "true"}, [0], 0, "0"]'::jsonb) x loop
    r := public.bot_session_answer(3002, 'b6000000', 0, v);
    perform pg_temp.check(r ->> 'status' = 'invalid' and r ->> 'reason' = 'choice', 'malformed choice ' || v::text, r - 'session');
  end loop;
  perform pg_temp.check(public.bot_session_answer(3002, 'b6000000', 0, null) ->> 'reason' = 'choice', 'null choice');
  perform pg_temp.check(pg_temp.sq($q$select pending is null from bot.sessions where sid = 'b6000000'$q$) = 'true',
                        'refusals left nothing pending');
  perform pg_temp.check(public.bot_session_resolve(3002, 'b6000000', 0, 'jump') ->> 'reason' = 'action'
                        and public.bot_session_resolve(3002, 'b6000000', 0, 'misclick') ->> 'reason' = 'no_answer'
                        and public.bot_session_resolve(3002, 'b6000000', 0, 'next') ->> 'reason' = 'no_answer', 'resolve refusals');
  perform pg_temp.check(public.bot_session_answer(3003, null, null, '{"text": "32"}') ->> 'status' = 'no_question',
                        'a typed message without a session');
end
$t$;

-- ── 12. The site and the bot on one question: both rows, one state; the bot's answer is too early to count ────────
select pg_temp.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
do $t$
declare r jsonb;
begin
  r := public.record_test_answers(jsonb_build_array(jsonb_build_object('client_event_id', 'web:t5:0001',
         'item_id', pg_temp.c('net7'), 'chosen', 1, 'local_date', pg_temp.c('minsk'))));
  perform pg_temp.check(r -> 'results' -> 0 ->> 'status' = 'saved' and r -> 'results' -> 0 ->> 'step' = 'start',
                        'the site answers net7', r);
end
$t$;
select pg_temp.as_role('service_role');
do $t$
declare r jsonb; st jsonb;
begin
  r := public.bot_session_answer(3002, 'b6000000', 0, '{"i": 1}');
  perform pg_temp.check(r -> 'answer' ->> 'status' = 'saved' and r -> 'answer' ->> 'step' = 'too_early'
                        and r -> 'session' -> 'figure' ->> 'too_early' = '1'
                        and r -> 'session' -> 'figure' -> 'too_early_states' -> 0 ->> 'streak_day' = pg_temp.c('minsk'),
                        'the bot answers the same question: too early, both counted in the state', r);
  st := pg_temp.sj(format($q$select to_jsonb(s) from public.test_item_states s
                              where s.user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and s.item_id = %L$q$, pg_temp.c('net7')));
  perform pg_temp.check((st ->> 'seen')::integer = 2 and (st ->> 'right_count')::integer = 2
                        and pg_temp.rows_of('web:t5:0001') = 1 and pg_temp.rows_of('tg:b6000000:0') = 1,
                        'one state, two rows (site and bot)', st);
end
$t$;

-- ── 13. The author (a far zone): role owner, the local day of the link's zone, ms at most 180 s ──────────────────────
do $t$
declare r jsonb; a jsonb;
begin
  r := public.bot_session_start(3001, 'a7000000', pg_temp.u('c'), pg_temp.u('s2'), 'errors',
         pg_temp.sq0('[["db3",[0,1,2,3]],["db5",[0,1,2,3]]]'), 901);
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'session' ->> 'role' = 'owner' and r -> 'session' ->> 'kind' = 'errors'
                        and r -> 'session' ->> 'local_day' = pg_temp.c('far'), 'the author''s session', r - 'view');
  perform pg_temp.sx($q$update bot.sessions set shown_at[1] = now() - interval '10 minutes' where sid = 'a7000000'$q$);
  r := public.bot_session_answer(3001, 'a7000000', 0, '{"i": 1}');
  a := pg_temp.row_of('tg:a7000000:0');
  perform pg_temp.check((a ->> 'correct')::boolean and (a ->> 'ms')::integer = 180000 and a ->> 'local_date' = pg_temp.c('far')
                        and a ->> 'cls' = 'free' and a ->> 'user_id' = 'aaaaaaaa-0000-0000-0000-000000000001',
                        'ms capped at 180 s; local_date in the link''s zone (not UTC''s); no class → free', a);
  perform pg_temp.check((r -> 'view' ->> 'code')::boolean and r -> 'view' -> 'options' ->> 1 = 'public virtual void Draw()',
                        'the code question next', r -> 'view');
end
$t$;

-- ── 14. The figure: gained (two days), dropped (a miss of a counted question), the key's change on the review ─────
select pg_temp.as_role('postgres');
insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev, seen, right_count, wrong_count,
                                     first_seen_at, first_seen_day, last_answer_at, last_answer_day, last_result,
                                     streak_at, streak_day, named_at, clean_ok_at)
select 'bbbbbbbb-0000-0000-0000-000000000002', i.id, i.container_id, i.subject_id, i.rev, 1, 1, 0,
       now() - interval '21 hours', (select v::date from ctx where k = 'minsk') - 1,
       now() - interval '21 hours', (select v::date from ctx where k = 'minsk') - 1, 'right',
       now() - interval '21 hours', (select v::date from ctx where k = 'minsk') - 1, now() - interval '21 hours',
       now() - interval '21 hours'
  from public.test_items i where i.id = (select v::uuid from ctx where k = 'db3');
insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev, seen, right_count, wrong_count,
                                     first_seen_at, first_seen_day, last_answer_at, last_answer_day, last_result,
                                     streak_at, streak_day, two_days_at, two_days_day, named_at, clean_ok_at)
select 'bbbbbbbb-0000-0000-0000-000000000002', i.id, i.container_id, i.subject_id, i.rev, 2, 2, 0,
       now() - interval '3 days', (select v::date from ctx where k = 'minsk') - 3,
       now() - interval '2 days', (select v::date from ctx where k = 'minsk') - 2, 'right',
       now() - interval '3 days', (select v::date from ctx where k = 'minsk') - 3,
       now() - interval '2 days', (select v::date from ctx where k = 'minsk') - 2, now() - interval '2 days',
       now() - interval '2 days'
  from public.test_items i where i.id = (select v::uuid from ctx where k = 'db5');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_session_start(3002, 'b8000000', pg_temp.u('c'), pg_temp.u('s2'), 'plan',
         pg_temp.sq0('[["db3",[0,1,2,3]],["db5",[3,2,1,0]],["db1",[0,1,2,3]]]'), 1001, '{"in_plan": 13, "two_days": 5}');
  r := public.bot_session_answer(3002, 'b8000000', 0, '{"i": 1}');
  perform pg_temp.check(r -> 'answer' ->> 'step' = 'two_days' and r -> 'answer' -> 'figure' ->> 'now' = '6'
                        and r -> 'answer' -> 'figure' ->> 'in_plan' = '13' and r -> 'answer' -> 'figure' ->> 'gained' = '1',
                        'two days: «Теперь 6 из 13»', r -> 'answer');
  r := public.bot_session_answer(3002, 'b8000000', 1, '{"i": 0}');   -- private void Draw(): wrong
  r := public.bot_session_resolve(3002, 'b8000000', 1, 'next',
         pg_temp.q('[["db3",0],["db5",0],["db1",0],["db5",1,[0,1,2,3]]]'));
  perform pg_temp.check(r -> 'answer' ->> 'step' = 'miss' and r -> 'session' -> 'figure' ->> 'dropped' = '1'
                        and r -> 'session' -> 'figure' ->> 'now' = '5', 'a counted question missed: dropped', r -> 'session');
  -- № 57 had its key changed by the author: its review names the change
  r := public.bot_session_answer(3002, 'b8000000', 2, '{"i": 0}');
  perform pg_temp.check(r -> 'view' -> 'review' ->> 'key_changed_at' is not null and r -> 'view' -> 'review' ->> 'key_source' = 'manual'
                        and r -> 'view' -> 'review' -> 'key' = '[2]'::jsonb, 'the review: «Ключ исправлен автором …»', r -> 'view');
end
$t$;

-- ── 15. A session's day: closed after midnight unless still active; «Продолжить» only on its own day ──────────────
do $t$
declare r jsonb;
begin
  -- S8 waits with an answer; it is from yesterday and idle for 2 hours: the next call closes it, the answer recorded
  perform pg_temp.sx($q$update bot.sessions set local_day = local_day - 1, active_at = now() - interval '2 hours'
                         where sid = 'b8000000'$q$);
  r := public.bot_session_view(3002, 'b8000000');
  perform pg_temp.check(r ->> 'status' = 'ended' and r -> 'session' ->> 'status' = 'abandoned', 'yesterday, idle: ended', r);
  perform pg_temp.check(pg_temp.rows_of('tg:b8000000:2') = 1, 'yesterday, idle: the waiting answer recorded as given');
  -- S9 is from yesterday but active 5 minutes ago: answers go on; «Продолжить» is refused
  r := public.bot_session_start(3002, 'b9000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
         pg_temp.sq0('[["net1",[0,1,2,3,4]],["net4",[0,1,2,3]]]'), 1101);
  perform pg_temp.sx($q$update bot.sessions set local_day = local_day - 1, active_at = now() - interval '5 minutes'
                         where sid = 'b9000000'$q$);
  r := public.bot_session_answer(3002, 'b9000000', 0, '{"i": 2}');
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'answer' ->> 'status' = 'saved', 'past midnight, active: goes on', r - 'session');
  r := public.bot_session_move(3002, 'b9000000', 1102);
  perform pg_temp.check(r ->> 'status' = 'ended', '«Продолжить» on another day: ended', r);
end
$t$;

-- ── 16. The tick's flush closes stale sessions; a link that ended records nothing; closed sessions go after 30 days ─
do $t$
declare r jsonb;
begin
  -- B: S10 waits with an answer (fresh), from yesterday and idle: closed by the flush, the answer recorded
  r := public.bot_session_start(3002, 'ba000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
         pg_temp.sq0('[["net6",[0,1,2,3]],["net8",[0,1,2,3]]]'), 1201);
  r := public.bot_session_answer(3002, 'ba000000', 0, '{"i": 0}');
  perform pg_temp.sx($q$update bot.sessions set local_day = local_day - 1, active_at = now() - interval '1 hour'
                         where sid = 'ba000000'$q$);
  -- E: S11 waits with an answer older than 30 minutes, then E's Telegram is disconnected (/stop)
  r := public.bot_session_start(3005, 'bb000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
         pg_temp.sq0('[["net6",[0,1,2,3]]]'), 1301);
  perform pg_temp.check(r ->> 'status' = 'ok', 'start S11 (E)', r);
  r := public.bot_session_answer(3005, 'bb000000', 0, '{"i": 0}');
  perform pg_temp.check(r -> 'answer' ->> 'status' = 'pending', 'E wrong');
  perform pg_temp.sx($q$update bot.sessions set pending_at = now() - interval '31 minutes' where sid = 'bb000000'$q$);
  perform public.bot_chat_event(3005, 'stop');
  -- a session closed 31 days ago goes
  perform pg_temp.sx($q$update bot.sessions set finished_at = now() - interval '31 days' where sid = 'b2000000'$q$);
  perform pg_temp.sx($q$update bot.sessions set finished_at = now() - interval '29 days' where sid = 'b4000000'$q$);
  r := public.bot_flush_pending();
  perform pg_temp.check((r ->> 'flushed')::integer = 1 and (r ->> 'closed')::integer = 1 and (r ->> 'deleted')::integer = 1,
                        'flush: one pending (E), one closed (S10), one deleted (S2)', r);
  perform pg_temp.check(pg_temp.sq($q$select status from bot.sessions where sid = 'ba000000'$q$) = 'abandoned'
                        and pg_temp.rows_of('tg:ba000000:0') = 1, 'flush: S10 closed, its answer recorded');
  perform pg_temp.check(pg_temp.sq($q$select status from bot.sessions where sid = 'bb000000'$q$) = 'abandoned'
                        and pg_temp.rows_of('tg:bb000000:0') = 0, 'flush: a disconnected Telegram records nothing');
  perform pg_temp.check(pg_temp.sq($q$select count(*) from bot.sessions where sid = 'b2000000'$q$) = '0'
                        and pg_temp.sq($q$select count(*) from bot.sessions where sid in ('b3000000', 'b4000000')$q$) = '2',
                        'housekeeping: only sessions closed 30 days ago');
  perform pg_temp.check(public.bot_session_view(3005, 'bb000000') ->> 'status' = 'unlinked', 'E: unlinked');
end
$t$;

-- ── 17. «Закончить» with nothing answered: abandoned; «Закончить» with a waiting answer: recorded, open ─────────────
do $t$
declare r jsonb;
begin
  r := public.bot_session_start(3002, 'bc000000', pg_temp.u('c'), pg_temp.u('s1'), 'extra',
         pg_temp.sq0('[["net6",[0,1,2,3]],["net7",[0,1,2,3]]]'), 1401);
  r := public.bot_session_finish(3002, 'bc000000');
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'session' ->> 'status' = 'abandoned', 'nothing answered: abandoned', r);
  perform pg_temp.check(public.bot_today(3002) -> 'session' = 'null'::jsonb, 'nothing open after it');
  r := public.bot_session_start(3002, 'bd000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
         pg_temp.sq0('[["net6",[0,1,2,3]],["net7",[0,1,2,3]],["net8",[0,1,2,3]]]'), 1501);
  r := public.bot_session_answer(3002, 'bd000000', 0, '{"i": 1}');
  r := public.bot_session_answer(3002, 'bd000000', 1, '{"i": 0}');
  perform pg_temp.check(r -> 'answer' ->> 'status' = 'pending', 'bd wrong waits');
  r := public.bot_session_finish(3002, 'bd000000');
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'answer' ->> 'status' = 'saved' and r -> 'session' ->> 'status' = 'open'
                        and (r -> 'session' ->> 'position')::integer = 2 and r -> 'session' -> 'counts' ->> 'questions' = '2'
                        and (r -> 'view' ->> 'pos')::integer = 2, '«Закончить»: the waiting answer recorded, open for later', r);
  perform pg_temp.check(pg_temp.rows_of('tg:bd000000:1') = 1, '«Закончить»: the row');
  r := public.bot_session_move(3002, 'bd000000', 1501);
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'prev_message_id' = 'null'::jsonb and (r -> 'view' ->> 'pos')::integer = 2,
                        '«Продолжить» in the summary''s own message', r - 'session');
end
$t$;

-- ── 18. The exam taken away: unavailable, closed, nothing recorded ───────────────────────────────────────────────────
do $t$
declare r jsonb;
begin
  r := public.bot_session_answer(3002, 'bd000000', 2, '{"i": 3}');   -- wrong: waits
  perform pg_temp.check(r -> 'answer' ->> 'status' = 'pending', 'bd waits again');
end
$t$;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$ begin
  perform public.container_member_remove(pg_temp.u('c'), 'bbbbbbbb-0000-0000-0000-000000000002');
end $t$;
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_session_resolve(3002, 'bd000000', 2, 'next');
  perform pg_temp.check(r ->> 'status' = 'unavailable' and r ->> 'exam_title' = 'Осенняя сессия'
                        and r -> 'session' ->> 'status' = 'abandoned', 'removed from the group: unavailable', r);
  perform pg_temp.check(pg_temp.rows_of('tg:bd000000:2') = 0, 'unavailable: nothing recorded');
  perform pg_temp.check(public.bot_session_start(3002, 'be000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan',
                          pg_temp.sq0('[["net6",[0,1,2,3]]]')) ->> 'status' = 'unavailable', 'start: not a member any more');
end
$t$;

-- ── 19. A session replaced after its Telegram was swapped: the old link ended, so its waiting answer is not recorded ─
select pg_temp.as_role('postgres');
insert into bot.links (user_id, tg_user_id, chat_id, tz) values ('eeeeeeee-0000-0000-0000-000000000005', 3006, 3006, 'Europe/Minsk');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_session_start(3006, 'bf000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan', pg_temp.sq0('[["net6",[0,1,2,3]]]'), 1601);
  perform pg_temp.check(public.bot_session_answer(3006, 'bf000000', 0, '{"i": 0}') -> 'answer' ->> 'status' = 'pending', 'E waits');
  -- E links another Telegram (the newest link wins: the old one ends)
  perform pg_temp.sx($q$update bot.links set unlinked_at = now() where tg_user_id = 3006 and unlinked_at is null$q$);
  perform pg_temp.sx($q$insert into bot.links (user_id, tg_user_id, chat_id, tz)
                        values ('eeeeeeee-0000-0000-0000-000000000005', 3007, 3007, 'Europe/Minsk')$q$);
  perform pg_temp.check(public.bot_session_answer(3006, 'bf000000', 0, '{"i": 1}') ->> 'status' = 'unlinked', 'the old Telegram');
  r := public.bot_session_start(3007, 'bg000000', pg_temp.u('c'), pg_temp.u('s1'), 'plan', pg_temp.sq0('[["net7",[0,1,2,3]]]'), 1701);
  perform pg_temp.check(r ->> 'status' = 'ok' and r -> 'replaced' ->> 'sid' = 'bf000000'
                        and (r -> 'replaced' ->> 'chat_id')::bigint = 3006, 'the new Telegram replaces it', r - 'view');
  perform pg_temp.check(pg_temp.rows_of('tg:bf000000:0') = 0, 'replaced after the link ended: nothing recorded');
end
$t$;

-- ── 20. The tick's hook uses its index ───────────────────────────────────────────────────────────────────────────────
select pg_temp.as_role('postgres');
set local enable_seqscan = off;
create temp table t5_plan (line text);
do $t$
declare l text;
begin
  for l in execute $q$explain (costs off) select exists (select 1 from bot.sessions s where s.pending_at < now() - interval '30 minutes')$q$ loop
    insert into t5_plan values (l);
  end loop;
  perform pg_temp.check(exists (select 1 from t5_plan where line like '%sessions_flush_idx%'),
                        'tick_due_sessions: an index scan on sessions_flush_idx', (select jsonb_agg(line) from t5_plan));
end
$t$;
reset enable_seqscan;

do $t$ begin raise notice 'TELEGRAM BOT SESSIONS CHECKS PASSED'; end $t$;
rollback;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Part 2. True concurrency (separate connections through dblink): a double tap, the flush racing «Дальше» both ways,
-- the site and the bot on one question at the same moment. The fixtures are committed under a fresh account (U =
-- 7e57…) and deleted at the end (its exam, answers, link and session go with it by ON DELETE CASCADE). Every change the
-- other connections must see is made through the autocommitting connection t5c, never inside this DO block's own
-- transaction (its locks would stop them).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP 1
select exists (select 1 from pg_available_extensions where name = 'dblink') as t5_dblink,
       not exists (select 1 from pg_extension where extname = 'dblink') as t5_own_dblink \gset
\if :t5_dblink
create extension if not exists dblink;
insert into auth.users (id) values ('7e570000-0000-4000-8000-000000000001') on conflict do nothing;
insert into bot.links (user_id, tg_user_id, chat_id, tz) values ('7e570000-0000-4000-8000-000000000001', 7001, 7001, 'Europe/Minsk');
create temp table t5c (k text primary key, v text);
grant all on t5c to authenticated;
set request.jwt.claim.sub = '7e570000-0000-4000-8000-000000000001';
set request.jwt.claims = '{"role": "authenticated", "sub": "7e570000-0000-4000-8000-000000000001"}';
set role authenticated;
do $t$
declare r jsonb;
begin
  r := public.container_create('Осенняя сессия', (now() at time zone 'utc')::date + 24, '[{"title":"Компьютерные сети"}]');
  insert into t5c values ('c', r ->> 'container_id'), ('s', r -> 'subjects' -> 0 ->> 'id');
  r := public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, '[
    {"ref":"cc:1","file_no":"1","stem":"Какой протокол передаёт веб-страницы в зашифрованном виде?","options":["HTTP","FTP","HTTPS","SMTP","Telnet"],"correct":[2],"key_source":"bold"},
    {"ref":"cc:2","file_no":"2","stem":"Какой протокол выдаёт устройству IP-адрес при подключении к сети?","options":["DNS","DHCP","ARP","NAT"],"correct":[1],"key_source":"bold"},
    {"ref":"cc:3","file_no":"3","stem":"Какой порт по умолчанию у HTTPS?","options":["80","443","21","25"],"correct":[1],"key_source":"bold"},
    {"ref":"cc:4","file_no":"4","stem":"Что делает служба DNS?","options":["Находит IP-адрес по имени","Шифрует трафик","Выдаёт IP-адреса","Передаёт почту"],"correct":[0],"key_source":"bold"}]');
  insert into t5c select 'i' || (x.o)::text, x.e ->> 'id' from jsonb_array_elements(r -> 'items') with ordinality x(e, o);
end
$t$;
reset role;
reset request.jwt.claims;
reset request.jwt.claim.sub;
-- A regression must fail here, not hang: each connection waits at most 10 s for a lock.
set statement_timeout = '120s';
do $t$
declare
  v_conn text := format('host=127.0.0.1 port=%s dbname=%s user=postgres', current_setting('port'), current_database());
  v_svc text := $s$set lock_timeout = '10s'; set statement_timeout = '30s'; set role service_role;
                   set request.jwt.claims = '{"role": "service_role"}'$s$;
  v_q2 text;
  v_q3 text;
  r jsonb;
begin
  perform dblink_connect('t5a', v_conn);
  perform dblink_connect('t5b', v_conn);
  perform dblink_connect('t5c', v_conn);
  perform dblink_exec('t5c', $s$set lock_timeout = '10s'; set statement_timeout = '30s'$s$);
  perform dblink_exec('t5a', v_svc);
  perform dblink_exec('t5b', v_svc);
  r := (select x from dblink('t5a', format($q$select public.bot_session_start(7001, 'cc000000', %L, %L, 'plan', %L::jsonb, 7101)$q$,
         (select v from t5c where k = 'c'), (select v from t5c where k = 's'),
         jsonb_build_array(jsonb_build_object('id', (select v from t5c where k = 'i1'), 'shown', '[0,1,2,3,4]'::jsonb),
                           jsonb_build_object('id', (select v from t5c where k = 'i2'), 'shown', '[0,1,2,3]'::jsonb),
                           jsonb_build_object('id', (select v from t5c where k = 'i3'), 'shown', '[0,1,2,3]'::jsonb),
                           jsonb_build_object('id', (select v from t5c where k = 'i4'), 'shown', '[0,1,2,3]'::jsonb))::text))
       as t(x jsonb));
  if r ->> 'status' <> 'ok' then raise exception 'FAILED: concurrency: start %', r; end if;

  -- 1. A double tap on two workers: the first holds the session, the second waits, then finds its question closed.
  perform dblink_exec('t5a', 'begin');
  r := (select x from dblink('t5a', $q$select public.bot_session_answer(7001, 'cc000000', 0, '{"i": 2}')$q$) as t(x jsonb));
  if r -> 'answer' ->> 'status' <> 'saved' then raise exception 'FAILED: concurrency: first tap %', r; end if;
  perform dblink_send_query('t5b', $q$select public.bot_session_answer(7001, 'cc000000', 0, '{"i": 0}')$q$);
  perform pg_sleep(0.3);
  if dblink_is_busy('t5b') <> 1 then raise exception 'FAILED: concurrency: the second tap did not wait for the first'; end if;
  perform dblink_exec('t5a', 'commit');
  r := (select x from dblink_get_result('t5b') as t(x jsonb));
  perform * from dblink_get_result('t5b') as t(x jsonb);
  if r ->> 'status' <> 'old' or r -> 'answer' ->> 'status' <> 'duplicate' then
    raise exception 'FAILED: concurrency: the second tap %', r;
  end if;
  if (select count(*) from public.test_answers where client_event_id = 'tg:cc000000:0') <> 1
     or (select chosen::text from public.test_answers where client_event_id = 'tg:cc000000:0') <> '{2}' then
    raise exception 'FAILED: concurrency: a double tap left more than the first answer';
  end if;

  -- 2. The flush racing «Дальше»: the flush holds the session, «Дальше» waits, then moves on without a second row.
  r := (select x from dblink('t5a', $q$select public.bot_session_answer(7001, 'cc000000', 1, '{"i": 0}')$q$) as t(x jsonb));
  if r -> 'answer' ->> 'status' <> 'pending' then raise exception 'FAILED: concurrency: pending %', r; end if;
  perform dblink_exec('t5c', $q$update bot.sessions set pending_at = now() - interval '31 minutes' where sid = 'cc000000'$q$);
  v_q2 := format($q$select public.bot_session_resolve(7001, 'cc000000', 1, 'next', %L::jsonb)$q$,
    jsonb_build_array(jsonb_build_object('id', (select v from t5c where k = 'i1'), 'retry', 0),
                      jsonb_build_object('id', (select v from t5c where k = 'i2'), 'retry', 0),
                      jsonb_build_object('id', (select v from t5c where k = 'i3'), 'retry', 0),
                      jsonb_build_object('id', (select v from t5c where k = 'i4'), 'retry', 0),
                      jsonb_build_object('id', (select v from t5c where k = 'i2'), 'retry', 1, 'shown', '[3,2,1,0]'::jsonb))::text);
  perform dblink_exec('t5a', 'begin');
  r := (select x from dblink('t5a', $q$select public.bot_flush_pending()$q$) as t(x jsonb));
  if (r ->> 'flushed')::integer <> 1 then raise exception 'FAILED: concurrency: flush %', r; end if;
  perform dblink_send_query('t5b', v_q2);
  perform pg_sleep(0.3);
  if dblink_is_busy('t5b') <> 1 then raise exception 'FAILED: concurrency: «Дальше» did not wait for the flush'; end if;
  perform dblink_exec('t5a', 'commit');
  r := (select x from dblink_get_result('t5b') as t(x jsonb));
  perform * from dblink_get_result('t5b') as t(x jsonb);
  if r ->> 'status' <> 'ok' or r -> 'answer' <> 'null'::jsonb or (r -> 'view' ->> 'pos')::integer <> 2 then
    raise exception 'FAILED: concurrency: «Дальше» after the flush %', r;
  end if;
  if (select count(*) from public.test_answers where client_event_id = 'tg:cc000000:1') <> 1 then
    raise exception 'FAILED: concurrency: flush and «Дальше» left two rows';
  end if;

  -- 3. «Дальше» holds the session: the flush skips it without waiting; one row.
  r := (select x from dblink('t5a', $q$select public.bot_session_answer(7001, 'cc000000', 2, '{"i": 0}')$q$) as t(x jsonb));
  if r -> 'answer' ->> 'status' <> 'pending' then raise exception 'FAILED: concurrency: pending 2 %', r; end if;
  perform dblink_exec('t5c', $q$update bot.sessions set pending_at = now() - interval '31 minutes' where sid = 'cc000000'$q$);
  v_q3 := format($q$select public.bot_session_resolve(7001, 'cc000000', 2, 'next', %L::jsonb)$q$,
    jsonb_build_array(jsonb_build_object('id', (select v from t5c where k = 'i1'), 'retry', 0),
                      jsonb_build_object('id', (select v from t5c where k = 'i2'), 'retry', 0),
                      jsonb_build_object('id', (select v from t5c where k = 'i3'), 'retry', 0),
                      jsonb_build_object('id', (select v from t5c where k = 'i4'), 'retry', 0),
                      jsonb_build_object('id', (select v from t5c where k = 'i2'), 'retry', 1, 'shown', '[3,2,1,0]'::jsonb),
                      jsonb_build_object('id', (select v from t5c where k = 'i3'), 'retry', 1, 'shown', '[3,2,1,0]'::jsonb))::text);
  perform dblink_exec('t5a', 'begin');
  r := (select x from dblink('t5a', v_q3) as t(x jsonb));
  if r ->> 'status' <> 'ok' then raise exception 'FAILED: concurrency: «Дальше» %', r; end if;
  r := (select x from dblink('t5b', $q$select public.bot_flush_pending()$q$) as t(x jsonb));
  if (r ->> 'flushed')::integer <> 0 then raise exception 'FAILED: concurrency: the flush took a held session %', r; end if;
  perform dblink_exec('t5a', 'commit');
  if (select count(*) from public.test_answers where client_event_id = 'tg:cc000000:2') <> 1 then
    raise exception 'FAILED: concurrency: «Дальше» and the flush left two rows';
  end if;

  -- 4. The site and the bot on one question at the same moment: the site holds its state, the bot waits; both rows.
  perform dblink_exec('t5b', $q$reset role; set role authenticated;
    set request.jwt.claim.sub = '7e570000-0000-4000-8000-000000000001';
    set request.jwt.claims = '{"role": "authenticated", "sub": "7e570000-0000-4000-8000-000000000001"}'$q$);
  perform dblink_exec('t5b', 'begin');
  r := (select x from dblink('t5b', format($q$select public.record_test_answers(%L::jsonb)$q$,
         jsonb_build_array(jsonb_build_object('client_event_id', 'web:t5c:0001', 'item_id', (select v from t5c where k = 'i4'),
                                              'chosen', 0))::text)) as t(x jsonb));
  if r -> 'results' -> 0 ->> 'status' <> 'saved' then raise exception 'FAILED: concurrency: the site %', r; end if;
  perform dblink_send_query('t5a', $q$select public.bot_session_answer(7001, 'cc000000', 3, '{"i": 0}')$q$);
  perform pg_sleep(0.3);
  if dblink_is_busy('t5a') <> 1 then raise exception 'FAILED: concurrency: the bot did not wait for the site'; end if;
  perform dblink_exec('t5b', 'commit');
  r := (select x from dblink_get_result('t5a') as t(x jsonb));
  perform * from dblink_get_result('t5a') as t(x jsonb);
  if r -> 'answer' ->> 'status' <> 'saved' or r -> 'answer' ->> 'step' <> 'too_early' then
    raise exception 'FAILED: concurrency: the bot after the site %', r;
  end if;
  if (select row(s.seen, s.right_count)::text from public.test_item_states s
       where s.user_id = '7e570000-0000-4000-8000-000000000001' and s.item_id = (select v::uuid from t5c where k = 'i4')) <> '(2,2)'
     or (select count(*) from public.test_answers where client_event_id in ('web:t5c:0001', 'tg:cc000000:3')) <> 2 then
    raise exception 'FAILED: concurrency: the site and the bot on one question';
  end if;

  perform dblink_disconnect('t5a');
  perform dblink_disconnect('t5b');
  perform dblink_disconnect('t5c');
  raise notice 'TELEGRAM BOT SESSIONS CONCURRENCY PASSED';
end
$t$;
reset statement_timeout;
delete from auth.users where id = '7e570000-0000-4000-8000-000000000001';
\if :t5_own_dblink
drop extension if exists dblink;
\endif
\else
\echo 'dblink is not available: the concurrency part is skipped'
\endif
