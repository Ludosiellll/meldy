-- live_challenge («Соревнование в своё время»: the battle's questions by a link with a deadline, each person alone, when
-- it suits them; a leaderboard by the same link)
-- Repo file: supabase/migrations/20261106090100_live_challenge.sql. Base: 20261106090000_live_calm.sql (and every live
-- migration before it: live_share, live_damage, live_more, the name and look checks), 20261101090000_question_kinds.sql
-- (public.meldy_number_right), 20261018130000_quiz_guards.sql (quiz_ip_hash, quiz_practice_ready).
-- Why (spec «Режимы — что решено», item 3; release 50 phase 2): the author makes a link with a deadline from a test or an
-- exam; each person plays the same questions alone, on a phone or a computer, with no host and no account (a name, as on
-- /play); each answer is graded by the server's time; one attempt a device (a guest token kept only as sha256); after
-- each question the key and the explanation, at the end the own review and «Тренировать ошибки»; a leaderboard by the
-- link that fills as people finish; the author closes it early and sees the results on «Игры» and the test's page.
-- Contract: docs/live/CHALLENGE.md (the rules, the shapes, who sees what, the limits).
-- Why new tables (not quiz_attempts, not live_games): a quiz attempt has no server time per question (no speed points,
-- no fair table); a live game is one host-driven state machine with one current question for everybody. Here each run
-- has its own current question with its own server times.
-- The numbers are the battle's for one player (docs/live/CONTRACT.md §3): the same grading (meldy_private.live_share,
-- public.meldy_number_right, public.meldy_short_norm), the same damage (meldy_private.live_damage, «Без спешки»: 100),
-- freeze, thaw, the boss's phases and heal (meldy_private.live_phase_for, live_heal) against a boss of 55 HP a question.
-- Check after the apply: supabase/tests/live_challenge.sql (catalog only; read-only). Local rehearsal (never live):
-- supabase/tests/local/live_game_run.sh, its challenge stage (live_challenge_behaviour.sql).
-- Rollback: supabase/rollback/20261106090100_live_challenge_down.sql (drops the four tables and the functions: the
-- challenges and their runs go; nothing else changes).
-- Release order: the site first (its new pages call these functions; until they exist the pages say «не получилось»),
-- then this file. The Space has nothing to change (the /sb proxy passes every rest/v1 call).
-- Strictly additive: no existing table, function, grant or JSON shape changes. The public functions are challenge_*, not
-- live_*: the older contracts (tests/live_game.sql, live_mixed.sql) count the public live_* functions and want each of
-- them for anon, while the author's functions here are for authenticated only. The private helpers keep the live_ names
-- (and those contracts' rule for them: search_path = '', no EXECUTE for the API roles).
-- Re-runnable: IF NOT EXISTS, OR REPLACE, guarded blocks. The whole file is one request (supabase/migrate.py).

do $do$
begin
  if pg_catalog.to_regclass('public.live_games') is null
     or not exists (select 1 from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = 'live_games' and c.column_name = 'calm')
     or pg_catalog.to_regprocedure('meldy_private.live_share(smallint[], smallint[])') is null
     or pg_catalog.to_regprocedure('meldy_private.live_more(public.test_items, boolean)') is null
     or pg_catalog.to_regprocedure('public.meldy_number_right(text, text[], numeric, text)') is null
     or pg_catalog.to_regprocedure('meldy_private.quiz_practice_ready(uuid)') is null
     or pg_catalog.to_regprocedure('meldy_private.record_test_answers_for(uuid, jsonb, text, integer, text, uuid)') is null then
    raise exception 'the base is expected: 20261106090000_live_calm.sql and every live migration before it';
  end if;
end;
$do$;

-- ─────────────────────────────────────────── 1. Tables ───────────────────────────────────────────

-- 1a. A challenge: its source, its link code (meldy_private.random_code: 12 characters), the settings, the deadline and
--     an early close, the questions' count. swept_at: when every run still under way at the end was closed (once).
create table if not exists public.live_challenges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  container_id uuid not null references public.containers(id) on delete cascade,
  quiz_id uuid references public.quizzes(id) on delete set null,
  title text not null,
  code text not null,
  time_s smallint not null default 20,
  speed boolean not null default true,
  calm boolean not null default false,
  q_count smallint not null,
  skipped integer not null default 0,
  deadline timestamptz not null,
  closed_at timestamptz,
  swept_at timestamptz,
  created_at timestamptz not null default now(),
  constraint live_challenges_title_check check (char_length(btrim(title)) between 1 and 200),
  constraint live_challenges_code_check check (code ~ '^[0-9a-hjkmnp-tv-z]{12}$'),
  constraint live_challenges_time_check check (time_s in (10, 20, 30)),
  constraint live_challenges_calm_check check (not calm or not speed),
  constraint live_challenges_q_count_check check (q_count between 1 and 30),
  constraint live_challenges_skipped_check check (skipped >= 0),
  constraint live_challenges_deadline_check check (deadline > created_at and deadline <= created_at + interval '31 days'),
  constraint live_challenges_closed_check check (closed_at is null or closed_at >= created_at)
);
create unique index if not exists live_challenges_code_uidx on public.live_challenges (code);
create index if not exists live_challenges_owner_idx on public.live_challenges (owner_id, created_at desc);
create index if not exists live_challenges_container_idx on public.live_challenges (container_id, created_at desc);
create index if not exists live_challenges_quiz_idx on public.live_challenges (quiz_id) where quiz_id is not null;
alter table public.live_challenges enable row level security;
comment on table public.live_challenges is 'Own-time challenges («Соревнование в своё время»): only through the public.challenge_* functions.';

-- 1b. The questions, frozen at create (an edit of the exam does not change a challenge): as live_questions — text and
--     options in the shown order, the key as a shown index (keys for several right answers), the accepted forms of a
--     text answer or the accepted numbers of a number question with its tolerance and unit, the explanation.
create table if not exists public.live_challenge_questions (
  challenge_id uuid not null references public.live_challenges(id) on delete cascade,
  qi smallint not null,
  item_id uuid,
  kind text not null,
  text text not null,
  options jsonb not null,
  shown smallint[] not null,
  key smallint not null,
  keys smallint[],
  forms text[],
  tolerance numeric,
  unit text,
  explanation text,
  primary key (challenge_id, qi),
  constraint live_challenge_questions_qi_check check (qi between 0 and 29),
  constraint live_challenge_questions_kind_check check (kind in ('single', 'multiple', 'short', 'number')),
  constraint live_challenge_questions_options_check check (
    jsonb_typeof(options) = 'array' and cardinality(shown) = jsonb_array_length(options)
    and case when kind in ('short', 'number') then jsonb_array_length(options) = 0
             else jsonb_array_length(options) between 2 and 6 end),
  constraint live_challenge_questions_key_check check (
    case when kind in ('short', 'number') then key = -1 else key >= 0 and key < cardinality(shown) end),
  constraint live_challenge_questions_keys_check check ((kind = 'multiple') = (keys is not null) and (keys is null or cardinality(keys) >= 2)),
  constraint live_challenge_questions_forms_check check (
    (kind in ('short', 'number')) = (forms is not null) and (forms is null or cardinality(forms) between 1 and 10)),
  constraint live_challenge_questions_number_check check (
    (tolerance is null or (kind = 'number' and tolerance >= 0)) and (unit is null or (kind = 'number' and char_length(unit) between 1 and 20)))
);
alter table public.live_challenge_questions enable row level security;
comment on table public.live_challenge_questions is 'Questions of a challenge with their keys: never readable by clients; a key leaves only once that person answered or ran out of time.';

-- 1c. A run: one person's attempt. token_hash: sha256 hex of the device's token (the token is never stored or returned);
--     user_id: a signed-in player (one run an account). qi: the run's current question (-1 before the first). The own
--     boss (hp, hp_max = 55 × questions, phase) and the battle's numbers (dmg, right_n, streak, best, frozen, thaws).
--     time_ms: the time taken, the whole time of a question left without an answer. finished_at: the run's end (its last
--     question graded, or the challenge over). removed_at: the author took it off the table (its token stops working).
create table if not exists public.live_runs (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.live_challenges(id) on delete cascade,
  token_hash text not null,
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  look jsonb not null,
  joined_at timestamptz not null default now(),
  qi smallint not null default -1,
  dmg integer not null default 0,
  right_n smallint not null default 0,
  streak smallint not null default 0,
  best smallint not null default 0,
  frozen boolean not null default false,
  thaws smallint not null default 0,
  hp integer not null,
  hp_max integer not null,
  phase smallint not null default 0,
  time_ms integer not null default 0,
  finished_at timestamptz,
  removed_at timestamptz,
  constraint live_runs_token_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint live_runs_name_check check (char_length(name) between 1 and 24),
  constraint live_runs_look_check check (jsonb_typeof(look) = 'object'),
  constraint live_runs_qi_check check (qi between -1 and 29),
  constraint live_runs_numbers_check check (dmg >= 0 and right_n >= 0 and streak >= 0 and best >= streak and thaws >= 0 and time_ms >= 0),
  constraint live_runs_hp_check check (hp_max > 0 and hp between 0 and hp_max),
  constraint live_runs_phase_check check (phase in (0, 1, 2))
);
create unique index if not exists live_runs_token_uidx on public.live_runs (challenge_id, token_hash);
create unique index if not exists live_runs_user_uidx on public.live_runs (challenge_id, user_id) where user_id is not null;
create index if not exists live_runs_challenge_idx on public.live_runs (challenge_id, joined_at);
create index if not exists live_runs_board_idx on public.live_runs (challenge_id, dmg desc, right_n desc, time_ms, finished_at, id)
  where finished_at is not null and removed_at is null;
create index if not exists live_runs_user_idx on public.live_runs (user_id) where user_id is not null;
alter table public.live_runs enable row level security;
comment on table public.live_runs is 'Runs of challenges (sha256 of their tokens only): only through the public.challenge_* functions.';

-- 1d. A run's questions: written when the server sends the question (opened_at; answers from opens_at = opened_at + 3 s
--     to closes_at = opens_at + time_s, plus 1.5 s), graded at the answer or when the time ran out (settled_at). phase:
--     the boss's phase the question opened with (its rules apply to it). The result is kept as the run saw it.
create table if not exists public.live_run_answers (
  run_id uuid not null references public.live_runs(id) on delete cascade,
  qi smallint not null,
  challenge_id uuid not null,
  opened_at timestamptz not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  phase smallint not null,
  at timestamptz,
  choice smallint,
  picks smallint[],
  typed text,
  elapsed_ms integer,
  settled_at timestamptz,
  correct boolean,
  share double precision,
  dmg integer,
  thawed boolean,
  frozen boolean,
  healed integer,
  hp_after integer,
  phase_changed smallint,
  primary key (run_id, qi),
  foreign key (challenge_id, qi) references public.live_challenge_questions(challenge_id, qi) on delete cascade,
  constraint live_run_answers_times_check check (opens_at >= opened_at and closes_at > opens_at),
  constraint live_run_answers_phase_check check (phase in (0, 1, 2) and (phase_changed is null or phase_changed in (1, 2))),
  constraint live_run_answers_one_check check (num_nonnulls(choice, picks, typed) <= 1 and (at is null) = (num_nonnulls(choice, picks, typed) = 0)),
  constraint live_run_answers_choice_check check (choice is null or choice between 0 and 5),
  constraint live_run_answers_picks_check check (picks is null or cardinality(picks) between 1 and 6),
  constraint live_run_answers_typed_check check (typed is null or char_length(typed) between 1 and 200),
  constraint live_run_answers_elapsed_check check (elapsed_ms is null or elapsed_ms between 0 and 30000),
  constraint live_run_answers_settled_check check ((settled_at is null) = (correct is null) and (correct is null) = (dmg is null)),
  constraint live_run_answers_dmg_check check (dmg is null or dmg between 0 and 200)
);
create index if not exists live_run_answers_challenge_idx on public.live_run_answers (challenge_id, qi);
alter table public.live_run_answers enable row level security;
comment on table public.live_run_answers is 'Answers of challenge runs, one a run and question: only through the public.challenge_* functions.';

-- 1e. The address throttle of starts (HMAC of the address, meldy_private.quiz_ip_hash), as live_join_hits; two minutes kept.
create table if not exists meldy_private.live_challenge_hits (
  ip_hash text not null,
  at timestamptz not null default now()
);
create index if not exists live_challenge_hits_idx on meldy_private.live_challenge_hits (ip_hash, at);
create index if not exists live_challenge_hits_at_idx on meldy_private.live_challenge_hits (at);
alter table meldy_private.live_challenge_hits enable row level security;

-- ─────────────────────────────────────────── 2. Pure helpers ───────────────────────────────────────────

-- 2a. The kind a challenge plays an item as, or null: the battle's kinds (one right option of 2–6; several right of 2–6;
--     a text answer or a number with 1–10 accepted answers: meldy_private.live_more), never an item with a picture
--     (the pictures function reads a game's or a quiz attempt's only) nor order, match, cloze, essay.
create or replace function meldy_private.live_challenge_kind(p_item public.test_items)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case
    when coalesce(pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(p_item.images -> 'stem') = 'array'
                                                     then p_item.images -> 'stem' end), 0) > 0
         or exists (select 1
                      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_item.images -> 'options') = 'array'
                                                                then p_item.images -> 'options' else '[]'::jsonb end) o
                     where pg_catalog.jsonb_typeof(o) = 'array' and pg_catalog.jsonb_array_length(o) > 0) then null
    when p_item.kind in ('single', 'multiple') and pg_catalog.cardinality(p_item.correct) = 1
         and pg_catalog.jsonb_array_length(p_item.options) between 2 and 6 then 'single'
    else meldy_private.live_more(p_item, true)
  end
$fn$;

-- 2b. The share of an answer, as meldy_private.live_close grades one (CONTRACT §3): ticks by live_share against the
--     keys, a number by meldy_number_right, a text by the normal forms, a tap by the keys; nothing is 0.
create or replace function meldy_private.live_challenge_share(p_q public.live_challenge_questions, p_choice smallint,
                                                               p_picks smallint[], p_typed text)
returns double precision
language sql
stable
set search_path = ''
as $fn$
  select case
    when p_picks is not null then meldy_private.live_share(p_picks, coalesce(p_q.keys, array[p_q.key]))
    when p_typed is not null and p_q.kind = 'number'
      then case when public.meldy_number_right(p_typed, p_q.forms, p_q.tolerance, p_q.unit) then 1 else 0 end::double precision
    when p_typed is not null
      then case when public.meldy_short_norm(p_typed) = any (coalesce((select pg_catalog.array_agg(public.meldy_short_norm(f))
                                                                         from pg_catalog.unnest(p_q.forms) f), '{}'::text[]))
                then 1 else 0 end::double precision
    when p_choice is not null then case when p_choice = any (coalesce(p_q.keys, array[p_q.key])) then 1 else 0 end::double precision
    else 0::double precision
  end
$fn$;

-- 2c. The challenge is over: closed by the author, or its deadline passed.
create or replace function meldy_private.live_challenge_over(p_c public.live_challenges)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select p_c.closed_at is not null or pg_catalog.now() >= p_c.deadline
$fn$;

-- When it ended (null while open).
create or replace function meldy_private.live_challenge_end_at(p_c public.live_challenges)
returns timestamptz
language sql
stable
set search_path = ''
as $fn$
  select case when p_c.closed_at is not null then least(p_c.closed_at, p_c.deadline)
              when pg_catalog.now() >= p_c.deadline then p_c.deadline end
$fn$;

-- ─────────────────────────────────────────── 3. The engine ───────────────────────────────────────────

-- 3a. One answer (or none: the time ran out) of a run's current question, graded as the battle's close grades one
--     player (meldy_private.live_close, CONTRACT §3): share 1 → damage (100 in «Без спешки»), streak +1; a frozen player
--     thaws (no damage, streak 1); share between 0 and 1 → round(damage × share), streak 0 (a frozen player deals 0);
--     share 0 → streak 0 and frozen; no answer → streak 0, frozen only from the boss's phase 1. «Без спешки»: nobody
--     freezes. In phase 2 a miss heals the boss 5 % (only while it is alive). The caller holds the run's lock.
create or replace function meldy_private.live_run_score(p_run uuid, p_qi integer, p_choice smallint, p_picks smallint[],
                                                        p_typed text, p_at timestamptz)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_r public.live_runs;
  v_c public.live_challenges;
  v_q public.live_challenge_questions;
  v_a public.live_run_answers;
  v_none boolean := p_choice is null and p_picks is null and p_typed is null;
  v_elapsed integer;
  v_share double precision := 0;
  v_dmg integer := 0;
  v_right boolean := false;
  v_thawed boolean := false;
  v_healed integer := 0;
  v_hp integer;
  v_streak integer;
  v_best integer;
  v_frozen boolean;
  v_right_n integer;
  v_thaws integer;
  v_phase smallint;
begin
  select r.* into v_r from public.live_runs r where r.id = p_run;
  select c.* into v_c from public.live_challenges c where c.id = v_r.challenge_id;
  select q.* into v_q from public.live_challenge_questions q where q.challenge_id = v_r.challenge_id and q.qi = p_qi;
  select a.* into v_a from public.live_run_answers a where a.run_id = p_run and a.qi = p_qi;
  if v_a.run_id is null or v_a.settled_at is not null then
    return;
  end if;
  if v_none then
    v_elapsed := v_c.time_s * 1000;
  else
    v_elapsed := least(greatest(pg_catalog.floor(extract(epoch from (p_at - v_a.opens_at)) * 1000), 0), v_c.time_s * 1000)::integer;
    v_share := meldy_private.live_challenge_share(v_q, p_choice, p_picks, p_typed);
  end if;
  v_hp := v_r.hp;
  v_streak := v_r.streak;
  v_best := v_r.best;
  v_frozen := v_r.frozen;
  v_right_n := v_r.right_n;
  v_thaws := v_r.thaws;
  if not v_none and v_share >= 1 then
    v_right := true;
    v_right_n := v_right_n + 1;
    if v_frozen then
      v_frozen := false;
      v_streak := 1;
      v_thaws := v_thaws + 1;
      v_best := greatest(v_best, 1);
      v_thawed := true;
    else
      v_dmg := case when v_c.calm then 100
                    else meldy_private.live_damage(v_elapsed, v_c.time_s, v_streak + 1, v_c.speed) end;
      v_hp := greatest(0, v_hp - v_dmg);
      v_streak := v_streak + 1;
      v_best := greatest(v_best, v_streak);
    end if;
  elsif not v_none and v_share > 0 then
    -- partly right: a share of the damage, no streak, no freeze (a frozen player deals 0 and stays frozen)
    v_dmg := case when v_frozen then 0
                  else pg_catalog.floor((case when v_c.calm then 100
                                              else meldy_private.live_damage(v_elapsed, v_c.time_s, v_streak + 1, v_c.speed) end)::double precision
                                        * v_share + 0.5)::integer end;
    v_hp := greatest(0, v_hp - v_dmg);
    v_streak := 0;
  elsif not v_none then
    v_streak := 0;
    v_frozen := v_frozen or not v_c.calm;
  else
    v_streak := 0;
    v_frozen := v_frozen or (not v_c.calm and v_a.phase >= 1);
  end if;
  if v_a.phase = 2 and v_hp > 0 and not v_right then
    v_healed := least(meldy_private.live_heal(v_r.hp_max), v_r.hp_max - v_hp);
    v_hp := v_hp + v_healed;
  end if;
  v_phase := greatest(v_r.phase, meldy_private.live_phase_for(v_hp, v_r.hp_max));
  update public.live_run_answers a
     set at = case when v_none then null else p_at end, choice = p_choice, picks = p_picks, typed = p_typed,
         elapsed_ms = case when v_none then null else v_elapsed end,
         settled_at = case when v_none then least(pg_catalog.now(), a.closes_at + interval '1.5 seconds') else p_at end,
         correct = v_right, share = case when v_none then 0 else v_share end, dmg = v_dmg, thawed = v_thawed,
         frozen = v_frozen, healed = v_healed, hp_after = v_hp,
         phase_changed = case when v_phase > v_r.phase then v_phase end
   where a.run_id = p_run and a.qi = p_qi;
  update public.live_runs r
     set dmg = r.dmg + v_dmg, right_n = v_right_n, streak = v_streak, best = v_best, frozen = v_frozen, thaws = v_thaws,
         hp = v_hp, phase = v_phase, time_ms = r.time_ms + v_elapsed
   where r.id = p_run;
end;
$fn$;

-- 3b. A run brought up to the server's time (the caller holds its lock): its current question left without an answer
--     past its time (closes_at + 1.5 s) is graded as none; a run whose current question is graded ends when that was the
--     last question or the challenge is over (finished_at: the moment it was graded).
create or replace function meldy_private.live_run_settle(p_run uuid)
returns public.live_runs
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_r public.live_runs;
  v_c public.live_challenges;
  v_a public.live_run_answers;
begin
  select r.* into v_r from public.live_runs r where r.id = p_run;
  if v_r.id is null or v_r.finished_at is not null or v_r.qi < 0 then
    return v_r;
  end if;
  select c.* into v_c from public.live_challenges c where c.id = v_r.challenge_id;
  select a.* into v_a from public.live_run_answers a where a.run_id = p_run and a.qi = v_r.qi;
  if v_a.settled_at is null and pg_catalog.now() > v_a.closes_at + interval '1.5 seconds' then
    perform meldy_private.live_run_score(p_run, v_r.qi, null, null, null, null);
    select a.* into v_a from public.live_run_answers a where a.run_id = p_run and a.qi = v_r.qi;
  end if;
  if v_a.settled_at is not null and (v_r.qi >= v_c.q_count - 1 or meldy_private.live_challenge_over(v_c)) then
    update public.live_runs r set finished_at = v_a.settled_at where r.id = p_run;
  end if;
  select r.* into v_r from public.live_runs r where r.id = p_run;
  return v_r;
end;
$fn$;

-- 3c. Once a challenge is over and every question that opened before its end has run out of time (35 s after the end:
--     30 s, the 3 s before it and the 1.5 s of grace), every run still under way is graded and ended, once. Runs that never
--     opened a question stay unfinished: they are on no table.
create or replace function meldy_private.live_challenge_sweep(p_challenge uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_c public.live_challenges;
  v_run uuid;
begin
  select c.* into v_c from public.live_challenges c where c.id = p_challenge for update;
  if v_c.id is null or v_c.swept_at is not null or not meldy_private.live_challenge_over(v_c)
     or pg_catalog.now() < meldy_private.live_challenge_end_at(v_c) + interval '35 seconds' then
    return;
  end if;
  for v_run in
    select r.id from public.live_runs r
     where r.challenge_id = p_challenge and r.finished_at is null and r.qi >= 0
     order by r.id
       for update
  loop
    perform meldy_private.live_run_settle(v_run);
  end loop;
  update public.live_challenges c set swept_at = pg_catalog.now() where c.id = p_challenge;
end;
$fn$;

-- 3d. The challenge of a link code (P0002 code 404), swept when it is due; locked when p_lock.
create or replace function meldy_private.live_challenge_of(p_code text, p_lock boolean)
returns public.live_challenges
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_c public.live_challenges;
begin
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    perform meldy_private.live_fail('P0002', 'code', 404);
  end if;
  select c.* into v_c from public.live_challenges c where c.code = p_code;
  if v_c.id is null then
    perform meldy_private.live_fail('P0002', 'code', 404);
  end if;
  if v_c.swept_at is null and meldy_private.live_challenge_over(v_c)
     and pg_catalog.now() >= meldy_private.live_challenge_end_at(v_c) + interval '35 seconds' then
    perform meldy_private.live_challenge_sweep(v_c.id);
  end if;
  if p_lock then
    select c.* into v_c from public.live_challenges c where c.id = v_c.id for update;
  else
    select c.* into v_c from public.live_challenges c where c.id = v_c.id;
  end if;
  return v_c;
end;
$fn$;

-- 3e. A run of this challenge by its device's token (P0002 token 404; taken off by the author → 42501 removed 403), locked
--     and brought up to the server's time.
create or replace function meldy_private.live_run_of(p_c public.live_challenges, p_token text)
returns public.live_runs
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_r public.live_runs;
begin
  if p_token is not null and p_token ~ '^[A-Za-z0-9_-]{43}$' then
    select r.* into v_r from public.live_runs r
     where r.challenge_id = p_c.id and r.token_hash = meldy_private.live_hash(p_token)
       for update;
  end if;
  if v_r.id is null then
    perform meldy_private.live_fail('P0002', 'token', 404);
  end if;
  if v_r.removed_at is not null then
    perform meldy_private.live_fail('42501', 'removed', 403);
  end if;
  return meldy_private.live_run_settle(v_r.id);
end;
$fn$;

-- 3f. A finished run's place among the finished runs not taken off (CHALLENGE.md §4: points, then right answers, then the
--     shorter time; equal on all three share the place), and how many finished.
create or replace function meldy_private.live_run_place(p_r public.live_runs)
returns integer
language sql
stable
set search_path = ''
as $fn$
  select case when p_r.finished_at is null or p_r.removed_at is not null then null
              else 1 + (select pg_catalog.count(*)::integer from public.live_runs o
                         where o.challenge_id = p_r.challenge_id and o.finished_at is not null and o.removed_at is null
                           and (o.dmg > p_r.dmg or (o.dmg = p_r.dmg and o.right_n > p_r.right_n)
                                or (o.dmg = p_r.dmg and o.right_n = p_r.right_n and o.time_ms < p_r.time_ms))) end
$fn$;

-- ─────────────────────────────────────────── 4. What the screens read ───────────────────────────────────────────

-- 4a. The challenge as anyone with the link sees it: no source, no owner, no key.
create or replace function meldy_private.live_challenge_json(p_c public.live_challenges)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'code', p_c.code, 'title', p_c.title, 'q_count', p_c.q_count, 'time_s', p_c.time_s, 'speed', p_c.speed,
    'deadline', meldy_private.live_iso(p_c.deadline),
    'state', case when meldy_private.live_challenge_over(p_c) then 'over' else 'open' end,
    'over', case when p_c.closed_at is not null and p_c.closed_at < p_c.deadline then 'closed'
                 when pg_catalog.now() >= p_c.deadline then 'deadline' end,
    'finished', (select pg_catalog.count(*) from public.live_runs r
                  where r.challenge_id = p_c.id and r.finished_at is not null and r.removed_at is null),
    'playing', (select pg_catalog.count(*) from public.live_runs r
                 where r.challenge_id = p_c.id and r.finished_at is null and r.removed_at is null and r.qi >= 0))
    || case when p_c.calm then '{"calm": true}'::jsonb else '{}'::jsonb end
$fn$;

-- 4b. A run as its own device sees it: the run's numbers and its boss; the current question (never its key before the
--     answer or the end of its time); the own answer; the result once graded (the key, the accepted forms, the
--     explanation); the place once finished.
create or replace function meldy_private.live_run_json(p_c public.live_challenges, p_r public.live_runs)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_q public.live_challenge_questions;
  v_a public.live_run_answers;
  v_question jsonb;
  v_answer jsonb;
  v_result jsonb;
begin
  if p_r.qi >= 0 then
    select q.* into v_q from public.live_challenge_questions q where q.challenge_id = p_c.id and q.qi = p_r.qi;
    select a.* into v_a from public.live_run_answers a where a.run_id = p_r.id and a.qi = p_r.qi;
    v_question := pg_catalog.jsonb_build_object(
      'qi', v_q.qi, 'text', v_q.text, 'options', v_q.options, 'opens_at', meldy_private.live_iso(v_a.opens_at),
      'closes_at', meldy_private.live_iso(v_a.closes_at), 'phase', v_a.phase)
      || case when v_q.kind = 'multiple' then pg_catalog.jsonb_build_object('kind', 'multiple', 'multi', pg_catalog.cardinality(v_q.keys))
              when v_q.kind = 'short' then pg_catalog.jsonb_build_object('kind', 'short')
              when v_q.kind = 'number' then pg_catalog.jsonb_build_object('kind', 'number', 'unit', v_q.unit)
              else '{}'::jsonb end;
    if v_a.at is not null then
      v_answer := case when v_a.picks is not null then pg_catalog.jsonb_build_object('picks', pg_catalog.to_jsonb(v_a.picks))
                       when v_a.typed is not null then pg_catalog.jsonb_build_object('typed', v_a.typed)
                       else pg_catalog.jsonb_build_object('choice', v_a.choice) end
                  || pg_catalog.jsonb_build_object('elapsed_ms', v_a.elapsed_ms);
    end if;
    if v_a.settled_at is not null then
      v_result := pg_catalog.jsonb_build_object(
        'qi', v_q.qi, 'key', v_q.key, 'correct', v_a.correct, 'none', v_a.at is null, 'dmg', v_a.dmg,
        'thawed', v_a.thawed, 'frozen', v_a.frozen, 'healed', v_a.healed, 'phase_changed', v_a.phase_changed,
        'elapsed_ms', v_a.elapsed_ms)
        || case when v_q.kind = 'multiple' then pg_catalog.jsonb_build_object('keys', pg_catalog.to_jsonb(v_q.keys), 'share', v_a.share)
                when v_q.kind = 'short' then pg_catalog.jsonb_build_object('forms', pg_catalog.to_jsonb(v_q.forms))
                when v_q.kind = 'number' then pg_catalog.jsonb_build_object('forms', pg_catalog.to_jsonb(v_q.forms),
                                                                            'tolerance', v_q.tolerance, 'unit', v_q.unit)
                else '{}'::jsonb end
        || case when v_q.explanation is not null then pg_catalog.jsonb_build_object('explanation', v_q.explanation) else '{}'::jsonb end;
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'now', meldy_private.live_iso(pg_catalog.clock_timestamp()),
    'challenge', meldy_private.live_challenge_json(p_c),
    'run', pg_catalog.jsonb_build_object(
      'name', p_r.name, 'look', p_r.look, 'qi', p_r.qi, 'dmg', p_r.dmg, 'right', p_r.right_n, 'streak', p_r.streak,
      'best', p_r.best, 'frozen', p_r.frozen, 'time_ms', p_r.time_ms,
      'boss', pg_catalog.jsonb_build_object('hp', p_r.hp, 'hp_max', p_r.hp_max, 'phase', p_r.phase, 'defeated', p_r.hp = 0),
      'finished', p_r.finished_at is not null,
      'place', meldy_private.live_run_place(p_r)),
    'question', v_question,
    'answer', v_answer,
    'result', v_result);
end;
$fn$;

-- 4c. The table by the link: the 50 best finished runs (points, right answers, time; equal on all three share a place),
--     how many finished and how many play now; with the own token, the own row («me») wherever it is.
create or replace function meldy_private.live_challenge_board_json(p_c public.live_challenges, p_me uuid)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'now', meldy_private.live_iso(pg_catalog.clock_timestamp()),
    'challenge', meldy_private.live_challenge_json(p_c),
    'top', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                     'place', t.place, 'name', t.name, 'look', t.look, 'dmg', t.dmg, 'right', t.right_n, 'time_ms', t.time_ms)
                     || case when t.id = p_me then '{"me": true}'::jsonb else '{}'::jsonb end
                     order by t.ord), '[]'::jsonb)
              from (select r.id, r.name, r.look, r.dmg, r.right_n, r.time_ms,
                           pg_catalog.rank() over (order by r.dmg desc, r.right_n desc, r.time_ms) as place,
                           pg_catalog.row_number() over (order by r.dmg desc, r.right_n desc, r.time_ms, r.finished_at, r.id) as ord
                      from public.live_runs r
                     where r.challenge_id = p_c.id and r.finished_at is not null and r.removed_at is null
                     order by r.dmg desc, r.right_n desc, r.time_ms, r.finished_at, r.id
                     limit 50) t),
    'me', (select pg_catalog.jsonb_build_object('place', meldy_private.live_run_place(r), 'name', r.name, 'look', r.look,
                                                'dmg', r.dmg, 'right', r.right_n, 'time_ms', r.time_ms,
                                                'finished', r.finished_at is not null)
             from public.live_runs r where r.id = p_me and r.removed_at is null))
$fn$;

-- ─────────────────────────────────────────── 5. The author ───────────────────────────────────────────

-- 5a. A challenge from a test or an exam of the caller's (as live_create's source: {quiz_id} — its draw, at most 30 — or
--     {container_id, subject_ids, count 3–30} drawn now). p_settings: time_s 10 | 20 | 30 (20), speed (true), calm
--     (false; calm keeps no points for speed), deadline (an ISO time 5 minutes to 30 days ahead; 22023 deadline). The
--     questions are copied now. 20 creates an hour (ML005 create), 20 open challenges (ML009), no playable question
--     (ML008, details = how many were skipped). Old challenges go 90 days after their end.
create or replace function public.challenge_create(p_source jsonb, p_settings jsonb)
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
  v_calm boolean;
  v_deadline timestamptz;
  v_quiz public.quizzes;
  v_container uuid;
  v_title text;
  v_subjects uuid[];
  v_count integer;
  v_candidates uuid[];
  v_items uuid[];
  v_skipped integer;
  v_c public.live_challenges;
  v_item public.test_items;
  v_kind text;
  v_shown smallint[];
  v_keys smallint[];
  v_ord integer;
begin
  if v_user is null then
    perform meldy_private.live_fail('28000', null, 401);
  end if;
  if pg_catalog.jsonb_typeof(v_settings) <> 'object' then
    perform meldy_private.live_fail('22023', 'settings');
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
  if v_settings ? 'calm' and pg_catalog.jsonb_typeof(v_settings -> 'calm') <> 'boolean' then
    perform meldy_private.live_fail('22023', 'calm');
  end if;
  v_calm := coalesce((v_settings ->> 'calm')::boolean, false);
  if v_calm then
    v_speed := false;
  end if;
  if pg_catalog.jsonb_typeof(v_settings -> 'deadline') is distinct from 'string'
     or pg_catalog.char_length(v_settings ->> 'deadline') > 40
     or (v_settings ->> 'deadline') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' then
    perform meldy_private.live_fail('22023', 'deadline');
  end if;
  begin
    v_deadline := (v_settings ->> 'deadline')::timestamptz;
  exception
    when others then
      perform meldy_private.live_fail('22023', 'deadline');
  end;
  if v_deadline < pg_catalog.now() + interval '5 minutes' or v_deadline > pg_catalog.now() + interval '30 days' then
    perform meldy_private.live_fail('22023', 'deadline');
  end if;
  -- The source (as live_create's).
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
  -- One author's creates in turn; old challenges go; the limits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('live.challenge:' || v_user::text, 0));
  delete from public.live_challenges c
   where c.id in (select x.id from public.live_challenges x
                   where least(coalesce(x.closed_at, x.deadline), x.deadline) < pg_catalog.now() - interval '90 days'
                   order by x.deadline limit 50);
  if (select pg_catalog.count(*) from public.live_challenges c
       where c.owner_id = v_user and c.created_at > pg_catalog.now() - interval '1 hour') >= 20 then
    perform meldy_private.live_fail('ML005', 'create', 429, meldy_private.live_retry_after(
      (select pg_catalog.min(c.created_at) from public.live_challenges c
        where c.owner_id = v_user and c.created_at > pg_catalog.now() - interval '1 hour'), interval '1 hour'));
  end if;
  if (select pg_catalog.count(*) from public.live_challenges c
       where c.owner_id = v_user and c.closed_at is null and c.deadline > pg_catalog.now()) >= 20 then
    perform meldy_private.live_fail('ML009', null);
  end if;
  -- The questions: the battle's kinds without pictures.
  if v_quiz.id is not null then
    v_candidates := meldy_private.quiz_draw(v_quiz);
    select coalesce(pg_catalog.array_agg(x.id order by x.ord), '{}'::uuid[]) into v_items
      from pg_catalog.unnest(v_candidates) with ordinality as x(id, ord)
      join public.test_items i on i.id = x.id
     where meldy_private.live_challenge_kind(i) is not null;
    v_skipped := pg_catalog.cardinality(v_candidates) - pg_catalog.cardinality(v_items);
    v_items := v_items[1:30];
  else
    v_candidates := meldy_private.quiz_pool(v_container, v_subjects);
    select coalesce(pg_catalog.array_agg(x.id order by x.ord), '{}'::uuid[]) into v_items
      from (select y.id, y.ord
              from pg_catalog.unnest(v_candidates) with ordinality as y(id, ord)
              join public.test_items i on i.id = y.id
             where meldy_private.live_challenge_kind(i) is not null
             order by pg_catalog.random()
             limit v_count) x;
    v_skipped := pg_catalog.cardinality(v_candidates)
                 - (select pg_catalog.count(*)::integer from pg_catalog.unnest(v_candidates) y(id)
                      join public.test_items i on i.id = y.id
                     where meldy_private.live_challenge_kind(i) is not null);
  end if;
  if pg_catalog.cardinality(v_items) = 0 then
    perform meldy_private.live_fail('ML008', v_skipped::text);
  end if;
  for v_attempt in 1 .. 20 loop
    begin
      insert into public.live_challenges (owner_id, container_id, quiz_id, title, code, time_s, speed, calm, q_count,
                                          skipped, deadline)
      values (v_user, v_container, v_quiz.id, pg_catalog.left(pg_catalog.btrim(v_title), 200), meldy_private.random_code(),
              v_time, v_speed, v_calm, pg_catalog.cardinality(v_items), v_skipped, v_deadline)
      returning * into v_c;
      exit;
    exception
      when unique_violation then
        if v_attempt = 20 then
          raise;
        end if;
    end;
  end loop;
  v_ord := 0;
  for v_item in
    select i.* from pg_catalog.unnest(v_items) with ordinality as x(id, ord) join public.test_items i on i.id = x.id order by x.ord
  loop
    v_kind := meldy_private.live_challenge_kind(v_item);
    if v_kind in ('short', 'number') then
      insert into public.live_challenge_questions (challenge_id, qi, item_id, kind, text, options, shown, key, forms, tolerance,
                                                   unit, explanation)
      values (v_c.id, v_ord, v_item.id, v_kind, v_item.stem, '[]'::jsonb, '{}'::smallint[], -1, v_item.answers,
              case when v_kind = 'number' then v_item.tolerance end,
              case when v_kind = 'number' then nullif(pg_catalog.btrim(v_item.unit), '') end,
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
      insert into public.live_challenge_questions (challenge_id, qi, item_id, kind, text, options, shown, key, keys, explanation)
      values (v_c.id, v_ord, v_item.id, v_kind, v_item.stem,
              (select pg_catalog.jsonb_agg(v_item.options -> s.f::integer order by s.n)
                 from pg_catalog.unnest(v_shown) with ordinality as s(f, n)),
              v_shown, coalesce(v_keys[1], (pg_catalog.array_position(v_shown, v_item.correct[1]) - 1)::smallint), v_keys,
              nullif(pg_catalog.btrim(v_item.explanation), ''));
    end if;
    v_ord := v_ord + 1;
  end loop;
  return pg_catalog.jsonb_build_object(
    'challenge_id', v_c.id, 'code', v_c.code, 'path', '/s/' || v_c.code,
    'url', 'https://ludosiel-studyforge.hf.space/s/' || v_c.code,
    'q_count', v_c.q_count, 'skipped', v_c.skipped, 'deadline', meldy_private.live_iso(v_c.deadline));
end;
$fn$;

-- 5b. The author's own challenge (P0002 challenge 404, someone else's 42501 author 403), swept when due; locked when p_lock.
create or replace function meldy_private.live_challenge_owned(p_challenge uuid, p_lock boolean)
returns public.live_challenges
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_c public.live_challenges;
begin
  if v_user is null then
    perform meldy_private.live_fail('28000', null, 401);
  end if;
  select c.* into v_c from public.live_challenges c where c.id = p_challenge;
  if v_c.id is null then
    perform meldy_private.live_fail('P0002', 'challenge', 404);
  end if;
  if v_c.owner_id <> v_user then
    perform meldy_private.live_fail('42501', 'author', 403);
  end if;
  if v_c.swept_at is null and meldy_private.live_challenge_over(v_c)
     and pg_catalog.now() >= meldy_private.live_challenge_end_at(v_c) + interval '35 seconds' then
    perform meldy_private.live_challenge_sweep(v_c.id);
  end if;
  if p_lock then
    select c.* into v_c from public.live_challenges c where c.id = p_challenge for update;
  else
    select c.* into v_c from public.live_challenges c where c.id = p_challenge;
  end if;
  return v_c;
end;
$fn$;

-- 5c. «Закрыть досрочно»: no new runs and no next question from now; a question already open may still be answered in its
--     time. Twice is fine.
create or replace function public.challenge_close(p_challenge uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_c public.live_challenges := meldy_private.live_challenge_owned(p_challenge, true);
begin
  if v_c.closed_at is null and pg_catalog.now() < v_c.deadline then
    update public.live_challenges c set closed_at = pg_catalog.now() where c.id = p_challenge returning * into v_c;
  end if;
  return meldy_private.live_challenge_json(v_c) || pg_catalog.jsonb_build_object('closed', true,
           'closed_at', meldy_private.live_iso(least(coalesce(v_c.closed_at, v_c.deadline), v_c.deadline)));
end;
$fn$;

-- 5d. The author takes a run off the table (a rude name the filter missed, a joke): its token stops working.
create or replace function public.challenge_remove(p_challenge uuid, p_run uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_c public.live_challenges := meldy_private.live_challenge_owned(p_challenge, true);
begin
  update public.live_runs r set removed_at = coalesce(r.removed_at, pg_catalog.now())
   where r.id = p_run and r.challenge_id = v_c.id;
  if not found then
    perform meldy_private.live_fail('P0002', 'run', 404);
  end if;
  return pg_catalog.jsonb_build_object('ok', true);
end;
$fn$;

-- 5e. The author's results: the settings and the link, every run (the finished ones by the table's order, then those
--     under way by their start; those taken off last), and each question's numbers (answered, right, partly right).
create or replace function public.challenge_results(p_challenge uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_c public.live_challenges := meldy_private.live_challenge_owned(p_challenge, false);
begin
  return meldy_private.live_challenge_json(v_c) || pg_catalog.jsonb_build_object(
    'challenge_id', v_c.id, 'container_id', v_c.container_id, 'quiz_id', v_c.quiz_id, 'skipped', v_c.skipped,
    'path', '/s/' || v_c.code, 'url', 'https://ludosiel-studyforge.hf.space/s/' || v_c.code,
    'created_at', meldy_private.live_iso(v_c.created_at),
    'closed_at', meldy_private.live_iso(v_c.closed_at),
    'now', meldy_private.live_iso(pg_catalog.clock_timestamp()),
    'runs', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'run_id', r.id, 'place', meldy_private.live_run_place(r), 'name', r.name, 'look', r.look, 'dmg', r.dmg,
                      'right', r.right_n, 'time_ms', r.time_ms,
                      'answered', (select pg_catalog.count(*) from public.live_run_answers a where a.run_id = r.id and a.settled_at is not null),
                      'joined_at', meldy_private.live_iso(r.joined_at), 'finished_at', meldy_private.live_iso(r.finished_at),
                      'removed', r.removed_at is not null)
                      order by (r.removed_at is not null), (r.finished_at is null), r.dmg desc, r.right_n desc, r.time_ms,
                               r.finished_at, r.joined_at, r.id), '[]'::jsonb)
               from public.live_runs r where r.challenge_id = v_c.id),
    'questions', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                           'qi', q.qi, 'text', q.text, 'kind', q.kind,
                           'answered', (select pg_catalog.count(*) from public.live_run_answers a join public.live_runs r on r.id = a.run_id
                                         where a.challenge_id = v_c.id and a.qi = q.qi and a.settled_at is not null and r.removed_at is null),
                           'right', (select pg_catalog.count(*) from public.live_run_answers a join public.live_runs r on r.id = a.run_id
                                      where a.challenge_id = v_c.id and a.qi = q.qi and a.correct and r.removed_at is null),
                           'partial', (select pg_catalog.count(*) from public.live_run_answers a join public.live_runs r on r.id = a.run_id
                                        where a.challenge_id = v_c.id and a.qi = q.qi and not a.correct and a.share > 0 and r.removed_at is null))
                           order by q.qi), '[]'::jsonb)
                    from public.live_challenge_questions q where q.challenge_id = v_c.id));
end;
$fn$;

-- 5f. The author's challenges (of one test or exam when p_container is given), the newest first, at most 50: the link,
--     the state, how many finished and play now, the leader.
create or replace function public.challenges_mine(p_container uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    perform meldy_private.live_fail('28000', null, 401);
  end if;
  for v_id in
    select c.id from public.live_challenges c
     where c.owner_id = v_user and (p_container is null or c.container_id = p_container)
       and c.swept_at is null and meldy_private.live_challenge_over(c)
       and pg_catalog.now() >= meldy_private.live_challenge_end_at(c) + interval '35 seconds'
     order by c.created_at desc
     limit 50
  loop
    perform meldy_private.live_challenge_sweep(v_id);
  end loop;
  return pg_catalog.jsonb_build_object('items', (
    select coalesce(pg_catalog.jsonb_agg(meldy_private.live_challenge_json(c) || pg_catalog.jsonb_build_object(
             'challenge_id', c.id, 'container_id', c.container_id, 'path', '/s/' || c.code,
             'created_at', meldy_private.live_iso(c.created_at),
             'leader', (select pg_catalog.jsonb_build_object('name', r.name, 'look', r.look, 'dmg', r.dmg)
                          from public.live_runs r
                         where r.challenge_id = c.id and r.finished_at is not null and r.removed_at is null
                         order by r.dmg desc, r.right_n desc, r.time_ms, r.finished_at, r.id
                         limit 1))
             order by c.created_at desc), '[]'::jsonb)
      from (select x.* from public.live_challenges x
             where x.owner_id = v_user and (p_container is null or x.container_id = p_container)
             order by x.created_at desc
             limit 50) c));
end;
$fn$;

-- ─────────────────────────────────────────── 6. The player (anyone with the link: the code and the own token) ───────────────────────────────────────────

-- 6a. The challenge by its link, before the start: what it is, until when, how many finished.
create or replace function public.challenge_info(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_c public.live_challenges := meldy_private.live_challenge_of(p_code, false);
begin
  return meldy_private.live_challenge_json(v_c) || pg_catalog.jsonb_build_object('now', meldy_private.live_iso(pg_catalog.clock_timestamp()));
end;
$fn$;

-- 6b. The start (anon or signed in): the token is made on the device (43 base64url characters); the database keeps its
--     sha256 and never returns it. The same token (or the same signed-in account, whose new token then replaces the
--     old one) gets its run back. A new run: not after the end (ML002 deadline / closed), 120 a minute per address and
--     120 a minute per link (ML005 join, 429 with Retry-After), 300 runs (ML001), the name (ML006), the look (ML007; none
--     given: the saved one of an account, else the name's).
create or replace function public.challenge_join(p_code text, p_name text, p_token text, p_look jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_c public.live_challenges;
  v_r public.live_runs;
  v_hash text;
  v_ip text;
  v_name text;
  v_look jsonb;
  v_w public.live_wardrobe;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform meldy_private.live_fail('22023', 'token');
  end if;
  v_c := meldy_private.live_challenge_of(p_code, true);
  v_hash := meldy_private.live_hash(p_token);
  select r.* into v_r from public.live_runs r
   where r.challenge_id = v_c.id and (r.token_hash = v_hash or (v_user is not null and r.user_id = v_user))
   order by (r.token_hash = v_hash) desc
   limit 1
     for update;
  if v_r.id is not null then
    if v_r.removed_at is not null then
      perform meldy_private.live_fail('42501', 'removed', 403);
    end if;
    update public.live_runs r
       set token_hash = v_hash,
           user_id = coalesce(r.user_id, case when v_user is not null
                                               and not exists (select 1 from public.live_runs o
                                                                where o.challenge_id = v_c.id and o.user_id = v_user)
                                              then v_user end)
     where r.id = v_r.id;
    v_r := meldy_private.live_run_settle(v_r.id);
    return meldy_private.live_run_json(v_c, v_r);
  end if;
  if meldy_private.live_challenge_over(v_c) then
    perform meldy_private.live_fail('ML002', case when v_c.closed_at is not null and v_c.closed_at < v_c.deadline then 'closed' else 'deadline' end);
  end if;
  v_ip := meldy_private.quiz_ip_hash();
  if v_ip is not null then
    delete from meldy_private.live_challenge_hits h where h.at <= pg_catalog.now() - interval '2 minutes';
    if (select pg_catalog.count(*) from meldy_private.live_challenge_hits h
         where h.ip_hash = v_ip and h.at > pg_catalog.now() - interval '1 minute') >= 120 then
      perform meldy_private.live_fail('ML005', 'join', 429, meldy_private.live_retry_after(
        (select pg_catalog.min(h.at) from meldy_private.live_challenge_hits h
          where h.ip_hash = v_ip and h.at > pg_catalog.now() - interval '1 minute'), interval '1 minute'));
    end if;
  end if;
  if (select pg_catalog.count(*) from public.live_runs r
       where r.challenge_id = v_c.id and r.joined_at > pg_catalog.now() - interval '1 minute') >= 120 then
    perform meldy_private.live_fail('ML005', 'join', 429, meldy_private.live_retry_after(
      (select pg_catalog.min(r.joined_at) from public.live_runs r
        where r.challenge_id = v_c.id and r.joined_at > pg_catalog.now() - interval '1 minute'), interval '1 minute'));
  end if;
  if (select pg_catalog.count(*) from public.live_runs r where r.challenge_id = v_c.id and r.removed_at is null) >= 300 then
    perform meldy_private.live_fail('ML001', null);
  end if;
  v_name := meldy_private.live_name_check(p_name);
  v_w := meldy_private.live_wardrobe_of(v_user, null);
  if p_look is null or p_look = 'null'::jsonb then
    v_look := meldy_private.live_default_look(v_name);
    if v_w.look is not null then
      begin
        v_look := meldy_private.live_look_check(v_w.look, v_w.unlocked);
      exception
        when sqlstate 'PGRST' then
          v_look := meldy_private.live_default_look(v_name);
      end;
    end if;
  else
    v_look := meldy_private.live_look_check(p_look, coalesce(v_w.unlocked, '{}'::text[]));
  end if;
  insert into public.live_runs (challenge_id, token_hash, user_id, name, look, hp, hp_max)
  values (v_c.id, v_hash, v_user, v_name, v_look, 55 * v_c.q_count, 55 * v_c.q_count)
  returning * into v_r;
  if v_ip is not null then
    insert into meldy_private.live_challenge_hits (ip_hash) values (v_ip);
  end if;
  return meldy_private.live_run_json(v_c, v_r);
end;
$fn$;

-- 6c. The own run now (a reload, a phone back from the pocket, the end of a question's time on the phone's clock).
create or replace function public.challenge_state(p_code text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_c public.live_challenges := meldy_private.live_challenge_of(p_code, false);
  v_r public.live_runs := meldy_private.live_run_of(v_c, p_token);
begin
  return meldy_private.live_run_json(v_c, v_r);
end;
$fn$;

-- 6d. The next question (p_qi: the one the device asks for — the current one again is the same answer, so a double tap or
--     a lost response opens nothing twice): only once the current one is graded (ML004 not_done), never another
--     (ML004 bad_qi). After the end: a run under way ends (the state says finished); one never started gets ML002.
create or replace function public.challenge_next(p_code text, p_token text, p_qi integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_c public.live_challenges := meldy_private.live_challenge_of(p_code, false);
  v_r public.live_runs := meldy_private.live_run_of(v_c, p_token);
  v_a public.live_run_answers;
  v_now timestamptz := pg_catalog.now();
begin
  if v_r.finished_at is not null or (p_qi is not null and p_qi = v_r.qi and v_r.qi >= 0) then
    return meldy_private.live_run_json(v_c, v_r);
  end if;
  if p_qi is null or p_qi <> v_r.qi + 1 or p_qi >= v_c.q_count then
    perform meldy_private.live_fail('ML004', 'bad_qi');
  end if;
  if v_r.qi >= 0 then
    select a.* into v_a from public.live_run_answers a where a.run_id = v_r.id and a.qi = v_r.qi;
    if v_a.settled_at is null then
      perform meldy_private.live_fail('ML004', 'not_done');
    end if;
  end if;
  if meldy_private.live_challenge_over(v_c) then
    if v_r.qi < 0 then
      perform meldy_private.live_fail('ML002', case when v_c.closed_at is not null and v_c.closed_at < v_c.deadline then 'closed' else 'deadline' end);
    end if;
    update public.live_runs r set finished_at = coalesce(v_a.settled_at, v_now) where r.id = v_r.id returning * into v_r;
    return meldy_private.live_run_json(v_c, v_r);
  end if;
  insert into public.live_run_answers (run_id, qi, challenge_id, opened_at, opens_at, closes_at, phase)
  values (v_r.id, p_qi, v_c.id, v_now, v_now + interval '3 seconds', v_now + interval '3 seconds' + pg_catalog.make_interval(secs => v_c.time_s),
          v_r.phase);
  update public.live_runs r set qi = p_qi where r.id = v_r.id returning * into v_r;
  return meldy_private.live_run_json(v_c, v_r);
end;
$fn$;

-- 6e. An answer to the current question, timed and graded by the server at once: from opens_at to closes_at + 1.5 s
--     (ML004 early / late), once (ML004 twice), of the question's kind (live_submit's shapes: {"choice": n},
--     {"picks": [n, …]} or {"text": "…"}; ML004 kind, 22023 answer). The state comes back with the result.
create or replace function public.challenge_answer(p_code text, p_token text, p_qi integer, p_answer jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_c public.live_challenges := meldy_private.live_challenge_of(p_code, false);
  v_r public.live_runs := meldy_private.live_run_of(v_c, p_token);
  v_a public.live_run_answers;
  v_q public.live_challenge_questions;
  v_now timestamptz := pg_catalog.now();
  v_options integer;
  v_choice smallint;
  v_picks smallint[];
  v_typed text;
begin
  if v_r.qi < 0 or p_qi is null or p_qi <> v_r.qi then
    perform meldy_private.live_fail('ML004', 'bad_qi');
  end if;
  select a.* into v_a from public.live_run_answers a where a.run_id = v_r.id and a.qi = v_r.qi;
  if v_a.settled_at is not null then
    perform meldy_private.live_fail('ML004', case when v_a.at is null then 'late' else 'twice' end);
  end if;
  if v_now < v_a.opens_at then
    perform meldy_private.live_fail('ML004', 'early');
  end if;
  if v_now > v_a.closes_at + interval '1.5 seconds' then
    perform meldy_private.live_fail('ML004', 'late');
  end if;
  select q.* into v_q from public.live_challenge_questions q where q.challenge_id = v_c.id and q.qi = v_r.qi;
  v_options := pg_catalog.jsonb_array_length(v_q.options);
  if p_answer is null or pg_catalog.jsonb_typeof(p_answer) <> 'object'
     or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_answer) k) <> 1 then
    perform meldy_private.live_fail('22023', 'answer');
  end if;
  if p_answer ? 'text' then
    if v_q.kind not in ('short', 'number') then
      perform meldy_private.live_fail('ML004', 'kind');
    end if;
    if (case when pg_catalog.jsonb_typeof(p_answer -> 'text') <> 'string' then true
             else pg_catalog.char_length(pg_catalog.btrim(p_answer ->> 'text')) not between 1 and 200
                  or public.meldy_short_norm(p_answer ->> 'text') = '' end) then
      perform meldy_private.live_fail('22023', 'answer');
    end if;
    v_typed := pg_catalog.btrim(p_answer ->> 'text');
  elsif p_answer ? 'choice' or p_answer ? 'picks' then
    if v_q.kind in ('short', 'number') then
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
    if v_q.kind = 'single' then
      if pg_catalog.cardinality(v_picks) <> 1 then
        perform meldy_private.live_fail('22023', 'answer');
      end if;
      v_choice := v_picks[1];
      v_picks := null;
    end if;
  else
    perform meldy_private.live_fail('22023', 'answer');
  end if;
  perform meldy_private.live_run_score(v_r.id, v_r.qi, v_choice, v_picks, v_typed, v_now);
  v_r := meldy_private.live_run_settle(v_r.id);
  return meldy_private.live_run_json(v_c, v_r);
end;
$fn$;

-- 6f. The table by the link (anyone; the own token adds the own row). Nothing per question, no keys: cheap for 300.
create or replace function public.challenge_board(p_code text, p_token text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_c public.live_challenges := meldy_private.live_challenge_of(p_code, false);
  v_me uuid;
begin
  if p_token is not null and p_token ~ '^[A-Za-z0-9_-]{43}$' then
    select r.id into v_me from public.live_runs r
     where r.challenge_id = v_c.id and r.token_hash = meldy_private.live_hash(p_token) and r.removed_at is null;
  end if;
  return meldy_private.live_challenge_board_json(v_c, v_me);
end;
$fn$;

-- 6g. The own review of a finished run (ML004 not_done before): the own answers and the keys of the questions this run
--     was shown and graded — never another question's key. The items as live_review's (CONTRACT §8).
create or replace function public.challenge_review(p_code text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_c public.live_challenges := meldy_private.live_challenge_of(p_code, false);
  v_r public.live_runs := meldy_private.live_run_of(v_c, p_token);
begin
  if v_r.finished_at is null then
    perform meldy_private.live_fail('ML004', 'not_done');
  end if;
  return pg_catalog.jsonb_build_object('items', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'qi', q.qi, 'text', q.text, 'options', q.options, 'key', q.key, 'choice', a.choice, 'correct', a.correct)
             || case when q.kind = 'multiple'
                     then pg_catalog.jsonb_build_object('kind', 'multiple', 'keys', pg_catalog.to_jsonb(q.keys), 'picks', pg_catalog.to_jsonb(a.picks),
                                                        'share', coalesce(a.share, 0))
                     when q.kind = 'short'
                     then pg_catalog.jsonb_build_object('kind', 'short', 'forms', pg_catalog.to_jsonb(q.forms), 'typed', a.typed)
                     when q.kind = 'number'
                     then pg_catalog.jsonb_build_object('kind', 'number', 'forms', pg_catalog.to_jsonb(q.forms), 'tolerance', q.tolerance,
                                                        'unit', q.unit, 'typed', a.typed)
                     else '{}'::jsonb end
             || case when q.explanation is not null then pg_catalog.jsonb_build_object('explanation', q.explanation) else '{}'::jsonb end
             order by q.qi), '[]'::jsonb)
      from public.live_run_answers a
      join public.live_challenge_questions q on q.challenge_id = a.challenge_id and q.qi = a.qi
     where a.run_id = v_r.id and a.settled_at is not null));
end;
$fn$;

-- 6h. «Тренировать ошибки» of a finished run, as live_practice (CONTRACT §14): the session's account (28000), the token of
--     a run of the link; the exam's author or an active member, else — when the challenge was made from a quiz whose
--     author offers practice and no quiz of the exam is open — the player joins the exam as quiz_practice_join makes a
--     member; anyone else ML012 practice. Every graded question of the run from an item still in the exam that was wrong,
--     partly right or left without an answer is recorded once as this user's answer of today through the study core
--     (record_test_answers_for, source web, client_event_id lc:<run>:<qi>: a second press records nothing twice).
create or replace function public.challenge_practice(p_code text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_c public.live_challenges;
  v_r public.live_runs;
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
  v_c := meldy_private.live_challenge_of(p_code, false);
  v_r := meldy_private.live_run_of(v_c, p_token);
  if v_r.finished_at is null then
    perform meldy_private.live_fail('ML004', 'not_done');
  end if;
  if meldy_private.role_in(v_user, v_c.container_id) is null then
    if v_c.quiz_id is not null then
      select q.* into v_q from public.quizzes q where q.id = v_c.quiz_id;
    end if;
    if v_q.id is null or not v_q.offer_practice or v_q.container_id <> v_c.container_id then
      perform meldy_private.live_fail('ML012', 'practice', 403);
    end if;
    if not meldy_private.quiz_practice_ready(v_c.container_id) then
      perform meldy_private.live_fail('ML012', 'open', 403);
    end if;
    perform 1 from public.containers c where c.id = v_c.container_id for update;
    select m.* into v_m from public.container_members m
     where m.container_id = v_c.container_id and m.user_id = v_user
       for update;
    v_found := found;
    if v_found and v_m.removed_at is not null then
      perform meldy_private.live_fail('ML012', 'removed', 403);
    end if;
    if (select pg_catalog.count(*) from public.container_members m
         where m.container_id = v_c.container_id and m.left_at is null and m.removed_at is null) >= 200 then
      perform meldy_private.live_fail('ML012', 'full', 403);
    end if;
    if v_found then
      update public.container_members m set left_at = null
       where m.container_id = v_c.container_id and m.user_id = v_user;
    else
      insert into public.container_members (container_id, user_id) values (v_c.container_id, v_user);
    end if;
    v_joined := true;
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'client_event_id', 'lc:' || pg_catalog.replace(v_r.id::text, '-', '') || ':' || q.qi,
           'item_id', q.item_id, 'mode', 'learn')
           || case when q.kind in ('short', 'number') then pg_catalog.jsonb_build_object('text', a.typed)
                   else pg_catalog.jsonb_build_object('chosen',
                          (select pg_catalog.to_jsonb(pg_catalog.array_agg(q.shown[x + 1] order by q.shown[x + 1]))
                             from pg_catalog.unnest(coalesce(a.picks, case when a.choice is not null then array[a.choice] end)) x)) end
           order by q.qi)
    into v_answers
    from public.live_run_answers a
    join public.live_challenge_questions q on q.challenge_id = a.challenge_id and q.qi = a.qi
   where a.run_id = v_r.id and a.settled_at is not null and not a.correct and q.item_id is not null
     and exists (select 1 from public.test_items i where i.id = q.item_id and i.container_id = v_c.container_id and i.keyed);
  if v_answers is not null then
    v_out := meldy_private.record_test_answers_for(v_user, v_answers, 'web', 30);
    select pg_catalog.count(*)::integer into v_saved
      from pg_catalog.jsonb_array_elements(v_out -> 'results') r where r ->> 'status' in ('saved', 'duplicate');
  end if;
  return pg_catalog.jsonb_build_object('container_id', v_c.container_id, 'joined', v_joined, 'saved', v_saved,
                                       'mistakes', coalesce(pg_catalog.jsonb_array_length(v_answers), 0));
end;
$fn$;

-- ─────────────────────────────────────────── 7. Grants ───────────────────────────────────────────
-- Supabase gives new public functions to anon and authenticated and PostgreSQL to PUBLIC: taken back, then given as the
-- contract says. The tables: nothing for the API roles (row security on, no policy).
revoke all on table public.live_challenges, public.live_challenge_questions, public.live_runs, public.live_run_answers
  from public, anon, authenticated;
revoke all on table meldy_private.live_challenge_hits from public, anon, authenticated, service_role;

revoke all on function
  meldy_private.live_challenge_kind(public.test_items),
  meldy_private.live_challenge_share(public.live_challenge_questions, smallint, smallint[], text),
  meldy_private.live_challenge_over(public.live_challenges), meldy_private.live_challenge_end_at(public.live_challenges),
  meldy_private.live_run_score(uuid, integer, smallint, smallint[], text, timestamptz),
  meldy_private.live_run_settle(uuid), meldy_private.live_challenge_sweep(uuid),
  meldy_private.live_challenge_of(text, boolean), meldy_private.live_run_of(public.live_challenges, text),
  meldy_private.live_run_place(public.live_runs), meldy_private.live_challenge_json(public.live_challenges),
  meldy_private.live_run_json(public.live_challenges, public.live_runs),
  meldy_private.live_challenge_board_json(public.live_challenges, uuid),
  meldy_private.live_challenge_owned(uuid, boolean)
  from public, anon, authenticated, service_role;

revoke all on function
  public.challenge_create(jsonb, jsonb), public.challenge_close(uuid), public.challenge_remove(uuid, uuid),
  public.challenge_results(uuid), public.challenges_mine(uuid),
  public.challenge_info(text), public.challenge_join(text, text, text, jsonb), public.challenge_state(text, text),
  public.challenge_next(text, text, integer), public.challenge_answer(text, text, integer, jsonb),
  public.challenge_board(text, text), public.challenge_review(text, text), public.challenge_practice(text, text)
  from public, anon, authenticated;
grant execute on function
  public.challenge_create(jsonb, jsonb), public.challenge_close(uuid), public.challenge_remove(uuid, uuid),
  public.challenge_results(uuid), public.challenges_mine(uuid)
  to authenticated;
grant execute on function
  public.challenge_info(text), public.challenge_join(text, text, text, jsonb), public.challenge_state(text, text),
  public.challenge_next(text, text, integer), public.challenge_answer(text, text, integer, jsonb),
  public.challenge_board(text, text), public.challenge_review(text, text), public.challenge_practice(text, text)
  to anon, authenticated;
