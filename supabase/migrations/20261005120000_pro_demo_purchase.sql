-- pro_demo_purchase
-- Repo file: supabase/migrations/20261005120000_pro_demo_purchase.sql. Written on 2026-10-05; the orchestrator
-- applies it (the package that wrote it did not).
--
-- «Купить PRO» in the PRO window (frontend/src/components/pro/ProWindowDialog.tsx) is a demo. There is no payment
-- provider, so the button switches PRO on for free and at once, and the window says so under the button: «Демо:
-- оплата не подключена — PRO включится бесплатно и сразу.» Owner, 2026-10-05: «нажимаешь на купить и тебе ее выдаст
-- просто бесплатно». Nothing imitates a payment (standing rule «не имитировать оплату»): no price, no card fields,
-- no receipt.
--
-- What it does:
--   1. profiles.pro_since timestamptz: when the account took PRO through the demo; NULL = not through the demo.
--      Clients cannot write it: profiles has column-scoped UPDATE grants only (20260924055024), and a new column
--      gets none. They read it on their own row only (RLS «Users can read own profile»; anon has no SELECT).
--   2. Data fix: PRO flags left over from the old app's self-service toggle (removed 2026-09-24, decision «Client-
--      managed profile entitlement is not trusted») are switched off. There has never been a payment provider, so
--      nobody paid for them; they are the rows with is_pro and no pro_since. Re-running this file leaves demo PRO
--      (pro_since set) alone.
--   3. public.start_pro_demo() -> {"pro": true, "since": <timestamptz>}: is_pro = true, pro_since = now() on the
--      caller's own profile row.
--   4. public.stop_pro_demo() -> {"pro": false}: is_pro = false, pro_since = NULL on the caller's own row
--      («Отключить PRO» in the window, so the demo can be repeated).
--   Both are SECURITY DEFINER with search_path = public, pg_temp, touch only the row of auth.uid(), raise 42501 when
--   it is NULL and P0002 when the account has no profile row. The daily AI limit follows at once: consume_ai_units
--   and ai_quota_status read profiles.is_pro (100 units free, 1000 with PRO; 20261004205613_ai_quota_server).
--
-- Access: GRANT EXECUTE to authenticated. This file has no REVOKE (the database connector holds REVOKE statements
-- for a human), so PUBLIC and anon keep Supabase's default EXECUTE on new functions. The auth.uid() guard is what
-- keeps anon out: an anon (or service) token carries no user id, so both functions raise before touching any row.
--
-- Kill switch (close the free demo, keep everything else): replace start_pro_demo with a body that refuses —
--   create or replace function public.start_pro_demo() returns jsonb language plpgsql security definer
--     set search_path = public, pg_temp as $$ begin raise exception 'PRO demo closed'; end $$;
-- The window then says «Бесплатное демо PRO закрыто.» and stop_pro_demo keeps working; the contract check reports
-- demo_open: false. Running this file again reopens the demo (CREATE OR REPLACE). To also take PRO back from the
-- accounts that took it through the demo:
--   update public.profiles set is_pro = false, pro_since = null where pro_since is not null;
--
-- Additive apart from the data fix: a new nullable column, two new functions and their grants; no existing grant,
-- policy or function is changed. Re-runnable (IF NOT EXISTS, CREATE OR REPLACE; the data fix is idempotent).
-- Rollback: supabase/rollback/20261005120000_pro_demo_purchase_down.sql. Contract check after the apply:
-- supabase/tests/pro_demo_purchase.sql. Local rehearsal (PostgreSQL 16, 2026-10-05: behaviour test passed, contract
-- green after the apply and with the kill switch, the ai quota contract still green, rollback and re-apply clean):
-- supabase/tests/local/baseline.sql, supabase/tests/local/ai_quota_baseline.sql, 20261005031722_ai_quota_lockdown.sql
-- (it merges the baseline's duplicate day rows that 20261004205613 refuses), 20261004205613_ai_quota_server.sql,
-- 20261005031722_ai_quota_lockdown.sql again, `revoke select on public.profiles from anon` (live since
-- 20260924061025; the local baseline lacks it), this file twice, supabase/tests/local/pro_demo_purchase_behaviour.sql,
-- supabase/tests/pro_demo_purchase.sql.

-- 1. When the demo PRO was taken.
alter table public.profiles add column if not exists pro_since timestamptz;

comment on column public.profiles.pro_since is
  'When the account took PRO through the free demo (start_pro_demo); NULL = not through the demo.';

-- 2. PRO flags left over from the old self-service toggle: nobody paid for them.
update public.profiles set is_pro = false where is_pro and pro_since is null;

-- 3. «Купить PRO»: the caller's own row only.
create or replace function public.start_pro_demo()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_since timestamptz;
begin
  if v_uid is null then
    raise exception 'start_pro_demo: no signed-in user' using errcode = '42501';
  end if;
  update public.profiles p
     set is_pro = true,
         pro_since = pg_catalog.now()
   where p.id = v_uid
  returning p.pro_since into v_since;
  if not found then
    raise exception 'start_pro_demo: no profile for this account' using errcode = 'P0002';
  end if;
  return pg_catalog.jsonb_build_object('pro', true, 'since', v_since);
end
$fn$;

-- 4. «Отключить PRO»: back to the free day, so the demo can be taken again.
create or replace function public.stop_pro_demo()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'stop_pro_demo: no signed-in user' using errcode = '42501';
  end if;
  update public.profiles p
     set is_pro = false,
         pro_since = null
   where p.id = v_uid;
  if not found then
    raise exception 'stop_pro_demo: no profile for this account' using errcode = 'P0002';
  end if;
  return pg_catalog.jsonb_build_object('pro', false);
end
$fn$;

comment on function public.start_pro_demo() is
  'Free PRO demo (no payment provider): sets is_pro and pro_since on the caller''s own profile. Kill switch: replace the body with raise exception ''PRO demo closed''.';
comment on function public.stop_pro_demo() is
  'Ends the free PRO demo for the caller: is_pro = false, pro_since = NULL on their own profile.';

grant execute on function public.start_pro_demo() to authenticated;
grant execute on function public.stop_pro_demo() to authenticated;
