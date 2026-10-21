-- live_stand (mode «Встань на ответ» of the live class game)
-- Repo file: supabase/migrations/20261022090000_live_stand.sql. Base: 20261021090000_live_game.sql.
-- Contract: docs/live/MODE_STAND.md (settings, phases, the room's messages, the scoring with worked numbers); the game
-- itself stays docs/live/CONTRACT.md. The room server is backend/live_move_stand.py.
-- Check after the apply: supabase/tests/live_stand.sql (catalog and the numbers; read-only). Local rehearsal (never live):
-- supabase/tests/local/live_game_run.sh, its stand stage (live_stand_behaviour.sql). Rollback:
-- supabase/rollback/20261022090000_live_stand_down.sql.
--
-- 1. live_games.mode takes 'stand' beside 'boss' (the battle); live_games.boss_kind 'clock' | 'skeleton' (the teacher's
--    pick of the boss, shown in stand games); time_s of a stand game is 15, 20 or 30 (default 15). live_answers.dmg holds
--    a stand game's points (up to 1400).
-- 2. A stand game has no HP (hp_max = hp = 0), never freezes by phase and never heals. live_answer refuses it
--    (ML004 stand): its answers come from the room, which reads where each character stands at the deadline and calls
--    public.live_stand_close with the host token (the Space has no service-role key). That call writes the answers,
--    closes the question at once (meldy_private.live_close_stand: points, ghosts = live_players.frozen, revives =
--    thaws) and returns every player's result. An open stand question nobody closes closes by itself 8 s after
--    q_closes_at (no answers).
-- 3. Battle games are unchanged: the same JSON (settings.boss and boss.kind appear only in stand games), the same numbers.
-- Changed functions (whole bodies, as in 20261021090000_live_game.sql plus the stand branch): live_due, live_countdown,
-- live_close, live_advance, live_base_json, live_host_json, live_create, live_answer. New: live_stand_points,
-- live_close_stand, live_stand_result (meldy_private) and public.live_stand_close.
-- Re-runnable: IF NOT EXISTS, OR REPLACE, guarded blocks. The whole file is one request (supabase/migrate.py).

do $do$
begin
  if pg_catalog.to_regprocedure('meldy_private.live_close(uuid)') is null
     or pg_catalog.to_regprocedure('public.live_next(uuid, text, text)') is null then
    raise exception 'the base is expected: 20261021090000_live_game.sql';
  end if;
end;
$do$;

-- ─────────────────────────────────────────── 1. Columns and checks ───────────────────────────────────────────

alter table public.live_games add column if not exists boss_kind text not null default 'clock';
do $do$
begin
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'public.live_games'::regclass and k.conname = 'live_games_mode_check'
                and pg_catalog.pg_get_constraintdef(k.oid) not like '%stand%') then
    alter table public.live_games drop constraint live_games_mode_check;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_games'::regclass and k.conname = 'live_games_mode_check') then
    alter table public.live_games add constraint live_games_mode_check check (mode in ('boss', 'stand'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_games'::regclass and k.conname = 'live_games_boss_kind_check') then
    alter table public.live_games add constraint live_games_boss_kind_check check (boss_kind in ('clock', 'skeleton'));
  end if;
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'public.live_games'::regclass and k.conname = 'live_games_time_check'
                and pg_catalog.pg_get_constraintdef(k.oid) not like '%stand%') then
    alter table public.live_games drop constraint live_games_time_check;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_games'::regclass and k.conname = 'live_games_time_check') then
    alter table public.live_games add constraint live_games_time_check
      check (case when mode = 'stand' then time_s in (15, 20, 30) else time_s in (10, 20, 30) end);
  end if;
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'public.live_answers'::regclass and k.conname = 'live_answers_dmg_check'
                and pg_catalog.pg_get_constraintdef(k.oid) not like '%1400%') then
    alter table public.live_answers drop constraint live_answers_dmg_check;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_answers'::regclass and k.conname = 'live_answers_dmg_check') then
    alter table public.live_answers add constraint live_answers_dmg_check check (dmg is null or dmg between 0 and 1400);
  end if;
end;
$do$;
comment on column public.live_games.boss_kind is 'The boss the teacher picked for a movement game: clock (the alarm-clock brute) or skeleton.';

-- ─────────────────────────────────────────── 2. The points (MODE_STAND.md §6) ───────────────────────────────────────────

-- early = speed ? max(0, 1 − elapsed / T) : 1; base = 500 + 500 × early; alive: × (1 + 0.1 × min(streak_after − 1, 4));
-- a ghost: × 0.5 (no streak bonus); then 10 × round(x / 10), rounded as Math.round of the double (floor(x + 0.5)).
create or replace function meldy_private.live_stand_points(p_elapsed_ms integer, p_time_s integer, p_streak_after integer,
                                                           p_speed boolean, p_ghost boolean)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select (10 * pg_catalog.floor(
           (500::float8 + 500::float8 * (case when p_speed
                                              then greatest(0::float8, 1::float8 - least(greatest(p_elapsed_ms, 0), p_time_s * 1000)::float8
                                                                                 / (p_time_s * 1000)::float8)
                                              else 1::float8 end))
           * (case when p_ghost then 0.5::float8
                   else 1::float8 + 0.1::float8 * least(greatest(p_streak_after - 1, 0), 4)::float8 end)
           / 10::float8 + 0.5::float8))::integer
$fn$;

-- ─────────────────────────────────────────── 3. The engine with the stand branch ───────────────────────────────────────────

-- 3b. An open stand question waits 8 s past q_closes_at for the room's answers (battle: 1.5 s).
create or replace function meldy_private.live_due(p_g public.live_games, p_now timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select (p_g.state <> 'ended' and p_now >= p_g.created_at + interval '3 hours')
      or (p_g.state = 'countdown' and p_now >= p_g.q_opens_at)
      or (p_g.state = 'open' and p_now > p_g.q_closes_at + case when p_g.mode = 'stand' then interval '8 seconds'
                                                                  else interval '1.5 seconds' end)
      or (p_g.state in ('reveal', 'leaderboard') and p_now >= p_g.state_at + interval '30 seconds')
$fn$;

-- 3c. No HP in a stand game.
create or replace function meldy_private.live_countdown(p_game uuid, p_qi integer)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_g public.live_games;
  v_now timestamptz := pg_catalog.now();
  v_opens timestamptz := pg_catalog.now() + interval '3 seconds';
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if p_qi = 0 and v_g.mode = 'boss' then
    v_g.hp_max := (select pg_catalog.count(*)::integer from public.live_players p
                    where p.game_id = p_game and p.kicked_at is null) * v_g.q_count * 55;
    v_g.hp := v_g.hp_max;
  end if;
  update public.live_questions q
     set phase = v_g.phase, opens_at = v_opens, closes_at = v_opens + pg_catalog.make_interval(secs => v_g.time_s)
   where q.game_id = p_game and q.qi = p_qi;
  update public.live_games g
     set state = 'countdown', state_at = v_now, qi = p_qi, q_ready_at = v_now, q_opens_at = v_opens,
         q_closes_at = v_opens + pg_catalog.make_interval(secs => v_g.time_s), hp_max = v_g.hp_max, hp = v_g.hp,
         rev = g.rev + 1
   where g.id = p_game;
end;
$fn$;

-- 3d. A stand game closes its own way (live_close_stand).
create or replace function meldy_private.live_close(p_game uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_g public.live_games;
  v_q public.live_questions;
  v_p public.live_players;
  v_a record;
  v_hp integer;
  v_right integer := 0;
  v_dmg integer;
  v_hits jsonb := '[]'::jsonb;
  v_frozen uuid[] := '{}'::uuid[];
  v_thawed uuid[] := '{}'::uuid[];
  v_none uuid[];
  v_active integer;
  v_healed integer := 0;
  v_phase smallint;
  v_rank uuid[];
  v_counts integer[];
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if v_g.mode = 'stand' then
    perform meldy_private.live_close_stand(p_game);
    return;
  end if;
  select q.* into v_q from public.live_questions q where q.game_id = p_game and q.qi = v_g.qi;
  if v_g.state <> 'open' or v_q.closed_at is not null then
    return;
  end if;
  v_rank := meldy_private.live_rank(p_game);
  v_hp := v_g.hp;
  v_counts := pg_catalog.array_fill(0, array[pg_catalog.jsonb_array_length(v_q.options)]);
  for v_a in
    select a.player_id, a.choice, a.elapsed_ms
      from public.live_answers a
      join public.live_players p on p.id = a.player_id
     where a.game_id = p_game and a.qi = v_g.qi and p.kicked_at is null
     order by a.elapsed_ms, a.player_id
  loop
    select p.* into v_p from public.live_players p where p.id = v_a.player_id;
    v_counts[v_a.choice + 1] := v_counts[v_a.choice + 1] + 1;
    if v_a.choice = v_q.key then
      v_right := v_right + 1;
      if v_p.frozen then
        update public.live_players p
           set frozen = false, streak = 1, thaws = p.thaws + 1, best = greatest(p.best, 1), right_n = p.right_n + 1
         where p.id = v_p.id;
        update public.live_answers a set correct = true, dmg = 0
         where a.game_id = p_game and a.qi = v_g.qi and a.player_id = v_p.id;
        v_thawed := v_thawed || v_p.id;
      else
        v_dmg := meldy_private.live_damage(v_a.elapsed_ms, v_g.time_s, v_p.streak + 1, v_g.speed);
        v_hp := greatest(0, v_hp - v_dmg);
        update public.live_players p
           set streak = p.streak + 1, best = greatest(p.best, p.streak + 1), dmg = p.dmg + v_dmg, right_n = p.right_n + 1
         where p.id = v_p.id;
        update public.live_answers a set correct = true, dmg = v_dmg
         where a.game_id = p_game and a.qi = v_g.qi and a.player_id = v_p.id;
        v_hits := v_hits || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('player_id', v_p.id, 'dmg', v_dmg, 'hp_after', v_hp));
      end if;
    else
      if not v_p.frozen then
        v_frozen := v_frozen || v_p.id;
      end if;
      update public.live_players p set streak = 0, frozen = true where p.id = v_p.id;
      update public.live_answers a set correct = false, dmg = 0
       where a.game_id = p_game and a.qi = v_g.qi and a.player_id = v_p.id;
    end if;
  end loop;
  -- No answer from an active player: those not yet frozen are frozen now from phase 1.
  select coalesce(pg_catalog.array_agg(p.id order by p.joined_at, p.id), '{}'::uuid[]) into v_none
    from public.live_players p
   where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_q.opens_at and not p.frozen
     and not exists (select 1 from public.live_answers a where a.game_id = p_game and a.qi = v_g.qi and a.player_id = p.id);
  if v_q.phase >= 1 then
    v_frozen := v_frozen || v_none;
  end if;
  update public.live_players p
     set streak = 0, frozen = p.frozen or v_q.phase >= 1
   where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_q.opens_at
     and not exists (select 1 from public.live_answers a where a.game_id = p_game and a.qi = v_g.qi and a.player_id = p.id);
  select pg_catalog.count(*)::integer into v_active
    from public.live_players p
   where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_q.opens_at;
  if v_q.phase = 2 and v_hp > 0 and v_right < meldy_private.live_right_needed(v_active) then
    v_healed := least(meldy_private.live_heal(v_g.hp_max), v_g.hp_max - v_hp);
    v_hp := v_hp + v_healed;
  end if;
  v_phase := greatest(v_g.phase, meldy_private.live_phase_for(v_hp, v_g.hp_max));
  update public.live_questions q
     set closed_at = pg_catalog.now(), counts = v_counts, right_n = v_right, healed = v_healed,
         phase_changed = case when v_phase > v_g.phase then v_phase end, hits = v_hits, frozen_now = v_frozen,
         thawed = v_thawed, rank_before = v_rank
   where q.game_id = p_game and q.qi = v_g.qi;
  update public.live_games g
     set state = 'reveal', state_at = pg_catalog.now(), hp = v_hp, phase = v_phase, rev = g.rev + 1
   where g.id = p_game;
end;
$fn$;

-- 3d'. Closing a stand question: answers of players not kicked in order of elapsed_ms, then player id. Right and alive:
--      streak + 1, points by time and streak. Right and a ghost: half points, alive again (thaws + 1), streak 0. Wrong:
--      streak 0, a ghost (frozen). No answer from an active player (not kicked, joined by q_opens_at): streak 0, a ghost.
--      frozen_now = those who fell now, thawed = the revived, hits = [{player_id, dmg: points, hp_after: 0}]. → reveal.
create or replace function meldy_private.live_close_stand(p_game uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_g public.live_games;
  v_q public.live_questions;
  v_p public.live_players;
  v_a record;
  v_right integer := 0;
  v_pts integer;
  v_hits jsonb := '[]'::jsonb;
  v_fell uuid[] := '{}'::uuid[];
  v_revived uuid[] := '{}'::uuid[];
  v_none uuid[];
  v_rank uuid[];
  v_counts integer[];
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  select q.* into v_q from public.live_questions q where q.game_id = p_game and q.qi = v_g.qi;
  if v_g.state <> 'open' or v_q.closed_at is not null then
    return;
  end if;
  v_rank := meldy_private.live_rank(p_game);
  v_counts := pg_catalog.array_fill(0, array[pg_catalog.jsonb_array_length(v_q.options)]);
  for v_a in
    select a.player_id, a.choice, a.elapsed_ms
      from public.live_answers a
      join public.live_players p on p.id = a.player_id
     where a.game_id = p_game and a.qi = v_g.qi and p.kicked_at is null
     order by a.elapsed_ms, a.player_id
  loop
    select p.* into v_p from public.live_players p where p.id = v_a.player_id;
    v_counts[v_a.choice + 1] := v_counts[v_a.choice + 1] + 1;
    if v_a.choice = v_q.key then
      v_right := v_right + 1;
      v_pts := meldy_private.live_stand_points(v_a.elapsed_ms, v_g.time_s, v_p.streak + 1, v_g.speed, v_p.frozen);
      if v_p.frozen then
        update public.live_players p
           set frozen = false, streak = 0, thaws = p.thaws + 1, dmg = p.dmg + v_pts, right_n = p.right_n + 1
         where p.id = v_p.id;
        v_revived := v_revived || v_p.id;
      else
        update public.live_players p
           set streak = p.streak + 1, best = greatest(p.best, p.streak + 1), dmg = p.dmg + v_pts, right_n = p.right_n + 1
         where p.id = v_p.id;
      end if;
      update public.live_answers a set correct = true, dmg = v_pts
       where a.game_id = p_game and a.qi = v_g.qi and a.player_id = v_p.id;
      v_hits := v_hits || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('player_id', v_p.id, 'dmg', v_pts, 'hp_after', 0));
    else
      if not v_p.frozen then
        v_fell := v_fell || v_p.id;
      end if;
      update public.live_players p set streak = 0, frozen = true where p.id = v_p.id;
      update public.live_answers a set correct = false, dmg = 0
       where a.game_id = p_game and a.qi = v_g.qi and a.player_id = v_p.id;
    end if;
  end loop;
  -- No answer from an active player: the floor goes from under them too.
  select coalesce(pg_catalog.array_agg(p.id order by p.joined_at, p.id), '{}'::uuid[]) into v_none
    from public.live_players p
   where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_q.opens_at and not p.frozen
     and not exists (select 1 from public.live_answers a where a.game_id = p_game and a.qi = v_g.qi and a.player_id = p.id);
  v_fell := v_fell || v_none;
  update public.live_players p
     set streak = 0, frozen = true
   where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_q.opens_at
     and not exists (select 1 from public.live_answers a where a.game_id = p_game and a.qi = v_g.qi and a.player_id = p.id);
  update public.live_questions q
     set closed_at = pg_catalog.now(), counts = v_counts, right_n = v_right, healed = 0, phase_changed = null, hits = v_hits,
         frozen_now = v_fell, thawed = v_revived, rank_before = v_rank
   where q.game_id = p_game and q.qi = v_g.qi;
  update public.live_games g
     set state = 'reveal', state_at = pg_catalog.now(), rev = g.rev + 1
   where g.id = p_game;
end;
$fn$;

-- 3f. Podium after the last question; only a battle ends early by the boss's defeat.
create or replace function meldy_private.live_advance(p_game uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_g public.live_games;
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if v_g.state = 'lobby' then
    perform meldy_private.live_countdown(p_game, 0);
  elsif v_g.state = 'reveal' then
    if (v_g.mode = 'boss' and v_g.hp = 0) or v_g.qi >= v_g.q_count - 1 then
      perform meldy_private.live_podium(p_game);
    else
      update public.live_games g set state = 'leaderboard', state_at = pg_catalog.now(), rev = g.rev + 1 where g.id = p_game;
    end if;
  elsif v_g.state = 'leaderboard' then
    perform meldy_private.live_countdown(p_game, v_g.qi + 1);
  elsif v_g.state = 'podium' then
    update public.live_games g
       set state = 'ended', state_at = pg_catalog.now(), ended_at = pg_catalog.now(), end_reason = 'podium', rev = g.rev + 1
     where g.id = p_game;
  end if;
end;
$fn$;

-- ─────────────────────────────────────────── 4. What the screens read ───────────────────────────────────────────

-- 4a. boss.kind in a stand game.
create or replace function meldy_private.live_base_json(p_g public.live_games)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_q public.live_questions;
  v_rank uuid[];
  v_top jsonb;
  v_question jsonb;
begin
  if p_g.qi >= 0 then
    select q.* into v_q from public.live_questions q where q.game_id = p_g.id and q.qi = p_g.qi;
  end if;
  if p_g.qi >= 0 and p_g.state in ('countdown', 'open', 'reveal', 'leaderboard') then
    v_question := pg_catalog.jsonb_build_object(
      'qi', p_g.qi, 'text', v_q.text, 'options', v_q.options, 'opens_at', meldy_private.live_iso(v_q.opens_at),
      'closes_at', meldy_private.live_iso(v_q.closes_at), 'phase', v_q.phase, 'picture', null);
  end if;
  if p_g.state in ('leaderboard', 'podium') or (p_g.state = 'ended' and p_g.won is not null) then
    v_rank := meldy_private.live_rank(p_g.id);
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'player_id', p.id, 'name', p.name, 'look', p.look, 'dmg', p.dmg,
             'move', case when p_g.qi > 0 and pg_catalog.array_position(v_q.rank_before, p.id) is not null
                          then pg_catalog.array_position(v_q.rank_before, p.id) - r.place::integer else 0 end)
             order by r.place), '[]'::jsonb)
      into v_top
      from pg_catalog.unnest(v_rank[1:5]) with ordinality as r(id, place)
      join public.live_players p on p.id = r.id;
  end if;
  return pg_catalog.jsonb_build_object(
    'rev', p_g.rev,
    'now', meldy_private.live_iso(pg_catalog.clock_timestamp()),
    'state', p_g.state,
    'mode', p_g.mode,
    'qi', p_g.qi,
    'q_count', p_g.q_count,
    'time_s', p_g.time_s,
    'speed', p_g.speed,
    'players', (select pg_catalog.count(*) from public.live_players p where p.game_id = p_g.id and p.kicked_at is null),
    'answered', case when p_g.qi >= 0 then
                  (select pg_catalog.count(*) from public.live_answers a join public.live_players p on p.id = a.player_id
                    where a.game_id = p_g.id and a.qi = p_g.qi and p.kicked_at is null) else 0 end,
    'question', v_question,
    'boss', pg_catalog.jsonb_build_object('hp', p_g.hp, 'hp_max', p_g.hp_max, 'phase', p_g.phase,
                                          'defeated', p_g.hp_max > 0 and p_g.hp = 0)
            || case when p_g.mode = 'boss' then '{}'::jsonb else pg_catalog.jsonb_build_object('kind', p_g.boss_kind) end,
    'top', v_top);
end;
$fn$;

-- 4d. settings.boss in a stand game.
create or replace function meldy_private.live_host_json(p_g public.live_games)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_closed jsonb := meldy_private.live_closed_json(p_g);
  v_q public.live_questions;
  v_result jsonb;
  v_final jsonb;
begin
  if v_closed is not null then
    select q.* into v_q from public.live_questions q where q.game_id = p_g.id and q.qi = p_g.qi;
    v_result := v_closed || pg_catalog.jsonb_build_object(
      'hits', coalesce(v_q.hits, '[]'::jsonb), 'frozen_now', pg_catalog.to_jsonb(coalesce(v_q.frozen_now, '{}'::uuid[])),
      'thawed', pg_catalog.to_jsonb(coalesce(v_q.thawed, '{}'::uuid[])));
  end if;
  if p_g.state in ('podium', 'ended') and p_g.won is not null then
    v_final := (select pg_catalog.jsonb_build_object('won', p_g.won, 'accuracy_pct',
                         meldy_private.live_accuracy(coalesce(pg_catalog.sum(p.right_n), 0)::integer, pg_catalog.count(*)::integer,
                                                     p_g.qi + 1))
                  from public.live_players p where p.game_id = p_g.id and p.kicked_at is null);
  end if;
  return meldy_private.live_base_json(p_g) || pg_catalog.jsonb_build_object(
    'pin', p_g.pin,
    'topic', p_g.topic,
    'settings', pg_catalog.jsonb_build_object('mode', p_g.mode, 'time_s', p_g.time_s, 'speed', p_g.speed, 'who', p_g.who,
                                              'chat_names', p_g.chat_names)
                || case when p_g.mode = 'boss' then '{}'::jsonb else pg_catalog.jsonb_build_object('boss', p_g.boss_kind) end,
    'skipped', p_g.skipped,
    'roster', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'player_id', p.id, 'name', p.name, 'look', p.look, 'dmg', p.dmg, 'right', p.right_n, 'streak', p.streak,
                 'frozen', p.frozen, 'joined_at', meldy_private.live_iso(p.joined_at),
                 'answered', p_g.qi >= 0 and exists (select 1 from public.live_answers a
                                                      where a.game_id = p_g.id and a.qi = p_g.qi and a.player_id = p.id))
                 order by p.joined_at, p.id), '[]'::jsonb)
                 from public.live_players p where p.game_id = p_g.id and p.kicked_at is null),
    'answered_ids', case when p_g.state = 'open' then
                      (select coalesce(pg_catalog.jsonb_agg(a.player_id order by a.at, a.player_id), '[]'::jsonb)
                         from public.live_answers a join public.live_players p on p.id = a.player_id
                        where a.game_id = p_g.id and a.qi = p_g.qi and p.kicked_at is null)
                    else '[]'::jsonb end,
    'result', v_result,
    'final', v_final);
end;
$fn$;

-- 4f. A closed stand question as the room reads it: the key, counts and every player not kicked (choice, right, points,
--     elapsed, fell now, revived, a ghost after it, joined too late to count, the totals and the place).
create or replace function meldy_private.live_stand_result(p_game uuid, p_qi integer, p_again boolean)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'qi', q.qi, 'key', q.key, 'counts', pg_catalog.to_jsonb(q.counts), 'right', q.right_n,
    'active', (select pg_catalog.count(*) from public.live_players p
                where p.game_id = p_game and p.kicked_at is null and p.joined_at <= q.opens_at),
    'again', p_again,
    'now', meldy_private.live_iso(pg_catalog.clock_timestamp()),
    'rows', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'p', p.id, 'c', a.choice, 'ok', coalesce(a.correct, false), 'pts', coalesce(a.dmg, 0), 'ms', a.elapsed_ms,
               'fell', p.id = any (coalesce(q.frozen_now, '{}'::uuid[])), 'revived', p.id = any (coalesce(q.thawed, '{}'::uuid[])),
               'ghost', p.frozen, 'out', p.joined_at > q.opens_at, 'total', p.dmg, 'streak', p.streak, 'best', p.best,
               'right', p.right_n, 'place', r.place::integer) order by r.place), '[]'::jsonb)
               from pg_catalog.unnest(meldy_private.live_rank(p_game)) with ordinality as r(id, place)
               join public.live_players p on p.id = r.id
               left join public.live_answers a on a.game_id = p_game and a.qi = q.qi and a.player_id = p.id))
    from public.live_questions q
   where q.game_id = p_game and q.qi = p_qi and q.closed_at is not null
$fn$;

-- ─────────────────────────────────────────── 6. The host ───────────────────────────────────────────

-- 6a. Create: settings.mode 'boss' | 'stand', settings.boss 'clock' | 'skeleton'; a stand game takes 15, 20 or 30 s.
create or replace function public.live_create(p_source jsonb, p_settings jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_mode text;
  v_boss text;
  v_time integer;
  v_speed boolean;
  v_who text;
  v_names boolean;
  v_quiz public.quizzes;
  v_container uuid;
  v_title text;
  v_subjects uuid[];
  v_count integer;
  v_candidates uuid[];
  v_items uuid[];
  v_skipped integer;
  v_token text := meldy_private.live_new_token(32);
  v_g public.live_games;
  v_item public.test_items;
  v_shown smallint[];
  v_flags jsonb;
  v_bot text;
  v_ord integer;
begin
  if v_user is null then
    perform meldy_private.live_fail('28000', null, 401);
  end if;
  -- Settings (defaults for the keys left out).
  if pg_catalog.jsonb_typeof(v_settings) <> 'object' then
    perform meldy_private.live_fail('22023', 'settings');
  end if;
  v_mode := coalesce(v_settings ->> 'mode', 'boss');
  if v_mode not in ('boss', 'stand') then
    perform meldy_private.live_fail('22023', 'mode');
  end if;
  v_boss := coalesce(v_settings ->> 'boss', 'clock');
  if v_boss not in ('clock', 'skeleton') then
    perform meldy_private.live_fail('22023', 'boss');
  end if;
  if v_settings ? 'time_s' and (pg_catalog.jsonb_typeof(v_settings -> 'time_s') <> 'number'
                                or not ((v_settings ->> 'time_s') = any (case when v_mode = 'stand' then array['15', '20', '30']
                                                                              else array['10', '20', '30'] end))) then
    perform meldy_private.live_fail('22023', 'time_s');
  end if;
  v_time := coalesce((v_settings ->> 'time_s')::integer, case when v_mode = 'stand' then 15 else 20 end);
  if v_settings ? 'speed' and pg_catalog.jsonb_typeof(v_settings -> 'speed') <> 'boolean' then
    perform meldy_private.live_fail('22023', 'speed');
  end if;
  v_speed := coalesce((v_settings ->> 'speed')::boolean, true);
  v_who := coalesce(v_settings ->> 'who', 'pin');
  if v_who not in ('pin', 'members') or (v_settings ? 'who' and pg_catalog.jsonb_typeof(v_settings -> 'who') <> 'string') then
    perform meldy_private.live_fail('22023', 'who');
  end if;
  if v_settings ? 'chat_names' and pg_catalog.jsonb_typeof(v_settings -> 'chat_names') <> 'boolean' then
    perform meldy_private.live_fail('22023', 'chat_names');
  end if;
  v_names := coalesce((v_settings ->> 'chat_names')::boolean, true);
  -- The source.
  if p_source is null or pg_catalog.jsonb_typeof(p_source) <> 'object' then
    perform meldy_private.live_fail('22023', 'source');
  end if;
  if p_source ? 'quiz_id' then
    if (p_source ->> 'quiz_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform meldy_private.live_fail('22023', 'quiz_id');
    end if;
    select q.* into v_quiz from public.quizzes q where q.id = (p_source ->> 'quiz_id')::uuid;
    if not found then
      perform meldy_private.live_fail('P0002', 'quiz', 404);
    end if;
    if v_quiz.owner_id <> v_user
       or not exists (select 1 from public.containers c where c.id = v_quiz.container_id and c.owner_id = v_user) then
      perform meldy_private.live_fail('42501', 'author', 403);
    end if;
    v_container := v_quiz.container_id;
    v_title := v_quiz.title;
  elsif p_source ? 'container_id' then
    if (p_source ->> 'container_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform meldy_private.live_fail('22023', 'container_id');
    end if;
    v_container := (p_source ->> 'container_id')::uuid;
    select c.title into v_title from public.containers c where c.id = v_container;
    if not found then
      perform meldy_private.live_fail('P0002', 'container', 404);
    end if;
    if not exists (select 1 from public.containers c where c.id = v_container and c.owner_id = v_user) then
      perform meldy_private.live_fail('42501', 'author', 403);
    end if;
    if pg_catalog.jsonb_typeof(p_source -> 'subject_ids') is distinct from 'array'
       or pg_catalog.jsonb_array_length(p_source -> 'subject_ids') not between 1 and 50
       or exists (select 1 from pg_catalog.jsonb_array_elements(p_source -> 'subject_ids') s
                   where pg_catalog.jsonb_typeof(s) <> 'string'
                      or (s #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      perform meldy_private.live_fail('22023', 'subject_ids');
    end if;
    select pg_catalog.array_agg(distinct (s #>> '{}')::uuid) into v_subjects
      from pg_catalog.jsonb_array_elements(p_source -> 'subject_ids') s;
    if exists (select 1 from pg_catalog.unnest(v_subjects) x(id)
                where not exists (select 1 from public.container_subjects cs where cs.id = x.id and cs.container_id = v_container)) then
      perform meldy_private.live_fail('22023', 'subject_ids');
    end if;
    if pg_catalog.jsonb_typeof(p_source -> 'count') is distinct from 'number'
       or (p_source ->> 'count') !~ '^[0-9]{1,2}$' or (p_source ->> 'count')::integer not between 3 and 30 then
      perform meldy_private.live_fail('22023', 'count');
    end if;
    v_count := (p_source ->> 'count')::integer;
  else
    perform meldy_private.live_fail('22023', 'source');
  end if;
  -- One author's creates in turn; the limits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('live.create:' || v_user::text, 0));
  update public.live_games g
     set state = 'ended', state_at = pg_catalog.now(), ended_at = pg_catalog.now(), end_reason = 'expired', rev = g.rev + 1
   where g.id in (select x.id from public.live_games x
                   where x.state <> 'ended' and x.created_at < pg_catalog.now() - interval '3 hours'
                   order by x.created_at limit 200);
  delete from public.live_games g
   where g.id in (select x.id from public.live_games x
                   where x.state = 'ended' and x.ended_at < pg_catalog.now() - interval '8 days'
                   order by x.ended_at limit 50);
  if (select pg_catalog.count(*) from public.live_games g
       where g.owner_id = v_user and g.created_at > pg_catalog.now() - interval '1 hour') >= 10 then
    perform meldy_private.live_fail('ML005', 'create', 429, meldy_private.live_retry_after(
      (select pg_catalog.min(g.created_at) from public.live_games g
        where g.owner_id = v_user and g.created_at > pg_catalog.now() - interval '1 hour'), interval '1 hour'));
  end if;
  if (select pg_catalog.count(*) from public.live_games g
       where g.owner_id = v_user and g.state not in ('podium', 'ended')) >= 3 then
    perform meldy_private.live_fail('ML009', null);
  end if;
  -- The questions.
  if v_quiz.id is not null then
    v_candidates := meldy_private.quiz_draw(v_quiz);
    select coalesce(pg_catalog.array_agg(x.id order by x.ord), '{}'::uuid[]) into v_items
      from pg_catalog.unnest(v_candidates) with ordinality as x(id, ord)
      join public.test_items i on i.id = x.id
     where meldy_private.live_playable(i);
    v_skipped := pg_catalog.cardinality(v_candidates) - pg_catalog.cardinality(v_items);
    v_items := v_items[1:30];
  else
    v_candidates := meldy_private.quiz_pool(v_container, v_subjects);
    select coalesce(pg_catalog.array_agg(x.id order by x.ord), '{}'::uuid[]) into v_items
      from (select y.id, y.ord
              from pg_catalog.unnest(v_candidates) with ordinality as y(id, ord)
              join public.test_items i on i.id = y.id
             where meldy_private.live_playable(i)
             order by pg_catalog.random()
             limit v_count) x;
    v_skipped := pg_catalog.cardinality(v_candidates)
                 - (select pg_catalog.count(*)::integer from pg_catalog.unnest(v_candidates) y(id)
                      join public.test_items i on i.id = y.id where meldy_private.live_playable(i));
  end if;
  if pg_catalog.cardinality(v_items) = 0 then
    perform meldy_private.live_fail('ML008', v_skipped::text);
  end if;
  -- The game, with a PIN no open game holds.
  for v_attempt in 1 .. 30 loop
    begin
      insert into public.live_games (owner_id, container_id, quiz_id, title, pin, topic, host_hash, time_s, speed, who,
                                     chat_names, q_count, skipped, mode, boss_kind)
      values (v_user, v_container, v_quiz.id, pg_catalog.left(pg_catalog.btrim(v_title), 200),
              (100000 + pg_catalog.floor(pg_catalog.random() * 900000))::integer::text,
              meldy_private.live_new_token(16), meldy_private.live_hash(v_token), v_time, v_speed, v_who, v_names,
              pg_catalog.cardinality(v_items), v_skipped, v_mode, v_boss)
      returning * into v_g;
      exit;
    exception
      when unique_violation then
        if v_attempt = 30 then
          raise;
        end if;
    end;
  end loop;
  v_ord := 0;
  for v_item in
    select i.* from pg_catalog.unnest(v_items) with ordinality as x(id, ord) join public.test_items i on i.id = x.id order by x.ord
  loop
    if v_item.keep_order then
      select pg_catalog.array_agg(s::smallint order by s) into v_shown
        from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(v_item.options) - 1) s;
    else
      select pg_catalog.array_agg(s::smallint order by pg_catalog.random()) into v_shown
        from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(v_item.options) - 1) s;
    end if;
    insert into public.live_questions (game_id, qi, item_id, text, options, shown, key)
    values (v_g.id, v_ord, v_item.id, v_item.stem,
            (select pg_catalog.jsonb_agg(v_item.options -> s.f::integer order by s.n)
               from pg_catalog.unnest(v_shown) with ordinality as s(f, n)),
            v_shown, (pg_catalog.array_position(v_shown, v_item.correct[1]) - 1)::smallint);
    v_ord := v_ord + 1;
  end loop;
  select c.flags, c.bot_username into v_flags, v_bot from bot.config c where c.id = 1;
  v_bot := coalesce(v_bot, 'Meldyteach_bot');
  return pg_catalog.jsonb_build_object(
    'game_id', v_g.id, 'pin', v_g.pin, 'topic', v_g.topic, 'host_token', v_token, 'q_count', v_g.q_count,
    'skipped', v_g.skipped,
    'join_url', 'https://ludosiel-studyforge.hf.space/play?pin=' || v_g.pin,
    'tg_url', case when coalesce(v_flags ->> 'live_direct', 'false') = 'true'
                   then 'https://t.me/' || v_bot || '/play?startapp=' || v_g.pin
                   else 'https://t.me/' || v_bot || '?start=play_' || v_g.pin end);
end;
$fn$;

-- 6f. The room's answers to an open stand question (MODE_STAND.md §6): p_answers = [{"p": player id, "c": zone = option
--     index, "e": elapsed ms}], one per player, at most 300; players kicked, of another game or joined after the question
--     opened are left out. Writes them, closes the question and returns live_stand_result. A question already closed
--     (a retry after a lost answer, or closed by time) is returned as it is with "again": true. Authorised by the host
--     token, like live_next. ML004 early: countdown, or more than 1 s before q_closes_at.
create or replace function public.live_stand_close(p_game uuid, p_host_token text, p_qi integer, p_answers jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_g public.live_games := meldy_private.live_host_game(p_game, p_host_token, true);
  v_q public.live_questions;
  v_n integer;
begin
  if v_g.mode <> 'stand' then
    perform meldy_private.live_fail('22023', 'mode');
  end if;
  if p_qi is null or p_qi < 0 or p_qi > v_g.qi then
    perform meldy_private.live_fail('ML004', 'bad_qi');
  end if;
  select q.* into v_q from public.live_questions q where q.game_id = p_game and q.qi = p_qi;
  if v_q.closed_at is not null then
    return meldy_private.live_stand_result(p_game, p_qi, true);
  end if;
  if p_qi <> v_g.qi then
    perform meldy_private.live_fail('ML004', 'bad_qi');
  end if;
  if v_g.state <> 'open' or pg_catalog.now() < v_g.q_closes_at - interval '1 second' then
    perform meldy_private.live_fail('ML004', 'early');
  end if;
  v_n := pg_catalog.jsonb_array_length(v_q.options);
  if p_answers is null or pg_catalog.jsonb_typeof(p_answers) <> 'array' or pg_catalog.jsonb_array_length(p_answers) > 300
     or exists (select 1 from pg_catalog.jsonb_array_elements(p_answers) e
                 where case when pg_catalog.jsonb_typeof(e) <> 'object' then true
                            when pg_catalog.jsonb_typeof(e -> 'p') is distinct from 'string'
                                 or (e ->> 'p') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then true
                            when pg_catalog.jsonb_typeof(e -> 'c') is distinct from 'number' or (e ->> 'c') !~ '^[0-3]$' then true
                            when (e ->> 'c')::integer >= v_n then true
                            when pg_catalog.jsonb_typeof(e -> 'e') is distinct from 'number' or (e ->> 'e') !~ '^[0-9]{1,5}$' then true
                            else (e ->> 'e')::integer > v_g.time_s * 1000 end)
     or (select pg_catalog.count(distinct pg_catalog.lower(e ->> 'p')) from pg_catalog.jsonb_array_elements(p_answers) e)
        <> pg_catalog.jsonb_array_length(p_answers) then
    perform meldy_private.live_fail('22023', 'answers');
  end if;
  insert into public.live_answers (game_id, qi, player_id, choice, at, elapsed_ms)
  select p_game, v_g.qi, p.id, (e ->> 'c')::smallint, pg_catalog.now(), (e ->> 'e')::integer
    from pg_catalog.jsonb_array_elements(p_answers) e
    join public.live_players p on p.id = (e ->> 'p')::uuid
   where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_g.q_opens_at
  on conflict do nothing;
  perform meldy_private.live_close(p_game);
  return meldy_private.live_stand_result(p_game, p_qi, false);
end;
$fn$;

-- ─────────────────────────────────────────── 7. The player ───────────────────────────────────────────

-- 7e. A stand game takes no taps: ML004 stand.
create or replace function public.live_answer(p_game uuid, p_token text, p_qi integer, p_choice integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p public.live_players := meldy_private.live_player_of(p_game, p_token, true);
  v_g public.live_games;
  v_now timestamptz := pg_catalog.now();
  v_options integer;
  v_answered integer;
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if v_g.mode = 'stand' then
    perform meldy_private.live_fail('ML004', 'stand');
  end if;
  if v_g.qi < 0 or p_qi is null or p_qi <> v_g.qi then
    perform meldy_private.live_fail('ML004', 'bad_qi');
  end if;
  if v_g.state = 'countdown' or v_now < v_g.q_opens_at then
    perform meldy_private.live_fail('ML004', 'early');
  end if;
  if v_g.state <> 'open' then
    perform meldy_private.live_fail('ML004', case when v_now > v_g.q_closes_at then 'late' else 'not_open' end);
  end if;
  if v_now > v_g.q_closes_at + interval '1.5 seconds' then
    perform meldy_private.live_fail('ML004', 'late');
  end if;
  if v_p.joined_at > v_g.q_opens_at then
    perform meldy_private.live_fail('ML004', 'not_joined_yet');
  end if;
  if exists (select 1 from public.live_answers a where a.game_id = p_game and a.qi = v_g.qi and a.player_id = v_p.id) then
    perform meldy_private.live_fail('ML004', 'twice');
  end if;
  select pg_catalog.jsonb_array_length(q.options) into v_options from public.live_questions q
   where q.game_id = p_game and q.qi = v_g.qi;
  if p_choice is null or p_choice < 0 or p_choice >= v_options then
    perform meldy_private.live_fail('22023', 'choice');
  end if;
  insert into public.live_answers (game_id, qi, player_id, choice, at, elapsed_ms)
  values (p_game, v_g.qi, v_p.id, p_choice, v_now,
          least(greatest(pg_catalog.floor(extract(epoch from (v_now - v_g.q_opens_at)) * 1000), 0), v_g.time_s * 1000)::integer);
  select pg_catalog.count(*)::integer into v_answered
    from public.live_answers a join public.live_players p on p.id = a.player_id
   where a.game_id = p_game and a.qi = v_g.qi and p.kicked_at is null;
  perform meldy_private.live_close_if_all(p_game);
  return pg_catalog.jsonb_build_object('accepted', true, 'answered', v_answered,
                                       'now', meldy_private.live_iso(pg_catalog.clock_timestamp()));
end;
$fn$;

-- ─────────────────────────────────────────── 9. Grants ───────────────────────────────────────────
-- create or replace keeps the grants of the changed functions; the new ones: taken back, then given as the contract says.
revoke all on function
  meldy_private.live_stand_points(integer, integer, integer, boolean, boolean), meldy_private.live_close_stand(uuid),
  meldy_private.live_stand_result(uuid, integer, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.live_stand_close(uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.live_stand_close(uuid, text, integer, jsonb) to anon, authenticated;
