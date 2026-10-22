-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261025090000_live_pin.sql (the
-- phone's PIN step) on the scratch database of live_game_run.sh, after live_game (and, when applied, live_stand and
-- live_mixed). One transaction, rolled back; now() is one moment inside it, so time moves by a time machine
-- (pg_temp.tick). A = aaaa…1 (author of exam X), C = cccc…3 (author of exam Y: the limits), D = dddd…4 (signed in, not a
-- member), E = eeee…5 (signed in, a member of X); guests are anon with tokens tok(n).
-- Every answer is compared with the old check (live_join with the empty name, pg_temp.parity): «open» where that said
-- ML006, «joined» where it took the identity back, «refused» with its code, details, HTTP status and Retry-After
-- otherwise. And every check that is not a take-back writes nothing (pg_temp.digest: the games, players, wardrobes, the
-- address throttle and the Realtime hints, before and after).
-- 1. An open game (guest, signed in): open + mode. 2. Wrong PIN, malformed PIN, malformed token. 3. Already in the game
-- by the same token (taken back, no new player, rev unchanged) and by the same account from another device (the old
-- token dies, as with live_join). 4. Kicked. 5. Members only (a guest, a non-member, a member, a member already in).
-- 6. Finished: ended by the host, podium (a new player refused, one already in taken back). 7. A time move that is due
-- (countdown → open, the 3 hours) is not written by the check. 8. Limits: 300 players, 120 joins a minute per game and
-- per address (Retry-After), and the throttle's pruning left to real joins. 9. A stand game says mode stand (when
-- 20261022090000_live_stand.sql is applied). 10. Only the function: anon reads no table.
-- A failure raises; success prints LIVE PIN BEHAVIOUR PASSED.
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
  select 'pin' || lpad(p_n::text, 40, '0')
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
-- The outcome of a statement: 'ok', or the body's code/details@status of a PGRST refusal (its Retry-After kept in
-- live_test.retry), or SQLSTATE/detail.
create or replace function pg_temp.e(p_sql text) returns text language plpgsql as $fn$
declare v_detail text; v_msg jsonb;
begin
  perform set_config('live_test.retry', '', true);
  execute p_sql;
  return 'ok';
exception
  when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlstate = 'PGRST' then
      v_msg := sqlerrm::jsonb;
      perform set_config('live_test.retry', coalesce(v_detail::jsonb -> 'headers' ->> 'Retry-After', ''), true);
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
-- The time machine: every time of a game moves back by p_s seconds. Runs as the session.
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
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
end;
$fn$;
-- What a check could write: every game, player and wardrobe row, the address throttle and the Realtime hints (the
-- deferred hint trigger flushed first). Runs as the session.
create or replace function pg_temp.digest() returns text language plpgsql as $fn$
declare v_role text := current_user; v text;
begin
  perform set_config('role', 'none', true);
  set constraints all immediate;
  set constraints all deferred;
  select md5(concat_ws('|',
           (select string_agg(g::text, ',' order by g.id) from public.live_games g),
           (select string_agg(p::text, ',' order by p.id) from public.live_players p),
           (select string_agg(q.game_id || ':' || q.qi || ':' || coalesce(q.closed_at::text, '-'), ',' order by q.game_id, q.qi) from public.live_questions q),
           (select string_agg(w::text, ',' order by w.owner_kind, w.owner_key) from public.live_wardrobe w),
           (select string_agg(h.ip_hash || '@' || h.at, ',' order by h.ip_hash, h.at) from meldy_private.live_join_hits h),
           (select count(*)::text from realtime.sent))) into v;
  if v_role <> 'postgres' then
    perform set_config('role', v_role, true);
  end if;
  return v;
end;
$fn$;
-- live_pin, checked against the old check (live_join with the empty name, the same caller and token) and, unless it
-- is a take-back, against the digest: nothing written.
create or replace function pg_temp.parity(p_what text, p_pin text, p_tok text) returns jsonb language plpgsql as $fn$
declare r jsonb; v_old text; v_before text := pg_temp.digest();
begin
  r := public.live_pin(p_pin, p_tok);
  if r ->> 'status' <> 'joined' then
    perform pg_temp.eq(p_what || ': nothing written by the check', pg_temp.digest(), v_before);
  end if;
  v_old := pg_temp.e(format('select public.live_join(%L, %L, %L, null)', p_pin, '', p_tok));
  perform pg_temp.eq(p_what || ': the same answer as live_join with the empty name',
                     case r ->> 'status' when 'open' then 'ML006/length@400' when 'joined' then 'ok'
                          else (r ->> 'code') || '/' || coalesce(r ->> 'detail', '') || '@' || (r ->> 'http') end, v_old);
  perform pg_temp.eq(p_what || ': the same Retry-After', coalesce(r ->> 'retry_after', ''), current_setting('live_test.retry'));
  perform pg_temp.eq(p_what || ': the shape', pg_temp.keys(r), case r ->> 'status'
                     when 'open' then 'mode,status' when 'refused' then 'code,detail,http,retry_after,status'
                     else 'game_id,look,name,now,player_id,rev,state,status,topic,wardrobe' end);
  return r;
end;
$fn$;
create or replace function pg_temp.refused(p_r jsonb) returns text language sql immutable as $fn$
  select (p_r ->> 'status') || ' ' || (p_r ->> 'code') || '/' || coalesce(p_r ->> 'detail', '') || '@' || (p_r ->> 'http')
         || coalesce(' retry ' || (p_r ->> 'retry_after'), '')
$fn$;
grant execute on all functions in schema pg_temp to authenticated, anon, service_role;

-- ─── 0. Exams: X (A, three questions; E a member), Y (C, three questions) ───
do $t$
declare r jsonb;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.container_create('Проверка PIN', null, '[{"title":"SQL"}]');
  perform pg_temp.put('x', r ->> 'container_id');
  perform pg_temp.put('xs', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'p:1', 'stem', 'Какая команда отменяет транзакцию?', 'options', jsonb_build_array('ROLLBACK', 'COMMIT'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'p:2', 'stem', 'Какая команда относится к DDL?', 'options', jsonb_build_array('SELECT', 'ALTER'), 'correct', jsonb_build_array(1)),
    jsonb_build_object('ref', 'p:3', 'stem', 'Буква I в ACID?', 'options', jsonb_build_array('Целиком', 'Изоляция'), 'correct', jsonb_build_array(1))));
  perform pg_temp.who('authenticated', 'cccccccc-0000-0000-0000-000000000003');
  r := public.container_create('Лимиты PIN', null, '[{"title":"Т"}]');
  perform pg_temp.put('y', r ->> 'container_id');
  perform pg_temp.put('ys', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'q:1', 'stem', 'Один', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'q:2', 'stem', 'Два', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(1)),
    jsonb_build_object('ref', 'q:3', 'stem', 'Три', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(0))));
  perform pg_temp.who('postgres');
  insert into public.container_members (container_id, user_id) values (pg_temp.g('x'), 'eeeeeeee-0000-0000-0000-000000000005');
  -- Joins committed by earlier runs on this database (the end-to-end stages) out of the address throttle's count.
  delete from meldy_private.live_join_hits;
  -- Earlier open games of A and C (the same database is used again and again) out of the 3-open-games limit.
  update public.live_games set state = 'ended', ended_at = now(), end_reason = 'host'
   where owner_id in ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003') and state <> 'ended';
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xs'))::jsonb, '{}');
  perform pg_temp.put('g1', r ->> 'game_id'); perform pg_temp.put('g1_host', r ->> 'host_token'); perform pg_temp.put('g1_pin', r ->> 'pin');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xs'))::jsonb, '{"who": "members"}');
  perform pg_temp.put('g2', r ->> 'game_id'); perform pg_temp.put('g2_host', r ->> 'host_token'); perform pg_temp.put('g2_pin', r ->> 'pin');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 1. An open game: a guest and a signed-in player may join; the mode; nothing written ───
do $t$
declare r jsonb; v_pin text := pg_temp.c('g1_pin');
begin
  perform pg_temp.who('anon', null, '192.0.2.9');
  r := pg_temp.parity('a guest, an open game', v_pin, pg_temp.tok(1));
  perform pg_temp.eq('a guest, an open game: open, the battle', r::text, '{"mode": "boss", "status": "open"}');
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004');
  r := pg_temp.parity('signed in, an open game', v_pin, pg_temp.tok(2));
  perform pg_temp.eq('signed in, an open game: open', r::text, '{"mode": "boss", "status": "open"}');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('no player made by the checks', (select count(*)::text from public.live_players where game_id = pg_temp.g('g1')), '0');
  perform pg_temp.eq('no join counted', (select count(*)::text from meldy_private.live_join_hits), '0');
  perform pg_temp.eq('rev unchanged by the checks', (select rev::text from public.live_games where id = pg_temp.g('g1')), '1');
end
$t$;

-- ─── 2. Wrong PINs and tokens ───
do $t$
begin
  perform pg_temp.who('anon');
  perform pg_temp.eq('an unknown PIN', pg_temp.refused(pg_temp.parity('an unknown PIN', '000001', pg_temp.tok(1))), 'refused P0002/pin@404');
  perform pg_temp.eq('a malformed PIN', pg_temp.refused(pg_temp.parity('a malformed PIN', '12ab56', pg_temp.tok(1))), 'refused P0002/pin@404');
  perform pg_temp.eq('no PIN', pg_temp.refused(public.live_pin(null, pg_temp.tok(1))), 'refused P0002/pin@404');
  perform pg_temp.eq('a malformed token', pg_temp.refused(pg_temp.parity('a malformed token', pg_temp.c('g1_pin'), 'short')), 'refused 22023/token@400');
  perform pg_temp.eq('no token', pg_temp.refused(public.live_pin(pg_temp.c('g1_pin'), null)), 'refused 22023/token@400');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 3. Already in the game: by the same token, and by the same account from another device ───
do $t$
declare r jsonb; j jsonb; v_pin text := pg_temp.c('g1_pin'); v_g uuid := pg_temp.g('g1');
begin
  perform pg_temp.who('anon', null, '192.0.2.10');
  j := public.live_join(v_pin, 'Дима', pg_temp.tok(1), null);
  perform pg_temp.put('p1', j ->> 'player_id');
  r := pg_temp.parity('the same token', v_pin, pg_temp.tok(1));
  perform pg_temp.eq('the same token: joined, the same player and name, rev unchanged',
                     (r ->> 'status') || '/' || (r ->> 'player_id') || '/' || (r ->> 'name') || '/' || (r ->> 'rev') || '/' || (r -> 'wardrobe')::text,
                     'joined/' || (j ->> 'player_id') || '/Дима/' || (j ->> 'rev') || '/null');
  perform pg_temp.eq('the JoinResult as live_join gives it', (r - 'status' - 'now')::text, (j - 'now')::text);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('no second player', (select count(*)::text from public.live_players where game_id = v_g), '1');
  perform pg_temp.eq('the join counted once, the take-back not at all', (select count(*)::text from meldy_private.live_join_hits), '1');
  -- D joins from one device, then checks the PIN from another: the account is found, the new token replaces the old.
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004', '192.0.2.11');
  j := public.live_join(v_pin, 'Боря', pg_temp.tok(20), null);
  perform pg_temp.put('p2', j ->> 'player_id');
  r := pg_temp.parity('the same account, another device', v_pin, pg_temp.tok(21));
  perform pg_temp.eq('the same account: joined, the same player, the account''s wardrobe',
                     (r ->> 'status') || '/' || (r ->> 'player_id') || '/' || (r ->> 'name') || '/' || (r -> 'wardrobe')::text,
                     'joined/' || (j ->> 'player_id') || '/Боря/' || (j -> 'wardrobe')::text);
  perform pg_temp.yes('a signed-in player has a wardrobe', jsonb_typeof(r -> 'wardrobe') = 'object');
  perform pg_temp.who('anon');
  perform pg_temp.eq('the first device''s token is dead (as after live_join)', pg_temp.e(format('select public.live_state(%L, %L, null)', v_g, pg_temp.tok(20))), 'P0002/token@404');
  perform pg_temp.eq('the new device''s token plays', pg_temp.e(format('select public.live_state(%L, %L, null)', v_g, pg_temp.tok(21))), 'ok');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('still two players, two joins counted', (select count(*)::text from public.live_players where game_id = v_g)
                     || '/' || (select count(*) from meldy_private.live_join_hits), '2/2');
end
$t$;

-- ─── 4. Kicked ───
do $t$
declare v_pin text := pg_temp.c('g1_pin');
begin
  perform pg_temp.who('anon');
  perform public.live_kick(pg_temp.g('g1'), pg_temp.c('g1_host'), pg_temp.g('p1'));
  perform pg_temp.eq('kicked: refused', pg_temp.refused(pg_temp.parity('kicked', v_pin, pg_temp.tok(1))), 'refused 42501/kicked@403');
  perform pg_temp.who('postgres');
  perform pg_temp.yes('the kicked player stays kicked', (select kicked_at is not null from public.live_players where id = pg_temp.g('p1')));
end
$t$;

-- ─── 5. Members only ───
do $t$
declare r jsonb; v_pin text := pg_temp.c('g2_pin');
begin
  perform pg_temp.who('anon');
  perform pg_temp.eq('members only: a guest', pg_temp.refused(pg_temp.parity('members only: a guest', v_pin, pg_temp.tok(30))), 'refused ML003/members@403');
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004');
  perform pg_temp.eq('members only: not a member', pg_temp.refused(pg_temp.parity('members only: not a member', v_pin, pg_temp.tok(31))), 'refused ML003/members@403');
  perform pg_temp.who('authenticated', 'eeeeeeee-0000-0000-0000-000000000005');
  r := pg_temp.parity('members only: a member', v_pin, pg_temp.tok(32));
  perform pg_temp.eq('members only: a member may join', r::text, '{"mode": "boss", "status": "open"}');
  perform public.live_join(v_pin, 'Ева', pg_temp.tok(32), null);
  r := pg_temp.parity('members only: a member already in', v_pin, pg_temp.tok(33));
  perform pg_temp.eq('members only: a member already in is taken back', (r ->> 'status') || '/' || (r ->> 'name'), 'joined/Ева');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 6. Finished: ended by the host; at the podium ───
do $t$
declare r jsonb; v_g3 uuid; v_host3 text; v_pin3 text; v_g4 uuid; v_pin4 text;
begin
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xs'))::jsonb, '{}');
  v_g3 := (r ->> 'game_id')::uuid; v_host3 := r ->> 'host_token'; v_pin3 := r ->> 'pin';
  perform pg_temp.who('anon');
  perform public.live_join(v_pin3, 'Лена', pg_temp.tok(40), null);
  perform public.live_end(v_g3, v_host3);
  perform pg_temp.eq('ended: a new player', pg_temp.refused(pg_temp.parity('ended: a new player', v_pin3, pg_temp.tok(41))), 'refused ML002/ended@400');
  perform pg_temp.eq('ended: a player who was in', pg_temp.refused(pg_temp.parity('ended: a player who was in', v_pin3, pg_temp.tok(40))), 'refused ML002/ended@400');
  perform pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('x'), pg_temp.c('xs'))::jsonb, '{}');
  v_g4 := (r ->> 'game_id')::uuid; v_pin4 := r ->> 'pin';
  perform pg_temp.who('anon');
  perform public.live_join(v_pin4, 'Тимур', pg_temp.tok(42), null);
  perform pg_temp.who('postgres');
  update public.live_games set state = 'podium', state_at = now(), qi = q_count - 1 where id = v_g4;
  perform pg_temp.who('anon');
  perform pg_temp.eq('podium: a new player', pg_temp.refused(pg_temp.parity('podium: a new player', v_pin4, pg_temp.tok(43))), 'refused ML002/ended@400');
  r := pg_temp.parity('podium: a player who was in', v_pin4, pg_temp.tok(42));
  perform pg_temp.eq('podium: a player who was in is taken back', (r ->> 'status') || '/' || (r ->> 'state') || '/' || (r ->> 'name'), 'joined/podium/Тимур');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 7. A time move that is due is not written by the check (a real call writes it) ───
do $t$
declare r jsonb; v_g uuid := pg_temp.g('g1'); v_pin text := pg_temp.c('g1_pin'); v_rev bigint;
begin
  perform pg_temp.who('anon');
  perform public.live_next(v_g, pg_temp.c('g1_host'), 'lobby');
  perform pg_temp.who('postgres');
  perform pg_temp.tick(v_g, 4);
  select rev into v_rev from public.live_games where id = v_g;
  perform pg_temp.yes('countdown → open is due', (select meldy_private.live_due(g, now()) and g.state = 'countdown' from public.live_games g where g.id = v_g));
  perform pg_temp.who('anon');
  r := pg_temp.parity('a game whose question is due to open', v_pin, pg_temp.tok(50));
  perform pg_temp.eq('a late joiner may still join', r ->> 'status', 'open');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the move is not written by the check', (select state || '/' || (rev = v_rev)::text from public.live_games where id = v_g), 'countdown/true');
  perform pg_temp.who('anon');
  perform public.live_state(v_g, pg_temp.tok(21), null);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('a real call writes it', (select state from public.live_games where id = v_g), 'open');
  -- The 3 hours: the check says expired; the game ends only by a real call.
  perform pg_temp.tick(v_g, 3 * 3600 + 1);
  perform pg_temp.who('anon');
  perform pg_temp.eq('3 h: expired', pg_temp.refused(pg_temp.parity('3 hours', v_pin, pg_temp.tok(51))), 'refused ML002/expired@400');
  perform pg_temp.who('authenticated', 'dddddddd-0000-0000-0000-000000000004');
  perform pg_temp.eq('3 h: a player who was in', pg_temp.refused(pg_temp.parity('3 hours, a player who was in', v_pin, pg_temp.tok(21))), 'refused ML002/expired@400');
  perform pg_temp.who('postgres');
  perform pg_temp.yes('the expiry is not written by the check', (select state <> 'ended' from public.live_games where id = v_g));
end
$t$;

-- ─── 8. Limits (author C): 300 players, 120 joins a minute per game and per address ───
do $t$
declare r jsonb; v_src jsonb := format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('y'), pg_temp.c('ys'))::jsonb;
        v_g uuid[] := '{}'; v_p text[] := '{}'; v_ip text; v_n bigint;
begin
  perform pg_temp.who('authenticated', 'cccccccc-0000-0000-0000-000000000003');
  for i in 1 .. 3 loop
    r := public.live_create(v_src, '{}');
    v_g := v_g || (r ->> 'game_id')::uuid; v_p := v_p || (r ->> 'pin');
  end loop;
  perform pg_temp.who('postgres');
  insert into public.live_players (game_id, token_hash, guest_hash, name, look, joined_at)
  select v_g[1], h, h, 'И' || n, '{}', now() - interval '2 minutes'
    from (select n, encode(sha256(convert_to('pinfull' || n, 'UTF8')), 'hex') h from generate_series(1, 300) n) x;
  insert into public.live_players (game_id, token_hash, guest_hash, name, look, joined_at)
  select v_g[2], h, h, 'И' || n, '{}', now() - interval '20 seconds'
    from (select n, encode(sha256(convert_to('pinbusy' || n, 'UTF8')), 'hex') h from generate_series(1, 120) n) x;
  perform pg_temp.who('anon');
  perform pg_temp.eq('300 players', pg_temp.refused(pg_temp.parity('300 players', v_p[1], pg_temp.tok(60))), 'refused ML001/@400');
  perform pg_temp.eq('120 joins a minute on a game', pg_temp.refused(pg_temp.parity('120 joins a minute on a game', v_p[2], pg_temp.tok(60))),
                     'refused ML005/join@429 retry 40');
  -- One address: 120 joins in the minute → refused (Retry-After 60); old hits (3 minutes) of another address are pruned
  -- by a real join only.
  perform pg_temp.who('postgres');
  perform set_config('request.headers', '{"x-forwarded-for": "203.0.113.77"}', true);
  v_ip := meldy_private.quiz_ip_hash();
  insert into meldy_private.live_join_hits (ip_hash, at) select v_ip, now() from generate_series(1, 120);
  perform set_config('request.headers', '{"x-forwarded-for": "198.51.100.77"}', true);
  insert into meldy_private.live_join_hits (ip_hash, at) select meldy_private.quiz_ip_hash(), now() - interval '3 minutes' from generate_series(1, 5);
  perform pg_temp.who('anon', null, '203.0.113.77');
  perform pg_temp.eq('120 a minute from one address', pg_temp.refused(pg_temp.parity('120 a minute from one address', v_p[3], pg_temp.tok(61))),
                     'refused ML005/join@429 retry 60');
  perform pg_temp.who('anon', null, '198.51.100.77');
  r := pg_temp.parity('another address', v_p[3], pg_temp.tok(62));
  perform pg_temp.eq('another address may join', r ->> 'status', 'open');
  perform pg_temp.who('postgres');
  perform pg_temp.eq('the old hits stay after the check', (select count(*)::text from meldy_private.live_join_hits where at < now() - interval '2 minutes'), '5');
  select count(*) into v_n from meldy_private.live_join_hits where at > now() - interval '2 minutes';
  perform pg_temp.who('anon', null, '198.51.100.77');
  perform public.live_join(v_p[3], 'Вера', pg_temp.tok(62), null);
  perform pg_temp.who('postgres');
  perform pg_temp.eq('a real join prunes them and counts itself', (select count(*) filter (where at < now() - interval '2 minutes') || '/' || count(*)
                                                                    from meldy_private.live_join_hits), '0/' || (v_n + 1));
end
$t$;

-- ─── 9. A stand game says so (once 20261022090000_live_stand.sql is applied) ───
do $t$
declare r jsonb;
begin
  if pg_catalog.to_regprocedure('public.live_stand_close(uuid,text,integer,jsonb)') is null then
    raise notice 'skip: no stand mode on this base';
    return;
  end if;
  -- C's three games of section 8 out of the way (3 open games an author).
  perform pg_temp.who('postgres');
  update public.live_games set state = 'ended', ended_at = now(), end_reason = 'host'
   where owner_id = 'cccccccc-0000-0000-0000-000000000003' and state <> 'ended';
  perform pg_temp.who('authenticated', 'cccccccc-0000-0000-0000-000000000003');
  r := public.live_create(format('{"container_id": "%s", "subject_ids": ["%s"], "count": 3}', pg_temp.c('y'), pg_temp.c('ys'))::jsonb, '{"mode": "stand"}');
  perform pg_temp.who('anon');
  perform pg_temp.eq('a stand game', pg_temp.parity('a stand game', r ->> 'pin', pg_temp.tok(70))::text, '{"mode": "stand", "status": "open"}');
  perform pg_temp.who('postgres');
end
$t$;

-- ─── 10. Only the function: the API roles read no table ───
do $t$
begin
  perform pg_temp.who('anon');
  perform pg_temp.eq('anon reads no game', split_part(pg_temp.e('select count(*) from public.live_games'), '/', 1), '42501');
  perform pg_temp.eq('anon calls no helper', split_part(pg_temp.e('select meldy_private.live_game_of_pin(''123456'')'), '/', 1), '42501');
  perform pg_temp.who('postgres');
  perform pg_temp.yes('anon and authenticated may call live_pin, PUBLIC may not',
                      has_function_privilege('anon', 'public.live_pin(text,text)', 'EXECUTE')
                      and has_function_privilege('authenticated', 'public.live_pin(text,text)', 'EXECUTE')
                      and not exists (select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
                                       where p.oid = 'public.live_pin(text,text)'::regprocedure and a.grantee = 0));
end
$t$;

rollback;
\echo LIVE PIN BEHAVIOUR PASSED
