-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261022090000_live_stand.sql (mode
-- «Встань на ответ», docs/live/MODE_STAND.md) on the scratch database of live_game_run.sh, after live_game. One
-- transaction, rolled back; now() is one moment inside it, so time moves by a time machine (pg_temp.tick).
-- A = aaaa…1 (author of exam S: three questions kept in order, 4, 3 and 2 options; keys Б, В, А); guests tok(n).
-- S1 (stand, boss skeleton, 15 s by default): the settings and their refusals, the JSON of a stand game (settings.boss,
--   boss.kind, no HP) and of a battle game (unchanged), live_answer refused (ML004 stand), live_stand_close's refusals
--   (host, mode, early, bad_qi, answers), question 0: alive and right (900, 800 by time), wrong and none fall (ghosts),
--   a late joiner left out, the retry (again, nothing written twice), the hits and frozen_now, leaderboard not podium;
--   question 1: a ghost on the right zone (half: 380, revived, streak 0), the streak bonus (1100), a ghost stays a ghost,
--   a kicked player left out; question 2: nobody writes → still open 7 s after the deadline, closed by time at 8 s
--   (everyone none); podium after the last question, won = false, the review; an old question again; the key's secrecy.
-- A failure raises; success prints LIVE STAND BEHAVIOUR PASSED.
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
  select 'stk' || lpad(p_n::text, 40, '0')
$fn$;
create or replace function pg_temp.who(p_role text, p_sub text default null) returns void
language plpgsql as $fn$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', coalesce(p_sub, ''), true);
  perform set_config('request.jwt.claim.role', case when p_role = 'postgres' then '' else p_role end, true);
  perform set_config('request.headers', '{}', true);
  if p_role <> 'postgres' then
    perform set_config('role', p_role, true);
  end if;
end;
$fn$;
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
      return (v_msg ->> 'code') || '/' || coalesce(v_msg ->> 'details', '') || '@' || coalesce(v_detail::jsonb ->> 'status', '?');
    end if;
    return sqlstate || '/' || coalesce(v_detail, '') || ' ' || sqlerrm;
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
create or replace function pg_temp.hints(p_game uuid) returns text language plpgsql as $fn$
declare v_role text := current_user; v text;
begin
  perform set_config('role', 'none', true);
  set constraints all immediate;
  set constraints all deferred;
  select string_agg(s.payload ->> 'state', ',' order by s.id) into v from realtime.sent s
   where s.topic = 'live:' || (select topic from public.live_games where id = p_game);
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  return v;
end;
$fn$;
create or replace function pg_temp.hs(p_game uuid, p_host text) returns jsonb language sql as $fn$
  select public.live_host_state(p_game, p_host, null)
$fn$;
create or replace function pg_temp.close(p_game uuid, p_host text, p_qi integer, p_answers jsonb) returns text language sql as $fn$
  select pg_temp.e(format('select public.live_stand_close(%L, %L, %s, %L)', p_game, p_host, p_qi, p_answers))
$fn$;
-- One player's row of a live_stand_close result: c/ok/pts/ms/fell/revived/ghost/out/total/streak/best/right/place.
create or replace function pg_temp.row_of(p_res jsonb, p_player text) returns text language sql stable as $fn$
  select concat_ws('/', coalesce(x ->> 'c', '-'), x ->> 'ok', x ->> 'pts', coalesce(x ->> 'ms', '-'), x ->> 'fell', x ->> 'revived',
                   x ->> 'ghost', x ->> 'out', x ->> 'total', x ->> 'streak', x ->> 'best', x ->> 'right', x ->> 'place')
    from jsonb_array_elements(p_res -> 'rows') x where x ->> 'p' = p_player
$fn$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- ─── 0. The points (MODE_STAND.md §6, the worked numbers) ───
do $t$
begin
  perform pg_temp.eq('15 s, 3000 ms, first right', meldy_private.live_stand_points(3000, 15, 1, true, false)::text, '900');
  perform pg_temp.eq('6000 ms, streak 2 before', meldy_private.live_stand_points(6000, 15, 3, true, false)::text, '960');
  perform pg_temp.eq('4321 ms, streak 1 before', meldy_private.live_stand_points(4321, 15, 2, true, false)::text, '940');
  perform pg_temp.eq('0 ms, streak 4 before', meldy_private.live_stand_points(0, 15, 5, true, false)::text, '1400');
  perform pg_temp.eq('the bonus stops at 1.4', meldy_private.live_stand_points(0, 15, 12, true, false)::text, '1400');
  perform pg_temp.eq('at the deadline', meldy_private.live_stand_points(15000, 15, 1, true, false)::text, '500');
  perform pg_temp.eq('a ghost at 7500 ms', meldy_private.live_stand_points(7500, 15, 3, true, true)::text, '380');
  perform pg_temp.eq('a ghost at 3000 ms', meldy_private.live_stand_points(3000, 15, 1, true, true)::text, '450');
  perform pg_temp.eq('a ghost at the deadline', meldy_private.live_stand_points(15000, 15, 1, true, true)::text, '250');
  perform pg_temp.eq('speed off', meldy_private.live_stand_points(14000, 15, 1, false, false)::text, '1000');
  perform pg_temp.eq('elapsed clamped', meldy_private.live_stand_points(99999, 20, 1, true, false) || ',' ||
                     meldy_private.live_stand_points(-40, 20, 1, true, false), '500,1000');
end
$t$;

-- ─── 1. Exam S: three questions in the file's order (keys 1, 2, 0) ───
do $t$
declare r jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.container_create('Встань на ответ', null, '[{"title":"Т"}]');
  perform pg_temp.put('x', r ->> 'container_id');
  perform pg_temp.put('xs', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 's:1', 'stem', 'Какая команда отменяет транзакцию?', 'options', jsonb_build_array('COMMIT', 'ROLLBACK', 'GRANT', 'SAVEPOINT'), 'correct', jsonb_build_array(1), 'keep_order', true),
    jsonb_build_object('ref', 's:2', 'stem', 'Какая нормальная форма без транзитивных зависимостей?', 'options', jsonb_build_array('Первая', 'Вторая', 'Третья'), 'correct', jsonb_build_array(2), 'keep_order', true),
    jsonb_build_object('ref', 's:3', 'stem', 'Буква I в ACID?', 'options', jsonb_build_array('Изоляция', 'Целиком'), 'correct', jsonb_build_array(0), 'keep_order', true)));
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 2. Creating: the settings ───
do $t$
declare r jsonb; h jsonb; v_src text := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xs'));
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('mode race', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"mode": "race"}')), '22023/mode@400');
  perform pg_temp.eq('mode battle (the value is boss)', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"mode": "battle"}')), '22023/mode@400');
  perform pg_temp.eq('boss dragon', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"mode": "stand", "boss": "dragon"}')), '22023/boss@400');
  perform pg_temp.eq('stand takes no 10 s', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"mode": "stand", "time_s": 10}')), '22023/time_s@400');
  perform pg_temp.eq('battle takes no 15 s', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"time_s": 15}')), '22023/time_s@400');
  -- A battle game: its JSON is the battle's own (no boss kind).
  r := public.live_create(v_src::jsonb, '{"boss": "skeleton"}');
  h := pg_temp.hs((r ->> 'game_id')::uuid, r ->> 'host_token');
  perform pg_temp.eq('battle settings unchanged', (h -> 'settings')::text,
                     '{"who": "pin", "mode": "boss", "speed": true, "time_s": 20, "chat_names": true}'::jsonb::text);
  perform pg_temp.eq('battle boss unchanged', (h -> 'boss')::text, '{"hp": 0, "phase": 0, "hp_max": 0, "defeated": false}'::jsonb::text);
  perform pg_temp.put('b', r ->> 'game_id');
  perform pg_temp.put('b_host', r ->> 'host_token');
  perform pg_temp.put('b_pin', r ->> 'pin');
  -- The stand game S1: 15 s by default, the skeleton.
  r := public.live_create(v_src::jsonb, '{"mode": "stand", "boss": "skeleton"}');
  perform pg_temp.put('g', r ->> 'game_id');
  perform pg_temp.put('host', r ->> 'host_token');
  perform pg_temp.put('pin', r ->> 'pin');
  h := pg_temp.hs((r ->> 'game_id')::uuid, r ->> 'host_token');
  perform pg_temp.eq('stand settings', (h -> 'settings')::text,
                     '{"who": "pin", "boss": "skeleton", "mode": "stand", "speed": true, "time_s": 15, "chat_names": true}'::jsonb::text);
  perform pg_temp.eq('stand boss: a kind, no HP', (h -> 'boss')::text, '{"hp": 0, "kind": "skeleton", "phase": 0, "hp_max": 0, "defeated": false}'::jsonb::text);
  perform pg_temp.eq('mode and time', (h ->> 'mode') || '/' || (h ->> 'time_s') || '/' || (h ->> 'q_count'), 'stand/15/3');
  perform pg_temp.eq('20 s is fine', pg_temp.e(format('select public.live_end((x ->> %L)::uuid, x ->> %L) from (select public.live_create(%L, %L) x) y',
                     'game_id', 'host_token', v_src, '{"mode": "stand", "time_s": 20}')), 'ok');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('a battle game keeps the pick too', (select boss_kind from public.live_games where id = pg_temp.g('b')), 'skeleton');
  perform pg_temp.eq('the clock by default', (select string_agg(boss_kind, ',') from public.live_games where mode = 'stand' and time_s = 20), 'clock');
end
$t$;

-- ─── 3. S1 question 0: refusals, the room's answers, ghosts, a late joiner, the retry ───
do $t$
declare r jsonb; h jsonb; v_g uuid := pg_temp.g('g'); v_host text := pg_temp.c('host'); v_pin text := pg_temp.c('pin');
        v_ans jsonb; v_rev bigint;
begin
  perform pg_temp.who('anon');
  -- One after another (a tick between the joins: ties in the ranking go by who joined first).
  perform pg_temp.put('p1', public.live_join(v_pin, 'Дима', pg_temp.tok(1), null) ->> 'player_id');
  perform pg_temp.tick(v_g, 0.1);
  perform pg_temp.put('p2', public.live_join(v_pin, 'Лена', pg_temp.tok(2), null) ->> 'player_id');
  perform pg_temp.tick(v_g, 0.1);
  perform pg_temp.put('p3', public.live_join(v_pin, 'Боря', pg_temp.tok(3), null) ->> 'player_id');
  perform pg_temp.tick(v_g, 0.1);
  perform pg_temp.put('p4', public.live_join(v_pin, 'Аня', pg_temp.tok(4), null) ->> 'player_id');
  perform pg_temp.tick(v_g, 0.1);
  r := public.live_state(v_g, pg_temp.tok(1), null);
  perform pg_temp.eq('the phone sees the mode and the boss', (r ->> 'mode') || '/' || (r -> 'boss' ->> 'kind'), 'stand/skeleton');
  perform pg_temp.eq('a write in the lobby', pg_temp.close(v_g, v_host, 0, '[]'), 'ML004/bad_qi@400');
  h := public.live_next(v_g, v_host, 'lobby');
  perform pg_temp.eq('countdown, no HP', (h ->> 'state') || '/' || (h -> 'boss' ->> 'hp_max'), 'countdown/0');
  perform pg_temp.yes('15 s to run', (h -> 'question' ->> 'closes_at')::timestamptz - (h -> 'question' ->> 'opens_at')::timestamptz = interval '15 s');
  perform pg_temp.eq('a tap is refused', pg_temp.e(format('select public.live_answer(%L, %L, 0, 1)', v_g, pg_temp.tok(1))), 'ML004/stand@400');
  perform pg_temp.eq('a write in the countdown', pg_temp.close(v_g, v_host, 0, '[]'), 'ML004/early@400');
  perform pg_temp.eq('a wrong host token', pg_temp.close(v_g, repeat('x', 43), 0, '[]'), '42501/host@403');
  perform pg_temp.eq('a battle game', pg_temp.close(pg_temp.g('b'), pg_temp.c('b_host'), 0, '[]'), '22023/mode@400');
  perform pg_temp.tick(v_g, 4);
  -- P5 joins after the question opened: a late joiner.
  perform pg_temp.put('p5', public.live_join(v_pin, 'Поздний', pg_temp.tok(5), null) ->> 'player_id');
  perform pg_temp.eq('open', pg_temp.hs(v_g, v_host) ->> 'state', 'open');
  perform pg_temp.eq('a write 14 s before the deadline', pg_temp.close(v_g, v_host, 0, '[]'), 'ML004/early@400');
  perform pg_temp.tick(v_g, 13.5);
  v_ans := jsonb_build_array(
    jsonb_build_object('p', pg_temp.c('p1'), 'c', 1, 'e', 3000),
    jsonb_build_object('p', pg_temp.c('p2'), 'c', 1, 'e', 7500),
    jsonb_build_object('p', pg_temp.c('p3'), 'c', 0, 'e', 1000),
    jsonb_build_object('p', pg_temp.c('p5'), 'c', 1, 'e', 500));
  perform pg_temp.eq('not a list', pg_temp.close(v_g, v_host, 0, '{"p": 1}'), '22023/answers@400');
  perform pg_temp.eq('a zone past the options', pg_temp.close(v_g, v_host, 0, jsonb_build_array(jsonb_build_object('p', pg_temp.c('p1'), 'c', 4, 'e', 1))), '22023/answers@400');
  perform pg_temp.eq('elapsed past T', pg_temp.close(v_g, v_host, 0, jsonb_build_array(jsonb_build_object('p', pg_temp.c('p1'), 'c', 1, 'e', 15001))), '22023/answers@400');
  perform pg_temp.eq('elapsed as text', pg_temp.close(v_g, v_host, 0, jsonb_build_array(jsonb_build_object('p', pg_temp.c('p1'), 'c', 1, 'e', '10'))), '22023/answers@400');
  perform pg_temp.eq('not a player id', pg_temp.close(v_g, v_host, 0, jsonb_build_array(jsonb_build_object('p', 'P1', 'c', 1, 'e', 1))), '22023/answers@400');
  perform pg_temp.eq('one player twice', pg_temp.close(v_g, v_host, 0, v_ans || jsonb_build_array(jsonb_build_object('p', upper(pg_temp.c('p1')), 'c', 0, 'e', 9))),
                     '22023/answers@400');
  perform pg_temp.eq('another question', pg_temp.close(v_g, v_host, 1, v_ans), 'ML004/bad_qi@400');
  perform pg_temp.eq('still open after the refusals', pg_temp.hs(v_g, v_host) ->> 'state', 'open');
  v_rev := (pg_temp.hs(v_g, v_host) ->> 'rev')::bigint;
  r := public.live_stand_close(v_g, v_host, 0, v_ans);
  perform pg_temp.eq('result keys', (select string_agg(k, ',' order by k) from jsonb_object_keys(r) k), 'active,again,counts,key,now,qi,right,rows');
  perform pg_temp.eq('key, counts, right, active', concat_ws('/', r ->> 'key', r -> 'counts', r ->> 'right', r ->> 'active', r ->> 'again'),
                     '1/[1, 2, 0, 0]/2/4/false');
  perform pg_temp.eq('row keys', (select string_agg(k, ',' order by k) from jsonb_object_keys(r -> 'rows' -> 0) k),
                     'best,c,fell,ghost,ms,ok,out,p,place,pts,revived,right,streak,total');
  perform pg_temp.eq('P1 alive and right at 3000 ms: 900', pg_temp.row_of(r, pg_temp.c('p1')), '1/true/900/3000/false/false/false/false/900/1/1/1/1');
  perform pg_temp.eq('P2 alive and right at 7500 ms: 750', pg_temp.row_of(r, pg_temp.c('p2')), '1/true/750/7500/false/false/false/false/750/1/1/1/2');
  perform pg_temp.eq('P3 wrong: falls, a ghost', pg_temp.row_of(r, pg_temp.c('p3')), '0/false/0/1000/true/false/true/false/0/0/0/0/3');
  perform pg_temp.eq('P4 no answer: falls, a ghost', pg_temp.row_of(r, pg_temp.c('p4')), '-/false/0/-/true/false/true/false/0/0/0/0/4');
  perform pg_temp.eq('P5 joined late: left out', pg_temp.row_of(r, pg_temp.c('p5')), '-/false/0/-/false/false/false/true/0/0/0/0/5');
  perform pg_temp.eq('one close, one rev', concat_ws('/', pg_temp.hs(v_g, v_host) ->> 'state', (pg_temp.hs(v_g, v_host) ->> 'rev')::bigint - v_rev), 'reveal/1');
  perform pg_temp.yes('the close sends the reveal hint', pg_temp.hints(v_g) like '%reveal');
  -- The retry after a lost answer: the same rows, nothing written again.
  h := public.live_stand_close(v_g, v_host, 0, v_ans);
  perform pg_temp.eq('again', (h ->> 'again') || '/' || (h -> 'rows')::text, 'true/' || (r -> 'rows')::text);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('stored answers (the late joiner''s not)', (select string_agg(concat_ws(':', choice, elapsed_ms, correct, dmg), ',' order by elapsed_ms)
                                                                  from public.live_answers where game_id = v_g and qi = 0), '0:1000:f:0,1:3000:t:900,1:7500:t:750');
  perform pg_temp.who('anon');
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('host result: points as hits, the fallen', (h -> 'result' -> 'hits')::text || '|' || (h -> 'result' -> 'frozen_now')::text || '|' || (h -> 'result' -> 'thawed')::text,
    jsonb_build_array(jsonb_build_object('dmg', 900, 'hp_after', 0, 'player_id', pg_temp.c('p1')),
                      jsonb_build_object('dmg', 750, 'hp_after', 0, 'player_id', pg_temp.c('p2')))::text || '|' ||
    jsonb_build_array(pg_temp.c('p3'), pg_temp.c('p4'))::text || '|[]');
  r := public.live_state(v_g, pg_temp.tok(1), null);
  perform pg_temp.eq('P1''s own result', concat_ws('/', r -> 'result' ->> 'correct', r -> 'result' ->> 'dmg', r -> 'me' ->> 'dmg', r -> 'me' ->> 'frozen'), 'true/900/900/false');
  r := public.live_state(v_g, pg_temp.tok(4), null);
  perform pg_temp.eq('P4: none, a ghost', concat_ws('/', r -> 'result' ->> 'none', r -> 'me' ->> 'frozen'), 'true/true');
  perform pg_temp.eq('a tap after the close', pg_temp.e(format('select public.live_answer(%L, %L, 0, 1)', v_g, pg_temp.tok(1))), 'ML004/stand@400');
  h := public.live_next(v_g, v_host, 'reveal');
  perform pg_temp.eq('no HP: leaderboard, not podium', h ->> 'state', 'leaderboard');
  perform pg_temp.eq('top', (select string_agg((x ->> 'name') || ':' || (x ->> 'dmg'), ',') from jsonb_array_elements(h -> 'top') x), 'Дима:900,Лена:750,Боря:0,Аня:0,Поздний:0');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 4. S1 question 1: a ghost on the right zone, the streak, a ghost stays, a kicked player ───
do $t$
declare r jsonb; h jsonb; v_g uuid := pg_temp.g('g'); v_host text := pg_temp.c('host');
begin
  perform pg_temp.who('anon');
  h := public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.eq('countdown 1', (h ->> 'state') || '/' || (h ->> 'qi'), 'countdown/1');
  perform pg_temp.tick(v_g, 3 + 14.6);
  perform public.live_kick(v_g, v_host, pg_temp.g('p2'));
  r := public.live_stand_close(v_g, v_host, 1, jsonb_build_array(
    jsonb_build_object('p', pg_temp.c('p1'), 'c', 2, 'e', 0),
    jsonb_build_object('p', pg_temp.c('p2'), 'c', 2, 'e', 0),
    jsonb_build_object('p', pg_temp.c('p3'), 'c', 2, 'e', 7500),
    jsonb_build_object('p', pg_temp.c('p4'), 'c', 1, 'e', 2000),
    jsonb_build_object('p', pg_temp.c('p5'), 'c', 0, 'e', 9000)));
  perform pg_temp.eq('key 2, counts without the kicked', concat_ws('/', r ->> 'key', r -> 'counts', r ->> 'right', r ->> 'active', jsonb_array_length(r -> 'rows')),
                     '2/[1, 1, 2]/2/4/4');
  perform pg_temp.eq('P1 streak 2 at 0 ms: 1100', pg_temp.row_of(r, pg_temp.c('p1')), '2/true/1100/0/false/false/false/false/2000/2/2/2/1');
  perform pg_temp.eq('P3 a ghost on the right zone: 380, revived, streak 0', pg_temp.row_of(r, pg_temp.c('p3')), '2/true/380/7500/false/true/false/false/380/0/0/1/2');
  perform pg_temp.eq('P4 a ghost elsewhere stays a ghost (not fell again)', pg_temp.row_of(r, pg_temp.c('p4')), '1/false/0/2000/false/false/true/false/0/0/0/0/3');
  perform pg_temp.eq('P5 plays now: wrong, falls', pg_temp.row_of(r, pg_temp.c('p5')), '0/false/0/9000/true/false/true/false/0/0/0/0/4');
  perform pg_temp.eq('the kicked one is not in the rows', pg_temp.row_of(r, pg_temp.c('p2')), null);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('P3 revives once', (select thaws || '/' || frozen from public.live_players where id = pg_temp.g('p3')), '1/false');
  perform pg_temp.eq('the kicked one''s answer is not stored', (select count(*)::text from public.live_answers where game_id = v_g and qi = 1 and player_id = pg_temp.g('p2')), '0');
  perform pg_temp.who('anon');
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('thawed and frozen_now', (h -> 'result' -> 'thawed')::text || '|' || (h -> 'result' -> 'frozen_now')::text,
                     jsonb_build_array(pg_temp.c('p3'))::text || '|' || jsonb_build_array(pg_temp.c('p5'))::text);
  perform public.live_next(v_g, v_host, 'reveal');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 5. S1 question 2: nobody writes; closed by time 8 s after the deadline; podium ───
do $t$
declare r jsonb; h jsonb; v_g uuid := pg_temp.g('g'); v_host text := pg_temp.c('host');
begin
  perform pg_temp.who('anon');
  h := public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.eq('countdown 2 (two options)', (h ->> 'qi') || '/' || jsonb_array_length(h -> 'question' -> 'options'), '2/2');
  perform pg_temp.tick(v_g, 3 + 15 + 7);
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.yes('7 s after the deadline: still open, no key anywhere', h ->> 'state' = 'open' and h::text !~ '"key"' and h::text !~ '"counts"'
                      and public.live_state(v_g, pg_temp.tok(1), null)::text !~ '"key"');
  perform pg_temp.eq('zone В on a two-option question', pg_temp.close(v_g, v_host, 2, jsonb_build_array(jsonb_build_object('p', pg_temp.c('p1'), 'c', 2, 'e', 1))),
                     '22023/answers@400');
  perform pg_temp.tick(v_g, 1.1);
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('closed by time: everyone none', concat_ws('/', h ->> 'state', h -> 'result' ->> 'right', h -> 'result' -> 'counts'), 'reveal/0/[0, 0]');
  r := public.live_stand_close(v_g, v_host, 2, jsonb_build_array(jsonb_build_object('p', pg_temp.c('p1'), 'c', 0, 'e', 1)));
  perform pg_temp.eq('the room comes too late: again, nothing written', (r ->> 'again') || '/' || pg_temp.row_of(r, pg_temp.c('p1')),
                     'true/-/false/0/-/true/false/true/false/2000/0/2/2/1');
  perform pg_temp.eq('an old question again', public.live_stand_close(v_g, v_host, 0, '[]') ->> 'again', 'true');
  perform pg_temp.eq('a question not played', pg_temp.close(v_g, v_host, 5, '[]'), 'ML004/bad_qi@400');
  h := public.live_next(v_g, v_host, 'reveal');
  perform pg_temp.eq('podium after the last question, nobody beats the boss', concat_ws('/', h ->> 'state', h -> 'final' ->> 'won', h -> 'final' ->> 'accuracy_pct'),
                     'podium/false/25');
  r := public.live_state(v_g, pg_temp.tok(1), null);
  perform pg_temp.eq('P1''s final', concat_ws('/', r -> 'final' ->> 'place', r -> 'final' ->> 'dmg', r -> 'final' ->> 'best', r -> 'final' ->> 'right'), '1/2000/2/2');
  r := public.live_review(v_g, pg_temp.tok(3));
  perform pg_temp.eq('P3''s review', (select string_agg(concat_ws(':', x ->> 'qi', x ->> 'key', coalesce(x ->> 'choice', '-'), x ->> 'correct'), ',' order by (x ->> 'qi')::int)
                                         from jsonb_array_elements(r -> 'items') x), '0:1:0:false,1:2:2:true,2:0:-:false');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 6. The battle game still takes taps; nothing for the API roles but the functions ───
do $t$
declare h jsonb; v_g uuid := pg_temp.g('b'); v_host text := pg_temp.c('b_host');
begin
  perform pg_temp.who('anon');
  perform public.live_join(pg_temp.c('b_pin'), 'Дима', pg_temp.tok(11), null);
  h := public.live_next(v_g, v_host, 'lobby');
  perform pg_temp.eq('battle HP as before', h -> 'boss' ->> 'hp_max', '165');
  perform pg_temp.tick(v_g, 4);
  perform pg_temp.eq('battle taps work', pg_temp.e(format('select public.live_answer(%L, %L, 0, 0)', v_g, pg_temp.tok(11))), 'ok');
  perform pg_temp.eq('anon calls no stand helper', split_part(pg_temp.e('select meldy_private.live_stand_points(1, 15, 1, true, false)'), '/', 1), '42501');
  perform pg_temp.eq('anon reads no answer', split_part(pg_temp.e('select count(*) from public.live_answers'), '/', 1), '42501');
  perform pg_temp.who('postgres');
end
$t$;

rollback;
\echo LIVE STAND BEHAVIOUR PASSED
