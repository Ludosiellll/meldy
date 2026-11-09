-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261109090100_bot_support.sql (support
-- through the bot, account deletion requests) on the scratch database of supabase/tests/local/bot_support_run.sh.
-- Covered: the gates (clients run no bot_support_* and read neither table; the service-role gate holds without the
-- grants; the account functions are authenticated's only and need a signed-in user); the one-time claim of the owner's
-- chat (off without a hash; no for another username, no username, a group; the matching username in any letter case
-- claims once; set for everyone after; a rebind by hand); bot_support_add (a private chat only; empty; 2 000 and 2 001
-- characters; the linked account or none; the name and username cleaned; the same message once; 5 an hour and 20 a day
-- per chat); bot_support_claim (the limit; no_chat with how many wait; oldest first; the rows' exact keys; the lease
-- of 50 seconds; the zone; rows older than 90 days deleted); bot_support_done (sent, closed, gone, 22023);
-- bot_support_reply (none for a stranger and for the owner in another chat; gone; service; ok with the sender's chat);
-- bot_support_answered (the first reply's time stays); account_deletion_request / _cancel / _status (idempotent while
-- open, a new time after a cancel, the queue rows the owner hears of, the cap of 5 a day, the cascade with the account);
-- the tables' checks; bot_status shows nothing of support.
-- The handle here is invented («meldy_owner_test»); the real one is nowhere in the repository.
-- One transaction, rolled back. A failure raises (FAILED: …); success prints BOT SUPPORT CHECKS PASSED. Roles as
-- PostgREST sets them (T1's telegram_bot_behaviour.sql): anon, authenticated (request.jwt.claim.sub), service_role
-- (request.jwt.claims); postgres for fixtures.
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
create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $fn$
begin
  if p_ok is not true then raise exception 'FAILED: %', p_what; end if;
end;
$fn$;
-- Reads and writes of schema bot and of the request table run as the migration role (the API roles have no way in).
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
-- As the database hashes a username (and as the bot's tests do): sha256 of the lowercased handle, hex.
create or replace function pg_temp.h(p_username text) returns text language sql immutable as $fn$
  select encode(sha256(convert_to(lower(p_username), 'UTF8')), 'hex')
$fn$;
grant execute on function pg_temp.expect_error(text, text[], text), pg_temp.as_role(text, uuid), pg_temp.check(boolean, text),
  pg_temp.sq(text), pg_temp.sx(text), pg_temp.h(text) to anon, authenticated, service_role;

-- Fixtures: A (linked: Telegram 810001), B and C (accounts without Telegram); the owner's Telegram is 820001, a
-- stranger's 830001, a second unlinked sender 840001. Every id is made up.
select pg_temp.as_role('postgres');
insert into auth.users (id) values ('b5000000-0000-4000-8000-00000000000a'), ('b5000000-0000-4000-8000-00000000000b'),
  ('b5000000-0000-4000-8000-00000000000c');
insert into bot.links (user_id, tg_user_id, chat_id) values ('b5000000-0000-4000-8000-00000000000a', 810001, 810001);
delete from bot.support_messages;
update bot.config set support_chat_id = null, support_tg_user_id = null, support_username_hash = null where id = 1;

-- 1. The gates.
select pg_temp.as_role(r) , pg_temp.expect_error(q, array['42501'], r || ': ' || q)
  from unnest(array['anon', 'authenticated']) r,
       unnest(array[$$select public.bot_support_add(1, 1, 1, 'x')$$, $$select public.bot_support_owner(1, 1, 'meldy_owner_test')$$,
                    $$select public.bot_support_claim()$$, $$select public.bot_support_done(1, 1, 1)$$,
                    $$select public.bot_support_reply(1, 1, 1)$$, $$select public.bot_support_answered(1)$$,
                    $$select count(*) from bot.support_messages$$, $$select count(*) from public.account_deletion_requests$$,
                    $$insert into public.account_deletion_requests (user_id) values ('b5000000-0000-4000-8000-00000000000b')$$,
                    $$select bot.support_cleanup(now())$$]) q;
-- The gate itself, with EXECUTE given back for a moment (the service-role check does not rely on the grants).
select pg_temp.as_role('postgres');
grant execute on function public.bot_support_add(bigint, bigint, bigint, text, text, text, timestamptz),
  public.bot_support_owner(bigint, bigint, text), public.bot_support_claim(integer, timestamptz),
  public.bot_support_done(bigint, bigint, bigint, text, timestamptz), public.bot_support_reply(bigint, bigint, bigint),
  public.bot_support_answered(bigint, timestamptz) to authenticated;
select pg_temp.as_role('authenticated', 'b5000000-0000-4000-8000-00000000000b');
select pg_temp.expect_error(q, array['42501'], 'the gate: ' || q)
  from unnest(array[$$select public.bot_support_add(1, 1, 1, 'x')$$, $$select public.bot_support_owner(1, 1, 'meldy_owner_test')$$,
                    $$select public.bot_support_claim()$$, $$select public.bot_support_done(1, 1, 1)$$,
                    $$select public.bot_support_reply(1, 1, 1)$$, $$select public.bot_support_answered(1)$$]) q;
select pg_temp.as_role('postgres');
revoke execute on function public.bot_support_add(bigint, bigint, bigint, text, text, text, timestamptz),
  public.bot_support_owner(bigint, bigint, text), public.bot_support_claim(integer, timestamptz),
  public.bot_support_done(bigint, bigint, bigint, text, timestamptz), public.bot_support_reply(bigint, bigint, bigint),
  public.bot_support_answered(bigint, timestamptz) from authenticated;
-- The account functions: not anon's, not the service role's; a session without a user is 28000.
select pg_temp.as_role(r), pg_temp.expect_error(q, array['42501'], r || ': ' || q)
  from unnest(array['anon', 'service_role']) r,
       unnest(array[$$select public.account_deletion_request()$$, $$select public.account_deletion_cancel()$$,
                    $$select public.account_deletion_status()$$]) q;
select pg_temp.as_role('authenticated');
select pg_temp.expect_error(q, array['28000'], 'not signed in: ' || q)
  from unnest(array[$$select public.account_deletion_request()$$, $$select public.account_deletion_cancel()$$,
                    $$select public.account_deletion_status()$$]) q;

-- 2. The one-time claim of the owner's chat.
select pg_temp.as_role('service_role');
select pg_temp.check(public.bot_support_owner(820001, 820001, 'meldy_owner_test') = '{"status": "off"}'::jsonb, 'claim: off without a hash');
select pg_temp.sx(format('update bot.config set support_username_hash = %L where id = 1', pg_temp.h('meldy_owner_test')));
do $t$
declare r jsonb;
begin
  -- Not this username, no username, not a username, a group (its id is not the sender's), a missing id.
  perform pg_temp.check(public.bot_support_owner(830001, 830001, 'meldy_owner_tes') = '{"status": "no"}'::jsonb, 'claim: another username');
  perform pg_temp.check(public.bot_support_owner(830001, 830001, 'meldy_owner_test1') = '{"status": "no"}'::jsonb, 'claim: a longer username');
  perform pg_temp.check(public.bot_support_owner(830001, 830001, null) = '{"status": "no"}'::jsonb, 'claim: no username');
  perform pg_temp.check(public.bot_support_owner(830001, 830001, '') = '{"status": "no"}'::jsonb, 'claim: an empty username');
  perform pg_temp.check(public.bot_support_owner(830001, 830001, 'meldy owner test') = '{"status": "no"}'::jsonb, 'claim: not a username');
  perform pg_temp.check(public.bot_support_owner(820001, -1001234567890, 'meldy_owner_test') = '{"status": "no"}'::jsonb, 'claim: a group chat');
  perform pg_temp.check(public.bot_support_owner(820001, 830001, 'meldy_owner_test') = '{"status": "no"}'::jsonb, 'claim: another one''s chat');
  perform pg_temp.check(public.bot_support_owner(null, null, 'meldy_owner_test') = '{"status": "no"}'::jsonb, 'claim: no ids');
  perform pg_temp.check(pg_temp.sq('select (support_chat_id is null and support_tg_user_id is null)::text from bot.config') = 'true',
                        'claim: nothing bound by the refusals');
  -- The matching username, in any letter case: bound, once.
  r := public.bot_support_owner(820001, 820001, 'Meldy_Owner_TEST');
  perform pg_temp.check(r = '{"status": "claimed"}'::jsonb, 'claim: the matching username ' || r::text);
  perform pg_temp.check(pg_temp.sq('select support_chat_id::text || ''/'' || support_tg_user_id::text from bot.config') = '820001/820001',
                        'claim: the chat and the Telegram id are stored');
  perform pg_temp.check(public.bot_support_owner(820001, 820001, 'meldy_owner_test') = '{"status": "set"}'::jsonb, 'claim: the owner again → set');
  -- The username now belongs to someone else: nothing moves.
  perform pg_temp.check(public.bot_support_owner(830001, 830001, 'meldy_owner_test') = '{"status": "set"}'::jsonb, 'claim: a taker → set');
  perform pg_temp.check(public.bot_support_owner(830001, 830001, 'someone_else') = '{"status": "set"}'::jsonb, 'claim: anyone → set');
  perform pg_temp.check(pg_temp.sq('select support_chat_id::text || ''/'' || support_tg_user_id::text from bot.config') = '820001/820001',
                        'claim: the binding did not move');
end
$t$;
select pg_temp.as_role('postgres');
-- The two ids go together; a hash is 64 hex.
select pg_temp.expect_error($$update bot.config set support_chat_id = null where id = 1$$, array['23514'], 'config: one id without the other');
select pg_temp.expect_error($$update bot.config set support_chat_id = -5 where id = 1$$, array['23514'], 'config: a chat that is no private one');
select pg_temp.expect_error($$update bot.config set support_username_hash = 'meldy_owner_test' where id = 1$$, array['23514'], 'config: a hash that is not one');
-- A rebind is a change by hand: both ids null, and the next «Старт» of the handle binds again.
update bot.config set support_chat_id = null, support_tg_user_id = null where id = 1;
select pg_temp.as_role('service_role');
select pg_temp.check(public.bot_support_owner(850001, 850001, 'meldy_owner_test') = '{"status": "claimed"}'::jsonb, 'rebind: claimed again');
select pg_temp.as_role('postgres');
update bot.config set support_chat_id = null, support_tg_user_id = null where id = 1;

-- 3. A person's message.
select pg_temp.as_role('service_role');
do $t$
declare
  r jsonb;
  t0 constant timestamptz := '2026-11-09 09:00+00';
  i integer;
begin
  -- A private chat only: the chat's id is the sender's.
  perform pg_temp.check(public.bot_support_add(810001, -1001234567890, 1, 'x') = '{"status": "private_only"}'::jsonb, 'add: a group');
  perform pg_temp.check(public.bot_support_add(810001, 830001, 1, 'x') = '{"status": "private_only"}'::jsonb, 'add: another chat');
  perform pg_temp.check(public.bot_support_add(0, 0, 1, 'x') = '{"status": "private_only"}'::jsonb, 'add: no sender');
  perform pg_temp.check(public.bot_support_add(810001, 810001, null, 'x') = '{"status": "private_only"}'::jsonb, 'add: no message id');
  perform pg_temp.check(public.bot_support_add(810001, 810001, 1, '') = '{"status": "empty"}'::jsonb, 'add: empty');
  perform pg_temp.check(public.bot_support_add(810001, 810001, 1, E' \n\t ') = '{"status": "empty"}'::jsonb, 'add: only spaces');
  perform pg_temp.check(public.bot_support_add(810001, 810001, 1, null) = '{"status": "empty"}'::jsonb, 'add: no text');
  perform pg_temp.check(public.bot_support_add(810001, 810001, 1, repeat('я', 2001)) = '{"status": "too_long"}'::jsonb, 'add: 2 001 characters');
  perform pg_temp.check(pg_temp.sq('select count(*)::text from bot.support_messages') = '0', 'add: nothing kept by the refusals');

  -- The linked sender: the account; the name on one line; the username as Telegram gave it.
  r := public.bot_support_add(810001, 810001, 11, E'  Не открывается экзамен.\n', E' Анна \n  Петрова ', 'anna_p', t0);
  perform pg_temp.check(r = '{"status": "stored"}'::jsonb, 'add: stored ' || r::text);
  perform pg_temp.check(pg_temp.sq($q$select row(kind, user_id, chat_id, tg_message_id, tg_name, tg_username, text, created_at = '2026-11-09 09:00+00',
                                                 sent_at, owner_message_id, answered_at, error)::text
                                      from bot.support_messages where chat_id = 810001$q$)
                        = '(message,b5000000-0000-4000-8000-00000000000a,810001,11,"Анна Петрова",anna_p,"Не открывается экзамен.",t,,,,)',
                        'add: the row of a linked sender');
  -- The same Telegram message again (a redelivered update): kept once.
  perform pg_temp.check(public.bot_support_add(810001, 810001, 11, 'Не открывается экзамен.', 'Анна', 'anna_p', t0 + interval '1 minute')
                        = '{"status": "stored"}'::jsonb, 'add: the same message again');
  perform pg_temp.check(pg_temp.sq('select count(*)::text from bot.support_messages') = '1', 'add: kept once');
  -- A sender with no Meldy account; 2 000 characters fit; a name of 300 characters is cut; a username that is none is dropped.
  r := public.bot_support_add(840001, 840001, 5, repeat('я', 2000), repeat('Ж', 300), 'not a username', t0);
  perform pg_temp.check(r = '{"status": "stored"}'::jsonb, 'add: 2 000 characters ' || r::text);
  perform pg_temp.check(pg_temp.sq($q$select row(user_id, char_length(text), char_length(tg_name), tg_username)::text
                                      from bot.support_messages where chat_id = 840001$q$) = '(,2000,128,)', 'add: the row of an unlinked sender');
  perform pg_temp.check(public.bot_support_add(840001, 840001, 6, 'без имени', null, null, t0) = '{"status": "stored"}'::jsonb, 'add: no name');
  perform pg_temp.check(pg_temp.sq('select (tg_name is null)::text from bot.support_messages where chat_id = 840001 and tg_message_id = 6') = 'true',
                        'add: an absent name is null');

  -- 5 an hour per chat (A has one at t0): four more go, the sixth waits; another chat is not held.
  for i in 1..4 loop
    perform pg_temp.check(public.bot_support_add(810001, 810001, 20 + i, 'ещё ' || i, 'Анна', null, t0 + i * interval '10 minutes')
                          = '{"status": "stored"}'::jsonb, 'limit: message ' || (i + 1));
  end loop;
  perform pg_temp.check(public.bot_support_add(810001, 810001, 30, 'шестое', 'Анна', null, t0 + interval '59 minutes')
                        = '{"status": "slow_down", "limit": "hour"}'::jsonb, 'limit: the sixth in an hour');
  perform pg_temp.check(public.bot_support_add(830001, 830001, 30, 'из другого чата', null, null, t0 + interval '59 minutes')
                        = '{"status": "stored"}'::jsonb, 'limit: another chat');
  -- An hour after the first: one more; 20 a day: three more hours of five, then «day».
  perform pg_temp.check(public.bot_support_add(810001, 810001, 31, 'через час', 'Анна', null, t0 + interval '60 minutes')
                        = '{"status": "stored"}'::jsonb, 'limit: an hour after the first one');
  for i in 1..14 loop
    perform pg_temp.check(public.bot_support_add(810001, 810001, 40 + i, 'день ' || i, 'Анна', null, t0 + interval '2 hours' + i * interval '15 minutes')
                          = '{"status": "stored"}'::jsonb, 'limit: message ' || (6 + i) || ' of the day');
  end loop;
  perform pg_temp.check(pg_temp.sq('select count(*)::text from bot.support_messages where chat_id = 810001') = '20', 'limit: 20 kept');
  perform pg_temp.check(public.bot_support_add(810001, 810001, 60, 'двадцать первое', 'Анна', null, t0 + interval '8 hours')
                        = '{"status": "slow_down", "limit": "day"}'::jsonb, 'limit: the 21st in a day');
  perform pg_temp.check(public.bot_support_add(810001, 810001, 60, 'двадцать первое', 'Анна', null, t0 + interval '24 hours 1 minute')
                        = '{"status": "stored"}'::jsonb, 'limit: a day after the first one');
end
$t$;

-- 4. The tick's claim. From here the queue is small and known.
select pg_temp.as_role('postgres');
delete from bot.support_messages;
insert into bot.support_messages (created_at, kind, user_id, chat_id, tg_message_id, tg_name, tg_username, text) values
  ('2026-11-09 09:00+00', 'message', 'b5000000-0000-4000-8000-00000000000a', 810001, 1, 'Анна', 'anna_p', 'первое'),
  ('2026-11-09 09:01+00', 'message', null, 840001, 1, null, null, 'второе');
insert into bot.support_messages (created_at, kind, user_id) values
  ('2026-11-09 09:02+00', 'deletion', 'b5000000-0000-4000-8000-00000000000b'),
  ('2026-11-09 09:03+00', 'deletion_cancel', 'b5000000-0000-4000-8000-00000000000b');
insert into bot.support_messages (created_at, kind, chat_id, tg_message_id, text) values
  ('2026-08-10 09:00+00', 'message', 840001, 2, 'старше 90 дней'), ('2026-08-13 09:00+00', 'message', 840001, 3, 'моложе 90 дней');
select pg_temp.as_role('service_role');
select pg_temp.expect_error(format('select public.bot_support_claim(%s)', n), array['22023'], 'claim: limit ' || n)
  from unnest(array['0', '51', 'null', '-1']) n;
do $t$
declare
  r jsonb;
  t0 constant timestamptz := '2026-11-09 10:00+00';
  ids bigint[];
begin
  -- Nothing bound: the rows wait, none is taken; the old row is gone all the same.
  r := public.bot_support_claim(10, t0);
  perform pg_temp.check(r = '{"status": "no_chat", "waiting": 5}'::jsonb, 'claim: no chat ' || r::text);
  perform pg_temp.check(pg_temp.sq('select count(*) filter (where claimed_at is not null)::text || ''/'' || count(*)::text from bot.support_messages') = '0/5',
                        'claim: nothing taken, the row older than 90 days deleted');
  perform pg_temp.check(pg_temp.sq($q$select count(*)::text from bot.support_messages where text = 'моложе 90 дней'$q$) = '1', 'cleanup: 88 days stay');
  perform pg_temp.sx($q$delete from bot.support_messages where text = 'моложе 90 дней'$q$);

  perform pg_temp.check(public.bot_support_owner(820001, 820001, 'meldy_owner_test') = '{"status": "claimed"}'::jsonb, 'claim: the owner binds');
  -- Oldest first, at most the limit; the rows' exact shapes.
  r := public.bot_support_claim(3, t0);
  ids := array(select (x ->> 'id')::bigint from jsonb_array_elements(r -> 'rows') x);
  perform pg_temp.check(r - 'rows' = '{"status": "ok", "chat_id": 820001, "tz": "Europe/Minsk"}'::jsonb, 'claim: ok ' || (r - 'rows')::text);
  perform pg_temp.check(jsonb_array_length(r -> 'rows') = 3 and ids = (select array_agg(id order by id) from (select id from unnest(ids) id) s),
                        'claim: three rows in id order');
  perform pg_temp.check((r -> 'rows' -> 0) - 'id' = '{"kind": "message", "name": "Анна", "username": "anna_p", "linked": true, "text": "первое"}'::jsonb,
                        'claim: a linked sender''s row ' || (r -> 'rows' -> 0)::text);
  perform pg_temp.check((r -> 'rows' -> 1) - 'id' = '{"kind": "message", "name": null, "username": null, "linked": false, "text": "второе"}'::jsonb,
                        'claim: an unlinked sender''s row ' || (r -> 'rows' -> 1)::text);
  perform pg_temp.check((r -> 'rows' -> 2) - 'id' - 'at' = '{"kind": "deletion", "user_id": "b5000000-0000-4000-8000-00000000000b"}'::jsonb
                        and (r -> 'rows' -> 2 ->> 'at')::timestamptz = '2026-11-09 09:02+00' and (r -> 'rows' -> 2 ->> 'at') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d',
                        'claim: a deletion row with its time (ISO 8601) ' || (r -> 'rows' -> 2)::text);
  -- A message row never carries the account id, a deletion row never a chat.
  perform pg_temp.check(not ((r -> 'rows' -> 0) ? 'user_id') and not ((r -> 'rows' -> 0) ? 'chat_id') and not ((r -> 'rows' -> 2) ? 'chat_id'),
                        'claim: no id beyond what the message says');
  -- The lease: the three are not handed again for 50 seconds; the fourth is.
  r := public.bot_support_claim(10, t0 + interval '49 seconds');
  perform pg_temp.check(jsonb_array_length(r -> 'rows') = 1 and r -> 'rows' -> 0 ->> 'kind' = 'deletion_cancel', 'lease: only the row not taken yet');
  perform pg_temp.check((r -> 'rows' -> 0) - 'id' - 'at' = '{"kind": "deletion_cancel", "user_id": "b5000000-0000-4000-8000-00000000000b"}'::jsonb,
                        'claim: a cancel row');
  r := public.bot_support_claim(10, t0 + interval '50 seconds');
  perform pg_temp.check(jsonb_array_length(r -> 'rows') = 3, 'lease: after 50 seconds the unmarked rows come again');
  -- The zone of a request's day: the owner's link when that Telegram is linked.
  perform pg_temp.sx($q$insert into bot.links (user_id, tg_user_id, chat_id, tz) values ('b5000000-0000-4000-8000-00000000000c', 820001, 820001, 'Asia/Almaty')$q$);
  perform pg_temp.check(public.bot_support_claim(10, t0 + interval '51 seconds') ->> 'tz' = 'Asia/Almaty', 'claim: the owner''s zone');
  perform pg_temp.sx('delete from bot.links where tg_user_id = 820001');

  -- 5. What became of a row.
  perform pg_temp.expect_error(format('select public.bot_support_done(%s)', a), array['22023'], 'done: ' || a)
    from unnest(array['1', '1, 820001', '1, null, 77', '1, 820001, 77, ''tg_400''', '1, null, null, ''Bad Request: chat''', 'null, 820001, 77']) a;
  perform pg_temp.check(public.bot_support_done(ids[1], 820001, 7001, null, t0 + interval '2 minutes') = '{"status": "ok"}'::jsonb, 'done: sent');
  perform pg_temp.check(pg_temp.sq(format('select row(sent_at = %L::timestamptz, owner_chat_id, owner_message_id, error)::text from bot.support_messages where id = %s',
                                          t0 + interval '2 minutes', ids[1])) = '(t,820001,7001,)', 'done: the owner''s message is kept');
  perform pg_temp.check(public.bot_support_done(ids[1], 820001, 7002) = '{"status": "gone"}'::jsonb, 'done: a sent row again → gone');
  perform pg_temp.check(public.bot_support_done(ids[1], null, null, 'tg_400') = '{"status": "gone"}'::jsonb, 'done: a sent row is not closed');
  perform pg_temp.check(public.bot_support_done(ids[2], null, null, 'tg_400') = '{"status": "ok"}'::jsonb, 'done: closed with a code');
  perform pg_temp.check(public.bot_support_done(ids[2], 820001, 7003) = '{"status": "gone"}'::jsonb, 'done: a closed row is not sent');
  perform pg_temp.check(public.bot_support_done(999999, 820001, 7004) = '{"status": "gone"}'::jsonb, 'done: no such row');
  perform pg_temp.check(public.bot_support_done(ids[3], 820001, 7005) = '{"status": "ok"}'::jsonb, 'done: the deletion row sent');
  r := public.bot_support_claim(10, t0 + interval '10 minutes');
  perform pg_temp.check(jsonb_array_length(r -> 'rows') = 1 and r -> 'rows' -> 0 ->> 'kind' = 'deletion_cancel',
                        'claim: sent and closed rows never come again');

  -- 6. Whose reply is it. The owner is the bound Telegram in the bound chat; anyone else is «none».
  perform pg_temp.check(public.bot_support_reply(830001, 830001, 7001) = '{"status": "none"}'::jsonb, 'reply: a stranger');
  perform pg_temp.check(public.bot_support_reply(810001, 810001, 7001) = '{"status": "none"}'::jsonb, 'reply: the sender themselves');
  perform pg_temp.check(public.bot_support_reply(820001, 830001, 7001) = '{"status": "none"}'::jsonb, 'reply: the owner in another chat');
  perform pg_temp.check(public.bot_support_reply(830001, 820001, 7001) = '{"status": "none"}'::jsonb, 'reply: someone else in the owner''s chat');
  perform pg_temp.check(public.bot_support_reply(null, 820001, 7001) = '{"status": "none"}'::jsonb, 'reply: no sender');
  perform pg_temp.check(public.bot_support_reply(820001, 820001, 7001) = jsonb_build_object('status', 'ok', 'id', ids[1], 'chat_id', 810001),
                        'reply: the owner → the sender''s chat');
  perform pg_temp.check(public.bot_support_reply(820001, 820001, 7005) = jsonb_build_object('status', 'service', 'id', ids[3]), 'reply: a deletion row');
  perform pg_temp.check(public.bot_support_reply(820001, 820001, 7999) = '{"status": "gone"}'::jsonb, 'reply: no row has that message');

  -- 7. Answered: by the first reply.
  perform pg_temp.check(public.bot_support_answered(ids[1], t0 + interval '1 hour') = '{"status": "ok"}'::jsonb, 'answered: ok');
  perform pg_temp.check(public.bot_support_answered(ids[1], t0 + interval '2 hours') = '{"status": "ok"}'::jsonb, 'answered: a second reply');
  perform pg_temp.check(pg_temp.sq(format('select (answered_at = %L::timestamptz)::text from bot.support_messages where id = %s', t0 + interval '1 hour', ids[1]))
                        = 'true', 'answered: the first reply''s time stays');
  perform pg_temp.check(public.bot_support_answered(ids[2]) = '{"status": "gone"}'::jsonb, 'answered: a row never sent');
  perform pg_temp.check(public.bot_support_answered(ids[3]) = '{"status": "gone"}'::jsonb, 'answered: a deletion row');
  perform pg_temp.check(public.bot_support_answered(999999) = '{"status": "gone"}'::jsonb, 'answered: no such row');

  -- After a rebind by hand the old owner is nobody: none, even for a message they once got.
  perform pg_temp.sx('update bot.config set support_chat_id = null, support_tg_user_id = null where id = 1');
  perform pg_temp.check(public.bot_support_reply(820001, 820001, 7001) = '{"status": "none"}'::jsonb, 'reply: nothing bound → none');
  perform pg_temp.check(public.bot_support_owner(820001, 820001, 'meldy_owner_test') = '{"status": "claimed"}'::jsonb, 'bound again');
end
$t$;

-- 8. Account deletion requests (B, signed in).
select pg_temp.as_role('postgres');
delete from bot.support_messages;
select pg_temp.as_role('authenticated', 'b5000000-0000-4000-8000-00000000000b');
do $t$
declare
  r jsonb;
  t1 timestamptz;
  t2 timestamptz;
  before timestamptz := clock_timestamp();
  i integer;
begin
  perform pg_temp.check(public.account_deletion_status() = '{"requested_at": null}'::jsonb, 'status: nothing asked');
  perform pg_temp.check(public.account_deletion_cancel() = '{"requested_at": null}'::jsonb, 'cancel: nothing to cancel');
  perform pg_temp.check(pg_temp.sq('select count(*)::text from bot.support_messages') = '0', 'cancel of nothing tells nobody');

  r := public.account_deletion_request();
  t1 := (r ->> 'requested_at')::timestamptz;
  perform pg_temp.check((select array_agg(k) from jsonb_object_keys(r) k) = array['requested_at'] and t1 between before and clock_timestamp(),
                        'request: {requested_at: now} ' || r::text);
  perform pg_temp.check(public.account_deletion_status() = r, 'status: the open request');
  perform pg_temp.check(pg_temp.sq($q$select row(user_id, cancelled_at)::text from public.account_deletion_requests$q$)
                        = '(b5000000-0000-4000-8000-00000000000b,)', 'request: one row, open');
  perform pg_temp.check(pg_temp.sq($q$select string_agg(kind || ':' || user_id::text || ':' || (chat_id is null)::text || ':' || (text is null)::text, ',')
                                      from bot.support_messages$q$) = 'deletion:b5000000-0000-4000-8000-00000000000b:true:true',
                        'request: the owner will hear of it (one deletion row, the account id only)');
  perform pg_temp.check(pg_temp.sq(format('select (created_at = %L::timestamptz)::text from bot.support_messages', t1)) = 'true',
                        'request: the row carries the request''s time');
  -- Asking again while it is open: the same time, nothing new for the owner.
  perform pg_sleep(0.02);
  perform pg_temp.check(public.account_deletion_request() = r, 'request: idempotent while open');
  perform pg_temp.check(pg_temp.sq('select count(*)::text from bot.support_messages') = '1', 'request again tells nobody');

  perform pg_temp.check(public.account_deletion_cancel() = '{"requested_at": null}'::jsonb, 'cancel: {requested_at: null}');
  perform pg_temp.check(public.account_deletion_status() = '{"requested_at": null}'::jsonb, 'status: cancelled');
  perform pg_temp.check(pg_temp.sq($q$select (cancelled_at > requested_at)::text from public.account_deletion_requests$q$) = 'true', 'cancel: the row is closed');
  perform pg_temp.check(pg_temp.sq($q$select string_agg(kind, ',' order by id) from bot.support_messages$q$) = 'deletion,deletion_cancel',
                        'cancel: the owner will hear of it');
  perform pg_temp.check(public.account_deletion_cancel() = '{"requested_at": null}'::jsonb, 'cancel again');
  perform pg_temp.check(pg_temp.sq('select count(*)::text from bot.support_messages') = '2', 'cancel again tells nobody');

  -- After a cancel a new request sets a new time; still one row per account.
  perform pg_sleep(0.02);
  r := public.account_deletion_request();
  t2 := (r ->> 'requested_at')::timestamptz;
  perform pg_temp.check(t2 > t1, 'request after a cancel: a new time');
  perform pg_temp.check(pg_temp.sq($q$select count(*)::text || ':' || count(*) filter (where cancelled_at is null)::text from public.account_deletion_requests$q$)
                        = '1:1', 'request after a cancel: the same row, open again');
  perform pg_temp.check(public.account_deletion_status() = r, 'status: the new request');

  -- At most 5 new requests in 24 hours (each writes to the owner's chat): the sixth is MA001; cancelling still works.
  for i in 3..5 loop
    perform public.account_deletion_cancel();
    perform public.account_deletion_request();
  end loop;
  perform public.account_deletion_cancel();
  perform pg_temp.expect_error('select public.account_deletion_request()', array['MA001'], 'request: the sixth in a day');
  perform pg_temp.check(public.account_deletion_status() = '{"requested_at": null}'::jsonb, 'the refused request opened nothing');
  perform pg_temp.check(pg_temp.sq($q$select count(*) filter (where kind = 'deletion')::text || '/' || count(*) filter (where kind = 'deletion_cancel')::text
                                      from bot.support_messages$q$) = '5/5', 'five requests and five cancels reached the queue');
  -- A day later it is possible again.
  perform pg_temp.sx($q$update bot.support_messages set created_at = created_at - interval '25 hours'$q$);
  r := public.account_deletion_request();
  perform pg_temp.check(r ->> 'requested_at' is not null, 'request: a day later');
end
$t$;
-- Another account sees only its own; the queue hands the requests to the owner's chat as service rows.
select pg_temp.as_role('authenticated', 'b5000000-0000-4000-8000-00000000000a');
select pg_temp.check(public.account_deletion_status() = '{"requested_at": null}'::jsonb, 'status: another account has none');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_support_claim(50);
  perform pg_temp.check(r ->> 'status' = 'ok' and jsonb_array_length(r -> 'rows') = 11, 'the requests reach the tick ' || jsonb_array_length(r -> 'rows'));
  perform pg_temp.check((select bool_and(x ->> 'user_id' = 'b5000000-0000-4000-8000-00000000000b' and x ->> 'kind' in ('deletion', 'deletion_cancel'))
                           from jsonb_array_elements(r -> 'rows') x), 'each row names the account and nothing else');
end
$t$;
-- The account deleted: its request and its rows go with it.
select pg_temp.as_role('postgres');
delete from auth.users where id = 'b5000000-0000-4000-8000-00000000000b';
select pg_temp.check((select count(*) from public.account_deletion_requests) = 0 and (select count(*) from bot.support_messages) = 0,
                     'the account''s request and queue rows are deleted with it');

-- 9. The queue's own checks.
select pg_temp.expect_error(q, array['23514'], 'check: ' || q)
  from unnest(array[
    $$insert into bot.support_messages (kind, text) values ('message', 'без чата')$$,
    $$insert into bot.support_messages (kind, chat_id, tg_message_id, text) values ('message', 840001, 9, '')$$,
    $$insert into bot.support_messages (kind, chat_id, tg_message_id, text) values ('message', 840001, 9, repeat('я', 2001))$$,
    $$insert into bot.support_messages (kind, chat_id, tg_message_id, text) values ('other', 840001, 9, 'x')$$,
    $$insert into bot.support_messages (kind) values ('deletion')$$,
    $$insert into bot.support_messages (kind, user_id, text) values ('deletion', 'b5000000-0000-4000-8000-00000000000a', 'текст')$$,
    $$insert into bot.support_messages (kind, user_id, chat_id) values ('deletion_cancel', 'b5000000-0000-4000-8000-00000000000a', 840001)$$,
    $$insert into bot.support_messages (kind, chat_id, tg_message_id, text, sent_at) values ('message', 840001, 9, 'x', now())$$,
    $$insert into bot.support_messages (kind, chat_id, tg_message_id, text, error) values ('message', 840001, 9, 'x', 'Bad Request: chat not found')$$,
    $$insert into bot.support_messages (kind, chat_id, tg_message_id, text, answered_at) values ('message', 840001, 9, 'x', now())$$,
    $$insert into bot.support_messages (kind, chat_id, tg_message_id, text, tg_username) values ('message', 840001, 9, 'x', '@anna')$$]) q;
insert into bot.support_messages (kind, chat_id, tg_message_id, text, sent_at, owner_chat_id, owner_message_id)
values ('message', 840001, 9, 'x', now(), 820001, 7100);
select pg_temp.expect_error($$insert into bot.support_messages (kind, chat_id, tg_message_id, text) values ('message', 840001, 9, 'ещё раз')$$,
                            array['23505'], 'unique: a Telegram message once');
select pg_temp.expect_error($$insert into bot.support_messages (kind, chat_id, tg_message_id, text, sent_at, owner_chat_id, owner_message_id)
                              values ('message', 840001, 10, 'y', now(), 820001, 7100)$$, array['23505'], 'unique: one row per message of the owner''s chat');

-- 10. bot_status (the public /status reads it) shows nothing of support: no hash, no chat, no id.
select pg_temp.as_role('service_role');
select pg_temp.check(public.bot_status()::text !~ 'support|820001', 'bot_status shows nothing of support');

select pg_temp.as_role('postgres');
select 'BOT SUPPORT CHECKS PASSED';
rollback;
