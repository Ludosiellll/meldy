-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261030090000_live_pictures.sql on
-- the scratch database of live_game_run.sh (its pictures stage; the helpers are those of live_game_behaviour.sql). One
-- transaction, rolled back; time moves by the same time machine.
-- A = aaaa…1 (author of exam P); guests are anon with tokens tok(n).
-- P holds: a five-option question with a picture in the stem and one on its third option (file order), a six-option one,
-- a four-option one without pictures, a seven-option one and one with two right options (neither plays).
-- A battle takes the first three (skipped 2); the pictures are copied in the shown order; question.pictures is in the
-- state only for the question that has them (the other questions' JSON as before); an answer 5 (the sixth option) is
-- taken; a stand game and a mixed game keep the old rule (the four-option one only); quiz_live_media_paths gives a picture to
-- the host and to a player once its question was shown (from its countdown), never in the lobby or before, never to a
-- token of no player, a kicked player or another game, and nothing 7 days after the end; the review carries the
-- pictures of the question that has them.
-- A failure raises; success prints LIVE PICTURES BEHAVIOUR PASSED.
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
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- ─── 1. Exam P ───
do $t$
declare r jsonb; v_c text; v_stem text; v_opt text;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.container_create('Картинки', null, '[{"title":"Схемы"}]');
  v_c := r ->> 'container_id';
  perform pg_temp.put('x', v_c);
  perform pg_temp.put('xs', r -> 'subjects' -> 0 ->> 'id');
  v_stem := v_c || '/' || repeat('a', 64) || '.png';
  v_opt := v_c || '/' || repeat('b', 64) || '.jpg';
  perform pg_temp.put('stem', v_stem);
  perform pg_temp.put('opt', v_opt);
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'p:1', 'stem', 'Какая связь на схеме?', 'options', jsonb_build_array('1:1', '1:N', 'N:M', 'нет связи', 'обе'),
                       'correct', jsonb_build_array(2),
                       'images', jsonb_build_object('stem', jsonb_build_array(v_stem),
                                                    'options', jsonb_build_array('[]'::jsonb, '[]'::jsonb, jsonb_build_array(v_opt), '[]'::jsonb, '[]'::jsonb))),
    jsonb_build_object('ref', 'p:2', 'stem', 'Шесть вариантов', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e', 'f'), 'correct', jsonb_build_array(5)),
    jsonb_build_object('ref', 'p:3', 'stem', 'Четыре варианта', 'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'p:4', 'stem', 'Семь вариантов', 'options', jsonb_build_array('1', '2', '3', '4', '5', '6', '7'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'p:5', 'stem', 'Два верных', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e'), 'correct', jsonb_build_array(0, 1))));
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 2. Creating: a battle takes 5–6 options and pictures; a stand game and a mixed game do not ───
do $t$
declare r jsonb; v_src text := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 5}', pg_temp.c('x'), pg_temp.c('xs'));
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xs'))::jsonb, '{"mode": "stand"}');
  perform pg_temp.eq('stand: the four-option question only', (r ->> 'q_count') || '/' || (r ->> 'skipped'), '1/4');
  perform public.live_end((r ->> 'game_id')::uuid, r ->> 'host_token');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xs'))::jsonb, '{"stand_every": 3}');
  perform pg_temp.eq('mixed: the four-option question only', (r ->> 'q_count') || '/' || (r ->> 'skipped'), '1/4');
  perform public.live_end((r ->> 'game_id')::uuid, r ->> 'host_token');
  r := public.live_create(v_src::jsonb, '{"speed": false}');
  perform pg_temp.eq('battle: five, six and four options play', (r ->> 'q_count') || '/' || (r ->> 'skipped'), '3/2');
  perform pg_temp.put('g', r ->> 'game_id');
  perform pg_temp.put('host', r ->> 'host_token');
  perform pg_temp.put('pin', r ->> 'pin');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('options per question', (select string_agg(jsonb_array_length(options)::text, ',' order by jsonb_array_length(options))
                                                from public.live_questions where game_id = pg_temp.g('g')), '4,5,6');
  perform pg_temp.yes('the five-option question: the stem picture, the option picture at its shown place, the key on the right text',
    (select q.pictures -> 'stem' = jsonb_build_array(pg_temp.c('stem'))
            and jsonb_array_length(q.pictures -> 'options') = 5
            and q.pictures -> 'options' -> (array_position(q.shown, 2::smallint) - 1) = jsonb_build_array(pg_temp.c('opt'))
            and (select count(*) from jsonb_array_elements(q.pictures -> 'options') o where jsonb_array_length(o) > 0) = 1
            and q.options ->> q.key::integer = 'N:M'
       from public.live_questions q where q.game_id = pg_temp.g('g') and jsonb_array_length(q.options) = 5));
  perform pg_temp.eq('no pictures: null', (select string_agg(coalesce(pictures::text, 'null'), ',') from public.live_questions
                                            where game_id = pg_temp.g('g') and jsonb_array_length(options) <> 5), 'null,null');
  perform pg_temp.put('pq', (select qi::text from public.live_questions where game_id = pg_temp.g('g') and pictures is not null));
  perform pg_temp.put('sq', (select qi::text from public.live_questions where game_id = pg_temp.g('g') and jsonb_array_length(options) = 6));
end
$t$;

-- ─── 3. The lobby: two players; nothing is shown yet ───
do $t$
declare r jsonb; v_g uuid := pg_temp.g('g');
begin
  perform pg_temp.who('anon');
  r := public.live_join(pg_temp.c('pin'), 'Дима', pg_temp.tok(1), null);
  perform pg_temp.put('p1', r ->> 'player_id');
  r := public.live_join(pg_temp.c('pin'), 'Лена', pg_temp.tok(2), null);
  perform pg_temp.put('p2', r ->> 'player_id');
  perform pg_temp.who('service_role');
  perform pg_temp.eq('lobby: no picture for the host or a player',
    public.quiz_live_media_paths(v_g, pg_temp.c('host'), array[pg_temp.c('stem')])::text || public.quiz_live_media_paths(v_g, pg_temp.tok(1), array[pg_temp.c('stem')])::text,
    '[][]');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 4. The questions in turn: pictures from the countdown of their question on ───
do $t$
declare r jsonb; h jsonb; v_g uuid := pg_temp.g('g'); v_host text := pg_temp.c('host'); v_pq integer := pg_temp.c('pq')::integer;
        v_sq integer := pg_temp.c('sq')::integer; v_qi integer; v_key integer; v_n integer; v_both text[] := array[pg_temp.c('stem'), pg_temp.c('opt')];
begin
  for v_qi in 0 .. 2 loop
    perform pg_temp.who('anon');
    h := public.live_next(v_g, v_host, case when v_qi = 0 then 'lobby' else 'leaderboard' end);
    perform pg_temp.eq('countdown ' || v_qi, (h ->> 'state') || '/' || (h ->> 'qi'), 'countdown/' || v_qi);
    r := pg_temp.st(v_g, pg_temp.tok(1));
    perform pg_temp.who('service_role');
    if v_qi < v_pq then
      perform pg_temp.eq('before its question: nothing (' || v_qi || ')', public.quiz_live_media_paths(v_g, pg_temp.tok(1), v_both)::text, '[]');
      perform pg_temp.eq('before its question: nothing for the host (' || v_qi || ')', public.quiz_live_media_paths(v_g, v_host, v_both)::text, '[]');
    else
      perform pg_temp.eq('from its countdown on: both pictures for a player (' || v_qi || ')',
        (select string_agg(x, ',' order by x) from jsonb_array_elements_text(public.quiz_live_media_paths(v_g, pg_temp.tok(1), v_both || array['nope'])) x),
        (select string_agg(x, ',' order by x) from unnest(v_both) x));
      perform pg_temp.eq('and for the host (' || v_qi || ')', jsonb_array_length(public.quiz_live_media_paths(v_g, v_host, v_both))::text, '2');
      perform pg_temp.eq('never for a token of no player (' || v_qi || ')', public.quiz_live_media_paths(v_g, pg_temp.tok(9), v_both)::text, '[]');
      perform pg_temp.eq('never through another game (' || v_qi || ')', public.quiz_live_media_paths(gen_random_uuid(), pg_temp.tok(1), v_both)::text, '[]');
      perform pg_temp.eq('at most 20 paths (' || v_qi || ')', public.quiz_live_media_paths(v_g, pg_temp.tok(1), array_fill(pg_temp.c('stem'), array[21]))::text, '[]');
    end if;
    perform pg_temp.who('anon');
    if v_qi = v_pq then
      perform pg_temp.eq('the picture question''s keys', pg_temp.keys(r -> 'question'), 'closes_at,opens_at,options,phase,picture,pictures,qi,text');
      perform pg_temp.eq('its pictures as stored', (r -> 'question' -> 'pictures')::text, pg_temp.pics(v_g, v_pq));
      perform pg_temp.eq('the host''s too', (h -> 'question' -> 'pictures' -> 'stem')::text, jsonb_build_array(pg_temp.c('stem'))::text);
      perform pg_temp.eq('picture stays null', r -> 'question' ->> 'picture', null);
    else
      perform pg_temp.eq('a question without pictures: the keys as before', pg_temp.keys(r -> 'question'), 'closes_at,opens_at,options,phase,picture,qi,text');
    end if;
    perform pg_temp.tick(v_g, 3.5);
    v_key := pg_temp.key_of(v_g, v_qi);
    -- Wrong answers (one right at most, on the six-option question): the boss (2 × 3 × 55 HP) lives to the last question.
    v_n := jsonb_array_length(h -> 'question' -> 'options');
    if v_qi = v_sq then
      perform pg_temp.eq('the sixth option is a choice', pg_temp.ans(v_g, pg_temp.tok(2), v_qi, 5), 'ok');
      perform pg_temp.eq('a seventh is not', pg_temp.ans(v_g, pg_temp.tok(1), v_qi, 6), '22023/choice@400');
    else
      perform pg_temp.eq('P2 answers ' || v_qi, pg_temp.ans(v_g, pg_temp.tok(2), v_qi, (v_key + 1) % v_n), 'ok');
    end if;
    perform pg_temp.eq('P1 answers ' || v_qi, pg_temp.ans(v_g, pg_temp.tok(1), v_qi, (v_key + 1) % v_n), 'ok');
    h := pg_temp.hs(v_g, v_host);
    perform pg_temp.eq('reveal ' || v_qi, h ->> 'state', 'reveal');
    if v_qi = v_sq then
      perform pg_temp.eq('six counts', jsonb_array_length(h -> 'result' -> 'counts')::text, '6');
      perform pg_temp.yes('the sixth counted', (h -> 'result' -> 'counts' ->> 5)::integer >= 1);
    end if;
    h := public.live_next(v_g, v_host, 'reveal');
  end loop;
end
$t$;

-- ─── 5. The end: the review; a kicked player; 7 days after ───
do $t$
declare r jsonb; v_g uuid := pg_temp.g('g'); v_host text := pg_temp.c('host'); v_both text[] := array[pg_temp.c('stem'), pg_temp.c('opt')];
        v_want text;
begin
  perform pg_temp.who('postgres');
  v_want := (select string_agg((qi = pg_temp.c('pq')::integer)::text, ',' order by qi) from public.live_questions where game_id = v_g);
  perform pg_temp.who('anon');
  perform public.live_end(v_g, v_host);
  r := public.live_review(v_g, pg_temp.tok(1));
  perform pg_temp.eq('review: pictures on the picture question only',
    (select string_agg((x ? 'pictures')::text, ',' order by (x ->> 'qi')::integer) from jsonb_array_elements(r -> 'items') x),
    v_want);
  perform pg_temp.who('service_role');
  perform pg_temp.eq('after the end: still the shown pictures', jsonb_array_length(public.quiz_live_media_paths(v_g, pg_temp.tok(2), v_both))::text, '2');
  perform pg_temp.who('postgres');
  update public.live_players set kicked_at = now() where id = pg_temp.g('p2');
  perform pg_temp.who('service_role');
  perform pg_temp.eq('a kicked player: nothing', public.quiz_live_media_paths(v_g, pg_temp.tok(2), v_both)::text, '[]');
  perform pg_temp.tick(v_g, 7 * 86400 + 60);
  perform pg_temp.eq('7 days after the end: nothing, the host neither', public.quiz_live_media_paths(v_g, pg_temp.tok(1), v_both)::text
                     || public.quiz_live_media_paths(v_g, v_host, v_both)::text, '[][]');
  perform pg_temp.who('postgres');
end
$t$;

rollback;
\echo LIVE PICTURES BEHAVIOUR PASSED
