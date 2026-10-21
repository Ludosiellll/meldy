-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261024090000_live_mixed.sql (the
-- battle with movement rounds, docs/live/MODE_MIXED.md) on the scratch database of live_game_run.sh, after live_game and
-- live_stand. One transaction, rolled back; now() is one moment inside it, so time moves by a time machine (pg_temp.tick).
-- A = aaaa…1 (author of exam M: six questions kept in order; exam T: three).
-- 1. Settings: stand_every and its refusals; a battle's and a stand game's JSON stay as they were.
-- 2. Game M (4 players, every 3rd a movement round, 20 s): two button questions; the movement round qi 2 (the worked
--    example A of MODE_MIXED.md §5: a hit with the streak bonus, a wrong zone and «no zone» freeze in phase 0, a thaw,
--    the phase goes to 1), taps refused there, the room's refusals and its retry; two more button questions; the
--    movement round qi 5 in phase 2 (worked example B: the heal after it); podium, accuracy, the review.
-- 3. Game V (every 10 of 3 questions: the last one is the movement round): nobody writes → void at 8 s (no freeze, no
--    streak lost, no heal), a late joiner, the room comes too late.
-- 4. Game D (every 3 of 3): the boss falls in a movement round → podium, won; a kicked player and a late joiner left out.
-- A failure raises; success prints LIVE MIXED BEHAVIOUR PASSED.
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
  select 'mix' || lpad(p_n::text, 40, '0')
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
create or replace function pg_temp.keys(p jsonb) returns text language sql stable as $fn$
  select string_agg(k, ',' order by k) from jsonb_object_keys(p) k
$fn$;
create or replace function pg_temp.tick(p_game uuid, p_s numeric) returns void language plpgsql as $fn$
declare v_role text := current_user; v_i interval := make_interval(secs => p_s::double precision);
begin
  perform set_config('role', 'none', true);
  update public.live_games set created_at = created_at - v_i, state_at = state_at - v_i, q_ready_at = q_ready_at - v_i,
         q_opens_at = q_opens_at - v_i, q_closes_at = q_closes_at - v_i, ended_at = ended_at - v_i
   where id = p_game;
  update public.live_questions set opens_at = opens_at - v_i, closes_at = closes_at - v_i, closed_at = closed_at - v_i,
         room_at = room_at - v_i
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
create or replace function pg_temp.tap(p_game uuid, p_tok integer, p_qi integer, p_choice integer) returns text language sql as $fn$
  select pg_temp.e(format('select public.live_answer(%L, %L, %s, %s)', p_game, pg_temp.tok(p_tok), p_qi, p_choice))
$fn$;
-- One player's row of a mixed live_stand_close result: c/ok/dmg/ms/thawed/froze/frozen/out/total/streak/best/right/place.
create or replace function pg_temp.row_of(p_res jsonb, p_player text) returns text language sql stable as $fn$
  select concat_ws('/', coalesce(x ->> 'c', '-'), x ->> 'ok', x ->> 'dmg', coalesce(x ->> 'ms', '-'), x ->> 'thawed', x ->> 'froze',
                   x ->> 'frozen', x ->> 'out', x ->> 'total', x ->> 'streak', x ->> 'best', x ->> 'right', x ->> 'place')
    from jsonb_array_elements(p_res -> 'rows') x where x ->> 'p' = p_player
$fn$;
-- The boss and the closed question as the host reads them: hp/hp_max/phase/defeated | right/counts/healed/phase_changed/stand/void.
create or replace function pg_temp.board(p_h jsonb) returns text language sql stable as $fn$
  select concat_ws('/', p_h -> 'boss' ->> 'hp', p_h -> 'boss' ->> 'hp_max', p_h -> 'boss' ->> 'phase', p_h -> 'boss' ->> 'defeated') || '|' ||
         concat_ws('/', p_h -> 'result' ->> 'right', p_h -> 'result' ->> 'counts', p_h -> 'result' ->> 'healed',
                   coalesce(p_h -> 'result' ->> 'phase_changed', '-'), p_h -> 'result' ->> 'stand', p_h -> 'result' ->> 'void')
$fn$;
-- A player's numbers: dmg/streak/best/right/frozen/thaws.
create or replace function pg_temp.pl(p_id uuid) returns text language sql stable as $fn$
  select concat_ws('/', dmg, streak, best, right_n, frozen::text, thaws) from public.live_players where id = p_id
$fn$;
-- The names of a list of player ids, in its order (read as the owner whatever the caller's role; ', sorted' sorts them).
create or replace function pg_temp.names(p_ids jsonb, p_sorted boolean default false) returns text language plpgsql as $fn$
declare v_role text := current_user; v text;
begin
  perform set_config('role', 'none', true);
  select coalesce(string_agg(p.name, ',' order by case when p_sorted then p.name end, x.n), '') into v
    from jsonb_array_elements_text(p_ids) with ordinality x(id, n) join public.live_players p on p.id = x.id::uuid;
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  return v;
end;
$fn$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- ─── 0. The rule (MODE_MIXED.md §3) ───
do $t$
begin
  perform pg_temp.eq('every 3rd of 6', (select string_agg(s::text, ',') from generate_series(0, 5) s where meldy_private.live_stand_round(3, 6, s)), '2,5');
  perform pg_temp.eq('every 5th of 12', (select string_agg(s::text, ',') from generate_series(0, 11) s where meldy_private.live_stand_round(5, 12, s)), '4,9');
  perform pg_temp.eq('every 10th of 6: the last one', (select string_agg(s::text, ',') from generate_series(0, 5) s where meldy_private.live_stand_round(10, 6, s)), '5');
  perform pg_temp.eq('none without N', coalesce((select string_agg(s::text, ',') from generate_series(0, 5) s where meldy_private.live_stand_round(0, 6, s)), '-'), '-');
end
$t$;

-- ─── 1. Exams M (six questions in the file's order: keys 1, 2, 1, 0, 0, 3) and T (three: keys 1, 0, 1) ───
do $t$
declare r jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.container_create('Битва с мини-игрой', null, '[{"title":"М"}, {"title":"Т"}]');
  perform pg_temp.put('x', r ->> 'container_id');
  perform pg_temp.put('xm', r -> 'subjects' -> 0 ->> 'id');
  perform pg_temp.put('xt', r -> 'subjects' -> 1 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'm:1', 'stem', 'Какая команда отменяет транзакцию?', 'options', jsonb_build_array('COMMIT', 'ROLLBACK', 'GRANT', 'SAVEPOINT'), 'correct', jsonb_build_array(1), 'keep_order', true),
    jsonb_build_object('ref', 'm:2', 'stem', 'Какая нормальная форма без транзитивных зависимостей?', 'options', jsonb_build_array('Первая', 'Вторая', 'Третья'), 'correct', jsonb_build_array(2), 'keep_order', true),
    jsonb_build_object('ref', 'm:3', 'stem', 'Что делает JOIN?', 'options', jsonb_build_array('Удаляет строки', 'Соединяет таблицы', 'Создаёт индекс', 'Блокирует таблицу'), 'correct', jsonb_build_array(1), 'keep_order', true),
    jsonb_build_object('ref', 'm:4', 'stem', 'Буква I в ACID?', 'options', jsonb_build_array('Изоляция', 'Целиком'), 'correct', jsonb_build_array(0), 'keep_order', true),
    jsonb_build_object('ref', 'm:5', 'stem', 'Ключ, который ссылается на другую таблицу?', 'options', jsonb_build_array('Внешний', 'Первичный', 'Составной'), 'correct', jsonb_build_array(0), 'keep_order', true),
    jsonb_build_object('ref', 'm:6', 'stem', 'Какой оператор группирует строки?', 'options', jsonb_build_array('ORDER BY', 'WHERE', 'HAVING', 'GROUP BY'), 'correct', jsonb_build_array(3), 'keep_order', true)));
  perform public.container_items_add((r -> 'subjects' -> 1 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 't:1', 'stem', 'Два плюс два', 'options', jsonb_build_array('3', '4', '5', '6'), 'correct', jsonb_build_array(1), 'keep_order', true),
    jsonb_build_object('ref', 't:2', 'stem', 'Три плюс три', 'options', jsonb_build_array('6', '7'), 'correct', jsonb_build_array(0), 'keep_order', true),
    jsonb_build_object('ref', 't:3', 'stem', 'Пять минус два', 'options', jsonb_build_array('2', '3', '4', '5'), 'correct', jsonb_build_array(1), 'keep_order', true)));
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 2. Creating: stand_every ───
do $t$
declare r jsonb; h jsonb;
        v_m text := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 6}', pg_temp.c('x'), pg_temp.c('xm'));
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('every 4', pg_temp.e(format('select public.live_create(%L, %L)', v_m, '{"stand_every": 4}')), '22023/stand_every@400');
  perform pg_temp.eq('every "3" as text', pg_temp.e(format('select public.live_create(%L, %L)', v_m, '{"stand_every": "3"}')), '22023/stand_every@400');
  perform pg_temp.eq('every 3.5', pg_temp.e(format('select public.live_create(%L, %L)', v_m, '{"stand_every": 3.5}')), '22023/stand_every@400');
  perform pg_temp.eq('null', pg_temp.e(format('select public.live_create(%L, %L)', v_m, '{"stand_every": null}')), '22023/stand_every@400');
  perform pg_temp.eq('a stand game is all movement: no N', pg_temp.e(format('select public.live_create(%L, %L)', v_m, '{"mode": "stand", "stand_every": 3}')),
                     '22023/stand_every@400');
  -- A stand game with 0 and a battle with 0: their JSON is their own.
  r := public.live_create(v_m::jsonb, '{"mode": "stand", "stand_every": 0}');
  h := pg_temp.hs((r ->> 'game_id')::uuid, r ->> 'host_token');
  perform pg_temp.eq('stand settings unchanged', (h -> 'settings')::text,
                     '{"who": "pin", "boss": "clock", "mode": "stand", "speed": true, "time_s": 15, "chat_names": true}'::jsonb::text);
  perform pg_temp.yes('no mixed in a stand game', not (h ? 'mixed'));
  perform public.live_end((r ->> 'game_id')::uuid, r ->> 'host_token');
  r := public.live_create(v_m::jsonb, '{"stand_every": 0, "boss": "skeleton"}');
  h := pg_temp.hs((r ->> 'game_id')::uuid, r ->> 'host_token');
  perform pg_temp.eq('battle settings unchanged', (h -> 'settings')::text,
                     '{"who": "pin", "mode": "boss", "speed": true, "time_s": 20, "chat_names": true}'::jsonb::text);
  perform pg_temp.eq('battle state keys unchanged', pg_temp.keys(h),
                     'answered,answered_ids,boss,final,mode,now,pin,players,q_count,qi,question,result,rev,roster,settings,skipped,speed,state,time_s,top,topic');
  perform pg_temp.eq('battle boss unchanged', (h -> 'boss')::text, '{"hp": 0, "phase": 0, "hp_max": 0, "defeated": false}'::jsonb::text);
  perform pg_temp.put('b', r ->> 'game_id');
  perform pg_temp.put('b_host', r ->> 'host_token');
  perform pg_temp.eq('the room cannot write a battle', pg_temp.close((r ->> 'game_id')::uuid, r ->> 'host_token', 0, '[]'), '22023/mode@400');
  perform public.live_end((r ->> 'game_id')::uuid, r ->> 'host_token');
  -- Game M: every 3rd question, the skeleton, 20 s.
  r := public.live_create(v_m::jsonb, '{"stand_every": 3, "boss": "skeleton"}');
  perform pg_temp.put('g', r ->> 'game_id');
  perform pg_temp.put('host', r ->> 'host_token');
  perform pg_temp.put('pin', r ->> 'pin');
  h := pg_temp.hs((r ->> 'game_id')::uuid, r ->> 'host_token');
  perform pg_temp.eq('mixed settings', (h -> 'settings')::text,
                     '{"who": "pin", "boss": "skeleton", "mode": "boss", "speed": true, "time_s": 20, "chat_names": true, "stand_every": 3}'::jsonb::text);
  perform pg_temp.eq('mixed: the plan from the lobby on', (h -> 'mixed')::text, '{"every": 3, "rounds": [2, 5]}'::jsonb::text);
  perform pg_temp.eq('the boss of the arena', (h -> 'boss')::text, '{"hp": 0, "kind": "skeleton", "phase": 0, "hp_max": 0, "defeated": false}'::jsonb::text);
  perform pg_temp.eq('mode stays boss', (h ->> 'mode') || '/' || (h ->> 'time_s') || '/' || (h ->> 'q_count'), 'boss/20/6');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 3. Game M, button questions 0 and 1 ───
do $t$
declare r jsonb; h jsonb; v_g uuid := pg_temp.g('g'); v_host text := pg_temp.c('host'); v_pin text := pg_temp.c('pin');
begin
  perform pg_temp.who('anon');
  perform pg_temp.put('p1', public.live_join(v_pin, 'Дима', pg_temp.tok(1), null) ->> 'player_id');
  perform pg_temp.tick(v_g, 0.1);
  perform pg_temp.put('p2', public.live_join(v_pin, 'Лена', pg_temp.tok(2), null) ->> 'player_id');
  perform pg_temp.tick(v_g, 0.1);
  perform pg_temp.put('p3', public.live_join(v_pin, 'Боря', pg_temp.tok(3), null) ->> 'player_id');
  perform pg_temp.tick(v_g, 0.1);
  perform pg_temp.put('p4', public.live_join(v_pin, 'Аня', pg_temp.tok(4), null) ->> 'player_id');
  perform pg_temp.tick(v_g, 0.1);
  r := public.live_state(v_g, pg_temp.tok(1), null);
  perform pg_temp.eq('the phone sees the plan', (r -> 'mixed')::text, '{"every": 3, "rounds": [2, 5]}'::jsonb::text);
  perform pg_temp.eq('a write in the lobby', pg_temp.close(v_g, v_host, 0, '[]'), 'ML004/bad_qi@400');
  -- Question 0: a button question.
  h := public.live_next(v_g, v_host, 'lobby');
  perform pg_temp.eq('countdown 0: HP for 4 × 6, a button question', concat_ws('/', h ->> 'state', h -> 'boss' ->> 'hp_max', h -> 'question' ->> 'stand'), 'countdown/1320/false');
  perform pg_temp.eq('question keys', pg_temp.keys(h -> 'question'), 'closes_at,opens_at,options,phase,picture,qi,stand,text');
  perform pg_temp.tick(v_g, 3);
  perform pg_temp.eq('the room cannot write a button question', pg_temp.close(v_g, v_host, 0, '[]'), 'ML004/tap@400');
  perform pg_temp.eq('Боря at 0 ms', pg_temp.tap(v_g, 3, 0, 1), 'ok');
  perform pg_temp.tick(v_g, 0.9);
  perform pg_temp.eq('Дима at 900 ms', pg_temp.tap(v_g, 1, 0, 1), 'ok');
  perform pg_temp.eq('Лена wrong', pg_temp.tap(v_g, 2, 0, 0), 'ok');
  perform pg_temp.tick(v_g, 21);
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('q0 closed by time: 1320 − 100 − 98', pg_temp.board(h), '1122/1320/0/false|2/[1, 2, 0, 0]/0/-/false/false');
  perform pg_temp.eq('q0 result keys', pg_temp.keys(h -> 'result'), 'counts,frozen_now,healed,hits,key,phase_changed,qi,right,stand,thawed,void');
  perform pg_temp.eq('q0: Лена froze; Аня gave no answer in phase 0', pg_temp.names(h -> 'result' -> 'frozen_now'), 'Лена');
  r := public.live_state(v_g, pg_temp.tok(4), null);
  perform pg_temp.eq('player result keys', pg_temp.keys(r -> 'result'), 'correct,counts,dmg,frozen,healed,key,none,phase_changed,qi,right,stand,thawed,void');
  -- Question 1: a button question.
  perform public.live_next(v_g, v_host, 'reveal');
  h := public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.eq('countdown 1, a button question', (h ->> 'qi') || '/' || (h -> 'question' ->> 'stand'), '1/false');
  perform pg_temp.tick(v_g, 3 + 5);
  perform pg_temp.eq('Дима at 5000 ms', pg_temp.tap(v_g, 1, 1, 2), 'ok');
  perform pg_temp.eq('Лена right: thaws', pg_temp.tap(v_g, 2, 1, 2), 'ok');
  perform pg_temp.eq('Боря wrong', pg_temp.tap(v_g, 3, 1, 0), 'ok');
  perform pg_temp.tick(v_g, 17);
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('q1: 1122 − 109', pg_temp.board(h), '1013/1320/0/false|2/[1, 0, 2]/0/-/false/false');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('before the movement round: Дима', pg_temp.pl(pg_temp.g('p1')), '207/2/2/2/false/0');
  perform pg_temp.eq('Лена (thawed)', pg_temp.pl(pg_temp.g('p2')), '0/1/1/1/false/1');
  perform pg_temp.eq('Боря (frozen)', pg_temp.pl(pg_temp.g('p3')), '100/0/1/1/true/0');
  perform pg_temp.eq('Аня (no answers, phase 0)', pg_temp.pl(pg_temp.g('p4')), '0/0/0/0/false/0');
end
$t$;

-- ─── 4. Game M, the movement round qi 2 (worked example A, MODE_MIXED.md §5) ───
do $t$
declare r jsonb; h jsonb; v_g uuid := pg_temp.g('g'); v_host text := pg_temp.c('host'); v_ans jsonb; v_rev bigint;
begin
  perform pg_temp.who('anon');
  perform public.live_next(v_g, v_host, 'reveal');
  h := public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.eq('countdown 2: a movement round in phase 0', concat_ws('/', h ->> 'qi', h -> 'question' ->> 'stand', h -> 'question' ->> 'phase'), '2/true/0');
  perform pg_temp.yes('20 s to run', (h -> 'question' ->> 'closes_at')::timestamptz - (h -> 'question' ->> 'opens_at')::timestamptz = interval '20 s');
  perform pg_temp.eq('a tap in the countdown', pg_temp.tap(v_g, 1, 2, 1), 'ML004/stand@400');
  perform pg_temp.eq('the room in the countdown', pg_temp.close(v_g, v_host, 2, '[]'), 'ML004/early@400');
  perform pg_temp.tick(v_g, 3);
  perform pg_temp.eq('a tap while it runs', pg_temp.tap(v_g, 1, 2, 1), 'ML004/stand@400');
  perform pg_temp.eq('a tap for another question', pg_temp.tap(v_g, 1, 1, 1), 'ML004/bad_qi@400');
  r := public.live_state(v_g, pg_temp.tok(1), null);
  perform pg_temp.eq('the phone: open, a movement round, no choice yet', concat_ws('/', r ->> 'state', r -> 'question' ->> 'stand', coalesce(r -> 'me' ->> 'choice', '-'), r ->> 'answered'),
                     'open/true/-/0');
  perform pg_temp.eq('the room 19 s early', pg_temp.close(v_g, v_host, 2, '[]'), 'ML004/early@400');
  perform pg_temp.tick(v_g, 19.2);
  v_ans := jsonb_build_array(
    jsonb_build_object('p', pg_temp.c('p2'), 'c', 0, 'e', 1200),
    jsonb_build_object('p', pg_temp.c('p1'), 'c', 1, 'e', 2500),
    jsonb_build_object('p', pg_temp.c('p3'), 'c', 1, 'e', 4000));
  perform pg_temp.eq('elapsed past T', pg_temp.close(v_g, v_host, 2, jsonb_build_array(jsonb_build_object('p', pg_temp.c('p1'), 'c', 1, 'e', 20001))), '22023/answers@400');
  perform pg_temp.eq('a wrong host token', pg_temp.close(v_g, repeat('x', 43), 2, v_ans), '42501/host@403');
  perform pg_temp.eq('the button question before', pg_temp.close(v_g, v_host, 1, v_ans), 'ML004/tap@400');
  v_rev := (pg_temp.hs(v_g, v_host) ->> 'rev')::bigint;
  r := public.live_stand_close(v_g, v_host, 2, v_ans);
  perform pg_temp.eq('result keys', pg_temp.keys(r), 'active,again,boss,counts,frozen_now,healed,hits,key,now,phase_changed,qi,right,rows,thawed,void');
  perform pg_temp.eq('row keys', pg_temp.keys(r -> 'rows' -> 0), 'best,c,dmg,froze,frozen,ms,ok,out,p,place,right,streak,thawed,total');
  perform pg_temp.eq('key, counts, right, active, void, heal, phase', concat_ws('/', r ->> 'key', r -> 'counts', r ->> 'right', r ->> 'active', r ->> 'again',
                     r ->> 'void', r ->> 'healed', r ->> 'phase_changed'), '1/[1, 2, 0, 0]/2/4/false/false/0/1');
  perform pg_temp.eq('the boss after the round', (r -> 'boss')::text, '{"hp": 872, "phase": 1, "hp_max": 1320, "defeated": false}'::jsonb::text);
  perform pg_temp.eq('Дима on Б since 2500 ms, streak 2 before: 141', pg_temp.row_of(r, pg_temp.c('p1')), '1/true/141/2500/false/false/false/false/348/3/3/3/1');
  perform pg_temp.eq('Боря frozen on Б: thaws, no damage', pg_temp.row_of(r, pg_temp.c('p3')), '1/true/0/4000/true/false/false/false/100/1/1/2/2');
  perform pg_temp.eq('Лена on А: wrong, freezes', pg_temp.row_of(r, pg_temp.c('p2')), '0/false/0/1200/false/true/true/false/0/0/1/1/3');
  perform pg_temp.eq('Аня in no zone: freezes in phase 0 too', pg_temp.row_of(r, pg_temp.c('p4')), '-/false/0/-/false/true/true/false/0/0/0/0/4');
  perform pg_temp.eq('hits', (r -> 'hits')::text, jsonb_build_array(jsonb_build_object('dmg', 141, 'hp_after', 872, 'player_id', pg_temp.c('p1')))::text);
  perform pg_temp.eq('frozen_now in close order, thawed', pg_temp.names(r -> 'frozen_now') || '|' || pg_temp.names(r -> 'thawed'), 'Лена,Аня|Боря');
  perform pg_temp.eq('one close, one rev', concat_ws('/', pg_temp.hs(v_g, v_host) ->> 'state', (pg_temp.hs(v_g, v_host) ->> 'rev')::bigint - v_rev), 'reveal/1');
  perform pg_temp.yes('the close sends the reveal hint', pg_temp.hints(v_g) like '%reveal');
  h := public.live_stand_close(v_g, v_host, 2, v_ans);
  perform pg_temp.eq('the retry: again, the same rows', (h ->> 'again') || '/' || (h -> 'rows')::text, 'true/' || (r -> 'rows')::text);
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('the host reads the same', pg_temp.board(h), '872/1320/1/false|2/[1, 2, 0, 0]/0/1/true/false');
  perform pg_temp.eq('host hits = the room''s', (h -> 'result' -> 'hits')::text, (r -> 'hits')::text);
  r := public.live_state(v_g, pg_temp.tok(4), null);
  perform pg_temp.eq('Аня: none, frozen', concat_ws('/', r -> 'result' ->> 'none', r -> 'result' ->> 'frozen', r -> 'result' ->> 'stand', r -> 'me' ->> 'frozen'), 'true/true/true/true');
  r := public.live_state(v_g, pg_temp.tok(1), null);
  perform pg_temp.eq('Дима: his zone, right, 141', concat_ws('/', r -> 'me' ->> 'choice', r -> 'result' ->> 'correct', r -> 'result' ->> 'dmg', r -> 'me' ->> 'dmg'), '1/true/141/348');
  -- The bot's message: still the battle's (mode boss, the boss's HP).
  perform pg_temp.who('postgres');
  update public.live_games set chat_id = -100123, message_id = 77, tg_edit_at = null where id = v_g;
  perform pg_temp.who('service_role');
  r := public.bot_live_sync(v_g);
  perform pg_temp.eq('the bot edits with the HP', concat_ws('/', r ->> 'status', r ->> 'state', r ->> 'qi', r ->> 'hp_pct', coalesce(r ->> 'mode', 'boss')), 'edit/reveal/2/66/boss');
  perform pg_temp.yes('the bot gets no key', r::text !~ '"key"');
  perform pg_temp.who('postgres');
  update public.live_games set chat_id = null, message_id = null where id = v_g;
end
$t$;

-- ─── 5. Game M: button questions 3 and 4, the movement round qi 5 in phase 2 (worked example B), podium ───
do $t$
declare r jsonb; h jsonb; v_g uuid := pg_temp.g('g'); v_host text := pg_temp.c('host');
begin
  perform pg_temp.who('anon');
  perform public.live_next(v_g, v_host, 'reveal');
  h := public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.eq('countdown 3: a button question again', (h ->> 'qi') || '/' || (h -> 'question' ->> 'stand'), '3/false');
  perform pg_temp.tick(v_g, 3);
  perform pg_temp.eq('q3 taps', concat_ws(',', pg_temp.tap(v_g, 1, 3, 0), pg_temp.tap(v_g, 2, 3, 0), pg_temp.tap(v_g, 3, 3, 0), pg_temp.tap(v_g, 4, 3, 0)), 'ok,ok,ok,ok');
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('q3 closes at once: 872 − 175 − 125', pg_temp.board(h), '572/1320/1/false|4/[4, 0]/0/-/false/false');
  perform pg_temp.eq('q3 thaws Лена and Аня (same ms: in player id order)', pg_temp.names(h -> 'result' -> 'thawed', true), 'Аня,Лена');
  perform public.live_next(v_g, v_host, 'reveal');
  perform public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.tick(v_g, 3);
  perform pg_temp.eq('q4 taps', concat_ws(',', pg_temp.tap(v_g, 1, 4, 0), pg_temp.tap(v_g, 2, 4, 1), pg_temp.tap(v_g, 3, 4, 1), pg_temp.tap(v_g, 4, 4, 2)), 'ok,ok,ok,ok');
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('q4: 572 − 200, phase 2', pg_temp.board(h), '372/1320/2/false|1/[1, 2, 1]/0/2/false/false');
  perform public.live_next(v_g, v_host, 'reveal');
  h := public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.eq('countdown 5: a movement round in phase 2', concat_ws('/', h ->> 'qi', h -> 'question' ->> 'stand', h -> 'question' ->> 'phase'), '5/true/2');
  perform pg_temp.tick(v_g, 3 + 19.5);
  r := public.live_stand_close(v_g, v_host, 5, jsonb_build_array(
    jsonb_build_object('p', pg_temp.c('p1'), 'c', 3, 'e', 0),
    jsonb_build_object('p', pg_temp.c('p2'), 'c', 3, 'e', 3000),
    jsonb_build_object('p', pg_temp.c('p3'), 'c', 2, 'e', 500)));
  perform pg_temp.eq('example B: 372 − 200, then 2 right of 4 < 3: heal 66', concat_ws('/', (r -> 'boss' ->> 'hp'), r ->> 'right', r ->> 'healed', coalesce(r ->> 'phase_changed', '-')),
                     '238/2/66/-');
  perform pg_temp.eq('Дима streak 5 before, on Г at 0 ms: 200', pg_temp.row_of(r, pg_temp.c('p1')), '3/true/200/0/false/false/false/false/923/6/6/6/1');
  perform pg_temp.eq('Лена frozen on Г: thaws', pg_temp.row_of(r, pg_temp.c('p2')), '3/true/0/3000/true/false/false/false/0/1/1/3/3');
  perform pg_temp.eq('Боря frozen on В: stays frozen (not frozen again)', pg_temp.row_of(r, pg_temp.c('p3')), '2/false/0/500/false/false/true/false/225/0/2/3/2');
  perform pg_temp.eq('Аня frozen, no zone: stays frozen', pg_temp.row_of(r, pg_temp.c('p4')), '-/false/0/-/false/false/true/false/0/0/1/1/4');
  perform pg_temp.eq('nobody froze now', (r -> 'frozen_now')::text, '[]');
  h := public.live_next(v_g, v_host, 'reveal');
  perform pg_temp.eq('podium after the last question, the boss stands', concat_ws('/', h ->> 'state', h -> 'final' ->> 'won', h -> 'final' ->> 'accuracy_pct', h -> 'boss' ->> 'hp'),
                     'podium/false/54/238');
  perform pg_temp.eq('the podium names the class', (select string_agg((x ->> 'name') || ':' || (x ->> 'dmg'), ',') from jsonb_array_elements(h -> 'top') x),
                     'Дима:923,Боря:225,Лена:0,Аня:0');
  r := public.live_review(v_g, pg_temp.tok(4));
  perform pg_temp.eq('review item keys', pg_temp.keys(r -> 'items' -> 0), 'choice,correct,key,options,qi,stand,text');
  perform pg_temp.eq('Аня''s review marks the movement rounds', (select string_agg(concat_ws(':', x ->> 'qi', x ->> 'stand', coalesce(x ->> 'choice', '-'), x ->> 'correct'), ','
                                                                   order by (x ->> 'qi')::int) from jsonb_array_elements(r -> 'items') x),
                     '0:false:-:false,1:false:-:false,2:true:-:false,3:false:0:true,4:false:2:false,5:true:-:false');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 6. Game V: every 10 of 3 questions → the last is the movement round; nobody writes it: void ───
do $t$
declare r jsonb; h jsonb; v_t text := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xt'));
        v_g uuid; v_host text; v_pin text;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(v_t::jsonb, '{"stand_every": 10}');
  v_g := (r ->> 'game_id')::uuid; v_host := r ->> 'host_token'; v_pin := r ->> 'pin';
  perform pg_temp.put('v', v_g::text);
  perform pg_temp.who('anon');
  perform pg_temp.eq('shorter than N: the last question', (pg_temp.hs(v_g, v_host) -> 'mixed')::text, '{"every": 10, "rounds": [2]}'::jsonb::text);
  perform pg_temp.put('v1', public.live_join(v_pin, 'Дима', pg_temp.tok(11), null) ->> 'player_id');
  perform pg_temp.tick(v_g, 0.1);
  perform pg_temp.put('v2', public.live_join(v_pin, 'Лена', pg_temp.tok(12), null) ->> 'player_id');
  perform pg_temp.tick(v_g, 0.1);
  perform public.live_next(v_g, v_host, 'lobby');
  perform pg_temp.tick(v_g, 3);
  perform pg_temp.eq('V q0', pg_temp.tap(v_g, 11, 0, 1), 'ok');
  perform pg_temp.tick(v_g, 22);
  perform pg_temp.eq('V q0: 330 − 100', pg_temp.board(pg_temp.hs(v_g, v_host)), '230/330/0/false|1/[0, 1, 0, 0]/0/-/false/false');
  perform public.live_next(v_g, v_host, 'reveal');
  perform public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.tick(v_g, 3);
  perform pg_temp.eq('V q1', pg_temp.tap(v_g, 11, 1, 0) || ',' || pg_temp.tap(v_g, 12, 1, 1), 'ok,ok');
  perform pg_temp.eq('V q1: 230 − 125, phase 2', pg_temp.board(pg_temp.hs(v_g, v_host)), '105/330/2/false|1/[1, 1]/0/2/false/false');
  perform public.live_next(v_g, v_host, 'reveal');
  h := public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.eq('V q2 is a movement round', (h ->> 'qi') || '/' || (h -> 'question' ->> 'stand'), '2/true');
  perform pg_temp.tick(v_g, 3.5);
  perform pg_temp.put('v3', public.live_join(v_pin, 'Поздний', pg_temp.tok(13), null) ->> 'player_id');
  perform pg_temp.eq('a late joiner adds no HP for the last question', pg_temp.hs(v_g, v_host) -> 'boss' ->> 'hp_max', '330');
  perform pg_temp.tick(v_g, 19.5 + 7);
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.yes('7 s after the deadline: still open, no key', h ->> 'state' = 'open' and h::text !~ '"key"');
  perform pg_temp.tick(v_g, 1.1);
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('closed by time: void, nothing changes, no heal in phase 2', pg_temp.board(h), '105/330/2/false|0/[0, 0, 0, 0]/0/-/true/true');
  perform pg_temp.eq('void: no hits, nobody froze', (h -> 'result' -> 'hits')::text || (h -> 'result' -> 'frozen_now')::text, '[][]');
  r := public.live_state(v_g, pg_temp.tok(11), null);
  perform pg_temp.eq('Дима keeps his streak', concat_ws('/', r -> 'result' ->> 'void', r -> 'result' ->> 'none', r -> 'me' ->> 'streak', r -> 'me' ->> 'frozen'), 'true/true/2/false');
  r := public.live_stand_close(v_g, v_host, 2, jsonb_build_array(jsonb_build_object('p', pg_temp.c('v1'), 'c', 1, 'e', 1)));
  perform pg_temp.eq('the room comes too late: again, void, nothing written', concat_ws('/', r ->> 'again', r ->> 'void', pg_temp.row_of(r, pg_temp.c('v1'))),
                     'true/true/-/false/0/-/false/false/false/false/225/2/2/2/1');
  perform pg_temp.eq('the late joiner', pg_temp.row_of(r, pg_temp.c('v3')), '-/false/0/-/false/false/false/true/0/0/0/0/3');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('Лена still frozen from q1, streak 0', pg_temp.pl(pg_temp.g('v2')), '0/0/0/0/true/0');
  perform pg_temp.who('anon');
  h := public.live_next(v_g, v_host, 'reveal');
  perform pg_temp.eq('V podium', concat_ws('/', h ->> 'state', h -> 'final' ->> 'won'), 'podium/false');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 7. Game D: the boss falls in a movement round; a kicked player and a late joiner are left out ───
do $t$
declare r jsonb; h jsonb; v_t text := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xt'));
        v_g uuid; v_host text; v_pin text;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(v_t::jsonb, '{"stand_every": 3, "speed": true, "time_s": 10}');
  v_g := (r ->> 'game_id')::uuid; v_host := r ->> 'host_token'; v_pin := r ->> 'pin';
  perform pg_temp.who('anon');
  perform pg_temp.put('d1', public.live_join(v_pin, 'Дима', pg_temp.tok(21), null) ->> 'player_id');
  perform pg_temp.tick(v_g, 0.1);
  perform pg_temp.put('d2', public.live_join(v_pin, 'Лена', pg_temp.tok(22), null) ->> 'player_id');
  perform pg_temp.tick(v_g, 0.1);
  perform pg_temp.put('d3', public.live_join(v_pin, 'Боря', pg_temp.tok(23), null) ->> 'player_id');
  perform pg_temp.tick(v_g, 0.1);
  perform public.live_next(v_g, v_host, 'lobby');
  perform pg_temp.tick(v_g, 3 + 12);
  perform pg_temp.eq('D q0 closed by time, nobody answered', pg_temp.hs(v_g, v_host) ->> 'state', 'reveal');
  perform public.live_next(v_g, v_host, 'reveal');
  perform public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.tick(v_g, 3 + 12);
  perform public.live_next(v_g, v_host, 'reveal');
  perform pg_temp.who('postgres');
  update public.live_games set hp = 120 where id = v_g;
  perform pg_temp.who('anon');
  perform public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.tick(v_g, 3.5);
  perform pg_temp.put('d4', public.live_join(v_pin, 'Поздний', pg_temp.tok(24), null) ->> 'player_id');
  perform public.live_kick(v_g, v_host, pg_temp.g('d3'));
  perform pg_temp.eq('still open after the kick', pg_temp.hs(v_g, v_host) ->> 'state', 'open');
  perform pg_temp.tick(v_g, 9);
  r := public.live_stand_close(v_g, v_host, 2, jsonb_build_array(
    jsonb_build_object('p', pg_temp.c('d1'), 'c', 1, 'e', 0),
    jsonb_build_object('p', pg_temp.c('d2'), 'c', 1, 'e', 500),
    jsonb_build_object('p', pg_temp.c('d3'), 'c', 1, 'e', 0),
    jsonb_build_object('p', pg_temp.c('d4'), 'c', 1, 'e', 0)));
  perform pg_temp.eq('two hits: 120 − 100 − 98, the second one still counts', (r -> 'hits')::text,
    jsonb_build_array(jsonb_build_object('dmg', 100, 'hp_after', 20, 'player_id', pg_temp.c('d1')),
                      jsonb_build_object('dmg', 98, 'hp_after', 0, 'player_id', pg_temp.c('d2')))::text);
  perform pg_temp.eq('defeated; the kicked and the late left out', concat_ws('/', r -> 'boss' ->> 'defeated', r ->> 'right', r ->> 'active', r -> 'counts',
                     jsonb_array_length(r -> 'rows'), pg_temp.row_of(r, pg_temp.c('d4'))),
                     'true/2/2/[0, 2, 0, 0]/3/-/false/0/-/false/false/false/true/0/0/0/0/3');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the kicked one''s and the late one''s answers are not stored',
                     (select count(*)::text from public.live_answers where game_id = v_g and qi = 2 and player_id in (pg_temp.g('d3'), pg_temp.g('d4'))), '0');
  perform pg_temp.who('anon');
  h := public.live_next(v_g, v_host, 'reveal');
  perform pg_temp.eq('podium: the class won', concat_ws('/', h ->> 'state', h -> 'final' ->> 'won', h -> 'boss' ->> 'defeated'), 'podium/true/true');
  perform pg_temp.eq('anon calls no mixed helper', split_part(pg_temp.e('select meldy_private.live_stand_round(3, 6, 2)'), '/', 1), '42501');
  perform pg_temp.who('postgres');
end
$t$;

rollback;
\echo LIVE MIXED BEHAVIOUR PASSED
