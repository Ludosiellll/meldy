-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261018130000_quiz_guards.sql on the
-- scratch database of quiz_guards_run.sh. One transaction, rolled back. A = author aaaa…1 (exams X and Y), D = dddd…4
-- and E = eeee…5 (signed-in takers), guests are anon with tokens tok(n). now() is one moment inside the transaction.
-- Covers: «Тренироваться» waits until no quiz of the exam is open or not yet open — the result's practice says ready
-- (the same rule), quiz_practice_join refuses with MC018 open and writes nothing (no member row, the items stay
-- unreadable); the offer / finished-attempt check comes first (MC018 practice); the author gets their own exam at any
-- time; a quiz closed by the author, then one not yet open, then one closed by time with an attempt still unsettled; a
-- quiz of another exam does not count; a new open quiz blocks again; the result keeps every other key. The address:
-- HMAC-SHA256 of the first x-forwarded-for under the private secret (not the old prefixed sha256), null without an
-- address, a readable header or the secret; 30 starts a minute from one address, the 31st refused (MC016), another
-- address passes; the throttle rows older than two minutes go at the check — with or without an address — and the rows
-- of the last two minutes stay. A failure raises; success prints QUIZ GUARDS BEHAVIOUR PASSED.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_what text, p_detail text default null)
returns void language plpgsql as $fn$
declare v_detail text;
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_state;
exception
  when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    -- 20261020120000_quiz_protection: «not found» of the functions it rewrote is PostgREST's 404 with P0002 inside.
    if sqlstate = 'PGRST' and p_state = 'P0002' and (sqlerrm::jsonb ->> 'code') = 'P0002'
       and (v_detail::jsonb ->> 'status') = '404' then
      v_detail := sqlerrm::jsonb ->> 'details';
    elsif sqlstate is distinct from p_state then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_state;
    end if;
    if p_detail is not null and v_detail is distinct from p_detail then
      raise exception 'FAILED: % — detail %, expected %', p_what, v_detail, p_detail;
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
-- the sorted key set of a JSON object. Release 47.1 (20261019100000_test_docs.sql) adds «design», «band», «score» and
-- «max_score» to the result; test_docs_behaviour.sql pins those shapes, so once it is applied the pins here leave those
-- keys out (before it, they must not be there). The same for the fields of 20261020120000_quiz_protection.sql, which
-- quiz_protection_behaviour.sql pins.
create or replace function pg_temp.keys(p jsonb) returns text language sql stable as $fn$
  select string_agg(k, ',' order by k) from jsonb_object_keys(p) k
   where not (k in ('design', 'band', 'score', 'max_score') and to_regclass('public.test_docs') is not null)
     and not (k in ('protection', 'protection_limit', 'guard', 'guard_count', 'guard_events', 'flagged', 'taker_name') and to_regclass('public.quiz_events') is not null)
$fn$;
create or replace function pg_temp.tok(p_n integer) returns text language sql immutable as $fn$
  select 'grd' || lpad(p_n::text, 8, '0') || repeat('Q', 32)
$fn$;
create or replace function pg_temp.practice(p_exam text, p_member boolean, p_ready boolean) returns jsonb language sql immutable as $fn$
  select jsonb_build_object('exam_title', p_exam, 'member', p_member, 'ready', p_ready)
$fn$;
grant all on ctx to authenticated, anon, service_role;
grant execute on function pg_temp.expect_error(text, text, text, text), pg_temp.c(text), pg_temp.put(text, text),
  pg_temp.keys(jsonb), pg_temp.tok(integer), pg_temp.practice(text, boolean, boolean)
  to authenticated, anon, service_role;

-- 1. A: exam X (two keyed questions) with QP (the practice offer, review «answers») and QO (open, no offer); exam Y with
--    QY (open, guests, attempts without limit). A writes QP once (for the author's own practice).
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; v_x text; v_y text;
begin
  r := public.container_create('Охрана тренировки', null, '[{"title":"Вопросы"}]');
  v_x := r ->> 'container_id';
  perform pg_temp.put('x', v_x);
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'g:1', 'stem', 'Сколько будет 2+2?', 'options', jsonb_build_array('3', '4'), 'correct', jsonb_build_array(1),
                       'explanation', 'Ключ первого'),
    jsonb_build_object('ref', 'g:2', 'stem', 'Столица Франции', 'answers', jsonb_build_array('Париж'))));
  r := public.container_create('Другой экзамен', null, '[{"title":"Один"}]');
  v_y := r ->> 'container_id';
  perform pg_temp.put('y', v_y);
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'gy:1', 'stem', 'Да или нет', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0))));
  r := public.quiz_create(v_x::uuid, jsonb_build_object('title', 'С тренировкой', 'review', 'answers', 'attempts', null, 'offer_practice', true));
  perform pg_temp.put('qp', r ->> 'id');
  perform pg_temp.put('code_p', r ->> 'code');
  r := public.quiz_create(v_x::uuid, jsonb_build_object('title', 'Вторая', 'attempts', null));
  perform pg_temp.put('qo', r ->> 'id');
  perform pg_temp.put('code_o', r ->> 'code');
  r := public.quiz_create(v_y::uuid, jsonb_build_object('title', 'Чужая', 'attempts', null));
  perform pg_temp.put('qy', r ->> 'id');
  perform pg_temp.put('code_y', r ->> 'code');
  r := public.quiz_start(pg_temp.c('code_p'), 'Автор');
  r := public.quiz_finish((r ->> 'attempt_id')::uuid);
  if r -> 'practice' is distinct from 'null'::jsonb then raise exception 'FAILED: practice offered to the author %', r -> 'practice'; end if;
end
$t$;

-- 2. D: no finished attempt → MC018 practice even while not ready (the offer check first); an attempt of QO left open
--    (for «closed by time, not settled» later); QP written and finished.
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
do $t$
declare r jsonb;
begin
  perform pg_temp.expect_error(format('select public.quiz_practice_join(%L)', pg_temp.c('code_p')), 'MC018', 'practice without a finished attempt', 'practice');
  r := public.quiz_start(pg_temp.c('code_o'), 'Дмитрий');
  perform pg_temp.put('d_qo', r ->> 'attempt_id');
  r := public.quiz_start(pg_temp.c('code_p'), 'Дмитрий');
  perform public.quiz_finish((r ->> 'attempt_id')::uuid);
end
$t$;

-- 3. E while QP and QO are open: the result says ready false; the join is refused with MC018 open and writes nothing;
--    a quiz without the offer gives practice null; every other key of the result as release 47.
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', true);
do $t$
declare r jsonb; v_att uuid;
begin
  r := public.quiz_start(pg_temp.c('code_p'), 'Ева');
  v_att := (r ->> 'attempt_id')::uuid;
  perform pg_temp.put('e_att', v_att::text);
  r := public.quiz_finish(v_att);
  if pg_temp.keys(r) is distinct from 'accent,answers_after,attempt_id,attempts_left,can_retry,code,correct,finish_reason,finished_at,'
       'items,n,pass_percent,passed,percent,practice,quiz_title,review_now,shuffle_options,started_at,total' then
    raise exception 'FAILED: Result keys %', pg_temp.keys(r);
  end if;
  if pg_temp.keys(r -> 'practice') is distinct from 'exam_title,member,ready'
     or r -> 'practice' is distinct from pg_temp.practice('Охрана тренировки', false, false) then
    raise exception 'FAILED: practice while the quizzes are open %', r -> 'practice';
  end if;
  if r ->> 'review_now' is distinct from 'answers' or not (r ->> 'can_retry')::boolean or r ->> 'accent' is distinct from 'blue'
     or jsonb_array_length(r -> 'items') <> 2 then
    raise exception 'FAILED: the rest of the result %', r;
  end if;
  if public.quiz_result(v_att) is distinct from r then raise exception 'FAILED: quiz_result differs from quiz_finish'; end if;
  perform pg_temp.expect_error(format('select public.quiz_practice_join(%L)', pg_temp.c('code_p')), 'MC018', 'practice while QP and QO are open', 'open');
  if exists (select 1 from public.test_items where container_id = pg_temp.c('x')::uuid) then
    raise exception 'FAILED: E reads the items of a running quiz';
  end if;
  -- no offer: practice null
  r := public.quiz_start(pg_temp.c('code_o'), 'Ева');
  r := public.quiz_finish((r ->> 'attempt_id')::uuid);
  if r -> 'practice' is distinct from 'null'::jsonb then raise exception 'FAILED: practice of a quiz without the offer %', r -> 'practice'; end if;
end
$t$;
reset role;
do $t$
begin
  if exists (select 1 from public.container_members where container_id = pg_temp.c('x')::uuid) then
    raise exception 'FAILED: a refused join wrote a member row';
  end if;
end
$t$;

-- 4. A guest's result says the same (member false).
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_guest_start(pg_temp.c('code_p'), 'Гость', pg_temp.tok(1));
  perform pg_temp.put('g_att', r ->> 'attempt_id');
  r := public.quiz_guest_finish((r ->> 'attempt_id')::uuid, pg_temp.tok(1));
  if r -> 'practice' is distinct from pg_temp.practice('Охрана тренировки', false, false) then
    raise exception 'FAILED: a guest''s practice while open %', r -> 'practice';
  end if;
end
$t$;

-- 5. A: their own exam back at any time; A closes QP — QO still open: not ready.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_practice_join(pg_temp.c('code_p'));
  if r is distinct from jsonb_build_object('container_id', pg_temp.c('x')) then raise exception 'FAILED: the author''s practice %', r; end if;
  perform public.quiz_close(pg_temp.c('qp')::uuid);
end
$t$;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', true);
do $t$
begin
  if (public.quiz_result(pg_temp.c('e_att')::uuid) -> 'practice' ->> 'ready')::boolean is distinct from false then
    raise exception 'FAILED: ready with QO open';
  end if;
  perform pg_temp.expect_error(format('select public.quiz_practice_join(%L)', pg_temp.c('code_p')), 'MC018', 'practice while QO is open', 'open');
end
$t$;

-- 6. QO not yet open (the author moves its opening a day on): not ready.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
begin
  if public.quiz_update(pg_temp.c('qo')::uuid, jsonb_build_object('opens_at', now() + interval '1 day')) ->> 'state'
     is distinct from 'not_yet' then
    raise exception 'FAILED: QO is not «not yet»';
  end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', true);
do $t$
begin
  if (public.quiz_result(pg_temp.c('e_att')::uuid) -> 'practice' ->> 'ready')::boolean is distinct from false then
    raise exception 'FAILED: ready with QO not yet open';
  end if;
  perform pg_temp.expect_error(format('select public.quiz_practice_join(%L)', pg_temp.c('code_p')), 'MC018', 'practice while QO is not yet open', 'open');
end
$t$;

-- 7. postgres: QO closed by time a minute ago, D's attempt in it not settled yet; QY of exam Y stays open.
reset role;
do $t$
begin
  update public.quizzes set opens_at = null, closes_at = now() - interval '1 minute' where id = pg_temp.c('qo')::uuid;
  if (select finished_at from public.quiz_attempts where id = pg_temp.c('d_qo')::uuid) is not null
     or (select closed_at from public.quizzes where id = pg_temp.c('qo')::uuid) is not null
     or meldy_private.quiz_state((select q from public.quizzes q where q.id = pg_temp.c('qy')::uuid)) <> 'open' then
    raise exception 'FAILED: the fixture of «closed by time»';
  end if;
end
$t$;

-- 8. E: ready; the join makes E a member; the items readable; the result says member and ready.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_result(pg_temp.c('e_att')::uuid);
  if r -> 'practice' is distinct from pg_temp.practice('Охрана тренировки', false, true) then
    raise exception 'FAILED: ready once every quiz of X is closed %', r -> 'practice';
  end if;
  r := public.quiz_practice_join(pg_temp.c('code_p'));
  if r is distinct from jsonb_build_object('container_id', pg_temp.c('x')) then raise exception 'FAILED: the join when ready %', r; end if;
  if (select count(*) from public.test_items where container_id = pg_temp.c('x')::uuid) <> 2 then
    raise exception 'FAILED: a practice member reads the items';
  end if;
  if public.quiz_result(pg_temp.c('e_att')::uuid) -> 'practice' is distinct from pg_temp.practice('Охрана тренировки', true, true) then
    raise exception 'FAILED: practice after the join %', public.quiz_result(pg_temp.c('e_att')::uuid) -> 'practice';
  end if;
end
$t$;

-- 9. A opens a new quiz in X: not ready again — a guest's result says so, D's join is refused and writes nothing.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select public.quiz_create(pg_temp.c('x')::uuid, '{"title": "Новая"}') is null;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
begin
  if public.quiz_guest_result(pg_temp.c('g_att')::uuid, pg_temp.tok(1)) -> 'practice' is distinct from pg_temp.practice('Охрана тренировки', false, false) then
    raise exception 'FAILED: a guest''s practice with a new open quiz';
  end if;
end
$t$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
do $t$
begin
  perform pg_temp.expect_error(format('select public.quiz_practice_join(%L)', pg_temp.c('code_p')), 'MC018', 'practice with a new open quiz', 'open');
end
$t$;
reset role;
do $t$
begin
  if exists (select 1 from public.container_members where container_id = pg_temp.c('x')::uuid and user_id = 'dddddddd-0000-0000-0000-000000000004') then
    raise exception 'FAILED: D became a member while a quiz is open';
  end if;
end
$t$;

-- 10. postgres: the address hash — HMAC-SHA256 of the first x-forwarded-for under the secret.
do $t$
declare v_key bytea; v_expected text;
begin
  if (select count(*) from meldy_private.quiz_ip_secret) <> 1
     or (select octet_length(secret) from meldy_private.quiz_ip_secret) <> 32 then
    raise exception 'FAILED: the secret row';
  end if;
  select secret into v_key from meldy_private.quiz_ip_secret;
  v_expected := encode(extensions.hmac(convert_to('203.0.113.7', 'UTF8'), v_key, 'sha256'), 'hex');
  perform pg_temp.put('ip_hash', v_expected);
  perform set_config('request.headers', '{"x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "test"}', true);
  if meldy_private.quiz_ip_hash() is distinct from v_expected then raise exception 'FAILED: the HMAC of the first address'; end if;
  if v_expected = encode(sha256(convert_to('meldy-quiz-ip:203.0.113.7', 'UTF8')), 'hex')
     or v_expected = encode(sha256(convert_to('203.0.113.7', 'UTF8')), 'hex') then
    raise exception 'FAILED: the hash needs no secret';
  end if;
  perform set_config('request.headers', '{"x-forwarded-for": " 203.0.113.7 "}', true);
  if meldy_private.quiz_ip_hash() is distinct from v_expected then raise exception 'FAILED: the address with spaces'; end if;
  perform set_config('request.headers', '{"x-forwarded-for": "198.51.100.1, 203.0.113.7"}', true);
  if meldy_private.quiz_ip_hash() = v_expected or meldy_private.quiz_ip_hash() !~ '^[0-9a-f]{64}$' then
    raise exception 'FAILED: another first address';
  end if;
  perform set_config('request.headers', '{"user-agent": "test"}', true);
  if meldy_private.quiz_ip_hash() is not null then raise exception 'FAILED: no address'; end if;
  perform set_config('request.headers', '', true);
  if meldy_private.quiz_ip_hash() is not null then raise exception 'FAILED: no headers'; end if;
  perform set_config('request.headers', 'не json', true);
  if meldy_private.quiz_ip_hash() is not null then raise exception 'FAILED: a broken header'; end if;
  -- without the secret: no address hash (only the per-quiz limit holds); the row comes back as it was
  perform set_config('request.headers', '{"x-forwarded-for": "203.0.113.7"}', true);
  delete from meldy_private.quiz_ip_secret;
  if meldy_private.quiz_ip_hash() is not null then raise exception 'FAILED: a hash without the secret'; end if;
  insert into meldy_private.quiz_ip_secret (id, secret) values (true, v_key);
  if meldy_private.quiz_ip_hash() is distinct from v_expected then raise exception 'FAILED: the secret back'; end if;
  -- clients cannot reach the secret
  if has_table_privilege('anon', 'meldy_private.quiz_ip_secret', 'SELECT')
     or has_table_privilege('authenticated', 'meldy_private.quiz_ip_secret', 'SELECT')
     or has_table_privilege('service_role', 'meldy_private.quiz_ip_secret', 'SELECT') then
    raise exception 'FAILED: a client reads the secret';
  end if;
  -- the throttle before the starts: rows of three minutes ago (to be pruned) and of ninety seconds ago (to be kept)
  delete from meldy_private.quiz_guest_starts;
  insert into meldy_private.quiz_guest_starts (ip_hash, started_at)
  select encode(sha256(convert_to('old' || g, 'UTF8')), 'hex'), now() - interval '3 minutes' from generate_series(1, 5) g;
  insert into meldy_private.quiz_guest_starts (ip_hash, started_at)
  select v_expected, now() - interval '90 seconds' from generate_series(1, 4) g;
end
$t$;

-- 11. Anon on QY from 203.0.113.7: the first start prunes the three-minute rows and keeps the ninety-second ones (they
--     are not counted); 30 starts pass, the 31st is refused; another address passes.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.7, 10.0.0.1"}', true);
do $t$
begin
  for i in 1..30 loop
    perform public.quiz_guest_start(pg_temp.c('code_y'), 'Адрес ' || i, pg_temp.tok(100 + i));
  end loop;
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', pg_temp.c('code_y'), 'Адрес 31', pg_temp.tok(131)),
    'MC016', 'the 31st start from one address', 'busy');
  perform set_config('request.headers', '{"x-forwarded-for": "198.51.100.1"}', true);
  perform public.quiz_guest_start(pg_temp.c('code_y'), 'Другой адрес', pg_temp.tok(132));
end
$t$;
reset role;
do $t$
begin
  if exists (select 1 from meldy_private.quiz_guest_starts where started_at <= now() - interval '2 minutes') then
    raise exception 'FAILED: rows older than two minutes stayed';
  end if;
  if (select count(*) from meldy_private.quiz_guest_starts where ip_hash = pg_temp.c('ip_hash')) <> 34
     or (select count(*) from meldy_private.quiz_guest_starts where ip_hash = pg_temp.c('ip_hash') and started_at = now() - interval '90 seconds') <> 4
     or (select count(*) from meldy_private.quiz_guest_starts) <> 35
     or exists (select 1 from meldy_private.quiz_guest_starts where ip_hash = encode(sha256(convert_to('meldy-quiz-ip:203.0.113.7', 'UTF8')), 'hex')) then
    raise exception 'FAILED: the throttle rows % (of the address %)', (select count(*) from meldy_private.quiz_guest_starts),
      (select count(*) from meldy_private.quiz_guest_starts where ip_hash = pg_temp.c('ip_hash'));
  end if;
  -- two and a half minutes later: the 35 rows are old; a start without an address prunes them too
  update meldy_private.quiz_guest_starts set started_at = now() - interval '150 seconds';
end
$t$;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.headers', '', true);
select public.quiz_guest_start(pg_temp.c('code_y'), 'Без адреса', pg_temp.tok(133)) is null;
reset role;
do $t$
begin
  if (select count(*) from meldy_private.quiz_guest_starts) <> 0 then
    raise exception 'FAILED: a start without an address did not prune % rows', (select count(*) from meldy_private.quiz_guest_starts);
  end if;
end
$t$;
-- and from the address again: the minute is free, one new row
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.7"}', true);
select public.quiz_guest_start(pg_temp.c('code_y'), 'Через минуту', pg_temp.tok(134)) is null;
reset role;
do $t$
begin
  if (select count(*) from meldy_private.quiz_guest_starts) <> 1
     or (select ip_hash from meldy_private.quiz_guest_starts) is distinct from pg_temp.c('ip_hash') then
    raise exception 'FAILED: the start a minute later';
  end if;
end
$t$;
select 'QUIZ GUARDS BEHAVIOUR PASSED';
rollback;
