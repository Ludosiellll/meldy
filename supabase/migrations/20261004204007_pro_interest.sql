-- pro_interest
-- Repo file: supabase/migrations/20261004204007_pro_interest.sql (the orchestrator applies it).
-- «Сообщить, когда появится» in the PRO window (frontend/src/components/pro/ProWindow.tsx): a
-- signed-in student leaves a note that they want PRO once payment exists. One row per account; the
-- reason says where the window was opened from: 'pricing' (the «Тарифы» page), 'limit' (the daily
-- AI limit ran out), 'meter' (the limit meter in the top line).
-- Additive and re-runnable: a new table only (IF NOT EXISTS, policies created only when missing,
-- REVOKE/GRANT repeat safely); no existing object or row is touched.
-- Access: the student may add their own row and read it back; nobody may change or delete it from
-- the client (no UPDATE/DELETE grant and no such policy); anon gets nothing. The client may write
-- only user_id and reason: created_at is always the server's time. service_role keeps Supabase's
-- default privileges (server side, bypasses RLS) so a later server job can read the list.
-- Rollback: supabase/rollback/20261004204007_pro_interest_down.sql. Contract check after the
-- apply: supabase/tests/pro_interest.sql. Local behaviour test: supabase/tests/local/pro_interest_behaviour.sql.

create table if not exists public.pro_interest (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint pro_interest_reason_check check (reason in ('pricing', 'limit', 'meter'))
);

alter table public.pro_interest enable row level security;

revoke all on table public.pro_interest from public, anon, authenticated;
grant select on table public.pro_interest to authenticated;
grant insert (user_id, reason) on table public.pro_interest to authenticated;

do $do$
begin
  if not exists (select 1 from pg_catalog.pg_policies
                 where schemaname = 'public' and tablename = 'pro_interest'
                   and policyname = 'PRO interest: read own') then
    create policy "PRO interest: read own" on public.pro_interest
      for select to authenticated using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies
                 where schemaname = 'public' and tablename = 'pro_interest'
                   and policyname = 'PRO interest: add own') then
    create policy "PRO interest: add own" on public.pro_interest
      for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
end
$do$;
