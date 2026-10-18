-- exam_move_bot_exams
-- Repo file: supabase/migrations/20261018120000_exam_move_bot_exams.sql (release 47, «Перенести экзамен» and the plan in
-- Telegram per exam; docs/superpowers/plans/2026-10-18-exam-move-bot-exams.md, «Data contract (agent D)»).
-- Rollback: supabase/rollback/20261018120000_exam_move_bot_exams_down.sql. Contract after the apply:
-- supabase/tests/exam_move_bot_exams.sql. Local rehearsal (never live): supabase/tests/local/exam_move_bot_exams_run.sh.
--
-- The owner, 2026-10-18: the bot's plan could not be turned off for one exam or sent for several at once, and an exam
-- whose date passed (17.10) could not be moved with a button; a member could not move it at all. What this file adds:
--   1. public.container_plans (the user's own row of an exam, written as the plan settings are: an upsert with the
--      defaults when missing): own_exam_date date (null — none; 2000-01-01..2100-12-31) and tg_remind boolean not null
--      default true. The table's grants and «own row» policies cover both.
--   2. The effective date. For a user with own_exam_date every subject of that exam uses it: it overrides the subject's
--      and the exam's date in meldy_private.plan_inputs_for (containers[].exam_date, subjects[].test_date),
--      container_summary_for (exam_date, subjects[].exam_date, and the new top-level own_exam_date and author_exam_date),
--      containers_overview_for (the same, per exam), the exam-eve rule of the answer core (record_test_answers_for), the
--      bot's exams (bot.exams_json, bot.after_date_json, bot.last_date: K3), the oral parts the bot plans
--      (bot_oral_inputs) and the bot's lists. Nobody else's dates change: the author's and the other members' rows stay.
--   3. public.exam_date_move(p_container_id, p_date, p_for 'all' | 'me', p_subject_id) jsonb (authenticated):
--      p_date from current_date to current_date + 730 (else 22023 «date»); null only with 'me' (clears the own date).
--      'all' — the owner only (42501): with p_subject_id that subject's date and its oral exam's (as the site's
--      updateSubject writes it); without, the exam's date, and every subject whose own date has passed (≤ today) takes
--      it too (with its oral exam), as do the oral exams of the subjects that follow the exam's date; future subject
--      dates stay. 'me' — the owner or an active member: own_exam_date. Returns {for, container_id, exam_date (the
--      exam's own), own_exam_date, subjects: [{id, exam_date (the caller's)}]}. P0002: not the caller's exam or subject.
--   4. public.exam_remind_set(p_container_id, p_on) jsonb {container_id, tg_remind} (owner or active member) and
--      public.telegram_exams() jsonb: the caller's exams, nearest first, [{container_id, title, exam_date, state,
--      tg_remind, role, members}] (bot.exams_list, on the day of the caller's Telegram zone, else Europe/Minsk).
--   5. The bot (service role, the user only through bot.links): bot_exams(p_tg_user_id) {status, local_day, exams},
--      bot_exam_remind(p_tg_user_id, p_container_id, p_on) {status, container_id, tg_remind, exams},
--      bot_exam_move(p_tg_user_id, p_container_id, p_date, p_for) {status, title, …exam_date_move's object} with the
--      rules of 3 on the link's local day; statuses, never errors: ok | invalid (+reason for | date | past | far) |
--      forbidden | gone | unlinked.
--   6. The reminders: the claim leaves out a user whose exams are all off (tg_remind false), the context answers skip
--      «off» for one and hands the bot the list (exam_list) to leave the others out of the card; bot_today hands it too;
--      K3 (and tick_due's K3 test) leave out an exam that is off, and come once per exam AND date: after a move, the
--      new date's K3 comes again.
-- Re-runnable: ADD COLUMN IF NOT EXISTS, a guarded constraint, CREATE OR REPLACE (grants kept). Every replaced function
-- is its latest body (20261014170000 for plan_inputs_for and container_summary_for, 20261010120007 for bot_oral_inputs,
-- 20261009093500 / 20261010120000 for the rest) with the lines above changed. New functions: SECURITY DEFINER with an
-- empty search_path where clients or the bot call them; explicit grants at the end. Errors: 28000 not signed in;
-- 22023 bad input («date», «for», «on»); 42501 a member moving for everyone; P0002 not the caller's exam or subject.

-- 1. The user's own date and the plan in Telegram, per exam.
alter table public.container_plans add column if not exists own_exam_date date;
alter table public.container_plans add column if not exists tg_remind boolean not null default true;
do $do$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conrelid = 'public.container_plans'::regclass and conname = 'container_plans_own_exam_date_check') then
    alter table public.container_plans add constraint container_plans_own_exam_date_check
      check (own_exam_date is null or own_exam_date between date '2000-01-01' and date '2100-12-31');
  end if;
end;
$do$;
comment on column public.container_plans.own_exam_date is
  'This user''s own date of the exam: it overrides the exam''s and every subject''s date for this user only (exam_date_move ''me'').';
comment on column public.container_plans.tg_remind is
  'The Telegram bot''s day plan includes this exam (exam_remind_set, the bot''s «Экзамены»); K3 too.';

-- 2. Helpers of schema bot (reached only by the SECURITY DEFINER functions).
-- 2a. Is the exam in this user's Telegram plan (no row: yes).
create or replace function bot.remind_on(p_user uuid, p_container uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce((select p.tg_remind from public.container_plans p
                    where p.user_id = p_user and p.container_id = p_container), true)
$fn$;

-- 2b. Has the user an exam in the Telegram plan, or no exam at all (then the card says so as before).
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

-- 2c. The last test date of an exam for this user (K3, bot_whoami's last_date): the own date, else the latest of the
--     subjects' dates (a subject's own, else the exam's), else the exam's.
create or replace function bot.last_date(p_user uuid, p_container uuid)
returns date
language sql
stable
set search_path = ''
as $fn$
  select coalesce(p.own_exam_date,
                  (select pg_catalog.max(coalesce(s.exam_date, c.exam_date)) from public.container_subjects s
                    where s.container_id = c.id),
                  c.exam_date)
    from public.containers c
    left join public.container_plans p on p.user_id = p_user and p.container_id = c.id
   where c.id = p_container
$fn$;

-- 2d. The user's exams for «Экзамены» (the bot) and the profile's Telegram card (the site), nearest first: those with
--     a date ahead (or today) by it, then those without one, then the passed ones, the latest first. Per exam:
--     container_id, title; exam_date = the nearest date ahead or today, else the last one, else null; state as the
--     plan has it (study while a subject has a date ahead or none, exam_today when the last ones are today, after,
--     no_date when nothing has a date); tg_remind; role; members (the author's active members; null for a member).
--     Each subject's date as the plan takes it: the own date of the exam first; a subject with no question with a key
--     takes its oral exam's date (the author's exam, a member's copy: oralParts.ts withOralDates); else its own date,
--     else the exam's. An exam without subjects has the exam's date.
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

-- 3. The effective date in the container's reads and in the answer core (the own date first).
-- 3a. meldy_private.plan_inputs_for (20261014170000_plan_tempo.sql): containers[].exam_date and subjects[].test_date:
--     the own date first.
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

-- 3b. meldy_private.container_summary_for (20261014170000_plan_tempo.sql): exam_date and subjects[].exam_date: the own
--     date first; + own_exam_date, author_exam_date.
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

-- 3c. meldy_private.containers_overview_for (20261009093500_containers.sql): per exam and subject the own date first; +
--     own_exam_date, author_exam_date per exam.
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

-- 3d. meldy_private.record_test_answers_for (20261009093500_containers.sql): the exam-eve rule (due_at) takes the own
--     date first.
create or replace function meldy_private.record_test_answers_for(p_user uuid, p_answers jsonb,
                                                                 p_source text default 'web', p_max integer default 50,
                                                                 p_mode text default null, p_session uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_cls constant text[] := array['relearn', 'confirm', 'new_floor', 'confirm_ai', 'start_ai', 'check', 'final',
                                 'new_fill', 'free'];
  v_now timestamptz := pg_catalog.now();
  v_out jsonb[];
  v_a jsonb;
  v_ord integer;
  v_id text;
  v_iid uuid;
  v_item public.test_items%rowtype;
  v_prev_item uuid;
  v_g record;
  v_r record;
  v_s public.test_item_states%rowtype;
  v_exam date;
  v_day date;
  v_mode text;
  v_retry boolean;
  v_misclick boolean;
  v_ms integer;
  v_cls text;
  v_session uuid;
  v_log bigint;
begin
  if p_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_source is null or p_source not in ('web', 'bot', 'bot_group')
     or (p_mode is not null and p_mode not in ('learn', 'mock')) then
    raise exception 'invalid source' using errcode = '22023';
  end if;
  if p_answers is null or pg_catalog.jsonb_typeof(p_answers) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_answers) not between 1 and coalesce(p_max, 50)
     or pg_catalog.octet_length(p_answers::text) > 524288 then
    raise exception 'invalid answers' using errcode = '22023';
  end if;
  v_out := pg_catalog.array_fill(null::jsonb, array[pg_catalog.jsonb_array_length(p_answers)]);

  for v_a, v_ord in
    select a.value, a.ord::integer
      from pg_catalog.jsonb_array_elements(p_answers) with ordinality as a(value, ord)
     order by (case when pg_catalog.jsonb_typeof(a.value) = 'object' then pg_catalog.lower(a.value ->> 'item_id') end), a.ord
  loop
    v_id := case when pg_catalog.jsonb_typeof(v_a) = 'object' then v_a ->> 'client_event_id' end;
    if v_id is null or v_id !~ '^[A-Za-z0-9_:-]{8,120}$' or coalesce(v_a ->> 'item_id', '') !~* c_uuid then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'status', 'invalid');
      continue;
    end if;
    v_iid := (v_a ->> 'item_id')::uuid;

    select t.item_id into v_prev_item from public.test_answers t where t.user_id = p_user and t.client_event_id = v_id;
    if found then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid,
        'status', case when v_prev_item is distinct from v_iid and v_prev_item is not null then 'conflict' else 'duplicate' end);
      continue;
    end if;

    select i.* into v_item from public.test_items i where i.id = v_iid;
    if not found or meldy_private.role_in(p_user, v_item.container_id) is null then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'gone');
      continue;
    end if;
    if not v_item.keyed then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'no_key');
      continue;
    end if;
    if pg_catalog.jsonb_typeof(v_a -> 'rev') = 'number' and (v_a ->> 'rev') is distinct from v_item.rev::text then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'stale',
                                                    'rev', v_item.rev);
      continue;
    end if;
    select * into v_g from meldy_private.grade_answer(v_item.kind, pg_catalog.jsonb_array_length(v_item.options),
                                                      v_item.correct, v_item.answers, v_a);
    if not v_g.o_valid then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'invalid');
      continue;
    end if;

    v_day := meldy_private.clamp_day(v_a ->> 'local_date');
    v_mode := coalesce(p_mode, case when v_a ->> 'mode' = 'mock' then 'mock' else 'learn' end);
    v_retry := v_mode = 'learn' and coalesce(v_a ->> 'retry', '') = 'true';
    -- «Нажали не туда?» under a wrong option or a «Не знаю» pressed by mistake (never under a right answer, never in a mock)
    v_misclick := v_mode = 'learn' and coalesce(v_a ->> 'misclick', '') = 'true' and v_g.o_result <> 'right';
    v_ms := case when coalesce(v_a ->> 'ms', '') ~ '^\d{1,7}$' then least((v_a ->> 'ms')::integer, 600000) end;
    v_cls := case when (v_a ->> 'cls') = any (c_cls) then v_a ->> 'cls' end;
    v_session := coalesce(p_session, case when coalesce(v_a ->> 'session_id', '') ~* c_uuid
                                          then (v_a ->> 'session_id')::uuid end);
    -- The exam-eve rule takes this user's own date of the exam first (container_plans.own_exam_date).
    select coalesce(p.own_exam_date, s.exam_date, c.exam_date) into v_exam
      from public.container_subjects s join public.containers c on c.id = s.container_id
      left join public.container_plans p on p.user_id = p_user and p.container_id = s.container_id
     where s.id = v_item.subject_id;

    -- The state row exists before it is locked: a concurrent first answer waits here instead of being lost.
    insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev)
    values (p_user, v_iid, v_item.container_id, v_item.subject_id, v_item.rev)
    on conflict (user_id, item_id) do nothing;
    select s.* into v_s from public.test_item_states s where s.user_id = p_user and s.item_id = v_iid for update;
    v_s.container_id := v_item.container_id;
    v_s.subject_id := v_item.subject_id;
    select * into v_r from meldy_private.rule_step(v_s, v_item.rev, v_now, v_day, v_g.o_result, v_retry, v_misclick, v_exam);
    v_s := v_r.o_state;

    insert into public.test_answers (user_id, client_event_id, local_date, container_id, subject_id, item_id, item_rev,
                                     kind, mode, source, chosen, answer_text, shown_order, correct, misclick, retry, step,
                                     two_days_before, due_before, checks_before, cls, ms, session_id)
    values (p_user, v_id, v_day, v_item.container_id, v_item.subject_id, v_iid, v_item.rev, v_item.kind, v_mode,
            p_source, v_g.o_chosen, v_g.o_text, v_g.o_order, v_g.o_correct, v_misclick, v_retry, v_r.o_step,
            v_r.o_two_days_before, v_r.o_due_before, v_r.o_checks_before, v_cls, v_ms, v_session)
    on conflict (user_id, client_event_id) do nothing
    returning id into v_log;
    if v_log is null then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'duplicate');
      continue;
    end if;

    if v_r.o_step <> 'late' then
      update public.test_item_states s
         set container_id = v_s.container_id, subject_id = v_s.subject_id, item_rev = v_s.item_rev, seen = v_s.seen,
             right_count = v_s.right_count, wrong_count = v_s.wrong_count, first_seen_at = v_s.first_seen_at,
             first_seen_day = v_s.first_seen_day, last_answer_at = v_s.last_answer_at,
             last_answer_day = v_s.last_answer_day, last_result = v_s.last_result, streak_at = v_s.streak_at,
             streak_day = v_s.streak_day, two_days_at = v_s.two_days_at, two_days_day = v_s.two_days_day,
             named_at = v_s.named_at, checks = v_s.checks, peek_day = v_s.peek_day, was_two_days = v_s.was_two_days,
             clean_ok_at = v_s.clean_ok_at, updated_at = v_s.updated_at
       where s.user_id = p_user and s.item_id = v_iid;
    end if;

    v_out[v_ord] := pg_catalog.jsonb_build_object(
        'client_event_id', v_id, 'item_id', v_iid, 'status', case when v_r.o_step = 'late' then 'late' else 'saved' end,
        'correct', v_g.o_correct, 'step', v_r.o_step, 'rev', v_item.rev, 'state', meldy_private.state_json(v_s))
      || case when v_item.kind = 'short'
              then pg_catalog.jsonb_build_object('answers', pg_catalog.to_jsonb(v_item.answers))
              else pg_catalog.jsonb_build_object('key', (select pg_catalog.to_jsonb(coalesce(pg_catalog.array_agg(k order by k),
                                                                                         '{}'::smallint[]))
                                                            from pg_catalog.unnest(v_item.correct) k)) end;
  end loop;
  return pg_catalog.jsonb_build_object('v', 1, 'server_day', (v_now at time zone 'utc')::date,
                                       'results', pg_catalog.to_jsonb(v_out));
end;
$fn$;

-- 4. «Перенести экзамен». The core takes the user and «today» (the site: current_date; the bot: the link's local day).
create or replace function meldy_private.exam_date_move_for(p_user uuid, p_container_id uuid, p_date date, p_for text,
                                                           p_subject_id uuid, p_today date)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_c public.containers%rowtype;
  v_role text;
  v_oral uuid;
  v_own date;
begin
  if p_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_for is null or p_for not in ('all', 'me') then
    raise exception 'for' using errcode = '22023';
  end if;
  if p_today is null or (p_date is null and p_for <> 'me')
     or (p_date is not null and (p_date < p_today or p_date > p_today + 730)) then
    raise exception 'date' using errcode = '22023';
  end if;
  v_role := meldy_private.role_in(p_user, p_container_id);
  if v_role is null then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  -- One move of an exam at a time (two tabs, the site and the bot): the exam's row is the lock.
  select c.* into v_c from public.containers c where c.id = p_container_id for update;
  if v_c.id is null then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  if p_subject_id is not null and not exists (select 1 from public.container_subjects s
                                               where s.id = p_subject_id and s.container_id = p_container_id) then
    raise exception 'subject not found' using errcode = 'P0002';
  end if;
  if p_for = 'all' then
    if v_role <> 'owner' then
      raise exception 'only the author moves the exam for everyone' using errcode = '42501';
    end if;
    if p_subject_id is not null then
      -- One subject: its date, and its oral exam's (the site's updateSubject writes both).
      update public.container_subjects s set exam_date = p_date where s.id = p_subject_id returning s.exam_id into v_oral;
      if v_oral is not null then
        update public.exams e set exam_date = p_date where e.id = v_oral;
      end if;
    else
      update public.containers c set exam_date = p_date where c.id = p_container_id;
      -- The oral exams of the subjects that follow the exam's date, when their own date has passed.
      update public.exams e set exam_date = p_date
       where e.id in (select s.exam_id from public.container_subjects s
                       where s.container_id = p_container_id and s.exam_id is not null and s.exam_date is null)
         and e.exam_date <= p_today;
      -- The subjects whose own date has passed (today included) move with the exam, and their oral exams too; a
      -- subject's date still ahead stays.
      update public.exams e set exam_date = p_date
       where e.id in (select s.exam_id from public.container_subjects s
                       where s.container_id = p_container_id and s.exam_id is not null and s.exam_date <= p_today);
      update public.container_subjects s set exam_date = p_date
       where s.container_id = p_container_id and s.exam_date <= p_today;
    end if;
  else
    -- Only for this user: their own row of the exam (as the plan settings are written: the defaults when missing).
    insert into public.container_plans (user_id, container_id, own_exam_date)
    values (p_user, p_container_id, p_date)
    on conflict (user_id, container_id) do update set own_exam_date = excluded.own_exam_date, updated_at = pg_catalog.now();
  end if;
  select c.* into v_c from public.containers c where c.id = p_container_id;
  select p.own_exam_date into v_own from public.container_plans p where p.user_id = p_user and p.container_id = p_container_id;
  return pg_catalog.jsonb_build_object(
    'for', p_for, 'container_id', v_c.id, 'exam_date', v_c.exam_date, 'own_exam_date', v_own,
    'subjects', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                            'id', s.id, 'exam_date', coalesce(v_own, s.exam_date, v_c.exam_date))
                            order by s.position, s.created_at, s.id)
                            from public.container_subjects s where s.container_id = p_container_id), '[]'::jsonb));
end;
$fn$;

create or replace function public.exam_date_move(p_container_id uuid, p_date date, p_for text default 'all',
                                                 p_subject_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return meldy_private.exam_date_move_for(auth.uid(), p_container_id, p_date, p_for, p_subject_id, current_date);
end;
$fn$;

-- 5. The plan in Telegram per exam: the user's own row (the defaults when missing).
create or replace function meldy_private.exam_remind_set_for(p_user uuid, p_container_id uuid, p_on boolean)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  if p_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_on is null then
    raise exception 'on' using errcode = '22023';
  end if;
  if meldy_private.role_in(p_user, p_container_id) is null then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  insert into public.container_plans (user_id, container_id, tg_remind)
  values (p_user, p_container_id, p_on)
  on conflict (user_id, container_id) do update set tg_remind = excluded.tg_remind, updated_at = pg_catalog.now();
  return pg_catalog.jsonb_build_object('container_id', p_container_id, 'tg_remind', p_on);
end;
$fn$;

create or replace function public.exam_remind_set(p_container_id uuid, p_on boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return meldy_private.exam_remind_set_for(auth.uid(), p_container_id, p_on);
end;
$fn$;

-- The profile's Telegram card: the caller's exams with their switch (bot.exams_list), on the day of the caller's
-- Telegram zone (Europe/Minsk when not linked).
create or replace function public.telegram_exams()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_tz text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select l.tz into v_tz from bot.links l where l.user_id = v_uid and l.unlinked_at is null;
  return bot.exams_list(v_uid, (pg_catalog.now() at time zone coalesce(v_tz, 'Europe/Minsk'))::date);
end;
$fn$;

-- 6. The bot: the user's exams, what the reminders and K3 read, «Экзамены» and «Перенести экзамен».
-- 6a. bot.exams_json (20261010120000_telegram_bot.sql): bot_whoami's exams: the own date first (last_date =
--     bot.last_date); + tg_remind.
create or replace function bot.exams_json(p_user uuid)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', c.id, 'title', c.title, 'exam_date', coalesce(p.own_exam_date, c.exam_date),
           'last_date', bot.last_date(p_user, c.id),
           'role', case when c.owner_id = p_user then 'owner' else 'member' end,
           'tg_remind', coalesce(p.tg_remind, true))
           order by c.exam_date nulls last, c.created_at desc), '[]'::jsonb)
    from public.containers c
    left join public.container_plans p on p.user_id = p_user and p.container_id = c.id
   where c.id in (select x.id from meldy_private.container_ids_of(p_user) as x(id))
$fn$;

-- 6b. bot.after_date_json (20261010120000_telegram_bot.sql): K3: the own date first; + own_exam_date, role, members
--     (who may move it, and for whom).
create or replace function bot.after_date_json(p_user uuid, p_container uuid, p_last date)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'container_id', c.id, 'title', c.title, 'exam_date', coalesce(p.own_exam_date, c.exam_date), 'last_date', p_last,
    'own_exam_date', p.own_exam_date, 'role', meldy_private.role_in(p_user, c.id),
    'members', case when c.owner_id = p_user then
                 (select pg_catalog.count(*) from public.container_members m
                   where m.container_id = c.id and m.left_at is null and m.removed_at is null) else 0 end,
    'first_plan_day', meldy_private.first_plan_day(p_user, c.id, p_last),
    'active_days', (select pg_catalog.count(distinct a.local_date) from public.test_answers a
                     where a.user_id = p_user and a.container_id = c.id and a.local_date <= p_last),
    'answers', (select pg_catalog.count(*) from public.test_answers a
                 where a.user_id = p_user and a.container_id = c.id and a.local_date <= p_last),
    'two_days', (select coalesce(pg_catalog.sum(f.two_days), 0)::bigint
                   from meldy_private.subject_facts_for(p_user, array[c.id], p_last) f),
    'keyed', (select coalesce(pg_catalog.sum(f.keyed), 0)::bigint
                from meldy_private.subject_facts_for(p_user, array[c.id], p_last) f))
    from public.containers c
    left join public.container_plans p on p.user_id = p_user and p.container_id = c.id
   where c.id = p_container
$fn$;

-- 6c. bot.tick_due (20261010120000_telegram_bot.sql): the day card only for a user with an exam in the plan; K3 by
--     bot.last_date, an exam in the plan, once per date.
create or replace function bot.tick_due(p_now timestamptz default pg_catalog.now())
returns boolean
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_due boolean := false;
begin
  -- the day card (K1/K2)
  if exists (select 1 from bot.links l
              where l.unlinked_at is null and l.blocked_at is null and l.remind_on
                and bot.in_window(p_now at time zone l.tz, l.remind_at)
                and (l.paused_until is null or l.paused_until <= (p_now at time zone l.tz)::date)
                and not exists (select 1 from bot.deliveries d
                                 where d.chat_id = l.chat_id and d.local_day = (p_now at time zone l.tz)::date
                                   and d.kind in ('reminder', 'ask'))
                and bot.remind_any(l.user_id)) then
    return true;
  end if;
  -- K3: an exam in the plan whose last test date (the user's own date first) was 1–3 days ago, no K3 for this user
  --     and this date yet
  if exists (select 1 from bot.links l
              cross join lateral meldy_private.container_ids_of(l.user_id) as x(id)
              join public.containers c on c.id = x.id
             where l.unlinked_at is null and l.blocked_at is null and l.remind_on
               and bot.in_window(p_now at time zone l.tz, l.remind_at)
               and (l.paused_until is null or l.paused_until <= (p_now at time zone l.tz)::date)
               and (p_now at time zone l.tz)::date - bot.last_date(l.user_id, c.id) between 1 and 3
               and bot.remind_on(l.user_id, c.id)
               and not exists (select 1 from bot.deliveries d join bot.links l2 on l2.id = d.link_id
                                where d.kind = 'after_date' and d.ref = c.id::text and l2.user_id = l.user_id
                                  and d.local_day > bot.last_date(l.user_id, c.id))) then
    return true;
  end if;
  -- the night's close
  if exists (select 1 from bot.days dy join bot.links l on l.id = dy.link_id
              where l.unlinked_at is null and l.blocked_at is null and dy.closed_at is null
                and dy.local_day < (p_now at time zone l.tz)::date and dy.local_day >= (p_now at time zone l.tz)::date - 2
                and ((dy.card_message_id is not null and not dy.card_used) or dy.last_message_id is not null)
                and not exists (select 1 from bot.deliveries d
                                 where d.kind = 'day_close' and d.chat_id = l.chat_id and d.local_day = dy.local_day)) then
    return true;
  end if;
  -- a worker died after a claim: the row waits to be taken again (after 10 minutes, 3 tries) or given up (3 hours)
  if exists (select 1 from bot.deliveries d
              where d.status = 'claimed' and d.kind in ('reminder', 'ask', 'after_date', 'day_close')
                and ((d.attempts < 3 and d.claimed_at < p_now - interval '10 minutes')
                     or d.claimed_at < p_now - interval '3 hours')) then
    return true;
  end if;
  -- ── package T5 hook: bot.tick_due_sessions(p_now timestamptz) returns boolean (a pending answer older than 30
  --    minutes, spec §6.6 step 7). Until T5 defines it: any pending answer in bot.sessions counts.
  if pg_catalog.to_regprocedure('bot.tick_due_sessions(timestamptz)') is not null then
    execute 'select bot.tick_due_sessions($1)' into v_due using p_now;
    if v_due then
      return true;
    end if;
  elsif exists (select 1 from pg_catalog.pg_attribute a
                 where a.attrelid = pg_catalog.to_regclass('bot.sessions') and a.attname = 'pending' and not a.attisdropped) then
    execute 'select exists (select 1 from bot.sessions s where s.pending is not null)' into v_due;
    if v_due then
      return true;
    end if;
  end if;
  -- ── package T7 hook: bot.tick_due_groups(p_now timestamptz) returns boolean (a group post, its counter or its close
  --    due, spec §6.6 steps 1, 2, 4). Until T7 defines it while its tables exist: every minute.
  if pg_catalog.to_regprocedure('bot.tick_due_groups(timestamptz)') is not null then
    execute 'select bot.tick_due_groups($1)' into v_due using p_now;
    if v_due then
      return true;
    end if;
  elsif pg_catalog.to_regclass('bot.group_posts') is not null then
    return true;
  end if;
  return false;
end;
$fn$;

-- 6d. public.bot_claim_reminders (20261010120000_telegram_bot.sql): a user whose exams are all off is not claimed.
create or replace function public.bot_claim_reminders(p_limit integer default 50, p_now timestamptz default null)
returns table (delivery_id bigint, chat_id bigint, local_day date, tz text)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
begin
  perform meldy_private.require_service_role();
  perform bot.sweep(array['reminder', 'ask'], v_now);
  return query
  with active as (
    select l.id as link_id, l.user_id, l.chat_id, l.tz, l.remind_at, l.paused_until,
           (v_now at time zone l.tz) as local_ts
      from bot.links l
     where l.unlinked_at is null and l.blocked_at is null and l.remind_on
  ),
  due as (
    select a.link_id, a.chat_id, a.local_ts::date as day
      from active a
     where bot.in_window(a.local_ts, a.remind_at)
       and (a.paused_until is null or a.paused_until <= a.local_ts::date)
       and not exists (select 1 from bot.deliveries d
                        where d.chat_id = a.chat_id and d.local_day = a.local_ts::date and d.kind in ('reminder', 'ask'))
       and not bot.recently_active(a.user_id, v_now, a.local_ts::date)
       and bot.remind_any(a.user_id)
     order by a.remind_at, a.link_id
     limit v_limit
  ),
  fresh as (
    insert into bot.deliveries (kind, chat_id, link_id, local_day, claimed_at)
    select 'reminder', d.chat_id, d.link_id, d.day, v_now from due d
    on conflict do nothing
    returning bot.deliveries.id, bot.deliveries.chat_id, bot.deliveries.local_day, bot.deliveries.link_id
  ),
  stale as (
    update bot.deliveries d
       set claimed_at = v_now, attempts = d.attempts + 1
      from active a
     where a.link_id = d.link_id and d.kind in ('reminder', 'ask') and d.status = 'claimed' and d.attempts < 3
       and d.claimed_at < v_now - interval '10 minutes'
       and d.local_day = a.local_ts::date
       and bot.in_window(a.local_ts, a.remind_at)
       and (a.paused_until is null or a.paused_until <= a.local_ts::date)
       and not bot.recently_active(a.user_id, v_now, a.local_ts::date)
    returning d.id, d.chat_id, d.local_day, d.link_id
  )
  select x.id, x.chat_id, x.local_day, a.tz
    from (select f.id, f.chat_id, f.local_day, f.link_id from fresh f
          union all
          select s.id, s.chat_id, s.local_day, s.link_id from stale s) x
    join active a on a.link_id = x.link_id
   order by x.id;
end;
$fn$;

-- 6e. public.bot_reminder_context (20261010120000_telegram_bot.sql): skip «off» when every exam is off; + exam_list
--     (bot.exams_list) for the card.
create or replace function public.bot_reminder_context(p_delivery_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_d bot.deliveries%rowtype;
  v_l bot.links%rowtype;
  v_reason text;
  v_sent timestamptz[];
  v_k2 boolean := false;
begin
  perform meldy_private.require_service_role();
  select d.* into v_d from bot.deliveries d where d.id = p_delivery_id for update;
  if v_d.id is null or v_d.kind not in ('reminder', 'ask') or v_d.status <> 'claimed' then
    return pg_catalog.jsonb_build_object('status', 'gone', 'delivery_id', p_delivery_id, 'card', 'skip',
                                         'reason', 'not_claimed');
  end if;
  select l.* into v_l from bot.links l where l.id = v_d.link_id;
  v_reason := case when v_l.id is null or v_l.unlinked_at is not null then 'unlinked'
                   when v_l.blocked_at is not null then 'blocked'
                   when not v_l.remind_on or not bot.remind_any(v_l.user_id) then 'off'
                   when v_l.paused_until > v_d.local_day then 'paused'
                   when v_l.asked_at is not null and coalesce(v_l.last_seen_at, '-infinity'::timestamptz) <= v_l.asked_at
                        and not bot.answered_since(v_l.user_id, v_l.asked_at) then 'silent' end;
  if v_reason is not null then
    update bot.deliveries d set status = 'skipped', error = v_reason where d.id = v_d.id;
    return pg_catalog.jsonb_build_object('status', 'ok', 'delivery_id', v_d.id, 'card', 'skip', 'reason', v_reason);
  end if;
  select pg_catalog.array_agg(x.t order by x.t desc) into v_sent
    from (select coalesce(d.sent_at, d.claimed_at) as t from bot.deliveries d
           where d.link_id = v_l.id and d.kind = 'reminder' and d.status in ('sent', 'unknown') and d.id <> v_d.id
           order by 1 desc limit 3) x;
  if coalesce(pg_catalog.cardinality(v_sent), 0) = 3 then
    v_k2 := coalesce(v_l.last_seen_at, '-infinity'::timestamptz) <= v_sent[3]
            and not bot.answered_since(v_l.user_id, v_sent[3]);
  end if;
  update bot.deliveries d set kind = case when v_k2 then 'ask' else 'reminder' end
   where d.id = v_d.id and d.kind <> case when v_k2 then 'ask' else 'reminder' end;
  return pg_catalog.jsonb_build_object(
    'status', 'ok', 'delivery_id', v_d.id, 'card', case when v_k2 then 'K2' else 'K1' end,
    'kind', case when v_k2 then 'ask' else 'reminder' end, 'reason', null,
    'chat_id', v_d.chat_id, 'local_day', v_d.local_day, 'tz', v_l.tz,
    'link', bot.link_json(v_l, v_now),
    'plan', meldy_private.plan_inputs_for(v_l.user_id, v_d.local_day),
    'overview', meldy_private.containers_overview_for(v_l.user_id, v_d.local_day),
    'exam_list', bot.exams_list(v_l.user_id, v_d.local_day));
end;
$fn$;

-- 6f. public.bot_today (20261010120000_telegram_bot.sql): + exam_list (bot.exams_list): the card and S1 leave out the
--     exams that are off.
create or replace function public.bot_today(p_tg_user_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_day date;
  v_session jsonb;
  v_dayrow jsonb;
begin
  perform meldy_private.require_service_role();
  update bot.links l set last_seen_at = v_now
   where l.tg_user_id = p_tg_user_id and l.unlinked_at is null
  returning l.* into v_l;
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('linked', false);
  end if;
  v_day := (v_now at time zone v_l.tz)::date;
  if pg_catalog.to_regclass('bot.sessions') is not null then
    execute 'select pg_catalog.to_jsonb(s) - ''user_id'' from bot.sessions s
              where s.user_id = $1 and s.status = ''open'' limit 1'
      into v_session using v_l.user_id;
  end if;
  select pg_catalog.jsonb_build_object('local_day', d.local_day, 'card_message_id', d.card_message_id,
                                       'card_used', d.card_used, 'last_message_id', d.last_message_id,
                                       'closed_at', d.closed_at)
    into v_dayrow
    from bot.days d where d.link_id = v_l.id and d.local_day = v_day;
  return pg_catalog.jsonb_build_object(
    'linked', true, 'link', bot.link_json(v_l, v_now), 'local_day', v_day,
    'plan', meldy_private.plan_inputs_for(v_l.user_id, v_day),
    'overview', meldy_private.containers_overview_for(v_l.user_id, v_day),
    'session', v_session, 'day', v_dayrow, 'exam_list', bot.exams_list(v_l.user_id, v_day));
end;
$fn$;

-- 6g. public.bot_claim_after_date (20261010120000_telegram_bot.sql): by bot.last_date (the own date first), only exams
--     in the plan, once per exam and date.
create or replace function public.bot_claim_after_date(p_limit integer default 50, p_now timestamptz default null)
returns table (delivery_id bigint, chat_id bigint, local_day date, tz text, container_id uuid, exam jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
begin
  perform meldy_private.require_service_role();
  perform bot.sweep(array['after_date'], v_now);
  return query
  with ready as (
    select l.id as link_id, l.user_id, l.chat_id, l.tz, (v_now at time zone l.tz)::date as day
      from bot.links l
     where l.unlinked_at is null and l.blocked_at is null and l.remind_on
       and bot.in_window(v_now at time zone l.tz, l.remind_at)
       and (l.paused_until is null or l.paused_until <= (v_now at time zone l.tz)::date)
       and not bot.recently_active(l.user_id, v_now, (v_now at time zone l.tz)::date)
  ),
  exams as (
    select r.link_id, r.user_id, r.chat_id, r.tz, r.day, c.id as cid, bot.last_date(r.user_id, c.id) as last_date
      from ready r
      cross join lateral meldy_private.container_ids_of(r.user_id) as x(id)
      join public.containers c on c.id = x.id
     where bot.remind_on(r.user_id, c.id)
  ),
  due as (
    select e.* from exams e
     where e.last_date is not null and e.day between e.last_date + 1 and e.last_date + 3
       and not exists (select 1 from bot.deliveries d join bot.links l2 on l2.id = d.link_id
                        where d.kind = 'after_date' and d.ref = e.cid::text and l2.user_id = e.user_id
                          and d.local_day > e.last_date)
     order by e.day, e.link_id, e.cid
     limit v_limit
  ),
  fresh as (
    insert into bot.deliveries (kind, chat_id, link_id, local_day, ref, claimed_at)
    select 'after_date', d.chat_id, d.link_id, d.day, d.cid::text, v_now from due d
    on conflict do nothing
    returning bot.deliveries.id, bot.deliveries.chat_id, bot.deliveries.local_day, bot.deliveries.link_id,
              bot.deliveries.ref
  ),
  stale as (
    update bot.deliveries d
       set claimed_at = v_now, attempts = d.attempts + 1
      from ready r
     where r.link_id = d.link_id and d.kind = 'after_date' and d.status = 'claimed' and d.attempts < 3
       and d.claimed_at < v_now - interval '10 minutes' and d.local_day = r.day
       and bot.remind_on(r.user_id, d.ref::uuid)
    returning d.id, d.chat_id, d.local_day, d.link_id, d.ref
  )
  -- the rows come from RETURNING: a data-modifying CTE's rows are not visible to a join on bot.deliveries here
  select x.id, x.chat_id, x.local_day, l.tz, x.ref::uuid,
         bot.after_date_json(l.user_id, x.ref::uuid, bot.last_date(l.user_id, x.ref::uuid))
    from (select f.id, f.chat_id, f.local_day, f.link_id, f.ref from fresh f
          union all
          select s.id, s.chat_id, s.local_day, s.link_id, s.ref from stale s) x
    join bot.links l on l.id = x.link_id
   order by x.id;
end;
$fn$;

-- 6h. public.bot_oral_inputs (20261010120007_oral_plan_inputs.sql): exam_date: the own date of the exam first (an oral-
--     only subject plans by it).
create or replace function public.bot_oral_inputs(p_tg_user_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_cap constant integer := 300;
  v_l bot.links%rowtype;
  v_part record;
  v_count integer;
  v_sheet jsonb;
  v_line text[];
  v_meta text[];
  v_events jsonb;
  v_parts jsonb := '[]'::jsonb;
begin
  perform meldy_private.require_service_role();
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('linked', false);
  end if;
  -- The parts the site plans (container_summary_for: subjects[].oral.exam_id; hooks.ts oralParts): in an exam the user
  -- owns, the subject's oral exam; in one they joined, their bound copy of it. Only the user's own exams are read.
  for v_part in
    select c.id as container_id, s.id as subject_id, x.exam_id, coalesce(p.own_exam_date, e.exam_date) as exam_date
      from public.containers c
      join public.container_subjects s on s.container_id = c.id and s.exam_id is not null
      cross join lateral (select case meldy_private.role_in(v_l.user_id, c.id)
                                   when 'owner' then s.exam_id
                                   when 'member' then (select me.exam_id from public.container_member_exams me
                                                        where me.subject_id = s.id and me.user_id = v_l.user_id) end as exam_id) x
      join public.exams e on e.id = x.exam_id and e.user_id = v_l.user_id
      -- the user's own date of the exam overrides the oral exam's date too (an oral-only subject plans by it)
      left join public.container_plans p on p.user_id = v_l.user_id and p.container_id = c.id
     where c.id in (select y.id from meldy_private.container_ids_of(v_l.user_id) as y(id))
     order by c.exam_date nulls last, c.created_at desc, c.id, s.position, s.created_at, s.id
  loop
    select pg_catalog.count(*) into v_count
      from public.exam_questions q where q.exam_id = v_part.exam_id and q.user_id = v_l.user_id;
    if v_count > v_cap then
      v_parts := v_parts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'container_id', v_part.container_id, 'subject_id', v_part.subject_id, 'exam_id', v_part.exam_id,
        'exam_date', v_part.exam_date, 'questions', v_count, 'capped', true, 'sheet', null,
        'line_events', '[]'::jsonb, 'meta_events', '[]'::jsonb));
      continue;
    end if;
    v_sheet := meldy_private.oral_sheet_for(v_l.user_id, v_part.exam_id);
    -- The site's reads: line events of the written questions (sheetHashes), self-checks and AI checks of the questions
    -- in the plan (the blocks lines, unwritten and rebuilt of cheatSheet.ts blockKind).
    select coalesce(pg_catalog.array_agg(distinct w.hash) filter (where w.written), '{}'::text[]),
           coalesce(pg_catalog.array_agg(distinct w.hash) filter (where w.planned), '{}'::text[])
      into v_line, v_meta
      from (select q ->> 'question_hash' as hash,
                   pg_catalog.jsonb_typeof(q -> 'rubric') = 'object' as written,
                   case when (q ->> 'coverage') = 'none' then false
                        when pg_catalog.jsonb_typeof(q -> 'rubric') = 'object'
                          then (q -> 'rubric' ->> 'coverage') <> 'none' and pg_catalog.jsonb_array_length(q -> 'rubric' -> 'points') > 0
                        when pg_catalog.jsonb_typeof(q -> 'coverage') is distinct from 'string' then false
                        when (q ->> 'coverage') = 'unverified' then false
                        when (q -> 'unwritable') = 'true'::jsonb then false
                        else true end as planned
              from pg_catalog.jsonb_array_elements(v_sheet -> 'questions') as q) w
     where w.hash ~ '^[0-9a-f]{32}$';
    v_events := meldy_private.oral_events_json(v_l.user_id, v_line, v_meta);
    v_parts := v_parts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'container_id', v_part.container_id, 'subject_id', v_part.subject_id, 'exam_id', v_part.exam_id,
      'exam_date', v_part.exam_date, 'questions', v_count, 'capped', false, 'sheet', v_sheet,
      'line_events', v_events -> 'line_events', 'meta_events', v_events -> 'meta_events'));
  end loop;
  return pg_catalog.jsonb_build_object('linked', true, 'cap', v_cap, 'parts', v_parts);
end;
$fn$;

-- 6i. «Экзамены» in the bot: the user's exams with their switch, and the link's local day. Marks the user as seen.
create or replace function public.bot_exams(p_tg_user_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_day date;
begin
  perform meldy_private.require_service_role();
  update bot.links l set last_seen_at = v_now
   where l.tg_user_id = p_tg_user_id and l.unlinked_at is null
  returning l.* into v_l;
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  v_day := (v_now at time zone v_l.tz)::date;
  return pg_catalog.jsonb_build_object('status', 'ok', 'local_day', v_day, 'exams', bot.exams_list(v_l.user_id, v_day));
end;
$fn$;

-- 6j. A press in «Экзамены»: the exam in the plan or out of it. status: ok (+ the list) | invalid | gone | unlinked.
create or replace function public.bot_exam_remind(p_tg_user_id bigint, p_container_id uuid, p_on boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
begin
  perform meldy_private.require_service_role();
  update bot.links l set last_seen_at = v_now
   where l.tg_user_id = p_tg_user_id and l.unlinked_at is null
  returning l.* into v_l;
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_container_id is null or p_on is null then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  if meldy_private.role_in(v_l.user_id, p_container_id) is null then
    return pg_catalog.jsonb_build_object('status', 'gone');
  end if;
  perform meldy_private.exam_remind_set_for(v_l.user_id, p_container_id, p_on);
  return pg_catalog.jsonb_build_object('status', 'ok', 'container_id', p_container_id, 'tg_remind', p_on,
                                       'exams', bot.exams_list(v_l.user_id, (v_now at time zone v_l.tz)::date));
end;
$fn$;

-- 6k. «Перенести экзамен» from the bot: the rules of exam_date_move on the link's local day. status: ok (+ title and
--     exam_date_move's object) | invalid (+ reason: for | date (null for everyone) | past | far) | forbidden (a member
--     for everyone) | gone (not the user's exam) | unlinked.
create or replace function public.bot_exam_move(p_tg_user_id bigint, p_container_id uuid, p_date date,
                                                p_for text default 'all')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_day date;
  v_role text;
  v_out jsonb;
begin
  perform meldy_private.require_service_role();
  update bot.links l set last_seen_at = v_now
   where l.tg_user_id = p_tg_user_id and l.unlinked_at is null
  returning l.* into v_l;
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  v_day := (v_now at time zone v_l.tz)::date;
  if p_for is null or p_for not in ('all', 'me') then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'for');
  end if;
  v_role := meldy_private.role_in(v_l.user_id, p_container_id);
  if v_role is null then
    return pg_catalog.jsonb_build_object('status', 'gone');
  end if;
  if p_date is null and p_for <> 'me' then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'date');
  end if;
  if p_date < v_day then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'past');
  end if;
  if p_date > v_day + 730 then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'far');
  end if;
  if p_for = 'all' and v_role <> 'owner' then
    return pg_catalog.jsonb_build_object('status', 'forbidden');
  end if;
  v_out := meldy_private.exam_date_move_for(v_l.user_id, p_container_id, p_date, p_for, null, v_day);
  return pg_catalog.jsonb_build_object('status', 'ok', 'title', (select c.title from public.containers c where c.id = p_container_id))
      || v_out;
end;
$fn$;

-- 7. Grants. PostgreSQL gives PUBLIC EXECUTE on a new function and Supabase's default privileges give anon and
--    authenticated more: taken back here (as the revokes files of the container and the bot do). The site's three run
--    for authenticated, the bot's three for the service role only, the helpers and the cores for their owner only.
--    CREATE OR REPLACE kept the grants of every function this file replaced.
revoke all on function bot.remind_on(uuid, uuid), bot.remind_any(uuid), bot.last_date(uuid, uuid), bot.exams_list(uuid, date)
  from public, anon, authenticated;
revoke all on function meldy_private.exam_date_move_for(uuid, uuid, date, text, uuid, date),
  meldy_private.exam_remind_set_for(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.exam_date_move(uuid, date, text, uuid), public.exam_remind_set(uuid, boolean),
  public.telegram_exams()
  from public, anon;
grant execute on function public.exam_date_move(uuid, date, text, uuid), public.exam_remind_set(uuid, boolean),
  public.telegram_exams()
  to authenticated;
revoke all on function public.bot_exams(bigint), public.bot_exam_remind(bigint, uuid, boolean),
  public.bot_exam_move(bigint, uuid, date, text)
  from public, anon, authenticated;
grant execute on function public.bot_exams(bigint), public.bot_exam_remind(bigint, uuid, boolean),
  public.bot_exam_move(bigint, uuid, date, text)
  to service_role;
