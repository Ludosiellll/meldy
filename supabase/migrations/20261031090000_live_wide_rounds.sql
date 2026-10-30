-- live_wide_rounds (the movement rounds and «Встань на ответ» play real tests too: 5–6 options and pictures)
-- Repo file: supabase/migrations/20261031090000_live_wide_rounds.sql. Base: 20261030090000_live_pictures.sql.
-- Why (2026-10-30): 47.31 let the battle without movement rounds take the questions of real tests (3 138 of the ~3 240
-- live questions have five options), but a mixed game and «Встань на ответ» still drew 2–4 options without pictures, and
-- the setup switched the mini-game off for such tests. The arena now has six zones (contracts/live/stand_arena.json:
-- А Б В Г on the corners, Д Е above and below the stage; a question with fewer options closes the rest) and the board
-- over it shows the pictures, so every game takes the wide rule. The owner, 30.10: real tests in 3D.
-- Release order: the Space first (the six-zone arena, the screens), then this file.
-- Check after the apply: supabase/tests/live_wide_rounds.sql (catalog only; read-only). Local rehearsal (never live):
-- supabase/tests/local/live_game_run.sh, its wide rounds stage.
-- Rollback: supabase/rollback/20261031090000_live_wide_rounds_down.sql (live_create as 20261030090000_live_pictures.sql).
-- Changed: public.live_create (whole body, as 20261030090000_live_pictures.sql 3a with v_wide := true) and
-- public.live_stand_close (as 20261024090000_live_mixed.sql 6, the room's write: a zone 0–5, was 0–3; still below the
-- question's option count). live_playable(item, true) is the rule of 47.31; the close functions size their counts by the
-- options; live_answers takes a choice 0–5 since 20261030090000_live_pictures.sql.
-- Re-runnable: OR REPLACE (the grants of both functions stay as they are).

do $do$
begin
  if pg_catalog.to_regprocedure('meldy_private.live_playable(public.test_items, boolean)') is null then
    raise exception 'the base is expected: 20261030090000_live_pictures.sql';
  end if;
end;
$do$;

-- Create, as 20261030090000_live_pictures.sql 3a, with the wide rule for every game.
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
  v_wide boolean;
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
  if v_settings ? 'stand_every' and (pg_catalog.jsonb_typeof(v_settings -> 'stand_every') <> 'number'
                                     or (v_settings ->> 'stand_every') not in ('0', '3', '5', '10')
                                     or (v_mode = 'stand' and (v_settings ->> 'stand_every') <> '0')) then
    perform meldy_private.live_fail('22023', 'stand_every');
  end if;
  v_every := coalesce((v_settings ->> 'stand_every')::integer, 0);
  -- Every game takes 5–6 options and pictures: the arena has six zones (20261031090000_live_wide_rounds.sql).
  v_wide := true;
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
     where meldy_private.live_playable(i, v_wide);
    v_skipped := pg_catalog.cardinality(v_candidates) - pg_catalog.cardinality(v_items);
    v_items := v_items[1:30];
  else
    v_candidates := meldy_private.quiz_pool(v_container, v_subjects);
    select coalesce(pg_catalog.array_agg(x.id order by x.ord), '{}'::uuid[]) into v_items
      from (select y.id, y.ord
              from pg_catalog.unnest(v_candidates) with ordinality as y(id, ord)
              join public.test_items i on i.id = y.id
             where meldy_private.live_playable(i, v_wide)
             order by pg_catalog.random()
             limit v_count) x;
    v_skipped := pg_catalog.cardinality(v_candidates)
                 - (select pg_catalog.count(*)::integer from pg_catalog.unnest(v_candidates) y(id)
                      join public.test_items i on i.id = y.id where meldy_private.live_playable(i, v_wide));
  end if;
  if pg_catalog.cardinality(v_items) = 0 then
    perform meldy_private.live_fail('ML008', v_skipped::text);
  end if;
  -- The game, with a PIN no open game holds.
  for v_attempt in 1 .. 30 loop
    begin
      insert into public.live_games (owner_id, container_id, quiz_id, title, pin, topic, host_hash, time_s, speed, who,
                                     chat_names, q_count, skipped, mode, boss_kind, stand_every)
      values (v_user, v_container, v_quiz.id, pg_catalog.left(pg_catalog.btrim(v_title), 200),
              (100000 + pg_catalog.floor(pg_catalog.random() * 900000))::integer::text,
              meldy_private.live_new_token(16), meldy_private.live_hash(v_token), v_time, v_speed, v_who, v_names,
              pg_catalog.cardinality(v_items), v_skipped, v_mode, v_boss, v_every)
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

-- The room's write of a round, as 20261024090000_live_mixed.sql 6: the zones Д and Е (choices 4 and 5) are answers too.
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
  v_mixed boolean;
begin
  v_mixed := v_g.mode = 'boss' and v_g.stand_every > 0;
  if v_g.mode <> 'stand' and not v_mixed then
    perform meldy_private.live_fail('22023', 'mode');
  end if;
  if p_qi is null or p_qi < 0 or p_qi > v_g.qi then
    perform meldy_private.live_fail('ML004', 'bad_qi');
  end if;
  if v_mixed and not meldy_private.live_stand_round(v_g.stand_every, v_g.q_count, p_qi) then
    perform meldy_private.live_fail('ML004', 'tap');
  end if;
  select q.* into v_q from public.live_questions q where q.game_id = p_game and q.qi = p_qi;
  if v_q.closed_at is not null then
    return case when v_mixed then meldy_private.live_mixed_result(p_game, p_qi, true)
                else meldy_private.live_stand_result(p_game, p_qi, true) end;
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
                            when pg_catalog.jsonb_typeof(e -> 'c') is distinct from 'number' or (e ->> 'c') !~ '^[0-5]$' then true
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
  update public.live_questions q set room_at = pg_catalog.now() where q.game_id = p_game and q.qi = v_g.qi;
  perform meldy_private.live_close(p_game);
  return case when v_mixed then meldy_private.live_mixed_result(p_game, p_qi, false)
              else meldy_private.live_stand_result(p_game, p_qi, false) end;
end;
$fn$;
