-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of the Mini App's sign-in
-- (supabase/migrations/20261010150000_telegram_webapp.sql) on a scratch database: the base and the exam container's
-- migrations, T1's three files and the bot's later packages, then this one (supabase/tests/local/telegram_bot_run.sh,
-- stage WA). Spec: meldy-notes/10_Project/Telegram_Mini_App_Spec_2026-10-10.md (§2 decisions 6–10 and 15, §4).
-- Covered: the gates (anon and authenticated get 42501, and the service-role gate holds without the grants);
-- bot_webapp_session — unlinked, linked (the account and its e-mail; the user seen), replayed, no_email (none, deleted,
-- banned; a ban that ended is fine), slow_down at 30 an hour (an older use does not count), 22023 for calls the function
-- never makes; bot_webapp_link — a new link (chat = the Telegram id, the zone, the language), the account's earlier
-- Telegram unlinked (replaced_chat_id), a Telegram of another account refused (linked_elsewhere), the same pair again
-- (again), a replay by the same pair (again) and by another account (replayed), an unknown zone → Europe/Minsk,
-- slow_down per Telegram and per account, 22023; the cleanup of uses older than two hours; the rows go with the
-- account; hashes only; row security on, no policy, no client privilege.
-- One transaction, rolled back. A failure raises (FAILED: …); success prints TELEGRAM WEBAPP CHECKS PASSED. Roles as
-- PostgREST sets them (T1's telegram_bot_behaviour.sql): anon, authenticated (request.jwt.claim.sub), service_role
-- (request.jwt.claims); postgres for fixtures.
\set ON_ERROR_STOP 1
begin;

-- Helpers (as in T1's behaviour test and T9's files test).
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
create temp table ctx (k text primary key, v text);
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from ctx where k = p_k
$fn$;
-- A replay key as the function makes it: sha256 hex (of the initData's hash; here of a word).
create or replace function pg_temp.h(p_word text) returns text language sql immutable as $fn$
  select encode(sha256(convert_to(p_word, 'UTF8')), 'hex')
$fn$;
-- Reads and writes of schema bot run as the migration role (the API roles have no way into it).
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
grant execute on function pg_temp.expect_error(text, text[], text), pg_temp.as_role(text, uuid), pg_temp.check(boolean, text),
  pg_temp.put(text, text), pg_temp.c(text), pg_temp.h(text), pg_temp.sq(text), pg_temp.sx(text) to anon, authenticated, service_role;

-- The local auth.users has only id (and created_at): the columns of Supabase Auth this package reads, for this test.
alter table auth.users add column if not exists email text, add column if not exists deleted_at timestamptz,
  add column if not exists banned_until timestamptz;

-- Accounts: S (a student on Telegram 709101), O (another account on Telegram 709102), N (an account without Telegram),
-- E (linked to 709103, no e-mail), D (linked to 709104, deleted), B (linked to 709105, banned for a day), P (linked to
-- 709106, a ban that ended). The addresses are made up.
insert into auth.users (id, email) values
  ('f9100000-0000-4000-8000-000000000001', 's@example.test'), ('f9100000-0000-4000-8000-000000000002', 'o@example.test'),
  ('f9100000-0000-4000-8000-000000000003', 'n@example.test'), ('f9100000-0000-4000-8000-000000000004', null),
  ('f9100000-0000-4000-8000-000000000005', 'd@example.test'), ('f9100000-0000-4000-8000-000000000006', 'b@example.test'),
  ('f9100000-0000-4000-8000-000000000007', 'p@example.test')
on conflict do nothing;
update auth.users set deleted_at = now() - interval '1 day' where id = 'f9100000-0000-4000-8000-000000000005';
update auth.users set banned_until = now() + interval '1 day' where id = 'f9100000-0000-4000-8000-000000000006';
update auth.users set banned_until = now() - interval '1 day' where id = 'f9100000-0000-4000-8000-000000000007';
insert into bot.links (user_id, tg_user_id, chat_id) values
  ('f9100000-0000-4000-8000-000000000001', 709101, 709101), ('f9100000-0000-4000-8000-000000000002', 709102, 709102),
  ('f9100000-0000-4000-8000-000000000004', 709103, 709103), ('f9100000-0000-4000-8000-000000000005', 709104, 709104),
  ('f9100000-0000-4000-8000-000000000006', 709105, 709105), ('f9100000-0000-4000-8000-000000000007', 709106, 709106);
select pg_temp.put('S', 'f9100000-0000-4000-8000-000000000001');
select pg_temp.put('O', 'f9100000-0000-4000-8000-000000000002');
select pg_temp.put('N', 'f9100000-0000-4000-8000-000000000003');

-- 1. The gates. Clients run neither function: anon and authenticated get 42501 (no EXECUTE after the grants, and the
--    service-role gate inside).
select pg_temp.as_role('anon');
select pg_temp.expect_error($$select public.bot_webapp_session(709101, pg_temp.h('g1'), now())$$, array['42501'], 'anon: session');
select pg_temp.expect_error($$select public.bot_webapp_link(709101, 'f9100000-0000-4000-8000-000000000001', pg_temp.h('g1'), now())$$,
                            array['42501'], 'anon: link');
select pg_temp.as_role('authenticated', pg_temp.c('S')::uuid);
select pg_temp.expect_error($$select public.bot_webapp_session(709101, pg_temp.h('g2'), now())$$, array['42501'], 'authenticated: session');
select pg_temp.expect_error($$select public.bot_webapp_link(709101, 'f9100000-0000-4000-8000-000000000001', pg_temp.h('g2'), now())$$,
                            array['42501'], 'authenticated: link');
select pg_temp.expect_error($$select count(*) from bot.webapp_uses$$, array['42501'], 'authenticated: read bot.webapp_uses');
-- The gate itself, with EXECUTE given back for a moment (the service-role check does not rely on the grants).
select pg_temp.as_role('postgres');
grant execute on function public.bot_webapp_session(bigint, text, timestamptz, timestamptz),
  public.bot_webapp_link(bigint, uuid, text, timestamptz, text, text, timestamptz) to authenticated;
select pg_temp.as_role('authenticated', pg_temp.c('S')::uuid);
select pg_temp.expect_error($$select public.bot_webapp_session(709101, pg_temp.h('g3'), now())$$, array['42501'], 'the gate: session');
select pg_temp.expect_error($$select public.bot_webapp_link(709101, 'f9100000-0000-4000-8000-000000000001', pg_temp.h('g3'), now())$$,
                            array['42501'], 'the gate: link');
select pg_temp.as_role('postgres');
revoke execute on function public.bot_webapp_session(bigint, text, timestamptz, timestamptz),
  public.bot_webapp_link(bigint, uuid, text, timestamptz, text, text, timestamptz) from authenticated;
select pg_temp.check(pg_temp.sq('select count(*) from bot.webapp_uses') = '0', 'the refused calls left no use');

-- 2. bot_webapp_session (service role).
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  -- Not linked: a status; the use is stored.
  r := public.bot_webapp_session(709199, pg_temp.h('u1'), now() - interval '5 seconds');
  perform pg_temp.check(r = '{"status": "unlinked"}'::jsonb, 'session: unlinked ' || r::text);
  -- Linked: the account and its e-mail.
  r := public.bot_webapp_session(709101, pg_temp.h('s1'), now() - interval '5 seconds');
  perform pg_temp.check(r = jsonb_build_object('status', 'linked', 'user_id', pg_temp.c('S'), 'email', 's@example.test'),
                        'session: linked ' || r::text);
  -- The same initData again: replayed, whatever the Telegram says.
  r := public.bot_webapp_session(709101, pg_temp.h('s1'), now() - interval '5 seconds');
  perform pg_temp.check(r = '{"status": "replayed"}'::jsonb, 'session: replayed ' || r::text);
  r := public.bot_webapp_session(709102, pg_temp.h('s1'), now());
  perform pg_temp.check(r = '{"status": "replayed"}'::jsonb, 'session: replayed by another Telegram ' || r::text);
  -- Accounts that cannot sign in by e-mail.
  perform pg_temp.check(public.bot_webapp_session(709103, pg_temp.h('e1'), now()) = '{"status": "no_email"}'::jsonb, 'session: no e-mail');
  perform pg_temp.check(public.bot_webapp_session(709104, pg_temp.h('d1'), now()) = '{"status": "no_email"}'::jsonb, 'session: deleted');
  perform pg_temp.check(public.bot_webapp_session(709105, pg_temp.h('b1'), now()) = '{"status": "no_email"}'::jsonb, 'session: banned');
  perform pg_temp.check(public.bot_webapp_session(709106, pg_temp.h('p1'), now()) ->> 'status' = 'linked', 'session: a ban that ended');
  -- Calls the function never makes: 22023.
  perform pg_temp.expect_error($$select public.bot_webapp_session(0, pg_temp.h('x'), now())$$, array['22023'], 'session: Telegram 0');
  perform pg_temp.expect_error($$select public.bot_webapp_session(709101, upper(pg_temp.h('x')), now())$$, array['22023'], 'session: upper-case hash');
  perform pg_temp.expect_error($$select public.bot_webapp_session(709101, 'abc', now())$$, array['22023'], 'session: short hash');
  perform pg_temp.expect_error($$select public.bot_webapp_session(709101, pg_temp.h('x'), null)$$, array['22023'], 'session: no auth_date');
end
$t$;
select pg_temp.as_role('postgres');
select pg_temp.check(pg_temp.sq($$select count(*) from bot.webapp_uses where purpose = 'session' and user_id is null$$) = '6',
                     'six uses stored, none for the refused or replayed calls');
select pg_temp.check(pg_temp.sq(format($$select tg_user_id from bot.webapp_uses where init_hash = %L and purpose = 'session'$$, pg_temp.h('s1'))) = '709101',
                     'the use names the Telegram of its first call');
select pg_temp.check(pg_temp.sq($$select (last_seen_at > now() - interval '1 minute')::text from bot.links where tg_user_id = 709101$$) = 'true',
                     'opening the Mini App counts as the user seen (ends K2''s silence)');
select pg_temp.check(pg_temp.sq($$select count(*) from bot.webapp_uses where init_hash !~ '^[0-9a-f]{64}$'$$) = '0', 'hashes only');

-- The brake: 30 sessions an hour per Telegram; a use older than an hour does not count.
select pg_temp.sx($$insert into bot.webapp_uses (init_hash, purpose, tg_user_id, auth_date, used_at)
                    select encode(sha256(convert_to('old' || i, 'UTF8')), 'hex'), 'session', 709102, now() - interval '70 minutes',
                           now() - interval '70 minutes' from generate_series(1, 40) i$$);
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  for i in 1..30 loop
    r := public.bot_webapp_session(709102, pg_temp.h('o' || i), now());
    perform pg_temp.check(r ->> 'status' = 'linked', 'session ' || i || ' of 30: ' || r::text);
  end loop;
  r := public.bot_webapp_session(709102, pg_temp.h('o31'), now());
  perform pg_temp.check(r = '{"status": "slow_down"}'::jsonb, 'session 31 in an hour: slow_down ' || r::text);
  -- Another Telegram is not slowed by it.
  perform pg_temp.check(public.bot_webapp_session(709106, pg_temp.h('p2'), now()) ->> 'status' = 'linked', 'another Telegram meanwhile');
end
$t$;
select pg_temp.as_role('postgres');
select pg_temp.check(pg_temp.sq($$select count(*) from bot.webapp_uses where init_hash = encode(sha256(convert_to('o31', 'UTF8')), 'hex')$$) = '0',
                     'a slowed call stores no use');

-- 3. bot_webapp_link (service role).
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  -- N (no Telegram) on Telegram 709110: a new link, the browser's zone and the language.
  r := public.bot_webapp_link(709110, pg_temp.c('N')::uuid, pg_temp.h('n1'), now(), 'ru', 'Europe/Moscow');
  perform pg_temp.check(r = '{"status": "linked", "again": false, "replaced_chat_id": null}'::jsonb, 'link: new ' || r::text);
  -- The same initData by the same pair: linked again, nothing new. By another account: replayed.
  r := public.bot_webapp_link(709110, pg_temp.c('N')::uuid, pg_temp.h('n1'), now(), 'ru', 'Europe/Moscow');
  perform pg_temp.check(r = '{"status": "linked", "again": true, "replaced_chat_id": null}'::jsonb, 'link: the same pair replays ' || r::text);
  r := public.bot_webapp_link(709110, pg_temp.c('O')::uuid, pg_temp.h('n1'), now());
  perform pg_temp.check(r = '{"status": "replayed"}'::jsonb, 'link: another account replays ' || r::text);
  -- A session use of a hash does not stop a link with it (the Mini App asks for both with one initData).
  perform pg_temp.check(public.bot_webapp_session(709120, pg_temp.h('both'), now()) = '{"status": "unlinked"}'::jsonb, 'both: session');
  r := public.bot_webapp_link(709120, pg_temp.c('O')::uuid, pg_temp.h('both'), now(), null, 'Mars/Base');
  perform pg_temp.check(r = '{"status": "linked", "again": false, "replaced_chat_id": 709102}'::jsonb,
                        'link: O moves from 709102 to 709120, its old chat for M6 ' || r::text);
  -- S's Telegram 709101 for O: refused, S keeps it.
  r := public.bot_webapp_link(709101, pg_temp.c('O')::uuid, pg_temp.h('steal'), now());
  perform pg_temp.check(r = '{"status": "linked_elsewhere"}'::jsonb, 'link: another account''s Telegram ' || r::text);
  -- The same pair with a new launch: again, the zone of the new browser taken.
  r := public.bot_webapp_link(709110, pg_temp.c('N')::uuid, pg_temp.h('n2'), now(), 'en', 'Asia/Tbilisi');
  perform pg_temp.check(r = '{"status": "linked", "again": true, "replaced_chat_id": null}'::jsonb, 'link: the same pair again ' || r::text);
  -- Calls the function never makes: 22023.
  perform pg_temp.expect_error($$select public.bot_webapp_link(709130, 'f9100000-0000-4000-8000-0000000000ff', pg_temp.h('x'), now())$$,
                               array['22023'], 'link: an account that is not there');
  perform pg_temp.expect_error($$select public.bot_webapp_link(0, 'f9100000-0000-4000-8000-000000000003', pg_temp.h('x'), now())$$,
                               array['22023'], 'link: Telegram 0');
  perform pg_temp.expect_error($$select public.bot_webapp_link(709130, 'f9100000-0000-4000-8000-000000000003', 'nope', now())$$,
                               array['22023'], 'link: a bad hash');
  perform pg_temp.expect_error($$select public.bot_webapp_link(709130, null, pg_temp.h('x'), now())$$, array['22023'], 'link: no account');
end
$t$;
select pg_temp.as_role('postgres');
select pg_temp.check(pg_temp.sq($$select string_agg(format('%s/%s/%s/%s', chat_id, tz, coalesce(tg_lang, '-'), user_id), ',' order by tg_user_id)
                                   from bot.links where tg_user_id in (709110, 709120) and unlinked_at is null$$)
                     = format('709110/Asia/Tbilisi/en/%s,709120/Europe/Minsk/-/%s', pg_temp.c('N'), pg_temp.c('O')),
                     'the links: chat = the Telegram id; the zone and language of the last launch; an unknown zone → Europe/Minsk');
select pg_temp.check(pg_temp.sq($$select (unlinked_at is not null)::text from bot.links where tg_user_id = 709102$$) = 'true',
                     'O''s earlier Telegram is unlinked');
select pg_temp.check(pg_temp.sq(format($$select user_id::text from bot.links where tg_user_id = 709101 and unlinked_at is null$$)) = pg_temp.c('S'),
                     'S keeps Telegram 709101');
select pg_temp.check(pg_temp.sq($$select count(*) from bot.links where unlinked_at is null and user_id = 'f9100000-0000-4000-8000-000000000003'$$) = '1',
                     'one active link per account');

-- The brake of links: 10 an hour per Telegram, 10 an hour per account, each on its own.
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  -- Ten uses of Telegram 709140: P links it (leaving 709106), then S and P in turn (S is refused: it is P's now).
  r := public.bot_webapp_link(709140, 'f9100000-0000-4000-8000-000000000007', pg_temp.h('t1'), now());
  perform pg_temp.check(r = '{"status": "linked", "again": false, "replaced_chat_id": 709106}'::jsonb, 'P links 709140 ' || r::text);
  for i in 2..10 loop
    r := public.bot_webapp_link(709140, (case when i % 2 = 0 then pg_temp.c('S') else 'f9100000-0000-4000-8000-000000000007' end)::uuid,
                                pg_temp.h('t' || i), now());
    perform pg_temp.check(r ->> 'status' in ('linked', 'linked_elsewhere'), 'use ' || i || ' of 10 for one Telegram: ' || r::text);
  end loop;
  -- An eleventh, by an account with no link use yet: the Telegram's ten stop it.
  r := public.bot_webapp_link(709140, 'f9100000-0000-4000-8000-000000000004', pg_temp.h('t11'), now());
  perform pg_temp.check(r = '{"status": "slow_down"}'::jsonb, 'use 11 for one Telegram: slow_down ' || r::text);
  -- Ten uses of account N (n1 and n2 above, then eight new Telegrams, each a move): an eleventh Telegram is stopped.
  for i in 1..8 loop
    r := public.bot_webapp_link(709150 + i, pg_temp.c('N')::uuid, pg_temp.h('m' || i), now());
    perform pg_temp.check(r ->> 'status' = 'linked' and r ->> 'again' = 'false', 'N to Telegram ' || (709150 + i) || ': ' || r::text);
  end loop;
  r := public.bot_webapp_link(709170, pg_temp.c('N')::uuid, pg_temp.h('m9'), now());
  perform pg_temp.check(r = '{"status": "slow_down"}'::jsonb, 'the account''s eleventh: slow_down ' || r::text);
end
$t$;
select pg_temp.as_role('postgres');
select pg_temp.check(pg_temp.sq($$select count(*) from bot.webapp_uses where init_hash in
                                   (encode(sha256(convert_to('t11', 'UTF8')), 'hex'), encode(sha256(convert_to('m9', 'UTF8')), 'hex'))$$) = '0',
                     'a slowed link stores no use');
select pg_temp.check(pg_temp.sq($$select count(*) from bot.links where unlinked_at is null and tg_user_id = 709170$$) = '0',
                     'the slowed link made no link');

-- 4. The cleanup: a session deletes uses older than two hours (at most 200 a call), keeps the rest.
select pg_temp.as_role('postgres');
select pg_temp.put('before', pg_temp.sq('select count(*) from bot.webapp_uses'));
select pg_temp.sx($$update bot.webapp_uses set used_at = now() - interval '3 hours' where init_hash in
                    (encode(sha256(convert_to('u1', 'UTF8')), 'hex'), encode(sha256(convert_to('e1', 'UTF8')), 'hex'))$$);
select pg_temp.as_role('service_role');
select pg_temp.check(public.bot_webapp_session(709160, pg_temp.h('c1'), now()) ->> 'status' = 'unlinked', 'a session after the cleanup');
select pg_temp.as_role('postgres');
-- 40 old uses of 70 minutes stay (younger than two hours); the two of three hours go; the new one is added.
select pg_temp.check(pg_temp.sq('select count(*) from bot.webapp_uses') = (pg_temp.c('before')::int - 2 + 1)::text,
                     'the two uses older than two hours are gone, the rest kept');

-- 5. The rows go with the account.
delete from auth.users where id = pg_temp.c('O')::uuid;
select pg_temp.check(pg_temp.sq(format($$select count(*) from bot.webapp_uses where user_id = %L$$, pg_temp.c('O'))) = '0',
                     'the link uses go with the account');

-- 6. The shape the contract checks: the six columns, keys, row security on, no policy, no client privilege.
select pg_temp.check((select array_agg(a.attname::text order by a.attname) from pg_attribute a
                       where a.attrelid = 'bot.webapp_uses'::regclass and a.attnum > 0 and not a.attisdropped)
                     = array['auth_date', 'init_hash', 'purpose', 'tg_user_id', 'used_at', 'user_id'], 'bot.webapp_uses has six columns');
select pg_temp.check((select relrowsecurity from pg_class where oid = 'bot.webapp_uses'::regclass), 'row security on bot.webapp_uses');
select pg_temp.check(not exists (select 1 from pg_policies where schemaname = 'bot' and tablename = 'webapp_uses'), 'no policy');
select pg_temp.check(not has_table_privilege('anon', 'bot.webapp_uses', 'SELECT')
                     and not has_table_privilege('authenticated', 'bot.webapp_uses', 'SELECT'), 'no client privilege on the table');
select pg_temp.check((select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') in ('search_path=""', 'search_path=')
                                      and not has_function_privilege('anon', p.oid, 'EXECUTE')
                                      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                      and has_function_privilege('service_role', p.oid, 'EXECUTE'))
                        from pg_proc p where p.proname in ('bot_webapp_session', 'bot_webapp_link') and p.pronamespace = 'public'::regnamespace),
                     'both functions: SECURITY DEFINER, empty search_path, the service role only');

select 'TELEGRAM WEBAPP CHECKS PASSED' as result;
rollback;
