-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261106090000_live_calm.sql on the
-- scratch database of live_game_run.sh, after the ranges step: the setting «Без спешки» (refusals, no points for speed),
-- a calm battle (every right answer 100 however fast and however many in a row, a partial one its share of 100, no
-- freeze for a wrong answer or none, even when the boss is angry), a calm battle with a movement round, and a game
-- without the setting as before (its JSON key for key, its points by speed). One transaction, rolled back. A failure
-- raises; success prints LIVE CALM BEHAVIOUR PASSED.
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

-- ─── 1. Exam C: one-answer questions and one of two right answers ───
do $t$
declare r jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.container_create('Без спешки', null, '[{"title":"Всё"}]');
  perform pg_temp.put('c', r ->> 'container_id');
  perform pg_temp.put('cs', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'c:1', 'stem', 'Первый', 'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct', jsonb_build_array(1)),
    jsonb_build_object('ref', 'c:2', 'stem', 'Второй', 'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct', jsonb_build_array(2)),
    jsonb_build_object('ref', 'c:3', 'stem', 'Третий', 'kind', 'multiple', 'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct', jsonb_build_array(0, 3))));
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 2. The setting ───
do $t$
declare r jsonb; v_src text;
begin
  v_src := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('c'), pg_temp.c('cs'));
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('calm as text', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"calm": "yes"}')), '22023/calm@400');
  perform pg_temp.eq('calm in «Встань на ответ»', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"calm": true, "mode": "stand"}')), '22023/calm@400');
  perform pg_temp.eq('calm off in «Встань на ответ» is fine', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"calm": false, "mode": "stand"}')), 'ok');
  r := public.live_create(v_src::jsonb, '{"calm": true, "speed": true, "time_s": 20}');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('a calm game keeps no points for speed', (select calm || '/' || speed from public.live_games where id = (r ->> 'game_id')::uuid), 'true/false');
  perform pg_temp.eq('no setting: not calm, as before', (select string_agg(calm::text, ',') from public.live_games g where g.mode = 'stand'
                                                          and g.owner_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'false');
  update public.live_games set state = 'ended', ended_at = now() where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001' and state <> 'ended';
end
$t$;

-- ─── 3. A calm battle: every right answer 100, no freeze in any phase ───
do $t$
declare r jsonb; h jsonb; s jsonb; v_g uuid; v_host text; v_pin text; v_qi integer; v_q jsonb; v_key integer; v_keys int[]; v_n integer;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('c'), pg_temp.c('cs'))::jsonb, '{"calm": true, "time_s": 20}');
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  v_pin := r ->> 'pin';
  perform pg_temp.who('anon');
  for v_n in 1 .. 4 loop
    perform pg_temp.put('p' || v_n, public.live_join(v_pin, 'Игрок ' || v_n, pg_temp.tok(v_n), null) ->> 'player_id');
  end loop;
  s := pg_temp.st(v_g, pg_temp.tok(1));
  perform pg_temp.eq('the lobby says calm', (s ->> 'calm') || '/' || (s ->> 'speed'), 'true/false');
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('the host''s settings say calm', pg_temp.keys(h -> 'settings') || '/' || (h -> 'settings' ->> 'calm'),
                     'calm,chat_names,mode,speed,time_s,who/true');
  for v_qi in 0 .. 2 loop
    -- from the second question on the boss is angry (phase 1): no answer would freeze in a game with points for speed
    if v_qi = 1 then
      perform pg_temp.who('postgres');
      update public.live_games set phase = 1 where id = v_g;
      perform pg_temp.who('anon');
    end if;
    h := public.live_next(v_g, v_host, case when v_qi = 0 then 'lobby' else 'leaderboard' end);
    v_q := pg_temp.qrow(v_g, v_qi);
    v_key := (v_q ->> 'key')::integer;
    perform pg_temp.tick(v_g, 4);
    if v_q ->> 'kind' = 'multiple' then
      select array_agg(x::integer order by o) into v_keys from jsonb_array_elements_text(v_q -> 'keys') with ordinality as k(x, o);
      perform pg_temp.eq('multi: the exact set', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, jsonb_build_object('picks', to_jsonb(v_keys))), 'ok');
      perform pg_temp.tick(v_g, 15);
      perform pg_temp.eq('multi: one of the two', pg_temp.sub(v_g, pg_temp.tok(2), v_qi, jsonb_build_object('picks', jsonb_build_array(v_keys[1]))), 'ok');
      perform pg_temp.eq('multi: a wrong one', pg_temp.sub(v_g, pg_temp.tok(3), v_qi, jsonb_build_object('picks',
        jsonb_build_array((select min(z) from generate_series(0, 3) z where z <> all (v_keys))))), 'ok');
    else
      perform pg_temp.eq('right at once ' || v_qi, pg_temp.ans(v_g, pg_temp.tok(1), v_qi, v_key), 'ok');
      perform pg_temp.tick(v_g, 15);
      perform pg_temp.eq('right at the end ' || v_qi, pg_temp.ans(v_g, pg_temp.tok(2), v_qi, v_key), 'ok');
      perform pg_temp.eq('wrong ' || v_qi, pg_temp.ans(v_g, pg_temp.tok(3), v_qi, (v_key + 1) % 4), 'ok');
    end if;
    perform pg_temp.tick(v_g, 8);
    h := pg_temp.hs(v_g, v_host);
    perform pg_temp.eq('reveal ' || v_qi, h ->> 'state', 'reveal');
    perform pg_temp.eq('nobody froze ' || v_qi, (h -> 'result' ->> 'frozen_now') || '/' ||
                       (select count(*) from generate_series(1, 4) n where (pg_temp.prow(pg_temp.g('p' || n)) ->> 'frozen')::boolean)::text, '[]/0');
    if v_q ->> 'kind' = 'multiple' then
      perform pg_temp.eq('multi: 100 for the set, 50 for half of it, none for a wrong one',
        (pg_temp.arow(v_g, v_qi, pg_temp.g('p1')) ->> 'dmg') || '/' || (pg_temp.arow(v_g, v_qi, pg_temp.g('p2')) ->> 'dmg') || '/' ||
        (pg_temp.arow(v_g, v_qi, pg_temp.g('p3')) ->> 'dmg'), '100/50/0');
    else
      perform pg_temp.eq('fast or slow, first or in a row: 100 ' || v_qi,
        (pg_temp.arow(v_g, v_qi, pg_temp.g('p1')) ->> 'dmg') || '/' || (pg_temp.arow(v_g, v_qi, pg_temp.g('p2')) ->> 'dmg') || '/' ||
        (pg_temp.arow(v_g, v_qi, pg_temp.g('p3')) ->> 'dmg'), '100/100/0');
    end if;
    h := public.live_next(v_g, v_host, 'reveal');
  end loop;
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the points say how much was right', (select string_agg(dmg::text || ':' || right_n || ':' || frozen, ',' order by name)
                     from public.live_players where game_id = v_g), '300:3:false,250:2:false,0:0:false,0:0:false');
  perform pg_temp.eq('the best run is kept for the player''s own numbers', pg_temp.prow(pg_temp.g('p1')) ->> 'best', '3');
end
$t$;

-- ─── 4. A calm battle with a movement round: no zone freezes nobody, a right zone 100 ───
do $t$
declare r jsonb; h jsonb; v_g uuid; v_host text; v_pin text; v_qi integer; v_key integer;
begin
  perform pg_temp.who('postgres');
  update public.live_games set state = 'ended', ended_at = now() where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001' and state <> 'ended';
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('c'), pg_temp.c('cs'))::jsonb,
                          '{"calm": true, "stand_every": 3, "time_s": 20}');
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  v_pin := r ->> 'pin';
  perform pg_temp.who('anon');
  perform pg_temp.put('m1', public.live_join(v_pin, 'Дима', pg_temp.tok(41), null) ->> 'player_id');
  perform pg_temp.put('m2', public.live_join(v_pin, 'Лена', pg_temp.tok(42), null) ->> 'player_id');
  for v_qi in 0 .. 1 loop
    h := public.live_next(v_g, v_host, case when v_qi = 0 then 'lobby' else 'leaderboard' end);
    perform pg_temp.tick(v_g, 30);
    h := public.live_next(v_g, v_host, 'reveal');
  end loop;
  perform pg_temp.eq('no answer in button questions froze nobody', (select count(*) from generate_series(41, 42) n
                     where (pg_temp.prow(pg_temp.g(case when n = 41 then 'm1' else 'm2' end)) ->> 'frozen')::boolean)::text, '0');
  h := public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.eq('the round says calm too', (h ->> 'calm') || '/' || (h -> 'question' ->> 'stand'), 'true/true');
  v_key := (pg_temp.qrow(v_g, 2) ->> 'key')::integer;
  perform pg_temp.tick(v_g, 4);
  perform pg_temp.tick(v_g, 19.5);
  r := public.live_stand_close(v_g, v_host, 2, jsonb_build_array(jsonb_build_object('p', pg_temp.c('m1'), 'c', v_key, 'e', 4000)));
  perform pg_temp.eq('a right zone 100, no zone freezes nobody',
    (select (x ->> 'dmg') from jsonb_array_elements(r -> 'rows') x where x ->> 'p' = pg_temp.c('m1')) || '/' || (r ->> 'frozen_now') || '/' ||
    (select (x ->> 'frozen') from jsonb_array_elements(r -> 'rows') x where x ->> 'p' = pg_temp.c('m2')), '100/[]/false');
end
$t$;

-- ─── 5. A game without the setting: its JSON as before (no calm key), its points by speed ───
do $t$
declare r jsonb; h jsonb; v_g uuid; v_host text;
begin
  perform pg_temp.who('postgres');
  update public.live_games set state = 'ended', ended_at = now() where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001' and state <> 'ended';
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('c'), pg_temp.c('cs'))::jsonb, '{}');
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  perform pg_temp.who('anon');
  perform public.live_join(r ->> 'pin', 'Один', pg_temp.tok(60), null);
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('no calm key', (h ? 'calm')::text || '/' || pg_temp.keys(h -> 'settings') || '/' || (pg_temp.st(v_g, pg_temp.tok(60)) ? 'calm')::text,
                     'false/chat_names,mode,speed,time_s,who/false');
  h := public.live_next(v_g, v_host, 'lobby');
  perform pg_temp.tick(v_g, 4);
  perform pg_temp.tick(v_g, 10);
  perform pg_temp.ans(v_g, pg_temp.tok(60), 0, (pg_temp.qrow(v_g, 0) ->> 'key')::integer);
  perform pg_temp.tick(v_g, 20);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('points by speed as before', (pg_temp.arow(v_g, 0, (select id from public.live_players where game_id = v_g)) ->> 'dmg'),
                     pg_temp.dmg((pg_temp.arow(v_g, 0, (select id from public.live_players where game_id = v_g)) ->> 'elapsed_ms')::integer, 20, 1, true)::text);
end
$t$;

rollback;
\echo LIVE CALM BEHAVIOUR PASSED
