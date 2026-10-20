-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261018140000_quiz_practice_grace.sql
-- on the scratch database of quiz_guards_run.sh (after 20261018130000). One transaction, rolled back. A = author aaaa…1
-- (exams X and Y), D = dddd…4 and E = eeee…5 (signed-in takers). now() is one moment inside the transaction, so «closed
-- 10 seconds ago» is made by moving closes_at as postgres.
-- Covers: a quiz closed by time 10 and 19 seconds ago keeps practice waiting (the result says ready false, the join is
-- refused with MC018 open and writes nothing); 20 seconds after the closing it is ready and the join works; a quiz the
-- author closed counts at once, with or without a closes_at just past. A failure raises; success prints
-- QUIZ PRACTICE GRACE BEHAVIOUR PASSED.
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
grant all on ctx to authenticated, anon, service_role;
grant execute on function pg_temp.expect_error(text, text, text, text), pg_temp.c(text), pg_temp.put(text, text)
  to authenticated, anon, service_role;

-- 1. A: exam X with QX (the practice offer), exam Y with QY (the offer); E writes QX, D writes QY.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb;
begin
  r := public.container_create('Пауза после закрытия', null, '[{"title":"Вопросы"}]');
  perform pg_temp.put('x', r ->> 'container_id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'pg:1', 'stem', 'Сколько будет 2+2?', 'options', jsonb_build_array('3', '4'), 'correct', jsonb_build_array(1))));
  r := public.quiz_create((pg_temp.c('x'))::uuid, jsonb_build_object('title', 'По времени', 'attempts', null, 'offer_practice', true));
  perform pg_temp.put('qx', r ->> 'id');
  perform pg_temp.put('code_x', r ->> 'code');
  r := public.container_create('Закрыта автором', null, '[{"title":"Вопросы"}]');
  perform pg_temp.put('y', r ->> 'container_id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'pg:2', 'stem', 'Да или нет', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0))));
  r := public.quiz_create((pg_temp.c('y'))::uuid, jsonb_build_object('title', 'Вручную', 'attempts', null, 'offer_practice', true));
  perform pg_temp.put('qy', r ->> 'id');
  perform pg_temp.put('code_y', r ->> 'code');
end
$t$;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_start(pg_temp.c('code_x'), 'Ева');
  perform pg_temp.put('e_att', r ->> 'attempt_id');
  perform public.quiz_finish((r ->> 'attempt_id')::uuid);
end
$t$;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_start(pg_temp.c('code_y'), 'Дмитрий');
  perform pg_temp.put('d_att', r ->> 'attempt_id');
  perform public.quiz_finish((r ->> 'attempt_id')::uuid);
end
$t$;

-- 2. QX closed by time 10, then 19 seconds ago: the quiz reads closed, practice still waits.
reset role;
create or replace function pg_temp.closes_ago(p_seconds integer) returns void language plpgsql security definer as $fn$
begin
  update public.quizzes set opens_at = null, closes_at = now() - make_interval(secs => p_seconds), closed_at = null
   where id = pg_temp.c('qx')::uuid;
  if meldy_private.quiz_state((select q from public.quizzes q where q.id = pg_temp.c('qx')::uuid)) <> 'closed' then
    raise exception 'FAILED: QX does not read closed % seconds after its closes_at', p_seconds;
  end if;
end;
$fn$;
grant execute on function pg_temp.closes_ago(integer) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', true);
do $t$
declare v_s integer;
begin
  foreach v_s in array array[10, 19] loop
    perform pg_temp.closes_ago(v_s);
    if (public.quiz_result(pg_temp.c('e_att')::uuid) -> 'practice' ->> 'ready')::boolean is distinct from false then
      raise exception 'FAILED: ready % seconds after a closing by time', v_s;
    end if;
    perform pg_temp.expect_error(format('select public.quiz_practice_join(%L)', pg_temp.c('code_x')), 'MC018',
      format('practice %s seconds after a closing by time', v_s), 'open');
  end loop;
  if exists (select 1 from public.test_items where container_id = pg_temp.c('x')::uuid) then
    raise exception 'FAILED: E reads the items inside the answer grace';
  end if;
end
$t$;
reset role;
do $t$
begin
  if exists (select 1 from public.container_members where container_id = pg_temp.c('x')::uuid) then
    raise exception 'FAILED: a refused join inside the grace wrote a member row';
  end if;
end
$t$;

-- 3. Twenty seconds after the closing: ready, the join works, the items are readable.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', true);
do $t$
begin
  perform pg_temp.closes_ago(20);
  if (public.quiz_result(pg_temp.c('e_att')::uuid) -> 'practice' ->> 'ready')::boolean is distinct from true then
    raise exception 'FAILED: not ready 20 seconds after the closing';
  end if;
  if public.quiz_practice_join(pg_temp.c('code_x')) is distinct from jsonb_build_object('container_id', pg_temp.c('x')) then
    raise exception 'FAILED: the join 20 seconds after the closing';
  end if;
  if (select count(*) from public.test_items where container_id = pg_temp.c('x')::uuid) <> 1 then
    raise exception 'FAILED: the member reads the items';
  end if;
end
$t$;

-- 4. QY closed by the author: ready at once — without a closes_at, and with one 5 seconds past.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select public.quiz_close(pg_temp.c('qy')::uuid) is null;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
do $t$
begin
  if (public.quiz_result(pg_temp.c('d_att')::uuid) -> 'practice' ->> 'ready')::boolean is distinct from true then
    raise exception 'FAILED: not ready right after the author closed the quiz';
  end if;
end
$t$;
reset role;
update public.quizzes set closes_at = now() - interval '5 seconds' where id = pg_temp.c('qy')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
do $t$
begin
  if (public.quiz_result(pg_temp.c('d_att')::uuid) -> 'practice' ->> 'ready')::boolean is distinct from true then
    raise exception 'FAILED: a quiz closed by the author waits for the grace of its closes_at';
  end if;
  if public.quiz_practice_join(pg_temp.c('code_y')) is distinct from jsonb_build_object('container_id', pg_temp.c('y')) then
    raise exception 'FAILED: the join after the author closed the quiz';
  end if;
end
$t$;
reset role;
select 'QUIZ PRACTICE GRACE BEHAVIOUR PASSED';
rollback;
