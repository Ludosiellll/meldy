-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261102090200_live_ranges.sql on the
-- scratch database of live_game_run.sh, after the numbers step: the ranges at their boundaries (exact labels, limits
-- and right ranges; a sweep of values, tolerances and places: the band always strictly inside), a battle whose movement
-- round draws a number as ranges (the zone graded by the key, the room's true value, the JSON of the round and of the
-- typed numbers as before, the review, «Тренировать ошибки» recording a missed range as «не знаю»), «Встань на ответ»
-- with every number as ranges (two accepted numbers: two right ranges), and a battle without rounds (typed as
-- before). One transaction, rolled back. A failure raises; success prints LIVE RANGES BEHAVIOUR PASSED.
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

-- ─── 1. Exam R: numbers (a tolerance and a unit; two accepted numbers; a negative; two far apart), a single answer ───
do $t$
declare r jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.container_create('Диапазоны', null, '[{"title":"Числа"},{"title":"Смешанный"}]');
  perform pg_temp.put('r', r ->> 'container_id');
  perform pg_temp.put('rn', r -> 'subjects' -> 0 ->> 'id');
  perform pg_temp.put('rm', r -> 'subjects' -> 1 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'r:1', 'stem', 'Скорость звука', 'kind', 'number', 'answers', jsonb_build_array('343'), 'tolerance', 10, 'unit', 'м/с',
                       'explanation', 'Около 343 м/с'),
    jsonb_build_object('ref', 'r:2', 'stem', 'Мороз', 'kind', 'number', 'answers', jsonb_build_array('-12'), 'tolerance', 0.5),
    jsonb_build_object('ref', 'r:3', 'stem', 'Два ответа', 'kind', 'number', 'answers', jsonb_build_array('10', '49'), 'tolerance', 1)));
  perform public.container_items_add((r -> 'subjects' -> 1 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'm:1', 'stem', 'Байт в килобайте', 'kind', 'number', 'answers', jsonb_build_array('1024')),
    jsonb_build_object('ref', 'm:2', 'stem', 'Бит в байте', 'kind', 'number', 'answers', jsonb_build_array('8')),
    jsonb_build_object('ref', 'm:3', 'stem', 'Один верный', 'options', jsonb_build_array('a', 'b', 'c', 'd'), 'correct', jsonb_build_array(1))));
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 2. The ranges: labels, limits and right ranges at the boundaries; the band always strictly inside ───
do $t$
declare c record; r jsonb; v_b numeric[]; v_bad text;
begin
  perform pg_temp.eq('text: a comma, «−», thousands apart from five digits', meldy_private.live_range_text(-12500.5),
                     '−12' || chr(160) || '500,5');
  perform pg_temp.eq('text: four digits stay whole, no trailing zeros', meldy_private.live_range_text(1000.00) || ' ' || meldy_private.live_range_text(0.250), '1000 0,25');
  perform pg_temp.eq('text: zero', meldy_private.live_range_text(0), '0');
  for c in select * from (values
      ('{343}'::text[], 10::numeric, 1, '["меньше 300", "300–400", "400–500", "больше 500"]', '[1]'),
      ('{1024}', null, 0, '["меньше 1500", "1500–2000", "2000–2500", "больше 2500"]', '[0]'),
      ('{1024}', null, 3, '["меньше 0", "0–500", "500–1000", "больше 1000"]', '[3]'),
      ('{-12}', 0.5, 1, '["меньше −15", "от −15 до −10", "от −10 до −5", "больше −5"]', '[1]'),
      ('{0}', null, 2, '["меньше −3", "от −3 до −1", "от −1 до 1", "больше 1"]', '[2]'),
      ('{0.5}', 0, 1, '["меньше 0,4", "0,4–0,6", "0,6–0,8", "больше 0,8"]', '[1]'),
      ('{1000}', null, 1, '["меньше 750", "750–1250", "1250–1750", "больше 1750"]', '[1]'),
      ('{100}', 25, 2, '["меньше −50", "от −50 до 50", "50–150", "больше 150"]', '[2]'),
      ('{10,49}', 1, 1, '["меньше 7,5", "7,5–12,5", "12,5–17,5", "больше 17,5"]', '[1, 3]'),
      ('{12500}', 100, 1, '["меньше 10 000", "10 000–15 000", "15 000–20 000", "больше 20 000"]', '[1]'),
      ('{-0.003}', null, 3, '["меньше −0,008", "от −0,008 до −0,006", "от −0,006 до −0,004", "больше −0,004"]', '[3]')) x(a, tol, slot, want, keys) loop
    r := meldy_private.live_ranges(c.a, c.tol, 4, c.slot);
    perform pg_temp.eq('ranges of ' || c.a::text || ' ± ' || coalesce(c.tol::text, '0') || ' at ' || c.slot,
                       replace((r -> 'options')::text, chr(160), ' ') || ' ' || (r -> 'keys')::text, c.want || ' ' || c.keys);
  end loop;
  perform pg_temp.eq('no canonical number: none', coalesce(meldy_private.live_ranges('{"5,0"}', null, 4, 0)::text, 'null'), 'null');
  perform pg_temp.eq('a place off the line: none', coalesce(meldy_private.live_ranges('{5}', null, 4, 4)::text, 'null'), 'null');
  -- every value of a sweep, every tolerance, every place: four labels, three rising limits a round width apart, the
  -- band strictly inside the range at the place, that range right, the width at least the band and a quarter of |a|
  select string_agg(format('%s±%s@%s', x.a, coalesce(x.t::text, '-'), x.s), ', ') into v_bad
    from (select a::text as a, t, s from unnest(array[0, 1, 7, 9.99, 42, 99.5, 100, 343, 999, 1000, 1024, 12500, 0.001, 0.5, -0.5, -1, -12,
                                                       -250, 3.14159, 1e6, 0.0001, 2.5, 7.5, 25, 125]::numeric[]) a,
                      unnest(array[null, 0, 0.01, 0.5, 1, 10, 25, 250]::numeric[]) t, generate_series(0, 3) s) x,
         lateral (select meldy_private.live_ranges(array[x.a], x.t, 4, x.s) as r) y,
         lateral (select array(select (b #>> '{}')::numeric from jsonb_array_elements(y.r -> 'bounds') b) as b) z
   where y.r is null or jsonb_array_length(y.r -> 'options') <> 4 or cardinality(z.b) <> 3
      or not (z.b[2] - z.b[1] = z.b[3] - z.b[2] and z.b[2] > z.b[1])
      or (x.s >= 1 and not (z.b[x.s] < x.a::numeric - coalesce(x.t, 0)))
      or (x.s <= 2 and not (x.a::numeric + coalesce(x.t, 0) < z.b[x.s + 1]))
      or y.r -> 'keys' <> jsonb_build_array(x.s)
      or z.b[2] - z.b[1] < greatest(2 * coalesce(x.t, 0), abs(x.a::numeric) / 4);
  perform pg_temp.eq('the sweep: 25 values × 8 tolerances × 4 places', coalesce(v_bad, 'all hold'), 'all hold');
end
$t$;

-- ─── 3. A battle with a movement round: a number on the round's place is played as ranges; typed elsewhere ───
do $t$
declare r jsonb; h jsonb; v_g uuid; v_host text; v_pin text; v_qi integer; v_q jsonb; v_key integer; v_wrong integer; v_e jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('r'), pg_temp.c('rn'))::jsonb,
                          '{"stand_every": 3, "time_s": 20}');
  perform pg_temp.eq('three numbers, none skipped, one on the round', (r ->> 'q_count') || '/' || (r ->> 'skipped'), '3/0');
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  v_pin := r ->> 'pin';
  perform pg_temp.put('g', v_g::text);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the button places: typed, as before', (select string_agg(jsonb_array_length(options)::text || ':' || coalesce(cardinality(bounds), 0), ',' order by qi)
                     from public.live_questions where game_id = v_g), '0:0,0:0,4:3');
  v_q := pg_temp.qrow(v_g, 2);
  perform pg_temp.yes('the round: four ranges, shown in order, the key one of them, three limits, the numbers kept',
    v_q ->> 'kind' = 'number' and v_q -> 'shown' = '[0, 1, 2, 3]' and (v_q ->> 'key')::integer between 0 and 3
    and jsonb_array_length(v_q -> 'bounds') = 3 and v_q -> 'forms' is not null and jsonb_array_length(v_q -> 'options') = 4);
  perform pg_temp.eq('the round''s ranges are live_ranges'' at its key',
    (v_q -> 'options')::text || (v_q -> 'bounds')::text,
    (select (x -> 'options')::text || (x -> 'bounds')::text
       from (select meldy_private.live_ranges(array(select jsonb_array_elements_text(v_q -> 'forms')), (v_q ->> 'tolerance')::numeric, 4, (v_q ->> 'key')::integer) as x) y));
  perform pg_temp.who('anon');
  perform pg_temp.put('p1', public.live_join(v_pin, 'Дима', pg_temp.tok(1), null) ->> 'player_id');
  perform pg_temp.put('p2', public.live_join(v_pin, 'Лена', pg_temp.tok(2), null) ->> 'player_id');
  perform pg_temp.put('p3', public.live_join(v_pin, 'Боря', pg_temp.tok(3), null) ->> 'player_id');
  for v_qi in 0 .. 1 loop
    h := public.live_next(v_g, v_host, case when v_qi = 0 then 'lobby' else 'leaderboard' end);
    perform pg_temp.eq('a typed number''s question as before ' || v_qi, pg_temp.keys(h -> 'question'), 'closes_at,kind,opens_at,options,phase,picture,qi,stand,text,unit');
    perform pg_temp.tick(v_g, 4);
    perform pg_temp.eq('typed ' || v_qi, pg_temp.sub(v_g, pg_temp.tok(1), v_qi, jsonb_build_object('text', pg_temp.qrow(v_g, v_qi) -> 'forms' ->> 0)), 'ok');
    perform pg_temp.tick(v_g, 22);
    h := pg_temp.hs(v_g, v_host);
    perform pg_temp.eq('a typed number''s result as before ' || v_qi, pg_temp.keys(h -> 'result'),
                       'counts,forms,frozen_now,healed,hits,key,phase_changed,qi,right,spread,stand,thawed,tolerance,tops,unit,void');
    h := public.live_next(v_g, v_host, 'reveal');
  end loop;
  h := public.live_next(v_g, v_host, 'leaderboard');
  perform pg_temp.eq('the range round''s question', pg_temp.keys(h -> 'question') || '/' || (h -> 'question' ->> 'ranges') || '/' || (h -> 'question' ->> 'stand'),
                     'closes_at,kind,opens_at,options,phase,picture,qi,ranges,stand,text,unit/true/true');
  perform pg_temp.eq('the ranges leave as options, no key', (h -> 'question' -> 'options')::text, (v_q -> 'options')::text);
  perform pg_temp.eq('no typing on a range round', pg_temp.sub(v_g, pg_temp.tok(1), 2, '{"text": "343"}'), 'ML004/stand@400');
  v_key := (v_q ->> 'key')::integer;
  v_wrong := (select min(z) from generate_series(0, 3) z
               where z <> all (case when jsonb_typeof(v_q -> 'keys') = 'array'
                                    then array(select jsonb_array_elements_text(v_q -> 'keys')::integer) else array[v_key] end));
  perform pg_temp.tick(v_g, 4);
  perform pg_temp.tick(v_g, 19.5);
  r := public.live_stand_close(v_g, v_host, 2, jsonb_build_array(
    jsonb_build_object('p', pg_temp.c('p1'), 'c', v_key, 'e', 1000),
    jsonb_build_object('p', pg_temp.c('p2'), 'c', v_wrong, 'e', 1500)));
  perform pg_temp.eq('the room reads the true value; keys only for several right ranges', (r -> 'num')::text || '/' || (r ? 'keys')::text,
                     (jsonb_build_object('forms', v_q -> 'forms', 'tolerance', v_q -> 'tolerance', 'unit', v_q -> 'unit'))::text || '/'
                     || (jsonb_typeof(v_q -> 'keys') = 'array')::text);
  perform pg_temp.eq('the right range is right, another wrong, none frozen in phase 0''s round',
    (select string_agg(x ->> 'ok', ',' order by x ->> 'ms') from jsonb_array_elements(r -> 'rows') x where x ->> 'p' in (pg_temp.c('p1'), pg_temp.c('p2'))), 'true,false');
  perform pg_temp.eq('right 1, the hit in full', (r ->> 'right') || '/' || (select x ->> 'dmg' from jsonb_array_elements(r -> 'rows') x where x ->> 'p' = pg_temp.c('p1')),
                     '1/' || pg_temp.dmg(1000, 20, 3, true));  -- two typed right before: the third in a row
  h := pg_temp.hs(v_g, v_host);
  perform pg_temp.eq('the host''s result of a range round', pg_temp.keys(h -> 'result'),
                     'counts,forms,frozen_now,healed,hits,key,' || case when jsonb_typeof(v_q -> 'keys') = 'array' then 'keys,' else '' end
                     || 'phase_changed,qi,ranges,right,stand,thawed,tolerance,unit,void');
  perform pg_temp.eq('the zones counted', (h -> 'result' ->> 'counts'),
                     (select jsonb_agg(case when z = v_key or z = v_wrong then 1 else 0 end order by z) from generate_series(0, 3) z)::text);
  perform pg_temp.eq('the player''s result', pg_temp.keys(pg_temp.st(v_g, pg_temp.tok(2)) -> 'result'),
                     'correct,counts,dmg,forms,frozen,healed,key,' || case when jsonb_typeof(v_q -> 'keys') = 'array' then 'keys,' else '' end
                     || 'none,phase_changed,qi,ranges,right,stand,thawed,tolerance,typed,unit,void');
  h := public.live_next(v_g, v_host, 'reveal');
  perform pg_temp.eq('podium', h ->> 'state', 'podium');
  -- the review: the range stood on, the true value; the typed ones as before
  r := public.live_review(v_g, pg_temp.tok(2));
  perform pg_temp.eq('the review of the range round', (select pg_temp.keys(x) || '/' || (x ->> 'choice') || '/' || (x ->> 'correct') from jsonb_array_elements(r -> 'items') x where (x ->> 'qi') = '2'),
                     'choice,correct,' || case when v_q ->> 'explanation' is not null then 'explanation,' else '' end || 'forms,key,'
                     || case when jsonb_typeof(v_q -> 'keys') = 'array' then 'keys,' else '' end
                     || 'kind,options,qi,ranges,stand,text,tolerance,typed,unit/' || v_wrong || '/false');
  perform pg_temp.eq('the review of a typed one as before (no ranges)', (select pg_temp.keys(x - 'explanation') from jsonb_array_elements(r -> 'items') x where (x ->> 'qi') = '0'),
                     'choice,correct,forms,key,kind,options,qi,stand,text,tolerance,typed,unit');
  -- «Тренировать ошибки»: the range missed goes as «не знаю» (no number was typed), the typed ones with their text
  perform pg_temp.who('postgres');
  update public.live_players set user_id = 'cccccccc-0000-0000-0000-000000000003', guest_hash = null where id = pg_temp.g('p2');
  insert into public.container_members (container_id, user_id) values (pg_temp.g('r'), 'cccccccc-0000-0000-0000-000000000003');
  perform pg_temp.who('authenticated', 'cccccccc-0000-0000-0000-000000000003');
  r := public.live_practice(v_g, pg_temp.tok(2));
  perform pg_temp.eq('Лена: two not answered, one range missed', (r ->> 'mistakes') || '/' || (r ->> 'saved'), '3/3');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the range as «не знаю» (no text, not right)', (select t.kind || '/' || coalesce(t.answer_text, 'null') || '/' || t.correct
                       from public.test_answers t join public.test_items i on i.id = t.item_id
                      where t.user_id = 'cccccccc-0000-0000-0000-000000000003' and i.stem = v_q ->> 'text'), 'number/null/false');
end
$t$;

-- ─── 4. «Встань на ответ»: every number as ranges; two accepted numbers in two ranges: either stays up ───
do $t$
declare r jsonb; v_g uuid; v_host text; v_pin text; v_q jsonb; v_keys int[]; v_qi integer;
begin
  perform pg_temp.who('postgres');
  update public.live_games set state = 'ended', state_at = now(), ended_at = now(), end_reason = 'host', rev = rev + 1
   where owner_id = 'aaaaaaaa-0000-0000-0000-000000000001' and state not in ('podium', 'ended');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('r'), pg_temp.c('rn'))::jsonb, '{"mode": "stand"}');
  perform pg_temp.eq('stand: the numbers play', (r ->> 'q_count') || '/' || (r ->> 'skipped'), '3/0');
  v_g := (r ->> 'game_id')::uuid;
  v_host := r ->> 'host_token';
  v_pin := r ->> 'pin';
  perform pg_temp.who('postgres');
  perform pg_temp.eq('stand: every question as ranges', (select string_agg(kind || ':' || jsonb_array_length(options), ',') from public.live_questions where game_id = v_g),
                     'number:4,number:4,number:4');
  select qi into v_qi from public.live_questions where game_id = v_g and text = 'Два ответа';
  v_q := pg_temp.qrow(v_g, v_qi);
  -- the right ranges: each accepted number's (an open end may hold both: then one)
  select array_agg(distinct (select count(*) from jsonb_array_elements(v_q -> 'bounds') b where (b #>> '{}')::numeric <= f::numeric)::integer) into v_keys
    from unnest(array['10', '49']) f;
  perform pg_temp.eq('two accepted numbers: a right range each, keys when two, the key the first',
    coalesce((v_q -> 'keys')::text, 'null') || '/' || (v_q ->> 'key'),
    case when cardinality(v_keys) = 2 then to_jsonb(v_keys)::text else 'null' end || '/' || v_keys[1]);
  perform pg_temp.who('anon');
  perform pg_temp.put('s1', public.live_join(v_pin, 'Дима', pg_temp.tok(51), null) ->> 'player_id');
  perform pg_temp.put('s2', public.live_join(v_pin, 'Лена', pg_temp.tok(52), null) ->> 'player_id');
  perform public.live_next(v_g, v_host, 'lobby');
  -- walk to the two-answer question: close the ones before it with nobody on a zone
  while (pg_temp.hs(v_g, v_host) ->> 'qi')::integer < v_qi loop
    perform pg_temp.tick(v_g, 4);
    perform pg_temp.tick(v_g, 14.5);
    perform public.live_stand_close(v_g, v_host, (pg_temp.hs(v_g, v_host) ->> 'qi')::integer, '[]'::jsonb);
    perform public.live_next(v_g, v_host, 'reveal');
    if pg_temp.hs(v_g, v_host) ->> 'state' = 'leaderboard' then
      perform public.live_next(v_g, v_host, 'leaderboard');
    end if;
  end loop;
  perform pg_temp.eq('stand: the range question says so', pg_temp.hs(v_g, v_host) -> 'question' ->> 'ranges', 'true');
  perform pg_temp.tick(v_g, 4);
  perform pg_temp.tick(v_g, 14.5);
  r := public.live_stand_close(v_g, v_host, v_qi, jsonb_build_array(
    jsonb_build_object('p', pg_temp.c('s1'), 'c', v_keys[cardinality(v_keys)], 'e', 3000),
    jsonb_build_object('p', pg_temp.c('s2'), 'c', (select min(z) from generate_series(0, 3) z where z <> all (v_keys)), 'e', 3000)));
  perform pg_temp.eq('stand: either right range is right, the room has both and the true value',
    coalesce(r ->> 'keys', 'null') || '/' || (r -> 'num' ->> 'forms') || '/' ||
    (select string_agg(x ->> 'ok', ',' order by x ->> 'p' = pg_temp.c('s2')) from jsonb_array_elements(r -> 'rows') x),
    case when cardinality(v_keys) = 2 then to_jsonb(v_keys)::text else 'null' end || '/["10", "49"]/true,false');
end
$t$;

-- ─── 5. A battle without movement rounds: a number is typed, as before (no ranges, no bounds) ───
do $t$
declare r jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('r'), pg_temp.c('rm'))::jsonb, '{}');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('no rounds: typed numbers and the single answer as before',
    (select string_agg(kind || ':' || jsonb_array_length(options) || ':' || coalesce(cardinality(bounds)::text, '-'), ',' order by kind, jsonb_array_length(options))
       from public.live_questions where game_id = (r ->> 'game_id')::uuid), 'number:0:-,number:0:-,single:4:-');
end
$t$;

rollback;
\echo LIVE RANGES BEHAVIOUR PASSED
