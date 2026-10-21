-- Rollback of supabase/migrations/20261022090000_live_stand.sql: the catalog of 20261021090000_live_game.sql again (the
-- rehearsal supabase/tests/local/live_game_run.sh compares the fingerprint). DROPS EVERY STAND GAME with its players and
-- answers (the battle's checks do not take them); battle games stay. Re-runnable (IF EXISTS, guarded blocks).

-- The functions as 20261021090000_live_game.sql made them (the same text: the same catalog).
create or replace function meldy_private.live_due(p_g public.live_games, p_now timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select (p_g.state <> 'ended' and p_now >= p_g.created_at + interval '3 hours')
      or (p_g.state = 'countdown' and p_now >= p_g.q_opens_at)
      or (p_g.state = 'open' and p_now > p_g.q_closes_at + interval '1.5 seconds')
      or (p_g.state in ('reveal', 'leaderboard') and p_now >= p_g.state_at + interval '30 seconds')
$fn$;

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
  if p_qi = 0 then
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
    if v_g.hp = 0 or v_g.qi >= v_g.q_count - 1 then
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
                                          'defeated', p_g.hp_max > 0 and p_g.hp = 0),
    'top', v_top);
end;
$fn$;

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
                                              'chat_names', p_g.chat_names),
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
  if coalesce(v_settings ->> 'mode', 'boss') <> 'boss' then
    perform meldy_private.live_fail('22023', 'mode');
  end if;
  if v_settings ? 'time_s' and (pg_catalog.jsonb_typeof(v_settings -> 'time_s') <> 'number'
                                or (v_settings ->> 'time_s') not in ('10', '20', '30')) then
    perform meldy_private.live_fail('22023', 'time_s');
  end if;
  v_time := coalesce((v_settings ->> 'time_s')::integer, 20);
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
                                     chat_names, q_count, skipped)
      values (v_user, v_container, v_quiz.id, pg_catalog.left(pg_catalog.btrim(v_title), 200),
              (100000 + pg_catalog.floor(pg_catalog.random() * 900000))::integer::text,
              meldy_private.live_new_token(16), meldy_private.live_hash(v_token), v_time, v_speed, v_who, v_names,
              pg_catalog.cardinality(v_items), v_skipped)
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
drop function if exists public.live_stand_close(uuid, text, integer, jsonb);
drop function if exists meldy_private.live_stand_result(uuid, integer, boolean);
drop function if exists meldy_private.live_close_stand(uuid);
drop function if exists meldy_private.live_stand_points(integer, integer, integer, boolean, boolean);

delete from public.live_games g where g.mode <> 'boss';

do $do$
begin
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'public.live_answers'::regclass and k.conname = 'live_answers_dmg_check'
                and pg_catalog.pg_get_constraintdef(k.oid) like '%1400%') then
    alter table public.live_answers drop constraint live_answers_dmg_check;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_answers'::regclass and k.conname = 'live_answers_dmg_check') then
    alter table public.live_answers add constraint live_answers_dmg_check check (dmg is null or dmg between 0 and 200);
  end if;
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'public.live_games'::regclass and k.conname = 'live_games_time_check'
                and pg_catalog.pg_get_constraintdef(k.oid) like '%stand%') then
    alter table public.live_games drop constraint live_games_time_check;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_games'::regclass and k.conname = 'live_games_time_check') then
    alter table public.live_games add constraint live_games_time_check check (time_s in (10, 20, 30));
  end if;
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'public.live_games'::regclass and k.conname = 'live_games_mode_check'
                and pg_catalog.pg_get_constraintdef(k.oid) like '%stand%') then
    alter table public.live_games drop constraint live_games_mode_check;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_games'::regclass and k.conname = 'live_games_mode_check') then
    alter table public.live_games add constraint live_games_mode_check check (mode = 'boss');
  end if;
end;
$do$;
alter table public.live_games drop constraint if exists live_games_boss_kind_check;
alter table public.live_games drop column if exists boss_kind;
