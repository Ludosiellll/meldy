-- live_duel («Дуэль»: two people play the same questions at the same time, each from their own phone or computer, by an
-- invite link; one server clock for both; head to head, no boss)
-- Repo file: supabase/migrations/20261106090200_live_duel.sql. Base: 20261106090100_live_challenge.sql (live_challenge_share,
-- live_challenge_kind, live_run_perm, live_challenge_over, live_challenge_end_at) and every live migration before it
-- (live_damage, live_name_check, live_name_rude, live_look_check, live_fail, live_hash), 20261018130000_quiz_guards.sql
-- (quiz_ip_hash, quiz_practice_ready).
-- Why (release 50, phase 3): a duel is the battle's scoring for two seats at once — the same grading
-- (meldy_private.live_challenge_share), the same points (meldy_private.live_damage; «Без спешки»: 100 a right answer) and
-- the freeze and the thaw of the battle's phase 0 (a wrong answer freezes unless calm, a right one thaws; no answer by
-- the end of the time freezes nobody) — with one current question for both, a reveal of both answers, and a winner.
-- Contract: docs/live/DUEL.md (the timeline, the shapes, who sees what, the disconnect rules, the limits).
-- Why new tables (not live_games, not live_runs): a live game is a host-driven room for a class, a challenge run is one
-- person alone on their own clock. A duel has two seats on one clock, settled lazily by whichever seat calls.
-- Check after the apply: supabase/tests/live_duel.sql (catalog only; read-only). Local rehearsal (never live):
-- supabase/tests/local/live_game_run.sh, its duel stage (live_duel_behaviour.sql, live_duel_mirror.*).
-- Rollback: supabase/rollback/20261106090200_live_duel_down.sql (drops the five tables and the functions: the duels go;
-- nothing else changes).
-- Release order: this file first (it only adds), then the site (its pages call duel_*). The Space has nothing to change
-- (the /sb proxy passes every rest/v1 call).
-- Strictly additive: no existing table, function, grant or JSON shape changes. The public functions are duel_*, not
-- live_* (the older contracts count the public live_* functions); the private helpers are live_duel_* (search_path = '',
-- no EXECUTE for anyone, service_role included). Re-runnable: IF NOT EXISTS, OR REPLACE. The whole file is one request.

-- A lock held by a busy game must not queue the site's queries behind this apply: give up after 2 s and try again later
-- (one request, one transaction: nothing of it stays).
set local lock_timeout = '2s';

do $do$
begin
  if pg_catalog.to_regclass('public.live_challenges') is null
     or pg_catalog.to_regprocedure('meldy_private.live_challenge_share(public.live_challenge_questions, smallint, smallint[], text)') is null
     or pg_catalog.to_regprocedure('meldy_private.live_challenge_kind(public.test_items)') is null
     or pg_catalog.to_regprocedure('meldy_private.live_run_perm(uuid, integer, integer, boolean)') is null
     or pg_catalog.to_regprocedure('meldy_private.live_challenge_end_at(public.live_challenges)') is null
     or pg_catalog.to_regprocedure('meldy_private.live_name_rude(text)') is null
     or pg_catalog.to_regprocedure('meldy_private.quiz_practice_ready(uuid)') is null then
    raise exception 'the base is expected: 20261106090100_live_challenge.sql and every live migration before it';
  end if;
end;
$do$;

-- ─────────────────────────────────────────── 1. Tables ───────────────────────────────────────────

-- 1a. A duel. owner_id: the signed-in account that made it (null: a guest). source: where the questions came from —
--     'container' / 'quiz' (the author's own), 'challenge' (the questions a person was shown in a finished run;
--     source_id the challenge, source_ref the run whose token made it), 'game' (the closed questions of a game a person
--     played; source_id the game, source_ref that player). stage: lobby → play (a current question, qi) ⇄ wait (between
--     questions, a seat away since wait_from) → final (ended_at, end_reason: done | left | gone | expired; winner the seat
--     or null). rev grows with every change a seat would see (the polls' «unchanged»). A rematch is a new duel: round
--     + 1, parent_id the one before (its next_id this one), draws the draws of the match before it.
create table if not exists public.live_duels (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  owner_id uuid references auth.users(id) on delete cascade,
  container_id uuid not null references public.containers(id) on delete cascade,
  quiz_id uuid references public.quizzes(id) on delete set null,
  source text not null,
  source_id uuid,
  source_ref uuid,
  subject_ids uuid[],
  title text not null,
  time_s smallint not null default 20,
  speed boolean not null default true,
  calm boolean not null default false,
  q_count smallint not null,
  skipped integer not null default 0,
  stage text not null default 'lobby',
  qi smallint not null default -1,
  rev bigint not null default 1,
  started_at timestamptz,
  wait_from timestamptz,
  ended_at timestamptz,
  end_reason text,
  winner smallint,
  round smallint not null default 1,
  parent_id uuid references public.live_duels(id) on delete set null,
  next_id uuid references public.live_duels(id) on delete set null,
  draws smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint live_duels_code_check check (code ~ '^[0-9a-hjkmnp-tv-z]{12}$'),
  constraint live_duels_title_check check (char_length(btrim(title)) between 1 and 200),
  constraint live_duels_source_check check (source in ('container', 'quiz', 'challenge', 'game')
                                            and (source in ('challenge', 'game')) = (source_id is not null)),
  constraint live_duels_time_check check (time_s in (10, 20, 30)),
  constraint live_duels_calm_check check (not calm or not speed),
  constraint live_duels_q_count_check check (q_count between 1 and 30),
  constraint live_duels_skipped_check check (skipped >= 0),
  constraint live_duels_stage_check check (stage in ('lobby', 'play', 'wait', 'final')),
  constraint live_duels_qi_check check (qi between -1 and q_count - 1 and (stage <> 'lobby' or qi = -1)
                                        and (stage not in ('play', 'wait') or qi >= 0)),
  constraint live_duels_end_check check ((stage = 'final') = (ended_at is not null) and (ended_at is null) = (end_reason is null)
                                         and (end_reason is null or end_reason in ('done', 'left', 'gone', 'expired'))
                                         and (winner is null or (winner in (1, 2) and end_reason in ('done', 'left')))),
  constraint live_duels_wait_check check ((stage = 'wait') = (wait_from is not null)),
  constraint live_duels_round_check check (round between 1 and 20 and draws between 0 and round - 1),
  constraint live_duels_rev_check check (rev >= 1)
);
create unique index if not exists live_duels_code_uidx on public.live_duels (code);
create index if not exists live_duels_owner_idx on public.live_duels (owner_id, created_at desc) where owner_id is not null;
create index if not exists live_duels_container_idx on public.live_duels (container_id);
create index if not exists live_duels_quiz_idx on public.live_duels (quiz_id) where quiz_id is not null;
create index if not exists live_duels_parent_idx on public.live_duels (parent_id) where parent_id is not null;
create index if not exists live_duels_next_idx on public.live_duels (next_id) where next_id is not null;
create index if not exists live_duels_created_idx on public.live_duels (created_at);
alter table public.live_duels enable row level security;
comment on table public.live_duels is 'Duels («Дуэль»): only through the public.duel_* functions.';

-- 1b. The two seats. id: the seat's own id — never sent anywhere; each seat's order of the options is drawn from it
--     (meldy_private.live_run_perm). token_hash: sha256 hex of the device's token (the token is never stored or sent
--     back). user_id: a signed-in player (one seat an account in a duel; the same account on another device takes the
--     same seat over). seen_at: the seat's last call (presence). ready_at: «Готов» in the lobby; next_qi / next_at:
--     «Дальше» pressed in the reveal of that question; rematch_at: «Ещё раз». The battle's numbers for one seat; wins:
--     the match's wins before this round.
create table if not exists public.live_duel_seats (
  id uuid primary key default gen_random_uuid(),
  duel_id uuid not null references public.live_duels(id) on delete cascade,
  seat smallint not null,
  token_hash text not null,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  look jsonb not null,
  joined_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  ready_at timestamptz,
  next_qi smallint,
  next_at timestamptz,
  rematch_at timestamptz,
  dmg integer not null default 0,
  right_n smallint not null default 0,
  streak smallint not null default 0,
  best smallint not null default 0,
  frozen boolean not null default false,
  thaws smallint not null default 0,
  time_ms integer not null default 0,
  wins smallint not null default 0,
  constraint live_duel_seats_seat_check check (seat in (1, 2)),
  constraint live_duel_seats_token_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint live_duel_seats_name_check check (char_length(name) between 1 and 24),
  constraint live_duel_seats_look_check check (jsonb_typeof(look) = 'object'),
  constraint live_duel_seats_next_check check ((next_qi is null) = (next_at is null)),
  constraint live_duel_seats_numbers_check check (dmg >= 0 and right_n >= 0 and streak >= 0 and best >= streak and thaws >= 0
                                                  and time_ms >= 0 and wins between 0 and 19)
);
create unique index if not exists live_duel_seats_seat_uidx on public.live_duel_seats (duel_id, seat);
create unique index if not exists live_duel_seats_token_uidx on public.live_duel_seats (duel_id, token_hash);
create unique index if not exists live_duel_seats_user_uidx on public.live_duel_seats (duel_id, user_id) where user_id is not null;
create index if not exists live_duel_seats_user_idx on public.live_duel_seats (user_id) where user_id is not null;
alter table public.live_duel_seats enable row level security;
comment on table public.live_duel_seats is 'The two seats of a duel (sha256 of their tokens only): only through the public.duel_* functions.';

-- 1c. The questions, frozen at create (an edit of the exam does not change a duel; a duel made from a challenge or a game
--     copies that one's frozen rows, never the item as it is now): live_challenge_questions' columns in its order, then
--     the times — shown_at (the text appears), opens_at = shown_at + 3 s (the answers open), closes_at = opens_at +
--     time_s, closed_at (both answered, or closes_at + 1.5 s).
create table if not exists public.live_duel_questions (
  duel_id uuid not null references public.live_duels(id) on delete cascade,
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
  keep_order boolean not null default false,
  item_rev integer,
  shown_at timestamptz,
  opens_at timestamptz,
  closes_at timestamptz,
  closed_at timestamptz,
  primary key (duel_id, qi),
  constraint live_duel_questions_qi_check check (qi between 0 and 29),
  constraint live_duel_questions_kind_check check (kind in ('single', 'multiple', 'short', 'number')),
  constraint live_duel_questions_options_check check (
    jsonb_typeof(options) = 'array' and cardinality(shown) = jsonb_array_length(options)
    and case when kind in ('short', 'number') then jsonb_array_length(options) = 0
             else jsonb_array_length(options) between 2 and 6 end),
  constraint live_duel_questions_key_check check (
    case when kind in ('short', 'number') then key = -1 else key >= 0 and key < cardinality(shown) end),
  constraint live_duel_questions_keys_check check ((kind = 'multiple') = (keys is not null) and (keys is null or cardinality(keys) >= 2)),
  constraint live_duel_questions_forms_check check (
    (kind in ('short', 'number')) = (forms is not null) and (forms is null or cardinality(forms) between 1 and 10)),
  constraint live_duel_questions_number_check check (
    (tolerance is null or (kind = 'number' and tolerance >= 0)) and (unit is null or (kind = 'number' and char_length(unit) between 1 and 20))),
  constraint live_duel_questions_times_check check (
    (shown_at is null) = (opens_at is null) and (opens_at is null) = (closes_at is null)
    and (opens_at is null or (opens_at >= shown_at and closes_at > opens_at))
    and (closed_at is null or shown_at is not null))
);
alter table public.live_duel_questions enable row level security;
comment on table public.live_duel_questions is 'Questions of a duel with their keys: never readable by clients; a key leaves only once its question closed.';

-- 1d. The answers: one a seat and question (the primary key). Written at the answer (at, the own option indexes kept in
--     the question's order, elapsed_ms by the server's clock); graded at the close (settled_at and the result). A seat
--     without an answer gets its row at the close (at null: none).
create table if not exists public.live_duel_answers (
  seat_id uuid not null references public.live_duel_seats(id) on delete cascade,
  qi smallint not null,
  duel_id uuid not null,
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
  primary key (seat_id, qi),
  foreign key (duel_id, qi) references public.live_duel_questions(duel_id, qi) on delete cascade,
  constraint live_duel_answers_one_check check (num_nonnulls(choice, picks, typed) <= 1 and (at is null) = (num_nonnulls(choice, picks, typed) = 0)),
  constraint live_duel_answers_choice_check check (choice is null or choice between 0 and 5),
  constraint live_duel_answers_picks_check check (picks is null or cardinality(picks) between 1 and 6),
  constraint live_duel_answers_typed_check check (typed is null or char_length(typed) between 1 and 200),
  constraint live_duel_answers_elapsed_check check ((elapsed_ms is null) = (at is null) and (elapsed_ms is null or elapsed_ms between 0 and 30000)),
  constraint live_duel_answers_settled_check check ((settled_at is null) = (correct is null) and (correct is null) = (dmg is null)),
  constraint live_duel_answers_dmg_check check (dmg is null or dmg between 0 and 200)
);
create index if not exists live_duel_answers_duel_idx on public.live_duel_answers (duel_id, qi);
alter table public.live_duel_answers enable row level security;
comment on table public.live_duel_answers is 'Answers of duels, one a seat and question: only through the public.duel_* functions.';

-- 1e. The address throttle (HMAC of the address, meldy_private.quiz_ip_hash): a guest's create, a join of the invited
--     seat. A day kept.
create table if not exists meldy_private.live_duel_hits (
  ip_hash text not null,
  kind text not null,
  at timestamptz not null default now(),
  constraint live_duel_hits_kind_check check (kind in ('create', 'join'))
);
create index if not exists live_duel_hits_idx on meldy_private.live_duel_hits (ip_hash, kind, at);
create index if not exists live_duel_hits_at_idx on meldy_private.live_duel_hits (at);
alter table meldy_private.live_duel_hits enable row level security;

-- ─────────────────────────────────────────── 2. Pure helpers ───────────────────────────────────────────

-- 2a. One seat's answer graded (the battle's phase 0, as meldy_private.live_run_score grades a question that opened in
--     phase 0): share 1 → points (live_damage by the time and the streak; «Без спешки»: 100), streak + 1; a frozen seat
--     thaws instead (no points, streak 1). A share between 0 and 1 → round(points × share) (0 while frozen), streak 0,
--     no freeze. Share 0 → streak 0, frozen (not in «Без спешки»). No answer (p_share null) → streak 0, nobody freezes.
--     The mirror is frontend/src/lib/duel/rules.ts (the rehearsal checks both, and both against live_run_score).
create or replace function meldy_private.live_duel_points(p_streak integer, p_frozen boolean, p_share double precision,
                                                          p_elapsed_ms integer, p_time_s integer, p_speed boolean,
                                                          p_calm boolean, out dmg integer, out correct boolean,
                                                          out thawed boolean, out frozen boolean, out streak integer)
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_elapsed integer := least(greatest(coalesce(p_elapsed_ms, p_time_s * 1000), 0), p_time_s * 1000);
  v_hit integer;
begin
  dmg := 0;
  correct := false;
  thawed := false;
  frozen := p_frozen;
  streak := 0;
  v_hit := case when p_calm then 100 else meldy_private.live_damage(v_elapsed, p_time_s, p_streak + 1, p_speed) end;
  if p_share is not null and p_share >= 1 then
    correct := true;
    if p_frozen then
      frozen := false;
      streak := 1;
      thawed := true;
    else
      dmg := v_hit;
      streak := p_streak + 1;
    end if;
  elsif p_share is not null and p_share > 0 then
    dmg := case when p_frozen then 0 else pg_catalog.floor(v_hit::double precision * p_share + 0.5)::integer end;
  elsif p_share is not null then
    frozen := p_frozen or not p_calm;
  end if;
end;
$fn$;

-- 2b. The winner (DUEL.md §3): more points, then more right answers; else nobody (a draw). Time decides nothing more.
create or replace function meldy_private.live_duel_winner(p_dmg1 integer, p_right1 integer, p_dmg2 integer, p_right2 integer)
returns smallint
language sql
immutable
set search_path = ''
as $fn$
  select case when p_dmg1 > p_dmg2 or (p_dmg1 = p_dmg2 and p_right1 > p_right2) then 1::smallint
              when p_dmg2 > p_dmg1 or (p_dmg1 = p_dmg2 and p_right2 > p_right1) then 2::smallint end
$fn$;

-- 2c. The share of an answer: the challenge's grading (meldy_private.live_challenge_share) of the same columns.
create or replace function meldy_private.live_duel_share(p_q public.live_duel_questions, p_choice smallint, p_picks smallint[],
                                                         p_typed text)
returns double precision
language sql
stable
set search_path = ''
as $fn$
  select meldy_private.live_challenge_share(
           row(p_q.duel_id, p_q.qi, p_q.item_id, p_q.kind, p_q.text, p_q.options, p_q.shown, p_q.key, p_q.keys, p_q.forms,
               p_q.tolerance, p_q.unit, p_q.explanation, p_q.keep_order, p_q.item_rev)::public.live_challenge_questions,
           p_choice, p_picks, p_typed)
$fn$;

-- 2d. A typed answer the other seat must not read as typed: the live game's filter of names (live_name_rude), word by
--     word over the answer as a name is normalised. The writer's own view keeps it as typed.
create or replace function meldy_private.live_duel_rude(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_text is not null and meldy_private.live_name_rude(meldy_private.live_name_norm(p_text))
$fn$;

-- 2e. Presence (DUEL.md §5): a seat is here at a moment when its last call was at most 20 s before it. The slowest poll
--     is 3 s (the /sb route) and its back-off on a 429 at most 9 s: 20 s is never reached by polling alone.
create or replace function meldy_private.live_duel_here(p_seen timestamptz, p_at timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(p_seen >= p_at - interval '20 seconds', false)
$fn$;

-- 2f. When a closed question's reveal ends by itself: 7 s, 14 s with an explanation to read.
create or replace function meldy_private.live_duel_reveal_end(p_q public.live_duel_questions)
returns timestamptz
language sql
immutable
set search_path = ''
as $fn$
  select p_q.closed_at + case when p_q.explanation is null then interval '7 seconds' else interval '14 seconds' end
$fn$;

-- 2g. The rev a seat is told (the polls' «unchanged»): twice the duel's rev, and one more once the current question's
--     text is out — the text appears by the clock (shown_at), not by a write, and a poll must not miss it.
create or replace function meldy_private.live_duel_rev(p_d public.live_duels)
returns bigint
language sql
stable
set search_path = ''
as $fn$
  select p_d.rev * 2 + case when exists (select 1 from public.live_duel_questions q
                                          where q.duel_id = p_d.id and q.qi = p_d.qi and q.shown_at > pg_catalog.now()) then 0 else 1 end
$fn$;

-- ─────────────────────────────────────────── 3. The engine (the caller holds the duel's lock) ───────────────────────────────────────────

create or replace function meldy_private.live_duel_bump(p_duel uuid)
returns void
language sql
volatile
set search_path = ''
as $fn$
  update public.live_duels d set rev = d.rev + 1 where d.id = p_duel
$fn$;

-- 3a. A question shown at p_at: the answers open 3 s later (3 · 2 · 1) and close time_s after that.
create or replace function meldy_private.live_duel_open(p_duel uuid, p_qi integer, p_at timestamptz)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_d public.live_duels;
begin
  select d.* into v_d from public.live_duels d where d.id = p_duel;
  update public.live_duel_questions q
     set shown_at = p_at, opens_at = p_at + interval '3 seconds',
         closes_at = p_at + interval '3 seconds' + pg_catalog.make_interval(secs => v_d.time_s)
   where q.duel_id = p_duel and q.qi = p_qi;
  update public.live_duels d set stage = 'play', qi = p_qi, wait_from = null where d.id = p_duel;
  perform meldy_private.live_duel_bump(p_duel);
end;
$fn$;

-- 3b. The current question closed at p_at: each seat graded in seat order (live_duel_points), a seat without an answer
--     as none (its row written now).
create or replace function meldy_private.live_duel_close(p_duel uuid, p_at timestamptz)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_d public.live_duels;
  v_q public.live_duel_questions;
  v_s public.live_duel_seats;
  v_a public.live_duel_answers;
  v_p record;
  v_share double precision;
begin
  select d.* into v_d from public.live_duels d where d.id = p_duel;
  select q.* into v_q from public.live_duel_questions q where q.duel_id = p_duel and q.qi = v_d.qi;
  if v_q.duel_id is null or v_q.closed_at is not null then
    return;
  end if;
  for v_s in select s.* from public.live_duel_seats s where s.duel_id = p_duel order by s.seat loop
    v_a := null;
    select a.* into v_a from public.live_duel_answers a where a.seat_id = v_s.id and a.qi = v_q.qi;
    if v_a.seat_id is null then
      insert into public.live_duel_answers (seat_id, qi, duel_id) values (v_s.id, v_q.qi, p_duel) returning * into v_a;
      v_share := null;
    else
      v_share := meldy_private.live_duel_share(v_q, v_a.choice, v_a.picks, v_a.typed);
    end if;
    select x.* into v_p
      from meldy_private.live_duel_points(v_s.streak, v_s.frozen, v_share, v_a.elapsed_ms, v_d.time_s, v_d.speed, v_d.calm) x;
    update public.live_duel_answers a
       set settled_at = p_at, correct = v_p.correct, share = coalesce(v_share, 0), dmg = v_p.dmg, thawed = v_p.thawed,
           frozen = v_p.frozen
     where a.seat_id = v_s.id and a.qi = v_q.qi;
    update public.live_duel_seats s
       set dmg = s.dmg + v_p.dmg, right_n = s.right_n + (case when v_p.correct then 1 else 0 end), streak = v_p.streak,
           best = greatest(s.best, v_p.streak), frozen = v_p.frozen, thaws = s.thaws + (case when v_p.thawed then 1 else 0 end),
           time_ms = s.time_ms + coalesce(v_a.elapsed_ms, v_d.time_s * 1000)
     where s.id = v_s.id;
  end loop;
  update public.live_duel_questions q set closed_at = p_at where q.duel_id = p_duel and q.qi = v_q.qi;
  perform meldy_private.live_duel_bump(p_duel);
end;
$fn$;

create or replace function meldy_private.live_duel_end(p_duel uuid, p_reason text, p_at timestamptz, p_winner smallint)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  update public.live_duels d
     set stage = 'final', ended_at = p_at, end_reason = p_reason, winner = p_winner, wait_from = null
   where d.id = p_duel;
  perform meldy_private.live_duel_bump(p_duel);
end;
$fn$;

-- 3c. The duel brought up to the server's time (DUEL.md §4): a bounded loop of what is due, at most one question shown a
--     call. Decisions at this moment count the calling seat as here; the end of a wait is judged by the seats' calls
--     before this one (seen_at), so a seat that comes back after both were gone wins nothing. Then the caller's seen_at.
--     - lobby: a day after the create it expires; the invited seat is freed after 2 minutes away (never the caller's);
--       both seated, both «Готов» and both here → the first question shows 2 s later.
--     - play, open: both answered (normally closed by the second answer) or closes_at + 1.5 s → closed.
--     - play, closed: the reveal ends at closed_at + 7 s (14 s with an explanation), or when both pressed «Дальше»; then
--       the last question ends the duel (done: points, then right answers), or the next question shows when both are
--       here, else the wait starts (from the moment it was due).
--     - wait: both here → the next question shows now; 60 s after it started → the one who stayed wins whatever the
--       score (left), nobody when both are gone (gone).
create or replace function meldy_private.live_duel_settle(p_duel uuid, p_caller uuid)
returns public.live_duels
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_d public.live_duels;
  v_q public.live_duel_questions;
  v_s1 public.live_duel_seats;
  v_s2 public.live_duel_seats;
  v_h1 boolean;
  v_h2 boolean;
  v_due timestamptz;
  v_end timestamptz;
  v_n integer;
  v_last timestamptz;
  v_shown boolean := false;
begin
  for v_i in 1 .. 8 loop
    select d.* into v_d from public.live_duels d where d.id = p_duel;
    exit when v_d.id is null or v_d.stage = 'final';
    v_s1 := null;
    v_s2 := null;
    select s.* into v_s1 from public.live_duel_seats s where s.duel_id = p_duel and s.seat = 1;
    select s.* into v_s2 from public.live_duel_seats s where s.duel_id = p_duel and s.seat = 2;
    v_h1 := v_s1.id is not null and ((p_caller is not null and v_s1.id = p_caller) or meldy_private.live_duel_here(v_s1.seen_at, v_now));
    v_h2 := v_s2.id is not null and ((p_caller is not null and v_s2.id = p_caller) or meldy_private.live_duel_here(v_s2.seen_at, v_now));
    if v_d.stage = 'lobby' then
      if v_now >= v_d.created_at + interval '1 day' then
        perform meldy_private.live_duel_end(p_duel, 'expired', v_d.created_at + interval '1 day', null);
        continue;
      end if;
      if v_s2.id is not null and (p_caller is null or v_s2.id <> p_caller) and v_s2.seen_at < v_now - interval '2 minutes' then
        delete from public.live_duel_seats s where s.id = v_s2.id;
        perform meldy_private.live_duel_bump(p_duel);
        continue;
      end if;
      if v_s2.id is not null and v_s1.ready_at is not null and v_s2.ready_at is not null and v_h1 and v_h2 and not v_shown then
        update public.live_duels d set started_at = v_now where d.id = p_duel;
        perform meldy_private.live_duel_open(p_duel, 0, v_now + interval '2 seconds');
        v_shown := true;
      end if;
      exit;
    end if;
    select q.* into v_q from public.live_duel_questions q where q.duel_id = p_duel and q.qi = v_d.qi;
    if v_d.stage = 'play' and v_q.closed_at is null then
      select pg_catalog.count(*)::integer, pg_catalog.max(a.at) into v_n, v_last
        from public.live_duel_answers a where a.duel_id = p_duel and a.qi = v_d.qi and a.at is not null;
      if v_n >= 2 then
        perform meldy_private.live_duel_close(p_duel, v_last);
        continue;
      elsif v_now > v_q.closes_at + interval '1.5 seconds' then
        perform meldy_private.live_duel_close(p_duel, v_q.closes_at + interval '1.5 seconds');
        continue;
      end if;
      exit;
    end if;
    if v_d.stage = 'play' then
      v_due := meldy_private.live_duel_reveal_end(v_q);
      if v_s1.next_qi = v_d.qi and v_s2.next_qi = v_d.qi then
        v_due := least(v_due, greatest(v_s1.next_at, v_s2.next_at, v_q.closed_at));
      end if;
      exit when v_now < v_due;
      if v_d.qi >= v_d.q_count - 1 then
        perform meldy_private.live_duel_end(p_duel, 'done', v_due,
                                            meldy_private.live_duel_winner(v_s1.dmg, v_s1.right_n, v_s2.dmg, v_s2.right_n));
        continue;
      end if;
      if v_h1 and v_h2 then
        exit when v_shown;
        perform meldy_private.live_duel_open(p_duel, v_d.qi + 1, v_now);
        v_shown := true;
        exit;
      end if;
      update public.live_duels d set stage = 'wait', wait_from = v_due where d.id = p_duel;
      perform meldy_private.live_duel_bump(p_duel);
      continue;
    end if;
    -- the wait between questions
    if v_h1 and v_h2 then
      exit when v_shown;
      perform meldy_private.live_duel_open(p_duel, v_d.qi + 1, v_now);
      v_shown := true;
      exit;
    end if;
    v_end := v_d.wait_from + interval '60 seconds';
    exit when v_now < v_end;
    v_h1 := meldy_private.live_duel_here(v_s1.seen_at, v_end);
    v_h2 := v_s2.id is not null and meldy_private.live_duel_here(v_s2.seen_at, v_end);
    if v_h1 and v_h2 then
      exit when v_shown;
      perform meldy_private.live_duel_open(p_duel, v_d.qi + 1, v_now);
      v_shown := true;
      exit;
    end if;
    perform meldy_private.live_duel_end(p_duel, case when v_h1 or v_h2 then 'left' else 'gone' end, v_end,
                                        case when v_h1 then 1::smallint when v_h2 then 2::smallint end);
  end loop;
  if p_caller is not null then
    update public.live_duel_seats s set seen_at = greatest(s.seen_at, v_now) where s.id = p_caller;
  end if;
  select d.* into v_d from public.live_duels d where d.id = p_duel;
  return v_d;
end;
$fn$;

-- 3d. The duel of a link code (P0002 code 404), unlocked.
create or replace function meldy_private.live_duel_of(p_code text)
returns public.live_duels
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_d public.live_duels;
begin
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    perform meldy_private.live_fail('P0002', 'code', 404);
  end if;
  select d.* into v_d from public.live_duels d where d.code = p_code;
  if v_d.id is null then
    perform meldy_private.live_fail('P0002', 'code', 404);
  end if;
  return v_d;
end;
$fn$;

-- 3e. A seat's call (the token's shape is checked by the caller first): the token's seat is found before the duel is
--     locked, so a wrong token never holds the lock (P0002 token 404); then the duel's lock, the seat again under it (a
--     takeover by account may have given it another token), the settle with this seat as the caller.
create or replace function meldy_private.live_duel_enter(p_code text, p_token text)
returns public.live_duel_seats
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_d public.live_duels := meldy_private.live_duel_of(p_code);
  v_hash text := meldy_private.live_hash(p_token);
  v_s public.live_duel_seats;
begin
  select s.* into v_s from public.live_duel_seats s where s.duel_id = v_d.id and s.token_hash = v_hash;
  if v_s.id is null then
    perform meldy_private.live_fail('P0002', 'token', 404);
  end if;
  perform 1 from public.live_duels d where d.id = v_d.id for update;
  select s.* into v_s from public.live_duel_seats s where s.id = v_s.id and s.token_hash = v_hash;
  if v_s.id is null then
    perform meldy_private.live_fail('P0002', 'token', 404);
  end if;
  perform meldy_private.live_duel_settle(v_d.id, v_s.id);
  select s.* into v_s from public.live_duel_seats s where s.id = v_s.id;
  return v_s;
end;
$fn$;

-- 3f. The create limits (DUEL.md §8). An account: 20 creates an hour (a rematch counts) and 20 unfinished duels (a
--     lobby, or one a seat called in the last 2 minutes; a rematch is not asked: it replaces the one just finished). A
--     guest: 120 creates an hour per address — a class behind one NAT creates with room to spare, and a signed-in person
--     is never refused because of other people on their address.
create or replace function meldy_private.live_duel_limits(p_user uuid, p_ip text, p_rematch boolean)
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if p_user is not null then
    if (select pg_catalog.count(*) from public.live_duels d
         where d.owner_id = p_user and d.created_at > pg_catalog.now() - interval '1 hour') >= 20 then
      perform meldy_private.live_fail('ML005', 'create', 429, meldy_private.live_retry_after(
        (select pg_catalog.min(d.created_at) from public.live_duels d
          where d.owner_id = p_user and d.created_at > pg_catalog.now() - interval '1 hour'), interval '1 hour'));
    end if;
    if not p_rematch
       and (select pg_catalog.count(*) from public.live_duels d
             where d.owner_id = p_user and d.stage <> 'final' and d.created_at > pg_catalog.now() - interval '1 day'
               and (d.stage = 'lobby' or exists (select 1 from public.live_duel_seats s
                                                  where s.duel_id = d.id and s.seen_at > pg_catalog.now() - interval '2 minutes'))) >= 20 then
      perform meldy_private.live_fail('ML009', null);
    end if;
  elsif p_ip is not null then
    if (select pg_catalog.count(*) from meldy_private.live_duel_hits h
         where h.ip_hash = p_ip and h.kind = 'create' and h.at > pg_catalog.now() - interval '1 hour') >= 120 then
      perform meldy_private.live_fail('ML005', 'create', 429, meldy_private.live_retry_after(
        (select pg_catalog.min(h.at) from meldy_private.live_duel_hits h
          where h.ip_hash = p_ip and h.kind = 'create' and h.at > pg_catalog.now() - interval '1 hour'), interval '1 hour'));
    end if;
  end if;
end;
$fn$;

-- 3g. Items of the exam copied as questions qi p_from.. in the given order (as challenge_create copies them: the options
--     shuffled once unless the item keeps its order, the key as a shown index, the item's rev now).
create or replace function meldy_private.live_duel_fill(p_duel uuid, p_items uuid[])
returns integer
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_item public.test_items;
  v_kind text;
  v_shown smallint[];
  v_keys smallint[];
  v_ord integer := 0;
begin
  for v_item in
    select i.* from pg_catalog.unnest(p_items) with ordinality as x(id, ord) join public.test_items i on i.id = x.id order by x.ord
  loop
    v_kind := meldy_private.live_challenge_kind(v_item);
    continue when v_kind is null;
    if v_kind in ('short', 'number') then
      insert into public.live_duel_questions (duel_id, qi, item_id, kind, text, options, shown, key, forms, tolerance, unit,
                                              explanation, item_rev)
      values (p_duel, v_ord, v_item.id, v_kind, v_item.stem, '[]'::jsonb, '{}'::smallint[], -1, v_item.answers,
              case when v_kind = 'number' then v_item.tolerance end,
              case when v_kind = 'number' then nullif(pg_catalog.btrim(v_item.unit), '') end,
              nullif(pg_catalog.btrim(v_item.explanation), ''), v_item.rev);
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
      insert into public.live_duel_questions (duel_id, qi, item_id, kind, text, options, shown, key, keys, explanation,
                                              keep_order, item_rev)
      values (p_duel, v_ord, v_item.id, v_kind, v_item.stem,
              (select pg_catalog.jsonb_agg(v_item.options -> s.f::integer order by s.n)
                 from pg_catalog.unnest(v_shown) with ordinality as s(f, n)),
              v_shown, coalesce(v_keys[1], (pg_catalog.array_position(v_shown, v_item.correct[1]) - 1)::smallint), v_keys,
              nullif(pg_catalog.btrim(v_item.explanation), ''), v_item.keep_order, v_item.rev);
    end if;
    v_ord := v_ord + 1;
    exit when v_ord >= 30;
  end loop;
  return v_ord;
end;
$fn$;

-- 3h. A new duel row with a fresh link code (meldy_private.random_code; tried again on the rare clash).
create or replace function meldy_private.live_duel_insert(p_d public.live_duels)
returns public.live_duels
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_d public.live_duels;
begin
  for v_attempt in 1 .. 20 loop
    begin
      insert into public.live_duels (code, owner_id, container_id, quiz_id, source, source_id, source_ref, subject_ids, title,
                                     time_s, speed, calm, q_count, skipped, round, parent_id, draws)
      values (meldy_private.random_code(), p_d.owner_id, p_d.container_id, p_d.quiz_id, p_d.source, p_d.source_id,
              p_d.source_ref, p_d.subject_ids, pg_catalog.left(pg_catalog.btrim(p_d.title), 200), p_d.time_s, p_d.speed,
              p_d.calm, p_d.q_count, p_d.skipped, p_d.round, p_d.parent_id, p_d.draws)
      returning * into v_d;
      return v_d;
    exception
      when unique_violation then
        if v_attempt = 20 then
          raise;
        end if;
    end;
  end loop;
  return v_d;
end;
$fn$;

-- 3i. «Ещё раз» pressed by both (the old duel locked): the next round as a new duel — the same seats with new ids (the
--     same tokens, names, looks; their wins so far), the same settings and source; the questions: an author's exam or
--     quiz draws again with the questions no round of this match played first, a fixed set (a challenge's or a game's
--     questions) is the same set reshuffled. The hourly limits count it (the account that made the match, else the
--     address of the press). At most 20 rounds.
create or replace function meldy_private.live_duel_rematch_make(p_old uuid)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_o public.live_duels;
  v_n public.live_duels;
  v_ip text := meldy_private.quiz_ip_hash();
  v_played uuid[];
  v_pool uuid[];
  v_items uuid[];
  v_quiz public.quizzes;
  v_count integer;
begin
  select d.* into v_o from public.live_duels d where d.id = p_old;
  if v_o.round >= 20 then
    perform meldy_private.live_fail('ML004', 'rounds');
  end if;
  perform meldy_private.live_duel_limits(v_o.owner_id, case when v_o.owner_id is null then v_ip end, true);
  v_n := v_o;
  v_n.round := v_o.round + 1;
  v_n.parent_id := v_o.id;
  v_n.draws := v_o.draws + case when v_o.end_reason = 'done' and v_o.winner is null then 1 else 0 end;
  if v_o.source in ('container', 'quiz') then
    with recursive chain(id, parent_id) as (
      select d.id, d.parent_id from public.live_duels d where d.id = v_o.id
      union all
      select d.id, d.parent_id from public.live_duels d join chain c on d.id = c.parent_id)
    select coalesce(pg_catalog.array_agg(distinct q.item_id), '{}'::uuid[]) into v_played
      from chain c join public.live_duel_questions q on q.duel_id = c.id where q.item_id is not null;
    if v_o.source = 'quiz' and v_o.quiz_id is not null then
      select q.* into v_quiz from public.quizzes q where q.id = v_o.quiz_id;
      v_pool := meldy_private.quiz_draw(v_quiz);
    elsif v_o.source = 'container' and v_o.subject_ids is not null then
      v_pool := meldy_private.quiz_pool(v_o.container_id, v_o.subject_ids);
    end if;
    select coalesce(pg_catalog.array_agg(x.id order by x.played, x.r), '{}'::uuid[]) into v_items
      from (select y.id, y.id = any (v_played) as played, pg_catalog.random() as r
              from pg_catalog.unnest(coalesce(v_pool, '{}'::uuid[])) y(id)
              join public.test_items i on i.id = y.id and i.container_id = v_o.container_id
             where meldy_private.live_challenge_kind(i) is not null
             order by 2, 3
             limit v_o.q_count) x;
    if pg_catalog.cardinality(v_items) = 0 then
      perform meldy_private.live_fail('ML008', '0');
    end if;
    v_n.q_count := pg_catalog.cardinality(v_items);
    v_n := meldy_private.live_duel_insert(v_n);
    v_count := meldy_private.live_duel_fill(v_n.id, v_items);
    if v_count <> v_n.q_count then
      update public.live_duels d set q_count = v_count where d.id = v_n.id;
    end if;
  else
    v_n := meldy_private.live_duel_insert(v_n);
    insert into public.live_duel_questions (duel_id, qi, item_id, kind, text, options, shown, key, keys, forms, tolerance,
                                            unit, explanation, keep_order, item_rev)
    select v_n.id, (pg_catalog.row_number() over (order by pg_catalog.random()) - 1)::smallint, q.item_id, q.kind, q.text,
           q.options, q.shown, q.key, q.keys, q.forms, q.tolerance, q.unit, q.explanation, q.keep_order, q.item_rev
      from public.live_duel_questions q where q.duel_id = v_o.id;
  end if;
  insert into public.live_duel_seats (duel_id, seat, token_hash, user_id, name, look, seen_at, wins)
  select v_n.id, s.seat, s.token_hash, s.user_id, s.name, s.look, s.seen_at,
         s.wins + case when v_o.winner = s.seat then 1 else 0 end
    from public.live_duel_seats s where s.duel_id = v_o.id;
  update public.live_duels d set next_id = v_n.id where d.id = v_o.id;
  if v_o.owner_id is null and v_ip is not null then
    insert into meldy_private.live_duel_hits (ip_hash, kind) values (v_ip, 'create');
  end if;
  return v_n.id;
end;
$fn$;

-- ─────────────────────────────────────────── 4. What the screens read ───────────────────────────────────────────

-- 4a. One seat's answer of a question in the viewer's order of the options (p_perm): the verdict, the points, the own
--     indexes, a typed text; the other seat's text masked when the live game's filter would not show it (p_own false).
create or replace function meldy_private.live_duel_side(p_a public.live_duel_answers, p_perm smallint[], p_own boolean)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select case when p_a.seat_id is null or p_a.settled_at is null then null else
    pg_catalog.jsonb_build_object('correct', p_a.correct, 'none', p_a.at is null, 'dmg', p_a.dmg, 'thawed', p_a.thawed,
                                  'frozen', p_a.frozen, 'elapsed_ms', p_a.elapsed_ms, 'share', p_a.share)
    || case when p_a.picks is not null
            then pg_catalog.jsonb_build_object('picks', (select pg_catalog.to_jsonb(pg_catalog.array_agg((pg_catalog.array_position(p_perm, x) - 1)::smallint
                                                                  order by pg_catalog.array_position(p_perm, x)))
                                                           from pg_catalog.unnest(p_a.picks) x))
            when p_a.choice is not null then pg_catalog.jsonb_build_object('choice', pg_catalog.array_position(p_perm, p_a.choice) - 1)
            when p_a.typed is not null and not p_own and meldy_private.live_duel_rude(p_a.typed) then '{"masked": true}'::jsonb
            when p_a.typed is not null then pg_catalog.jsonb_build_object('typed', p_a.typed)
            else '{}'::jsonb end end
$fn$;

-- 4b. The key of a closed question in the viewer's order: key, keys, the accepted forms, the explanation.
create or replace function meldy_private.live_duel_key(p_q public.live_duel_questions, p_perm smallint[])
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object('key', case when p_q.key < 0 then p_q.key else pg_catalog.array_position(p_perm, p_q.key) - 1 end)
         || case when p_q.kind = 'multiple'
                 then pg_catalog.jsonb_build_object('kind', 'multiple',
                        'keys', (select pg_catalog.to_jsonb(pg_catalog.array_agg((pg_catalog.array_position(p_perm, k) - 1)::smallint
                                                            order by pg_catalog.array_position(p_perm, k))) from pg_catalog.unnest(p_q.keys) k))
                 when p_q.kind = 'short' then pg_catalog.jsonb_build_object('kind', 'short', 'forms', pg_catalog.to_jsonb(p_q.forms))
                 when p_q.kind = 'number' then pg_catalog.jsonb_build_object('kind', 'number', 'forms', pg_catalog.to_jsonb(p_q.forms),
                                                                             'tolerance', p_q.tolerance, 'unit', p_q.unit)
                 else '{}'::jsonb end
         || case when p_q.explanation is not null then pg_catalog.jsonb_build_object('explanation', p_q.explanation) else '{}'::jsonb end
$fn$;

-- 4c. The duel as anyone with the link sees it: the title, the settings, the stage, who sits (names and looks), whether
--     a seat is free. No source, no owner, no key, no answer.
create or replace function meldy_private.live_duel_info_json(p_d public.live_duels)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'code', p_d.code, 'title', p_d.title, 'q_count', p_d.q_count, 'time_s', p_d.time_s, 'speed', p_d.speed,
    'stage', case when p_d.stage = 'lobby' and pg_catalog.now() >= p_d.created_at + interval '1 day' then 'final' else p_d.stage end,
    'round', p_d.round,
    'players', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('seat', s.seat, 'name', s.name, 'look', s.look)
                                                     order by s.seat), '[]'::jsonb)
                  from public.live_duel_seats s where s.duel_id = p_d.id),
    'full', p_d.stage <> 'lobby' or pg_catalog.now() >= p_d.created_at + interval '1 day'
            or exists (select 1 from public.live_duel_seats s
                        where s.duel_id = p_d.id and s.seat = 2 and s.seen_at >= pg_catalog.now() - interval '2 minutes'),
    'now', meldy_private.live_iso(pg_catalog.clock_timestamp()))
    || case when p_d.calm then '{"calm": true}'::jsonb else '{}'::jsonb end
$fn$;

-- 4d. The duel as one seat sees it (DUEL.md §6). Every option index is in this seat's own order (live_run_perm of the
--     seat's id, never sent). The current question's text only from shown_at; the own answer without a verdict; the
--     other seat only as «answered» until the question closes; then the key, both answers and the points (the other's
--     typed text masked by the live game's filter); the tracks of every closed question; the end, the rematch, the match.
create or replace function meldy_private.live_duel_json(p_d public.live_duels, p_me public.live_duel_seats)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_o public.live_duel_seats;
  v_q public.live_duel_questions;
  v_mine public.live_duel_answers;
  v_theirs public.live_duel_answers;
  v_perm smallint[];
  v_question jsonb;
  v_answer jsonb;
  v_result jsonb;
  v_next text;
  v_won smallint;
begin
  select s.* into v_o from public.live_duel_seats s where s.duel_id = p_d.id and s.seat <> p_me.seat;
  if p_d.qi >= 0 then
    select q.* into v_q from public.live_duel_questions q where q.duel_id = p_d.id and q.qi = p_d.qi;
    select a.* into v_mine from public.live_duel_answers a where a.seat_id = p_me.id and a.qi = p_d.qi;
    if v_o.id is not null then
      select a.* into v_theirs from public.live_duel_answers a where a.seat_id = v_o.id and a.qi = p_d.qi;
    end if;
    v_perm := meldy_private.live_run_perm(p_me.id, v_q.qi, pg_catalog.jsonb_array_length(v_q.options), v_q.keep_order);
    if v_q.shown_at is not null and pg_catalog.now() < v_q.shown_at then
      v_question := pg_catalog.jsonb_build_object('qi', v_q.qi, 'soon', true, 'shown_at', meldy_private.live_iso(v_q.shown_at),
                                                  'opens_at', meldy_private.live_iso(v_q.opens_at), 'closes_at', meldy_private.live_iso(v_q.closes_at));
    elsif v_q.shown_at is not null then
      v_question := pg_catalog.jsonb_build_object(
        'qi', v_q.qi, 'text', v_q.text,
        'options', (select coalesce(pg_catalog.jsonb_agg(v_q.options -> x.f::integer order by x.n), '[]'::jsonb)
                      from pg_catalog.unnest(v_perm) with ordinality as x(f, n)),
        'shown_at', meldy_private.live_iso(v_q.shown_at), 'opens_at', meldy_private.live_iso(v_q.opens_at),
        'closes_at', meldy_private.live_iso(v_q.closes_at))
        || case when v_q.kind = 'multiple' then pg_catalog.jsonb_build_object('kind', 'multiple', 'multi', pg_catalog.cardinality(v_q.keys))
                when v_q.kind = 'short' then pg_catalog.jsonb_build_object('kind', 'short')
                when v_q.kind = 'number' then pg_catalog.jsonb_build_object('kind', 'number', 'unit', v_q.unit)
                else '{}'::jsonb end
        || case when v_q.closed_at is not null
                then pg_catalog.jsonb_build_object('closed_at', meldy_private.live_iso(v_q.closed_at),
                                                   'reveal_until', meldy_private.live_iso(meldy_private.live_duel_reveal_end(v_q)))
                else '{}'::jsonb end;
    end if;
    if v_mine.at is not null then
      v_answer := case when v_mine.picks is not null
                       then pg_catalog.jsonb_build_object('picks', (select pg_catalog.to_jsonb(pg_catalog.array_agg((pg_catalog.array_position(v_perm, x) - 1)::smallint
                                                                            order by pg_catalog.array_position(v_perm, x)))
                                                                      from pg_catalog.unnest(v_mine.picks) x))
                       when v_mine.typed is not null then pg_catalog.jsonb_build_object('typed', v_mine.typed)
                       else pg_catalog.jsonb_build_object('choice', pg_catalog.array_position(v_perm, v_mine.choice) - 1) end
                  || pg_catalog.jsonb_build_object('elapsed_ms', v_mine.elapsed_ms);
    end if;
    if v_q.closed_at is not null then
      v_result := pg_catalog.jsonb_build_object('qi', v_q.qi)
                  || meldy_private.live_duel_key(v_q, v_perm)
                  || pg_catalog.jsonb_build_object('me', meldy_private.live_duel_side(v_mine, v_perm, true),
                                                   'other', meldy_private.live_duel_side(v_theirs, v_perm, false));
    end if;
  end if;
  if p_d.next_id is not null then
    select d.code into v_next from public.live_duels d where d.id = p_d.next_id;
  end if;
  v_won := case when p_d.stage = 'final' then p_d.winner end;
  return pg_catalog.jsonb_build_object(
    'now', meldy_private.live_iso(pg_catalog.clock_timestamp()),
    'rev', meldy_private.live_duel_rev(p_d),
    'duel', pg_catalog.jsonb_build_object(
      'code', p_d.code, 'title', p_d.title, 'q_count', p_d.q_count, 'time_s', p_d.time_s, 'speed', p_d.speed,
      'stage', p_d.stage, 'qi', p_d.qi, 'round', p_d.round, 'path', '/d/' || p_d.code,
      'url', 'https://ludosiel-studyforge.hf.space/d/' || p_d.code,
      'expires_at', case when p_d.stage = 'lobby' then meldy_private.live_iso(p_d.created_at + interval '1 day') end,
      'wait_until', case when p_d.stage = 'wait' then meldy_private.live_iso(p_d.wait_from + interval '60 seconds') end)
      || case when p_d.calm then '{"calm": true}'::jsonb else '{}'::jsonb end,
    'me', pg_catalog.jsonb_build_object(
      'seat', p_me.seat, 'name', p_me.name, 'look', p_me.look, 'dmg', p_me.dmg, 'right', p_me.right_n,
      'streak', p_me.streak, 'best', p_me.best, 'frozen', p_me.frozen, 'ready', p_me.ready_at is not null,
      'next', p_me.next_qi is not null and p_me.next_qi = p_d.qi, 'rematch', p_me.rematch_at is not null),
    'other', case when v_o.id is null then null else pg_catalog.jsonb_build_object(
      'seat', v_o.seat, 'name', v_o.name, 'look', v_o.look, 'dmg', v_o.dmg, 'right', v_o.right_n, 'streak', v_o.streak,
      'frozen', v_o.frozen, 'ready', v_o.ready_at is not null,
      'present', meldy_private.live_duel_here(v_o.seen_at, pg_catalog.now()),
      'answered', v_theirs.at is not null,
      'next', v_o.next_qi is not null and v_o.next_qi = p_d.qi, 'rematch', v_o.rematch_at is not null) end,
    'question', v_question,
    'answer', v_answer,
    'result', v_result,
    'track', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                       'qi', q.qi,
                       'me', case when m.correct then 'right' when m.at is null then 'none' when m.share > 0 then 'part' else 'wrong' end,
                       'other', case when t.seat_id is null then 'none' when t.correct then 'right' when t.at is null then 'none'
                                     when t.share > 0 then 'part' else 'wrong' end,
                       'me_dmg', m.dmg, 'other_dmg', coalesce(t.dmg, 0)) order by q.qi), '[]'::jsonb)
                from public.live_duel_questions q
                join public.live_duel_answers m on m.seat_id = p_me.id and m.qi = q.qi
                left join public.live_duel_answers t on t.seat_id = v_o.id and t.qi = q.qi
               where q.duel_id = p_d.id and q.closed_at is not null),
    'final', case when p_d.stage = 'final' then pg_catalog.jsonb_build_object(
      'reason', p_d.end_reason, 'ended_at', meldy_private.live_iso(p_d.ended_at),
      'winner', case when v_won = p_me.seat then 'me' when v_won is not null then 'other' end) end,
    'rematch', case when p_d.stage = 'final' and p_d.end_reason <> 'expired' then pg_catalog.jsonb_build_object(
      'me', p_me.rematch_at is not null, 'other', coalesce(v_o.rematch_at is not null, false), 'code', v_next,
      'round', p_d.round + 1, 'possible', p_d.round < 20) end,
    'match', pg_catalog.jsonb_build_object(
      'round', p_d.round,
      'me', p_me.wins + case when v_won = p_me.seat then 1 else 0 end,
      'other', coalesce(v_o.wins, 0) + case when v_won is not null and v_won <> p_me.seat then 1 else 0 end,
      'draws', p_d.draws + case when p_d.stage = 'final' and p_d.end_reason = 'done' and v_won is null then 1 else 0 end));
end;
$fn$;

-- ─────────────────────────────────────────── 5. The functions (PostgREST rpc/…; anon and authenticated) ───────────────────────────────────────────

-- 5a. A duel and its first seat (the caller's). p_token: made on the device (43 base64url characters); the database
--     keeps its sha256. p_source (DUEL.md §2): {container_id, subject_ids, count 3–30} or {quiz_id} — the signed-in
--     author's own (28000; 42501 author); {challenge: <code>, token: <the run's token>} — the questions that run was
--     shown, from the challenge's frozen copies, once the challenge is over (ML004 not_over) and until 7 days after its
--     end (ML002 expired), the run finished (ML004 not_done) and not taken off (42501 removed); {game: <id>, token: <the
--     player's token>} — the game's closed questions, from its frozen rows, at its podium or after its end (ML004
--     not_over), until 7 days later (ML002 expired), the player not kicked (42501 kicked). The server builds the list;
--     the client never sends item ids. p_settings: time_s 10 | 20 | 30, speed, calm (calm keeps no points for speed);
--     a challenge's or a game's own by default. The name (ML006), the look (ML007), no question to play (ML008), the
--     limits (ML005 create 429, ML009) — all checked before old duels are cleaned up and before anything is written.
create or replace function public.duel_create(p_source jsonb, p_settings jsonb, p_name text, p_token text, p_look jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_new public.live_duels;
  v_d public.live_duels;
  v_s public.live_duel_seats;
  v_time integer := 20;
  v_speed boolean := true;
  v_calm boolean := false;
  v_name text;
  v_look jsonb;
  v_w public.live_wardrobe;
  v_quiz public.quizzes;
  v_ch public.live_challenges;
  v_run public.live_runs;
  v_g public.live_games;
  v_p public.live_players;
  v_subjects uuid[];
  v_count integer;
  v_candidates uuid[];
  v_items uuid[];
  v_qis integer[];
  v_ip text;
  v_n integer;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform meldy_private.live_fail('22023', 'token');
  end if;
  if pg_catalog.jsonb_typeof(v_settings) <> 'object' then
    perform meldy_private.live_fail('22023', 'settings');
  end if;
  if v_settings ? 'time_s' and (pg_catalog.jsonb_typeof(v_settings -> 'time_s') <> 'number'
                                or (v_settings ->> 'time_s') not in ('10', '20', '30')) then
    perform meldy_private.live_fail('22023', 'time_s');
  end if;
  if v_settings ? 'speed' and pg_catalog.jsonb_typeof(v_settings -> 'speed') <> 'boolean' then
    perform meldy_private.live_fail('22023', 'speed');
  end if;
  if v_settings ? 'calm' and pg_catalog.jsonb_typeof(v_settings -> 'calm') <> 'boolean' then
    perform meldy_private.live_fail('22023', 'calm');
  end if;
  -- the source
  if p_source is null or pg_catalog.jsonb_typeof(p_source) <> 'object' then
    perform meldy_private.live_fail('22023', 'source');
  end if;
  if p_source ? 'quiz_id' or p_source ? 'container_id' then
    if v_user is null then
      perform meldy_private.live_fail('28000', null, 401);
    end if;
    if p_source ? 'quiz_id' then
      if pg_catalog.jsonb_typeof(p_source -> 'quiz_id') <> 'string'
         or (p_source ->> 'quiz_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        perform meldy_private.live_fail('22023', 'quiz_id');
      end if;
      select q.* into v_quiz from public.quizzes q where q.id = (p_source ->> 'quiz_id')::uuid;
      if v_quiz.id is null then
        perform meldy_private.live_fail('P0002', 'quiz', 404);
      end if;
      if v_quiz.owner_id <> v_user
         or not exists (select 1 from public.containers c where c.id = v_quiz.container_id and c.owner_id = v_user) then
        perform meldy_private.live_fail('42501', 'author', 403);
      end if;
      v_new.source := 'quiz';
      v_new.container_id := v_quiz.container_id;
      v_new.quiz_id := v_quiz.id;
      v_new.title := v_quiz.title;
    else
      if pg_catalog.jsonb_typeof(p_source -> 'container_id') <> 'string'
         or (p_source ->> 'container_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        perform meldy_private.live_fail('22023', 'container_id');
      end if;
      v_new.container_id := (p_source ->> 'container_id')::uuid;
      select c.title into v_new.title from public.containers c where c.id = v_new.container_id;
      if v_new.title is null then
        perform meldy_private.live_fail('P0002', 'container', 404);
      end if;
      if not exists (select 1 from public.containers c where c.id = v_new.container_id and c.owner_id = v_user) then
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
                  where not exists (select 1 from public.container_subjects cs where cs.id = x.id and cs.container_id = v_new.container_id)) then
        perform meldy_private.live_fail('22023', 'subject_ids');
      end if;
      if pg_catalog.jsonb_typeof(p_source -> 'count') is distinct from 'number'
         or (p_source ->> 'count') !~ '^[0-9]{1,2}$' or (p_source ->> 'count')::integer not between 3 and 30 then
        perform meldy_private.live_fail('22023', 'count');
      end if;
      v_count := (p_source ->> 'count')::integer;
      v_new.source := 'container';
      v_new.subject_ids := v_subjects;
    end if;
  elsif p_source ? 'challenge' then
    if pg_catalog.jsonb_typeof(p_source -> 'challenge') <> 'string' or (p_source ->> 'challenge') !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
      perform meldy_private.live_fail('22023', 'challenge');
    end if;
    if pg_catalog.jsonb_typeof(p_source -> 'token') <> 'string' or (p_source ->> 'token') !~ '^[A-Za-z0-9_-]{43}$' then
      perform meldy_private.live_fail('22023', 'token');
    end if;
    select c.* into v_ch from public.live_challenges c where c.code = p_source ->> 'challenge';
    if v_ch.id is null then
      perform meldy_private.live_fail('P0002', 'challenge', 404);
    end if;
    select r.* into v_run from public.live_runs r
     where r.challenge_id = v_ch.id and r.token_hash = meldy_private.live_hash(p_source ->> 'token');
    if v_run.id is null then
      perform meldy_private.live_fail('P0002', 'run', 404);
    end if;
    if v_run.removed_at is not null then
      perform meldy_private.live_fail('42501', 'removed', 403);
    end if;
    if not meldy_private.live_challenge_over(v_ch) then
      perform meldy_private.live_fail('ML004', 'not_over');
    end if;
    if v_run.finished_at is null then
      perform meldy_private.live_fail('ML004', 'not_done');
    end if;
    if meldy_private.live_challenge_end_at(v_ch) < pg_catalog.now() - interval '7 days' then
      perform meldy_private.live_fail('ML002', 'expired');
    end if;
    select pg_catalog.array_agg(a.qi::integer order by a.qi) into v_qis
      from public.live_run_answers a where a.run_id = v_run.id and a.settled_at is not null;
    v_new.source := 'challenge';
    v_new.source_id := v_ch.id;
    v_new.source_ref := v_run.id;
    v_new.container_id := v_ch.container_id;
    v_new.quiz_id := v_ch.quiz_id;
    v_new.title := v_ch.title;
    v_time := v_ch.time_s;
    v_speed := v_ch.speed;
    v_calm := v_ch.calm;
  elsif p_source ? 'game' then
    if pg_catalog.jsonb_typeof(p_source -> 'game') <> 'string'
       or (p_source ->> 'game') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform meldy_private.live_fail('22023', 'game');
    end if;
    if pg_catalog.jsonb_typeof(p_source -> 'token') <> 'string' or (p_source ->> 'token') !~ '^[A-Za-z0-9_-]{43}$' then
      perform meldy_private.live_fail('22023', 'token');
    end if;
    select g.* into v_g from public.live_games g where g.id = (p_source ->> 'game')::uuid;
    if v_g.id is null then
      perform meldy_private.live_fail('P0002', 'game', 404);
    end if;
    select p.* into v_p from public.live_players p
     where p.game_id = v_g.id and p.token_hash = meldy_private.live_hash(p_source ->> 'token');
    if v_p.id is null then
      perform meldy_private.live_fail('P0002', 'player', 404);
    end if;
    if v_p.kicked_at is not null then
      perform meldy_private.live_fail('42501', 'kicked', 403);
    end if;
    if v_g.state not in ('podium', 'ended') then
      perform meldy_private.live_fail('ML004', 'not_over');
    end if;
    if coalesce(v_g.ended_at, v_g.state_at) < pg_catalog.now() - interval '7 days' then
      perform meldy_private.live_fail('ML002', 'expired');
    end if;
    -- the closed questions a duel plays (as the challenge's: no picture, two to six options, text and number answers)
    select pg_catalog.array_agg(q.qi::integer order by q.qi) into v_qis
      from public.live_questions q
     where q.game_id = v_g.id and q.closed_at is not null and q.pictures is null
       and q.kind in ('single', 'multiple', 'short', 'number')
       and case when q.kind in ('short', 'number') then pg_catalog.cardinality(q.forms) between 1 and 10
                when q.kind = 'multiple' then pg_catalog.cardinality(q.keys) >= 2 and pg_catalog.jsonb_array_length(q.options) between 2 and 6
                else pg_catalog.jsonb_array_length(q.options) between 2 and 6 end;
    v_new.skipped := (select pg_catalog.count(*)::integer from public.live_questions q where q.game_id = v_g.id and q.closed_at is not null)
                     - coalesce(pg_catalog.cardinality(v_qis), 0);
    v_new.source := 'game';
    v_new.source_id := v_g.id;
    v_new.source_ref := v_p.id;
    v_new.container_id := v_g.container_id;
    v_new.quiz_id := v_g.quiz_id;
    v_new.title := v_g.title;
    v_time := v_g.time_s;
    v_speed := v_g.speed;
    v_calm := v_g.calm;
  else
    perform meldy_private.live_fail('22023', 'source');
  end if;
  v_time := coalesce((v_settings ->> 'time_s')::integer, v_time);
  v_speed := coalesce((v_settings ->> 'speed')::boolean, v_speed);
  v_calm := coalesce((v_settings ->> 'calm')::boolean, v_calm);
  if v_calm then
    v_speed := false;
  end if;
  if v_time not in (10, 20, 30) then
    v_time := 20;
  end if;
  -- the name and the look of the first seat
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
  -- what will be played (nothing written yet)
  if v_new.source = 'quiz' then
    v_candidates := meldy_private.quiz_draw(v_quiz);
    select coalesce(pg_catalog.array_agg(x.id order by x.ord), '{}'::uuid[]) into v_items
      from pg_catalog.unnest(v_candidates) with ordinality as x(id, ord)
      join public.test_items i on i.id = x.id
     where meldy_private.live_challenge_kind(i) is not null;
    v_new.skipped := pg_catalog.cardinality(v_candidates) - pg_catalog.cardinality(v_items);
    v_items := v_items[1:30];
    v_n := pg_catalog.cardinality(v_items);
  elsif v_new.source = 'container' then
    v_candidates := meldy_private.quiz_pool(v_new.container_id, v_subjects);
    select coalesce(pg_catalog.array_agg(x.id order by x.r), '{}'::uuid[]) into v_items
      from (select y.id, pg_catalog.random() as r
              from pg_catalog.unnest(v_candidates) y(id)
              join public.test_items i on i.id = y.id
             where meldy_private.live_challenge_kind(i) is not null
             order by 2
             limit v_count) x;
    v_new.skipped := pg_catalog.cardinality(v_candidates)
                     - (select pg_catalog.count(*)::integer from pg_catalog.unnest(v_candidates) y(id)
                          join public.test_items i on i.id = y.id
                         where meldy_private.live_challenge_kind(i) is not null);
    v_n := pg_catalog.cardinality(v_items);
  else
    v_qis := v_qis[1:30];
    v_n := coalesce(pg_catalog.cardinality(v_qis), 0);
  end if;
  if v_n = 0 then
    perform meldy_private.live_fail('ML008', coalesce(v_new.skipped, 0)::text);
  end if;
  -- the limits: one creator at a time (the account, else the address)
  v_ip := meldy_private.quiz_ip_hash();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('live.duel:' || coalesce(v_user::text, 'ip:' || v_ip, 'guest'), 0));
  perform meldy_private.live_duel_limits(v_user, case when v_user is null then v_ip end, false);
  -- only now old rows go: duels 90 days after their create, the throttle's rows after a day
  delete from public.live_duels d
   where d.id in (select x.id from public.live_duels x where x.created_at < pg_catalog.now() - interval '90 days'
                   order by x.created_at limit 50);
  delete from meldy_private.live_duel_hits h where h.at <= pg_catalog.now() - interval '1 day';
  -- the duel, its questions, its first seat
  v_new.owner_id := v_user;
  v_new.time_s := v_time;
  v_new.speed := v_speed;
  v_new.calm := v_calm;
  v_new.q_count := v_n;
  v_new.skipped := coalesce(v_new.skipped, 0);
  v_new.round := 1;
  v_new.draws := 0;
  v_d := meldy_private.live_duel_insert(v_new);
  if v_new.source in ('quiz', 'container') then
    v_n := meldy_private.live_duel_fill(v_d.id, v_items);
  elsif v_new.source = 'challenge' then
    -- the frozen copies the run was shown (never the item as it is now)
    insert into public.live_duel_questions (duel_id, qi, item_id, kind, text, options, shown, key, keys, forms, tolerance,
                                            unit, explanation, keep_order, item_rev)
    select v_d.id, (x.n - 1)::smallint, q.item_id, q.kind, q.text, q.options, q.shown, q.key, q.keys, q.forms, q.tolerance,
           q.unit, q.explanation, q.keep_order, q.item_rev
      from pg_catalog.unnest(v_qis) with ordinality as x(qi, n)
      join public.live_challenge_questions q on q.challenge_id = v_new.source_id and q.qi = x.qi;
  else
    -- the game's frozen rows; an item edited after the game was made is stale for practice (item_rev 0)
    insert into public.live_duel_questions (duel_id, qi, item_id, kind, text, options, shown, key, keys, forms, tolerance,
                                            unit, explanation, keep_order, item_rev)
    select v_d.id, (x.n - 1)::smallint, q.item_id, q.kind, q.text, q.options, q.shown,
           case when q.kind in ('short', 'number') then -1 else q.key end, q.keys, q.forms, q.tolerance, q.unit, q.explanation,
           coalesce(i.keep_order, false), case when i.id is null then null when i.updated_at <= v_g.created_at then i.rev else 0 end
      from pg_catalog.unnest(v_qis) with ordinality as x(qi, n)
      join public.live_questions q on q.game_id = v_new.source_id and q.qi = x.qi
      left join public.test_items i on i.id = q.item_id;
  end if;
  get diagnostics v_count = row_count;
  if v_new.source in ('quiz', 'container') then
    v_count := v_n;
  end if;
  if v_count <> v_d.q_count then
    update public.live_duels d set q_count = v_count where d.id = v_d.id returning * into v_d;
  end if;
  insert into public.live_duel_seats (duel_id, seat, token_hash, user_id, name, look)
  values (v_d.id, 1, meldy_private.live_hash(p_token), v_user, v_name, v_look)
  returning * into v_s;
  if v_user is null and v_ip is not null then
    insert into meldy_private.live_duel_hits (ip_hash, kind) values (v_ip, 'create');
  end if;
  select d.* into v_d from public.live_duels d where d.id = v_d.id;
  return meldy_private.live_duel_json(v_d, v_s);
end;
$fn$;

-- 5b. The duel by its link, before a seat: what it is, who sits, whether the invited seat is free. Nothing secret.
create or replace function public.duel_info(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return meldy_private.live_duel_info_json(meldy_private.live_duel_of(p_code));
end;
$fn$;

-- 5c. A seat (anon or signed in). The own seat back: by this device's token, or by the signed-in account (the same
--     account on another device takes the same seat over: its new token replaces the old hash, the old device's token
--     stops working). A new seat: only the invited one — refused before any lock or write when the duel is over
--     (ML002 over) or the seat is taken (ML001 full; a seat away 2 minutes in the lobby counts as free); the name (ML006),
--     the look (ML007); 120 joins a minute per address (the live game's join throttle) and 300 a day (ML005 join 429).
create or replace function public.duel_join(p_code text, p_name text, p_token text, p_look jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_d public.live_duels;
  v_s public.live_duel_seats;
  v_s2 public.live_duel_seats;
  v_hash text;
  v_ip text;
  v_name text;
  v_look jsonb;
  v_w public.live_wardrobe;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform meldy_private.live_fail('22023', 'token');
  end if;
  v_d := meldy_private.live_duel_of(p_code);
  v_hash := meldy_private.live_hash(p_token);
  select s.* into v_s from public.live_duel_seats s
   where s.duel_id = v_d.id and (s.token_hash = v_hash or (v_user is not null and s.user_id = v_user))
   order by (s.token_hash = v_hash) desc, s.seat
   limit 1;
  if v_s.id is not null then
    perform 1 from public.live_duels d where d.id = v_d.id for update;
    select s.* into v_s from public.live_duel_seats s
     where s.id = v_s.id and (s.token_hash = v_hash or (v_user is not null and s.user_id = v_user));
    if v_s.id is not null then
      update public.live_duel_seats s
         set token_hash = v_hash,
             user_id = coalesce(s.user_id, case when v_user is not null
                                                 and not exists (select 1 from public.live_duel_seats o
                                                                  where o.duel_id = v_d.id and o.user_id = v_user)
                                                then v_user end)
       where s.id = v_s.id;
      if v_s.token_hash <> v_hash then
        perform meldy_private.live_duel_bump(v_d.id);
      end if;
      v_d := meldy_private.live_duel_settle(v_d.id, v_s.id);
      select s.* into v_s from public.live_duel_seats s where s.id = v_s.id;
      return meldy_private.live_duel_json(v_d, v_s);
    end if;
  end if;
  -- a new seat: refused before any lock or write while the invited seat is taken
  select s.* into v_s2 from public.live_duel_seats s where s.duel_id = v_d.id and s.seat = 2;
  if v_d.stage = 'final' or (v_d.stage = 'lobby' and pg_catalog.now() >= v_d.created_at + interval '1 day') then
    perform meldy_private.live_fail('ML002', 'over');
  end if;
  if v_d.stage <> 'lobby' or (v_s2.id is not null and v_s2.seen_at >= pg_catalog.now() - interval '2 minutes') then
    perform meldy_private.live_fail('ML001', 'full');
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
  v_ip := meldy_private.quiz_ip_hash();
  if v_ip is not null then
    if (select pg_catalog.count(*) from meldy_private.live_duel_hits h
         where h.ip_hash = v_ip and h.kind = 'join' and h.at > pg_catalog.now() - interval '1 minute') >= 120 then
      perform meldy_private.live_fail('ML005', 'join', 429, meldy_private.live_retry_after(
        (select pg_catalog.min(h.at) from meldy_private.live_duel_hits h
          where h.ip_hash = v_ip and h.kind = 'join' and h.at > pg_catalog.now() - interval '1 minute'), interval '1 minute'));
    end if;
    if (select pg_catalog.count(*) from meldy_private.live_duel_hits h
         where h.ip_hash = v_ip and h.kind = 'join' and h.at > pg_catalog.now() - interval '1 day') >= 300 then
      perform meldy_private.live_fail('ML005', 'join', 429, meldy_private.live_retry_after(
        (select pg_catalog.min(h.at) from meldy_private.live_duel_hits h
          where h.ip_hash = v_ip and h.kind = 'join' and h.at > pg_catalog.now() - interval '1 day'), interval '1 day'));
    end if;
  end if;
  perform 1 from public.live_duels d where d.id = v_d.id for update;
  v_d := meldy_private.live_duel_settle(v_d.id, null);
  if v_d.stage = 'final' then
    perform meldy_private.live_fail('ML002', 'over');
  end if;
  if v_d.stage <> 'lobby' or exists (select 1 from public.live_duel_seats s where s.duel_id = v_d.id and s.seat = 2) then
    perform meldy_private.live_fail('ML001', 'full');
  end if;
  insert into public.live_duel_seats (duel_id, seat, token_hash, user_id, name, look)
  values (v_d.id, 2, v_hash, v_user, v_name, v_look)
  returning * into v_s;
  if v_ip is not null then
    insert into meldy_private.live_duel_hits (ip_hash, kind) values (v_ip, 'join');
  end if;
  perform meldy_private.live_duel_bump(v_d.id);
  select d.* into v_d from public.live_duels d where d.id = v_d.id;
  return meldy_private.live_duel_json(v_d, v_s);
end;
$fn$;

-- 5d. The own seat's view now (the poll). p_rev: the rev the device holds — the same: a tiny «unchanged» answer with the
--     stage and whether the other seat is here.
create or replace function public.duel_state(p_code text, p_token text, p_rev bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_s public.live_duel_seats;
  v_d public.live_duels;
  v_o public.live_duel_seats;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform meldy_private.live_fail('P0002', 'token', 404);
  end if;
  v_s := meldy_private.live_duel_enter(p_code, p_token);
  select d.* into v_d from public.live_duels d where d.id = v_s.duel_id;
  if p_rev is not null and p_rev = meldy_private.live_duel_rev(v_d) then
    select s.* into v_o from public.live_duel_seats s where s.duel_id = v_d.id and s.seat <> v_s.seat;
    return pg_catalog.jsonb_build_object('unchanged', true, 'rev', p_rev, 'now', meldy_private.live_iso(pg_catalog.clock_timestamp()),
                                         'stage', v_d.stage,
                                         'other', case when v_o.id is null then null
                                                       else pg_catalog.jsonb_build_object('present', meldy_private.live_duel_here(v_o.seen_at, pg_catalog.now())) end);
  end if;
  return meldy_private.live_duel_json(v_d, v_s);
end;
$fn$;

-- 5e. «Готов» in the lobby (twice is fine; after the start it changes nothing).
create or replace function public.duel_ready(p_code text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_s public.live_duel_seats;
  v_d public.live_duels;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform meldy_private.live_fail('P0002', 'token', 404);
  end if;
  v_s := meldy_private.live_duel_enter(p_code, p_token);
  select d.* into v_d from public.live_duels d where d.id = v_s.duel_id;
  if v_d.stage = 'lobby' and v_s.ready_at is null then
    update public.live_duel_seats s set ready_at = pg_catalog.now() where s.id = v_s.id;
    perform meldy_private.live_duel_bump(v_d.id);
    v_d := meldy_private.live_duel_settle(v_d.id, v_s.id);
    select s.* into v_s from public.live_duel_seats s where s.id = v_s.id;
  end if;
  return meldy_private.live_duel_json(v_d, v_s);
end;
$fn$;

-- 5f. An answer to the current question: from opens_at to closes_at + 1.5 s by the server's clock (ML004 early / late),
--     once (ML004 twice: the primary key and this check under the lock), of the question's kind (live_submit's shapes:
--     {"choice": n}, {"picks": [n, …]}, {"text": "…"}; ML004 kind, 22023 answer) — indexes in the seat's own order, kept
--     in the question's. Not graded now: the other seat sees only «answered». The second answer closes the question
--     (both are graded then, and the state that comes back is the reveal).
create or replace function public.duel_answer(p_code text, p_token text, p_qi integer, p_answer jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_s public.live_duel_seats;
  v_d public.live_duels;
  v_q public.live_duel_questions;
  v_now timestamptz := pg_catalog.now();
  v_options integer;
  v_choice smallint;
  v_picks smallint[];
  v_typed text;
  v_perm smallint[];
  v_n integer;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform meldy_private.live_fail('P0002', 'token', 404);
  end if;
  v_s := meldy_private.live_duel_enter(p_code, p_token);
  select d.* into v_d from public.live_duels d where d.id = v_s.duel_id;
  if p_qi is null or p_qi < 0 or p_qi >= v_d.q_count then
    perform meldy_private.live_fail('ML004', 'bad_qi');
  end if;
  if exists (select 1 from public.live_duel_answers a where a.seat_id = v_s.id and a.qi = p_qi and a.at is not null) then
    perform meldy_private.live_fail('ML004', 'twice');
  end if;
  if v_d.stage not in ('play', 'wait', 'final') or p_qi > v_d.qi then
    perform meldy_private.live_fail('ML004', 'bad_qi');
  end if;
  select q.* into v_q from public.live_duel_questions q where q.duel_id = v_d.id and q.qi = p_qi;
  if v_d.stage <> 'play' or p_qi < v_d.qi or v_q.closed_at is not null or v_now > v_q.closes_at + interval '1.5 seconds' then
    perform meldy_private.live_fail('ML004', 'late');
  end if;
  if v_now < v_q.opens_at then
    perform meldy_private.live_fail('ML004', 'early');
  end if;
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
    -- the seat sees the options in its own order: back to the question's (live_run_perm of the seat's id)
    v_perm := meldy_private.live_run_perm(v_s.id, v_q.qi, v_options, v_q.keep_order);
    select pg_catalog.array_agg(v_perm[x + 1] order by v_perm[x + 1]) into v_picks from pg_catalog.unnest(v_picks) x;
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
  begin
    insert into public.live_duel_answers (seat_id, qi, duel_id, at, choice, picks, typed, elapsed_ms)
    values (v_s.id, v_q.qi, v_d.id, v_now, v_choice, v_picks, v_typed,
            least(greatest(pg_catalog.floor(extract(epoch from (v_now - v_q.opens_at)) * 1000), 0), v_d.time_s * 1000)::integer);
  exception
    when unique_violation then
      perform meldy_private.live_fail('ML004', 'twice');
  end;
  perform meldy_private.live_duel_bump(v_d.id);
  select pg_catalog.count(*)::integer into v_n from public.live_duel_answers a where a.duel_id = v_d.id and a.qi = v_q.qi and a.at is not null;
  if v_n >= 2 then
    perform meldy_private.live_duel_close(v_d.id, v_now);
  end if;
  select d.* into v_d from public.live_duels d where d.id = v_d.id;
  select s.* into v_s from public.live_duel_seats s where s.id = v_s.id;
  return meldy_private.live_duel_json(v_d, v_s);
end;
$fn$;

-- 5g. «Дальше» in the reveal of question p_qi: when both pressed, the next question shows at once (or the duel ends).
--     An older question's press changes nothing; a question not yet closed is ML004 bad_qi.
create or replace function public.duel_next(p_code text, p_token text, p_qi integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_s public.live_duel_seats;
  v_d public.live_duels;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform meldy_private.live_fail('P0002', 'token', 404);
  end if;
  v_s := meldy_private.live_duel_enter(p_code, p_token);
  select d.* into v_d from public.live_duels d where d.id = v_s.duel_id;
  if v_d.stage = 'play' and p_qi = v_d.qi
     and exists (select 1 from public.live_duel_questions q where q.duel_id = v_d.id and q.qi = p_qi and q.closed_at is not null) then
    if v_s.next_qi is distinct from p_qi then
      update public.live_duel_seats s set next_qi = p_qi, next_at = pg_catalog.now() where s.id = v_s.id;
      perform meldy_private.live_duel_bump(v_d.id);
      v_d := meldy_private.live_duel_settle(v_d.id, v_s.id);
      select s.* into v_s from public.live_duel_seats s where s.id = v_s.id;
    end if;
  elsif p_qi is null or (v_d.stage = 'play' and p_qi >= v_d.qi) or (v_d.stage = 'lobby') then
    perform meldy_private.live_fail('ML004', 'bad_qi');
  end if;
  return meldy_private.live_duel_json(v_d, v_s);
end;
$fn$;

-- 5h. «Ещё раз» on the final: both must press it; the second press makes the next round (meldy_private.
--     live_duel_rematch_make: the limits count it) and both states carry its code. Not after a duel that never started
--     (ML004 not_done), not after the 20th round (ML004 rounds).
create or replace function public.duel_rematch(p_code text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_s public.live_duel_seats;
  v_d public.live_duels;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform meldy_private.live_fail('P0002', 'token', 404);
  end if;
  v_s := meldy_private.live_duel_enter(p_code, p_token);
  select d.* into v_d from public.live_duels d where d.id = v_s.duel_id;
  if v_d.stage <> 'final' or v_d.end_reason = 'expired' then
    perform meldy_private.live_fail('ML004', 'not_done');
  end if;
  if v_d.round >= 20 then
    perform meldy_private.live_fail('ML004', 'rounds');
  end if;
  if v_s.rematch_at is null then
    update public.live_duel_seats s set rematch_at = pg_catalog.now() where s.id = v_s.id;
    perform meldy_private.live_duel_bump(v_d.id);
  end if;
  if v_d.next_id is null
     and (select pg_catalog.count(*) from public.live_duel_seats s where s.duel_id = v_d.id and s.rematch_at is not null) = 2 then
    perform meldy_private.live_duel_rematch_make(v_d.id);
  end if;
  select d.* into v_d from public.live_duels d where d.id = v_d.id;
  select s.* into v_s from public.live_duel_seats s where s.id = v_s.id;
  return meldy_private.live_duel_json(v_d, v_s);
end;
$fn$;

-- 5i. «Разбор и ошибки» of a finished duel (ML004 not_done before): every closed question with its key, the own answer
--     and the other seat's (its typed text masked by the live game's filter), all in this seat's order of the options.
--     The items as live_review's (CONTRACT §8) with `other`.
create or replace function public.duel_review(p_code text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_s public.live_duel_seats;
  v_d public.live_duels;
  v_o public.live_duel_seats;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform meldy_private.live_fail('P0002', 'token', 404);
  end if;
  v_s := meldy_private.live_duel_enter(p_code, p_token);
  select d.* into v_d from public.live_duels d where d.id = v_s.duel_id;
  if v_d.stage <> 'final' then
    perform meldy_private.live_fail('ML004', 'not_done');
  end if;
  select s.* into v_o from public.live_duel_seats s where s.duel_id = v_d.id and s.seat <> v_s.seat;
  return pg_catalog.jsonb_build_object('items', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'qi', q.qi, 'text', q.text,
             'options', (select coalesce(pg_catalog.jsonb_agg(q.options -> x.f::integer order by x.n), '[]'::jsonb)
                           from pg_catalog.unnest(o.p) with ordinality as x(f, n)),
             'choice', pg_catalog.array_position(o.p, m.choice) - 1, 'correct', m.correct,
             'picks', (select pg_catalog.to_jsonb(pg_catalog.array_agg((pg_catalog.array_position(o.p, k) - 1)::smallint
                                                  order by pg_catalog.array_position(o.p, k))) from pg_catalog.unnest(m.picks) k),
             'typed', m.typed, 'share', coalesce(m.share, 0), 'dmg', m.dmg, 'none', m.at is null,
             'other', meldy_private.live_duel_side(t, o.p, false))
             || meldy_private.live_duel_key(q, o.p)
             order by q.qi), '[]'::jsonb)
      from public.live_duel_questions q
      join public.live_duel_answers m on m.seat_id = v_s.id and m.qi = q.qi
      left join public.live_duel_answers t on t.seat_id = v_o.id and t.qi = q.qi
      cross join lateral (select meldy_private.live_run_perm(v_s.id, q.qi, pg_catalog.jsonb_array_length(q.options), q.keep_order) as p) o
     where q.duel_id = v_d.id and q.closed_at is not null));
end;
$fn$;

-- 5j. «Тренировать ошибки» of a finished duel, as challenge_practice (CHALLENGE.md §5): the session's account (28000),
--     a seat of the link; the duel over (ML004 not_done), never one that expired unplayed (ML002 expired), until a week
--     after its end (ML002 expired), a seat with a closed question (ML004 not_done). The exam's author or an active
--     member records at once. Anyone else becomes a member (which lets them read every key of the exam) only with a
--     standing of their own (DUEL.md §9): (a) the duel is the exam author's own (its owner owns the exam), or (b) in the
--     source, within its window: their own finished, not removed run of that challenge until 7 days after its end, their
--     own player in that game, not kicked, until 7 days after it — own by the account, or the run or player whose token
--     made this duel when the caller holds its first seat — or their own finished attempt of the quiz (as
--     quiz_practice_join asks); and then only through a quiz that offers practice with no quiz of the exam open
--     (ML012 practice | open | removed | full). Without that right nothing is written to container_members (ML012
--     practice). Wrong, partial and unanswered questions go through record_test_answers_for (source web, client_event_id
--     ld:<duel>:<seat>:<qi>: once) with the frozen item_rev: an item whose key changed since is «stale», never graded by
--     the new key.
create or replace function public.duel_practice(p_code text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_s public.live_duel_seats;
  v_d public.live_duels;
  v_q public.quizzes;
  v_m public.container_members%rowtype;
  v_found boolean;
  v_standing boolean;
  v_joined boolean := false;
  v_answers jsonb;
  v_out jsonb;
  v_saved integer := 0;
begin
  if v_user is null then
    perform meldy_private.live_fail('28000', null, 401);
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform meldy_private.live_fail('P0002', 'token', 404);
  end if;
  v_s := meldy_private.live_duel_enter(p_code, p_token);
  select d.* into v_d from public.live_duels d where d.id = v_s.duel_id;
  if v_d.stage <> 'final' then
    perform meldy_private.live_fail('ML004', 'not_done');
  end if;
  if v_d.end_reason = 'expired' or v_d.ended_at < pg_catalog.now() - interval '7 days' then
    perform meldy_private.live_fail('ML002', 'expired');
  end if;
  if not exists (select 1 from public.live_duel_answers a join public.live_duel_questions q on q.duel_id = a.duel_id and q.qi = a.qi
                  where a.seat_id = v_s.id and a.settled_at is not null and q.closed_at is not null) then
    perform meldy_private.live_fail('ML004', 'not_done');
  end if;
  if meldy_private.role_in(v_user, v_d.container_id) is null then
    v_standing :=
      (v_d.owner_id is not null and exists (select 1 from public.containers c where c.id = v_d.container_id and c.owner_id = v_d.owner_id))
      or (v_d.source = 'challenge' and exists (
            select 1 from public.live_runs r join public.live_challenges c on c.id = r.challenge_id
             where r.challenge_id = v_d.source_id and r.finished_at is not null and r.removed_at is null
               and (r.user_id = v_user or (v_s.seat = 1 and r.id = v_d.source_ref))
               and meldy_private.live_challenge_end_at(c) >= pg_catalog.now() - interval '7 days'))
      or (v_d.source = 'game' and exists (
            select 1 from public.live_players p join public.live_games g on g.id = p.game_id
             where p.game_id = v_d.source_id and p.kicked_at is null
               and (p.user_id = v_user or (v_s.seat = 1 and p.id = v_d.source_ref))
               and g.state in ('podium', 'ended') and coalesce(g.ended_at, g.state_at) >= pg_catalog.now() - interval '7 days'))
      or (v_d.quiz_id is not null and exists (
            select 1 from public.quiz_attempts a where a.quiz_id = v_d.quiz_id and a.user_id = v_user and a.finished_at is not null));
    if not coalesce(v_standing, false) then
      perform meldy_private.live_fail('ML012', 'practice', 403);
    end if;
    if v_d.quiz_id is not null then
      select q.* into v_q from public.quizzes q where q.id = v_d.quiz_id;
    end if;
    if v_q.id is null or not v_q.offer_practice or v_q.container_id <> v_d.container_id then
      perform meldy_private.live_fail('ML012', 'practice', 403);
    end if;
    if not meldy_private.quiz_practice_ready(v_d.container_id) then
      perform meldy_private.live_fail('ML012', 'open', 403);
    end if;
    perform 1 from public.containers c where c.id = v_d.container_id for update;
    select m.* into v_m from public.container_members m
     where m.container_id = v_d.container_id and m.user_id = v_user
       for update;
    v_found := found;
    if v_found and v_m.removed_at is not null then
      perform meldy_private.live_fail('ML012', 'removed', 403);
    end if;
    if (select pg_catalog.count(*) from public.container_members m
         where m.container_id = v_d.container_id and m.left_at is null and m.removed_at is null) >= 200 then
      perform meldy_private.live_fail('ML012', 'full', 403);
    end if;
    if v_found then
      update public.container_members m set left_at = null
       where m.container_id = v_d.container_id and m.user_id = v_user;
    else
      insert into public.container_members (container_id, user_id) values (v_d.container_id, v_user);
    end if;
    v_joined := true;
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'client_event_id', 'ld:' || pg_catalog.replace(v_d.id::text, '-', '') || ':' || v_s.seat || ':' || q.qi,
           'item_id', q.item_id, 'mode', 'learn')
           || case when q.item_rev is not null then pg_catalog.jsonb_build_object('rev', q.item_rev) else '{}'::jsonb end
           || case when q.kind in ('short', 'number') then pg_catalog.jsonb_build_object('text', a.typed)
                   else pg_catalog.jsonb_build_object('chosen',
                          (select pg_catalog.to_jsonb(pg_catalog.array_agg(q.shown[x + 1] order by q.shown[x + 1]))
                             from pg_catalog.unnest(coalesce(a.picks, case when a.choice is not null then array[a.choice] end)) x)) end
           order by q.qi)
    into v_answers
    from public.live_duel_answers a
    join public.live_duel_questions q on q.duel_id = a.duel_id and q.qi = a.qi
   where a.seat_id = v_s.id and a.settled_at is not null and not a.correct and q.item_id is not null
     and exists (select 1 from public.test_items i where i.id = q.item_id and i.container_id = v_d.container_id and i.keyed);
  if v_answers is not null then
    v_out := meldy_private.record_test_answers_for(v_user, v_answers, 'web', 30);
    select pg_catalog.count(*)::integer into v_saved
      from pg_catalog.jsonb_array_elements(v_out -> 'results') r where r ->> 'status' in ('saved', 'duplicate');
  end if;
  return pg_catalog.jsonb_build_object('container_id', v_d.container_id, 'joined', v_joined, 'saved', v_saved,
                                       'mistakes', coalesce(pg_catalog.jsonb_array_length(v_answers), 0));
end;
$fn$;

-- ─────────────────────────────────────────── 6. Grants ───────────────────────────────────────────
-- Supabase gives new public functions to anon and authenticated and PostgreSQL to PUBLIC: taken back, then given as the
-- contract says. The tables and the helpers: nothing for anyone (service_role included).
revoke all on table public.live_duels, public.live_duel_seats, public.live_duel_questions, public.live_duel_answers
  from public, anon, authenticated, service_role;
revoke all on table meldy_private.live_duel_hits from public, anon, authenticated, service_role;

revoke all on function
  meldy_private.live_duel_points(integer, boolean, double precision, integer, integer, boolean, boolean),
  meldy_private.live_duel_winner(integer, integer, integer, integer),
  meldy_private.live_duel_share(public.live_duel_questions, smallint, smallint[], text),
  meldy_private.live_duel_rude(text), meldy_private.live_duel_here(timestamptz, timestamptz),
  meldy_private.live_duel_reveal_end(public.live_duel_questions), meldy_private.live_duel_rev(public.live_duels),
  meldy_private.live_duel_bump(uuid),
  meldy_private.live_duel_open(uuid, integer, timestamptz), meldy_private.live_duel_close(uuid, timestamptz),
  meldy_private.live_duel_end(uuid, text, timestamptz, smallint), meldy_private.live_duel_settle(uuid, uuid),
  meldy_private.live_duel_of(text), meldy_private.live_duel_enter(text, text),
  meldy_private.live_duel_limits(uuid, text, boolean), meldy_private.live_duel_fill(uuid, uuid[]),
  meldy_private.live_duel_insert(public.live_duels), meldy_private.live_duel_rematch_make(uuid),
  meldy_private.live_duel_side(public.live_duel_answers, smallint[], boolean),
  meldy_private.live_duel_key(public.live_duel_questions, smallint[]),
  meldy_private.live_duel_info_json(public.live_duels),
  meldy_private.live_duel_json(public.live_duels, public.live_duel_seats)
  from public, anon, authenticated, service_role;

revoke all on function
  public.duel_create(jsonb, jsonb, text, text, jsonb), public.duel_info(text), public.duel_join(text, text, text, jsonb),
  public.duel_state(text, text, bigint), public.duel_ready(text, text), public.duel_answer(text, text, integer, jsonb),
  public.duel_next(text, text, integer), public.duel_rematch(text, text), public.duel_review(text, text),
  public.duel_practice(text, text)
  from public, anon, authenticated;
grant execute on function
  public.duel_create(jsonb, jsonb, text, text, jsonb), public.duel_info(text), public.duel_join(text, text, text, jsonb),
  public.duel_state(text, text, bigint), public.duel_ready(text, text), public.duel_answer(text, text, integer, jsonb),
  public.duel_next(text, text, integer), public.duel_rematch(text, text), public.duel_review(text, text),
  public.duel_practice(text, text)
  to anon, authenticated;
