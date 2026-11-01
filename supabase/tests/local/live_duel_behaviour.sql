-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261106090200_live_duel.sql on the
-- scratch database of live_game_run.sh, after the challenge step: the create (its refusals, the kinds it takes, the
-- questions frozen, the checks before any cleanup), the link's info, the seats (token, name, look, one seat a token and an
-- account, the takeover by account, a third device refused before any write), a whole duel by the server's clock (the
-- timeline, «Готов», the reveal, «Дальше»), the key and the other seat's answer never before the close, each seat's own
-- order of the options both ways, double answers, time-outs, the disconnect rules (the clock never stops in a question,
-- the wait between questions, the stayer wins, both gone, the wait judged at its deadline whoever calls first, a seat's
-- 120 s wait budget, the lobby's freed seat, the expiry), «unchanged», the winner, the review with the masked typed
-- answer (the mask's disguises, an ordinary word kept), the rematch (both press, new seat ids, unplayed questions first, a
-- fixed set reshuffled, 20 rounds, the match score, the hourly limits), the limits (an account's, a lobby counted only
-- while its creator is around, the guest-only address limit, a run's own cap, the joins by account and by address), the
-- sources (a challenge run and a game: frozen copies, windows; a «Встань на ответ» game's range questions as typed
-- numbers), «Тренировать ошибки» (members, the standing rule, the expired-lobby attack), the cleanup of lobbies nobody
-- joined, and that no token or hash ever leaves. One transaction, rolled back: now() stays put and the time machine
-- moves the rows. A failure raises; success prints LIVE DUEL BEHAVIOUR PASSED.
\set ON_ERROR_STOP 1
begin;
create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated, anon, service_role;
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
-- The time machine of a duel: every time of it, its seats, questions and answers, p_s seconds back.
create or replace function pg_temp.dtick(p_duel uuid, p_s numeric) returns void language plpgsql as $fn$
declare v_role text := current_user; v_i interval := make_interval(secs => p_s::double precision);
begin
  perform set_config('role', 'none', true);
  update public.live_duels set created_at = created_at - v_i, started_at = started_at - v_i, wait_from = wait_from - v_i,
         ended_at = ended_at - v_i where id = p_duel;
  update public.live_duel_seats set joined_at = joined_at - v_i, seen_at = seen_at - v_i, ready_at = ready_at - v_i,
         next_at = next_at - v_i, rematch_at = rematch_at - v_i where duel_id = p_duel;
  update public.live_duel_questions set shown_at = shown_at - v_i, opens_at = opens_at - v_i, closes_at = closes_at - v_i,
         closed_at = closed_at - v_i where duel_id = p_duel;
  update public.live_duel_answers set at = at - v_i, settled_at = settled_at - v_i where duel_id = p_duel;
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
end;
$fn$;
-- One seat's last call p_s seconds further back (it went away).
create or replace function pg_temp.away(p_duel uuid, p_tok text, p_s numeric) returns void language plpgsql as $fn$
declare v_role text := current_user;
begin
  perform set_config('role', 'none', true);
  update public.live_duel_seats set seen_at = seen_at - make_interval(secs => p_s::double precision)
   where duel_id = p_duel and token_hash = meldy_private.live_hash(p_tok);
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
end;
$fn$;
-- The time machine of a live game (as the other behaviours) and of a challenge.
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
-- Rows as the session: a duel by its code, a seat by its token, a question, a duel's and a seat's row.
create or replace function pg_temp.duel(p_code text) returns uuid language sql as $fn$
  select (pg_temp.sudo(format('select to_jsonb(d.id) from public.live_duels d where d.code = %L', p_code)) #>> '{}')::uuid
$fn$;
create or replace function pg_temp.seat(p_duel uuid, p_tok text) returns uuid language sql as $fn$
  select (pg_temp.sudo(format('select to_jsonb(s.id) from public.live_duel_seats s where s.duel_id = %L and s.token_hash = meldy_private.live_hash(%L)',
                              p_duel, p_tok)) #>> '{}')::uuid
$fn$;
create or replace function pg_temp.dq(p_duel uuid, p_qi integer) returns jsonb language sql as $fn$
  select pg_temp.sudo(format('select to_jsonb(q) from public.live_duel_questions q where q.duel_id = %L and q.qi = %s', p_duel, p_qi))
$fn$;
create or replace function pg_temp.drow(p_duel uuid) returns jsonb language sql as $fn$
  select pg_temp.sudo(format('select to_jsonb(d) from public.live_duels d where d.id = %L', p_duel))
$fn$;
create or replace function pg_temp.srow(p_duel uuid, p_tok text) returns jsonb language sql as $fn$
  select pg_temp.sudo(format('select to_jsonb(s) from public.live_duel_seats s where s.duel_id = %L and s.token_hash = meldy_private.live_hash(%L)', p_duel, p_tok))
$fn$;
create or replace function pg_temp.n(p_sql text) returns integer language sql as $fn$
  select (pg_temp.sudo(format('select to_jsonb(count(*)) from (%s) x', p_sql)) #>> '{}')::integer
$fn$;
-- The answers of a question row (a duel's, a challenge's or a game's: the same columns): right, partly right, wrong.
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
-- The share an answer in the question's order earns (the challenge's grading of the row).
create or replace function pg_temp.share_of(p_q jsonb, p_a jsonb) returns double precision language sql as $fn$
  select (pg_temp.sudo(format('select to_jsonb(meldy_private.live_duel_share(q, %s, %s, %L)) from public.live_duel_questions q where q.duel_id = %L and q.qi = %s',
    coalesce((p_a ->> 'choice'), 'null') || '::smallint',
    case when p_a ? 'picks' then quote_literal((select array_agg(x::smallint order by x::integer) from jsonb_array_elements_text(p_a -> 'picks') x)::text) || '::smallint[]' else 'null::smallint[]' end,
    p_a ->> 'text', p_q ->> 'duel_id', p_q ->> 'qi')) #>> '{}')::double precision
$fn$;
-- The points of one answer (meldy_private.live_duel_points) as the session computes them.
create or replace function pg_temp.pts(p_streak integer, p_frozen boolean, p_share double precision, p_elapsed integer, p_time integer,
                                       p_speed boolean, p_calm boolean) returns jsonb language sql as $fn$
  select pg_temp.sudo(format('select to_jsonb(x) from meldy_private.live_duel_points(%s, %L, %s, %s, %s, %L, %L) x', p_streak, p_frozen,
                             coalesce(p_share::text, 'null'), coalesce(p_elapsed::text, 'null'), p_time, p_speed, p_calm))
$fn$;
-- An answer given in the question's order of the options turned into the seat's own order (live_run_perm of the seat's
-- id), as its device would send it.
create or replace function pg_temp.in_seat(p_code text, p_tok text, p_qi integer, p_answer jsonb) returns jsonb language plpgsql as $fn$
declare v_role text := current_user; v_perm smallint[]; v_n integer; v jsonb := p_answer;
begin
  perform set_config('role', 'none', true);
  select meldy_private.live_run_perm(s.id, q.qi, jsonb_array_length(q.options), q.keep_order), jsonb_array_length(q.options)
    into v_perm, v_n
    from public.live_duel_seats s join public.live_duels d on d.id = s.duel_id
    join public.live_duel_questions q on q.duel_id = d.id and q.qi = p_qi
   where d.code = p_code and s.token_hash = meldy_private.live_hash(p_tok);
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
create or replace function pg_temp.ans(p_code text, p_tok text, p_qi integer, p_answer jsonb) returns jsonb language plpgsql as $fn$
begin
  return public.duel_answer(p_code, p_tok, p_qi, pg_temp.in_seat(p_code, p_tok, p_qi, p_answer));
end;
$fn$;
create or replace function pg_temp.da(p_code text, p_tok text, p_qi integer, p_answer jsonb) returns text language sql as $fn$
  select pg_temp.e(format('select pg_temp.ans(%L, %L, %s, %L)', p_code, p_tok, p_qi, p_answer))
$fn$;
create or replace function pg_temp.ds(p_code text, p_tok text) returns jsonb language sql as $fn$
  select public.duel_state(p_code, p_tok, null)
$fn$;
-- Both seats call (both are here).
create or replace function pg_temp.poll(p_code text, p_t1 text, p_t2 text) returns void language plpgsql as $fn$
begin
  perform public.duel_state(p_code, p_t1, null);
  perform public.duel_state(p_code, p_t2, null);
end;
$fn$;
-- The text of option i of a list in a state.
create or replace function pg_temp.opt(p_options jsonb, p_i jsonb) returns text language sql immutable as $fn$
  select p_options ->> (p_i #>> '{}')::integer
$fn$;
-- No token and no sha256 in a JSON (the hashes are 64 hex characters; the tokens of this file start with «tok»), and no
-- seat id.
create or replace function pg_temp.clean(p jsonb) returns boolean language sql as $fn$
  select p::text !~ '[0-9a-f]{64}' and p::text !~ 'tok0'
     and not exists (select 1 from jsonb_array_elements(pg_temp.sudo('select coalesce(jsonb_agg(id), ''[]'') from public.live_duel_seats')) x
                      where strpos(p::text, x #>> '{}') > 0)
$fn$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- ─── 1. Exams: every kind a duel plays and two it skips, nothing playable, a pool, three text questions, six options ───
do $t$
declare r jsonb; v_c text;
begin
  insert into auth.users (id)
  select x::uuid from unnest(array['51515151-0000-0000-0000-000000000051', '52525252-0000-0000-0000-000000000052', '53535353-0000-0000-0000-000000000053',
                                   '54545454-0000-0000-0000-000000000054', '55555555-0000-0000-0000-000000000055', '61616161-0000-0000-0000-000000000061',
                                   '62626262-0000-0000-0000-000000000062', '63636363-0000-0000-0000-000000000063',
                                   '64646464-0000-0000-0000-000000000064', '65656565-0000-0000-0000-000000000065',
                                   'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002',
                                   'cccccccc-0000-0000-0000-000000000003']) x
  on conflict do nothing;
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.container_create('Дуэль', null, '[{"title":"Всё"}]');
  v_c := r ->> 'container_id';
  perform pg_temp.put('k', v_c);
  perform pg_temp.put('ks', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'c:1', 'stem', 'Один верный', 'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct', jsonb_build_array(1),
                       'explanation', 'Потому что b'),
    jsonb_build_object('ref', 'c:2', 'stem', 'Два верных', 'kind', 'multiple', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e'),
                       'correct', jsonb_build_array(0, 3)),
    jsonb_build_object('ref', 'c:3', 'stem', 'Столица России', 'kind', 'short', 'answers', jsonb_build_array('Москва')),
    jsonb_build_object('ref', 'c:4', 'stem', 'Высота башни', 'kind', 'number', 'answers', jsonb_build_array('42'), 'tolerance', 0.5, 'unit', 'м'),
    jsonb_build_object('ref', 'c:5', 'stem', 'Схема', 'options', jsonb_build_array('1:1', '1:N'), 'correct', jsonb_build_array(1),
                       'images', jsonb_build_object('stem', jsonb_build_array(v_c || '/' || repeat('a', 64) || '.png'), 'options', '[[], []]'::jsonb)),
    jsonb_build_object('ref', 'c:6', 'stem', 'По порядку', 'kind', 'order', 'options', jsonb_build_array('раз', 'два', 'три'))));
  r := public.container_create('Только порядок', null, '[{"title":"Всё"}]');
  perform pg_temp.put('e', r ->> 'container_id');
  perform pg_temp.put('es', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'e:1', 'stem', 'По порядку', 'kind', 'order', 'options', jsonb_build_array('раз', 'два', 'три')),
    jsonb_build_object('ref', 'e:2', 'stem', 'Схема', 'options', jsonb_build_array('1:1', '1:N'), 'correct', jsonb_build_array(1),
                       'images', jsonb_build_object('stem', jsonb_build_array((r ->> 'container_id') || '/' || repeat('c', 64) || '.png'),
                                                    'options', '[[], []]'::jsonb))));
  r := public.container_create('Пул', null, '[{"title":"Всё"}]');
  perform pg_temp.put('p', r ->> 'container_id');
  perform pg_temp.put('ps', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid,
    (select jsonb_agg(jsonb_build_object('ref', 'p:' || i, 'stem', 'Пул ' || i, 'options', jsonb_build_array('да', 'нет', 'может'),
                                         'correct', jsonb_build_array(i % 3))) from generate_series(1, 8) i));
  r := public.container_create('Текст', null, '[{"title":"Всё"}]');
  perform pg_temp.put('t', r ->> 'container_id');
  perform pg_temp.put('ts', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 't:1', 'stem', 'Т1', 'kind', 'short', 'answers', jsonb_build_array('один')),
    jsonb_build_object('ref', 't:2', 'stem', 'Т2', 'kind', 'short', 'answers', jsonb_build_array('два')),
    jsonb_build_object('ref', 't:3', 'stem', 'Т3', 'kind', 'short', 'answers', jsonb_build_array('три'))));
  r := public.container_create('Шесть', null, '[{"title":"Всё"}]');
  perform pg_temp.put('o', r ->> 'container_id');
  perform pg_temp.put('os', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'o:1', 'stem', 'O1', 'options', jsonb_build_array('альфа', 'бета', 'гамма', 'дельта', 'эпсилон', 'дзета'), 'correct', jsonb_build_array(4)),
    jsonb_build_object('ref', 'o:2', 'stem', 'O2', 'kind', 'multiple', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e', 'f'), 'correct', jsonb_build_array(1, 3)),
    jsonb_build_object('ref', 'o:3', 'stem', 'O3', 'options', jsonb_build_array('Все', 'Ни один', 'Оба', 'Не знаю'), 'correct', jsonb_build_array(2),
                       'keep_order', true)));
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 2. The create: its refusals, the kinds, the frozen questions ───
do $t$
declare r jsonb; v_src text := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 4}', pg_temp.c('k'), pg_temp.c('ks'));
begin
  perform pg_temp.who('anon');
  perform pg_temp.eq('a guest has no exam source', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)', v_src, '{}', 'Аня', pg_temp.tok(1))), '28000/@401');
  perform pg_temp.who('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
  perform pg_temp.eq('someone else''s exam', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)', v_src, '{}', 'Боря', pg_temp.tok(1))), '42501/author@403');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('a token of the wrong shape', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)', v_src, '{}', 'Аня', 'short')), '22023/token@400');
  perform pg_temp.eq('15 s is the stand game''s', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)', v_src, '{"time_s": 15}', 'Аня', pg_temp.tok(1))), '22023/time_s@400');
  perform pg_temp.eq('calm as text', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)', v_src, '{"calm": "yes"}', 'Аня', pg_temp.tok(1))), '22023/calm@400');
  perform pg_temp.eq('two questions', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    format('{"container_id": "%s", "subject_ids": ["%s"], "count": 2}', pg_temp.c('k'), pg_temp.c('ks')), '{}', 'Аня', pg_temp.tok(1))), '22023/count@400');
  perform pg_temp.eq('nothing playable: order and a picture', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('e'), pg_temp.c('es')), '{}', 'Аня', pg_temp.tok(1))), 'ML008/2@400');
  perform pg_temp.eq('a rude name', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)', v_src, '{}', 'Су-ка', pg_temp.tok(1))), 'ML006/rude@400');
  perform pg_temp.eq('a part not opened', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L, %L)', v_src, '{}', 'Аня', pg_temp.tok(1),
    '{"body": "round", "colour": "blue", "eyes": "round", "hat": "crown"}')), 'ML007/locked@400');
  perform pg_temp.eq('an unknown source', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)', '{"items": []}', '{}', 'Аня', pg_temp.tok(1))), '22023/source@400');
  perform pg_temp.eq('nothing made by the refusals', pg_temp.n('select 1 from public.live_duels')::text, '0');
  r := public.duel_create(v_src::jsonb, '{"time_s": 20}'::jsonb, '  Аня  ', pg_temp.tok(1), '{"body": "cloud", "colour": "teal", "eyes": "dots", "hat": "cap"}');
  perform pg_temp.eq('the state of the first seat', pg_temp.keys(r) || '/' || pg_temp.keys(r -> 'duel') || '/' || pg_temp.keys(r -> 'me'),
                     'answer,duel,final,match,me,now,other,question,rematch,result,rev,track/code,expires_at,path,q_count,qi,round,speed,stage,time_s,title,url,wait_open,wait_until/best,dmg,frozen,look,name,next,ready,rematch,right,seat,streak');
  perform pg_temp.eq('a lobby of four questions, alone', (r -> 'duel' ->> 'stage') || '/' || (r -> 'duel' ->> 'q_count') || '/' || (r -> 'me' ->> 'seat') || '/' ||
                     (r -> 'me' ->> 'name') || '/' || coalesce(r ->> 'other', 'null') || '/' || coalesce(r ->> 'question', 'null') || '/' ||
                     ((r -> 'duel' ->> 'path') = '/d/' || (r -> 'duel' ->> 'code'))::text, 'lobby/4/1/Аня/null/null/true');
  perform pg_temp.yes('a link code of 12', (r -> 'duel' ->> 'code') ~ '^[0-9a-hjkmnp-tv-z]{12}$');
  perform pg_temp.yes('no token, no hash, no seat id', pg_temp.clean(r));
  perform pg_temp.put('ac', r -> 'duel' ->> 'code');
  perform pg_temp.put('a', pg_temp.duel(r -> 'duel' ->> 'code')::text);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the four kinds, no picture, no order', (select string_agg(kind, ',' order by kind) from public.live_duel_questions
                     where duel_id = pg_temp.g('a')), 'multiple,number,short,single');
  perform pg_temp.eq('skipped counted', (pg_temp.drow(pg_temp.g('a')) ->> 'skipped'), '2');
  perform pg_temp.eq('the first seat is the account''s', pg_temp.srow(pg_temp.g('a'), pg_temp.tok(1)) ->> 'user_id', 'aaaaaaaa-0000-0000-0000-000000000001');
  update public.test_items set stem = 'Изменён' where stem = 'Один верный';
  perform pg_temp.eq('an edit of the exam does not change it', (select count(*) from public.live_duel_questions
                     where duel_id = pg_temp.g('a') and text = 'Один верный')::text, '1');
  update public.test_items set stem = 'Один верный' where stem = 'Изменён';
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.duel_create(v_src::jsonb, '{"calm": true, "speed": true}'::jsonb, 'Аня', pg_temp.tok(90), null);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('calm keeps no points for speed', (select calm || '/' || speed || '/' || time_s from public.live_duels where code = r -> 'duel' ->> 'code'), 'true/false/20');
  perform pg_temp.eq('a look of none given: the name''s own', (r -> 'me' -> 'look')::text, meldy_private.live_default_look('Аня')::text);
end
$t$;

-- ─── 3. The link's info and the seats: the invited one, the same token, the takeover by account, a third device ───
do $t$
declare r jsonb; s jsonb; v_code text := pg_temp.c('ac'); v_d uuid := pg_temp.g('a'); v_rev text; v_hits integer;
begin
  perform pg_temp.who('anon');
  perform pg_temp.eq('no such link', pg_temp.e('select public.duel_info(''zzzzzzzzzzzz'')'), 'P0002/code@404');
  perform pg_temp.eq('not a link code', pg_temp.e('select public.duel_info(''x'')'), 'P0002/code@404');
  r := public.duel_info(v_code);
  perform pg_temp.eq('info', pg_temp.keys(r) || '/' || (r ->> 'stage') || '/' || (r ->> 'full') || '/' || jsonb_array_length(r -> 'players') || '/' ||
                     (r -> 'players' -> 0 ->> 'name'), 'code,full,now,players,q_count,round,speed,stage,time_s,title/lobby/false/1/Аня');
  perform pg_temp.yes('no token, no hash in the info', pg_temp.clean(r));
  perform pg_temp.eq('a token of the wrong shape', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_code, 'Боря', 'short')), '22023/token@400');
  perform pg_temp.eq('a rude name', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_code, 'бля', pg_temp.tok(2))), 'ML006/rude@400');
  perform pg_temp.eq('a long name', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_code, repeat('я', 25), pg_temp.tok(2))), 'ML006/length@400');
  s := public.duel_join(v_code, 'Боря', pg_temp.tok(2), null);
  perform pg_temp.eq('the invited seat', (s -> 'me' ->> 'seat') || '/' || (s -> 'me' ->> 'name') || '/' || (s -> 'other' ->> 'name') || '/' ||
                     (s -> 'other' ->> 'present') || '/' || (s -> 'duel' ->> 'stage'), '2/Боря/Аня/true/lobby');
  perform pg_temp.yes('no token, no hash', pg_temp.clean(s));
  perform pg_temp.eq('the info says it is full', public.duel_info(v_code) ->> 'full', 'true');
  -- a third device: refused before any lock or write
  v_rev := pg_temp.drow(v_d) ->> 'rev';
  v_hits := pg_temp.n('select 1 from meldy_private.live_duel_hits');
  perform pg_temp.eq('a third device', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_code, 'Вика', pg_temp.tok(3))), 'ML001/full@400');
  perform pg_temp.eq('nothing written by it', (pg_temp.drow(v_d) ->> 'rev') || '/' || pg_temp.n('select 1 from meldy_private.live_duel_hits') || '/' ||
                     pg_temp.n(format('select 1 from public.live_duel_seats where duel_id = %L', v_d)), v_rev || '/' || v_hits || '/2');
  s := public.duel_join(v_code, 'Другое имя', pg_temp.tok(2), null);
  perform pg_temp.eq('the same token: the same seat, as it was', (s -> 'me' ->> 'seat') || '/' || (s -> 'me' ->> 'name'), '2/Боря');
  -- the author on another device (signed in): the same seat taken over, the old token stops working
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  s := public.duel_join(v_code, 'Ноутбук', pg_temp.tok(4), null);
  perform pg_temp.eq('the account takes its seat back', (s -> 'me' ->> 'seat') || '/' || (s -> 'me' ->> 'name'), '1/Аня');
  perform pg_temp.who('anon');
  perform pg_temp.eq('the old token of that seat', pg_temp.e(format('select public.duel_state(%L, %L, null)', v_code, pg_temp.tok(1))), 'P0002/token@404');
  perform pg_temp.eq('a token of no seat', pg_temp.e(format('select public.duel_state(%L, %L, null)', v_code, pg_temp.tok(99))), 'P0002/token@404');
  perform pg_temp.eq('a token of no shape', pg_temp.e(format('select public.duel_state(%L, %L, null)', v_code, 'bad')), 'P0002/token@404');
  perform pg_temp.eq('a seat of another link', pg_temp.e(format('select public.duel_state(%L, %L, null)', 'zzzzzzzzzzzz', pg_temp.tok(2))), 'P0002/code@404');
  -- someone else signed in, with no seat: full
  perform pg_temp.who('authenticated', 'cccccccc-0000-0000-0000-000000000003');
  perform pg_temp.eq('a stranger signed in', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_code, 'Лена', pg_temp.tok(5))), 'ML001/full@400');
  perform pg_temp.who('anon');
  perform pg_temp.eq('a guest''s seat has no account', pg_temp.srow(v_d, pg_temp.tok(2)) ->> 'user_id', null);
end
$t$;

-- ─── 4. A whole duel: «Готов», 2 s, 3 · 2 · 1, the answers by the server's clock, the key only at the close, each seat's
--     own order both ways, «Дальше», a time-out, the freeze and the thaw, the end, the winner, the review ───
do $t$
declare s jsonb; o jsonb; v_code text := pg_temp.c('ac'); v_d uuid := pg_temp.g('a'); a text := pg_temp.tok(4); b text := pg_temp.tok(2);
        v_q jsonb; v_qi integer; v_aa jsonb; v_bb jsonb; v_pa jsonb; v_pb jsonb; v_sa jsonb; v_sb jsonb; v_reveal numeric;
        v_dmg_a integer := 0; v_dmg_b integer := 0; v_ms_a numeric; v_ms_b numeric;
begin
  perform pg_temp.who('anon');
  s := public.duel_ready(v_code, a);
  perform pg_temp.eq('one «Готов» starts nothing', (s -> 'duel' ->> 'stage') || '/' || (s -> 'me' ->> 'ready') || '/' || (s -> 'other' ->> 'ready'), 'lobby/true/false');
  perform pg_temp.eq('the other sees it', pg_temp.ds(v_code, b) -> 'other' ->> 'ready', 'true');
  s := public.duel_ready(v_code, b);
  perform pg_temp.eq('both «Готов» while both are here: play, the question in 2 s, no text yet', (s -> 'duel' ->> 'stage') || '/' || (s -> 'question' ->> 'qi') || '/' ||
                     (s -> 'question' ->> 'soon') || '/' || coalesce(s -> 'question' ->> 'text', 'null') || '/' ||
                     round(extract(epoch from ((s -> 'question' ->> 'shown_at')::timestamptz - now())))::text || '/' ||
                     round(extract(epoch from ((s -> 'question' ->> 'opens_at')::timestamptz - now())))::text || '/' ||
                     round(extract(epoch from ((s -> 'question' ->> 'closes_at')::timestamptz - now())))::text, 'play/0/true/null/2/5/25');
  perform pg_temp.eq('«Готов» again changes nothing', (public.duel_ready(v_code, a) -> 'question' ->> 'qi'), '0');
  for v_qi in 0 .. 3 loop
    v_q := pg_temp.dq(v_d, v_qi);
    v_reveal := case when v_q ->> 'explanation' is null then 7 else 14 end;
    if v_qi = 0 then
      perform pg_temp.dtick(v_d, 2);
      perform pg_temp.poll(v_code, a, b);
    end if;
    s := pg_temp.ds(v_code, a);
    perform pg_temp.eq('the question shows: its text, its options, no key ' || v_qi, (s -> 'question' ->> 'text') || '/' || coalesce(s -> 'question' ->> 'soon', 'null') || '/' ||
                       jsonb_array_length(s -> 'question' -> 'options'), (v_q ->> 'text') || '/null/' || jsonb_array_length(v_q -> 'options'));
    perform pg_temp.yes('no key, no forms, no explanation, no verdict before the close ' || v_qi, s::text !~ '"(key|keys|forms|tolerance|explanation|correct)"' and s ->> 'result' is null);
    perform pg_temp.eq('the same options for both seats ' || v_qi, (select string_agg(x, ',' order by x) from jsonb_array_elements_text(s -> 'question' -> 'options') x),
                       (select string_agg(x, ',' order by x) from jsonb_array_elements_text(pg_temp.ds(v_code, b) -> 'question' -> 'options') x));
    perform pg_temp.eq('too early ' || v_qi, pg_temp.da(v_code, a, v_qi, pg_temp.right_of(v_q)), 'ML004/early@400');
    perform pg_temp.dtick(v_d, 3);
    perform pg_temp.poll(v_code, a, b);
    -- the script: 0 — A right at 1 s, B wrong at 3 s; 1 — nobody (the time runs out); 2 — A wrong, B right (thaws);
    -- 3 — A right (thaws), B partly right (several right) or wrong
    v_aa := case v_qi when 0 then pg_temp.right_of(v_q) when 2 then pg_temp.wrong_of(v_q) when 3 then pg_temp.right_of(v_q) end;
    v_bb := case v_qi when 0 then pg_temp.wrong_of(v_q) when 2 then pg_temp.right_of(v_q) when 3 then pg_temp.part_of(v_q) end;
    v_sa := pg_temp.srow(v_d, a);
    v_sb := pg_temp.srow(v_d, b);
    if v_aa is null then
      perform pg_temp.dtick(v_d, 21.4);
      perform pg_temp.poll(v_code, a, b);
      perform pg_temp.eq('within the 1.5 s of grace: still open', coalesce(pg_temp.ds(v_code, a) ->> 'result', 'null'), 'null');
      perform pg_temp.dtick(v_d, 0.2);
      s := pg_temp.ds(v_code, a);
      perform pg_temp.eq('the time ran out: none for both, nobody freezes for it', (s -> 'result' -> 'me' ->> 'none') || '/' || (s -> 'result' -> 'other' ->> 'none') || '/' ||
                         (s -> 'result' -> 'me' ->> 'dmg') || '/' || (s -> 'me' ->> 'streak') || '/' || (s -> 'me' ->> 'frozen') || '/' ||
                         (pg_temp.srow(v_d, a) ->> 'time_ms')::integer - (v_sa ->> 'time_ms')::integer, 'true/true/0/0/false/20000');
      perform pg_temp.eq('the frozen one stays frozen', pg_temp.ds(v_code, b) -> 'me' ->> 'frozen', 'true');
      perform pg_temp.eq('too late', pg_temp.da(v_code, a, v_qi, pg_temp.right_of(v_q)), 'ML004/late@400');
    else
      v_ms_a := 1;
      v_ms_b := 3;
      perform pg_temp.dtick(v_d, v_ms_a);
      s := pg_temp.ans(v_code, a, v_qi, v_aa);
      perform pg_temp.eq('the answer comes back without a verdict ' || v_qi, coalesce(s ->> 'result', 'null') || '/' || (s -> 'answer' ->> 'elapsed_ms') || '/' ||
                         (s::text ~ '"(key|keys|forms|correct|explanation)"')::text, 'null/1000/false');
      perform pg_temp.eq('the own answer as sent ' || v_qi,
                         coalesce(s -> 'answer' ->> 'typed', s -> 'answer' ->> 'choice',
                                  (select string_agg(x, ',' order by x::integer) from jsonb_array_elements_text(s -> 'answer' -> 'picks') x)),
                         coalesce(v_aa ->> 'text', pg_temp.in_seat(v_code, a, v_qi, v_aa) ->> 'choice',
                                  (select string_agg(x, ',' order by x::integer) from jsonb_array_elements_text(pg_temp.in_seat(v_code, a, v_qi, v_aa) -> 'picks') x)));
      o := pg_temp.ds(v_code, b);
      perform pg_temp.eq('the other seat only sees «answered» ' || v_qi, (o -> 'other' ->> 'answered') || '/' || coalesce(o ->> 'result', 'null') || '/' ||
                         (o::text ~ '"(key|keys|forms|correct|explanation)"')::text || '/' || coalesce(o ->> 'answer', 'null'), 'true/null/false/null');
      perform pg_temp.eq('twice ' || v_qi, pg_temp.da(v_code, a, v_qi, v_aa), 'ML004/twice@400');
      perform pg_temp.dtick(v_d, v_ms_b - v_ms_a);
      perform public.duel_state(v_code, a, null);
      s := pg_temp.ans(v_code, b, v_qi, v_bb);
      perform pg_temp.eq('the second answer closes it at once ' || v_qi, (s -> 'result' ->> 'qi') || '/' || (s -> 'question' ? 'closed_at')::text, v_qi || '/true');
      -- the points: each seat by its streak, its ice and the server's elapsed time (live_duel_points)
      v_pa := pg_temp.pts((v_sa ->> 'streak')::integer, (v_sa ->> 'frozen')::boolean, pg_temp.share_of(v_q, v_aa), (v_ms_a * 1000)::integer, 20, true, false);
      v_pb := pg_temp.pts((v_sb ->> 'streak')::integer, (v_sb ->> 'frozen')::boolean, pg_temp.share_of(v_q, v_bb), (v_ms_b * 1000)::integer, 20, true, false);
      v_dmg_a := v_dmg_a + (v_pa ->> 'dmg')::integer;
      v_dmg_b := v_dmg_b + (v_pb ->> 'dmg')::integer;
      perform pg_temp.eq('B''s result: its own and the other''s ' || v_qi, (s -> 'result' -> 'me' ->> 'correct') || ':' || (s -> 'result' -> 'me' ->> 'dmg') || ':' ||
                         (s -> 'result' -> 'me' ->> 'frozen') || ':' || (s -> 'result' -> 'me' ->> 'thawed') || '/' ||
                         (s -> 'result' -> 'other' ->> 'correct') || ':' || (s -> 'result' -> 'other' ->> 'dmg') || ':' || (s -> 'result' -> 'other' ->> 'elapsed_ms'),
                         (v_pb ->> 'correct') || ':' || (v_pb ->> 'dmg') || ':' || (v_pb ->> 'frozen') || ':' || (v_pb ->> 'thawed') || '/' ||
                         (v_pa ->> 'correct') || ':' || (v_pa ->> 'dmg') || ':1000');
      o := pg_temp.ds(v_code, a);
      perform pg_temp.eq('A''s numbers ' || v_qi, (o -> 'me' ->> 'dmg') || '/' || (o -> 'other' ->> 'dmg') || '/' || (o -> 'result' -> 'me' ->> 'dmg'),
                         v_dmg_a || '/' || v_dmg_b || '/' || (v_pa ->> 'dmg'));
      -- the key and the other seat's answer, each in the viewer's own order
      if v_q ->> 'kind' in ('single', 'multiple') then
        perform pg_temp.eq('the key in the own order (A) ' || v_qi, pg_temp.opt(o -> 'question' -> 'options', o -> 'result' -> 'key'), v_q -> 'options' ->> (v_q ->> 'key')::integer);
        perform pg_temp.eq('the key in the own order (B) ' || v_qi, pg_temp.opt(s -> 'question' -> 'options', s -> 'result' -> 'key'), v_q -> 'options' ->> (v_q ->> 'key')::integer);
        if v_q ->> 'kind' = 'single' then
          perform pg_temp.eq('B sees A''s pick where B has that option ' || v_qi, pg_temp.opt(s -> 'question' -> 'options', s -> 'result' -> 'other' -> 'choice'),
                             v_q -> 'options' ->> (v_aa ->> 'choice')::integer);
          perform pg_temp.eq('A sees B''s pick where A has that option ' || v_qi, pg_temp.opt(o -> 'question' -> 'options', o -> 'result' -> 'other' -> 'choice'),
                             v_q -> 'options' ->> (v_bb ->> 'choice')::integer);
          perform pg_temp.eq('the own pick back in the own order ' || v_qi, pg_temp.opt(o -> 'question' -> 'options', o -> 'result' -> 'me' -> 'choice'),
                             v_q -> 'options' ->> (v_aa ->> 'choice')::integer);
        else
          perform pg_temp.eq('B sees A''s ticks where B has them ' || v_qi,
                             (select string_agg(t, ',' order by t) from (select s -> 'question' -> 'options' ->> (x #>> '{}')::integer as t from jsonb_array_elements(s -> 'result' -> 'other' -> 'picks') x) z),
                             (select string_agg(t, ',' order by t) from (select v_q -> 'options' ->> (x #>> '{}')::integer as t from jsonb_array_elements(v_aa -> 'picks') x) z));
          perform pg_temp.eq('the keys in the own order ' || v_qi,
                             (select string_agg(t, ',' order by t) from (select o -> 'question' -> 'options' ->> (x #>> '{}')::integer as t from jsonb_array_elements(o -> 'result' -> 'keys') x) z),
                             (select string_agg(t, ',' order by t) from (select v_q -> 'options' ->> (x #>> '{}')::integer as t from jsonb_array_elements(v_q -> 'keys') x) z));
        end if;
      else
        perform pg_temp.eq('a typed answer: the forms and the other''s text ' || v_qi, (o -> 'result' -> 'forms')::text || '/' || (o -> 'result' -> 'other' ->> 'typed'),
                           (v_q -> 'forms')::text || '/' || (v_bb ->> 'text'));
      end if;
      perform pg_temp.yes('the explanation comes with the key ' || v_qi, (o -> 'result' ? 'explanation') = (v_q ->> 'explanation' is not null));
    end if;
    perform pg_temp.eq('the track so far ' || v_qi, jsonb_array_length(pg_temp.ds(v_code, a) -> 'track')::text, (v_qi + 1)::text);
    -- the reveal: 7 s, or 14 with an explanation; «Дальше» by both goes on at once
    if v_qi = 0 then
      s := public.duel_next(v_code, a, 0);
      perform pg_temp.eq('one «Дальше»: still the reveal', (s -> 'question' ->> 'qi') || '/' || (s -> 'me' ->> 'next') || '/' || (pg_temp.ds(v_code, b) -> 'other' ->> 'next'), '0/true/true');
      perform pg_temp.eq('«Дальше» of a question not shown yet', pg_temp.e(format('select public.duel_next(%L, %L, 1)', v_code, a)), 'ML004/bad_qi@400');
      s := public.duel_next(v_code, b, 0);
      perform pg_temp.eq('both «Дальше»: the next question shows now', (s -> 'question' ->> 'qi') || '/' || coalesce(s -> 'question' ->> 'soon', 'null') || '/' ||
                         round(extract(epoch from ((s -> 'question' ->> 'opens_at')::timestamptz - now())))::text, '1/null/3');
      perform pg_temp.eq('an older «Дальше» changes nothing', public.duel_next(v_code, a, 0) -> 'question' ->> 'qi', '1');
    elsif v_qi < 3 then
      v_reveal := extract(epoch from ((pg_temp.dq(v_d, v_qi) ->> 'closed_at')::timestamptz + make_interval(secs => v_reveal::double precision) - now()));
      perform pg_temp.dtick(v_d, v_reveal - 0.1);
      perform pg_temp.poll(v_code, a, b);
      perform pg_temp.eq('the reveal lasts 7 s, 14 with an explanation (' || v_qi || ')', pg_temp.ds(v_code, a) -> 'question' ->> 'qi', v_qi::text);
      perform pg_temp.dtick(v_d, 0.2);
      s := pg_temp.ds(v_code, a);
      perform pg_temp.eq('then the next question shows by itself', (s -> 'question' ->> 'qi') || '/' || (s -> 'duel' ->> 'stage'), (v_qi + 1) || '/play');
      perform public.duel_state(v_code, b, null);
    else
      perform public.duel_next(v_code, a, 3);
      s := public.duel_next(v_code, b, 3);
    end if;
  end loop;
  -- the end: the winner by points, then right answers
  perform pg_temp.eq('the last «Дальше» ends the duel', (s -> 'duel' ->> 'stage') || '/' || (s -> 'final' ->> 'reason'), 'final/done');
  o := pg_temp.ds(v_code, a);
  perform pg_temp.eq('the winner and the numbers', (o -> 'final' ->> 'winner') || '/' || (s -> 'final' ->> 'winner') || '/' || (o -> 'me' ->> 'dmg') || '/' ||
                     (o -> 'other' ->> 'dmg') || '/' || (o -> 'me' ->> 'right') || '/' || (o -> 'match' ->> 'me') || ':' || (o -> 'match' ->> 'other'),
                     case when v_dmg_a > v_dmg_b then 'me/other' when v_dmg_b > v_dmg_a then 'other/me' else 'me/other' end || '/' || v_dmg_a || '/' || v_dmg_b || '/2/'
                     || case when v_dmg_a >= v_dmg_b then '1:0' else '0:1' end);
  perform pg_temp.yes('the tracks', (select string_agg((x ->> 'me') || ':' || (x ->> 'other'), ',' order by (x ->> 'qi')::integer) from jsonb_array_elements(o -> 'track') x)
                                    ~ '^right:wrong,none:none,wrong:right,right:(part|wrong)$');
  perform pg_temp.yes('no token, no hash, no seat id in the end', pg_temp.clean(o) and pg_temp.clean(s));
  perform pg_temp.eq('no answer after the end', pg_temp.da(v_code, a, 3, '{"choice": 0}'), 'ML004/twice@400');
end
$t$;

-- ─── 4b. The review: every closed question with its key and both answers, each seat in its own order ───
do $t$
declare r jsonb; v_code text := pg_temp.c('ac'); v_d uuid := pg_temp.g('a'); a text := pg_temp.tok(4); b text := pg_temp.tok(2); v_it jsonb; v_q jsonb;
begin
  perform pg_temp.who('anon');
  r := public.duel_review(v_code, a);
  perform pg_temp.eq('four items, the own verdicts', jsonb_array_length(r -> 'items')::text || '/' ||
                     (select string_agg((x ->> 'correct'), ',' order by (x ->> 'qi')::integer) from jsonb_array_elements(r -> 'items') x), '4/true,false,false,true');
  for v_it in select x from jsonb_array_elements(r -> 'items') x loop
    v_q := pg_temp.dq(v_d, (v_it ->> 'qi')::integer);
    perform pg_temp.yes('an item has its key and the other''s answer', v_it ? 'key' and v_it ? 'other' and v_it ? 'options');
    if v_q ->> 'kind' = 'single' then
      perform pg_temp.eq('review: the key in the own order', v_it -> 'options' ->> (v_it ->> 'key')::integer, v_q -> 'options' ->> (v_q ->> 'key')::integer);
      perform pg_temp.yes('review: the other''s pick is an option or none', (v_it -> 'other' ->> 'none')::boolean or (v_it -> 'other' ? 'choice'));
    elsif v_q ->> 'kind' = 'multiple' then
      perform pg_temp.yes('review: the keys and the share', v_it ? 'keys' and v_it ? 'share');
    else
      perform pg_temp.yes('review: the forms', v_it ? 'forms');
    end if;
  end loop;
  perform pg_temp.yes('no token, no hash, no seat id in the review', pg_temp.clean(r));
  perform pg_temp.eq('the other seat''s review is its own', (select string_agg((x ->> 'correct'), ',' order by (x ->> 'qi')::integer)
                                                             from jsonb_array_elements(public.duel_review(v_code, b) -> 'items') x) ~ '^false,false,true,(false|true)$' || '', 'true');
end
$t$;

-- ─── 5. A typed answer the other seat must not read: masked in its view and review, the writer's own as typed ───
do $t$
declare r jsonb; s jsonb; o jsonb; v_code text; v_d uuid; a text := pg_temp.tok(10); b text := pg_temp.tok(11); v_qi integer;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.duel_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('t'), pg_temp.c('ts'))::jsonb,
                          '{"time_s": 10}'::jsonb, 'Аня', a, null);
  v_code := r -> 'duel' ->> 'code';
  v_d := pg_temp.duel(v_code);
  perform pg_temp.who('anon');
  perform public.duel_join(v_code, 'Боря', b, null);
  perform public.duel_ready(v_code, a);
  perform public.duel_ready(v_code, b);
  perform pg_temp.dtick(v_d, 5);
  perform pg_temp.poll(v_code, a, b);
  perform public.duel_answer(v_code, a, 0, '{"text": "Ну Су-ка!"}');
  s := public.duel_answer(v_code, b, 0, '{"text": "что-то"}');
  perform pg_temp.eq('the other''s rude text is masked', (s -> 'result' -> 'other' ->> 'masked') || '/' || coalesce(s -> 'result' -> 'other' ->> 'typed', 'null') || '/' ||
                     (s::text ~* 'су-ка')::text, 'true/null/false');
  o := pg_temp.ds(v_code, a);
  perform pg_temp.eq('the writer sees it as typed, the other''s plain text as typed', (o -> 'result' -> 'me' ->> 'typed') || '/' || (o -> 'result' -> 'other' ->> 'typed'),
                     'Ну Су-ка!/что-то');
  -- the mask's disguises (a hidden letter, spaced-out letters), and an ordinary word with a short root inside it
  perform public.duel_next(v_code, a, 0);
  perform public.duel_next(v_code, b, 0);
  for v_qi in 1 .. 2 loop
    perform pg_temp.dtick(v_d, 3.2);
    perform pg_temp.poll(v_code, a, b);
    perform public.duel_answer(v_code, a, v_qi, jsonb_build_object('text', (array['пошёл на х*й', 'с у к а'])[v_qi]));
    s := public.duel_answer(v_code, b, v_qi, jsonb_build_object('text', (array['Застрахуйте', 'х у й'])[v_qi]));
    o := pg_temp.ds(v_code, a);
    perform pg_temp.eq(format('question %s: what each seat reads of the other''s text', v_qi),
                       coalesce(s -> 'result' -> 'other' ->> 'typed', 'masked:' || (s -> 'result' -> 'other' ->> 'masked')) || '/' ||
                       coalesce(o -> 'result' -> 'other' ->> 'typed', 'masked:' || (o -> 'result' -> 'other' ->> 'masked')),
                       (array['masked:true/Застрахуйте', 'masked:true/masked:true'])[v_qi]);
    perform public.duel_next(v_code, a, v_qi);
    perform public.duel_next(v_code, b, v_qi);
  end loop;
  perform pg_temp.eq('over', pg_temp.ds(v_code, b) -> 'duel' ->> 'stage', 'final');
  perform pg_temp.eq('judged once, as written', pg_temp.sudo(format('select to_jsonb(string_agg(s.seat || '':'' || a.rude, '','' order by a.qi, s.seat))
                       from public.live_duel_answers a join public.live_duel_seats s on s.id = a.seat_id where a.duel_id = %L', v_d)) #>> '{}',
                     '1:true,2:false,1:true,2:false,1:true,2:true');
  r := public.duel_review(v_code, b);
  perform pg_temp.eq('the review masks it too', (r -> 'items' -> 0 -> 'other' ->> 'masked') || '/' || (r::text ~* 'су-ка')::text || '/' || (r -> 'items' -> 0 ->> 'typed'),
                     'true/false/что-то');
  perform pg_temp.eq('the writer''s review keeps it', public.duel_review(v_code, a) -> 'items' -> 0 ->> 'typed', 'Ну Су-ка!');
end
$t$;

-- ─── 6. Each seat sees the options in its own order (the same on every read); an item that keeps its order keeps it ───
do $t$
declare r jsonb; s jsonb; o jsonb; v_code text; v_d uuid; a text := pg_temp.tok(12); b text := pg_temp.tok(13); v_qi integer; v_q jsonb; v_moved integer := 0;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.duel_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('o'), pg_temp.c('os'))::jsonb,
                          '{"time_s": 10}'::jsonb, 'Аня', a, null);
  v_code := r -> 'duel' ->> 'code';
  v_d := pg_temp.duel(v_code);
  perform pg_temp.who('anon');
  perform public.duel_join(v_code, 'Боря', b, null);
  perform public.duel_ready(v_code, a);
  perform public.duel_ready(v_code, b);
  perform pg_temp.dtick(v_d, 2);
  for v_qi in 0 .. 2 loop
    v_q := pg_temp.dq(v_d, v_qi);
    s := pg_temp.ds(v_code, a);
    o := pg_temp.ds(v_code, b);
    perform pg_temp.eq('the same order on every read', pg_temp.ds(v_code, a) -> 'question' ->> 'options', s -> 'question' ->> 'options');
    if (v_q ->> 'keep_order')::boolean then
      perform pg_temp.eq('an item that keeps its order: both see it so', (s -> 'question' ->> 'options') || '/' || (o -> 'question' ->> 'options'),
                         (v_q ->> 'options') || '/' || (v_q ->> 'options'));
    elsif (s -> 'question' ->> 'options') <> (o -> 'question' ->> 'options') then
      v_moved := v_moved + 1;
    end if;
    perform pg_temp.dtick(v_d, 3);
    perform pg_temp.ans(v_code, a, v_qi, pg_temp.right_of(v_q));
    s := pg_temp.ans(v_code, b, v_qi, pg_temp.right_of(v_q));
    perform pg_temp.eq('the right answer in each own order is right for both', (s -> 'result' -> 'me' ->> 'correct') || '/' || (s -> 'result' -> 'other' ->> 'correct'), 'true/true');
    perform public.duel_next(v_code, a, v_qi);
    perform public.duel_next(v_code, b, v_qi);
  end loop;
  perform pg_temp.yes('another order for the other seat', v_moved >= 1);
  -- the review: the key and the own answer in the own order
  for s in select x from jsonb_array_elements(public.duel_review(v_code, b) -> 'items') x loop
    if s ->> 'kind' is null then
      perform pg_temp.eq('review: the key is where the own pick is', (s ->> 'key') || '/' || (s -> 'other' ->> 'choice'), (s ->> 'choice') || '/' || (s ->> 'choice'));
    else
      perform pg_temp.eq('review: the keys are the own ticks and the other''s', (s -> 'keys')::text || '/' || (s -> 'other' -> 'picks')::text, (s -> 'picks')::text || '/' || (s -> 'picks')::text);
    end if;
  end loop;
end
$t$;

-- ─── 7. One answer a seat and question: the primary key under the check ───
do $t$
declare v_d uuid := pg_temp.g('a');
begin
  perform pg_temp.who('postgres');
  perform pg_temp.eq('a second row for a seat and a question', split_part(pg_temp.e(format(
    'insert into public.live_duel_answers (seat_id, qi, duel_id) values (%L, 0, %L)', pg_temp.seat(v_d, pg_temp.tok(4)), v_d)), '/', 1), '23505');
end
$t$;

-- ─── 8. Disconnects: the wait between questions, the stayer wins whatever the score, both gone, the clock inside a
--     question, the lobby's freed seat (never the caller's), the expiry, «Готов» while one is away ───
do $t$
declare r jsonb; s jsonb; v_code text; v_d uuid; a text := pg_temp.tok(20); b text := pg_temp.tok(21); v_q jsonb; v_i integer;
        v_src jsonb := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('p'), pg_temp.c('ps'))::jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.duel_create(v_src, '{"time_s": 10}'::jsonb, 'Аня', a, null);
  v_code := r -> 'duel' ->> 'code';
  v_d := pg_temp.duel(v_code);
  perform pg_temp.who('anon');
  perform public.duel_join(v_code, 'Боря', b, null);
  perform public.duel_ready(v_code, a);
  perform public.duel_ready(v_code, b);
  perform pg_temp.dtick(v_d, 5);
  perform pg_temp.poll(v_code, a, b);
  -- B leads after the first question
  v_q := pg_temp.dq(v_d, 0);
  perform pg_temp.ans(v_code, b, 0, pg_temp.right_of(v_q));
  perform pg_temp.ans(v_code, a, 0, pg_temp.wrong_of(v_q));
  -- B goes away; the reveal ends: the duel waits
  perform pg_temp.away(v_d, b, 25);
  perform pg_temp.dtick(v_d, 7.2);
  s := pg_temp.ds(v_code, a);
  perform pg_temp.eq('one seat away when the next question is due: the wait', (s -> 'duel' ->> 'stage') || '/' || (s -> 'other' ->> 'present') || '/' ||
                     round(extract(epoch from ((s -> 'duel' ->> 'wait_until')::timestamptz - now())))::text, 'wait/false/60');
  perform pg_temp.yes('the wait shows no new question', (s -> 'question' ->> 'qi') = '0');
  perform pg_temp.dtick(v_d, 15);
  perform pg_temp.ds(v_code, a);
  perform pg_temp.dtick(v_d, 15);
  perform pg_temp.ds(v_code, a);
  s := pg_temp.ds(v_code, b);
  perform pg_temp.eq('back within the minute: the next question shows', (s -> 'duel' ->> 'stage') || '/' || (s -> 'question' ->> 'qi'), 'play/1');
  -- the clock never stops inside a question: B goes away for good, its answer is none
  perform pg_temp.away(v_d, b, 25);
  perform pg_temp.dtick(v_d, 3);
  perform pg_temp.ds(v_code, a);
  perform pg_temp.ans(v_code, a, 1, pg_temp.right_of(pg_temp.dq(v_d, 1)));
  perform pg_temp.dtick(v_d, 11.6);
  s := pg_temp.ds(v_code, a);
  perform pg_temp.eq('closed at its time with none for the one away', (s -> 'result' -> 'other' ->> 'none') || '/' || (s -> 'result' -> 'me' ->> 'correct'), 'true/true');
  perform pg_temp.dtick(v_d, 7.2);
  perform pg_temp.eq('waiting for B again', pg_temp.ds(v_code, a) -> 'duel' ->> 'stage', 'wait');
  for v_i in 1 .. 3 loop
    perform pg_temp.dtick(v_d, 19.5);
    perform pg_temp.ds(v_code, a);
  end loop;
  perform pg_temp.eq('58.5 s: still waiting', pg_temp.ds(v_code, a) -> 'duel' ->> 'stage', 'wait');
  perform pg_temp.dtick(v_d, 2);
  s := pg_temp.ds(v_code, a);
  perform pg_temp.eq('a minute away: the one who stayed wins whatever the score', (s -> 'duel' ->> 'stage') || '/' || (s -> 'final' ->> 'reason') || '/' ||
                     (s -> 'final' ->> 'winner') || '/' || ((s -> 'other' ->> 'dmg')::integer > (s -> 'me' ->> 'dmg')::integer)::text, 'final/left/me/true');
  s := pg_temp.ds(v_code, b);
  perform pg_temp.eq('the one who left comes back to a lost duel', (s -> 'final' ->> 'winner') || '/' || (s -> 'final' ->> 'reason'), 'other/left');

  -- both gone: no winner, not even for the one who comes back first
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.duel_create(v_src, '{"time_s": 10}'::jsonb, 'Аня', pg_temp.tok(22), null);
  v_code := r -> 'duel' ->> 'code';
  v_d := pg_temp.duel(v_code);
  perform pg_temp.who('anon');
  perform public.duel_join(v_code, 'Боря', pg_temp.tok(23), null);
  perform public.duel_ready(v_code, pg_temp.tok(22));
  perform public.duel_ready(v_code, pg_temp.tok(23));
  perform pg_temp.dtick(v_d, 5);
  perform pg_temp.poll(v_code, pg_temp.tok(22), pg_temp.tok(23));
  v_q := pg_temp.dq(v_d, 0);
  perform pg_temp.ans(v_code, pg_temp.tok(22), 0, pg_temp.right_of(v_q));
  perform pg_temp.ans(v_code, pg_temp.tok(23), 0, pg_temp.wrong_of(v_q));
  perform pg_temp.dtick(v_d, 7 + 61 + 30);
  s := pg_temp.ds(v_code, pg_temp.tok(22));
  perform pg_temp.eq('both gone: no winner, the leader who came back first included', (s -> 'final' ->> 'reason') || '/' || coalesce(s -> 'final' ->> 'winner', 'null'),
                     'gone/null');

  -- the lobby: the invited seat is freed after 2 minutes away, never the caller's
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.duel_create(v_src, '{}'::jsonb, 'Аня', pg_temp.tok(24), null);
  v_code := r -> 'duel' ->> 'code';
  v_d := pg_temp.duel(v_code);
  perform pg_temp.put('lobby', v_code);
  perform pg_temp.who('anon');
  perform public.duel_join(v_code, 'Боря', pg_temp.tok(25), null);
  perform pg_temp.dtick(v_d, 110);
  perform pg_temp.eq('away 110 s: the seat is kept', pg_temp.ds(v_code, pg_temp.tok(24)) -> 'other' ->> 'name', 'Боря');
  perform pg_temp.dtick(v_d, 11);
  perform pg_temp.eq('the info counts a seat away 2 minutes as free', public.duel_info(v_code) ->> 'full', 'false');
  s := pg_temp.ds(v_code, pg_temp.tok(24));
  perform pg_temp.eq('away 2 minutes: freed', coalesce(s ->> 'other', 'null'), 'null');
  perform pg_temp.eq('its token stops working', pg_temp.e(format('select public.duel_state(%L, %L, null)', v_code, pg_temp.tok(25))), 'P0002/token@404');
  perform public.duel_join(v_code, 'Вика', pg_temp.tok(26), null);
  perform pg_temp.dtick(v_d, 130);
  s := pg_temp.ds(v_code, pg_temp.tok(26));
  perform pg_temp.eq('the invited seat that calls is never freed', (s -> 'me' ->> 'seat') || '/' || (s -> 'other' ->> 'present'), '2/false');
  perform pg_temp.eq('nor by the other''s next call', pg_temp.ds(v_code, pg_temp.tok(24)) -> 'other' ->> 'name', 'Вика');

  -- «Готов» by both while one is away: no start until it is back
  perform public.duel_ready(v_code, pg_temp.tok(26));
  perform pg_temp.away(v_d, pg_temp.tok(26), 25);
  s := public.duel_ready(v_code, pg_temp.tok(24));
  perform pg_temp.eq('both ready, one away: still the lobby', (s -> 'duel' ->> 'stage') || '/' || (s -> 'other' ->> 'present'), 'lobby/false');
  s := pg_temp.ds(v_code, pg_temp.tok(26));
  perform pg_temp.eq('it is back: the start', (s -> 'duel' ->> 'stage') || '/' || (s -> 'question' ->> 'soon'), 'play/true');

  -- an unstarted duel expires after a day
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.duel_create(v_src, '{}'::jsonb, 'Аня', pg_temp.tok(27), null);
  v_code := r -> 'duel' ->> 'code';
  v_d := pg_temp.duel(v_code);
  perform pg_temp.dtick(v_d, 86400 - 5);
  perform pg_temp.who('anon');
  perform pg_temp.eq('a day less 5 s: still a lobby', public.duel_info(v_code) ->> 'stage', 'lobby');
  perform pg_temp.dtick(v_d, 6);
  perform pg_temp.eq('the info says it is over', (public.duel_info(v_code) ->> 'stage') || '/' || (public.duel_info(v_code) ->> 'full'), 'final/true');
  perform pg_temp.eq('no seat in it any more', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_code, 'Поздно', pg_temp.tok(28))), 'ML002/over@400');
  s := pg_temp.ds(v_code, pg_temp.tok(27));
  perform pg_temp.eq('expired, no winner', (s -> 'duel' ->> 'stage') || '/' || (s -> 'final' ->> 'reason') || '/' || coalesce(s -> 'final' ->> 'winner', 'null') || '/' ||
                     coalesce(s ->> 'rematch', 'null'), 'final/expired/null/null');
  perform pg_temp.eq('no rematch of a duel never played', pg_temp.e(format('select public.duel_rematch(%L, %L)', v_code, pg_temp.tok(27))), 'ML004/not_done@400');
  perform pg_temp.put('expired', v_code);
end
$t$;

-- ─── 8b. The wait's end is judged at its deadline, whoever calls first after it: the one away calls first and still
--     loses; a seat's wait budget (120 s a duel): spent, the next question opens without it ───
do $t$
declare r jsonb; s jsonb; v_code text; v_d uuid; a text := pg_temp.tok(30); b text := pg_temp.tok(31); v_q jsonb; v_qi integer;
        v_src jsonb := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('p'), pg_temp.c('ps'))::jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  v_code := public.duel_create(v_src, '{"time_s": 10}'::jsonb, 'Аня', a, null) -> 'duel' ->> 'code';
  v_d := pg_temp.duel(v_code);
  perform pg_temp.who('anon');
  perform public.duel_join(v_code, 'Боря', b, null);
  perform public.duel_ready(v_code, a);
  perform public.duel_ready(v_code, b);
  perform pg_temp.dtick(v_d, 5);
  perform pg_temp.poll(v_code, a, b);
  v_q := pg_temp.dq(v_d, 0);
  perform pg_temp.ans(v_code, a, 0, pg_temp.wrong_of(v_q));
  perform pg_temp.ans(v_code, b, 0, pg_temp.right_of(v_q));
  perform pg_temp.away(v_d, b, 25);
  perform pg_temp.dtick(v_d, 7.2);
  perform pg_temp.eq('B away: the wait', pg_temp.ds(v_code, a) -> 'duel' ->> 'stage', 'wait');
  perform pg_temp.dtick(v_d, 29);
  perform pg_temp.ds(v_code, a);
  perform pg_temp.dtick(v_d, 29);
  perform pg_temp.ds(v_code, a);
  -- A was last here 2.2 s before the deadline; 3 s after it B calls first: at the deadline only A was here
  perform pg_temp.dtick(v_d, 5);
  s := pg_temp.ds(v_code, b);
  perform pg_temp.eq('the one away calls first after the deadline: it lost, the one who stayed wins (B led)',
                     (s -> 'duel' ->> 'stage') || '/' || (s -> 'final' ->> 'reason') || '/' || (s -> 'final' ->> 'winner') || '/' ||
                     ((s -> 'me' ->> 'dmg')::integer > (s -> 'other' ->> 'dmg')::integer)::text, 'final/left/other/true');
  perform pg_temp.eq('ended at the deadline', round(extract(epoch from (now() - (pg_temp.drow(v_d) ->> 'ended_at')::timestamptz)))::text, '3');
  s := pg_temp.ds(v_code, a);
  perform pg_temp.eq('the stayer reads its win', (s -> 'final' ->> 'winner') || '/' || (s -> 'final' ->> 'reason'), 'me/left');

  -- the budget: B goes away before every question
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  v_code := public.duel_create(jsonb_set(v_src, '{count}', '5'), '{"time_s": 10}'::jsonb, 'Аня', pg_temp.tok(32), null) -> 'duel' ->> 'code';
  a := pg_temp.tok(32);
  b := pg_temp.tok(33);
  v_d := pg_temp.duel(v_code);
  perform pg_temp.who('anon');
  perform public.duel_join(v_code, 'Боря', b, null);
  perform public.duel_ready(v_code, a);
  perform public.duel_ready(v_code, b);
  perform pg_temp.dtick(v_d, 5);
  perform pg_temp.poll(v_code, a, b);
  for v_qi in 0 .. 1 loop
    v_q := pg_temp.dq(v_d, v_qi);
    perform pg_temp.ans(v_code, a, v_qi, pg_temp.right_of(v_q));
    perform pg_temp.ans(v_code, b, v_qi, pg_temp.right_of(v_q));
    perform pg_temp.away(v_d, b, 25);
    perform pg_temp.dtick(v_d, 7.2);
    s := pg_temp.ds(v_code, a);
    perform pg_temp.eq(format('wait %s: a minute, the budget is enough', v_qi + 1),
                       (s -> 'duel' ->> 'stage') || '/' || round(extract(epoch from ((s -> 'duel' ->> 'wait_until')::timestamptz - now())))::text || '/' ||
                       (s -> 'duel' ->> 'wait_open'), 'wait/60/false');
    perform pg_temp.dtick(v_d, 25);
    perform pg_temp.ds(v_code, a);
    perform pg_temp.dtick(v_d, 25);
    perform pg_temp.ds(v_code, a);
    s := pg_temp.ds(v_code, b);
    perform pg_temp.eq(format('back after 50 s of wait %s', v_qi + 1), (s -> 'duel' ->> 'stage') || '/' || (s -> 'question' ->> 'qi'), 'play/' || (v_qi + 1));
    perform pg_temp.eq('its budget charged', (pg_temp.srow(v_d, b) ->> 'waited_ms') || '/' || (pg_temp.srow(v_d, a) ->> 'waited_ms'),
                       ((v_qi + 1) * 50200)::text || '/0');
    perform pg_temp.dtick(v_d, 3.2);
    perform pg_temp.poll(v_code, a, b);
  end loop;
  v_q := pg_temp.dq(v_d, 2);
  perform pg_temp.ans(v_code, a, 2, pg_temp.right_of(v_q));
  perform pg_temp.ans(v_code, b, 2, pg_temp.right_of(v_q));
  perform pg_temp.away(v_d, b, 25);
  perform pg_temp.dtick(v_d, 7.2);
  s := pg_temp.ds(v_code, a);
  perform pg_temp.eq('wait 3: what is left of the budget (19.6 s), and the question opens without B then',
                     (s -> 'duel' ->> 'stage') || '/' || round(extract(epoch from ((s -> 'duel' ->> 'wait_until')::timestamptz - now())), 1)::text || '/' ||
                     (s -> 'duel' ->> 'wait_open'), 'wait/19.4/true');
  perform pg_temp.dtick(v_d, 19);
  perform pg_temp.eq('19.2 s: still the wait', pg_temp.ds(v_code, a) -> 'duel' ->> 'stage', 'wait');
  perform pg_temp.dtick(v_d, 0.6);
  s := pg_temp.ds(v_code, a);
  perform pg_temp.eq('the budget spent: the next question without B', (s -> 'duel' ->> 'stage') || '/' || (s -> 'question' ->> 'qi') || '/' ||
                     (s -> 'other' ->> 'present'), 'play/3/false');
  perform pg_temp.eq('B''s budget is spent', pg_temp.srow(v_d, b) ->> 'waited_ms', '120000');
  -- B stays away: its answer is none; at the next reveal's end no wait at all
  perform pg_temp.dtick(v_d, 3.2);
  perform pg_temp.ds(v_code, a);
  perform pg_temp.ans(v_code, a, 3, pg_temp.right_of(pg_temp.dq(v_d, 3)));
  perform pg_temp.dtick(v_d, 11.6);
  s := pg_temp.ds(v_code, a);
  perform pg_temp.eq('closed with none for B', s -> 'result' -> 'other' ->> 'none', 'true');
  perform pg_temp.dtick(v_d, 7.2);
  s := pg_temp.ds(v_code, a);
  perform pg_temp.eq('no wait once the budget is spent', (s -> 'duel' ->> 'stage') || '/' || (s -> 'question' ->> 'qi'), 'play/4');
  -- back, B plays on; nothing is charged twice
  s := pg_temp.ds(v_code, b);
  perform pg_temp.eq('B back plays the last question', (s -> 'duel' ->> 'stage') || '/' || (s -> 'question' ->> 'qi') || '/' ||
                     (pg_temp.srow(v_d, b) ->> 'waited_ms'), 'play/4/120000');
end
$t$;

-- ─── 9. The poll: «unchanged» while the rev is the same, with the stage and whether the other seat is here ───
do $t$
declare s jsonb; u jsonb; v_code text := pg_temp.c('lobby'); v_d uuid := pg_temp.duel(pg_temp.c('lobby'));
begin
  perform pg_temp.who('anon');
  s := pg_temp.ds(v_code, pg_temp.tok(24));
  u := public.duel_state(v_code, pg_temp.tok(24), (s ->> 'rev')::bigint);
  perform pg_temp.eq('unchanged: tiny', pg_temp.keys(u) || '/' || (u ->> 'unchanged') || '/' || (u ->> 'stage') || '/' || pg_temp.keys(u -> 'other') || '/' || (u -> 'other' ->> 'present'),
                     'now,other,rev,stage,unchanged/true/play/present/true');
  perform pg_temp.away(v_d, pg_temp.tok(26), 25);
  u := public.duel_state(v_code, pg_temp.tok(24), (s ->> 'rev')::bigint);
  perform pg_temp.eq('the other''s presence moves without a new rev', (u ->> 'unchanged') || '/' || (u -> 'other' ->> 'present'), 'true/false');
  perform pg_temp.dtick(v_d, 2);
  u := public.duel_state(v_code, pg_temp.tok(24), (s ->> 'rev')::bigint);
  perform pg_temp.eq('the question shows: a new rev, the whole state', coalesce(u ->> 'unchanged', 'null') || '/' || (u -> 'question' ->> 'qi') || '/' ||
                     ((u ->> 'rev')::bigint > (s ->> 'rev')::bigint)::text, 'null/0/true');
end
$t$;

-- ─── 10. «Ещё раз»: both press it; the same seats carry over with new ids, the match score, unplayed questions first, a
--     fixed set reshuffled, at most 20 rounds ───
do $t$
declare s jsonb; o jsonb; r jsonb; v_code text := pg_temp.c('ac'); v_d uuid := pg_temp.g('a'); a text := pg_temp.tok(4); b text := pg_temp.tok(2);
        v_new text; v_nd uuid; v_old_items text; v_items text; v_i integer;
begin
  perform pg_temp.who('anon');
  s := public.duel_rematch(v_code, b);
  perform pg_temp.eq('one press: no new duel yet', (s -> 'rematch' ->> 'me') || '/' || (s -> 'rematch' ->> 'other') || '/' || coalesce(s -> 'rematch' ->> 'code', 'null') || '/' ||
                     (s -> 'rematch' ->> 'round'), 'true/false/null/2');
  perform pg_temp.eq('the other sees the press', pg_temp.ds(v_code, a) -> 'rematch' ->> 'other', 'true');
  s := public.duel_rematch(v_code, a);
  v_new := s -> 'rematch' ->> 'code';
  perform pg_temp.yes('both pressed: the next duel''s code', v_new ~ '^[0-9a-hjkmnp-tv-z]{12}$' and v_new <> v_code);
  perform pg_temp.eq('the other gets the same code', pg_temp.ds(v_code, b) -> 'rematch' ->> 'code', v_new);
  perform pg_temp.eq('twice is fine', public.duel_rematch(v_code, b) -> 'rematch' ->> 'code', v_new);
  v_nd := pg_temp.duel(v_new);
  s := pg_temp.ds(v_new, a);
  o := pg_temp.ds(v_new, b);
  perform pg_temp.eq('the same seats by the same tokens, round 2, a new lobby, the match score',
                     (s -> 'me' ->> 'seat') || (o -> 'me' ->> 'seat') || '/' || (s -> 'me' ->> 'name') || ':' || (o -> 'me' ->> 'name') || '/' ||
                     (s -> 'duel' ->> 'round') || '/' || (s -> 'duel' ->> 'stage') || '/' || (s -> 'me' ->> 'dmg') || '/' ||
                     (s -> 'match' ->> 'me') || ':' || (s -> 'match' ->> 'other') || '/' || (o -> 'match' ->> 'me') || ':' || (o -> 'match' ->> 'other'),
                     '12/Аня:Боря/2/lobby/0/1:0/0:1');
  perform pg_temp.yes('new seat ids', pg_temp.seat(v_nd, a) <> pg_temp.seat(v_d, a) and pg_temp.seat(v_nd, b) <> pg_temp.seat(v_d, b));
  perform pg_temp.eq('the same settings, the same source, the parent', (select string_agg(x::text, '/') from (values
                       ((pg_temp.drow(v_nd) ->> 'parent_id') = v_d::text), ((pg_temp.drow(v_nd) ->> 'source') = (pg_temp.drow(v_d) ->> 'source')),
                       ((pg_temp.drow(v_nd) ->> 'time_s') = (pg_temp.drow(v_d) ->> 'time_s'))) t(x)), 'true/true/true');
  perform pg_temp.yes('no token, no hash in the rematch', pg_temp.clean(s) and pg_temp.clean(pg_temp.ds(v_code, a)));

  -- unplayed questions first: a pool of 8, 4 a round
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.duel_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 4}', pg_temp.c('p'), pg_temp.c('ps'))::jsonb, '{}'::jsonb, 'Аня', pg_temp.tok(30), null);
  v_new := r -> 'duel' ->> 'code';
  perform pg_temp.who('anon');
  perform public.duel_join(v_new, 'Боря', pg_temp.tok(31), null);
  for v_i in 1 .. 3 loop
    v_nd := pg_temp.duel(v_new);
    perform pg_temp.who('postgres');
    update public.live_duels set stage = 'final', ended_at = now(), end_reason = 'done', winner = case when v_i = 1 then null else 2 end where id = v_nd;
    perform pg_temp.who('anon');
    perform public.duel_rematch(v_new, pg_temp.tok(30));
    v_new := public.duel_rematch(v_new, pg_temp.tok(31)) -> 'rematch' ->> 'code';
    perform pg_temp.who('postgres');
    v_old_items := (select string_agg(text, ',' order by text) from public.live_duel_questions where duel_id = v_nd);
    v_items := (select string_agg(text, ',' order by text) from public.live_duel_questions where duel_id = pg_temp.duel(v_new));
    if v_i = 1 then
      perform pg_temp.eq('round 2 plays the four unplayed', (select count(*) from public.live_duel_questions q
                         where q.duel_id = pg_temp.duel(v_new) and q.item_id in (select item_id from public.live_duel_questions where duel_id = v_nd))::text, '0');
    end if;
    perform pg_temp.who('anon');
  end loop;
  s := pg_temp.ds(v_new, pg_temp.tok(31));
  perform pg_temp.eq('round 4: the match score, a draw counted', (s -> 'duel' ->> 'round') || '/' || (s -> 'match' ->> 'me') || ':' || (s -> 'match' ->> 'other') || ':' ||
                     (s -> 'match' ->> 'draws'), '4/2:0:1');
  -- 20 rounds at most
  perform pg_temp.who('postgres');
  update public.live_duels set round = 20, draws = 0, stage = 'final', ended_at = now(), end_reason = 'done' where id = pg_temp.duel(v_new);
  perform pg_temp.who('anon');
  perform pg_temp.eq('no 21st round', pg_temp.e(format('select public.duel_rematch(%L, %L)', v_new, pg_temp.tok(31))), 'ML004/rounds@400');
  perform pg_temp.eq('the 20th says so', pg_temp.ds(v_new, pg_temp.tok(30)) -> 'rematch' ->> 'possible', 'false');
end
$t$;

-- ─── 11. Sources a guest may use: the questions shown in a finished challenge run, the closed questions of a game
--     played — from their frozen copies, in their windows ───
do $t$
declare r jsonb; s jsonb; v_ch uuid; v_cc text; v_qi integer; v_g uuid; v_host text; v_pin text; h jsonb; v_code text; v_d uuid;
begin
  -- a challenge of the author, a guest's run of two questions before the author closes it
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.challenge_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 4}', pg_temp.c('k'), pg_temp.c('ks'))::jsonb,
                               format('{"deadline": "%s"}', (now() + interval '1 day')::text)::jsonb);
  v_ch := (r ->> 'challenge_id')::uuid;
  v_cc := r ->> 'code';
  perform pg_temp.put('ch', v_ch::text);
  perform pg_temp.put('chc', v_cc);
  perform pg_temp.who('anon');
  perform public.challenge_join(v_cc, 'Гость', pg_temp.tok(50), null);
  perform public.challenge_join(v_cc, 'Не начал', pg_temp.tok(51), null);
  for v_qi in 0 .. 1 loop
    perform public.challenge_next(v_cc, pg_temp.tok(50), v_qi);
    perform pg_temp.ctick(v_ch, 25);
    perform public.challenge_state(v_cc, pg_temp.tok(50));
  end loop;
  perform pg_temp.eq('while the challenge is open', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('challenge', v_cc, 'token', pg_temp.tok(50)), '{}', 'Гость', pg_temp.tok(52))), 'ML004/not_over@400');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform public.challenge_close(v_ch);
  perform pg_temp.who('anon');
  perform public.challenge_next(v_cc, pg_temp.tok(50), 2);
  perform pg_temp.eq('the run is over', public.challenge_state(v_cc, pg_temp.tok(50)) -> 'run' ->> 'finished', 'true');
  perform pg_temp.eq('a token of no run', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('challenge', v_cc, 'token', pg_temp.tok(99)), '{}', 'Гость', pg_temp.tok(52))), 'P0002/run@404');
  perform pg_temp.eq('no such challenge', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('challenge', 'zzzzzzzzzzzz', 'token', pg_temp.tok(50)), '{}', 'Гость', pg_temp.tok(52))), 'P0002/challenge@404');
  perform pg_temp.eq('a run that never started', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('challenge', v_cc, 'token', pg_temp.tok(51)), '{}', 'Гость', pg_temp.tok(52))), 'ML004/not_done@400');
  -- the exam is edited after the challenge: stems and a key
  perform pg_temp.who('postgres');
  update public.test_items set stem = 'Изменено: ' || stem where container_id = pg_temp.g('k');
  update public.test_items set correct = '{2}' where container_id = pg_temp.g('k') and stem = 'Изменено: Один верный';
  perform pg_temp.who('anon');
  s := public.duel_create(jsonb_build_object('challenge', v_cc, 'token', pg_temp.tok(50)), '{}'::jsonb, 'Гость', pg_temp.tok(52), null);
  v_code := s -> 'duel' ->> 'code';
  v_d := pg_temp.duel(v_code);
  perform pg_temp.put('gc', v_code);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the questions the run was shown, from the frozen copies: no edited stem, no new key',
                     (select count(*) || '/' || bool_and(text not like 'Изменено%') || '/' ||
                             bool_and(exists (select 1 from public.live_challenge_questions c where c.challenge_id = v_ch and c.text = q.text and c.key = q.key
                                                and c.options = q.options and c.item_rev = q.item_rev))
                        from public.live_duel_questions q where q.duel_id = v_d), '2/true/true');
  perform pg_temp.eq('a guest''s duel: the challenge''s settings and exam', (pg_temp.drow(v_d) ->> 'time_s') || '/' || (pg_temp.drow(v_d) ->> 'source') || '/' ||
                     ((pg_temp.drow(v_d) ->> 'container_id') = pg_temp.c('k'))::text || '/' || coalesce(pg_temp.drow(v_d) ->> 'owner_id', 'none'), '20/challenge/true/none');
  -- a fixed set: the rematch is the same set, reshuffled
  perform pg_temp.who('anon');
  perform public.duel_join(v_code, 'Соперник', pg_temp.tok(53), null);
  perform pg_temp.who('postgres');
  update public.live_duels set stage = 'final', ended_at = now(), end_reason = 'done' where id = v_d;
  perform pg_temp.who('anon');
  perform public.duel_rematch(v_code, pg_temp.tok(52));
  s := public.duel_rematch(v_code, pg_temp.tok(53));
  perform pg_temp.who('postgres');
  perform pg_temp.eq('a fixed set: the same questions in the rematch', (select string_agg(text || ':' || key, ',' order by text) from public.live_duel_questions
                     where duel_id = pg_temp.duel(s -> 'rematch' ->> 'code')), (select string_agg(text || ':' || key, ',' order by text) from public.live_duel_questions where duel_id = v_d));
  -- a run taken off; a week after the end
  update public.live_runs set removed_at = now() where challenge_id = v_ch and token_hash = meldy_private.live_hash(pg_temp.tok(50));
  perform pg_temp.who('anon');
  perform pg_temp.eq('a run taken off', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('challenge', v_cc, 'token', pg_temp.tok(50)), '{}', 'Гость', pg_temp.tok(54))), '42501/removed@403');
  perform pg_temp.who('postgres');
  update public.live_runs set removed_at = null where challenge_id = v_ch;
  perform pg_temp.ctick(v_ch, 7 * 86400 + 60);
  perform pg_temp.who('anon');
  perform pg_temp.eq('more than a week after the end', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('challenge', v_cc, 'token', pg_temp.tok(50)), '{}', 'Гость', pg_temp.tok(54))), 'ML002/expired@400');
  perform pg_temp.ctick(v_ch, -(7 * 86400 + 60) + 6 * 86400);

  -- a game: its closed questions from its frozen rows, at the podium or after the end, until a week later
  perform pg_temp.who('postgres');
  update public.test_items set stem = replace(stem, 'Изменено: ', '') where container_id = pg_temp.g('k');
  update public.live_games set state = 'ended', ended_at = now() where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001' and state <> 'ended';
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 4}', pg_temp.c('k'), pg_temp.c('ks'))::jsonb, '{"time_s": 20}'::jsonb);
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  v_pin := r ->> 'pin';
  perform pg_temp.put('game', v_g::text);
  perform pg_temp.who('anon');
  perform public.live_join(v_pin, 'Игрок', pg_temp.tok(60), null);
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  h := public.live_next(v_g, v_host, 'lobby');
  perform pg_temp.tick(v_g, 3 + 21.6);
  h := public.live_host_state(v_g, v_host);
  h := public.live_next(v_g, v_host, 'reveal');
  h := public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.tick(v_g, 3 + 21.6);
  h := public.live_host_state(v_g, v_host);
  perform pg_temp.eq('two questions closed', h ->> 'state', 'reveal');
  perform pg_temp.who('anon');
  perform pg_temp.eq('while the game goes on', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('game', v_g, 'token', pg_temp.tok(60)), '{}', 'Игрок', pg_temp.tok(61))), 'ML004/not_over@400');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform public.live_end(v_g, v_host);
  perform pg_temp.who('postgres');
  perform pg_temp.tick(v_g, 5);
  update public.test_items set stem = 'После игры: ' || stem where container_id = pg_temp.g('k');
  perform pg_temp.who('anon');
  perform pg_temp.eq('a token of no player', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('game', v_g, 'token', pg_temp.tok(99)), '{}', 'Игрок', pg_temp.tok(61))), 'P0002/player@404');
  s := public.duel_create(jsonb_build_object('game', v_g, 'token', pg_temp.tok(60)), '{"calm": true}'::jsonb, 'Игрок', pg_temp.tok(61), null);
  v_d := pg_temp.duel(s -> 'duel' ->> 'code');
  perform pg_temp.put('gamec', s -> 'duel' ->> 'code');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('only the closed questions, from the game''s rows; an item edited since is stale for practice',
                     (select count(*) || '/' || bool_and(text not like 'После игры%') || '/' || bool_and(item_rev = 0)
                        from public.live_duel_questions q where q.duel_id = v_d), '2/true/true');
  perform pg_temp.eq('the game''s exam, «Без спешки» asked', (pg_temp.drow(v_d) ->> 'source') || '/' || (pg_temp.drow(v_d) ->> 'calm') || '/' ||
                     ((pg_temp.drow(v_d) ->> 'source_id') = v_g::text)::text, 'game/true/true');
  update public.test_items set stem = replace(stem, 'После игры: ', '') where container_id = pg_temp.g('k');
  update public.live_players set kicked_at = now() where game_id = v_g;
  perform pg_temp.who('anon');
  perform pg_temp.eq('a kicked player', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('game', v_g, 'token', pg_temp.tok(60)), '{}', 'Игрок', pg_temp.tok(62))), '42501/kicked@403');
  perform pg_temp.who('postgres');
  update public.live_players set kicked_at = null where game_id = v_g;
  perform pg_temp.tick(v_g, 7 * 86400);
  perform pg_temp.who('anon');
  perform pg_temp.eq('a week after the game', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('game', v_g, 'token', pg_temp.tok(60)), '{}', 'Игрок', pg_temp.tok(62))), 'ML002/expired@400');
  perform pg_temp.tick(v_g, -7 * 86400);
end
$t$;

-- ─── 11b. «Дуэль на этих вопросах» after a game of «Встань на ответ» (every number as four ranges on the floor): its
--     numbers come as the typed numbers they are (the accepted numbers, tolerance and unit; no options, no range key),
--     and are graded as typed ───
do $t$
declare r jsonb; s jsonb; o jsonb; v_g uuid; v_host text; v_pin text; v_code text; v_d uuid; v_i integer; v_qi integer; v_q jsonb;
        a text := pg_temp.tok(141); b text := pg_temp.tok(142);
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.container_create('Встань', null, '[{"title":"Числа"}]');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 's:1', 'stem', 'Скорость звука', 'kind', 'number', 'answers', jsonb_build_array('343'), 'tolerance', 10, 'unit', 'м/с'),
    jsonb_build_object('ref', 's:2', 'stem', 'Два ответа', 'kind', 'number', 'answers', jsonb_build_array('10', '49'), 'tolerance', 1),
    jsonb_build_object('ref', 's:3', 'stem', 'Мороз', 'kind', 'number', 'answers', jsonb_build_array('-12'))));
  perform pg_temp.who('postgres');
  update public.live_games set state = 'ended', state_at = now(), ended_at = now(), end_reason = 'host', rev = rev + 1
   where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001' and state not in ('podium', 'ended');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', r ->> 'container_id', r -> 'subjects' -> 0 ->> 'id')::jsonb,
                          '{"mode": "stand"}');
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  v_pin := r ->> 'pin';
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the game plays every number as four ranges, a range key', (select string_agg(kind || ':' || jsonb_array_length(options) || ':' ||
                     cardinality(shown) || ':' || (key between 0 and 3)::text, ',') from public.live_questions where game_id = v_g),
                     'number:4:4:true,number:4:4:true,number:4:4:true');
  perform pg_temp.who('anon');
  perform public.live_join(v_pin, 'Стоящий', pg_temp.tok(140), null);
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform public.live_next(v_g, v_host, 'lobby');
  for v_i in 1 .. 3 loop
    v_qi := (public.live_host_state(v_g, v_host) ->> 'qi')::integer;
    perform pg_temp.tick(v_g, 4);
    perform pg_temp.tick(v_g, 14.5);
    perform public.live_stand_close(v_g, v_host, v_qi, '[]'::jsonb);
    if v_i < 3 then
      perform public.live_next(v_g, v_host, 'reveal');
      if public.live_host_state(v_g, v_host) ->> 'state' = 'leaderboard' then
        perform public.live_next(v_g, v_host, 'leaderboard');
      end if;
    end if;
  end loop;
  perform public.live_end(v_g, v_host);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('all three closed', (select count(*) from public.live_questions where game_id = v_g and closed_at is not null)::text, '3');
  -- the player's duel on these questions
  perform pg_temp.who('anon');
  s := public.duel_create(jsonb_build_object('game', v_g, 'token', pg_temp.tok(140)), '{"time_s": 20}'::jsonb, 'Стоящий', a, null);
  v_code := s -> 'duel' ->> 'code';
  v_d := pg_temp.duel(v_code);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('every range question as a typed number: no options, no shown order, no range key; the numbers, tolerance and unit',
                     (select string_agg(text || ':' || kind || ':' || options::text || ':' || shown::text || ':' || key || ':' || coalesce(keys::text, 'null') || ':' ||
                                        array_to_string(forms, '|') || ':' || coalesce(tolerance::text, 'null') || ':' || coalesce(unit, 'null') || ':' || keep_order,
                                        ',' order by text)
                        from public.live_duel_questions where duel_id = v_d),
                     (select string_agg(q.text || ':number:[]:{}:-1:null:' || array_to_string(q.forms, '|') || ':' || coalesce(q.tolerance::text, 'null') || ':' ||
                                        coalesce(q.unit, 'null') || ':false', ',' order by q.text)
                        from public.live_questions q where q.game_id = v_g));
  perform pg_temp.eq('the numbers as the exam has them', (select string_agg(text || '=' || array_to_string(forms, '|') || '±' || coalesce(tolerance::text, '0'), ',' order by text)
                                                          from public.live_duel_questions where duel_id = v_d),
                     'Два ответа=10|49±1,Мороз=-12±0,Скорость звука=343±10');
  -- played: typed, graded as typed (within the tolerance; either accepted number)
  perform pg_temp.who('anon');
  perform public.duel_join(v_code, 'Гость', b, null);
  perform public.duel_ready(v_code, a);
  perform public.duel_ready(v_code, b);
  perform pg_temp.dtick(v_d, 5);
  perform pg_temp.poll(v_code, a, b);
  for v_qi in 0 .. 2 loop
    v_q := pg_temp.dq(v_d, v_qi);
    o := pg_temp.ds(v_code, a) -> 'question';
    perform pg_temp.eq(format('question %s reads as a typed number', v_qi), (o ->> 'kind') || '/' || (o -> 'options')::text || '/' || (o ? 'ranges')::text,
                       'number/[]/false');
    perform public.duel_answer(v_code, a, v_qi, jsonb_build_object('text', case v_q ->> 'text' when 'Скорость звука' then '350' when 'Два ответа' then '49'
                                                                                              else '-12' end));
    s := public.duel_answer(v_code, b, v_qi, '{"text": "100000"}');
    perform pg_temp.eq(format('question %s: right as typed, the other wrong', v_qi),
                       (s -> 'result' -> 'other' ->> 'correct') || '/' || (s -> 'result' -> 'me' ->> 'correct'), 'true/false');
    perform public.duel_next(v_code, a, v_qi);
    perform public.duel_next(v_code, b, v_qi);
    if v_qi < 2 then
      perform pg_temp.dtick(v_d, 3.2);
      perform pg_temp.poll(v_code, a, b);
    end if;
  end loop;
  s := pg_temp.ds(v_code, a);
  perform pg_temp.eq('the player wins on these questions', (s -> 'duel' ->> 'stage') || '/' || (s -> 'final' ->> 'winner') || '/' || (s -> 'me' ->> 'right'), 'final/me/3');
end
$t$;

-- A duel played to its end by time-outs (both seats here, nobody answers), from wherever it is.
create or replace function pg_temp.run_out(p_code text, p_t1 text, p_t2 text) returns jsonb language plpgsql as $fn$
declare s jsonb; v_d uuid := pg_temp.duel(p_code); v_i integer := 0;
begin
  perform public.duel_ready(p_code, p_t1);
  perform public.duel_ready(p_code, p_t2);
  loop
    v_i := v_i + 1;
    s := public.duel_state(p_code, p_t1, null);
    exit when s -> 'duel' ->> 'stage' = 'final' or v_i > 100;
    if s -> 'question' ? 'closed_at' then
      perform public.duel_next(p_code, p_t1, (s -> 'question' ->> 'qi')::integer);
      perform public.duel_next(p_code, p_t2, (s -> 'question' ->> 'qi')::integer);
    else
      perform pg_temp.dtick(v_d, extract(epoch from ((s -> 'question' ->> 'closes_at')::timestamptz - now())) + 1.6);
      perform public.duel_state(p_code, p_t2, null);
    end if;
  end loop;
  return s;
end;
$fn$;
grant execute on function pg_temp.run_out(text, text, text) to authenticated, anon, service_role;

-- ─── 12. «Тренировать ошибки»: a member records; anyone else joins the exam only with a standing of their own; never
--     after a duel that expired unplayed (the review's attack: a guest's duel from an old run, a stranger on its second
--     seat, the lobby expires, the stranger asks for practice) ───
do $t$
declare r jsonb; s jsonb; v_code text; v_d uuid; v_quiz uuid; v_ch uuid; v_cc text; v_n integer; v_qi integer;
begin
  -- the attack: refused, no membership
  perform pg_temp.who('anon');
  s := public.duel_create(jsonb_build_object('challenge', pg_temp.c('chc'), 'token', pg_temp.tok(50)), '{}'::jsonb, 'Гость', pg_temp.tok(70), null);
  v_code := s -> 'duel' ->> 'code';
  v_d := pg_temp.duel(v_code);
  perform pg_temp.who('authenticated', '51515151-0000-0000-0000-000000000051');
  perform public.duel_join(v_code, 'Чужой', pg_temp.tok(71), null);
  perform pg_temp.eq('practice before the end', pg_temp.e(format('select public.duel_practice(%L, %L)', v_code, pg_temp.tok(71))), 'ML004/not_done@400');
  perform pg_temp.dtick(v_d, 86401);
  perform pg_temp.eq('the lobby expired: practice refused', pg_temp.e(format('select public.duel_practice(%L, %L)', v_code, pg_temp.tok(71))), 'ML002/expired@400');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the stranger is no member', (select count(*) from public.container_members where user_id = '51515151-0000-0000-0000-000000000051')::text, '0');

  -- a quiz that offers practice, a challenge from it, a guest's run, a duel from that run
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.quiz_create(pg_temp.g('k'), jsonb_build_object('title', 'Контрольная', 'attempts', null, 'offer_practice', true));
  v_quiz := (r ->> 'id')::uuid;
  perform pg_temp.put('quiz', v_quiz::text);
  r := public.challenge_create(jsonb_build_object('quiz_id', v_quiz), format('{"deadline": "%s"}', (now() + interval '1 day')::text)::jsonb);
  v_ch := (r ->> 'challenge_id')::uuid;
  v_cc := r ->> 'code';
  perform pg_temp.who('anon');
  perform public.challenge_join(v_cc, 'Гость-3', pg_temp.tok(72), null);
  v_n := (r ->> 'q_count')::integer;
  for v_qi in 0 .. v_n - 1 loop
    perform public.challenge_next(v_cc, pg_temp.tok(72), v_qi);
    perform pg_temp.ctick(v_ch, 25);
    perform public.challenge_state(v_cc, pg_temp.tok(72));
  end loop;
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform public.challenge_close(v_ch);
  perform pg_temp.who('postgres');
  update public.quizzes set closed_at = now() - interval '1 minute' where container_id = pg_temp.g('k');
  perform pg_temp.who('anon');
  s := public.duel_create(jsonb_build_object('challenge', v_cc, 'token', pg_temp.tok(72)), '{"time_s": 10}'::jsonb, 'Гость-3', pg_temp.tok(73), null);
  v_code := s -> 'duel' ->> 'code';
  perform pg_temp.who('authenticated', '52525252-0000-0000-0000-000000000052');
  perform public.duel_join(v_code, 'Чужой-2', pg_temp.tok(74), null);
  s := pg_temp.run_out(v_code, pg_temp.tok(73), pg_temp.tok(74));
  perform pg_temp.eq('played through', s -> 'final' ->> 'reason', 'done');
  perform pg_temp.eq('a stranger who played the duel but not the source', pg_temp.e(format('select public.duel_practice(%L, %L)', v_code, pg_temp.tok(74))), 'ML012/practice@403');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('and no member', (select count(*) from public.container_members where user_id = '52525252-0000-0000-0000-000000000052')::text, '0');
  -- the guest who made it from their own run signs in: the run's standing (the first seat of this duel)
  perform pg_temp.who('authenticated', '53535353-0000-0000-0000-000000000053');
  r := public.duel_practice(v_code, pg_temp.tok(73));
  perform pg_temp.eq('the run''s own player joins through the quiz that offers it', (r ->> 'joined') || '/' || ((r ->> 'mistakes')::integer > 0)::text || '/' ||
                     ((r ->> 'saved') = (r ->> 'mistakes'))::text, 'true/true/true');
  perform pg_temp.who('postgres');
  perform pg_temp.yes('a member now', meldy_private.role_in('53535353-0000-0000-0000-000000000053', pg_temp.g('k')) = 'member');

  -- the author's own duel from the quiz: the invited one joins through the quiz
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  s := public.duel_create(jsonb_build_object('quiz_id', v_quiz), '{"time_s": 10}'::jsonb, 'Аня', pg_temp.tok(75), null);
  v_code := s -> 'duel' ->> 'code';
  perform pg_temp.who('authenticated', '54545454-0000-0000-0000-000000000054');
  perform public.duel_join(v_code, 'Приглашённый', pg_temp.tok(76), null);
  perform pg_temp.run_out(v_code, pg_temp.tok(75), pg_temp.tok(76));
  r := public.duel_practice(v_code, pg_temp.tok(76));
  perform pg_temp.eq('an author''s duel: the invited one joins through the quiz', r ->> 'joined', 'true');
  -- the author's duel from the exam itself: no quiz offers it
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  s := public.duel_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 4}', pg_temp.c('k'), pg_temp.c('ks'))::jsonb, '{"time_s": 10}'::jsonb, 'Аня', pg_temp.tok(77), null);
  v_code := s -> 'duel' ->> 'code';
  v_d := pg_temp.duel(v_code);
  perform pg_temp.who('authenticated', '55555555-0000-0000-0000-000000000055');
  perform public.duel_join(v_code, 'Без квиза', pg_temp.tok(78), null);
  perform pg_temp.run_out(v_code, pg_temp.tok(77), pg_temp.tok(78));
  perform pg_temp.eq('no quiz offers practice', pg_temp.e(format('select public.duel_practice(%L, %L)', v_code, pg_temp.tok(78))), 'ML012/practice@403');
  perform pg_temp.who('anon');
  perform pg_temp.eq('a guest: sign in first', pg_temp.e(format('select public.duel_practice(%L, %L)', v_code, pg_temp.tok(78))), '28000/@401');
  -- the author: recorded at once, once; an item whose key changed since is stale
  perform pg_temp.who('postgres');
  update public.test_items set answers = array_append(answers, 'Мск') where container_id = pg_temp.g('k') and kind = 'short';
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.duel_practice(v_code, pg_temp.tok(77));
  perform pg_temp.eq('four mistakes, three recorded: the changed item is stale', (r ->> 'joined') || '/' || (r ->> 'mistakes') || '/' || (r ->> 'saved'), 'false/4/3');
  r := public.duel_practice(v_code, pg_temp.tok(77));
  perform pg_temp.who('postgres');
  perform pg_temp.eq('a second press records nothing twice', (r ->> 'saved') || '/' || (select count(*) from public.test_answers
                     where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and client_event_id like 'ld:%')::text, '3/3');
  perform pg_temp.yes('by ld:<duel>:<seat>:<qi>', (select bool_and(client_event_id ~ ('^ld:' || replace(v_d::text, '-', '') || ':1:[0-9]+$'))
                                                    from public.test_answers where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and client_event_id like 'ld:%'));
  -- a week after the end
  perform pg_temp.dtick(v_d, 8 * 86400);
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('a week after the end', pg_temp.e(format('select public.duel_practice(%L, %L)', v_code, pg_temp.tok(77))), 'ML002/expired@400');
  perform pg_temp.who('anon');
  perform pg_temp.eq('the review stays', jsonb_array_length(public.duel_review(v_code, pg_temp.tok(77)) -> 'items')::text, '4');
end
$t$;

-- ─── 13. The limits: an account's 20 an hour and 20 unfinished (a lobby only while its creator is around), a rematch
--     counted; a guest's 120 an hour per address, never for a signed-in person on that address; a challenge run's or a
--     game player's own 20 an hour and 5 unfinished, whatever the address; joins: an account's 120 a minute and 300 a
--     day, a guest's 120 a minute and 3000 a day per address ───
do $t$
declare r jsonb; s jsonb; v_c text; v_cs text; v_ip text; v_code text; v_code2 text; v_run uuid; v_rc text; v_i integer; v_n integer; v_l text[];
begin
  -- 20 creates an hour per account
  perform pg_temp.who('authenticated', '61616161-0000-0000-0000-000000000061');
  r := public.container_create('Лимит', null, '[{"title":"Всё"}]');
  v_c := r ->> 'container_id';
  v_cs := r -> 'subjects' -> 0 ->> 'id';
  perform public.container_items_add(v_cs::uuid, (select jsonb_agg(jsonb_build_object('ref', 'l:' || i, 'stem', 'Л ' || i, 'options', jsonb_build_array('да', 'нет'),
                                                                                       'correct', jsonb_build_array(0))) from generate_series(1, 3) i));
  perform pg_temp.who('postgres');
  insert into public.live_duels (code, owner_id, container_id, source, title, q_count, stage, ended_at, end_reason, created_at)
  select meldy_private.random_code(), '61616161-0000-0000-0000-000000000061', v_c::uuid, 'container', 'Старая', 1, 'final', now(), 'done', now() - interval '30 minutes'
    from generate_series(1, 19);
  perform pg_temp.who('authenticated', '61616161-0000-0000-0000-000000000061');
  s := public.duel_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', v_c, v_cs)::jsonb, '{}'::jsonb, 'Лимит', pg_temp.tok(80), null);
  v_code := s -> 'duel' ->> 'code';
  perform pg_temp.eq('the 21st create of an hour', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', v_c, v_cs), '{}', 'Лимит', pg_temp.tok(81))), 'ML005/create@429');
  perform pg_temp.yes('with Retry-After', (current_setting('live_test.headers')::jsonb ->> 'Retry-After')::integer between 1 and 3600);
  -- a rematch counts against it too
  perform pg_temp.who('anon');
  perform public.duel_join(v_code, 'Второй', pg_temp.tok(82), null);
  perform pg_temp.who('postgres');
  update public.live_duels set stage = 'final', ended_at = now(), end_reason = 'done' where code = v_code;
  perform pg_temp.who('anon');
  perform public.duel_rematch(v_code, pg_temp.tok(82));
  perform pg_temp.eq('a rematch over the hour''s limit', pg_temp.e(format('select public.duel_rematch(%L, %L)', v_code, pg_temp.tok(80))), 'ML005/create@429');
  perform pg_temp.eq('the press stays undone with it', pg_temp.ds(v_code, pg_temp.tok(80)) -> 'rematch' ->> 'me', 'false');
  -- 20 unfinished per account: lobbies whose creator was here 10 minutes ago
  perform pg_temp.who('postgres');
  insert into public.live_duels (code, owner_id, container_id, source, title, q_count, created_at)
  select meldy_private.random_code(), '62626262-0000-0000-0000-000000000062', v_c::uuid, 'container', 'Открытая', 1, now() - interval '2 hours'
    from generate_series(1, 20);
  insert into public.live_duel_seats (duel_id, seat, token_hash, name, look, joined_at, seen_at)
  select d.id, 1, encode(sha256(convert_to(d.id::text, 'UTF8')), 'hex'), 'Я', '{}'::jsonb, now() - interval '2 hours', now() - interval '10 minutes'
    from public.live_duels d where d.owner_id = '62626262-0000-0000-0000-000000000062';
  perform pg_temp.who('authenticated', '62626262-0000-0000-0000-000000000062');
  r := public.container_create('Лимит 2', null, '[{"title":"Всё"}]');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, (select jsonb_agg(jsonb_build_object('ref', 'm:' || i, 'stem', 'М ' || i,
                                     'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0))) from generate_series(1, 3) i));
  perform pg_temp.eq('20 unfinished', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', r ->> 'container_id', r -> 'subjects' -> 0 ->> 'id'), '{}', 'Открыто', pg_temp.tok(83))), 'ML009/@400');
  -- their creator has been gone 31 minutes: those lobbies no longer count
  perform pg_temp.who('postgres');
  update public.live_duel_seats s set seen_at = now() - interval '31 minutes'
    from public.live_duels d where d.id = s.duel_id and d.owner_id = '62626262-0000-0000-0000-000000000062';
  perform pg_temp.who('authenticated', '62626262-0000-0000-0000-000000000062');
  perform pg_temp.eq('a lobby whose creator left 30 minutes ago is not unfinished', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', r ->> 'container_id', r -> 'subjects' -> 0 ->> 'id'), '{}', 'Открыто', pg_temp.tok(83))), 'ok');

  -- a guest: 120 creates an hour per address
  perform pg_temp.who('postgres', null, '203.0.113.7');
  v_ip := meldy_private.quiz_ip_hash();
  perform pg_temp.yes('the address is read', v_ip ~ '^[0-9a-f]{64}$');
  insert into meldy_private.live_duel_hits (ip_hash, kind, at) select v_ip, 'create', now() - interval '20 minutes' from generate_series(1, 119);
  perform pg_temp.who('anon', null, '203.0.113.7');
  perform pg_temp.eq('the 120th guest create of an address', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('challenge', pg_temp.c('chc'), 'token', pg_temp.tok(50)), '{}', 'Гость', pg_temp.tok(84))), 'ok');
  perform pg_temp.eq('the 121st', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('challenge', pg_temp.c('chc'), 'token', pg_temp.tok(50)), '{}', 'Гость', pg_temp.tok(85))), 'ML005/create@429');
  perform pg_temp.who('anon', null, '198.51.100.40');
  perform pg_temp.eq('another address is fine', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('challenge', pg_temp.c('chc'), 'token', pg_temp.tok(50)), '{}', 'Гость', pg_temp.tok(86))), 'ok');
  -- a signed-in person on the same busy address keeps the account's own limit
  perform pg_temp.who('authenticated', '63636363-0000-0000-0000-000000000063', '203.0.113.7');
  r := public.container_create('Класс', null, '[{"title":"Всё"}]');
  v_c := r ->> 'container_id';
  v_cs := r -> 'subjects' -> 0 ->> 'id';
  perform public.container_items_add(v_cs::uuid, (select jsonb_agg(jsonb_build_object('ref', 'n:' || i, 'stem', 'Н ' || i, 'options', jsonb_build_array('да', 'нет'),
                                                                                       'correct', jsonb_build_array(0))) from generate_series(1, 3) i));
  s := public.duel_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', v_c, v_cs)::jsonb, '{}'::jsonb, 'Учитель', pg_temp.tok(87), null);
  perform pg_temp.yes('an account behind the busy address is not refused', s -> 'duel' ->> 'code' is not null);
  v_code := s -> 'duel' ->> 'code';
  v_code2 := public.duel_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', v_c, v_cs)::jsonb, '{}'::jsonb, 'Учитель', pg_temp.tok(88), null) -> 'duel' ->> 'code';
  perform pg_temp.who('postgres');
  perform pg_temp.eq('an account''s creates leave the address''s count alone', (select count(*) from meldy_private.live_duel_hits where ip_hash = v_ip and kind = 'create')::text, '120');

  -- the run's own cap, whatever the address it comes from: 5 unfinished
  v_run := (select id from public.live_runs where challenge_id = pg_temp.g('ch') and token_hash = meldy_private.live_hash(pg_temp.tok(50)));
  v_n := (select count(*) from public.live_duels d where d.source_ref = v_run and meldy_private.live_duel_alive(d));
  perform pg_temp.yes('the run has some unfinished duels so far', v_n between 1 and 4);
  perform pg_temp.who('anon', null, '192.0.2.1');
  v_rc := public.duel_create(jsonb_build_object('challenge', pg_temp.c('chc'), 'token', pg_temp.tok(50)), '{}'::jsonb, 'Гость', pg_temp.tok(101), null) -> 'duel' ->> 'code';
  for v_i in 2 .. 5 - v_n loop
    perform pg_temp.who('anon', null, '192.0.2.' || v_i);
    perform pg_temp.eq('a create from the run, a new address each time', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
      jsonb_build_object('challenge', pg_temp.c('chc'), 'token', pg_temp.tok(50)), '{}', 'Гость', pg_temp.tok(100 + v_i))), 'ok');
  end loop;
  perform pg_temp.who('anon', null, '192.0.2.9');
  perform pg_temp.eq('the run''s 6th unfinished duel', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('challenge', pg_temp.c('chc'), 'token', pg_temp.tok(50)), '{}', 'Гость', pg_temp.tok(104))), 'ML009/source@400');
  -- 20 an hour: finished ones count too, and a rematch
  perform pg_temp.who('anon', null, '192.0.2.10');
  perform public.duel_join(v_rc, 'Соперник', pg_temp.tok(105), null);
  perform pg_temp.who('postgres');
  update public.live_duels set stage = 'final', ended_at = now(), end_reason = 'done', qi = 0 where source_ref = v_run and stage <> 'final';
  v_i := pg_temp.n(format('select 1 from public.live_duels where source_ref = %L and created_at > now() - interval ''1 hour''', v_run));
  perform pg_temp.who('postgres');
  insert into public.live_duels (code, container_id, source, source_id, source_ref, title, q_count, stage, ended_at, end_reason, created_at)
  select meldy_private.random_code(), pg_temp.g('k'), 'challenge', pg_temp.g('ch'), v_run, 'Ранее', 1, 'final', now(), 'done', now() - interval '50 minutes'
    from generate_series(1, 19 - v_i);
  perform pg_temp.who('anon', null, '192.0.2.11');
  perform pg_temp.eq('the run''s 20th create of an hour', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('challenge', pg_temp.c('chc'), 'token', pg_temp.tok(50)), '{}', 'Гость', pg_temp.tok(106))), 'ok');
  perform pg_temp.who('anon', null, '192.0.2.12');
  perform pg_temp.eq('the 21st, from yet another address', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    jsonb_build_object('challenge', pg_temp.c('chc'), 'token', pg_temp.tok(50)), '{}', 'Гость', pg_temp.tok(107))), 'ML005/create@429');
  perform pg_temp.yes('with Retry-After (about 10 minutes: the oldest of the hour leaves then)',
                      (current_setting('live_test.headers')::jsonb ->> 'Retry-After')::integer between 590 and 610);
  perform public.duel_rematch(v_rc, pg_temp.tok(105));
  perform pg_temp.eq('a rematch of the run''s duel counts', pg_temp.e(format('select public.duel_rematch(%L, %L)', v_rc, pg_temp.tok(101))), 'ML005/create@429');

  -- joins of a signed-in person: by the account, never refused for the address (four more open lobbies of the teacher)
  perform pg_temp.who('authenticated', '63636363-0000-0000-0000-000000000063', '198.51.100.10');
  select array_agg(public.duel_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', v_c, v_cs)::jsonb, '{}'::jsonb, 'Учитель',
                                      pg_temp.tok(120 + i), null) -> 'duel' ->> 'code' order by i) into v_l from generate_series(1, 4) i;
  perform pg_temp.who('postgres', null, '198.51.100.9');
  v_ip := meldy_private.quiz_ip_hash();
  insert into meldy_private.live_duel_hits (ip_hash, kind, at) select v_ip, 'join', now() - interval '20 seconds' from generate_series(1, 200);
  insert into meldy_private.live_duel_hits (user_id, kind, at) select '64646464-0000-0000-0000-000000000064', 'join', now() - interval '3 hours' from generate_series(1, 299);
  perform pg_temp.who('authenticated', '65656565-0000-0000-0000-000000000065', '198.51.100.9');
  perform pg_temp.eq('an account behind an address over the limit joins', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_l[4], 'Ученица', pg_temp.tok(108))), 'ok');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('counted by the account, not the address', (select count(*) from meldy_private.live_duel_hits where user_id = '65656565-0000-0000-0000-000000000065')::text || '/' ||
                     (select count(*) from meldy_private.live_duel_hits where ip_hash = v_ip)::text, '1/200');
  perform pg_temp.who('authenticated', '64646464-0000-0000-0000-000000000064', '198.51.100.11');
  perform pg_temp.eq('the account''s 300th join of a day', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_l[1], 'Много', pg_temp.tok(110))), 'ok');
  perform pg_temp.eq('the 301st', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_l[2], 'Много', pg_temp.tok(111))), 'ML005/join@429');
  perform pg_temp.yes('with Retry-After (a day at most)', (current_setting('live_test.headers')::jsonb ->> 'Retry-After')::integer between 1 and 86400);

  -- joins of guests: 120 a minute and 3000 a day per address
  perform pg_temp.who('postgres', null, '198.51.100.7');
  v_ip := meldy_private.quiz_ip_hash();
  insert into meldy_private.live_duel_hits (ip_hash, kind, at) select v_ip, 'join', now() - interval '20 seconds' from generate_series(1, 119);
  perform pg_temp.who('anon', null, '198.51.100.7');
  perform pg_temp.eq('the 120th join of a minute', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_code, 'Ученик', pg_temp.tok(89))), 'ok');
  perform pg_temp.eq('the 121st', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_code2, 'Ученик', pg_temp.tok(91))), 'ML005/join@429');
  perform pg_temp.yes('with Retry-After (a minute at most)', (current_setting('live_test.headers')::jsonb ->> 'Retry-After')::integer between 1 and 60);
  perform pg_temp.eq('the same token comes back past the limit', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_code, 'Ученик', pg_temp.tok(89))), 'ok');
  perform pg_temp.who('postgres', null, '198.51.100.8');
  v_ip := meldy_private.quiz_ip_hash();
  insert into meldy_private.live_duel_hits (ip_hash, kind, at) select v_ip, 'join', now() - interval '3 hours' from generate_series(1, 2999);
  perform pg_temp.who('anon', null, '198.51.100.8');
  perform pg_temp.eq('a school''s 3000th join of a day on one address', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_l[2], 'Ученик', pg_temp.tok(92))), 'ok');
  perform pg_temp.eq('the 3001st', pg_temp.e(format('select public.duel_join(%L, %L, %L, null)', v_l[3], 'Ученик', pg_temp.tok(112))), 'ML005/join@429');
  perform pg_temp.yes('with Retry-After (a day at most)', (current_setting('live_test.headers')::jsonb ->> 'Retry-After')::integer between 1 and 86400);
end
$t$;

-- ─── 14. The create checks everything before it cleans up old duels: 90 days after their create, and a lobby nobody
--     joined a day after it expired ───
do $t$
declare v_old uuid; v_l uuid[];
begin
  perform pg_temp.who('postgres');
  insert into public.live_duels (code, owner_id, container_id, source, title, q_count, stage, ended_at, end_reason, created_at)
  values (meldy_private.random_code(), 'aaaaaaaa-0000-0000-0000-000000000001', pg_temp.g('p'), 'container', 'Давняя', 1, 'final', now() - interval '99 days', 'done',
          now() - interval '100 days')
  returning id into v_old;
  -- lobbies: expired 25 hours ago and nobody joined; never settled since (still a lobby) 2.5 days on; expired but someone
  -- joined; expired 12 hours ago; a rematch that expired
  with ins as (
    insert into public.live_duels (code, owner_id, container_id, source, title, q_count, stage, ended_at, end_reason, created_at, round)
    select meldy_private.random_code(), 'aaaaaaaa-0000-0000-0000-000000000001', pg_temp.g('p'), 'container', 'Лобби ' || x.n, 1, x.stage,
           case when x.stage = 'final' then now() - x.made + interval '1 day' end, x.reason, now() - x.made, x.round
      from (values (1, 'final', 'expired', interval '49 hours', 1), (2, 'lobby', null, interval '60 hours', 1), (3, 'final', 'expired', interval '49 hours', 1),
                   (4, 'final', 'expired', interval '36 hours', 1), (5, 'final', 'expired', interval '49 hours', 2)) x(n, stage, reason, made, round)
    returning id, title)
  select array_agg(id order by title) into v_l from ins;
  insert into public.live_duel_seats (duel_id, seat, token_hash, name, look)
  select v_l[3], z, encode(sha256(convert_to(v_l[3]::text || z, 'UTF8')), 'hex'), 'Был', '{}'::jsonb from generate_series(1, 2) z;
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('a create refused for its name', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('p'), pg_temp.c('ps')), '{}', 'хуйло', pg_temp.tok(93))), 'ML006/rude@400');
  perform pg_temp.eq('a create refused for its source', pg_temp.e(format('select public.duel_create(%L, %L, %L, %L)',
    format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('e'), pg_temp.c('es')), '{}', 'Аня', pg_temp.tok(93))), 'ML008/2@400');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the refusals cleaned nothing up', (select count(*) from public.live_duels where id = v_old or id = any (v_l))::text, '6');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform public.duel_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('p'), pg_temp.c('ps'))::jsonb, '{}'::jsonb, 'Аня', pg_temp.tok(93), null);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('a create that goes through cleans up after its checks', (select count(*) from public.live_duels where id = v_old)::text, '0');
  perform pg_temp.eq('lobbies nobody joined go a day after they expired; the joined, the recent and the rematch stay',
                     (select string_agg(title, ',' order by title) from public.live_duels where id = any (v_l)), 'Лобби 3,Лобби 4,Лобби 5');
end
$t$;

-- ─── 15. Nothing of a token or a seat id anywhere in the tables' API ───
do $t$
begin
  perform pg_temp.who('anon');
  perform pg_temp.yes('the info of every duel is clean', (select bool_and(pg_temp.clean(public.duel_info(code)))
                                                           from jsonb_array_elements_text(pg_temp.sudo('select jsonb_agg(code) from public.live_duels')) code));
  perform pg_temp.who('postgres');
  perform pg_temp.yes('no plain token is kept', not exists (select 1 from public.live_duel_seats where token_hash ~ 'tok'));
end
$t$;

rollback;
\echo LIVE DUEL BEHAVIOUR PASSED
