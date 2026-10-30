-- live_pictures (the battle «Битва с монстром» plays the questions of real tests: 5–6 options and pictures)
-- Repo file: supabase/migrations/20261030090000_live_pictures.sql. Base: 20261021090000_live_game.sql,
-- 20261022090000_live_stand.sql, 20261024090000_live_mixed.sql (and 20261025090000_live_pin.sql, untouched here).
-- Why (2026-10-30): of the ~3 240 questions in the live database 3 138 have five options and 145 have a picture in the
-- question, and the battle played only 2–4 options without pictures: a real exam's test gave a game of nothing (one game
-- of 21.10 skipped 810 questions). The owner, 21.10: «а что делать если в тесте есть картинки? или видео?».
-- Contract: docs/live/CONTRACT.md §4 and §5 (updated with this file).
-- Check after the apply: supabase/tests/live_pictures.sql (catalog and pure calls; read-only). Local rehearsal (never
-- live): supabase/tests/local/live_game_run.sh, its pictures stage (live_pictures_behaviour.sql).
-- Rollback: supabase/rollback/20261030090000_live_pictures_down.sql.
--
-- 1. live_questions takes 2–6 options (was 2–4) and live_answers a choice 0–5 (was 0–3). live_questions.pictures: the
--    question's pictures as the game shows them, {"stem": [path…], "options": [[path…] per option in the SHOWN order]},
--    or null when it has none; written by a trigger from the item when the question is drawn (a copy, as the text and
--    options: an edit of the exam does not change a running game).
-- 2. meldy_private.live_playable(item, wide): wide (a battle without movement rounds) — one right option of 2–6, pictures
--    allowed; not wide (a stand game, a mixed game: the arena has four zones and draws no pictures) — the old rule.
--    live_create picks wide for mode 'boss' with stand_every 0. Nothing else in a stand or mixed game changes.
-- 3. JSON: question.pictures and review items' pictures, only when the question has pictures (every other answer is
--    exactly as before). question.picture stays null (old phones).
-- 4. public.quiz_live_media_paths(game, token, paths) for the quiz-media Edge Function (service_role only): the subset of the
--    paths that are pictures of this game's questions shown so far (from the countdown of the current one; none in the
--    lobby), for the host's token or a player's not kicked; nothing 7 days after the end (as live_review). The pictures
--    stay in the private bucket test-item-images; the function reads them with the service key after this answer.
-- Changed functions (whole bodies, as in 20261024090000_live_mixed.sql plus the change): live_create, live_base_json,
-- live_review. New: meldy_private.live_playable(test_items, boolean), meldy_private.live_question_pictures() (trigger),
-- public.quiz_live_media_paths(uuid, text, text[]).
-- Re-runnable: IF NOT EXISTS, OR REPLACE, guarded blocks. The whole file is one request (supabase/migrate.py).

do $do$
begin
  if pg_catalog.to_regprocedure('meldy_private.live_stand_round(integer, integer, integer)') is null then
    raise exception 'the base is expected: 20261021090000_live_game.sql, 20261022090000_live_stand.sql, 20261024090000_live_mixed.sql';
  end if;
end;
$do$;

-- ─────────────────────────────────────────── 1. Columns and checks ───────────────────────────────────────────

do $do$
begin
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_questions'::regclass and k.conname = 'live_questions_options_check'
                    and pg_catalog.pg_get_constraintdef(k.oid) like '%<= 6)%') then
    alter table public.live_questions drop constraint if exists live_questions_options_check;
    alter table public.live_questions add constraint live_questions_options_check
      check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6
             and cardinality(shown) = jsonb_array_length(options));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_answers'::regclass and k.conname = 'live_answers_choice_check'
                    and pg_catalog.pg_get_constraintdef(k.oid) like '%<= 5)%') then
    alter table public.live_answers drop constraint if exists live_answers_choice_check;
    alter table public.live_answers add constraint live_answers_choice_check check (choice between 0 and 5);
  end if;
end;
$do$;

alter table public.live_questions add column if not exists pictures jsonb;
do $do$
begin
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_questions'::regclass and k.conname = 'live_questions_pictures_check') then
    alter table public.live_questions add constraint live_questions_pictures_check
      check (pictures is null or (jsonb_typeof(pictures -> 'stem') = 'array' and jsonb_typeof(pictures -> 'options') = 'array'
                                  and jsonb_array_length(pictures -> 'options') = jsonb_array_length(options)));
  end if;
end;
$do$;
comment on column public.live_questions.pictures is
  'The question''s pictures as shown: {"stem": [path…], "options": [[path…] per shown option]} in the private bucket test-item-images; null: none. Written by live_questions_pictures from the item.';

-- ─────────────────────────────────────────── 2. The pictures of a drawn question ───────────────────────────────────────────

-- 2a. Before a question is inserted (live_create draws it): its item's pictures, the options' in the shown order. An item
--     with no picture (or a question without an item) gets null.
create or replace function meldy_private.live_question_pictures()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_images jsonb;
  v_stem jsonb;
  v_options jsonb;
begin
  new.pictures := null;
  if new.item_id is null then
    return new;
  end if;
  select i.images into v_images from public.test_items i where i.id = new.item_id;
  if v_images is null or pg_catalog.jsonb_typeof(v_images) <> 'object' then
    return new;
  end if;
  v_stem := case when pg_catalog.jsonb_typeof(v_images -> 'stem') = 'array' then v_images -> 'stem' else '[]'::jsonb end;
  select coalesce(pg_catalog.jsonb_agg(case when pg_catalog.jsonb_typeof(v_images -> 'options' -> s.f::integer) = 'array'
                                            then v_images -> 'options' -> s.f::integer else '[]'::jsonb end order by s.n), '[]'::jsonb)
    into v_options
    from pg_catalog.unnest(new.shown) with ordinality as s(f, n);
  if pg_catalog.jsonb_array_length(v_stem) > 0
     or exists (select 1 from pg_catalog.jsonb_array_elements(v_options) o where pg_catalog.jsonb_array_length(o) > 0) then
    new.pictures := pg_catalog.jsonb_build_object('stem', v_stem, 'options', v_options);
  end if;
  return new;
end;
$fn$;

create or replace trigger live_questions_pictures
  before insert on public.live_questions
  for each row execute function meldy_private.live_question_pictures();

-- 2b. A playable question. wide (a battle without movement rounds): one right option of 2–6, pictures allowed. Not wide (a
--     stand game, a mixed game): the old rule of meldy_private.live_playable(test_items) — 2–4 options, no pictures.
create or replace function meldy_private.live_playable(p_item public.test_items, p_wide boolean)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select case when p_wide
              then p_item.kind in ('single', 'multiple')
                   and pg_catalog.cardinality(p_item.correct) = 1
                   and pg_catalog.jsonb_array_length(p_item.options) between 2 and 6
              else meldy_private.live_playable(p_item) end
$fn$;

-- ─────────────────────────────────────────── 3. Create ───────────────────────────────────────────

-- 3a. Create, as 20261024090000_live_mixed.sql 6a, with the wide rule for a battle without movement rounds.
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
  -- A battle without movement rounds takes 5–6 options and pictures; the arena's four zones do not.
  v_wide := v_mode = 'boss' and v_every = 0;
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

-- ─────────────────────────────────────────── 4. What the screens read ───────────────────────────────────────────

-- 4a. As 20261024090000_live_mixed.sql 4a, plus question.pictures when the question has pictures.
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
              else '{}'::jsonb end;
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
            || case when p_g.mode = 'boss' and not v_mixed then '{}'::jsonb else pg_catalog.jsonb_build_object('kind', p_g.boss_kind) end,
    'top', v_top)
    || case when v_mixed then pg_catalog.jsonb_build_object('mixed', pg_catalog.jsonb_build_object(
              'every', p_g.stand_every,
              'rounds', (select coalesce(pg_catalog.jsonb_agg(s.qi order by s.qi), '[]'::jsonb)
                           from pg_catalog.generate_series(0, p_g.q_count - 1) as s(qi)
                          where meldy_private.live_stand_round(p_g.stand_every, p_g.q_count, s.qi))))
            else '{}'::jsonb end;
end;
$fn$;

-- 4b. The review, as 20261024090000_live_mixed.sql 7f, plus each item's pictures when it has them.
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
             'correct', coalesce(a.choice = q.key, false))
             || case when q.pictures is not null then pg_catalog.jsonb_build_object('pictures', q.pictures) else '{}'::jsonb end
             || case when v_g.mode = 'boss' and v_g.stand_every > 0
                     then pg_catalog.jsonb_build_object('stand', meldy_private.live_stand_round(v_g.stand_every, v_g.q_count, q.qi))
                     else '{}'::jsonb end
             order by q.qi), '[]'::jsonb)
      from public.live_questions q
      left join public.live_answers a on a.game_id = q.game_id and a.qi = q.qi and a.player_id = v_p.id
     where q.game_id = p_game and q.closed_at is not null));
end;
$fn$;

-- ─────────────────────────────────────────── 5. The pictures for the quiz-media function ───────────────────────────────────────────

-- 5a. Which of `p_paths` (at most 20) the holder of `p_token` may see in game `p_game`: the pictures of the questions shown
--     so far (qi up to the current one from its countdown; none in the lobby), for the host's token or the token of a
--     player who is not kicked; none 7 days after the end. A wrong token, game or path: they are just not in the answer.
--     Only the quiz-media Edge Function calls it (service_role); it never says why a path is missing.
create or replace function public.quiz_live_media_paths(p_game uuid, p_token text, p_paths text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_g public.live_games;
  v_hash text;
  v_last integer;
begin
  if p_game is null or p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' or p_paths is null
     or pg_catalog.cardinality(p_paths) > 20 then
    return '[]'::jsonb;
  end if;
  select g.* into v_g from public.live_games g where g.id = p_game;
  if not found or (v_g.ended_at is not null and v_g.ended_at < pg_catalog.now() - interval '7 days') then
    return '[]'::jsonb;
  end if;
  v_hash := meldy_private.live_hash(p_token);
  if v_hash <> v_g.host_hash
     and not exists (select 1 from public.live_players p
                      where p.game_id = p_game and p.token_hash = v_hash and p.kicked_at is null) then
    return '[]'::jsonb;
  end if;
  v_last := case when v_g.state = 'lobby' then -1 else v_g.qi end;
  return coalesce((
    select pg_catalog.jsonb_agg(distinct x.path)
      from pg_catalog.unnest(p_paths) as x(path)
     where exists (select 1 from public.live_questions q
                    where q.game_id = p_game and q.qi <= v_last and q.pictures is not null
                      and ((q.pictures -> 'stem') ? x.path
                           or exists (select 1 from pg_catalog.jsonb_array_elements(q.pictures -> 'options') o where o ? x.path)))),
    '[]'::jsonb);
end;
$fn$;

-- ─────────────────────────────────────────── 6. Grants ───────────────────────────────────────────
-- create or replace keeps the grants of the changed functions; the new ones are private, quiz_live_media_paths is the
-- Edge Function's only.
revoke all on function meldy_private.live_playable(public.test_items, boolean), meldy_private.live_question_pictures()
  from public, anon, authenticated, service_role;
revoke all on function public.quiz_live_media_paths(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.quiz_live_media_paths(uuid, text, text[]) to service_role;
