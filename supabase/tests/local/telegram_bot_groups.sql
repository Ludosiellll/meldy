-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of the group chat's database (package T7:
-- supabase/migrations/20261010120004_telegram_bot_groups.sql) on the scratch database of telegram_bot_run.sh, after the
-- exam container's migrations and T1's three files. Spec §8.2 «Беседа» line by line, plus §4.6 G0–G4 and §6.5–§6.6:
-- the G code (only the author, an active group link, a linked Telegram), the claim (foreign from.id, expired, used,
-- again, no link, the brake), the site's list and switch, the post (one a day, never with the key, not on the exam day
-- or after the date, not after the link is revoked, not when off, 5 empty → off + G4 once), sending → unknown never a
-- second post, the presses (member → one tgq: row with bot_group, repeat → none, unlinked → only the counter, linked
-- not a member → gone + the counter), the counter at most once a minute, the 21:00 close once, the migration, the bot
-- removed, a deleted question, the housekeeping (presses two days after the close), T1's tick hook.
-- Two sessions at once (two claims of one code, two ticks): telegram_bot_groups_race.sql.
-- One transaction, rolled back. A failure raises (FAILED: …); success prints TELEGRAM BOT GROUP CHECKS PASSED. Roles:
-- anon, authenticated (request.jwt.claim.sub) and service_role as PostgREST sets them; postgres for fixtures.
-- Time: the group's zone is chosen so that it is about 12:xx there now (an Etc/GMT zone), so the real clock of the
-- answer core and the p_now of the claims agree; p_now moves only within the same local day, or to past days through
-- fixtures.
\set ON_ERROR_STOP 1
begin;

-- Helpers (as in telegram_bot_behaviour.sql).
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
-- Schema bot is closed to the API roles: assertions and fixture changes there run as the migration role.
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
-- The moment of the run (about 12:xx in the group's zone) plus an offset.
create or replace function pg_temp.t(p_offset interval default '0'::interval) returns timestamptz
language sql stable as $fn$
  select (select v from ctx where k = 't0')::timestamptz + p_offset
$fn$;
-- Every key of a JSON value, at any depth: the key never leaves before a press.
create or replace function pg_temp.jkeys(p_j jsonb) returns setof text language sql immutable as $fn$
  with recursive t(v) as (
    select p_j
    union all
    select e.value
      from t, lateral (select x.value from pg_catalog.jsonb_each(case when pg_catalog.jsonb_typeof(t.v) = 'object' then t.v else '{}'::jsonb end) x
                       union all
                       select y.value from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(t.v) = 'array' then t.v else '[]'::jsonb end) y) e
  )
  select k from t, lateral pg_catalog.jsonb_object_keys(case when pg_catalog.jsonb_typeof(t.v) = 'object' then t.v else '{}'::jsonb end) k
$fn$;
create or replace function pg_temp.no_key(p_j jsonb, p_what text) returns void language plpgsql as $fn$
begin
  if exists (select 1 from pg_temp.jkeys(p_j) k where k in ('correct', 'answers', 'key', 'key_source', 'keyed')) then
    raise exception 'FAILED: % shows the key: %', p_what, p_j;
  end if;
end;
$fn$;
grant all on ctx to anon, authenticated, service_role;
grant execute on function pg_temp.expect_error(text, text[], text), pg_temp.as_role(text, uuid), pg_temp.put(text, text),
  pg_temp.c(text), pg_temp.sq(text), pg_temp.sx(text), pg_temp.t(interval), pg_temp.jkeys(jsonb),
  pg_temp.no_key(jsonb, text) to anon, authenticated, service_role;

-- 0. Fixtures. A author, B and E members, C linked but not in the exam, D never linked (the container's baseline
--    accounts). The exam «Осенняя сессия» (spec §3's invented example), two subjects, questions of the spec's own kind:
--    four that may be posted (net:1, net:6, db:1, db:3) and five that may not (several correct, a short answer, too long,
--    a lost image, set aside by a doubt).
select pg_temp.as_role('postgres');
do $t$
declare
  k integer := 12 - extract(hour from now() at time zone 'utc')::integer;   -- -11..12: about 12:xx there now
  v_tz text;
begin
  v_tz := 'Etc/GMT' || case when k > 0 then '-' || k::text when k < 0 then '+' || (-k)::text else '' end;
  perform pg_temp.put('tz', v_tz);
  perform pg_temp.put('t0', now()::text);
  perform pg_temp.put('day', ((now() at time zone v_tz)::date)::text);
  if extract(hour from now() at time zone v_tz) <> 12 then raise exception 'FAILED: the zone trick (%)', v_tz; end if;
end
$t$;

select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$
declare r jsonb;
begin
  r := public.container_create('Осенняя сессия', pg_temp.c('day')::date + 24,
                               '[{"title":"Компьютерные сети"},{"title":"Базы данных"}]');
  perform pg_temp.put('c', r ->> 'container_id');
  perform pg_temp.put('s1', r -> 'subjects' -> 0 ->> 'id');
  perform pg_temp.put('s2', r -> 'subjects' -> 1 ->> 'id');
  perform public.container_items_add(pg_temp.c('s1')::uuid, jsonb_build_array(
    '{"ref":"g:net1","file_no":"21","topic":1,"stem":"Какой протокол выдаёт устройству IP-адрес при подключении к сети?","options":["DNS","DHCP","ARP","NAT"],"correct":[1],"key_source":"bold"}'::jsonb,
    '{"ref":"g:net2","file_no":"13","topic":1,"stem":"Какие адреса относятся к частным диапазонам IPv4?","options":["10.4.0.9","172.20.1.1","192.168.3.7","8.8.4.4"],"correct":[0,1,2],"key_source":"bold"}'::jsonb,
    '{"ref":"g:net3","file_no":"14","topic":1,"kind":"short","stem":"Сколько бит в адресе IPv4?","answers":["32"],"key_source":"answer_line"}'::jsonb,
    jsonb_build_object('ref', 'g:net4', 'file_no', '15', 'topic', 2, 'stem', 'Что делает этот маршрутизатор? ' || repeat('Длинное условие задачи. ', 70),
                       'options', jsonb_build_array('Пересылает пакеты', 'Шифрует пакеты'), 'correct', jsonb_build_array(0), 'key_source', 'bold'),
    '{"ref":"g:net5","file_no":"16","topic":2,"stem":"Какое устройство показано на рисунке?","options":["Коммутатор","Маршрутизатор","Концентратор"],"correct":[1],"key_source":"bold","flags":["has_image"]}'::jsonb,
    '{"ref":"g:net6","file_no":"12","topic":2,"stem":"Какой протокол передаёт веб-страницы в зашифрованном виде?","options":["HTTP","FTP","HTTPS","SMTP","Telnet"],"correct":[2],"key_source":"bold"}'::jsonb));
  perform public.container_items_add(pg_temp.c('s2')::uuid, jsonb_build_array(
    '{"ref":"g:db1","file_no":"57","topic":3,"stem":"Что гарантирует изолированность — буква I в ACID?","options":["Изменения завершённой транзакции сохраняются даже после сбоя","Параллельные транзакции не видят промежуточных изменений друг друга","Транзакция выполняется целиком или не выполняется совсем","После транзакции данные удовлетворяют всем ограничениям целостности"],"correct":[1],"key_source":"bold"}'::jsonb,
    '{"ref":"g:db2","file_no":"58","topic":3,"stem":"Какая команда SQL удаляет таблицу вместе с данными?","options":["DELETE","DROP TABLE","TRUNCATE","ALTER TABLE"],"correct":[1],"key_source":"bold"}'::jsonb,
    '{"ref":"g:db3","file_no":"59","topic":4,"stem":"Какой вид индекса хранит строки таблицы в порядке ключа?","options":["Кластерный","Хеш-индекс","Битовый","Полнотекстовый"],"correct":[0],"key_source":"bold"}'::jsonb));
end
$t$;
select pg_temp.as_role('postgres');
select pg_temp.put(x.k, (select id::text from public.test_items where import_ref = x.r))
  from (values ('net1', 'g:net1'), ('net2', 'g:net2'), ('net3', 'g:net3'), ('net4', 'g:net4'), ('net5', 'g:net5'),
               ('net6', 'g:net6'), ('db1', 'g:db1'), ('db2', 'g:db2'), ('db3', 'g:db3')) x(k, r);

-- 1. «Подключить беседу» (spec §6.3, §8.2 «код — только автор при активной ссылке и подключённом Telegram»).
select pg_temp.as_role('anon');
select pg_temp.expect_error(format('select public.telegram_group_code(%L::uuid, 12)', pg_temp.c('c')), array['42501', '28000'],
                            'anon makes a G code');
select pg_temp.as_role('service_role');
select pg_temp.expect_error(format('select public.telegram_group_code(%L::uuid, 12)', pg_temp.c('c')), array['42501', '28000'],
                            'the service role makes a G code (no auth.uid())');
-- the author, Telegram not linked yet → P0002
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_error(format('select public.telegram_group_code(%L::uuid, 12)', pg_temp.c('c')), array['P0002'],
                            'G code without a linked Telegram');
-- Telegram links (T1's table, written as the migration role): A in the group's zone, B, C, E in Minsk; D never linked.
select pg_temp.as_role('postgres');
select pg_temp.sx(format($q$insert into bot.links (user_id, tg_user_id, chat_id, tz) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 70000001, 70000001, %L),
  ('bbbbbbbb-0000-0000-0000-000000000002', 70000002, 70000002, 'Europe/Minsk'),
  ('cccccccc-0000-0000-0000-000000000003', 70000003, 70000003, 'Europe/Minsk'),
  ('eeeeeeee-0000-0000-0000-000000000005', 70000005, 70000005, 'Europe/Minsk')$q$, pg_temp.c('tz')));
-- the author, linked, but the exam has no group link yet → MT002
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_error(format('select public.telegram_group_code(%L::uuid, 12)', pg_temp.c('c')), array['MT002'],
                            'G code without an active group link');
do $t$
declare r jsonb;
begin
  r := public.container_link_create(pg_temp.c('c')::uuid, 60);
  perform pg_temp.put('gcode', r ->> 'code');
  perform pg_temp.put('glink', r ->> 'link_id');
end
$t$;
select pg_temp.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
do $t$ begin
  if not (public.container_join(pg_temp.c('gcode')) ->> 'joined')::boolean then raise exception 'FAILED: B did not join'; end if;
end $t$;
select pg_temp.as_role('authenticated', 'eeeeeeee-0000-0000-0000-000000000005');
do $t$ begin
  if not (public.container_join(pg_temp.c('gcode')) ->> 'joined')::boolean then raise exception 'FAILED: E did not join'; end if;
end $t$;
-- a member, a stranger → 42501; a bad hour → 22023
select pg_temp.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.expect_error(format('select public.telegram_group_code(%L::uuid, 12)', pg_temp.c('c')), array['42501'],
                            'a member makes a G code');
select pg_temp.as_role('authenticated', 'cccccccc-0000-0000-0000-000000000003');
select pg_temp.expect_error(format('select public.telegram_group_code(%L::uuid, 12)', pg_temp.c('c')), array['42501'],
                            'a stranger makes a G code');
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_error(format('select public.telegram_group_code(%L::uuid, 10)', pg_temp.c('c')), array['22023'],
                            'G code for 10:00');
select pg_temp.expect_error(format('select public.telegram_group_code(%L::uuid, null)', pg_temp.c('c')), array['22023'],
                            'G code without an hour');
select pg_temp.expect_error('select public.telegram_group_code(gen_random_uuid(), 12)', array['42501'],
                            'G code of an exam that does not exist');
do $t$
declare r jsonb; r2 jsonb;
begin
  r := public.telegram_group_code(pg_temp.c('c')::uuid);
  if r ->> 'code' !~ '^G[0-9a-f]{32}$' or (r ->> 'post_hour')::int <> 12
     or (r ->> 'expires_at')::timestamptz not between now() + interval '59 minutes' and now() + interval '61 minutes'
     or not (r ? 'bot_username') then
    raise exception 'FAILED: the G code %', r; end if;
  perform pg_temp.put('code_old', r ->> 'code');
  -- a new code ends the earlier unused one of this exam
  r2 := public.telegram_group_code(pg_temp.c('c')::uuid, 18);
  if (r2 ->> 'post_hour')::int <> 18 or r2 ->> 'code' = r ->> 'code' then raise exception 'FAILED: the second code %', r2; end if;
  perform pg_temp.put('code18', r2 ->> 'code');
  if pg_temp.sq(format($q$select count(*) from bot.link_codes where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                           and purpose = 'group' and expires_at >= now()$q$))::int <> 1 then
    raise exception 'FAILED: one live G code per exam'; end if;
  -- stored as sha256 only, with the exam, the hour and the author's zone
  if pg_temp.sq(format($q$select count(*) from bot.link_codes where code_hash = encode(sha256(convert_to(%L, 'UTF8')), 'hex')
                           and purpose = 'group' and container_id = %L and post_hour = 18 and tz = %L$q$,
                       r2 ->> 'code', pg_temp.c('c'), pg_temp.c('tz')))::int <> 1 then
    raise exception 'FAILED: the stored G code'; end if;
  if pg_temp.sq(format($q$select count(*) from bot.link_codes where code_hash = %L$q$, r2 ->> 'code'))::int <> 0 then
    raise exception 'FAILED: the plain code stored'; end if;
  -- at most 5 an hour (MT001)
  perform public.telegram_group_code(pg_temp.c('c')::uuid, 9);
  perform public.telegram_group_code(pg_temp.c('c')::uuid, 15);
  perform public.telegram_group_code(pg_temp.c('c')::uuid, 12);
  perform pg_temp.expect_error(format('select public.telegram_group_code(%L::uuid, 12)', pg_temp.c('c')), array['MT001'],
                               'a sixth G code within an hour');
  perform pg_temp.sx($q$update bot.link_codes set created_at = created_at - interval '2 hours'
                         where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and purpose = 'group'$q$);
  r := public.telegram_group_code(pg_temp.c('c')::uuid, 12);
  perform pg_temp.put('code12', r ->> 'code');
end
$t$;

-- 2. The claim (spec §4.6 G1, §8.2 «заявка от чужого from.id и устаревшая — отказ»). Chats: G1 = -1001000000001 (the
--    group of the exam), G2 = -1001000000002, G3 = -400000003 (a basic group, migrated later).
select pg_temp.as_role('anon');
select pg_temp.expect_error(format('select public.bot_group_claim(%L, -1001000000001, %L, %L, 70000001)', pg_temp.c('code12'), 'supergroup', '3-ПО'),
                            array['42501'], 'anon claims a G code');
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_error(format('select public.bot_group_claim(%L, -1001000000001, %L, %L, 70000001)', pg_temp.c('code12'), 'supergroup', '3-ПО'),
                            array['42501'], 'the author claims through the API');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb; v_fail int;
begin
  -- not a group
  r := public.bot_group_claim(pg_temp.c('code12'), 70000001, 'private', null, 70000001);
  if r ->> 'status' <> 'not_group' then raise exception 'FAILED: a private chat %', r; end if;
  r := public.bot_group_claim(pg_temp.c('code12'), -1001000000001, 'channel', 'Канал', 70000001);
  if r ->> 'status' <> 'not_group' then raise exception 'FAILED: a channel %', r; end if;
  -- garbage and unknown codes: invalid, counted
  v_fail := pg_temp.sq('select count(*) from bot.claim_failures where tg_user_id = 70000002')::int;
  r := public.bot_group_claim('Lnot-a-group-code', -1001000000001, 'supergroup', '3-ПО', 70000002);
  if r ->> 'status' <> 'invalid' then raise exception 'FAILED: garbage %', r; end if;
  r := public.bot_group_claim('G' || repeat('0', 32), -1001000000001, 'supergroup', '3-ПО', 70000002);
  if r ->> 'status' <> 'invalid' or (r ->> 'sender_chat_id')::bigint <> 70000002 or (r ->> 'chat_bound')::boolean then
    raise exception 'FAILED: an unknown G code %', r; end if;
  if pg_temp.sq('select count(*) from bot.claim_failures where tg_user_id = 70000002')::int <> v_fail + 2 then
    raise exception 'FAILED: failures not counted'; end if;
  -- a foreign from.id: B (linked, a member) forwards A's link → foreign, B may be told in private
  r := public.bot_group_claim(pg_temp.c('code12'), -1001000000001, 'supergroup', '3-ПО', 70000002, now());
  if r ->> 'status' <> 'foreign' or (r ->> 'sender_chat_id')::bigint <> 70000002 or (r ->> 'chat_bound')::boolean then
    raise exception 'FAILED: a foreign claim %', r; end if;
  -- D (no Telegram link) tries → foreign, nobody to tell
  r := public.bot_group_claim(pg_temp.c('code12'), -1001000000001, 'supergroup', '3-ПО', 70000004, now());
  if r ->> 'status' <> 'foreign' or r -> 'sender_chat_id' <> 'null'::jsonb then raise exception 'FAILED: an unlinked claim %', r; end if;
  -- the code ended by a newer one → expired; a fresh code with a message older than its hour → expired
  r := public.bot_group_claim(pg_temp.c('code_old'), -1001000000001, 'supergroup', '3-ПО', 70000001, now());
  if r ->> 'status' <> 'expired' or (r ->> 'sender_chat_id')::bigint <> 70000001 then raise exception 'FAILED: an ended code %', r; end if;
  perform pg_temp.sx(format($q$update bot.link_codes set expires_at = now() - interval '1 minute'
                               where code_hash = encode(sha256(convert_to(%L, 'UTF8')), 'hex')$q$, pg_temp.c('code18')));
  r := public.bot_group_claim(pg_temp.c('code18'), -1001000000001, 'supergroup', '3-ПО', 70000001, now());
  if r ->> 'status' <> 'expired' then raise exception 'FAILED: an expired code %', r; end if;
  -- judged by the message's date: a delayed delivery of a message sent in time is accepted (checked on code12 below);
  -- bound: the author's linked Telegram, a fresh code, the exam has an active group link
  r := public.bot_group_claim(pg_temp.c('code12'), -1001000000001, 'supergroup', E' 3-ПО \u0007 ', 70000001, now() - interval '30 seconds');
  if r ->> 'status' <> 'bound' or (r ->> 'again')::boolean or (r ->> 'chat_id')::bigint <> -1001000000001
     or r ->> 'container_id' <> pg_temp.c('c') or r ->> 'exam_title' <> 'Осенняя сессия' or r ->> 'title' <> '3-ПО'
     or (r ->> 'post_hour')::int <> 12 or r ->> 'tz' <> pg_temp.c('tz') or (r ->> 'owner_chat_id')::bigint <> 70000001
     or not (r ->> 'chat_bound')::boolean then
    raise exception 'FAILED: bound %', r; end if;
  -- the same code from the same Telegram for the same chat (a redelivery) → bound again, nothing changes
  r := public.bot_group_claim(pg_temp.c('code12'), -1001000000001, 'supergroup', '3-ПО', 70000001, now());
  if r ->> 'status' <> 'bound' or not (r ->> 'again')::boolean then raise exception 'FAILED: again %', r; end if;
  -- the same code in another chat → used; a foreign claim in the bound chat says chat_bound (the bot stays)
  r := public.bot_group_claim(pg_temp.c('code12'), -1001000000002, 'supergroup', 'Другая', 70000001, now());
  if r ->> 'status' <> 'used' or (r ->> 'chat_bound')::boolean then raise exception 'FAILED: used %', r; end if;
  r := public.bot_group_claim(pg_temp.c('code12'), -1001000000001, 'supergroup', '3-ПО', 70000003, now());
  if r ->> 'status' <> 'foreign' or not (r ->> 'chat_bound')::boolean then raise exception 'FAILED: chat_bound %', r; end if;
  if pg_temp.sq($q$select count(*) from bot.groups where chat_id = -1001000000001 and left_at is null and off_at is null
                    and post_hour = 12 and link_id is not null and owner_id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$)::int <> 1 then
    raise exception 'FAILED: the bound row'; end if;
end
$t$;
-- the author's site: another code for the second chat (G2, 15:00) and for G3; no group link left → no_link at the claim
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('code_g2', public.telegram_group_code(pg_temp.c('c')::uuid, 15) ->> 'code');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_group_claim(pg_temp.c('code_g2'), -1001000000002, 'group', 'Вторая группа', 70000001, now());
  if r ->> 'status' <> 'bound' or (r ->> 'post_hour')::int <> 15 then raise exception 'FAILED: G2 bound %', r; end if;
end
$t$;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('code_g3', public.telegram_group_code(pg_temp.c('c')::uuid, 12) ->> 'code');
select pg_temp.as_role('postgres');
select pg_temp.sx(format('update public.container_links set revoked_at = now() where id = %L', pg_temp.c('glink')));
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_group_claim(pg_temp.c('code_g3'), -400000003, 'group', 'Третья', 70000001, now());
  if r ->> 'status' <> 'no_link' then raise exception 'FAILED: no group link at the claim %', r; end if;
end
$t$;
select pg_temp.as_role('postgres');
select pg_temp.sx(format('update public.container_links set revoked_at = null where id = %L', pg_temp.c('glink')));
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_group_claim(pg_temp.c('code_g3'), -400000003, 'group', 'Третья', 70000001, now());
  if r ->> 'status' <> 'bound' then raise exception 'FAILED: G3 bound %', r; end if;
  -- the brake: 10 failures in an hour from one Telegram → slow_down, even for a good code
  for i in 1..10 loop
    perform public.bot_group_claim('G' || lpad(i::text, 32, '0'), -1001000000009, 'group', 'x', 70000009);
  end loop;
  r := public.bot_group_claim(pg_temp.c('code_g3'), -1001000000009, 'group', 'x', 70000009);
  if r ->> 'status' <> 'slow_down' then raise exception 'FAILED: the brake %', r; end if;
end
$t$;

-- 3. The site's list and switch (spec §6.3 telegram_groups, telegram_group_set; G1 «Час и отключение — на сайте»).
select pg_temp.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.expect_error(format('select public.telegram_groups(%L::uuid)', pg_temp.c('c')), array['42501'], 'a member lists the chats');
select pg_temp.expect_error('select public.telegram_group_set(-1001000000001, 15, null)', array['P0002'], 'a member changes a chat');
select pg_temp.as_role('anon');
select pg_temp.expect_error(format('select public.telegram_groups(%L::uuid)', pg_temp.c('c')), array['42501', '28000'], 'anon lists the chats');
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$
declare r jsonb; g jsonb;
begin
  r := public.telegram_groups(pg_temp.c('c')::uuid);
  if not (r ->> 'telegram_linked')::boolean or not (r ->> 'link_active')::boolean or r -> 'hours' <> '[9, 12, 15, 18]'::jsonb
     or (r ->> 'default_hour')::int <> 12 or jsonb_array_length(r -> 'groups') <> 3 then
    raise exception 'FAILED: telegram_groups %', r; end if;
  -- (one transaction: every bound_at is the same now(), so the list falls back to the chat id order)
  select x into g from jsonb_array_elements(r -> 'groups') x where (x ->> 'chat_id')::bigint = -1001000000001;
  if g is null or g ->> 'title' <> '3-ПО' or (g ->> 'post_hour')::int <> 12
     or not (g ->> 'on')::boolean or g -> 'off_reason' <> 'null'::jsonb or not (g ->> 'link_active')::boolean
     or g ->> 'tz' <> pg_temp.c('tz') or not (g ? 'bound_at') then
    raise exception 'FAILED: a group as the site sees it %', g; end if;
  perform pg_temp.no_key(r, 'telegram_groups');
  perform pg_temp.expect_error('select public.telegram_group_set(-1001000000001, 13, null)', array['22023'], 'an hour of 13');
  perform pg_temp.expect_error('select public.telegram_group_set(-1001999999999, 12, null)', array['P0002'], 'a chat that is not bound');
  g := public.telegram_group_set(-1001000000002, 18, null);
  if (g ->> 'post_hour')::int <> 18 or not (g ->> 'on')::boolean then raise exception 'FAILED: the hour changed %', g; end if;
  g := public.telegram_group_set(-1001000000002, null, false);
  if (g ->> 'on')::boolean or g ->> 'off_reason' <> 'author' or (g ->> 'post_hour')::int <> 18 then raise exception 'FAILED: off %', g; end if;
  g := public.telegram_group_set(-1001000000002, 15, null);
  if (g ->> 'on')::boolean or (g ->> 'post_hour')::int <> 15 then raise exception 'FAILED: the hour of an off chat %', g; end if;
end
$t$;
select pg_temp.as_role('authenticated', 'cccccccc-0000-0000-0000-000000000003');
select pg_temp.expect_error('select public.telegram_group_set(-1001000000002, null, true)', array['P0002'], 'a stranger turns a chat on');

-- 4. The post (spec §4.6 G2, §6.5, §6.6 step 2, §8.2 «пост не отдаёт correct»).
--    States of the exam's people that the summary counts: B started net1 yesterday (26 h ago: confirmable now, and his
--    press today makes it «верно в два разных дня»); E's last answer to db1 was wrong (relearn); B's db3 is counted and
--    its check is due; A saw net6 today; E doubts db2 (set aside: never posted).
select pg_temp.as_role('postgres');
do $t$
declare
  B constant uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  E constant uuid := 'eeeeeeee-0000-0000-0000-000000000005';
  A constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  v_y timestamptz := now() - interval '26 hours';
  v_m timestamptz := now() - interval '30 days';
begin
  insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev, seen, right_count, wrong_count,
         first_seen_at, first_seen_day, last_answer_at, last_answer_day, last_result, streak_at, streak_day, named_at, clean_ok_at)
  values (B, pg_temp.c('net1')::uuid, pg_temp.c('c')::uuid, pg_temp.c('s1')::uuid, 1, 1, 1, 0, v_y, (v_y at time zone 'Europe/Minsk')::date,
          v_y, (v_y at time zone 'Europe/Minsk')::date, 'right', v_y, (v_y at time zone 'Europe/Minsk')::date, v_y, v_y);
  insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev, seen, right_count, wrong_count,
         first_seen_at, first_seen_day, last_answer_at, last_answer_day, last_result, peek_day)
  values (E, pg_temp.c('db1')::uuid, pg_temp.c('c')::uuid, pg_temp.c('s2')::uuid, 1, 1, 0, 1, v_y, (v_y at time zone 'Europe/Minsk')::date,
          v_y, (v_y at time zone 'Europe/Minsk')::date, 'wrong', (v_y at time zone 'Europe/Minsk')::date);
  insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev, seen, right_count, wrong_count,
         first_seen_at, first_seen_day, last_answer_at, last_answer_day, last_result, streak_at, streak_day, two_days_at, two_days_day,
         named_at, checks, clean_ok_at)
  values (B, pg_temp.c('db3')::uuid, pg_temp.c('c')::uuid, pg_temp.c('s2')::uuid, 1, 2, 2, 0, v_m - interval '1 day',
          (v_m at time zone 'Europe/Minsk')::date - 1, v_m, (v_m at time zone 'Europe/Minsk')::date, 'right',
          v_m - interval '1 day', (v_m at time zone 'Europe/Minsk')::date - 1, v_m, (v_m at time zone 'Europe/Minsk')::date, v_m, 0, v_m);
  insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev, seen, right_count, wrong_count,
         first_seen_at, first_seen_day, last_answer_at, last_answer_day, last_result, streak_at, streak_day, named_at, clean_ok_at)
  values (A, pg_temp.c('net6')::uuid, pg_temp.c('c')::uuid, pg_temp.c('s1')::uuid, 1, 1, 1, 0, now() - interval '1 hour',
          (now() at time zone 'Europe/Minsk')::date, now() - interval '1 hour', (now() at time zone 'Europe/Minsk')::date, 'right',
          now() - interval '1 hour', (now() at time zone 'Europe/Minsk')::date, now() - interval '1 hour', now() - interval '1 hour');
  perform meldy_private.test_key_doubt_for(E, pg_temp.c('db2')::uuid, '[]'::jsonb, 'в файле другой ответ');
end
$t$;
select pg_temp.as_role('anon');
select pg_temp.expect_error('select * from public.bot_claim_group_posts(10)', array['42501'], 'anon claims posts');
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_error('select * from public.bot_claim_group_posts(10)', array['42501'], 'the author claims posts');
select pg_temp.as_role('service_role');
do $t$
declare r record; n int := 0; v_c jsonb; it jsonb; v_g1 bigint; v_g3 bigint;
begin
  -- before the hour: nothing (G1 and G3 post at 12:00, G2 is off)
  if exists (select 1 from public.bot_claim_group_posts(10, pg_temp.t(- interval '1 hour'))) then
    raise exception 'FAILED: a post before its hour'; end if;
  for r in select * from public.bot_claim_group_posts(10, pg_temp.t()) loop
    n := n + 1;
    if r.kind <> 'post' or r.delivery_id is not null or r.chat_id <> r.group_chat_id or r.local_day <> pg_temp.c('day')::date
       or r.container_id <> pg_temp.c('c')::uuid or r.exam_title <> 'Осенняя сессия' then
      raise exception 'FAILED: a post row %', row_to_json(r); end if;
    perform pg_temp.no_key(to_jsonb(r), 'the post claim');
    if r.chat_id = -1001000000001 then v_g1 := r.post_id; v_c := r.candidates; end if;
    if r.chat_id = -400000003 then v_g3 := r.post_id; end if;
  end loop;
  if n <> 2 or v_g1 is null or v_g3 is null then raise exception 'FAILED: % posts claimed (G1 %, G3 %)', n, v_g1, v_g3; end if;
  perform pg_temp.put('p1', v_g1::text);
  perform pg_temp.put('p3', v_g3::text);
  -- the summary is group.ts's GroupInput: the four questions that may be posted, counts over A, B and E, no user ids
  if v_c ->> 'day' <> pg_temp.c('day') or (v_c ->> 'minGapDays')::int <> 14 or v_c -> 'recent' <> '[]'::jsonb
     or (select array_agg(k order by k) from jsonb_object_keys(v_c) k) <> array['day', 'items', 'minGapDays', 'recent'] then
    raise exception 'FAILED: the summary %', v_c; end if;
  if (select array_agg(x ->> 'rev' order by x ->> 'rev') from jsonb_array_elements(v_c -> 'items') x)
     <> (select array_agg(v order by v) from unnest(array[pg_temp.c('net1'), pg_temp.c('net6'), pg_temp.c('db1'), pg_temp.c('db3')]) v) then
    raise exception 'FAILED: the questions offered %', v_c -> 'items'; end if;
  for it in select x from jsonb_array_elements(v_c -> 'items') x loop
    if (select array_agg(k order by k) from jsonb_object_keys(it) k)
       <> array['blocked', 'confirmable', 'due', 'label', 'members', 'relearn', 'rev', 'topic', 'unseen']
       or (it ->> 'members')::int <> 3 or (it ->> 'blocked')::boolean then
      raise exception 'FAILED: an item of the summary %', it; end if;
    if it ->> 'rev' = pg_temp.c('net1') and ((it ->> 'confirmable')::int <> 1 or (it ->> 'unseen')::int <> 2 or it ->> 'label' <> '21'
                                             or (it ->> 'topic')::int <> 1 or (it ->> 'relearn')::int <> 0 or (it ->> 'due')::int <> 0)
       or it ->> 'rev' = pg_temp.c('db1') and ((it ->> 'relearn')::int <> 1 or (it ->> 'confirmable')::int <> 0 or (it ->> 'unseen')::int <> 2)
       or it ->> 'rev' = pg_temp.c('db3') and ((it ->> 'due')::int <> 1 or (it ->> 'unseen')::int <> 2)
       or it ->> 'rev' = pg_temp.c('net6') and ((it ->> 'unseen')::int <> 2 or (it ->> 'confirmable')::int <> 0) then
      raise exception 'FAILED: the counts of %', it; end if;
  end loop;
  if v_c::text ~ '(aaaaaaaa|bbbbbbbb|eeeeeeee)-' then raise exception 'FAILED: a user id in the summary'; end if;
  -- one post a day per chat: a second claim the same day gives nothing
  if exists (select 1 from public.bot_claim_group_posts(10, pg_temp.t(interval '1 minute'))) then
    raise exception 'FAILED: a second post the same day'; end if;
end
$t$;
do $t$
declare r jsonb;
begin
  -- the pick: a question the summary does not offer, garbage, another exam's question → invalid (still claimed)
  r := public.bot_group_pick(pg_temp.c('p1')::bigint, pg_temp.c('net2'));
  if r ->> 'status' <> 'invalid' then raise exception 'FAILED: several correct picked %', r; end if;
  r := public.bot_group_pick(pg_temp.c('p1')::bigint, pg_temp.c('db2'));
  if r ->> 'status' <> 'invalid' then raise exception 'FAILED: a doubted question picked %', r; end if;
  r := public.bot_group_pick(pg_temp.c('p1')::bigint, 'not-a-question');
  if r ->> 'status' <> 'invalid' then raise exception 'FAILED: garbage picked %', r; end if;
  -- group.ts picks net1 (the most members can make it count today)
  r := public.bot_group_pick(pg_temp.c('p1')::bigint, pg_temp.c('net1'));
  if r ->> 'status' <> 'picked' or (r ->> 'post_id')::bigint <> pg_temp.c('p1')::bigint or (r ->> 'chat_id')::bigint <> -1001000000001
     or r -> 'question' ->> 'subject' <> 'Компьютерные сети'
     or r -> 'question' ->> 'stem' <> 'Какой протокол выдаёт устройству IP-адрес при подключении к сети?'
     or r -> 'question' -> 'options' <> '["DNS", "DHCP", "ARP", "NAT"]'::jsonb or r -> 'question' -> 'shown' <> 'null'::jsonb
     or (r -> 'question' ->> 'keep_order')::boolean or (r -> 'question' ->> 'code')::boolean then
    raise exception 'FAILED: picked %', r; end if;
  perform pg_temp.no_key(r, 'the pick');
  -- nothing to post in G3 today (group.ts gave null) → none, the day is done for that chat
  r := public.bot_group_pick(pg_temp.c('p3')::bigint, null);
  if r ->> 'status' <> 'none' then raise exception 'FAILED: none %', r; end if;
  r := public.bot_group_pick(pg_temp.c('p3')::bigint, pg_temp.c('net1'));
  if r ->> 'status' <> 'gone' then raise exception 'FAILED: a pick after none %', r; end if;
  -- sending: the shown order must be an order of the 4 options
  perform pg_temp.expect_error(format('select public.bot_group_sending(%s, array[0,1,2], %L)', pg_temp.c('p1'), pg_temp.t()),
                               array['22023'], 'shown of 3');
  perform pg_temp.expect_error(format('select public.bot_group_sending(%s, array[0,1,1,2], %L)', pg_temp.c('p1'), pg_temp.t()),
                               array['22023'], 'shown with a repeat');
  perform pg_temp.expect_error(format('select public.bot_group_sending(%s, array[0,1,2,4], %L)', pg_temp.c('p1'), pg_temp.t()),
                               array['22023'], 'shown out of range');
  if not public.bot_group_sending(pg_temp.c('p1')::bigint, array[2, 0, 3, 1], pg_temp.t()) then raise exception 'FAILED: sending'; end if;
  if public.bot_group_sending(pg_temp.c('p1')::bigint, array[2, 0, 3, 1], pg_temp.t()) then raise exception 'FAILED: sending twice'; end if;
  if public.bot_group_pick(pg_temp.c('p1')::bigint, pg_temp.c('net6')) ->> 'status' <> 'gone' then raise exception 'FAILED: a pick while sending'; end if;
  perform pg_temp.expect_error(format('select public.bot_group_posted(%s, %L)', pg_temp.c('p1'), 'sent'), array['22023'], 'sent without a message id');
  perform pg_temp.expect_error(format('select public.bot_group_posted(%s, %L, 5)', pg_temp.c('p1'), 'done'), array['22023'], 'an unknown post status');
  r := public.bot_group_posted(pg_temp.c('p1')::bigint, 'sent', 501, null, pg_temp.t());
  if r ->> 'status' <> 'ok' then raise exception 'FAILED: posted %', r; end if;
  r := public.bot_group_posted(pg_temp.c('p1')::bigint, 'sent', 501, null, pg_temp.t());
  if r ->> 'status' <> 'ok' then raise exception 'FAILED: posted again %', r; end if;
  r := public.bot_group_posted(pg_temp.c('p1')::bigint, 'failed', null, 'TelegramError:400', pg_temp.t());
  if r ->> 'status' <> 'ignored' then raise exception 'FAILED: failed after sent %', r; end if;
  if pg_temp.sq(format($q$select count(*) from bot.group_posts where id = %s and status = 'open' and tg_message_id = 501
                           and shown = '{2,0,3,1}' and item_id = %L and item_rev = 1 and error is null$q$,
                       pg_temp.c('p1'), pg_temp.c('net1')))::int <> 1
     or pg_temp.sq(format($q$select status || ':' || error from bot.group_posts where id = %s$q$, pg_temp.c('p3'))) <> 'failed:none' then
    raise exception 'FAILED: the post rows'; end if;
end
$t$;

-- 5. Presses (spec §4.6 G3, decision 25, §8.2 «участник → tgq:-строка с bot_group; повтор — без новой строки;
--    неподключённый — только счётчик; подключённый не участник → gone + счётчик»). The post shows
--    [ARP, DNS, NAT, DHCP] (shown {2,0,3,1}); the key DHCP is button 3.
select pg_temp.as_role('anon');
select pg_temp.expect_error(format('select public.bot_group_answer(%s, 70000002, 3)', pg_temp.c('p1')), array['42501'], 'anon presses');
select pg_temp.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.expect_error(format('select public.bot_group_answer(%s, 70000002, 3)', pg_temp.c('p1')), array['42501'], 'B presses through the API');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb; p bigint := pg_temp.c('p1')::bigint; g constant bigint := -1001000000001;
  v_tgq text;
begin
  -- not this post's chat, no such button, bad input, no such post: no key, nothing stored or counted
  r := public.bot_group_answer(p, 70000002, 3, -1001000000002, 501, pg_temp.t(interval '2 minutes'));
  if r ->> 'status' <> 'invalid' or r ->> 'reason' <> 'chat' then raise exception 'FAILED: another chat %', r; end if;
  perform pg_temp.no_key(r, 'a press from another chat');
  r := public.bot_group_answer(p, 70000002, 4, g, 501, pg_temp.t(interval '2 minutes'));
  if r ->> 'status' <> 'invalid' or r ->> 'reason' <> 'shown' then raise exception 'FAILED: button 4 %', r; end if;
  r := public.bot_group_answer(p, 70000002, 8, g, 501, pg_temp.t(interval '2 minutes'));
  if r ->> 'status' <> 'invalid' or r ->> 'reason' <> 'input' then raise exception 'FAILED: button 8 %', r; end if;
  r := public.bot_group_answer(p + 100000, 70000002, 1, g, 501, pg_temp.t(interval '2 minutes'));
  if r ->> 'status' <> 'closed' or r ->> 'reason' <> 'gone' then raise exception 'FAILED: no such post %', r; end if;
  perform pg_temp.no_key(r, 'a press on no post');
  if pg_temp.sq(format('select answered from bot.group_posts where id = %s', p))::int <> 0
     or pg_temp.sq(format('select count(*) from bot.group_answers where post_id = %s', p))::int <> 0 then
    raise exception 'FAILED: a refused press was stored'; end if;

  -- B, a member, right: one test_answers row (bot_group, tgq:<post>:<tg_user>), the rule's step two_days and the figure
  r := public.bot_group_answer(p, 70000002, 3, g, 501, pg_temp.t(interval '2 minutes'));
  if r ->> 'status' <> 'answered' or r ->> 'who' <> 'member' or not (r ->> 'correct')::boolean
     or r -> 'choice' <> '{"shown": 3, "text": "DHCP"}'::jsonb or r -> 'key' <> '{"shown": 3, "text": "DHCP"}'::jsonb
     or (r ->> 'answered')::int <> 1 or not (r ->> 'recorded')::boolean or r ->> 'core' <> 'saved' or r ->> 'step' <> 'two_days'
     or r -> 'figure' <> '{"two_days": 2, "in_plan": 9}'::jsonb then
    raise exception 'FAILED: B right %', r; end if;
  v_tgq := 'tgq:' || p::text || ':70000002';
  if pg_temp.sq(format($q$select count(*) from public.test_answers where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'
                          and client_event_id = %L and source = 'bot_group' and correct and chosen = '{1}'
                          and shown_order = '{2,0,3,1}' and item_id = %L and step = 'two_days' and mode = 'learn'$q$,
                       v_tgq, pg_temp.c('net1')))::int <> 1 then
    raise exception 'FAILED: B''s tgq row'; end if;
  -- a repeat: the first choice comes back, nothing new is written or counted
  r := public.bot_group_answer(p, 70000002, 0, g, 501, pg_temp.t(interval '3 minutes'));
  if r ->> 'status' <> 'repeat' or not (r ->> 'correct')::boolean or r -> 'choice' <> '{"shown": 3, "text": "DHCP"}'::jsonb
     or r -> 'key' <> '{"shown": 3, "text": "DHCP"}'::jsonb or (r ->> 'answered')::int <> 1 then
    raise exception 'FAILED: B again %', r; end if;
  if pg_temp.sq($q$select count(*) from public.test_answers where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'$q$)::int <> 1 then
    raise exception 'FAILED: a repeat wrote a row'; end if;
  -- E, a member, wrong: recorded as a miss — the key was shown, so it is a peek of today (no clean answer in private today)
  r := public.bot_group_answer(p, 70000005, 0, g, 501, pg_temp.t(interval '3 minutes'));
  if r ->> 'status' <> 'answered' or r ->> 'who' <> 'member' or (r ->> 'correct')::boolean
     or r -> 'choice' <> '{"shown": 0, "text": "ARP"}'::jsonb or r -> 'key' <> '{"shown": 3, "text": "DHCP"}'::jsonb
     or not (r ->> 'recorded')::boolean or r ->> 'step' <> 'miss' or r -> 'figure' <> 'null'::jsonb or (r ->> 'answered')::int <> 2 then
    raise exception 'FAILED: E wrong %', r; end if;
  if pg_temp.sq(format($q$select count(*) from public.test_answers where user_id = 'eeeeeeee-0000-0000-0000-000000000005'
                           and client_event_id = 'tgq:%s:70000005' and source = 'bot_group' and not correct and chosen = '{2}'$q$, p))::int <> 1
     or pg_temp.sq(format($q$select count(*) from public.test_item_states where user_id = 'eeeeeeee-0000-0000-0000-000000000005'
                           and item_id = %L and peek_day is not null and last_result = 'wrong'$q$, pg_temp.c('net1')))::int <> 1 then
    raise exception 'FAILED: E''s miss and peek'; end if;
  -- D, no Telegram link: only the counter
  r := public.bot_group_answer(p, 70000004, 1, g, 501, pg_temp.t(interval '4 minutes'));
  if r ->> 'status' <> 'answered' or r ->> 'who' <> 'unlinked' or (r ->> 'correct')::boolean or r ? 'recorded' or r ? 'step'
     or r -> 'key' <> '{"shown": 3, "text": "DHCP"}'::jsonb or (r ->> 'answered')::int <> 3 then
    raise exception 'FAILED: an unlinked press %', r; end if;
  -- C, linked but not in the exam: the core says gone, nothing written, counted
  r := public.bot_group_answer(p, 70000003, 3, g, 501, pg_temp.t(interval '4 minutes'));
  if r ->> 'status' <> 'answered' or r ->> 'who' <> 'outsider' or not (r ->> 'correct')::boolean or r ? 'recorded'
     or (r ->> 'answered')::int <> 4 then
    raise exception 'FAILED: an outsider %', r; end if;
  if pg_temp.sq($q$select count(*) from public.test_answers where user_id = 'cccccccc-0000-0000-0000-000000000003'$q$)::int <> 0 then
    raise exception 'FAILED: an outsider''s press written'; end if;
  -- A, the author: a member of the exam too
  r := public.bot_group_answer(p, 70000001, 3, g, 501, pg_temp.t(interval '5 minutes'));
  if r ->> 'who' <> 'member' or not (r ->> 'recorded')::boolean or r ->> 'step' <> 'start' then raise exception 'FAILED: the author %', r; end if;
  if pg_temp.sq(format($q$select count(*) from public.test_answers where source = 'bot_group' and client_event_id like 'tgq:%s:%%'$q$, p))::int <> 3
     or pg_temp.sq(format('select answered from bot.group_posts where id = %s', p))::int <> 5
     or pg_temp.sq(format('select count(*) from bot.group_answers where post_id = %s', p))::int <> 5 then
    raise exception 'FAILED: rows after five presses'; end if;
end
$t$;

-- 6. «Ответили N» at most once a minute (spec §4.6 G2, §6.6 step 4, §8.2 «счётчик ≤ 1/мин»).
do $t$
declare r record; n int; p bigint := pg_temp.c('p1')::bigint;
begin
  select count(*) into n from public.bot_group_counters(50, pg_temp.t(interval '5 minutes'));
  if n <> 1 then raise exception 'FAILED: % counters due', n; end if;
end
$t$;
do $t$
declare r record; n int := 0; p bigint := pg_temp.c('p1')::bigint; x jsonb;
begin
  -- the edit just handed out holds the post for a minute
  if exists (select 1 from public.bot_group_counters(50, pg_temp.t(interval '5 minutes 30 seconds'))) then
    raise exception 'FAILED: two counter edits within a minute'; end if;
  x := public.bot_group_counter_done(p, 5);
  if x ->> 'status' <> 'ok' or pg_temp.sq(format('select counter_shown from bot.group_posts where id = %s', p))::int <> 5 then
    raise exception 'FAILED: counter done %', x; end if;
  perform pg_temp.expect_error(format('select public.bot_group_counter_done(%s, 5, %L)', p, 'nope'), array['22023'], 'counter status');
  -- nothing new: nothing due, even a minute later
  if exists (select 1 from public.bot_group_counters(50, pg_temp.t(interval '7 minutes'))) then raise exception 'FAILED: a counter without news'; end if;
  -- a new press; the last edit was at +5 min: not before +6 min
  x := public.bot_group_answer(p, 70000006, 2, -1001000000001, 501, pg_temp.t(interval '5 minutes 40 seconds'));
  if (x ->> 'answered')::int <> 6 then raise exception 'FAILED: the sixth press %', x; end if;
  if exists (select 1 from public.bot_group_counters(50, pg_temp.t(interval '5 minutes 50 seconds'))) then
    raise exception 'FAILED: a counter within the minute'; end if;
  for r in select * from public.bot_group_counters(50, pg_temp.t(interval '6 minutes 1 second')) loop
    n := n + 1;
    if r.post_id <> p or r.chat_id <> -1001000000001 or r.tg_message_id <> 501 or r.answered <> 6
       or r.view ->> 'subject' <> 'Компьютерные сети' or r.view -> 'shown' <> '[2, 0, 3, 1]'::jsonb
       or r.view -> 'options' <> '["DNS", "DHCP", "ARP", "NAT"]'::jsonb then
      raise exception 'FAILED: the counter row %', row_to_json(r); end if;
    perform pg_temp.no_key(to_jsonb(r), 'the counter');
  end loop;
  if n <> 1 then raise exception 'FAILED: % counter rows', n; end if;
  -- a failed edit: tried again a minute later
  perform public.bot_group_counter_done(p, 6, 'failed');
  if exists (select 1 from public.bot_group_counters(50, pg_temp.t(interval '6 minutes 30 seconds'))) then
    raise exception 'FAILED: a failed counter retried within the minute'; end if;
  if not exists (select 1 from public.bot_group_counters(50, pg_temp.t(interval '7 minutes 2 seconds'))) then
    raise exception 'FAILED: a failed counter not retried'; end if;
  perform public.bot_group_counter_done(p, 6, 'shown');
  if pg_temp.sq(format('select counter_shown from bot.group_posts where id = %s', p))::int <> 6 then raise exception 'FAILED: counter 6'; end if;
end
$t$;

-- 7. The 21:00 close, once (spec §4.6 G2, §6.6 step 1).
do $t$
declare r record; n int := 0; p bigint := pg_temp.c('p1')::bigint; x jsonb;
begin
  if exists (select 1 from public.bot_claim_group_closes(50, pg_temp.t(interval '8 hours'))) then
    raise exception 'FAILED: a close before 21:00'; end if;
  -- a press just before 21:00 still counts; a counter edit is not handed out at or after 21:00
  x := public.bot_group_answer(p, 70000007, 1, -1001000000001, 501, pg_temp.t(interval '8 hours 58 minutes') - make_interval(mins => extract(minute from pg_temp.t() at time zone pg_temp.c('tz'))::int));
  if x ->> 'status' <> 'answered' or (x ->> 'answered')::int <> 7 then raise exception 'FAILED: a press at 20:58 %', x; end if;
  if exists (select 1 from public.bot_group_counters(50, pg_temp.t(interval '9 hours'))) then raise exception 'FAILED: a counter after 21:00'; end if;
  for r in select * from public.bot_claim_group_closes(50, pg_temp.t(interval '9 hours')) loop
    n := n + 1;
    if r.post_id <> p or r.tg_message_id <> 501 or r.answered <> 7 or r.view ->> 'stem' is null then
      raise exception 'FAILED: the close row %', row_to_json(r); end if;
    perform pg_temp.no_key(to_jsonb(r), 'the close');
  end loop;
  if n <> 1 then raise exception 'FAILED: % closes', n; end if;
  -- leased: a second tick does not close it again
  if exists (select 1 from public.bot_claim_group_closes(50, pg_temp.t(interval '9 hours 1 minute'))) then
    raise exception 'FAILED: a second close'; end if;
  -- a press after 21:00: closed, no key
  x := public.bot_group_answer(p, 70000008, 3, -1001000000001, 501, pg_temp.t(interval '9 hours'));
  if x ->> 'status' <> 'closed' or x ->> 'reason' <> 'time' then raise exception 'FAILED: a press after 21:00 %', x; end if;
  perform pg_temp.no_key(x, 'a press after 21:00');
  perform pg_temp.expect_error(format('select public.bot_group_closed(%s, %L)', p, 'nope'), array['22023'], 'close status');
  x := public.bot_group_closed(p, 'closed', pg_temp.t(interval '9 hours'));
  if x ->> 'status' <> 'ok' then raise exception 'FAILED: closed %', x; end if;
  x := public.bot_group_closed(p, 'closed', pg_temp.t(interval '9 hours'));
  if x ->> 'status' <> 'ignored' then raise exception 'FAILED: closed twice %', x; end if;
  if pg_temp.sq(format($q$select status || ':' || answered from bot.group_posts where id = %s and closed_at is not null$q$, p)) <> 'closed:7' then
    raise exception 'FAILED: the closed row'; end if;
  if exists (select 1 from public.bot_claim_group_closes(50, pg_temp.t(interval '9 hours 30 minutes'))) then
    raise exception 'FAILED: a close after closed'; end if;
  x := public.bot_group_answer(p, 70000002, 3, -1001000000001, 501, pg_temp.t(interval '2 hours'));
  if x ->> 'status' <> 'closed' or x ->> 'reason' <> 'status' then raise exception 'FAILED: a press on a closed post %', x; end if;
end
$t$;

-- 8. At most once (spec decision 7, §6.5): sending → unknown is never sent again; a claimed post is taken again after 10
--    minutes and only one of two workers gets to send it; retry (429) and a press that brings an unknown post back.
--    G2 (-1001000000002, 15:00) is turned on again; G4 (-1001000000004, 12:00) is bound directly (the claim is tested).
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$ begin
  if not (public.telegram_group_set(-1001000000002, 15, true) ->> 'on')::boolean then raise exception 'FAILED: G2 on again'; end if;
end $t$;
select pg_temp.as_role('postgres');
select pg_temp.sx(format($q$insert into bot.groups (chat_id, container_id, link_id, owner_id, title, post_hour, tz)
  values (-1001000000004, %L, %L, 'aaaaaaaa-0000-0000-0000-000000000001', 'Четвёртая', 12, %L)$q$,
  pg_temp.c('c'), pg_temp.c('glink'), pg_temp.c('tz')));
select pg_temp.as_role('service_role');
do $t$
declare r record; n int; x jsonb; p2 bigint; p4 bigint;
begin
  -- G2 at 15:xx: claimed, picked, sending — and the worker dies before bot_group_posted
  select * into r from public.bot_claim_group_posts(10, pg_temp.t(interval '3 hours')) where group_chat_id = -1001000000002;
  p2 := r.post_id;
  if p2 is null then raise exception 'FAILED: G2 not claimed at 15:00'; end if;
  perform pg_temp.put('p2', p2::text);
  if public.bot_group_pick(p2, pg_temp.c('net6')) ->> 'status' <> 'picked' then raise exception 'FAILED: G2 pick'; end if;
  if not public.bot_group_sending(p2, array[4, 3, 2, 1, 0], pg_temp.t(interval '3 hours')) then raise exception 'FAILED: G2 sending'; end if;
  -- ten minutes later the sweep makes it unknown; no second post that day
  if exists (select 1 from public.bot_claim_group_posts(10, pg_temp.t(interval '3 hours 11 minutes')) where group_chat_id = -1001000000002) then
    raise exception 'FAILED: a second post after a death while sending'; end if;
  if pg_temp.sq(format('select status || '':'' || error from bot.group_posts where id = %s', p2)) <> 'unknown:died while sending' then
    raise exception 'FAILED: sending → unknown'; end if;
  if public.bot_group_sending(p2, array[4, 3, 2, 1, 0], pg_temp.t(interval '3 hours 12 minutes')) then raise exception 'FAILED: an unknown post sent'; end if;
  -- the post is in the chat after all: a press brings back its message id (never one of an earlier post of the chat)
  x := public.bot_group_answer(p2, 70000002, 2, -1001000000002, 900, pg_temp.t(interval '3 hours 20 minutes'));
  if x ->> 'status' <> 'answered' or not (x ->> 'correct')::boolean or x -> 'key' <> '{"shown": 2, "text": "HTTPS"}'::jsonb then
    raise exception 'FAILED: a press on an unknown post %', x; end if;
  if pg_temp.sq(format('select status || '':'' || tg_message_id from bot.group_posts where id = %s', p2)) <> 'open:900' then
    raise exception 'FAILED: the message id of an unknown post'; end if;
  x := public.bot_group_posted(p2, 'sent', 900, null, pg_temp.t(interval '3 hours 21 minutes'));
  if x ->> 'status' <> 'ok' then raise exception 'FAILED: a late posted after a press %', x; end if;

  -- G4: claimed at 12:xx, the worker dies before sending; another worker takes it again after 10 minutes
  select * into r from public.bot_claim_group_posts(10, pg_temp.t(interval '2 minutes')) where group_chat_id = -1001000000004;
  p4 := r.post_id;
  if p4 is null then raise exception 'FAILED: G4 not claimed'; end if;
  perform pg_temp.put('p4', p4::text);
  if public.bot_group_pick(p4, pg_temp.c('db1')) ->> 'status' <> 'picked' then raise exception 'FAILED: G4 pick'; end if;
  if exists (select 1 from public.bot_claim_group_posts(10, pg_temp.t(interval '7 minutes')) where group_chat_id = -1001000000004) then
    raise exception 'FAILED: taken again before 10 minutes'; end if;
  select count(*) into n from public.bot_claim_group_posts(10, pg_temp.t(interval '13 minutes')) x
   where x.post_id = p4 and x.kind = 'post' and x.candidates -> 'items' is not null;
  if n <> 1 or pg_temp.sq(format('select attempts from bot.group_posts where id = %s', p4))::int <> 2 then
    raise exception 'FAILED: taken again after 10 minutes (%)', n; end if;
  -- the second worker picks and sends; the first one wakes up: no second send
  if public.bot_group_pick(p4, pg_temp.c('db3')) ->> 'status' <> 'picked' then raise exception 'FAILED: G4 second pick'; end if;
  if not public.bot_group_sending(p4, array[3, 1, 0, 2], pg_temp.t(interval '13 minutes')) then raise exception 'FAILED: G4 sending'; end if;
  if public.bot_group_sending(p4, array[0, 1, 2, 3], pg_temp.t(interval '13 minutes')) then raise exception 'FAILED: G4 sent twice'; end if;
  -- 429: certainly not posted → claimed again, offered after 10 minutes (the third and last try)
  x := public.bot_group_posted(p4, 'retry', null, 'TelegramError:429', pg_temp.t(interval '13 minutes'));
  if x ->> 'status' <> 'ok' or pg_temp.sq(format('select status from bot.group_posts where id = %s', p4)) <> 'claimed' then
    raise exception 'FAILED: retry %', x; end if;
  if (select count(*) from public.bot_claim_group_posts(10, pg_temp.t(interval '24 minutes')) x where x.post_id = p4) <> 1 then
    raise exception 'FAILED: a retry not offered again'; end if;
  if public.bot_group_pick(p4, pg_temp.c('db3')) ->> 'status' <> 'picked'
     or not public.bot_group_sending(p4, array[3, 1, 0, 2], pg_temp.t(interval '24 minutes')) then
    raise exception 'FAILED: the third try'; end if;
  x := public.bot_group_posted(p4, 'failed', null, 'TelegramError:400', pg_temp.t(interval '24 minutes'));
  if x ->> 'status' <> 'ok' or pg_temp.sq(format('select status || '':'' || error from bot.group_posts where id = %s', p4)) <> 'failed:TelegramError:400' then
    raise exception 'FAILED: a failed send %', x; end if;
  -- a failed post is never offered again, and gets no presses
  if exists (select 1 from public.bot_claim_group_posts(10, pg_temp.t(interval '40 minutes')) x where x.group_chat_id = -1001000000004) then
    raise exception 'FAILED: a failed post offered again'; end if;
  x := public.bot_group_answer(p4, 70000002, 0, -1001000000004, 950, pg_temp.t(interval '41 minutes'));
  if x ->> 'status' <> 'closed' then raise exception 'FAILED: a press on a failed post %', x; end if;
  -- a claim after 3 tries stays claimed until the 3-hour sweep fails it (no fourth try)
  perform pg_temp.sx(format($q$update bot.group_posts set status = 'claimed', attempts = 3, claimed_at = %L where id = %s$q$,
                            pg_temp.t(interval '41 minutes'), p4));
  if exists (select 1 from public.bot_claim_group_posts(10, pg_temp.t(interval '55 minutes')) x where x.post_id = p4) then
    raise exception 'FAILED: a fourth try'; end if;
  perform public.bot_claim_group_posts(10, pg_temp.t(interval '3 hours 42 minutes'));
  if pg_temp.sq(format('select status || '':'' || error from bot.group_posts where id = %s', p4)) <> 'failed:abandoned' then
    raise exception 'FAILED: abandoned after 3 hours'; end if;
end
$t$;

-- 9. No post on an exam day, after the date, after the group link is revoked or has expired, or when the author turned it
--    off (spec §4.6 G2, §8.2 «отзыв ссылки и день экзамена → поста нет»). A second exam «Зимняя сессия» of A: subjects
--    «Сети» (the exam's date) and «Базы» (its own date); G6 (-1001000000006, 12:00) bound to it.
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$
declare r jsonb;
begin
  r := public.container_create('Зимняя сессия', pg_temp.c('day')::date + 30, '[{"title":"Сети"},{"title":"Базы"}]');
  perform pg_temp.put('c2', r ->> 'container_id');
  perform pg_temp.put('c2s1', r -> 'subjects' -> 0 ->> 'id');
  perform pg_temp.put('c2s2', r -> 'subjects' -> 1 ->> 'id');
  perform public.container_items_add(pg_temp.c('c2s1')::uuid,
    '[{"ref":"w:1","file_no":"1","topic":1,"stem":"Какой порт по умолчанию у HTTPS?","options":["80","443","21","25"],"correct":[1],"key_source":"bold"}]');
  perform public.container_items_add(pg_temp.c('c2s2')::uuid,
    '[{"ref":"w:2","file_no":"2","topic":1,"stem":"Какая нормальная форма запрещает транзитивные зависимости?","options":["Первая","Вторая","Третья","Четвёртая"],"correct":[2],"key_source":"bold"}]');
  update public.container_subjects set exam_date = pg_temp.c('day')::date + 40 where id = pg_temp.c('c2s2')::uuid;
  r := public.container_link_create(pg_temp.c('c2')::uuid, 60);
  perform pg_temp.put('c2code', r ->> 'code');
  perform pg_temp.put('c2link', r ->> 'link_id');
end
$t$;
select pg_temp.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
do $t$ begin
  if not (public.container_join(pg_temp.c('c2code')) ->> 'joined')::boolean then raise exception 'FAILED: B did not join the second exam'; end if;
end $t$;
select pg_temp.as_role('postgres');
select pg_temp.sx(format($q$insert into bot.groups (chat_id, container_id, link_id, owner_id, title, post_hour, tz)
  values (-1001000000006, %L, %L, 'aaaaaaaa-0000-0000-0000-000000000001', 'Шестая', 12, %L)$q$,
  pg_temp.c('c2'), pg_temp.c('c2link'), pg_temp.c('tz')));
select pg_temp.put('w1', (select id::text from public.test_items where import_ref = 'w:1'));
select pg_temp.put('w2', (select id::text from public.test_items where import_ref = 'w:2'));
-- G6's row of today, if any: status:error.
create or replace function pg_temp.g6_today() returns text language sql as $fn$
  select pg_temp.sq(format($q$select coalesce(max(status || ':' || coalesce(error, '')), '') from bot.group_posts
                               where chat_id = -1001000000006 and local_day = %L$q$, pg_temp.c('day')))
$fn$;
create or replace function pg_temp.g6_claim(p_offset interval) returns bigint language sql as $fn$
  select x.post_id from public.bot_claim_group_posts(10, pg_temp.t(p_offset)) x where x.group_chat_id = -1001000000006
$fn$;
grant execute on function pg_temp.g6_today(), pg_temp.g6_claim(interval) to service_role;
-- the exam's own date is today → no post; a failed row for the day (nothing to retry: the tick goes quiet)
update public.containers set exam_date = pg_temp.c('day')::date where id = pg_temp.c('c2')::uuid;
select pg_temp.as_role('service_role');
do $t$ begin
  if pg_temp.g6_claim(interval '3 minutes') is not null then raise exception 'FAILED: a post on the exam day'; end if;
  if pg_temp.g6_today() <> 'failed:exam_day' then raise exception 'FAILED: the exam day row %', pg_temp.g6_today(); end if;
  if pg_temp.g6_claim(interval '4 minutes') is not null then raise exception 'FAILED: a post on the exam day, later'; end if;
end $t$;
-- after the last date (yesterday) → no post (after_date)
select pg_temp.as_role('postgres');
select pg_temp.sx('delete from bot.group_posts where chat_id = -1001000000006');
update public.containers set exam_date = pg_temp.c('day')::date - 1 where id = pg_temp.c('c2')::uuid;
update public.container_subjects set exam_date = pg_temp.c('day')::date - 2 where id = pg_temp.c('c2s2')::uuid;
select pg_temp.as_role('service_role');
do $t$ begin
  if pg_temp.g6_claim(interval '5 minutes') is not null or pg_temp.g6_today() <> 'failed:after_date' then
    raise exception 'FAILED: a post after the date (%)', pg_temp.g6_today(); end if;
end $t$;
-- a subject's own date today (the exam's later) → exam_day as well
select pg_temp.as_role('postgres');
select pg_temp.sx('delete from bot.group_posts where chat_id = -1001000000006');
update public.containers set exam_date = pg_temp.c('day')::date + 30 where id = pg_temp.c('c2')::uuid;
update public.container_subjects set exam_date = pg_temp.c('day')::date where id = pg_temp.c('c2s2')::uuid;
select pg_temp.as_role('service_role');
do $t$ begin
  if pg_temp.g6_claim(interval '6 minutes') is not null or pg_temp.g6_today() <> 'failed:exam_day' then
    raise exception 'FAILED: a post on a subject''s exam day (%)', pg_temp.g6_today(); end if;
end $t$;
-- that subject's date passed (yesterday), the exam's is later: a post, without that subject's questions
select pg_temp.as_role('postgres');
select pg_temp.sx('delete from bot.group_posts where chat_id = -1001000000006');
update public.container_subjects set exam_date = pg_temp.c('day')::date - 1 where id = pg_temp.c('c2s2')::uuid;
select pg_temp.as_role('service_role');
do $t$
declare r record;
begin
  select * into r from public.bot_claim_group_posts(10, pg_temp.t(interval '7 minutes')) x where x.group_chat_id = -1001000000006;
  if r.post_id is null or (select array_agg(i ->> 'rev') from jsonb_array_elements(r.candidates -> 'items') i) <> array[pg_temp.c('w1')] then
    raise exception 'FAILED: a post without the passed subject %', r.candidates; end if;
  if public.bot_group_pick(r.post_id, pg_temp.c('w2')) ->> 'status' <> 'invalid' then raise exception 'FAILED: a passed subject picked'; end if;
  if public.bot_group_pick(r.post_id, pg_temp.c('net1')) ->> 'status' <> 'invalid' then raise exception 'FAILED: another exam''s question picked'; end if;
  perform pg_temp.put('p6', r.post_id::text);
end $t$;
-- the group link revoked after the pick: sending says no (the post fails), and the next day's claim turns the group off
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$ begin
  if public.container_link_revoke(pg_temp.c('c2link')::uuid) ->> 'revoked_at' is null then raise exception 'FAILED: revoke'; end if;
end $t$;
select pg_temp.as_role('service_role');
do $t$
declare g jsonb;
begin
  if public.bot_group_pick(pg_temp.c('p6')::bigint, pg_temp.c('w1')) ->> 'status' <> 'picked' then raise exception 'FAILED: G6 pick'; end if;
  if public.bot_group_sending(pg_temp.c('p6')::bigint, array[1, 0, 3, 2], pg_temp.t(interval '8 minutes')) then
    raise exception 'FAILED: sent after the link was revoked'; end if;
  if pg_temp.g6_today() <> 'failed:link' then raise exception 'FAILED: the revoked link row %', pg_temp.g6_today(); end if;
  perform pg_temp.sx('delete from bot.group_posts where chat_id = -1001000000006');
  if pg_temp.g6_claim(interval '9 minutes') is not null then raise exception 'FAILED: a post after the link was revoked'; end if;
  if pg_temp.sq('select off_reason from bot.groups where chat_id = -1001000000006') <> 'link' or pg_temp.g6_today() <> '' then
    raise exception 'FAILED: off after the link was revoked'; end if;
end $t$;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$
declare r jsonb; g jsonb;
begin
  r := public.telegram_groups(pg_temp.c('c2')::uuid);
  g := r -> 'groups' -> 0;
  if (r ->> 'link_active')::boolean or (g ->> 'on')::boolean or g ->> 'off_reason' <> 'link' or (g ->> 'link_active')::boolean then
    raise exception 'FAILED: the site after the revoke %', r; end if;
  perform pg_temp.expect_error(format('select public.telegram_group_code(%L::uuid, 12)', pg_temp.c('c2')), array['MT002'],
                               'a G code after the revoke');
  -- a new group link: the chat is connected again with a new code (turning it on keeps the old, revoked link)
  r := public.container_link_create(pg_temp.c('c2')::uuid, 60);
  g := public.telegram_group_set(-1001000000006, null, true);
  if not (g ->> 'on')::boolean or (g ->> 'link_active')::boolean then raise exception 'FAILED: on with the old link %', g; end if;
  perform pg_temp.sx($q$update bot.link_codes set created_at = created_at - interval '2 hours'
                         where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and purpose = 'group'$q$);
  perform pg_temp.put('code_g6', public.telegram_group_code(pg_temp.c('c2')::uuid, 12) ->> 'code');
end $t$;
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  if pg_temp.g6_claim(interval '10 minutes') is not null or pg_temp.sq('select off_reason from bot.groups where chat_id = -1001000000006') <> 'link' then
    raise exception 'FAILED: on again with the revoked link'; end if;
  r := public.bot_group_claim(pg_temp.c('code_g6'), -1001000000006, 'supergroup', 'Шестая', 70000001, now());
  if r ->> 'status' <> 'bound' or (r ->> 'again')::boolean then raise exception 'FAILED: G6 bound again %', r; end if;
  if pg_temp.g6_claim(interval '11 minutes') is null then raise exception 'FAILED: no post after binding with the new link'; end if;
end $t$;
-- the author turned it off: no post the next day (it is not even due)
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$ begin
  if public.telegram_group_set(-1001000000006, null, false) ->> 'off_reason' <> 'author' then raise exception 'FAILED: off by the author'; end if;
end $t$;
select pg_temp.as_role('postgres');
select pg_temp.sx('delete from bot.group_posts where chat_id = -1001000000006');
select pg_temp.as_role('service_role');
do $t$ begin
  if pg_temp.g6_claim(interval '12 minutes') is not null or pg_temp.g6_today() <> '' then raise exception 'FAILED: a post when off'; end if;
end $t$;

-- 10. 5 posts in a row without an answer → off + G4 once (spec §4.6 G2, G4; §8.2 «5 пустых → выкл»). G5: five empty
--     posts on the last five days (an answered one before them); G7: an unknown post without presses in between does not
--     count, so its last five counted posts include an answered one; G8: the author blocked the bot → off, no G4.
select pg_temp.as_role('postgres');
do $t$
declare g bigint; d int; v_day date := pg_temp.c('day')::date;
begin
  foreach g in array array[-1001000000005, -1001000000007, -1001000000008] loop
    perform pg_temp.sx(format($q$insert into bot.groups (chat_id, container_id, link_id, owner_id, title, post_hour, tz, bound_at, on_at)
      values (%s, %L, %L, 'aaaaaaaa-0000-0000-0000-000000000001', %L, 12, %L, %L, %L)$q$,
      g, pg_temp.c('c'), pg_temp.c('glink'), 'Группа ' || (-g % 10), pg_temp.c('tz'), pg_temp.t(- interval '10 days'), pg_temp.t(- interval '10 days')));
    for d in 1..6 loop
      perform pg_temp.sx(format($q$insert into bot.group_posts (chat_id, local_day, item_id, item_rev, shown, status, claimed_at,
                                     posted_at, tg_message_id, answered, counter_shown, closed_at)
        values (%s, %L, %L, 1, '{0,1,2,3}', %L, %L, %L, %s, %s, %s, %L)$q$,
        g, v_day - d, pg_temp.c('net1'), case when g = -1001000000007 and d = 3 then 'unknown' else 'closed' end,
        pg_temp.t(- make_interval(days => d)), pg_temp.t(- make_interval(days => d)), 100 + 10 * (7 - d),
        case when d = 6 then 1 else 0 end, case when d = 6 then 1 else 0 end,
        case when g = -1001000000007 and d = 3 then null else pg_temp.t(- make_interval(days => d) + interval '9 hours') end));
    end loop;
  end loop;
  perform pg_temp.sx($q$update bot.links set blocked_at = now() where tg_user_id = 70000001$q$);
end
$t$;
select pg_temp.as_role('service_role');
do $t$
declare r record; n_g4 int := 0; v_d bigint;
begin
  for r in select * from public.bot_claim_group_posts(10, pg_temp.t(interval '15 minutes'))
            where group_chat_id in (-1001000000005, -1001000000007, -1001000000008) loop
    if r.group_chat_id = -1001000000005 or r.group_chat_id = -1001000000008 then
      raise exception 'FAILED: % posted or told with the author blocked: %', r.group_chat_id, row_to_json(r); end if;
    if r.kind <> 'post' then raise exception 'FAILED: G7 %', row_to_json(r); end if;
  end loop;
  -- G8 is off without a G4 (the author's Telegram is blocked); G5 too, here, since the author was blocked at the claim
  if pg_temp.sq('select off_reason from bot.groups where chat_id = -1001000000008') <> 'empty'
     or pg_temp.sq('select off_reason from bot.groups where chat_id = -1001000000005') <> 'empty'
     or pg_temp.sq($q$select count(*) from bot.deliveries where kind = 'notice' and ref like 'g4:%'$q$)::int <> 0 then
    raise exception 'FAILED: 5 empty with the author blocked'; end if;
  if pg_temp.sq('select off_at is null from bot.groups where chat_id = -1001000000007')::boolean is not true then
    raise exception 'FAILED: G7 off'; end if;
end
$t$;
-- G5 again with the author reachable: on again by hand would restart the count, so put it back off-less as it was
select pg_temp.as_role('postgres');
select pg_temp.sx($q$update bot.links set blocked_at = null where tg_user_id = 70000001$q$);
select pg_temp.sx($q$update bot.groups set off_at = null, off_reason = null where chat_id = -1001000000005$q$);
select pg_temp.as_role('service_role');
do $t$
declare r record; n int := 0; v_d bigint; x jsonb;
begin
  for r in select * from public.bot_claim_group_posts(10, pg_temp.t(interval '16 minutes')) where group_chat_id = -1001000000005 loop
    n := n + 1;
    if r.kind <> 'g4' or r.post_id is not null or r.delivery_id is null or r.chat_id <> 70000001 or r.title <> 'Группа 5'
       or r.exam_title <> 'Осенняя сессия' or r.container_id <> pg_temp.c('c')::uuid or r.local_day <> pg_temp.c('day')::date
       or r.candidates is not null then
      raise exception 'FAILED: the G4 row %', row_to_json(r); end if;
    v_d := r.delivery_id;
  end loop;
  if n <> 1 then raise exception 'FAILED: % G4 rows', n; end if;
  if pg_temp.sq(format($q$select count(*) from bot.deliveries where id = %s and kind = 'notice' and chat_id = 70000001
                           and ref = 'g4:-1001000000005' and status = 'claimed' and local_day = %L$q$, v_d, pg_temp.c('day')))::int <> 1
     or pg_temp.sq('select off_reason from bot.groups where chat_id = -1001000000005') <> 'empty' then
    raise exception 'FAILED: the G4 notice row'; end if;
  -- once: the next tick has nothing for G5; a notice never tried comes back after 10 minutes
  if exists (select 1 from public.bot_claim_group_posts(10, pg_temp.t(interval '17 minutes')) where group_chat_id = -1001000000005) then
    raise exception 'FAILED: G4 twice'; end if;
  if (select count(*) from public.bot_claim_group_posts(10, pg_temp.t(interval '27 minutes')) x where x.kind = 'g4' and x.delivery_id = v_d) <> 1 then
    raise exception 'FAILED: a G4 never tried not offered again'; end if;
  -- sent through T1's delivery functions; then never again
  if not public.bot_delivery_sending(v_d, pg_temp.t(interval '27 minutes')) then raise exception 'FAILED: G4 sending'; end if;
  x := public.bot_delivery_done(v_d, 'sent', 9001, null, pg_temp.t(interval '27 minutes'));
  if x ->> 'status' <> 'ok' or x ->> 'kind' <> 'notice' then raise exception 'FAILED: G4 done %', x; end if;
  if exists (select 1 from public.bot_claim_group_posts(10, pg_temp.t(interval '45 minutes')) where group_chat_id = -1001000000005) then
    raise exception 'FAILED: G4 after it was sent'; end if;
end
$t$;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$
declare g jsonb;
begin
  select x into g from jsonb_array_elements(public.telegram_groups(pg_temp.c('c')::uuid) -> 'groups') x
   where (x ->> 'chat_id')::bigint = -1001000000005;
  if (g ->> 'on')::boolean or g ->> 'off_reason' <> 'empty' then raise exception 'FAILED: the site after G4 %', g; end if;
  -- on again: the count starts over (on_at), so the five empty posts before it do not stop it
  g := public.telegram_group_set(-1001000000005, null, true);
  if not (g ->> 'on')::boolean then raise exception 'FAILED: on again %', g; end if;
end
$t$;
select pg_temp.as_role('service_role');
do $t$ begin
  if not exists (select 1 from public.bot_claim_group_posts(10, pg_temp.t(interval '46 minutes')) x
                  where x.group_chat_id = -1001000000005 and x.kind = 'post') then
    raise exception 'FAILED: no post after on again'; end if;
end $t$;
do $t$ begin
  if pg_temp.sq($q$select count(*) from bot.group_posts where chat_id = -1001000000007 and status = 'claimed'$q$)::int <> 1 then
    raise exception 'FAILED: G7 (an unknown post without presses does not count) got no post'; end if;
end $t$;

-- 11. migrate_to_chat_id moves the group (spec §6.7, §8.3 п. 8); the bot removed → unbound; «Заниматься в Meldy».
select pg_temp.as_role('service_role');
do $t$
declare r jsonb; p2 bigint := pg_temp.c('p2')::bigint;
begin
  perform pg_temp.expect_error('select public.bot_group_event(-1001000000002, ''joined'')', array['22023'], 'an unknown event');
  perform pg_temp.expect_error('select public.bot_group_event(-1001000000002, ''migrated'')', array['22023'], 'migrated without a new id');
  perform pg_temp.expect_error('select public.bot_group_event(-1001000000002, ''migrated'', 5)', array['22023'], 'migrated to a private chat');
  perform pg_temp.expect_error('select public.bot_group_event(-1001000000002, ''migrated'', -1001000000002)', array['22023'], 'migrated to itself');
  r := public.bot_group_event(-1001000000002, 'migrated', -1009000000002);
  if r ->> 'status' <> 'ok' or not (r ->> 'changed')::boolean or (r ->> 'chat_id')::bigint <> -1009000000002 then raise exception 'FAILED: migrated %', r; end if;
  if pg_temp.sq('select count(*) from bot.groups where chat_id = -1001000000002')::int <> 0
     or pg_temp.sq($q$select count(*) from bot.groups where chat_id = -1009000000002 and left_at is null and post_hour = 15
                       and title = 'Вторая группа'$q$)::int <> 1
     or pg_temp.sq(format('select chat_id from bot.group_posts where id = %s', p2))::bigint <> -1009000000002 then
    raise exception 'FAILED: the group and its posts did not move'; end if;
  r := public.bot_group_event(-1001000000002, 'migrated', -1009000000002);
  if (r ->> 'changed')::boolean then raise exception 'FAILED: migrated twice %', r; end if;
  -- presses come from the new chat now; the old id is not this post's chat
  r := public.bot_group_answer(p2, 70000003, 0, -1009000000002, 900, pg_temp.t(interval '3 hours 30 minutes'));
  if r ->> 'status' <> 'answered' or r ->> 'who' <> 'outsider' then raise exception 'FAILED: a press after the migration %', r; end if;
  r := public.bot_group_answer(p2, 70000005, 0, -1001000000002, 900, pg_temp.t(interval '3 hours 30 minutes'));
  if r ->> 'status' <> 'invalid' or r ->> 'reason' <> 'chat' then raise exception 'FAILED: a press from the old chat %', r; end if;
  -- an old unbound row of the new chat is replaced; a new chat already bound keeps its binding (the old one ends)
  perform pg_temp.sx(format($q$insert into bot.groups (chat_id, container_id, owner_id, post_hour, tz, left_at)
    values (-1009000000004, %L, 'aaaaaaaa-0000-0000-0000-000000000001', 9, 'Europe/Minsk', now() - interval '3 days')$q$, pg_temp.c('c')));
  r := public.bot_group_event(-1001000000004, 'migrated', -1009000000004);
  if not (r ->> 'changed')::boolean or pg_temp.sq('select post_hour from bot.groups where chat_id = -1009000000004')::int <> 12
     or pg_temp.sq(format('select chat_id from bot.group_posts where id = %s', pg_temp.c('p4')))::bigint <> -1009000000004 then
    raise exception 'FAILED: migrated onto an old row %', r; end if;
  perform pg_temp.sx(format($q$insert into bot.groups (chat_id, container_id, link_id, owner_id, post_hour, tz) values
    (-1001000000010, %1$L, %2$L, 'aaaaaaaa-0000-0000-0000-000000000001', 9, 'Europe/Minsk'),
    (-1009000000010, %1$L, %2$L, 'aaaaaaaa-0000-0000-0000-000000000001', 18, 'Europe/Minsk')$q$, pg_temp.c('c'), pg_temp.c('glink')));
  r := public.bot_group_event(-1001000000010, 'migrated', -1009000000010);
  if not (r ->> 'changed')::boolean or (r ->> 'chat_id')::bigint <> -1009000000010
     or pg_temp.sq('select left_at is not null from bot.groups where chat_id = -1001000000010')::boolean is not true
     or pg_temp.sq('select post_hour from bot.groups where chat_id = -1009000000010 and left_at is null')::int <> 18 then
    raise exception 'FAILED: migrated onto a bound chat %', r; end if;
  -- the bot removed from G6 and G7 (kicked / left): unbound
  r := public.bot_group_event(-1001000000006, 'kicked');
  if not (r ->> 'changed')::boolean then raise exception 'FAILED: kicked %', r; end if;
  r := public.bot_group_event(-1001000000006, 'kicked');
  if (r ->> 'changed')::boolean then raise exception 'FAILED: kicked twice %', r; end if;
  r := public.bot_group_event(-1001000000007, 'left');
  if not (r ->> 'changed')::boolean then raise exception 'FAILED: left %', r; end if;
  r := public.bot_group_event(70000002, 'kicked');
  if (r ->> 'changed')::boolean then raise exception 'FAILED: a private chat unbound here %', r; end if;
  -- «Заниматься в Meldy»
  r := public.bot_group_entry(70000002, -1001000000001);
  if r <> jsonb_build_object('linked', true, 'status', 'ok', 'container_id', pg_temp.c('c'), 'exam_title', 'Осенняя сессия', 'role', 'member') then
    raise exception 'FAILED: entry of a member %', r; end if;
  if public.bot_group_entry(70000001, -1001000000001) ->> 'role' <> 'owner' then raise exception 'FAILED: entry of the author'; end if;
  r := public.bot_group_entry(70000003, -1001000000001);
  if r ->> 'status' <> 'ok' or r -> 'role' <> 'null'::jsonb or r ->> 'exam_title' <> 'Осенняя сессия' then raise exception 'FAILED: entry of an outsider %', r; end if;
  if public.bot_group_entry(70000004, -1001000000001) <> '{"linked": false}'::jsonb then raise exception 'FAILED: entry unlinked'; end if;
  if public.bot_group_entry(70000002, -1001000000006) <> '{"linked": true, "status": "unknown"}'::jsonb then raise exception 'FAILED: entry of a left chat'; end if;
end
$t$;
-- the next day (in a savepoint: that claim takes tomorrow's posts of the other chats too): nothing for the removed chats
savepoint next_day;
select pg_temp.as_role('service_role');
do $t$
declare v_chats bigint[];
begin
  select array_agg(x.group_chat_id) into v_chats from public.bot_claim_group_posts(10, pg_temp.t(interval '1 day')) x;
  if v_chats && array[-1001000000006, -1001000000007]::bigint[] then raise exception 'FAILED: a post after the bot was removed'; end if;
  if not (v_chats @> array[-1001000000001]::bigint[]) then raise exception 'FAILED: G1 got no post the next day (%)', v_chats; end if;
end $t$;
rollback to savepoint next_day;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$ begin
  if jsonb_array_length(public.telegram_groups(pg_temp.c('c2')::uuid) -> 'groups') <> 0 then raise exception 'FAILED: a left chat listed'; end if;
  perform pg_temp.expect_error('select public.telegram_group_set(-1001000000006, null, true)', array['P0002'], 'turning on a left chat');
end $t$;

-- 12. Closes without an edit, a deleted question, the housekeeping (spec §6.2 «удаляются через 2 дня после закрытия»).
select pg_temp.as_role('service_role');
do $t$
declare v_p5 bigint;
begin
  -- G5's post of today dies while sending (it will be unknown at 21:00)
  select id into v_p5 from (select pg_temp.sq($q$select id from bot.group_posts where chat_id = -1001000000005
                                                  and status = 'claimed'$q$)::bigint as id) x;
  perform pg_temp.put('p5', v_p5::text);
  if public.bot_group_pick(v_p5, pg_temp.c('db3')) ->> 'status' <> 'picked'
     or not public.bot_group_sending(v_p5, array[0, 1, 2, 3], pg_temp.t(interval '50 minutes')) then
    raise exception 'FAILED: G5 sending'; end if;
end
$t$;
select pg_temp.as_role('postgres');
-- an open post in G6, which the bot has left; presses of G5's older posts (three days and one day after their close)
select pg_temp.sx(format($q$insert into bot.group_posts (chat_id, local_day, item_id, item_rev, shown, status, claimed_at, posted_at,
  tg_message_id) values (-1001000000006, %L, %L, 1, '{1,0,3,2}', 'open', %L, %L, 300)$q$,
  pg_temp.c('day'), pg_temp.c('w1'), pg_temp.t(), pg_temp.t()));
select pg_temp.sx(format($q$insert into bot.group_answers (post_id, tg_user_id, shown, correct)
  select p.id, u, 0, false from bot.group_posts p, unnest(array[71000001, 71000002]) u
   where p.chat_id = -1001000000005 and p.local_day in (%L::date - 3, %L::date - 1)$q$, pg_temp.c('day'), pg_temp.c('day')));
-- a post older than 90 days, a group the bot left 31 days ago
select pg_temp.sx(format($q$insert into bot.group_posts (chat_id, local_day, status, claimed_at, error)
  values (-1001000000001, %L::date - 91, 'failed', now() - interval '91 days', 'none')$q$, pg_temp.c('day')));
select pg_temp.sx(format($q$insert into bot.groups (chat_id, container_id, owner_id, post_hour, tz, left_at)
  values (-1001000000011, %L, 'aaaaaaaa-0000-0000-0000-000000000001', 9, 'Europe/Minsk', now() - interval '31 days')$q$, pg_temp.c('c')));
select pg_temp.sx($q$insert into bot.group_posts (chat_id, local_day, status, claimed_at, error)
  values (-1001000000011, current_date - 40, 'failed', now() - interval '40 days', 'none')$q$);
-- the author deletes the question of G2's open post: the day's row stays (no second post), presses find it closed
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
delete from public.test_items where id = pg_temp.c('net6')::uuid;
select pg_temp.as_role('service_role');
do $t$
declare r jsonb; n int;
begin
  if pg_temp.sq(format('select item_id is null and status = ''open'' from bot.group_posts where id = %s', pg_temp.c('p2')))::boolean is not true then
    raise exception 'FAILED: the post of a deleted question'; end if;
  r := public.bot_group_answer(pg_temp.c('p2')::bigint, 70000005, 1, -1009000000002, 900, pg_temp.t(interval '3 hours 40 minutes'));
  if r ->> 'status' <> 'closed' then raise exception 'FAILED: a press on a deleted question %', r; end if;
  perform pg_temp.no_key(r, 'a press on a deleted question');
  if exists (select 1 from public.bot_claim_group_posts(10, pg_temp.t(interval '3 hours 41 minutes')) x where x.group_chat_id = -1009000000002) then
    raise exception 'FAILED: a second post after the question was deleted'; end if;
  if exists (select 1 from public.bot_group_counters(50, pg_temp.t(interval '3 hours 42 minutes')) x where x.post_id = pg_temp.c('p2')::bigint) then
    raise exception 'FAILED: a counter of a deleted question'; end if;
  -- 21:00: nothing to edit here — G2 (no question), G5 (died while sending → unknown), G6 (the bot left) close silently
  select count(*) into n from public.bot_claim_group_closes(50, pg_temp.t(interval '9 hours'));
  if n <> 0 then raise exception 'FAILED: % closes handed out', n; end if;
  if pg_temp.sq(format($q$select string_agg(status || ':' || error, ',' order by chat_id) from bot.group_posts
                          where local_day = %L and chat_id in (-1009000000002, -1001000000005, -1001000000006)$q$, pg_temp.c('day')))
     <> 'closed:no question,closed:left,closed:died while sending' then
    raise exception 'FAILED: silent closes: %', pg_temp.sq(format($q$select string_agg(chat_id || '=' || status || ':' || coalesce(error, ''), ',' order by chat_id)
                                                               from bot.group_posts where local_day = %L$q$, pg_temp.c('day'))); end if;
  -- the housekeeping of that call: presses closed more than two days ago are gone, the newer ones stay
  if pg_temp.sq(format($q$select count(*) from bot.group_answers a join bot.group_posts p on p.id = a.post_id
                          where p.chat_id = -1001000000005 and p.local_day = %L::date - 3$q$, pg_temp.c('day')))::int <> 0
     or pg_temp.sq(format($q$select count(*) from bot.group_answers a join bot.group_posts p on p.id = a.post_id
                          where p.chat_id = -1001000000005 and p.local_day = %L::date - 1$q$, pg_temp.c('day')))::int <> 2
     or pg_temp.sq(format($q$select purged_at is not null from bot.group_posts where chat_id = -1001000000005 and local_day = %L::date - 3$q$,
                          pg_temp.c('day')))::boolean is not true then
    raise exception 'FAILED: the presses'' housekeeping'; end if;
  if pg_temp.sq(format($q$select count(*) from bot.group_posts where local_day = %L::date - 91$q$, pg_temp.c('day')))::int <> 0
     or pg_temp.sq('select count(*) from bot.groups where chat_id = -1001000000011')::int <> 0
     or pg_temp.sq('select count(*) from bot.group_posts where chat_id = -1001000000011')::int <> 0 then
    raise exception 'FAILED: old posts and left groups kept'; end if;
  -- two days later the rest goes too
  perform public.bot_claim_group_closes(50, pg_temp.t(interval '2 days 1 hour'));
  if pg_temp.sq('select count(*) from bot.group_answers a join bot.group_posts p on p.id = a.post_id where p.chat_id = -1001000000005')::int <> 0 then
    raise exception 'FAILED: presses kept beyond two days'; end if;
end
$t$;

-- 13. T1's hook for the tick's saving mode: bot.tick_due_groups(p_now) is true exactly when a group step has work
--     (a post due, a claimed post or G4 to take again, a post left in sending, a close due, a counter waiting). On a clean
--     slate (in a savepoint), with T1's own reasons quiet (no reminders), bot.tick_due and bot.tick follow it.
savepoint hook;
select pg_temp.as_role('postgres');
select pg_temp.sx('delete from bot.groups');
select pg_temp.sx($q$delete from bot.deliveries where kind = 'notice'$q$);
select pg_temp.sx('update bot.links set remind_on = false');
do $t$
declare
  b timestamptz := date_trunc('hour', pg_temp.t()) + interval '7 minutes';   -- 12:07 in the group's zone
  v_post bigint;
  v_link bigint;
  v_calls bigint;
begin
  if bot.tick_due_groups(b) then raise exception 'FAILED: due with no group'; end if;
  insert into bot.groups (chat_id, container_id, link_id, owner_id, title, post_hour, tz)
  values (-1002000000001, pg_temp.c('c')::uuid, pg_temp.c('glink')::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', 'Хук', 12, pg_temp.c('tz'));
  if not bot.tick_due_groups(b) then raise exception 'FAILED: a post due'; end if;
  if bot.tick_due_groups(b - interval '1 hour') or bot.tick_due_groups(b + interval '3 hours') then
    raise exception 'FAILED: due outside the window'; end if;
  update bot.groups set off_at = b, off_reason = 'author' where chat_id = -1002000000001;
  if bot.tick_due_groups(b) then raise exception 'FAILED: due when off'; end if;
  update bot.groups set off_at = null, off_reason = null where chat_id = -1002000000001;
  -- the saving mode of T1: bot.tick_due and bot.tick go by the hook
  update bot.config set function_url = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/telegram',
                        tick_token = 'tk_' || repeat('Ab9-_', 8), function_region = 'eu-central-1',
                        flags = '{"tick": "when_due"}'::jsonb
   where id = 1;
  v_calls := (select count(*) from net.calls);
  if not bot.tick_due(b) then raise exception 'FAILED: bot.tick_due misses a post due'; end if;
  if bot.tick(b) is null then raise exception 'FAILED: the tick does not go when a post is due'; end if;
  if (select count(*) from net.calls) <> v_calls + 1 then raise exception 'FAILED: the tick''s request'; end if;
  -- the day's post claimed: nothing due; a claim never sent is due again after 10 minutes (while tries are left)
  insert into bot.group_posts (chat_id, local_day, status, claimed_at) values (-1002000000001, pg_temp.c('day')::date, 'claimed', b)
  returning id into v_post;
  if bot.tick_due_groups(b + interval '1 minute') or bot.tick_due(b + interval '1 minute') or bot.tick(b + interval '1 minute') is not null then
    raise exception 'FAILED: due after the claim'; end if;
  if not bot.tick_due_groups(b + interval '11 minutes') then raise exception 'FAILED: a stale claim not due'; end if;
  update bot.group_posts set attempts = 3 where id = v_post;
  if bot.tick_due_groups(b + interval '11 minutes') then raise exception 'FAILED: a claim without tries due'; end if;
  -- sending for 10 minutes: due (the sweep makes it unknown)
  update bot.group_posts set status = 'sending', sending_at = b, item_id = pg_temp.c('net1')::uuid, item_rev = 1,
                             shown = '{0,1,2,3}' where id = v_post;
  if bot.tick_due_groups(b + interval '5 minutes') then raise exception 'FAILED: sending due too early'; end if;
  if not bot.tick_due_groups(b + interval '11 minutes') then raise exception 'FAILED: a stuck sending not due'; end if;
  -- open: a counter waits for new presses, at most once a minute
  update bot.group_posts set status = 'open', tg_message_id = 1, posted_at = b where id = v_post;
  if bot.tick_due_groups(b + interval '5 minutes') then raise exception 'FAILED: an open post without presses due'; end if;
  update bot.group_posts set answered = 2 where id = v_post;
  if not bot.tick_due_groups(b + interval '5 minutes') then raise exception 'FAILED: a counter not due'; end if;
  update bot.group_posts set counter_at = b + interval '4 minutes' where id = v_post;
  if bot.tick_due_groups(b + interval '4 minutes 30 seconds') then raise exception 'FAILED: a counter within the minute'; end if;
  if not bot.tick_due_groups(b + interval '5 minutes 1 second') then raise exception 'FAILED: a counter after the minute'; end if;
  update bot.group_posts set counter_shown = 2 where id = v_post;
  if bot.tick_due_groups(b + interval '6 minutes') then raise exception 'FAILED: a counter already shown'; end if;
  -- 21:00: the close is due; leased: not until the lease ends; closed: never
  if not bot.tick_due_groups(b + interval '9 hours') then raise exception 'FAILED: a close not due'; end if;
  update bot.group_posts set close_at = b + interval '9 hours' where id = v_post;
  if bot.tick_due_groups(b + interval '9 hours 5 minutes') then raise exception 'FAILED: a leased close due'; end if;
  if not bot.tick_due_groups(b + interval '9 hours 11 minutes') then raise exception 'FAILED: a close after its lease'; end if;
  update bot.group_posts set status = 'unknown', tg_message_id = null where id = v_post;
  if bot.tick_due_groups(b + interval '5 minutes') or not bot.tick_due_groups(b + interval '9 hours') then
    raise exception 'FAILED: an unknown post closes at 21:00 only'; end if;
  update bot.group_posts set status = 'closed', closed_at = b + interval '9 hours' where id = v_post;
  if bot.tick_due_groups(b + interval '9 hours 30 minutes') then raise exception 'FAILED: a closed post due'; end if;
  -- a G4 never tried: due after 10 minutes, not for a blocked author, not without tries
  select id into v_link from bot.links where tg_user_id = 70000001 and unlinked_at is null;
  insert into bot.deliveries (kind, chat_id, link_id, local_day, ref, claimed_at)
  values ('notice', 70000001, v_link, pg_temp.c('day')::date, 'g4:-1002000000001', b);
  if bot.tick_due_groups(b + interval '5 minutes') then raise exception 'FAILED: a fresh G4 due'; end if;
  if not bot.tick_due_groups(b + interval '11 minutes') then raise exception 'FAILED: a G4 to take again'; end if;
  update bot.links set blocked_at = b where id = v_link;
  if bot.tick_due_groups(b + interval '11 minutes') then raise exception 'FAILED: a G4 for a blocked author'; end if;
end
$t$;
rollback to savepoint hook;

-- 14. Cascades: the author deletes the second exam (after removing its member): its group rows go with it.
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_error(format('delete from public.containers where id = %L', pg_temp.c('c2')), array['MC009'], 'an exam with members');
do $t$ begin
  perform public.container_member_remove(pg_temp.c('c2')::uuid, null);
  delete from public.containers where id = pg_temp.c('c2')::uuid;
  if pg_temp.sq(format('select count(*) from bot.groups where container_id = %L', pg_temp.c('c2')))::int <> 0
     or pg_temp.sq('select count(*) from bot.group_posts where chat_id = -1001000000006')::int <> 0
     or pg_temp.sq(format($q$select count(*) from bot.link_codes where container_id = %L$q$, pg_temp.c('c2')))::int <> 0 then
    raise exception 'FAILED: the exam''s chats outlived it'; end if;
end $t$;

-- 15. The gate: every bot_* refuses anon and authenticated (42501, no EXECUTE); every telegram_group_* refuses anon;
--     schema bot's helpers are out of the API roles' reach.
do $t$
declare s text; r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    perform pg_temp.as_role(r, case when r = 'authenticated' then 'aaaaaaaa-0000-0000-0000-000000000001'::uuid end);
    foreach s in array array[
      'select public.bot_group_claim(null, null, null, null, null, null)', 'select public.bot_group_event(null, null, null)',
      'select public.bot_group_entry(null, null)', 'select * from public.bot_claim_group_posts(null, null)',
      'select public.bot_group_pick(null, null)', 'select public.bot_group_sending(null, null, null)',
      'select public.bot_group_posted(null, null, null, null, null)', 'select public.bot_group_answer(null, null, null, null, null, null)',
      'select * from public.bot_group_counters(null, null)', 'select public.bot_group_counter_done(null, null, null)',
      'select * from public.bot_claim_group_closes(null, null)', 'select public.bot_group_closed(null, null, null)',
      'select bot.tick_due_groups(now())', 'select bot.group_candidates(-1, null, current_date, ''UTC'', now())',
      'select bot.group_post_view(1)'] loop
      perform pg_temp.expect_error(s, array['42501'], r || ': ' || s);
    end loop;
  end loop;
  perform pg_temp.as_role('anon');
  foreach s in array array['select public.telegram_group_code(null, 12)', 'select public.telegram_groups(null)',
                           'select public.telegram_group_set(null, null, null)'] loop
    perform pg_temp.expect_error(s, array['42501'], 'anon: ' || s);
  end loop;
  perform pg_temp.as_role('postgres');
end
$t$;

do $t$ begin raise notice 'TELEGRAM BOT GROUP CHECKS PASSED'; end $t$;
rollback;
