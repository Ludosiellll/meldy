-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261102090100_live_numbers.sql on the
-- scratch database of live_game_run.sh, after the kinds and teams step and release 48's question kinds: number questions
-- in a battle (a tolerance and a unit, an exact one with two accepted numbers: the verdict is public.meldy_number_right's,
-- the tops and the spread, every refusal of live_answer and live_submit), the review, «Тренировать ошибки» (the number
-- typed goes to the study core), a battle with movement rounds (no number on a round) and «Встань на ответ» (none), and
-- a one-answer game's messages unchanged. One transaction, rolled back; time moves by a time machine (pg_temp.tick).
-- A failure raises; success prints LIVE NUMBERS BEHAVIOUR PASSED.
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
create or replace function pg_temp.j(p_sql text) returns jsonb language plpgsql as $fn$
declare v jsonb;
begin
  execute p_sql into v;
  return v;
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
-- The time machine: every time of a game (and the address throttle) moves back by p_s seconds. Runs as the session.
create or replace function pg_temp.tick(p_game uuid, p_s numeric) returns void language plpgsql as $fn$
declare v_role text := current_user; v_i interval := make_interval(secs => p_s::double precision);
begin
  perform set_config('role', 'none', true);
  update public.live_games set created_at = created_at - v_i, state_at = state_at - v_i, q_ready_at = q_ready_at - v_i,
         q_opens_at = q_opens_at - v_i, q_closes_at = q_closes_at - v_i, ended_at = ended_at - v_i,
         tg_posted_at = tg_posted_at - v_i, tg_edit_at = tg_edit_at - v_i, tg_sync_at = tg_sync_at - v_i,
         tg_final_at = tg_final_at - v_i
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
-- The hints sent so far (flushes the deferred trigger first).
create or replace function pg_temp.hints(p_game uuid) returns jsonb language plpgsql as $fn$
declare v_role text := current_user; v jsonb;
begin
  perform set_config('role', 'none', true);
  set constraints all immediate;
  set constraints all deferred;
  select coalesce(jsonb_agg(jsonb_build_object('payload', s.payload, 'event', s.event, 'private', s.private) order by s.id), '[]')
    into v from realtime.sent s
   where s.topic = 'live:' || (select topic from public.live_games where id = p_game);
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  return v;
end;
$fn$;
create or replace function pg_temp.key_of(p_game uuid, p_qi integer) returns integer language plpgsql as $fn$
declare v_role text := current_user; v integer;
begin
  perform set_config('role', 'none', true);
  select key into v from public.live_questions where game_id = p_game and qi = p_qi;
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  return v;
end;
$fn$;
create or replace function pg_temp.st(p_game uuid, p_tok text, p_since bigint default null) returns jsonb language sql as $fn$
  select public.live_state(p_game, p_tok, p_since)
$fn$;
create or replace function pg_temp.hs(p_game uuid, p_host text, p_since bigint default null) returns jsonb language sql as $fn$
  select public.live_host_state(p_game, p_host, p_since)
$fn$;
create or replace function pg_temp.ans(p_game uuid, p_tok text, p_qi integer, p_choice integer) returns text language sql as $fn$
  select pg_temp.e(format('select public.live_answer(%L, %L, %s, %s)', p_game, p_tok, p_qi, p_choice))
$fn$;
create or replace function pg_temp.pics(p_game uuid, p_qi integer) returns text language plpgsql as $fn$
declare v_role text := current_user; v text;
begin
  perform set_config('role', 'none', true);
  select pictures::text into v from public.live_questions where game_id = p_game and qi = p_qi;
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  return v;
end;
$fn$;
create or replace function pg_temp.qrow(p_game uuid, p_qi integer) returns jsonb language plpgsql as $fn$
declare v_role text := current_user; v jsonb;
begin
  perform set_config('role', 'none', true);
  select to_jsonb(q) into v from public.live_questions q where game_id = p_game and qi = p_qi;
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  return v;
end;
$fn$;
create or replace function pg_temp.prow(p_pid uuid) returns jsonb language plpgsql as $fn$
declare v_role text := current_user; v jsonb;
begin
  perform set_config('role', 'none', true);
  select to_jsonb(p) into v from public.live_players p where id = p_pid;
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  return v;
end;
$fn$;
create or replace function pg_temp.arow(p_game uuid, p_qi integer, p_pid uuid) returns jsonb language plpgsql as $fn$
declare v_role text := current_user; v jsonb;
begin
  perform set_config('role', 'none', true);
  select to_jsonb(a) into v from public.live_answers a where game_id = p_game and qi = p_qi and player_id = p_pid;
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  return v;
end;
$fn$;
create or replace function pg_temp.dmg(p_e integer, p_t integer, p_s integer, p_speed boolean) returns integer language plpgsql as $fn$
declare v_role text := current_user; v integer;
begin
  perform set_config('role', 'none', true);
  v := meldy_private.live_damage(p_e, p_t, p_s, p_speed);
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  return v;
end;
$fn$;
create or replace function pg_temp.spts(p_e integer, p_t integer, p_s integer, p_speed boolean, p_ghost boolean) returns integer language plpgsql as $fn$
declare v_role text := current_user; v integer;
begin
  perform set_config('role', 'none', true);
  v := meldy_private.live_stand_points(p_e, p_t, p_s, p_speed, p_ghost);
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  return v;
end;
$fn$;
create or replace function pg_temp.sub(p_game uuid, p_tok text, p_qi integer, p_answer jsonb) returns text language sql as $fn$
  select pg_temp.e(format('select public.live_submit(%L, %L, %s, %L)', p_game, p_tok, p_qi, p_answer))
$fn$;
create or replace function pg_temp.close(p_game uuid, p_host text, p_qi integer, p_answers jsonb) returns text language sql as $fn$
  select pg_temp.e(format('select public.live_stand_close(%L, %L, %s, %L)', p_game, p_host, p_qi, p_answers))
$fn$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;
create or replace function pg_temp.num(p_text text, p_unit text) returns numeric language plpgsql as $fn$
declare v_role text := current_user; v numeric;
begin
  perform set_config('role', 'none', true);
  v := meldy_private.live_number_value(p_text, p_unit);
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  return v;
end;
$fn$;
grant execute on function pg_temp.num(text, text) to authenticated, anon, service_role;

-- ─── 1. Exam N: number questions (one with a tolerance and a unit, one exact with two accepted numbers), a single
--        answer, an order question (never played); a subject of numbers only ───
do $t$
declare r jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.container_create('Числа', null, '[{"title":"Всё"},{"title":"Только числа"}]');
  perform pg_temp.put('n', r ->> 'container_id');
  perform pg_temp.put('ns', r -> 'subjects' -> 0 ->> 'id');
  perform pg_temp.put('nn', r -> 'subjects' -> 1 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'n:1', 'stem', 'Высота башни', 'kind', 'number', 'answers', jsonb_build_array('42'), 'tolerance', 0.5,
                       'unit', ' м ', 'explanation', 'Башня — 42 метра'),
    jsonb_build_object('ref', 'n:2', 'stem', 'Байт в килобайте', 'kind', 'number', 'answers', jsonb_build_array('1024', '1000')),
    jsonb_build_object('ref', 'n:3', 'stem', 'Один верный', 'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct', jsonb_build_array(1)),
    jsonb_build_object('ref', 'n:4', 'stem', 'По порядку', 'kind', 'order', 'options', jsonb_build_array('раз', 'два', 'три'),
                       'correct', jsonb_build_array(0, 1, 2))));
  perform public.container_items_add((r -> 'subjects' -> 1 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'm:1', 'stem', 'Число один', 'kind', 'number', 'answers', jsonb_build_array('1')),
    jsonb_build_object('ref', 'm:2', 'stem', 'Число два', 'kind', 'number', 'answers', jsonb_build_array('2')),
    jsonb_build_object('ref', 'm:3', 'stem', 'Выбор', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(0))));
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 2. The number rule as the game reads it: live_number_value is meldy_number_right's reading ───
do $t$
declare c record;
begin
  perform pg_temp.eq('a value: spaces, a comma, the unit', pg_temp.num(' 1 000,50 м', 'м')::text, '1000.5');
  perform pg_temp.eq('a value: minus zero is zero', pg_temp.num('-0', null)::text, '0');
  perform pg_temp.eq('a value: a leading dot, a unicode minus', pg_temp.num('−.5', null)::text, '-0.5');
  perform pg_temp.eq('a value: trailing zeros go', pg_temp.num('3.140', null)::text, '3.14');
  perform pg_temp.eq('a value: another unit is no number', coalesce(pg_temp.num('5 см', 'м')::text, 'null'), 'null');
  perform pg_temp.eq('a value: words are no number', coalesce(pg_temp.num('сорок два', null)::text, 'null'), 'null');
  perform pg_temp.eq('a value: an exponent is no number', coalesce(pg_temp.num('1e3', null)::text, 'null'), 'null');
  perform pg_temp.eq('a value: too long', coalesce(pg_temp.num(repeat('1', 41), null)::text, 'null'), 'null');
  perform pg_temp.eq('a value: null', coalesce(pg_temp.num(null, null)::text, 'null'), 'null');
  -- right ⇔ the value is within the tolerance of an accepted number (the rehearsal runs every shared vector too)
  for c in select * from (values ('9,75 м/с²', '{9.8}'::text[], 0.1, 'м/с²'), ('1.1', '{1}', 0.1, null), ('1.1000001', '{1}', 0.1, null),
                                 ('50', '{10,49}', 1, null), ('5 м м', '{5}', null, 'м'), ('12 KG', '{12}', null, 'kg')) x(t, a, tol, u) loop
    perform pg_temp.eq('the reading is the rule''s: ' || c.t,
      (select coalesce(bool_or(abs(pg_temp.num(c.t, c.u) - f::numeric) <= coalesce(c.tol, 0)), false) from unnest(c.a) f)::text,
      public.meldy_number_right(c.t, c.a, c.tol, c.u)::text);
  end loop;
  perform pg_temp.who('postgres');
  perform pg_temp.eq('live_more: a number in a battle', meldy_private.live_more(i, true), 'number') from public.test_items i where i.stem = 'Высота башни';
  perform pg_temp.eq('live_more: no number in «Встань на ответ»', coalesce(meldy_private.live_more(i, false), 'null'), 'null') from public.test_items i where i.stem = 'Высота башни';
  perform pg_temp.eq('live_more: an order never', coalesce(meldy_private.live_more(i, true), 'null'), 'null') from public.test_items i where i.stem = 'По порядку';
end
$t$;

-- ─── 3. A battle with number questions ───
do $t$
declare r jsonb; h jsonb; s jsonb; v_g uuid; v_host text; v_pin text; v_src text; v_qi integer; v_q jsonb; v_key integer;
        v_n integer; v_stem text; v_seen text := ''; v_a jsonb; v_p integer;
begin
  v_src := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 10}', pg_temp.c('n'), pg_temp.c('ns'));
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(v_src::jsonb, '{"time_s": 20}');
  perform pg_temp.eq('the numbers play, the order question never', (r ->> 'q_count') || '/' || (r ->> 'skipped'), '3/1');
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  v_pin := r ->> 'pin';
  perform pg_temp.put('g', v_g::text);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the kinds drawn', (select string_agg(kind, ',' order by kind) from public.live_questions where game_id = v_g), 'number,number,single');
  perform pg_temp.yes('a number question: no options, key -1, the accepted numbers, the tolerance, the unit trimmed, the explanation',
    exists (select 1 from public.live_questions where game_id = v_g and kind = 'number' and options = '[]' and shown = '{}' and key = -1
              and forms = '{42}' and tolerance = 0.5 and unit = 'м' and explanation = 'Башня — 42 метра' and tops is null and spread is null));
  perform pg_temp.yes('an exact number: no tolerance, no unit',
    exists (select 1 from public.live_questions where game_id = v_g and kind = 'number' and forms = '{1024,1000}' and tolerance is null and unit is null));
  perform pg_temp.yes('a single answer carries none of it',
    exists (select 1 from public.live_questions where game_id = v_g and kind = 'single' and tolerance is null and unit is null and forms is null));
  perform pg_temp.who('anon');
  for v_n in 1 .. 6 loop
    perform pg_temp.put('p' || v_n, public.live_join(v_pin, 'Игрок ' || v_n, pg_temp.tok(v_n), null) ->> 'player_id');
  end loop;
  for v_qi in 0 .. 2 loop
    h := public.live_next(v_g, v_host, case when v_qi = 0 then 'lobby' else 'leaderboard' end);
    v_q := pg_temp.qrow(v_g, v_qi);
    v_stem := v_q ->> 'text';
    v_seen := v_seen || v_stem || ';';
    v_key := (v_q ->> 'key')::integer;
    if v_q ->> 'kind' = 'number' then
      perform pg_temp.eq('countdown: a number question says its kind and unit, no key ' || v_qi,
        pg_temp.keys(h -> 'question') || '/' || (h -> 'question' ->> 'kind') || '/' || coalesce(h -> 'question' ->> 'unit', 'null') || '/' || (h -> 'question' ->> 'options'),
        'closes_at,kind,opens_at,options,phase,picture,qi,text,unit/number/' || case when v_stem = 'Высота башни' then 'м' else 'null' end || '/[]');
      perform pg_temp.eq('countdown: the player sees the same', pg_temp.keys(pg_temp.st(v_g, pg_temp.tok(1)) -> 'question'),
        'closes_at,kind,opens_at,options,phase,picture,qi,text,unit');
    else
      perform pg_temp.eq('countdown: a single answer as before ' || v_qi, pg_temp.keys(h -> 'question'), 'closes_at,opens_at,options,phase,picture,qi,text');
    end if;
    perform pg_temp.eq('early ' || v_qi, pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"text": "1"}'), 'ML004/early@400');
    perform pg_temp.tick(v_g, 4);
    perform pg_temp.eq('open ' || v_qi, pg_temp.hs(v_g, v_host) ->> 'state', 'open');
    if v_q ->> 'kind' = 'single' then
      perform pg_temp.eq('single: a number''s text', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"text": "1"}'), 'ML004/kind@400');
      perform pg_temp.eq('single: a tap', pg_temp.ans(v_g, pg_temp.tok(1), v_qi, v_key), 'ok');
      perform pg_temp.eq('single: a wrong choice', pg_temp.sub(v_g, pg_temp.tok(2), v_qi, jsonb_build_object('choice', (v_key + 1) % 4)), 'ok');
    else
      perform pg_temp.eq('number: a tap', pg_temp.ans(v_g, pg_temp.tok(1), v_qi, 0), 'ML004/kind@400');
      perform pg_temp.eq('number: a choice', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"choice": 0}'), 'ML004/kind@400');
      perform pg_temp.eq('number: picks', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"picks": [0]}'), 'ML004/kind@400');
      perform pg_temp.eq('number: a JSON number', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"text": 42}'), '22023/answer@400');
      perform pg_temp.eq('number: blank', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"text": "  "}'), '22023/answer@400');
      perform pg_temp.eq('number: too long', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, jsonb_build_object('text', repeat('1', 201))), '22023/answer@400');
      if v_stem = 'Высота башни' then
        -- 42 ± 0.5 м: right inside the band (the edge too, the unit or none, a comma), wrong outside, words wrong
        perform pg_temp.eq('number: exact', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"text": "42"}'), 'ok');
        perform pg_temp.tick(v_g, 1);
        perform pg_temp.eq('number: inside, a comma, the unit', pg_temp.sub(v_g, pg_temp.tok(2), v_qi, '{"text": " 41,6 м "}'), 'ok');
        perform pg_temp.eq('number: the edge', pg_temp.sub(v_g, pg_temp.tok(3), v_qi, '{"text": "42.5"}'), 'ok');
        perform pg_temp.eq('number: outside', pg_temp.sub(v_g, pg_temp.tok(4), v_qi, '{"text": "43"}'), 'ok');
        perform pg_temp.eq('number: words are taken, and wrong', pg_temp.sub(v_g, pg_temp.tok(5), v_qi, '{"text": "сорок два"}'), 'ok');
        perform pg_temp.eq('number: stored trimmed, as typed', pg_temp.arow(v_g, v_qi, pg_temp.g('p2')) ->> 'typed', '41,6 м');
        perform pg_temp.eq('number: me.typed before the close', pg_temp.st(v_g, pg_temp.tok(2)) -> 'me' ->> 'typed', '41,6 м');
        perform pg_temp.eq('number: twice', pg_temp.sub(v_g, pg_temp.tok(2), v_qi, '{"text": "42"}'), 'ML004/twice@400');
      else
        -- 1024 or 1000, exact
        perform pg_temp.eq('exact: one accepted', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"text": "1024"}'), 'ok');
        perform pg_temp.eq('exact: the other, thousands apart', pg_temp.sub(v_g, pg_temp.tok(2), v_qi, '{"text": "1 000"}'), 'ok');
        perform pg_temp.eq('exact: trailing zeros', pg_temp.sub(v_g, pg_temp.tok(3), v_qi, '{"text": "1024,0"}'), 'ok');
        perform pg_temp.eq('exact: one off', pg_temp.sub(v_g, pg_temp.tok(4), v_qi, '{"text": "1023"}'), 'ok');
        perform pg_temp.eq('exact: the sign matters', pg_temp.sub(v_g, pg_temp.tok(5), v_qi, '{"text": "-1024"}'), 'ok');
      end if;
      perform pg_temp.yes('number: no key, no forms before the close', not (pg_temp.hs(v_g, v_host) ? 'result') or pg_temp.hs(v_g, v_host) -> 'result' = 'null');
    end if;
    -- the time runs out
    perform pg_temp.tick(v_g, 22);
    h := pg_temp.hs(v_g, v_host);
    perform pg_temp.eq('reveal ' || v_qi, h ->> 'state', 'reveal');
    if v_q ->> 'kind' = 'single' then
      perform pg_temp.eq('single: the result as before', pg_temp.keys(h -> 'result'), 'counts,frozen_now,healed,hits,key,phase_changed,qi,right,thawed');
      perform pg_temp.eq('single: the player''s result as before', pg_temp.keys(pg_temp.st(v_g, pg_temp.tok(1)) -> 'result'),
                         'correct,counts,dmg,frozen,healed,key,none,phase_changed,qi,right,thawed');
    else
      perform pg_temp.eq('number: the host''s result', pg_temp.keys(h -> 'result'),
                         'counts,forms,frozen_now,healed,hits,key,phase_changed,qi,right,spread,thawed,tolerance,tops,unit');
      perform pg_temp.eq('number: no counts, key -1', (h -> 'result' ->> 'counts') || '/' || (h -> 'result' ->> 'key'), '[]/-1');
      -- every verdict is the number rule's
      for v_p in 1 .. 5 loop
        v_a := pg_temp.arow(v_g, v_qi, pg_temp.g('p' || v_p));
        perform pg_temp.eq('number: the verdict is meldy_number_right''s, ' || (v_a ->> 'typed'), v_a ->> 'correct',
          public.meldy_number_right(v_a ->> 'typed', (select array_agg(x) from jsonb_array_elements_text(v_q -> 'forms') x),
                                    (v_q ->> 'tolerance')::numeric, v_q ->> 'unit')::text);
        perform pg_temp.eq('number: a right one hits, a wrong one freezes, ' || (v_a ->> 'typed'),
          ((v_a ->> 'dmg')::integer > 0)::text || '/' || (pg_temp.prow(pg_temp.g('p' || v_p)) ->> 'frozen'),
          case when (v_a ->> 'correct')::boolean then 'true/false' else 'false/true' end);
      end loop;
      perform pg_temp.eq('number: no answer as a tap left out (frozen from phase 1 on)', pg_temp.prow(pg_temp.g('p6')) ->> 'frozen',
                         ((v_q ->> 'phase')::integer >= 1)::text);
      if v_stem = 'Высота башни' then
        perform pg_temp.eq('number: three inside the band', h -> 'result' ->> 'right', '3');
        perform pg_temp.eq('number: the forms, the tolerance, the unit', (h -> 'result' ->> 'forms') || '/' || (h -> 'result' ->> 'tolerance') || '/' || (h -> 'result' ->> 'unit'), '["42"]/0.5/м');
        perform pg_temp.eq('number: the three nearest (the words left out)', h -> 'result' ->> 'tops',
          '[{"n": 1, "ok": true, "text": "42"}, {"n": 1, "ok": true, "text": "41.6"}, {"n": 1, "ok": true, "text": "42.5"}]');
        perform pg_temp.eq('number: the spread by value', h -> 'result' ->> 'spread', '[["41.6", 1], ["42", 1], ["42.5", 1], ["43", 1]]');
        s := pg_temp.st(v_g, pg_temp.tok(2));
        perform pg_temp.eq('number: the player''s result (no spread)', pg_temp.keys(s -> 'result'),
          'correct,counts,dmg,forms,frozen,healed,key,none,phase_changed,qi,right,thawed,tolerance,tops,typed,unit');
        perform pg_temp.eq('number: own text and right', (s -> 'result' ->> 'typed') || '/' || (s -> 'result' ->> 'correct'), '41,6 м/true');
        perform pg_temp.eq('number: me.typed', s -> 'me' ->> 'typed', '41,6 м');
      else
        perform pg_temp.eq('exact: three right', h -> 'result' ->> 'right', '3');
        perform pg_temp.eq('exact: no tolerance, no unit', (h -> 'result' -> 'tolerance')::text || '/' || (h -> 'result' -> 'unit')::text, 'null/null');
        perform pg_temp.eq('exact: the nearest (one value typed twice counts twice)', h -> 'result' ->> 'tops',
          '[{"n": 2, "ok": true, "text": "1024"}, {"n": 1, "ok": true, "text": "1000"}, {"n": 1, "ok": false, "text": "1023"}]');
        perform pg_temp.eq('exact: the spread', h -> 'result' ->> 'spread', '[["-1024", 1], ["1000", 1], ["1023", 1], ["1024", 2]]');
      end if;
    end if;
    h := public.live_next(v_g, v_host, 'reveal');
  end loop;
  perform pg_temp.eq('every question once', (select string_agg(x, ';' order by x) from unnest(string_to_array(trim(v_seen, ';'), ';')) x),
                     'Байт в килобайте;Высота башни;Один верный');
  perform pg_temp.eq('podium', h ->> 'state', 'podium');
  perform pg_temp.put('g1', v_g::text);
end
$t$;

-- ─── 4. The review: the number typed, the accepted numbers, the tolerance, the unit, the explanation ───
do $t$
declare r jsonb; v_g uuid := pg_temp.g('g1'); x jsonb;
begin
  perform pg_temp.who('anon');
  r := public.live_review(v_g, pg_temp.tok(2));
  perform pg_temp.eq('three items', jsonb_array_length(r -> 'items')::text, '3');
  for x in select * from jsonb_array_elements(r -> 'items') loop
    if x ->> 'text' = 'Высота башни' then
      perform pg_temp.eq('number item', pg_temp.keys(x), 'choice,correct,explanation,forms,key,kind,options,qi,text,tolerance,typed,unit');
      perform pg_temp.eq('number item: the values', (x ->> 'kind') || '/' || (x ->> 'forms') || '/' || (x ->> 'tolerance') || '/' || (x ->> 'unit') || '/' || (x ->> 'typed') || '/' || (x ->> 'correct'),
                         'number/["42"]/0.5/м/41,6 м/true');
    elsif x ->> 'text' = 'Байт в килобайте' then
      perform pg_temp.eq('exact item', pg_temp.keys(x), 'choice,correct,forms,key,kind,options,qi,text,tolerance,typed,unit');
    else
      perform pg_temp.eq('single item as before', pg_temp.keys(x), 'choice,correct,key,options,qi,text');
    end if;
  end loop;
  r := public.live_review(v_g, pg_temp.tok(6));
  perform pg_temp.yes('no answer: no text, not right', (select bool_and(y -> 'typed' = 'null' and (y ->> 'correct') = 'false')
                                                         from jsonb_array_elements(r -> 'items') y where y ->> 'kind' = 'number'));
end
$t$;

-- ─── 5. «Тренировать ошибки»: a number mistake goes to the study core with the own text ───
do $t$
declare r jsonb; v_g uuid := pg_temp.g('g1');
begin
  perform pg_temp.who('postgres');
  update public.live_players set user_id = 'cccccccc-0000-0000-0000-000000000003', guest_hash = null where id = pg_temp.g('p4');
  insert into public.container_members (container_id, user_id) values (pg_temp.g('n'), 'cccccccc-0000-0000-0000-000000000003');
  perform pg_temp.who('authenticated', 'cccccccc-0000-0000-0000-000000000003');
  r := public.live_practice(v_g, pg_temp.tok(4));
  -- Игрок 4 typed 43 (outside the band) and 1023 (one off); the single answer he did not give
  perform pg_temp.eq('every mistake', (r ->> 'mistakes') || '/' || (r ->> 'saved'), '3/3');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the numbers as typed, graded by the study core', (select string_agg(t.kind || ':' || coalesce(t.answer_text, '-') || ':' || t.correct, ',' order by t.kind, t.answer_text)
                      from public.test_answers t where t.user_id = 'cccccccc-0000-0000-0000-000000000003'),
                     'number:1023:false,number:43:false,single:-:false');
end
$t$;

-- ─── 6. A battle with movement rounds: a number never stands on a round; «Встань на ответ» takes none ───
do $t$
declare r jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('n'), pg_temp.c('nn'))::jsonb, '{"stand_every": 3}');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the round''s place holds the choice question', (select string_agg(kind, ',' order by qi) from public.live_questions where game_id = (r ->> 'game_id')::uuid),
                     'number,number,single');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('n'), pg_temp.c('nn'))::jsonb, '{"mode": "stand"}');
  perform pg_temp.eq('«Встань на ответ»: the numbers skipped', (r ->> 'q_count') || '/' || (r ->> 'skipped'), '1/2');
end
$t$;

-- ─── 7. One-answer games' messages are as before, key for key (every other assertion above, and the older behaviours) ───
do $t$
declare r jsonb; h jsonb; v_g uuid; v_host text;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.who('postgres');
  update public.live_games set state = 'ended', ended_at = now() where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001' and state <> 'ended';
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(jsonb_build_object('container_id', pg_temp.c('n'), 'subject_ids', jsonb_build_array(pg_temp.c('nn'), pg_temp.c('ns')), 'count', 3), '{}');
  perform pg_temp.who('postgres');
  update public.live_questions set kind = 'single', forms = null, tolerance = null, unit = null, options = '["a", "b"]', shown = '{0,1}', key = 0
   where game_id = (r ->> 'game_id')::uuid;
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  perform pg_temp.who('anon');
  perform public.live_join(r ->> 'pin', 'Один', pg_temp.tok(40), null);
  h := public.live_next(v_g, v_host, 'lobby');
  perform pg_temp.eq('a single answer''s question', pg_temp.keys(h -> 'question'), 'closes_at,opens_at,options,phase,picture,qi,text');
  perform pg_temp.tick(v_g, 4);
  perform pg_temp.eq('a tap', pg_temp.ans(v_g, pg_temp.tok(40), 0, 0), 'ok');
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('its result', pg_temp.keys(h -> 'result'), 'counts,frozen_now,healed,hits,key,phase_changed,qi,right,thawed');
  perform pg_temp.eq('the player''s', pg_temp.keys(pg_temp.st(v_g, pg_temp.tok(40)) -> 'me'), 'best,choice,dmg,frozen,look,name,place,player_id,streak');
end
$t$;

rollback;
\echo LIVE NUMBERS BEHAVIOUR PASSED
