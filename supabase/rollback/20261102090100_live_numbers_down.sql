-- Rollback of supabase/migrations/20261102090100_live_numbers.sql (LOCAL rehearsal: supabase/tests/local/live_game_run.sh).
-- Every function it replaced goes back to the body 20261102090000_live_kinds_teams.sql left; live_number_value, the
-- columns tolerance, unit and spread and the number check go, and the checks of kind, options, key, forms and tops are
-- 20261102090000's again. The games that played a number question are deleted with their players and answers first: the
-- old checks cannot hold their rows. Every other game stays as it was. Re-runnable.

do $do$
begin
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'public.live_questions'::regclass and k.conname = 'live_questions_kind_check'
                and pg_catalog.pg_get_constraintdef(k.oid) like '%number%') then
    delete from public.live_games g
     where exists (select 1 from public.live_questions q where q.game_id = g.id and q.kind = 'number');
  end if;
end;
$do$;

-- As 20261102090000_live_kinds_teams.sql left it.
create or replace function meldy_private.live_more(p_item public.test_items, p_text boolean)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case
    when p_item.kind in ('single', 'multiple') and pg_catalog.cardinality(p_item.correct) >= 2
         and pg_catalog.jsonb_array_length(p_item.options) between 2 and 6 then 'multiple'
    when p_item.kind = 'short' and p_text and pg_catalog.cardinality(p_item.answers) between 1 and 10 then 'short'
  end
$fn$;

-- As 20261102090000_live_kinds_teams.sql left it.
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
  v_every integer;
  v_teams integer;
  v_wide boolean;
  v_text boolean;
  v_quiz public.quizzes;
  v_container uuid;
  v_title text;
  v_subjects uuid[];
  v_count integer;
  v_candidates uuid[];
  v_items uuid[];
  v_drawn integer;
  v_skipped integer;
  v_token text := meldy_private.live_new_token(32);
  v_g public.live_games;
  v_item public.test_items;
  v_kind text;
  v_shown smallint[];
  v_keys smallint[];
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
  if v_settings ? 'stand_every' and (pg_catalog.jsonb_typeof(v_settings -> 'stand_every') <> 'number'
                                     or (v_settings ->> 'stand_every') not in ('0', '3', '5', '10')
                                     or (v_mode = 'stand' and (v_settings ->> 'stand_every') <> '0')) then
    perform meldy_private.live_fail('22023', 'stand_every');
  end if;
  v_every := coalesce((v_settings ->> 'stand_every')::integer, 0);
  if v_settings ? 'teams' and (pg_catalog.jsonb_typeof(v_settings -> 'teams') <> 'number'
                               or (v_settings ->> 'teams') not in ('0', '2', '3', '4')) then
    perform meldy_private.live_fail('22023', 'teams');
  end if;
  v_teams := coalesce((v_settings ->> 'teams')::integer, 0);
  -- Every game takes 5–6 options and pictures: the arena has six zones (20261031090000_live_wide_rounds.sql).
  v_wide := true;
  -- Several right answers in every game; a text answer wherever a button question can be (not «Встань на ответ»).
  v_text := v_mode <> 'stand';
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
     where (meldy_private.live_playable(i, v_wide) or meldy_private.live_more(i, v_text) is not null);
    v_skipped := pg_catalog.cardinality(v_candidates) - pg_catalog.cardinality(v_items);
    v_items := v_items[1:30];
  else
    v_candidates := meldy_private.quiz_pool(v_container, v_subjects);
    select coalesce(pg_catalog.array_agg(x.id order by x.ord), '{}'::uuid[]) into v_items
      from (select y.id, y.ord
              from pg_catalog.unnest(v_candidates) with ordinality as y(id, ord)
              join public.test_items i on i.id = y.id
             where (meldy_private.live_playable(i, v_wide) or meldy_private.live_more(i, v_text) is not null)
             order by pg_catalog.random()
             limit v_count) x;
    v_skipped := pg_catalog.cardinality(v_candidates)
                 - (select pg_catalog.count(*)::integer from pg_catalog.unnest(v_candidates) y(id)
                      join public.test_items i on i.id = y.id
                     where (meldy_private.live_playable(i, v_wide) or meldy_private.live_more(i, v_text) is not null));
  end if;
  -- A battle with movement rounds: choice questions on the rounds' places; a text answer that finds no place is skipped.
  if v_mode = 'boss' and v_every > 0 then
    v_drawn := pg_catalog.cardinality(v_items);
    v_items := meldy_private.live_arrange(v_items,
                 (select pg_catalog.array_agg(i.kind = 'short' order by x.ord)
                    from pg_catalog.unnest(v_items) with ordinality as x(id, ord) join public.test_items i on i.id = x.id),
                 v_every);
    v_skipped := v_skipped + v_drawn - pg_catalog.cardinality(v_items);
  end if;
  if pg_catalog.cardinality(v_items) = 0 then
    perform meldy_private.live_fail('ML008', v_skipped::text);
  end if;
  -- The game, with a PIN no open game holds.
  for v_attempt in 1 .. 30 loop
    begin
      insert into public.live_games (owner_id, container_id, quiz_id, title, pin, topic, host_hash, time_s, speed, who,
                                     chat_names, q_count, skipped, mode, boss_kind, stand_every, teams)
      values (v_user, v_container, v_quiz.id, pg_catalog.left(pg_catalog.btrim(v_title), 200),
              (100000 + pg_catalog.floor(pg_catalog.random() * 900000))::integer::text,
              meldy_private.live_new_token(16), meldy_private.live_hash(v_token), v_time, v_speed, v_who, v_names,
              pg_catalog.cardinality(v_items), v_skipped, v_mode, v_boss, v_every, v_teams)
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
    v_kind := coalesce(meldy_private.live_more(v_item, v_text), 'single');
    if v_kind = 'short' then
      insert into public.live_questions (game_id, qi, item_id, text, options, shown, key, kind, forms, explanation)
      values (v_g.id, v_ord, v_item.id, v_item.stem, '[]'::jsonb, '{}'::smallint[], -1, 'short', v_item.answers,
              nullif(pg_catalog.btrim(v_item.explanation), ''));
    else
      if v_item.keep_order then
        select pg_catalog.array_agg(s::smallint order by s) into v_shown
          from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(v_item.options) - 1) s;
      else
        select pg_catalog.array_agg(s::smallint order by pg_catalog.random()) into v_shown
          from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(v_item.options) - 1) s;
      end if;
      v_keys := case when v_kind = 'multiple'
                     then (select pg_catalog.array_agg((pg_catalog.array_position(v_shown, c) - 1)::smallint order by pg_catalog.array_position(v_shown, c))
                             from (select distinct c from pg_catalog.unnest(v_item.correct) c) k) end;
      insert into public.live_questions (game_id, qi, item_id, text, options, shown, key, kind, keys, explanation)
      values (v_g.id, v_ord, v_item.id, v_item.stem,
              (select pg_catalog.jsonb_agg(v_item.options -> s.f::integer order by s.n)
                 from pg_catalog.unnest(v_shown) with ordinality as s(f, n)),
              v_shown, coalesce(v_keys[1], (pg_catalog.array_position(v_shown, v_item.correct[1]) - 1)::smallint), v_kind, v_keys,
              nullif(pg_catalog.btrim(v_item.explanation), ''));
    end if;
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

-- As 20261102090000_live_kinds_teams.sql left it.
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
  v_stand boolean;
  v_void boolean;
  v_keys smallint[];
  v_norms text[];
  v_share double precision;
  v_pick smallint;
  v_tops jsonb;
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
  v_stand := meldy_private.live_stand_round(v_g.stand_every, v_g.q_count, v_g.qi);
  v_void := v_stand and v_q.room_at is null;
  v_rank := meldy_private.live_rank(p_game);
  v_hp := v_g.hp;
  v_counts := pg_catalog.array_fill(0, array[pg_catalog.jsonb_array_length(v_q.options)]);
  v_keys := coalesce(v_q.keys, array[v_q.key]);
  v_norms := (select pg_catalog.array_agg(public.meldy_short_norm(f)) from pg_catalog.unnest(v_q.forms) f);
  for v_a in
    select a.player_id, a.choice, a.picks, a.typed, a.elapsed_ms
      from public.live_answers a
      join public.live_players p on p.id = a.player_id
     where a.game_id = p_game and a.qi = v_g.qi and p.kicked_at is null
     order by a.elapsed_ms, a.player_id
  loop
    select p.* into v_p from public.live_players p where p.id = v_a.player_id;
    if v_a.picks is not null then
      foreach v_pick in array v_a.picks loop
        if v_pick < pg_catalog.cardinality(v_counts) then
          v_counts[v_pick + 1] := v_counts[v_pick + 1] + 1;
        end if;
      end loop;
      v_share := meldy_private.live_share(v_a.picks, v_keys);
    elsif v_a.typed is not null then
      v_share := case when public.meldy_short_norm(v_a.typed) = any (coalesce(v_norms, '{}'::text[])) then 1 else 0 end;
    else
      v_counts[v_a.choice + 1] := v_counts[v_a.choice + 1] + 1;
      v_share := case when v_a.choice = any (v_keys) then 1 else 0 end;
    end if;
    if v_share >= 1 then
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
    elsif v_share > 0 then
      -- partly right (several right answers, some of them ticked): a share of the damage, no streak, no freeze
      v_dmg := case when v_p.frozen then 0
                    else pg_catalog.floor(meldy_private.live_damage(v_a.elapsed_ms, v_g.time_s, v_p.streak + 1, v_g.speed)::double precision
                                          * v_share + 0.5)::integer end;
      update public.live_players p set streak = 0, dmg = p.dmg + v_dmg where p.id = v_p.id;
      update public.live_answers a set correct = false, dmg = v_dmg
       where a.game_id = p_game and a.qi = v_g.qi and a.player_id = v_p.id;
      if v_dmg > 0 then
        v_hp := greatest(0, v_hp - v_dmg);
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
  -- No answer from an active player: those not yet frozen are frozen now from phase 1, or in a movement round the room
  -- wrote; a void movement round leaves everyone as they were.
  if not v_void then
    select coalesce(pg_catalog.array_agg(p.id order by p.joined_at, p.id), '{}'::uuid[]) into v_none
      from public.live_players p
     where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_q.opens_at and not p.frozen
       and not exists (select 1 from public.live_answers a where a.game_id = p_game and a.qi = v_g.qi and a.player_id = p.id);
    if v_q.phase >= 1 or v_stand then
      v_frozen := v_frozen || v_none;
    end if;
    update public.live_players p
       set streak = 0, frozen = p.frozen or v_q.phase >= 1 or v_stand
     where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_q.opens_at
       and not exists (select 1 from public.live_answers a where a.game_id = p_game and a.qi = v_g.qi and a.player_id = p.id);
  end if;
  select pg_catalog.count(*)::integer into v_active
    from public.live_players p
   where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_q.opens_at;
  if not v_void and v_q.phase = 2 and v_hp > 0 and v_right < meldy_private.live_right_needed(v_active) then
    v_healed := least(meldy_private.live_heal(v_g.hp_max), v_g.hp_max - v_hp);
    v_hp := v_hp + v_healed;
  end if;
  v_phase := greatest(v_g.phase, meldy_private.live_phase_for(v_hp, v_g.hp_max));
  if v_q.kind = 'short' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('text', t.norm, 'n', t.n, 'ok', t.norm = any (coalesce(v_norms, '{}'::text[])))
                                         order by t.n desc, t.norm), '[]'::jsonb)
      into v_tops
      from (select x.norm, pg_catalog.count(*)::integer as n
              from (select public.meldy_short_norm(a.typed) as norm
                      from public.live_answers a join public.live_players p on p.id = a.player_id
                     where a.game_id = p_game and a.qi = v_g.qi and p.kicked_at is null and a.typed is not null) x
             where x.norm <> '' and not meldy_private.live_name_rude(x.norm)
             group by x.norm
             order by pg_catalog.count(*) desc, x.norm
             limit 3) t;
  end if;
  update public.live_questions q
     set closed_at = pg_catalog.now(), counts = v_counts, right_n = v_right, healed = v_healed,
         phase_changed = case when v_phase > v_g.phase then v_phase end, hits = v_hits, frozen_now = v_frozen,
         thawed = v_thawed, rank_before = v_rank, tops = v_tops
   where q.game_id = p_game and q.qi = v_g.qi;
  update public.live_games g
     set state = 'reveal', state_at = pg_catalog.now(), hp = v_hp, phase = v_phase, rev = g.rev + 1
   where g.id = p_game;
end;
$fn$;

-- As 20261102090000_live_kinds_teams.sql left it.
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
  v_kind text;
  v_answered integer;
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if v_g.mode = 'stand' then
    perform meldy_private.live_fail('ML004', 'stand');
  end if;
  if v_g.qi < 0 or p_qi is null or p_qi <> v_g.qi then
    perform meldy_private.live_fail('ML004', 'bad_qi');
  end if;
  if meldy_private.live_stand_round(v_g.stand_every, v_g.q_count, v_g.qi) then
    perform meldy_private.live_fail('ML004', 'stand');
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
  select pg_catalog.jsonb_array_length(q.options), q.kind into v_options, v_kind from public.live_questions q
   where q.game_id = p_game and q.qi = v_g.qi;
  if v_kind = 'short' then
    perform meldy_private.live_fail('ML004', 'kind');
  end if;
  if p_choice is null or p_choice < 0 or p_choice >= v_options then
    perform meldy_private.live_fail('22023', 'choice');
  end if;
  insert into public.live_answers (game_id, qi, player_id, choice, picks, at, elapsed_ms)
  values (p_game, v_g.qi, v_p.id, case when v_kind = 'multiple' then null else p_choice end,
          case when v_kind = 'multiple' then array[p_choice::smallint] end, v_now,
          least(greatest(pg_catalog.floor(extract(epoch from (v_now - v_g.q_opens_at)) * 1000), 0), v_g.time_s * 1000)::integer);
  select pg_catalog.count(*)::integer into v_answered
    from public.live_answers a join public.live_players p on p.id = a.player_id
   where a.game_id = p_game and a.qi = v_g.qi and p.kicked_at is null;
  perform meldy_private.live_close_if_all(p_game);
  return pg_catalog.jsonb_build_object('accepted', true, 'answered', v_answered,
                                       'now', meldy_private.live_iso(pg_catalog.clock_timestamp()));
end;
$fn$;

-- As 20261102090000_live_kinds_teams.sql left it.
create or replace function public.live_submit(p_game uuid, p_token text, p_qi integer, p_answer jsonb)
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
  v_kind text;
  v_choice smallint;
  v_picks smallint[];
  v_typed text;
  v_answered integer;
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if v_g.mode = 'stand' then
    perform meldy_private.live_fail('ML004', 'stand');
  end if;
  if v_g.qi < 0 or p_qi is null or p_qi <> v_g.qi then
    perform meldy_private.live_fail('ML004', 'bad_qi');
  end if;
  if meldy_private.live_stand_round(v_g.stand_every, v_g.q_count, v_g.qi) then
    perform meldy_private.live_fail('ML004', 'stand');
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
  select pg_catalog.jsonb_array_length(q.options), q.kind into v_options, v_kind from public.live_questions q
   where q.game_id = p_game and q.qi = v_g.qi;
  if p_answer is null or pg_catalog.jsonb_typeof(p_answer) <> 'object'
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_answer) k) <> 1 then
    perform meldy_private.live_fail('22023', 'answer');
  end if;
  if p_answer ? 'text' then
    if v_kind <> 'short' then
      perform meldy_private.live_fail('ML004', 'kind');
    end if;
    if (case when pg_catalog.jsonb_typeof(p_answer -> 'text') <> 'string' then true
             else pg_catalog.char_length(pg_catalog.btrim(p_answer ->> 'text')) not between 1 and 200
                  or public.meldy_short_norm(p_answer ->> 'text') = '' end) then
      perform meldy_private.live_fail('22023', 'answer');
    end if;
    v_typed := pg_catalog.btrim(p_answer ->> 'text');
  elsif p_answer ? 'choice' or p_answer ? 'picks' then
    if v_kind = 'short' then
      perform meldy_private.live_fail('ML004', 'kind');
    end if;
    if p_answer ? 'choice' then
      if (case when pg_catalog.jsonb_typeof(p_answer -> 'choice') <> 'number' or (p_answer ->> 'choice') !~ '^[0-5]$' then true
               else (p_answer ->> 'choice')::integer >= v_options end) then
        perform meldy_private.live_fail('22023', 'answer');
      end if;
      v_picks := array[(p_answer ->> 'choice')::smallint];
    else
      if (case when pg_catalog.jsonb_typeof(p_answer -> 'picks') <> 'array' then true
              when pg_catalog.jsonb_array_length(p_answer -> 'picks') not between 1 and v_options then true
              when exists (select 1 from pg_catalog.jsonb_array_elements(p_answer -> 'picks') x
                            where case when pg_catalog.jsonb_typeof(x) <> 'number' or (x #>> '{}') !~ '^[0-5]$' then true
                                       else (x #>> '{}')::integer >= v_options end) then true
              else (select pg_catalog.count(distinct x #>> '{}') from pg_catalog.jsonb_array_elements(p_answer -> 'picks') x)
                   <> pg_catalog.jsonb_array_length(p_answer -> 'picks') end) then
        perform meldy_private.live_fail('22023', 'answer');
      end if;
      select pg_catalog.array_agg((x #>> '{}')::smallint order by (x #>> '{}')::integer) into v_picks
        from pg_catalog.jsonb_array_elements(p_answer -> 'picks') x;
    end if;
    if v_kind = 'single' then
      if pg_catalog.cardinality(v_picks) <> 1 then
        perform meldy_private.live_fail('22023', 'answer');
      end if;
      v_choice := v_picks[1];
      v_picks := null;
    end if;
  else
    perform meldy_private.live_fail('22023', 'answer');
  end if;
  insert into public.live_answers (game_id, qi, player_id, choice, picks, typed, at, elapsed_ms)
  values (p_game, v_g.qi, v_p.id, v_choice, v_picks, v_typed, v_now,
          least(greatest(pg_catalog.floor(extract(epoch from (v_now - v_g.q_opens_at)) * 1000), 0), v_g.time_s * 1000)::integer);
  select pg_catalog.count(*)::integer into v_answered
    from public.live_answers a join public.live_players p on p.id = a.player_id
   where a.game_id = p_game and a.qi = v_g.qi and p.kicked_at is null;
  perform meldy_private.live_close_if_all(p_game);
  return pg_catalog.jsonb_build_object('accepted', true, 'answered', v_answered,
                                       'now', meldy_private.live_iso(pg_catalog.clock_timestamp()));
end;
$fn$;

-- As 20261102090000_live_kinds_teams.sql left it.
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
  v_mixed boolean := p_g.mode = 'boss' and coalesce(p_g.stand_every, 0) > 0;
  v_teams boolean := coalesce(p_g.teams, 0) > 0;
begin
  if p_g.qi >= 0 then
    select q.* into v_q from public.live_questions q where q.game_id = p_g.id and q.qi = p_g.qi;
  end if;
  if p_g.qi >= 0 and p_g.state in ('countdown', 'open', 'reveal', 'leaderboard') then
    v_question := pg_catalog.jsonb_build_object(
      'qi', p_g.qi, 'text', v_q.text, 'options', v_q.options, 'opens_at', meldy_private.live_iso(v_q.opens_at),
      'closes_at', meldy_private.live_iso(v_q.closes_at), 'phase', v_q.phase, 'picture', null)
      || case when v_q.pictures is not null then pg_catalog.jsonb_build_object('pictures', v_q.pictures) else '{}'::jsonb end
      || case when v_mixed then pg_catalog.jsonb_build_object('stand', meldy_private.live_stand_round(p_g.stand_every, p_g.q_count, p_g.qi))
              else '{}'::jsonb end
      || case when v_q.kind = 'multiple' then pg_catalog.jsonb_build_object('kind', 'multiple', 'multi', pg_catalog.cardinality(v_q.keys))
              when v_q.kind = 'short' then pg_catalog.jsonb_build_object('kind', 'short')
              else '{}'::jsonb end;
  end if;
  if p_g.state in ('leaderboard', 'podium') or (p_g.state = 'ended' and p_g.won is not null) then
    v_rank := meldy_private.live_rank(p_g.id);
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'player_id', p.id, 'name', p.name, 'look', p.look, 'dmg', p.dmg,
             'move', case when p_g.qi > 0 and pg_catalog.array_position(v_q.rank_before, p.id) is not null
                          then pg_catalog.array_position(v_q.rank_before, p.id) - r.place::integer else 0 end)
             || case when v_teams then pg_catalog.jsonb_build_object('team', p.team) else '{}'::jsonb end
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
            || case when p_g.mode = 'boss' and not v_mixed then '{}'::jsonb else pg_catalog.jsonb_build_object('kind', p_g.boss_kind) end,
    'top', v_top)
    || case when v_mixed then pg_catalog.jsonb_build_object('mixed', pg_catalog.jsonb_build_object(
              'every', p_g.stand_every,
              'rounds', (select coalesce(pg_catalog.jsonb_agg(s.qi order by s.qi), '[]'::jsonb)
                           from pg_catalog.generate_series(0, p_g.q_count - 1) as s(qi)
                          where meldy_private.live_stand_round(p_g.stand_every, p_g.q_count, s.qi))))
            else '{}'::jsonb end
    || case when v_teams then pg_catalog.jsonb_build_object('teams', meldy_private.live_teams_json(p_g)) else '{}'::jsonb end;
end;
$fn$;

-- As 20261102090000_live_kinds_teams.sql left it.
create or replace function meldy_private.live_closed_json(p_g public.live_games)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object('qi', q.qi, 'key', q.key, 'counts', pg_catalog.to_jsonb(q.counts), 'right', q.right_n,
                                       'healed', q.healed, 'phase_changed', q.phase_changed)
         || case when p_g.mode = 'boss' and coalesce(p_g.stand_every, 0) > 0
                 then pg_catalog.jsonb_build_object(
                        'stand', meldy_private.live_stand_round(p_g.stand_every, p_g.q_count, q.qi),
                        'void', meldy_private.live_stand_round(p_g.stand_every, p_g.q_count, q.qi) and q.room_at is null)
                 else '{}'::jsonb end
         || case when q.kind = 'multiple' then pg_catalog.jsonb_build_object('keys', pg_catalog.to_jsonb(q.keys))
                 when q.kind = 'short' then pg_catalog.jsonb_build_object('forms', pg_catalog.to_jsonb(q.forms),
                                                                          'tops', coalesce(q.tops, '[]'::jsonb))
                 else '{}'::jsonb end
    from public.live_questions q
   where q.game_id = p_g.id and q.qi = p_g.qi and q.closed_at is not null
     and p_g.state in ('reveal', 'leaderboard', 'podium', 'ended')
$fn$;

-- As 20261102090000_live_kinds_teams.sql left it.
create or replace function meldy_private.live_player_json(p_g public.live_games, p_player uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_p public.live_players;
  v_rank uuid[] := meldy_private.live_rank(p_g.id);
  v_closed jsonb := meldy_private.live_closed_json(p_g);
  v_a public.live_answers;
  v_q public.live_questions;
  v_kind text;
  v_result jsonb;
  v_final jsonb;
  v_crowd jsonb;
begin
  select p.* into v_p from public.live_players p where p.id = p_player;
  if p_g.qi >= 0 then
    select a.* into v_a from public.live_answers a where a.game_id = p_g.id and a.qi = p_g.qi and a.player_id = p_player;
    select q.kind into v_kind from public.live_questions q where q.game_id = p_g.id and q.qi = p_g.qi;
  end if;
  if v_closed is not null then
    select q.* into v_q from public.live_questions q where q.game_id = p_g.id and q.qi = p_g.qi;
    v_result := v_closed || pg_catalog.jsonb_build_object(
      'correct', coalesce(v_a.correct, false),
      'none', v_a.player_id is null,
      'dmg', coalesce(v_a.dmg, 0),
      'thawed', p_player = any (coalesce(v_q.thawed, '{}'::uuid[])),
      'frozen', v_p.frozen)
      || case when v_q.kind = 'multiple'
              then pg_catalog.jsonb_build_object('picks', pg_catalog.to_jsonb(v_a.picks),
                     'share', case when v_a.picks is not null then meldy_private.live_share(v_a.picks, v_q.keys)
                                   when v_a.choice is not null then (v_a.choice = any (v_q.keys))::integer
                                   else 0 end)
              when v_q.kind = 'short' then pg_catalog.jsonb_build_object('typed', v_a.typed)
              else '{}'::jsonb end;
  end if;
  if p_g.state in ('podium', 'ended') and p_g.won is not null then
    v_final := pg_catalog.jsonb_build_object(
      'won', p_g.won,
      'place', pg_catalog.array_position(v_rank, p_player),
      'dmg', v_p.dmg, 'best', v_p.best, 'right', v_p.right_n,
      'accuracy_pct', (select meldy_private.live_accuracy(coalesce(pg_catalog.sum(p.right_n), 0)::integer,
                                                          pg_catalog.count(*)::integer, p_g.qi + 1)
                         from public.live_players p where p.game_id = p_g.id and p.kicked_at is null),
      'unlocked_now', pg_catalog.to_jsonb(v_p.unlocked_now));
  end if;
  if p_g.state = 'lobby' then
    select coalesce(pg_catalog.jsonb_agg(x.look order by x.joined_at, x.id), '[]'::jsonb) into v_crowd
      from (select p.look, p.joined_at, p.id from public.live_players p
             where p.game_id = p_g.id and p.kicked_at is null and p.id <> p_player
             order by p.joined_at, p.id limit 40) x;
  end if;
  return meldy_private.live_base_json(p_g) || pg_catalog.jsonb_build_object(
    'me', pg_catalog.jsonb_build_object(
      'player_id', v_p.id, 'name', v_p.name, 'look', v_p.look, 'dmg', v_p.dmg, 'streak', v_p.streak, 'best', v_p.best,
      'frozen', v_p.frozen, 'place', pg_catalog.array_position(v_rank, p_player), 'choice', v_a.choice)
      || case when v_kind = 'multiple' then pg_catalog.jsonb_build_object('picks', pg_catalog.to_jsonb(v_a.picks))
              when v_kind = 'short' then pg_catalog.jsonb_build_object('typed', v_a.typed)
              else '{}'::jsonb end
      || case when coalesce(p_g.teams, 0) > 0 then pg_catalog.jsonb_build_object('team', v_p.team) else '{}'::jsonb end,
    'result', v_result,
    'final', v_final,
    'crowd', v_crowd);
end;
$fn$;

-- As 20261102090000_live_kinds_teams.sql left it.
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
  v_mixed boolean := p_g.mode = 'boss' and coalesce(p_g.stand_every, 0) > 0;
  v_teams boolean := coalesce(p_g.teams, 0) > 0;
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
                || case when p_g.mode = 'boss' and not v_mixed then '{}'::jsonb else pg_catalog.jsonb_build_object('boss', p_g.boss_kind) end
                || case when v_mixed then pg_catalog.jsonb_build_object('stand_every', p_g.stand_every) else '{}'::jsonb end
                || case when v_teams then pg_catalog.jsonb_build_object('teams', p_g.teams) else '{}'::jsonb end,
    'skipped', p_g.skipped,
    'roster', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'player_id', p.id, 'name', p.name, 'look', p.look, 'dmg', p.dmg, 'right', p.right_n, 'streak', p.streak,
                 'frozen', p.frozen, 'joined_at', meldy_private.live_iso(p.joined_at),
                 'answered', p_g.qi >= 0 and exists (select 1 from public.live_answers a
                                                      where a.game_id = p_g.id and a.qi = p_g.qi and a.player_id = p.id))
                 || case when v_teams then pg_catalog.jsonb_build_object('team', p.team) else '{}'::jsonb end
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

-- As 20261102090000_live_kinds_teams.sql left it.
create or replace function public.live_review(p_game uuid, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p public.live_players := meldy_private.live_player_of(p_game, p_token, false);
  v_g public.live_games;
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if v_g.state not in ('podium', 'ended') then
    perform meldy_private.live_fail('ML004', 'not_open');
  end if;
  if v_g.ended_at is not null and v_g.ended_at < pg_catalog.now() - interval '7 days' then
    perform meldy_private.live_fail('ML002', 'expired');
  end if;
  return pg_catalog.jsonb_build_object('items', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'qi', q.qi, 'text', q.text, 'options', q.options, 'key', q.key, 'choice', a.choice,
             'correct', coalesce(a.correct, a.choice = q.key, false))
             || case when q.pictures is not null then pg_catalog.jsonb_build_object('pictures', q.pictures) else '{}'::jsonb end
             || case when v_g.mode = 'boss' and v_g.stand_every > 0
                     then pg_catalog.jsonb_build_object('stand', meldy_private.live_stand_round(v_g.stand_every, v_g.q_count, q.qi))
                     else '{}'::jsonb end
             || case when q.kind = 'multiple'
                     then pg_catalog.jsonb_build_object('kind', 'multiple', 'keys', pg_catalog.to_jsonb(q.keys), 'picks', pg_catalog.to_jsonb(a.picks),
                            'share', case when a.picks is not null then meldy_private.live_share(a.picks, q.keys)
                                          when a.choice is not null then (a.choice = any (q.keys))::integer else 0 end)
                     when q.kind = 'short'
                     then pg_catalog.jsonb_build_object('kind', 'short', 'forms', pg_catalog.to_jsonb(q.forms), 'typed', a.typed)
                     else '{}'::jsonb end
             || case when q.explanation is not null then pg_catalog.jsonb_build_object('explanation', q.explanation) else '{}'::jsonb end
             order by q.qi), '[]'::jsonb)
      from public.live_questions q
      left join public.live_answers a on a.game_id = q.game_id and a.qi = q.qi and a.player_id = v_p.id
     where q.game_id = p_game and q.closed_at is not null));
end;
$fn$;

-- As 20261102090000_live_kinds_teams.sql left it.
create or replace function public.live_practice(p_game uuid, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_p public.live_players;
  v_g public.live_games;
  v_q public.quizzes;
  v_m public.container_members%rowtype;
  v_found boolean;
  v_joined boolean := false;
  v_answers jsonb;
  v_out jsonb;
  v_saved integer := 0;
begin
  if v_user is null then
    perform meldy_private.live_fail('28000', null, 401);
  end if;
  v_p := meldy_private.live_player_of(p_game, p_token, false);
  select g.* into v_g from public.live_games g where g.id = p_game;
  if v_g.state not in ('podium', 'ended') then
    perform meldy_private.live_fail('ML004', 'not_open');
  end if;
  if v_g.ended_at is not null and v_g.ended_at < pg_catalog.now() - interval '7 days' then
    perform meldy_private.live_fail('ML002', 'expired');
  end if;
  if meldy_private.role_in(v_user, v_g.container_id) is null then
    if v_g.quiz_id is not null then
      select q.* into v_q from public.quizzes q where q.id = v_g.quiz_id;
    end if;
    if v_q.id is null or not v_q.offer_practice or v_q.container_id <> v_g.container_id then
      perform meldy_private.live_fail('ML012', 'practice', 403);
    end if;
    if not meldy_private.quiz_practice_ready(v_g.container_id) then
      perform meldy_private.live_fail('ML012', 'open', 403);
    end if;
    perform 1 from public.containers c where c.id = v_g.container_id for update;
    select m.* into v_m from public.container_members m
     where m.container_id = v_g.container_id and m.user_id = v_user
       for update;
    v_found := found;
    if v_found and v_m.removed_at is not null then
      perform meldy_private.live_fail('ML012', 'removed', 403);
    end if;
    if (select pg_catalog.count(*) from public.container_members m
         where m.container_id = v_g.container_id and m.left_at is null and m.removed_at is null) >= 200 then
      perform meldy_private.live_fail('ML012', 'full', 403);
    end if;
    if v_found then
      update public.container_members m set left_at = null
       where m.container_id = v_g.container_id and m.user_id = v_user;
    else
      insert into public.container_members (container_id, user_id) values (v_g.container_id, v_user);
    end if;
    v_joined := true;
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'client_event_id', 'live:' || pg_catalog.replace(p_game::text, '-', '') || ':' || q.qi,
           'item_id', q.item_id, 'mode', 'learn')
           || case when q.kind = 'short' then pg_catalog.jsonb_build_object('text', a.typed)
                   else pg_catalog.jsonb_build_object('chosen',
                          (select pg_catalog.to_jsonb(pg_catalog.array_agg(q.shown[x + 1] order by q.shown[x + 1]))
                             from pg_catalog.unnest(coalesce(a.picks, case when a.choice is not null then array[a.choice] end)) x)) end
           order by q.qi)
    into v_answers
    from public.live_questions q
    left join public.live_answers a on a.game_id = q.game_id and a.qi = q.qi and a.player_id = v_p.id
   where q.game_id = p_game and q.closed_at is not null and q.item_id is not null
     and exists (select 1 from public.test_items i where i.id = q.item_id and i.container_id = v_g.container_id and i.keyed)
     and not coalesce(a.correct, false)
     and (a.player_id is not null
          or (v_p.joined_at <= q.opens_at
              and not (v_g.mode = 'boss' and meldy_private.live_stand_round(v_g.stand_every, v_g.q_count, q.qi) and q.room_at is null)));
  if v_answers is not null then
    v_out := meldy_private.record_test_answers_for(v_user, v_answers, 'web', 30);
    select pg_catalog.count(*)::integer into v_saved
      from pg_catalog.jsonb_array_elements(v_out -> 'results') r where r ->> 'status' in ('saved', 'duplicate');
  end if;
  return pg_catalog.jsonb_build_object('container_id', v_g.container_id, 'joined', v_joined, 'saved', v_saved,
                                       'mistakes', coalesce(pg_catalog.jsonb_array_length(v_answers), 0));
end;
$fn$;

drop function if exists meldy_private.live_number_value(text, text);
alter table public.live_questions drop constraint if exists live_questions_number_check;
do $do$
begin
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'public.live_questions'::regclass and k.conname = 'live_questions_kind_check'
                and pg_catalog.pg_get_constraintdef(k.oid) like '%number%') then
    alter table public.live_questions drop constraint live_questions_kind_check;
    alter table public.live_questions add constraint live_questions_kind_check check (kind in ('single', 'multiple', 'short'));
  end if;
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'public.live_questions'::regclass and k.conname = 'live_questions_options_check'
                and pg_catalog.pg_get_constraintdef(k.oid) like '%number%') then
    alter table public.live_questions drop constraint live_questions_options_check;
    alter table public.live_questions add constraint live_questions_options_check
      check (jsonb_typeof(options) = 'array' and cardinality(shown) = jsonb_array_length(options)
             and case when kind = 'short' then jsonb_array_length(options) = 0
                      else jsonb_array_length(options) >= 2 and jsonb_array_length(options) <= 6 end);
  end if;
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'public.live_questions'::regclass and k.conname = 'live_questions_key_check'
                and pg_catalog.pg_get_constraintdef(k.oid) like '%number%') then
    alter table public.live_questions drop constraint live_questions_key_check;
    alter table public.live_questions add constraint live_questions_key_check
      check (case when kind = 'short' then key = -1 else key >= 0 and key < cardinality(shown) end);
  end if;
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'public.live_questions'::regclass and k.conname = 'live_questions_forms_check'
                and pg_catalog.pg_get_constraintdef(k.oid) like '%number%') then
    alter table public.live_questions drop constraint live_questions_forms_check;
    alter table public.live_questions add constraint live_questions_forms_check
      check ((kind = 'short') = (forms is not null) and (forms is null or cardinality(forms) between 1 and 10));
  end if;
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'public.live_questions'::regclass and k.conname = 'live_questions_tops_check'
                and pg_catalog.pg_get_constraintdef(k.oid) like '%number%') then
    alter table public.live_questions drop constraint live_questions_tops_check;
    alter table public.live_questions add constraint live_questions_tops_check
      check (tops is null or (kind = 'short' and jsonb_typeof(tops) = 'array' and jsonb_array_length(tops) <= 3));
  end if;
end;
$do$;
alter table public.live_questions drop column if exists spread;
alter table public.live_questions drop column if exists unit;
alter table public.live_questions drop column if exists tolerance;
comment on column public.live_questions.kind is 'single: one right option; multiple: two or more (keys); short: a text answer (forms, no options, key -1).';
comment on column public.live_questions.forms is 'A text answer: the accepted forms copied from the item (compared by public.meldy_short_norm).';
comment on column public.live_questions.tops is 'A closed text answer: the three answers typed most often, [{text, n, ok}] (normalised, rude ones left out).';
