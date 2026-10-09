-- Numbers of the exam containers («экзамен» with subjects; supabase/migrations/20261009093500_containers.sql).
-- Read only. Run in the project's SQL Editor (role postgres) or through the agent's connector. Every figure comes with
-- its denominator. Accounts in analytics.excluded_accounts (the team, agents' test accounts) are left out entirely;
-- say in the slide how many there are (funnel.excluded_accounts). Add one with:
--   insert into analytics.excluded_accounts (user_id, reason) values ('<uuid>', 'team');
-- Provenance: the log and the states are written only by the server (record_test_answers, SECURITY DEFINER), which
-- computes correctness from the key; from the device come only ms (time on a question) and the local day (kept within
-- a day of the server's UTC day). Days below are those local days (test_answers.local_date).
-- Params: the window [d0, d1] and, optionally, one container.
with params as (
  select (current_date - 13)::date as d0, current_date::date as d1, null::uuid as only_container
),
excluded as (select user_id from analytics.excluded_accounts),
-- People: owners of a container with items, and members who joined one.
people as (
  select c.owner_id as user_id, c.id as container_id, c.created_at as since, 'owner' as role
    from public.containers c, params p
   where (p.only_container is null or c.id = p.only_container)
     and exists (select 1 from public.test_items i where i.container_id = c.id)
  union
  select m.user_id, m.container_id, m.joined_at, 'member'
    from public.container_members m, params p
   where (p.only_container is null or m.container_id = p.only_container)
),
people_in as (select * from people where user_id not in (select user_id from excluded)),
-- The answers that count for the numbers: every mode, without «late» (an older local day sent after a newer one:
-- the journal keeps it, the rule does not).
log as (
  select a.* from public.test_answers a join people_in pe on pe.user_id = a.user_id and pe.container_id = a.container_id, params p
   where a.local_date between p.d0 and p.d1 and a.step <> 'late'
),
per_user as (
  select pe.user_id,
         count(l.id) as answers,
         count(distinct l.local_date) as days,
         coalesce(sum(least(coalesce(l.ms, 30000), 180000)), 0) / 60000.0 as minutes
    from (select distinct user_id from people_in) pe left join log l on l.user_id = pe.user_id
   group by pe.user_id
),
funnel as (
  select (select count(distinct user_id) from people_in) as in_containers,
         (select count(*) from per_user where answers > 0) as answered,
         (select count(*) from per_user where days >= 2) as days_2,
         (select count(*) from per_user where days >= 4) as days_4
),
-- Minutes: ms per answer capped at 180 s (the plan's idle cap), 30 s when the device sent none.
per_active_day as (
  select user_id, local_date, count(*) as answers,
         sum(least(coalesce(ms, 30000), 180000)) / 60000.0 as minutes
    from log group by user_id, local_date
),
medians as (
  select count(distinct user_id) as people, count(*) as active_days,
         percentile_cont(0.5) within group (order by answers) as answers_median,
         percentile_cont(0.25) within group (order by answers) as answers_p25,
         percentile_cont(0.75) within group (order by answers) as answers_p75,
         round(percentile_cont(0.5) within group (order by minutes)::numeric, 1) as minutes_median,
         round(percentile_cont(0.25) within group (order by minutes)::numeric, 1) as minutes_p25,
         round(percentile_cont(0.75) within group (order by minutes)::numeric, 1) as minutes_p75
    from per_active_day
),
-- Coverage now: seen at least once (current key) of the keyed items, per person.
coverage as (
  select pe.user_id,
         count(*) filter (where i.keyed) as keyed,
         count(*) filter (where i.keyed and s.item_rev = i.rev and s.first_seen_day is not null) as seen,
         count(*) filter (where i.keyed and s.item_rev = i.rev and s.two_days_at is not null) as two_days
    from people_in pe
    join public.test_items i on i.container_id = pe.container_id
    left join public.test_item_states s on s.user_id = pe.user_id and s.item_id = i.id
   group by pe.user_id
),
-- «Верно в два разных дня» by day: an item counts from the day of its step 'two_days' until a miss that took it out of
-- the figure (step 'miss' with two_days_before) or the author's key change, whichever comes first.
chains as materialized (
  select a.user_id, a.item_id, a.item_rev, a.local_date as from_day,
         least(lost.day, fixed.day) as to_day
    from public.test_answers a
    join people_in pe on pe.user_id = a.user_id and pe.container_id = a.container_id
    left join lateral (select min(w.local_date) as day from public.test_answers w
                        where w.user_id = a.user_id and w.item_id = a.item_id and w.item_rev = a.item_rev
                          and w.step = 'miss' and w.two_days_before and w.id > a.id) lost on true
    left join lateral (select min((k.changed_at at time zone 'utc')::date) as day from public.test_item_key_changes k
                        where k.item_id = a.item_id and k.rev > a.item_rev) fixed on true
   where a.step = 'two_days'
),
days as (select generate_series(p.d0, p.d1, interval '1 day')::date as day from params p),
two_days_by_day as (
  select d.day, pe.user_id, count(c.item_id) as items
    from days d
    cross join (select distinct user_id from people_in) pe
    left join chains c on c.user_id = pe.user_id and c.from_day <= d.day and (c.to_day is null or c.to_day > d.day)
   group by d.day, pe.user_id
),
-- Checks of counted items once their moment had come (named_at + 5 / 12 / 25 / 50 days; 4 days on the last days before
-- the date): passed = step 'check'; failed = a miss of a counted item whose check was due by then. Early answers
-- (before the moment) are counted apart: they are neither.
checks as (
  select count(*) filter (where step = 'check') as passed,
         count(*) filter (where step = 'miss' and two_days_before and due_before <= created_at) as failed,
         count(*) filter (where step = 'early') as early,
         count(distinct user_id) filter (where step = 'check' or (step = 'miss' and two_days_before and due_before <= created_at)) as people
    from log
),
-- «Нажали не туда?»: how often a wrong tap (or a «Не знаю» pressed by mistake) was marked, of the answers (honest
-- numbers: it never counts as an error, so watch it).
misclicks as (
  select count(*) filter (where misclick) as misclicks, count(*) as answers, count(distinct user_id) filter (where misclick) as people
    from log where mode = 'learn'
),
mocks as (
  select count(*) as runs, count(distinct r.user_id) as people,
         percentile_cont(0.5) within group (order by r.correct::numeric / r.items) as share_correct_median
    from public.test_mock_runs r join people_in pe on pe.user_id = r.user_id and pe.container_id = r.container_id, params p
   where r.local_date between p.d0 and p.d1
)
select 'funnel' as what, jsonb_build_object('in_containers', f.in_containers, 'answered', f.answered,
         'days_2_plus', f.days_2, 'days_4_plus', f.days_4, 'excluded_accounts', (select count(*) from excluded)) as value
  from funnel f
union all
select 'per active day (answers, minutes)', to_jsonb(m) from medians m
union all
select 'coverage now (median of seen / keyed)', jsonb_build_object(
         'people', count(*), 'seen_median', percentile_cont(0.5) within group (order by seen),
         'keyed_median', percentile_cont(0.5) within group (order by keyed),
         'two_days_median', percentile_cont(0.5) within group (order by two_days))
  from coverage
union all
select 'two days by day (median, p25, p75 of people)', jsonb_agg(jsonb_build_object('day', x.day, 'people', x.people,
         'median', x.med, 'p25', x.p25, 'p75', x.p75) order by x.day)
  from (select day, count(*) as people, percentile_cont(0.5) within group (order by items) as med,
               percentile_cont(0.25) within group (order by items) as p25,
               percentile_cont(0.75) within group (order by items) as p75
          from two_days_by_day group by day) x
union all
select 'checks once due (5+ days)', to_jsonb(c) from checks c
union all
select 'misclicks («Нажали не туда?»)', to_jsonb(m) from misclicks m
union all
select 'mock runs («Как на экзамене»)', to_jsonb(k) from mocks k;
