-- Exam container: the page of an exam that is not the caller's any more answers «not found» calmly (third live check,
-- 2026-10-10: the address of a deleted or left exam made two requests that answered 500, two errors in the console).
-- The page reads container_summary and plan_inputs(…, p_container_id) together (frontend/src/lib/containers/hooks.ts),
-- and for an exam the caller does not have both raised P0002 ('container not found'): PostgREST answers every P0
-- SQLSTATE but P0001 with HTTP 500, so a deleted, left or removed exam read as a server failure, in the browser and in
-- the API's log. Now both answer null (HTTP 200) for such an exam — the same test as the cores' (role_in) — and the page
-- (frontend/src/api/containers.ts) reads null as «Этого экзамена больше нет в вашем списке», as it read P0002.
-- Unchanged: without a signed-in user both still raise 28000; plan_inputs without an exam; the private cores
-- (container_summary_for, plan_inputs_for: the Telegram bot's) still raise P0002. The functions are STABLE: the test and
-- the read see one snapshot. Deploy the site first (its client reads both answers). Re-runnable; CREATE OR REPLACE keeps
-- the functions' grants (20261009093501_containers_revokes.sql). Check: supabase/tests/containers_not_found.sql.
-- Rollback: supabase/rollback/20261011100000_containers_not_found_null_down.sql.
create or replace function public.container_summary(p_container_id uuid, p_local_date text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- Not the caller's exam (deleted, left, removed, never theirs): null, not P0002 (HTTP 500).
  if meldy_private.role_in(auth.uid(), p_container_id) is null then
    return null;
  end if;
  return meldy_private.container_summary_for(auth.uid(), p_container_id, meldy_private.clamp_day(p_local_date));
end;
$fn$;

create or replace function public.plan_inputs(p_local_date text default null, p_container_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- One exam that is not the caller's: null, as container_summary answers it.
  if p_container_id is not null and meldy_private.role_in(auth.uid(), p_container_id) is null then
    return null;
  end if;
  return meldy_private.plan_inputs_for(auth.uid(), meldy_private.clamp_day(p_local_date), p_container_id);
end;
$fn$;
