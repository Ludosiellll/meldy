-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261014170000_plan_tempo.sql: a
-- student's tempo is 'date' until they choose, their own row keeps 'fast', plan_inputs and container_summary hand it
-- out with the minutes and the days, another student's choice is theirs, and nothing but 'date' / 'fast' is kept.
-- One transaction, rolled back; success prints PLAN TEMPO CHECKS PASSED.
\set ON_ERROR_STOP 1
begin;
create temp table ctx (k text primary key, v text);
grant all on ctx to anon, authenticated, service_role;
create or replace function pg_temp.check(p_ok boolean, p_what text, p_detail jsonb default null)
returns void language plpgsql as $fn$
begin
  if p_ok is not true then raise exception 'FAILED: % %', p_what, coalesce(p_detail::text, ''); end if;
end;
$fn$;
grant execute on function pg_temp.check(boolean, text, jsonb) to anon, authenticated, service_role;
insert into auth.users (id) values ('7e7e7e7e-0000-0000-0000-000000000001'), ('7e7e7e7e-0000-0000-0000-000000000002')
  on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', '7e7e7e7e-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"7e7e7e7e-0000-0000-0000-000000000001"}', true);
do $t$
declare
  r jsonb;
  c uuid;
begin
  r := public.container_create('Шесть вариантов', null, '[{"title":"Вариант 1","topics":[]}]');
  c := (r ->> 'container_id')::uuid;
  insert into ctx values ('c', c::text);
  -- no row yet: the default
  r := public.plan_inputs(null, c);
  perform pg_temp.check(r -> 'containers' -> 0 -> 'settings' ->> 'tempo' = 'date', 'plan_inputs: date before a choice', r -> 'containers' -> 0 -> 'settings');
  r := public.container_summary(c, null);
  perform pg_temp.check(r -> 'settings' ->> 'tempo' = 'date', 'summary: date before a choice', r -> 'settings');
  -- the student's own row (as saveSettings upserts it)
  insert into public.container_plans (container_id, minutes_per_day, study_weekdays, tempo) values (c, 300, 127, 'fast');
  r := public.plan_inputs(null, c);
  perform pg_temp.check(r -> 'containers' -> 0 -> 'settings' = '{"minutes_per_day": 300, "study_weekdays": 127, "tempo": "fast"}'::jsonb,
                        'plan_inputs: the own choice', r -> 'containers' -> 0 -> 'settings');
  r := public.container_summary(c, null);
  perform pg_temp.check(r -> 'settings' ->> 'tempo' = 'fast', 'summary: the own choice', r -> 'settings');
  update public.container_plans set tempo = 'date' where container_id = c;
  perform pg_temp.check(public.container_summary(c, null) -> 'settings' ->> 'tempo' = 'date', 'back to date');
  begin
    update public.container_plans set tempo = 'slow' where container_id = c;
    raise exception 'FAILED: tempo slow was kept';
  exception when check_violation then null;
  end;
end
$t$;

-- Another student cannot write the author's row (the «own row» policies).
select set_config('request.jwt.claim.sub', '7e7e7e7e-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"7e7e7e7e-0000-0000-0000-000000000002"}', true);
do $t$
declare
  n integer;
begin
  update public.container_plans set tempo = 'fast' where container_id = (select v::uuid from ctx where k = 'c');
  get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'another student changes nothing');
end
$t$;
reset role;
select 'PLAN TEMPO CHECKS PASSED';
rollback;
