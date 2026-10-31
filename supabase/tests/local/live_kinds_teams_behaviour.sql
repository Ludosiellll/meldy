-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261102090000_live_kinds_teams.sql on the
-- scratch database of live_game_run.sh, after the wide rounds step: questions of several right answers and text answers
-- in a battle (the share, the partial hit, the tops of a text question, every refusal of live_submit), in two teams (the
-- balanced join, the standings by the average), the review with the explanations, «Тренировать ошибки» (live_practice:
-- who may, what it records, a second press), a battle with movement rounds (choice questions on the rounds, a movement
-- round of several right answers: every right zone counts) and «Встань на ответ» (no text answers). One transaction,
-- rolled back; now() is one moment inside it, so time moves by a time machine (pg_temp.tick). A failure raises; success
-- prints LIVE KINDS TEAMS BEHAVIOUR PASSED.
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

-- ─── 1. Exam K: one right answer, several, text answers (with explanations), one never played ───
do $t$
declare r jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.container_create('Виды вопросов', null, '[{"title":"Всё"},{"title":"Только текст"},{"title":"Несколько"}]');
  perform pg_temp.put('k', r ->> 'container_id');
  perform pg_temp.put('ks', r -> 'subjects' -> 0 ->> 'id');
  perform pg_temp.put('kt', r -> 'subjects' -> 1 ->> 'id');
  perform pg_temp.put('km', r -> 'subjects' -> 2 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'k:1', 'stem', 'Один верный', 'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct', jsonb_build_array(2)),
    jsonb_build_object('ref', 'k:2', 'stem', 'Две верных', 'kind', 'multiple', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e'),
                       'correct', jsonb_build_array(0, 2), 'explanation', 'Гласные: a и c'),
    jsonb_build_object('ref', 'k:3', 'stem', 'Три верных', 'kind', 'multiple', 'options', jsonb_build_array('1', '2', '3', '4', '5', '6'),
                       'correct', jsonb_build_array(1, 3, 5)),
    jsonb_build_object('ref', 'k:4', 'stem', 'Столица России', 'kind', 'short', 'answers', jsonb_build_array('Москва', 'г. Москва'),
                       'explanation', 'Москва — столица с 1918 года'),
    jsonb_build_object('ref', 'k:5', 'stem', 'Ответ на главный вопрос', 'kind', 'short', 'answers', jsonb_build_array('42')),
    jsonb_build_object('ref', 'k:6', 'stem', 'Семь вариантов', 'options', jsonb_build_array('1', '2', '3', '4', '5', '6', '7'), 'correct', jsonb_build_array(0))));
  perform public.container_items_add((r -> 'subjects' -> 1 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 't:1', 'stem', 'Текст один', 'kind', 'short', 'answers', jsonb_build_array('да')),
    jsonb_build_object('ref', 't:2', 'stem', 'Текст два', 'kind', 'short', 'answers', jsonb_build_array('нет'))));
  perform public.container_items_add((r -> 'subjects' -> 2 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'm:1', 'stem', 'Углы квадрата', 'kind', 'multiple', 'options', jsonb_build_array('А', 'Б', 'В', 'Г'),
                       'correct', jsonb_build_array(0, 3))));
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 2. The pure rules ───
do $t$
declare v uuid[] := array['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003',
                          '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000006']::uuid[];
begin
  perform pg_temp.eq('share: the exact set', meldy_private.live_share('{0,2}', '{0,2}')::text, '1');
  perform pg_temp.eq('share: one of two', meldy_private.live_share('{2}', '{0,2}')::text, '0.5');
  perform pg_temp.eq('share: one right one wrong', meldy_private.live_share('{0,1}', '{0,2}')::text, '0');
  perform pg_temp.eq('share: never below 0', meldy_private.live_share('{1,3,4}', '{0,2}')::text, '0');
  perform pg_temp.eq('share: two of three, one wrong', meldy_private.live_share('{1,3,0}', '{1,3,5}')::text, (1.0 / 3)::double precision::text);
  perform pg_temp.eq('share: all six ticked', meldy_private.live_share('{0,1,2,3,4,5}', '{1,3,5}')::text, '0');
  perform pg_temp.eq('arrange: no movement rounds, as drawn', meldy_private.live_arrange(v[1:3], '{t,f,t}', 0)::text, v[1:3]::text);
  -- every 3 of 5: round at qi 2; items t f t t f → the choice question goes to the round, the order kept otherwise
  perform pg_temp.eq('arrange: a choice question on the round', meldy_private.live_arrange(v[1:5], '{t,f,t,t,f}', 3)::text,
                     array[v[1], v[3], v[2], v[4], v[5]]::text);
  -- every 3 of 6: rounds at 2 and 5; f f t t t t → each round swaps with the nearest choice question on a button place
  perform pg_temp.eq('arrange: both rounds get a choice question', meldy_private.live_arrange(v[1:6], '{f,f,t,t,t,t}', 3)::text,
                     array[v[6], v[3], v[2], v[4], v[5], v[1]]::text);
  -- a tie: the later one
  perform pg_temp.eq('arrange: a tie takes the later one', meldy_private.live_arrange(v[1:4], '{t,f,t,f}', 3)::text,
                     array[v[1], v[2], v[4], v[3]]::text);
  -- every 3 of 6 with one choice question: 6 → 5 (rounds 2) fits: the last text answer dropped
  perform pg_temp.eq('arrange: too few choice questions, the last text answer goes', meldy_private.live_arrange(v[1:6], '{t,t,t,f,t,t}', 3)::text,
                     array[v[1], v[2], v[4], v[3], v[5]]::text);
  perform pg_temp.eq('arrange: only text answers, nothing', meldy_private.live_arrange(v[1:3], '{t,t,t}', 3)::text, '{}');
end
$t$;

-- ─── 3. A battle of every kind, in two teams ───
do $t$
declare r jsonb; h jsonb; s jsonb; v_g uuid; v_host text; v_pin text; v_src text; v_qi integer; v_q jsonb; v_keys int[]; v_key integer;
        v_e jsonb; v_share double precision; v_d integer; v_kinds text := ''; v_n integer; v_f2 boolean; v_s2 integer; v_f4 boolean;
begin
  v_src := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 10}', pg_temp.c('k'), pg_temp.c('ks'));
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('teams 5', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"teams": 5}')), '22023/teams@400');
  perform pg_temp.eq('teams as text', pg_temp.e(format('select public.live_create(%L, %L)', v_src, '{"teams": "2"}')), '22023/teams@400');
  r := public.live_create(v_src::jsonb, '{"teams": 2, "time_s": 20}');
  perform pg_temp.eq('every kind plays, seven options never', (r ->> 'q_count') || '/' || (r ->> 'skipped'), '5/1');
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  v_pin := r ->> 'pin';
  perform pg_temp.put('g', v_g::text);
  perform pg_temp.put('host', v_host);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the kinds drawn', (select string_agg(kind, ',' order by kind) from public.live_questions where game_id = v_g),
                     'multiple,multiple,short,short,single');
  perform pg_temp.yes('a text question: no options, key -1, the forms, the explanation',
    exists (select 1 from public.live_questions where game_id = v_g and kind = 'short' and options = '[]' and shown = '{}' and key = -1
              and forms = '{Москва,"г. Москва"}' and explanation = 'Москва — столица с 1918 года'));
  perform pg_temp.yes('several right: every right option in shown order, key the first',
    (select bool_and(cardinality(keys) = cardinality(i.correct) and key = keys[1]
                     and (select bool_and(shown[k + 1] = any (i.correct)) from unnest(keys) k)
                     and keys = (select array_agg(k order by k) from unnest(keys) k))
       from public.live_questions q join public.test_items i on i.id = q.item_id where q.game_id = v_g and q.kind = 'multiple'));
  perform pg_temp.yes('a single answer keeps no keys', exists (select 1 from public.live_questions where game_id = v_g and kind = 'single' and keys is null and forms is null));
  -- the teams: the smallest team, the lower number on a tie; kept on rejoin; a kick leaves a gap the next join fills
  perform pg_temp.who('anon');
  for v_n in 1 .. 5 loop
    perform pg_temp.put('p' || v_n, public.live_join(v_pin, 'Игрок ' || v_n, pg_temp.tok(v_n), null) ->> 'player_id');
  end loop;
  perform pg_temp.who('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
  perform pg_temp.put('p6', public.live_join(v_pin, 'Боря', pg_temp.tok(6), null) ->> 'player_id');
  perform pg_temp.who('anon');
  perform pg_temp.eq('teams in turn', (select string_agg((pg_temp.prow(pg_temp.g('p' || n)) ->> 'team'), ',' order by n) from generate_series(1, 6) n), '1,2,1,2,1,2');
  perform public.live_join(v_pin, 'Игрок 3', pg_temp.tok(3), null);
  perform pg_temp.eq('a rejoin keeps the team', pg_temp.prow(pg_temp.g('p3')) ->> 'team', '1');
  s := pg_temp.st(v_g, pg_temp.tok(2));
  perform pg_temp.eq('me.team', s -> 'me' ->> 'team', '2');
  perform pg_temp.eq('the lobby''s teams', (s -> 'teams')::text, '[{"avg": 0.0, "dmg": 0, "team": 1, "place": 1, "players": 3}, {"avg": 0.0, "dmg": 0, "team": 2, "place": 2, "players": 3}]');
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('settings.teams', h -> 'settings' ->> 'teams', '2');
  perform pg_temp.yes('the roster''s teams', (select bool_and(x ? 'team') from jsonb_array_elements(h -> 'roster') x));
  perform public.live_kick(v_g, v_host, pg_temp.g('p6'));
  perform pg_temp.put('p7', public.live_join(v_pin, 'Аня', pg_temp.tok(7), null) ->> 'player_id');
  perform pg_temp.eq('the next join fills the smaller team', pg_temp.prow(pg_temp.g('p7')) ->> 'team', '2');
  -- the questions in turn
  for v_qi in 0 .. 4 loop
    h := public.live_next(v_g, v_host, case when v_qi = 0 then 'lobby' else 'leaderboard' end);
    v_q := pg_temp.qrow(v_g, v_qi);
    v_kinds := v_kinds || (v_q ->> 'kind') || ' ';
    select coalesce(array_agg(x::integer order by o), '{}') into v_keys from jsonb_array_elements_text(case when jsonb_typeof(v_q -> 'keys') = 'array' then v_q -> 'keys' else '[]' end) with ordinality as k(x, o);
    v_key := (v_q ->> 'key')::integer;
    if v_q ->> 'kind' = 'multiple' then
      perform pg_temp.eq('countdown: several right, how many ' || v_qi, pg_temp.keys(h -> 'question') || '/' || (h -> 'question' ->> 'multi'),
                         'closes_at,kind,multi,opens_at,options,phase,picture,qi,text/' || cardinality(v_keys));
    elsif v_q ->> 'kind' = 'short' then
      perform pg_temp.eq('countdown: a text question ' || v_qi, pg_temp.keys(h -> 'question') || '/' || (h -> 'question' ->> 'kind') || '/' || (h -> 'question' ->> 'options'),
                         'closes_at,kind,opens_at,options,phase,picture,qi,text/short/[]');
    else
      perform pg_temp.eq('countdown: a single answer as before ' || v_qi, pg_temp.keys(h -> 'question'), 'closes_at,opens_at,options,phase,picture,qi,text');
    end if;
    perform pg_temp.eq('early ' || v_qi, pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"choice": 0}'), 'ML004/early@400');
    perform pg_temp.tick(v_g, 4);
    perform pg_temp.eq('open ' || v_qi, pg_temp.hs(v_g, v_host) ->> 'state', 'open');
    v_f2 := (pg_temp.prow(pg_temp.g('p2')) ->> 'frozen')::boolean;
    v_s2 := (pg_temp.prow(pg_temp.g('p2')) ->> 'streak')::integer;
    v_f4 := (pg_temp.prow(pg_temp.g('p4')) ->> 'frozen')::boolean;
    if v_q ->> 'kind' = 'single' then
      perform pg_temp.eq('single: a tap', pg_temp.ans(v_g, pg_temp.tok(1), v_qi, v_key), 'ok');
      perform pg_temp.eq('single: two picks', pg_temp.sub(v_g, pg_temp.tok(4), v_qi, '{"picks": [0, 1]}'), '22023/answer@400');
      perform pg_temp.eq('single: a text', pg_temp.sub(v_g, pg_temp.tok(4), v_qi, '{"text": "a"}'), 'ML004/kind@400');
      perform pg_temp.tick(v_g, 1);
      perform pg_temp.eq('single: a wrong choice', pg_temp.sub(v_g, pg_temp.tok(2), v_qi, jsonb_build_object('choice', (v_key + 1) % 4)), 'ok');
      perform pg_temp.eq('single: one pick is that choice', pg_temp.sub(v_g, pg_temp.tok(3), v_qi, jsonb_build_object('picks', jsonb_build_array(v_key))), 'ok');
      perform pg_temp.eq('single: stored as a choice', (pg_temp.arow(v_g, v_qi, pg_temp.g('p3')) ->> 'choice') || '/' || coalesce(pg_temp.arow(v_g, v_qi, pg_temp.g('p3')) ->> 'picks', 'null'), v_key || '/null');
      perform pg_temp.eq('twice', pg_temp.sub(v_g, pg_temp.tok(3), v_qi, '{"choice": 0}'), 'ML004/twice@400');
    elsif v_q ->> 'kind' = 'multiple' then
      perform pg_temp.eq('multi: the exact set', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, jsonb_build_object('picks', to_jsonb(v_keys))), 'ok');
      perform pg_temp.tick(v_g, 1);
      perform pg_temp.eq('multi: one right', pg_temp.sub(v_g, pg_temp.tok(2), v_qi, jsonb_build_object('picks', jsonb_build_array(v_keys[2]))), 'ok');
      perform pg_temp.eq('multi: one right, one wrong', pg_temp.sub(v_g, pg_temp.tok(3), v_qi,
        jsonb_build_object('picks', jsonb_build_array(v_keys[1], (select min(z) from generate_series(0, 5) z where z <> all (v_keys))))), 'ok');
      perform pg_temp.eq('multi: a picks twice the same', pg_temp.sub(v_g, pg_temp.tok(4), v_qi, jsonb_build_object('picks', jsonb_build_array(v_keys[1], v_keys[1]))), '22023/answer@400');
      perform pg_temp.eq('multi: a pick past the options', pg_temp.sub(v_g, pg_temp.tok(4), v_qi, '{"picks": [6]}'), '22023/answer@400');
      perform pg_temp.eq('multi: no picks', pg_temp.sub(v_g, pg_temp.tok(4), v_qi, '{"picks": []}'), '22023/answer@400');
      perform pg_temp.eq('multi: two keys', pg_temp.sub(v_g, pg_temp.tok(4), v_qi, '{"picks": [0], "choice": 0}'), '22023/answer@400');
      perform pg_temp.eq('multi: a text', pg_temp.sub(v_g, pg_temp.tok(4), v_qi, '{"text": "a"}'), 'ML004/kind@400');
      perform pg_temp.eq('multi: an old phone''s tap is one tick', pg_temp.ans(v_g, pg_temp.tok(4), v_qi, v_keys[1]), 'ok');
      perform pg_temp.eq('multi: the tap stored as picks', (pg_temp.arow(v_g, v_qi, pg_temp.g('p4')) ->> 'picks') || '/' || coalesce(pg_temp.arow(v_g, v_qi, pg_temp.g('p4')) ->> 'choice', 'null'),
                         '[' || v_keys[1] || ']/null');
      perform pg_temp.eq('multi: me.picks before the close', pg_temp.st(v_g, pg_temp.tok(2)) -> 'me' ->> 'picks', '[' || v_keys[2] || ']');
    else
      perform pg_temp.eq('text: a tap', pg_temp.ans(v_g, pg_temp.tok(1), v_qi, 0), 'ML004/kind@400');
      perform pg_temp.eq('text: a choice', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"choice": 0}'), 'ML004/kind@400');
      perform pg_temp.eq('text: blank', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"text": "   "}'), '22023/answer@400');
      perform pg_temp.eq('text: a number', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"text": 42}'), '22023/answer@400');
      perform pg_temp.eq('text: too long', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, jsonb_build_object('text', repeat('я', 201))), '22023/answer@400');
      perform pg_temp.eq('text: not an object', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '"Москва"'), '22023/answer@400');
      if v_q -> 'forms' ->> 0 = 'Москва' then
        perform pg_temp.eq('text: right', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"text": "  москва "}'), 'ok');
        perform pg_temp.eq('text: the other form, a dot', pg_temp.sub(v_g, pg_temp.tok(2), v_qi, '{"text": "Г. МОСКВА."}'), 'ok');
        perform pg_temp.eq('text: wrong', pg_temp.sub(v_g, pg_temp.tok(3), v_qi, '{"text": "Питер"}'), 'ok');
        perform pg_temp.eq('text: wrong too', pg_temp.sub(v_g, pg_temp.tok(4), v_qi, '{"text": "питер"}'), 'ok');
        perform pg_temp.eq('text: rude', pg_temp.sub(v_g, pg_temp.tok(5), v_qi, '{"text": "сука"}'), 'ok');
        perform pg_temp.eq('text: stored trimmed, as typed', pg_temp.arow(v_g, v_qi, pg_temp.g('p1')) ->> 'typed', 'москва');
        perform pg_temp.eq('text: me.typed', pg_temp.st(v_g, pg_temp.tok(2)) -> 'me' ->> 'typed', 'Г. МОСКВА.');
      else
        perform pg_temp.eq('text 42: right', pg_temp.sub(v_g, pg_temp.tok(1), v_qi, '{"text": "42"}'), 'ok');
      end if;
    end if;
    -- the time runs out
    perform pg_temp.tick(v_g, 22);
    h := pg_temp.hs(v_g, v_host);
    perform pg_temp.eq('reveal ' || v_qi, h ->> 'state', 'reveal');
    if v_q ->> 'kind' = 'single' then
      perform pg_temp.eq('single: the result as before', pg_temp.keys(h -> 'result'), 'counts,frozen_now,healed,hits,key,phase_changed,qi,right,thawed');
      perform pg_temp.eq('single: right 2', h -> 'result' ->> 'right', '2');
    elsif v_q ->> 'kind' = 'multiple' then
      perform pg_temp.eq('multi: the host''s result', pg_temp.keys(h -> 'result'), 'counts,frozen_now,healed,hits,key,keys,phase_changed,qi,right,thawed');
      perform pg_temp.eq('multi: every right option', h -> 'result' ->> 'keys', to_jsonb(v_keys)::text);
      perform pg_temp.eq('multi: only the exact set is right', h -> 'result' ->> 'right', '1');
      perform pg_temp.eq('multi: every tick counts', (h -> 'result' -> 'counts' ->> v_keys[1])::text, '3');
      perform pg_temp.eq('multi: the other right option', (h -> 'result' -> 'counts' ->> v_keys[2])::text, '2');
      v_e := pg_temp.arow(v_g, v_qi, pg_temp.g('p1'));
      perform pg_temp.eq('multi: the exact set hits in full', v_e ->> 'dmg',
        pg_temp.dmg((v_e ->> 'elapsed_ms')::integer, 20, (pg_temp.prow(pg_temp.g('p1')) ->> 'streak')::integer, true)::text);
      v_e := pg_temp.arow(v_g, v_qi, pg_temp.g('p2'));
      v_share := 1.0 / cardinality(v_keys);
      v_d := case when v_f2 then 0 else floor(pg_temp.dmg((v_e ->> 'elapsed_ms')::integer, 20, v_s2 + 1, true)::double precision * v_share + 0.5)::integer end;
      perform pg_temp.eq('multi: one of the right options hits its share (none when frozen)', (v_e ->> 'dmg') || '/' || (v_e ->> 'correct'), v_d || '/false');
      perform pg_temp.eq('multi: a partial answer: no streak, the ice as it was', (pg_temp.prow(pg_temp.g('p2')) ->> 'streak') || '/' || (pg_temp.prow(pg_temp.g('p2')) ->> 'frozen'), '0/' || v_f2);
      perform pg_temp.eq('multi: one right one wrong is wrong', (pg_temp.arow(v_g, v_qi, pg_temp.g('p3')) ->> 'dmg') || '/' || (pg_temp.prow(pg_temp.g('p3')) ->> 'frozen'), '0/true');
      perform pg_temp.eq('multi: the partial hits are hits (of the players not frozen)', (select count(*) from jsonb_array_elements(h -> 'result' -> 'hits') x
                                                               where x ->> 'player_id' in (pg_temp.c('p2'), pg_temp.c('p4')))::text,
                         ((case when v_f2 then 0 else 1 end) + (case when v_f4 then 0 else 1 end))::text);
      s := pg_temp.st(v_g, pg_temp.tok(2));
      perform pg_temp.eq('multi: the player''s result', pg_temp.keys(s -> 'result'), 'correct,counts,dmg,frozen,healed,key,keys,none,phase_changed,picks,qi,right,share,thawed');
      perform pg_temp.eq('multi: the share', (s -> 'result' ->> 'share')::double precision::text, v_share::text);
      perform pg_temp.eq('multi: the exact set''s share', pg_temp.st(v_g, pg_temp.tok(1)) -> 'result' ->> 'share', '1');
      perform pg_temp.eq('multi: no answer', (pg_temp.st(v_g, pg_temp.tok(5)) -> 'result' ->> 'share') || '/' || (pg_temp.st(v_g, pg_temp.tok(5)) -> 'result' ->> 'none'), '0/true');
    else
      perform pg_temp.eq('text: the host''s result', pg_temp.keys(h -> 'result'), 'counts,forms,frozen_now,healed,hits,key,phase_changed,qi,right,thawed,tops');
      perform pg_temp.eq('text: no counts, key -1', (h -> 'result' ->> 'counts') || '/' || (h -> 'result' ->> 'key'), '[]/-1');
      if v_q -> 'forms' ->> 0 = 'Москва' then
        perform pg_temp.eq('text: two forms right', h -> 'result' ->> 'right', '2');
        perform pg_temp.eq('text: the forms', h -> 'result' ->> 'forms', '["Москва", "г. Москва"]');
        perform pg_temp.eq('text: the tops (normalised, by count, the rude one out)', h -> 'result' ->> 'tops',
          '[{"n": 2, "ok": false, "text": "питер"}, {"n": 1, "ok": true, "text": "г. москва"}, {"n": 1, "ok": true, "text": "москва"}]');
        perform pg_temp.eq('text: wrong freezes', pg_temp.prow(pg_temp.g('p3')) ->> 'frozen', 'true');
        s := pg_temp.st(v_g, pg_temp.tok(2));
        perform pg_temp.eq('text: the player''s result', pg_temp.keys(s -> 'result'), 'correct,counts,dmg,forms,frozen,healed,key,none,phase_changed,qi,right,thawed,tops,typed');
        perform pg_temp.eq('text: own text and right', (s -> 'result' ->> 'typed') || '/' || (s -> 'result' ->> 'correct'), 'Г. МОСКВА./true');
      else
        perform pg_temp.eq('text 42: the tops', h -> 'result' ->> 'tops', '[{"n": 1, "ok": true, "text": "42"}]');
      end if;
    end if;
    perform pg_temp.yes('a new kind leaves no key before the close', true);
    h := public.live_next(v_g, v_host, 'reveal');
    if v_qi < 4 then
      perform pg_temp.eq('leaderboard ' || v_qi, h ->> 'state', 'leaderboard');
      perform pg_temp.yes('the five best carry their teams', (select bool_and(x ? 'team') from jsonb_array_elements(h -> 'top') x));
    end if;
  end loop;
  perform pg_temp.eq('every kind was played', (select string_agg(x, ',' order by x) from unnest(string_to_array(trim(v_kinds), ' ')) x), 'multiple,multiple,short,short,single');
  perform pg_temp.eq('podium', h ->> 'state', 'podium');
  -- the standings: the average of each team's players not kicked, by place
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the teams by the average', (h -> 'teams')::text,
    (select jsonb_agg(jsonb_build_object('team', t.team, 'players', t.n, 'dmg', t.d, 'avg', round(t.d::numeric / t.n, 1), 'place', t.pl) order by t.pl)::text
       from (select team, count(*)::integer n, sum(dmg)::integer d, row_number() over (order by sum(dmg)::numeric / count(*) desc, sum(dmg) desc, team)::integer pl
               from public.live_players where game_id = v_g and kicked_at is null group by team) t));
  perform pg_temp.put('g1', v_g::text);
end
$t$;

-- ─── 4. The review: kinds, the own answers, the explanations ───
do $t$
declare r jsonb; v_g uuid := pg_temp.g('g1'); x jsonb;
begin
  perform pg_temp.who('anon');
  r := public.live_review(v_g, pg_temp.tok(2));
  perform pg_temp.eq('five items', jsonb_array_length(r -> 'items')::text, '5');
  for x in select * from jsonb_array_elements(r -> 'items') loop
    if x ->> 'kind' = 'multiple' then
      perform pg_temp.yes('multi item: keys, picks, share', x ? 'keys' and x ? 'picks' and x ? 'share' and (x ->> 'correct') = 'false');
    elsif x ->> 'kind' = 'short' then
      perform pg_temp.yes('text item: forms, own text, the question''s text kept', x ? 'forms' and x ? 'typed' and x -> 'options' = '[]' and x ->> 'text' in ('Столица России', 'Ответ на главный вопрос'));
      if x -> 'forms' ->> 0 = 'Москва' then
        perform pg_temp.eq('text item: the explanation', x ->> 'explanation', 'Москва — столица с 1918 года');
        perform pg_temp.eq('text item: right', (x ->> 'typed') || '/' || (x ->> 'correct'), 'Г. МОСКВА./true');
      else
        perform pg_temp.eq('text item without an explanation', (x ? 'explanation')::text || '/' || coalesce(x ->> 'typed', 'null'), 'false/null');
      end if;
    else
      perform pg_temp.eq('single item as before', pg_temp.keys(x), 'choice,correct,key,options,qi,text');
    end if;
  end loop;
  perform pg_temp.yes('the explanation of several right answers',
    exists (select 1 from jsonb_array_elements(r -> 'items') y where y ->> 'explanation' = 'Гласные: a и c'));
end
$t$;

-- ─── 5. «Тренировать ошибки» ───
do $t$
declare r jsonb; v_g uuid := pg_temp.g('g1'); v_n integer;
begin
  perform pg_temp.who('anon');
  perform pg_temp.eq('a guest: sign in first', pg_temp.e(format('select public.live_practice(%L, %L)', v_g, pg_temp.tok(1))), '28000/@401');
  perform pg_temp.who('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
  perform pg_temp.eq('kicked: no practice', pg_temp.e(format('select public.live_practice(%L, %L)', v_g, pg_temp.tok(6))), '42501/kicked@403');
  perform pg_temp.who('postgres');
  update public.live_players set kicked_at = null where id = pg_temp.g('p6');
  perform pg_temp.who('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
  perform pg_temp.eq('not a member, no quiz offers it', pg_temp.e(format('select public.live_practice(%L, %L)', v_g, pg_temp.tok(6))), 'ML012/practice@403');
  perform pg_temp.eq('a token of no player', pg_temp.e(format('select public.live_practice(%L, %L)', v_g, pg_temp.tok(99))), 'P0002/token@404');
  perform pg_temp.who('postgres');
  insert into public.container_members (container_id, user_id) values (pg_temp.g('k'), 'bbbbbbbb-0000-0000-0000-000000000002');
  perform pg_temp.who('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
  r := public.live_practice(v_g, pg_temp.tok(6));
  -- Боря was kicked before the game and answered nothing: every question he played is a mistake (he joined before them)
  perform pg_temp.eq('a member: every mistake recorded', pg_temp.keys(r) || '/' || (r ->> 'container_id') || '/' || (r ->> 'joined') || '/' || (r ->> 'saved') || '/' || (r ->> 'mistakes'),
                     'container_id,joined,mistakes,saved/' || pg_temp.c('k') || '/false/5/5');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the study log: five answers of today, none right', (select count(*) || '/' || bool_or(correct)::text || '/' || min(source) || '/' || min(mode)
                     from public.test_answers where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'), '5/false/web/learn');
  perform pg_temp.yes('the plan holds them as not known', (select count(*) = 5 and bool_and(right_count = 0) from public.test_item_states
                                                            where user_id = 'bbbbbbbb-0000-0000-0000-000000000002'));
  perform pg_temp.who('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
  r := public.live_practice(v_g, pg_temp.tok(6));
  perform pg_temp.eq('a second press counts nothing twice', (r ->> 'saved') || '/' || (select count(*) from public.test_answers
                     where user_id = 'bbbbbbbb-0000-0000-0000-000000000002')::text, '5/5');
  -- a player who answered: only the questions not right (wrong, partial, none)
  perform pg_temp.who('postgres');
  update public.live_players set user_id = 'cccccccc-0000-0000-0000-000000000003', guest_hash = null where id = pg_temp.g('p2');
  insert into public.container_members (container_id, user_id) values (pg_temp.g('k'), 'cccccccc-0000-0000-0000-000000000003');
  v_n := (select count(*) from public.live_answers a where a.game_id = v_g and a.player_id = pg_temp.g('p2') and a.correct);
  perform pg_temp.who('authenticated', 'cccccccc-0000-0000-0000-000000000003');
  r := public.live_practice(v_g, pg_temp.tok(2));
  perform pg_temp.eq('only the mistakes', r ->> 'mistakes', (5 - v_n)::text);
  perform pg_temp.who('postgres');
  perform pg_temp.yes('the text answer as typed, the ticks as file indexes', exists (select 1 from public.test_answers t
                      where t.user_id = 'cccccccc-0000-0000-0000-000000000003' and t.kind = 'multiple' and cardinality(t.chosen) = 1));
  -- a game before its podium: not yet
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('k'), pg_temp.c('ks'))::jsonb, '{}');
  perform pg_temp.who('authenticated', 'bbbbbbbb-0000-0000-0000-000000000002');
  perform public.live_join(r ->> 'pin', 'Боря', pg_temp.tok(20), null);
  perform pg_temp.eq('before the podium', pg_temp.e(format('select public.live_practice(%L, %L)', r ->> 'game_id', pg_temp.tok(20))), 'ML004/not_open@400');
end
$t$;

-- ─── 6. A quiz that offers practice: a player joins the exam, unless a quiz of it is open ───
do $t$
declare r jsonb; v_g uuid; v_host text; v_quiz uuid;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.quiz_create(pg_temp.g('k'), jsonb_build_object('title', 'Контрольная видов', 'attempts', null, 'offer_practice', true));
  v_quiz := (r ->> 'id')::uuid;
  r := public.live_create(jsonb_build_object('quiz_id', v_quiz), '{}');
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004');
  perform public.live_join(r ->> 'pin', 'Дина', pg_temp.tok(30), null);
  perform pg_temp.who('anon');
  perform public.live_next(v_g, v_host, 'lobby');
  perform pg_temp.tick(v_g, 30);
  perform pg_temp.eq('the first question closed with no answer', pg_temp.hs(v_g, v_host) ->> 'state', 'reveal');
  perform public.live_end(v_g, v_host);
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004');
  perform pg_temp.eq('the quiz is open: its answers would show', pg_temp.e(format('select public.live_practice(%L, %L)', v_g, pg_temp.tok(30))), 'ML012/open@403');
  perform pg_temp.who('postgres');
  update public.quizzes set closed_at = now() - interval '1 minute' where id = v_quiz;
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004');
  r := public.live_practice(v_g, pg_temp.tok(30));
  perform pg_temp.eq('the quiz offers practice: joined', (r ->> 'joined') || '/' || (r ->> 'mistakes'), 'true/1');
  perform pg_temp.who('postgres');
  perform pg_temp.yes('a member now', meldy_private.role_in('dddddddd-0000-0000-0000-000000000004', pg_temp.g('k')) = 'member');
  update public.container_members set removed_at = now() where user_id = 'dddddddd-0000-0000-0000-000000000004';
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004');
  perform pg_temp.eq('removed by the author', pg_temp.e(format('select public.live_practice(%L, %L)', v_g, pg_temp.tok(30))), 'ML012/removed@403');
end
$t$;

-- ─── 7. A battle with movement rounds: choice questions on the rounds; several right zones ───
do $t$
declare r jsonb; h jsonb; v_g uuid; v_host text; v_pin text; v_qi integer; v_keys int[];
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.eq('only text answers: no movement round can play', pg_temp.e(format('select public.live_create(%L, %L)',
    format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('k'), pg_temp.c('kt')), '{"stand_every": 3}')), 'ML008/2@400');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s", "%s"], "count": 3}', pg_temp.c('k'), pg_temp.c('kt'), pg_temp.c('km'))::jsonb,
                          '{"stand_every": 3, "boss": "skeleton"}');
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  v_pin := r ->> 'pin';
  perform pg_temp.eq('three questions, one round', r ->> 'q_count', '3');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the round holds the choice question', (select string_agg(kind, ',' order by qi) from public.live_questions where game_id = v_g), 'short,short,multiple');
  perform pg_temp.who('anon');
  perform pg_temp.put('m1', public.live_join(v_pin, 'Дима', pg_temp.tok(41), null) ->> 'player_id');
  perform pg_temp.put('m2', public.live_join(v_pin, 'Лена', pg_temp.tok(42), null) ->> 'player_id');
  perform pg_temp.put('m3', public.live_join(v_pin, 'Боря', pg_temp.tok(43), null) ->> 'player_id');
  for v_qi in 0 .. 2 loop
    h := public.live_next(v_g, v_host, case when v_qi = 0 then 'lobby' else 'leaderboard' end);
    perform pg_temp.tick(v_g, 4);
    if v_qi < 2 then
      perform pg_temp.eq('a text button question in a mixed game', pg_temp.sub(v_g, pg_temp.tok(41), v_qi, jsonb_build_object('text', pg_temp.qrow(v_g, v_qi) -> 'forms' ->> 0)), 'ok');
      perform pg_temp.tick(v_g, 22);
      perform pg_temp.eq('closed ' || v_qi, pg_temp.hs(v_g, v_host) ->> 'state', 'reveal');
      h := public.live_next(v_g, v_host, 'reveal');
    end if;
  end loop;
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('the movement round says several right', (h -> 'question' ->> 'stand') || '/' || (h -> 'question' ->> 'kind') || '/' || (h -> 'question' ->> 'multi'), 'true/multiple/2');
  perform pg_temp.eq('no taps on the round', pg_temp.sub(v_g, pg_temp.tok(41), 2, '{"picks": [0]}'), 'ML004/stand@400');
  select array_agg(x::integer order by o) into v_keys from jsonb_array_elements_text(pg_temp.qrow(v_g, 2) -> 'keys') with ordinality as k(x, o);
  perform pg_temp.tick(v_g, 19.5);
  r := public.live_stand_close(v_g, v_host, 2, jsonb_build_array(
    jsonb_build_object('p', pg_temp.c('m1'), 'c', v_keys[1], 'e', 1000),
    jsonb_build_object('p', pg_temp.c('m2'), 'c', v_keys[2], 'e', 2000),
    jsonb_build_object('p', pg_temp.c('m3'), 'c', (select min(z) from generate_series(0, 3) z where z <> all (v_keys)), 'e', 3000)));
  perform pg_temp.eq('the room reads every right zone', r ->> 'keys', to_jsonb(v_keys)::text);
  perform pg_temp.eq('either right zone is right', (select string_agg((x ->> 'ok'), ',' order by x ->> 'ms') from jsonb_array_elements(r -> 'rows') x), 'true,true,false');
  perform pg_temp.eq('right 2, both hit in full', (r ->> 'right') || '/' || jsonb_array_length(r -> 'hits'), '2/2');
  perform pg_temp.eq('m2 hits as a right answer', (select x ->> 'dmg' from jsonb_array_elements(r -> 'rows') x where x ->> 'p' = pg_temp.c('m2')),
                     pg_temp.dmg(2000, 20, 1, true)::text);
end
$t$;

-- ─── 8. «Встань на ответ»: no text answers; several right zones ───
do $t$
declare r jsonb; h jsonb; v_g uuid; v_host text; v_pin text; v_keys int[];
begin
  -- the author's open games so far end (three at most may be open)
  perform pg_temp.who('postgres');
  update public.live_games set state = 'ended', state_at = now(), ended_at = now(), end_reason = 'host', rev = rev + 1
   where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001' and state not in ('podium', 'ended');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 10}', pg_temp.c('k'), pg_temp.c('ks'))::jsonb, '{"mode": "stand"}');
  perform pg_temp.eq('stand: the text answers skipped', (r ->> 'q_count') || '/' || (r ->> 'skipped'), '3/3');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('k'), pg_temp.c('km'))::jsonb, '{"mode": "stand"}');
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  v_pin := r ->> 'pin';
  perform pg_temp.who('anon');
  perform pg_temp.put('s1', public.live_join(v_pin, 'Дима', pg_temp.tok(51), null) ->> 'player_id');
  perform pg_temp.put('s2', public.live_join(v_pin, 'Лена', pg_temp.tok(52), null) ->> 'player_id');
  h := public.live_next(v_g, v_host, 'lobby');
  perform pg_temp.tick(v_g, 4);
  perform pg_temp.tick(v_g, 14.5);
  select array_agg(x::integer order by o) into v_keys from jsonb_array_elements_text(pg_temp.qrow(v_g, 0) -> 'keys') with ordinality as k(x, o);
  r := public.live_stand_close(v_g, v_host, 0, jsonb_build_array(
    jsonb_build_object('p', pg_temp.c('s1'), 'c', v_keys[2], 'e', 3000),
    jsonb_build_object('p', pg_temp.c('s2'), 'c', (select min(z) from generate_series(0, 3) z where z <> all (v_keys)), 'e', 3000)));
  perform pg_temp.eq('stand: keys and the right zone''s points', (r ->> 'keys') || '/' ||
    (select (x ->> 'ok') || ':' || (x ->> 'pts') from jsonb_array_elements(r -> 'rows') x where x ->> 'p' = pg_temp.c('s1')),
    to_jsonb(v_keys)::text || '/true:' || pg_temp.spts(3000, 15, 1, true, false));
end
$t$;

rollback;
\echo LIVE KINDS TEAMS BEHAVIOUR PASSED
