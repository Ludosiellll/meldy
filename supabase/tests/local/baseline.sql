-- APPROXIMATION OF THE LIVE SCHEMA FOR LOCAL TESTS ONLY; NEVER RUN AGAINST THE LIVE PROJECT.
-- A Supabase-like baseline for rehearsing *_hackathon_journal_exams_oral.sql on a plain local
-- PostgreSQL 16+ database created with UTF8 encoding (an SQL_ASCII database breaks the Cyrillic
-- question normalisation): the anon / authenticated / service_role roles, a minimal auth schema
-- with auth.uid() read from request.jwt.claim.sub, Supabase's default privileges, the four old
-- tables the migration changes (materials, flashcard_progress, exam_sessions, mistake_diary) as
-- quoted from live metadata in the hackathon specs, and a few fixture rows for two users.
-- Column facts of the four old tables were checked against live metadata on 2026-10-03 (the
-- post-apply report of 20261003083154); exam_sessions.duration_seconds is NOT NULL DEFAULT 0 there.
-- Order: this file, then the migration (twice, to prove it is re-runnable), then
-- supabase/tests/local/journal_rpc_behaviour.sql and supabase/tests/journal_exams_rls.sql.

-- Roles (exist on Supabase already).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

-- Schema baseline.
-- Supabase-like baseline (approximation of live schema facts quoted in specs / update_all_code.py)
create schema auth;
create table auth.users(id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '', subject text not null default '',
  original_text text not null default '', summary_json jsonb, flashcards_json jsonb, quiz_json jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now());
alter table public.materials enable row level security;
create policy "Users can read own materials" on public.materials for select using (auth.uid() = user_id or is_public);
create policy "Users can insert own materials" on public.materials for insert with check (auth.uid() = user_id);
create policy "Users can update own materials" on public.materials for update using (auth.uid() = user_id);
create policy "Users can delete own materials" on public.materials for delete using (auth.uid() = user_id);

create table public.flashcard_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  question text not null default '', answer text not null default '',
  ease_factor real not null default 2.5, interval_days int not null default 1,
  repetitions int not null default 0, next_review timestamptz not null default now(),
  last_reviewed_at timestamptz);
alter table public.flashcard_progress enable row level security;
create policy "Users can read own progress" on public.flashcard_progress for select using (auth.uid() = user_id);
create policy "Users can insert own progress" on public.flashcard_progress for insert with check (auth.uid() = user_id);
create policy "Users can update own progress" on public.flashcard_progress for update using (auth.uid() = user_id);
create policy "Users can delete own progress" on public.flashcard_progress for delete using (auth.uid() = user_id);

create table public.exam_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  subject text not null default '', questions_json jsonb not null default '[]',
  total_questions int not null default 0, score int not null default 0,
  duration_seconds int not null default 0,
  status text not null default 'in_progress' check (status in ('in_progress','completed')),
  created_at timestamptz not null default now(), completed_at timestamptz);
alter table public.exam_sessions enable row level security;
create policy "Users can manage own exam sessions" on public.exam_sessions for all using (auth.uid() = user_id);

create table public.mistake_diary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid references public.materials(id) on delete set null,
  exam_session_id uuid references public.exam_sessions(id) on delete set null,
  question text not null, correct_answer text not null,
  student_answer text not null default '', topic text not null default '',
  is_resolved boolean not null default false, resolved_at timestamptz,
  created_at timestamptz not null default now());
alter table public.mistake_diary enable row level security;
create policy "Users can manage own mistakes" on public.mistake_diary for all using (auth.uid() = user_id);

insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001'), ('bbbbbbbb-0000-0000-0000-000000000002');
insert into public.materials(id, user_id, title, subject, original_text) values
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','Денежный рынок','Макроэкономика','Текст лекции'),
 ('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-000000000002','Чужая лекция','Физика','Текст');
insert into public.flashcard_progress(id, user_id, material_id, question, answer) values
 ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Что такое ставка?','Цена денег'),
 ('c0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Что такое ВВП?','Сумма');
insert into public.mistake_diary(user_id, question, correct_answer) values ('aaaaaaaa-0000-0000-0000-000000000001','old q','old a');
