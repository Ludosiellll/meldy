-- live_ranges (a number question on the arena: four ranges on the floor, the right one stays up)
-- Repo file: supabase/migrations/20261102090200_live_ranges.sql. Base: 20261102090100_live_numbers.sql (and every live
-- migration before it, 20261101090000_question_kinds.sql among them).
-- Why (2026-10-31): a number question could only be typed, so a battle's movement rounds and «Встань на ответ» never
-- drew it. Now a number on a movement round's place is played on the floor: four ranges («меньше 300», «300–400»,
-- «400–500», «больше 500»), the class runs onto the one it thinks holds the answer, and the right one stays up.
-- Contract: docs/live/CONTRACT.md §3, §4, §8, §15; MODE_STAND.md and MODE_MIXED.md (a range round).
-- Check after the apply: supabase/tests/live_ranges.sql (catalog and pure calls; read-only). Local rehearsal (never
-- live): supabase/tests/local/live_game_run.sh, its ranges stage (live_ranges_behaviour.sql).
-- Rollback: supabase/rollback/20261102090200_live_ranges_down.sql (deletes the games that played a range question).
-- Release order: 20261102090100 first; then the site and the Space (the room forwards the new keys; the screens read
-- them and keep working without them); then this file.
-- What changes:
-- 1. A number question on a movement round's place (a battle's round, every question of «Встань на ответ») is a zone
--    question: kind 'number', options = four ranges' labels (meldy_private.live_ranges), shown 0–3, key = the right
--    range (keys when another accepted number falls in another range), bounds = the three limits between the ranges,
--    forms / tolerance / unit kept. A range is right as any zone is (the room's write, the close by keys).
-- 2. The ranges: a width of at least the tolerance band and about a quarter of the value, rounded up to 1, 2, 2.5 or
--    5 × 10^k; the right range at the given place with the band wholly inside it (strictly: no limit on the right value
--    or on its band's ends; else the next round width, or the grid moved by half a width); open ends («меньше X»,
--    «больше Y»); labels with a decimal comma, «−» and a no-break space between thousands from five digits on («от −15
--    до −10» when a range starts below zero).
-- 3. JSON, only where a question is a range question (every other game's JSON is as before, key for key; a typed
--    number question's too): question.ranges true; result.ranges, keys (several), forms, tolerance, unit (no tops, no
--    spread); the room's result num {forms, tolerance, unit}; the review item's ranges and keys.
-- 4. «Тренировать ошибки»: a range question missed is recorded as «не знаю» (text null): the player stood on a range,
--    typed no number, and the study core grades a number item by a typed text only.
-- Changed functions (whole bodies, as the file before left them plus the change): live_more, live_create, live_close,
-- live_base_json, live_closed_json, live_host_json, live_review (20261102090100); live_stand_result, live_mixed_result
-- (20261102090000). New: meldy_private.live_ranges, live_range_text.
-- Re-runnable: IF NOT EXISTS, OR REPLACE, guarded blocks. The whole file is one request (supabase/migrate.py).

do $do$
begin
  if pg_catalog.to_regprocedure('meldy_private.live_number_value(text, text)') is null
     or pg_catalog.to_regprocedure('public.meldy_number_right(text, text[], numeric, text)') is null then
    raise exception 'the base is expected: 20261102090100_live_numbers.sql and every migration before it';
  end if;
end;
$do$;

-- ─────────────────────────────────────────── 1. Columns and checks ───────────────────────────────────────────

alter table public.live_questions add column if not exists bounds numeric[];

do $do$
begin
  -- a typed answer has no options; a number may have 2–6 (its ranges); a choice question 2–6
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_questions'::regclass and k.conname = 'live_questions_options_check'
                    and pg_catalog.pg_get_constraintdef(k.oid) like '%kind = ''number''::text%') then
    alter table public.live_questions drop constraint if exists live_questions_options_check;
    alter table public.live_questions add constraint live_questions_options_check
      check (jsonb_typeof(options) = 'array' and cardinality(shown) = jsonb_array_length(options)
             and case when kind = 'short' then jsonb_array_length(options) = 0
                      when kind = 'number' then jsonb_array_length(options) = 0
                                                or (jsonb_array_length(options) >= 2 and jsonb_array_length(options) <= 6)
                      else jsonb_array_length(options) >= 2 and jsonb_array_length(options) <= 6 end);
  end if;
  -- a typed answer (no options) has no key (-1); a range question, as any other, a shown option
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_questions'::regclass and k.conname = 'live_questions_key_check'
                    and pg_catalog.pg_get_constraintdef(k.oid) like '%cardinality(shown) = 0%') then
    alter table public.live_questions drop constraint if exists live_questions_key_check;
    alter table public.live_questions add constraint live_questions_key_check
      check (case when kind in ('short', 'number') and cardinality(shown) = 0 then key = -1 else key >= 0 and key < cardinality(shown) end);
  end if;
  -- several right options of a 'multiple' question, or several right ranges of a number question
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_questions'::regclass and k.conname = 'live_questions_keys_check'
                    and pg_catalog.pg_get_constraintdef(k.oid) like '%number%') then
    alter table public.live_questions drop constraint if exists live_questions_keys_check;
    alter table public.live_questions add constraint live_questions_keys_check
      check ((kind <> 'multiple' or keys is not null) and (keys is null or kind in ('multiple', 'number'))
             and (keys is null or (cardinality(keys) between 2 and cardinality(shown) and key = keys[1])));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.live_questions'::regclass and k.conname = 'live_questions_number_check'
                    and pg_catalog.pg_get_constraintdef(k.oid) like '%bounds%') then
    alter table public.live_questions drop constraint if exists live_questions_number_check;
    alter table public.live_questions add constraint live_questions_number_check
      check ((tolerance is null or (kind = 'number' and tolerance >= 0))
             and (unit is null or (kind = 'number' and char_length(unit) between 1 and 20))
             and (spread is null or (kind = 'number' and jsonb_typeof(spread) = 'array' and jsonb_array_length(spread) <= 60))
             and (bounds is null or (kind = 'number' and cardinality(bounds) = jsonb_array_length(options) - 1)));
  end if;
end;
$do$;
comment on column public.live_questions.bounds is 'A number question played as ranges: the limits between its ranges, ascending (one fewer than the options); null otherwise.';

-- ─────────────────────────────────────────── 2. The ranges ───────────────────────────────────────────

-- 2a. A limit as a range's label says it: a decimal comma, «−», a no-break space between thousands from five digits on,
--     no trailing zeros («−12,5», «12 500», «0,25»).
create or replace function meldy_private.live_range_text(p_v numeric)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select case when p_v < 0 then '−' else '' end
         || case when pg_catalog.char_length(pg_catalog.split_part(x.t, '.', 1)) >= 5
                 then pg_catalog.regexp_replace(pg_catalog.split_part(x.t, '.', 1), '(\d)(?=(\d{3})+$)', '\1' || pg_catalog.chr(160), 'g')
                 else pg_catalog.split_part(x.t, '.', 1) end
         || case when pg_catalog.strpos(x.t, '.') > 0 then ',' || pg_catalog.split_part(x.t, '.', 2) else '' end
    from (select pg_catalog.trim_scale(pg_catalog.abs(p_v))::text as t) x
$fn$;

-- 2b. A number question's p_n ranges with the right one at place p_slot (0..p_n-1): {options: [label…], bounds: [the
--     p_n−1 limits, ascending], keys: [every range holding an accepted number]}; null without a canonical accepted
--     number. The first accepted number a and the tolerance t: the width is the first round one (1, 2, 2.5, 5 × 10^k) of
--     at least max(2t, |a|/4, one step of a's last digit) whose grid — or the grid moved by half a width — holds the
--     band [a − t, a + t] strictly inside one range (tried in the order w0, w1, w1 moved, w0 moved, then w2, w2 moved,
--     …: the plainer labels first). Range p_slot is that one; the others step a width away; the ends are open. Pure:
--     the place is the caller's (live_create draws it at random).
create or replace function meldy_private.live_ranges(p_answers text[], p_tolerance numeric, p_n integer, p_slot integer)
returns jsonb
language plpgsql
immutable
parallel safe
set search_path = ''
as $fn$
declare
  v_a numeric;
  v_t numeric := greatest(coalesce(p_tolerance, 0), 0);
  v_base numeric;
  v_steps numeric[] := '{}'::numeric[];
  v_e integer;
  v_m numeric;
  v_try integer[];
  v_tries integer[][] := '{{1,0},{2,0},{2,1},{1,1}}'::integer[][];
  v_w numeric;
  v_off numeric;
  v_lo numeric;
  v_found boolean := false;
  v_bounds numeric[];
  v_labels jsonb := '[]'::jsonb;
  v_keys jsonb;
  i integer;
begin
  select x.f::numeric into v_a
    from pg_catalog.unnest(p_answers) with ordinality as x(f, o)
   where x.f ~ '^-?[0-9]+(\.[0-9]+)?$' and pg_catalog.char_length(x.f) <= 40
   order by x.o
   limit 1;
  if v_a is null or p_n is null or p_n < 2 or p_n > 6 or p_slot is null or p_slot < 0 or p_slot >= p_n then
    return null;
  end if;
  v_base := greatest(2 * v_t, pg_catalog.abs(v_a) / 4, pg_catalog.power(10::numeric, - pg_catalog.scale(v_a)));
  v_e := pg_catalog.floor(pg_catalog.log(v_base))::integer;
  while pg_catalog.cardinality(v_steps) < 14 loop
    foreach v_m in array array[1, 2, 2.5, 5]::numeric[] loop
      if v_m * pg_catalog.power(10::numeric, v_e) >= v_base and pg_catalog.cardinality(v_steps) < 14 then
        v_steps := v_steps || pg_catalog.trim_scale(v_m * pg_catalog.power(10::numeric, v_e));
      end if;
    end loop;
    v_e := v_e + 1;
  end loop;
  for i in 3 .. 14 loop
    v_tries := v_tries || array[array[i, 0], array[i, 1]];
  end loop;
  foreach v_try slice 1 in array v_tries loop
    v_w := v_steps[v_try[1]];
    v_off := case when v_try[2] = 1 then v_w / 2 else 0 end;
    v_lo := pg_catalog.floor((v_a - v_off) / v_w) * v_w + v_off;
    if v_lo < v_a - v_t and v_a + v_t < v_lo + v_w then
      v_found := true;
      exit;
    end if;
  end loop;
  if not v_found then
    return null;
  end if;
  select pg_catalog.array_agg(pg_catalog.trim_scale(v_lo + (s - p_slot) * v_w) order by s) into v_bounds
    from pg_catalog.generate_series(1, p_n - 1) s;
  for i in 0 .. p_n - 1 loop
    v_labels := v_labels || pg_catalog.to_jsonb(case
      when i = 0 then 'меньше' || pg_catalog.chr(160) || meldy_private.live_range_text(v_bounds[1])
      when i = p_n - 1 then 'больше' || pg_catalog.chr(160) || meldy_private.live_range_text(v_bounds[p_n - 1])
      when v_bounds[i] < 0 then 'от' || pg_catalog.chr(160) || meldy_private.live_range_text(v_bounds[i]) || ' до'
                                 || pg_catalog.chr(160) || meldy_private.live_range_text(v_bounds[i + 1])
      else meldy_private.live_range_text(v_bounds[i]) || '–' || meldy_private.live_range_text(v_bounds[i + 1]) end);
  end loop;
  select pg_catalog.jsonb_agg(z.k order by z.k) into v_keys
    from (select distinct (select pg_catalog.count(*) from pg_catalog.unnest(v_bounds) b where b <= x.f::numeric)::integer as k
            from pg_catalog.unnest(p_answers) x(f)
           where x.f ~ '^-?[0-9]+(\.[0-9]+)?$' and pg_catalog.char_length(x.f) <= 40) z;
  return pg_catalog.jsonb_build_object('options', v_labels, 'bounds', pg_catalog.to_jsonb(v_bounds), 'keys', v_keys);
end;
$fn$;

-- 2c. The kinds a game plays, as 20261102090100 2b, but a number wherever: on a button place it is typed, on a movement
--     round's place (and in «Встань на ответ») it is played as ranges.
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
    when p_item.kind = 'number' and pg_catalog.cardinality(p_item.answers) between 1 and 10 then 'number'
  end
$fn$;

-- ─────────────────────────────────────────── 3. Create ───────────────────────────────────────────

-- 3a. Create, as 20261102090100 3a, plus: a number on a movement round's place (every place of «Встань на ответ») is
--     drawn as four ranges (live_ranges, the right one at a random place): kind 'number', options = the labels, shown
--     0–3, key (and keys, when another accepted number falls in another range), bounds, and the accepted numbers,
--     tolerance and unit kept for the reveal and the review. live_arrange now keeps only text answers off the rounds.
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
  v_ranges jsonb;
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
    -- a number on a movement round's place (every question of «Встань на ответ»): four ranges on the floor, the right
    -- one at a random place
    if v_kind = 'number' and (v_mode = 'stand' or (v_every > 0 and meldy_private.live_stand_round(v_every, v_g.q_count, v_ord))) then
      v_ranges := meldy_private.live_ranges(v_item.answers, v_item.tolerance, 4, pg_catalog.floor(pg_catalog.random() * 4)::integer);
      v_keys := (select pg_catalog.array_agg(x.k::smallint order by x.o)
                   from pg_catalog.jsonb_array_elements_text(v_ranges -> 'keys') with ordinality as x(k, o));
      insert into public.live_questions (game_id, qi, item_id, text, options, shown, key, kind, keys, forms, explanation, tolerance,
                                         unit, bounds)
      values (v_g.id, v_ord, v_item.id, v_item.stem, v_ranges -> 'options', '{0,1,2,3}'::smallint[], v_keys[1], 'number',
              case when pg_catalog.cardinality(v_keys) > 1 then v_keys end, v_item.answers,
              nullif(pg_catalog.btrim(v_item.explanation), ''), v_item.tolerance, nullif(pg_catalog.btrim(v_item.unit), ''),
              (select pg_catalog.array_agg(x.b::numeric order by x.o)
                 from pg_catalog.jsonb_array_elements_text(v_ranges -> 'bounds') with ordinality as x(b, o)));
    elsif v_kind in ('short', 'number') then
      insert into public.live_questions (game_id, qi, item_id, text, options, shown, key, kind, forms, explanation, tolerance, unit)
      values (v_g.id, v_ord, v_item.id, v_item.stem, '[]'::jsonb, '{}'::smallint[], -1, v_kind, v_item.answers,
              nullif(pg_catalog.btrim(v_item.explanation), ''),
              case when v_kind = 'number' then v_item.tolerance end,
              case when v_kind = 'number' then nullif(pg_catalog.btrim(v_item.unit), '') end);
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

-- ─────────────────────────────────────────── 4. The engine ───────────────────────────────────────────

-- 4a. Closing a question, as 20261102090100 4a: a range question is a zone question (its zone right when it is a right
--     range, keys or key, as any); the tops and the spread are a typed number question's only.
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
  v_nums numeric[];
  v_spread jsonb;
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
    elsif v_a.typed is not null and v_q.kind = 'number' then
      v_share := case when public.meldy_number_right(v_a.typed, v_q.forms, v_q.tolerance, v_q.unit) then 1 else 0 end;
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
  elsif v_q.kind = 'number' and pg_catalog.jsonb_array_length(v_q.options) = 0 then
    -- the numbers typed, read as meldy_number_right reads them (what is no number is left out): the three nearest a right
    -- value (then the most typed, then the smaller) and up to 60 values with their counts, the most typed, for the line
    select pg_catalog.array_agg(z.v) into v_nums
      from (select meldy_private.live_number_value(a.typed, v_q.unit) as v
              from public.live_answers a join public.live_players p on p.id = a.player_id
             where a.game_id = p_game and a.qi = v_g.qi and p.kicked_at is null and a.typed is not null) z
     where z.v is not null;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('text', t.v::text, 'n', t.n, 'ok', t.d <= coalesce(v_q.tolerance, 0))
                                         order by t.d, t.n desc, t.v), '[]'::jsonb)
      into v_tops
      from (select y.v, y.n, y.d
              from (select c.v, c.n,
                           (select pg_catalog.min(pg_catalog.abs(c.v - f::numeric)) from pg_catalog.unnest(v_q.forms) f
                             where f ~ '^-?[0-9]+(\.[0-9]+)?$' and pg_catalog.char_length(f) <= 40) as d
                      from (select u.v, pg_catalog.count(*)::integer as n from pg_catalog.unnest(v_nums) u(v) group by u.v) c) y
             order by y.d, y.n desc, y.v
             limit 3) t;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(s.v::text, s.n) order by s.v), '[]'::jsonb)
      into v_spread
      from (select u.v, pg_catalog.count(*)::integer as n from pg_catalog.unnest(v_nums) u(v)
             group by u.v order by pg_catalog.count(*) desc, u.v limit 60) s;
  end if;
  update public.live_questions q
     set closed_at = pg_catalog.now(), counts = v_counts, right_n = v_right, healed = v_healed,
         phase_changed = case when v_phase > v_g.phase then v_phase end, hits = v_hits, frozen_now = v_frozen,
         thawed = v_thawed, rank_before = v_rank, tops = v_tops, spread = v_spread
   where q.game_id = p_game and q.qi = v_g.qi;
  update public.live_games g
     set state = 'reveal', state_at = pg_catalog.now(), hp = v_hp, phase = v_phase, rev = g.rev + 1
   where g.id = p_game;
end;
$fn$;

-- ─────────────────────────────────────────── 5. What the screens and the room read ───────────────────────────────────────────

-- 5a. As 20261102090100 5a, plus: a range question says so (ranges: true) beside its kind and unit; its options are the
--     ranges' labels.
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
              when v_q.kind = 'number' then pg_catalog.jsonb_build_object('kind', 'number', 'unit', v_q.unit)
                                            || case when pg_catalog.jsonb_array_length(v_q.options) > 0 then '{"ranges": true}'::jsonb
                                                    else '{}'::jsonb end
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

-- 5b. As 20261102090100 5b: a closed range question gives its right zones (keys, when more than one), the accepted
--     numbers, the tolerance and the unit (the true value shown inside the right range), no tops.
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
                 when q.kind = 'number' and pg_catalog.jsonb_array_length(q.options) > 0
                 then pg_catalog.jsonb_build_object('ranges', true, 'forms', pg_catalog.to_jsonb(q.forms), 'tolerance', q.tolerance, 'unit', q.unit)
                      || case when q.keys is not null then pg_catalog.jsonb_build_object('keys', pg_catalog.to_jsonb(q.keys)) else '{}'::jsonb end
                 when q.kind = 'number' then pg_catalog.jsonb_build_object('forms', pg_catalog.to_jsonb(q.forms), 'tolerance', q.tolerance,
                                                                           'unit', q.unit, 'tops', coalesce(q.tops, '[]'::jsonb))
                 else '{}'::jsonb end
    from public.live_questions q
   where q.game_id = p_g.id and q.qi = p_g.qi and q.closed_at is not null
     and p_g.state in ('reveal', 'leaderboard', 'podium', 'ended')
$fn$;

-- 5c. As 20261102090100 5d: the spread is a typed number question's only.
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
      'thawed', pg_catalog.to_jsonb(coalesce(v_q.thawed, '{}'::uuid[])))
      || case when v_q.kind = 'number' and pg_catalog.jsonb_array_length(v_q.options) = 0 then pg_catalog.jsonb_build_object('spread', coalesce(v_q.spread, '[]'::jsonb)) else '{}'::jsonb end;
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

-- 5d. The review, as 20261102090100 5e, plus: a range question says so, with its right zones when more than one; the
--     zone stood on is the item's choice.
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
                     when q.kind = 'number'
                     then pg_catalog.jsonb_build_object('kind', 'number', 'forms', pg_catalog.to_jsonb(q.forms), 'tolerance', q.tolerance,
                                                        'unit', q.unit, 'typed', a.typed)
                          || case when pg_catalog.jsonb_array_length(q.options) > 0 then pg_catalog.jsonb_build_object('ranges', true) else '{}'::jsonb end
                          || case when q.keys is not null then pg_catalog.jsonb_build_object('keys', pg_catalog.to_jsonb(q.keys)) else '{}'::jsonb end
                     else '{}'::jsonb end
             || case when q.explanation is not null then pg_catalog.jsonb_build_object('explanation', q.explanation) else '{}'::jsonb end
             order by q.qi), '[]'::jsonb)
      from public.live_questions q
      left join public.live_answers a on a.game_id = q.game_id and a.qi = q.qi and a.player_id = v_p.id
     where q.game_id = p_game and q.closed_at is not null));
end;
$fn$;

-- 5e. A closed «Встань на ответ» question as the room reads it, as 20261102090000 5e, plus a range question's right zones
--     (keys, when more than one) and its numbers (num: forms, tolerance, unit) for the reveal.
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
    || case when q.keys is not null then pg_catalog.jsonb_build_object('keys', pg_catalog.to_jsonb(q.keys)) else '{}'::jsonb end
    || case when q.kind = 'number'
            then pg_catalog.jsonb_build_object('num', pg_catalog.jsonb_build_object('forms', pg_catalog.to_jsonb(q.forms), 'tolerance', q.tolerance,
                                                                                   'unit', q.unit))
            else '{}'::jsonb end
    from public.live_questions q
   where q.game_id = p_game and q.qi = p_qi and q.closed_at is not null
$fn$;

-- 5f. A closed movement round of a mixed game as the room reads it, as 20261102090000 5f, plus the same.
create or replace function meldy_private.live_mixed_result(p_game uuid, p_qi integer, p_again boolean)
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
    'void', q.room_at is null,
    'healed', q.healed, 'phase_changed', q.phase_changed, 'hits', coalesce(q.hits, '[]'::jsonb),
    'frozen_now', pg_catalog.to_jsonb(coalesce(q.frozen_now, '{}'::uuid[])), 'thawed', pg_catalog.to_jsonb(coalesce(q.thawed, '{}'::uuid[])),
    'boss', (select pg_catalog.jsonb_build_object('hp', g.hp, 'hp_max', g.hp_max, 'phase', g.phase, 'defeated', g.hp_max > 0 and g.hp = 0)
               from public.live_games g where g.id = p_game),
    'rows', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'p', p.id, 'c', a.choice, 'ok', coalesce(a.correct, false), 'dmg', coalesce(a.dmg, 0), 'ms', a.elapsed_ms,
               'thawed', p.id = any (coalesce(q.thawed, '{}'::uuid[])), 'froze', p.id = any (coalesce(q.frozen_now, '{}'::uuid[])),
               'frozen', p.frozen, 'out', p.joined_at > q.opens_at, 'total', p.dmg, 'streak', p.streak, 'best', p.best,
               'right', p.right_n, 'place', r.place::integer) order by r.place), '[]'::jsonb)
               from pg_catalog.unnest(meldy_private.live_rank(p_game)) with ordinality as r(id, place)
               join public.live_players p on p.id = r.id
               left join public.live_answers a on a.game_id = p_game and a.qi = q.qi and a.player_id = p.id))
    || case when q.keys is not null then pg_catalog.jsonb_build_object('keys', pg_catalog.to_jsonb(q.keys)) else '{}'::jsonb end
    || case when q.kind = 'number'
            then pg_catalog.jsonb_build_object('num', pg_catalog.jsonb_build_object('forms', pg_catalog.to_jsonb(q.forms), 'tolerance', q.tolerance,
                                                                                   'unit', q.unit))
            else '{}'::jsonb end
    from public.live_questions q
   where q.game_id = p_game and q.qi = p_qi and q.closed_at is not null
$fn$;

-- ─────────────────────────────────────────── 6. Grants ───────────────────────────────────────────
-- create or replace keeps the grants of the changed functions; the new private ones are taken back from everyone.
revoke all on function meldy_private.live_ranges(text[], numeric, integer, integer), meldy_private.live_range_text(numeric)
  from public, anon, authenticated, service_role;
