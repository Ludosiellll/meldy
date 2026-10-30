-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261031090000_live_wide_rounds.sql on
-- the scratch database of live_game_run.sh, after the pictures step: «Встань на ответ» draws the questions of a real test
-- (five and six options), and the room's write of a round (live_stand_close) takes the zones Д and Е; a zone past the
-- question's options is still refused. A mixed game's movement round goes through the same write. One transaction,
-- rolled back; now() is one moment inside it, so time moves by a time machine (pg_temp.tick).
-- Exam P as in live_pictures_behaviour.sql: five options with pictures, six, four (playable); seven and two right ones
-- (never). A failure raises; success prints LIVE WIDE CLOSE BEHAVIOUR PASSED.
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


create or replace function pg_temp.close(p_game uuid, p_host text, p_qi integer, p_answers jsonb) returns text language sql as $fn$
  select pg_temp.e(format('select public.live_stand_close(%L, %L, %s, %L)', p_game, p_host, p_qi, p_answers))
$fn$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- ─── 2. «Встань на ответ» of a real test: Д and Е are zones of the round's write ───
do $t$
declare r jsonb; h jsonb; v_g uuid; v_host text; v_pin text; v_qi integer; v_n integer; v_key integer; v_ans jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xs'))::jsonb, '{"mode": "stand"}');
  perform pg_temp.eq('stand: five, six and four options play', (r ->> 'q_count') || '/' || (r ->> 'skipped'), '3/2');
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  v_pin := r ->> 'pin';
  perform pg_temp.who('anon');
  perform pg_temp.put('p1', public.live_join(v_pin, 'Дима', pg_temp.tok(1), null) ->> 'player_id');
  perform pg_temp.put('p2', public.live_join(v_pin, 'Лена', pg_temp.tok(2), null) ->> 'player_id');
  for v_qi in 0 .. 2 loop
    h := public.live_next(v_g, v_host, case when v_qi = 0 then 'lobby' else 'leaderboard' end);
    perform pg_temp.eq('countdown ' || v_qi, (h ->> 'state') || '/' || (h ->> 'qi'), 'countdown/' || v_qi);
    v_n := jsonb_array_length(h -> 'question' -> 'options');
    v_key := pg_temp.key_of(v_g, v_qi);
    perform pg_temp.tick(v_g, 4);
    perform pg_temp.eq('open ' || v_qi, pg_temp.hs(v_g, v_host) ->> 'state', 'open');
    perform pg_temp.tick(v_g, 14.5);
    -- a zone past the options: refused (the sixth zone on a four- or five-option question, a seventh on six)
    perform pg_temp.eq('a zone past the options (' || v_n || ')',
      pg_temp.close(v_g, v_host, v_qi, jsonb_build_array(jsonb_build_object('p', pg_temp.c('p1'), 'c', v_n, 'e', 1))), '22023/answers@400');
    perform pg_temp.eq('still open after the refusal ' || v_qi, pg_temp.hs(v_g, v_host) ->> 'state', 'open');
    -- P1 on the last zone (Д on five options, Е on six), P2 on the key
    v_ans := jsonb_build_array(jsonb_build_object('p', pg_temp.c('p1'), 'c', v_n - 1, 'e', 2000),
                               jsonb_build_object('p', pg_temp.c('p2'), 'c', v_key, 'e', 3000));
    r := public.live_stand_close(v_g, v_host, v_qi, v_ans);
    perform pg_temp.eq('counts per option ' || v_qi, jsonb_array_length(r -> 'counts')::text, v_n::text);
    perform pg_temp.yes('the last zone counted ' || v_qi, (r -> 'counts' ->> (v_n - 1))::integer >= 1);
    perform pg_temp.eq('the key ' || v_qi, r ->> 'key', v_key::text);
    perform pg_temp.who('postgres');
    perform pg_temp.eq('P1''s answer as written ' || v_qi,
      (select choice::text from public.live_answers where game_id = v_g and qi = v_qi and player_id = pg_temp.g('p1')), (v_n - 1)::text);
    perform pg_temp.who('anon');
    perform pg_temp.eq('reveal ' || v_qi, pg_temp.hs(v_g, v_host) ->> 'state', 'reveal');
    h := public.live_next(v_g, v_host, 'reveal');
  end loop;
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the six zones were played', (select string_agg(n::text, ',' order by n) from (
    select jsonb_array_length(options) n from public.live_questions where game_id = v_g) s), '4,5,6');
  perform pg_temp.eq('Д and Е written', (select string_agg(choice::text, ',' order by choice) from public.live_answers
                                         where game_id = v_g and player_id = pg_temp.g('p1') and choice >= 4), '4,5');
end
$t$;

rollback;
\echo LIVE WIDE CLOSE BEHAVIOUR PASSED
