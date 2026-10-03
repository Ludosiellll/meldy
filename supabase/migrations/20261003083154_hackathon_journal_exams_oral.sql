-- hackathon_journal_exams_oral
-- Repo file: supabase/migrations/<version recorded by apply_migration>_hackathon_journal_exams_oral.sql
-- One additive, re-runnable migration for the hackathon build (Hackathon_Plan_2026-10-02:
-- agreements 5.1, orchestrator corrections 2-7). It creates new objects and adds columns with
-- defaults only: no DROP, no DELETE, no UPDATE of existing rows. Every statement is idempotent
-- (IF NOT EXISTS, OR REPLACE, policies created only when missing), so a failed apply can be
-- re-run. The live client f3b94ba keeps working: it never reads the new tables, every new
-- column on an old table has a default, and its direct flashcard UPDATE still succeeds.

-- 0. Normalised question hash (correction 6): no leading number, case, ё/е or punctuation.
--    Locale-independent: explicit letter table and code-point classes, so the result is the
--    same on every server. md5 hex of the normalised text is the history key of a question.
create or replace function public.meldy_normalize_question(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $fn$
  select pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.translate(
        pg_catalog.regexp_replace(
          p_text,
          '^\s*([Вв][Оо][Пп][Рр][Оо][Сс]\s*)?№?\s*\d{1,3}(\.\d{1,2})?[.)]\s*',
          ''
        ),
        'ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё',
        'abcdefghijklmnopqrstuvwxyzабвгдеежзийклмнопрстуфхцчшщъыьэюяе'
      ),
      '[^0-9a-zа-я]+', ' ', 'g'
    )
  )
$fn$;

create or replace function public.meldy_question_hash(p_text text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $fn$
  select pg_catalog.md5(public.meldy_normalize_question(p_text))
$fn$;

revoke all on function public.meldy_normalize_question(text) from public, anon;
revoke all on function public.meldy_question_hash(text) from public, anon;
grant execute on function public.meldy_normalize_question(text) to authenticated, service_role;
grant execute on function public.meldy_question_hash(text) to authenticated, service_role;

-- 1. Journal learning_events (agreement 5.1 #1). Append-only, own rows only, no anon access.
create table if not exists public.learning_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  local_date date not null default current_date,
  material_id uuid references public.materials(id) on delete set null,
  kind text not null,
  item_key text not null,
  correct boolean,
  score real,
  confidence smallint,
  source_ids text[] not null default '{}'::text[],
  session_id uuid,
  client_event_id text not null,
  payload jsonb not null default '{}'::jsonb,
  constraint learning_events_kind_check
    check (kind in ('quiz_answer', 'card_review', 'exam_answer', 'oral_point', 'self_rating')),
  constraint learning_events_item_key_check check (char_length(item_key) between 1 and 200),
  constraint learning_events_score_check check (score is null or (score >= 0 and score <= 1)),
  constraint learning_events_confidence_check check (confidence is null or confidence between 1 and 3),
  constraint learning_events_source_ids_check check (cardinality(source_ids) <= 20),
  constraint learning_events_client_event_id_check check (char_length(client_event_id) between 8 and 120),
  constraint learning_events_payload_check
    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 8192),
  constraint learning_events_client_event_unique unique (user_id, client_event_id)
);

create index if not exists learning_events_user_kind_item_idx
  on public.learning_events (user_id, kind, item_key, created_at desc);
create index if not exists learning_events_user_material_idx
  on public.learning_events (user_id, material_id, created_at desc);
create index if not exists learning_events_user_session_idx
  on public.learning_events (user_id, session_id);

-- created_at is always the server time; local_date is the client's local date, kept only within
-- one day of the server's UTC date (otherwise the server UTC date is stored).
create or replace function public.learning_events_set_server_fields()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_today date := (pg_catalog.now() at time zone 'utc')::date;
begin
  new.created_at := pg_catalog.now();
  if new.local_date is null or new.local_date < v_today - 1 or new.local_date > v_today + 1 then
    new.local_date := v_today;
  end if;
  return new;
end;
$fn$;

create or replace trigger learning_events_set_server_fields
  before insert on public.learning_events
  for each row execute function public.learning_events_set_server_fields();

alter table public.learning_events enable row level security;
revoke all on table public.learning_events from anon;
revoke update, delete, truncate, references, trigger on table public.learning_events from authenticated;
grant select, insert on table public.learning_events to authenticated;

do $do$
begin
  if not exists (select 1 from pg_catalog.pg_policies
                 where schemaname = 'public' and tablename = 'learning_events'
                   and policyname = 'Learning events: read own') then
    create policy "Learning events: read own" on public.learning_events
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies
                 where schemaname = 'public' and tablename = 'learning_events'
                   and policyname = 'Learning events: add own') then
    create policy "Learning events: add own" on public.learning_events
      for insert to authenticated with check (
        (select auth.uid()) = user_id
        and (material_id is null
             or exists (select 1 from public.materials m
                        where m.id = material_id and m.user_id = (select auth.uid())))
      );
  end if;
end
$do$;

-- 2. mistake_diary: fragment ids, origin, open-item key (dedupe) and rubric point.
alter table public.mistake_diary
  add column if not exists exam_session_id uuid references public.exam_sessions(id) on delete set null,
  add column if not exists source_ids text[] not null default '{}'::text[]
    constraint mistake_diary_source_ids_check check (cardinality(source_ids) <= 20),
  add column if not exists origin text not null default 'professor'
    constraint mistake_diary_origin_check check (origin in ('professor', 'oral_ticket', 'quiz')),
  add column if not exists item_key text
    constraint mistake_diary_item_key_check check (item_key is null or char_length(item_key) between 1 and 200),
  add column if not exists rubric_point_id text
    constraint mistake_diary_rubric_point_check check (rubric_point_id is null or rubric_point_id ~ '^p[1-6]$');

-- At most one open mistake per item. Old rows have item_key null and are outside this index.
create unique index if not exists mistake_diary_open_item_key_uidx
  on public.mistake_diary (user_id, item_key)
  where item_key is not null and not is_resolved;

-- 3. flashcard_progress: review date, card origin, fragment ids.
alter table public.flashcard_progress
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists origin text not null default 'analysis'
    constraint flashcard_progress_origin_check check (origin in ('analysis', 'oral_followup')),
  add column if not exists source_ids text[] not null default '{}'::text[]
    constraint flashcard_progress_source_ids_check check (cardinality(source_ids) <= 20);

-- Any write that moves the schedule (the review RPC or the old client's direct UPDATE) records
-- when the card was reviewed, so last_reviewed_at is truthful for both clients.
create or replace function public.flashcard_progress_touch_reviewed()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.next_review is distinct from old.next_review or new.repetitions is distinct from old.repetitions then
    new.last_reviewed_at := pg_catalog.now();
  end if;
  return new;
end;
$fn$;

create or replace trigger flashcard_progress_touch_reviewed
  before update of next_review, repetitions on public.flashcard_progress
  for each row execute function public.flashcard_progress_touch_reviewed();

-- 4. exam_sessions: attempt kind (old rows and the old client get 'professor').
alter table public.exam_sessions
  add column if not exists kind text not null default 'professor'
    constraint exam_sessions_kind_check check (kind in ('professor', 'oral_ticket')),
  add column if not exists duration_seconds integer;

create index if not exists exam_sessions_user_kind_idx
  on public.exam_sessions (user_id, kind, completed_at desc);

-- 5. «Билеты»: exams (the only owner of an exam date, correction 4), their lectures and questions.
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  kind text not null default 'exam',
  exam_date date,
  source_kind text not null default 'paste',
  source_text text not null default '',
  ticket_layout jsonb not null default '{"mode": "random", "per_ticket": 2}'::jsonb,
  mapping_state text not null default 'none',
  mapping_started_at timestamptz,
  mapped_at timestamptz,
  mapped_material_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  constraint exams_title_check check (char_length(btrim(title)) between 1 and 200),
  constraint exams_kind_check check (kind in ('exam', 'credit', 'colloquium')),
  constraint exams_source_kind_check check (source_kind in ('paste', 'file')),
  constraint exams_source_text_check check (char_length(source_text) <= 60000),
  constraint exams_ticket_layout_check
    check (jsonb_typeof(ticket_layout) = 'object' and octet_length(ticket_layout::text) <= 65536),
  constraint exams_mapping_state_check check (mapping_state in ('none', 'running', 'done', 'partial', 'failed'))
);
create index if not exists exams_user_date_idx on public.exams (user_id, exam_date);

create table if not exists public.exam_materials (
  exam_id uuid not null references public.exams(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (exam_id, material_id)
);
create index if not exists exam_materials_material_idx on public.exam_materials (material_id);
create index if not exists exam_materials_user_idx on public.exam_materials (user_id);

create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  position smallint not null,
  label text not null default '',
  section smallint,
  text text not null,
  question_hash text generated always as (public.meldy_question_hash(text)) stored,
  coverage text,
  coverage_method text,
  coverage_reason text not null default '',
  missing_note text not null default '',
  evidence jsonb not null default '[]'::jsonb,
  nearest jsonb not null default '[]'::jsonb,
  materials_fingerprint text,
  mapping_version smallint,
  mapped_at timestamptz,
  created_at timestamptz not null default now(),
  constraint exam_questions_position_check check (position between 1 and 300),
  constraint exam_questions_label_check check (char_length(label) <= 16),
  constraint exam_questions_section_check check (section is null or section between 1 and 20),
  constraint exam_questions_text_check check (char_length(btrim(text)) between 3 and 1000),
  constraint exam_questions_coverage_check check (coverage is null or coverage in ('full', 'partial', 'none', 'unverified')),
  constraint exam_questions_method_check check (coverage_method is null or coverage_method in ('llm', 'lexical', 'manual')),
  constraint exam_questions_reason_check check (char_length(coverage_reason) <= 400),
  constraint exam_questions_missing_check check (char_length(missing_note) <= 400),
  constraint exam_questions_evidence_check
    check (jsonb_typeof(evidence) = 'array' and octet_length(evidence::text) <= 16384),
  constraint exam_questions_nearest_check
    check (jsonb_typeof(nearest) = 'array' and octet_length(nearest::text) <= 8192)
);
create index if not exists exam_questions_exam_idx on public.exam_questions (exam_id, position);
create index if not exists exam_questions_reuse_idx on public.exam_questions (user_id, question_hash);

alter table public.exams enable row level security;
alter table public.exam_materials enable row level security;
alter table public.exam_questions enable row level security;
revoke all on table public.exams, public.exam_materials, public.exam_questions from anon;
revoke truncate, references, trigger on table public.exams, public.exam_materials, public.exam_questions from authenticated;
revoke update on table public.exam_materials from authenticated;
grant select, insert, update, delete on table public.exams, public.exam_questions to authenticated;
grant select, insert, delete on table public.exam_materials to authenticated;

do $do$
begin
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exams' and policyname = 'Exams: read own') then
    create policy "Exams: read own" on public.exams for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exams' and policyname = 'Exams: insert own') then
    create policy "Exams: insert own" on public.exams for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exams' and policyname = 'Exams: update own') then
    create policy "Exams: update own" on public.exams for update to authenticated
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exams' and policyname = 'Exams: delete own') then
    create policy "Exams: delete own" on public.exams for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exam_materials' and policyname = 'Exam materials: read own') then
    create policy "Exam materials: read own" on public.exam_materials for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exam_materials' and policyname = 'Exam materials: attach own') then
    create policy "Exam materials: attach own" on public.exam_materials for insert to authenticated
      with check (
        (select auth.uid()) = user_id
        and exists (select 1 from public.exams e where e.id = exam_id and e.user_id = (select auth.uid()))
        and exists (select 1 from public.materials m where m.id = material_id and m.user_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exam_materials' and policyname = 'Exam materials: detach own') then
    create policy "Exam materials: detach own" on public.exam_materials for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exam_questions' and policyname = 'Exam questions: read own') then
    create policy "Exam questions: read own" on public.exam_questions for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exam_questions' and policyname = 'Exam questions: insert own') then
    create policy "Exam questions: insert own" on public.exam_questions for insert to authenticated
      with check (
        (select auth.uid()) = user_id
        and exists (select 1 from public.exams e where e.id = exam_id and e.user_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exam_questions' and policyname = 'Exam questions: update own') then
    create policy "Exam questions: update own" on public.exam_questions for update to authenticated
      using ((select auth.uid()) = user_id)
      with check (
        (select auth.uid()) = user_id
        and exists (select 1 from public.exams e where e.id = exam_id and e.user_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exam_questions' and policyname = 'Exam questions: delete own') then
    create policy "Exam questions: delete own" on public.exam_questions for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end
$do$;

-- 6. «Ответ вслух»: rubric cache. One row per (question hash, exact fragment set, version).
create table if not exists public.oral_rubrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question_hash text not null,
  source_key text not null,
  material_id uuid not null references public.materials(id) on delete cascade,
  material_ids uuid[] not null default '{}'::uuid[],
  question text not null,
  rubric jsonb not null,
  rubric_version smallint not null default 1,
  model text not null default '',
  created_at timestamptz not null default now(),
  constraint oral_rubrics_hash_check check (question_hash ~ '^[0-9a-f]{32}$'),
  constraint oral_rubrics_source_key_check check (char_length(source_key) between 8 and 128),
  constraint oral_rubrics_question_check check (char_length(question) between 3 and 1000),
  constraint oral_rubrics_rubric_check check (jsonb_typeof(rubric) = 'object' and octet_length(rubric::text) <= 65536),
  constraint oral_rubrics_model_check check (char_length(model) <= 80),
  constraint oral_rubrics_unique unique (user_id, question_hash, source_key, rubric_version)
);
create index if not exists oral_rubrics_material_idx on public.oral_rubrics (material_id);

alter table public.oral_rubrics enable row level security;
revoke all on table public.oral_rubrics from anon;
revoke truncate, references, trigger on table public.oral_rubrics from authenticated;
grant select, insert, update, delete on table public.oral_rubrics to authenticated;

do $do$
begin
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'oral_rubrics' and policyname = 'Oral rubrics: read own') then
    create policy "Oral rubrics: read own" on public.oral_rubrics for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'oral_rubrics' and policyname = 'Oral rubrics: create for own materials') then
    create policy "Oral rubrics: create for own materials" on public.oral_rubrics for insert to authenticated
      with check (
        (select auth.uid()) = user_id
        and exists (select 1 from public.materials m where m.id = material_id and m.user_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'oral_rubrics' and policyname = 'Oral rubrics: update own') then
    create policy "Oral rubrics: update own" on public.oral_rubrics for update to authenticated
      using ((select auth.uid()) = user_id)
      with check (
        (select auth.uid()) = user_id
        and exists (select 1 from public.materials m where m.id = material_id and m.user_id = (select auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'oral_rubrics' and policyname = 'Oral rubrics: delete own') then
    create policy "Oral rubrics: delete own" on public.oral_rubrics for delete to authenticated
      using ((select auth.uid()) = user_id);
  end if;
end
$do$;

-- 7a. Review RPC: one transaction, idempotent by client_event_id, SM-2 identical to
--     frontend/src/api/flashcards.ts, writes last_reviewed_at and one card_review event.
create or replace function public.review_flashcard(
  p_card_id uuid,
  p_quality integer,
  p_client_event_id text,
  p_local_date date default null,
  p_session_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_card record;
  v_material uuid;
  v_key text;
  v_existing_key text;
  v_ease double precision;
  v_interval integer;
  v_reps integer;
  v_next timestamptz;
  v_event_id uuid;
  v_now timestamptz := pg_catalog.now();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_quality is null or p_quality < 0 or p_quality > 5 then
    raise exception 'quality must be between 0 and 5' using errcode = '22023';
  end if;
  if p_client_event_id is null or pg_catalog.char_length(p_client_event_id) < 8
     or pg_catalog.char_length(p_client_event_id) > 120 then
    raise exception 'invalid client_event_id' using errcode = '22023';
  end if;

  select f.id, f.material_id, f.ease_factor, f.interval_days, f.repetitions, f.next_review, f.last_reviewed_at
    into v_card
    from public.flashcard_progress f
   where f.id = p_card_id and f.user_id = v_user
   for update;
  if not found then
    raise exception 'card not found' using errcode = 'P0002';
  end if;
  v_key := 'card:' || v_card.id::text;
  -- The journal links only the caller's own materials (insert policy); anything else is null.
  select m.id into v_material
    from public.materials m
   where m.id = v_card.material_id and m.user_id = v_user;

  select e.item_key into v_existing_key
    from public.learning_events e
   where e.user_id = v_user and e.client_event_id = p_client_event_id;
  if found then
    if v_existing_key is distinct from v_key then
      raise exception 'client_event_id was already used for another item' using errcode = '22023';
    end if;
    return pg_catalog.jsonb_build_object(
      'card_id', v_card.id, 'ease_factor', v_card.ease_factor, 'interval_days', v_card.interval_days,
      'repetitions', v_card.repetitions, 'next_review', v_card.next_review,
      'last_reviewed_at', v_card.last_reviewed_at, 'duplicate', true);
  end if;

  v_ease := coalesce(v_card.ease_factor, 2.5);
  v_interval := coalesce(v_card.interval_days, 1);
  v_reps := coalesce(v_card.repetitions, 0);
  if p_quality >= 3 then
    if v_reps = 0 then
      v_interval := 1;
    elsif v_reps = 1 then
      v_interval := 6;
    else
      v_interval := pg_catalog.round((v_interval * v_ease)::numeric)::integer;
    end if;
    v_reps := v_reps + 1;
    v_ease := greatest(1.3, v_ease + 0.1 - (5 - p_quality) * (0.08 + (5 - p_quality) * 0.02));
  else
    v_reps := 0;
    v_interval := 1;
  end if;
  v_next := v_now + pg_catalog.make_interval(days => v_interval);

  insert into public.learning_events
    (user_id, local_date, material_id, kind, item_key, correct, score, session_id, client_event_id, payload)
  values
    (v_user, p_local_date, v_material, 'card_review', v_key,
     p_quality >= 3, p_quality / 5.0, p_session_id, p_client_event_id,
     pg_catalog.jsonb_build_object(
       'v', 1, 'quality', p_quality,
       'before', pg_catalog.jsonb_build_object('ease_factor', v_card.ease_factor,
                 'interval_days', v_card.interval_days, 'repetitions', v_card.repetitions),
       'after', pg_catalog.jsonb_build_object('ease_factor', v_ease, 'interval_days', v_interval,
                'repetitions', v_reps, 'next_review', v_next)))
  on conflict (user_id, client_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    -- A concurrent call stored the same client_event_id first.
    select e.item_key into v_existing_key
      from public.learning_events e
     where e.user_id = v_user and e.client_event_id = p_client_event_id;
    if v_existing_key is distinct from v_key then
      raise exception 'client_event_id was already used for another item' using errcode = '22023';
    end if;
    return pg_catalog.jsonb_build_object(
      'card_id', v_card.id, 'ease_factor', v_card.ease_factor, 'interval_days', v_card.interval_days,
      'repetitions', v_card.repetitions, 'next_review', v_card.next_review,
      'last_reviewed_at', v_card.last_reviewed_at, 'duplicate', true);
  end if;

  update public.flashcard_progress
     set ease_factor = v_ease,
         interval_days = v_interval,
         repetitions = v_reps,
         next_review = v_next,
         last_reviewed_at = v_now
   where id = v_card.id;

  return pg_catalog.jsonb_build_object(
    'card_id', v_card.id, 'ease_factor', v_ease, 'interval_days', v_interval, 'repetitions', v_reps,
    'next_review', v_next, 'last_reviewed_at', v_now, 'duplicate', false);
end;
$fn$;

-- 7b. Quiz attempt: one quiz_answer event per answered question (idempotent per
--     session_id:index) and one open mistake per wrong question (deduplicated by item_key).
--     The item key is scoped to the material; an attempt counts as a retake when the client says
--     so or when any of its questions was already answered in another session.
create or replace function public.record_quiz_attempt(p_attempt jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_session uuid;
  v_material uuid;
  v_prefix text;
  v_local_date date;
  v_client_retake boolean;
  v_retake boolean;
  v_surface text;
  v_topic text;
  v_answer jsonb;
  v_index integer;
  v_position integer := 0;
  v_question text;
  v_key text;
  v_keys text[] := '{}'::text[];
  v_correct boolean;
  v_seen boolean;
  v_sources text[];
  v_event_id uuid;
  v_inserted boolean;
  v_events integer := 0;
  v_added integer := 0;
  v_existing integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_attempt is null or pg_catalog.jsonb_typeof(p_attempt) <> 'object'
     or pg_catalog.jsonb_typeof(p_attempt -> 'answers') is distinct from 'array' then
    raise exception 'invalid quiz attempt' using errcode = '22023';
  end if;
  if pg_catalog.jsonb_array_length(p_attempt -> 'answers') not between 1 and 50
     or pg_catalog.octet_length(p_attempt::text) > 65536 then
    raise exception 'invalid quiz attempt' using errcode = '22023';
  end if;
  if coalesce(p_attempt ->> 'session_id', '') !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'session_id must be a uuid' using errcode = '22023';
  end if;
  v_session := (p_attempt ->> 'session_id')::uuid;
  if coalesce(p_attempt ->> 'material_id', '') ~ '^[0-9a-fA-F-]{36}$' then
    select m.id into v_material
      from public.materials m
     where m.id = (p_attempt ->> 'material_id')::uuid and m.user_id = v_user;
  end if;
  v_prefix := 'quiz:' || coalesce(v_material::text, 'none') || ':';
  v_local_date := case when coalesce(p_attempt ->> 'local_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
                       then (p_attempt ->> 'local_date')::date end;
  v_client_retake := coalesce(p_attempt ->> 'retake', '') = 'true';
  v_surface := case when p_attempt ->> 'surface' in ('analysis', 'material') then p_attempt ->> 'surface' else 'analysis' end;
  v_topic := pg_catalog.left(coalesce(p_attempt ->> 'topic', ''), 200);

  for v_answer in select value from pg_catalog.jsonb_array_elements(p_attempt -> 'answers') loop
    v_question := pg_catalog.left(pg_catalog.btrim(coalesce(v_answer ->> 'question', '')), 1000);
    if pg_catalog.char_length(v_question) >= 3 then
      v_keys := v_keys || (v_prefix || public.meldy_question_hash(v_question));
    end if;
  end loop;
  v_retake := v_client_retake or exists (
    select 1 from public.learning_events e
     where e.user_id = v_user and e.kind = 'quiz_answer'
       and e.item_key = any (v_keys) and e.session_id is distinct from v_session);

  for v_answer in select value from pg_catalog.jsonb_array_elements(p_attempt -> 'answers') loop
    v_position := v_position + 1;
    v_index := case when coalesce(v_answer ->> 'index', '') ~ '^\d{1,3}$'
                    then (v_answer ->> 'index')::integer else v_position - 1 end;
    v_question := pg_catalog.left(pg_catalog.btrim(coalesce(v_answer ->> 'question', '')), 1000);
    continue when pg_catalog.char_length(v_question) < 3;
    v_key := v_prefix || public.meldy_question_hash(v_question);
    v_correct := case when pg_catalog.jsonb_typeof(v_answer -> 'correct') = 'boolean'
                      then (v_answer ->> 'correct')::boolean end;
    v_sources := coalesce(array(
      select s from pg_catalog.jsonb_array_elements_text(
        case when pg_catalog.jsonb_typeof(v_answer -> 'source_ids') = 'array' then v_answer -> 'source_ids' else '[]'::jsonb end) s
       where s ~ '^S[0-9]{1,3}$'
       limit 20), '{}'::text[]);
    v_seen := exists (
      select 1 from public.learning_events e
       where e.user_id = v_user and e.kind = 'quiz_answer'
         and e.item_key = v_key and e.session_id is distinct from v_session);

    v_event_id := null;
    insert into public.learning_events
      (user_id, local_date, material_id, kind, item_key, correct, score, source_ids, session_id, client_event_id, payload)
    values
      (v_user, v_local_date, v_material, 'quiz_answer', v_key, v_correct,
       case when v_correct is null then null when v_correct then 1 else 0 end,
       v_sources, v_session, v_session::text || ':' || v_index::text,
       pg_catalog.jsonb_build_object(
         'v', 1, 'index', v_index,
         'chosen', pg_catalog.left(v_answer ->> 'chosen', 4), 'expected', pg_catalog.left(v_answer ->> 'expected', 4),
         'options', case when pg_catalog.jsonb_typeof(v_answer -> 'options') = 'number' then v_answer -> 'options' end,
         'retake', v_retake, 'client_retake', v_client_retake, 'seen_before', v_seen,
         'surface', v_surface, 'question', pg_catalog.left(v_question, 300)))
    on conflict (user_id, client_event_id) do nothing
    returning id into v_event_id;

    continue when v_event_id is null;  -- this answer was already recorded
    v_events := v_events + 1;

    if v_correct is false then
      insert into public.mistake_diary
        (user_id, material_id, question, correct_answer, student_answer, topic, is_resolved, origin, item_key, source_ids)
      values
        (v_user, v_material, v_question,
         pg_catalog.left(coalesce(nullif(pg_catalog.btrim(v_answer ->> 'expected_text'), ''), '—')
           || coalesce(' — ' || nullif(pg_catalog.btrim(v_answer ->> 'explanation'), ''), ''), 1000),
         pg_catalog.left(coalesce(v_answer ->> 'chosen_text', ''), 500),
         v_topic, false, 'quiz', v_key, v_sources)
      on conflict (user_id, item_key) where item_key is not null and not is_resolved
      do update set student_answer = excluded.student_answer
      returning (xmax = 0) into v_inserted;
      if v_inserted then
        v_added := v_added + 1;
      else
        v_existing := v_existing + 1;
      end if;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'events', v_events, 'duplicate', v_events = 0, 'retake', v_retake,
    'mistakes_added', v_added, 'mistakes_existing', v_existing);
end;
$fn$;

-- 7c. Oral ticket attempt (agreement 5.1 #2: one answer engine). One transaction:
--     exam_sessions row (kind 'oral_ticket'), one exam_answer event, one oral_point event per
--     rubric point, open mistakes for unrecovered points and an optional review card made from
--     the follow-up question. The question text and hash come from the caller's exam_questions
--     row, never from the client. Idempotent by attempt_id. Stored quotes are short (<=160).
create or replace function public.record_oral_attempt(p_attempt jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_attempt_id text;
  v_question_id uuid;
  v_exam_id uuid;
  v_hash text;
  v_question text;
  v_subject text;
  v_session_id uuid;
  v_material uuid;
  v_local_date date;
  v_score integer;
  v_grade integer;
  v_confidence smallint;
  v_rubric_id text;
  v_input text;
  v_raw jsonb;
  v_point jsonb;
  v_points jsonb := '[]'::jsonb;
  v_ids text[] := '{}'::text[];
  v_point_id text;
  v_status text;
  v_point_material uuid;
  v_sources text[];
  v_title text;
  v_quote text;
  v_label text;
  v_credit real;
  v_followup jsonb;
  v_followup_point jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_recovered boolean;
  v_inserted boolean;
  v_card_material uuid;
  v_card_question text;
  v_events integer := 0;
  v_added integer := 0;
  v_existing integer := 0;
  v_card boolean := false;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_attempt is null or pg_catalog.jsonb_typeof(p_attempt) <> 'object'
     or pg_catalog.jsonb_typeof(p_attempt -> 'points') is distinct from 'array'
     or pg_catalog.octet_length(p_attempt::text) > 32768 then
    raise exception 'invalid oral attempt' using errcode = '22023';
  end if;
  v_attempt_id := p_attempt ->> 'attempt_id';
  if v_attempt_id is null or v_attempt_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'attempt_id is required' using errcode = '22023';
  end if;
  if coalesce(p_attempt ->> 'exam_question_id', '') !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'exam_question_id must be a uuid' using errcode = '22023';
  end if;
  v_question_id := (p_attempt ->> 'exam_question_id')::uuid;
  v_score := case when coalesce(p_attempt ->> 'score', '') ~ '^\d{1,3}$' then (p_attempt ->> 'score')::integer end;
  v_grade := case when coalesce(p_attempt ->> 'grade', '') ~ '^[2-5]$' then (p_attempt ->> 'grade')::integer end;
  if v_score is null or v_score > 100 or v_grade is null then
    raise exception 'score (0..100) and grade (2..5) are required' using errcode = '22023';
  end if;

  select q.question_hash, q.text, q.exam_id, e.title
    into v_hash, v_question, v_exam_id, v_subject
    from public.exam_questions q
    join public.exams e on e.id = q.exam_id
   where q.id = v_question_id and q.user_id = v_user;
  if not found then
    raise exception 'exam question not found' using errcode = 'P0002';
  end if;

  -- Serialise retries of the same attempt, then answer a retry with the first result.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':' || v_attempt_id, 0));
  select e.session_id into v_session_id
    from public.learning_events e
   where e.user_id = v_user and e.client_event_id = v_attempt_id || ':answer';
  if found then
    return pg_catalog.jsonb_build_object('session_id', v_session_id, 'duplicate', true,
      'events', 0, 'mistakes_added', 0, 'mistakes_existing', 0, 'card_added', false);
  end if;

  if coalesce(p_attempt ->> 'material_id', '') ~ '^[0-9a-fA-F-]{36}$' then
    select m.id into v_material
      from public.materials m
     where m.id = (p_attempt ->> 'material_id')::uuid and m.user_id = v_user;
  end if;
  v_local_date := case when coalesce(p_attempt ->> 'local_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
                       then (p_attempt ->> 'local_date')::date end;
  v_confidence := case when coalesce(p_attempt ->> 'confidence', '') ~ '^[1-3]$'
                       then (p_attempt ->> 'confidence')::smallint end;
  v_rubric_id := case when coalesce(p_attempt ->> 'rubric_id', '') ~ '^[0-9a-fA-F-]{36}$'
                      then p_attempt ->> 'rubric_id' end;
  v_input := case when p_attempt ->> 'input' in ('speech', 'text', 'mixed') then p_attempt ->> 'input' else 'text' end;

  -- Clean points: valid unique ids p1..p6, known statuses, short quotes, own materials only.
  for v_raw in select value from pg_catalog.jsonb_array_elements(p_attempt -> 'points') loop
    v_point_id := v_raw ->> 'id';
    continue when v_point_id is null or v_point_id !~ '^p[1-6]$' or v_point_id = any (v_ids);
    v_ids := v_ids || v_point_id;
    v_point_material := null;
    if coalesce(v_raw ->> 'material_id', '') ~ '^[0-9a-fA-F-]{36}$' then
      select m.id into v_point_material
        from public.materials m
       where m.id = (v_raw ->> 'material_id')::uuid and m.user_id = v_user;
    end if;
    v_points := v_points || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', v_point_id,
      'title', pg_catalog.left(pg_catalog.btrim(coalesce(v_raw ->> 'title', '')), 120),
      'essential', coalesce(v_raw ->> 'essential', '') = 'true',
      'status', case when v_raw ->> 'status' in ('covered', 'partial', 'missing', 'wrong', 'unrated')
                     then v_raw ->> 'status' else 'unrated' end,
      'credit', case when pg_catalog.jsonb_typeof(v_raw -> 'credit') = 'number'
                     then least(1, greatest(0, (v_raw ->> 'credit')::real)) end,
      'student_quote', pg_catalog.left(coalesce(v_raw ->> 'student_quote', ''), 160),
      'comment', pg_catalog.left(coalesce(v_raw ->> 'comment', ''), 200),
      'source_ids', pg_catalog.to_jsonb(coalesce(array(
         select s from pg_catalog.jsonb_array_elements_text(
           case when pg_catalog.jsonb_typeof(v_raw -> 'source_ids') = 'array' then v_raw -> 'source_ids' else '[]'::jsonb end) s
          where s ~ '^S[0-9]{1,3}$' limit 6), '{}'::text[])),
      'material_id', v_point_material,
      'source_quote', pg_catalog.left(coalesce(v_raw ->> 'source_quote', ''), 300),
      'source_label', pg_catalog.left(coalesce(v_raw ->> 'source_label', ''), 120),
      'live', coalesce(v_raw ->> 'live', '') = 'true'));
  end loop;
  if pg_catalog.jsonb_array_length(v_points) = 0 then
    raise exception 'at least one rubric point is required' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_attempt -> 'followup') = 'object'
     and (p_attempt -> 'followup' ->> 'point_id') = any (v_ids) then
    v_followup := pg_catalog.jsonb_build_object(
      'point_id', p_attempt -> 'followup' ->> 'point_id',
      'question', pg_catalog.left(pg_catalog.btrim(coalesce(p_attempt -> 'followup' ->> 'question', '')), 200),
      'expected', pg_catalog.left(pg_catalog.btrim(coalesce(p_attempt -> 'followup' ->> 'expected', '')), 300),
      'status', case when p_attempt -> 'followup' ->> 'status' in ('covered', 'partial', 'missing', 'wrong')
                     then p_attempt -> 'followup' ->> 'status' else 'missing' end,
      'student_quote', pg_catalog.left(coalesce(p_attempt -> 'followup' ->> 'student_quote', ''), 160),
      'chosen_by', case when p_attempt -> 'followup' ->> 'chosen_by' = 'check' then 'check' else 'client' end);
  end if;

  if pg_catalog.jsonb_typeof(p_attempt -> 'errors') = 'array' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'point_id', x ->> 'point_id',
             'student_quote', pg_catalog.left(coalesce(x ->> 'student_quote', ''), 160),
             'correction', pg_catalog.left(coalesce(x ->> 'correction', ''), 160))), '[]'::jsonb)
      into v_errors
      from (select value as x from pg_catalog.jsonb_array_elements(p_attempt -> 'errors') limit 10) t
     where (x ->> 'point_id') = any (v_ids);
  end if;

  insert into public.exam_sessions
    (user_id, material_id, subject, kind, questions_json, total_questions, score, duration_seconds, status, completed_at)
  values
    (v_user, v_material, pg_catalog.left(v_subject, 200), 'oral_ticket',
     pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
       'v', 1,
       'exam_id', v_exam_id,
       'exam_question_id', v_question_id,
       'rubric_id', v_rubric_id,
       'question_hash', v_hash,
       'question', v_question,
       'input', v_input,
       'points', v_points,
       'followup', v_followup,
       'errors', v_errors,
       'verdict', pg_catalog.left(coalesce(p_attempt ->> 'verdict', ''), 600),
       'grade', v_grade,
       'formula', 'v1')),
     1, v_score,
     case when coalesce(p_attempt ->> 'duration_seconds', '') ~ '^\d{1,6}$'
          then least((p_attempt ->> 'duration_seconds')::integer, 3600) else 0 end,
     'completed', pg_catalog.now())
  returning id into v_session_id;

  insert into public.learning_events
    (user_id, local_date, material_id, kind, item_key, correct, score, confidence, session_id, client_event_id, payload)
  values
    (v_user, v_local_date, v_material, 'exam_answer', 'q:' || v_hash, v_grade >= 4, v_score / 100.0,
     v_confidence, v_session_id, v_attempt_id || ':answer',
     pg_catalog.jsonb_build_object(
       'v', 1,
       'exam_id', v_exam_id,
       'exam_question_id', v_question_id,
       'grade', v_grade, 'score_pct', v_score,
       'input', v_input,
       'rubric_id', v_rubric_id,
       'followup_point', v_followup ->> 'point_id',
       'followup_status', v_followup ->> 'status',
       'chosen_by', v_followup ->> 'chosen_by'));
  v_events := 1;

  for v_point in select value from pg_catalog.jsonb_array_elements(v_points) loop
    v_point_id := v_point ->> 'id';
    v_status := v_point ->> 'status';
    v_recovered := v_followup is not null and v_followup ->> 'point_id' = v_point_id
                   and v_followup ->> 'status' = 'covered';
    v_point_material := coalesce((v_point ->> 'material_id')::uuid, v_material);
    v_sources := coalesce(array(select pg_catalog.jsonb_array_elements_text(v_point -> 'source_ids')), '{}'::text[]);
    v_title := v_point ->> 'title';
    v_credit := (v_point ->> 'credit')::real;

    insert into public.learning_events
      (user_id, local_date, material_id, kind, item_key, correct, score, source_ids, session_id, client_event_id, payload)
    values
      (v_user, v_local_date, v_point_material, 'oral_point',
       'oral:' || coalesce(v_rubric_id, v_hash) || ':' || v_point_id,
       case when v_status = 'unrated' then null else v_status = 'covered' or v_recovered end,
       v_credit, v_sources, v_session_id, v_attempt_id || ':' || v_point_id,
       pg_catalog.jsonb_build_object(
         'v', 1, 'question_hash', v_hash, 'rubric_id', v_rubric_id,
         'point_id', v_point_id, 'title', v_title, 'status', v_status,
         'essential', (v_point ->> 'essential')::boolean,
         'live', (v_point ->> 'live')::boolean,
         'followup_status', case when v_followup ->> 'point_id' = v_point_id then v_followup ->> 'status' end));
    v_events := v_events + 1;

    if v_status in ('partial', 'missing', 'wrong') and not v_recovered and pg_catalog.char_length(v_title) > 0 then
      v_quote := v_point ->> 'source_quote';
      v_label := coalesce(nullif(v_point ->> 'source_label', ''), 'Лекция');
      insert into public.mistake_diary
        (user_id, material_id, exam_session_id, question, correct_answer, student_answer, topic,
         is_resolved, origin, item_key, source_ids, rubric_point_id)
      values
        (v_user, v_point_material, v_session_id, v_question,
         pg_catalog.left(v_title || case when v_quote <> '' then '. ' || v_label || ': «' || v_quote || '»' else '' end, 1000),
         coalesce(nullif(v_point ->> 'student_quote', ''), '(не названо)'),
         pg_catalog.left(v_subject, 200), false, 'oral_ticket',
         'oral:' || v_hash || ':' || pg_catalog.left(public.meldy_question_hash(v_title), 12),
         v_sources, v_point_id)
      on conflict (user_id, item_key) where item_key is not null and not is_resolved
      do update set student_answer = excluded.student_answer, exam_session_id = excluded.exam_session_id
      returning (xmax = 0) into v_inserted;
      if v_inserted then
        v_added := v_added + 1;
      else
        v_existing := v_existing + 1;
      end if;
    end if;
  end loop;

  if coalesce(p_attempt ->> 'make_card', '') = 'true' and v_followup is not null
     and v_followup ->> 'status' <> 'covered' then
    select value into v_followup_point
      from pg_catalog.jsonb_array_elements(v_points)
     where value ->> 'id' = v_followup ->> 'point_id'
     limit 1;
    v_card_material := coalesce((v_followup_point ->> 'material_id')::uuid, v_material);
    v_card_question := v_followup ->> 'question';
    if v_card_material is not null and pg_catalog.char_length(v_card_question) >= 5
       and not exists (select 1 from public.flashcard_progress f
                       where f.user_id = v_user and f.material_id = v_card_material and f.question = v_card_question) then
      v_quote := v_followup_point ->> 'source_quote';
      v_label := coalesce(nullif(v_followup_point ->> 'source_label', ''), 'Лекция');
      insert into public.flashcard_progress
        (user_id, material_id, question, answer, origin, source_ids, next_review, interval_days, repetitions)
      values
        (v_user, v_card_material, v_card_question,
         pg_catalog.left(coalesce(nullif(v_followup ->> 'expected', ''), v_followup_point ->> 'title', '')
           || case when v_quote <> '' then E'\n\n' || v_label || ': «' || v_quote || '»' else '' end, 2000),
         'oral_followup',
         coalesce(array(select pg_catalog.jsonb_array_elements_text(v_followup_point -> 'source_ids')), '{}'::text[]),
         pg_catalog.now() + interval '1 day', 1, 0);
      v_card := true;
    end if;
  end if;

  return pg_catalog.jsonb_build_object('session_id', v_session_id, 'duplicate', false,
    'events', v_events, 'mistakes_added', v_added, 'mistakes_existing', v_existing, 'card_added', v_card);
end;
$fn$;

revoke all on function public.review_flashcard(uuid, integer, text, date, uuid) from public, anon;
revoke all on function public.record_quiz_attempt(jsonb) from public, anon;
revoke all on function public.record_oral_attempt(jsonb) from public, anon;
grant execute on function public.review_flashcard(uuid, integer, text, date, uuid) to authenticated;
grant execute on function public.record_quiz_attempt(jsonb) to authenticated;
grant execute on function public.record_oral_attempt(jsonb) to authenticated;
