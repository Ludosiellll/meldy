-- APPROXIMATION OF THE LIVE SCHEMA FOR LOCAL TESTS ONLY; NEVER RUN AGAINST THE LIVE PROJECT.
-- What *_containers.sql meets on the live project but the repo's local baselines lack. Runs after (the order of
-- containers_run_all.sh): baseline.sql, 20261003083154_hackathon_journal_exams_oral.sql, 20261005143420_cheat_sheet.sql,
-- exam_shares_baseline.sql, 20261007110403_exam_shares.sql, 20261007110457_exam_shares_revokes.sql,
-- auth.users.created_at, 20261005042323_app_telemetry.sql, ai_quota_baseline.sql, 20261004205613_ai_quota_server.sql,
-- 20261005031722_ai_quota_lockdown.sql, 20261007103621_oral_answer_texts.sql.
-- Adds: public.profiles with full_name and is_pro (live: 20260924061025 reads p.full_name, 20261004205613 reads
-- p.is_pro; ai_quota_baseline.sql already makes the table, this file only fills what is missing) with the names the
-- container checks expect, and two more accounts (D without a name, E).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  is_pro boolean default false
);
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists is_pro boolean default false;
alter table public.profiles enable row level security;
insert into auth.users (id) values ('cccccccc-0000-0000-0000-000000000003'), ('dddddddd-0000-0000-0000-000000000004'),
  ('eeeeeeee-0000-0000-0000-000000000005')
  on conflict do nothing;
insert into public.profiles (id, full_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Автор А'), ('bbbbbbbb-0000-0000-0000-000000000002', 'Борис'),
  ('cccccccc-0000-0000-0000-000000000003', 'Вера'), ('dddddddd-0000-0000-0000-000000000004', '')
  on conflict (id) do update set full_name = excluded.full_name;
