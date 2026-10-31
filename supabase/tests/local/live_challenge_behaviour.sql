-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261106090100_live_challenge.sql on the
-- scratch database of live_game_run.sh, after the calm step: the author's create (its refusals, the kinds it takes, the
-- questions frozen), the link's info, the start (token, name, look, one run a token and an account), a run (the next
-- question, the server's clock, early, late, twice, the kinds, the key never before the answer or the time's end, the
-- explanation after), the grading against a one-player battle played with the same answers (with points for speed and
-- «Без спешки»), the table (its order, shared places, the own row, a run taken off), the early close and the end (the
-- open question still answered, the sweep), the review, «Тренировать ошибки» (members, a quiz that offers it, once),
-- the limits (per address, per link, 300 runs), the author's views, and that no token or hash ever leaves. One
-- transaction, rolled back: now() stays put and the time machine moves the rows. A failure raises; success prints
-- LIVE CHALLENGE BEHAVIOUR PASSED.
\set ON_ERROR_STOP 1
begin;
create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated, anon, service_role;
create temp table shared (k text primary key, v jsonb);
insert into shared values ('names', :'names'::jsonb), ('looks', :'looks'::jsonb);
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = p_k
$fn$;
create or replace function pg_temp.g(p_k text) returns uuid language sql stable as $fn$
  select v::uuid from pg_temp.ctx where k = p_k
$fn$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into pg_temp.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
create or replace function pg_temp.tok(p_n integer) returns text language sql immutable as $fn$
  select 'tok' || lpad(p_n::text, 40, '0')
$fn$;
-- Who calls: a role ('postgres' = the session's own), the JWT's sub, and the caller's address (x-forwarded-for).
create or replace function pg_temp.who(p_role text, p_sub text default null, p_ip text default null) returns void
language plpgsql as $fn$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', coalesce(p_sub, ''), true);
  perform set_config('request.jwt.claim.role', case when p_role = 'postgres' then '' else p_role end, true);
  perform set_config('request.headers', case when p_ip is null then '{}' else jsonb_build_object('x-forwarded-for', p_ip)::text end, true);
  if p_role <> 'postgres' then
    perform set_config('role', p_role, true);
  end if;
end;
$fn$;
-- The outcome of a statement: 'ok', or the body's code/details@status of a PGRST refusal, or SQLSTATE/detail.
create or replace function pg_temp.e(p_sql text) returns text language plpgsql as $fn$
declare v_detail text; v_msg jsonb;
begin
  execute p_sql;
  return 'ok';
exception
  when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlstate = 'PGRST' then
      v_msg := sqlerrm::jsonb;
      perform set_config('live_test.headers', coalesce(v_detail::jsonb -> 'headers', '{}')::text, true);
      return (v_msg ->> 'code') || '/' || coalesce(v_msg ->> 'details', '') || '@' || coalesce(v_detail::jsonb ->> 'status', '?');
    end if;
    return sqlstate || '/' || coalesce(v_detail, '');
end;
$fn$;
create or replace function pg_temp.eq(p_what text, p_got text, p_want text) returns void language plpgsql as $fn$
begin
  if p_got is distinct from p_want then
    raise exception 'FAILED: % — got %, expected %', p_what, coalesce(p_got, 'NULL'), coalesce(p_want, 'NULL');
  end if;
end;
$fn$;
create or replace function pg_temp.yes(p_what text, p_ok boolean) returns void language plpgsql as $fn$
begin
  if p_ok is not true then
    raise exception 'FAILED: %', p_what;
  end if;
end;
$fn$;
create or replace function pg_temp.keys(p jsonb) returns text language sql stable as $fn$
  select string_agg(k, ',' order by k) from jsonb_object_keys(p) k
$fn$;
-- Run as the session's own role (reads and writes the closed tables), then back to the caller's.
create or replace function pg_temp.sudo(p_sql text) returns jsonb language plpgsql as $fn$
declare v_role text := current_user; v jsonb;
begin
  perform set_config('role', 'none', true);
  execute p_sql into v;
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  return v;
end;
$fn$;
-- The time machine of a battle (as the other behaviours): every time of a game moves back by p_s seconds.
create or replace function pg_temp.tick(p_game uuid, p_s numeric) returns void language plpgsql as $fn$
declare v_role text := current_user; v_i interval := make_interval(secs => p_s::double precision);
begin
  perform set_config('role', 'none', true);
  update public.live_games set created_at = created_at - v_i, state_at = state_at - v_i, q_ready_at = q_ready_at - v_i,
         q_opens_at = q_opens_at - v_i, q_closes_at = q_closes_at - v_i, ended_at = ended_at - v_i
   where id = p_game;
  update public.live_questions set opens_at = opens_at - v_i, closes_at = closes_at - v_i, closed_at = closed_at - v_i
   where game_id = p_game;
  update public.live_players set joined_at = joined_at - v_i, kicked_at = kicked_at - v_i where game_id = p_game;
  update public.live_answers set at = at - v_i where game_id = p_game;
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
end;
$fn$;
-- The time machine of a run: its questions' times move back by p_s seconds (a run's own clock).
create or replace function pg_temp.rtick(p_run uuid, p_s numeric) returns void language plpgsql as $fn$
declare v_role text := current_user; v_i interval := make_interval(secs => p_s::double precision);
begin
  perform set_config('role', 'none', true);
  update public.live_run_answers set opened_at = opened_at - v_i, opens_at = opens_at - v_i, closes_at = closes_at - v_i,
         at = at - v_i, settled_at = settled_at - v_i
   where run_id = p_run;
  update public.live_runs set joined_at = joined_at - v_i, finished_at = finished_at - v_i where id = p_run;
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
end;
$fn$;
-- The time machine of a whole challenge: its times and every run's.
create or replace function pg_temp.ctick(p_ch uuid, p_s numeric) returns void language plpgsql as $fn$
declare v_role text := current_user; v_i interval := make_interval(secs => p_s::double precision);
begin
  perform set_config('role', 'none', true);
  update public.live_challenges set created_at = created_at - v_i, deadline = deadline - v_i, closed_at = closed_at - v_i,
         swept_at = swept_at - v_i
   where id = p_ch;
  update public.live_run_answers set opened_at = opened_at - v_i, opens_at = opens_at - v_i, closes_at = closes_at - v_i,
         at = at - v_i, settled_at = settled_at - v_i
   where challenge_id = p_ch;
  update public.live_runs set joined_at = joined_at - v_i, finished_at = finished_at - v_i where challenge_id = p_ch;
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
end;
$fn$;
-- The run of a token in a challenge; a challenge's question; a run's answer row (as the session).
create or replace function pg_temp.run(p_ch uuid, p_tok text) returns uuid language sql as $fn$
  select (pg_temp.sudo(format('select to_jsonb(r.id) from public.live_runs r where r.challenge_id = %L and r.token_hash = meldy_private.live_hash(%L)',
                              p_ch, p_tok)) #>> '{}')::uuid
$fn$;
create or replace function pg_temp.cq(p_ch uuid, p_qi integer) returns jsonb language sql as $fn$
  select pg_temp.sudo(format('select to_jsonb(q) from public.live_challenge_questions q where q.challenge_id = %L and q.qi = %s', p_ch, p_qi))
$fn$;
create or replace function pg_temp.ra(p_run uuid, p_qi integer) returns jsonb language sql as $fn$
  select pg_temp.sudo(format('select to_jsonb(a) from public.live_run_answers a where a.run_id = %L and a.qi = %s', p_run, p_qi))
$fn$;
create or replace function pg_temp.rrow(p_run uuid) returns jsonb language sql as $fn$
  select pg_temp.sudo(format('select to_jsonb(r) from public.live_runs r where r.id = %L', p_run))
$fn$;
create or replace function pg_temp.qrow(p_game uuid, p_qi integer) returns jsonb language sql as $fn$
  select pg_temp.sudo(format('select to_jsonb(q) from public.live_questions q where q.game_id = %L and q.qi = %s', p_game, p_qi))
$fn$;
-- The answers of a question row (a live or a challenge question: the same columns): right, partly right, wrong.
create or replace function pg_temp.right_of(p_q jsonb) returns jsonb language sql immutable as $fn$
  select case p_q ->> 'kind'
    when 'single' then jsonb_build_object('choice', (p_q ->> 'key')::integer)
    when 'multiple' then jsonb_build_object('picks', p_q -> 'keys')
    else jsonb_build_object('text', p_q -> 'forms' ->> 0) end
$fn$;
create or replace function pg_temp.wrong_of(p_q jsonb) returns jsonb language sql immutable as $fn$
  select case p_q ->> 'kind'
    when 'single' then jsonb_build_object('choice', ((p_q ->> 'key')::integer + 1) % jsonb_array_length(p_q -> 'options'))
    when 'multiple' then jsonb_build_object('picks', jsonb_build_array((select min(z) from generate_series(0, jsonb_array_length(p_q -> 'options') - 1) z
                                                                         where not (p_q -> 'keys') @> to_jsonb(z))))
    when 'number' then '{"text": "99999"}'::jsonb
    else '{"text": "совсем не то"}'::jsonb end
$fn$;
create or replace function pg_temp.part_of(p_q jsonb) returns jsonb language sql immutable as $fn$
  select case p_q ->> 'kind' when 'multiple' then jsonb_build_object('picks', jsonb_build_array((p_q -> 'keys' ->> 0)::integer))
                             else pg_temp.wrong_of(p_q) end
$fn$;
-- An answer given in the question's order of the options (as the rows of live_challenge_questions and live_questions
-- hold them), turned into the run's own order (meldy_private.live_run_perm) as its device would send it: indexes that
-- are no option of the question stay as they are (the refusals).
create or replace function pg_temp.in_run(p_code text, p_tok text, p_qi integer, p_answer jsonb) returns jsonb language plpgsql as $fn$
declare v_role text := current_user; v_perm smallint[]; v_n integer; v jsonb := p_answer;
begin
  perform set_config('role', 'none', true);
  select meldy_private.live_run_perm(r.id, q.qi, jsonb_array_length(q.options), q.keep_order), jsonb_array_length(q.options)
    into v_perm, v_n
    from public.live_runs r join public.live_challenges c on c.id = r.challenge_id
    join public.live_challenge_questions q on q.challenge_id = c.id and q.qi = p_qi
   where c.code = p_code and r.token_hash = meldy_private.live_hash(p_tok);
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  if v_perm is null or v_n = 0 then
    return p_answer;
  end if;
  if jsonb_typeof(p_answer -> 'choice') = 'number' and (p_answer ->> 'choice')::integer between 0 and v_n - 1 then
    v := jsonb_set(p_answer, '{choice}', to_jsonb(array_position(v_perm, (p_answer ->> 'choice')::smallint) - 1));
  elsif jsonb_typeof(p_answer -> 'picks') = 'array' then
    v := jsonb_build_object('picks', (select jsonb_agg(case when jsonb_typeof(x) = 'number' and (x #>> '{}')::integer between 0 and v_n - 1
                                                            then to_jsonb(array_position(v_perm, (x #>> '{}')::smallint) - 1) else x end)
                                        from jsonb_array_elements(p_answer -> 'picks') x));
  end if;
  return v;
end;
$fn$;
create or replace function pg_temp.answer(p_code text, p_tok text, p_qi integer, p_answer jsonb) returns jsonb language plpgsql as $fn$
begin
  return public.challenge_answer(p_code, p_tok, p_qi, pg_temp.in_run(p_code, p_tok, p_qi, p_answer));
end;
$fn$;
create or replace function pg_temp.cs(p_code text, p_tok text) returns jsonb language sql as $fn$
  select public.challenge_state(p_code, p_tok)
$fn$;
create or replace function pg_temp.cn(p_code text, p_tok text, p_qi integer) returns text language sql as $fn$
  select pg_temp.e(format('select public.challenge_next(%L, %L, %s)', p_code, p_tok, p_qi))
$fn$;
create or replace function pg_temp.ca(p_code text, p_tok text, p_qi integer, p_answer jsonb) returns text language sql as $fn$
  select pg_temp.e(format('select pg_temp.answer(%L, %L, %s, %L)', p_code, p_tok, p_qi, p_answer))
$fn$;
create or replace function pg_temp.dl(p_hours numeric default 24) returns text language sql stable as $fn$
  select (now() + make_interval(secs => (p_hours * 3600)::double precision))::text
$fn$;
-- No token and no sha256 in a JSON (the hashes are 64 hex characters; the tokens of this file start with «tok»).
create or replace function pg_temp.clean(p jsonb) returns boolean language sql immutable as $fn$
  select p::text !~ '[0-9a-f]{64}' and p::text !~ 'tok0'
$fn$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- ─── 1. Exams: the kinds a challenge plays, one that plays nothing, one for the battle's mirror ───
do $t$
declare r jsonb; v_c text; v_stem text;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.container_create('Соревнование', null, '[{"title":"Всё"}]');
  v_c := r ->> 'container_id';
  perform pg_temp.put('k', v_c);
  perform pg_temp.put('ks', r -> 'subjects' -> 0 ->> 'id');
  v_stem := v_c || '/' || repeat('a', 64) || '.png';
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'c:1', 'stem', 'Один верный', 'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct', jsonb_build_array(1),
                       'explanation', 'Потому что b'),
    jsonb_build_object('ref', 'c:2', 'stem', 'Два верных', 'kind', 'multiple', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e'),
                       'correct', jsonb_build_array(0, 3)),
    jsonb_build_object('ref', 'c:3', 'stem', 'Столица России', 'kind', 'short', 'answers', jsonb_build_array('Москва'),
                       'explanation', 'Москва — столица'),
    jsonb_build_object('ref', 'c:4', 'stem', 'Высота башни', 'kind', 'number', 'answers', jsonb_build_array('42'), 'tolerance', 0.5, 'unit', 'м'),
    jsonb_build_object('ref', 'c:5', 'stem', 'Схема', 'options', jsonb_build_array('1:1', '1:N'), 'correct', jsonb_build_array(1),
                       'images', jsonb_build_object('stem', jsonb_build_array(v_stem), 'options', '[[], []]'::jsonb)),
    jsonb_build_object('ref', 'c:6', 'stem', 'По порядку', 'kind', 'order', 'options', jsonb_build_array('раз', 'два', 'три'))));
  r := public.container_create('Только порядок', null, '[{"title":"Всё"}]');
  perform pg_temp.put('e', r ->> 'container_id');
  perform pg_temp.put('es', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'e:1', 'stem', 'По порядку', 'kind', 'order', 'options', jsonb_build_array('раз', 'два', 'три')),
    jsonb_build_object('ref', 'e:2', 'stem', 'Схема', 'options', jsonb_build_array('1:1', '1:N'), 'correct', jsonb_build_array(1),
                       'images', jsonb_build_object('stem', jsonb_build_array((r ->> 'container_id') || '/' || repeat('c', 64) || '.png'),
                                                    'options', '[[], []]'::jsonb))));
  -- the mirror: nine questions whose order (by the stem) and kinds the script below plays
  r := public.container_create('Зеркало', null, '[{"title":"Всё"}]');
  perform pg_temp.put('m', r ->> 'container_id');
  perform pg_temp.put('ms', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'm:0', 'stem', 'P0 один', 'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct', jsonb_build_array(2)),
    jsonb_build_object('ref', 'm:1', 'stem', 'P1 число', 'kind', 'number', 'answers', jsonb_build_array('1024'), 'tolerance', 0),
    jsonb_build_object('ref', 'm:2', 'stem', 'P2 два верных', 'kind', 'multiple', 'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct', jsonb_build_array(1, 2)),
    jsonb_build_object('ref', 'm:3', 'stem', 'P3 один', 'options', jsonb_build_array('a', 'b', 'c'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'm:4', 'stem', 'P4 текст', 'kind', 'short', 'answers', jsonb_build_array('да')),
    jsonb_build_object('ref', 'm:5', 'stem', 'P5 текст', 'kind', 'short', 'answers', jsonb_build_array('нет', 'не')),
    jsonb_build_object('ref', 'm:6', 'stem', 'P6 один', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e', 'f'), 'correct', jsonb_build_array(5)),
    jsonb_build_object('ref', 'm:7', 'stem', 'P7 число', 'kind', 'number', 'answers', jsonb_build_array('3.14'), 'tolerance', 0.01),
    jsonb_build_object('ref', 'm:8', 'stem', 'P8 два верных', 'kind', 'multiple', 'options', jsonb_build_array('a', 'b', 'c'), 'correct', jsonb_build_array(0, 2))));
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 2. The author's create: its refusals, the kinds, the frozen questions ───
do $t$
declare r jsonb; v_src text := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 4}', pg_temp.c('k'), pg_temp.c('ks'));
        v_ok text := format('{"deadline": "%s"}', pg_temp.dl());
begin
  perform pg_temp.who('anon');
  perform pg_temp.eq('anon cannot even call it', split_part(pg_temp.e(format('select public.challenge_create(%L, %L)', v_src, v_ok)), '/', 1), '42501');
  perform pg_temp.who('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
  perform pg_temp.eq('someone else''s exam', pg_temp.e(format('select public.challenge_create(%L, %L)', v_src, v_ok)), '42501/author@403');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('no deadline', pg_temp.e(format('select public.challenge_create(%L, %L)', v_src, '{}')), '22023/deadline@400');
  perform pg_temp.eq('a deadline in a minute', pg_temp.e(format('select public.challenge_create(%L, %L)', v_src, format('{"deadline": "%s"}', pg_temp.dl(0.01)))), '22023/deadline@400');
  perform pg_temp.eq('a deadline in 31 days', pg_temp.e(format('select public.challenge_create(%L, %L)', v_src, format('{"deadline": "%s"}', pg_temp.dl(31 * 24)))), '22023/deadline@400');
  perform pg_temp.eq('a deadline that is no time', pg_temp.e(format('select public.challenge_create(%L, %L)', v_src, '{"deadline": "2026-13-45 99:99"}')), '22023/deadline@400');
  perform pg_temp.eq('15 s is the stand game''s', pg_temp.e(format('select public.challenge_create(%L, %L)', v_src, format('{"deadline": "%s", "time_s": 15}', pg_temp.dl()))), '22023/time_s@400');
  perform pg_temp.eq('calm as text', pg_temp.e(format('select public.challenge_create(%L, %L)', v_src, format('{"deadline": "%s", "calm": "yes"}', pg_temp.dl()))), '22023/calm@400');
  perform pg_temp.eq('two questions', pg_temp.e(format('select public.challenge_create(%L, %L)',
    format('{"container_id": "%s", "subject_ids": ["%s"], "count": 2}', pg_temp.c('k'), pg_temp.c('ks')), v_ok)), '22023/count@400');
  perform pg_temp.eq('nothing playable: order and a picture', pg_temp.e(format('select public.challenge_create(%L, %L)',
    format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('e'), pg_temp.c('es')), v_ok)), 'ML008/2@400');
  r := public.challenge_create(v_src::jsonb, format('{"deadline": "%s", "time_s": 20}', pg_temp.dl())::jsonb);
  perform pg_temp.eq('create', pg_temp.keys(r) || '/' || (r ->> 'q_count') || '/' || (r ->> 'skipped') || '/' || (r ->> 'path' = '/s/' || (r ->> 'code'))::text,
                     'challenge_id,code,deadline,path,q_count,skipped,url/4/2/true');
  perform pg_temp.yes('a link code of 12', (r ->> 'code') ~ '^[0-9a-hjkmnp-tv-z]{12}$');
  perform pg_temp.put('a', r ->> 'challenge_id');
  perform pg_temp.put('ac', r ->> 'code');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the four kinds, no picture, no order', (select string_agg(kind, ',' order by kind) from public.live_challenge_questions
                     where challenge_id = pg_temp.g('a')), 'multiple,number,short,single');
  perform pg_temp.eq('the questions are a copy', (select string_agg(coalesce(explanation, '-') || ':' || coalesce(unit, '-') || ':' || coalesce(tolerance::text, '-'), ',' order by text)
                     from public.live_challenge_questions where challenge_id = pg_temp.g('a')), '-:м:0.5,-:-:-,Потому что b:-:-,Москва — столица:-:-');
  update public.test_items set stem = 'Изменён' where stem = 'Один верный';
  perform pg_temp.eq('an edit of the exam does not change it', (select count(*) from public.live_challenge_questions
                     where challenge_id = pg_temp.g('a') and text = 'Один верный')::text, '1');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.challenge_create(v_src::jsonb, format('{"deadline": "%s", "calm": true, "speed": true}', pg_temp.dl(48))::jsonb);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('calm keeps no points for speed', (select calm || '/' || speed || '/' || time_s from public.live_challenges where id = (r ->> 'challenge_id')::uuid), 'true/false/20');
end
$t$;

-- ─── 3. The link's info and the start ───
do $t$
declare r jsonb; s jsonb; v_code text := pg_temp.c('ac');
begin
  perform pg_temp.who('anon');
  perform pg_temp.eq('no such link', pg_temp.e('select public.challenge_info(''zzzzzzzzzzzz'')'), 'P0002/code@404');
  perform pg_temp.eq('not a link code', pg_temp.e('select public.challenge_info(''x'')'), 'P0002/code@404');
  r := public.challenge_info(v_code);
  perform pg_temp.eq('info', pg_temp.keys(r) || '/' || (r ->> 'state') || '/' || (r ->> 'finished') || '/' || (r ->> 'title'),
                     'code,deadline,finished,now,over,playing,q_count,speed,state,time_s,title/open/0/Соревнование');
  perform pg_temp.eq('a token of the wrong shape', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Дима', 'short')), '22023/token@400');
  perform pg_temp.eq('a rude name', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Су-ка', pg_temp.tok(1))), 'ML006/rude@400');
  perform pg_temp.eq('a long name', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, repeat('я', 25), pg_temp.tok(1))), 'ML006/length@400');
  perform pg_temp.eq('an unknown part', pg_temp.e(format('select public.challenge_join(%L, %L, %L, %L)', v_code, 'Дима', pg_temp.tok(1),
    '{"body": "star", "colour": "blue", "eyes": "round", "hat": "none"}')), 'ML007/unknown_part@400');
  perform pg_temp.eq('a part a guest has not opened', pg_temp.e(format('select public.challenge_join(%L, %L, %L, %L)', v_code, 'Дима', pg_temp.tok(1),
    '{"body": "round", "colour": "blue", "eyes": "round", "hat": "crown"}')), 'ML007/locked@400');
  perform pg_temp.eq('nothing was made by the refusals', (pg_temp.sudo(format('select to_jsonb(count(*)) from public.live_runs where challenge_id = %L', pg_temp.g('a'))))::text, '0');
  s := public.challenge_join(v_code, '  Дима  ', pg_temp.tok(1), '{"body": "cloud", "colour": "teal", "eyes": "dots", "hat": "cap"}');
  perform pg_temp.eq('the start', pg_temp.keys(s) || '/' || pg_temp.keys(s -> 'run') || '/' || (s -> 'run' ->> 'name') || '/' || (s -> 'run' ->> 'qi') || '/' ||
                     (s -> 'run' -> 'boss' ->> 'hp') || '/' || (s -> 'run' -> 'boss' ->> 'hp_max') || '/' || coalesce(s ->> 'question', 'null'),
                     'answer,challenge,now,question,result,run/best,boss,dmg,finished,frozen,look,name,place,qi,right,streak,time_ms/Дима/-1/220/220/null');
  perform pg_temp.yes('no token, no hash in the answer', pg_temp.clean(s));
  perform pg_temp.put('r1', pg_temp.run(pg_temp.g('a'), pg_temp.tok(1))::text);
  s := public.challenge_join(v_code, 'Другое имя', pg_temp.tok(1), null);
  perform pg_temp.eq('the same token: the same run, as it was', (s -> 'run' ->> 'name') || '/' ||
                     (pg_temp.sudo(format('select to_jsonb(count(*)) from public.live_runs where challenge_id = %L', pg_temp.g('a'))))::text, 'Дима/1');
  -- a signed-in player: one run an account; a new token from another device takes it over
  perform pg_temp.who('authenticated', 'cccccccc-0000-0000-0000-000000000003');
  s := public.challenge_join(v_code, 'Лена', pg_temp.tok(2), null);
  perform pg_temp.put('r2', pg_temp.run(pg_temp.g('a'), pg_temp.tok(2))::text);
  s := public.challenge_join(v_code, 'Лена с ноутбука', pg_temp.tok(3), null);
  perform pg_temp.eq('the account''s run with the new token', (s -> 'run' ->> 'name') || '/' || (pg_temp.run(pg_temp.g('a'), pg_temp.tok(3)) = pg_temp.g('r2'))::text, 'Лена/true');
  perform pg_temp.who('anon');
  perform pg_temp.eq('the old token stops working', pg_temp.e(format('select public.challenge_state(%L, %L)', v_code, pg_temp.tok(2))), 'P0002/token@404');
  perform pg_temp.eq('a token of no run', pg_temp.e(format('select public.challenge_state(%L, %L)', v_code, pg_temp.tok(99))), 'P0002/token@404');
  perform pg_temp.eq('a run of another link', pg_temp.e(format('select public.challenge_state(%L, %L)', 'zzzzzzzzzzzz', pg_temp.tok(1))), 'P0002/code@404');
  perform pg_temp.eq('a guest''s run has no account', (pg_temp.rrow(pg_temp.g('r1')) ->> 'user_id') || '/' || (pg_temp.rrow(pg_temp.g('r2')) ->> 'user_id'),
                     null);
  perform pg_temp.eq('the account is kept', pg_temp.rrow(pg_temp.g('r2')) ->> 'user_id', 'cccccccc-0000-0000-0000-000000000003');
end
$t$;

-- ─── 4. A run: the server's clock, the kinds, the key only after the answer or the end of its time ───
do $t$
declare s jsonb; v_code text := pg_temp.c('ac'); v_run uuid := pg_temp.g('r1'); v_q jsonb; v_qi integer; v_dmg integer := 0;
begin
  perform pg_temp.who('anon');
  perform pg_temp.eq('not the next question', pg_temp.cn(v_code, pg_temp.tok(1), 1), 'ML004/bad_qi@400');
  perform pg_temp.eq('no answer before a question', pg_temp.ca(v_code, pg_temp.tok(1), 0, '{"choice": 0}'), 'ML004/bad_qi@400');
  s := public.challenge_next(v_code, pg_temp.tok(1), 0);
  v_q := pg_temp.cq(pg_temp.g('a'), 0);
  perform pg_temp.eq('the first question', (s -> 'question' ->> 'qi') || '/' || (s -> 'run' ->> 'qi') || '/' || coalesce(s ->> 'result', 'null') || '/' ||
                     coalesce(s ->> 'answer', 'null') || '/' || (s -> 'question' ->> 'text'), '0/0/null/null/' || (v_q ->> 'text'));
  perform pg_temp.yes('no key, no forms, no explanation before the answer', s::text !~ '"(key|keys|forms|tolerance|explanation)"');
  perform pg_temp.yes('three seconds to read: the answers open then', (extract(epoch from ((s -> 'question' ->> 'opens_at')::timestamptz - now())) between 2.9 and 3.1)
                      and (extract(epoch from ((s -> 'question' ->> 'closes_at')::timestamptz - (s -> 'question' ->> 'opens_at')::timestamptz)) = 20));
  perform pg_temp.eq('too early', pg_temp.ca(v_code, pg_temp.tok(1), 0, pg_temp.right_of(v_q)), 'ML004/early@400');
  perform pg_temp.rtick(v_run, 3);
  perform pg_temp.eq('the other kind', pg_temp.ca(v_code, pg_temp.tok(1), 0, case when v_q ->> 'kind' in ('single', 'multiple') then '{"text": "a"}'::jsonb else '{"choice": 0}'::jsonb end),
                     'ML004/kind@400');
  perform pg_temp.eq('an answer of no shape', pg_temp.ca(v_code, pg_temp.tok(1), 0, '{"choice": 0, "text": "a"}'), '22023/answer@400');
  perform pg_temp.eq('an option that is not there', pg_temp.ca(v_code, pg_temp.tok(1), 0, case when v_q ->> 'kind' in ('single', 'multiple') then '{"choice": 6}'::jsonb else '{"text": ""}'::jsonb end),
                     '22023/answer@400');
  perform pg_temp.eq('nothing graded by the refusals', pg_temp.ra(v_run, 0) ->> 'settled_at', null);
  perform pg_temp.rtick(v_run, 1);
  s := pg_temp.answer(v_code, pg_temp.tok(1), 0, pg_temp.right_of(v_q));
  perform pg_temp.eq('right at 1 s of 20: the battle''s damage', (s -> 'result' ->> 'correct') || '/' || (s -> 'result' ->> 'dmg') || '/' || (s -> 'result' ->> 'elapsed_ms') || '/' ||
                     (s -> 'run' ->> 'dmg') || '/' || (s -> 'run' ->> 'streak') || '/' || (s -> 'run' -> 'boss' ->> 'hp'),
                     'true/98/1000/98/1/122');
  perform pg_temp.yes('now the key and the explanation', (s -> 'result') ? 'key' and ((s -> 'result' ? 'explanation') = (v_q ->> 'explanation' is not null)));
  perform pg_temp.eq('the own answer', pg_temp.keys(s -> 'answer'), case when v_q ->> 'kind' = 'single' then 'choice,elapsed_ms'
                                                                         when v_q ->> 'kind' = 'multiple' then 'elapsed_ms,picks' else 'elapsed_ms,typed' end);
  perform pg_temp.eq('twice', pg_temp.ca(v_code, pg_temp.tok(1), 0, pg_temp.right_of(v_q)), 'ML004/twice@400');
  s := public.challenge_next(v_code, pg_temp.tok(1), 0);
  perform pg_temp.eq('asking for the same question again opens nothing', (s -> 'run' ->> 'qi') || '/' || (s -> 'result' ->> 'correct'), '0/true');
  perform pg_temp.eq('no jumping ahead', pg_temp.cn(v_code, pg_temp.tok(1), 2), 'ML004/bad_qi@400');
  -- the second question: no answer; the time is the server's
  s := public.challenge_next(v_code, pg_temp.tok(1), 1);
  perform pg_temp.eq('no next before this one is done', pg_temp.cn(v_code, pg_temp.tok(1), 2), 'ML004/not_done@400');
  perform pg_temp.rtick(v_run, 3 + 21);
  s := pg_temp.cs(v_code, pg_temp.tok(1));
  perform pg_temp.eq('still within the 1.5 s of grace: no result yet', coalesce(s ->> 'result', 'null'), 'null');
  perform pg_temp.rtick(v_run, 1);
  s := pg_temp.cs(v_code, pg_temp.tok(1));
  -- 98 of 220 put the boss in phase 1 («Дедлайн злится»): the question opened in it, so no answer freezes as in the battle
  perform pg_temp.eq('the time ran out: no answer, the key now, frozen by the angry boss', (s -> 'result' ->> 'none') || '/' || (s -> 'result' ->> 'correct') || '/' || (s -> 'result' ->> 'dmg') || '/' ||
                     ((s -> 'result') ? 'key')::text || '/' || (s -> 'run' ->> 'streak') || '/' || (s -> 'run' ->> 'time_ms') || '/' || (s -> 'run' ->> 'frozen'),
                     'true/false/0/true/0/21000/true');
  perform pg_temp.eq('too late', pg_temp.ca(v_code, pg_temp.tok(1), 1, pg_temp.right_of(pg_temp.cq(pg_temp.g('a'), 1))), 'ML004/late@400');
  -- the third: wrong (frozen); the fourth: right (thaws: no damage)
  perform public.challenge_next(v_code, pg_temp.tok(1), 2);
  perform pg_temp.rtick(v_run, 5);
  s := pg_temp.answer(v_code, pg_temp.tok(1), 2, pg_temp.wrong_of(pg_temp.cq(pg_temp.g('a'), 2)));
  perform pg_temp.eq('wrong: frozen', (s -> 'result' ->> 'correct') || '/' || (s -> 'result' ->> 'frozen') || '/' || (s -> 'run' ->> 'frozen'), 'false/true/true');
  perform pg_temp.eq('the run is not over', (s -> 'run' ->> 'finished') || '/' || coalesce(s -> 'run' ->> 'place', 'null'), 'false/null');
  perform public.challenge_next(v_code, pg_temp.tok(1), 3);
  perform pg_temp.rtick(v_run, 4);
  s := pg_temp.answer(v_code, pg_temp.tok(1), 3, pg_temp.right_of(pg_temp.cq(pg_temp.g('a'), 3)));
  perform pg_temp.eq('right while frozen: thawed, no damage', (s -> 'result' ->> 'correct') || '/' || (s -> 'result' ->> 'thawed') || '/' || (s -> 'result' ->> 'dmg') || '/' ||
                     (s -> 'run' ->> 'frozen') || '/' || (s -> 'run' ->> 'dmg') || '/' || (s -> 'run' ->> 'right'), 'true/true/0/false/98/2');
  perform pg_temp.eq('the last question: the run is finished, first of one', (s -> 'run' ->> 'finished') || '/' || (s -> 'run' ->> 'place') || '/' ||
                     (s -> 'challenge' ->> 'finished') || '/' || (s -> 'run' ->> 'time_ms'), 'true/1/1/' || (1000 + 20000 + 2000 + 1000)::text);
  s := public.challenge_next(v_code, pg_temp.tok(1), 4);
  perform pg_temp.eq('after the last nothing opens', (s -> 'run' ->> 'qi') || '/' || (s -> 'run' ->> 'finished'), '3/true');
  perform pg_temp.yes('no token, no hash', pg_temp.clean(s));
  -- the other run sees only its own
  perform pg_temp.who('authenticated', 'cccccccc-0000-0000-0000-000000000003');
  s := pg_temp.cs(v_code, pg_temp.tok(3));
  perform pg_temp.eq('another run is its own', (s -> 'run' ->> 'name') || '/' || (s -> 'run' ->> 'qi') || '/' || coalesce(s ->> 'question', 'null'), 'Лена/-1/null');
end
$t$;

-- ─── 5. The grading is the battle's: one player's battle and a run of the same questions with the same answers ───
do $t$
declare r jsonb; h jsonb; s jsonb; v_g uuid; v_host text; v_ch uuid; v_code text; v_run uuid; v_qi integer; v_q jsonb; v_a jsonb;
        v_play text[];
        v_ms integer[] := array[1000, 5000, 2000, 0, 3000, 4000, 0, 19000, 1000];
        v_calm boolean; v_lp jsonb; v_rr jsonb; v_live text; v_mine text; v_n integer := 0;
begin
  foreach v_calm in array array[false, true] loop
    -- the boss lives to the last question in both (the battle would end at its defeat): with points for speed it goes
    -- through phase 1 (no answer freezes), a thaw, phase 2 and a heal; «Без спешки» through both phases and a heal
    v_play := case when v_calm then array['right', 'wrong', 'part', 'none', 'wrong', 'right', 'none', 'right', 'wrong']
                   else array['right', 'right', 'part', 'none', 'wrong', 'right', 'right', 'right', 'wrong'] end;
    perform pg_temp.who('postgres');
    update public.live_games set state = 'ended', ended_at = now() where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001' and state <> 'ended';
    perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
    r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 9}', pg_temp.c('m'), pg_temp.c('ms'))::jsonb,
                            jsonb_build_object('time_s', 20, 'calm', v_calm));
    v_g := (r ->> 'game_id')::uuid;
    v_host := r ->> 'host_token';
    perform pg_temp.who('anon');
    perform public.live_join(r ->> 'pin', 'Зеркало', pg_temp.tok(70), null);
    perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
    r := public.challenge_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 9}', pg_temp.c('m'), pg_temp.c('ms'))::jsonb,
                                 jsonb_build_object('time_s', 20, 'calm', v_calm, 'deadline', pg_temp.dl()));
    v_ch := (r ->> 'challenge_id')::uuid;
    v_code := r ->> 'code';
    -- the same nine questions in the same order with the same shown options: the game's, by the stem, copied to the challenge
    perform pg_temp.who('postgres');
    update public.live_questions set qi = qi + 20 where game_id = v_g;
    update public.live_questions q set qi = o.n
      from (select x.qi, (row_number() over (order by x.text) - 1)::smallint as n from public.live_questions x where x.game_id = v_g) o
     where q.game_id = v_g and q.qi = o.qi;
    delete from public.live_challenge_questions where challenge_id = v_ch;
    insert into public.live_challenge_questions (challenge_id, qi, item_id, kind, text, options, shown, key, keys, forms, tolerance, unit, explanation)
    select v_ch, q.qi, q.item_id, q.kind, q.text, q.options, q.shown, q.key, q.keys, q.forms, q.tolerance, q.unit, q.explanation
      from public.live_questions q where q.game_id = v_g;
    perform pg_temp.eq('the same order', (select string_agg(left(text, 2), ',' order by qi) from public.live_challenge_questions where challenge_id = v_ch),
                       'P0,P1,P2,P3,P4,P5,P6,P7,P8');
    perform pg_temp.who('anon');
    perform public.challenge_join(v_code, 'Зеркало', pg_temp.tok(71), null);
    v_run := pg_temp.run(v_ch, pg_temp.tok(71));
    for v_qi in 0 .. 8 loop
      v_q := pg_temp.qrow(v_g, v_qi);
      v_a := case v_play[v_qi + 1] when 'right' then pg_temp.right_of(v_q) when 'part' then pg_temp.part_of(v_q)
                                    when 'wrong' then pg_temp.wrong_of(v_q) end;
      -- the battle
      h := public.live_next(v_g, v_host, case when v_qi = 0 then 'lobby' else 'leaderboard' end);
      perform pg_temp.tick(v_g, 3);
      if v_a is null then
        perform pg_temp.tick(v_g, 21.6);
      else
        perform pg_temp.tick(v_g, v_ms[v_qi + 1] / 1000.0);
        perform pg_temp.eq('battle answer ' || v_qi, pg_temp.e(format('select public.live_submit(%L, %L, %s, %L)', v_g, pg_temp.tok(70), v_qi, v_a)), 'ok');
      end if;
      h := public.live_host_state(v_g, v_host);
      perform pg_temp.eq('battle closed ' || v_qi, h ->> 'state', 'reveal');
      -- the run
      perform pg_temp.eq('run next ' || v_qi, pg_temp.cn(v_code, pg_temp.tok(71), v_qi), 'ok');
      perform pg_temp.rtick(v_run, 3);
      if v_a is null then
        perform pg_temp.rtick(v_run, 21.6);
        s := pg_temp.cs(v_code, pg_temp.tok(71));
      else
        perform pg_temp.rtick(v_run, v_ms[v_qi + 1] / 1000.0);
        s := pg_temp.answer(v_code, pg_temp.tok(71), v_qi, v_a);
      end if;
      -- the same verdict, damage, streak, ice, boss
      v_lp := pg_temp.sudo(format('select to_jsonb(p) from public.live_players p where p.game_id = %L', v_g));
      v_rr := pg_temp.rrow(v_run);
      v_live := coalesce(pg_temp.sudo(format('select to_jsonb(coalesce(a.correct, false)::text || '':'' || coalesce(a.dmg, 0)) from public.live_answers a where a.game_id = %L and a.qi = %s', v_g, v_qi)) #>> '{}', 'false:0')
                || '/' || (v_lp ->> 'dmg') || '/' || (v_lp ->> 'streak') || '/' || (v_lp ->> 'best') || '/' || (v_lp ->> 'frozen') || '/' || (v_lp ->> 'right_n')
                || '/' || (v_lp ->> 'thaws') || '/' || (h -> 'boss' ->> 'hp') || '/' || (h -> 'boss' ->> 'phase') || '/' || (h -> 'result' ->> 'healed');
      v_mine := (s -> 'result' ->> 'correct') || ':' || (s -> 'result' ->> 'dmg')
                || '/' || (v_rr ->> 'dmg') || '/' || (v_rr ->> 'streak') || '/' || (v_rr ->> 'best') || '/' || (v_rr ->> 'frozen') || '/' || (v_rr ->> 'right_n')
                || '/' || (v_rr ->> 'thaws') || '/' || (v_rr ->> 'hp') || '/' || (v_rr ->> 'phase') || '/' || (s -> 'result' ->> 'healed');
      perform pg_temp.eq(format('calm %s, question %s (%s, %s ms): the battle and the run agree', v_calm, v_qi, v_play[v_qi + 1], v_ms[v_qi + 1]), v_mine, v_live);
      v_n := v_n + 1;
      if v_qi < 8 then
        h := public.live_next(v_g, v_host, 'reveal');
      end if;
    end loop;
    perform pg_temp.yes('the script plays the boss''s phases, a freeze, a thaw and a heal', v_calm or ((v_rr ->> 'phase')::integer = 2
      and (v_rr ->> 'thaws')::integer = 1 and exists (select 1 from jsonb_array_elements(pg_temp.sudo(format('select jsonb_agg(a.healed) from public.live_run_answers a where a.run_id = %L', v_run))) x where (x #>> '{}')::integer > 0)));
    perform pg_temp.yes('calm: 100 a right answer, half of it for half the ticks, nobody froze, a heal', not v_calm or ((v_rr ->> 'thaws')::integer = 0
      and not (v_rr ->> 'frozen')::boolean and (v_rr ->> 'dmg')::integer = 100 * (v_rr ->> 'right_n')::integer + 50 and (v_rr ->> 'phase')::integer = 2
      and exists (select 1 from jsonb_array_elements(pg_temp.sudo(format('select jsonb_agg(a.healed) from public.live_run_answers a where a.run_id = %L', v_run))) x where (x #>> '{}')::integer > 0)));
    perform pg_temp.eq('the run is finished', s -> 'run' ->> 'finished', 'true');
  end loop;
  perform pg_temp.eq('eighteen questions compared', v_n::text, '18');
end
$t$;

-- ─── 6. The table: points, then right answers, then the shorter time; equal on all three share a place ───
do $t$
declare r jsonb; b jsonb; v_ch uuid; v_code text; v_n integer;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.challenge_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 4}', pg_temp.c('k'), pg_temp.c('ks'))::jsonb,
                               format('{"deadline": "%s"}', pg_temp.dl())::jsonb);
  v_ch := (r ->> 'challenge_id')::uuid;
  v_code := r ->> 'code';
  perform pg_temp.put('b', v_ch::text);
  perform pg_temp.put('bc', v_code);
  perform pg_temp.who('anon');
  b := public.challenge_board(v_code);
  perform pg_temp.eq('an empty table', pg_temp.keys(b) || '/' || (b ->> 'top') || '/' || coalesce(b ->> 'me', 'null'), 'challenge,me,now,top/[]/null');
  for v_n in 31 .. 37 loop
    perform public.challenge_join(v_code, (array['Аня', 'Боря', 'Вика', 'Гоша', 'Даня', 'Ева', 'Жора'])[v_n - 30], pg_temp.tok(v_n), null);
  end loop;
  perform pg_temp.who('postgres');
  update public.live_runs r set dmg = x.d, right_n = x.rn, time_ms = x.t, qi = 3, finished_at = now() - make_interval(secs => x.f)
    from (values ('Аня', 500, 4, 30000, 50), ('Боря', 500, 4, 25000, 40), ('Вика', 500, 5, 40000, 30), ('Гоша', 300, 3, 10000, 20),
                 ('Даня', 500, 4, 25000, 10), ('Жора', 0, 0, 80000, 5)) as x(n, d, rn, t, f)
   where r.challenge_id = v_ch and r.name = x.n;
  update public.live_runs set qi = 1 where challenge_id = v_ch and name = 'Ева';
  perform pg_temp.who('anon');
  b := public.challenge_board(v_code, pg_temp.tok(35));
  perform pg_temp.eq('the order and the places', (select string_agg((x ->> 'place') || ':' || (x ->> 'name'), ',' order by o) from jsonb_array_elements(b -> 'top') with ordinality t(x, o)),
                     '1:Вика,2:Боря,2:Даня,4:Аня,5:Гоша,6:Жора');
  perform pg_temp.eq('the own row', (b -> 'me' ->> 'place') || '/' || (b -> 'me' ->> 'finished') || '/' ||
                     (select count(*) from jsonb_array_elements(b -> 'top') x where x ? 'me')::text || '/' ||
                     (select x ->> 'name' from jsonb_array_elements(b -> 'top') x where x ? 'me'), '2/true/1/Даня');
  perform pg_temp.eq('a row', pg_temp.keys(b -> 'top' -> 0), 'dmg,look,name,place,right,time_ms');
  perform pg_temp.eq('who plays now', (b -> 'challenge' ->> 'finished') || '/' || (b -> 'challenge' ->> 'playing'), '6/1');
  b := public.challenge_board(v_code, pg_temp.tok(36));
  perform pg_temp.eq('one under way is not on the table yet', (b -> 'me' ->> 'finished') || '/' || coalesce(b -> 'me' ->> 'place', 'null') || '/' ||
                     (select count(*) from jsonb_array_elements(b -> 'top') x where x ? 'me')::text, 'false/null/0');
  b := public.challenge_board(v_code, 'not a token');
  perform pg_temp.eq('a wrong token: the table without a row of one''s own', coalesce(b ->> 'me', 'null') || '/' || jsonb_array_length(b -> 'top'), 'null/6');
  perform pg_temp.yes('no token, no hash on the table', pg_temp.clean(b));
  perform pg_temp.eq('a run''s own state says the same place', pg_temp.cs(v_code, pg_temp.tok(32)) -> 'run' ->> 'place', '2');
  -- the author takes one off
  perform pg_temp.who('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
  perform pg_temp.eq('not the author', pg_temp.e(format('select public.challenge_remove(%L, %L)', v_ch, pg_temp.run(v_ch, pg_temp.tok(32)))), '42501/author@403');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('a run of another challenge', pg_temp.e(format('select public.challenge_remove(%L, %L)', v_ch, pg_temp.g('r1'))), 'P0002/run@404');
  perform public.challenge_remove(v_ch, pg_temp.run(v_ch, pg_temp.tok(32)));
  perform pg_temp.who('anon');
  b := public.challenge_board(v_code);
  perform pg_temp.eq('off the table', (select string_agg((x ->> 'place') || ':' || (x ->> 'name'), ',' order by o) from jsonb_array_elements(b -> 'top') with ordinality t(x, o)),
                     '1:Вика,2:Даня,3:Аня,4:Гоша,5:Жора');
  perform pg_temp.eq('its token stops working', pg_temp.e(format('select public.challenge_state(%L, %L)', v_code, pg_temp.tok(32))), '42501/removed@403');
  perform pg_temp.eq('nor can it start again', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Боря', pg_temp.tok(32))), '42501/removed@403');
end
$t$;

-- ─── 7. The early close and the end: the open question may still be answered; the sweep ends the rest ───
do $t$
declare r jsonb; s jsonb; v_ch uuid; v_code text; v_q jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.challenge_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 4}', pg_temp.c('k'), pg_temp.c('ks'))::jsonb,
                               format('{"deadline": "%s"}', pg_temp.dl())::jsonb);
  v_ch := (r ->> 'challenge_id')::uuid;
  v_code := r ->> 'code';
  perform pg_temp.put('d', v_ch::text);
  perform pg_temp.put('dc', v_code);
  perform pg_temp.who('anon');
  perform public.challenge_join(v_code, 'Миша', pg_temp.tok(41), null);
  perform public.challenge_join(v_code, 'Нина', pg_temp.tok(42), null);
  perform public.challenge_join(v_code, 'Оля', pg_temp.tok(43), null);
  -- Миша is on question 2, its time running; Оля opened question 1 and went away
  perform public.challenge_next(v_code, pg_temp.tok(41), 0);
  perform pg_temp.rtick(pg_temp.run(v_ch, pg_temp.tok(41)), 4);
  perform pg_temp.answer(v_code, pg_temp.tok(41), 0, pg_temp.right_of(pg_temp.cq(v_ch, 0)));
  perform public.challenge_next(v_code, pg_temp.tok(41), 1);
  perform public.challenge_next(v_code, pg_temp.tok(43), 0);
  perform pg_temp.who('anon');
  perform pg_temp.eq('anon cannot close', split_part(pg_temp.e(format('select public.challenge_close(%L)', v_ch)), '/', 1), '42501');
  perform pg_temp.who('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
  perform pg_temp.eq('not the author''s', pg_temp.e(format('select public.challenge_close(%L)', v_ch)), '42501/author@403');
  perform pg_temp.eq('no such challenge', pg_temp.e(format('select public.challenge_close(%L)', gen_random_uuid())), 'P0002/challenge@404');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.challenge_close(v_ch);
  perform pg_temp.eq('closed early', (r ->> 'closed') || '/' || (r ->> 'state') || '/' || (r ->> 'over'), 'true/over/closed');
  r := public.challenge_close(v_ch);
  perform pg_temp.eq('twice is fine', (r ->> 'closed') || '/' || (r ->> 'state'), 'true/over');
  perform pg_temp.who('anon');
  perform pg_temp.eq('no new start', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Петя', pg_temp.tok(44))), 'ML002/closed@400');
  perform pg_temp.eq('one who never started gets no question', pg_temp.cn(v_code, pg_temp.tok(42), 0), 'ML002/closed@400');
  perform pg_temp.rtick(pg_temp.run(v_ch, pg_temp.tok(41)), 5);
  s := pg_temp.answer(v_code, pg_temp.tok(41), 1, pg_temp.right_of(pg_temp.cq(v_ch, 1)));
  perform pg_temp.eq('the question already open is answered in its time, and the run ends', (s -> 'result' ->> 'correct') || '/' || (s -> 'run' ->> 'finished') || '/' ||
                     (s -> 'run' ->> 'place'), 'true/true/1');
  perform pg_temp.eq('no question after the end', (pg_temp.e(format('select public.challenge_next(%L, %L, 2)', v_code, pg_temp.tok(41)))) || '/' ||
                     (pg_temp.cs(v_code, pg_temp.tok(41)) -> 'run' ->> 'qi'), 'ok/1');
  s := public.challenge_board(v_code);
  perform pg_temp.eq('before the sweep: Оля is still under way', (s -> 'challenge' ->> 'finished') || '/' || (s -> 'challenge' ->> 'playing'), '1/1');
  -- 35 s after the end every question that opened before it has run out: the next read ends Оля's run
  perform pg_temp.ctick(v_ch, 36);
  s := public.challenge_board(v_code);
  perform pg_temp.eq('after the sweep', (s -> 'challenge' ->> 'finished') || '/' || (s -> 'challenge' ->> 'playing') || '/' ||
                     (select string_agg(x ->> 'name', ',' order by o) from jsonb_array_elements(s -> 'top') with ordinality t(x, o)), '2/0/Миша,Оля');
  perform pg_temp.yes('swept once', (pg_temp.sudo(format('select to_jsonb(swept_at is not null) from public.live_challenges where id = %L', v_ch)) #>> '{}')::boolean);
  s := pg_temp.cs(v_code, pg_temp.tok(43));
  perform pg_temp.eq('Оля: her open question ran out, the run is over', (s -> 'result' ->> 'none') || '/' || (s -> 'run' ->> 'finished') || '/' || (s -> 'run' ->> 'time_ms'),
                     'true/true/20000');
  perform pg_temp.eq('Нина never started: on no table', (pg_temp.cs(v_code, pg_temp.tok(42)) -> 'run' ->> 'finished') || '/' ||
                     coalesce(pg_temp.cs(v_code, pg_temp.tok(42)) -> 'run' ->> 'place', 'null'), 'false/null');
  -- a deadline that passed
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.challenge_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 4}', pg_temp.c('k'), pg_temp.c('ks'))::jsonb,
                               format('{"deadline": "%s"}', pg_temp.dl(1))::jsonb);
  perform pg_temp.ctick((r ->> 'challenge_id')::uuid, 3601);
  perform pg_temp.who('anon');
  perform pg_temp.eq('the deadline passed', (public.challenge_info(r ->> 'code') ->> 'over') || '/' ||
                     pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', r ->> 'code', 'Петя', pg_temp.tok(45))), 'deadline/ML002/deadline@400');
end
$t$;

-- ─── 8. The review and «Тренировать ошибки» ───
do $t$
declare r jsonb; v_code text := pg_temp.c('ac'); v_n integer; v_quiz uuid; v_ch uuid; v_qi integer;
begin
  perform pg_temp.who('authenticated', 'cccccccc-0000-0000-0000-000000000003');
  perform pg_temp.eq('no review before the end', pg_temp.e(format('select public.challenge_review(%L, %L)', v_code, pg_temp.tok(3))), 'ML004/not_done@400');
  perform pg_temp.eq('no practice before the end', pg_temp.e(format('select public.challenge_practice(%L, %L)', v_code, pg_temp.tok(3))), 'ML004/not_done@400');
  perform pg_temp.who('anon');
  r := public.challenge_review(v_code, pg_temp.tok(1));
  perform pg_temp.eq('the review: the four questions of the run', jsonb_array_length(r -> 'items')::text || '/' ||
                     (select string_agg(coalesce(x ->> 'correct', 'null'), ',' order by (x ->> 'qi')::integer) from jsonb_array_elements(r -> 'items') x),
                     '4/true,false,false,true');
  perform pg_temp.yes('each with its key, the own answer and the explanation', (select bool_and(x ? 'key' and x ? 'choice'
      and (x ->> 'kind' is null or x ->> 'kind' <> 'multiple' or (x ? 'keys' and x ? 'picks' and x ? 'share'))
      and (x ->> 'kind' is null or x ->> 'kind' not in ('short', 'number') or (x ? 'forms' and x ? 'typed'))) from jsonb_array_elements(r -> 'items') x)
    and exists (select 1 from jsonb_array_elements(r -> 'items') x where x ->> 'explanation' = 'Потому что b'));
  perform pg_temp.eq('a guest: sign in first', pg_temp.e(format('select public.challenge_practice(%L, %L)', v_code, pg_temp.tok(1))), '28000/@401');
  perform pg_temp.who('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
  perform pg_temp.eq('not a member, no quiz offers it', pg_temp.e(format('select public.challenge_practice(%L, %L)', v_code, pg_temp.tok(1))), 'ML012/practice@403');
  perform pg_temp.eq('a token of no run', pg_temp.e(format('select public.challenge_practice(%L, %L)', v_code, pg_temp.tok(99))), 'P0002/token@404');
  -- the exam's author signs in on the device of the guest run (wrong, none, right after a thaw: two mistakes)
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.challenge_practice(v_code, pg_temp.tok(1));
  perform pg_temp.eq('the author: the mistakes recorded', pg_temp.keys(r) || '/' || (r ->> 'container_id') || '/' || (r ->> 'joined') || '/' || (r ->> 'saved') || '/' || (r ->> 'mistakes'),
                     'container_id,joined,mistakes,saved/' || pg_temp.c('k') || '/false/2/2');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the study log: two answers of today, by lc:<run>:<qi>', (select count(*) || '/' || bool_or(correct)::text || '/' || min(source) || '/' ||
                     bool_and(client_event_id ~ ('^lc:' || replace(pg_temp.c('r1'), '-', '') || ':[0-9]+$'))::text
                     from public.test_answers where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and client_event_id like 'lc:%'), '2/false/web/true');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.challenge_practice(v_code, pg_temp.tok(1));
  perform pg_temp.who('postgres');
  perform pg_temp.eq('a second press counts nothing twice', (r ->> 'saved') || '/' || (select count(*) from public.test_answers
                     where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and client_event_id like 'lc:%')::text, '2/2');
  -- a quiz that offers practice: a player joins the exam, unless a quiz of it is open
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.quiz_create(pg_temp.g('k'), jsonb_build_object('title', 'Контрольная', 'attempts', null, 'offer_practice', true));
  v_quiz := (r ->> 'id')::uuid;
  r := public.challenge_create(jsonb_build_object('quiz_id', v_quiz), format('{"deadline": "%s"}', pg_temp.dl())::jsonb);
  v_ch := (r ->> 'challenge_id')::uuid;
  v_n := (r ->> 'q_count')::integer;
  perform pg_temp.yes('a quiz''s draw without the picture and the order', v_n between 1 and 4
    and (pg_temp.sudo(format('select to_jsonb(bool_and(kind in (''single'', ''multiple'', ''short'', ''number''))) from public.live_challenge_questions where challenge_id = %L', v_ch)) #>> '{}')::boolean);
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004');
  perform public.challenge_join(r ->> 'code', 'Дина', pg_temp.tok(50), null);
  for v_qi in 0 .. v_n - 1 loop
    perform public.challenge_next(r ->> 'code', pg_temp.tok(50), v_qi);
    perform pg_temp.rtick(pg_temp.run(v_ch, pg_temp.tok(50)), 25);
  end loop;
  perform pg_temp.eq('every question let run out', pg_temp.cs(r ->> 'code', pg_temp.tok(50)) -> 'run' ->> 'finished', 'true');
  perform pg_temp.eq('the quiz is open: its answers would show', pg_temp.e(format('select public.challenge_practice(%L, %L)', r ->> 'code', pg_temp.tok(50))), 'ML012/open@403');
  perform pg_temp.who('postgres');
  update public.quizzes set closed_at = now() - interval '1 minute' where id = v_quiz;
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004');
  r := public.challenge_practice(r ->> 'code', pg_temp.tok(50));
  perform pg_temp.eq('the quiz offers practice: joined, every question a mistake («не знаю»)', (r ->> 'joined') || '/' || (r ->> 'mistakes') || '/' || (r ->> 'saved'),
                     'true/' || v_n || '/' || v_n);
  perform pg_temp.who('postgres');
  perform pg_temp.yes('a member now', meldy_private.role_in('dddddddd-0000-0000-0000-000000000004', pg_temp.g('k')) = 'member');
end
$t$;

-- ─── 9. The limits: 120 starts a minute per address and per link, 300 runs ───
do $t$
declare r jsonb; v_ch uuid; v_code text; v_ip text;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.challenge_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 4}', pg_temp.c('k'), pg_temp.c('ks'))::jsonb,
                               format('{"deadline": "%s"}', pg_temp.dl())::jsonb);
  v_ch := (r ->> 'challenge_id')::uuid;
  v_code := r ->> 'code';
  perform pg_temp.who('postgres', null, '203.0.113.7');
  v_ip := meldy_private.quiz_ip_hash();
  perform pg_temp.yes('the address is read', v_ip ~ '^[0-9a-f]{64}$');
  -- the address's other starts of the last minute were on another link (the per-link limits of an address do not see them)
  insert into meldy_private.live_challenge_hits (ip_hash, challenge_id, at) select v_ip, pg_temp.g('a'), now() - interval '10 seconds' from generate_series(1, 119);
  perform pg_temp.who('anon', null, '203.0.113.7');
  perform pg_temp.eq('the 120th start of an address', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Сто двадцать', pg_temp.tok(60))), 'ok');
  perform pg_temp.eq('the 121st', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Лишний', pg_temp.tok(61))), 'ML005/join@429');
  perform pg_temp.yes('with Retry-After', (current_setting('live_test.headers')::jsonb ->> 'Retry-After')::integer between 1 and 60);
  perform pg_temp.who('anon', null, '198.51.100.9');
  perform pg_temp.eq('another address is fine', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Другой', pg_temp.tok(62))), 'ok');
  perform pg_temp.who('anon', null, '203.0.113.7');
  perform pg_temp.eq('the same token comes back past the limit', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Сто двадцать', pg_temp.tok(60))), 'ok');
  -- per link: 120 starts in a minute
  perform pg_temp.who('postgres');
  insert into public.live_runs (challenge_id, token_hash, name, look, hp, hp_max, joined_at)
  select v_ch, md5(i::text) || md5('x' || i), 'Бот ' || i, '{"body": "round", "colour": "blue", "eyes": "round", "hat": "none"}', 220, 220, now() - interval '20 seconds'
    from generate_series(1, 118) i;
  perform pg_temp.who('anon', null, '192.0.2.1');
  perform pg_temp.eq('the 121st start of the link in a minute', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Лишний', pg_temp.tok(63))), 'ML005/join@429');
  -- 300 runs
  perform pg_temp.who('postgres');
  update public.live_runs set joined_at = now() - interval '5 minutes' where challenge_id = v_ch;
  insert into public.live_runs (challenge_id, token_hash, name, look, hp, hp_max, joined_at)
  select v_ch, md5('y' || i) || md5('z' || i), 'Бот ' || i, '{"body": "round", "colour": "blue", "eyes": "round", "hat": "none"}', 220, 220, now() - interval '5 minutes'
    from generate_series(1, 299 - (select count(*) from public.live_runs where challenge_id = v_ch)) i;
  perform pg_temp.who('anon', null, '192.0.2.1');
  perform pg_temp.eq('the 300th', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Последний', pg_temp.tok(64))), 'ok');
  perform pg_temp.eq('the 301st', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Лишний', pg_temp.tok(65))), 'ML001/@400');
  perform pg_temp.eq('300 under way: nobody on the table yet, the count says so', jsonb_array_length(public.challenge_board(v_code) -> 'top')::text || '/' ||
                     (public.challenge_board(v_code) -> 'challenge' ->> 'playing'), '0/0');
end
$t$;

-- ─── 10. The author's views; nothing for anyone else; no token anywhere ───
do $t$
declare r jsonb; v_ch uuid := pg_temp.g('a');
begin
  perform pg_temp.who('anon');
  perform pg_temp.eq('anon cannot read results', split_part(pg_temp.e(format('select public.challenge_results(%L)', v_ch)), '/', 1), '42501');
  perform pg_temp.eq('anon has no list', split_part(pg_temp.e('select public.challenges_mine(null)'), '/', 1), '42501');
  perform pg_temp.who('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
  perform pg_temp.eq('not the author', pg_temp.e(format('select public.challenge_results(%L)', v_ch)), '42501/author@403');
  perform pg_temp.eq('someone else has none', jsonb_array_length(public.challenges_mine(null) -> 'items')::text, '0');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.challenge_results(v_ch);
  perform pg_temp.eq('results', (select string_agg(k, ',' order by k) from jsonb_object_keys(r) k),
                     'challenge_id,closed_at,code,container_id,created_at,deadline,finished,now,over,path,playing,q_count,questions,quiz_id,runs,skipped,speed,state,time_s,title,url');
  perform pg_temp.eq('every run, the finished first', (select string_agg((x ->> 'name') || ':' || coalesce(x ->> 'place', '-') || ':' || (x ->> 'answered'), ',' order by o)
                     from jsonb_array_elements(r -> 'runs') with ordinality t(x, o)), 'Дима:1:4,Лена:-:0');
  perform pg_temp.eq('each question''s numbers', (select string_agg((x ->> 'answered') || ':' || (x ->> 'right'), ',' order by (x ->> 'qi')::integer)
                     from jsonb_array_elements(r -> 'questions') x), '1:1,1:0,1:0,1:1');
  perform pg_temp.yes('no key, no token, no hash in the results', pg_temp.clean(r) and r::text !~ '"(key|keys|forms)"');
  r := public.challenges_mine(null);
  perform pg_temp.yes('the list: newest first, with the leader', jsonb_array_length(r -> 'items') >= 8
    and (select bool_and(x ? 'challenge_id' and x ? 'code' and x ? 'state' and x ? 'leader' and x ? 'finished') from jsonb_array_elements(r -> 'items') x)
    and exists (select 1 from jsonb_array_elements(r -> 'items') x where x ->> 'code' = pg_temp.c('ac') and x -> 'leader' ->> 'name' = 'Дима'));
  perform pg_temp.eq('one exam''s', (select count(*) from jsonb_array_elements(public.challenges_mine(pg_temp.g('m')) -> 'items'))::text, '2');
  perform pg_temp.yes('no token, no hash in the list', pg_temp.clean(r));
end
$t$;

-- ─── 11. Every run sees the options in its own order (the same on every read); an item that keeps its order keeps it ───
do $t$
declare r jsonb; s jsonb; v_ch uuid; v_code text; v_n integer; v_qi integer; v_q jsonb; v_orders text[] := '{}'; v_keytext text;
        v_moved integer := 0; v_kind text; v_rv jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.container_create('Порядок', null, '[{"title":"Всё"}]');
  perform pg_temp.put('o', r ->> 'container_id');
  perform pg_temp.put('os', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'o:1', 'stem', 'O1 один', 'options', jsonb_build_array('альфа', 'бета', 'гамма', 'дельта', 'эпсилон', 'дзета'), 'correct', jsonb_build_array(4),
                       'explanation', 'Пятый.'),
    jsonb_build_object('ref', 'o:2', 'stem', 'O2 два', 'kind', 'multiple', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e'), 'correct', jsonb_build_array(1, 3)),
    jsonb_build_object('ref', 'o:3', 'stem', 'O3 по порядку', 'options', jsonb_build_array('Все', 'Ни один', 'Оба', 'Не знаю'), 'correct', jsonb_build_array(2),
                       'keep_order', true)));
  r := public.challenge_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('o'), pg_temp.c('os'))::jsonb,
                               format('{"deadline": "%s"}', pg_temp.dl())::jsonb);
  v_ch := (r ->> 'challenge_id')::uuid;
  v_code := r ->> 'code';
  perform pg_temp.who('anon');
  for v_n in 90 .. 97 loop
    perform public.challenge_join(v_code, 'Порядок ' || v_n, pg_temp.tok(v_n), null);
  end loop;
  for v_qi in 0 .. 2 loop
    v_q := pg_temp.cq(v_ch, v_qi);
    v_kind := v_q ->> 'kind';
    v_orders := '{}';
    for v_n in 90 .. 97 loop
      s := public.challenge_next(v_code, pg_temp.tok(v_n), v_qi);
      perform pg_temp.eq('the same order on every read', (pg_temp.cs(v_code, pg_temp.tok(v_n)) -> 'question' ->> 'options'), s -> 'question' ->> 'options');
      perform pg_temp.eq('the same options', (select string_agg(x, ',' order by x) from jsonb_array_elements_text(s -> 'question' -> 'options') x),
                         (select string_agg(x, ',' order by x) from jsonb_array_elements_text(v_q -> 'options') x));
      v_orders := v_orders || (s -> 'question' ->> 'options');
      perform pg_temp.rtick(pg_temp.run(v_ch, pg_temp.tok(v_n)), 4);
      if v_kind = 'single' then
        -- half the class taps the question's own index of the key, half the option of the key's text in its own order
        v_keytext := v_q -> 'options' ->> (v_q ->> 'key')::integer;
        if v_n % 2 = 0 then
          -- the question's own index is right exactly when this run shows the key there
          s := public.challenge_answer(v_code, pg_temp.tok(v_n), v_qi, jsonb_build_object('choice', (v_q ->> 'key')::integer));
          perform pg_temp.eq('a tap is graded in the run''s own order', s -> 'result' ->> 'correct', ((s -> 'result' ->> 'key') = (v_q ->> 'key'))::text);
        else
          s := public.challenge_answer(v_code, pg_temp.tok(v_n), v_qi, jsonb_build_object('choice',
                 (select o - 1 from jsonb_array_elements_text(s -> 'question' -> 'options') with ordinality t(x, o) where x = v_keytext)));
          perform pg_temp.eq('the key''s text in the own order is right', s -> 'result' ->> 'correct', 'true');
        end if;
        perform pg_temp.eq('the key comes back in the own order', s -> 'question' -> 'options' ->> (s -> 'result' ->> 'key')::integer, v_keytext);
        if not (v_q ->> 'keep_order')::boolean and (s -> 'result' ->> 'key') <> (v_q ->> 'key') then
          v_moved := v_moved + 1;
        end if;
      else
        s := pg_temp.answer(v_code, pg_temp.tok(v_n), v_qi, pg_temp.right_of(v_q));
        perform pg_temp.eq('the right ticks, turned into the own order, are right', s -> 'result' ->> 'correct', 'true');
        perform pg_temp.eq('the own ticks come back as sent', (select string_agg(x, ',' order by x::integer) from jsonb_array_elements_text(s -> 'answer' -> 'picks') x),
                           (select string_agg(x, ',' order by x::integer) from jsonb_array_elements_text(pg_temp.in_run(v_code, pg_temp.tok(v_n), v_qi, pg_temp.right_of(v_q)) -> 'picks') x));
      end if;
    end loop;
    if (v_q ->> 'keep_order')::boolean then
      perform pg_temp.eq('an item that keeps its order: every run sees it so', (select count(distinct x)::text from unnest(v_orders) x) || '/' || v_orders[1],
                         '1/' || (v_q ->> 'options'));
    else
      perform pg_temp.yes('another order for another run (' || v_kind || ')', (select count(distinct x) from unnest(v_orders) x) >= 3);
    end if;
  end loop;
  perform pg_temp.yes('the key is not at the same place for every run («it is В» carries over nowhere)', v_moved >= 1);
  -- the review: the run's order, the key and the own answer in it
  s := public.challenge_review(v_code, pg_temp.tok(91));
  for v_rv in select x from jsonb_array_elements(s -> 'items') x loop
    if v_rv ->> 'kind' is null then
      perform pg_temp.eq('review: the key and the own choice in the own order', (v_rv -> 'options' ->> (v_rv ->> 'key')::integer) || '/' || (v_rv ->> 'correct'),
                         (v_rv -> 'options' ->> (v_rv ->> 'choice')::integer) || '/true');
    else
      perform pg_temp.eq('review: the keys and the own ticks in the own order', (v_rv -> 'keys')::text || '/' || (v_rv ->> 'correct'), (v_rv -> 'picks')::text || '/true');
    end if;
  end loop;
end
$t$;

-- ─── 12. «Верный ответ — в конце»: the verdict and the points at once, the key and the explanation once the run is over ───
do $t$
declare r jsonb; s jsonb; v_ch uuid; v_code text; v_qi integer;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('reveal of no kind', pg_temp.e(format('select public.challenge_create(%L, %L)',
    format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('o'), pg_temp.c('os')), format('{"deadline": "%s", "reveal": "never"}', pg_temp.dl()))),
    '22023/reveal@400');
  r := public.challenge_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('o'), pg_temp.c('os'))::jsonb,
                               format('{"deadline": "%s", "reveal": "end"}', pg_temp.dl())::jsonb);
  v_ch := (r ->> 'challenge_id')::uuid;
  v_code := r ->> 'code';
  perform pg_temp.who('anon');
  perform pg_temp.eq('the link says the answers come at the end', public.challenge_info(v_code) ->> 'reveal', 'end');
  perform public.challenge_join(v_code, 'Конец', pg_temp.tok(98), null);
  for v_qi in 0 .. 2 loop
    perform public.challenge_next(v_code, pg_temp.tok(98), v_qi);
    perform pg_temp.rtick(pg_temp.run(v_ch, pg_temp.tok(98)), 4);
    s := pg_temp.answer(v_code, pg_temp.tok(98), v_qi, pg_temp.right_of(pg_temp.cq(v_ch, v_qi)));
    if v_qi < 2 then
      perform pg_temp.eq('graded: the verdict and the points, no key, no explanation', (s -> 'result' ->> 'correct') || '/' || ((s -> 'result' ->> 'dmg')::integer > 0)::text || '/' ||
                         (s -> 'result' ->> 'hidden') || '/' || (s::text ~ '"(key|keys|forms|tolerance|explanation)"')::text, 'true/true/true/false');
      perform pg_temp.yes('not on a reload either', pg_temp.cs(v_code, pg_temp.tok(98))::text !~ '"(key|keys|explanation)"');
    else
      perform pg_temp.eq('the last answer ends the run: now the key', (s -> 'run' ->> 'finished') || '/' || ((s -> 'result') ? 'key')::text || '/' ||
                         coalesce(s -> 'result' ->> 'hidden', 'null'), 'true/true/null');
    end if;
  end loop;
  s := public.challenge_review(v_code, pg_temp.tok(98));
  perform pg_temp.yes('the review: every key and the explanation', jsonb_array_length(s -> 'items') = 3
    and (select bool_and(x ? 'key') from jsonb_array_elements(s -> 'items') x)
    and exists (select 1 from jsonb_array_elements(s -> 'items') x where x ->> 'explanation' = 'Пятый.'));
end
$t$;

-- ─── 13. One address cannot lock a link: 60 starts in 10 minutes and 150 a day per address on a link; runs never started
--     free their place after 15 minutes ───
do $t$
declare r jsonb; v_ch uuid; v_code text; v_ip text; v_other uuid;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.challenge_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('o'), pg_temp.c('os'))::jsonb,
                               format('{"deadline": "%s"}', pg_temp.dl())::jsonb);
  v_ch := (r ->> 'challenge_id')::uuid;
  v_code := r ->> 'code';
  v_other := pg_temp.g('a');
  perform pg_temp.who('postgres', null, '203.0.113.40');
  v_ip := meldy_private.quiz_ip_hash();
  -- a class of 40 behind one school address, then 19 more within ten minutes: all in
  insert into meldy_private.live_challenge_hits (ip_hash, challenge_id, at) select v_ip, v_ch, now() - interval '5 minutes' from generate_series(1, 59);
  perform pg_temp.who('anon', null, '203.0.113.40');
  perform pg_temp.eq('the 60th start of an address on a link in ten minutes', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Шестьдесят', pg_temp.tok(110))), 'ok');
  perform pg_temp.eq('the 61st', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Лишний', pg_temp.tok(111))), 'ML005/join@429');
  perform pg_temp.yes('with Retry-After (at most ten minutes)', (current_setting('live_test.headers')::jsonb ->> 'Retry-After')::integer between 1 and 600);
  perform pg_temp.eq('the same address on another link', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', pg_temp.c('ac'), 'Другая ссылка', pg_temp.tok(112))), 'ok');
  -- the day: three classes of the school on one link; then no more from that address
  perform pg_temp.who('postgres');
  update meldy_private.live_challenge_hits set at = now() - interval '3 hours' where challenge_id = v_ch;
  insert into meldy_private.live_challenge_hits (ip_hash, challenge_id, at) select v_ip, v_ch, now() - interval '2 hours' from generate_series(1, 89);
  perform pg_temp.who('anon', null, '203.0.113.40');
  perform pg_temp.eq('the 150th start of an address on a link in a day', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Сто пятьдесят', pg_temp.tok(113))), 'ok');
  perform pg_temp.eq('the 151st', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Лишний', pg_temp.tok(114))), 'ML005/join@429');
  perform pg_temp.who('anon', null, '198.51.100.40');
  perform pg_temp.eq('another address is fine', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Сосед', pg_temp.tok(115))), 'ok');
  -- the places: 297 runs that never opened a question, all but 10 of them started 20 minutes ago
  perform pg_temp.who('postgres');
  insert into public.live_runs (challenge_id, token_hash, name, look, hp, hp_max, joined_at)
  select v_ch, md5('s' || i) || md5('t' || i), 'Не начал ' || i, '{"body": "round", "colour": "blue", "eyes": "round", "hat": "none"}', 165, 165,
         now() - case when i <= 10 then interval '5 minutes' else interval '20 minutes' end
    from generate_series(1, 300 - (select count(*) from public.live_runs where challenge_id = v_ch)) i;
  update public.live_runs set removed_at = now() where challenge_id = v_ch and name = 'Не начал 11';
  perform pg_temp.eq('the link is full', (select count(*) from public.live_runs where challenge_id = v_ch)::text, '300');
  perform pg_temp.who('anon', null, '192.0.2.40');
  perform pg_temp.eq('a start frees the places of runs never started for 15 minutes', pg_temp.e(format('select public.challenge_join(%L, %L, %L, null)', v_code, 'Новый', pg_temp.tok(116))), 'ok');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('those went; the recent ones, the ones that played and the one taken off stay',
                     (select count(*) filter (where name like 'Не начал %') || '/' || count(*) filter (where removed_at is not null)
                        || '/' || count(*) filter (where name in ('Шестьдесят', 'Сто пятьдесят', 'Сосед', 'Новый'))
                        from public.live_runs where challenge_id = v_ch), '11/1/4');
end
$t$;

-- ─── 14. «Тренировать ошибки»: only a finished run, until a week after the end; an item whose key changed since is «stale» ───
do $t$
declare r jsonb; v_ch uuid := pg_temp.g('a'); v_code text := pg_temp.c('ac'); v_qi integer; v_short integer;
begin
  -- a member plays the whole of challenge «a» without an answer
  perform pg_temp.who('postgres');
  insert into public.container_members (container_id, user_id) values (pg_temp.g('k'), 'eeeeeeee-0000-0000-0000-000000000005') on conflict do nothing;
  perform pg_temp.who('anon');
  perform public.challenge_join(v_code, 'Ева', pg_temp.tok(120), null);
  perform pg_temp.who('authenticated', 'eeeeeeee-0000-0000-0000-000000000005');
  perform public.challenge_next(v_code, pg_temp.tok(120), 0);
  perform pg_temp.eq('not before the run is over', pg_temp.e(format('select public.challenge_practice(%L, %L)', v_code, pg_temp.tok(120))), 'ML004/not_done@400');
  for v_qi in 0 .. 3 loop
    perform pg_temp.rtick(pg_temp.run(v_ch, pg_temp.tok(120)), 25);
    if v_qi < 3 then
      perform public.challenge_next(v_code, pg_temp.tok(120), v_qi + 1);
    end if;
  end loop;
  perform pg_temp.eq('the run is over', pg_temp.cs(v_code, pg_temp.tok(120)) -> 'run' ->> 'finished', 'true');
  -- the key of the text question changes after the challenge was made: its rev moves
  v_short := (select (x ->> 'qi')::integer from jsonb_array_elements(pg_temp.sudo(format('select jsonb_agg(to_jsonb(q)) from public.live_challenge_questions q where q.challenge_id = %L', v_ch))) x
               where x ->> 'kind' = 'short');
  perform pg_temp.who('postgres');
  update public.test_items set answers = array_append(answers, 'Мск') where id = (pg_temp.cq(v_ch, v_short) ->> 'item_id')::uuid;
  perform pg_temp.who('authenticated', 'eeeeeeee-0000-0000-0000-000000000005');
  r := public.challenge_practice(v_code, pg_temp.tok(120));
  perform pg_temp.eq('four mistakes, three recorded: the changed item is stale, never graded by its new key', (r ->> 'mistakes') || '/' || (r ->> 'saved'), '4/3');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('nothing recorded for it', (select count(*) from public.test_answers where user_id = 'eeeeeeee-0000-0000-0000-000000000005'
                     and item_id = (pg_temp.cq(v_ch, v_short) ->> 'item_id')::uuid)::text, '0');
  -- a week after the end: no more
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform public.challenge_close(v_ch);
  perform pg_temp.ctick(v_ch, 8 * 86400);
  perform pg_temp.who('authenticated', 'eeeeeeee-0000-0000-0000-000000000005');
  perform pg_temp.eq('a week after the end', pg_temp.e(format('select public.challenge_practice(%L, %L)', v_code, pg_temp.tok(120))), 'ML002/expired@400');
  perform pg_temp.who('anon');
  perform pg_temp.eq('the review stays', jsonb_array_length(public.challenge_review(v_code, pg_temp.tok(120)) -> 'items')::text, '4');
end
$t$;

-- ─── 15. The token is checked before the challenge is read; only calls that cannot be refused after it sweep ───
do $t$
declare v_ch uuid := pg_temp.g('b'); v_code text := pg_temp.c('bc');
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform public.challenge_close(v_ch);
  perform pg_temp.ctick(v_ch, 40);
  perform pg_temp.who('anon');
  perform pg_temp.eq('a token of no shape: refused before anything', pg_temp.e(format('select public.challenge_state(%L, %L)', v_code, 'bad')), 'P0002/token@404');
  perform pg_temp.eq('an answer of no shape', pg_temp.e(format('select public.challenge_answer(%L, %L, 0, %L)', v_code, 'bad', '{"choice": 0}')), 'P0002/token@404');
  perform pg_temp.eq('a code of no shape with a good token', pg_temp.e(format('select public.challenge_next(%L, %L, 0)', 'x', pg_temp.tok(35))), 'P0002/code@404');
  perform pg_temp.eq('a refused answer (the run is over)', split_part(pg_temp.e(format('select public.challenge_answer(%L, %L, 3, %L)', v_code, pg_temp.tok(35), '{"choice": 0}')), '/', 1), 'ML004');
  perform pg_temp.eq('nothing swept by them', (pg_temp.sudo(format('select to_jsonb(swept_at is null) from public.live_challenges where id = %L', v_ch)) #>> '{}'), 'true');
  perform pg_temp.cs(v_code, pg_temp.tok(35));
  perform pg_temp.eq('the own state sweeps, once its run is found', (pg_temp.sudo(format('select to_jsonb(swept_at is not null) from public.live_challenges where id = %L', v_ch)) #>> '{}'), 'true');
end
$t$;

rollback;
\echo LIVE CHALLENGE BEHAVIOUR PASSED
