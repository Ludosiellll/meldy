-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261021090000_live_game.sql on the
-- scratch database of live_game_run.sh (which sets :names and :looks to contracts/live/name_cases.json and
-- default_looks.json). One transaction, rolled back; now() is one moment inside it, so time moves by a time machine
-- (pg_temp.tick: every time of a game moves back by n seconds). Hints are flushed with SET CONSTRAINTS ALL IMMEDIATE.
-- A = aaaa…1 (author of exam X), C = cccc…3 (author of exam Y: the limits), D = dddd…4 and E = eeee…5 (signed-in
-- players; E becomes a member of X); guests are anon with tokens tok(n).
-- G1, the main game (3 questions, 20 s, speed on): exact damage (98, 95, 125, 75 — rules.test.ts numbers), hits in
--   order of time, freeze, thaw, phase 1 by HP and its «no answer freezes», moves of the top five, the 1.5 s grace,
--   the 30 s auto-advance, early close when all answered, podium, accuracy 67 %, the crown for D, review, ended.
-- G2: late joiners (HP + 55 per question not opened; not_joined_yet; not frozen for that question), kick (token dead,
--   early close by the kick), phase 2's heal (round(5 %)), the host's end, review of closed questions only.
-- G3: one hint per transaction (a cascade countdown → open → reveal), no answer in phase 0 does not freeze, the defeat
--   (hits 100/100: hp_after 20, 0; both counted), podium before the last question, won, E's wins.
-- The key's secrecy (never in any state before close, host included), tokens stored as sha256 only, unchanged by
-- since_rev, errors and HTTP statuses of the contract, members only, the bot's functions (join with replay rules,
-- live_tg_post and the pg_net calls, bot_live_post, posted, sync), limits (3 open games, 10 creates an hour, 300 players, 120 joins a minute per game,
-- 120 a minute per address — 429 with Retry-After, the PIN's 3 hours), names and default looks of contracts/live, the
-- JSON shapes of types.ts.
-- A failure raises; success prints LIVE GAME BEHAVIOUR PASSED.
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
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- ─── 0. The shared cases (contracts/live) and the pure numbers ───
do $t$
declare c jsonb; v_got text;
begin
  for c in select x from jsonb_array_elements((select v from pg_temp.shared where k = 'names') -> 'cases') x loop
    v_got := pg_temp.e(format('select meldy_private.live_name_check(%L)', c ->> 'name'));
    if c ? 'ok' then
      perform pg_temp.eq('name ' || (c ->> 'name'), v_got, 'ok');
      perform pg_temp.eq('name kept ' || (c ->> 'name'), meldy_private.live_name_check(c ->> 'name'), c ->> 'ok');
    else
      perform pg_temp.eq('name ' || (c ->> 'name'), v_got, 'ML006/' || (c ->> 'reason') || '@400');
    end if;
  end loop;
  for c in select x from jsonb_array_elements((select v from pg_temp.shared where k = 'looks') -> 'cases') x loop
    perform pg_temp.eq('default look ' || (c ->> 'name'), meldy_private.live_default_look(c ->> 'name')::text, (c -> 'look')::text);
  end loop;
  perform pg_temp.eq('name with tabs and a no-break space', meldy_private.live_name_check(E'\tЛена\u00a0 Ли '), 'Лена Ли');
  -- rules.test.ts
  perform pg_temp.eq('damage 900 ms', meldy_private.live_damage(900, 20, 1, true)::text, '98');
  perform pg_temp.eq('damage 0 ms streak 5', meldy_private.live_damage(0, 20, 5, true)::text, '200');
  perform pg_temp.eq('damage at the limit', meldy_private.live_damage(20000, 20, 1, true)::text, '50');
  perform pg_temp.eq('damage without speed', meldy_private.live_damage(5000, 20, 2, false)::text, '125');
  perform pg_temp.eq('damage streak capped', meldy_private.live_damage(0, 20, 9, true)::text, '200');
  perform pg_temp.eq('damage time capped', meldy_private.live_damage(99999, 10, 1, true)::text, '50');
  perform pg_temp.eq('damage negative time', meldy_private.live_damage(-50, 10, 1, true)::text, '100');
  perform pg_temp.eq('damage: the double, not the fraction', meldy_private.live_damage(8500, 10, 1, true)::text, '57');
  perform pg_temp.eq('hp for 24 × 6', (24 * 6 * 55)::text, '7920');
  perform pg_temp.eq('phases', concat_ws(',', meldy_private.live_phase_for(7920, 7920), meldy_private.live_phase_for(5280, 7920),
                                          meldy_private.live_phase_for(5281, 7920), meldy_private.live_phase_for(2640, 7920)), '0,1,0,2');
  perform pg_temp.eq('heal', meldy_private.live_heal(7920)::text, '396');
  perform pg_temp.eq('right needed', meldy_private.live_right_needed(24) || ',' || meldy_private.live_right_needed(25), '16,17');
  perform pg_temp.eq('accuracy', meldy_private.live_accuracy(1, 8, 1) || ',' || meldy_private.live_accuracy(0, 0, 3), '13,0');
  perform pg_temp.eq('unlocks', meldy_private.live_unlocks(2, 700, 5, 3, 10, 5, array['grad'])::text, '{crown,graphite,horns,snow}');
  perform pg_temp.eq('no unlocks', meldy_private.live_unlocks(2, 0, 1, 0, 1, 0, '{}')::text, '{}');
  perform pg_temp.eq('look ok', meldy_private.live_look_check('{"body":"cloud","colour":"orange","eyes":"round","hat":"phones","x":1}', '{}')::text,
                     '{"hat": "phones", "body": "cloud", "eyes": "round", "colour": "orange"}');
  -- 'fez' is unknown before and after 20261023090000_live_stand_phone.sql (which makes 'tophat' a free hat).
  perform pg_temp.eq('look unknown', pg_temp.e($$select meldy_private.live_look_check('{"body":"cloud","colour":"orange","eyes":"round","hat":"fez"}', '{}')$$),
                     'ML007/unknown_part@400');
  perform pg_temp.eq('look locked', pg_temp.e($$select meldy_private.live_look_check('{"body":"cloud","colour":"orange","eyes":"round","hat":"crown"}', '{}')$$),
                     'ML007/locked@400');
  perform pg_temp.eq('look opened', pg_temp.e($$select meldy_private.live_look_check('{"body":"cloud","colour":"graphite","eyes":"round","hat":"none"}', '{graphite}')$$),
                     'ok');
end
$t$;

-- ─── 1. Exams: X (A) with 5 playable questions and 4 that are not; Y (C) with 4 playable ───
do $t$
declare r jsonb; v_s text;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.container_create('Живая игра', null, '[{"title":"Базы данных"},{"title":"Другое"}]');
  perform pg_temp.put('x', r ->> 'container_id');
  v_s := r -> 'subjects' -> 0 ->> 'id';
  perform pg_temp.put('xs', v_s);
  perform pg_temp.put('xs2', r -> 'subjects' -> 1 ->> 'id');
  perform public.container_items_add(v_s::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'l:1', 'stem', 'Какая команда отменяет транзакцию?', 'options', jsonb_build_array('ROLLBACK', 'COMMIT', 'SAVEPOINT', 'GRANT'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'l:2', 'stem', 'Какая команда относится к DDL?', 'options', jsonb_build_array('SELECT', 'ALTER'), 'correct', jsonb_build_array(1)),
    jsonb_build_object('ref', 'l:3', 'stem', 'Какая нормальная форма без транзитивных зависимостей?', 'options', jsonb_build_array('Первая', 'Вторая', 'Третья'), 'correct', jsonb_build_array(2), 'keep_order', true),
    jsonb_build_object('ref', 'l:4', 'stem', 'Что объединяет строки по условию?', 'options', jsonb_build_array('UNION', 'JOIN', 'HAVING'), 'correct', jsonb_build_array(1)),
    jsonb_build_object('ref', 'l:5', 'stem', 'Буква I в ACID?', 'options', jsonb_build_array('Целиком', 'Изоляция'), 'correct', jsonb_build_array(1)),
    jsonb_build_object('ref', 'n:1', 'stem', 'Несколько верных', 'options', jsonb_build_array('a', 'b', 'c'), 'correct', jsonb_build_array(0, 1)),
    jsonb_build_object('ref', 'n:2', 'stem', 'Пять вариантов', 'options', jsonb_build_array('1', '2', '3', '4', '5'), 'correct', jsonb_build_array(4)),
    jsonb_build_object('ref', 'n:3', 'stem', 'Столица Франции', 'answers', jsonb_build_array('Париж')),
    jsonb_build_object('ref', 'n:4', 'stem', 'С картинкой', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0),
                       'images', jsonb_build_object('stem', jsonb_build_array((r ->> 'container_id') || '/' || repeat('a', 64) || '.png'))),
    jsonb_build_object('ref', 'u:1', 'stem', 'Без ключа', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array())));
  perform public.container_items_add((r -> 'subjects' -> 1 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'o:1', 'stem', 'Только несколько', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(0, 1))));
  r := public.quiz_create(pg_temp.g('x'), jsonb_build_object('title', 'Контрольная по БД', 'attempts', null));
  perform pg_temp.put('quiz', r ->> 'id');
  perform pg_temp.who('authenticated', 'cccccccc-0000-0000-0000-000000000003');
  r := public.container_create('Лимиты', null, '[{"title":"Т"}]');
  perform pg_temp.put('y', r ->> 'container_id');
  perform pg_temp.put('ys', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'y:1', 'stem', 'Один', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'y:2', 'stem', 'Два', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(1)),
    jsonb_build_object('ref', 'y:3', 'stem', 'Три', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'y:4', 'stem', 'Четыре', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(1))));
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 2. Creating: who may, the settings, the sources, skipped, the shape ───
do $t$
declare r jsonb; v_src text := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xs'));
begin
  perform pg_temp.who('anon');
  perform pg_temp.eq('anon create', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{}')), '28000/@401');
  perform pg_temp.who('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
  perform pg_temp.eq('not the author', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{}')), '42501/author@403');
  perform pg_temp.eq('not the quiz author', pg_temp.e(format('select public.live_create(%L, %L)', format('{"quiz_id": "%s"}', pg_temp.c('quiz')), '{}')),
                     '42501/author@403');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('unknown quiz', pg_temp.e(format('select public.live_create(%L, %L)', '{"quiz_id": "00000000-0000-4000-8000-000000000000"}', '{}')),
                     'P0002/quiz@404');
  perform pg_temp.eq('unknown exam', pg_temp.e(format('select public.live_create(%L, %L)',
                     '{"container_id": "00000000-0000-4000-8000-000000000000", "subject_ids": [], "count": 3}', '{}')), 'P0002/container@404');
  perform pg_temp.eq('no source', pg_temp.e($$select public.live_create('{}', '{}')$$), '22023/source@400');
  perform pg_temp.eq('time 15', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"time_s": 15}')), '22023/time_s@400');
  perform pg_temp.eq('mode race', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"mode": "race"}')), '22023/mode@400');
  perform pg_temp.eq('who all', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"who": "all"}')), '22023/who@400');
  perform pg_temp.eq('speed as text', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"speed": "yes"}')), '22023/speed@400');
  perform pg_temp.eq('count 2', pg_temp.e(format('select public.live_create(%L, %L)', replace(v_src, '"count": 3', '"count": 2'), '{}')),
                     '22023/count@400');
  perform pg_temp.eq('count 31', pg_temp.e(format('select public.live_create(%L, %L)', replace(v_src, '"count": 3', '"count": 31'), '{}')),
                     '22023/count@400');
  perform pg_temp.eq('a subject of another exam', pg_temp.e(format('select public.live_create(%L, %L)',
                     format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('ys')), '{}')), '22023/subject_ids@400');
  perform pg_temp.eq('nothing playable (1 skipped)', pg_temp.e(format('select public.live_create(%L, %L)',
                     format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xs2')), '{}')), 'ML008/1@400');
  -- From the контрольная: its draw (both subjects: 10 keyed), 5 playable, 5 skipped.
  r := public.live_create(format('{"quiz_id": "%s"}', pg_temp.c('quiz'))::jsonb, '{"time_s": 10, "speed": false, "who": "pin", "chat_names": false}');
  perform pg_temp.eq('create keys', pg_temp.keys(r), 'game_id,host_token,join_url,pin,q_count,skipped,tg_url,topic');
  perform pg_temp.eq('quiz source: q_count and skipped', (r ->> 'q_count') || '/' || (r ->> 'skipped'), '5/5');
  perform pg_temp.yes('pin, topic and host token formats', r ->> 'pin' ~ '^[1-9][0-9]{5}$' and r ->> 'topic' ~ '^[A-Za-z0-9_-]{22}$'
                      and r ->> 'host_token' ~ '^[A-Za-z0-9_-]{43}$');
  perform pg_temp.eq('join url', r ->> 'join_url', 'https://ludosiel-studyforge.hf.space/play?pin=' || (r ->> 'pin'));
  perform pg_temp.eq('tg url without the direct link (live_direct off)', r ->> 'tg_url', 'https://t.me/Meldyteach_bot?start=play_' || (r ->> 'pin'));
  perform pg_temp.put('gq', r ->> 'game_id');
  perform pg_temp.put('gq_host', r ->> 'host_token');
  perform pg_temp.who('postgres');
  perform pg_temp.yes('the host token is kept as sha256 only', (select g.host_hash = encode(sha256(convert_to(r ->> 'host_token', 'UTF8')), 'hex')
                                                                      and strpos(g::text, r ->> 'host_token') = 0
                                                                  from public.live_games g where g.id = (r ->> 'game_id')::uuid));
  perform pg_temp.yes('settings stored', (select time_s = 10 and not speed and who = 'pin' and not chat_names and title = 'Контрольная по БД'
                                              from public.live_games where id = pg_temp.g('gq')));
  perform pg_temp.yes('keep_order keeps the file order; the key is a shown index; options are the shown texts',
    (select bool_and(case when q.text like 'Какая нормальная форма%' then q.shown = '{0,1,2}' and q.key = 2 else true end
                     and q.options -> q.key::integer = i.options -> i.correct[1]::integer
                     and (select array_agg(s order by s) from unnest(q.shown) s) = (select array_agg(s::smallint order by s) from generate_series(0, jsonb_array_length(i.options) - 1) s))
       from public.live_questions q join public.test_items i on i.id = q.item_id where q.game_id = pg_temp.g('gq')));
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform public.live_end(pg_temp.g('gq'), pg_temp.c('gq_host'));
  -- G1 from subjects: 3 of the 5 playable, 4 skipped.
  r := public.live_create(v_src::jsonb, '{}');
  perform pg_temp.eq('subjects source: q_count and skipped', (r ->> 'q_count') || '/' || (r ->> 'skipped'), '3/4');
  perform pg_temp.put('g1', r ->> 'game_id');
  perform pg_temp.put('g1_host', r ->> 'host_token');
  perform pg_temp.put('g1_pin', r ->> 'pin');
  perform pg_temp.put('g1_topic', r ->> 'topic');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 3. G1: the lobby (joins, names, looks, tokens, rev and hints, unchanged) ───
do $t$
declare r jsonb; v_g uuid := pg_temp.g('g1'); v_pin text := pg_temp.c('g1_pin'); v_host text := pg_temp.c('g1_host'); v_rev bigint;
        v_dima jsonb := meldy_private.live_default_look('Дима'); v_lena jsonb := meldy_private.live_default_look('Лена');
begin
  perform pg_temp.who('anon');
  perform pg_temp.eq('host state: wrong token', pg_temp.e(format('select public.live_host_state(%L, %L, null)', v_g, repeat('x', 43))), '42501/host@403');
  perform pg_temp.eq('host state: unknown game', pg_temp.e(format('select public.live_host_state(%L, %L, null)', gen_random_uuid(), v_host)), 'P0002/game@404');
  r := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('host state keys', pg_temp.keys(r),
    'answered,answered_ids,boss,final,mode,now,pin,players,q_count,qi,question,result,rev,roster,settings,skipped,speed,state,time_s,top,topic');
  perform pg_temp.eq('lobby', (r ->> 'state') || '/' || (r ->> 'qi') || '/' || (r ->> 'rev') || '/' || (r ->> 'players'), 'lobby/-1/1/0');
  perform pg_temp.eq('settings', (r -> 'settings')::text, '{"who": "pin", "mode": "boss", "speed": true, "time_s": 20, "chat_names": true}'::jsonb::text);
  perform pg_temp.yes('now is ISO with ms', r ->> 'now' ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$');
  perform pg_temp.eq('next on an empty lobby', pg_temp.e(format('select public.live_next(%L, %L, %L)', v_g, v_host, 'lobby')), 'ML011/empty@409');
  perform pg_temp.eq('bad pin', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', '12ab56', 'Дима', pg_temp.tok(1))), 'P0002/pin@404');
  perform pg_temp.eq('unknown pin', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', '000001', 'Дима', pg_temp.tok(1))), 'P0002/pin@404');
  perform pg_temp.eq('bad token', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', v_pin, 'Дима', 'short')), '22023/token@400');
  perform pg_temp.eq('empty name', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', v_pin, '   ', pg_temp.tok(1))), 'ML006/length@400');
  perform pg_temp.eq('rude name', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', v_pin, 'Су-ка', pg_temp.tok(1))), 'ML006/rude@400');
  perform pg_temp.eq('unknown look', pg_temp.e(format('select public.live_join(%L, %L, %L, %L)', v_pin, 'Дима', pg_temp.tok(1),
                     '{"body":"x","colour":"blue","eyes":"round","hat":"none"}')), 'ML007/unknown_part@400');
  perform pg_temp.eq('locked look', pg_temp.e(format('select public.live_join(%L, %L, %L, %L)', v_pin, 'Дима', pg_temp.tok(1),
                     '{"body":"drop","colour":"snow","eyes":"round","hat":"none"}')), 'ML007/locked@400');
  perform pg_temp.eq('nothing written by the refused joins', pg_temp.hs(v_g, v_host) ->> 'players', '0');
  r := public.live_join(v_pin, '  Дима ', pg_temp.tok(1), null);
  perform pg_temp.eq('join keys', pg_temp.keys(r), 'game_id,look,name,now,player_id,rev,state,topic,wardrobe');
  perform pg_temp.eq('a guest: the name kept, rev moved, no wardrobe', (r ->> 'name') || '/' || (r ->> 'rev') || '/' || (r -> 'wardrobe')::text, 'Дима/2/null');
  perform pg_temp.eq('the same token again: the same player, rev unchanged',
                     (select (x ->> 'player_id') || '/' || (x ->> 'rev') from public.live_join(v_pin, 'Дима', pg_temp.tok(1), null) x), (r ->> 'player_id') || '/2');
  perform pg_temp.eq('the default look of the name', (r -> 'look')::text, v_dima::text);
  perform pg_temp.put('p1', r ->> 'player_id');
  perform pg_temp.eq('topic only to the joined', r ->> 'topic', pg_temp.c('g1_topic'));
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004');
  r := public.live_join(v_pin, 'Боря', pg_temp.tok(20), '{"body":"cloud","colour":"orange","eyes":"round","hat":"phones"}');
  perform pg_temp.eq('a signed-in player has a wardrobe', (r -> 'wardrobe')::text, '{"wins": 0, "games": 0, "unlocked": []}'::jsonb::text);
  perform pg_temp.put('p2', r ->> 'player_id');
  r := public.live_join(v_pin, 'Боря второй', pg_temp.tok(2), null);
  perform pg_temp.eq('the same account from another device: the same player and name', (r ->> 'player_id') || '/' || (r ->> 'name'), pg_temp.c('p2') || '/Боря');
  perform pg_temp.who('anon');
  perform pg_temp.eq('the first device''s token is dead', pg_temp.e(format('select public.live_state(%L, %L, null)', v_g, pg_temp.tok(20))), 'P0002/token@404');
  r := public.live_join(v_pin, 'Лена', pg_temp.tok(3), null);
  perform pg_temp.put('p3', r ->> 'player_id');
  perform pg_temp.eq('three joins moved rev to 4', r ->> 'rev', '4');
  perform pg_temp.who('postgres');
  perform pg_temp.yes('player tokens kept as sha256 only', (select bool_and(p.token_hash = encode(sha256(convert_to(t, 'UTF8')), 'hex') and strpos(p::text, t) = 0)
                                                        from public.live_players p
                                                        join (values (pg_temp.c('p1'), pg_temp.tok(1)), (pg_temp.c('p2'), pg_temp.tok(2)), (pg_temp.c('p3'), pg_temp.tok(3))) v(id, t)
                                                          on p.id = v.id::uuid));
  perform pg_temp.eq('a guest is their first token''s hash; the user has no guest hash',
    (select string_agg((guest_hash is not null)::text || ':' || coalesce(user_id::text, '-'), ',' order by name) from public.live_players where game_id = v_g),
    'false:dddddddd-0000-0000-0000-000000000004,true:-,true:-');
  perform pg_temp.who('anon');
  r := pg_temp.st(v_g, pg_temp.tok(1));
  perform pg_temp.eq('player state keys', pg_temp.keys(r), 'answered,boss,crowd,final,me,mode,now,players,q_count,qi,question,result,rev,speed,state,time_s,top');
  perform pg_temp.eq('me keys', pg_temp.keys(r -> 'me'), 'best,choice,dmg,frozen,look,name,place,player_id,streak');
  perform pg_temp.eq('the crowd: looks of the others, no names', (select jsonb_agg(x order by x::text) from jsonb_array_elements(r -> 'crowd') x)::text,
                     (select jsonb_agg(x order by x::text)
                        from jsonb_array_elements(jsonb_build_array('{"hat": "phones", "body": "cloud", "eyes": "round", "colour": "orange"}'::jsonb, v_lena)) x)::text);
  perform pg_temp.yes('never unchanged in the lobby', pg_temp.st(v_g, pg_temp.tok(1), 4) ? 'state');
  perform pg_temp.eq('set look', (public.live_set_look(v_g, pg_temp.tok(3), '{"body":"bean","colour":"teal","eyes":"one","hat":"bow"}') -> 'look' ->> 'body'), 'bean');
  perform pg_temp.eq('a look change moves rev', pg_temp.st(v_g, pg_temp.tok(3)) ->> 'rev', '5');
  perform pg_temp.eq('lobby roster hints', (select string_agg(h -> 'payload' ->> 'rev', ',') from jsonb_array_elements(pg_temp.hints(v_g)) h), '5');
  perform pg_temp.eq('expect another state', pg_temp.e(format('select public.live_next(%L, %L, %L)', v_g, v_host, 'reveal')), 'ML011/lobby@409');
  perform pg_temp.eq('expect a bad state', pg_temp.e(format('select public.live_next(%L, %L, %L)', v_g, v_host, 'nap')), '22023/expect@400');
  perform pg_temp.eq('an answer in the lobby', pg_temp.ans(v_g, pg_temp.tok(1), 0, 0), 'ML004/bad_qi@400');
  perform pg_temp.eq('review in the lobby', pg_temp.e(format('select public.live_review(%L, %L)', v_g, pg_temp.tok(1))), 'ML004/not_open@400');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 4. G1 question 0: countdown, early, open, answers by the server's clock, the key's secrecy, early close ───
do $t$
declare r jsonb; h jsonb; v_g uuid := pg_temp.g('g1'); v_host text := pg_temp.c('g1_host'); v_key integer; v_n integer; v_rev bigint;
        v_dima jsonb := meldy_private.live_default_look('Дима');
begin
  perform pg_temp.who('anon');
  h := public.live_next(v_g, v_host, 'lobby');
  perform pg_temp.hints(v_g);
  perform pg_temp.eq('countdown of question 0, HP = 3 × 3 × 55', (h ->> 'state') || '/' || (h ->> 'qi') || '/' || (h -> 'boss')::text,
                     'countdown/0/{"hp": 495, "phase": 0, "hp_max": 495, "defeated": false}');
  perform pg_temp.eq('question keys', pg_temp.keys(h -> 'question'), 'closes_at,opens_at,options,phase,picture,qi,text');
  perform pg_temp.yes('opens 3 s after the countdown, closes 20 s later',
    (h -> 'question' ->> 'opens_at')::timestamptz - now() between interval '2.99 s' and interval '3.01 s'
    and (h -> 'question' ->> 'closes_at')::timestamptz - (h -> 'question' ->> 'opens_at')::timestamptz = interval '20 s');
  v_key := pg_temp.key_of(v_g, 0);
  perform pg_temp.put('k0', v_key::text);
  v_n := jsonb_array_length(h -> 'question' -> 'options');
  r := pg_temp.st(v_g, pg_temp.tok(1));
  perform pg_temp.yes('countdown: no key, no counts, no result (player, host)', h::text !~ '"key"' and h::text !~ '"counts"' and h -> 'result' = 'null'
                      and r::text !~ '"key"' and r::text !~ '"counts"' and r -> 'result' = 'null');
  perform pg_temp.eq('unchanged in countdown', pg_temp.keys(pg_temp.st(v_g, pg_temp.tok(1), (r ->> 'rev')::bigint)), 'now,rev,unchanged');
  perform pg_temp.eq('the host too', pg_temp.keys(pg_temp.hs(v_g, v_host, (r ->> 'rev')::bigint)), 'now,rev,unchanged');
  perform pg_temp.eq('answer during the countdown', pg_temp.ans(v_g, pg_temp.tok(1), 0, v_key), 'ML004/early@400');
  perform pg_temp.eq('the host cannot skip the countdown', pg_temp.e(format('select public.live_next(%L, %L, %L)', v_g, v_host, 'countdown')), 'ML011/countdown@409');
  perform pg_temp.tick(v_g, 3.9);
  r := pg_temp.st(v_g, pg_temp.tok(1));
  perform pg_temp.eq('open by time (lazily), rev moved', (r ->> 'state') || '/' || (r ->> 'rev'), 'open/7');
  perform pg_temp.hints(v_g);
  perform pg_temp.yes('open: never unchanged', pg_temp.st(v_g, pg_temp.tok(1), 7) ? 'state');
  perform pg_temp.eq('wrong question', pg_temp.ans(v_g, pg_temp.tok(1), 1, v_key), 'ML004/bad_qi@400');
  perform pg_temp.eq('a choice out of range', pg_temp.ans(v_g, pg_temp.tok(1), 0, v_n), '22023/choice@400');
  r := public.live_answer(v_g, pg_temp.tok(1), 0, v_key);
  perform pg_temp.eq('the ack has no key or correctness', pg_temp.keys(r) || '/' || (r ->> 'answered'), 'accepted,answered,now/1');
  perform pg_temp.eq('twice', pg_temp.ans(v_g, pg_temp.tok(1), 0, v_key), 'ML004/twice@400');
  perform pg_temp.hints(v_g);
  perform pg_temp.tick(v_g, 1.1);
  perform pg_temp.eq('P2 right at 2000 ms', pg_temp.ans(v_g, pg_temp.tok(2), 0, v_key), 'ok');
  h := pg_temp.hs(v_g, v_host);
  r := pg_temp.st(v_g, pg_temp.tok(1));
  perform pg_temp.yes('open: the host sees who answered, nobody sees the key or counts',
    h ->> 'state' = 'open' and h -> 'answered_ids' = jsonb_build_array(pg_temp.c('p1'), pg_temp.c('p2')) and (h ->> 'answered') = '2'
    and h::text !~ '"key"' and h::text !~ '"counts"' and r::text !~ '"key"' and r::text !~ '"counts"'
    and (r -> 'me' ->> 'choice') = v_key::text and (r ->> 'answered') = '2');
  perform pg_temp.eq('roster answered flags', (select string_agg((x ->> 'answered'), ',' order by x ->> 'name') from jsonb_array_elements(h -> 'roster') x), 'true,true,false');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the stored times', (select string_agg(elapsed_ms::text, ',' order by elapsed_ms) from public.live_answers where game_id = v_g and qi = 0), '900,2000');
  perform pg_temp.eq('nothing judged before the close', (select count(*)::text from public.live_answers where game_id = v_g and (correct is not null or dmg is not null)), '0');
  perform pg_temp.who('anon');
  v_rev := (h ->> 'rev')::bigint;
  perform pg_temp.eq('P3 wrong: everyone answered, the question closes at once', pg_temp.ans(v_g, pg_temp.tok(3), 0, (v_key + 1) % v_n), 'ok');
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('reveal at once', (h ->> 'state') || '/' || ((h ->> 'rev')::bigint - v_rev), 'reveal/1');
  perform pg_temp.eq('host result keys', pg_temp.keys(h -> 'result'), 'counts,frozen_now,healed,hits,key,phase_changed,qi,right,thawed');
  perform pg_temp.eq('hits in order of time: 98 then 95', (h -> 'result' -> 'hits')::text,
    jsonb_build_array(jsonb_build_object('dmg', 98, 'hp_after', 397, 'player_id', pg_temp.c('p1')),
                      jsonb_build_object('dmg', 95, 'hp_after', 302, 'player_id', pg_temp.c('p2')))::text);
  perform pg_temp.eq('the key leaves now', h -> 'result' ->> 'key', v_key::text);
  perform pg_temp.eq('counts', (h -> 'result' -> 'counts' ->> v_key) || '/' || (h -> 'result' -> 'counts' ->> ((v_key + 1) % v_n)) || '/' || (h -> 'result' ->> 'right'), '2/1/2');
  perform pg_temp.eq('frozen now: P3; phase 1 entered (302 ≤ ⅔ of 495)', (h -> 'result' -> 'frozen_now')::text || '/' || (h -> 'result' ->> 'phase_changed') || '/' || (h -> 'boss')::text,
    jsonb_build_array(pg_temp.c('p3'))::text || '/1/{"hp": 302, "phase": 1, "hp_max": 495, "defeated": false}');
  r := pg_temp.st(v_g, pg_temp.tok(1));
  perform pg_temp.eq('player result keys', pg_temp.keys(r -> 'result'), 'correct,counts,dmg,frozen,healed,key,none,phase_changed,qi,right,thawed');
  perform pg_temp.eq('P1''s result', concat_ws('/', r -> 'result' ->> 'correct', r -> 'result' ->> 'dmg', r -> 'result' ->> 'none', r -> 'me' ->> 'place', r -> 'me' ->> 'streak'), 'true/98/false/1/1');
  r := pg_temp.st(v_g, pg_temp.tok(3));
  perform pg_temp.eq('P3''s result: wrong, frozen', concat_ws('/', r -> 'result' ->> 'correct', r -> 'result' ->> 'frozen', r -> 'me' ->> 'frozen', r -> 'me' ->> 'streak'), 'false/true/true/0');
  perform pg_temp.eq('no top in reveal', r ->> 'top', null);
  perform pg_temp.eq('unchanged in reveal', pg_temp.keys(pg_temp.st(v_g, pg_temp.tok(3), (r ->> 'rev')::bigint)), 'now,rev,unchanged');
  perform pg_temp.eq('an answer after the close', pg_temp.ans(v_g, pg_temp.tok(1), 0, v_key), 'ML004/not_open@400');
  perform pg_temp.yes('hints: {rev, state} only, event hint, public channel',
    (select bool_and(pg_temp.keys(x -> 'payload') = 'rev,state' and x ->> 'event' = 'hint' and x ->> 'private' = 'false')
       from jsonb_array_elements(pg_temp.hints(v_g)) x)
    and (select (x -> 'payload')::text from jsonb_array_elements(pg_temp.hints(v_g)) x order by (x -> 'payload' ->> 'rev')::bigint desc limit 1)
        = jsonb_build_object('rev', (h ->> 'rev')::bigint, 'state', 'reveal')::text);
  perform pg_temp.eq('one hint per change, none for answers', (select string_agg((x -> 'payload' ->> 'state') || ':' || (x -> 'payload' ->> 'rev'), ',')
                                                                  from jsonb_array_elements(pg_temp.hints(v_g)) x), 'lobby:5,countdown:6,open:7,reveal:8');
  h := public.live_next(v_g, v_host, 'reveal');
  perform pg_temp.eq('leaderboard: top five with moves 0 after question 0', (h -> 'top')::text,
    jsonb_build_array(jsonb_build_object('dmg', 98, 'look', v_dima, 'move', 0, 'name', 'Дима', 'player_id', pg_temp.c('p1')),
                      jsonb_build_object('dmg', 95, 'look', '{"hat": "phones", "body": "cloud", "eyes": "round", "colour": "orange"}'::jsonb, 'move', 0, 'name', 'Боря', 'player_id', pg_temp.c('p2')),
                      jsonb_build_object('dmg', 0, 'look', '{"hat": "bow", "body": "bean", "eyes": "one", "colour": "teal"}'::jsonb, 'move', 0, 'name', 'Лена', 'player_id', pg_temp.c('p3')))::text);
  perform pg_temp.eq('a double click', pg_temp.e(format('select public.live_next(%L, %L, %L)', v_g, v_host, 'reveal')), 'ML011/leaderboard@409');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 5. G1 question 1 (phase 1): streak ×1.25, a thaw, no answer freezes, the grace, the late answer, moves, 30 s ───
do $t$
declare r jsonb; h jsonb; v_g uuid := pg_temp.g('g1'); v_host text := pg_temp.c('g1_host'); v_key integer; v_n integer;
begin
  perform pg_temp.who('anon');
  h := public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.eq('question 1 keeps the phase of its countdown', (h ->> 'qi') || '/' || (h -> 'question' ->> 'phase'), '1/1');
  v_key := pg_temp.key_of(v_g, 1);
  v_n := jsonb_array_length(h -> 'question' -> 'options');
  perform pg_temp.tick(v_g, 3.0);
  perform pg_temp.eq('P2 right at 0 ms', pg_temp.ans(v_g, pg_temp.tok(2), 1, v_key), 'ok');
  perform pg_temp.eq('P3 (frozen) right', pg_temp.ans(v_g, pg_temp.tok(3), 1, v_key), 'ok');
  perform pg_temp.tick(v_g, 21.0);
  perform pg_temp.eq('within the grace the question is open', pg_temp.hs(v_g, v_host) ->> 'state', 'open');
  perform pg_temp.tick(v_g, 0.6);
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('closed by time', h ->> 'state', 'reveal');
  perform pg_temp.eq('P1 too late', pg_temp.ans(v_g, pg_temp.tok(1), 1, v_key), 'ML004/late@400');
  perform pg_temp.eq('hits: 125 (streak 2)', (h -> 'result' -> 'hits')::text,
                     jsonb_build_array(jsonb_build_object('dmg', 125, 'hp_after', 177, 'player_id', pg_temp.c('p2')))::text);
  perform pg_temp.eq('thawed P3, frozen P1 for no answer (phase 1)',
                     (h -> 'result' -> 'thawed')::text || '/' || (h -> 'result' -> 'frozen_now')::text || '/' || coalesce(h -> 'result' ->> 'phase_changed', '-'),
                     jsonb_build_array(pg_temp.c('p3'))::text || '/' || jsonb_build_array(pg_temp.c('p1'))::text || '/-');
  r := pg_temp.st(v_g, pg_temp.tok(1));
  perform pg_temp.eq('P1: none, frozen', concat_ws('/', r -> 'result' ->> 'none', r -> 'result' ->> 'frozen', r -> 'me' ->> 'streak', coalesce(r -> 'me' ->> 'choice', '-')), 'true/true/0/-');
  r := pg_temp.st(v_g, pg_temp.tok(3));
  perform pg_temp.eq('P3: thawed without damage, streak 1', concat_ws('/', r -> 'result' ->> 'thawed', r -> 'result' ->> 'dmg', r -> 'me' ->> 'frozen', r -> 'me' ->> 'streak'), 'true/0/false/1');
  perform pg_temp.tick(v_g, 30);
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('the server moved on after 30 s', h ->> 'state', 'leaderboard');
  perform pg_temp.eq('moves: P2 up one, P1 down one', (select string_agg((x ->> 'name') || ':' || (x ->> 'move'), ',') from jsonb_array_elements(h -> 'top') x), 'Боря:1,Дима:-1,Лена:0');
  perform pg_temp.tick(v_g, 30);
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('and again after 30 s: countdown of question 2', (h ->> 'state') || '/' || (h ->> 'qi') || '/' || (h -> 'question' ->> 'phase'), 'countdown/2/1');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 6. G1 question 2 (the last): an answer in the grace counts at the time limit (75), phase 2, podium, review ───
do $t$
declare r jsonb; h jsonb; v_g uuid := pg_temp.g('g1'); v_host text := pg_temp.c('g1_host'); v_key integer; v_n integer;
begin
  perform pg_temp.who('anon');
  v_key := pg_temp.key_of(v_g, 2);
  v_n := jsonb_array_length(pg_temp.hs(v_g, v_host) -> 'question' -> 'options');
  perform pg_temp.tick(v_g, 3.5);
  perform pg_temp.eq('P1 (frozen) right: thaw', pg_temp.ans(v_g, pg_temp.tok(1), 2, v_key), 'ok');
  perform pg_temp.eq('P3 wrong', pg_temp.ans(v_g, pg_temp.tok(3), 2, (v_key + 1) % v_n), 'ok');
  perform pg_temp.tick(v_g, 20.5);
  perform pg_temp.eq('P2 in the grace (1 s after the close)', pg_temp.ans(v_g, pg_temp.tok(2), 2, v_key), 'ok');
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('elapsed capped at the limit: 75 (streak 3, time 20 000 ms)', (h -> 'result' -> 'hits')::text,
                     jsonb_build_array(jsonb_build_object('dmg', 75, 'hp_after', 102, 'player_id', pg_temp.c('p2')))::text);
  perform pg_temp.eq('phase 2 entered', (h -> 'result' ->> 'phase_changed') || '/' || (h -> 'boss' ->> 'phase') || '/' || (h -> 'result' ->> 'healed'), '2/2/0');
  h := public.live_next(v_g, v_host, 'reveal');
  perform pg_temp.eq('the last question → podium; the class lost', (h ->> 'state') || '/' || (h -> 'final')::text, 'podium/' || '{"won": false, "accuracy_pct": 67}'::jsonb::text);
  perform pg_temp.eq('podium top', (select string_agg((x ->> 'name') || ':' || (x ->> 'dmg'), ',') from jsonb_array_elements(h -> 'top') x), 'Боря:295,Дима:98,Лена:0');
  perform pg_temp.eq('no question at the podium', h ->> 'question', null);
  r := pg_temp.st(v_g, pg_temp.tok(2));
  perform pg_temp.eq('final keys', pg_temp.keys(r -> 'final'), 'accuracy_pct,best,dmg,place,right,unlocked_now,won');
  perform pg_temp.eq('D''s final: first, the crown', (r -> 'final')::text,
                     '{"won": false, "dmg": 295, "best": 3, "place": 1, "right": 3, "accuracy_pct": 67, "unlocked_now": ["crown"]}'::jsonb::text);
  r := pg_temp.st(v_g, pg_temp.tok(1));
  perform pg_temp.eq('a guest opens nothing', (r -> 'final')::text,
                     '{"won": false, "dmg": 98, "best": 1, "place": 2, "right": 2, "accuracy_pct": 67, "unlocked_now": []}'::jsonb::text);
  perform pg_temp.eq('a new player at the podium', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', pg_temp.c('g1_pin'), 'Поздний', pg_temp.tok(9))), 'ML002/ended@400');
  perform pg_temp.eq('a player rejoins at the podium', public.live_join(pg_temp.c('g1_pin'), 'Дима', pg_temp.tok(1), null) ->> 'player_id', pg_temp.c('p1'));
  r := public.live_review(v_g, pg_temp.tok(1));
  perform pg_temp.eq('review item keys', pg_temp.keys(r -> 'items' -> 0), 'choice,correct,key,options,qi,text');
  perform pg_temp.eq('review: own answers and the keys of the played questions',
    (select string_agg(concat_ws(':', x ->> 'qi', x ->> 'key', coalesce(x ->> 'choice', '-'), x ->> 'correct'), ',') from jsonb_array_elements(r -> 'items') x),
    concat_ws(',', '0:' || pg_temp.c('k0') || ':' || pg_temp.c('k0') || ':true', '1:' || pg_temp.key_of(v_g, 1) || ':-:false', '2:' || v_key || ':' || v_key || ':true'));
  h := public.live_next(v_g, v_host, 'podium');
  perform pg_temp.eq('podium → ended; the final stays', (h ->> 'state') || '/' || (h -> 'final' ->> 'accuracy_pct'), 'ended/67');
  perform pg_temp.eq('ended: next refused', pg_temp.e(format('select public.live_next(%L, %L, %L)', v_g, v_host, 'ended')), 'ML011/ended@409');
  perform pg_temp.eq('ended: answers refused', pg_temp.ans(v_g, pg_temp.tok(1), 2, v_key), 'ML004/late@400');
  perform pg_temp.eq('ended: the review stays', jsonb_array_length(public.live_review(v_g, pg_temp.tok(3)) -> 'items')::text, '3');
  perform pg_temp.eq('ended: a join says ended', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', pg_temp.c('g1_pin'), 'Поздний', pg_temp.tok(9))), 'ML002/ended@400');
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004');
  perform pg_temp.eq('D''s wardrobe', public.live_wardrobe()::text, '{"look": null, "wins": 0, "games": 1, "unlocked": ["crown"]}'::jsonb::text);
  perform pg_temp.eq('D may wear the crown now', public.live_wardrobe_set('{"body":"drop","colour":"blue","eyes":"dots","hat":"crown"}') -> 'look' ->> 'hat', 'crown');
  perform pg_temp.eq('but not snow', pg_temp.e($$select public.live_wardrobe_set('{"body":"drop","colour":"snow","eyes":"dots","hat":"crown"}')$$), 'ML007/locked@400');
  perform pg_temp.who('anon');
  perform pg_temp.eq('the wardrobe needs an account', pg_temp.e('select public.live_wardrobe()'), '28000/@401');
  perform pg_temp.tick(v_g, 7 * 86400 + 1);
  perform pg_temp.eq('after 7 days no review', pg_temp.e(format('select public.live_review(%L, %L)', v_g, pg_temp.tok(1))), 'ML002/expired@400');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 7. G2: late joiners, the kick, the heal of phase 2, the host's end ───
do $t$
declare r jsonb; h jsonb; v_g uuid; v_host text; v_pin text; v_key integer; v_n integer;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 4}', pg_temp.c('x'), pg_temp.c('xs'))::jsonb, '{}');
  v_g := (r ->> 'game_id')::uuid; v_host := r ->> 'host_token'; v_pin := r ->> 'pin';
  perform pg_temp.put('g2', v_g::text);
  perform pg_temp.who('anon');
  perform public.live_join(v_pin, 'Аня', pg_temp.tok(31), null);
  perform public.live_join(v_pin, 'Ваня', pg_temp.tok(32), null);
  perform pg_temp.put('katya', public.live_join(v_pin, 'Катя', pg_temp.tok(33), null) ->> 'player_id');
  h := public.live_next(v_g, v_host, 'lobby');
  perform pg_temp.eq('HP 3 × 4 × 55', h -> 'boss' ->> 'hp_max', '660');
  r := public.live_join(v_pin, 'Ранний', pg_temp.tok(34), null);
  perform pg_temp.put('l1', r ->> 'player_id');
  perform pg_temp.eq('joined during the countdown: + 55 × 4 questions not opened', pg_temp.hs(v_g, v_host) -> 'boss' ->> 'hp_max', '880');
  perform pg_temp.tick(v_g, 3.5);
  r := public.live_join(v_pin, 'Поздний', pg_temp.tok(35), null);
  perform pg_temp.eq('joined during open: + 55 × 3', pg_temp.hs(v_g, v_host) -> 'boss' ->> 'hp', '1045');
  perform pg_temp.eq('a joiner after the opening cannot answer it', pg_temp.ans(v_g, pg_temp.tok(35), 0, 0), 'ML004/not_joined_yet@400');
  v_key := pg_temp.key_of(v_g, 0);
  perform pg_temp.eq('Аня right', pg_temp.ans(v_g, pg_temp.tok(31), 0, v_key), 'ok');
  perform pg_temp.eq('Ваня right', pg_temp.ans(v_g, pg_temp.tok(32), 0, v_key), 'ok');
  perform pg_temp.eq('Ранний right', pg_temp.ans(v_g, pg_temp.tok(34), 0, v_key), 'ok');
  perform pg_temp.eq('still open (Катя)', pg_temp.hs(v_g, v_host) ->> 'state', 'open');
  perform pg_temp.eq('kick of an unknown player', pg_temp.e(format('select public.live_kick(%L, %L, %L)', v_g, v_host, gen_random_uuid())), 'P0002/player@404');
  perform pg_temp.eq('kick with a player''s token', pg_temp.e(format('select public.live_kick(%L, %L, %L)', v_g, pg_temp.tok(31), pg_temp.c('l1'))), '42501/host@403');
  perform pg_temp.eq('the kick', (public.live_kick(v_g, v_host, pg_temp.g('katya')))::text, '{"ok": true}');
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('the kick closed the question: everyone left had answered', (h ->> 'state') || '/' || jsonb_array_length(h -> 'result' -> 'hits') || '/' || (h ->> 'players'), 'reveal/3/4');
  perform pg_temp.eq('the kicked token is dead', pg_temp.e(format('select public.live_state(%L, %L, null)', v_g, pg_temp.tok(33))), '42501/kicked@403');
  perform pg_temp.eq('the kicked cannot come back', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', v_pin, 'Катя', pg_temp.tok(33))), '42501/kicked@403');
  perform pg_temp.eq('not in the roster', (select count(*)::text from jsonb_array_elements(h -> 'roster') x where x ->> 'name' = 'Катя'), '0');
  r := pg_temp.st(v_g, pg_temp.tok(35));
  perform pg_temp.eq('the late joiner: none, not frozen for that question', (r -> 'result' ->> 'none') || '/' || (r -> 'me' ->> 'frozen'), 'true/false');
  -- Phase 2 by hand: hp 200 of 1045 before the next countdown; 4 active, 3 right needed, 1 right → heal round(52.25) = 52.
  perform public.live_next(v_g, v_host, 'reveal');
  perform pg_temp.who('postgres');
  update public.live_games set hp = 200, phase = 2 where id = v_g;
  perform pg_temp.who('anon');
  h := public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.eq('question 1 opens in phase 2', h -> 'question' ->> 'phase', '2');
  v_key := pg_temp.key_of(v_g, 1);
  perform pg_temp.tick(v_g, 3.0);
  perform pg_temp.eq('Аня right at 0 ms, streak 2', pg_temp.ans(v_g, pg_temp.tok(31), 1, v_key), 'ok');
  perform pg_temp.tick(v_g, 21.6);
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('heal: 200 − 125 + 52', concat_ws('/', h -> 'result' ->> 'healed', h -> 'boss' ->> 'hp', h -> 'boss' ->> 'phase', coalesce(h -> 'result' ->> 'phase_changed', '-')), '52/127/2/-');
  perform pg_temp.eq('no answer in phase 2 freezes (3 players)', jsonb_array_length(h -> 'result' -> 'frozen_now')::text, '3');
  perform pg_temp.eq('the host ends the game', (public.live_end(v_g, v_host))::text, '{"ok": true}');
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('ended by the host: no final (not played to the end)', (h ->> 'state') || '/' || coalesce(h ->> 'final', '-'), 'ended/-');
  perform pg_temp.eq('ending again is fine', (public.live_end(v_g, v_host))::text, '{"ok": true}');
  r := public.live_review(v_g, pg_temp.tok(31));
  perform pg_temp.eq('review: only the closed questions (2 of 4)', (select string_agg(x ->> 'qi', ',') from jsonb_array_elements(r -> 'items') x), '0,1');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('end reason', (select end_reason from public.live_games where id = v_g), 'host');
end
$t$;

-- ─── 8. G3: one hint per transaction (a cascade), no answer in phase 0, the defeat before the last question, E wins ───
do $t$
declare r jsonb; h jsonb; v_g uuid; v_host text; v_pin text; v_key integer; v_before integer; v_rev bigint;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xs'))::jsonb, '{"speed": false}');
  v_g := (r ->> 'game_id')::uuid; v_host := r ->> 'host_token'; v_pin := r ->> 'pin';
  perform pg_temp.who('authenticated', 'eeeeeeee-0000-0000-0000-000000000005');
  perform public.live_join(v_pin, 'Ева', pg_temp.tok(41), null);
  perform pg_temp.who('anon');
  perform public.live_join(v_pin, 'Гость', pg_temp.tok(42), null);
  h := public.live_next(v_g, v_host, 'lobby');
  v_before := jsonb_array_length(pg_temp.hints(v_g));
  v_rev := (h ->> 'rev')::bigint;
  perform pg_temp.tick(v_g, 3 + 20 + 1.6);
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('countdown → open → reveal in one read: rev + 2', (h ->> 'state') || '/' || ((h ->> 'rev')::bigint - v_rev), 'reveal/2');
  r := pg_temp.hints(v_g);
  perform pg_temp.eq('one hint for that transaction, with the last rev and state', (jsonb_array_length(r) - v_before) || '/' || (r -> -1 -> 'payload')::text,
                     '1/' || jsonb_build_object('rev', v_rev + 2, 'state', 'reveal')::text);
  perform pg_temp.eq('no answer in phase 0: nobody frozen', (h -> 'result' -> 'frozen_now')::text || '/' || (select string_agg(x ->> 'frozen', ',') from jsonb_array_elements(h -> 'roster') x), '[]/false,false');
  perform public.live_next(v_g, v_host, 'reveal');
  perform public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.who('postgres');
  update public.live_games set hp = 120 where id = v_g;
  perform pg_temp.who('anon');
  v_key := pg_temp.key_of(v_g, 1);
  perform pg_temp.tick(v_g, 4);
  perform pg_temp.eq('Ева right (speed off: 100)', pg_temp.ans(v_g, pg_temp.tok(41), 1, v_key), 'ok');
  perform pg_temp.tick(v_g, 0.5);
  perform pg_temp.eq('Гость right', pg_temp.ans(v_g, pg_temp.tok(42), 1, v_key), 'ok');
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('the boss falls; the second hit still counts', (select string_agg((x ->> 'dmg') || '→' || (x ->> 'hp_after'), ',') from jsonb_array_elements(h -> 'result' -> 'hits') x)
                     || '/' || (h -> 'boss' ->> 'defeated') || '/' || (h -> 'result' ->> 'phase_changed'), '100→20,100→0/true/2');
  h := public.live_next(v_g, v_host, 'reveal');
  perform pg_temp.eq('defeated → podium before the last question; won', (h ->> 'state') || '/' || (h -> 'final' ->> 'won'), 'podium/true');
  perform pg_temp.who('authenticated', 'eeeeeeee-0000-0000-0000-000000000005');
  perform pg_temp.eq('E: a game and a win', (public.live_wardrobe() ->> 'games') || '/' || (public.live_wardrobe() ->> 'wins'), '1/1');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 9. Members only, and the bot (service role): join with the launch rules, post, posted, sync, pg_net ───
do $t$
declare r jsonb; h jsonb; v_g uuid; v_host text; v_pin text; v_g6 uuid; v_host6 text; v_pin6 text; v_e uuid; v_pid text; v_tok text := repeat('L', 43);
        v_eva jsonb := meldy_private.live_default_look('Ева');
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xs'))::jsonb, '{"who": "members"}');
  v_g := (r ->> 'game_id')::uuid; v_host := r ->> 'host_token'; v_pin := r ->> 'pin';
  perform pg_temp.who('postgres');
  insert into public.container_members (container_id, user_id) values (pg_temp.g('x'), 'eeeeeeee-0000-0000-0000-000000000005');
  perform pg_temp.who('anon');
  perform pg_temp.eq('members only: a guest', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', v_pin, 'Гость', pg_temp.tok(51))), 'ML003/members@403');
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004');
  perform pg_temp.eq('members only: not a member', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', v_pin, 'Боря', pg_temp.tok(52))), 'ML003/members@403');
  perform pg_temp.who('authenticated', 'eeeeeeee-0000-0000-0000-000000000005');
  r := public.live_join(v_pin, 'Ева', pg_temp.tok(53), null);
  v_e := (r ->> 'player_id')::uuid;
  perform pg_temp.eq('a member joins; no look saved: the name''s', (r -> 'wardrobe' ->> 'wins') || '/' || (r -> 'look')::text, '1/' || v_eva::text);
  -- The bot.
  perform pg_temp.who('anon');
  perform pg_temp.eq('bot_live_join is the service role''s', split_part(pg_temp.e(format('select public.bot_live_join(%L, 777, %L, null, %L, %L, now())', v_pin, 'Тг', repeat('a', 64), repeat('b', 64))), '/', 1), '42501');
  perform pg_temp.who('service_role');
  perform pg_temp.eq('bot: unknown pin', public.bot_live_join('999999', 777, 'Тг', null, repeat('a', 64), repeat('1', 64), now()) ->> 'status', 'not_found');
  perform pg_temp.eq('bot: an unlinked Telegram on a members game', public.bot_live_join(v_pin, 999, 'Тг', null, repeat('a', 64), repeat('2', 64), now()) ->> 'status', 'members_only');
  perform pg_temp.who('postgres');
  insert into bot.links (user_id, tg_user_id, chat_id) values ('eeeeeeee-0000-0000-0000-000000000005', 888, 888);
  perform pg_temp.who('service_role');
  r := public.bot_live_join(v_pin, 888, 'Ева из Телеграма', null, repeat('c', 64), repeat('3', 64), now());
  perform pg_temp.eq('a linked Telegram is its account: the same player as on the site', (r ->> 'status') || '/' || (r ->> 'player_id') || '/' || (r ->> 'name'), 'joined/' || v_e || '/Ева');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the site''s token of E is replaced', (select tg_user_id::text || '/' || (token_hash = repeat('c', 64))::text from public.live_players where id = v_e), '888/true');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform public.live_end(v_g, v_host);
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xs'))::jsonb, '{}');
  v_g6 := (r ->> 'game_id')::uuid; v_host6 := r ->> 'host_token'; v_pin6 := r ->> 'pin';
  perform pg_temp.who('service_role');
  r := public.bot_live_join(v_pin6, 777, 'Тимур', '{"body":"square","colour":"green","eyes":"glasses","hat":"cap"}', repeat('d', 64), repeat('4', 64), now());
  perform pg_temp.eq('bot join keys', pg_temp.keys(r), 'game_id,look,name,now,player_id,rev,state,status,topic,wardrobe');
  perform pg_temp.eq('a Telegram guest has a wardrobe', (r ->> 'status') || '/' || (r -> 'wardrobe')::text, 'joined/' || '{"wins": 0, "games": 0, "unlocked": []}'::jsonb::text);
  v_pid := r ->> 'player_id';
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the use is spent with purpose game', (select purpose || '/' || tg_user_id from bot.webapp_uses where init_hash = repeat('4', 64)), 'game/777');
  perform pg_temp.who('service_role');
  perform pg_temp.eq('the same launch rejoins the same game (a lost answer)', public.bot_live_join(v_pin6, 777, 'Тимур', null, repeat('e', 64), repeat('4', 64), now()) ->> 'player_id', v_pid);
  perform pg_temp.eq('the same launch for another game', public.bot_live_join(pg_temp.c('g1_pin'), 777, 'Тимур', null, repeat('f', 64), repeat('4', 64), now()) ->> 'status', 'replayed');
  perform pg_temp.eq('a rude name', public.bot_live_join(v_pin6, 778, 'Блядь', null, repeat('a', 64), repeat('5', 64), now())::text, '{"reason": "rude", "status": "name_refused"}');
  perform pg_temp.eq('a refused join does not spend the launch', public.bot_live_join(v_pin6, 778, 'Марк', null, repeat('a', 64), repeat('5', 64), now()) ->> 'status', 'joined');
  perform pg_temp.eq('a locked look', public.bot_live_join(v_pin6, 779, 'Ира', '{"body":"drop","colour":"blue","eyes":"one","hat":"horns"}', repeat('9', 64), repeat('6', 64), now())::text,
                     '{"reason": "locked", "status": "look_refused"}');
  perform pg_temp.who('postgres');
  insert into bot.webapp_uses (init_hash, purpose, tg_user_id, auth_date, used_at)
  select lpad(to_hex(n), 64, 'a'), 'game', 555, now(), now() - interval '10 minutes' from generate_series(1, 30) n;
  perform pg_temp.who('service_role');
  perform pg_temp.eq('30 joins an hour per Telegram', public.bot_live_join(v_pin6, 555, 'Лиза', null, repeat('a', 64), repeat('7', 64), now()) ->> 'status', 'slow_down');
  -- Posting into a group of the exam: the author asks the database (live_tg_post); the database calls the bot.
  perform pg_temp.who('anon');
  perform pg_temp.eq('post: signed in only', pg_temp.e(format('select public.live_tg_post(%L, -100123)', v_g6)), '28000/@401');
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004');
  perform pg_temp.eq('post: not the author', pg_temp.e(format('select public.live_tg_post(%L, -100123)', v_g6)), '42501/author@403');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('post: no game', pg_temp.e(format('select public.live_tg_post(%L, -100123)', gen_random_uuid())), 'P0002/game@404');
  perform pg_temp.eq('post: a chat not bound to the exam', pg_temp.e(format('select public.live_tg_post(%L, -100123)', v_g6)), 'P0002/group@404');
  perform pg_temp.who('postgres');
  insert into bot.groups (chat_id, container_id, owner_id, title) values (-100123, pg_temp.g('x'), 'aaaaaaaa-0000-0000-0000-000000000001', 'Группа');
  update bot.config set function_url = 'https://abcdefgh.supabase.co/functions/v1/telegram', function_region = 'eu-central-1' where id = 1;
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('post: the bot not set up (no live token)', pg_temp.e(format('select public.live_tg_post(%L, -100123)', v_g6)), 'ML010/bot@503');
  perform pg_temp.who('anon');
  perform pg_temp.eq('bot_live_setup is the service role''s', split_part(pg_temp.e(format('select public.bot_live_setup(%L)', v_tok)), '/', 1), '42501');
  perform pg_temp.who('service_role');
  perform pg_temp.eq('a bad live token', split_part(pg_temp.e('select public.bot_live_setup(''short'')'), '/', 1), '22023');
  perform pg_temp.eq('/setup keeps the live token', public.bot_live_setup(v_tok) ->> 'status', 'ok');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the live token kept for the calls', (select live_token from bot.config where id = 1), v_tok);
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('post', (public.live_tg_post(v_g6, -100123))::text, '{"status": "posting"}');
  perform pg_temp.eq('one post a minute, Retry-After', pg_temp.e(format('select public.live_tg_post(%L, -100123)', v_g6)) || ' ' || current_setting('live_test.headers'),
                     'ML005/post@429 {"Retry-After": "60"}');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the database asked the bot to post', (select string_agg(url || ' ' || (headers ->> 'x-meldy-live') || ' ' || (body ->> 'game_id'), ',') from net.calls),
                     'https://abcdefgh.supabase.co/functions/v1/telegram/game/post?forceFunctionRegion=eu-central-1 ' || v_tok || ' ' || v_g6);
  delete from net.calls;
  perform pg_temp.who('anon');
  perform pg_temp.eq('bot_live_post is the service role''s', split_part(pg_temp.e(format('select public.bot_live_post(%L)', v_g6)), '/', 1), '42501');
  perform pg_temp.who('service_role');
  r := public.bot_live_post(v_g6);
  perform pg_temp.eq('post: the facts of the text', r::text,
    jsonb_build_object('status', 'post', 'chat_id', -100123, 'title', 'Живая игра', 'q_count', 3, 'host', 'Автор А', 'pin', v_pin6, 'players', 2, 'direct', false)::text);
  perform pg_temp.eq('a retried call finds the post taken', public.bot_live_post(v_g6) ->> 'status', 'skip');
  perform pg_temp.eq('no game: skip', public.bot_live_post(gen_random_uuid()) ->> 'status', 'skip');
  perform pg_temp.eq('posted', public.bot_live_posted(v_g6, -100123, 555) ->> 'status', 'ok');
  perform pg_temp.eq('sync right after the post: skip', public.bot_live_sync(v_g6) ->> 'status', 'skip');
  perform pg_temp.who('anon');
  perform public.live_join(v_pin6, 'Новенький', pg_temp.tok(61), null);
  perform pg_temp.hints(v_g6);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('a lobby join within 5 s of the last sync: no call', (select count(*)::text from net.calls), '0');
  perform pg_temp.who('anon');
  perform public.live_next(v_g6, v_host6, 'lobby');
  perform pg_temp.hints(v_g6);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the countdown asked the bot to edit', (select url || ' ' || (headers ->> 'x-meldy-live') || ' ' || (body ->> 'game_id') from net.calls),
                     'https://abcdefgh.supabase.co/functions/v1/telegram/game/sync?forceFunctionRegion=eu-central-1 ' || v_tok || ' ' || v_g6);
  perform pg_temp.tick(v_g6, 3.1);
  perform pg_temp.who('service_role');
  r := public.bot_live_sync(v_g6);
  perform pg_temp.eq('sync facts', r::text, jsonb_build_object('status', 'edit', 'chat_id', -100123, 'message_id', 555, 'state', 'open', 'players', 3,
    'qi', 0, 'q_count', 3, 'hp_pct', 100, 'title', 'Живая игра', 'pin', v_pin6, 'host', 'Автор А', 'direct', false, 'final', null)::text);
  perform pg_temp.eq('no key and no per-question result for the chat', (r::text ~ '"key"' or r::text ~ '"counts"')::text, 'false');
  perform pg_temp.eq('one edit per 3 s', public.bot_live_sync(v_g6) ->> 'status', 'skip');
  perform pg_temp.who('anon');
  perform public.live_end(v_g6, v_host6);
  perform pg_temp.hints(v_g6);
  perform pg_temp.tick(v_g6, 1.1);
  perform pg_temp.who('service_role');
  r := public.bot_live_sync(v_g6);
  perform pg_temp.eq('the end edits (1 s after the last edit); no final post without a podium', (r ->> 'state') || '/' || coalesce(r ->> 'final', '-'), 'ended/-');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the end is synced once', (select count(*)::text from net.calls where url like '%game/sync%'), '2');
  perform pg_temp.who('anon');
  perform pg_temp.eq('anon may not call the bot''s sync', split_part(pg_temp.e(format('select public.bot_live_sync(%L)', v_g6)), '/', 1), '42501');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 10. Limits (author C): 3 open games, 300 players, 120 joins a minute per game and per address, 3 hours, 10 creates ───
do $t$
declare r jsonb; v_src jsonb := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('y'), pg_temp.c('ys'))::jsonb;
        v_g uuid[] := '{}'; v_h text[] := '{}'; v_p text[] := '{}'; v_n integer; v_out text;
begin
  perform pg_temp.who('authenticated', 'cccccccc-0000-0000-0000-000000000003');
  for i in 1 .. 3 loop
    r := public.live_create(v_src, '{}');
    v_g := v_g || (r ->> 'game_id')::uuid; v_h := v_h || (r ->> 'host_token'); v_p := v_p || (r ->> 'pin');
  end loop;
  perform pg_temp.eq('pins differ', (select count(distinct x)::text from unnest(v_p) x), '3');
  perform pg_temp.eq('a 4th open game', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{}')), 'ML009/@400');
  -- 300 players (joined two minutes ago) → full.
  perform pg_temp.who('postgres');
  insert into public.live_players (game_id, token_hash, guest_hash, name, look, joined_at)
  select v_g[1], h, h, 'И' || n, '{}', now() - interval '2 minutes'
    from (select n, encode(sha256(convert_to('full' || n, 'UTF8')), 'hex') h from generate_series(1, 300) n) x;
  insert into public.live_players (game_id, token_hash, guest_hash, name, look, joined_at)
  select v_g[2], h, h, 'И' || n, '{}', now()
    from (select n, encode(sha256(convert_to('busy' || n, 'UTF8')), 'hex') h from generate_series(1, 120) n) x;
  perform pg_temp.who('anon');
  perform pg_temp.eq('300 players', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', v_p[1], 'Ещё', pg_temp.tok(70))), 'ML001/@400');
  perform pg_temp.eq('120 joins a minute on a game', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', v_p[2], 'Ещё', pg_temp.tok(70))), 'ML005/join@429');
  perform pg_temp.eq('… with a short Retry-After (the oldest join leaves the minute)', current_setting('live_test.headers'), '{"Retry-After": "60"}');
  -- 120 joins a minute from one address (a class behind one school NAT): the 121st is refused. The players are then
  -- moved a minute back (the game's own limit out of the way); the address's joins stay in the minute.
  for i in 1 .. 120 loop
    perform pg_temp.who('anon', null, '203.0.113.7');
    perform public.live_join(v_p[3], 'Игрок ' || i, pg_temp.tok(100 + i), null);
  end loop;
  perform pg_temp.who('postgres');
  update public.live_players set joined_at = joined_at - interval '61 s' where game_id = v_g[3];
  perform pg_temp.who('anon', null, '203.0.113.7');
  perform pg_temp.eq('the 121st from the address', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', v_p[3], 'Ещё', pg_temp.tok(300))), 'ML005/join@429');
  perform pg_temp.eq('… with Retry-After', current_setting('live_test.headers'), '{"Retry-After": "60"}');
  perform pg_temp.who('anon', null, '198.51.100.9');
  perform pg_temp.eq('another address passes', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', v_p[3], 'Ещё', pg_temp.tok(300))), 'ok');
  perform pg_temp.who('postgres');
  perform pg_temp.yes('the throttle keeps HMACs, never the address', (select count(*) = 121 and bool_and(ip_hash ~ '^[0-9a-f]{64}$') from meldy_private.live_join_hits)
                      and not exists (select 1 from meldy_private.live_join_hits where ip_hash like '%203.0.113%'));
  perform pg_temp.tick(v_g[3], 20);
  update meldy_private.live_join_hits set at = at - interval '20 s';
  perform pg_temp.who('anon', null, '203.0.113.7');
  perform pg_temp.eq('20 s later: Retry-After 40', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', v_p[3], 'Ещё', pg_temp.tok(301))) || ' '
                     || current_setting('live_test.headers'), 'ML005/join@429 {"Retry-After": "40"}');
  perform pg_temp.who('postgres');
  -- The PIN's 3 hours.
  perform pg_temp.tick(v_g[3], 3 * 3600 + 1);
  perform pg_temp.who('anon', null, '192.0.2.1');
  perform pg_temp.eq('3 h after create: no joins', pg_temp.e(format('select public.live_join(%L, %L, %L, null)', v_p[3], 'Поздно', pg_temp.tok(201))), 'ML002/expired@400');
  perform pg_temp.eq('the expired game ended itself', (pg_temp.hs(v_g[3], v_h[3]) ->> 'state'), 'ended');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('end reason expired', (select end_reason from public.live_games where id = v_g[3]), 'expired');
  -- 10 creates an hour (the expired game was made «3 h ago» by the time machine: 2 of C's games are in the hour).
  perform pg_temp.who('authenticated', 'cccccccc-0000-0000-0000-000000000003');
  v_n := 2;
  loop
    v_out := pg_temp.e(format('select public.live_end((x ->> %L)::uuid, x ->> %L) from (select public.live_create(%L, %L) x) y', 'game_id', 'host_token', v_src, '{}'));
    exit when v_out <> 'ok' or v_n > 20;
    v_n := v_n + 1;
  end loop;
  perform pg_temp.eq('the 11th create in an hour', v_n || ' ' || v_out, '10 ML005/create@429');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 11. Nothing for the API roles but the functions ───
do $t$
begin
  perform pg_temp.who('anon');
  perform pg_temp.eq('anon reads no game', split_part(pg_temp.e('select count(*) from public.live_games'), '/', 1), '42501');
  perform pg_temp.eq('anon reads no question', split_part(pg_temp.e('select key from public.live_questions'), '/', 1), '42501');
  perform pg_temp.eq('anon calls no helper', split_part(pg_temp.e('select meldy_private.live_damage(1, 20, 1, true)'), '/', 1), '42501');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('the author reads no question either', split_part(pg_temp.e('select key from public.live_questions'), '/', 1), '42501');
  perform pg_temp.eq('nor answers', split_part(pg_temp.e('select * from public.live_answers'), '/', 1), '42501');
  perform pg_temp.who('postgres');
end
$t$;

rollback;
\echo LIVE GAME BEHAVIOUR PASSED
