-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of the site's outage monitor
-- (supabase/migrations/20261012100000_telegram_bot_monitor.sql) on a scratch database: the base and the exam
-- container's migrations, T1's three files and the bot's later packages, then this one
-- (supabase/tests/local/telegram_bot_run.sh, stage MON; the same script runs two claims of one slot at once).
-- Covered: the gates (anon and authenticated get 42501, and the service-role gate holds without the grants); off while
-- bot.config.monitor_chat_id is null (every function answers off and changes nothing); the switch's and the site's
-- checks; bot_monitor_state (the chat, the site, the tick's mode, the slots, the state); bot_monitor_claim (a slot is
-- taken once and only forward, at most an hour ahead; the state starts over after a day without a run); bot_monitor_save
-- (merged per check; codes and ISO times only, anything else 22023); one row; row security on, no policy, no client
-- privilege; bot_status shows nothing of the monitor.
-- One transaction, rolled back. A failure raises (FAILED: …); success prints TELEGRAM BOT MONITOR CHECKS PASSED. Roles as
-- PostgREST sets them (T1's telegram_bot_behaviour.sql): anon, authenticated (request.jwt.claim.sub), service_role
-- (request.jwt.claims); postgres for fixtures.
\set ON_ERROR_STOP 1
begin;

-- Helpers (as in T1's behaviour test and the Mini App's test).
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
grant execute on function pg_temp.expect_error(text, text[], text), pg_temp.as_role(text, uuid), pg_temp.check(boolean, text),
  pg_temp.sq(text), pg_temp.sx(text) to anon, authenticated, service_role;

-- A state of one check as monitor.ts saves it.
create or replace function pg_temp.st(p_fails int, p_since text, p_code text) returns jsonb language sql immutable as $fn$
  select jsonb_build_object('fails', p_fails, 'since', p_since, 'alerted', null, 'ok', null, 'code', p_code)
$fn$;
grant execute on function pg_temp.st(int, text, text) to anon, authenticated, service_role;

select pg_temp.as_role('postgres');
select pg_temp.sx($$update bot.config set monitor_chat_id = null, monitor_site = null where id = 1$$);
select pg_temp.sx($$update bot.monitor set checks = '{}', health_slot = null, deep_slot = null where id = 1$$);

-- 1. The gates. Clients run none of the three: anon and authenticated get 42501 (no EXECUTE after the grants, and the
--    service-role gate inside).
select pg_temp.as_role('anon');
select pg_temp.expect_error($$select public.bot_monitor_state()$$, array['42501'], 'anon: state');
select pg_temp.expect_error($$select public.bot_monitor_claim(now(), now())$$, array['42501'], 'anon: claim');
select pg_temp.expect_error($$select public.bot_monitor_save('{}')$$, array['42501'], 'anon: save');
select pg_temp.as_role('authenticated', 'f9200000-0000-4000-8000-000000000001');
select pg_temp.expect_error($$select public.bot_monitor_state()$$, array['42501'], 'authenticated: state');
select pg_temp.expect_error($$select public.bot_monitor_claim(now(), now())$$, array['42501'], 'authenticated: claim');
select pg_temp.expect_error($$select public.bot_monitor_save('{}')$$, array['42501'], 'authenticated: save');
select pg_temp.expect_error($$select count(*) from bot.monitor$$, array['42501'], 'authenticated: read bot.monitor');
-- The gate itself, with EXECUTE given back for a moment (the service-role check does not rely on the grants).
select pg_temp.as_role('postgres');
grant execute on function public.bot_monitor_state(timestamptz), public.bot_monitor_claim(timestamptz, timestamptz, timestamptz),
  public.bot_monitor_save(jsonb) to authenticated;
select pg_temp.as_role('authenticated', 'f9200000-0000-4000-8000-000000000001');
select pg_temp.expect_error($$select public.bot_monitor_state()$$, array['42501'], 'the gate: state');
select pg_temp.expect_error($$select public.bot_monitor_claim(now(), now())$$, array['42501'], 'the gate: claim');
select pg_temp.expect_error($$select public.bot_monitor_save('{}')$$, array['42501'], 'the gate: save');
select pg_temp.as_role('postgres');
revoke execute on function public.bot_monitor_state(timestamptz), public.bot_monitor_claim(timestamptz, timestamptz, timestamptz),
  public.bot_monitor_save(jsonb) from authenticated;

-- 2. Off while no chat is set: every function answers off and changes nothing.
select pg_temp.as_role('service_role');
do $t$
begin
  perform pg_temp.check(public.bot_monitor_state() = '{"status": "off"}'::jsonb, 'off: state');
  perform pg_temp.check(public.bot_monitor_claim('2026-10-12 02:50+00', '2026-10-12 02:30+00', '2026-10-12 02:50:05+00')
                        = '{"status": "off"}'::jsonb, 'off: claim');
  perform pg_temp.check(public.bot_monitor_save(jsonb_build_object('health', pg_temp.st(1, '2026-10-12T02:50:05.000Z', '503')))
                        = '{"status": "off"}'::jsonb, 'off: save');
end
$t$;
select pg_temp.as_role('postgres');
select pg_temp.check(pg_temp.sq($$select (checks = '{}' and health_slot is null and deep_slot is null)::text from bot.monitor$$) = 'true',
                     'off: nothing claimed or saved');

-- 3. The switch and the site: their checks.
select pg_temp.expect_error($$select pg_temp.sx('update bot.config set monitor_chat_id = 0 where id = 1')$$, array['23514'], 'chat 0');
select pg_temp.sx($$update bot.config set monitor_site = 'https://ludosiel-studyforge.hf.space' where id = 1$$);
select pg_temp.sx($$update bot.config set monitor_site = 'https://meldy-status.example.org:8443' where id = 1$$);
select pg_temp.expect_error(format('select pg_temp.sx(%L)', format('update bot.config set monitor_site = %L where id = 1', s)),
                            array['23514'], 'site ' || s)
  from unnest(array['http://meldy.example.org', 'https://user:pass@meldy.example.org', 'https://meldy.example.org/api',
                    'https://meldy.example.org/', 'https://meldy.example.org?token=1', 'https://localhost', 'https://Meldy.example.org',
                    'https://meldy.example.org:8443/x', '']) s;
select pg_temp.sx($$update bot.config set monitor_site = null, monitor_chat_id = 700777 where id = 1$$);

-- 4. On: bot_monitor_state.
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_monitor_state('2026-10-12 02:50:05+00');
  perform pg_temp.check(r = '{"status": "on", "chat_id": 700777, "site": null, "tick_mode": "every_minute", "health_slot": null,
                              "deep_slot": null, "checks": {}}'::jsonb, 'on: state ' || r::text);
end
$t$;
select pg_temp.as_role('postgres');
select pg_temp.sx($$update bot.config set flags = flags || '{"tick": "when_due"}', monitor_site = 'https://meldy-status.example.org' where id = 1$$);
select pg_temp.as_role('service_role');
select pg_temp.check(public.bot_monitor_state() ->> 'tick_mode' = 'when_due', 'saving mode: tick_mode when_due');
select pg_temp.check(public.bot_monitor_state() ->> 'site' = 'https://meldy-status.example.org', 'the configured site');
select pg_temp.as_role('postgres');
select pg_temp.sx($$update bot.config set flags = flags - 'tick', monitor_site = null where id = 1$$);

-- 5. bot_monitor_claim: a slot is taken once, only forward, at most an hour ahead.
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_monitor_claim('2026-10-12 02:50+00', '2026-10-12 02:30+00', '2026-10-12 02:50:05+00');
  perform pg_temp.check(r = '{"status": "ok", "health": true, "deep": true, "checks": {}}'::jsonb, 'claim: both ' || r::text);
  r := public.bot_monitor_claim('2026-10-12 02:50+00', '2026-10-12 02:30+00', '2026-10-12 02:51:05+00');
  perform pg_temp.check(r ->> 'health' = 'false' and r ->> 'deep' = 'false', 'claim: the same slots again ' || r::text);
  r := public.bot_monitor_claim('2026-10-12 02:55+00', null, '2026-10-12 02:55:05+00');
  perform pg_temp.check(r ->> 'health' = 'true' and r ->> 'deep' = 'false', 'claim: the next five minutes ' || r::text);
  r := public.bot_monitor_claim('2026-10-12 02:45+00', '2026-10-12 02:00+00', '2026-10-12 02:56:05+00');
  perform pg_temp.check(r ->> 'health' = 'false' and r ->> 'deep' = 'false', 'claim: older slots ' || r::text);
  r := public.bot_monitor_claim('2026-10-12 05:00+00', '2026-10-12 05:00+00', '2026-10-12 02:57:05+00');
  perform pg_temp.check(r ->> 'health' = 'false' and r ->> 'deep' = 'false', 'claim: two hours ahead ' || r::text);
  r := public.bot_monitor_claim(null, null, '2026-10-12 02:58:05+00');
  perform pg_temp.check(r ->> 'health' = 'false' and r ->> 'deep' = 'false', 'claim: nothing asked');
  r := public.bot_monitor_state('2026-10-12 02:58:05+00');
  perform pg_temp.check((r ->> 'health_slot')::timestamptz = '2026-10-12 02:55+00'
                        and (r ->> 'deep_slot')::timestamptz = '2026-10-12 02:30+00', 'the slots claimed last ' || r::text);
end
$t$;

-- 6. bot_monitor_save: merged per check; codes and ISO times only.
do $t$
declare r jsonb;
begin
  r := public.bot_monitor_save(jsonb_build_object('health', pg_temp.st(1, '2026-10-12T02:50:05.000Z', '503'),
                                                  'tts', pg_temp.st(2, '2026-10-12T02:51:00.000Z', 'network')));
  perform pg_temp.check(r = '{"status": "ok"}'::jsonb, 'save ' || r::text);
  r := public.bot_monitor_save(jsonb_build_object('try', jsonb_build_object('fails', 0, 'since', null, 'alerted', null,
                                                                            'ok', '2026-10-12T02:55:05.000Z', 'code', null),
                                                  'tts', jsonb_build_object('fails', 3, 'since', '2026-10-12T02:51:00.000Z',
                                                                            'alerted', '2026-10-12T03:30:05Z', 'ok', null,
                                                                            'code', 'network')));
  r := public.bot_monitor_state();
  perform pg_temp.check(r -> 'checks' -> 'health' = pg_temp.st(1, '2026-10-12T02:50:05.000Z', '503'), 'health kept ' || r::text);
  perform pg_temp.check(r -> 'checks' -> 'tts' ->> 'fails' = '3' and r -> 'checks' -> 'tts' ->> 'alerted' = '2026-10-12T03:30:05Z',
                        'tts replaced ' || r::text);
  perform pg_temp.check(r -> 'checks' -> 'try' ->> 'ok' = '2026-10-12T02:55:05.000Z', 'try added ' || r::text);
  -- The claim answers the state as it is.
  r := public.bot_monitor_claim('2026-10-12 03:00+00', '2026-10-12 03:00+00', '2026-10-12 03:00:05+00');
  perform pg_temp.check(r ->> 'health' = 'true' and r ->> 'deep' = 'true' and r -> 'checks' -> 'tts' ->> 'fails' = '3',
                        'claim with the state ' || r::text);
end
$t$;
select pg_temp.expect_error(format('select public.bot_monitor_save(%L::jsonb)', v), array['22023'], 'save ' || v)
  from unnest(array[
    'null', '[]', '"health"', '{"health": []}', '{"health": 1}', '{"Health": {"fails": 1}}', '{"a-b": {"fails": 1}}',
    '{"abcdefghijklmnopq": {"fails": 1}}',
    '{"health": {"fails": 1, "detail": "Rate limit reached for model in organization org_01abc"}}',
    '{"health": {"since": null}}', '{"health": {"fails": -1}}', '{"health": {"fails": 1.5}}', '{"health": {"fails": "2"}}',
    '{"health": {"fails": 1234567}}', '{"health": {"fails": 1, "since": "yesterday"}}',
    '{"health": {"fails": 1, "since": "2026-10-12 02:50:05"}}', '{"health": {"fails": 1, "ok": 1760237405}}',
    '{"health": {"fails": 1, "code": "Service Unavailable: upstream connect error"}}', '{"health": {"fails": 1, "code": "HTTP_503"}}',
    '{"health": {"fails": 1, "code": ""}}'
  ]) v;
select pg_temp.expect_error(format('select public.bot_monitor_save(%L::jsonb)',
                                   jsonb_build_object('health', jsonb_build_object('fails', 1, 'code', 'x'),
                                                      'pad', jsonb_build_object('fails', 1, 'code', repeat('a', 32)))
                                   || (select jsonb_object_agg('c' || i, jsonb_build_object('fails', 1, 'code', repeat('b', 32)))
                                         from generate_series(1, 80) i)),
                            array['22023'], 'save: more than 4 KB');
select pg_temp.expect_error($$select public.bot_monitor_save(null)$$, array['22023'], 'save: null');
select pg_temp.as_role('postgres');
select pg_temp.check(pg_temp.sq($$select (checks -> 'health' ->> 'code') from bot.monitor$$) = '503',
                     'the refused saves changed nothing');

-- 7. After a day without a run the state starts over; after two hours it is kept.
select pg_temp.as_role('service_role');
do $t$
declare r jsonb;
begin
  r := public.bot_monitor_claim('2026-10-12 05:00+00', '2026-10-12 05:00+00', '2026-10-12 05:00:05+00');
  perform pg_temp.check(r ->> 'health' = 'true' and r -> 'checks' ? 'tts', 'two hours later: the state kept ' || r::text);
  r := public.bot_monitor_claim('2026-10-14 05:00+00', null, '2026-10-14 05:00:05+00');
  perform pg_temp.check(r = '{"status": "ok", "health": true, "deep": false, "checks": {}}'::jsonb, 'two days later: a fresh state ' || r::text);
  r := public.bot_monitor_state('2026-10-14 05:00:05+00');
  perform pg_temp.check((r ->> 'deep_slot')::timestamptz = '2026-10-12 05:00+00' and r -> 'checks' = '{}'::jsonb, 'after the start over ' || r::text);
end
$t$;

-- 8. Off again: the state stays, nothing is claimed or saved.
select pg_temp.as_role('postgres');
select pg_temp.sx($$update bot.config set monitor_chat_id = null where id = 1$$);
select pg_temp.as_role('service_role');
select pg_temp.check(public.bot_monitor_claim('2026-10-14 05:05+00', null, '2026-10-14 05:05:05+00') = '{"status": "off"}'::jsonb, 'off again: claim');
select pg_temp.as_role('postgres');
select pg_temp.check(pg_temp.sq($$select health_slot::text from bot.monitor$$) = pg_temp.sq($$select '2026-10-14 05:00+00'::timestamptz::text$$),
                     'off again: the slot not moved');

-- 9. The shape the contract checks: one row, the columns, row security on, no policy, no client privilege; the three
--    functions SECURITY DEFINER with an empty search_path for the service role only, the state's read STABLE; the
--    switch's two columns nullable; bot_status shows nothing of the monitor.
select pg_temp.expect_error($$select pg_temp.sx('insert into bot.monitor (id) values (2)')$$, array['23514'], 'a second row');
select pg_temp.check(pg_temp.sq('select count(*) from bot.monitor') = '1', 'one row');
select pg_temp.check((select array_agg(a.attname::text order by a.attname) from pg_attribute a
                       where a.attrelid = 'bot.monitor'::regclass and a.attnum > 0 and not a.attisdropped)
                     = array['checks', 'deep_slot', 'health_slot', 'id', 'updated_at'], 'bot.monitor has five columns');
select pg_temp.check((select relrowsecurity from pg_class where oid = 'bot.monitor'::regclass), 'row security on bot.monitor');
select pg_temp.check(not exists (select 1 from pg_policies where schemaname = 'bot' and tablename = 'monitor'), 'no policy');
select pg_temp.check(not has_table_privilege('anon', 'bot.monitor', 'SELECT') and not has_table_privilege('authenticated', 'bot.monitor', 'SELECT'),
                     'no client privilege on the table');
select pg_temp.check((select count(*) = 3 and bool_and(p.prosecdef and array_to_string(p.proconfig, ',') in ('search_path=""', 'search_path=')
                                      and not has_function_privilege('anon', p.oid, 'EXECUTE')
                                      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                      and has_function_privilege('service_role', p.oid, 'EXECUTE'))
                        from pg_proc p where p.proname like 'bot\_monitor\_%' and p.pronamespace = 'public'::regnamespace),
                     'bot_monitor_*: three, SECURITY DEFINER, empty search_path, the service role only');
select pg_temp.check((select string_agg(p.proname::text || '=' || p.provolatile::text, ' ' order by p.proname) from pg_proc p
                       where p.proname like 'bot\_monitor\_%' and p.pronamespace = 'public'::regnamespace)
                     = 'bot_monitor_claim=v bot_monitor_save=v bot_monitor_state=s', 'the state reads only');
select pg_temp.check((select string_agg(a.attname::text || ':' || format_type(a.atttypid, a.atttypmod) || ':' || (not a.attnotnull)::text, ' ' order by a.attname)
                        from pg_attribute a where a.attrelid = 'bot.config'::regclass and a.attname like 'monitor\_%' and not a.attisdropped)
                     = 'monitor_chat_id:bigint:true monitor_site:text:true', 'the switch: two nullable columns of bot.config');
select pg_temp.sx($$update bot.config set monitor_chat_id = 700777, monitor_site = 'https://meldy-status.example.org' where id = 1$$);
select pg_temp.as_role('service_role');
select pg_temp.check(public.bot_status()::text !~ 'monitor|700777|meldy-status', 'bot_status shows nothing of the monitor');

select 'TELEGRAM BOT MONITOR CHECKS PASSED' as result;
rollback;
