-- quizzes («Контрольная», release 46)
-- Repo file: supabase/migrations/20261016120000_quizzes.sql. Spec: meldy-notes 10_Project/Quiz_and_Editor_Spec_2026-10-16.md
-- part 2 (§2.4 data); plan: docs/superpowers/plans/2026-10-16-quiz.md («Global Constraints», «Data contract»: the shapes
-- frontend/src/types/quiz.ts mirrors — field names, functions and error codes are fixed there).
-- Check after the apply: supabase/tests/quizzes.sql. Local rehearsal (never live): supabase/tests/local/quizzes_run.sh.
-- Rollback: supabase/rollback/20261016120000_quizzes_down.sql.
--
-- The author of an exam (containers) makes a «Контрольная» from its keyed questions: how many, from which subjects, one
-- set for all or a new draw per attempt, the order, a timer, a window, attempts, best / last, a pass mark, what the
-- participant sees after. The link /k/<code> works for anyone signed in (or members of the exam only); the author sees
-- the names people type, their answers and results. The participant does not become a member of the exam: no plan, no
-- test_answers, no test_items read through RLS (the pictures only, by the storage policy of §5).
--
-- Three tables, RLS on and no policy, every right revoked from the clients: the functions below are the only door.
-- Scores are never stored: «correct» is meldy_private.grade_answer against the CURRENT key of each question at read
-- time (a key fixed during the quiz re-grades everyone at once; a question deleted or left without a key drops out).
-- Attempts past their time are closed lazily by meldy_private.quiz_settle at the start of every quiz function; no
-- schedule. deadline_at = least(started_at + time limit, closes_at, closed_at) over the ones set (null: no deadline); an
-- answer is taken until deadline_at + 20 s (a slow phone), then the attempt ends at deadline_at: «time» when the timer
-- made the deadline, «closed» when the closing did («Закрыть сейчас» ends them at once, without the 20 s). A change of
-- closes_at moves the deadlines of unfinished attempts with it. The key (test_items.correct / answers) leaves only through
-- quiz_result, and only when the review setting allows it now.
--
-- Additive and re-runnable: IF NOT EXISTS, OR REPLACE, the policy created when missing, grants at the end. Nothing of an
-- older migration changes (my_container_ids() stays as it is: a quiz taker must not read test_items with their keys).
-- Errors (SQLSTATE): 28000 not signed in; P0002 not the caller's / missing; 22023 bad input (detail names the field);
-- MC010 too many quizzes (50 per exam); MC011 a locked setting after the first attempt (detail = the key); MC012 the
-- attempt is over (finished, or past deadline_at + 20 s); MC013 not open (detail not_yet / closed / no_questions);
-- MC014 no attempts left (detail attempts / full); MC015 members only.

-- 1. Tables.
-- 1a. A quiz of an exam. code: the link (stored open, unlike container_links: the author shows it again from any device,
--     and no client reads this table). subject_ids: in exam order. item_count: clamped to the pool when written.
--     fixed_item_ids: the one set of same_set, drawn at the create (and again when the draw settings change before any
--     participant started). time_limit_s: the setting time_limit_min × 60. attempts_allowed null = no limit (50 a person).
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references public.containers(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  code text not null default meldy_private.random_code(),
  title text not null,
  subject_ids uuid[] not null,
  item_count smallint not null,
  same_set boolean not null default false,
  fixed_item_ids uuid[],
  shuffle_items boolean not null default true,
  shuffle_options boolean not null default true,
  time_limit_s integer,
  opens_at timestamptz,
  closes_at timestamptz,
  attempts_allowed smallint default 1,
  grading text not null default 'best',
  allow_back boolean not null default true,
  pass_percent smallint,
  review text not null default 'mistakes_then_answers',
  members_only boolean not null default false,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quizzes_code_key unique (code),
  constraint quizzes_code_check check (code ~ '^[0-9a-hjkmnp-tv-z]{12}$'),
  constraint quizzes_title_check check (char_length(btrim(title)) between 1 and 120),
  constraint quizzes_subject_ids_check check (cardinality(subject_ids) between 1 and 50),
  constraint quizzes_item_count_check check (item_count between 1 and 200),
  constraint quizzes_fixed_item_ids_check check (fixed_item_ids is null or cardinality(fixed_item_ids) between 1 and 200),
  constraint quizzes_time_limit_check check (time_limit_s is null or time_limit_s between 60 and 14400),
  constraint quizzes_window_check check (opens_at is null or closes_at is null or closes_at > opens_at),
  constraint quizzes_attempts_check check (attempts_allowed is null or attempts_allowed between 1 and 50),
  constraint quizzes_grading_check check (grading in ('best', 'last')),
  constraint quizzes_pass_percent_check check (pass_percent is null or pass_percent between 1 and 100),
  constraint quizzes_review_check check (review in ('score', 'mistakes', 'answers', 'mistakes_then_answers'))
);
create index if not exists quizzes_container_idx on public.quizzes (container_id, created_at desc);
create index if not exists quizzes_owner_idx on public.quizzes (owner_id);

-- 1b. An attempt: the name the participant typed for the author, the questions drawn in the order shown.
--     n = the person's attempt number (a reset deletes a row; the next start takes max(n) + 1).
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  n smallint not null,
  item_ids uuid[] not null,
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  finished_at timestamptz,
  finish_reason text,
  constraint quiz_attempts_person_n_key unique (quiz_id, user_id, n),
  constraint quiz_attempts_name_check check (char_length(btrim(name)) between 2 and 80),
  constraint quiz_attempts_n_check check (n >= 1),
  constraint quiz_attempts_item_ids_check check (cardinality(item_ids) between 1 and 200),
  constraint quiz_attempts_finish_reason_check check (finish_reason in ('sent', 'time', 'closed')),
  constraint quiz_attempts_finished_check check ((finished_at is null) = (finish_reason is null))
);
create index if not exists quiz_attempts_user_idx on public.quiz_attempts (user_id, quiz_id);
create index if not exists quiz_attempts_open_idx on public.quiz_attempts (quiz_id) where finished_at is null;

-- 1c. The saved answer of a question in an attempt: chosen (options in file order) or text, never both; no verdict.
create table if not exists public.quiz_answers (
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  item_id uuid not null references public.test_items(id) on delete cascade,
  chosen smallint[],
  text text,
  answered_at timestamptz not null default now(),
  primary key (attempt_id, item_id),
  constraint quiz_answers_one_check check ((chosen is null) <> (text is null)),
  constraint quiz_answers_chosen_check check (chosen is null or cardinality(chosen) between 1 and 8),
  constraint quiz_answers_text_check check (text is null or char_length(text) between 1 and 200)
);
create index if not exists quiz_answers_item_idx on public.quiz_answers (item_id);

alter table public.quizzes enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_answers enable row level security;
revoke all on table public.quizzes, public.quiz_attempts, public.quiz_answers from anon, authenticated;

-- 2. Private helpers (meldy_private: no USAGE for clients; called by the SECURITY DEFINER functions of §3–§5).
-- 2a. The state of a quiz now: closed (closed by the author, or past closes_at), not_yet (before opens_at), open.
create or replace function meldy_private.quiz_state(p_q public.quizzes)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case when p_q.closed_at is not null or p_q.closes_at <= pg_catalog.now() then 'closed'
              when p_q.opens_at > pg_catalog.now() then 'not_yet'
              else 'open' end
$fn$;

-- 2b. Started = someone other than the author has an attempt (the author's own test attempt locks nothing).
create or replace function meldy_private.quiz_started(p_q public.quizzes)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (select 1 from public.quiz_attempts a where a.quiz_id = p_q.id and a.user_id <> p_q.owner_id)
$fn$;

-- 2c. QuizRow (the data contract): the settings as the client names them, the state, started. No fixed_item_ids.
create or replace function meldy_private.quiz_row(p_q public.quizzes)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'id', p_q.id, 'container_id', p_q.container_id, 'code', p_q.code, 'title', p_q.title,
    'subject_ids', pg_catalog.to_jsonb(p_q.subject_ids), 'item_count', p_q.item_count, 'same_set', p_q.same_set,
    'shuffle_items', p_q.shuffle_items, 'shuffle_options', p_q.shuffle_options, 'time_limit_s', p_q.time_limit_s,
    'opens_at', p_q.opens_at, 'closes_at', p_q.closes_at, 'closed_at', p_q.closed_at, 'attempts', p_q.attempts_allowed,
    'grading', p_q.grading, 'allow_back', p_q.allow_back, 'pass_percent', p_q.pass_percent, 'review', p_q.review,
    'members_only', p_q.members_only, 'created_at', p_q.created_at, 'updated_at', p_q.updated_at,
    'state', meldy_private.quiz_state(p_q), 'started', meldy_private.quiz_started(p_q))
$fn$;

-- 2d. The pool: keyed questions of the exam in the chosen subjects, in exam order (subject position, then question
--     position).
create or replace function meldy_private.quiz_pool(p_container uuid, p_subjects uuid[])
returns uuid[]
language sql
stable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.array_agg(i.id order by s.position, s.created_at, i.position, i.id), '{}'::uuid[])
    from public.test_items i
    join public.container_subjects s on s.id = i.subject_id
   where i.container_id = p_container and i.subject_id = any (p_subjects) and i.keyed
$fn$;

-- 2e. A random set of item_count questions of the pool, in pool order (the same_set draw; a fresh attempt's sample).
create or replace function meldy_private.quiz_fixed(p_q public.quizzes, p_pool uuid[])
returns uuid[]
language sql
volatile
set search_path = ''
as $fn$
  select coalesce(pg_catalog.array_agg(x.id order by x.ord), '{}'::uuid[])
    from (select p.id, p.ord from pg_catalog.unnest(p_pool) with ordinality as p(id, ord)
           order by pg_catalog.random() limit p_q.item_count) x
$fn$;

-- 2f. The questions of a new attempt in the order shown: same_set → the fixed set (only what is still in the pool), else
--     a new sample; shuffle_items → a random order, else exam order.
create or replace function meldy_private.quiz_draw(p_q public.quizzes)
returns uuid[]
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_pool uuid[] := meldy_private.quiz_pool(p_q.container_id, p_q.subject_ids);
  v_set uuid[];
begin
  if p_q.same_set and p_q.fixed_item_ids is not null then
    select coalesce(pg_catalog.array_agg(f.id order by f.ord), '{}'::uuid[]) into v_set
      from pg_catalog.unnest(p_q.fixed_item_ids) with ordinality as f(id, ord)
     where f.id = any (v_pool);
  else
    v_set := meldy_private.quiz_fixed(p_q, v_pool);
  end if;
  if p_q.shuffle_items then
    return (select coalesce(pg_catalog.array_agg(s.id order by pg_catalog.random()), '{}'::uuid[])
              from pg_catalog.unnest(v_set) as s(id));
  end if;
  return (select coalesce(pg_catalog.array_agg(s.id order by pg_catalog.array_position(v_pool, s.id)), '{}'::uuid[])
            from pg_catalog.unnest(v_set) as s(id));
end;
$fn$;

-- 2g. How many questions a start would draw now (the preview's item_count; 0 = nothing to draw).
create or replace function meldy_private.quiz_draw_count(p_q public.quizzes)
returns integer
language sql
stable
set search_path = ''
as $fn$
  select case when p_q.same_set and p_q.fixed_item_ids is not null
              then (select pg_catalog.count(*)::integer from pg_catalog.unnest(p_q.fixed_item_ids) f
                     where f = any (meldy_private.quiz_pool(p_q.container_id, p_q.subject_ids)))
              else least(p_q.item_count::integer,
                         pg_catalog.cardinality(meldy_private.quiz_pool(p_q.container_id, p_q.subject_ids))) end
$fn$;

-- 2h. The deadline of an attempt started at p_started: the earliest of the timer, closes_at and closed_at that are set
--     (null when none is), never before the start.
create or replace function meldy_private.quiz_deadline(p_started timestamptz, p_q public.quizzes)
returns timestamptz
language sql
stable
set search_path = ''
as $fn$
  select case when x.d is null then null else greatest(x.d, p_started) end
    from (select least(p_started + pg_catalog.make_interval(secs => p_q.time_limit_s), p_q.closes_at, p_q.closed_at) as d) x
$fn$;

-- 2i. Why an attempt ended at its deadline: «time» when the timer made the deadline, «closed» when the closing did.
create or replace function meldy_private.quiz_end_reason(p_started timestamptz, p_deadline timestamptz, p_limit_s integer)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case when p_limit_s is not null and p_deadline = p_started + pg_catalog.make_interval(secs => p_limit_s)
              then 'time' else 'closed' end
$fn$;

-- 2j. Settle: unfinished attempts past deadline_at + 20 s end at deadline_at; when the quiz is closed by the author (or
--     its closing time passed, for an attempt without a deadline) every unfinished attempt ends as «closed». Returns
--     the number of attempts it ended. Runs at the start of every quiz function.
create or replace function meldy_private.quiz_settle(p_quiz uuid)
returns integer
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_q public.quizzes%rowtype;
  v_n integer;
  v_m integer;
begin
  select q.* into v_q from public.quizzes q where q.id = p_quiz;
  if not found then
    return 0;
  end if;
  update public.quiz_attempts a
     set finished_at = a.deadline_at,
         finish_reason = meldy_private.quiz_end_reason(a.started_at, a.deadline_at, v_q.time_limit_s)
   where a.quiz_id = p_quiz and a.finished_at is null and a.deadline_at is not null
     and pg_catalog.now() >= a.deadline_at + interval '20 seconds';
  get diagnostics v_n = row_count;
  update public.quiz_attempts a
     set finished_at = greatest(a.started_at, coalesce(v_q.closed_at, v_q.closes_at)), finish_reason = 'closed'
   where a.quiz_id = p_quiz and a.finished_at is null
     and (v_q.closed_at is not null
          or (a.deadline_at is null and v_q.closes_at is not null
              and pg_catalog.now() >= v_q.closes_at + interval '20 seconds'));
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$fn$;

-- 2k. Reading one setting of p_settings; a bad value raises 22023 with the key in detail.
--     An integer p_min..p_max (a JSON number without a fraction); JSON null → null when p_nullable.
create or replace function meldy_private.quiz_int(p_settings jsonb, p_key text, p_min integer, p_max integer,
                                                  p_nullable boolean)
returns integer
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v jsonb := p_settings -> p_key;
  v_n integer;
begin
  if p_nullable and pg_catalog.jsonb_typeof(v) = 'null' then
    return null;
  end if;
  if pg_catalog.jsonb_typeof(v) is distinct from 'number' or (v #>> '{}') !~ '^[0-9]{1,6}$' then
    raise exception 'invalid settings' using errcode = '22023', detail = p_key;
  end if;
  v_n := (v #>> '{}')::integer;
  if v_n not between p_min and p_max then
    raise exception 'invalid settings' using errcode = '22023', detail = p_key;
  end if;
  return v_n;
end;
$fn$;

create or replace function meldy_private.quiz_bool(p_settings jsonb, p_key text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if pg_catalog.jsonb_typeof(p_settings -> p_key) is distinct from 'boolean' then
    raise exception 'invalid settings' using errcode = '22023', detail = p_key;
  end if;
  return (p_settings ->> p_key)::boolean;
end;
$fn$;

-- A moment: JSON null → null, else an ISO date-time string («2026-10-24T18:00:00+03:00»).
create or replace function meldy_private.quiz_time(p_settings jsonb, p_key text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v jsonb := p_settings -> p_key;
  v_t timestamptz;
begin
  if pg_catalog.jsonb_typeof(v) = 'null' then
    return null;
  end if;
  if pg_catalog.jsonb_typeof(v) is distinct from 'string' or (v #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then
    raise exception 'invalid settings' using errcode = '22023', detail = p_key;
  end if;
  begin
    v_t := (v #>> '{}')::timestamptz;
  exception
    when others then
      raise exception 'invalid settings' using errcode = '22023', detail = p_key;
  end;
  return v_t;
end;
$fn$;

-- 2l. The settings of the contract applied on a quiz row: only the keys given (create starts from the defaults);
--     unknown keys are ignored. subject_ids must be subjects of the quiz's exam; they are kept in exam order.
--     item_count is NOT clamped here (the callers clamp to the pool).
create or replace function meldy_private.quiz_apply(p_q public.quizzes, p_settings jsonb)
returns public.quizzes
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_q public.quizzes := p_q;
  v jsonb;
  v_ids uuid[];
begin
  if p_settings is null or pg_catalog.jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'invalid settings' using errcode = '22023', detail = 'settings';
  end if;
  if p_settings ? 'title' then
    v := p_settings -> 'title';
    if pg_catalog.jsonb_typeof(v) is distinct from 'string'
       or pg_catalog.char_length(pg_catalog.btrim(v #>> '{}')) not between 1 and 120 then
      raise exception 'invalid settings' using errcode = '22023', detail = 'title';
    end if;
    v_q.title := pg_catalog.btrim(v #>> '{}');
  end if;
  if p_settings ? 'subject_ids' then
    v := p_settings -> 'subject_ids';
    if pg_catalog.jsonb_typeof(v) is distinct from 'array' then
      raise exception 'invalid settings' using errcode = '22023', detail = 'subject_ids';
    end if;
    if pg_catalog.jsonb_array_length(v) not between 1 and 50
       or exists (select 1 from pg_catalog.jsonb_array_elements(v) x
                   where pg_catalog.jsonb_typeof(x) is distinct from 'string'
                      or (x #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'invalid settings' using errcode = '22023', detail = 'subject_ids';
    end if;
    select pg_catalog.array_agg(s.id order by s.position, s.created_at, s.id) into v_ids
      from public.container_subjects s
     where s.container_id = v_q.container_id
       and s.id in (select (x #>> '{}')::uuid from pg_catalog.jsonb_array_elements(v) x);
    if coalesce(pg_catalog.cardinality(v_ids), 0)
       <> (select pg_catalog.count(distinct (x #>> '{}')::uuid) from pg_catalog.jsonb_array_elements(v) x) then
      raise exception 'invalid settings' using errcode = '22023', detail = 'subject_ids';
    end if;
    v_q.subject_ids := v_ids;
  end if;
  if p_settings ? 'item_count' then
    v_q.item_count := meldy_private.quiz_int(p_settings, 'item_count', 1, 200, false);
  end if;
  if p_settings ? 'same_set' then
    v_q.same_set := meldy_private.quiz_bool(p_settings, 'same_set');
  end if;
  if p_settings ? 'shuffle_items' then
    v_q.shuffle_items := meldy_private.quiz_bool(p_settings, 'shuffle_items');
  end if;
  if p_settings ? 'shuffle_options' then
    v_q.shuffle_options := meldy_private.quiz_bool(p_settings, 'shuffle_options');
  end if;
  if p_settings ? 'time_limit_min' then
    v_q.time_limit_s := meldy_private.quiz_int(p_settings, 'time_limit_min', 1, 240, true) * 60;
  end if;
  if p_settings ? 'opens_at' then
    v_q.opens_at := meldy_private.quiz_time(p_settings, 'opens_at');
  end if;
  if p_settings ? 'closes_at' then
    v_q.closes_at := meldy_private.quiz_time(p_settings, 'closes_at');
  end if;
  if p_settings ? 'attempts' then
    v_q.attempts_allowed := meldy_private.quiz_int(p_settings, 'attempts', 1, 50, true);
  end if;
  if p_settings ? 'grading' then
    if pg_catalog.jsonb_typeof(p_settings -> 'grading') is distinct from 'string'
       or (p_settings ->> 'grading') not in ('best', 'last') then
      raise exception 'invalid settings' using errcode = '22023', detail = 'grading';
    end if;
    v_q.grading := p_settings ->> 'grading';
  end if;
  if p_settings ? 'allow_back' then
    v_q.allow_back := meldy_private.quiz_bool(p_settings, 'allow_back');
  end if;
  if p_settings ? 'pass_percent' then
    v_q.pass_percent := meldy_private.quiz_int(p_settings, 'pass_percent', 1, 100, true);
  end if;
  if p_settings ? 'review' then
    if pg_catalog.jsonb_typeof(p_settings -> 'review') is distinct from 'string'
       or (p_settings ->> 'review') not in ('score', 'mistakes', 'answers', 'mistakes_then_answers') then
      raise exception 'invalid settings' using errcode = '22023', detail = 'review';
    end if;
    v_q.review := p_settings ->> 'review';
  end if;
  if p_settings ? 'members_only' then
    v_q.members_only := meldy_private.quiz_bool(p_settings, 'members_only');
  end if;
  if v_q.opens_at is not null and v_q.closes_at is not null and v_q.closes_at <= v_q.opens_at then
    raise exception 'invalid settings' using errcode = '22023', detail = 'closes_at';
  end if;
  return v_q;
end;
$fn$;

-- 2m. Every question of an attempt (p_attempt) or of all attempts of a quiz (p_quiz) that still exists and has a key,
--     with the saved answer graded NOW by grade_answer against the current key (unanswered = not correct).
create or replace function meldy_private.quiz_graded(p_quiz uuid, p_attempt uuid)
returns table (attempt_id uuid, item_id uuid, ord integer, answered boolean, correct boolean, chosen smallint[],
               typed text, answered_at timestamptz)
language plpgsql
stable
set search_path = ''
as $fn$
begin
  return query
  select t.id, x.id, x.ord::integer, w.attempt_id is not null, coalesce(g.o_correct, false), w.chosen, w.text,
         w.answered_at
    from public.quiz_attempts t
   cross join lateral pg_catalog.unnest(t.item_ids) with ordinality as x(id, ord)
    join public.test_items i on i.id = x.id and i.keyed
    left join public.quiz_answers w on w.attempt_id = t.id and w.item_id = x.id
    left join lateral meldy_private.grade_answer(i.kind, pg_catalog.jsonb_array_length(i.options), i.correct, i.answers,
                case when w.text is not null then pg_catalog.jsonb_build_object('text', w.text)
                     when w.chosen is not null then pg_catalog.jsonb_build_object('chosen', pg_catalog.to_jsonb(w.chosen))
                end) g on true
   where (p_attempt is null or t.id = p_attempt) and (p_quiz is null or t.quiz_id = p_quiz);
end;
$fn$;

-- 2n. What keeps p_user from starting a new attempt now (null = nothing): closed (also: nothing left to draw),
--     not_yet, members_only, no_attempts (the person's limit, or 3000 attempts on the quiz).
create or replace function meldy_private.quiz_block(p_q public.quizzes, p_user uuid)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case
    when meldy_private.quiz_state(p_q) = 'closed' or meldy_private.quiz_draw_count(p_q) = 0 then 'closed'
    when meldy_private.quiz_state(p_q) = 'not_yet' then 'not_yet'
    when p_q.members_only and meldy_private.role_in(p_user, p_q.container_id) is null then 'members_only'
    when (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = p_q.id and a.user_id = p_user)
           >= coalesce(p_q.attempts_allowed, 50)
      or (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = p_q.id) >= 3000 then 'no_attempts'
  end
$fn$;

-- 2o. Attempt (the contract): the questions in the order shown WITHOUT correct / answers, the saved answers.
create or replace function meldy_private.quiz_attempt_json(p_a public.quiz_attempts, p_q public.quizzes)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'attempt_id', p_a.id, 'n', p_a.n, 'quiz_title', p_q.title, 'server_now', pg_catalog.now(),
    'started_at', p_a.started_at, 'deadline_at', p_a.deadline_at, 'allow_back', p_q.allow_back,
    'shuffle_options', p_q.shuffle_options,
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'id', i.id, 'kind', i.kind, 'stem', i.stem, 'options', i.options, 'code', i.code,
                                'keep_order', i.keep_order, 'images', i.images) order by x.ord)
                         from pg_catalog.unnest(p_a.item_ids) with ordinality as x(id, ord)
                         join public.test_items i on i.id = x.id), '[]'::jsonb),
    'answers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                  'item_id', w.item_id, 'chosen', pg_catalog.to_jsonb(w.chosen), 'text', w.text)
                                order by pg_catalog.array_position(p_a.item_ids, w.item_id))
                           from public.quiz_answers w where w.attempt_id = p_a.id), '[]'::jsonb))
$fn$;

-- 2p. Result (the contract) of a finished attempt: the score under the current key; the questions as the review
--     setting allows now (score: none; mistakes: the answers with right / wrong; answers: also key / forms;
--     mistakes_then_answers: mistakes until the quiz is closed, then answers).
create or replace function meldy_private.quiz_result_json(p_attempt uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_a public.quiz_attempts%rowtype;
  v_q public.quizzes%rowtype;
  v_total integer;
  v_correct integer;
  v_percent integer;
  v_review text;
  v_used integer;
  v_items jsonb := '[]'::jsonb;
begin
  select a.* into v_a from public.quiz_attempts a where a.id = p_attempt;
  select q.* into v_q from public.quizzes q where q.id = v_a.quiz_id;
  select pg_catalog.count(*)::integer, (pg_catalog.count(*) filter (where g.correct))::integer into v_total, v_correct
    from meldy_private.quiz_graded(null, p_attempt) g;
  v_percent := case when v_total > 0 then pg_catalog.round(100.0 * v_correct / v_total)::integer else 0 end;
  v_review := case when v_q.review <> 'mistakes_then_answers' then v_q.review
                   when meldy_private.quiz_state(v_q) = 'closed' then 'answers'
                   else 'mistakes' end;
  select pg_catalog.count(*)::integer into v_used
    from public.quiz_attempts a where a.quiz_id = v_q.id and a.user_id = v_a.user_id;
  if v_review <> 'score' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', i.id, 'kind', i.kind, 'stem', i.stem, 'options', i.options, 'code', i.code, 'images', i.images,
             'chosen', pg_catalog.to_jsonb(g.chosen), 'text', g.typed, 'right', g.correct,
             'key', case when v_review = 'answers' and i.kind <> 'short' then pg_catalog.to_jsonb(i.correct) end,
             'forms', case when v_review = 'answers' and i.kind = 'short' then pg_catalog.to_jsonb(i.answers) end)
             order by g.ord), '[]'::jsonb)
      into v_items
      from meldy_private.quiz_graded(null, p_attempt) g
      join public.test_items i on i.id = g.item_id;
  end if;
  return pg_catalog.jsonb_build_object(
    'attempt_id', v_a.id, 'n', v_a.n, 'quiz_title', v_q.title, 'code', v_q.code, 'started_at', v_a.started_at,
    'finished_at', v_a.finished_at, 'finish_reason', v_a.finish_reason, 'correct', v_correct, 'total', v_total,
    'percent', v_percent, 'pass_percent', v_q.pass_percent,
    'passed', case when v_q.pass_percent is not null then v_percent >= v_q.pass_percent end,
    'review_now', v_review,
    'answers_after', case when v_q.review = 'mistakes_then_answers' and v_review = 'mistakes'
                          then coalesce(v_q.closed_at, v_q.closes_at) end,
    'attempts_left', case when v_q.attempts_allowed is not null then greatest(v_q.attempts_allowed - v_used, 0) end,
    'can_retry', meldy_private.quiz_block(v_q, v_a.user_id) is null
                 and not exists (select 1 from public.quiz_attempts a
                                  where a.quiz_id = v_q.id and a.user_id = v_a.user_id and a.finished_at is null),
    'items', v_items);
end;
$fn$;

-- 3. The author (the exam's owner; anyone else gets P0002).
-- 3a. A new quiz: missing settings take the defaults of the contract; at most 50 per exam (MC010); an empty pool → MC013
--     no_questions; same_set draws its set now.
create or replace function public.quiz_create(p_container_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_pool uuid[];
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- One creator per exam at a time: the count below holds until commit.
  perform 1 from public.containers c where c.id = p_container_id and c.owner_id = v_user for update;
  if not found then
    raise exception 'container not found' using errcode = 'P0002', detail = 'container';
  end if;
  if (select pg_catalog.count(*) from public.quizzes q where q.container_id = p_container_id) >= 50 then
    raise exception 'too many quizzes' using errcode = 'MC010', detail = 'quizzes';
  end if;
  v_q.id := pg_catalog.gen_random_uuid();
  v_q.container_id := p_container_id;
  v_q.owner_id := v_user;
  v_q.title := 'Контрольная · ' || pg_catalog.to_char(pg_catalog.now() at time zone 'Europe/Minsk', 'DD.MM');
  select coalesce(pg_catalog.array_agg(s.id order by s.position, s.created_at, s.id), '{}'::uuid[]) into v_q.subject_ids
    from public.container_subjects s
   where s.container_id = p_container_id
     and exists (select 1 from public.test_items i where i.subject_id = s.id and i.keyed);
  v_q.item_count := 20;
  v_q.same_set := false;
  v_q.shuffle_items := true;
  v_q.shuffle_options := true;
  v_q.attempts_allowed := 1;
  v_q.grading := 'best';
  v_q.allow_back := true;
  v_q.review := 'mistakes_then_answers';
  v_q.members_only := false;
  v_q := meldy_private.quiz_apply(v_q, coalesce(p_settings, '{}'::jsonb));
  v_pool := meldy_private.quiz_pool(p_container_id, v_q.subject_ids);
  if pg_catalog.cardinality(v_pool) = 0 then
    raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
  end if;
  v_q.item_count := least(v_q.item_count::integer, pg_catalog.cardinality(v_pool));
  if v_q.same_set then
    v_q.fixed_item_ids := meldy_private.quiz_fixed(v_q, v_pool);
  end if;
  loop
    v_q.code := meldy_private.random_code();
    exit when not exists (select 1 from public.quizzes q where q.code = v_q.code);
  end loop;
  v_q.created_at := pg_catalog.now();
  v_q.updated_at := pg_catalog.now();
  insert into public.quizzes values (v_q.*);
  return meldy_private.quiz_row(v_q);
end;
$fn$;

-- 3b. Change settings (only the keys given). After someone other than the author started, a NEW value of subject_ids,
--     item_count, same_set, shuffle_items, shuffle_options or time_limit_min is refused (MC011, detail = the key); the
--     same value is fine (subjects as a set; a count equal after the clamp). A closes_at in the future opens a closed
--     quiz again. The deadlines of unfinished attempts follow the new closes_at / time limit.
create or replace function public.quiz_update(p_quiz_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_old public.quizzes%rowtype;
  v_new public.quizzes%rowtype;
  v_pool uuid[];
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select q.* into v_old from public.quizzes q
    join public.containers c on c.id = q.container_id
   where q.id = p_quiz_id and c.owner_id = v_user
     for update of q;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  perform meldy_private.quiz_settle(v_old.id);
  v_new := meldy_private.quiz_apply(v_old, p_settings);
  v_pool := meldy_private.quiz_pool(v_old.container_id, v_new.subject_ids);
  if meldy_private.quiz_started(v_old) then
    if p_settings ? 'subject_ids' and v_new.subject_ids is distinct from v_old.subject_ids then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'subject_ids';
    end if;
    if p_settings ? 'item_count' and v_new.item_count <> v_old.item_count
       and least(v_new.item_count::integer, pg_catalog.cardinality(v_pool)) <> v_old.item_count then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'item_count';
    end if;
    if v_new.same_set is distinct from v_old.same_set then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'same_set';
    end if;
    if v_new.shuffle_items is distinct from v_old.shuffle_items then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'shuffle_items';
    end if;
    if v_new.shuffle_options is distinct from v_old.shuffle_options then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'shuffle_options';
    end if;
    if v_new.time_limit_s is distinct from v_old.time_limit_s then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'time_limit_min';
    end if;
    v_new.item_count := v_old.item_count;
  elsif p_settings ?| array['subject_ids', 'item_count', 'same_set'] then
    if pg_catalog.cardinality(v_pool) = 0 then
      raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
    end if;
    v_new.item_count := least(v_new.item_count::integer, pg_catalog.cardinality(v_pool));
    if not v_new.same_set then
      v_new.fixed_item_ids := null;
    elsif v_new.fixed_item_ids is null or not v_old.same_set or v_new.subject_ids is distinct from v_old.subject_ids
          or v_new.item_count <> v_old.item_count then
      v_new.fixed_item_ids := meldy_private.quiz_fixed(v_new, v_pool);
    end if;
  end if;
  if p_settings ? 'closes_at' and v_new.closes_at > pg_catalog.now() then
    v_new.closed_at := null;
  end if;
  v_new.updated_at := pg_catalog.now();
  update public.quizzes q set
    title = v_new.title, subject_ids = v_new.subject_ids, item_count = v_new.item_count, same_set = v_new.same_set,
    fixed_item_ids = v_new.fixed_item_ids, shuffle_items = v_new.shuffle_items, shuffle_options = v_new.shuffle_options,
    time_limit_s = v_new.time_limit_s, opens_at = v_new.opens_at, closes_at = v_new.closes_at,
    attempts_allowed = v_new.attempts_allowed, grading = v_new.grading, allow_back = v_new.allow_back,
    pass_percent = v_new.pass_percent, review = v_new.review, members_only = v_new.members_only,
    closed_at = v_new.closed_at, updated_at = v_new.updated_at
   where q.id = v_old.id;
  update public.quiz_attempts a set deadline_at = meldy_private.quiz_deadline(a.started_at, v_new)
   where a.quiz_id = v_old.id and a.finished_at is null
     and a.deadline_at is distinct from meldy_private.quiz_deadline(a.started_at, v_new);
  return meldy_private.quiz_row(v_new);
end;
$fn$;

-- 3c. Close now: closed_at = now() (kept when already closed); unfinished attempts settle as «closed».
create or replace function public.quiz_close(p_quiz_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select q.* into v_q from public.quizzes q
    join public.containers c on c.id = q.container_id
   where q.id = p_quiz_id and c.owner_id = v_user
     for update of q;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  update public.quizzes q set closed_at = coalesce(q.closed_at, pg_catalog.now()), updated_at = pg_catalog.now()
   where q.id = v_q.id
  returning q.* into v_q;
  perform meldy_private.quiz_settle(v_q.id);
  return meldy_private.quiz_row(v_q);
end;
$fn$;

-- 3d. Delete with its attempts and answers.
create or replace function public.quiz_delete(p_quiz_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.quizzes q
   using public.containers c
   where q.id = p_quiz_id and c.id = q.container_id and c.owner_id = v_user;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  return pg_catalog.jsonb_build_object('deleted', true);
end;
$fn$;

-- 3e. The quizzes of an exam, newest first: QuizRow + people (distinct participants other than the author), writing and
--     finished (attempts), avg_percent (finished attempts of others than the author, one decimal; null = none).
create or replace function public.quiz_list(p_container_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.containers c where c.id = p_container_id and c.owner_id = v_user) then
    raise exception 'container not found' using errcode = 'P0002', detail = 'container';
  end if;
  perform meldy_private.quiz_settle(q.id) from public.quizzes q where q.container_id = p_container_id;
  return coalesce((
    select pg_catalog.jsonb_agg(meldy_private.quiz_row(q) || pg_catalog.jsonb_build_object(
             'people', (select pg_catalog.count(distinct a.user_id) from public.quiz_attempts a
                         where a.quiz_id = q.id and a.user_id <> q.owner_id),
             'writing', (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = q.id and a.finished_at is null),
             'finished', (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = q.id and a.finished_at is not null),
             'avg_percent', (select pg_catalog.round(pg_catalog.avg(100.0 * s.correct / s.total), 1)
                               from (select g.attempt_id, pg_catalog.count(*) as total,
                                            pg_catalog.count(*) filter (where g.correct) as correct
                                       from meldy_private.quiz_graded(q.id, null) g
                                       join public.quiz_attempts a on a.id = g.attempt_id
                                      where a.finished_at is not null and a.user_id <> q.owner_id
                                      group by g.attempt_id) s))
             order by q.created_at desc, q.id desc)
      from public.quizzes q where q.container_id = p_container_id), '[]'::jsonb);
end;
$fn$;

-- 3f. The stats page (polled): the quiz, the server's clock, every attempt with its live score (own = the author's test
--     attempt; person = a stable id of the participant within this quiz, no user id), and per question (attempts of
--     others than the author only): shown, answered, correct, picks per option, the 3 most common wrong short answers.
create or replace function public.quiz_results(p_quiz_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select q.* into v_q from public.quizzes q
    join public.containers c on c.id = q.container_id
   where q.id = p_quiz_id and c.owner_id = v_user;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  -- One grading pass (g0) for both lists.
  with g0 as materialized (
    select g.*, a.user_id <> v_q.owner_id as counted
      from meldy_private.quiz_graded(v_q.id, null) g
      join public.quiz_attempts a on a.id = g.attempt_id
  ), s as (  -- the live score of each attempt
    select g0.attempt_id, pg_catalog.count(*) as total, pg_catalog.count(*) filter (where g0.answered) as answered,
           pg_catalog.count(*) filter (where g0.correct) as correct
      from g0 group by g0.attempt_id
  ), g as (  -- the question stats count the attempts of others than the author only
    select g0.* from g0 where g0.counted
  ), x as (
    select g.item_id, pg_catalog.count(*) as shown, pg_catalog.count(*) filter (where g.answered) as answered,
           pg_catalog.count(*) filter (where g.correct) as correct
      from g group by g.item_id
  ), p as (  -- answers that chose option k of a question
    select g.item_id, c.k::integer as k, pg_catalog.count(*) as n
      from g cross join lateral pg_catalog.unnest(g.chosen) as c(k)
     group by g.item_id, c.k
  ), wt as (  -- the 3 most common wrong short answers of a question (one spelling per normalised form)
    select z.item_id, z.t, z.n
      from (select y.item_id, y.t, y.n, pg_catalog.row_number() over (partition by y.item_id order by y.n desc, y.t) as r
              from (select g.item_id, pg_catalog.min(pg_catalog.btrim(g.typed)) as t, pg_catalog.count(*) as n
                      from g where g.answered and not g.correct and g.typed is not null
                     group by g.item_id, public.meldy_short_norm(g.typed)) y) z
     where z.r <= 3
  )
  select pg_catalog.jsonb_build_object(
    'quiz', meldy_private.quiz_row(v_q), 'server_now', pg_catalog.now(),
    'attempts', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'id', a.id, 'person', pg_catalog.left(pg_catalog.md5(a.user_id::text || a.quiz_id::text), 16),
                   'name', a.name, 'own', a.user_id = v_q.owner_id, 'n', a.n, 'started_at', a.started_at,
                   'deadline_at', a.deadline_at, 'finished_at', a.finished_at, 'finish_reason', a.finish_reason,
                   'total', coalesce(s.total, 0), 'answered', coalesce(s.answered, 0), 'correct', coalesce(s.correct, 0))
                   order by a.started_at, a.user_id, a.n), '[]'::jsonb)
                   from public.quiz_attempts a
                   left join s on s.attempt_id = a.id
                  where a.quiz_id = v_q.id),
    'items', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'item_id', i.id, 'shown', x.shown, 'answered', x.answered, 'correct', x.correct,
                'picks', case when i.kind = 'short' then '[]'::jsonb
                              else (select pg_catalog.jsonb_agg(coalesce(p.n, 0) order by o.k)
                                      from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(i.options) - 1) as o(k)
                                      left join p on p.item_id = i.id and p.k = o.k) end,
                'wrong_texts', case when i.kind <> 'short' then '[]'::jsonb
                                    else coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('text', wt.t, 'n', wt.n)
                                                                               order by wt.n desc, wt.t)
                                                     from wt where wt.item_id = i.id), '[]'::jsonb) end)
                order by cs.position, cs.created_at, i.position, i.id), '[]'::jsonb)
                from x
                join public.test_items i on i.id = x.item_id
                join public.container_subjects cs on cs.id = i.subject_id))
    into v_out;
  return v_out;
end;
$fn$;

-- 3g. Every saved answer graded now (the CSV): attempt, question, correct.
create or replace function public.quiz_marks(p_quiz_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select q.* into v_q from public.quizzes q
    join public.containers c on c.id = q.container_id
   where q.id = p_quiz_id and c.owner_id = v_user;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('attempt_id', g.attempt_id, 'item_id', g.item_id,
                                                              'correct', g.correct)
                                order by a.started_at, a.user_id, a.n, g.ord)
      from meldy_private.quiz_graded(v_q.id, null) g
      join public.quiz_attempts a on a.id = g.attempt_id
     where g.answered), '[]'::jsonb);
end;
$fn$;

-- 3h. One attempt's saved answers, graded now, in the order shown.
create or replace function public.quiz_attempt_answers(p_attempt_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_quiz uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select a.quiz_id into v_quiz from public.quiz_attempts a
    join public.quizzes q on q.id = a.quiz_id
    join public.containers c on c.id = q.container_id
   where a.id = p_attempt_id and c.owner_id = v_user;
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002', detail = 'attempt';
  end if;
  perform meldy_private.quiz_settle(v_quiz);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', g.item_id, 'chosen', pg_catalog.to_jsonb(g.chosen),
                                                              'text', g.typed, 'correct', g.correct,
                                                              'answered_at', g.answered_at) order by g.ord)
      from meldy_private.quiz_graded(null, p_attempt_id) g
     where g.answered), '[]'::jsonb);
end;
$fn$;

-- 3i. «Сбросить попытку»: the attempt and its answers are deleted; the person has it back.
create or replace function public.quiz_attempt_reset(p_attempt_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_quiz uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select a.quiz_id into v_quiz from public.quiz_attempts a
    join public.quizzes q on q.id = a.quiz_id
    join public.containers c on c.id = q.container_id
   where a.id = p_attempt_id and c.owner_id = v_user;
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002', detail = 'attempt';
  end if;
  perform meldy_private.quiz_settle(v_quiz);
  delete from public.quiz_attempts a where a.id = p_attempt_id;
  return pg_catalog.jsonb_build_object('deleted', true);
end;
$fn$;

-- 4. The participant.
-- 4a. The page /k/<code>, signed out too: what it is, from whom, how long, until when; for a signed-in caller also
--     «me» (the name hint: the name of the last attempt, else the profile; attempts used; the open attempt; whether a
--     start is possible and why not; the finished attempts with their score). No question, no key, no other person.
create or replace function public.quiz_preview(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_me jsonb;
  v_role text;
  v_used integer;
  v_open uuid;
  v_reason text;
begin
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  select q.* into v_q from public.quizzes q where q.code = p_code;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  if v_user is not null then
    v_role := meldy_private.role_in(v_user, v_q.container_id);
    select pg_catalog.count(*)::integer, (pg_catalog.array_agg(a.id) filter (where a.finished_at is null))[1]
      into v_used, v_open
      from public.quiz_attempts a where a.quiz_id = v_q.id and a.user_id = v_user;
    v_reason := case when v_open is null then meldy_private.quiz_block(v_q, v_user) end;
    v_me := pg_catalog.jsonb_build_object(
      'name_hint', coalesce((select a.name from public.quiz_attempts a
                              where a.quiz_id = v_q.id and a.user_id = v_user order by a.n desc limit 1),
                            (select nullif(pg_catalog.btrim(p.full_name), '') from public.profiles p where p.id = v_user)),
      'is_author', v_q.owner_id = v_user,
      'is_member', coalesce(v_role = 'member', false),
      'attempts_used', v_used,
      'open_attempt', v_open,
      'can_start', v_open is not null or v_reason is null,
      'reason', v_reason,
      'results', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                    'attempt_id', a.id, 'n', a.n, 'finished_at', a.finished_at,
                                    'correct', s.correct, 'total', s.total) order by a.n)
                             from public.quiz_attempts a
                             cross join lateral (select pg_catalog.count(*) filter (where g.correct) as correct,
                                                        pg_catalog.count(*) as total
                                                   from meldy_private.quiz_graded(null, a.id) g) s
                            where a.quiz_id = v_q.id and a.user_id = v_user and a.finished_at is not null), '[]'::jsonb));
  end if;
  return pg_catalog.jsonb_build_object(
    'status', meldy_private.quiz_state(v_q), 'title', v_q.title,
    'exam_title', (select c.title from public.containers c where c.id = v_q.container_id),
    'author_name', coalesce((select nullif(pg_catalog.btrim(p.full_name), '') from public.profiles p
                              where p.id = v_q.owner_id), 'Без имени'),
    'item_count', meldy_private.quiz_draw_count(v_q), 'time_limit_s', v_q.time_limit_s,
    'opens_at', v_q.opens_at, 'closes_at', v_q.closes_at, 'attempts', v_q.attempts_allowed, 'grading', v_q.grading,
    'allow_back', v_q.allow_back, 'pass_percent', v_q.pass_percent, 'review', v_q.review,
    'members_only', v_q.members_only, 'server_now', pg_catalog.now(), 'me', v_me);
end;
$fn$;

-- 4b. «Начать»: the caller's unfinished attempt comes back as it is (the name ignored), else a new attempt n + 1 when the
--     quiz is open (MC013), the caller may write it (MC015), has attempts left and the quiz has room (MC014), with a name
--     of 2–80 characters (22023 name). The quiz row is locked first: two tabs pressing «Начать» together get one
--     attempt (the second waits, then finds the first one's attempt open).
create or replace function public.quiz_start(p_code text, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_a public.quiz_attempts%rowtype;
  v_state text;
  v_items uuid[];
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  select q.* into v_q from public.quizzes q where q.code = p_code for update;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  select a.* into v_a from public.quiz_attempts a
   where a.quiz_id = v_q.id and a.user_id = v_user and a.finished_at is null
   order by a.n desc
   limit 1;
  if found then
    return meldy_private.quiz_attempt_json(v_a, v_q);
  end if;
  v_state := meldy_private.quiz_state(v_q);
  if v_state <> 'open' then
    raise exception 'quiz not open' using errcode = 'MC013', detail = v_state;
  end if;
  if v_q.members_only and meldy_private.role_in(v_user, v_q.container_id) is null then
    raise exception 'members only' using errcode = 'MC015', detail = 'members_only';
  end if;
  if (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = v_q.id and a.user_id = v_user)
       >= coalesce(v_q.attempts_allowed, 50) then
    raise exception 'no attempts left' using errcode = 'MC014', detail = 'attempts';
  end if;
  if (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = v_q.id) >= 3000 then
    raise exception 'no attempts left' using errcode = 'MC014', detail = 'full';
  end if;
  if pg_catalog.char_length(v_name) not between 2 and 80 then
    raise exception 'invalid name' using errcode = '22023', detail = 'name';
  end if;
  v_items := meldy_private.quiz_draw(v_q);
  if pg_catalog.cardinality(v_items) = 0 then
    raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
  end if;
  insert into public.quiz_attempts (quiz_id, user_id, name, n, item_ids, started_at, deadline_at)
  values (v_q.id, v_user, v_name,
          (select coalesce(pg_catalog.max(a.n), 0) + 1 from public.quiz_attempts a
            where a.quiz_id = v_q.id and a.user_id = v_user),
          v_items, pg_catalog.now(), meldy_private.quiz_deadline(pg_catalog.now(), v_q))
  returning * into v_a;
  return meldy_private.quiz_attempt_json(v_a, v_q);
end;
$fn$;

-- 4c. Save answers (1–200 at once, all or none): {item_id, chosen?: int[] | null, text?: string | null}. Checked by
--     grade_answer (22023 detail chosen / text; a text of at most 200 characters); an empty choice or an empty text
--     deletes the saved answer; a question outside the attempt → 22023 item. Refused once the attempt is finished or
--     deadline_at + 20 s has passed (MC012).
create or replace function public.quiz_answer(p_attempt_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_a public.quiz_attempts%rowtype;
  v_i public.test_items%rowtype;
  v_x jsonb;
  v_item uuid;
  v_empty boolean;
  v_valid boolean;
  v_chosen smallint[];
  v_text text;
  v_n integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select a.quiz_id into v_a.quiz_id from public.quiz_attempts a where a.id = p_attempt_id and a.user_id = v_user;
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002', detail = 'attempt';
  end if;
  perform meldy_private.quiz_settle(v_a.quiz_id);
  select a.* into v_a from public.quiz_attempts a where a.id = p_attempt_id for update;
  if v_a.finished_at is not null then
    raise exception 'attempt is over' using errcode = 'MC012', detail = 'finished';
  end if;
  if v_a.deadline_at is not null and pg_catalog.now() > v_a.deadline_at + interval '20 seconds' then
    raise exception 'attempt is over' using errcode = 'MC012', detail = 'time';
  end if;
  if p_answers is null or pg_catalog.jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'invalid answers' using errcode = '22023', detail = 'answers';
  end if;
  if pg_catalog.jsonb_array_length(p_answers) not between 1 and 200 then
    raise exception 'invalid answers' using errcode = '22023', detail = 'answers';
  end if;
  for v_x in select x from pg_catalog.jsonb_array_elements(p_answers) x loop
    if pg_catalog.jsonb_typeof(v_x) is distinct from 'object' or pg_catalog.jsonb_typeof(v_x -> 'item_id') is distinct from 'string'
       or (v_x ->> 'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid answers' using errcode = '22023', detail = 'item';
    end if;
    v_item := (v_x ->> 'item_id')::uuid;
    if not (v_item = any (v_a.item_ids)) then
      raise exception 'invalid answers' using errcode = '22023', detail = 'item';
    end if;
    select i.* into v_i from public.test_items i where i.id = v_item;
    if not found then
      raise exception 'invalid answers' using errcode = '22023', detail = 'item';
    end if;
    if v_i.kind = 'short' then
      v_empty := coalesce(pg_catalog.jsonb_typeof(v_x -> 'text'), 'null') = 'null'
                 or (pg_catalog.jsonb_typeof(v_x -> 'text') = 'string' and public.meldy_short_norm(v_x ->> 'text') = '');
    else
      v_empty := coalesce(pg_catalog.jsonb_typeof(v_x -> 'chosen'), 'null') = 'null' or v_x -> 'chosen' = '[]'::jsonb;
    end if;
    if v_empty then
      delete from public.quiz_answers w where w.attempt_id = v_a.id and w.item_id = v_item;
    else
      select g.o_valid, g.o_chosen, g.o_text into v_valid, v_chosen, v_text
        from meldy_private.grade_answer(v_i.kind, pg_catalog.jsonb_array_length(v_i.options), v_i.correct, v_i.answers,
               case when v_i.kind = 'short' then pg_catalog.jsonb_build_object('text', v_x -> 'text')
                    else pg_catalog.jsonb_build_object('chosen', v_x -> 'chosen') end) g;
      if not v_valid or (v_i.kind = 'short' and pg_catalog.char_length(v_text) > 200) then
        raise exception 'invalid answers' using errcode = '22023',
          detail = case when v_i.kind = 'short' then 'text' else 'chosen' end;
      end if;
      insert into public.quiz_answers (attempt_id, item_id, chosen, text, answered_at)
      values (v_a.id, v_item, case when v_i.kind <> 'short' then v_chosen end,
              case when v_i.kind = 'short' then v_text end, pg_catalog.now())
      on conflict (attempt_id, item_id) do update
        set chosen = excluded.chosen, text = excluded.text, answered_at = excluded.answered_at;
    end if;
    v_n := v_n + 1;
  end loop;
  return pg_catalog.jsonb_build_object('saved', v_n, 'server_now', pg_catalog.now(), 'deadline_at', v_a.deadline_at);
end;
$fn$;

-- 4d. «Завершить» (also the page's own call when the timer runs out): an unfinished attempt ends now («sent»), or at its
--     deadline when that has passed («time» / «closed»); a finished one stays as it is. Returns Result.
create or replace function public.quiz_finish(p_attempt_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_a public.quiz_attempts%rowtype;
  v_limit integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select a.quiz_id into v_a.quiz_id from public.quiz_attempts a where a.id = p_attempt_id and a.user_id = v_user;
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002', detail = 'attempt';
  end if;
  perform meldy_private.quiz_settle(v_a.quiz_id);
  select a.* into v_a from public.quiz_attempts a where a.id = p_attempt_id for update;
  if v_a.finished_at is null then
    if v_a.deadline_at is not null and pg_catalog.now() > v_a.deadline_at then
      select q.time_limit_s into v_limit from public.quizzes q where q.id = v_a.quiz_id;
      update public.quiz_attempts a
         set finished_at = a.deadline_at, finish_reason = meldy_private.quiz_end_reason(a.started_at, a.deadline_at, v_limit)
       where a.id = p_attempt_id;
    else
      update public.quiz_attempts a set finished_at = pg_catalog.now(), finish_reason = 'sent' where a.id = p_attempt_id;
    end if;
  end if;
  return meldy_private.quiz_result_json(p_attempt_id);
end;
$fn$;

-- 4e. The result of a finished attempt of the caller (an unfinished one → 22023 unfinished).
create or replace function public.quiz_result(p_attempt_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_quiz uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select a.quiz_id into v_quiz from public.quiz_attempts a where a.id = p_attempt_id and a.user_id = v_user;
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002', detail = 'attempt';
  end if;
  perform meldy_private.quiz_settle(v_quiz);
  if exists (select 1 from public.quiz_attempts a where a.id = p_attempt_id and a.finished_at is null) then
    raise exception 'attempt not finished' using errcode = '22023', detail = 'unfinished';
  end if;
  return meldy_private.quiz_result_json(p_attempt_id);
end;
$fn$;

-- 5. Pictures for the participant: the exams of quizzes where the caller has an attempt (the storage policy below).
--    my_container_ids() is not touched: through it a quiz taker would read test_items with their keys.
create or replace function public.my_quiz_container_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  return query
  select distinct q.container_id
    from public.quiz_attempts a
    join public.quizzes q on q.id = a.quiz_id
   where a.user_id = (select auth.uid());
end;
$fn$;

do $do$
begin
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Test item images: quiz takers read') then
    create policy "Test item images: quiz takers read" on storage.objects for select to authenticated
      using (bucket_id = 'test-item-images'
             and (storage.foldername(name))[1] in (select x::text from public.my_quiz_container_ids() x));
  end if;
end;
$do$;

-- 6. Grants. The clients run the API only (anon: the preview); the helpers stay private.
revoke all on function public.quiz_create(uuid, jsonb), public.quiz_update(uuid, jsonb), public.quiz_close(uuid),
  public.quiz_delete(uuid), public.quiz_list(uuid), public.quiz_results(uuid), public.quiz_marks(uuid),
  public.quiz_attempt_answers(uuid), public.quiz_attempt_reset(uuid), public.quiz_start(text, text),
  public.quiz_answer(uuid, jsonb), public.quiz_finish(uuid), public.quiz_result(uuid), public.my_quiz_container_ids()
  from public, anon;
revoke all on function public.quiz_preview(text) from public;
grant execute on function public.quiz_create(uuid, jsonb), public.quiz_update(uuid, jsonb), public.quiz_close(uuid),
  public.quiz_delete(uuid), public.quiz_list(uuid), public.quiz_results(uuid), public.quiz_marks(uuid),
  public.quiz_attempt_answers(uuid), public.quiz_attempt_reset(uuid), public.quiz_start(text, text),
  public.quiz_answer(uuid, jsonb), public.quiz_finish(uuid), public.quiz_result(uuid), public.my_quiz_container_ids()
  to authenticated;
grant execute on function public.quiz_preview(text) to anon, authenticated;
revoke all on function meldy_private.quiz_state(public.quizzes), meldy_private.quiz_started(public.quizzes),
  meldy_private.quiz_row(public.quizzes), meldy_private.quiz_pool(uuid, uuid[]),
  meldy_private.quiz_fixed(public.quizzes, uuid[]), meldy_private.quiz_draw(public.quizzes),
  meldy_private.quiz_draw_count(public.quizzes), meldy_private.quiz_deadline(timestamptz, public.quizzes),
  meldy_private.quiz_end_reason(timestamptz, timestamptz, integer), meldy_private.quiz_settle(uuid),
  meldy_private.quiz_int(jsonb, text, integer, integer, boolean), meldy_private.quiz_bool(jsonb, text),
  meldy_private.quiz_time(jsonb, text), meldy_private.quiz_apply(public.quizzes, jsonb),
  meldy_private.quiz_graded(uuid, uuid), meldy_private.quiz_block(public.quizzes, uuid),
  meldy_private.quiz_attempt_json(public.quiz_attempts, public.quizzes), meldy_private.quiz_result_json(uuid)
  from public, anon, authenticated;
