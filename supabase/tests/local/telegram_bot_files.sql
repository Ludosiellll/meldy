-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of the file hand-off (package T9:
-- supabase/migrations/20261010120005_telegram_bot_files.sql) on a scratch database: the base and the exam container's
-- migrations, T1's three files (20261010120000_telegram_bot.sql, _cron.sql, _revokes.sql), then T9's migration.
-- Spec §8.2 «Файлы» (another user, an expired ticket, a repeated ticket) and the rest of the contract: the ticket and the
-- token stored as hashes only; 30 minutes and 60 seconds; the token once; a take replaces the earlier token; statuses
-- for every expected outcome; the gates (42501 for clients on bot_*, 28000 signed out, anon runs nothing); the name and
-- type cleaned; the day-old rows deleted by the next offer; the rows go with the account.
-- One transaction, rolled back. A failure raises (FAILED: …); success prints TELEGRAM BOT FILES CHECKS PASSED. Roles as
-- PostgREST sets them (T1's telegram_bot_behaviour.sql): anon, authenticated (request.jwt.claim.sub), service_role
-- (request.jwt.claims); postgres for fixtures. Two redeems at the same moment: telegram_bot_files_run.sh in the
-- scratchpad runner (two sessions), not here.
\set ON_ERROR_STOP 1
begin;

-- Helpers (as in T1's behaviour test).
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
  pg_temp.put(text, text), pg_temp.c(text), pg_temp.sq(text), pg_temp.sx(text) to anon, authenticated, service_role;

-- Accounts: S (a student, Telegram 709001), O (another account, Telegram 709002), N (an account with no Telegram).
-- The invented exam's file «Банк_БД_2026.docx» (spec §4.7); the file ids are made up.
insert into auth.users (id) values
  ('f9000000-0000-4000-8000-000000000001'), ('f9000000-0000-4000-8000-000000000002'), ('f9000000-0000-4000-8000-000000000003')
on conflict do nothing;
insert into bot.links (user_id, tg_user_id, chat_id) values
  ('f9000000-0000-4000-8000-000000000001', 709001, 709001), ('f9000000-0000-4000-8000-000000000002', 709002, 709002);
select pg_temp.put('S', 'f9000000-0000-4000-8000-000000000001');
select pg_temp.put('O', 'f9000000-0000-4000-8000-000000000002');
select pg_temp.put('N', 'f9000000-0000-4000-8000-000000000003');
select pg_temp.put('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

-- 1. The gates. Clients run no bot_* function: anon and authenticated get 42501 (no EXECUTE after the grants, and the
--    service-role gate inside); anon cannot take a ticket; signed out (authenticated without a subject) → 28000.
select pg_temp.as_role('anon');
select pg_temp.expect_error($$select public.bot_file_offer(709001, 'BQACAgIAAxkBAAIBc2Zm_test-file_1', 'x.docx', 10, null)$$,
                            array['42501'], 'anon: bot_file_offer');
select pg_temp.expect_error($$select public.bot_file_redeem(repeat('a', 64))$$, array['42501'], 'anon: bot_file_redeem');
select pg_temp.expect_error($$select public.telegram_file_take('F' || repeat('a', 32))$$, array['42501'], 'anon: telegram_file_take');
select pg_temp.as_role('authenticated', pg_temp.c('S')::uuid);
select pg_temp.expect_error($$select public.bot_file_offer(709001, 'BQACAgIAAxkBAAIBc2Zm_test-file_1', 'x.docx', 10, null)$$,
                            array['42501'], 'authenticated: bot_file_offer');
select pg_temp.expect_error($$select public.bot_file_redeem(repeat('a', 64))$$, array['42501'], 'authenticated: bot_file_redeem');
select pg_temp.as_role('authenticated');
select pg_temp.expect_error($$select public.telegram_file_take('F' || repeat('a', 32))$$, array['28000'], 'signed out: telegram_file_take');
-- The gate itself, with EXECUTE given back for a moment (the service-role check does not rely on the grants).
select pg_temp.as_role('postgres');
grant execute on function public.bot_file_offer(bigint, text, text, bigint, text), public.bot_file_redeem(text) to authenticated;
select pg_temp.as_role('authenticated', pg_temp.c('S')::uuid);
select pg_temp.expect_error($$select public.bot_file_offer(709001, 'BQACAgIAAxkBAAIBc2Zm_test-file_1', 'x.docx', 10, null)$$,
                            array['42501'], 'the gate: bot_file_offer');
select pg_temp.expect_error($$select public.bot_file_redeem(repeat('a', 64))$$, array['42501'], 'the gate: bot_file_redeem');
select pg_temp.as_role('postgres');
revoke execute on function public.bot_file_offer(bigint, text, text, bigint, text), public.bot_file_redeem(text) from authenticated;

-- 2. bot_file_offer (service role).
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_file_offer(709001, 'BQACAgIAAxkBAAIBc2Zm_test-file_1', 'Банк_БД_2026.docx', 1258291, pg_temp.c('docx'));
  perform pg_temp.check(r ->> 'status' = 'ok', 'offer: ok ' || r::text);
  perform pg_temp.check((r ->> 'ticket') ~ '^F[0-9a-f]{32}$', 'offer: the ticket is F + 32 hex');
  perform pg_temp.check(abs(extract(epoch from (r ->> 'expires_at')::timestamptz - (now() + interval '30 minutes'))) < 1,
                        'offer: 30 minutes');
  perform pg_temp.put('t1', r ->> 'ticket');
  -- Not linked: a status, no row.
  r := public.bot_file_offer(709099, 'BQACAgIAAxkBAAIBc2Zm_test-file_2', 'x.docx', 10, null);
  perform pg_temp.check(r = '{"status": "unlinked"}'::jsonb, 'offer: not linked ' || r::text);
  -- Over 20 MB (getFile's limit): a status, no row. Exactly 20 MB is fine.
  r := public.bot_file_offer(709001, 'BQACAgIAAxkBAAIBc2Zm_test-file_3', 'big.docx', 20971521, null);
  perform pg_temp.check(r = '{"status": "too_big"}'::jsonb, 'offer: too big ' || r::text);
  r := public.bot_file_offer(709001, 'BQACAgIAAxkBAAIBc2Zm_test-file_4', 'edge.docx', 20971520, null);
  perform pg_temp.check(r ->> 'status' = 'ok', 'offer: exactly 20 MB');
  -- A call the function never makes: 22023.
  perform pg_temp.expect_error($$select public.bot_file_offer(0, 'abc', null, null, null)$$, array['22023'], 'offer: Telegram id 0');
  perform pg_temp.expect_error($$select public.bot_file_offer(709001, null, null, null, null)$$, array['22023'], 'offer: no file id');
  perform pg_temp.expect_error($$select public.bot_file_offer(709001, 'a b', null, null, null)$$, array['22023'], 'offer: file id with a space');
  perform pg_temp.expect_error($$select public.bot_file_offer(709001, repeat('a', 513), null, null, null)$$, array['22023'], 'offer: file id too long');
  perform pg_temp.expect_error($$select public.bot_file_offer(709001, 'abc', null, -1, null)$$, array['22023'], 'offer: negative size');
end
$t$;

-- Only hashes: the row's ticket_hash is sha256(ticket); the ticket itself is nowhere in the table.
select pg_temp.as_role('postgres');
select pg_temp.check((select count(*) from bot.files where ticket_hash = encode(sha256(convert_to(pg_temp.c('t1'), 'UTF8')), 'hex')) = 1,
                     'the row is found by sha256(ticket)');
select pg_temp.check(not exists (select 1 from bot.files f where f::text like '%' || substr(pg_temp.c('t1'), 2) || '%'),
                     'the ticket is not stored');
select pg_temp.check((select user_id::text = pg_temp.c('S') and name = 'Банк_БД_2026.docx' and size = 1258291 and mime = pg_temp.c('docx')
                             and token_hash is null and used_at is null
                        from bot.files where ticket_hash = encode(sha256(convert_to(pg_temp.c('t1'), 'UTF8')), 'hex')),
                     'the row: the account of that Telegram, the name, size and type, no token yet');

-- The name and the type as Telegram gave them, cleaned: one line, no control or direction marks, 255 characters at most;
-- a type that is not one is dropped; no name at all is kept as null.
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_file_offer(709001, 'BQACAgIAAxkBAAIBc2Zm_test-file_5', E'  Банк\tБД\n2026‮xcod.docx​  ', 10, ' Text/Plain ');
  perform pg_temp.put('t5', r ->> 'ticket');
  r := public.bot_file_offer(709001, 'BQACAgIAAxkBAAIBc2Zm_test-file_6', repeat('я', 300) || '.docx', 10, 'not a type');
  perform pg_temp.put('t6', r ->> 'ticket');
  r := public.bot_file_offer(709001, 'BQACAgIAAxkBAAIBc2Zm_test-file_7', E'‮‏', null, null);
  perform pg_temp.put('t7', r ->> 'ticket');
end
$t$;
select pg_temp.as_role('postgres');
select pg_temp.check((select name = 'Банк БД 2026xcod.docx' and mime = 'text/plain'
                        from bot.files where ticket_hash = encode(sha256(convert_to(pg_temp.c('t5'), 'UTF8')), 'hex')),
                     'the name cleaned (tab and line break → space, U+202E and U+200B gone, trimmed), the type lower-cased');
select pg_temp.check((select char_length(name) = 255 and name = repeat('я', 255) and mime is null
                        from bot.files where ticket_hash = encode(sha256(convert_to(pg_temp.c('t6'), 'UTF8')), 'hex')),
                     'a long name cut to 255 characters; a bad type dropped');
select pg_temp.check((select name is null and size is null
                        from bot.files where ticket_hash = encode(sha256(convert_to(pg_temp.c('t7'), 'UTF8')), 'hex')),
                     'a name of marks only is no name');

-- 3. telegram_file_take: another account (§8.2 «чужой пользователь»), the owner, a second take, malformed tickets.
select pg_temp.as_role('authenticated', pg_temp.c('O')::uuid);
select pg_temp.check(public.telegram_file_take(pg_temp.c('t1')) = '{"status": "other_user"}'::jsonb,
                     'another account: other_user and nothing else');
select pg_temp.as_role('authenticated', pg_temp.c('N')::uuid);
select pg_temp.check(public.telegram_file_take(pg_temp.c('t1')) = '{"status": "other_user"}'::jsonb,
                     'an account without Telegram: other_user');
select pg_temp.as_role('postgres');
select pg_temp.check((select token_hash is null and used_at is null
                        from bot.files where ticket_hash = encode(sha256(convert_to(pg_temp.c('t1'), 'UTF8')), 'hex')),
                     'a foreign take changes nothing');
select pg_temp.as_role('authenticated', pg_temp.c('S')::uuid);
do $t$
declare r jsonb;
begin
  r := public.telegram_file_take(pg_temp.c('t1'));
  perform pg_temp.check(r ->> 'status' = 'ok', 'take: ok ' || r::text);
  perform pg_temp.check((r ->> 'token') ~ '^[0-9a-f]{64}$', 'take: the token is 64 hex');
  perform pg_temp.check(abs(extract(epoch from (r ->> 'expires_at')::timestamptz - (now() + interval '60 seconds'))) < 1,
                        'take: 60 seconds');
  perform pg_temp.check(r ->> 'name' = 'Банк_БД_2026.docx' and (r ->> 'size')::bigint = 1258291 and r ->> 'mime' = pg_temp.c('docx'),
                        'take: name, size and type for the File');
  perform pg_temp.check(not (r ? 'file_id') and not (r ? 'user_id') and not (r ? 'ticket'), 'take: no file id, no account, no ticket');
  perform pg_temp.put('k1', r ->> 'token');
  -- A second take before the file was fetched (a reload, a second tab): a new token, the first one ends.
  r := public.telegram_file_take(pg_temp.c('t1'));
  perform pg_temp.check(r ->> 'status' = 'ok' and r ->> 'token' <> pg_temp.c('k1'), 'take again: a new token');
  perform pg_temp.put('k2', r ->> 'token');
  -- Malformed or unknown tickets.
  perform pg_temp.check(public.telegram_file_take(null) = '{"status": "invalid"}'::jsonb, 'take: null');
  perform pg_temp.check(public.telegram_file_take('garbage') = '{"status": "invalid"}'::jsonb, 'take: garbage');
  perform pg_temp.check(public.telegram_file_take(upper(pg_temp.c('t1'))) = '{"status": "invalid"}'::jsonb, 'take: upper-case hex');
  perform pg_temp.check(public.telegram_file_take('F' || repeat('0', 32)) = '{"status": "invalid"}'::jsonb, 'take: unknown ticket');
  perform pg_temp.check(public.telegram_file_take(substr(pg_temp.c('t1'), 2)) = '{"status": "invalid"}'::jsonb, 'take: without the F');
end
$t$;
select pg_temp.as_role('postgres');
select pg_temp.check((select token_hash = encode(sha256(convert_to(pg_temp.c('k2'), 'UTF8')), 'hex')
                             and abs(extract(epoch from token_expires_at - (now() + interval '60 seconds'))) < 1
                        from bot.files where ticket_hash = encode(sha256(convert_to(pg_temp.c('t1'), 'UTF8')), 'hex')),
                     'the token is stored as sha256, 60 seconds');
select pg_temp.check(not exists (select 1 from bot.files f where f::text like '%' || pg_temp.c('k2') || '%'),
                     'the token is not stored');

-- 4. bot_file_redeem: the replaced token, the token once, then the ticket is spent (§8.2 «повторный билет»).
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  perform pg_temp.check(public.bot_file_redeem(pg_temp.c('k1')) = '{"status": "invalid"}'::jsonb, 'redeem: the replaced token');
  r := public.bot_file_redeem(pg_temp.c('k2'));
  perform pg_temp.check(r = jsonb_build_object('status', 'ok', 'file_id', 'BQACAgIAAxkBAAIBc2Zm_test-file_1', 'name', 'Банк_БД_2026.docx',
                                               'size', 1258291, 'mime', pg_temp.c('docx')), 'redeem: ok ' || r::text);
  perform pg_temp.check(public.bot_file_redeem(pg_temp.c('k2')) = '{"status": "used"}'::jsonb, 'redeem: the same token again');
  perform pg_temp.check(public.bot_file_redeem(null) = '{"status": "invalid"}'::jsonb, 'redeem: null');
  perform pg_temp.check(public.bot_file_redeem('xyz') = '{"status": "invalid"}'::jsonb, 'redeem: garbage');
  perform pg_temp.check(public.bot_file_redeem(upper(pg_temp.c('k2'))) = '{"status": "invalid"}'::jsonb, 'redeem: upper-case hex');
  perform pg_temp.check(public.bot_file_redeem(repeat('0', 64)) = '{"status": "invalid"}'::jsonb, 'redeem: unknown token');
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('S')::uuid);
select pg_temp.check(public.telegram_file_take(pg_temp.c('t1')) = '{"status": "used"}'::jsonb,
                     'the ticket after the file was fetched: used (the second time the ticket does not open)');
select pg_temp.as_role('authenticated', pg_temp.c('O')::uuid);
select pg_temp.check(public.telegram_file_take(pg_temp.c('t1')) = '{"status": "other_user"}'::jsonb,
                     'a spent ticket to another account: still only other_user');

-- 5. Expired (§8.2 «устаревший билет»): the ticket after its 30 minutes; the token after its 60 seconds (the ticket is
--    then still good for a new take); a token taken in the ticket's last second lives its own 60 seconds.
select pg_temp.as_role('service_role');
select pg_temp.put('t2', public.bot_file_offer(709001, 'BQACAgIAAxkBAAIBc2Zm_test-file_8', 'Сети.xlsx', 2048, null) ->> 'ticket');
select pg_temp.put('t3', public.bot_file_offer(709001, 'BQACAgIAAxkBAAIBc2Zm_test-file_9', 'ОС.txt', 512, 'text/plain') ->> 'ticket');
select pg_temp.as_role('postgres');
select pg_temp.sx(format('update bot.files set expires_at = now() - interval ''1 second'' where ticket_hash = %L',
                         encode(sha256(convert_to(pg_temp.c('t2'), 'UTF8')), 'hex')));
select pg_temp.as_role('authenticated', pg_temp.c('S')::uuid);
select pg_temp.check(public.telegram_file_take(pg_temp.c('t2')) = '{"status": "expired"}'::jsonb, 'take: the ticket after 30 minutes');
select pg_temp.as_role('authenticated', pg_temp.c('O')::uuid);
select pg_temp.check(public.telegram_file_take(pg_temp.c('t2')) = '{"status": "other_user"}'::jsonb, 'an expired ticket to another account');
select pg_temp.as_role('authenticated', pg_temp.c('S')::uuid);
select pg_temp.put('k3', public.telegram_file_take(pg_temp.c('t3')) ->> 'token');
select pg_temp.as_role('postgres');
select pg_temp.sx(format('update bot.files set token_expires_at = now() - interval ''1 second'' where ticket_hash = %L',
                         encode(sha256(convert_to(pg_temp.c('t3'), 'UTF8')), 'hex')));
select pg_temp.as_role('service_role');
select pg_temp.check(public.bot_file_redeem(pg_temp.c('k3')) = '{"status": "expired"}'::jsonb, 'redeem: the token after 60 seconds');
select pg_temp.as_role('authenticated', pg_temp.c('S')::uuid);
select pg_temp.put('k4', public.telegram_file_take(pg_temp.c('t3')) ->> 'token');
select pg_temp.check(pg_temp.c('k4') ~ '^[0-9a-f]{64}$', 'the ticket is still good for a new take after its token expired');
select pg_temp.as_role('postgres');
select pg_temp.sx(format('update bot.files set expires_at = now() - interval ''1 second'' where ticket_hash = %L',
                         encode(sha256(convert_to(pg_temp.c('t3'), 'UTF8')), 'hex')));
select pg_temp.as_role('service_role');
select pg_temp.check(public.bot_file_redeem(pg_temp.c('k4')) ->> 'status' = 'ok',
                     'redeem: a token taken before the ticket expired lives its own 60 seconds');

-- 6. No client reads schema bot directly; the rows follow the account; day-old rows go with the next offer.
select pg_temp.as_role('authenticated', pg_temp.c('S')::uuid);
select pg_temp.expect_error($$select count(*) from bot.files$$, array['42501'], 'authenticated: select bot.files');
select pg_temp.as_role('anon');
select pg_temp.expect_error($$select count(*) from bot.files$$, array['42501'], 'anon: select bot.files');
select pg_temp.as_role('postgres');
select pg_temp.put('before', (select count(*)::text from bot.files));
select pg_temp.sx(format('update bot.files set expires_at = now() - interval ''25 hours'' where ticket_hash in (%L, %L)',
                         encode(sha256(convert_to(pg_temp.c('t5'), 'UTF8')), 'hex'), encode(sha256(convert_to(pg_temp.c('t6'), 'UTF8')), 'hex')));
select pg_temp.sx(format('update bot.files set expires_at = now() - interval ''23 hours'' where ticket_hash = %L',
                         encode(sha256(convert_to(pg_temp.c('t7'), 'UTF8')), 'hex')));
select pg_temp.as_role('service_role');
select pg_temp.check(public.bot_file_offer(709002, 'BQACAgIAAxkBAAIBc2Zm_test-file_10', 'Другой.docx', 100, null) ->> 'status' = 'ok',
                     'an offer from the other account');
select pg_temp.as_role('postgres');
select pg_temp.check((select count(*) from bot.files)::text = (pg_temp.c('before')::int - 2 + 1)::text,
                     'the next offer deleted the two rows expired more than a day ago, kept the one of 23 hours');
select pg_temp.check(not exists (select 1 from bot.files where ticket_hash in (encode(sha256(convert_to(pg_temp.c('t5'), 'UTF8')), 'hex'),
                                                                             encode(sha256(convert_to(pg_temp.c('t6'), 'UTF8')), 'hex'))),
                     'the day-old rows are gone');
delete from auth.users where id = pg_temp.c('O')::uuid;
select pg_temp.check(not exists (select 1 from bot.files where user_id = pg_temp.c('O')::uuid), 'the rows go with the account');

-- 7. The shape the contract checks: the spec's ten columns, row security on, no policy.
select pg_temp.check((select array_agg(a.attname::text order by a.attname) from pg_attribute a
                       where a.attrelid = 'bot.files'::regclass and a.attnum > 0 and not a.attisdropped)
                     = array['expires_at', 'file_id', 'mime', 'name', 'size', 'ticket_hash', 'token_expires_at', 'token_hash', 'used_at', 'user_id'],
                     'bot.files has the ten columns of spec §6.2');
select pg_temp.check((select relrowsecurity from pg_class where oid = 'bot.files'::regclass), 'row security on bot.files');
select pg_temp.check(not exists (select 1 from pg_policies where schemaname = 'bot' and tablename = 'files'), 'no policy on bot.files');

select 'TELEGRAM BOT FILES CHECKS PASSED' as result;
rollback;
