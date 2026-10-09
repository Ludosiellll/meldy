-- containers
-- Repo file: supabase/migrations/20261009093500_containers.sql (package A of the exam container, 2026-10-09).
-- Spec: meldy-notes/10_Project/Exam_Container_Spec_2026-10-09.md (§4 the rule, §8 data); details: Concept_3_Architecture
-- (tables, RPCs, RLS) and Concept_2_Study_Engine §2.2–2.9 (the rule to the letter). Shapes: frontend/src/types/container.ts.
-- Hardening: 20261009093501_containers_revokes.sql. Rollback: supabase/rollback/20261009093500_containers_down.sql.
-- Contract check after the apply: supabase/tests/containers.sql. Local rehearsal (never live):
-- supabase/tests/local/containers_run_all.sh (baseline, this file twice, behaviour under both grant modes, concurrency,
-- 2000 items × 30 members, catalog fingerprint, rollback, the repo's oral checks before and after every step).
--
-- One exam for a whole session («экзамен» on screen): subjects; a subject has a TEST part (test_items, own tables) and/or
-- an ORAL part (one existing public.exams row with its exam_questions — cheat sheet, draw and AI check unchanged). Today's
-- exams are one-subject containers VIRTUALLY: an exam that no subject points at is listed as it is; no row of any
-- existing table is written, altered or migrated.
--
-- Nothing existing changes: no ALTER of exams / exam_questions / learning_events / exam_shares, no new journal kind
-- (supabase/tests/cheat_sheet.sql pins six kinds), no CREATE OR REPLACE of an existing function, no policy of an old
-- table, no quota function touched (plan_inputs only READS ai_usage / profiles.is_pro). The group link of a container is
-- MEMBERSHIP (one source of items, own states); its oral subjects reach a member as COPIES through the unchanged
-- exam_share_bundle / exam_share_join, by «derived» exam_shares rows this file inserts (one per oral subject and link;
-- code = f(secret salt of the link, exam id)).
--
-- The rule «верно в два разных дня» lives ONLY here, in meldy_private.rule_step (spec §4, Concept 2 §2.2–2.9): local days
-- from the device (clamped to the server's UTC day ±1), hours from the server clock; a different local day AND ≥ 20 h;
-- checks at named_at + 5 / 12 / 25 / 50 days (50 after the third) as MOMENTS; on the subject's last days (0–2 days
-- before coalesce(subject.exam_date, container.exam_date)) at most named_at + 4 days; an early answer is not a check and
-- the same wait starts again; «Нажали не туда?» (misclick: a wrong option, or «Не знаю» pressed by mistake) is a peek;
-- a retry or a peek day is training; a rev change
-- starts the item from zero; correctness comes from the key, never from the client. contracts/container/rule_vectors.json
-- holds this function's output for 300+ seeded sequences and the named cases; the client's TS reads the same states.
--
-- Additive and re-runnable: IF NOT EXISTS, OR REPLACE, policies created when missing. No DELETE, DROP POLICY or REVOKE of
-- an old object (the Supabase connector holds those for a human). Hardening REVOKEs of the NEW objects are in the second
-- file; safety does not depend on them: every function checks auth.uid() / ownership / membership itself, RLS has no
-- policy for anon, and meldy_private has no USAGE for clients.
-- Errors (SQLSTATE): 28000 not signed in; 42501 not allowed; P0002 not found; 22023 bad input;
-- MC001 no such link; MC002 link revoked; MC003 link expired; MC004 no seat; MC005 own link; MC006 removed from the
-- container; MC007 too many items/subjects/links; MC008 consent needed for oral subjects; MC009 the container has
-- members (remove them before deleting it).

-- 0. Private helpers: a schema PostgREST does not expose and anon/authenticated have no USAGE on.
create schema if not exists meldy_private;
comment on schema meldy_private is 'Internal helpers of the exam containers (not an API). Called by SECURITY DEFINER functions only.';

-- The caller's JWT role: Supabase sets request.jwt.claims (JSON) and, in older PostgREST, request.jwt.claim.role.
create or replace function meldy_private.jwt_role()
returns text
language sql
stable
set search_path = ''
as $fn$
  select coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    (nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))
$fn$;

-- The bot's functions run for the Edge Function (service_role key) or for postgres itself (pg_cron, SQL Editor).
-- A client always arrives as session_user authenticator with a JWT, so it can fake neither.
create or replace function meldy_private.require_service_role()
returns void
language plpgsql
stable
set search_path = ''
as $fn$
begin
  if meldy_private.jwt_role() is not distinct from 'service_role' then
    return;
  end if;
  if meldy_private.jwt_role() is null and session_user in ('postgres', 'supabase_admin') then
    return;
  end if;
  raise exception 'service role only' using errcode = '42501';
end;
$fn$;

-- The client's local day, kept within one day of the server's UTC day (the rule of
-- learning_events_set_server_fields), compared as text: a malformed or impossible date never raises.
create or replace function meldy_private.clamp_day(p_text text)
returns date
language sql
stable
set search_path = ''
as $fn$
  select case p_text
           when pg_catalog.to_char((pg_catalog.now() at time zone 'utc')::date - 1, 'YYYY-MM-DD')
             then (pg_catalog.now() at time zone 'utc')::date - 1
           when pg_catalog.to_char((pg_catalog.now() at time zone 'utc')::date + 1, 'YYYY-MM-DD')
             then (pg_catalog.now() at time zone 'utc')::date + 1
           else (pg_catalog.now() at time zone 'utc')::date
         end
$fn$;

-- 60 bits (15 hex digits) → 12 characters of the share alphabet (Crockford base32 without i, l, o, u), the alphabet
-- exam_share_* accept: ^[0-9a-hjkmnp-tv-z]{12}$.
create or replace function meldy_private.base32_60(p_hex text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_alphabet constant text := '0123456789abcdefghjkmnpqrstvwxyz';
  v_bits bigint := (('x' || pg_catalog.substr(p_hex, 1, 15))::bit(60))::bigint;
  v_out text := '';
begin
  for i in 0..11 loop
    v_out := v_out || pg_catalog.substr(v_alphabet, ((v_bits >> (55 - 5 * i)) & 31)::integer + 1, 1);
  end loop;
  return v_out;
end;
$fn$;

-- A fresh secret code: 60 random bits of gen_random_uuid() (the version nibble skipped).
create or replace function meldy_private.random_code()
returns text
language sql
volatile
set search_path = ''
as $fn$
  select meldy_private.base32_60(pg_catalog.substr(h, 1, 12) || pg_catalog.substr(h, 14, 3))
    from (select pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') as h) x
$fn$;

-- The code of the oral share a container link makes for one oral subject: secret salt of the link + the exam id.
create or replace function meldy_private.oral_code(p_salt text, p_exam_id uuid)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select meldy_private.base32_60(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
           'meldy-oral:' || p_salt || ':' || p_exam_id::text, 'UTF8')), 'hex'))
$fn$;

create or replace function meldy_private.code_hash(p_code text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_code, 'UTF8')), 'hex')
$fn$;

-- 1. Shape validators (immutable, used by CHECK constraints; a client's direct write of a subject runs them too).
-- Options: 2..8 strings, each 1..600 characters after trimming, at most 8 KB together.
create or replace function public.meldy_options_ok(p_options jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select case
    when p_options is null or pg_catalog.jsonb_typeof(p_options) is distinct from 'array' then false
    when pg_catalog.jsonb_array_length(p_options) not between 2 and 8 then false
    when pg_catalog.octet_length(p_options::text) > 8192 then false
    else not exists (
      select 1 from pg_catalog.jsonb_array_elements(p_options) o
       where pg_catalog.jsonb_typeof(o) is distinct from 'string'
          or pg_catalog.char_length(pg_catalog.btrim(o #>> '{}')) not between 1 and 600)
  end
$fn$;

-- Key: indices into the options IN FILE ORDER, distinct, in range; single → at most one; short → none (its key is
-- `answers`); {} = no key yet.
create or replace function public.meldy_key_ok(p_key smallint[], p_options integer, p_kind text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select p_key is not null
     and pg_catalog.array_ndims(p_key) is distinct from 2
     and coalesce(pg_catalog.cardinality(p_key), 0) <= case when p_kind = 'single' then 1
                                                            when p_kind = 'short' then 0 else p_options end
     and not exists (select 1 from pg_catalog.unnest(p_key) k where k is null or k < 0 or k >= p_options)
     and (select pg_catalog.count(distinct k) from pg_catalog.unnest(p_key) k) = coalesce(pg_catalog.cardinality(p_key), 0)
$fn$;

-- A short answer, normalised the same way on both sides (the accepted forms of the file and the typed answer):
-- lower case (an explicit Latin/Cyrillic table first, so Russian and English never depend on the server's locale),
-- ё → е, every run of whitespace (the set of JavaScript's \s) → one space, trimmed, then one trailing «.» dropped
-- and trimmed again. Equal after this = correct. TS: s.toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim(),
-- then if it ends with '.', drop that one character and trimEnd().
create or replace function public.meldy_short_norm(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $fn$
  select pg_catalog.rtrim(case when pg_catalog.right(x.t, 1) = '.' then pg_catalog.left(x.t, -1) else x.t end, ' ')
    from (select pg_catalog.btrim(pg_catalog.regexp_replace(
                   pg_catalog.lower(pg_catalog.translate(p_text,
                     'ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯёІЇЄҐЎ',
                     'abcdefghijklmnopqrstuvwxyzабвгдеежзийклмнопрстуфхцчшщъыьэюяеіїєґў')),
                   '[\t\n\v\f\r    -     　﻿]+', ' ', 'g'), ' ') as t) x
$fn$;

-- The accepted forms of a short answer: 1..10 strings of 1..200 characters, none empty after normalising; every other
-- kind has none.
create or replace function public.meldy_answers_ok(p_answers text[], p_kind text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select case
    when p_answers is null or pg_catalog.array_ndims(p_answers) = 2 then false
    when p_kind = 'short' then
      pg_catalog.cardinality(p_answers) between 1 and 10
      and not exists (select 1 from pg_catalog.unnest(p_answers) a
                       where a is null or pg_catalog.char_length(a) not between 1 and 200
                          or public.meldy_short_norm(a) = '')
    else coalesce(pg_catalog.cardinality(p_answers), 0) = 0
  end
$fn$;

-- Topic titles of a subject: an array of at most 99 strings of at most 200 characters.
create or replace function public.meldy_topics_ok(p_topics jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select p_topics is not null and pg_catalog.jsonb_typeof(p_topics) = 'array'
     and pg_catalog.jsonb_array_length(p_topics) <= 99
     and not exists (select 1 from pg_catalog.jsonb_array_elements(p_topics) t
                      where pg_catalog.jsonb_typeof(t) is distinct from 'string'
                         or pg_catalog.char_length(t #>> '{}') > 200)
$fn$;

create or replace function public.meldy_flags_ok(p_flags text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select p_flags is not null and coalesce(pg_catalog.cardinality(p_flags), 0) <= 16
     and not exists (select 1 from pg_catalog.unnest(p_flags) f where f is null or f !~ '^[a-z_]{1,32}$')
$fn$;

-- 2. Tables.
-- 2a. The container: one exam session of one student (title, a common date).
create table if not exists public.containers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  exam_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint containers_title_check check (char_length(btrim(title)) between 1 and 200)
);
create index if not exists containers_owner_idx on public.containers (owner_id, created_at desc);

-- 2b. Subjects. exam_id = the ORAL part: one of the owner's public.exams rows (its questions, lectures, cheat sheet);
--     null = no oral part. exam_date overrides the container's date for the TEST part; the oral part keeps the
--     date of its exams row (that row stays the only owner of an oral date). topics = titles of topics 1..99.
create table if not exists public.container_subjects (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references public.containers(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  position smallint not null default 1,
  title text not null,
  exam_date date,
  exam_id uuid references public.exams(id) on delete set null,
  topics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint container_subjects_position_check check (position between 1 and 20),
  constraint container_subjects_title_check check (char_length(btrim(title)) between 1 and 200),
  constraint container_subjects_topics_check check (public.meldy_topics_ok(topics)),
  constraint container_subjects_exam_key unique (exam_id)
);
create index if not exists container_subjects_container_idx on public.container_subjects (container_id, position);
create index if not exists container_subjects_owner_idx on public.container_subjects (owner_id);

-- 2c. Test items: the questions with a key of a subject. Written only through container_items_add /
--     container_item_update (the 2000 limit, the rev rule); the owner may DELETE directly.
--     single / multiple: options in file order, correct = indices IN FILE ORDER ({} = no key yet: never offered in a
--     session), answers = {}. short (a typed answer, «Впишите…», GIFT {=…}): options [] and correct {}, answers = the
--     1..10 accepted forms of the file. keyed = has a key. rev grows when the key (correct, or the normalised set of
--     answers), the kind or the number of options changes — states of an older rev count as unseen.
create table if not exists public.test_items (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references public.containers(id) on delete cascade,
  subject_id uuid not null references public.container_subjects(id) on delete cascade,
  position integer not null,
  file_no text not null default '',
  topic smallint,
  kind text not null default 'single',
  stem text not null,
  options jsonb not null default '[]'::jsonb,
  correct smallint[] not null default '{}'::smallint[],
  answers text[] not null default '{}'::text[],
  key_source text not null default 'none',
  code boolean not null default false,
  keep_order boolean not null default false,
  flags text[] not null default '{}'::text[],
  import_ref text,
  rev integer not null default 1,
  keyed boolean generated always as (cardinality(correct) > 0 or cardinality(answers) > 0) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint test_items_position_check check (position between 1 and 2000),
  constraint test_items_file_no_check check (char_length(file_no) <= 16),
  constraint test_items_topic_check check (topic is null or topic between 1 and 99),
  constraint test_items_kind_check check (kind in ('single', 'multiple', 'short')),
  constraint test_items_stem_check check (char_length(btrim(stem)) between 1 and 4000),
  constraint test_items_options_check check (case when kind = 'short' then options = '[]'::jsonb
                                                  else public.meldy_options_ok(options) end),
  constraint test_items_correct_check check (public.meldy_key_ok(correct, jsonb_array_length(options), kind)),
  constraint test_items_answers_check check (public.meldy_answers_ok(answers, kind)),
  constraint test_items_key_source_check check (key_source in ('bold', 'underline', 'italic', 'color', 'highlight',
    'shade', 'marker', 'key_column', 'answer_line', 'key_list', 'key_text', 'gift', 'first_option', 'manual', 'none')),
  constraint test_items_flags_check check (public.meldy_flags_ok(flags)),
  constraint test_items_import_ref_check check (import_ref is null or import_ref ~ '^[A-Za-z0-9_:.-]{1,80}$'),
  constraint test_items_rev_check check (rev >= 1)
);
create index if not exists test_items_subject_idx on public.test_items (subject_id, position);
create index if not exists test_items_container_idx on public.test_items (container_id, subject_id, position);
create unique index if not exists test_items_import_ref_uidx on public.test_items (container_id, import_ref)
  where import_ref is not null;

-- 2d. Key changes: one row per rev bump (the author fixed a key). Members see «Автор исправил ключ в N вопросах»;
--     the numbers end an item's chain of answers at its key change.
create table if not exists public.test_item_key_changes (
  id bigint generated always as identity primary key,
  item_id uuid not null references public.test_items(id) on delete cascade,
  container_id uuid not null references public.containers(id) on delete cascade,
  rev integer not null,
  old_correct smallint[] not null,
  new_correct smallint[] not null,
  old_answers text[] not null default '{}'::text[],
  new_answers text[] not null default '{}'::text[],
  changed_at timestamptz not null default now()
);
create index if not exists test_item_key_changes_container_idx on public.test_item_key_changes (container_id, changed_at desc);
create index if not exists test_item_key_changes_item_idx on public.test_item_key_changes (item_id);

-- 2e. Per-user state of one item: the fields of the rule (spec §4). Written only by meldy_private.record_test_answers_for
--     (the site, the mock test, the bot) through meldy_private.rule_step. item_rev ≠ test_items.rev = unseen («stale»).
--     seen = counted answers (a retry is not counted); right = counted right answers; wrong = every miss, retries
--     included (spec §4); streak_* = the first clean right answer since the last miss; two_days_* = the answer that
--     met the rule; named_at = the latest clean right answer (checks count from it); checks = checks passed since
--     two_days_at; peek_day = the key was seen that local day; was_two_days = a miss once took it out of the figure;
--     clean_ok_at = the latest clean right answer (the final pass; unlike named_at it survives a miss);
--     last_result = the last answer that counted for the rule (a miss, or a clean right answer; training and
--     misclick leave it) — «ошибок сейчас» are the items whose last_result is wrong or «Не знаю».
create table if not exists public.test_item_states (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.test_items(id) on delete cascade,
  container_id uuid not null references public.containers(id) on delete cascade,
  subject_id uuid not null references public.container_subjects(id) on delete cascade,
  item_rev integer not null,
  seen integer not null default 0,
  right_count integer not null default 0,
  wrong_count integer not null default 0,
  first_seen_at timestamptz,
  first_seen_day date,
  last_answer_at timestamptz,
  last_answer_day date,
  last_result text,
  streak_at timestamptz,
  streak_day date,
  two_days_at timestamptz,
  two_days_day date,
  named_at timestamptz,
  checks smallint not null default 0,
  peek_day date,
  was_two_days boolean not null default false,
  clean_ok_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id),
  constraint test_item_states_counts_check check (seen >= 0 and right_count between 0 and seen
                                                  and wrong_count >= seen - right_count),
  constraint test_item_states_result_check check (last_result is null or last_result in ('right', 'wrong', 'dont_know')),
  constraint test_item_states_series_check check ((streak_at is null) = (streak_day is null)),
  constraint test_item_states_two_days_check check ((two_days_at is null) = (two_days_day is null)
                                                    and (two_days_at is null or (streak_at is not null and named_at is not null))),
  constraint test_item_states_checks_check check (checks >= 0 and (checks = 0 or two_days_at is not null))
);
create index if not exists test_item_states_container_idx on public.test_item_states (user_id, container_id);
create index if not exists test_item_states_item_idx on public.test_item_states (item_id);
create index if not exists test_item_states_subject_idx on public.test_item_states (subject_id);

-- 2f. The answer log: append-only, one row per answer, written only by the answer core (correctness computed from the
--     key here, never taken from the client). container_id / subject_id are plain ids: the log outlives a deleted
--     container for the numbers; item_id goes null with its item. step is the rule's verdict; two_days_before /
--     due_before / checks_before describe the item just before the answer (the numbers: «проверки через 5+ дней»);
--     cls is the plan class the client asked it under (the student's own pace), ms the time on the question.
create table if not exists public.test_answers (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id text not null,
  created_at timestamptz not null default now(),
  local_date date not null,
  container_id uuid not null,
  subject_id uuid not null,
  item_id uuid references public.test_items(id) on delete set null,
  item_rev integer not null,
  kind text not null default 'single',
  mode text not null default 'learn',
  source text not null default 'web',
  chosen smallint[] not null default '{}'::smallint[],
  answer_text text,
  shown_order smallint[],
  correct boolean not null,
  misclick boolean not null default false,
  retry boolean not null default false,
  step text not null,
  two_days_before boolean not null default false,
  due_before timestamptz,
  checks_before smallint not null default 0,
  cls text,
  ms integer,
  session_id uuid,
  constraint test_answers_client_event_check check (client_event_id ~ '^[A-Za-z0-9_:-]{8,120}$'),
  constraint test_answers_kind_check check (kind in ('single', 'multiple', 'short')),
  constraint test_answers_mode_check check (mode in ('learn', 'mock')),
  constraint test_answers_source_check check (source in ('web', 'bot', 'bot_group')),
  constraint test_answers_step_check check (step in ('miss', 'misclick', 'training', 'start', 'too_early', 'two_days',
                                                    'check', 'early', 'late')),
  constraint test_answers_text_check check (answer_text is null or char_length(answer_text) <= 1000),
  constraint test_answers_cls_check check (cls is null or cls in ('relearn', 'confirm', 'new_floor', 'confirm_ai',
                                                                  'start_ai', 'check', 'final', 'new_fill', 'free')),
  constraint test_answers_ms_check check (ms is null or ms between 0 and 600000),
  constraint test_answers_client_event_key unique (user_id, client_event_id)
);
create index if not exists test_answers_user_day_idx on public.test_answers (user_id, local_date);
create index if not exists test_answers_container_day_idx on public.test_answers (container_id, local_date);
create index if not exists test_answers_item_idx on public.test_answers (item_id, user_id, id);  -- FK on item delete; a user's chain of one item

-- 2g. «Сомневаюсь в ключе» / «Ключ неверный?»: one row per (item, user). Open (resolved_at null) = the item is aside in
--     THIS user's plan.
create table if not exists public.test_key_doubts (
  item_id uuid not null references public.test_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  container_id uuid not null references public.containers(id) on delete cascade,
  item_rev integer not null,
  proposed smallint[] not null default '{}'::smallint[],
  note text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text,
  primary key (item_id, user_id),
  constraint test_key_doubts_note_check check (char_length(note) <= 300),
  constraint test_key_doubts_resolution_check check (
    (resolved_at is null and resolution is null) or (resolved_at is not null and resolution in ('fixed', 'kept', 'withdrawn')))
);
create index if not exists test_key_doubts_container_idx on public.test_key_doubts (container_id) where resolved_at is null;

-- 2h. «Как на экзамене»: one row per finished run; its answers are in test_answers (mode 'mock', session_id = run id).
create table if not exists public.test_mock_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  container_id uuid not null,
  client_run_id text not null,
  local_date date not null,
  subject_ids uuid[] not null default '{}'::uuid[],
  items integer not null,
  correct integer not null,
  unanswered integer not null default 0,
  time_limit_s integer,
  duration_s integer,
  finished_at timestamptz not null default now(),
  constraint test_mock_runs_client_run_check check (client_run_id ~ '^[A-Za-z0-9_:-]{8,120}$'),
  constraint test_mock_runs_counts_check check (items between 1 and 200 and correct between 0 and items
                                                and unanswered between 0 and items),
  constraint test_mock_runs_client_run_key unique (user_id, client_run_id)
);
create index if not exists test_mock_runs_user_idx on public.test_mock_runs (user_id, container_id, finished_at desc);

-- 2i. Plan settings of one user in one container (a member has their own): minutes a day, days of the week.
create table if not exists public.container_plans (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  container_id uuid not null references public.containers(id) on delete cascade,
  minutes_per_day smallint not null default 60,
  study_weekdays smallint not null default 127,
  updated_at timestamptz not null default now(),
  primary key (user_id, container_id),
  constraint container_plans_minutes_check check (minutes_per_day between 10 and 300),
  constraint container_plans_weekdays_check check (study_weekdays between 1 and 127)
);
create index if not exists container_plans_container_idx on public.container_plans (container_id);

-- 2j. Group links of a container (only sha256 of the code). oral_salt derives the codes of the oral shares; it never
--     leaves the database (no column grant reaches a member).
create table if not exists public.container_links (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references public.containers(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  oral_salt text not null,
  consent text,
  oral_share_ids uuid[] not null default '{}'::uuid[],
  max_members integer not null default 60,
  members integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint container_links_code_hash_check check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint container_links_code_hash_key unique (code_hash),
  constraint container_links_salt_check check (oral_salt ~ '^[0-9a-f]{32}$'),
  constraint container_links_consent_check check (consent is null or char_length(consent) between 20 and 400),
  constraint container_links_max_members_check check (max_members between 1 and 200),
  constraint container_links_members_check check (members >= 0),
  constraint container_links_expires_check check (expires_at is null or expires_at > created_at)
);
create index if not exists container_links_container_idx on public.container_links (container_id, created_at desc);

-- 2k. Members (membership, not copies). left_at — the member left; removed_at — the author removed them.
create table if not exists public.container_members (
  container_id uuid not null references public.containers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  link_id uuid references public.container_links(id) on delete set null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  removed_at timestamptz,
  primary key (container_id, user_id)
);
create index if not exists container_members_user_idx on public.container_members (user_id);

-- 2l. A member's oral copy of an oral subject (made by the unchanged exam_share_join through a derived share).
create table if not exists public.container_member_exams (
  container_id uuid not null references public.containers(id) on delete cascade,
  subject_id uuid not null references public.container_subjects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  bound_at timestamptz not null default now(),
  primary key (subject_id, user_id),
  constraint container_member_exams_exam_key unique (exam_id)
);
create index if not exists container_member_exams_user_idx on public.container_member_exams (user_id, container_id);

-- 2m. Telegram: NOT here. The bot keeps its own schema `bot` (links, link codes, deliveries, groups, group posts and
--     answers; scratchpad/bot/tech-report.md §4). What this file leaves for it: bot.group_posts.item_id can reference
--     public.test_items(id); a linked member's answer goes through meldy_private.record_test_answers_for(...,
--     'bot_group') with a deterministic client_event_id; the bot's public.bot_* functions (SECURITY DEFINER, owned by
--     the migration role, service role only) call the *_for cores below with the user they resolve themselves.

-- 2n. Accounts left out of the numbers (team, agents' test accounts). Owner-only schema (20261005042323), not exposed.
create table if not exists analytics.excluded_accounts (
  user_id uuid primary key,
  reason text not null default 'team',
  added_at timestamptz not null default now()
);

-- 3. Triggers.
create or replace function public.containers_touch()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$fn$;
create or replace trigger containers_touch
  before update on public.containers
  for each row execute function public.containers_touch();

-- A container with active members is not deleted by a direct DELETE (one misclick would wipe the group's progress):
-- the author removes the members first (container_member_remove with p_user_id null). A cascade (the account is
-- deleted) runs one trigger level deeper and is not stopped.
create or replace function public.containers_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if pg_catalog.pg_trigger_depth() = 1 and exists (
       select 1 from public.container_members m
        where m.container_id = old.id and m.left_at is null and m.removed_at is null) then
    raise exception 'the container has members' using errcode = 'MC009';
  end if;
  return old;
end;
$fn$;
create or replace trigger containers_guard_delete
  before delete on public.containers
  for each row execute function public.containers_guard_delete();

-- At most 20 subjects; the subject's owner is the container's owner; an oral part is one of the owner's exams.
create or replace function public.container_subjects_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_owner uuid;
begin
  select c.owner_id into v_owner from public.containers c where c.id = new.container_id for update;
  if v_owner is null or v_owner is distinct from new.owner_id then
    raise exception 'not the container''s owner' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.container_id is distinct from old.container_id then
    raise exception 'a subject does not move to another container' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and (select pg_catalog.count(*) from public.container_subjects s
                            where s.container_id = new.container_id) >= 20 then
    raise exception 'at most 20 subjects' using errcode = 'MC007';
  end if;
  if new.exam_id is not null and (tg_op = 'INSERT' or new.exam_id is distinct from old.exam_id)
     and not exists (select 1 from public.exams e where e.id = new.exam_id and e.user_id = new.owner_id) then
    raise exception 'not the owner''s exam' using errcode = '42501';
  end if;
  return new;
end;
$fn$;
create or replace trigger container_subjects_guard
  before insert or update on public.container_subjects
  for each row execute function public.container_subjects_guard();

-- container_id follows the subject; rev grows only when the key (the set of correct indices, or the normalised set of
-- accepted short answers), the kind or the number of options changes — a typo fix in a stem, an option or the case /
-- spaces / ё of an accepted answer keeps everyone's progress; updated_at is the server's.
create or replace function public.test_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_container uuid;
begin
  select s.container_id into v_container from public.container_subjects s where s.id = new.subject_id;
  if v_container is null then
    raise exception 'no such subject' using errcode = 'P0002';
  end if;
  if tg_op = 'UPDATE' and v_container is distinct from old.container_id then
    raise exception 'an item does not move to another container' using errcode = '22023';
  end if;
  new.container_id := v_container;
  new.updated_at := pg_catalog.now();
  if tg_op = 'INSERT' then
    new.rev := 1;
  elsif new.kind is distinct from old.kind
        or pg_catalog.jsonb_array_length(new.options) <> pg_catalog.jsonb_array_length(old.options)
        or (select coalesce(pg_catalog.array_agg(k order by k), '{}'::smallint[]) from pg_catalog.unnest(new.correct) k)
           is distinct from
           (select coalesce(pg_catalog.array_agg(k order by k), '{}'::smallint[]) from pg_catalog.unnest(old.correct) k)
        or (select coalesce(pg_catalog.array_agg(distinct public.meldy_short_norm(a) order by public.meldy_short_norm(a)), '{}'::text[])
              from pg_catalog.unnest(new.answers) a)
           is distinct from
           (select coalesce(pg_catalog.array_agg(distinct public.meldy_short_norm(a) order by public.meldy_short_norm(a)), '{}'::text[])
              from pg_catalog.unnest(old.answers) a) then
    new.rev := old.rev + 1;
  else
    new.rev := old.rev;
  end if;
  return new;
end;
$fn$;
create or replace trigger test_items_guard
  before insert or update on public.test_items
  for each row execute function public.test_items_guard();

-- 4. Who may read a container: its owner and its active members. SECURITY DEFINER, so the policies below do not
--    recurse; it returns only the caller's own ids.
create or replace function public.my_container_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select c.id from public.containers c where c.owner_id = (select auth.uid())
  union
  select m.container_id from public.container_members m
   where m.user_id = (select auth.uid()) and m.left_at is null and m.removed_at is null
$fn$;

-- 5. Row level security. No policy for anon anywhere. Clients write only: containers, subjects (the owner),
--    container_plans (own); items are deleted by the owner; everything else goes through the functions below.
alter table public.containers enable row level security;
alter table public.container_subjects enable row level security;
alter table public.test_items enable row level security;
alter table public.test_item_key_changes enable row level security;
alter table public.test_item_states enable row level security;
alter table public.test_answers enable row level security;
alter table public.test_key_doubts enable row level security;
alter table public.test_mock_runs enable row level security;
alter table public.container_plans enable row level security;
alter table public.container_links enable row level security;
alter table public.container_members enable row level security;
alter table public.container_member_exams enable row level security;
alter table analytics.excluded_accounts enable row level security;

grant select, insert, update, delete on table public.containers to authenticated;
grant select, insert, update, delete on table public.container_subjects to authenticated;
grant select, delete on table public.test_items to authenticated;
grant select on table public.test_item_key_changes, public.test_item_states, public.test_answers,
  public.test_key_doubts, public.test_mock_runs, public.container_members, public.container_member_exams
  to authenticated;
grant select (id, container_id, owner_id, consent, max_members, members, created_at, expires_at, revoked_at)
  on table public.container_links to authenticated;
grant select, insert, update on table public.container_plans to authenticated;

do $do$
begin
  -- containers
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'containers'
                 and policyname = 'Containers: read own or joined') then
    -- The owner test is on the row itself: INSERT … RETURNING checks a row my_container_ids() cannot see yet.
    create policy "Containers: read own or joined" on public.containers for select to authenticated
      using ((select auth.uid()) = owner_id or id in (select public.my_container_ids()));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'containers'
                 and policyname = 'Containers: insert own') then
    create policy "Containers: insert own" on public.containers for insert to authenticated
      with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'containers'
                 and policyname = 'Containers: update own') then
    create policy "Containers: update own" on public.containers for update to authenticated
      using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'containers'
                 and policyname = 'Containers: delete own') then
    create policy "Containers: delete own" on public.containers for delete to authenticated
      using ((select auth.uid()) = owner_id);
  end if;
  -- subjects
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'container_subjects'
                 and policyname = 'Container subjects: read own or joined') then
    create policy "Container subjects: read own or joined" on public.container_subjects for select to authenticated
      using ((select auth.uid()) = owner_id or container_id in (select public.my_container_ids()));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'container_subjects'
                 and policyname = 'Container subjects: insert own') then
    create policy "Container subjects: insert own" on public.container_subjects for insert to authenticated
      with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'container_subjects'
                 and policyname = 'Container subjects: update own') then
    create policy "Container subjects: update own" on public.container_subjects for update to authenticated
      using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'container_subjects'
                 and policyname = 'Container subjects: delete own') then
    create policy "Container subjects: delete own" on public.container_subjects for delete to authenticated
      using ((select auth.uid()) = owner_id);
  end if;
  -- items
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'test_items'
                 and policyname = 'Test items: read own or joined') then
    create policy "Test items: read own or joined" on public.test_items for select to authenticated
      using (container_id in (select public.my_container_ids()));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'test_items'
                 and policyname = 'Test items: delete own') then
    create policy "Test items: delete own" on public.test_items for delete to authenticated
      using (exists (select 1 from public.containers c
                      where c.id = test_items.container_id and c.owner_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'test_item_key_changes'
                 and policyname = 'Key changes: read own or joined') then
    create policy "Key changes: read own or joined" on public.test_item_key_changes for select to authenticated
      using (container_id in (select public.my_container_ids()));
  end if;
  -- own rows only
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'test_item_states'
                 and policyname = 'Test states: read own') then
    create policy "Test states: read own" on public.test_item_states for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'test_answers'
                 and policyname = 'Test answers: read own') then
    create policy "Test answers: read own" on public.test_answers for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'test_key_doubts'
                 and policyname = 'Key doubts: read own') then
    create policy "Key doubts: read own" on public.test_key_doubts for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'test_mock_runs'
                 and policyname = 'Mock runs: read own') then
    create policy "Mock runs: read own" on public.test_mock_runs for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'container_members'
                 and policyname = 'Container members: read own') then
    create policy "Container members: read own" on public.container_members for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'container_member_exams'
                 and policyname = 'Member exams: read own') then
    create policy "Member exams: read own" on public.container_member_exams for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'container_links'
                 and policyname = 'Container links: read own') then
    create policy "Container links: read own" on public.container_links for select to authenticated
      using ((select auth.uid()) = owner_id);
  end if;
  -- plan settings: own rows of a readable container
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'container_plans'
                 and policyname = 'Container plans: read own') then
    create policy "Container plans: read own" on public.container_plans for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'container_plans'
                 and policyname = 'Container plans: insert own') then
    create policy "Container plans: insert own" on public.container_plans for insert to authenticated
      with check ((select auth.uid()) = user_id and container_id in (select public.my_container_ids()));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'container_plans'
                 and policyname = 'Container plans: update own') then
    create policy "Container plans: update own" on public.container_plans for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id and container_id in (select public.my_container_ids()));
  end if;
end
$do$;

-- 6. Internal: the caller's role in a container ('owner' | 'member' | null), and every container a user may read.
create or replace function meldy_private.role_in(p_user uuid, p_container uuid)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case
    when exists (select 1 from public.containers c where c.id = p_container and c.owner_id = p_user) then 'owner'
    when exists (select 1 from public.container_members m
                  where m.container_id = p_container and m.user_id = p_user
                    and m.left_at is null and m.removed_at is null) then 'member'
  end
$fn$;

create or replace function meldy_private.container_ids_of(p_user uuid)
returns setof uuid
language sql
stable
set search_path = ''
as $fn$
  select c.id from public.containers c where c.owner_id = p_user
  union
  select m.container_id from public.container_members m
   where m.user_id = p_user and m.left_at is null and m.removed_at is null
$fn$;

-- 7. The rule «верно в два разных дня» (spec §4; Concept 2 §2.2–2.9, the oral readiness.ts / cheatSheet.ts to the
--    letter). Pure functions: the answer core calls them with the server's clock, the rule vectors with fixed moments.
-- 7a. The moment a counted item's next check is due: named_at + 5 / 12 / 25 / 50 days for 0 / 1 / 2 / 3+ checks passed
--     (exact 24-hour days); when the answer's local day is 0..2 days before the subject's test date, at most named_at +
--     4 days (cheatSheet.ts dueMoment, the exam-eve rule). Hours only, so the session's TimeZone never matters.
create or replace function meldy_private.due_at(p_named_at timestamptz, p_checks integer, p_day date, p_exam_day date)
returns timestamptz
language sql
immutable
set search_path = ''
as $fn$
  select case when p_exam_day is not null and p_exam_day - p_day between 0 and 2
              then least(d.due, p_named_at + pg_catalog.make_interval(hours => 96))
              else d.due end
    from (select p_named_at + pg_catalog.make_interval(
                   hours => 24 * (array[5, 12, 25, 50])[least(greatest(coalesce(p_checks, 0), 0), 3) + 1])
                 as due) d
$fn$;

-- 7b. One answer through the rule: the previous state (null or another rev = from zero), the moment (server clock), the
--     local day, the result (right | wrong | dont_know, computed from the key), retry, misclick (a wrong option or «Не
--     знаю» the student marked «Нажали не туда?»), the item's current rev and the subject's test date. Returns the new state,
--     the step and what the numbers keep of the state before it. Steps:
--       late      the local day is older than the state's last answer day: the log keeps it, the state does not move;
--       misclick  a peek: counters unchanged, the series kept, peek_day = today (no counted answer today);
--       miss      wrong or «Не знаю», retries included: wrong+1; series, two days, named_at, checks cleared; peek_day;
--       training  right in a retry or on a peek day: nothing counts;
--       check     right, clean, in the figure, at ≥ due: checks+1, named_at = now;
--       early     right, clean, in the figure, before due: named_at = now, the same wait starts again;
--       start     right, clean, no series: streak = now;
--       two_days  right, clean, series, another local day and ≥ 20 h since the streak: two_days = now, checks = 0;
--       too_early right, clean, series, the rule not met yet: nothing that counts.
--     named_at and clean_ok_at take every clean right answer. A retry flag on a state never answered under this rev is
--     an ordinary answer (there is nothing to retry).
create or replace function meldy_private.rule_step(p_s public.test_item_states, p_rev integer, p_at timestamptz,
                                                   p_day date, p_result text, p_retry boolean, p_misclick boolean,
                                                   p_exam_day date,
                                                   out o_state public.test_item_states, out o_step text,
                                                   out o_two_days_before boolean, out o_due_before timestamptz,
                                                   out o_checks_before smallint)
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_retry boolean;
begin
  if p_rev is null or p_at is null or p_day is null or p_result is null or p_result not in ('right', 'wrong', 'dont_know') then
    raise exception 'rule_step: bad event' using errcode = '22023';
  end if;
  o_state := p_s;
  if o_state.item_rev is distinct from p_rev then
    -- Another rev of the item (the author changed the key): it starts again for this user.
    o_state.item_rev := p_rev;
    o_state.seen := 0;
    o_state.right_count := 0;
    o_state.wrong_count := 0;
    o_state.first_seen_at := null;
    o_state.first_seen_day := null;
    o_state.last_answer_at := null;
    o_state.last_answer_day := null;
    o_state.last_result := null;
    o_state.streak_at := null;
    o_state.streak_day := null;
    o_state.two_days_at := null;
    o_state.two_days_day := null;
    o_state.named_at := null;
    o_state.checks := 0;
    o_state.peek_day := null;
    o_state.was_two_days := false;
    o_state.clean_ok_at := null;
  end if;
  o_two_days_before := o_state.two_days_at is not null;
  o_checks_before := o_state.checks;
  o_due_before := case when o_two_days_before
                       then meldy_private.due_at(o_state.named_at, o_state.checks, p_day, p_exam_day) end;

  if o_state.last_answer_day is not null and p_day < o_state.last_answer_day then
    o_step := 'late';
    return;
  end if;
  o_state.updated_at := p_at;

  if coalesce(p_misclick, false) then
    o_step := 'misclick';
    o_state.peek_day := p_day;
    o_state.first_seen_at := coalesce(o_state.first_seen_at, p_at);
    o_state.first_seen_day := coalesce(o_state.first_seen_day, p_day);
    o_state.last_answer_at := p_at;
    o_state.last_answer_day := greatest(o_state.last_answer_day, p_day);
    return;
  end if;

  v_retry := coalesce(p_retry, false) and o_state.first_seen_day is not null;
  if not v_retry then
    o_state.seen := o_state.seen + 1;
    o_state.first_seen_at := coalesce(o_state.first_seen_at, p_at);
    o_state.first_seen_day := coalesce(o_state.first_seen_day, p_day);
    o_state.last_answer_at := p_at;
    o_state.last_answer_day := greatest(o_state.last_answer_day, p_day);
  end if;

  if p_result <> 'right' then
    o_step := 'miss';
    o_state.wrong_count := o_state.wrong_count + 1;
    o_state.last_result := p_result;
    o_state.was_two_days := o_state.was_two_days or o_state.two_days_at is not null;
    o_state.streak_at := null;
    o_state.streak_day := null;
    o_state.two_days_at := null;
    o_state.two_days_day := null;
    o_state.named_at := null;
    o_state.checks := 0;
    o_state.peek_day := p_day;
    return;
  end if;

  if not v_retry then
    o_state.right_count := o_state.right_count + 1;
  end if;
  if v_retry or o_state.peek_day = p_day then
    o_step := 'training';                       -- the key was seen today, or it is a retry: right, not from memory
    return;
  end if;

  o_state.last_result := 'right';
  o_state.clean_ok_at := p_at;
  if o_state.two_days_at is not null then
    if p_at >= o_due_before then
      o_step := 'check';
      o_state.checks := o_state.checks + 1;
    else
      o_step := 'early';                        -- before its moment: not a check, the same wait starts again
    end if;
  elsif o_state.streak_at is null then
    o_step := 'start';
    o_state.streak_at := p_at;
    o_state.streak_day := p_day;
  elsif p_day <> o_state.streak_day and p_at - o_state.streak_at >= pg_catalog.make_interval(hours => 20) then
    o_step := 'two_days';
    o_state.two_days_at := p_at;
    o_state.two_days_day := p_day;
    o_state.checks := 0;
  else
    o_step := 'too_early';                      -- the same local day, or under 20 hours: nothing counts yet
  end if;
  o_state.named_at := p_at;
end;
$fn$;

-- 7c. Grading one answer element against an item's key (the server's verdict; the client's own is never read).
--     single / multiple: chosen = an index or a set of indices IN FILE ORDER (any order, no repeats), JSON null = «Не
--     знаю» ([] too); multiple is all or nothing; shown_order (optional) = the permutation of file indices shown.
--     short: text = the typed answer (≤ 1000 characters, not empty after normalising), JSON null = «Не знаю»; right when
--     its normalised form equals a normalised accepted form. A missing chosen / text, a letter, an index out of range,
--     two indices on a single, a broken shown_order: not valid (status invalid, nothing recorded).
create or replace function meldy_private.grade_answer(p_kind text, p_options integer, p_key smallint[], p_answers text[],
                                                      p_a jsonb,
                                                      out o_valid boolean, out o_correct boolean, out o_result text,
                                                      out o_chosen smallint[], out o_text text, out o_order smallint[])
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v_type text;
  v_key smallint[];
begin
  o_valid := false;
  o_correct := false;
  o_chosen := '{}'::smallint[];
  if p_a is null or pg_catalog.jsonb_typeof(p_a) is distinct from 'object' then
    return;
  end if;
  if p_kind = 'short' then
    v_type := pg_catalog.jsonb_typeof(p_a -> 'text');
    if v_type = 'null' then
      o_result := 'dont_know';
    elsif v_type = 'string' and pg_catalog.char_length(p_a ->> 'text') <= 1000
          and public.meldy_short_norm(p_a ->> 'text') <> '' then
      o_text := p_a ->> 'text';
      o_correct := exists (select 1 from pg_catalog.unnest(p_answers) f
                            where public.meldy_short_norm(f) = public.meldy_short_norm(o_text));
      o_result := case when o_correct then 'right' else 'wrong' end;
    else
      return;
    end if;
    if pg_catalog.jsonb_typeof(p_a -> 'shown_order') is distinct from 'null' and p_a ? 'shown_order' then
      return;
    end if;
    o_valid := true;
    return;
  end if;

  v_type := pg_catalog.jsonb_typeof(p_a -> 'chosen');
  o_chosen := null;
  if v_type = 'null' then
    o_chosen := '{}'::smallint[];
  elsif v_type = 'number' then
    if (p_a ->> 'chosen') ~ '^[0-7]$' and (p_a ->> 'chosen')::integer < p_options then
      o_chosen := array[(p_a ->> 'chosen')::smallint];
    end if;
  elsif v_type = 'array'
        and pg_catalog.jsonb_array_length(p_a -> 'chosen') <= p_options
        and not exists (select 1 from pg_catalog.jsonb_array_elements(p_a -> 'chosen') x
                         where pg_catalog.jsonb_typeof(x) <> 'number' or (x #>> '{}') !~ '^[0-7]$'
                            or (x #>> '{}')::integer >= p_options)
        and (select pg_catalog.count(*) = pg_catalog.count(distinct x #>> '{}')
               from pg_catalog.jsonb_array_elements(p_a -> 'chosen') x) then
    select coalesce(pg_catalog.array_agg((x #>> '{}')::smallint order by (x #>> '{}')::integer), '{}'::smallint[])
      into o_chosen from pg_catalog.jsonb_array_elements(p_a -> 'chosen') x;
  end if;
  if o_chosen is null or (p_kind = 'single' and pg_catalog.cardinality(o_chosen) > 1) then
    o_chosen := '{}'::smallint[];
    return;
  end if;
  if pg_catalog.jsonb_typeof(p_a -> 'shown_order') = 'array' then
    if pg_catalog.jsonb_array_length(p_a -> 'shown_order') = p_options
       and (select pg_catalog.count(distinct x) filter (where x ~ '^[0-7]$' and x::integer < p_options)
              from pg_catalog.jsonb_array_elements_text(p_a -> 'shown_order') x) = p_options then
      select pg_catalog.array_agg(x::smallint order by o) into o_order
        from pg_catalog.jsonb_array_elements_text(p_a -> 'shown_order') with ordinality as s(x, o);
    else
      return;
    end if;
  elsif p_a ? 'shown_order' and pg_catalog.jsonb_typeof(p_a -> 'shown_order') <> 'null' then
    return;
  end if;
  select coalesce(pg_catalog.array_agg(k order by k), '{}'::smallint[]) into v_key from pg_catalog.unnest(p_key) k;
  o_correct := pg_catalog.cardinality(o_chosen) > 0 and o_chosen = v_key;
  o_result := case when pg_catalog.cardinality(o_chosen) = 0 then 'dont_know' when o_correct then 'right' else 'wrong' end;
  o_valid := true;
end;
$fn$;

-- 7d. The kind of an imported element: as given; else short when it has accepted answers and no options, multiple when
--     it has two keys or more, single otherwise.
create or replace function meldy_private.item_kind(p_x jsonb)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(p_x ->> 'kind',
           case when pg_catalog.jsonb_typeof(p_x -> 'answers') = 'array' and pg_catalog.jsonb_array_length(p_x -> 'answers') > 0
                     and coalesce(pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(p_x -> 'options') = 'array'
                                                                     then p_x -> 'options' end), 0) = 0 then 'short'
                when pg_catalog.jsonb_typeof(p_x -> 'correct') = 'array' and pg_catalog.jsonb_array_length(p_x -> 'correct') > 1
                  then 'multiple'
                else 'single' end)
$fn$;

-- 7e. A state as the client receives it (AnswerState of frontend/src/types/container.ts).
create or replace function meldy_private.state_json(p_s public.test_item_states)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'item_rev', p_s.item_rev, 'seen', p_s.seen, 'right', p_s.right_count, 'wrong', p_s.wrong_count,
    'last_result', p_s.last_result, 'first_seen_day', p_s.first_seen_day, 'last_answer_day', p_s.last_answer_day,
    'streak_at', p_s.streak_at, 'streak_day', p_s.streak_day, 'two_days_at', p_s.two_days_at,
    'two_days_day', p_s.two_days_day, 'named_at', p_s.named_at, 'checks', p_s.checks, 'peek_day', p_s.peek_day,
    'was_two_days', p_s.was_two_days, 'clean_ok_at', p_s.clean_ok_at)
$fn$;

-- 8. The answer core: 1..p_max answers of one user. Every element gets a status; only a malformed call raises.
--    status: saved | late (journal only: an older local day arrived after a newer one) | duplicate | conflict (the
--    client_event_id was used for another item) | gone (no such item the user may read) | no_key | stale (answered
--    an older rev of the item: not recorded, the item comes again) | invalid.
--    Element: {client_event_id, item_id, chosen?: index | [indices] | null («Не знаю»), text?: string | null (short),
--    rev?, shown_order?, mode?, retry?, misclick?, session_id?, local_date?, ms?, cls?}. Indices are IN FILE ORDER.
--    Results come back in the order of the elements. Lock order: items sorted by id, so two devices never deadlock;
--    the state row is created then locked, so a first answer from two devices is never a lost update.
create or replace function meldy_private.record_test_answers_for(p_user uuid, p_answers jsonb,
                                                                 p_source text default 'web', p_max integer default 50,
                                                                 p_mode text default null, p_session uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_cls constant text[] := array['relearn', 'confirm', 'new_floor', 'confirm_ai', 'start_ai', 'check', 'final',
                                 'new_fill', 'free'];
  v_now timestamptz := pg_catalog.now();
  v_out jsonb[];
  v_a jsonb;
  v_ord integer;
  v_id text;
  v_iid uuid;
  v_item public.test_items%rowtype;
  v_prev_item uuid;
  v_g record;
  v_r record;
  v_s public.test_item_states%rowtype;
  v_exam date;
  v_day date;
  v_mode text;
  v_retry boolean;
  v_misclick boolean;
  v_ms integer;
  v_cls text;
  v_session uuid;
  v_log bigint;
begin
  if p_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_source is null or p_source not in ('web', 'bot', 'bot_group')
     or (p_mode is not null and p_mode not in ('learn', 'mock')) then
    raise exception 'invalid source' using errcode = '22023';
  end if;
  if p_answers is null or pg_catalog.jsonb_typeof(p_answers) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_answers) not between 1 and coalesce(p_max, 50)
     or pg_catalog.octet_length(p_answers::text) > 524288 then
    raise exception 'invalid answers' using errcode = '22023';
  end if;
  v_out := pg_catalog.array_fill(null::jsonb, array[pg_catalog.jsonb_array_length(p_answers)]);

  for v_a, v_ord in
    select a.value, a.ord::integer
      from pg_catalog.jsonb_array_elements(p_answers) with ordinality as a(value, ord)
     order by (case when pg_catalog.jsonb_typeof(a.value) = 'object' then pg_catalog.lower(a.value ->> 'item_id') end), a.ord
  loop
    v_id := case when pg_catalog.jsonb_typeof(v_a) = 'object' then v_a ->> 'client_event_id' end;
    if v_id is null or v_id !~ '^[A-Za-z0-9_:-]{8,120}$' or coalesce(v_a ->> 'item_id', '') !~* c_uuid then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'status', 'invalid');
      continue;
    end if;
    v_iid := (v_a ->> 'item_id')::uuid;

    select t.item_id into v_prev_item from public.test_answers t where t.user_id = p_user and t.client_event_id = v_id;
    if found then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid,
        'status', case when v_prev_item is distinct from v_iid and v_prev_item is not null then 'conflict' else 'duplicate' end);
      continue;
    end if;

    select i.* into v_item from public.test_items i where i.id = v_iid;
    if not found or meldy_private.role_in(p_user, v_item.container_id) is null then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'gone');
      continue;
    end if;
    if not v_item.keyed then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'no_key');
      continue;
    end if;
    if pg_catalog.jsonb_typeof(v_a -> 'rev') = 'number' and (v_a ->> 'rev') is distinct from v_item.rev::text then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'stale',
                                                    'rev', v_item.rev);
      continue;
    end if;
    select * into v_g from meldy_private.grade_answer(v_item.kind, pg_catalog.jsonb_array_length(v_item.options),
                                                      v_item.correct, v_item.answers, v_a);
    if not v_g.o_valid then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'invalid');
      continue;
    end if;

    v_day := meldy_private.clamp_day(v_a ->> 'local_date');
    v_mode := coalesce(p_mode, case when v_a ->> 'mode' = 'mock' then 'mock' else 'learn' end);
    v_retry := v_mode = 'learn' and coalesce(v_a ->> 'retry', '') = 'true';
    -- «Нажали не туда?» under a wrong option or a «Не знаю» pressed by mistake (never under a right answer, never in a mock)
    v_misclick := v_mode = 'learn' and coalesce(v_a ->> 'misclick', '') = 'true' and v_g.o_result <> 'right';
    v_ms := case when coalesce(v_a ->> 'ms', '') ~ '^\d{1,7}$' then least((v_a ->> 'ms')::integer, 600000) end;
    v_cls := case when (v_a ->> 'cls') = any (c_cls) then v_a ->> 'cls' end;
    v_session := coalesce(p_session, case when coalesce(v_a ->> 'session_id', '') ~* c_uuid
                                          then (v_a ->> 'session_id')::uuid end);
    select coalesce(s.exam_date, c.exam_date) into v_exam
      from public.container_subjects s join public.containers c on c.id = s.container_id
     where s.id = v_item.subject_id;

    -- The state row exists before it is locked: a concurrent first answer waits here instead of being lost.
    insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev)
    values (p_user, v_iid, v_item.container_id, v_item.subject_id, v_item.rev)
    on conflict (user_id, item_id) do nothing;
    select s.* into v_s from public.test_item_states s where s.user_id = p_user and s.item_id = v_iid for update;
    v_s.container_id := v_item.container_id;
    v_s.subject_id := v_item.subject_id;
    select * into v_r from meldy_private.rule_step(v_s, v_item.rev, v_now, v_day, v_g.o_result, v_retry, v_misclick, v_exam);
    v_s := v_r.o_state;

    insert into public.test_answers (user_id, client_event_id, local_date, container_id, subject_id, item_id, item_rev,
                                     kind, mode, source, chosen, answer_text, shown_order, correct, misclick, retry, step,
                                     two_days_before, due_before, checks_before, cls, ms, session_id)
    values (p_user, v_id, v_day, v_item.container_id, v_item.subject_id, v_iid, v_item.rev, v_item.kind, v_mode,
            p_source, v_g.o_chosen, v_g.o_text, v_g.o_order, v_g.o_correct, v_misclick, v_retry, v_r.o_step,
            v_r.o_two_days_before, v_r.o_due_before, v_r.o_checks_before, v_cls, v_ms, v_session)
    on conflict (user_id, client_event_id) do nothing
    returning id into v_log;
    if v_log is null then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'duplicate');
      continue;
    end if;

    if v_r.o_step <> 'late' then
      update public.test_item_states s
         set container_id = v_s.container_id, subject_id = v_s.subject_id, item_rev = v_s.item_rev, seen = v_s.seen,
             right_count = v_s.right_count, wrong_count = v_s.wrong_count, first_seen_at = v_s.first_seen_at,
             first_seen_day = v_s.first_seen_day, last_answer_at = v_s.last_answer_at,
             last_answer_day = v_s.last_answer_day, last_result = v_s.last_result, streak_at = v_s.streak_at,
             streak_day = v_s.streak_day, two_days_at = v_s.two_days_at, two_days_day = v_s.two_days_day,
             named_at = v_s.named_at, checks = v_s.checks, peek_day = v_s.peek_day, was_two_days = v_s.was_two_days,
             clean_ok_at = v_s.clean_ok_at, updated_at = v_s.updated_at
       where s.user_id = p_user and s.item_id = v_iid;
    end if;

    v_out[v_ord] := pg_catalog.jsonb_build_object(
        'client_event_id', v_id, 'item_id', v_iid, 'status', case when v_r.o_step = 'late' then 'late' else 'saved' end,
        'correct', v_g.o_correct, 'step', v_r.o_step, 'rev', v_item.rev, 'state', meldy_private.state_json(v_s))
      || case when v_item.kind = 'short'
              then pg_catalog.jsonb_build_object('answers', pg_catalog.to_jsonb(v_item.answers))
              else pg_catalog.jsonb_build_object('key', (select pg_catalog.to_jsonb(coalesce(pg_catalog.array_agg(k order by k),
                                                                                         '{}'::smallint[]))
                                                            from pg_catalog.unnest(v_item.correct) k)) end;
  end loop;
  return pg_catalog.jsonb_build_object('v', 1, 'server_day', (v_now at time zone 'utc')::date,
                                       'results', pg_catalog.to_jsonb(v_out));
end;
$fn$;

-- 8a. The site: up to 50 answers of the signed-in user (a session, or the offline queue in order).
create or replace function public.record_test_answers(p_answers jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return meldy_private.record_test_answers_for((select auth.uid()), p_answers, 'web', 50);
end;
$fn$;

-- 8b. A finished «Как на экзамене»: up to 200 answers recorded as mode 'mock' (same rule «верно в два разных дня»), one
--     run row with the score computed here. Idempotent by client_run_id. Unanswered (chosen / text null) counts as wrong.
create or replace function public.container_mock_finish(p_run jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_container uuid;
  v_run public.test_mock_runs%rowtype;
  v_id uuid := pg_catalog.gen_random_uuid();
  v_day date;
  v_answers jsonb;
  v_res jsonb;
  v_items integer;
  v_correct integer;
  v_unanswered integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_run is null or pg_catalog.jsonb_typeof(p_run) <> 'object'
     or coalesce(p_run ->> 'client_run_id', '') !~ '^[A-Za-z0-9_:-]{8,120}$'
     or coalesce(p_run ->> 'container_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or pg_catalog.jsonb_typeof(p_run -> 'answers') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_run -> 'answers') not between 1 and 200 then
    raise exception 'invalid run' using errcode = '22023';
  end if;
  v_container := (p_run ->> 'container_id')::uuid;
  if meldy_private.role_in(v_user, v_container) is null then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  select r.* into v_run from public.test_mock_runs r where r.user_id = v_user and r.client_run_id = p_run ->> 'client_run_id';
  if not found and exists (
       select 1 from public.test_items i
        where i.id = any (array(select (a ->> 'item_id')::uuid from pg_catalog.jsonb_array_elements(p_run -> 'answers') a
                                 where pg_catalog.jsonb_typeof(a) = 'object'
                                   and coalesce(a ->> 'item_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
          and i.container_id <> v_container) then
    raise exception 'an answer of another container in the run' using errcode = '22023';
  end if;
  if found then
    return pg_catalog.jsonb_build_object('run_id', v_run.id, 'items', v_run.items, 'correct', v_run.correct,
                                         'unanswered', v_run.unanswered, 'duplicate', true);
  end if;
  v_day := meldy_private.clamp_day(p_run ->> 'local_date');
  select pg_catalog.jsonb_agg(case when pg_catalog.jsonb_typeof(a.value) = 'object'
                                   then a.value || pg_catalog.jsonb_build_object('local_date', p_run ->> 'local_date')
                                   else a.value end
                              order by a.ord)
    into v_answers
    from pg_catalog.jsonb_array_elements(p_run -> 'answers') with ordinality as a(value, ord);
  v_res := meldy_private.record_test_answers_for(v_user, v_answers, 'web', 200, 'mock', v_id);
  select pg_catalog.count(*) filter (where r ->> 'status' in ('saved', 'late', 'duplicate')),
         pg_catalog.count(*) filter (where r ->> 'status' in ('saved', 'late') and (r ->> 'correct')::boolean)
    into v_items, v_correct
    from pg_catalog.jsonb_array_elements(v_res -> 'results') r;
  select pg_catalog.count(*) into v_unanswered
    from pg_catalog.jsonb_array_elements(p_run -> 'answers') a
   where pg_catalog.jsonb_typeof(a) = 'object'
     and coalesce(pg_catalog.jsonb_typeof(a -> 'chosen'), 'null') = 'null'
     and coalesce(pg_catalog.jsonb_typeof(a -> 'text'), 'null') = 'null'
     and (a ? 'chosen' or a ? 'text');
  if v_items = 0 then
    raise exception 'no answer of the run could be recorded' using errcode = '22023';
  end if;
  insert into public.test_mock_runs (id, user_id, container_id, client_run_id, local_date, subject_ids, items, correct,
                                     unanswered, time_limit_s, duration_s)
  values (v_id, v_user, v_container, p_run ->> 'client_run_id', v_day,
          coalesce(array(select x::uuid from pg_catalog.jsonb_array_elements_text(
                     case when pg_catalog.jsonb_typeof(p_run -> 'subject_ids') = 'array' then p_run -> 'subject_ids'
                          else '[]'::jsonb end) x
                   where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' limit 20), '{}'::uuid[]),
          v_items, v_correct, least(v_unanswered, v_items),
          case when coalesce(p_run ->> 'time_limit_s', '') ~ '^\d{1,5}$' then (p_run ->> 'time_limit_s')::integer end,
          case when coalesce(p_run ->> 'duration_s', '') ~ '^\d{1,5}$' then (p_run ->> 'duration_s')::integer end);
  return pg_catalog.jsonb_build_object('run_id', v_id, 'items', v_items, 'correct', v_correct,
                                       'unanswered', least(v_unanswered, v_items), 'duplicate', false,
                                       'results', v_res -> 'results');
end;
$fn$;

-- 9. Writing a container.
-- 9a. A container with its subjects in one call (INVOKER: the owner's own rows under RLS).
--     p_subjects: [{title, exam_date?, exam_id? (an own oral exam; also: an old exam becomes subject 1), topics?: [titles]}],
--     1..20.
create or replace function public.container_create(p_title text, p_exam_date date, p_subjects jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_subjects is null or pg_catalog.jsonb_typeof(p_subjects) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_subjects) not between 1 and 20
     or exists (select 1 from pg_catalog.jsonb_array_elements(p_subjects) s
                 where pg_catalog.jsonb_typeof(s) is distinct from 'object') then
    raise exception 'invalid subjects' using errcode = '22023';
  end if;
  begin
    insert into public.containers (owner_id, title, exam_date)
    values (v_user, pg_catalog.btrim(coalesce(p_title, '')), p_exam_date)
    returning id into v_id;
    insert into public.container_subjects (container_id, owner_id, position, title, exam_date, exam_id, topics)
    select v_id, v_user, x.ord::smallint, pg_catalog.btrim(coalesce(x.s ->> 'title', '')),
           case when coalesce(x.s ->> 'exam_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (x.s ->> 'exam_date')::date end,
           case when coalesce(x.s ->> 'exam_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                then (x.s ->> 'exam_id')::uuid end,
           case when pg_catalog.jsonb_typeof(x.s -> 'topics') = 'array' then x.s -> 'topics' else '[]'::jsonb end
      from pg_catalog.jsonb_array_elements(p_subjects) with ordinality as x(s, ord);
  exception
    when unique_violation then
      raise exception 'that exam is already a subject of an exam container' using errcode = '22023';
    when check_violation or not_null_violation or datetime_field_overflow or invalid_datetime_format then
      raise exception 'invalid container' using errcode = '22023', detail = sqlerrm;
  end;
  select pg_catalog.jsonb_build_object('container_id', v_id, 'subjects',
           pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.id, 'position', s.position, 'title', s.title)
                                order by s.position))
    into v_out
    from public.container_subjects s where s.container_id = v_id;
  return v_out;
end;
$fn$;

-- 9b. One more subject at the end (INVOKER, the owner): {title, exam_date?, exam_id?, topics?}; at most 20 (MC007).
create or replace function public.container_subject_add(p_container_id uuid, p_subject jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_pos integer;
  v_row public.container_subjects%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_subject is null or pg_catalog.jsonb_typeof(p_subject) is distinct from 'object' then
    raise exception 'invalid subject' using errcode = '22023';
  end if;
  -- One writer at a time per container (the guard trigger counts under the same lock).
  perform 1 from public.containers c where c.id = p_container_id and c.owner_id = v_user for update;
  if not found then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  select least(coalesce(pg_catalog.max(s.position), 0) + 1, 20) into v_pos
    from public.container_subjects s where s.container_id = p_container_id;
  begin
    insert into public.container_subjects (container_id, owner_id, position, title, exam_date, exam_id, topics)
    values (p_container_id, v_user, v_pos, pg_catalog.btrim(coalesce(p_subject ->> 'title', '')),
            case when coalesce(p_subject ->> 'exam_date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (p_subject ->> 'exam_date')::date end,
            case when coalesce(p_subject ->> 'exam_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 then (p_subject ->> 'exam_id')::uuid end,
            case when pg_catalog.jsonb_typeof(p_subject -> 'topics') = 'array' then p_subject -> 'topics' else '[]'::jsonb end)
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'that exam is already a subject of an exam container' using errcode = '22023';
    when check_violation or not_null_violation or datetime_field_overflow or invalid_datetime_format then
      raise exception 'invalid subject' using errcode = '22023', detail = sqlerrm;
  end;
  return pg_catalog.jsonb_build_object('id', v_row.id, 'position', v_row.position, 'title', v_row.title);
end;
$fn$;

-- 9c. Items of one subject, 1..300 per call, at most 2000 per container. Elements: {ref, stem, kind?, options[],
--     correct[] (file order), answers[] (short), file_no?, topic?, key_source?, code?, keep_order?, flags?}. kind
--     defaults to short when answers are given without options, multiple for two keys or more, else single. ref
--     ("<import id>:<n>", unique in the container) makes a resent batch insert nothing twice. A bad element refuses the
--     whole call (22023, the detail names it): the importer checks the same rules first.
create or replace function public.container_items_add(p_subject_id uuid, p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_container uuid;
  v_have integer;
  v_new integer;
  v_pos integer;
  v_bad text;
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select s.container_id into v_container
    from public.container_subjects s join public.containers c on c.id = s.container_id
   where s.id = p_subject_id and c.owner_id = v_user;
  if v_container is null then
    raise exception 'subject not found' using errcode = 'P0002';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_items) not between 1 and 300
     or pg_catalog.octet_length(p_items::text) > 1048576 then
    raise exception 'invalid items' using errcode = '22023';
  end if;

  -- The first element that breaks a rule, with its number (1-based) and the rule.
  with e as (
    select x.ord, x.x,
           case when pg_catalog.jsonb_typeof(x.x) = 'object' then meldy_private.item_kind(x.x) end as kind
      from pg_catalog.jsonb_array_elements(p_items) with ordinality as x(x, ord)
  )
  select pg_catalog.format('item %s: %s', y.ord, y.why) into v_bad
    from (
      select e.ord,
             case
               when pg_catalog.jsonb_typeof(e.x) <> 'object' then 'not an object'
               when coalesce(e.x ->> 'ref', '') !~ '^[A-Za-z0-9_:.-]{1,80}$' then 'ref'
               when (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_items) o
                      where o ->> 'ref' = e.x ->> 'ref') > 1 then 'ref repeated'
               when pg_catalog.jsonb_typeof(e.x -> 'stem') is distinct from 'string'
                    or pg_catalog.char_length(pg_catalog.btrim(e.x ->> 'stem')) not between 1 and 4000 then 'stem'
               when e.kind is null or e.kind not in ('single', 'multiple', 'short') then 'kind'
               when e.kind = 'short' and coalesce(pg_catalog.jsonb_typeof(e.x -> 'options'), 'null') <> 'null'
                    and e.x -> 'options' <> '[]'::jsonb then 'options'
               when e.kind = 'short' and coalesce(pg_catalog.jsonb_typeof(e.x -> 'correct'), 'null') <> 'null'
                    and e.x -> 'correct' <> '[]'::jsonb then 'correct'
               when e.kind = 'short' and (pg_catalog.jsonb_typeof(e.x -> 'answers') is distinct from 'array'
                    or exists (select 1 from pg_catalog.jsonb_array_elements(e.x -> 'answers') a
                                where pg_catalog.jsonb_typeof(a) <> 'string')
                    or not public.meldy_answers_ok(array(select pg_catalog.btrim(a)
                                                          from pg_catalog.jsonb_array_elements_text(e.x -> 'answers') a),
                                                    'short')) then 'answers'
               when e.kind <> 'short' and not public.meldy_options_ok(e.x -> 'options') then 'options'
               when e.kind <> 'short' and (pg_catalog.jsonb_typeof(e.x -> 'correct') is distinct from 'array'
                    or exists (select 1 from pg_catalog.jsonb_array_elements(e.x -> 'correct') k
                                where pg_catalog.jsonb_typeof(k) <> 'number' or (k #>> '{}') !~ '^[0-7]$')) then 'correct'
               when e.kind <> 'short' and not public.meldy_key_ok(array(select (k #>> '{}')::smallint
                                                                        from pg_catalog.jsonb_array_elements(e.x -> 'correct') k),
                                                                  pg_catalog.jsonb_array_length(e.x -> 'options'), e.kind) then 'correct'
               when e.kind <> 'short' and coalesce(pg_catalog.jsonb_typeof(e.x -> 'answers'), 'null') <> 'null'
                    and e.x -> 'answers' <> '[]'::jsonb then 'answers'
               when e.x ? 'topic' and pg_catalog.jsonb_typeof(e.x -> 'topic') <> 'null'
                    and coalesce(e.x ->> 'topic', '') !~ '^([1-9]|[1-9][0-9])$' then 'topic'
               when coalesce(pg_catalog.jsonb_typeof(e.x -> 'file_no'), 'null') not in ('null', 'string', 'number')
                    or pg_catalog.char_length(coalesce(e.x ->> 'file_no', '')) > 16 then 'file_no'
               when coalesce(e.x ->> 'key_source', 'none') not in ('bold', 'underline', 'italic', 'color', 'highlight',
                    'shade', 'marker', 'key_column', 'answer_line', 'key_list', 'key_text', 'gift', 'first_option',
                    'manual', 'none') then 'key_source'
               when coalesce(pg_catalog.jsonb_typeof(e.x -> 'code'), 'null') not in ('null', 'boolean') then 'code'
               when coalesce(pg_catalog.jsonb_typeof(e.x -> 'keep_order'), 'null') not in ('null', 'boolean') then 'keep_order'
               when coalesce(pg_catalog.jsonb_typeof(e.x -> 'flags'), 'null') not in ('null', 'array')
                    or (pg_catalog.jsonb_typeof(e.x -> 'flags') = 'array'
                        and (exists (select 1 from pg_catalog.jsonb_array_elements(e.x -> 'flags') f
                                      where pg_catalog.jsonb_typeof(f) <> 'string')
                             or not public.meldy_flags_ok(array(select pg_catalog.jsonb_array_elements_text(e.x -> 'flags'))))) then 'flags'
             end as why
        from e
    ) y
   where y.why is not null
   order by y.ord
   limit 1;
  if v_bad is not null then
    raise exception 'invalid item' using errcode = '22023', detail = v_bad;
  end if;

  -- One writer per container at a time: the count below holds until commit.
  perform 1 from public.containers c where c.id = v_container for update;
  select pg_catalog.count(*) into v_have from public.test_items i where i.container_id = v_container;
  select pg_catalog.count(*) into v_new
    from pg_catalog.jsonb_array_elements(p_items) e(x)
   where not exists (select 1 from public.test_items i
                      where i.container_id = v_container and i.import_ref = e.x ->> 'ref');
  if v_have + v_new > 2000 then
    raise exception 'at most 2000 items in a container' using errcode = 'MC007',
      detail = pg_catalog.format('%s in the container, %s more do not fit', v_have, v_new);
  end if;
  select coalesce(pg_catalog.max(i.position), 0) into v_pos from public.test_items i where i.subject_id = p_subject_id;
  if v_pos + v_new > 2000 then
    raise exception 'at most 2000 items in a subject' using errcode = 'MC007';
  end if;

  insert into public.test_items (container_id, subject_id, position, file_no, topic, kind, stem, options, correct, answers,
                                 key_source, code, keep_order, flags, import_ref)
  select v_container, p_subject_id, v_pos + (pg_catalog.row_number() over (order by n.ord))::integer,
         coalesce(n.x ->> 'file_no', ''),
         case when coalesce(n.x ->> 'topic', '') ~ '^\d+$' then (n.x ->> 'topic')::smallint end,
         n.kind, n.x ->> 'stem',
         case when n.kind = 'short' then '[]'::jsonb else n.x -> 'options' end,
         case when n.kind = 'short' then '{}'::smallint[]
              else array(select (k #>> '{}')::smallint from pg_catalog.jsonb_array_elements(n.x -> 'correct') k) end,
         case when n.kind = 'short'
              then array(select pg_catalog.btrim(a) from pg_catalog.jsonb_array_elements_text(n.x -> 'answers') a)
              else '{}'::text[] end,
         coalesce(n.x ->> 'key_source',
                  case when n.kind = 'short' or pg_catalog.jsonb_array_length(n.x -> 'correct') > 0 then 'manual' else 'none' end),
         coalesce((n.x ->> 'code')::boolean, false), coalesce((n.x ->> 'keep_order')::boolean, false),
         case when pg_catalog.jsonb_typeof(n.x -> 'flags') = 'array'
              then array(select pg_catalog.jsonb_array_elements_text(n.x -> 'flags')) else '{}'::text[] end,
         n.x ->> 'ref'
    from (select x.ord, x.x, meldy_private.item_kind(x.x) as kind
            from pg_catalog.jsonb_array_elements(p_items) with ordinality as x(x, ord)
           where not exists (select 1 from public.test_items i
                              where i.container_id = v_container and i.import_ref = x.x ->> 'ref')) n
  on conflict (container_id, import_ref) where import_ref is not null do nothing;

  select pg_catalog.jsonb_build_object('subject_id', p_subject_id, 'added', v_new, 'in_container', v_have + v_new,
           'items', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('ref', i.import_ref, 'id', i.id,
                                                                                 'position', i.position)
                                                  order by i.position), '[]'::jsonb))
    into v_out
    from public.test_items i
   where i.container_id = v_container
     and i.import_ref in (select e.x ->> 'ref' from pg_catalog.jsonb_array_elements(p_items) e(x));
  return v_out;
end;
$fn$;

-- 9d. The owner edits an item (a key fix, a typo). A change of the key (correct; for short the normalised set of
--     answers), the kind or the option count raises rev (the trigger): every member's state of this item starts again,
--     the change is logged for «Автор исправил ключ», and the open doubts about it are resolved as fixed. A text-only
--     edit keeps everyone's progress. Patch keys: stem, options, correct, answers, kind, file_no, topic, key_source, code,
--     keep_order.
create or replace function public.container_item_update(p_item_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_old public.test_items%rowtype;
  v_new public.test_items%rowtype;
  v_resolved integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid patch' using errcode = '22023';
  end if;
  select i.* into v_old from public.test_items i
    join public.containers c on c.id = i.container_id
   where i.id = p_item_id and c.owner_id = v_user
     for update of i;
  if not found then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  if (p_patch ? 'correct' and (pg_catalog.jsonb_typeof(p_patch -> 'correct') <> 'array'
        or exists (select 1 from pg_catalog.jsonb_array_elements(p_patch -> 'correct') k
                    where pg_catalog.jsonb_typeof(k) <> 'number' or (k #>> '{}') !~ '^[0-7]$')))
     or (p_patch ? 'answers' and (pg_catalog.jsonb_typeof(p_patch -> 'answers') <> 'array'
        or exists (select 1 from pg_catalog.jsonb_array_elements(p_patch -> 'answers') a
                    where pg_catalog.jsonb_typeof(a) <> 'string')))
     or (p_patch ? 'options' and pg_catalog.jsonb_typeof(p_patch -> 'options') <> 'array')
     or (p_patch ? 'stem' and pg_catalog.jsonb_typeof(p_patch -> 'stem') <> 'string')
     or (p_patch ? 'kind' and pg_catalog.jsonb_typeof(p_patch -> 'kind') <> 'string')
     or (p_patch ? 'file_no' and pg_catalog.jsonb_typeof(p_patch -> 'file_no') not in ('string', 'number'))
     or (p_patch ? 'key_source' and pg_catalog.jsonb_typeof(p_patch -> 'key_source') <> 'string')
     or (p_patch ? 'code' and pg_catalog.jsonb_typeof(p_patch -> 'code') <> 'boolean')
     or (p_patch ? 'keep_order' and pg_catalog.jsonb_typeof(p_patch -> 'keep_order') <> 'boolean')
     or (p_patch ? 'topic' and pg_catalog.jsonb_typeof(p_patch -> 'topic') <> 'null'
         and coalesce(p_patch ->> 'topic', '') !~ '^([1-9]|[1-9][0-9])$') then
    raise exception 'invalid patch' using errcode = '22023';
  end if;
  begin
    update public.test_items i set
      stem = case when p_patch ? 'stem' then p_patch ->> 'stem' else i.stem end,
      options = case when p_patch ? 'options' then p_patch -> 'options' else i.options end,
      correct = case when p_patch ? 'correct'
                     then array(select (k #>> '{}')::smallint from pg_catalog.jsonb_array_elements(p_patch -> 'correct') k)
                     else i.correct end,
      answers = case when p_patch ? 'answers'
                     then array(select pg_catalog.btrim(a) from pg_catalog.jsonb_array_elements_text(p_patch -> 'answers') a)
                     else i.answers end,
      kind = coalesce(p_patch ->> 'kind', i.kind),
      topic = case when p_patch ? 'topic' then (p_patch ->> 'topic')::smallint else i.topic end,
      file_no = coalesce(p_patch ->> 'file_no', i.file_no),
      keep_order = coalesce((p_patch ->> 'keep_order')::boolean, i.keep_order),
      code = coalesce((p_patch ->> 'code')::boolean, i.code),
      key_source = case when p_patch ? 'key_source' then p_patch ->> 'key_source'
                        when p_patch ? 'correct' or p_patch ? 'answers' then 'manual' else i.key_source end
     where i.id = p_item_id
    returning i.* into v_new;
  exception
    when check_violation or not_null_violation then
      raise exception 'invalid patch' using errcode = '22023', detail = sqlerrm;
  end;
  if v_new.rev <> v_old.rev then
    insert into public.test_item_key_changes (item_id, container_id, rev, old_correct, new_correct, old_answers, new_answers)
    values (v_new.id, v_new.container_id, v_new.rev, v_old.correct, v_new.correct, v_old.answers, v_new.answers);
    update public.test_key_doubts d set resolved_at = pg_catalog.now(), resolution = 'fixed'
     where d.item_id = p_item_id and d.resolved_at is null;
    get diagnostics v_resolved = row_count;
  end if;
  return pg_catalog.jsonb_build_object('id', v_new.id, 'rev', v_new.rev, 'rev_changed', v_new.rev <> v_old.rev,
                                       'doubts_resolved', v_resolved);
end;
$fn$;

-- 10. «Сомневаюсь в ключе» (a member, and the author too: spec decision 37) / «Ключ неверный?» (the author fixes it):
--     the item leaves this user's plan until the doubt is withdrawn or the author decides. proposed = option indices in
--     file order (none for short). The _for cores take the user (the site passes auth.uid(), the bot the user it
--     resolved itself).
create or replace function meldy_private.test_key_doubt_for(p_user uuid, p_item_id uuid, p_proposed jsonb default '[]'::jsonb,
                                                            p_note text default '')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_item public.test_items%rowtype;
  v_proposed smallint[];
begin
  if p_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select i.* into v_item from public.test_items i where i.id = p_item_id;
  if not found or meldy_private.role_in(p_user, v_item.container_id) is null then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  select coalesce(pg_catalog.array_agg(distinct (k #>> '{}')::smallint), '{}'::smallint[]) into v_proposed
    from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_proposed) = 'array' then p_proposed
                                               else '[]'::jsonb end) k
   where pg_catalog.jsonb_typeof(k) = 'number' and (k #>> '{}') ~ '^[0-7]$'
     and (k #>> '{}')::integer < pg_catalog.jsonb_array_length(v_item.options);
  insert into public.test_key_doubts (item_id, user_id, container_id, item_rev, proposed, note)
  values (p_item_id, p_user, v_item.container_id, v_item.rev, v_proposed,
          pg_catalog.left(pg_catalog.btrim(coalesce(p_note, '')), 300))
  on conflict (item_id, user_id) do update
     set item_rev = excluded.item_rev, proposed = excluded.proposed, note = excluded.note,
         created_at = pg_catalog.now(), resolved_at = null, resolution = null;
  return pg_catalog.jsonb_build_object('item_id', p_item_id, 'open', true);
end;
$fn$;

create or replace function meldy_private.test_key_doubt_withdraw_for(p_user uuid, p_item_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if p_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.test_key_doubts d set resolved_at = pg_catalog.now(), resolution = 'withdrawn'
   where d.item_id = p_item_id and d.user_id = p_user and d.resolved_at is null;
  return pg_catalog.jsonb_build_object('item_id', p_item_id, 'open', false);
end;
$fn$;

create or replace function public.test_key_doubt(p_item_id uuid, p_proposed jsonb default '[]'::jsonb, p_note text default '')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return meldy_private.test_key_doubt_for((select auth.uid()), p_item_id, p_proposed, p_note);
end;
$fn$;

create or replace function public.test_key_doubt_withdraw(p_item_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  return meldy_private.test_key_doubt_withdraw_for((select auth.uid()), p_item_id);
end;
$fn$;

-- The author's list: items with open doubts (counts and proposed options, no names) and items where at least 3
-- people answered for the first time and more than half chose the same wrong option (short answers: doubts only). No
-- teacher, no verdict.
create or replace function public.container_doubts(p_container_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.containers c where c.id = p_container_id and c.owner_id = v_user) then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  with doubts as (
    select d.item_id, pg_catalog.count(*) as open,
           pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d.proposed)) filter (where pg_catalog.cardinality(d.proposed) > 0) as proposed,
           pg_catalog.jsonb_agg(d.note) filter (where d.note <> '') as notes
      from public.test_key_doubts d
     where d.container_id = p_container_id and d.resolved_at is null
     group by d.item_id
  ),
  firsts as (
    select distinct on (a.user_id, a.item_id) a.item_id, a.chosen, a.correct
      from public.test_answers a
      join public.test_items i on i.id = a.item_id and i.rev = a.item_rev
     where a.container_id = p_container_id and not a.misclick and a.step <> 'late'
     order by a.user_id, a.item_id, a.id
  ),
  wrong as (
    select f.item_id, f.chosen, pg_catalog.count(*) as n,
           pg_catalog.row_number() over (partition by f.item_id order by pg_catalog.count(*) desc, f.chosen) as rk
      from firsts f
     where not f.correct and pg_catalog.cardinality(f.chosen) > 0
     group by f.item_id, f.chosen
  ),
  signals as (
    select f.item_id, pg_catalog.count(*) as people,
           (select pg_catalog.to_jsonb(w.chosen) from wrong w where w.item_id = f.item_id and w.rk = 1) as top_wrong,
           (select w.n from wrong w where w.item_id = f.item_id and w.rk = 1) as top_wrong_n
      from firsts f
     group by f.item_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'item_id', i.id, 'subject_id', i.subject_id, 'position', i.position, 'file_no', i.file_no,
           'correct', pg_catalog.to_jsonb(i.correct), 'doubts', coalesce(d.open, 0), 'proposed', d.proposed,
           'notes', d.notes, 'first_answers', coalesce(s.people, 0), 'top_wrong', s.top_wrong,
           'top_wrong_n', s.top_wrong_n)
           order by coalesce(d.open, 0) desc, s.top_wrong_n desc nulls last, i.position), '[]'::jsonb)
    into v_out
    from public.test_items i
    left join doubts d on d.item_id = i.id
    left join signals s on s.item_id = i.id
   where i.container_id = p_container_id
     and (d.item_id is not null or (s.people >= 3 and s.top_wrong_n * 2 > s.people));
  return v_out;
end;
$fn$;

create or replace function public.container_doubt_keep(p_item_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.test_items i join public.containers c on c.id = i.container_id
                  where i.id = p_item_id and c.owner_id = auth.uid()) then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  update public.test_key_doubts d set resolved_at = pg_catalog.now(), resolution = 'kept'
   where d.item_id = p_item_id and d.resolved_at is null;
  get diagnostics v_n = row_count;
  return pg_catalog.jsonb_build_object('item_id', p_item_id, 'resolved', v_n);
end;
$fn$;

-- 11. Reads. Facts only (counts of what happened); what is due today, the new quota and the minutes are the pure TS
--     plan's (lib/containers/plan.ts), computed from plan_inputs — the same code on «Сегодня» and in the bot.
-- 11a. Facts per subject for one user. Items without a key are counted apart and never planned; a state of an older
--      rev is «stale» (the author changed that key) and counts as unseen.
create or replace function meldy_private.subject_facts_for(p_user uuid, p_containers uuid[], p_day date)
returns table (subject_id uuid, keyed integer, no_key integer, seen integer, two_days integer, open_errors integer,
               seen_today integer, doubted integer, stale integer, updated_at timestamptz)
language sql
stable
set search_path = ''
as $fn$
  select i.subject_id,
         (pg_catalog.count(*) filter (where i.keyed))::integer,
         (pg_catalog.count(*) filter (where not i.keyed))::integer,
         (pg_catalog.count(*) filter (where i.keyed and st.item_rev = i.rev and st.first_seen_day is not null))::integer,
         (pg_catalog.count(*) filter (where i.keyed and st.item_rev = i.rev and st.two_days_at is not null))::integer,
         (pg_catalog.count(*) filter (where i.keyed and st.item_rev = i.rev and st.last_result in ('wrong', 'dont_know')
                                       and d.item_id is null))::integer,
         (pg_catalog.count(*) filter (where i.keyed and st.item_rev = i.rev and st.first_seen_day = p_day))::integer,
         (pg_catalog.count(*) filter (where i.keyed and d.item_id is not null))::integer,
         (pg_catalog.count(*) filter (where st.item_rev < i.rev))::integer,
         pg_catalog.max(i.updated_at)
    from public.test_items i
    left join public.test_item_states st on st.user_id = p_user and st.item_id = i.id
    left join public.test_key_doubts d on d.item_id = i.id and d.user_id = p_user and d.resolved_at is null
   where i.container_id = any (p_containers)
   group by i.subject_id
$fn$;

-- The first day of a user's plan in a container: the owner's day of creating it, a member's day of joining (the server
-- does not know the device's zone: the day is taken in Europe/Minsk, the product's zone, and never after p_day).
create or replace function meldy_private.first_plan_day(p_user uuid, p_container uuid, p_day date)
returns date
language sql
stable
set search_path = ''
as $fn$
  select least(coalesce(
           (select (c.created_at at time zone 'Europe/Minsk')::date from public.containers c
             where c.id = p_container and c.owner_id = p_user),
           (select (m.joined_at at time zone 'Europe/Minsk')::date from public.container_members m
             where m.container_id = p_container and m.user_id = p_user),
           p_day), p_day)
$fn$;

-- 11b. Every container of the user (own and joined) with its subjects and facts: «Экзамены», the header of the
--      container page, the bot's reminder text. attached_exam_ids = the user's oral exams that live inside a
--      container (the author's oral parts, a member's copies): «Экзамены» and «Сегодня» show them inside it.
create or replace function meldy_private.containers_overview_for(p_user uuid, p_day date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_ids uuid[];
  v_out jsonb;
begin
  select coalesce(pg_catalog.array_agg(x.id), '{}'::uuid[]) into v_ids
    from meldy_private.container_ids_of(p_user) as x(id);
  with facts as (select * from meldy_private.subject_facts_for(p_user, v_ids, p_day)),
  subjects as (
    select s.container_id, pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', s.id, 'position', s.position, 'title', s.title,
             'exam_date', coalesce(s.exam_date, c.exam_date),
             'oral_exam_id', case when c.owner_id = p_user then s.exam_id else me.exam_id end,
             'has_oral', s.exam_id is not null,
             'keyed', coalesce(f.keyed, 0), 'no_key', coalesce(f.no_key, 0), 'seen', coalesce(f.seen, 0),
             'two_days', coalesce(f.two_days, 0), 'open_errors', coalesce(f.open_errors, 0),
             'seen_today', coalesce(f.seen_today, 0), 'doubted', coalesce(f.doubted, 0), 'stale', coalesce(f.stale, 0))
             order by s.position, s.created_at) as list,
           pg_catalog.max(f.updated_at) as items_updated_at,
           pg_catalog.sum(coalesce(f.keyed, 0) + coalesce(f.no_key, 0)) as items
      from public.container_subjects s
      join public.containers c on c.id = s.container_id
      left join facts f on f.subject_id = s.id
      left join public.container_member_exams me on me.subject_id = s.id and me.user_id = p_user
     where s.container_id = any (v_ids)
     group by s.container_id
  )
  select pg_catalog.jsonb_build_object(
           'v', 1, 'day', p_day,
           'containers', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'id', c.id, 'title', c.title, 'exam_date', c.exam_date, 'created_at', c.created_at,
              'role', case when c.owner_id = p_user then 'owner' else 'member' end,
              'items', coalesce(sj.items, 0), 'items_updated_at', sj.items_updated_at,
              'subjects', coalesce(sj.list, '[]'::jsonb),
              'answers_today', (select pg_catalog.count(*) from public.test_answers a
                                 where a.user_id = p_user and a.container_id = c.id and a.local_date = p_day),
              'settings', (select pg_catalog.jsonb_build_object('minutes_per_day', p.minutes_per_day,
                                                                'study_weekdays', p.study_weekdays)
                             from public.container_plans p where p.user_id = p_user and p.container_id = c.id))
              order by c.exam_date nulls last, c.created_at desc), '[]'::jsonb),
           'attached_exam_ids', coalesce((
              select pg_catalog.jsonb_agg(x.exam_id order by x.exam_id) from (
                select s.exam_id from public.container_subjects s
                 where s.owner_id = p_user and s.exam_id is not null
                union
                select me.exam_id from public.container_member_exams me where me.user_id = p_user) x), '[]'::jsonb))
    into v_out
    from public.containers c
    left join subjects sj on sj.container_id = c.id
   where c.id = any (v_ids);
  return v_out;
end;
$fn$;

-- 11c. One container in full: subjects with topics and kinds, the user's settings, first plan day and mock runs; for the
--      author the members, links and open doubts. key_changes_unseen = items whose key the author changed after this
--      user's last answer to them (they start again).
create or replace function meldy_private.container_summary_for(p_user uuid, p_container_id uuid, p_day date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_role text := meldy_private.role_in(p_user, p_container_id);
  v_c public.containers%rowtype;
  v_out jsonb;
begin
  if v_role is null then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  select c.* into v_c from public.containers c where c.id = p_container_id;
  with facts as (select * from meldy_private.subject_facts_for(p_user, array[p_container_id], p_day)),
  item_view as (
    select i.subject_id, i.topic, i.kind, i.keyed,
           (st.item_rev = i.rev and st.first_seen_day is not null) as seen,
           (st.item_rev = i.rev and st.two_days_at is not null) as two_days,
           (st.item_rev = i.rev and st.last_result in ('wrong', 'dont_know') and d.item_id is null) as open_error
      from public.test_items i
      left join public.test_item_states st on st.user_id = p_user and st.item_id = i.id
      left join public.test_key_doubts d on d.item_id = i.id and d.user_id = p_user and d.resolved_at is null
     where i.container_id = p_container_id
  ),
  topics as (
    select v.subject_id, pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'topic', v.topic, 'keyed', v.keyed_n, 'seen', v.seen_n, 'two_days', v.two_days_n,
             'open_errors', v.errors_n) order by v.topic) as list
      from (select subject_id, topic,
                   pg_catalog.count(*) filter (where keyed) as keyed_n,
                   pg_catalog.count(*) filter (where keyed and seen) as seen_n,
                   pg_catalog.count(*) filter (where keyed and two_days) as two_days_n,
                   pg_catalog.count(*) filter (where keyed and open_error) as errors_n
              from item_view where topic is not null
             group by subject_id, topic) v
     group by v.subject_id
  ),
  kinds as (
    select subject_id,
           pg_catalog.count(*) filter (where keyed and kind = 'single') as single_n,
           pg_catalog.count(*) filter (where keyed and kind = 'multiple') as multiple_n,
           pg_catalog.count(*) filter (where keyed and kind = 'short') as short_n
      from item_view group by subject_id
  )
  select pg_catalog.jsonb_build_object(
    'v', 1, 'day', p_day, 'id', v_c.id, 'title', v_c.title, 'exam_date', v_c.exam_date, 'role', v_role,
    'created_at', v_c.created_at,
    'first_plan_day', meldy_private.first_plan_day(p_user, p_container_id, p_day),
    'settings', coalesce((select pg_catalog.jsonb_build_object('minutes_per_day', p.minutes_per_day,
                                                               'study_weekdays', p.study_weekdays)
                            from public.container_plans p where p.user_id = p_user and p.container_id = p_container_id),
                         '{"minutes_per_day": 60, "study_weekdays": 127}'::jsonb),
    'subjects', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', s.id, 'position', s.position, 'title', s.title,
               'exam_date', coalesce(s.exam_date, v_c.exam_date), 'topic_titles', s.topics,
               'oral', case
                 when v_role = 'owner' and s.exam_id is not null then pg_catalog.jsonb_build_object(
                   'exam_id', s.exam_id,
                   'questions', (select pg_catalog.count(*) from public.exam_questions q where q.exam_id = s.exam_id))
                 when v_role = 'member' and s.exam_id is not null then pg_catalog.jsonb_build_object(
                   'exam_id', me.exam_id,
                   'questions', (select pg_catalog.count(*) from public.exam_questions q where q.exam_id = me.exam_id)) end,
               'keyed', coalesce(f.keyed, 0), 'no_key', coalesce(f.no_key, 0), 'seen', coalesce(f.seen, 0),
               'two_days', coalesce(f.two_days, 0), 'open_errors', coalesce(f.open_errors, 0),
               'seen_today', coalesce(f.seen_today, 0), 'doubted', coalesce(f.doubted, 0), 'stale', coalesce(f.stale, 0),
               'topics', coalesce(t.list, '[]'::jsonb),
               'kinds', pg_catalog.jsonb_build_object('single', coalesce(k.single_n, 0), 'multiple', coalesce(k.multiple_n, 0),
                                                      'short', coalesce(k.short_n, 0)))
               order by s.position, s.created_at)
        from public.container_subjects s
        left join facts f on f.subject_id = s.id
        left join topics t on t.subject_id = s.id
        left join kinds k on k.subject_id = s.id
        left join public.container_member_exams me on me.subject_id = s.id and me.user_id = p_user
       where s.container_id = p_container_id), '[]'::jsonb),
    'items_version', (select pg_catalog.jsonb_build_object('count', pg_catalog.count(*), 'updated_at', pg_catalog.max(i.updated_at))
                        from public.test_items i where i.container_id = p_container_id),
    'answers_today', (select pg_catalog.count(*) from public.test_answers a
                       where a.user_id = p_user and a.container_id = p_container_id and a.local_date = p_day),
    'key_changes_unseen', (select pg_catalog.count(*) from public.test_item_states st
                             join public.test_items i on i.id = st.item_id
                            where st.user_id = p_user and st.container_id = p_container_id and st.item_rev < i.rev),
    'mock_runs', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                             'id', r.id, 'local_date', r.local_date, 'subject_ids', pg_catalog.to_jsonb(r.subject_ids),
                             'items', r.items, 'correct', r.correct)
                             order by r.finished_at desc)
                             from (select * from public.test_mock_runs r
                                    where r.user_id = p_user and r.container_id = p_container_id
                                    order by r.finished_at desc limit 5) r), '[]'::jsonb),
    'owner', case when v_role = 'owner' then pg_catalog.jsonb_build_object(
       'members', (select pg_catalog.count(*) from public.container_members m
                    where m.container_id = p_container_id and m.left_at is null and m.removed_at is null),
       'doubts_open', (select pg_catalog.count(distinct d.item_id) from public.test_key_doubts d
                        where d.container_id = p_container_id and d.resolved_at is null),
       'links', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                            'id', l.id, 'created_at', l.created_at, 'expires_at', l.expires_at, 'revoked_at', l.revoked_at,
                            'members', l.members, 'max_members', l.max_members, 'oral', pg_catalog.cardinality(l.oral_share_ids))
                            order by l.created_at desc)
                            from public.container_links l where l.container_id = p_container_id), '[]'::jsonb)) end)
    into v_out;
  return v_out;
end;
$fn$;

-- 11d. Everything the pure TS plan needs for one user and one day, as one jsonb (no 1000-row cap): containers with
--      settings, their first plan day and today's start; subjects with test dates, the number of topics (titles, or the
--      highest topic number of their items) and today's new items; keyed items
--      (not set aside by this user's doubt) and their current-rev states as compact tuples; the student's own pace;
--      today's AI units. Day fields are offsets from p_day (0 = today, -1 = yesterday); moments are epoch seconds
--      (state moments rounded up, so the client never offers an item a moment before the server would count it).
--      p_container_id narrows it to one container (the container page, a session); null = all («Сегодня», the bot).
--      items:  [id, subject index, topic, position, kind 0 single | 1 multiple | 2 short, rev, slow 0 | 1 (code or multiple)]
--      states: [item index, seen, wrong, first_seen_day, last_answer_day, last_result 0 right | 1 wrong | 2 «Не знаю»,
--               streak_day, streak_at, two_days_at, named_at, checks, peek_day, was_two_days 0 | 1, clean_ok_at]
--      doubted: always [] — doubted items are left out of items (the plan never offers them; their count is in the
--               facts of containers_overview / container_summary).
--      pace: per subject index and plan class (cls of the answer, none = 'free'), the last ≤ 200 learn answers with a
--            time (not retries, not «Нажали не туда?», not the mock): n, the median of ms capped at 180 s, the share wrong.
--      ai: {left, resets_at} = today's AI units left (UTC day, as consume_ai_units counts them) and the next reset;
--          null when the quota tables are not there. Read only: no quota function is called or changed.
create or replace function meldy_private.plan_inputs_for(p_user uuid, p_day date, p_container_id uuid default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_ids uuid[];
  v_now timestamptz := pg_catalog.now();
  v_ai jsonb;
  v_out jsonb;
begin
  select coalesce(pg_catalog.array_agg(c.id order by c.exam_date nulls last, c.created_at desc, c.id), '{}'::uuid[])
    into v_ids
    from public.containers c
   where c.id in (select x.id from meldy_private.container_ids_of(p_user) as x(id))
     and (p_container_id is null or c.id = p_container_id);
  if p_container_id is not null and pg_catalog.cardinality(v_ids) = 0 then
    raise exception 'container not found' using errcode = 'P0002';
  end if;

  -- Today's AI units, read the way ai_quota_status() reads them (20261004205613): the UTC day's ai_usage rows,
  -- the limit of public.ai_daily_limit(profiles.is_pro).
  if pg_catalog.to_regclass('public.ai_usage') is not null and pg_catalog.to_regclass('public.profiles') is not null
     and pg_catalog.to_regprocedure('public.ai_daily_limit(boolean)') is not null
     and exists (select 1 from pg_catalog.pg_attribute a
                  where a.attrelid = pg_catalog.to_regclass('public.profiles') and a.attname = 'is_pro' and not a.attisdropped) then
    execute $q$
      select pg_catalog.jsonb_build_object(
               'left', greatest(public.ai_daily_limit(coalesce((select p.is_pro from public.profiles p where p.id = $1), false))
                                           - coalesce((select pg_catalog.sum(greatest(coalesce(u.requests_count, 0), 0))
                                                         from public.ai_usage u
                                                        where u.user_id = $1 and u.date = ($2 at time zone 'utc')::date), 0), 0),
               'resets_at', extract(epoch from ((($2 at time zone 'utc')::date + 1)::timestamp at time zone 'utc'))::bigint)
    $q$ into v_ai using p_user, v_now;
  end if;

  with cs as (
    select c.*, (pg_catalog.array_position(v_ids, c.id) - 1) as ci from public.containers c where c.id = any (v_ids)
  ),
  ss as (
    select s.*, cs.ci, coalesce(s.exam_date, cs.exam_date) as test_date,
           (pg_catalog.row_number() over (order by cs.ci, s.position, s.created_at, s.id) - 1) as si
      from public.container_subjects s join cs on cs.id = s.container_id
  ),
  it as (
    select i.*, ss.si, (pg_catalog.row_number() over (order by ss.si, i.position, i.id) - 1) as ii
      from public.test_items i join ss on ss.id = i.subject_id
     where i.keyed
       and not exists (select 1 from public.test_key_doubts d
                        where d.item_id = i.id and d.user_id = p_user and d.resolved_at is null)
  ),
  today as (
    select a.container_id, pg_catalog.min(a.created_at) as first_at,
           pg_catalog.sum(least(coalesce(a.ms, 0), 180000)) filter (where a.mode = 'learn') as learn_ms
      from public.test_answers a
     where a.user_id = p_user and a.container_id = any (v_ids) and a.local_date = p_day
     group by a.container_id
  ),
  mocks as (
    select r.container_id, pg_catalog.sum(least(coalesce(r.duration_s, 0), 10800)) as mock_s
      from public.test_mock_runs r
     where r.user_id = p_user and r.container_id = any (v_ids) and r.local_date = p_day
     group by r.container_id
  ),
  pace as (
    select ss.si, x.cls, pg_catalog.count(*) as n,
           pg_catalog.round(pg_catalog.percentile_cont(0.5) within group (order by least(x.ms, 180000)))::integer as median_ms,
           pg_catalog.round(pg_catalog.avg(case when x.correct then 0 else 1 end), 4) as p_wrong
      from (select a.subject_id, coalesce(a.cls, 'free') as cls, a.ms, a.correct,
                   pg_catalog.row_number() over (partition by a.subject_id, coalesce(a.cls, 'free') order by a.id desc) as rn
              from public.test_answers a
             where a.user_id = p_user and a.container_id = any (v_ids) and a.mode = 'learn'
               and not a.retry and not a.misclick and a.ms is not null) x
      join ss on ss.id = x.subject_id
     where x.rn <= 200
     group by ss.si, x.cls
  )
  select pg_catalog.jsonb_build_object(
    'v', 1, 'day', p_day, 'now', pg_catalog.floor(extract(epoch from v_now))::bigint,
    'containers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', cs.id, 'title', cs.title, 'exam_date', cs.exam_date,
        'role', case when cs.owner_id = p_user then 'owner' else 'member' end,
        'first_plan_day', meldy_private.first_plan_day(p_user, cs.id, p_day),
        'answers_today', (select pg_catalog.count(*) from public.test_answers a
                           where a.user_id = p_user and a.container_id = cs.id and a.local_date = p_day),
        'settings', coalesce((select pg_catalog.jsonb_build_object('minutes_per_day', p.minutes_per_day,
                                                                   'study_weekdays', p.study_weekdays)
                                from public.container_plans p where p.user_id = p_user and p.container_id = cs.id),
                             '{"minutes_per_day": 60, "study_weekdays": 127}'::jsonb),
        'today', pg_catalog.jsonb_build_object(
                   'first_at', (select pg_catalog.floor(extract(epoch from t.first_at))::bigint
                                  from today t where t.container_id = cs.id),
                   'done_s', coalesce((select pg_catalog.round(coalesce(t.learn_ms, 0) / 1000.0)::bigint
                                         from today t where t.container_id = cs.id), 0)
                             + coalesce((select m.mock_s from mocks m where m.container_id = cs.id), 0)))
        order by cs.ci) from cs), '[]'::jsonb),
    'subjects', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', ss.id, 'container', ss.ci, 'title', ss.title, 'test_date', ss.test_date,
        'oral_exam_id', case when ss.owner_id = p_user then ss.exam_id
                             else (select me.exam_id from public.container_member_exams me
                                    where me.subject_id = ss.id and me.user_id = p_user) end,
        'topics', greatest(pg_catalog.jsonb_array_length(ss.topics),
                           coalesce((select pg_catalog.max(i.topic) from public.test_items i where i.subject_id = ss.id), 0)),
        'new_today', (select pg_catalog.count(*) from public.test_item_states st
                        join public.test_items i on i.id = st.item_id and i.rev = st.item_rev and i.keyed
                       where st.user_id = p_user and st.subject_id = ss.id and st.first_seen_day = p_day))
        order by ss.si) from ss), '[]'::jsonb),
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        it.id, it.si, it.topic, it.position,
        case it.kind when 'multiple' then 1 when 'short' then 2 else 0 end, it.rev,
        case when it.code or it.kind = 'multiple' then 1 else 0 end) order by it.ii)
        from it), '[]'::jsonb),
    'states', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        it.ii, st.seen, st.wrong_count, st.first_seen_day - p_day, st.last_answer_day - p_day,
        case st.last_result when 'right' then 0 when 'wrong' then 1 when 'dont_know' then 2 end,
        st.streak_day - p_day,
        pg_catalog.ceil(extract(epoch from st.streak_at))::bigint,
        pg_catalog.ceil(extract(epoch from st.two_days_at))::bigint,
        pg_catalog.ceil(extract(epoch from st.named_at))::bigint,
        st.checks, st.peek_day - p_day, case when st.was_two_days then 1 else 0 end,
        pg_catalog.ceil(extract(epoch from st.clean_ok_at))::bigint) order by it.ii)
        from it join public.test_item_states st on st.user_id = p_user and st.item_id = it.id and st.item_rev = it.rev),
        '[]'::jsonb),
    'doubted', '[]'::jsonb,
    'pace', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'subject', pace.si, 'cls', pace.cls, 'n', pace.n, 'median_ms', pace.median_ms, 'p_wrong', pace.p_wrong)
        order by pace.si, pace.cls) from pace), '[]'::jsonb),
    'ai', v_ai)
    into v_out;
  return v_out;
end;
$fn$;

-- 11e. Public wrappers: the signed-in user, the local day kept within a day of the server's.
create or replace function public.containers_overview(p_local_date text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return meldy_private.containers_overview_for(auth.uid(), meldy_private.clamp_day(p_local_date));
end;
$fn$;

create or replace function public.container_summary(p_container_id uuid, p_local_date text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return meldy_private.container_summary_for(auth.uid(), p_container_id, meldy_private.clamp_day(p_local_date));
end;
$fn$;

create or replace function public.plan_inputs(p_local_date text default null, p_container_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return meldy_private.plan_inputs_for(auth.uid(), meldy_private.clamp_day(p_local_date), p_container_id);
end;
$fn$;

-- Days with test answers («Профиль» дни подряд, «Прогресс» по дням): one row per day, at most two years back, so a
-- response never nears 1000 rows.
create or replace function public.test_answer_days(p_since date)
returns table (local_date date, answers integer)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select a.local_date, pg_catalog.count(*)::integer
    from public.test_answers a
   where a.user_id = (select auth.uid())
     and a.local_date >= greatest(p_since, (pg_catalog.now() at time zone 'utc')::date - 730)
   group by a.local_date
   order by a.local_date
$fn$;

-- 12. The group link: membership for the test parts, copies for the oral parts.
-- 12a. Internal: make the derived oral shares of a link for the container's current oral subjects (the author's own
--      exams that are not themselves copies), the way «Пригласить группу» would; returns the link's share ids.
create or replace function meldy_private.ensure_oral_shares(p_link_id uuid)
returns uuid[]
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_link public.container_links%rowtype;
  v_subject record;
  v_share uuid;
  v_ids uuid[];
begin
  select l.* into v_link from public.container_links l where l.id = p_link_id for update;
  if not found or v_link.consent is null then
    return coalesce(v_link.oral_share_ids, '{}'::uuid[]);
  end if;
  v_ids := v_link.oral_share_ids;
  for v_subject in
    select s.exam_id from public.container_subjects s
      join public.exams e on e.id = s.exam_id and e.user_id = v_link.owner_id
     where s.container_id = v_link.container_id and s.exam_id is not null
       and not exists (select 1 from public.exam_share_members m where m.member_exam_id = s.exam_id)
  loop
    select sh.id into v_share from public.exam_shares sh
     where sh.code_hash = meldy_private.code_hash(meldy_private.oral_code(v_link.oral_salt, v_subject.exam_id));
    if v_share is null then
      insert into public.exam_shares (exam_id, owner_id, code_hash, consent, max_members, expires_at, revoked_at)
      values (v_subject.exam_id, v_link.owner_id,
              meldy_private.code_hash(meldy_private.oral_code(v_link.oral_salt, v_subject.exam_id)),
              v_link.consent, v_link.max_members,
              case when v_link.expires_at > pg_catalog.now() then v_link.expires_at end, v_link.revoked_at)
      returning id into v_share;
    end if;
    if not v_share = any (v_ids) then
      v_ids := v_ids || v_share;
    end if;
    v_share := null;
  end loop;
  update public.container_links set oral_share_ids = v_ids where id = p_link_id;
  return v_ids;
end;
$fn$;

-- 12b. The author makes a link; the code comes back once (only its sha256 is kept). Oral subjects need the consent
--      of the oral link (their lecture texts and answer points go into the copies); test-only containers need none.
--      Default expiry: two days after the latest date of the container, else 120 days.
create or replace function public.container_link_create(p_container_id uuid, p_max_members integer default 60,
                                                        p_consent text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_c public.containers%rowtype;
  v_code text := meldy_private.random_code();
  v_link uuid;
  v_oral integer;
  v_last date;
  v_shares uuid[];
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select c.* into v_c from public.containers c where c.id = p_container_id and c.owner_id = v_user for update;
  if not found then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  if (select pg_catalog.count(*) from public.container_links l
       where l.container_id = p_container_id and l.revoked_at is null
         and (l.expires_at is null or l.expires_at > pg_catalog.now())) >= 10 then
    raise exception 'at most 10 open links' using errcode = 'MC007';
  end if;
  if not exists (select 1 from public.test_items i where i.container_id = p_container_id and i.keyed)
     and not exists (select 1 from public.container_subjects s where s.container_id = p_container_id and s.exam_id is not null) then
    raise exception 'nothing to share yet' using errcode = '22023';
  end if;
  select pg_catalog.count(*) into v_oral
    from public.container_subjects s
   where s.container_id = p_container_id and s.exam_id is not null
     and not exists (select 1 from public.exam_share_members m where m.member_exam_id = s.exam_id);
  if v_oral > 0 and (p_consent is null or pg_catalog.char_length(pg_catalog.btrim(p_consent)) not between 20 and 400) then
    raise exception 'the oral subjects need the consent' using errcode = 'MC008';
  end if;
  select pg_catalog.max(d) into v_last
    from (select v_c.exam_date as d union all
          select s.exam_date from public.container_subjects s where s.container_id = p_container_id) x;
  insert into public.container_links (container_id, owner_id, code_hash, oral_salt, consent, max_members, expires_at)
  values (p_container_id, v_user, meldy_private.code_hash(v_code),
          pg_catalog.md5(meldy_private.random_code() || pg_catalog.clock_timestamp()::text || pg_catalog.gen_random_uuid()::text),
          case when v_oral > 0 then pg_catalog.btrim(p_consent) end,
          least(greatest(coalesce(p_max_members, 60), 1), 200),
          case when v_last is not null and v_last + 2 > (pg_catalog.now() at time zone 'utc')::date
               then ((v_last + 2)::timestamp at time zone 'utc')
               else pg_catalog.now() + interval '120 days' end)
  returning id into v_link;
  v_shares := meldy_private.ensure_oral_shares(v_link);
  return pg_catalog.jsonb_build_object('link_id', v_link, 'code', v_code, 'path', '/g/' || v_code,
    'oral_subjects', pg_catalog.cardinality(v_shares),
    'expires_at', (select l.expires_at from public.container_links l where l.id = v_link));
end;
$fn$;

-- 12c. The author closes a link: no new members and no new oral copies through it. Members stay members.
create or replace function public.container_link_revoke(p_link_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_link public.container_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.container_links l set revoked_at = coalesce(l.revoked_at, pg_catalog.now())
   where l.id = p_link_id and l.owner_id = auth.uid()
  returning l.* into v_link;
  if not found then
    raise exception 'no such link' using errcode = 'MC001';
  end if;
  update public.exam_shares sh set revoked_at = coalesce(sh.revoked_at, v_link.revoked_at)
   where sh.id = any (v_link.oral_share_ids) and sh.owner_id = v_link.owner_id;
  return pg_catalog.jsonb_build_object('id', p_link_id, 'revoked_at', v_link.revoked_at);
end;
$fn$;

-- 12d. The invitation page /g/<code>, signed out too: the status and, for a live link, the title, the date, what is
--      inside (subjects with counts) and whether oral subjects come with it (needs_consent_text: the page shows what the
--      author shares). No items, no keys, no names.
create or replace function public.container_link_preview(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_link public.container_links%rowtype;
  v_c public.containers%rowtype;
  v_m public.container_members%rowtype;
  v_status text := 'active';
begin
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  select l.* into v_link from public.container_links l where l.code_hash = meldy_private.code_hash(p_code);
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  select c.* into v_c from public.containers c where c.id = v_link.container_id;
  if v_user is not null and v_user = v_c.owner_id then
    v_status := 'own';
  elsif v_user is not null then
    select m.* into v_m from public.container_members m where m.container_id = v_c.id and m.user_id = v_user;
    if found and v_m.removed_at is not null then
      return pg_catalog.jsonb_build_object('status', 'removed');
    elsif found and v_m.left_at is null then
      v_status := 'joined';
    end if;
  end if;
  if v_status = 'active' then
    if v_link.revoked_at is not null then
      return pg_catalog.jsonb_build_object('status', 'revoked');
    elsif v_link.expires_at is not null and v_link.expires_at <= pg_catalog.now() then
      return pg_catalog.jsonb_build_object('status', 'expired');
    elsif v_link.members >= v_link.max_members
          and not exists (select 1 from public.container_members m where m.container_id = v_c.id and m.user_id = v_user) then
      return pg_catalog.jsonb_build_object('status', 'full');
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'status', v_status, 'container_id', case when v_status in ('own', 'joined') then v_c.id end,
    'title', v_c.title, 'exam_date', v_c.exam_date,
    'subjects', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'title', s.title,
                  'items', (select pg_catalog.count(*) from public.test_items i where i.subject_id = s.id and i.keyed),
                  'oral', s.exam_id is not null) order by s.position, s.created_at)
                  from public.container_subjects s where s.container_id = v_c.id), '[]'::jsonb),
    'needs_consent_text', exists (select 1 from public.container_subjects s
                                   where s.container_id = v_c.id and s.exam_id is not null));
end;
$fn$;

-- 12e. Joining: a seat in the link and membership of the container (one row; rejoining after leaving takes no new
--      seat). The test parts are readable at once; the oral parts come as copies (container_oral_codes + the
--      unchanged exam_share_bundle / exam_share_join, then container_bind_copy).
create or replace function public.container_join(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_link public.container_links%rowtype;
  v_m public.container_members%rowtype;
  v_found boolean;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    raise exception 'no such link' using errcode = 'MC001';
  end if;
  select l.* into v_link from public.container_links l where l.code_hash = meldy_private.code_hash(p_code) for update;
  if not found then
    raise exception 'no such link' using errcode = 'MC001';
  end if;
  if v_link.owner_id = v_user then
    raise exception 'the author''s own link' using errcode = 'MC005';
  end if;
  select m.* into v_m from public.container_members m where m.container_id = v_link.container_id and m.user_id = v_user
     for update;
  v_found := found;
  if v_found and v_m.removed_at is not null then
    raise exception 'removed from this container' using errcode = 'MC006';
  end if;
  if v_found and v_m.left_at is null then
    return pg_catalog.jsonb_build_object('container_id', v_link.container_id, 'joined', false);
  end if;
  if v_link.revoked_at is not null then
    raise exception 'the link is revoked' using errcode = 'MC002';
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= pg_catalog.now() then
    raise exception 'the link has expired' using errcode = 'MC003';
  end if;
  if v_found then
    update public.container_members set left_at = null, link_id = v_link.id
     where container_id = v_link.container_id and user_id = v_user;
  else
    if v_link.members >= v_link.max_members then
      raise exception 'no seat left' using errcode = 'MC004';
    end if;
    insert into public.container_members (container_id, user_id, link_id) values (v_link.container_id, v_user, v_link.id);
    update public.container_links set members = members + 1 where id = v_link.id;
  end if;
  return pg_catalog.jsonb_build_object('container_id', v_link.container_id, 'joined', true,
    'oral_subjects', (select pg_catalog.count(*) from public.container_subjects s
                       where s.container_id = v_link.container_id and s.exam_id is not null));
end;
$fn$;

-- 12f. For a member: the codes of the derived oral shares of the oral subjects they have no copy of yet (the backend
--      runs the unchanged copy path with them: exam_share_bundle → plan_copy → exam_share_join). A copy they already
--      have through any share of that exam comes back as existing_exam_id (bind it, do not copy twice).
create or replace function public.container_oral_codes(p_container_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_link public.container_links%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if meldy_private.role_in(v_user, p_container_id) is distinct from 'member' then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  -- The member's own link while it is open, else the newest open link with the consent.
  select l.* into v_link from public.container_links l
    join public.container_members m on m.container_id = l.container_id and m.user_id = v_user
   where l.container_id = p_container_id and l.consent is not null and l.revoked_at is null
     and (l.expires_at is null or l.expires_at > pg_catalog.now())
   order by (l.id = m.link_id) desc, l.created_at desc
   limit 1;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'closed', 'subjects', '[]'::jsonb);
  end if;
  perform meldy_private.ensure_oral_shares(v_link.id);
  return pg_catalog.jsonb_build_object('status', 'open', 'subjects', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'subject_id', s.id, 'title', s.title,
             'code', meldy_private.oral_code(v_link.oral_salt, s.exam_id),
             'existing_exam_id', (select m.member_exam_id from public.exam_share_members m
                                    join public.exam_shares sh on sh.id = m.share_id
                                    join public.exams e on e.id = m.member_exam_id and e.user_id = v_user
                                   where sh.exam_id = s.exam_id and m.user_id = v_user
                                   order by m.joined_at desc limit 1))
             order by s.position, s.created_at)
      from public.container_subjects s
     where s.container_id = p_container_id and s.exam_id is not null
       and not exists (select 1 from public.container_member_exams me where me.subject_id = s.id and me.user_id = v_user)
       and exists (select 1 from public.exam_shares sh
                    where sh.code_hash = meldy_private.code_hash(meldy_private.oral_code(v_link.oral_salt, s.exam_id))
                      and sh.revoked_at is null)), '[]'::jsonb));
end;
$fn$;

-- 12g. A member's copy of an oral subject belongs to it: only a copy made from that subject's exam through a group
--      link (exam_share_members proves it; the policies of exam_shares then keep it from being shared on).
create or replace function public.container_bind_copy(p_subject_id uuid, p_exam_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_s public.container_subjects%rowtype;
  v_bound uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select s.* into v_s from public.container_subjects s where s.id = p_subject_id;
  if v_s.id is null or v_s.exam_id is null or meldy_private.role_in(v_user, v_s.container_id) is distinct from 'member' then
    raise exception 'subject not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.exam_share_members m
                   join public.exam_shares sh on sh.id = m.share_id
                   join public.exams e on e.id = m.member_exam_id and e.user_id = v_user
                  where sh.exam_id = v_s.exam_id and m.user_id = v_user and m.member_exam_id = p_exam_id) then
    raise exception 'not a copy of this subject' using errcode = '42501';
  end if;
  insert into public.container_member_exams (container_id, subject_id, user_id, exam_id)
  values (v_s.container_id, p_subject_id, v_user, p_exam_id)
  on conflict (subject_id, user_id) do nothing;
  select me.exam_id into v_bound from public.container_member_exams me where me.subject_id = p_subject_id and me.user_id = v_user;
  return pg_catalog.jsonb_build_object('subject_id', p_subject_id, 'exam_id', v_bound);
end;
$fn$;

-- 12h. A member leaves (keeps their own states, answers and oral copies; rejoins through any open link).
create or replace function public.container_leave(p_container_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.container_members m set left_at = coalesce(m.left_at, pg_catalog.now())
   where m.container_id = p_container_id and m.user_id = auth.uid() and m.removed_at is null;
  if not found then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  return pg_catalog.jsonb_build_object('container_id', p_container_id, 'left', true);
end;
$fn$;

-- 12i. The author: the members (the name they gave in «Профиль», when they joined), no progress of anyone.
create or replace function public.container_members_list(p_container_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_out jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.containers c where c.id = p_container_id and c.owner_id = auth.uid()) then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'user_id', m.user_id, 'name', coalesce(nullif(pg_catalog.btrim(p.full_name), ''), 'Без имени'),
           'joined_at', m.joined_at, 'left_at', m.left_at, 'removed_at', m.removed_at) order by m.joined_at, m.user_id), '[]'::jsonb)
    into v_out
    from public.container_members m
    left join public.profiles p on p.id = m.user_id
   where m.container_id = p_container_id;
  return v_out;
end;
$fn$;

-- 12j. The author removes a member (or takes them back with p_restore); p_user_id null = everyone («Закрыть доступ
--      всем»; with p_restore: everyone removed comes back). removed = the number of members whose state changed.
create or replace function public.container_member_remove(p_container_id uuid, p_user_id uuid, p_restore boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.containers c where c.id = p_container_id and c.owner_id = auth.uid()) then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  if p_user_id is not null and not exists (select 1 from public.container_members m
                                            where m.container_id = p_container_id and m.user_id = p_user_id) then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if coalesce(p_restore, false) then
    update public.container_members m set removed_at = null
     where m.container_id = p_container_id and (p_user_id is null or m.user_id = p_user_id) and m.removed_at is not null;
  else
    update public.container_members m set removed_at = pg_catalog.now()
     where m.container_id = p_container_id and (p_user_id is null or m.user_id = p_user_id) and m.removed_at is null;
  end if;
  get diagnostics v_n = row_count;
  return pg_catalog.jsonb_build_object('removed', v_n);
end;
$fn$;

-- 13. Function grants (the revokes file takes PUBLIC/anon back; each function checks its caller anyway).
grant execute on function public.record_test_answers(jsonb), public.container_mock_finish(jsonb),
  public.container_create(text, date, jsonb), public.container_subject_add(uuid, jsonb),
  public.container_items_add(uuid, jsonb), public.container_item_update(uuid, jsonb),
  public.test_key_doubt(uuid, jsonb, text), public.test_key_doubt_withdraw(uuid), public.container_doubts(uuid),
  public.container_doubt_keep(uuid), public.containers_overview(text), public.container_summary(uuid, text),
  public.plan_inputs(text, uuid), public.test_answer_days(date), public.container_link_create(uuid, integer, text),
  public.container_link_revoke(uuid), public.container_join(text), public.container_oral_codes(uuid),
  public.container_bind_copy(uuid, uuid), public.container_leave(uuid), public.container_members_list(uuid),
  public.container_member_remove(uuid, uuid, boolean), public.my_container_ids()
  to authenticated;
grant execute on function public.container_link_preview(text) to anon, authenticated;
