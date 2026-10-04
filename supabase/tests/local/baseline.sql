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
-- Added for *_jury_trust_reads.sql (2026-10-04): minimal groups / group_members / study_sessions
-- with their owner and teacher read policies (the shapes 20260924061025 leaves behind), so
-- 20260924062645_secure_group_weekly_scores.sql can be created on top of this file; an
-- approximation of the live SELECT policy «Teachers can read exam sessions of their students»
-- (its live text was never read: only its name and command are quoted in the oral-ticket spec);
-- and the supabase_migrations.schema_migrations table that apply_migration writes, so
-- supabase/tests/jury_trust_reads.sql runs here. Order for that migration: this file,
-- 20260924062645, 20261003083154, the new migration (twice), journal_rpc_behaviour.sql,
-- jury_trust_behaviour.sql, jury_trust_reads.sql.

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

-- Classes (approximation): a teacher owns a group, students are its members. The live tables have
-- more columns (name, invite code, nickname, join date); get_group_weekly_scores reads only these.
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '');
alter table public.groups enable row level security;
revoke all on table public.groups from anon;
create policy "Teachers can manage their groups" on public.groups for all to authenticated
  using ((select auth.uid()) = teacher_id) with check ((select auth.uid()) = teacher_id);

create table public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  unique (group_id, student_id));
alter table public.group_members enable row level security;
revoke all on table public.group_members from anon;
create policy "Students can view their memberships" on public.group_members for select to authenticated
  using ((select auth.uid()) = student_id);
create policy "Teachers can view their group members" on public.group_members for select to authenticated
  using (exists (select 1 from public.groups g where g.id = group_id and g.teacher_id = (select auth.uid())));

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date,
  cards_reviewed int not null default 0,
  materials_added int not null default 0);
alter table public.study_sessions enable row level security;
create policy "Users can manage own study sessions" on public.study_sessions for all using (auth.uid() = user_id);

-- Approximation of the live permissive policy (name and command quoted in the oral-ticket spec,
-- body assumed): the teacher of a student's group reads that student's exam sessions.
create policy "Teachers can read exam sessions of their students" on public.exam_sessions for select
  using (exists (select 1 from public.group_members gm join public.groups g on g.id = gm.group_id
                  where gm.student_id = exam_sessions.user_id and g.teacher_id = auth.uid()));

-- Migration history written by apply_migration on Supabase (version, name; read by the reports).
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);

insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001'), ('bbbbbbbb-0000-0000-0000-000000000002');
insert into public.materials(id, user_id, title, subject, original_text) values
 ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','Денежный рынок','Макроэкономика','Текст лекции'),
 ('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-000000000002','Чужая лекция','Физика','Текст');
insert into public.flashcard_progress(id, user_id, material_id, question, answer) values
 ('c0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Что такое ставка?','Цена денег'),
 ('c0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Что такое ВВП?','Сумма');
insert into public.mistake_diary(user_id, question, correct_answer) values ('aaaaaaaa-0000-0000-0000-000000000001','old q','old a');
