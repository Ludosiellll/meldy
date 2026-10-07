-- oral_answer_texts
-- Repo file: supabase/migrations/20261007103621_oral_answer_texts.sql (the orchestrator applies it).
--
-- «Текст ответа с согласия» (notes: 10_Project/CodingFest_11_Improvement_Plan_2026-10-07). The blind check of
-- Meldy's accuracy needs the whole text of an answer; the server kept only student_quote of at most 160
-- characters per point (record_oral_attempt, 20261003083154), the whole answer lived only in the browser
-- (meldy_answer_draft_*). With the student's consent the client now stores it after a successful save:
--   1. public.oral_answer_consent — one row per account: granted (true or false), version of the consent text
--      the student answered, updated_at (always the server's time, set by a trigger). The client inserts or
--      updates its own row (the switch in «Профиль», the question on the exam page); nobody reads another's.
--   2. public.oral_answer_texts — the text of one checked answer: the exam, the question hash, the attempt
--      (attempt_id of record_oral_attempt, session_id of its exam_sessions row), how it was given
--      (speech / text / mixed), the text (up to 20 000 characters), the consent version it was stored under,
--      created_at (always the server's time). Own rows only: insert, read, delete; nobody may change a text
--      (no UPDATE grant and no UPDATE policy). An insert needs this account's granted consent of the same
--      version and, when they are named, an own exam and an own exam_sessions row. One text per attempt
--      (unique user_id, attempt_id): a retried save stores nothing twice.
-- The rows keep user_id (RLS needs it); the owner's export (docs/oral-answer-texts-export.sql) shows a salted
-- hash instead and no name.
-- Deleting the exam keeps its texts (exam_id becomes NULL, as the answers stay in the history); deleting the
-- attempt's exam_sessions row or the account deletes them.
-- Additive and re-runnable: two new tables, one trigger function, policies created only when missing; every
-- REVOKE / GRANT names a new table. No existing object, grant, policy or row is touched.
-- Rollback: supabase/rollback/20261007103621_oral_answer_texts_down.sql. Contract check after the apply:
-- supabase/tests/oral_answer_texts.sql. Local behaviour test: supabase/tests/local/oral_answer_texts_behaviour.sql
-- (after supabase/tests/local/baseline.sql and 20261003083154_hackathon_journal_exams_oral.sql).

-- 1. Consent: one row per account.
create table if not exists public.oral_answer_consent (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  granted boolean not null,
  version smallint not null default 1,
  updated_at timestamptz not null default now(),
  constraint oral_answer_consent_version_check check (version between 1 and 100)
);

create or replace function public.oral_answer_consent_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$fn$;

create or replace trigger oral_answer_consent_set_updated_at
  before insert or update on public.oral_answer_consent
  for each row execute function public.oral_answer_consent_set_updated_at();

-- 2. Texts of answers.
create table if not exists public.oral_answer_texts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exam_id uuid references public.exams(id) on delete set null,
  question_hash text not null,
  attempt_id text not null,
  session_id uuid references public.exam_sessions(id) on delete cascade,
  input text not null default 'text',
  text text not null,
  consent_version smallint not null,
  created_at timestamptz not null default now(),
  constraint oral_answer_texts_hash_check check (question_hash ~ '^[0-9a-f]{32}$'),
  constraint oral_answer_texts_attempt_check check (attempt_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  constraint oral_answer_texts_input_check check (input in ('speech', 'text', 'mixed')),
  constraint oral_answer_texts_text_check check (char_length(btrim(text)) >= 1 and char_length(text) <= 20000),
  constraint oral_answer_texts_consent_check check (consent_version between 1 and 100),
  constraint oral_answer_texts_attempt_unique unique (user_id, attempt_id)
);
create index if not exists oral_answer_texts_user_idx on public.oral_answer_texts (user_id, created_at desc);
create index if not exists oral_answer_texts_session_idx on public.oral_answer_texts (session_id);
create index if not exists oral_answer_texts_exam_idx on public.oral_answer_texts (exam_id);

-- 3. Access: own rows only; the client never writes created_at / updated_at; anon gets nothing.
alter table public.oral_answer_consent enable row level security;
alter table public.oral_answer_texts enable row level security;
revoke all on table public.oral_answer_consent, public.oral_answer_texts from public, anon, authenticated;
grant select, delete on table public.oral_answer_consent to authenticated;
grant insert (user_id, granted, version) on table public.oral_answer_consent to authenticated;
grant update (granted, version) on table public.oral_answer_consent to authenticated;
grant select, delete on table public.oral_answer_texts to authenticated;
grant insert (user_id, exam_id, question_hash, attempt_id, session_id, input, text, consent_version)
  on table public.oral_answer_texts to authenticated;

do $do$
begin
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'oral_answer_consent' and policyname = 'Oral answer consent: read own') then
    create policy "Oral answer consent: read own" on public.oral_answer_consent
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'oral_answer_consent' and policyname = 'Oral answer consent: add own') then
    create policy "Oral answer consent: add own" on public.oral_answer_consent
      for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'oral_answer_consent' and policyname = 'Oral answer consent: change own') then
    create policy "Oral answer consent: change own" on public.oral_answer_consent
      for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'oral_answer_consent' and policyname = 'Oral answer consent: delete own') then
    create policy "Oral answer consent: delete own" on public.oral_answer_consent
      for delete to authenticated using ((select auth.uid()) = user_id);
  end if;

  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'oral_answer_texts' and policyname = 'Oral answer texts: read own') then
    create policy "Oral answer texts: read own" on public.oral_answer_texts
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'oral_answer_texts' and policyname = 'Oral answer texts: add own with consent') then
    create policy "Oral answer texts: add own with consent" on public.oral_answer_texts
      for insert to authenticated with check (
        (select auth.uid()) = user_id
        and exists (select 1 from public.oral_answer_consent c
                     where c.user_id = (select auth.uid()) and c.granted and c.version = consent_version)
        and (exam_id is null
             or exists (select 1 from public.exams e where e.id = exam_id and e.user_id = (select auth.uid())))
        and (session_id is null
             or exists (select 1 from public.exam_sessions s where s.id = session_id and s.user_id = (select auth.uid())))
      );
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'oral_answer_texts' and policyname = 'Oral answer texts: delete own') then
    create policy "Oral answer texts: delete own" on public.oral_answer_texts
      for delete to authenticated using ((select auth.uid()) = user_id);
  end if;
end
$do$;

comment on table public.oral_answer_consent is
  'Consent to store the full text of oral answers for the blind accuracy check: one row per account.';
comment on table public.oral_answer_texts is
  'Full text of a checked oral answer, stored with consent (oral_answer_consent); own rows, no updates.';
