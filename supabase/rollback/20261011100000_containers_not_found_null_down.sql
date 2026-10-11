-- Rollback of 20261011100000_containers_not_found_null.sql: container_summary and plan_inputs as in
-- 20261010130000_containers_frozen_pace.sql / 20261009093500_containers.sql (an exam that is not the caller's raises
-- P0002 from the cores again). The client reads both answers. Re-runnable; CREATE OR REPLACE keeps the grants.
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
  return meldy_private.plan_inputs_for(auth.uid(), meldy_private.clamp_day(p_local_date), p_container_id);
end;
$fn$;
