-- APPROXIMATION OF THE LIVE SCHEMA FOR LOCAL TESTS ONLY; NEVER RUN AGAINST THE LIVE PROJECT.
-- Run after supabase/tests/local/baseline.sql (roles, auth.uid(), auth.users A and B, Supabase's
-- default privileges). Adds what *_ai_quota_server.sql changes, as the orchestrator read it on the
-- live project on 2026-10-04: public.ai_usage(id uuid default uuid_generate_v4(), user_id uuid
-- null, date date not null, requests_count int default 0, created_at timestamptz default now())
-- with the three own-row policies for role public and full DML for anon and authenticated, and a
-- minimal public.profiles with is_pro (B is PRO). Today's rows of A are duplicated on purpose (the
-- old client could insert twice) to prove the merge; A also has a row from yesterday.
-- Order: baseline.sql, this file, 20261004190000_ai_quota_server.sql (twice),
-- ai_quota_behaviour.sql, then supabase/tests/ai_quota_server.sql (contract_ok must be true).
create extension if not exists "uuid-ossp";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  is_pro boolean default false
);
alter table public.profiles enable row level security;
create policy "Profiles: own row" on public.profiles for select using (auth.uid() = id);
revoke insert, update on public.profiles from anon, authenticated;
insert into public.profiles(id, full_name, is_pro) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A', false),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'B', true);

create table public.ai_usage (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid,
  date date not null,
  requests_count integer default 0,
  created_at timestamptz default now()
);
alter table public.ai_usage enable row level security;
create policy "Users can insert own usage" on public.ai_usage for insert with check (auth.uid() = user_id);
create policy "Users can update own usage" on public.ai_usage for update using (auth.uid() = user_id);
create policy "Users can view own usage" on public.ai_usage for select using (auth.uid() = user_id);
grant all on public.ai_usage to anon, authenticated;

insert into public.ai_usage(user_id, date, requests_count, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', (now() at time zone 'utc')::date, 7, now() - interval '2 hours'),
  ('aaaaaaaa-0000-0000-0000-000000000001', (now() at time zone 'utc')::date, 5, now() - interval '1 hour'),
  ('aaaaaaaa-0000-0000-0000-000000000001', (now() at time zone 'utc')::date - 1, 40, now() - interval '1 day'),
  ('bbbbbbbb-0000-0000-0000-000000000002', (now() at time zone 'utc')::date, 990, now() - interval '3 hours'),
  (null, (now() at time zone 'utc')::date, 3, now());
