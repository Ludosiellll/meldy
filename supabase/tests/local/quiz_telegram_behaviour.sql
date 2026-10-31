-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261105090100_quiz_telegram.sql
-- (release 49, part B) on the scratch database of quiz_stats_telegram_run.sh. One transaction, rolled back.
-- A = the author aaaa…1 with a linked Telegram (chat 7001) and the group chat -100500 bound to the exam; B, C, D, E
-- and guests take the quiz. The bot's calls run as service_role with p_now set (T = 12:00 in Minsk today).
-- Covers: the state, the mode and its refusals (B, a bad mode); nothing while off; «each» — a finish at once, two in a
-- minute wait for a digest 10 minutes after the last message, then one again; at most 3 single messages in 10 minutes;
-- the night (22:00–08:00 in the link's zone) and a pause hold everything, the morning sends it; «digest» — from 10
-- minutes after the first finish, at most once an hour; the close summary once, with the finishes that waited, the
-- people, the average, who passed and the hardest; the share into the group (queued, already, closed, no group, no link)
-- handed once a minute and again after a 429; a blocked link gets nothing; off drops what waits; the author's own try
-- is never told; at most once (a row in sending is never handed again).
-- A failure raises; success prints QUIZ TELEGRAM BEHAVIOUR PASSED.
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
create or replace function pg_temp.id(p_ref text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = 'id:' || p_ref
$fn$;
create or replace function pg_temp.as_role(p_role text, p_sub text default '') returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', p_sub, true);
  perform set_config('request.jwt.claim.role', '', true);
  if p_role = 'postgres' then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', nullif(p_sub, ''))::text, true);
    execute format('set local role %I', p_role);
  end if;
end;
$fn$;
-- T + minutes: 12:00 in Minsk today plus the minutes (the bot's clock for p_now)
create or replace function pg_temp.at(p_min integer) returns timestamptz language sql stable as $fn$
  select (date_trunc('day', now() at time zone 'Europe/Minsk') + interval '12 hours') at time zone 'Europe/Minsk'
         + make_interval(mins => p_min)
$fn$;
-- the bot's call at T + minutes: its rows
create or replace function pg_temp.tick(p_min integer) returns jsonb language plpgsql as $fn$
declare r jsonb;
begin
  perform pg_temp.as_role('service_role');
  r := public.bot_quiz_notices(20, pg_temp.at(p_min)) -> 'rows';
  perform pg_temp.as_role('postgres');
  return r;
end;
$fn$;
-- the bot sends a row: sending, then sent
create or replace function pg_temp.sent(p_row jsonb) returns void language plpgsql as $fn$
begin
  perform pg_temp.as_role('service_role');
  perform pg_temp.ok(public.bot_delivery_sending((p_row ->> 'delivery_id')::bigint), 'sending taken');
  perform public.bot_delivery_done((p_row ->> 'delivery_id')::bigint, 'sent', 900);
  perform pg_temp.as_role('postgres');
end;
$fn$;
-- someone (an account, or a guest when p_user is null) takes the quiz and finishes it: q:1 right when p_right
create or replace function pg_temp.take(p_user text, p_name text, p_right boolean, p_tok integer default 1) returns text
language plpgsql as $fn$
declare v_att text;
begin
  if p_user is null then
    perform pg_temp.as_role('anon');
    v_att := public.quiz_guest_start(pg_temp.c('code'), p_name, pg_temp.tok(p_tok)) ->> 'attempt_id';
    perform public.quiz_guest_answer(v_att::uuid, pg_temp.tok(p_tok), jsonb_build_array(
      jsonb_build_object('item_id', pg_temp.id('q:1'), 'chosen', jsonb_build_array(case when p_right then 0 else 1 end))));
    perform public.quiz_guest_finish(v_att::uuid, pg_temp.tok(p_tok));
  else
    perform pg_temp.as_role('authenticated', p_user);
    v_att := public.quiz_start(pg_temp.c('code'), p_name) ->> 'attempt_id';
    perform public.quiz_answer(v_att::uuid, jsonb_build_array(
      jsonb_build_object('item_id', pg_temp.id('q:1'), 'chosen', jsonb_build_array(case when p_right then 0 else 1 end)),
      jsonb_build_object('item_id', pg_temp.id('q:2'), 'chosen', jsonb_build_array(0))));
    perform public.quiz_finish(v_att::uuid);
  end if;
  perform pg_temp.as_role('postgres');
  return v_att;
end;
$fn$;
grant all on ctx to authenticated, anon, service_role;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- 1. A's exam (two questions), the quiz, the Telegram link and the group chat.
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('s', (public.container_create('Сообщения', null, '[{"title":"Вопросы"}]') -> 'subjects' -> 0 ->> 'id'));
select pg_temp.put('x', (select container_id::text from public.container_subjects where id = pg_temp.c('s')::uuid));
select public.container_items_add(pg_temp.c('s')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'q:1', 'kind', 'single', 'stem', 'Один', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0)),
  jsonb_build_object('ref', 'q:2', 'kind', 'single', 'stem', 'Два', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0))));
select pg_temp.put('id:' || i.import_ref, i.id::text) from public.test_items i where i.subject_id = pg_temp.c('s')::uuid;
select pg_temp.put('qobj', public.quiz_create(pg_temp.c('x')::uuid, jsonb_build_object(
  'title', 'Контрольная <9А>', 'subject_ids', jsonb_build_array(pg_temp.c('s')), 'item_count', 2, 'shuffle_items', false,
  'shuffle_options', false, 'same_set', true, 'attempts', null, 'pass_percent', 50))::text);
select pg_temp.put('q', pg_temp.c('qobj')::jsonb ->> 'id'), pg_temp.put('code', pg_temp.c('qobj')::jsonb ->> 'code');
select pg_temp.as_role('postgres');
insert into auth.users (id) values ('ffffffff-0000-0000-0000-000000000006') on conflict do nothing;
insert into bot.links (user_id, tg_user_id, chat_id, tz) values ('aaaaaaaa-0000-0000-0000-000000000001', 7001, 7001, 'Europe/Minsk');
insert into bot.groups (chat_id, container_id, owner_id, title, tz)
values (-100500, pg_temp.c('x')::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', '9 «А» — математика', 'Europe/Minsk');

-- 2. The state and the mode.
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $do$
declare r jsonb := public.telegram_quiz_state(pg_temp.c('q')::uuid);
begin
  perform pg_temp.ok(r = jsonb_build_object('linked', true, 'blocked', false, 'notice', 'off',
                                            'groups', jsonb_build_array(jsonb_build_object('chat_id', -100500, 'title', '9 «А» — математика', 'shared_at', null))),
                     format('the state: %s', r));
end;
$do$;
select pg_temp.expect_error(format('select public.telegram_quiz_notice(%L, %L)', pg_temp.c('q'), 'loud'), '22023', 'an unknown mode');
-- without a linked Telegram notices cannot be switched on (off can), and the tick never looks at such a watch
select pg_temp.as_role('postgres');
update bot.links set unlinked_at = now() where tg_user_id = 7001;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_error(format('select public.telegram_quiz_notice(%L, %L)', pg_temp.c('q'), 'each'), '22023', 'notices without a link');
select pg_temp.ok(public.telegram_quiz_notice(pg_temp.c('q')::uuid, 'off') ->> 'notice' = 'off', 'off without a link');
select pg_temp.as_role('postgres');
update bot.quiz_watch set mode = 'each' where quiz_id = pg_temp.c('q')::uuid;  -- as if switched on before the unlink
select pg_temp.ok(pg_temp.tick(0) = '[]'::jsonb and (select checked_at is null from bot.quiz_watch where quiz_id = pg_temp.c('q')::uuid),
                  'the tick skips a watch whose author has no link');
update bot.quiz_watch set mode = 'off' where quiz_id = pg_temp.c('q')::uuid;
update bot.links set unlinked_at = null where tg_user_id = 7001;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.expect_error(format('select public.telegram_quiz_state(%L)', pg_temp.c('q')), 'P0002', 'B reads A''s state');
select pg_temp.expect_error(format('select public.telegram_quiz_notice(%L, %L)', pg_temp.c('q'), 'each'), 'P0002', 'B switches A''s notices');
select pg_temp.expect_error(format('select public.telegram_quiz_share(%L, %s)', pg_temp.c('q'), -100500), 'P0002', 'B shares A''s quiz');
select pg_temp.as_role('anon');
select pg_temp.expect_error(format('select public.telegram_quiz_state(%L)', pg_temp.c('q')), '42501', 'anon');
select pg_temp.as_role('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.expect_error('select public.bot_quiz_notices(20, null)', '42501', 'a user calls the bot''s function');

-- 3. Off: a finish is not told.
select pg_temp.put('b0', pg_temp.take('bbbbbbbb-0000-0000-0000-000000000002', 'Борис', true));
-- (one transaction: now() never moves; B finished a minute before anything below)
update public.quiz_attempts set started_at = now() - interval '2 minutes', finished_at = now() - interval '1 minute'
 where id = pg_temp.c('b0')::uuid;
select pg_temp.ok(pg_temp.tick(0) = '[]'::jsonb, 'off: nothing');
select pg_temp.ok(not exists (select 1 from bot.quiz_notices), 'off: nothing noted');

-- 4. Each: on from now (the finish before is not told); the author's own try never.
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok(public.telegram_quiz_notice(pg_temp.c('q')::uuid, 'each') ->> 'notice' = 'each', 'each');
select pg_temp.as_role('postgres');
select pg_temp.take('aaaaaaaa-0000-0000-0000-000000000001', 'Автор', false);
select pg_temp.put('c1', pg_temp.take('cccccccc-0000-0000-0000-000000000003', 'Вера <В>', true));
do $do$
declare r jsonb := pg_temp.tick(0);
begin
  perform pg_temp.ok(jsonb_array_length(r) = 1, format('one message: %s', r));
  perform pg_temp.ok(r -> 0 ->> 'kind' = 'one' and r -> 0 ->> 'name' = 'Вера <В>' and (r -> 0 ->> 'score')::numeric = 2
                     and (r -> 0 ->> 'max')::numeric = 2 and (r -> 0 ->> 'chat_id')::bigint = 7001
                     and r -> 0 ->> 'title' = 'Контрольная <9А>' and r -> 0 ->> 'quiz_id' = pg_temp.c('q')
                     and r -> 0 ->> 'container_id' = pg_temp.c('x') and (r -> 0 ->> 'pass_percent')::integer = 50,
                     format('C''s finish: %s', r -> 0));
  perform pg_temp.put('one1', (r -> 0)::text);
  -- handed: not again within the minute, nor after it once in sending (at most once)
  perform pg_temp.ok(pg_temp.tick(0) = '[]'::jsonb, 'not handed twice');
  perform pg_temp.sent(r -> 0);
  perform pg_temp.ok(pg_temp.tick(2) = '[]'::jsonb, 'a sent one is done');
end;
$do$;
-- two in the same minute: they wait for a digest 10 minutes after the last message
select pg_temp.put('d1', pg_temp.take('dddddddd-0000-0000-0000-000000000004', 'Дмитрий', false));
select pg_temp.put('g1', pg_temp.take(null, 'Гость Г', true, 1));
select pg_temp.ok(pg_temp.tick(3) = '[]'::jsonb, 'two waiting: no single message, no digest yet');
do $do$
declare r jsonb := pg_temp.tick(10);
begin
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'kind' = 'digest', format('the digest: %s', r));
  perform pg_temp.ok((r -> 0 ->> 'count')::integer = 2 and (r -> 0 ->> 'done')::integer = 4
                     and (select array_agg(x ->> 'name' order by x ->> 'name') from jsonb_array_elements(r -> 0 -> 'people') x) = '{Гость Г,Дмитрий}',
                     format('its people: %s', r -> 0));
  perform pg_temp.sent(r -> 0);
end;
$do$;
-- one more: a single message again (one in the last 10 minutes)
select pg_temp.put('e1', pg_temp.take('eeeeeeee-0000-0000-0000-000000000005', 'Ева', true));
do $do$
declare r jsonb := pg_temp.tick(11);
begin
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'kind' = 'one' and r -> 0 ->> 'name' = 'Ева', format('Ева: %s', r));
  perform pg_temp.sent(r -> 0);
end;
$do$;
-- at most 3 single messages in 10 minutes
select pg_temp.take(null, 'Гость 2', true, 2);
select pg_temp.sent(pg_temp.tick(12) -> 0);
select pg_temp.take(null, 'Гость 3', true, 3);
select pg_temp.ok(pg_temp.tick(13) = '[]'::jsonb, 'a fourth message in 10 minutes waits (T+10, +11, +12)');
select pg_temp.ok(pg_temp.tick(19) = '[]'::jsonb, 'still three in the last 10 minutes');
do $do$
declare r jsonb := pg_temp.tick(20);  -- T+10 left the window
begin
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'kind' = 'one' and r -> 0 ->> 'name' = 'Гость 3', format('then it goes: %s', r));
  perform pg_temp.sent(r -> 0);
end;
$do$;

-- 5. The night and a pause hold; the morning sends.
select pg_temp.take(null, 'Гость 4', true, 4);
select pg_temp.ok(pg_temp.tick(10 * 60 + 30) = '[]'::jsonb, '22:30 in Minsk: nothing');
select pg_temp.ok(pg_temp.tick(-5 * 60) = '[]'::jsonb, '07:00 in Minsk: nothing');
update bot.links set paused_until = (pg_temp.at(0) at time zone 'Europe/Minsk')::date + 1 where tg_user_id = 7001;
select pg_temp.ok(pg_temp.tick(60) = '[]'::jsonb, 'paused: nothing');
update bot.links set paused_until = null where tg_user_id = 7001;
do $do$
declare r jsonb := pg_temp.tick(61);
begin
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'name' = 'Гость 4', format('after the pause: %s', r));
  perform pg_temp.sent(r -> 0);
end;
$do$;

-- 6. Digest: from 10 minutes after the first waiting finish, at most once an hour.
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select public.telegram_quiz_notice(pg_temp.c('q')::uuid, 'digest');
select pg_temp.take(null, 'Гость 5', true, 5);
select pg_temp.ok(pg_temp.tick(62) = '[]'::jsonb, 'digest: not right away (noted at 62)');
select pg_temp.ok(pg_temp.tick(70) = '[]'::jsonb, 'digest: 8 minutes later, still waiting');
select pg_temp.ok(pg_temp.tick(80) = '[]'::jsonb, 'digest: 10 minutes after it, but the last message was 19 minutes ago');
do $do$
declare r jsonb := pg_temp.tick(121);
begin
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'kind' = 'digest' and (r -> 0 ->> 'count')::integer = 1, format('the hourly digest: %s', r));
  perform pg_temp.sent(r -> 0);
end;
$do$;

-- 7. The close: once, with what waits, the people, the average, who passed and the hardest.
select pg_temp.take(null, 'Гость 6', false, 6);
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select public.quiz_close(pg_temp.c('q')::uuid);
do $do$
declare r jsonb := pg_temp.tick(125);
begin
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'kind' = 'close', format('the close: %s', r));
  -- people: B (before the watch, still a finish), C, D, E and six guests — 10. The accounts answer both (B, C, E 100 %,
  -- D 50 %), the guests q:1 only (50 %, the last one 0 %): the average 60 %, 9 at the pass mark of 50 %. q:1 right 8 of
  -- 10, q:2 4 of 10: the hardest first, by its number (the position when the file gave none).
  perform pg_temp.ok((r -> 0 ->> 'people')::integer = 10, format('ten people: %s', r -> 0));
  perform pg_temp.ok((r -> 0 ->> 'passed')::integer = 9 and (r -> 0 ->> 'avg_percent')::integer = 60, format('passed and the average: %s', r -> 0));
  perform pg_temp.ok(jsonb_array_length(r -> 0 -> 'hardest') = 2 and r -> 0 -> 'hardest' -> 0 ->> 'no' = '2'
                     and (r -> 0 -> 'hardest' -> 0 ->> 'percent')::integer = 40, format('the hardest: %s', r -> 0 -> 'hardest'));
  perform pg_temp.ok(not exists (select 1 from bot.quiz_notices n where n.quiz_id = pg_temp.c('q')::uuid and n.handled_at is null),
                     'the waiting finish went with the close');
  perform pg_temp.ok((select n.summary ->> 'people' from bot.quiz_notices n where n.quiz_id = pg_temp.c('q')::uuid and n.kind = 'close') = '10'
                     and r -> 0 -> 'sample' = 'null'::jsonb, 'the summary is kept with the close (all graded)');
  perform pg_temp.put('close1', (r -> 0)::text);
end;
$do$;
-- the bot died before sending: a minute later the row comes again, from the kept summary — nothing graded again
delete from public.quiz_answers w using public.quiz_attempts a where a.id = w.attempt_id and a.quiz_id = pg_temp.c('q')::uuid;
do $do$
declare r jsonb := pg_temp.tick(127);
begin
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 = pg_temp.c('close1')::jsonb, format('the same summary again: %s', r));
  perform pg_temp.sent(r -> 0);
  perform pg_temp.ok(pg_temp.tick(200) = '[]'::jsonb, 'the close once');
end;
$do$;

-- 7b. Open again: watched again (review 2026-11-05: notices stopped silently); a finish is told; a new close, a new summary.
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select public.quiz_update(pg_temp.c('q')::uuid, jsonb_build_object('closes_at', (now() + interval '3 days')::text));
select public.telegram_quiz_notice(pg_temp.c('q')::uuid, 'each');  -- (it was «digest» since section 6)
select pg_temp.put('f1', pg_temp.take('ffffffff-0000-0000-0000-000000000006', 'Фёдор', true));
do $do$
declare r jsonb := pg_temp.tick(210);
begin
  perform pg_temp.ok((select closed_at is null from bot.quiz_watch where quiz_id = pg_temp.c('q')::uuid), 'watched again');
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'kind' = 'one' and r -> 0 ->> 'name' = 'Фёдор', format('a finish after the reopen: %s', r));
  perform pg_temp.sent(r -> 0);
end;
$do$;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select public.quiz_close(pg_temp.c('q')::uuid);
select pg_temp.as_role('postgres');
update public.quizzes set closed_at = now() + interval '1 minute' where id = pg_temp.c('q')::uuid;  -- (now() never moves here)
do $do$
declare r jsonb := pg_temp.tick(215);
begin
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'kind' = 'close' and (r -> 0 ->> 'people')::integer = 11,
                     format('a second close, its own summary: %s', r));
  perform pg_temp.ok((select count(*) from bot.quiz_notices n where n.quiz_id = pg_temp.c('q')::uuid and n.kind = 'close') = 2, 'two closes kept');
  perform pg_temp.sent(r -> 0);
end;
$do$;

-- 7c. At most one close summary is computed a call: two quizzes closed at once go in two ticks.
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('q3', public.quiz_create(pg_temp.c('x')::uuid, jsonb_build_object(
  'title', 'Третья', 'subject_ids', jsonb_build_array(pg_temp.c('s')), 'item_count', 2)) ->> 'id');
select pg_temp.put('q4', public.quiz_create(pg_temp.c('x')::uuid, jsonb_build_object(
  'title', 'Четвёртая', 'subject_ids', jsonb_build_array(pg_temp.c('s')), 'item_count', 2)) ->> 'id');
select public.telegram_quiz_notice(pg_temp.c('q3')::uuid, 'each'), public.telegram_quiz_notice(pg_temp.c('q4')::uuid, 'each');
select public.quiz_close(pg_temp.c('q3')::uuid), public.quiz_close(pg_temp.c('q4')::uuid);
do $do$
declare r jsonb := pg_temp.tick(220);
declare r2 jsonb;
begin
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'kind' = 'close', format('one close this call: %s', r));
  perform pg_temp.sent(r -> 0);
  r2 := pg_temp.tick(221);
  perform pg_temp.ok(jsonb_array_length(r2) = 1 and r2 -> 0 ->> 'kind' = 'close' and r2 -> 0 ->> 'quiz_id' <> r -> 0 ->> 'quiz_id',
                     format('the other the next call: %s', r2));
  perform pg_temp.sent(r2 -> 0);
end;
$do$;

-- 8. The share: refusals, queued, already; handed once a minute, again after a 429; never after sending.
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok(public.telegram_quiz_share(pg_temp.c('q')::uuid, -100500) ->> 'status' = 'closed', 'a closed quiz is not shared');
select pg_temp.put('q2obj', public.quiz_create(pg_temp.c('x')::uuid, jsonb_build_object(
  'title', 'Контрольная 9Б', 'subject_ids', jsonb_build_array(pg_temp.c('s')), 'item_count', 2, 'time_limit_min', 20,
  'closes_at', (now() + interval '3 days')::text))::text);
select pg_temp.put('q2', pg_temp.c('q2obj')::jsonb ->> 'id');
select pg_temp.ok(public.telegram_quiz_share(pg_temp.c('q2')::uuid, -999) ->> 'status' = 'no_group', 'a chat not bound');
select pg_temp.ok(public.telegram_quiz_share(pg_temp.c('q2')::uuid, -100500) = '{"status": "queued", "title": "9 «А» — математика"}'::jsonb, 'queued');
select pg_temp.ok(public.telegram_quiz_share(pg_temp.c('q2')::uuid, -100500) ->> 'status' = 'already', 'once a day a chat');
select pg_temp.ok(public.telegram_quiz_state(pg_temp.c('q2')::uuid) -> 'groups' -> 0 ->> 'shared_at' is not null, 'the state says it went');
do $do$
declare r jsonb := pg_temp.tick(300);
begin
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'kind' = 'share' and (r -> 0 ->> 'chat_id')::bigint = -100500
                     and r -> 0 ->> 'code' = pg_temp.c('q2obj')::jsonb ->> 'code' and (r -> 0 ->> 'item_count')::integer = 2
                     and (r -> 0 ->> 'time_limit_s')::integer = 1200 and r -> 0 ->> 'tz' = 'Europe/Minsk'
                     and r -> 0 ->> 'chat_title' = '9 «А» — математика' and r -> 0 ->> 'closes_at' is not null,
                     format('the share: %s', r));
  perform pg_temp.ok(pg_temp.tick(300) = '[]'::jsonb, 'not handed again within the minute');
  -- a 429 after sending: back to claimed, handed again after a minute (attempt 2)
  perform pg_temp.as_role('service_role');
  perform pg_temp.ok(public.bot_delivery_sending((r -> 0 ->> 'delivery_id')::bigint), 'sending');
  perform pg_temp.ok(pg_temp.tick(302) = '[]'::jsonb, 'in sending: never handed');
  perform pg_temp.as_role('service_role');
  perform pg_temp.ok(public.bot_delivery_retry((r -> 0 ->> 'delivery_id')::bigint, '429'), 'retry');
  perform pg_temp.as_role('postgres');
  r := pg_temp.tick(304);
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'kind' = 'share', format('handed again: %s', r));
  perform pg_temp.ok((select d.attempts from bot.deliveries d where d.id = (r -> 0 ->> 'delivery_id')::bigint) = 2, 'its second attempt');
  perform pg_temp.sent(r -> 0);
end;
$do$;

-- 8b. A row handed again keeps the rules of a new one: not at night, not while paused; too old — skipped; out of
--     tries — failed (never left claimed for good); a share to a group the bot left — failed.
select pg_temp.as_role('postgres');
insert into bot.deliveries (kind, chat_id, link_id, local_day, ref, attempts)
select 'notice', 7001, l.id, current_date, 'qz:test-' || g, case g when 3 then 3 else 1 end from bot.links l, generate_series(1, 3) g
 where l.tg_user_id = 7001;
insert into bot.quiz_sends (delivery_id, quiz_id, kind, made_at, handed_at)
select d.id, pg_temp.c('q')::uuid, 'one', case d.ref when 'qz:test-2' then pg_temp.at(300) - interval '4 days' else pg_temp.at(300) end,
       pg_temp.at(290)
  from bot.deliveries d where d.ref like 'qz:test-%';
insert into bot.quiz_notices (quiz_id, attempt_id, kind, score, max_score, delivery_id, handled_at)
select pg_temp.c('q')::uuid, pg_temp.c('f1')::uuid, 'done', 2, 2, d.id, pg_temp.at(290) from bot.deliveries d where d.ref = 'qz:test-1'
on conflict do nothing;
do $do$
declare r jsonb;
begin
  perform pg_temp.ok(pg_temp.tick(10 * 60 + 30) = '[]'::jsonb, 'not at night (22:30)');
  perform pg_temp.ok((select status from bot.deliveries where ref = 'qz:test-1') = 'claimed', 'still claimed for the morning');
  r := pg_temp.tick(301);
  perform pg_temp.ok((select status from bot.deliveries where ref = 'qz:test-2') = 'skipped', 'too old: skipped');
  perform pg_temp.ok((select status from bot.deliveries where ref = 'qz:test-3') = 'failed', 'out of tries: failed');
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'kind' = 'one', format('the one in the day: %s', r));
  perform pg_temp.sent(r -> 0);
end;
$do$;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('q5', public.quiz_create(pg_temp.c('x')::uuid, jsonb_build_object(
  'title', 'Пятая', 'subject_ids', jsonb_build_array(pg_temp.c('s')), 'item_count', 2)) ->> 'id');
select pg_temp.ok(public.telegram_quiz_share(pg_temp.c('q5')::uuid, -100500) ->> 'status' = 'queued', 'queued again for a new quiz');
select pg_temp.as_role('postgres');
update bot.groups set left_at = now() where chat_id = -100500;
select pg_temp.ok(pg_temp.tick(302) = '[]'::jsonb, 'the bot left the group: nothing handed');
select pg_temp.ok((select d.status from bot.deliveries d join bot.quiz_sends s on s.delivery_id = d.id
                    where s.quiz_id = pg_temp.c('q5')::uuid) = 'failed', 'the share failed, not left claimed');
update bot.groups set left_at = null where chat_id = -100500;

-- 9. A blocked link: nothing, not even looked at (review 2026-11-05: the tick's work only for linked authors); after the
--    unblock the finish is told; off drops what waits; a blocked link cannot share.
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select public.telegram_quiz_notice(pg_temp.c('q2')::uuid, 'each');
select pg_temp.as_role('postgres');
update bot.quiz_watch set since = now() - interval '1 second' where quiz_id = pg_temp.c('q2')::uuid;
select pg_temp.put('code', pg_temp.c('q2obj')::jsonb ->> 'code');
select pg_temp.take(null, 'Гость 7', true, 7);
update bot.links set blocked_at = now() where tg_user_id = 7001;
select pg_temp.ok(pg_temp.tick(400) = '[]'::jsonb, 'blocked: nothing');
select pg_temp.ok(not exists (select 1 from bot.quiz_notices n where n.quiz_id = pg_temp.c('q2')::uuid), 'not even looked at');
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok(public.telegram_quiz_state(pg_temp.c('q2')::uuid) ->> 'blocked' = 'true', 'the state says blocked');
select pg_temp.ok(public.telegram_quiz_share(pg_temp.c('q2')::uuid, -100500) ->> 'status' = 'no_link', 'a blocked link cannot share');
select pg_temp.as_role('postgres');
update bot.links set blocked_at = null where tg_user_id = 7001;
do $do$
declare r jsonb := pg_temp.tick(401);
begin
  perform pg_temp.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'name' = 'Гость 7', format('told after the unblock: %s', r));
  perform pg_temp.sent(r -> 0);
end;
$do$;
select pg_temp.take(null, 'Гость 9', true, 9);
select pg_temp.ok(pg_temp.tick(10 * 60 + 40) = '[]'::jsonb, 'at night it is noted and waits');
select pg_temp.ok(exists (select 1 from bot.quiz_notices n where n.quiz_id = pg_temp.c('q2')::uuid and n.handled_at is null), 'it waits');
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select public.telegram_quiz_notice(pg_temp.c('q2')::uuid, 'off');
select pg_temp.as_role('postgres');
select pg_temp.ok(not exists (select 1 from bot.quiz_notices n where n.quiz_id = pg_temp.c('q2')::uuid and n.handled_at is null), 'off drops it');
select pg_temp.ok(pg_temp.tick(402) = '[]'::jsonb, 'off: nothing in the day');
-- the tables are the functions' only
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_error('select count(*) from bot.quiz_watch', '42501', 'a user reads the watch table');

-- 10. One quiz that fails never stops the rest (review 2026-11-05): its close summary raises; the call goes on and
--     counts it, another quiz's finish is still told.
select pg_temp.as_role('postgres');
create or replace function meldy_private.quiz_close_summary(p_q public.quizzes) returns jsonb language plpgsql stable
set search_path = '' as $fn$ begin raise exception 'boom'; end; $fn$;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('q6', public.quiz_create(pg_temp.c('x')::uuid, jsonb_build_object(
  'title', 'Шестая', 'subject_ids', jsonb_build_array(pg_temp.c('s')), 'item_count', 2)) ->> 'id');
select pg_temp.put('q7obj', public.quiz_create(pg_temp.c('x')::uuid, jsonb_build_object(
  'title', 'Седьмая', 'subject_ids', jsonb_build_array(pg_temp.c('s')), 'item_count', 2))::text);
select public.telegram_quiz_notice(pg_temp.c('q6')::uuid, 'each'),
       public.telegram_quiz_notice((pg_temp.c('q7obj')::jsonb ->> 'id')::uuid, 'each');
select public.quiz_close(pg_temp.c('q6')::uuid);
select pg_temp.put('code', pg_temp.c('q7obj')::jsonb ->> 'code');
select pg_temp.take(null, 'Гость 8', true, 8);
do $do$
declare r jsonb;
begin
  perform pg_temp.as_role('service_role');
  r := public.bot_quiz_notices(20, pg_temp.at(500));
  perform pg_temp.as_role('postgres');
  perform pg_temp.ok((r ->> 'errors')::integer = 1, format('the failing quiz counted: %s', r ->> 'errors'));
  perform pg_temp.ok(jsonb_array_length(r -> 'rows') = 1 and r -> 'rows' -> 0 ->> 'name' = 'Гость 8', format('the other told: %s', r -> 'rows'));
end;
$do$;

rollback;
\echo QUIZ TELEGRAM BEHAVIOUR PASSED
