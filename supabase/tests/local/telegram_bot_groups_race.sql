-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Two sessions at once on the group chat's functions (package T7,
-- supabase/migrations/20261010120004_telegram_bot_groups.sql), through dblink on the scratch cluster of
-- telegram_bot_run.sh: session A opens a transaction and holds what the function locked, session B runs the same call
-- meanwhile, then A commits. Spec §6.5 and decision 7: two claims of one G code (in two chats, in one chat), two ticks
-- claiming the day's post, two workers sending one post, a double tap, two counter and two close claims — each time one
-- winner and nothing twice. The fixtures are committed (another session must see them) under their own ids and removed
-- at the end (the author's account goes, everything of it cascades); dblink is dropped again if this file created it.
-- Success prints TELEGRAM BOT GROUP RACES PASSED; a failure raises (FAILED: …) and stops.
\set ON_ERROR_STOP 1
select not exists (select 1 from pg_catalog.pg_extension where extname = 'dblink') as made_dblink \gset
create extension if not exists dblink;

-- Fixtures: the author R (79000001) in a zone where it is about 12:xx now, an exam with one question, an open group link,
-- two G codes for 12:00.
do $t$
declare
  k integer := 12 - extract(hour from now() at time zone 'utc')::integer;
  v_tz text;
  R constant uuid := '7a000000-0000-4000-8000-000000000001';
  v_c uuid := '7a000000-0000-4000-8000-0000000000c1';
  v_s uuid := '7a000000-0000-4000-8000-0000000000d1';
begin
  v_tz := 'Etc/GMT' || case when k > 0 then '-' || k::text when k < 0 then '+' || (-k)::text else '' end;
  insert into auth.users (id) values (R) on conflict do nothing;
  insert into public.containers (id, owner_id, title, exam_date) values (v_c, R, 'Гоночная сессия', current_date + 20);
  insert into public.container_subjects (id, container_id, owner_id, title) values (v_s, v_c, R, 'Сети');
  insert into public.test_items (container_id, subject_id, position, file_no, stem, options, correct, key_source)
  values (v_c, v_s, 1, '1', 'Какой порт по умолчанию у SSH?', '["21", "22", "23", "25"]', '{1}', 'bold');
  insert into public.container_links (container_id, owner_id, code_hash, oral_salt)
  values (v_c, R, encode(sha256(convert_to('race-link', 'UTF8')), 'hex'), md5('race-salt'));
  insert into bot.links (user_id, tg_user_id, chat_id, tz) values (R, 79000001, 79000001, v_tz);
  insert into bot.link_codes (code_hash, user_id, purpose, container_id, tz, post_hour, expires_at)
  select encode(sha256(convert_to(c, 'UTF8')), 'hex'), R, 'group', v_c, v_tz, 12, now() + interval '1 hour'
    from (values ('G' || md5('race-code-1')), ('G' || md5('race-code-2'))) x(c);
end
$t$;

create or replace function pg_temp.conn() returns text language sql stable as $fn$
  select format('host=127.0.0.1 port=%s dbname=%s user=postgres', current_setting('port'), current_database())
$fn$;
do $t$ begin perform dblink_connect('a', pg_temp.conn()); perform dblink_connect('b', pg_temp.conn()); end $t$;
-- B's query is running and waits on A's lock.
create or replace function pg_temp.waits(p_conn text) returns boolean language plpgsql as $fn$
begin
  perform pg_sleep(0.3);
  return dblink_is_busy(p_conn) = 1;
end;
$fn$;
create or replace function pg_temp.one(p_conn text) returns text language sql as $fn$
  select x from dblink_get_result(p_conn) as t(x text)
$fn$;

-- 1. Two claims of one code in two chats: A binds, B (waiting on the code's row) gets used.
do $t$
declare ra jsonb; rb jsonb; c1 constant text := 'G' || md5('race-code-1');
begin
  perform dblink_exec('a', 'begin');
  select x::jsonb into ra from dblink('a', format($q$select public.bot_group_claim(%L, -1003000000001, 'supergroup', 'Гонка', 79000001, now())::text$q$, c1)) as t(x text);
  perform dblink_send_query('b', format($q$select public.bot_group_claim(%L, -1003000000002, 'supergroup', 'Другая', 79000001, now())::text$q$, c1));
  if not pg_temp.waits('b') then raise exception 'FAILED: the second claim did not wait for the first'; end if;
  perform dblink_exec('a', 'commit');
  rb := pg_temp.one('b')::jsonb;
  perform pg_temp.one('b');
  if ra ->> 'status' <> 'bound' or rb ->> 'status' <> 'used' then raise exception 'FAILED: two claims of one code: % / %', ra, rb; end if;
end
$t$;
-- 2. The same code twice in one chat at once (a redelivery handled twice): bound, then bound again.
do $t$
declare ra jsonb; rb jsonb; c2 constant text := 'G' || md5('race-code-2');
begin
  perform dblink_exec('a', 'begin');
  select x::jsonb into ra from dblink('a', format($q$select public.bot_group_claim(%L, -1003000000002, 'supergroup', 'Другая', 79000001, now())::text$q$, c2)) as t(x text);
  perform dblink_send_query('b', format($q$select public.bot_group_claim(%L, -1003000000002, 'supergroup', 'Другая', 79000001, now())::text$q$, c2));
  if not pg_temp.waits('b') then raise exception 'FAILED: the same claim did not wait'; end if;
  perform dblink_exec('a', 'commit');
  rb := pg_temp.one('b')::jsonb;
  perform pg_temp.one('b');
  if ra ->> 'status' <> 'bound' or (ra ->> 'again')::boolean or rb ->> 'status' <> 'bound' or not (rb ->> 'again')::boolean then
    raise exception 'FAILED: one code twice in one chat: % / %', ra, rb; end if;
  if (select count(*) from bot.groups where chat_id in (-1003000000001, -1003000000002) and left_at is null) <> 2 then
    raise exception 'FAILED: the bound chats'; end if;
end
$t$;
-- 3. Two ticks claim posts at once: A takes both chats' posts; B skips the locked groups and finds nothing, also after A.
do $t$
declare na int; nb int;
begin
  perform dblink_exec('a', 'begin');
  select count(*) into na from dblink('a', 'select post_id from public.bot_claim_group_posts(10)') as t(post_id bigint);
  select count(*) into nb from dblink('b', $q$select post_id from public.bot_claim_group_posts(10)
                                            where group_chat_id in (-1003000000001, -1003000000002)$q$) as t(post_id bigint);
  perform dblink_exec('a', 'commit');
  if na <> 2 or nb <> 0 then raise exception 'FAILED: two ticks: A % posts, B %', na, nb; end if;
  select count(*) into nb from dblink('b', $q$select post_id from public.bot_claim_group_posts(10)
                                            where group_chat_id in (-1003000000001, -1003000000002)$q$) as t(post_id bigint);
  if nb <> 0 or (select count(*) from bot.group_posts where chat_id in (-1003000000001, -1003000000002)) <> 2 then
    raise exception 'FAILED: a second post of the day (%)', nb; end if;
end
$t$;
-- 4. Two workers send one post at once: A moves it to sending, B (waiting on the row) is told not to send.
do $t$
declare p bigint; v_item text; ra text; rb text;
begin
  select id into p from bot.group_posts where chat_id = -1003000000001;
  select id::text into v_item from public.test_items where container_id = '7a000000-0000-4000-8000-0000000000c1';
  perform x from dblink('a', format('select public.bot_group_pick(%s, %L)::text', p, v_item)) as t(x text);
  perform dblink_exec('a', 'begin');
  select x into ra from dblink('a', format('select public.bot_group_sending(%s, array[1,0,3,2])::text', p)) as t(x text);
  perform dblink_send_query('b', format('select public.bot_group_sending(%s, array[1,0,3,2])::text', p));
  if not pg_temp.waits('b') then raise exception 'FAILED: the second sender did not wait'; end if;
  perform dblink_exec('a', 'commit');
  rb := pg_temp.one('b');
  perform pg_temp.one('b');
  if ra <> 'true' or rb <> 'false' then raise exception 'FAILED: two senders: % / %', ra, rb; end if;
  perform x from dblink('a', format($q$select public.bot_group_posted(%s, 'sent', 77)::text$q$, p)) as t(x text);
  perform set_config('race.p', p::text, false);
end
$t$;
-- 5. A double tap of the author (a member of the exam): one press stored, one test_answers row, the second is a repeat.
do $t$
declare p bigint := current_setting('race.p')::bigint; ra jsonb; rb jsonb;
begin
  perform dblink_exec('a', 'begin');
  select x::jsonb into ra from dblink('a', format('select public.bot_group_answer(%s, 79000001, 1, -1003000000001, 77)::text', p)) as t(x text);
  perform dblink_send_query('b', format('select public.bot_group_answer(%s, 79000001, 0, -1003000000001, 77)::text', p));
  if not pg_temp.waits('b') then raise exception 'FAILED: the second tap did not wait'; end if;
  perform dblink_exec('a', 'commit');
  rb := pg_temp.one('b')::jsonb;
  perform pg_temp.one('b');
  if ra ->> 'status' <> 'answered' or ra ->> 'who' <> 'member' or not (ra ->> 'recorded')::boolean
     or rb ->> 'status' <> 'repeat' or rb -> 'choice' <> ra -> 'choice' then
    raise exception 'FAILED: a double tap: % / %', ra, rb; end if;
  if (select answered from bot.group_posts where id = p) <> 1
     or (select count(*) from public.test_answers where client_event_id = format('tgq:%s:79000001', p) and source = 'bot_group') <> 1 then
    raise exception 'FAILED: a double tap stored twice'; end if;
end
$t$;
-- 6. Two counter claims at once, then two close claims at once (21:00): one edit each.
do $t$
declare p bigint := current_setting('race.p')::bigint; na int; nb int;
begin
  perform dblink_exec('a', 'begin');
  select count(*) into na from dblink('a', 'select post_id from public.bot_group_counters(50)') as t(post_id bigint);
  select count(*) into nb from dblink('b', 'select post_id from public.bot_group_counters(50)') as t(post_id bigint);
  perform dblink_exec('a', 'commit');
  if na <> 1 or nb <> 0 then raise exception 'FAILED: two counter claims: A %, B %', na, nb; end if;
  perform dblink_exec('a', 'begin');
  select count(*) into na from dblink('a', $q$select post_id from public.bot_claim_group_closes(50, now() + interval '9 hours')$q$) as t(post_id bigint);
  select count(*) into nb from dblink('b', $q$select post_id from public.bot_claim_group_closes(50, now() + interval '9 hours')$q$) as t(post_id bigint);
  perform dblink_exec('a', 'commit');
  if na <> 1 or nb <> 0 then raise exception 'FAILED: two close claims: A %, B %', na, nb; end if;
  select count(*) into nb from dblink('b', $q$select post_id from public.bot_claim_group_closes(50, now() + interval '9 hours 1 minute')$q$) as t(post_id bigint);
  if nb <> 0 then raise exception 'FAILED: a second close'; end if;
end
$t$;

do $t$ begin perform dblink_disconnect('a'); perform dblink_disconnect('b'); end $t$;
-- Clean-up: the author's account goes; the exam, its link, the codes, the link, the group rows and the answers cascade.
delete from auth.users where id = '7a000000-0000-4000-8000-000000000001';
do $t$ begin
  if exists (select 1 from bot.groups where chat_id in (-1003000000001, -1003000000002))
     or exists (select 1 from bot.links where tg_user_id = 79000001)
     or exists (select 1 from public.containers where id = '7a000000-0000-4000-8000-0000000000c1') then
    raise exception 'FAILED: the race fixtures stayed'; end if;
end $t$;
\if :made_dblink
drop extension dblink;
\endif
do $t$ begin raise notice 'TELEGRAM BOT GROUP RACES PASSED'; end $t$;
