-- Rollback of 20261010130000_containers_frozen_pace.sql: plan_inputs_for as in 20261009093500_containers.sql (no
-- day_start, no pace_day), the trigger, its function and the column dropped. The client then plans the frozen day the
-- way it did before (lib/containers/plan.ts reads both keys only when they are there). Re-runnable.
drop trigger if exists test_item_states_day_start on public.test_item_states;
drop function if exists meldy_private.test_item_states_day_start();
alter table public.test_item_states drop column if exists day_start;

create or replace function meldy_private.plan_inputs_for(p_user uuid, p_day date, p_container_id uuid default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_ids uuid[];
  v_now timestamptz := pg_catalog.now();
  v_ai jsonb;
  v_out jsonb;
begin
  select coalesce(pg_catalog.array_agg(c.id order by c.exam_date nulls last, c.created_at desc, c.id), '{}'::uuid[])
    into v_ids
    from public.containers c
   where c.id in (select x.id from meldy_private.container_ids_of(p_user) as x(id))
     and (p_container_id is null or c.id = p_container_id);
  if p_container_id is not null and pg_catalog.cardinality(v_ids) = 0 then
    raise exception 'container not found' using errcode = 'P0002';
  end if;

  -- Today's AI units, read the way ai_quota_status() reads them (20261004205613): the UTC day's ai_usage rows,
  -- the limit of public.ai_daily_limit(profiles.is_pro).
  if pg_catalog.to_regclass('public.ai_usage') is not null and pg_catalog.to_regclass('public.profiles') is not null
     and pg_catalog.to_regprocedure('public.ai_daily_limit(boolean)') is not null
     and exists (select 1 from pg_catalog.pg_attribute a
                  where a.attrelid = pg_catalog.to_regclass('public.profiles') and a.attname = 'is_pro' and not a.attisdropped) then
    execute $q$
      select pg_catalog.jsonb_build_object(
               'left', greatest(public.ai_daily_limit(coalesce((select p.is_pro from public.profiles p where p.id = $1), false))
                                           - coalesce((select pg_catalog.sum(greatest(coalesce(u.requests_count, 0), 0))
                                                         from public.ai_usage u
                                                        where u.user_id = $1 and u.date = ($2 at time zone 'utc')::date), 0), 0),
               'resets_at', extract(epoch from ((($2 at time zone 'utc')::date + 1)::timestamp at time zone 'utc'))::bigint)
    $q$ into v_ai using p_user, v_now;
  end if;

  with cs as (
    select c.*, (pg_catalog.array_position(v_ids, c.id) - 1) as ci from public.containers c where c.id = any (v_ids)
  ),
  ss as (
    select s.*, cs.ci, coalesce(s.exam_date, cs.exam_date) as test_date,
           (pg_catalog.row_number() over (order by cs.ci, s.position, s.created_at, s.id) - 1) as si
      from public.container_subjects s join cs on cs.id = s.container_id
  ),
  it as (
    select i.*, ss.si, (pg_catalog.row_number() over (order by ss.si, i.position, i.id) - 1) as ii
      from public.test_items i join ss on ss.id = i.subject_id
     where i.keyed
       and not exists (select 1 from public.test_key_doubts d
                        where d.item_id = i.id and d.user_id = p_user and d.resolved_at is null)
  ),
  today as (
    select a.container_id, pg_catalog.min(a.created_at) as first_at,
           pg_catalog.sum(least(coalesce(a.ms, 0), 180000)) filter (where a.mode = 'learn') as learn_ms
      from public.test_answers a
     where a.user_id = p_user and a.container_id = any (v_ids) and a.local_date = p_day
     group by a.container_id
  ),
  mocks as (
    select r.container_id, pg_catalog.sum(least(coalesce(r.duration_s, 0), 10800)) as mock_s
      from public.test_mock_runs r
     where r.user_id = p_user and r.container_id = any (v_ids) and r.local_date = p_day
     group by r.container_id
  ),
  pace as (
    select ss.si, x.cls, pg_catalog.count(*) as n,
           pg_catalog.round(pg_catalog.percentile_cont(0.5) within group (order by least(x.ms, 180000)))::integer as median_ms,
           pg_catalog.round(pg_catalog.avg(case when x.correct then 0 else 1 end), 4) as p_wrong
      from (select a.subject_id, coalesce(a.cls, 'free') as cls, a.ms, a.correct,
                   pg_catalog.row_number() over (partition by a.subject_id, coalesce(a.cls, 'free') order by a.id desc) as rn
              from public.test_answers a
             where a.user_id = p_user and a.container_id = any (v_ids) and a.mode = 'learn'
               and not a.retry and not a.misclick and a.ms is not null) x
      join ss on ss.id = x.subject_id
     where x.rn <= 200
     group by ss.si, x.cls
  )
  select pg_catalog.jsonb_build_object(
    'v', 1, 'day', p_day, 'now', pg_catalog.floor(extract(epoch from v_now))::bigint,
    'containers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', cs.id, 'title', cs.title, 'exam_date', cs.exam_date,
        'role', case when cs.owner_id = p_user then 'owner' else 'member' end,
        'first_plan_day', meldy_private.first_plan_day(p_user, cs.id, p_day),
        'answers_today', (select pg_catalog.count(*) from public.test_answers a
                           where a.user_id = p_user and a.container_id = cs.id and a.local_date = p_day),
        'settings', coalesce((select pg_catalog.jsonb_build_object('minutes_per_day', p.minutes_per_day,
                                                                   'study_weekdays', p.study_weekdays)
                                from public.container_plans p where p.user_id = p_user and p.container_id = cs.id),
                             '{"minutes_per_day": 60, "study_weekdays": 127}'::jsonb),
        'today', pg_catalog.jsonb_build_object(
                   'first_at', (select pg_catalog.floor(extract(epoch from t.first_at))::bigint
                                  from today t where t.container_id = cs.id),
                   'done_s', coalesce((select pg_catalog.round(coalesce(t.learn_ms, 0) / 1000.0)::bigint
                                         from today t where t.container_id = cs.id), 0)
                             + coalesce((select m.mock_s from mocks m where m.container_id = cs.id), 0)))
        order by cs.ci) from cs), '[]'::jsonb),
    'subjects', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', ss.id, 'container', ss.ci, 'title', ss.title, 'test_date', ss.test_date,
        'oral_exam_id', case when ss.owner_id = p_user then ss.exam_id
                             else (select me.exam_id from public.container_member_exams me
                                    where me.subject_id = ss.id and me.user_id = p_user) end,
        'topics', greatest(pg_catalog.jsonb_array_length(ss.topics),
                           coalesce((select pg_catalog.max(i.topic) from public.test_items i where i.subject_id = ss.id), 0)),
        'new_today', (select pg_catalog.count(*) from public.test_item_states st
                        join public.test_items i on i.id = st.item_id and i.rev = st.item_rev and i.keyed
                       where st.user_id = p_user and st.subject_id = ss.id and st.first_seen_day = p_day))
        order by ss.si) from ss), '[]'::jsonb),
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        it.id, it.si, it.topic, it.position,
        case it.kind when 'multiple' then 1 when 'short' then 2 else 0 end, it.rev,
        case when it.code or it.kind = 'multiple' then 1 else 0 end) order by it.ii)
        from it), '[]'::jsonb),
    'states', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        it.ii, st.seen, st.wrong_count, st.first_seen_day - p_day, st.last_answer_day - p_day,
        case st.last_result when 'right' then 0 when 'wrong' then 1 when 'dont_know' then 2 end,
        st.streak_day - p_day,
        pg_catalog.ceil(extract(epoch from st.streak_at))::bigint,
        pg_catalog.ceil(extract(epoch from st.two_days_at))::bigint,
        pg_catalog.ceil(extract(epoch from st.named_at))::bigint,
        st.checks, st.peek_day - p_day, case when st.was_two_days then 1 else 0 end,
        pg_catalog.ceil(extract(epoch from st.clean_ok_at))::bigint) order by it.ii)
        from it join public.test_item_states st on st.user_id = p_user and st.item_id = it.id and st.item_rev = it.rev),
        '[]'::jsonb),
    'doubted', '[]'::jsonb,
    'pace', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'subject', pace.si, 'cls', pace.cls, 'n', pace.n, 'median_ms', pace.median_ms, 'p_wrong', pace.p_wrong)
        order by pace.si, pace.cls) from pace), '[]'::jsonb),
    'ai', v_ai)
    into v_out;
  return v_out;
end;
$fn$;

-- 11e. Public wrappers: the signed-in user, the local day kept within a day of the server's.
create or replace function public.containers_overview(p_local_date text default null)
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
  return meldy_private.containers_overview_for(auth.uid(), meldy_private.clamp_day(p_local_date));
end;
$fn$;

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

