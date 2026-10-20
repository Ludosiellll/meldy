-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261020120000_quiz_protection.sql
-- («Защита от списывания») on the scratch database of quiz_protection_run.sh. One transaction, rolled back. A = author
-- aaaa…1, B = bbbb…2 (not the author), C = cccc…3 and D = dddd…4 (signed-in takers); guests are anon with tokens tok(n).
-- now() is one moment inside the transaction: «ten minutes ago» is made by moving finished_at back as postgres.
-- Covers: the settings (defaults off / 3, refusals, QuizRow and the preview carry them, locked after the start, free
-- before it); the attempt (taker_name, protection, limit, guard_count); events: a new id counts once, the same id again
-- keeps the stronger kind and takes the duration, a resend changes nothing, copy / paste / reload are not counted,
-- every refusal of a batch (22023 events), 50 a call, the 500 rows of an attempt, the time clamped to start..now;
-- another person's attempt and a wrong token answer 404 (PGRST with P0002 inside), a malformed token 22023 token;
-- quiz_start giving back an unfinished attempt records «reload» (server, not counted; none without protection or past
-- the cap); the strict limit ends the attempt (finish_reason 'protection') in the call that reaches it, quiz_answer then
-- refuses (MC012 finished) and the result carries guard; an attempt over the limit that nobody finished is ended by
-- quiz_settle when its answers arrive (the server's own check); the normal level never ends an attempt; a quiz without
-- protection takes nothing; a late resend (finished more than ten minutes ago) takes nothing; the guest path; the
-- author's quiz_results (guard_count, guard_events, flagged) and quiz_attempt_events (the timeline; anyone else → 404);
-- a reset takes the events with the attempt; the 404 of quiz_create, quiz_update, quiz_start, quiz_results.
-- A failure raises; success prints QUIZ PROTECTION BEHAVIOUR PASSED.
\set ON_ERROR_STOP 1
begin;
-- p_state P0002 also matches the PostgREST form (raise sqlstate 'PGRST' with the error as JSON and HTTP 404).
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_what text, p_detail text default null)
returns void language plpgsql as $fn$
declare v_detail text; v_state text; v_msg jsonb;
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_state;
exception
  when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    v_state := sqlstate;
    if sqlstate = 'PGRST' then
      v_msg := sqlerrm::jsonb;
      if (v_detail::jsonb ->> 'status') is distinct from '404' then
        raise exception 'FAILED: % — PGRST without 404: %', p_what, v_detail;
      end if;
      v_state := v_msg ->> 'code';
      v_detail := v_msg ->> 'details';
    end if;
    if v_state is distinct from p_state then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, v_state, sqlerrm, p_state;
    end if;
    if p_detail is not null and v_detail is distinct from p_detail then
      raise exception 'FAILED: % — detail %, expected %', p_what, v_detail, p_detail;
    end if;
end;
$fn$;
-- The 404 form only (never a bare P0002, which PostgREST answers with HTTP 500).
create or replace function pg_temp.expect_404(p_sql text, p_what text, p_detail text)
returns void language plpgsql as $fn$
declare v_detail text;
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected 404', p_what;
exception
  when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if sqlstate is distinct from 'PGRST' then
      raise exception 'FAILED: % — SQLSTATE % (%), expected PGRST 404', p_what, sqlstate, sqlerrm;
    end if;
    if (sqlerrm::jsonb ->> 'code') is distinct from 'P0002' or (sqlerrm::jsonb ->> 'details') is distinct from p_detail
       or (v_detail::jsonb ->> 'status') is distinct from '404' or jsonb_typeof(v_detail::jsonb -> 'headers') is distinct from 'object' then
      raise exception 'FAILED: % — % / %', p_what, sqlerrm, v_detail;
    end if;
end;
$fn$;
create temp table ctx (k text primary key, v text);
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = p_k
$fn$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into pg_temp.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
create or replace function pg_temp.keys(p jsonb) returns text language sql immutable as $fn$
  select string_agg(k, ',' order by k) from jsonb_object_keys(p) k
$fn$;
create or replace function pg_temp.tok(p_n integer) returns text language sql immutable as $fn$
  select 'tok' || lpad(p_n::text, 8, '0') || repeat('P', 32)
$fn$;
-- one event as the client sends it
create or replace function pg_temp.ev(p_id text, p_kind text, p_q integer default null, p_ms integer default null,
                                      p_at text default '2026-10-20T10:00:00.000Z')
returns jsonb language sql immutable as $fn$
  select jsonb_build_object('id', p_id, 'kind', p_kind, 'at', p_at, 'q', p_q, 'ms', p_ms)
$fn$;
create or replace function pg_temp.events_of(p_attempt text) returns integer language sql stable security definer as $fn$
  select count(*)::integer from public.quiz_events where attempt_id = p_attempt::uuid
$fn$;
create or replace function pg_temp.kind_of(p_attempt text, p_cid text) returns text language sql stable security definer as $fn$
  select kind || ':' || coalesce(ms::text, '-') from public.quiz_events where attempt_id = p_attempt::uuid and cid = p_cid
$fn$;
grant all on ctx to authenticated, anon;
grant execute on function pg_temp.expect_error(text, text, text, text), pg_temp.expect_404(text, text, text), pg_temp.c(text),
  pg_temp.put(text, text), pg_temp.keys(jsonb), pg_temp.tok(integer), pg_temp.ev(text, text, integer, integer, text),
  pg_temp.events_of(text), pg_temp.kind_of(text, text)
  to authenticated, anon;

-- 1. A: an exam of three keyed questions; quizzes S (strict, limit 2, guests), N (normal), O (off), G (strict, limit
--    1, guests), F (strict, nobody started). The defaults, the refusals, QuizRow, the 404 of create / update.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; v_x text; v_s uuid; v_bad record;
begin
  r := public.container_create('Защита проверка', null, '[{"title":"Вопросы"}]');
  v_x := r ->> 'container_id';
  v_s := (r -> 'subjects' -> 0 ->> 'id')::uuid;
  perform pg_temp.put('x', v_x);
  perform public.container_items_add(v_s, jsonb_build_array(
    jsonb_build_object('ref', 'p:1', 'stem', 'Один', 'options', jsonb_build_array('а', 'б'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'p:2', 'stem', 'Два', 'options', jsonb_build_array('а', 'б'), 'correct', jsonb_build_array(1)),
    jsonb_build_object('ref', 'p:3', 'stem', 'Столица', 'answers', jsonb_build_array('Париж'))));
  insert into pg_temp.ctx select 'item:' || i.import_ref, i.id::text from public.test_items i where i.container_id = v_x::uuid;
  -- the defaults
  r := public.quiz_create(v_x::uuid, '{"title": "Без защиты", "attempts": null}');
  if r ->> 'protection' is distinct from 'off' or (r ->> 'protection_limit')::int is distinct from 3 then
    raise exception 'FAILED: the defaults %', r;
  end if;
  perform pg_temp.put('qo', r ->> 'id');
  perform pg_temp.put('code_o', r ->> 'code');
  r := public.quiz_create(v_x::uuid, '{"title": "Строгая", "protection": "strict", "protection_limit": 2, "attempts": null}');
  if r ->> 'protection' is distinct from 'strict' or (r ->> 'protection_limit')::int is distinct from 2
     or position('protection_limit' in pg_temp.keys(r)) = 0 then
    raise exception 'FAILED: strict %', r;
  end if;
  perform pg_temp.put('qs', r ->> 'id');
  perform pg_temp.put('code_s', r ->> 'code');
  r := public.quiz_create(v_x::uuid, '{"title": "Обычная", "protection": "normal", "attempts": null}');
  perform pg_temp.put('qn', r ->> 'id');
  perform pg_temp.put('code_n', r ->> 'code');
  r := public.quiz_create(v_x::uuid, '{"title": "Строгая на один раз", "protection": "strict", "protection_limit": 1, "attempts": null}');
  perform pg_temp.put('qg', r ->> 'id');
  perform pg_temp.put('code_g', r ->> 'code');
  r := public.quiz_create(v_x::uuid, '{"title": "Ещё никто", "protection": "strict"}');
  perform pg_temp.put('qf', r ->> 'id');
  -- refusals: the level and the limit
  for v_bad in select * from (values
      ('{"protection": "max"}'::jsonb, 'protection'), ('{"protection": null}', 'protection'), ('{"protection": 1}', 'protection'),
      ('{"protection_limit": 0}', 'protection_limit'), ('{"protection_limit": 21}', 'protection_limit'),
      ('{"protection_limit": "3"}', 'protection_limit'), ('{"protection_limit": null}', 'protection_limit'),
      ('{"protection_limit": 2.5}', 'protection_limit')) b(s, detail) loop
    perform pg_temp.expect_error(format('select public.quiz_create(%L, %L)', v_x, v_bad.s), '22023', 'create ' || v_bad.s::text, v_bad.detail);
    perform pg_temp.expect_error(format('select public.quiz_update(%L, %L)', pg_temp.c('qf'), v_bad.s), '22023', 'update ' || v_bad.s::text, v_bad.detail);
  end loop;
  -- nobody started F: the level and the limit change freely
  r := public.quiz_update(pg_temp.c('qf')::uuid, '{"protection": "normal", "protection_limit": 5}');
  if r ->> 'protection' is distinct from 'normal' or (r ->> 'protection_limit')::int is distinct from 5 then
    raise exception 'FAILED: an update before the start %', r;
  end if;
  -- 404, never a bare P0002
  perform pg_temp.expect_404(format('select public.quiz_create(%L, %L)', '99999999-0000-4000-8000-000000000009', '{}'), 'create in a missing exam', 'container');
  perform pg_temp.expect_404(format('select public.quiz_update(%L, %L)', '99999999-0000-4000-8000-000000000009', '{}'), 'update a missing quiz', 'quiz');
  perform pg_temp.expect_404(format('select public.quiz_results(%L)', '99999999-0000-4000-8000-000000000009'), 'results of a missing quiz', 'quiz');
end
$t$;

-- 2. B is not the author: 404 on A's quizzes.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
begin
  perform pg_temp.expect_404(format('select public.quiz_update(%L, %L)', pg_temp.c('qs'), '{"protection": "off"}'), 'a stranger updates', 'quiz');
  perform pg_temp.expect_404(format('select public.quiz_results(%L)', pg_temp.c('qs')), 'a stranger reads results', 'quiz');
  perform pg_temp.expect_404(format('select public.quiz_create(%L, %L)', pg_temp.c('x'), '{}'), 'a stranger creates', 'container');
end
$t$;

-- 3. C starts S: the preview and the attempt carry the rules; events count once per id, the kind gets stronger, a
--    resend changes nothing, copy and paste are recorded only, every refusal of a batch.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb; v_att text; v_bad record; v_many jsonb;
begin
  r := public.quiz_preview(pg_temp.c('code_s'));
  if r ->> 'protection' is distinct from 'strict' or (r ->> 'protection_limit')::int is distinct from 2 then
    raise exception 'FAILED: the preview %', r;
  end if;
  perform pg_temp.expect_404(format('select public.quiz_start(%L, %L)', 'zzzzzzzzzzzz', 'Вера'), 'start an unknown code', 'quiz');
  perform pg_temp.expect_404(format('select public.quiz_start(%L, %L)', 'нет', 'Вера'), 'start a malformed code', 'quiz');
  r := public.quiz_start(pg_temp.c('code_s'), 'Вера Иванова');
  v_att := r ->> 'attempt_id';
  perform pg_temp.put('att_s', v_att);
  if r ->> 'taker_name' is distinct from 'Вера Иванова' or r ->> 'protection' is distinct from 'strict'
     or (r ->> 'protection_limit')::int is distinct from 2 or (r ->> 'guard_count')::int is distinct from 0
     or position('correct' in pg_temp.keys(r)) > 0 then
    raise exception 'FAILED: the attempt %', r;
  end if;
  -- the first time away: blur, then the same id as hidden with its duration (one episode, one count)
  r := public.quiz_events_add(v_att::uuid, jsonb_build_array(pg_temp.ev('e1', 'blur', 1)));
  if (r ->> 'accepted')::int is distinct from 1 or (r ->> 'count')::int is distinct from 1 or (r ->> 'limit')::int is distinct from 2
     or (r ->> 'finished')::boolean then
    raise exception 'FAILED: the first event %', r;
  end if;
  r := public.quiz_events_add(v_att::uuid, jsonb_build_array(pg_temp.ev('e1', 'hidden', 1, 12000)));
  if (r ->> 'count')::int is distinct from 1 or pg_temp.kind_of(v_att, 'e1') is distinct from 'hidden:12000' then
    raise exception 'FAILED: the same episode, hidden % %', r, pg_temp.kind_of(v_att, 'e1');
  end if;
  -- a resend of the first form: hidden stays, the duration stays
  r := public.quiz_events_add(v_att::uuid, jsonb_build_array(pg_temp.ev('e1', 'blur', 1)));
  if (r ->> 'count')::int is distinct from 1 or pg_temp.kind_of(v_att, 'e1') is distinct from 'hidden:12000' then
    raise exception 'FAILED: a resend %', pg_temp.kind_of(v_att, 'e1');
  end if;
  -- copy and paste: recorded, not counted; a copy id never becomes a counted kind
  r := public.quiz_events_add(v_att::uuid, jsonb_build_array(pg_temp.ev('c1', 'copy', 2), pg_temp.ev('p1', 'paste', 3)));
  if (r ->> 'accepted')::int is distinct from 2 or (r ->> 'count')::int is distinct from 1 or pg_temp.events_of(v_att) is distinct from 3 then
    raise exception 'FAILED: copy and paste %', r;
  end if;
  r := public.quiz_events_add(v_att::uuid, jsonb_build_array(pg_temp.ev('c1', 'hidden', 2)));
  if (r ->> 'count')::int is distinct from 1 or pg_temp.kind_of(v_att, 'c1') is distinct from 'copy:-' then
    raise exception 'FAILED: a copy turned into a counted kind %', pg_temp.kind_of(v_att, 'c1');
  end if;
  -- the refusals of a batch: nothing of it is kept
  v_many := (select jsonb_agg(pg_temp.ev('m' || g, 'copy')) from generate_series(1, 51) g);
  for v_bad in select * from (values
      ('[]'::jsonb, 'empty'), ('{}'::jsonb, 'an object'), (v_many, '51 events'),
      (jsonb_build_array(pg_temp.ev('x1', 'gemini')), 'an unknown kind'),
      (jsonb_build_array(pg_temp.ev('x 1', 'blur')), 'a space in the id'),
      (jsonb_build_array(pg_temp.ev(repeat('x', 33), 'blur')), 'a 33-character id'),
      (jsonb_build_array(pg_temp.ev('x1', 'blur', null, null, 'вчера')), 'a time in words'),
      (jsonb_build_array(pg_temp.ev('x1', 'blur', null, null, '2026-13-45T99:00:00Z')), 'an impossible time'),
      (jsonb_build_array(pg_temp.ev('x1', 'blur', 0)), 'question 0'),
      (jsonb_build_array(pg_temp.ev('x1', 'blur', 201)), 'question 201'),
      (jsonb_build_array(pg_temp.ev('x1', 'blur', null, 86400001)), 'a day and a millisecond'),
      (jsonb_build_array(jsonb_build_object('id', 'x1', 'kind', 'blur', 'at', '2026-10-20T10:00:00Z', 'ms', -5)), 'a negative duration'),
      (jsonb_build_array(jsonb_build_object('id', 'x1', 'kind', 'blur', 'at', '2026-10-20T10:00:00Z', 'q', '2')), 'question as text'),
      (jsonb_build_array(jsonb_build_object('id', 'x1', 'kind', 'blur')), 'no time'),
      (jsonb_build_array(pg_temp.ev('x1', 'blur'), '"blur"'::jsonb), 'a string in the batch')) b(events, what) loop
    perform pg_temp.expect_error(format('select public.quiz_events_add(%L, %L)', v_att, v_bad.events), '22023', 'events: ' || v_bad.what, 'events');
  end loop;
  perform pg_temp.expect_error(format('select public.quiz_events_add(%L, null)', v_att), '22023', 'events: null', 'events');
  if pg_temp.events_of(v_att) is distinct from 3 then raise exception 'FAILED: a refused batch kept rows'; end if;
  -- the time is clamped to the attempt's start..now
  r := public.quiz_events_add(v_att::uuid, jsonb_build_array(pg_temp.ev('t1', 'paste', null, null, '2020-01-01T00:00:00Z'),
                                                              pg_temp.ev('t2', 'paste', null, null, '2099-01-01T00:00:00+03:00')));
  if (r ->> 'accepted')::int <> 2 or pg_temp.events_of(v_att) <> 5 then raise exception 'FAILED: the clamped pair %', r; end if;
end
$t$;
reset role;
do $t$
begin
  if (select at from public.quiz_events where attempt_id = pg_temp.c('att_s')::uuid and cid = 't1')
       is distinct from (select started_at from public.quiz_attempts where id = pg_temp.c('att_s')::uuid)
     or (select at from public.quiz_events where attempt_id = pg_temp.c('att_s')::uuid and cid = 't2') is distinct from now()
     or (select source from public.quiz_events where attempt_id = pg_temp.c('att_s')::uuid and cid = 't1') is distinct from 'client' then
    raise exception 'FAILED: the time clamp';
  end if;
  -- the table is closed to the clients
  if has_table_privilege('authenticated', 'public.quiz_events', 'SELECT') or has_table_privilege('anon', 'public.quiz_events', 'INSERT') then
    raise exception 'FAILED: quiz_events is open to a client role';
  end if;
end
$t$;

-- 4. Another person and wrong tokens: 404 attempt; D reading C's attempt; the guest call with a malformed token.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
do $t$
begin
  perform pg_temp.expect_404(format('select public.quiz_events_add(%L, %L)', pg_temp.c('att_s'), jsonb_build_array(pg_temp.ev('d1', 'blur'))),
    'another person''s attempt', 'attempt');
  perform pg_temp.expect_404(format('select public.quiz_events_add(%L, %L)', '99999999-0000-4000-8000-000000000009', jsonb_build_array(pg_temp.ev('d1', 'blur'))),
    'a missing attempt', 'attempt');
  perform pg_temp.expect_404(format('select public.quiz_attempt_events(%L)', pg_temp.c('att_s')), 'a taker reads a timeline', 'attempt');
end
$t$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
begin
  perform pg_temp.expect_error(format('select public.quiz_guest_events_add(%L, %L, %L)', pg_temp.c('att_s'), 'короткий',
    jsonb_build_array(pg_temp.ev('g1', 'blur'))), '22023', 'a malformed token', 'token');
  perform pg_temp.expect_404(format('select public.quiz_guest_events_add(%L, %L, %L)', pg_temp.c('att_s'), pg_temp.tok(9),
    jsonb_build_array(pg_temp.ev('g1', 'blur'))), 'a token that is not the attempt''s', 'attempt');
  perform pg_temp.expect_error(format('select public.quiz_events_add(%L, %L)', pg_temp.c('att_s'), jsonb_build_array(pg_temp.ev('g1', 'blur'))),
    '42501', 'anon runs the signed-in call');
  perform pg_temp.expect_error(format('select public.quiz_attempt_events(%L)', pg_temp.c('att_s')), '42501', 'anon reads a timeline');
end
$t$;
reset role;

-- 5. C opens S again: the server records reload (not counted); the second time away reaches the limit — the attempt
--    ends in that call, answers are refused, the result says so.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb; v_att text := pg_temp.c('att_s');
begin
  r := public.quiz_start(pg_temp.c('code_s'), '');
  if r ->> 'attempt_id' is distinct from v_att or (r ->> 'guard_count')::int is distinct from 1 then
    raise exception 'FAILED: the resume %', r;
  end if;
  if pg_temp.events_of(v_att) is distinct from 6 then raise exception 'FAILED: the reload row (%)', pg_temp.events_of(v_att); end if;
  perform public.quiz_answer(v_att::uuid, jsonb_build_array(jsonb_build_object('item_id', pg_temp.c('item:p:1'), 'chosen', jsonb_build_array(0))));
  r := public.quiz_events_add(v_att::uuid, jsonb_build_array(pg_temp.ev('e2', 'split', 2)));
  if (r ->> 'count')::int is distinct from 2 or not (r ->> 'finished')::boolean or r ->> 'reason' is distinct from 'protection' then
    raise exception 'FAILED: the limit %', r;
  end if;
  -- the late part of the same episode still lands (the attempt finished a moment ago)
  r := public.quiz_events_add(v_att::uuid, jsonb_build_array(pg_temp.ev('e2', 'hidden', 2, 4000)));
  if (r ->> 'count')::int is distinct from 2 or pg_temp.kind_of(v_att, 'e2') is distinct from 'hidden:4000' then
    raise exception 'FAILED: the episode after the end %', r;
  end if;
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', v_att,
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.c('item:p:2'), 'chosen', jsonb_build_array(1)))), 'MC012', 'an answer after the end', 'finished');
  r := public.quiz_result(v_att::uuid);
  if r ->> 'finish_reason' is distinct from 'protection' or (r ->> 'correct')::int is distinct from 1
     or r -> 'guard' is distinct from '{"level": "strict", "count": 2, "limit": 2}'::jsonb then
    raise exception 'FAILED: the result %', r;
  end if;
  -- a new start of S is a new attempt (no reload row on it)
  r := public.quiz_start(pg_temp.c('code_s'), 'Вера Иванова');
  if r ->> 'attempt_id' = v_att or (r ->> 'guard_count')::int is distinct from 0 or pg_temp.events_of(r ->> 'attempt_id') <> 0 then
    raise exception 'FAILED: the next attempt %', r;
  end if;
  perform pg_temp.put('att_s2', r ->> 'attempt_id');
end
$t$;
reset role;
do $t$
begin
  if (select kind || ':' || source from public.quiz_events
       where attempt_id = pg_temp.c('att_s')::uuid and cid like 'srv-%') is distinct from 'reload:server'
     or (select guard_count from public.quiz_attempts where id = pg_temp.c('att_s')::uuid) <> 2 then
    raise exception 'FAILED: the server''s reload row';
  end if;
end
$t$;

-- 6. The server's own check: D's attempt of S reaches the limit without the events call ending it (a client that
--    never sent the call that reached it: set as postgres). Its next answer meets a finished attempt (quiz_settle),
--    and the result says 'protection'.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
select pg_temp.put('att_d', public.quiz_start(pg_temp.c('code_s'), 'Дмитрий') ->> 'attempt_id');
reset role;
update public.quiz_attempts set guard_count = 2 where id = pg_temp.c('att_d')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
do $t$
declare r jsonb;
begin
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', pg_temp.c('att_d'),
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.c('item:p:1'), 'chosen', jsonb_build_array(0)))), 'MC012', 'answers over the limit', 'finished');
  r := public.quiz_result(pg_temp.c('att_d')::uuid);
  if r ->> 'finish_reason' is distinct from 'protection' then raise exception 'FAILED: settled by the server %', r; end if;
end
$t$;

-- 7. The normal level records and never ends; a quiz without protection takes nothing and records no reload.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb; v_att text;
begin
  v_att := public.quiz_start(pg_temp.c('code_n'), 'Вера') ->> 'attempt_id';
  perform pg_temp.put('att_n', v_att);
  r := public.quiz_events_add(v_att::uuid, (select jsonb_agg(pg_temp.ev('n' || g, case when g % 2 = 0 then 'blur' else 'hidden' end, 1))
                                              from generate_series(1, 6) g));
  if (r ->> 'count')::int is distinct from 6 or (r ->> 'finished')::boolean or r -> 'limit' is distinct from 'null'::jsonb then
    raise exception 'FAILED: the normal level %', r;
  end if;
  r := public.quiz_finish(v_att::uuid);
  if r ->> 'finish_reason' is distinct from 'sent' or r -> 'guard' ->> 'level' is distinct from 'normal' or (r -> 'guard' ->> 'count')::int <> 6 then
    raise exception 'FAILED: the normal result %', r;
  end if;
  v_att := public.quiz_start(pg_temp.c('code_o'), 'Вера') ->> 'attempt_id';
  perform pg_temp.put('att_o', v_att);
  r := public.quiz_events_add(v_att::uuid, jsonb_build_array(pg_temp.ev('o1', 'hidden')));
  if (r ->> 'accepted')::int <> 0 or (r ->> 'count')::int <> 0 or pg_temp.events_of(v_att) <> 0 then
    raise exception 'FAILED: a quiz without protection took events %', r;
  end if;
  perform public.quiz_start(pg_temp.c('code_o'), '');
  if pg_temp.events_of(v_att) <> 0 then raise exception 'FAILED: a reload row without protection'; end if;
  r := public.quiz_finish(v_att::uuid);
  if r -> 'guard' is distinct from 'null'::jsonb then raise exception 'FAILED: guard without protection %', r; end if;
end
$t$;
-- B on N: a copy only (flagged without a counted event).
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare r jsonb; v_att text;
begin
  v_att := public.quiz_start(pg_temp.c('code_n'), 'Борис') ->> 'attempt_id';
  perform pg_temp.put('att_b', v_att);
  r := public.quiz_events_add(v_att::uuid, jsonb_build_array(pg_temp.ev('b1', 'copy', 1)));
  if (r ->> 'count')::int <> 0 or (r ->> 'accepted')::int <> 1 then raise exception 'FAILED: a copy only %', r; end if;
end
$t$;

-- 8. The cap (500 rows an attempt) and a late resend (finished more than ten minutes ago).
reset role;
insert into public.quiz_events (attempt_id, cid, kind, at)
select pg_temp.c('att_s2')::uuid, 'f' || g, 'copy', now() from generate_series(1, 498) g;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb; v_att text := pg_temp.c('att_s2');
begin
  r := public.quiz_events_add(v_att::uuid, jsonb_build_array(pg_temp.ev('k1', 'copy'), pg_temp.ev('k2', 'blur'), pg_temp.ev('k3', 'blur')));
  if (r ->> 'accepted')::int <> 2 or pg_temp.events_of(v_att) <> 500 or (r ->> 'count')::int <> 1 then
    raise exception 'FAILED: the cap %', r;
  end if;
  -- a known id still takes its duration at the cap
  r := public.quiz_events_add(v_att::uuid, jsonb_build_array(pg_temp.ev('k2', 'hidden', null, 900)));
  if (r ->> 'accepted')::int <> 1 or pg_temp.kind_of(v_att, 'k2') is distinct from 'hidden:900' or pg_temp.events_of(v_att) <> 500 then
    raise exception 'FAILED: an episode at the cap %', r;
  end if;
  -- a reopen at the cap writes no reload row
  perform public.quiz_start(pg_temp.c('code_s'), '');
  if pg_temp.events_of(v_att) <> 500 then raise exception 'FAILED: a reload row past the cap'; end if;
end
$t$;
reset role;
update public.quiz_attempts set finished_at = now() - interval '11 minutes', finish_reason = 'sent' where id = pg_temp.c('att_n')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_events_add(pg_temp.c('att_n')::uuid, jsonb_build_array(pg_temp.ev('late1', 'hidden')));
  if (r ->> 'accepted')::int <> 0 or (r ->> 'count')::int <> 6 or not (r ->> 'finished')::boolean then
    raise exception 'FAILED: a late resend %', r;
  end if;
end
$t$;

-- 9. A guest on G (strict, limit 1): the token's calls; the first time away ends the attempt.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare r jsonb; v_att text;
begin
  r := public.quiz_guest_start(pg_temp.c('code_g'), 'Гость Гостев', pg_temp.tok(1));
  v_att := r ->> 'attempt_id';
  perform pg_temp.put('att_g', v_att);
  if r ->> 'taker_name' is distinct from 'Гость Гостев' or (r ->> 'protection_limit')::int <> 1 then raise exception 'FAILED: guest attempt %', r; end if;
  r := public.quiz_guest_events_add(v_att::uuid, pg_temp.tok(1), jsonb_build_array(pg_temp.ev('g1', 'blur', 1, 2500)));
  if not (r ->> 'finished')::boolean or r ->> 'reason' is distinct from 'protection' then raise exception 'FAILED: the guest''s limit %', r; end if;
  perform pg_temp.expect_error(format('select public.quiz_guest_answer(%L, %L, %L)', v_att, pg_temp.tok(1),
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.c('item:p:1'), 'chosen', jsonb_build_array(0)))), 'MC012', 'a guest''s answer after the end', 'finished');
  r := public.quiz_guest_result(v_att::uuid, pg_temp.tok(1));
  if r ->> 'finish_reason' is distinct from 'protection' or (r -> 'guard' ->> 'count')::int <> 1 then raise exception 'FAILED: the guest''s result %', r; end if;
end
$t$;
reset role;

-- 10. The author: the results' new fields, the timeline, the lock after the start, a reset takes the events.
update public.quiz_events set at = now() - interval '1 hour' where attempt_id = pg_temp.c('att_s')::uuid and cid = 'c1';
update public.quiz_events set at = now() + interval '1 hour' where attempt_id = pg_temp.c('att_s')::uuid and cid = 'e2';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; v_row jsonb; v_ev jsonb;
begin
  r := public.quiz_results(pg_temp.c('qs')::uuid);
  if r -> 'quiz' ->> 'protection' is distinct from 'strict' then raise exception 'FAILED: results quiz %', r -> 'quiz'; end if;
  select x into v_row from jsonb_array_elements(r -> 'attempts') x where x ->> 'id' = pg_temp.c('att_s');
  if (v_row ->> 'guard_count')::int <> 2 or (v_row ->> 'guard_events')::int <> 7 or not (v_row ->> 'flagged')::boolean
     or v_row ->> 'finish_reason' is distinct from 'protection' then
    raise exception 'FAILED: the attempt row %', v_row;
  end if;
  -- D's attempt was ended by the server's count, without a row of its own
  select x into v_row from jsonb_array_elements(r -> 'attempts') x where x ->> 'id' = pg_temp.c('att_d');
  if (v_row ->> 'guard_count')::int <> 2 or (v_row ->> 'guard_events')::int <> 0 or not (v_row ->> 'flagged')::boolean then
    raise exception 'FAILED: D''s row %', v_row;
  end if;
  -- a copy only is flagged without a counted event
  r := public.quiz_results(pg_temp.c('qn')::uuid);
  select x into v_row from jsonb_array_elements(r -> 'attempts') x where x ->> 'id' = pg_temp.c('att_b');
  if (v_row ->> 'guard_count')::int <> 0 or (v_row ->> 'guard_events')::int <> 1 or not (v_row ->> 'flagged')::boolean then
    raise exception 'FAILED: B''s row %', v_row;
  end if;
  r := public.quiz_results(pg_temp.c('qo')::uuid);
  select x into v_row from jsonb_array_elements(r -> 'attempts') x where x ->> 'id' = pg_temp.c('att_o');
  if (v_row ->> 'guard_count')::int <> 0 or (v_row ->> 'guard_events')::int <> 0 or (v_row ->> 'flagged')::boolean then
    raise exception 'FAILED: a clean row %', v_row;
  end if;
  -- the timeline, by time
  r := public.quiz_attempt_events(pg_temp.c('att_s')::uuid);
  if pg_temp.keys(r) is distinct from 'count,events' or (r ->> 'count')::int <> 2 or jsonb_array_length(r -> 'events') <> 7 then
    raise exception 'FAILED: the timeline %', r;
  end if;
  select x into v_ev from jsonb_array_elements(r -> 'events') x where x ->> 'id' = 'e1';
  if pg_temp.keys(v_ev) is distinct from 'at,id,kind,ms,q,source' or v_ev ->> 'kind' <> 'hidden' or (v_ev ->> 'ms')::int <> 12000
     or (v_ev ->> 'q')::int <> 1 then
    raise exception 'FAILED: an event of the timeline %', v_ev;
  end if;
  -- by time: c1 an hour before the rest, e2 an hour after (moved as postgres before this block)
  if (r -> 'events' -> 0 ->> 'id') is distinct from 'c1' or (r -> 'events' -> 6 ->> 'id') is distinct from 'e2' then
    raise exception 'FAILED: the timeline is not by time %', r -> 'events';
  end if;
  -- the lock after the start: the level and the limit
  perform pg_temp.expect_error(format('select public.quiz_update(%L, %L)', pg_temp.c('qs'), '{"protection": "normal"}'), 'MC011', 'the level after the start', 'protection');
  perform pg_temp.expect_error(format('select public.quiz_update(%L, %L)', pg_temp.c('qs'), '{"protection_limit": 5}'), 'MC011', 'the limit after the start', 'protection_limit');
  r := public.quiz_update(pg_temp.c('qs')::uuid, '{"protection": "strict", "protection_limit": 2, "title": "Строгая контрольная"}');
  if r ->> 'title' is distinct from 'Строгая контрольная' then raise exception 'FAILED: the same values after the start %', r; end if;
  -- a reset takes the attempt's events with it
  perform public.quiz_attempt_reset(pg_temp.c('att_s')::uuid);
  perform pg_temp.expect_404(format('select public.quiz_attempt_events(%L)', pg_temp.c('att_s')), 'the timeline of a reset attempt', 'attempt');
end
$t$;
reset role;
do $t$
begin
  if exists (select 1 from public.quiz_events where attempt_id = pg_temp.c('att_s')::uuid) then
    raise exception 'FAILED: the events of a reset attempt';
  end if;
end
$t$;
select 'QUIZ PROTECTION BEHAVIOUR PASSED';
rollback;
