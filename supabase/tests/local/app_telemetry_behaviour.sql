-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour test of *_app_telemetry.sql on
-- supabase/tests/local/baseline.sql + the hackathon migration + app_telemetry_baseline.sql: log_app_events as anon
-- and as user A (user_id from the token only, never from the event), what is clamped and what is dropped, the
-- 50-element batch, the daily caps (3000 per account, 50000 anonymous), a token of a deleted account, no direct
-- access to app_events or to the analytics schema for clients, and the four views on the fixtures. Everything runs
-- in transactions that roll back; a failure raises, success prints the PASSED notices.
\set ON_ERROR_STOP on

-- 1. Anonymous visitor: valid events are stored without an account, invalid ones are dropped silently.
begin;
set local role anon;
do $t$
declare
  r integer;
  n integer;
  rec record;
  denied boolean;
  long_message text := repeat('м', 700);
  long_stack text := repeat('s', 5000);
  big_props jsonb := jsonb_build_object('blob', repeat('x', 2100));
begin
  r := public.log_app_events(jsonb_build_array(
    jsonb_build_object('kind', 'event', 'name', 'page_view', 'route', '/exams/:id/ticket', 'session', 'sessAnon0001',
                       'device', 'mobile', 'app_version', '20261005.1200', 'props', jsonb_build_object('n', 1),
                       'message', 'events carry no message', 'stack', 'nor a stack',
                       'user_id', 'aaaaaaaa-0000-0000-0000-000000000001'),
    jsonb_build_object('kind', 'client_error', 'name', 'window_error', 'message', '  ' || long_message || '  ',
                       'stack', long_stack, 'props', big_props, 'route', '/exams/1?q=секрет', 'session', 'bad session!',
                       'device', 'phone', 'app_version', 'v 1'),
    jsonb_build_object('kind', 'server_error', 'name', 'unhandled', 'route', '/api/exams/{exam_id}/map',
                       'props', jsonb_build_object('error_id', 'abc123def456'), 'message', 'KeyError'),
    jsonb_build_object('kind', 'event', 'name', 'Page View'),
    jsonb_build_object('kind', 'metric', 'name', 'page_view'),
    jsonb_build_object('kind', 'event'),
    jsonb_build_object('kind', 'event', 'name', 123),
    jsonb_build_object('kind', 'event', 'name', 'props_not_object', 'props', jsonb_build_array(1, 2)),
    to_jsonb('not an object'::text),
    'null'::jsonb));
  if r <> 4 then raise exception 'anon stored % (4 expected)', r; end if;

  denied := false;
  begin perform 1 from public.app_events;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'anon reads app_events'; end if;
  denied := false;
  begin insert into public.app_events (kind, name) values ('event', 'direct');
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'anon inserts into app_events'; end if;
  denied := false;
  begin perform 1 from analytics.events_daily;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'anon reads analytics.events_daily'; end if;

  -- Not an array, empty, null: nothing, no error.
  if public.log_app_events('{"kind": "event", "name": "x"}'::jsonb) <> 0 then raise exception 'object accepted'; end if;
  if public.log_app_events('[]'::jsonb) <> 0 then raise exception 'empty array'; end if;
  if public.log_app_events(null) <> 0 then raise exception 'null'; end if;

  -- Only the first 50 elements are looked at.
  r := public.log_app_events((select jsonb_agg(jsonb_build_object('kind', 'event', 'name', 'bulk', 'props',
                                                                   jsonb_build_object('i', i)))
                                from generate_series(1, 60) i));
  if r <> 50 then raise exception 'batch of 60 stored % (50 expected)', r; end if;
end
$t$;
reset role;
do $t$
declare
  rec record;
  n integer;
begin
  select * into rec from public.app_events where name = 'page_view';
  if rec.user_id is not null or rec.route <> '/exams/:id/ticket' or rec.session <> 'sessAnon0001' or rec.device <> 'mobile'
     or rec.app_version <> '20261005.1200' or rec.props <> '{"n": 1}'::jsonb or rec.message is not null or rec.stack is not null
     or rec.created_at <> now() then
    raise exception 'anon page_view stored as %', row_to_json(rec);
  end if;
  select * into rec from public.app_events where name = 'window_error';
  if rec.user_id is not null or char_length(rec.message) <> 500 or rec.message !~ '^м+$' or char_length(rec.stack) <> 4000
     or rec.props <> '{}'::jsonb or rec.route is not null or rec.session is not null or rec.device is not null
     or rec.app_version is not null then
    raise exception 'clamped error stored as % / % / %', char_length(rec.message), char_length(rec.stack), rec.props;
  end if;
  select * into rec from public.app_events where name = 'unhandled';
  if rec.kind <> 'server_error' or rec.route <> '/api/exams/{exam_id}/map' or rec.props ->> 'error_id' <> 'abc123def456'
     or rec.message <> 'KeyError' then
    raise exception 'server error stored as %', row_to_json(rec);
  end if;
  select * into rec from public.app_events where name = 'props_not_object';
  if rec.props <> '{}'::jsonb then raise exception 'props array kept: %', rec.props; end if;
  select count(*) into n from public.app_events where name = 'bulk';
  if n <> 50 or exists (select 1 from public.app_events where name = 'bulk' and (props ->> 'i')::int > 50) then
    raise exception 'bulk kept % rows or the wrong ones', n;
  end if;
  raise notice 'ANON TELEMETRY CHECKS PASSED';
end
$t$;
rollback;

-- 2. Signed-in user A: the account comes from the token, never from the event; no direct reads either.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare
  r integer;
  denied boolean;
begin
  r := public.log_app_events(jsonb_build_array(
    jsonb_build_object('kind', 'event', 'name', 'lecture_ready', 'user_id', 'bbbbbbbb-0000-0000-0000-000000000002',
                       'session', 'sessA0000001', 'props', jsonb_build_object('partial', false)),
    jsonb_build_object('kind', 'client_error', 'name', 'api_failure', 'message', '503 /api/oral/check',
                       'session', 'sessA0000001', 'props', jsonb_build_object('status', 503, 'api', '/api/oral/check'))));
  if r <> 2 then raise exception 'A stored %', r; end if;
  denied := false;
  begin perform 1 from public.app_events;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'authenticated reads app_events'; end if;
  denied := false;
  begin update public.app_events set name = 'x';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'authenticated updates app_events'; end if;
  denied := false;
  begin perform 1 from analytics.top_errors;
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'authenticated reads analytics.top_errors'; end if;
end
$t$;
reset role;
do $t$
begin
  if (select count(*) from public.app_events where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') <> 2
     or exists (select 1 from public.app_events where user_id is distinct from 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'A''s events stored under another account';
  end if;
  raise notice 'USER TELEMETRY CHECKS PASSED';
end
$t$;
rollback;

-- 3. The caps: 3000 rows a day per account, 50000 anonymous rows a day; yesterday's rows do not count.
begin;
insert into public.app_events (kind, name, user_id, created_at)
select 'event', 'filler', 'aaaaaaaa-0000-0000-0000-000000000001', now() from generate_series(1, 2990);
insert into public.app_events (kind, name, user_id, created_at)
select 'event', 'old', 'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '25 hours' from generate_series(1, 500);
insert into public.app_events (kind, name, user_id, created_at)
select 'event', 'filler', null, now() from generate_series(1, 49995);
insert into public.app_events (kind, name, user_id, created_at)
select 'event', 'old', null, now() - interval '25 hours' from generate_series(1, 500);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare
  r integer;
  batch jsonb := (select jsonb_agg(jsonb_build_object('kind', 'event', 'name', 'capped', 'props', jsonb_build_object('i', i)))
                    from generate_series(1, 20) i);
begin
  r := public.log_app_events(batch);
  if r <> 10 then raise exception 'A near the cap stored % (10 expected)', r; end if;
  r := public.log_app_events(batch);
  if r <> 0 then raise exception 'A at the cap stored %', r; end if;
end
$t$;
-- B is not near the cap: an account's cap is its own.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
begin
  if public.log_app_events('[{"kind": "event", "name": "capped"}]'::jsonb) <> 1 then raise exception 'B capped by A'; end if;
end
$t$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare
  r integer;
  batch jsonb := (select jsonb_agg(jsonb_build_object('kind', 'event', 'name', 'capped_anon')) from generate_series(1, 10));
begin
  r := public.log_app_events(batch);
  if r <> 5 then raise exception 'anon near the cap stored % (5 expected)', r; end if;
  r := public.log_app_events(batch);
  if r <> 0 then raise exception 'anon at the cap stored %', r; end if;
end
$t$;
reset role;
do $t$
begin
  if (select count(*) from public.app_events where name = 'capped' and user_id = 'aaaaaaaa-0000-0000-0000-000000000001') <> 10
     or (select array_agg((props ->> 'i')::int order by (props ->> 'i')::int) from public.app_events
          where name = 'capped' and user_id = 'aaaaaaaa-0000-0000-0000-000000000001') <> array[1,2,3,4,5,6,7,8,9,10] then
    raise exception 'the cap kept the wrong events';
  end if;
  raise notice 'CAP TELEMETRY CHECKS PASSED';
end
$t$;
rollback;

-- 4. A valid token of an account deleted since: the events are kept without an account (no foreign-key error).
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
begin
  if public.log_app_events('[{"kind": "event", "name": "page_view"}]'::jsonb) <> 1 then raise exception 'deleted account'; end if;
end
$t$;
reset role;
do $t$
begin
  if (select user_id from public.app_events where name = 'page_view') is not null then raise exception 'ghost user_id kept'; end if;
  raise notice 'DELETED ACCOUNT CHECK PASSED';
end
$t$;
rollback;

-- 5. The views on the fixtures (app_telemetry_baseline.sql) plus a few events of today.
begin;
insert into public.app_events (kind, name, session, user_id) values
  ('event', 'page_view', 's1', null), ('event', 'page_view', 's1', null), ('event', 'page_view', 's2', null),
  ('event', 'try_opened', 's2', null), ('event', 'page_view', 's3', 'bbbbbbbb-0000-0000-0000-000000000002');
insert into public.app_events (kind, name, message, session, route, props, stack) values
  ('client_error', 'window_error', 'TypeError: a is undefined', 's1', '/dashboard', '{}', 'first'),
  ('client_error', 'window_error', 'TypeError: a is undefined', 's2', '/review', '{}', 'second'),
  ('server_error', 'unhandled', 'KeyError', null, '/api/oral/check', '{"error_id": "0123456789ab"}', 'main.py:1 in f');
do $t$
declare
  rec record;
  today date := (now() at time zone 'Europe/Moscow')::date;
begin
  if (select count(*) from analytics.daily_funnel) <> 90 then raise exception 'funnel days'; end if;
  select * into rec from analytics.daily_funnel where day = today;
  if rec.visits <> 3 or rec.try_opened <> 1 then raise exception 'funnel today: %', row_to_json(rec); end if;
  select * into rec from analytics.daily_funnel where day = today - 8;
  if rec.signups <> 1 then raise exception 'funnel A sign-up day: %', row_to_json(rec); end if;
  select * into rec from analytics.daily_funnel where day = today - 7;
  if rec.first_lecture <> 1 or rec.first_exam <> 1 or rec.first_ticket <> 1 then
    raise exception 'funnel A first steps: %', row_to_json(rec);
  end if;
  select * into rec from analytics.daily_funnel where day = today - 1;
  if rec.signups <> 1 or rec.first_lecture <> 0 then raise exception 'funnel B: %', row_to_json(rec); end if;

  select * into rec from analytics.retention where signup_day = today - 8;
  if rec.signups <> 1 or rec.day1_active <> 1 or rec.day2_active <> 0 or rec.day7_active <> 1
     or rec.day1_pct <> 100.0 or rec.day2_pct <> 0.0 or rec.day7_pct <> 100.0 then
    raise exception 'retention A: %', row_to_json(rec);
  end if;
  select * into rec from analytics.retention where signup_day = today - 1;
  if rec.signups <> 1 or rec.day1_active <> 1 or rec.day1_pct <> 100.0 or rec.day2_pct is not null or rec.day7_pct is not null then
    raise exception 'retention B: %', row_to_json(rec);
  end if;

  select * into rec from analytics.top_errors where kind = 'client_error' and name = 'window_error';
  if rec.events <> 2 or rec.sessions <> 2 or rec.last_route <> '/review' or rec.sample_stack <> 'second' then
    raise exception 'top errors: %', row_to_json(rec);
  end if;
  select * into rec from analytics.top_errors where kind = 'server_error';
  if rec.last_error_id <> '0123456789ab' or rec.message <> 'KeyError' then raise exception 'server error row: %', row_to_json(rec); end if;

  select * into rec from analytics.events_daily where day = today and kind = 'event' and name = 'page_view';
  if rec.events <> 4 or rec.sessions <> 3 or rec.users <> 1 then raise exception 'events daily: %', row_to_json(rec); end if;
  raise notice 'ANALYTICS VIEW CHECKS PASSED';
end
$t$;
rollback;
