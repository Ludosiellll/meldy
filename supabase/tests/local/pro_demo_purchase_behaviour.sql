-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour test of *_pro_demo_purchase.sql on the local baseline:
-- supabase/tests/local/baseline.sql, supabase/tests/local/ai_quota_baseline.sql (A free, B PRO from the old
-- self-service toggle), 20261005031722_ai_quota_lockdown.sql (merges the baseline's duplicate day rows, which
-- 20261004205613 refuses), 20261004205613_ai_quota_server.sql, 20261005031722_ai_quota_lockdown.sql again,
-- `revoke select on public.profiles from anon` (live since 20260924061025), then 20261005120000_pro_demo_purchase.sql
-- (twice, to prove it is re-runnable), then this file, then supabase/tests/pro_demo_purchase.sql. C is added here: an
-- account without a profile row. Runs as role authenticated with request.jwt.claim.sub switching between users, and
-- as anon. Everything happens in one transaction that rolls back; a failure raises an exception, success prints
-- PRO DEMO PASSED. Assertions are NULL-safe (IS DISTINCT FROM): a missing row fails.
-- Checks:
--   * the data fix switched off B's leftover PRO flag (no pro_since), and the daily limit followed (100);
--   * A takes PRO: start_pro_demo returns pro true and the time; A's row has is_pro and pro_since; the daily limit
--     of ai_quota_status and consume_ai_units is 1000 at once; B's row is untouched;
--   * nobody sets is_pro or pro_since by hand (42501), on the own row or another's;
--   * the data fix run again leaves demo PRO alone;
--   * A stops PRO: stop_pro_demo returns pro false; is_pro false, pro_since NULL; the limit is 100 again; A can take
--     the demo again;
--   * the kill switch of the migration's header: start_pro_demo refuses with 'PRO demo closed', stop_pro_demo works;
--   * an account without a profile row gets P0002 and nothing changes; anon gets 42501 from both functions.
begin;

insert into auth.users values ('cccccccc-0000-0000-0000-000000000003');

create or replace function pg_temp.expect_error(p_sql text, p_state text, p_what text)
returns void language plpgsql as $fn$
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_state;
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if sqlstate is distinct from p_state then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_state;
    end if;
end;
$fn$;
grant execute on function pg_temp.expect_error(text, text, text) to authenticated, anon;

-- The data fix: B's flag came from the old toggle (no pro_since), so it is off.
do $$
begin
  if (select is_pro from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002') is distinct from false then
    raise exception 'FAILED: B''s leftover PRO flag is still on';
  end if;
  if exists (select 1 from public.profiles where is_pro and pro_since is null) then
    raise exception 'FAILED: a PRO flag without pro_since is left';
  end if;
end $$;

-- A takes PRO.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $$
declare r jsonb; v_pro boolean; v_since timestamptz; q jsonb;
begin
  q := public.ai_quota_status();
  if (q->>'limit')::int is distinct from 100 or q->>'pro' is distinct from 'false' then
    raise exception 'FAILED: A''s day before the demo: %', q;
  end if;
  r := public.start_pro_demo();
  if r->>'pro' is distinct from 'true' or r->>'since' is null then
    raise exception 'FAILED: start_pro_demo answer: %', r;
  end if;
  select is_pro, pro_since into v_pro, v_since from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_pro is distinct from true or v_since is null or v_since < now() - interval '1 minute'
     or (r->>'since')::timestamptz is distinct from v_since then
    raise exception 'FAILED: A''s row after start (is_pro %, pro_since %, answer %)', v_pro, v_since, r;
  end if;
  q := public.ai_quota_status();
  if (q->>'limit')::int is distinct from 1000 or q->>'pro' is distinct from 'true' then
    raise exception 'FAILED: A''s day with the demo: %', q;
  end if;
  -- 12 units used today (the baseline's two rows of A); 900 more fit only under the PRO day.
  q := public.consume_ai_units(900, 'lecture');
  if q->>'allowed' is distinct from 'true' or (q->>'limit')::int is distinct from 1000 then
    raise exception 'FAILED: A charges under the PRO day: %', q;
  end if;
end $$;

-- Nobody writes PRO by hand.
select pg_temp.expect_error(
  $q$update public.profiles set is_pro = true where id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$,
  '42501', 'A sets is_pro');
select pg_temp.expect_error(
  $q$update public.profiles set pro_since = now() where id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$,
  '42501', 'A sets pro_since');
select pg_temp.expect_error(
  $q$update public.profiles set is_pro = true, pro_since = now() where id = 'bbbbbbbb-0000-0000-0000-000000000002'$q$,
  '42501', 'A sets PRO for B');

-- B is untouched by A's demo and still on the free day.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $$
declare q jsonb;
begin
  q := public.ai_quota_status();
  if (q->>'limit')::int is distinct from 100 or q->>'pro' is distinct from 'false' then
    raise exception 'FAILED: B''s day while A is on the demo: %', q;
  end if;
end $$;
reset role;
do $$
begin
  if (select is_pro or pro_since is not null from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002') is distinct from false then
    raise exception 'FAILED: A''s start changed B''s row';
  end if;
end $$;

-- The data fix again (a re-run of the migration): demo PRO stays.
update public.profiles set is_pro = false where is_pro and pro_since is null;
do $$
begin
  if (select is_pro from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001') is distinct from true then
    raise exception 'FAILED: the data fix took A''s demo PRO';
  end if;
end $$;

-- A stops PRO, and can take it again.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $$
declare r jsonb; v_pro boolean; v_since timestamptz; q jsonb;
begin
  r := public.stop_pro_demo();
  if r is distinct from '{"pro": false}'::jsonb then
    raise exception 'FAILED: stop_pro_demo answer: %', r;
  end if;
  select is_pro, pro_since into v_pro, v_since from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_pro is distinct from false or v_since is not null then
    raise exception 'FAILED: A''s row after stop (is_pro %, pro_since %)', v_pro, v_since;
  end if;
  q := public.ai_quota_status();
  if (q->>'limit')::int is distinct from 100 or q->>'pro' is distinct from 'false' then
    raise exception 'FAILED: A''s day after stop: %', q;
  end if;
  q := public.consume_ai_units(1, 'chatMessage');
  if q->>'allowed' is distinct from 'false' then
    raise exception 'FAILED: A charges past the free day after stop: %', q;
  end if;
  r := public.start_pro_demo();
  if r->>'pro' is distinct from 'true' then
    raise exception 'FAILED: A takes the demo again: %', r;
  end if;
end $$;

-- The kill switch, exactly as the migration's header gives it.
reset role;
create or replace function public.start_pro_demo() returns jsonb language plpgsql security definer
  set search_path = public, pg_temp as $$ begin raise exception 'PRO demo closed'; end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $$
begin
  perform public.start_pro_demo();
  raise exception 'FAILED: the closed demo still switched PRO on';
exception
  when others then
    if sqlerrm is distinct from 'PRO demo closed' then
      raise exception 'FAILED: the closed demo says % (%), expected PRO demo closed', sqlerrm, sqlstate;
    end if;
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $$
begin
  if public.stop_pro_demo() is distinct from '{"pro": false}'::jsonb then
    raise exception 'FAILED: stop_pro_demo with the demo closed';
  end if;
end $$;

-- C has no profile row: nothing to switch.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
select pg_temp.expect_error($q$select public.stop_pro_demo()$q$, 'P0002', 'C stops PRO without a profile');

-- anon: refused by the auth.uid() guard (anon keeps the default EXECUTE), before any row is touched.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  perform public.stop_pro_demo();
  raise exception 'FAILED: anon stopped PRO';
exception
  when others then
    if sqlstate is distinct from '42501' or sqlerrm not like '%no signed-in user%' then
      raise exception 'FAILED: anon stops PRO — % (%), expected the guard', sqlerrm, sqlstate;
    end if;
end $$;
reset role;
-- The original start_pro_demo for anon and for C (the kill switch above replaced it in this transaction).
create or replace function public.start_pro_demo()
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_since timestamptz;
begin
  if v_uid is null then
    raise exception 'start_pro_demo: no signed-in user' using errcode = '42501';
  end if;
  update public.profiles p set is_pro = true, pro_since = pg_catalog.now() where p.id = v_uid
  returning p.pro_since into v_since;
  if not found then
    raise exception 'start_pro_demo: no profile for this account' using errcode = 'P0002';
  end if;
  return pg_catalog.jsonb_build_object('pro', true, 'since', v_since);
end
$fn$;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  perform public.start_pro_demo();
  raise exception 'FAILED: anon took PRO';
exception
  when others then
    if sqlstate is distinct from '42501' or sqlerrm not like '%no signed-in user%' then
      raise exception 'FAILED: anon takes PRO — % (%), expected the guard', sqlerrm, sqlstate;
    end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
select pg_temp.expect_error($q$select public.start_pro_demo()$q$, 'P0002', 'C takes PRO without a profile');
reset role;
do $$
begin
  if exists (select 1 from public.profiles where is_pro) then
    raise exception 'FAILED: someone is PRO after anon and C';
  end if;
end $$;

select 'PRO DEMO PASSED' as result;
rollback;
