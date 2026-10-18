-- Rollback of 20261019090000_container_kind.sql: (1) the six functions it replaced, as 20261018120000_exam_move_bot_exams.sql
-- left them, byte for byte; (2) the check and the column public.containers.kind. Every test made since is an exam again
-- (its author's study plan and Telegram reminders count it, as before release 47.3). Run in this order: the replaced
-- functions read the column. Re-runnable.

-- 1. The replaced functions.

-- 1.1 meldy_private.plan_inputs_for (20261018120000_exam_move_bot_exams.sql): as it was
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
    -- own_date: this user's own date of the exam (container_plans.own_exam_date): it overrides every date of the exam
    select c.*, (pg_catalog.array_position(v_ids, c.id) - 1) as ci,
           (select p.own_exam_date from public.container_plans p where p.user_id = p_user and p.container_id = c.id) as own_date
      from public.containers c where c.id = any (v_ids)
  ),
  ss as (
    select s.*, cs.ci, coalesce(cs.own_date, s.exam_date, cs.exam_date) as test_date,
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
  ),
  -- The same, from the answers made before the container's first answer today: the pace the frozen day is planned
  -- with (it does not move while the student answers).
  pace_day as (
    select ss.si, x.cls, pg_catalog.count(*) as n,
           pg_catalog.round(pg_catalog.percentile_cont(0.5) within group (order by least(x.ms, 180000)))::integer as median_ms,
           pg_catalog.round(pg_catalog.avg(case when x.correct then 0 else 1 end), 4) as p_wrong
      from (select a.subject_id, coalesce(a.cls, 'free') as cls, a.ms, a.correct,
                   pg_catalog.row_number() over (partition by a.subject_id, coalesce(a.cls, 'free') order by a.id desc) as rn
              from public.test_answers a
              left join today t on t.container_id = a.container_id
             where a.user_id = p_user and a.container_id = any (v_ids) and a.mode = 'learn'
               and not a.retry and not a.misclick and a.ms is not null
               and (t.first_at is null or a.created_at < t.first_at)) x
      join ss on ss.id = x.subject_id
     where x.rn <= 200
     group by ss.si, x.cls
  ),
  -- Items answered today that were seen on an earlier day, with the state they began the day in (day_start, kept by
  -- the trigger test_item_states_day_start); an item first answered today began the day unseen.
  starts as (
    select it.ii, st.day_start as d
      from it join public.test_item_states st on st.user_id = p_user and st.item_id = it.id and st.item_rev = it.rev
     where st.last_answer_day = p_day and st.first_seen_day < p_day
       and (st.day_start ->> 'day')::date = p_day and (st.day_start ->> 'rev')::integer = it.rev
  )
  select pg_catalog.jsonb_build_object(
    'v', 1, 'day', p_day, 'now', pg_catalog.floor(extract(epoch from v_now))::bigint,
    'containers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', cs.id, 'title', cs.title, 'exam_date', coalesce(cs.own_date, cs.exam_date),
        'role', case when cs.owner_id = p_user then 'owner' else 'member' end,
        'first_plan_day', meldy_private.first_plan_day(p_user, cs.id, p_day),
        'answers_today', (select pg_catalog.count(*) from public.test_answers a
                           where a.user_id = p_user and a.container_id = cs.id and a.local_date = p_day),
        'settings', coalesce((select pg_catalog.jsonb_build_object('minutes_per_day', p.minutes_per_day,
                                                                   'study_weekdays', p.study_weekdays, 'tempo', p.tempo)
                                from public.container_plans p where p.user_id = p_user and p.container_id = cs.id),
                             '{"minutes_per_day": 60, "study_weekdays": 127, "tempo": "date"}'::jsonb),
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
    'day_start', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        s.ii, (s.d ->> 'seen')::integer, (s.d ->> 'wrong')::integer,
        (s.d ->> 'first_seen_day')::date - p_day, (s.d ->> 'last_answer_day')::date - p_day,
        case s.d ->> 'last_result' when 'right' then 0 when 'wrong' then 1 when 'dont_know' then 2 end,
        (s.d ->> 'streak_day')::date - p_day,
        pg_catalog.ceil((s.d ->> 'streak_at')::numeric)::bigint,
        pg_catalog.ceil((s.d ->> 'two_days_at')::numeric)::bigint,
        pg_catalog.ceil((s.d ->> 'named_at')::numeric)::bigint,
        (s.d ->> 'checks')::integer, (s.d ->> 'peek_day')::date - p_day,
        case when (s.d ->> 'was_two_days')::boolean then 1 else 0 end,
        pg_catalog.ceil((s.d ->> 'clean_ok_at')::numeric)::bigint) order by s.ii)
        from starts s), '[]'::jsonb),
    'doubted', '[]'::jsonb,
    'pace', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'subject', pace.si, 'cls', pace.cls, 'n', pace.n, 'median_ms', pace.median_ms, 'p_wrong', pace.p_wrong)
        order by pace.si, pace.cls) from pace), '[]'::jsonb),
    'pace_day', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'subject', p.si, 'cls', p.cls, 'n', p.n, 'median_ms', p.median_ms, 'p_wrong', p.p_wrong)
        order by p.si, p.cls) from pace_day p), '[]'::jsonb),
    'ai', v_ai)
    into v_out;
  return v_out;
end;
$fn$;

-- 1.2 meldy_private.container_summary_for (20261018120000_exam_move_bot_exams.sql): as it was
create or replace function meldy_private.container_summary_for(p_user uuid, p_container_id uuid, p_day date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_role text := meldy_private.role_in(p_user, p_container_id);
  v_c public.containers%rowtype;
  v_own date;
  v_out jsonb;
begin
  if v_role is null then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  select c.* into v_c from public.containers c where c.id = p_container_id;
  -- This user's own date of the exam: it overrides the exam's and every subject's date (the author keeps theirs).
  select p.own_exam_date into v_own from public.container_plans p where p.user_id = p_user and p.container_id = p_container_id;
  with facts as (select * from meldy_private.subject_facts_for(p_user, array[p_container_id], p_day)),
  item_view as (
    select i.subject_id, i.topic, i.kind, i.keyed,
           (st.item_rev = i.rev and st.first_seen_day is not null) as seen,
           (st.item_rev = i.rev and st.two_days_at is not null) as two_days,
           (st.item_rev = i.rev and st.last_result in ('wrong', 'dont_know') and d.item_id is null) as open_error
      from public.test_items i
      left join public.test_item_states st on st.user_id = p_user and st.item_id = i.id
      left join public.test_key_doubts d on d.item_id = i.id and d.user_id = p_user and d.resolved_at is null
     where i.container_id = p_container_id
  ),
  topics as (
    select v.subject_id, pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'topic', v.topic, 'keyed', v.keyed_n, 'seen', v.seen_n, 'two_days', v.two_days_n,
             'open_errors', v.errors_n) order by v.topic) as list
      from (select subject_id, topic,
                   pg_catalog.count(*) filter (where keyed) as keyed_n,
                   pg_catalog.count(*) filter (where keyed and seen) as seen_n,
                   pg_catalog.count(*) filter (where keyed and two_days) as two_days_n,
                   pg_catalog.count(*) filter (where keyed and open_error) as errors_n
              from item_view where topic is not null
             group by subject_id, topic) v
     group by v.subject_id
  ),
  kinds as (
    select subject_id,
           pg_catalog.count(*) filter (where keyed and kind = 'single') as single_n,
           pg_catalog.count(*) filter (where keyed and kind = 'multiple') as multiple_n,
           pg_catalog.count(*) filter (where keyed and kind = 'short') as short_n
      from item_view group by subject_id
  )
  select pg_catalog.jsonb_build_object(
    'v', 1, 'day', p_day, 'id', v_c.id, 'title', v_c.title, 'exam_date', coalesce(v_own, v_c.exam_date), 'role', v_role,
    'own_exam_date', v_own, 'author_exam_date', v_c.exam_date,
    'created_at', v_c.created_at,
    'first_plan_day', meldy_private.first_plan_day(p_user, p_container_id, p_day),
    'settings', coalesce((select pg_catalog.jsonb_build_object('minutes_per_day', p.minutes_per_day,
                                                               'study_weekdays', p.study_weekdays, 'tempo', p.tempo)
                            from public.container_plans p where p.user_id = p_user and p.container_id = p_container_id),
                         '{"minutes_per_day": 60, "study_weekdays": 127, "tempo": "date"}'::jsonb),
    'subjects', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', s.id, 'position', s.position, 'title', s.title,
               'exam_date', coalesce(v_own, s.exam_date, v_c.exam_date), 'topic_titles', s.topics,
               'oral', case
                 when v_role = 'owner' and s.exam_id is not null then pg_catalog.jsonb_build_object(
                   'exam_id', s.exam_id,
                   'questions', (select pg_catalog.count(*) from public.exam_questions q where q.exam_id = s.exam_id))
                 when v_role = 'member' and s.exam_id is not null then pg_catalog.jsonb_build_object(
                   'exam_id', me.exam_id,
                   'questions', (select pg_catalog.count(*) from public.exam_questions q where q.exam_id = me.exam_id)) end,
               'keyed', coalesce(f.keyed, 0), 'no_key', coalesce(f.no_key, 0), 'seen', coalesce(f.seen, 0),
               'two_days', coalesce(f.two_days, 0), 'open_errors', coalesce(f.open_errors, 0),
               'seen_today', coalesce(f.seen_today, 0), 'doubted', coalesce(f.doubted, 0), 'stale', coalesce(f.stale, 0),
               'topics', coalesce(t.list, '[]'::jsonb),
               'kinds', pg_catalog.jsonb_build_object('single', coalesce(k.single_n, 0), 'multiple', coalesce(k.multiple_n, 0),
                                                      'short', coalesce(k.short_n, 0)))
               order by s.position, s.created_at)
        from public.container_subjects s
        left join facts f on f.subject_id = s.id
        left join topics t on t.subject_id = s.id
        left join kinds k on k.subject_id = s.id
        left join public.container_member_exams me on me.subject_id = s.id and me.user_id = p_user
       where s.container_id = p_container_id), '[]'::jsonb),
    'items_version', (select pg_catalog.jsonb_build_object('count', pg_catalog.count(*), 'updated_at', pg_catalog.max(i.updated_at))
                        from public.test_items i where i.container_id = p_container_id),
    'answers_today', (select pg_catalog.count(*) from public.test_answers a
                       where a.user_id = p_user and a.container_id = p_container_id and a.local_date = p_day),
    'key_changes_unseen', (select pg_catalog.count(*) from public.test_item_states st
                             join public.test_items i on i.id = st.item_id
                            where st.user_id = p_user and st.container_id = p_container_id and st.item_rev < i.rev),
    'mock_runs', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                             'id', r.id, 'local_date', r.local_date, 'subject_ids', pg_catalog.to_jsonb(r.subject_ids),
                             'items', r.items, 'correct', r.correct)
                             order by r.finished_at desc)
                             from (select * from public.test_mock_runs r
                                    where r.user_id = p_user and r.container_id = p_container_id
                                    order by r.finished_at desc limit 5) r), '[]'::jsonb),
    'owner', case when v_role = 'owner' then pg_catalog.jsonb_build_object(
       'members', (select pg_catalog.count(*) from public.container_members m
                    where m.container_id = p_container_id and m.left_at is null and m.removed_at is null),
       'doubts_open', (select pg_catalog.count(distinct d.item_id) from public.test_key_doubts d
                        where d.container_id = p_container_id and d.resolved_at is null),
       'links', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                            'id', l.id, 'created_at', l.created_at, 'expires_at', l.expires_at, 'revoked_at', l.revoked_at,
                            'members', l.members, 'max_members', l.max_members, 'oral', pg_catalog.cardinality(l.oral_share_ids))
                            order by l.created_at desc)
                            from public.container_links l where l.container_id = p_container_id), '[]'::jsonb)) end)
    into v_out;
  return v_out;
end;
$fn$;

-- 1.3 meldy_private.containers_overview_for (20261018120000_exam_move_bot_exams.sql): as it was
create or replace function meldy_private.containers_overview_for(p_user uuid, p_day date)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_ids uuid[];
  v_out jsonb;
begin
  select coalesce(pg_catalog.array_agg(x.id), '{}'::uuid[]) into v_ids
    from meldy_private.container_ids_of(p_user) as x(id);
  with facts as (select * from meldy_private.subject_facts_for(p_user, v_ids, p_day)),
  subjects as (
    select s.container_id, pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', s.id, 'position', s.position, 'title', s.title,
             'exam_date', coalesce(cp.own_exam_date, s.exam_date, c.exam_date),
             'oral_exam_id', case when c.owner_id = p_user then s.exam_id else me.exam_id end,
             'has_oral', s.exam_id is not null,
             'keyed', coalesce(f.keyed, 0), 'no_key', coalesce(f.no_key, 0), 'seen', coalesce(f.seen, 0),
             'two_days', coalesce(f.two_days, 0), 'open_errors', coalesce(f.open_errors, 0),
             'seen_today', coalesce(f.seen_today, 0), 'doubted', coalesce(f.doubted, 0), 'stale', coalesce(f.stale, 0))
             order by s.position, s.created_at) as list,
           pg_catalog.max(f.updated_at) as items_updated_at,
           pg_catalog.sum(coalesce(f.keyed, 0) + coalesce(f.no_key, 0)) as items
      from public.container_subjects s
      join public.containers c on c.id = s.container_id
      left join public.container_plans cp on cp.user_id = p_user and cp.container_id = s.container_id
      left join facts f on f.subject_id = s.id
      left join public.container_member_exams me on me.subject_id = s.id and me.user_id = p_user
     where s.container_id = any (v_ids)
     group by s.container_id
  )
  select pg_catalog.jsonb_build_object(
           'v', 1, 'day', p_day,
           'containers', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'id', c.id, 'title', c.title, 'exam_date', coalesce(cp.own_exam_date, c.exam_date),
              'own_exam_date', cp.own_exam_date, 'author_exam_date', c.exam_date, 'created_at', c.created_at,
              'role', case when c.owner_id = p_user then 'owner' else 'member' end,
              'items', coalesce(sj.items, 0), 'items_updated_at', sj.items_updated_at,
              'subjects', coalesce(sj.list, '[]'::jsonb),
              'answers_today', (select pg_catalog.count(*) from public.test_answers a
                                 where a.user_id = p_user and a.container_id = c.id and a.local_date = p_day),
              'settings', (select pg_catalog.jsonb_build_object('minutes_per_day', p.minutes_per_day,
                                                                'study_weekdays', p.study_weekdays)
                             from public.container_plans p where p.user_id = p_user and p.container_id = c.id))
              order by c.exam_date nulls last, c.created_at desc), '[]'::jsonb),
           'attached_exam_ids', coalesce((
              select pg_catalog.jsonb_agg(x.exam_id order by x.exam_id) from (
                select s.exam_id from public.container_subjects s
                 where s.owner_id = p_user and s.exam_id is not null
                union
                select me.exam_id from public.container_member_exams me where me.user_id = p_user) x), '[]'::jsonb))
    into v_out
    from public.containers c
    left join subjects sj on sj.container_id = c.id
    left join public.container_plans cp on cp.user_id = p_user and cp.container_id = c.id
   where c.id = any (v_ids);
  return v_out;
end;
$fn$;

-- 1.4 bot.remind_on (20261018120000_exam_move_bot_exams.sql): as it was
create or replace function bot.remind_on(p_user uuid, p_container uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce((select p.tg_remind from public.container_plans p
                    where p.user_id = p_user and p.container_id = p_container), true)
$fn$;

-- 1.5 bot.remind_any (20261018120000_exam_move_bot_exams.sql): as it was
create or replace function bot.remind_any(p_user uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.bool_or(coalesce(p.tg_remind, true)), true)
    from meldy_private.container_ids_of(p_user) as x(id)
    left join public.container_plans p on p.user_id = p_user and p.container_id = x.id
$fn$;

-- 1.6 bot.exams_list (20261018120000_exam_move_bot_exams.sql): as it was
create or replace function bot.exams_list(p_user uuid, p_day date)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  with ex as (
    select c.id, c.title, c.exam_date, c.created_at, c.owner_id = p_user as own, p.own_exam_date as own_date,
           coalesce(p.tg_remind, true) as tg_remind
      from public.containers c
      left join public.container_plans p on p.user_id = p_user and p.container_id = c.id
     where c.id in (select x.id from meldy_private.container_ids_of(p_user) as x(id))
  ),
  dates as (
    select e.id,
           coalesce(e.own_date,
                    case when not exists (select 1 from public.test_items i where i.subject_id = s.id and i.keyed)
                         then (select o.exam_date from public.exams o
                                where o.id = case when e.own then s.exam_id
                                                  else (select me.exam_id from public.container_member_exams me
                                                         where me.subject_id = s.id and me.user_id = p_user) end) end,
                    s.exam_date, e.exam_date) as d
      from ex e join public.container_subjects s on s.container_id = e.id
    union all
    select e.id, coalesce(e.own_date, e.exam_date) from ex e
     where not exists (select 1 from public.container_subjects s where s.container_id = e.id)
  ),
  facts as (
    select dt.id, pg_catalog.bool_or(dt.d is null) as undated, pg_catalog.bool_or(dt.d > p_day) as ahead,
           pg_catalog.bool_or(dt.d = p_day) as on_day, pg_catalog.min(dt.d) filter (where dt.d >= p_day) as next_date,
           pg_catalog.max(dt.d) as last_date
      from dates dt
     group by dt.id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'container_id', e.id, 'title', e.title, 'exam_date', coalesce(f.next_date, f.last_date),
           'state', case when f.last_date is null then 'no_date'
                         when f.undated or f.ahead then 'study'
                         when f.on_day then 'exam_today'
                         else 'after' end,
           'tg_remind', e.tg_remind, 'role', case when e.own then 'owner' else 'member' end,
           'members', case when e.own then (select pg_catalog.count(*) from public.container_members m
                                             where m.container_id = e.id and m.left_at is null and m.removed_at is null) end)
           order by case when f.next_date is not null then 0 when f.last_date is null or f.undated then 1 else 2 end,
                    f.next_date, f.last_date desc, e.created_at desc, e.id), '[]'::jsonb)
    from ex e join facts f on f.id = e.id
$fn$;

-- 2. The column and its check.
alter table public.containers drop constraint if exists containers_kind_check;
alter table public.containers drop column if exists kind;
