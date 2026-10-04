-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour test of *_pro_interest.sql on the local
-- baseline: supabase/tests/local/baseline.sql, then 20261004204007_pro_interest.sql (twice, to prove
-- it is re-runnable), then this file. Users A and B come from the baseline, C is added here. Runs as
-- role authenticated with request.jwt.claim.sub switching between them, and finally as anon.
-- Everything happens in one transaction that rolls back; a failure raises an exception, success
-- prints PRO INTEREST PASSED. Assertions are NULL-safe (IS DISTINCT FROM): a missing row fails.
-- Checks:
--   * a student adds their own row (user_id given, or left to its default auth.uid()) and reads it
--     back; a second add is a unique violation (23505, which the client reads as «already noted»);
--   * no row for someone else (RLS, 42501), no reason outside pricing/limit/meter (23514), no
--     client-chosen created_at (column privilege, 42501), no UPDATE or DELETE of the own row (42501);
--   * every student reads only their own row; anon can neither read nor add (42501);
--   * deleting the account deletes its row (on delete cascade).
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

-- A: adds the own row, reads it back, cannot add it twice or touch it.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
insert into public.pro_interest (user_id, reason) values ('aaaaaaaa-0000-0000-0000-000000000001', 'pricing');
do $$
declare v_rows int; v_reason text; v_created timestamptz;
begin
  select count(*), max(reason), max(created_at) into v_rows, v_reason, v_created from public.pro_interest;
  if v_rows is distinct from 1 or v_reason is distinct from 'pricing' or v_created is null
     or v_created < now() - interval '1 minute' then
    raise exception 'FAILED: A reads back own row (rows %, reason %, created %)', v_rows, v_reason, v_created;
  end if;
end $$;
select pg_temp.expect_error(
  $q$insert into public.pro_interest (user_id, reason) values ('aaaaaaaa-0000-0000-0000-000000000001', 'limit')$q$,
  '23505', 'A adds a second row');
select pg_temp.expect_error(
  $q$insert into public.pro_interest (user_id, reason) values ('bbbbbbbb-0000-0000-0000-000000000002', 'pricing')$q$,
  '42501', 'A adds a row for B');
select pg_temp.expect_error(
  $q$insert into public.pro_interest (user_id, reason, created_at) values ('aaaaaaaa-0000-0000-0000-000000000001', 'pricing', '2020-01-01')$q$,
  '42501', 'A chooses created_at');
select pg_temp.expect_error(
  $q$update public.pro_interest set reason = 'meter' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$,
  '42501', 'A changes the own row');
select pg_temp.expect_error(
  $q$delete from public.pro_interest where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$,
  '42501', 'A deletes the own row');

-- B: an invalid reason is refused; then B adds a row and sees only it.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
select pg_temp.expect_error(
  $q$insert into public.pro_interest (user_id, reason) values ('bbbbbbbb-0000-0000-0000-000000000002', 'checkout')$q$,
  '23514', 'B gives an unknown reason');
select pg_temp.expect_error(
  $q$insert into public.pro_interest (user_id) values ('bbbbbbbb-0000-0000-0000-000000000002')$q$,
  '23502', 'B gives no reason');
do $$
declare v_rows int;
begin
  select count(*) into v_rows from public.pro_interest;
  if v_rows is distinct from 0 then raise exception 'FAILED: B sees A''s row (% rows)', v_rows; end if;
end $$;
insert into public.pro_interest (user_id, reason) values ('bbbbbbbb-0000-0000-0000-000000000002', 'limit');
do $$
declare v_rows int; v_user uuid;
begin
  select count(*), max(user_id::text)::uuid into v_rows, v_user from public.pro_interest;
  if v_rows is distinct from 1 or v_user is distinct from 'bbbbbbbb-0000-0000-0000-000000000002'::uuid then
    raise exception 'FAILED: B reads only own row (rows %, user %)', v_rows, v_user;
  end if;
end $$;

-- C: leaves user_id to its default (auth.uid()).
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
insert into public.pro_interest (reason) values ('meter');
do $$
declare v_user uuid;
begin
  select user_id into v_user from public.pro_interest;
  if v_user is distinct from 'cccccccc-0000-0000-0000-000000000003'::uuid then
    raise exception 'FAILED: C''s row takes user_id from auth.uid() (got %)', v_user;
  end if;
end $$;

-- anon: nothing.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_error($q$select count(*) from public.pro_interest$q$, '42501', 'anon reads');
select pg_temp.expect_error(
  $q$insert into public.pro_interest (user_id, reason) values ('aaaaaaaa-0000-0000-0000-000000000001', 'pricing')$q$,
  '42501', 'anon adds a row');

-- The account goes, its row goes with it.
reset role;
delete from auth.users where id = 'cccccccc-0000-0000-0000-000000000003';
do $$
begin
  if (select count(*) from public.pro_interest) is distinct from 2::bigint then
    raise exception 'FAILED: rows after deleting C (expected A and B)';
  end if;
  if exists (select 1 from public.pro_interest where user_id = 'cccccccc-0000-0000-0000-000000000003') then
    raise exception 'FAILED: C''s row outlived the account';
  end if;
end $$;

select 'PRO INTEREST PASSED' as result;
rollback;
