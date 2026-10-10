-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of the bot's database core (package T1:
-- supabase/migrations/20261010120000_telegram_bot.sql, _cron.sql, _revokes.sql) on the scratch database of
-- telegram_bot_run.sh, on top of the exam container's migrations. Spec §8.2 «Контракт» and «Привязка» entirely, plus
-- the update ledger, the bot's settings, /today and the day's messages, setup / status / the tick and the housekeeping;
-- section 1 confirms spec §6.8 (what the bot takes from the container) for a service-role caller.
-- One transaction, rolled back. A failure raises (FAILED: …); success prints TELEGRAM BOT CHECKS PASSED. Roles: anon,
-- authenticated (request.jwt.claim.sub) and service_role as PostgREST sets them (request.jwt.claims); postgres for
-- fixtures and for pg_cron's bot.tick(). Runs under both grant modes (before and after *_telegram_bot_revokes.sql).
-- Reminders, K2, K3 and the night's close: telegram_bot_claims.sql.
\set ON_ERROR_STOP 1
begin;

-- Helpers.
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
-- The caller as PostgREST presents it: a JWT role (claims) and, for a signed-in user, the subject.
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
-- Assertions and fixture changes that read or write schema bot directly run as the migration role (the API roles have
-- no way into it): sq returns one value as text, sx runs a statement.
create or replace function pg_temp.sq(p_sql text) returns text
language plpgsql security definer set search_path = '' as $fn$
declare v text;
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
grant all on ctx to anon, authenticated, service_role;
grant execute on function pg_temp.expect_error(text, text[], text), pg_temp.as_role(text, uuid), pg_temp.put(text, text),
  pg_temp.c(text), pg_temp.sq(text), pg_temp.sx(text) to anon, authenticated, service_role;

-- What a bot_* function of a later package does with the container's cores (SECURITY DEFINER, owned by the migration
-- role, the service-role gate first, the user resolved by the bot): §6.8 is checked through these wrappers.
create or replace function pg_temp.svc_record(p_user uuid, p_answers jsonb, p_source text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  perform meldy_private.require_service_role();
  return meldy_private.record_test_answers_for(p_user, p_answers, p_source, 50);
end;
$fn$;
create or replace function pg_temp.svc_doubt(p_user uuid, p_item uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  perform meldy_private.require_service_role();
  return meldy_private.test_key_doubt_for(p_user, p_item, '[]'::jsonb, 'из бота');
end;
$fn$;
create or replace function pg_temp.svc_reads(p_user uuid, p_container uuid, p_day date) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  perform meldy_private.require_service_role();
  return pg_catalog.jsonb_build_object(
    'role', meldy_private.role_in(p_user, p_container),
    'plan', meldy_private.plan_inputs_for(p_user, p_day),
    'overview', meldy_private.containers_overview_for(p_user, p_day),
    'summary', meldy_private.container_summary_for(p_user, p_container, p_day));
end;
$fn$;
grant execute on function pg_temp.svc_record(uuid, jsonb, text), pg_temp.svc_doubt(uuid, uuid),
  pg_temp.svc_reads(uuid, uuid, date) to service_role;

-- Accounts: A author, B member, C stranger (the container's baseline); U1…U9 for linking.
insert into auth.users (id) select ('b0700000-0000-4000-8000-00000000000' || g)::uuid from generate_series(1, 9) g
on conflict do nothing;

-- 0. The exam «Осенняя сессия» (spec §3's invented example): A's container with two subjects and three questions of the
--    spec, a group link, B joined.
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$
declare r jsonb;
begin
  r := public.container_create('Осенняя сессия', (now() at time zone 'utc')::date + 24,
                               '[{"title":"Компьютерные сети"},{"title":"Базы данных"}]');
  perform pg_temp.put('c', r ->> 'container_id');
  perform pg_temp.put('s1', r -> 'subjects' -> 0 ->> 'id');
  perform pg_temp.put('s2', r -> 'subjects' -> 1 ->> 'id');
  perform public.container_items_add(pg_temp.c('s1')::uuid, '[
    {"ref":"net:1","file_no":"12","topic":1,"stem":"Какой протокол передаёт веб-страницы в зашифрованном виде?","options":["HTTP","FTP","HTTPS","SMTP","Telnet"],"correct":[2],"key_source":"bold"},
    {"ref":"net:2","file_no":"13","topic":1,"stem":"Какие адреса относятся к частным диапазонам IPv4?","options":["10.4.0.9","172.20.1.1","192.168.3.7","8.8.4.4"],"correct":[0,1,2],"key_source":"bold"},
    {"ref":"net:3","file_no":"14","topic":1,"kind":"short","stem":"Сколько бит в адресе IPv4?","answers":["32"],"key_source":"answer_line"}]');
  perform public.container_items_add(pg_temp.c('s2')::uuid, '[
    {"ref":"db:1","file_no":"57","topic":3,"stem":"Что гарантирует изолированность — буква I в ACID?","options":["Изменения завершённой транзакции сохраняются даже после сбоя","Параллельные транзакции не видят промежуточных изменений друг друга","Транзакция выполняется целиком или не выполняется совсем","После транзакции данные удовлетворяют всем ограничениям целостности"],"correct":[1],"key_source":"bold"}]');
  r := public.container_link_create(pg_temp.c('c')::uuid, 60);
  perform pg_temp.put('code', r ->> 'code');
end
$t$;
select pg_temp.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
do $t$
begin
  if not (public.container_join(pg_temp.c('code')) ->> 'joined')::boolean then raise exception 'FAILED: B did not join'; end if;
end
$t$;
select pg_temp.as_role('postgres');
select pg_temp.put('net1', (select id::text from public.test_items where import_ref = 'net:1'));
select pg_temp.put('net2', (select id::text from public.test_items where import_ref = 'net:2'));
select pg_temp.put('net3', (select id::text from public.test_items where import_ref = 'net:3'));
select pg_temp.put('db1', (select id::text from public.test_items where import_ref = 'db:1'));

-- 1. Spec §6.8: the container's cores, as the bot's DEFINER functions call them for a service-role request.
select pg_temp.as_role('service_role');
do $t$
declare
  A constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  B constant uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  C constant uuid := 'cccccccc-0000-0000-0000-000000000003';
  today date := (now() at time zone 'utc')::date;
  r jsonb; x jsonb;
begin
  -- the service role itself has no way into meldy_private: only through a DEFINER function
  perform pg_temp.expect_error(format('select meldy_private.role_in(%L, %L)', B, pg_temp.c('c')), array['42501'],
                               'service_role calls a core directly');
  -- record_test_answers_for: source bot, a right answer saved with the bot's client_event_id
  r := pg_temp.svc_record(B, jsonb_build_array(jsonb_build_object('client_event_id', 'tg:k7m2p9qa:0',
         'item_id', pg_temp.c('net1'), 'chosen', 2, 'local_date', to_char(today, 'YYYY-MM-DD'), 'ms', 4000,
         'cls', 'new_floor', 'retry', false)), 'bot');
  x := r -> 'results' -> 0;
  if x ->> 'status' <> 'saved' or not (x ->> 'correct')::boolean or x ->> 'step' <> 'start' then
    raise exception 'FAILED: §6.8 record (bot) %', r; end if;
  if (select row(source, ms, cls, local_date) from public.test_answers where user_id = B and client_event_id = 'tg:k7m2p9qa:0')
     is distinct from row('bot'::text, 4000, 'new_floor'::text, today) then
    raise exception 'FAILED: §6.8 the log row of the bot answer'; end if;
  -- a replay of the same press: duplicate, no second row
  r := pg_temp.svc_record(B, jsonb_build_array(jsonb_build_object('client_event_id', 'tg:k7m2p9qa:0',
         'item_id', pg_temp.c('net1'), 'chosen', 2)), 'bot');
  if r -> 'results' -> 0 ->> 'status' <> 'duplicate'
     or (select count(*) from public.test_answers where user_id = B and client_event_id = 'tg:k7m2p9qa:0') <> 1 then
    raise exception 'FAILED: §6.8 replay %', r; end if;
  -- «Не знаю» pressed by mistake: misclick accepted for chosen = null (spec §6.8), a peek today, wrong stays 0
  r := pg_temp.svc_record(B, jsonb_build_array(jsonb_build_object('client_event_id', 'tg:k7m2p9qa:1',
         'item_id', pg_temp.c('db1'), 'chosen', null, 'misclick', true, 'local_date', to_char(today, 'YYYY-MM-DD'))), 'bot');
  if r -> 'results' -> 0 ->> 'status' <> 'saved' or r -> 'results' -> 0 ->> 'step' <> 'misclick' then
    raise exception 'FAILED: §6.8 misclick on «Не знаю» %', r; end if;
  if (select row(wrong_count, peek_day, last_result) from public.test_item_states where user_id = B and item_id = pg_temp.c('db1')::uuid)
     is distinct from row(0, today, null::text) then
    raise exception 'FAILED: §6.8 misclick state'; end if;
  -- a group answer: source bot_group with the post key
  r := pg_temp.svc_record(B, jsonb_build_array(jsonb_build_object('client_event_id', 'tgq:1a:3002',
         'item_id', pg_temp.c('net2'), 'chosen', jsonb_build_array(0, 1, 2))), 'bot_group');
  if r -> 'results' -> 0 ->> 'status' <> 'saved' or not (r -> 'results' -> 0 ->> 'correct')::boolean
     or (select source from public.test_answers where user_id = B and client_event_id = 'tgq:1a:3002') <> 'bot_group' then
    raise exception 'FAILED: §6.8 bot_group %', r; end if;
  -- a stranger's answer is gone; an answer to an older rev is stale; an unknown source is refused
  r := pg_temp.svc_record(C, jsonb_build_array(jsonb_build_object('client_event_id', 'tg:zzzzzzzz:0',
         'item_id', pg_temp.c('net1'), 'chosen', 2)), 'bot');
  if r -> 'results' -> 0 ->> 'status' <> 'gone' then raise exception 'FAILED: §6.8 stranger %', r; end if;
  r := pg_temp.svc_record(B, jsonb_build_array(jsonb_build_object('client_event_id', 'tg:k7m2p9qa:2',
         'item_id', pg_temp.c('net1'), 'chosen', 2, 'rev', 99)), 'bot');
  if r -> 'results' -> 0 ->> 'status' <> 'stale' then raise exception 'FAILED: §6.8 stale %', r; end if;
  perform pg_temp.expect_error(format($$select pg_temp.svc_record(%L, '[{"client_event_id":"tg:x0000000:0","item_id":"%s","chosen":1}]', 'telegram')$$,
                                      B, pg_temp.c('net1')), array['22023'], '§6.8 an unknown source');
  -- test_key_doubt_for: a member's doubt opens; a stranger's is not found
  r := pg_temp.svc_doubt(B, pg_temp.c('net3')::uuid);
  if r <> jsonb_build_object('item_id', pg_temp.c('net3'), 'open', true) then raise exception 'FAILED: §6.8 doubt %', r; end if;
  perform pg_temp.expect_error(format('select pg_temp.svc_doubt(%L, %L)', C, pg_temp.c('net3')), array['P0002'],
                               '§6.8 a stranger''s doubt');
  -- the reads: role_in, plan_inputs_for (doubted items left out), containers_overview_for, container_summary_for
  r := pg_temp.svc_reads(B, pg_temp.c('c')::uuid, today);
  if r ->> 'role' <> 'member' or r -> 'plan' -> 'containers' -> 0 ->> 'id' <> pg_temp.c('c')
     or r -> 'plan' -> 'containers' -> 0 ->> 'role' <> 'member' or jsonb_array_length(r -> 'plan' -> 'items') <> 3
     or r -> 'overview' -> 'containers' -> 0 ->> 'role' <> 'member' or r -> 'summary' ->> 'role' <> 'member'
     or (r -> 'plan' ->> 'day')::date <> today then
    raise exception 'FAILED: §6.8 reads for the member %', r - 'plan'; end if;
  r := pg_temp.svc_reads(A, pg_temp.c('c')::uuid, today);
  if r ->> 'role' <> 'owner' or jsonb_array_length(r -> 'plan' -> 'items') <> 4 or r -> 'summary' ->> 'role' <> 'owner' then
    raise exception 'FAILED: §6.8 reads for the author %', r - 'plan'; end if;
  perform pg_temp.expect_error(format('select pg_temp.svc_reads(%L, %L, %L)', C, pg_temp.c('c'), today), array['P0002'],
                               '§6.8 a stranger''s summary');
end
$t$;
-- the gate itself: the service role passes, a client JWT does not, postgres without a JWT (pg_cron) passes
select pg_temp.as_role('anon');
do $t$ begin
  perform pg_temp.expect_error('select pg_temp.svc_reads(''bbbbbbbb-0000-0000-0000-000000000002'', null, current_date)',
                               array['42501'], '§6.8 anon through a bot function');
end $t$;
select pg_temp.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
do $t$ begin
  perform pg_temp.expect_error('select pg_temp.svc_reads(''bbbbbbbb-0000-0000-0000-000000000002'', null, current_date)',
                               array['42501'], '§6.8 a signed-in user through a bot function');
end $t$;
select pg_temp.as_role('postgres');
do $t$ begin
  perform meldy_private.require_service_role();   -- pg_cron's path: session user postgres, no JWT
end $t$;

-- 2. «Контракт»: every bot_* refuses anon and authenticated with 42501; anon reaches no telegram_* and nothing in
--    schema bot.
create temp table bot_calls (sql text);
insert into bot_calls values
  ($$select public.bot_setup('Meldyteach_bot', 1, repeat('x', 43), 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/telegram')$$),
  ($$select public.bot_update_begin(1)$$), ($$select public.bot_update_done(1)$$),
  ($$select public.bot_update_failed(1, 'Error')$$), ($$select public.bot_tick_beat('{}')$$), ($$select public.bot_status()$$),
  ($$select public.bot_link_claim('L' || repeat('0', 32), 1, 1, 'ru', now())$$), ($$select public.bot_chat_event(1, 'stop')$$),
  ($$select public.bot_whoami(1)$$), ($$select public.bot_settings(1, '{}')$$), ($$select public.bot_today(1)$$),
  ($$select public.bot_card_sent(1, 1, 'card')$$), ($$select * from public.bot_claim_reminders(1)$$),
  ($$select public.bot_reminder_context(1)$$), ($$select public.bot_delivery_sending(1)$$),
  ($$select public.bot_delivery_done(1, 'sent', 1, null)$$), ($$select * from public.bot_claim_day_close(1)$$),
  ($$select * from public.bot_claim_after_date(1)$$);
grant select on bot_calls to anon, authenticated;
select pg_temp.as_role('anon');
do $t$
declare q text;
begin
  for q in select sql from bot_calls loop
    perform pg_temp.expect_error(q, array['42501'], 'anon: ' || q);
  end loop;
  perform pg_temp.expect_error($$select public.telegram_link_start('Europe/Minsk')$$, array['28000', '42501'], 'anon: telegram_link_start');
  perform pg_temp.expect_error($$select public.telegram_link_state()$$, array['28000', '42501'], 'anon: telegram_link_state');
  perform pg_temp.expect_error($$select public.telegram_settings(true, '20:00', 'Europe/Minsk')$$, array['28000', '42501'], 'anon: telegram_settings');
  perform pg_temp.expect_error($$select public.telegram_unlink()$$, array['28000', '42501'], 'anon: telegram_unlink');
  perform pg_temp.expect_error('select bot.tick()', array['42501'], 'anon: bot.tick()');
  perform pg_temp.expect_error('select count(*) from bot.links', array['42501'], 'anon reads bot.links');
  perform pg_temp.expect_error('select count(*) from bot.config', array['42501'], 'anon reads bot.config');
end
$t$;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$
declare q text;
begin
  for q in select sql from bot_calls loop
    perform pg_temp.expect_error(q, array['42501'], 'authenticated: ' || q);
  end loop;
  perform pg_temp.expect_error('select bot.tick()', array['42501'], 'authenticated: bot.tick()');
  perform pg_temp.expect_error('select count(*) from bot.link_codes', array['42501'], 'authenticated reads bot.link_codes');
  perform pg_temp.expect_error('select count(*) from bot.deliveries', array['42501'], 'authenticated reads bot.deliveries');
  perform pg_temp.expect_error('insert into bot.links (user_id, tg_user_id, chat_id) values (auth.uid(), 5, 5)', array['42501'],
                               'authenticated writes bot.links');
end
$t$;

-- 3. «Привязка» (spec §4.1 M2/M5, §6.5, §8.2).
-- 3a. A code: L + 32 hex, 15 minutes, only its sha256 stored, the browser's zone kept; a bad zone is refused.
select pg_temp.as_role('authenticated', 'b0700000-0000-4000-8000-000000000001');
do $t$
declare r jsonb; v text;
begin
  r := public.telegram_link_state();
  if r <> jsonb_build_object('linked', false, 'bot_username', null) then raise exception 'FAILED: state before %', r; end if;
  r := public.telegram_link_start('Asia/Vladivostok');
  v := r ->> 'code';
  if v !~ '^L[0-9a-f]{32}$' or (r ->> 'expires_at')::timestamptz <> now() + interval '15 minutes' or r -> 'bot_username' <> 'null'::jsonb then
    raise exception 'FAILED: link code %', r; end if;
  perform pg_temp.put('u1code', v);
  perform pg_temp.expect_error($$select public.telegram_link_start('Mars/Olympus')$$, array['22023'], 'an unknown zone');
  perform pg_temp.expect_error($$select public.telegram_link_start('Europe/Minsk; select 1')$$, array['22023'], 'a zone with garbage');
end
$t$;
select pg_temp.as_role('postgres');
do $t$
begin
  if exists (select 1 from bot.link_codes where code_hash = pg_temp.c('u1code')) then raise exception 'FAILED: the plain code is stored'; end if;
  if (select row(user_id, purpose, tz, used_at) from bot.link_codes
       where code_hash = encode(sha256(convert_to(pg_temp.c('u1code'), 'UTF8')), 'hex'))
     is distinct from row('b0700000-0000-4000-8000-000000000001'::uuid, 'link'::text, 'Asia/Vladivostok'::text, null::timestamptz) then
    raise exception 'FAILED: the code row'; end if;
end
$t$;
-- 3b. Claims: linked; the same code from the same Telegram again → linked, nothing new; from another Telegram → used;
--     garbage and unknown → invalid (counted); a group chat → private_only (not counted). The link takes the code's zone.
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_link_claim(pg_temp.c('u1code'), 1001, 1001, 'ru', now());
  if r <> jsonb_build_object('status', 'linked', 'replaced_chat_id', null) then raise exception 'FAILED: claim %', r; end if;
  r := public.bot_whoami(1001);
  if not (r ->> 'linked')::boolean or r ->> 'tz' <> 'Asia/Vladivostok' or r ->> 'remind_at' <> '20:00' or r ->> 'tg_lang' <> 'ru'
     or not (r ->> 'remind_on')::boolean or (r ->> 'chat_id')::bigint <> 1001 then
    raise exception 'FAILED: the new link (zone from the code) %', r; end if;
  r := public.bot_link_claim(pg_temp.c('u1code'), 1001, 1001, 'ru', now());
  if r ->> 'status' <> 'linked' then raise exception 'FAILED: the same code again %', r; end if;
  if pg_temp.sq($q$select count(*) from bot.links where user_id = 'b0700000-0000-4000-8000-000000000001'$q$)::int <> 1 then
    raise exception 'FAILED: a repeat made a second link'; end if;
  r := public.bot_link_claim(pg_temp.c('u1code'), 1002, 1002, 'ru', now());
  if r <> jsonb_build_object('status', 'used') then raise exception 'FAILED: used %', r; end if;
  r := public.bot_link_claim('hello', 1003, 1003, null, now());
  if r <> jsonb_build_object('status', 'invalid') then raise exception 'FAILED: garbage %', r; end if;
  r := public.bot_link_claim('L' || repeat('0', 32), 1003, 1003, null, now());
  if r <> jsonb_build_object('status', 'invalid') then raise exception 'FAILED: unknown code %', r; end if;
  r := public.bot_link_claim(pg_temp.c('u1code'), 1004, -100500, null, now());
  if r <> jsonb_build_object('status', 'private_only') then raise exception 'FAILED: a group chat %', r; end if;
  r := public.bot_link_claim(null, 1004, 1004, null, now());
  if r ->> 'status' <> 'invalid' then raise exception 'FAILED: no code %', r; end if;
  if pg_temp.sq('select count(*) from bot.claim_failures where tg_user_id = 1003')::int <> 2
     or pg_temp.sq('select count(*) from bot.claim_failures where tg_user_id = 1004')::int <> 1 then
    raise exception 'FAILED: failed claims counted wrong'; end if;
end
$t$;
-- 3c. Expired, judged by the message date; a future message date counts as now.
select pg_temp.as_role('authenticated', 'b0700000-0000-4000-8000-000000000002');
select pg_temp.put('u2a', public.telegram_link_start('Europe/Minsk') ->> 'code');
select pg_temp.as_role('postgres');
update bot.link_codes set expires_at = now() - interval '1 minute'
 where code_hash = encode(sha256(convert_to(pg_temp.c('u2a'), 'UTF8')), 'hex');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_link_claim(pg_temp.c('u2a'), 2201, 2201, 'ru', now());
  if r <> jsonb_build_object('status', 'expired') then raise exception 'FAILED: expired %', r; end if;
  r := public.bot_link_claim(pg_temp.c('u2a'), 2201, 2201, 'ru', now() + interval '1 hour');
  if r <> jsonb_build_object('status', 'expired') then raise exception 'FAILED: a future date is not now %', r; end if;
  -- the message was sent while the code was valid (Telegram delivered it late): linked
  r := public.bot_link_claim(pg_temp.c('u2a'), 2201, 2201, 'ru', now() - interval '2 minutes');
  if r ->> 'status' <> 'linked' then raise exception 'FAILED: judged by the message date %', r; end if;
end
$t$;
-- 3d. A new code ends the older unused ones (the older one reads as expired).
select pg_temp.as_role('authenticated', 'b0700000-0000-4000-8000-000000000003');
select pg_temp.put('u3x', public.telegram_link_start(null) ->> 'code');
select pg_temp.put('u3y', public.telegram_link_start(null) ->> 'code');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_link_claim(pg_temp.c('u3x'), 2301, 2301, null, now());
  if r <> jsonb_build_object('status', 'expired') then raise exception 'FAILED: the older code still works %', r; end if;
  r := public.bot_link_claim(pg_temp.c('u3y'), 2301, 2301, null, now());
  if r ->> 'status' <> 'linked' then raise exception 'FAILED: the newer code %', r; end if;
  if public.bot_whoami(2301) ->> 'tz' <> 'Europe/Minsk' or public.bot_whoami(2301) -> 'tg_lang' <> 'null'::jsonb then
    raise exception 'FAILED: a code without a zone links in Europe/Minsk'; end if;
end
$t$;
-- 3e. Five codes an hour per user.
select pg_temp.as_role('authenticated', 'b0700000-0000-4000-8000-000000000004');
do $t$
begin
  for i in 1..5 loop perform public.telegram_link_start('Europe/Minsk'); end loop;
  perform pg_temp.expect_error($$select public.telegram_link_start('Europe/Minsk')$$, array['MT001'], 'the sixth code in an hour');
end
$t$;
-- 3f. Ten failed claims an hour per Telegram → slow_down, even for a valid code (which stays unused).
select pg_temp.as_role('authenticated', 'b0700000-0000-4000-8000-000000000005');
select pg_temp.put('u5', public.telegram_link_start('Europe/Minsk') ->> 'code');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  for i in 1..10 loop
    r := public.bot_link_claim('L' || lpad(to_hex(i), 32, '0'), 2501, 2501, null, now());
    if r ->> 'status' <> 'invalid' then raise exception 'FAILED: failure % %', i, r; end if;
  end loop;
  r := public.bot_link_claim(pg_temp.c('u5'), 2501, 2501, null, now());
  if r <> jsonb_build_object('status', 'slow_down') then raise exception 'FAILED: no brake after ten %', r; end if;
  if pg_temp.sq(format('select used_at from bot.link_codes where code_hash = %L', encode(sha256(convert_to(pg_temp.c('u5'), 'UTF8')), 'hex'))) is not null then
    raise exception 'FAILED: the braked code was used'; end if;
  r := public.bot_link_claim(pg_temp.c('u5'), 2502, 2502, null, now());   -- another Telegram is not braked
  if r ->> 'status' <> 'linked' then raise exception 'FAILED: the brake is per Telegram %', r; end if;
end
$t$;
-- 3g. The new link wins on both sides (spec §4.1 M6): U6 takes the Telegram U7 had; then U6 moves to a new Telegram and
--     the old chat is named for M6; re-linking the same pair keeps the settings and takes the new zone.
select pg_temp.as_role('authenticated', 'b0700000-0000-4000-8000-000000000007');
select pg_temp.put('u7', public.telegram_link_start('Europe/Minsk') ->> 'code');
select pg_temp.as_role('authenticated', 'b0700000-0000-4000-8000-000000000006');
select pg_temp.put('u6a', public.telegram_link_start('Europe/Minsk') ->> 'code');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  if public.bot_link_claim(pg_temp.c('u7'), 2601, 2601, 'ru', now()) ->> 'status' <> 'linked' then raise exception 'FAILED: U7 link'; end if;
  r := public.bot_link_claim(pg_temp.c('u6a'), 2601, 2601, 'ru', now());
  if r <> jsonb_build_object('status', 'linked', 'replaced_chat_id', null) then raise exception 'FAILED: U6 takes U7''s Telegram %', r; end if;
  if pg_temp.sq('select user_id from bot.links where tg_user_id = 2601 and unlinked_at is null') <> 'b0700000-0000-4000-8000-000000000006' then
    raise exception 'FAILED: the Telegram should belong to U6 now'; end if;
end
$t$;
select pg_temp.as_role('authenticated', 'b0700000-0000-4000-8000-000000000007');
do $t$ begin
  if (public.telegram_link_state() ->> 'linked')::boolean then raise exception 'FAILED: U7 still linked'; end if;
end $t$;
select pg_temp.as_role('authenticated', 'b0700000-0000-4000-8000-000000000006');
select pg_temp.put('u6b', public.telegram_link_start('Europe/Minsk') ->> 'code');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_link_claim(pg_temp.c('u6b'), 2602, 2602, 'en', now());
  if r <> jsonb_build_object('status', 'linked', 'replaced_chat_id', 2601) then raise exception 'FAILED: U6 moves, M6 to 2601 %', r; end if;
  if (public.bot_whoami(2601) ->> 'linked')::boolean then raise exception 'FAILED: the old Telegram is still linked'; end if;
  if pg_temp.sq($q$select count(*) from bot.links where user_id = 'b0700000-0000-4000-8000-000000000006' and unlinked_at is null$q$)::int <> 1
     or pg_temp.sq('select count(*) from bot.links where tg_user_id = 2602 and unlinked_at is null')::int <> 1 then
    raise exception 'FAILED: one active link per side'; end if;
  r := public.bot_settings(2602, '{"remind_at": "21:00"}');
  if r ->> 'status' <> 'ok' then raise exception 'FAILED: settings %', r; end if;
  perform pg_temp.put('u6link', pg_temp.sq('select id from bot.links where tg_user_id = 2602 and unlinked_at is null'));
end
$t$;
select pg_temp.as_role('authenticated', 'b0700000-0000-4000-8000-000000000006');
select pg_temp.put('u6c', public.telegram_link_start('Asia/Vladivostok') ->> 'code');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_link_claim(pg_temp.c('u6c'), 2602, 2602, null, now());
  if r <> jsonb_build_object('status', 'linked', 'replaced_chat_id', null) then raise exception 'FAILED: the same pair again %', r; end if;
  r := public.bot_whoami(2602);
  if r ->> 'remind_at' <> '21:00' or r ->> 'tz' <> 'Asia/Vladivostok' or r ->> 'tg_lang' <> 'en' then
    raise exception 'FAILED: re-linking the same pair keeps settings, takes the zone %', r; end if;
  if pg_temp.sq('select id from bot.links where tg_user_id = 2602 and unlinked_at is null') <> pg_temp.c('u6link') then
    raise exception 'FAILED: re-linking the same pair made a new row'; end if;
end
$t$;
-- 3h. The site's settings and unlinking.
select pg_temp.as_role('authenticated', 'b0700000-0000-4000-8000-000000000006');
do $t$
declare r jsonb;
begin
  r := public.telegram_settings(true, '20:00:30', 'Europe/Minsk');
  if r ->> 'remind_at' <> '20:00' or r ->> 'tz' <> 'Europe/Minsk' or not (r ->> 'linked')::boolean then
    raise exception 'FAILED: site settings %', r; end if;
  r := public.telegram_settings(null, null, null);
  if r ->> 'remind_at' <> '20:00' or not (r ->> 'remind_on')::boolean then raise exception 'FAILED: null keeps %', r; end if;
  r := public.telegram_settings(false, '07:00', null);
  if r ->> 'remind_at' <> '07:00' or (r ->> 'remind_on')::boolean then raise exception 'FAILED: off at 07:00 %', r; end if;
  perform pg_temp.expect_error($$select public.telegram_settings(null, '06:59', null)$$, array['22023'], 'site: 06:59');
  perform pg_temp.expect_error($$select public.telegram_settings(null, '23:00', null)$$, array['22023'], 'site: 23:00');
  perform pg_temp.expect_error($$select public.telegram_settings(null, null, 'Mars/Olympus')$$, array['22023'], 'site: a bad zone');
  r := public.telegram_unlink();
  if (r ->> 'linked')::boolean then raise exception 'FAILED: unlink %', r; end if;
  r := public.telegram_unlink();
  if (r ->> 'linked')::boolean then raise exception 'FAILED: unlink twice %', r; end if;
end
$t$;
select pg_temp.as_role('authenticated', 'b0700000-0000-4000-8000-000000000009');
do $t$ begin
  perform pg_temp.expect_error($$select public.telegram_settings(true, '20:00', 'Europe/Minsk')$$, array['P0002'], 'site: not linked');
end $t$;
select pg_temp.as_role('service_role');
do $t$ begin
  if (public.bot_whoami(2602) ->> 'linked')::boolean then raise exception 'FAILED: unlinked on the site, linked in the bot'; end if;
end $t$;

-- 4. The bot's view of a user (whoami), its settings and chat events. A ↔ 3001 (author), B ↔ 3002 (member).
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('ca', public.telegram_link_start('Europe/Minsk') ->> 'code');
select pg_temp.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.put('cb', public.telegram_link_start('Europe/Minsk') ->> 'code');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb; x jsonb; v_day date := (now() at time zone 'Europe/Minsk')::date;
begin
  perform public.bot_link_claim(pg_temp.c('ca'), 3001, 3001, 'ru', now());
  perform public.bot_link_claim(pg_temp.c('cb'), 3002, 3002, 'ru', now());
  r := public.bot_whoami(3001);
  if not (r ?& array['linked', 'chat_id', 'tg_lang', 'linked_at', 'blocked', 'remind_on', 'remind_at', 'tz', 'paused_until',
                     'asked_at', 'last_seen_at', 'prompt', 'local_day', 'local_time', 'now', 'exams', 'reminder_today']) then
    raise exception 'FAILED: whoami keys %', r; end if;
  if r ? 'user_id' or r::text like '%aaaaaaaa%' then raise exception 'FAILED: whoami shows the account %', r; end if;
  if (r ->> 'local_day')::date <> v_day or r ->> 'local_time' <> to_char(now() at time zone 'Europe/Minsk', 'HH24:MI') then
    raise exception 'FAILED: whoami clock %', r; end if;
  x := r -> 'exams' -> 0;
  if jsonb_array_length(r -> 'exams') <> 1 or x ->> 'id' <> pg_temp.c('c') or x ->> 'title' <> 'Осенняя сессия'
     or x ->> 'role' <> 'owner' or (x ->> 'exam_date')::date <> (now() at time zone 'utc')::date + 24
     or (x ->> 'last_date')::date <> (now() at time zone 'utc')::date + 24 then
    raise exception 'FAILED: the author''s exams %', r -> 'exams'; end if;
  if public.bot_whoami(3002) -> 'exams' -> 0 ->> 'role' <> 'member' then raise exception 'FAILED: the member''s exams'; end if;
  if pg_temp.sq('select last_seen_at from bot.links where tg_user_id = 3001 and unlinked_at is null')::timestamptz <> now() then
    raise exception 'FAILED: whoami marks the user as seen'; end if;
  if public.bot_whoami(424242) <> jsonb_build_object('linked', false) then raise exception 'FAILED: a stranger'; end if;
end
$t$;
select pg_temp.as_role('service_role');
do $t$
declare r jsonb; v_day date := (now() at time zone 'Europe/Minsk')::date;
begin
  -- times
  r := public.bot_settings(3001, '{"remind_at": "19:30"}');
  if r ->> 'status' <> 'ok' or r -> 'link' ->> 'remind_at' <> '19:30' then raise exception 'FAILED: 19:30 %', r; end if;
  r := public.bot_settings(3001, '{"remind_at": "7:05"}');
  if r -> 'link' ->> 'remind_at' <> '07:05' then raise exception 'FAILED: 7:05 %', r; end if;
  if public.bot_settings(3001, '{"remind_at": "25:99"}') <> '{"status": "invalid", "field": "remind_at", "reason": "format"}'::jsonb
     or public.bot_settings(3001, '{"remind_at": "6:59"}') <> '{"status": "invalid", "field": "remind_at", "reason": "range"}'::jsonb
     or public.bot_settings(3001, '{"remind_at": "23:00"}') <> '{"status": "invalid", "field": "remind_at", "reason": "range"}'::jsonb
     or public.bot_settings(3001, '{"remind_at": 1930}') <> '{"status": "invalid", "field": "remind_at", "reason": "format"}'::jsonb then
    raise exception 'FAILED: bad times'; end if;
  -- the plan off, then a chosen time turns it on (K2 «Не присылать» → /settings → «Время»)
  r := public.bot_settings(3001, '{"remind_on": false}');
  if (r -> 'link' ->> 'remind_on')::boolean then raise exception 'FAILED: off %', r; end if;
  r := public.bot_settings(3001, '{"remind_at": "20:00"}');
  if not (r -> 'link' ->> 'remind_on')::boolean or r -> 'link' ->> 'remind_at' <> '20:00' then raise exception 'FAILED: a time turns it on %', r; end if;
  r := public.bot_settings(3001, '{"remind_at": "20:00", "remind_on": false}');
  if (r -> 'link' ->> 'remind_on')::boolean then raise exception 'FAILED: an explicit remind_on wins %', r; end if;
  r := public.bot_settings(3001, '{"remind_on": true}');
  if public.bot_settings(3001, '{"remind_on": "yes"}') ->> 'reason' <> 'format' then raise exception 'FAILED: remind_on yes'; end if;
  -- zones
  if public.bot_settings(3001, '{"tz": "Mars/Olympus"}') <> '{"status": "invalid", "field": "tz", "reason": "unknown"}'::jsonb then
    raise exception 'FAILED: a bad zone'; end if;
  r := public.bot_settings(3001, '{"tz": "Asia/Vladivostok"}');
  if r -> 'link' ->> 'tz' <> 'Asia/Vladivostok' then raise exception 'FAILED: zone %', r; end if;
  r := public.bot_settings(3001, '{"tz": "Europe/Minsk"}');
  -- the pause: the first day the card comes again
  r := public.bot_settings(3001, jsonb_build_object('paused_until', to_char(v_day + 3, 'YYYY-MM-DD')));
  if (r -> 'link' ->> 'paused_until')::date <> v_day + 3 then raise exception 'FAILED: pause %', r; end if;
  if public.bot_settings(3001, jsonb_build_object('paused_until', to_char(v_day, 'YYYY-MM-DD'))) ->> 'reason' <> 'past'
     or public.bot_settings(3001, jsonb_build_object('paused_until', to_char(v_day - 5, 'YYYY-MM-DD'))) ->> 'reason' <> 'past'
     or public.bot_settings(3001, jsonb_build_object('paused_until', to_char(v_day + 400, 'YYYY-MM-DD'))) ->> 'reason' <> 'far'
     or public.bot_settings(3001, '{"paused_until": "2026-02-30"}') ->> 'reason' <> 'format'
     or public.bot_settings(3001, '{"paused_until": "25.10"}') ->> 'reason' <> 'format' then
    raise exception 'FAILED: bad pauses'; end if;
  if (public.bot_whoami(3001) ->> 'paused_until')::date <> v_day + 3 then raise exception 'FAILED: a bad pause changed it'; end if;
  r := public.bot_settings(3001, '{"paused_until": null}');
  if r -> 'link' -> 'paused_until' <> 'null'::jsonb then raise exception 'FAILED: end the pause %', r; end if;
  -- the pending ForceReply
  r := public.bot_settings(3001, '{"prompt": {"kind": "time", "prompt_id": 15, "target_id": 14}}');
  if r -> 'link' -> 'prompt' <> '{"kind": "time", "prompt_id": 15, "target_id": 14}'::jsonb
     or public.bot_whoami(3001) -> 'prompt' <> '{"kind": "time", "prompt_id": 15, "target_id": 14}'::jsonb then
    raise exception 'FAILED: prompt %', r; end if;
  if public.bot_settings(3001, '{"prompt": "x"}') ->> 'reason' <> 'format'
     or public.bot_settings(3001, jsonb_build_object('prompt', jsonb_build_object('x', repeat('я', 600)))) ->> 'reason' <> 'format' then
    raise exception 'FAILED: bad prompts'; end if;
  r := public.bot_settings(3001, '{"prompt": null}');
  if r -> 'link' -> 'prompt' <> 'null'::jsonb then raise exception 'FAILED: clear the prompt'; end if;
  -- S6 at most once an hour
  if (public.bot_settings(3001, '{"hint": true}') ->> 'hint')::boolean is not true then raise exception 'FAILED: the first hint'; end if;
  if (public.bot_settings(3001, '{"hint": true}') ->> 'hint')::boolean is not false then raise exception 'FAILED: a second hint within the hour'; end if;
  perform pg_temp.sx($q$update bot.links set hint_at = now() - interval '61 minutes' where tg_user_id = 3001 and unlinked_at is null$q$);
  if (public.bot_settings(3001, '{"hint": true}') ->> 'hint')::boolean is not true then raise exception 'FAILED: a hint after an hour'; end if;
  if public.bot_settings(3001, '{"hint": false}') ->> 'reason' <> 'format' then raise exception 'FAILED: hint false'; end if;
  -- all or nothing; unknown keys; not an object; not linked; the empty patch only marks the user as seen
  r := public.bot_settings(3001, '{"remind_at": "10:00", "bogus": 1}');
  if r <> '{"status": "invalid", "field": "bogus", "reason": "unknown"}'::jsonb or public.bot_whoami(3001) ->> 'remind_at' <> '20:00' then
    raise exception 'FAILED: all or nothing %', r; end if;
  if public.bot_settings(3001, '[]') ->> 'status' <> 'invalid' or public.bot_settings(3001, null) ->> 'status' <> 'invalid' then
    raise exception 'FAILED: a patch that is not an object'; end if;
  if public.bot_settings(424242, '{}') <> '{"status": "unlinked"}'::jsonb then raise exception 'FAILED: settings of a stranger'; end if;
  perform pg_temp.sx($q$update bot.links set last_seen_at = now() - interval '2 days' where tg_user_id = 3001 and unlinked_at is null$q$);
  r := public.bot_settings(3001, '{}');
  if r ->> 'status' <> 'ok' or (r -> 'link' ->> 'last_seen_at')::timestamptz <> now() then raise exception 'FAILED: the empty patch %', r; end if;
end
$t$;
-- chat events on U1's link (1001)
select pg_temp.as_role('service_role');
do $t$
declare r jsonb; v_at timestamptz;
begin
  r := public.bot_chat_event(1001, 'blocked');
  if r <> '{"status": "ok", "changed": true}'::jsonb or not (public.bot_whoami(1001) ->> 'blocked')::boolean then
    raise exception 'FAILED: blocked %', r; end if;
  perform pg_temp.sx($q$update bot.links set blocked_at = now() - interval '1 day' where tg_user_id = 1001 and unlinked_at is null$q$);
  perform public.bot_chat_event(1001, 'blocked');
  if pg_temp.sq('select blocked_at from bot.links where tg_user_id = 1001 and unlinked_at is null')::timestamptz <> now() - interval '1 day' then
    raise exception 'FAILED: blocked twice moves the date'; end if;
  r := public.bot_chat_event(1001, 'unblocked');
  if (public.bot_whoami(1001) ->> 'blocked')::boolean then raise exception 'FAILED: unblocked %', r; end if;
  perform pg_temp.expect_error($$select public.bot_chat_event(1001, 'left')$$, array['22023'], 'an unknown chat event');
  r := public.bot_chat_event(1001, 'stop');
  if r <> '{"status": "ok", "changed": true}'::jsonb or (public.bot_whoami(1001) ->> 'linked')::boolean then
    raise exception 'FAILED: stop %', r; end if;
  r := public.bot_chat_event(1001, 'stop');
  if r <> '{"status": "ok", "changed": false}'::jsonb then raise exception 'FAILED: stop twice %', r; end if;
end
$t$;

-- 5. The update ledger (spec decision 6): new → busy within the lease → failed → retry → done → done; a lease that ran
--    out → retry; only error names are kept; every begin is counted.
select pg_temp.as_role('service_role');
do $t$
declare t constant timestamptz := now(); v_before bigint;
begin
  v_before := coalesce(pg_temp.sq($q$select updates from bot.usage where day = (now() at time zone 'utc')::date$q$)::bigint, 0);
  if public.bot_update_begin(900001, t) <> 'new' then raise exception 'FAILED: new'; end if;
  if public.bot_update_begin(900001, t + interval '1 second') <> 'busy' then raise exception 'FAILED: busy within the lease'; end if;
  perform public.bot_update_failed(900001, 'TypeError');
  if pg_temp.sq('select status || '' '' || error_name from bot.updates where update_id = 900001') <> 'failed TypeError' then
    raise exception 'FAILED: failed row'; end if;
  if public.bot_update_begin(900001, t + interval '2 seconds') <> 'retry' then raise exception 'FAILED: retry after a failure'; end if;
  if pg_temp.sq('select attempts from bot.updates where update_id = 900001')::int <> 2 then raise exception 'FAILED: attempts'; end if;
  perform public.bot_update_done(900001);
  if public.bot_update_begin(900001, t + interval '3 seconds') <> 'done' then raise exception 'FAILED: done'; end if;
  perform public.bot_update_failed(900001, 'Late');
  if pg_temp.sq('select status from bot.updates where update_id = 900001') <> 'done' then raise exception 'FAILED: a failure after done'; end if;
  -- a worker that died without failed/done: busy for 30 s, then retry
  if public.bot_update_begin(900002, t) <> 'new' then raise exception 'FAILED: new 2'; end if;
  if public.bot_update_begin(900002, t + interval '29 seconds') <> 'busy' then raise exception 'FAILED: busy at 29 s'; end if;
  if public.bot_update_begin(900002, t + interval '31 seconds') <> 'retry' then raise exception 'FAILED: retry at 31 s'; end if;
  perform public.bot_update_failed(900002, 'token 123456:ABC in a message');
  if pg_temp.sq('select error_name from bot.updates where update_id = 900002') <> 'Error' then raise exception 'FAILED: a text was stored as the error'; end if;
  perform public.bot_update_failed(900002, 'TelegramError:429');
  if pg_temp.sq('select error_name from bot.updates where update_id = 900002') <> 'TelegramError:429' then raise exception 'FAILED: an error name'; end if;
  perform pg_temp.expect_error('select public.bot_update_begin(-1)', array['22023'], 'a negative update id');
  -- seven begins (the negative id is refused before it is counted)
  if pg_temp.sq($q$select updates from bot.usage where day = (now() at time zone 'utc')::date$q$)::bigint - v_before <> 7 then
    raise exception 'FAILED: begins counted wrong'; end if;
end
$t$;

-- 6. Setup, status, the tick and its heartbeat. Before /setup the tick is quiet.
select pg_temp.as_role('postgres');
do $t$
declare v_calls bigint := (select count(*) from net.calls);
begin
  if bot.tick() is not null or (select count(*) from net.calls) <> v_calls then raise exception 'FAILED: the tick before /setup'; end if;
end
$t$;
select pg_temp.as_role('service_role');
do $t$
declare r jsonb; tok constant text := 'tk_' || repeat('Ab9-_', 8);
        url constant text := 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/telegram';
begin
  perform pg_temp.expect_error(format('select public.bot_setup(%L, 1, %L, %L)', 'x', tok, url), array['22023'], 'setup: a short username');
  perform pg_temp.expect_error(format('select public.bot_setup(%L, 1, %L, %L)', 'Meldyteach_bot', 'short', url), array['22023'], 'setup: a short token');
  perform pg_temp.expect_error(format('select public.bot_setup(%L, 1, %L, %L)', 'Meldyteach_bot', tok, 'https://evil.example/telegram'),
                               array['22023'], 'setup: a foreign URL');
  perform pg_temp.expect_error(format('select public.bot_setup(%L, 0, %L, %L)', 'Meldyteach_bot', tok, url), array['22023'], 'setup: bot id 0');
  perform pg_temp.expect_error(format('select public.bot_setup(%L, 1, %L, %L, %L)', 'Meldyteach_bot', tok, url, 'Frankfurt'),
                               array['22023'], 'setup: a region that is not a region code');
  perform pg_temp.expect_error(format('select public.bot_setup(%L, 1, %L, %L, null)', 'Meldyteach_bot', tok, url),
                               array['22023'], 'setup: no region');
  r := public.bot_setup('Meldyteach_bot', 8123456789, tok, url);   -- the default region
  if r ->> 'status' <> 'ok' or r ->> 'bot_username' <> 'Meldyteach_bot' or r ->> 'function_region' <> 'eu-central-1' then
    raise exception 'FAILED: setup %', r; end if;
  r := public.bot_setup('Meldyteach_bot', 8123456789, tok, url);
  if r ->> 'status' <> 'slow_down' or (r ->> 'retry_after')::int not between 1 and 60 then raise exception 'FAILED: setup twice a minute %', r; end if;
  perform pg_temp.sx($q$update bot.config set last_setup_at = now() - interval '61 seconds' where id = 1$q$);
  r := public.bot_setup('Meldyteach_bot', 8123456789, tok, url, 'eu-west-2');
  if r ->> 'status' <> 'ok' or pg_temp.sq('select function_region from bot.config where id = 1') <> 'eu-west-2' then
    raise exception 'FAILED: setup after a minute, another region %', r; end if;
  perform pg_temp.sx($q$update bot.config set last_setup_at = now() - interval '61 seconds' where id = 1$q$);
  if public.bot_setup('Meldyteach_bot', 8123456789, tok, url, 'eu-central-1') ->> 'status' <> 'ok' then raise exception 'FAILED: setup back'; end if;
  r := public.bot_status();
  if not (r ->> 'configured')::boolean or r ->> 'bot_username' <> 'Meldyteach_bot' or r ->> 'function_region' <> 'eu-central-1'
     or r ->> 'tick_mode' <> 'every_minute' or (r ->> 'tick_threshold')::bigint <> 300000 or r::text like '%' || tok || '%'
     or r::text like '%supabase.co%' or r ? 'tick_token' or r ? 'function_url' then
    raise exception 'FAILED: status shows a secret or misses a field %', r; end if;
  if (r -> 'ledger' ->> 'done')::int < 1 or (r -> 'ledger' ->> 'started')::int <> 0 or (r -> 'ledger' ->> 'failed')::int < 1 then
    raise exception 'FAILED: status ledger %', r -> 'ledger'; end if;
  perform pg_temp.put('tok', tok);
end
$t$;
select pg_temp.as_role('authenticated', 'b0700000-0000-4000-8000-000000000008');
do $t$ begin
  if public.telegram_link_state() ->> 'bot_username' <> 'Meldyteach_bot'
     or public.telegram_link_start(null) ->> 'bot_username' <> 'Meldyteach_bot' then
    raise exception 'FAILED: the site sees the bot''s username'; end if;
end $t$;
select pg_temp.as_role('postgres');
do $t$
declare v_id bigint; c record;
begin
  v_id := bot.tick();
  select * into c from net.calls where id = v_id;
  if c.url <> 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/telegram/tick?forceFunctionRegion=eu-central-1'
     or c.headers ->> 'x-meldy-tick' <> pg_temp.c('tok') or c.headers ->> 'Content-Type' <> 'application/json'
     or c.timeout_milliseconds <> 10000 or not (c.body ? 'at') then
    raise exception 'FAILED: the tick request % %', c.url, c.headers; end if;
  if (select count(*) from cron.job where jobname = 'meldy-telegram-tick' and schedule = '* * * * *' and command = 'select bot.tick()') <> 1 then
    raise exception 'FAILED: the cron job'; end if;
end
$t$;
select pg_temp.as_role('service_role');
do $t$
declare r jsonb; v_ticks bigint;
begin
  v_ticks := coalesce(pg_temp.sq($q$select ticks from bot.usage where day = (now() at time zone 'utc')::date$q$)::bigint, 0);
  perform pg_temp.sx('update bot.config set last_cleanup_at = null where id = 1');
  r := public.bot_tick_beat('{"reminders": {"claimed": 3, "sent": 2}}');
  if r ->> 'status' <> 'ok' or r -> 'cleanup' = 'null'::jsonb or not (r -> 'calls' ? 'updates') then raise exception 'FAILED: beat %', r; end if;
  if pg_temp.sq('select last_tick_at = now() and last_cleanup_at = now() and last_tick = ''{"reminders": {"claimed": 3, "sent": 2}}''::jsonb from bot.config where id = 1')::boolean is not true then
    raise exception 'FAILED: the heartbeat row'; end if;
  r := public.bot_tick_beat(jsonb_build_object('big', repeat('x', 2100)));
  if r -> 'cleanup' <> 'null'::jsonb then raise exception 'FAILED: the housekeeping ran twice within the hour'; end if;
  if pg_temp.sq('select last_tick from bot.config where id = 1')::jsonb <> '{"truncated": true}'::jsonb then raise exception 'FAILED: a big heartbeat'; end if;
  if pg_temp.sq($q$select ticks from bot.usage where day = (now() at time zone 'utc')::date$q$)::bigint - v_ticks <> 2 then raise exception 'FAILED: ticks counted'; end if;
  r := public.bot_status();
  if (r -> 'calls' ->> 'ticks')::bigint < 2 or (r -> 'calls' ->> 'updates')::bigint < 7
     or (r -> 'calls' ->> 'total')::bigint <> (r -> 'calls' ->> 'ticks')::bigint + (r -> 'calls' ->> 'updates')::bigint
     or r -> 'calls' ->> 'month' <> to_char(now() at time zone 'utc', 'YYYY-MM') then
    raise exception 'FAILED: calls this month %', r -> 'calls'; end if;
end
$t$;

-- 6b. The tick's saving mode (spec §10): under 300 000 calls this month every minute; at 300 000 (or flags.tick =
--     'when_due') only when something may be due, and every 15th minute regardless. Every active link here is in
--     Minsk with its window at 19:30–23:00 at most, so at 05:0x local nothing is due.
select pg_temp.as_role('postgres');
do $t$
declare
  d0 timestamptz := (date_trunc('day', now() at time zone 'utc') + interval '2 hours') at time zone 'utc';  -- 05:00 Minsk
  ev timestamptz := (date_trunc('day', now() at time zone 'utc') + interval '17 hours 31 minutes') at time zone 'utc';  -- 20:31 Minsk
  v_calls bigint;
  posted int;
begin
  if (select count(*) from bot.links l where l.unlinked_at is null and l.tz <> 'Europe/Minsk') <> 0 then
    raise exception 'FAILED: the fixture expects Minsk links only'; end if;
  -- every_minute: three minutes, three requests, whatever is due
  v_calls := (select count(*) from net.calls);
  for i in 1..3 loop perform bot.tick(d0 + make_interval(mins => i)); end loop;
  if (select count(*) from net.calls) - v_calls <> 3 then raise exception 'FAILED: every minute under the threshold'; end if;
  if bot.tick_mode(d0) <> 'every_minute' or bot.tick_due(d0 + interval '7 minutes') then raise exception 'FAILED: the quiet morning'; end if;
  -- 300 000 calls this month: when_due
  insert into bot.usage as u (day, updates) values ((now() at time zone 'utc')::date, 300000)
  on conflict (day) do update set updates = u.updates + 300000;
  if bot.tick_mode(d0) <> 'when_due' then raise exception 'FAILED: when_due at 300 000'; end if;
  v_calls := (select count(*) from net.calls);
  posted := 0;
  for i in 1..14 loop
    if bot.tick(d0 + make_interval(mins => i)) is not null then posted := posted + 1; end if;
  end loop;
  if posted <> 0 or (select count(*) from net.calls) <> v_calls then raise exception 'FAILED: when_due posted % times with nothing due', posted; end if;
  if bot.tick(d0 + interval '15 minutes') is null or bot.tick(d0 + interval '30 minutes') is null then
    raise exception 'FAILED: the 15-minute beat'; end if;
  -- a day card due (A's window at 20:31 Minsk, no card claimed today): posted off the beat
  if not bot.tick_due(ev) or bot.tick(ev) is null then raise exception 'FAILED: when_due with a card due'; end if;
  -- a claimed row waiting to be taken again is due too
  insert into bot.deliveries (kind, chat_id, link_id, local_day, claimed_at)
  select 'reminder', l.chat_id, l.id, (d0 at time zone l.tz)::date - 1, d0 - interval '1 day' from bot.links l
   where l.tg_user_id = 3002 and l.unlinked_at is null;
  if not bot.tick_due(d0 + interval '7 minutes') then raise exception 'FAILED: a claimed row is due'; end if;
  delete from bot.deliveries where chat_id = 3002;
  -- package T5's pending answers: the fallback reads bot.sessions.pending, a hook decides when T5 defines it
  create table bot.sessions (sid text primary key, user_id uuid, chat_id bigint, message_id bigint, status text, pending jsonb);
  insert into bot.sessions values ('p0000001', 'aaaaaaaa-0000-0000-0000-000000000001', 3001, 5, 'open', '{"pos": 3}');
  if not bot.tick_due(d0 + interval '7 minutes') then raise exception 'FAILED: a pending answer is due (fallback)'; end if;
  create function bot.tick_due_sessions(p_now timestamptz) returns boolean language sql stable set search_path = '' as 'select false';
  if bot.tick_due(d0 + interval '7 minutes') then raise exception 'FAILED: T5''s hook decides'; end if;
  drop function bot.tick_due_sessions(timestamptz);
  drop table bot.sessions;
  -- package T7: its tables without its hook → every minute; its hook decides when present
  create table bot.group_posts (id bigint primary key);
  if not bot.tick_due(d0 + interval '7 minutes') then raise exception 'FAILED: T7 tables without a hook'; end if;
  create function bot.tick_due_groups(p_now timestamptz) returns boolean language sql stable set search_path = '' as 'select false';
  if bot.tick_due(d0 + interval '7 minutes') then raise exception 'FAILED: T7''s hook decides'; end if;
  drop function bot.tick_due_groups(timestamptz);
  drop table bot.group_posts;
  -- the owner's switch, under the threshold
  update bot.usage set updates = updates - 300000 where day = (now() at time zone 'utc')::date;
  if bot.tick_mode(d0) <> 'every_minute' then raise exception 'FAILED: back under the threshold'; end if;
  update bot.config set flags = '{"tick": "when_due"}' where id = 1;
  if bot.tick_mode(d0) <> 'when_due' or bot.tick(d0 + interval '7 minutes') is not null then raise exception 'FAILED: flags.tick'; end if;
  update bot.config set flags = '{}' where id = 1;
end
$t$;
select pg_temp.as_role('service_role');
do $t$ begin
  if public.bot_status() ->> 'tick_mode' <> 'every_minute' then raise exception 'FAILED: status tick_mode'; end if;
end $t$;

-- 7. /today and the day's messages. bot.sessions belongs to package T5: a stand-in with the spec's columns shows what
--    bot_today hands over.
select pg_temp.as_role('service_role');
do $t$
declare r jsonb; v_day date := (now() at time zone 'Europe/Minsk')::date;
begin
  r := public.bot_today(3001);
  if not (r ->> 'linked')::boolean or (r ->> 'local_day')::date <> v_day or r -> 'session' <> 'null'::jsonb or r -> 'day' <> 'null'::jsonb
     or r -> 'link' ->> 'tz' <> 'Europe/Minsk' then
    raise exception 'FAILED: today %', r - 'plan' - 'overview'; end if;
  if r -> 'plan' -> 'containers' -> 0 ->> 'id' <> pg_temp.c('c') or r -> 'plan' -> 'containers' -> 0 ->> 'role' <> 'owner'
     or (r -> 'plan' ->> 'day')::date <> v_day or jsonb_array_length(r -> 'plan' -> 'items') <> 4
     or jsonb_array_length(r -> 'plan' -> 'subjects') <> 2
     or r -> 'overview' -> 'containers' -> 0 ->> 'title' <> 'Осенняя сессия'
     or jsonb_array_length(r -> 'overview' -> 'containers' -> 0 -> 'subjects') <> 2 then
    raise exception 'FAILED: today''s plan and overview %', r -> 'overview'; end if;
  r := public.bot_today(3002);   -- the member doubted net:3 in section 1: never offered
  if r -> 'plan' -> 'containers' -> 0 ->> 'role' <> 'member' or jsonb_array_length(r -> 'plan' -> 'items') <> 3
     or jsonb_array_length(r -> 'plan' -> 'states') <> 3 then
    raise exception 'FAILED: the member''s plan %', r -> 'plan' -> 'items'; end if;
  if public.bot_today(424242) <> '{"linked": false}'::jsonb then raise exception 'FAILED: today for a stranger'; end if;
end
$t$;
select pg_temp.as_role('postgres');
create table bot.sessions (sid text primary key, user_id uuid not null, chat_id bigint not null, message_id bigint,
  container_id uuid, kind text, local_day date, items uuid[], position integer, status text not null);
insert into bot.sessions values ('k7m2p9qa', 'aaaaaaaa-0000-0000-0000-000000000001', 3001, 77, pg_temp.c('c')::uuid, 'plan',
  (now() at time zone 'Europe/Minsk')::date, array[pg_temp.c('net1')::uuid, pg_temp.c('net2')::uuid], 1, 'open'),
  ('a0000000', 'aaaaaaaa-0000-0000-0000-000000000001', 3001, 70, pg_temp.c('c')::uuid, 'plan',
  (now() at time zone 'Europe/Minsk')::date - 1, '{}', 20, 'finished');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_today(3001) -> 'session';
  if r ->> 'sid' <> 'k7m2p9qa' or (r ->> 'message_id')::bigint <> 77 or (r ->> 'position')::int <> 1
     or jsonb_array_length(r -> 'items') <> 2 or r ? 'user_id' then
    raise exception 'FAILED: the open session %', r; end if;
  if public.bot_today(3002) -> 'session' <> 'null'::jsonb then raise exception 'FAILED: another user''s session'; end if;
end
$t$;
select pg_temp.as_role('postgres');
drop table bot.sessions;
select pg_temp.as_role('service_role');
do $t$
declare r jsonb; v_day date := (now() at time zone 'Europe/Minsk')::date;
begin
  r := public.bot_card_sent(3001, 101, 'card');
  if r <> jsonb_build_object('status', 'ok', 'local_day', v_day, 'prev_message_id', null) then raise exception 'FAILED: card 1 %', r; end if;
  r := public.bot_card_sent(3001, 102, 'card');   -- /today again: the unused card above goes
  if (r ->> 'prev_message_id')::bigint <> 101 then raise exception 'FAILED: card 2 %', r; end if;
  r := public.bot_card_sent(3001, 102, 'card');   -- the same message again: nothing to delete
  if r -> 'prev_message_id' <> 'null'::jsonb then raise exception 'FAILED: card 2 twice %', r; end if;
  r := public.bot_card_sent(3001, 102, 'used');
  if r <> jsonb_build_object('status', 'ok', 'local_day', v_day, 'updated', true) then raise exception 'FAILED: used %', r; end if;
  if (public.bot_card_sent(3001, 999, 'used') ->> 'updated')::boolean then raise exception 'FAILED: used of a foreign message'; end if;
  r := public.bot_card_sent(3001, 103, 'card');   -- the used card is a session now: never deleted
  if r -> 'prev_message_id' <> 'null'::jsonb then raise exception 'FAILED: a used card handed back %', r; end if;
  r := public.bot_card_sent(3001, 201, 'last');
  if r -> 'prev_message_id' <> 'null'::jsonb then raise exception 'FAILED: last 1 %', r; end if;
  r := public.bot_card_sent(3001, 202, 'last');
  if (r ->> 'prev_message_id')::bigint <> 201 then raise exception 'FAILED: last 2 %', r; end if;
  if public.bot_card_sent(3001, 202, 'last') -> 'prev_message_id' <> 'null'::jsonb then raise exception 'FAILED: last 2 twice'; end if;
  if public.bot_card_sent(3001, 1, 'bogus') <> '{"status": "invalid"}'::jsonb or public.bot_card_sent(3001, 0, 'card') <> '{"status": "invalid"}'::jsonb
     or public.bot_card_sent(424242, 5, 'card') <> '{"status": "unlinked"}'::jsonb then
    raise exception 'FAILED: bad card events'; end if;
  r := public.bot_today(3001) -> 'day';
  if r <> jsonb_build_object('local_day', v_day, 'card_message_id', 103, 'card_used', false, 'last_message_id', 202, 'closed_at', null) then
    raise exception 'FAILED: today''s day row %', r; end if;
end
$t$;

-- 8. Housekeeping (bot.cleanup, hourly from bot_tick_beat): old rows go, recent ones stay (codes: 30 days after expiry).
select pg_temp.as_role('postgres');
do $t$
declare r jsonb; v_link bigint; v_old bigint; v_utc date := (now() at time zone 'utc')::date;
begin
  insert into bot.updates (update_id, status, started_at) values (800001, 'done', now() - interval '4 days'), (800002, 'done', now() - interval '2 days');
  insert into bot.claim_failures (tg_user_id, failed_at) values (7001, now() - interval '25 hours'), (7001, now() - interval '1 hour');
  insert into bot.link_codes (code_hash, user_id, expires_at, created_at) values
    (repeat('a', 64), 'b0700000-0000-4000-8000-000000000009', now() - interval '31 days', now() - interval '31 days'),
    (repeat('b', 64), 'b0700000-0000-4000-8000-000000000009', now() - interval '29 days', now() - interval '29 days');
  insert into bot.links (user_id, tg_user_id, chat_id, unlinked_at) values ('b0700000-0000-4000-8000-000000000009', 7002, 7002, now() - interval '31 days')
    returning id into v_old;
  insert into bot.links (user_id, tg_user_id, chat_id) values ('b0700000-0000-4000-8000-000000000009', 7003, 7003) returning id into v_link;
  insert into bot.deliveries (kind, chat_id, link_id, local_day, status) values
    ('reminder', 7003, v_link, v_utc - 91, 'sent'), ('reminder', 7003, v_link, v_utc - 89, 'sent');
  insert into bot.days (link_id, local_day) values (v_link, v_utc - 31), (v_link, v_utc - 29);
  insert into bot.usage (day) values (v_utc - 401), (v_utc - 399) on conflict do nothing;
  insert into cron.job_run_details (jobid, status, start_time, end_time)
    select j.jobid, 'succeeded', now() - interval '8 days', now() - interval '8 days' from cron.job j where j.jobname = 'meldy-telegram-tick'
    union all
    select j.jobid, 'succeeded', now() - interval '1 day', now() - interval '1 day' from cron.job j where j.jobname = 'meldy-telegram-tick';
  r := bot.cleanup(now());
  if exists (select 1 from bot.updates where update_id = 800001) or not exists (select 1 from bot.updates where update_id = 800002)
     or (select count(*) from bot.claim_failures where tg_user_id = 7001) <> 1
     or exists (select 1 from bot.link_codes where code_hash = repeat('a', 64)) or not exists (select 1 from bot.link_codes where code_hash = repeat('b', 64))
     or exists (select 1 from bot.links where id = v_old) or not exists (select 1 from bot.links where id = v_link)
     or (select count(*) from bot.deliveries where link_id = v_link) <> 1 or (select count(*) from bot.days where link_id = v_link) <> 1
     or exists (select 1 from bot.usage where day = v_utc - 401) or not exists (select 1 from bot.usage where day = v_utc - 399)
     or (select count(*) from cron.job_run_details r join cron.job j on j.jobid = r.jobid where j.jobname = 'meldy-telegram-tick') <> 1 then
    raise exception 'FAILED: housekeeping %', r; end if;
end
$t$;

do $t$ begin raise notice 'TELEGRAM BOT CHECKS PASSED'; end $t$;
rollback;
