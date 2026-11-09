-- group_summary: the author of an exam sees a summary of their group without names (owner, 2026-11-09).
-- Repo file: supabase/migrations/20261109090000_group_summary.sql. Base: the live order up to
-- 20261107090800_avatars_owner.sql. Nothing existing is replaced or altered: one new function.
-- Check after the apply: supabase/tests/group_summary.sql (read-only, catalog only). Local rehearsal (never live):
-- supabase/tests/local/group_summary_run.sh (with group_summary_behaviour.sql). Rollback:
-- supabase/rollback/20261109090000_group_summary_down.sql (the function dropped; no data is lost).
--
-- Why: the author of an exam saw only who came in (container_members_list: a name and dates). A real group of 19 went
-- from 16 people studying in its first week to 6, then to 1, and its author could not see that the group had stopped.
-- The owner approved (2026-11-09) a summary without names and knowingly changed the promise «Ваши ответы и прогресс не
-- видит никто»: this is the one exception to docs/answers-privacy.md (a student's answers belong to the student), and
-- it stays inside that rule — numbers of a group, never a person's answers or progress, never a name.
--
-- What this file adds: public.container_group_summary(p_container_id) → jsonb, for the exam's author only.
--   {members, min_members}                           while fewer than 5 members are in the exam: no other number;
--   {members, min_members, studied_7d, studied_prev_7d, studied_ever, learned_pct, hard_topics}   from 5 members.
--   members          who is in the exam now: not left, not removed (the number container_summary gives its author);
--   min_members      5: under it the function gives no number about the group;
--   studied_7d       members with at least one answer of their own in this exam in the last 7 days (168 hours);
--   studied_prev_7d  the same for the 7 days before those;
--   studied_ever     the same for any time;
--   learned_pct      the average over the members of «learned questions / questions that count», a whole percent; null
--                    when no question counts. A question counts and is learned as the plan says it for that member
--                    (meldy_private.plan_inputs_for and lib/containers/rule.ts inFigure): it has a key and the member
--                    has not set it aside by an open doubt; it is learned when the member's state under the question's
--                    current key has two_days_at;
--   hard_topics      at most 3 topics with the highest share of wrong answers in the last 30 days (720 hours), each
--                    {subject, topic, answers, wrong_pct}: only a topic where at least 5 different members answered
--                    and at least 30 answers exist, and whose share of wrong answers rounds to 1 % or more. topic is
--                    the topic's title (container_subjects.topics; «Тема N» when it has none, as the site names it),
--                    or null for questions without a topic: the subject as a whole. An answer counts here as the
--                    plan's pace counts it (not «Нажали не туда?», not a repeat inside a session) and only under the
--                    question's current key (an answer graded by a key the author has since changed says nothing
--                    about the topic).
-- Whose answers: the members' own. Not the author's (the author is not a member). Not the rows quiz_send_mistakes
-- writes (source 'quiz', 20261105090000_quiz_stats.sql): the author's press puts those into a member's training, they
-- are not the member's activity, and only mistakes are written, so they would bend the share of wrong answers.
-- Oral answers are not read at all (they live in the journal of the member's own copy, docs/answers-privacy.md).
-- What never leaves: an account id, a name, a row or a number about one person. No number is given about fewer than 5
-- people: the whole answer needs 5 members, a topic 5 different members who answered in it.
-- Errors (SQLSTATE), as container_members_list: 28000 not signed in; P0002 not the caller's exam (a member and a
-- stranger read the same «not found»).
-- Time: every window is counted in hours from now(), so the session's TimeZone never matters. The scan of the last 30
-- days is narrowed by local_date first (test_answers_container_day_idx): the answer core keeps local_date within one
-- day of the server's UTC day (meldy_private.clamp_day), so created_at >= X implies local_date >= X's UTC day - 1.
-- Re-runnable: CREATE OR REPLACE; the grants are explicit at the end. The whole file is one request (supabase/migrate.py).

set local lock_timeout = '2s';

do $do$
begin
  if pg_catalog.to_regprocedure('public.container_members_list(uuid)') is null
     or pg_catalog.to_regclass('public.container_members') is null
     or pg_catalog.to_regclass('public.test_answers') is null
     or pg_catalog.to_regclass('public.test_item_states') is null
     or pg_catalog.to_regclass('public.test_key_doubts') is null
     or not exists (select 1 from pg_catalog.pg_attribute a
                     where a.attrelid = 'public.test_answers'::regclass and a.attname = 'source' and not a.attisdropped) then
    raise exception 'the base is expected: 20261009093500_containers.sql and what follows it';
  end if;
end;
$do$;

create or replace function public.container_group_summary(p_container_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  c_min constant integer := 5;             -- no number is given about fewer people than this
  c_topic_answers constant integer := 30;  -- a topic is named from this many answers
  v_user uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_week timestamptz := v_now - pg_catalog.make_interval(hours => 168);
  v_prev timestamptz := v_now - pg_catalog.make_interval(hours => 336);
  v_month timestamptz := v_now - pg_catalog.make_interval(hours => 720);
  v_members integer;
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.containers c where c.id = p_container_id and c.owner_id = v_user) then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  select pg_catalog.count(*)::integer into v_members
    from public.container_members m
   where m.container_id = p_container_id and m.left_at is null and m.removed_at is null and m.user_id <> v_user;
  if v_members < c_min then
    return pg_catalog.jsonb_build_object('members', v_members, 'min_members', c_min);
  end if;

  with mem as materialized (
    select m.user_id
      from public.container_members m
     where m.container_id = p_container_id and m.left_at is null and m.removed_at is null and m.user_id <> v_user
  ),
  -- Who answered, and when: one row per member with an answer of their own in this exam.
  act as (
    select a.user_id,
           pg_catalog.bool_or(a.created_at >= v_week) as week,
           pg_catalog.bool_or(a.created_at >= v_prev and a.created_at < v_week) as prev
      from public.test_answers a
     where a.container_id = p_container_id and a.source <> 'quiz'
       and a.user_id in (select mem.user_id from mem)
     group by a.user_id
  ),
  -- The questions a member set aside by an open doubt: out of that member's plan, so out of their share too.
  aside as (
    select d.user_id, pg_catalog.count(*) as n
      from public.test_key_doubts d
      join public.test_items i on i.id = d.item_id and i.keyed
     where d.container_id = p_container_id and d.resolved_at is null
       and d.user_id in (select mem.user_id from mem)
     group by d.user_id
  ),
  learned as (
    select st.user_id, pg_catalog.count(*) as n
      from public.test_item_states st
      join public.test_items i on i.id = st.item_id and i.rev = st.item_rev and i.keyed
     where st.container_id = p_container_id and st.two_days_at is not null
       and st.user_id in (select mem.user_id from mem)
       and not exists (select 1 from public.test_key_doubts d
                        where d.item_id = st.item_id and d.user_id = st.user_id and d.resolved_at is null)
     group by st.user_id
  ),
  -- Each member's share, then the average of the shares (a member without a learned question counts as 0).
  share as (
    select pg_catalog.round(pg_catalog.avg(coalesce(l.n, 0)::numeric / nullif(k.n - coalesce(s.n, 0), 0)) * 100)::integer as pct
      from mem
     cross join (select pg_catalog.count(*) as n from public.test_items i
                  where i.container_id = p_container_id and i.keyed) k
      left join learned l on l.user_id = mem.user_id
      left join aside s on s.user_id = mem.user_id
  ),
  topic as (
    select i.subject_id, i.topic, pg_catalog.count(*) as answers,
           pg_catalog.count(*) filter (where not a.correct) as wrong
      from public.test_answers a
      join public.test_items i on i.id = a.item_id and i.rev = a.item_rev and i.container_id = p_container_id
     where a.container_id = p_container_id and a.source <> 'quiz' and not a.misclick and not a.retry
       and a.local_date >= (v_month at time zone 'utc')::date - 1
       and a.created_at >= v_month
       and a.user_id in (select mem.user_id from mem)
     group by i.subject_id, i.topic
    having pg_catalog.count(distinct a.user_id) >= c_min and pg_catalog.count(*) >= c_topic_answers
  ),
  hard as (
    select s.title as subject,
           case when t.topic is not null
                then coalesce(nullif(pg_catalog.btrim(s.topics ->> (t.topic - 1)), ''), 'Тема ' || t.topic) end as topic,
           t.answers, pg_catalog.round(100.0 * t.wrong / t.answers)::integer as wrong_pct,
           pg_catalog.row_number() over (order by t.wrong::numeric / t.answers desc, t.answers desc,
                                                  s.position, s.created_at, s.id, t.topic nulls first) as place
      from topic t
      join public.container_subjects s on s.id = t.subject_id
     where t.wrong * 200 >= t.answers
  )
  select pg_catalog.jsonb_build_object(
           'members', v_members, 'min_members', c_min,
           'studied_7d', (select pg_catalog.count(*) from act where act.week),
           'studied_prev_7d', (select pg_catalog.count(*) from act where act.prev),
           'studied_ever', (select pg_catalog.count(*) from act),
           'learned_pct', (select share.pct from share),
           'hard_topics', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                      'subject', h.subject, 'topic', h.topic, 'answers', h.answers,
                                      'wrong_pct', h.wrong_pct) order by h.place)
                                      from hard h where h.place <= 3), '[]'::jsonb))
    into v_out;
  return v_out;
end;
$fn$;
comment on function public.container_group_summary(uuid) is
  'The exam''s author only: the group''s numbers without names (members, who studied in the last 7 days, the 7 days before and ever, the average share of learned questions, up to 3 hard topics). No number about fewer than 5 people; no account id, no name. 20261109090000_group_summary, docs/answers-privacy.md.';

-- Grants. PostgreSQL gives PUBLIC EXECUTE on a new function and Supabase's default privileges give anon,
-- authenticated and service_role more: taken back here. The function runs for authenticated only (it asks auth.uid()
-- for the exam's author; the service role has no account of its own to ask about).
revoke all on function public.container_group_summary(uuid) from public;
do $do$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    revoke all on function public.container_group_summary(uuid) from anon;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke all on function public.container_group_summary(uuid) from service_role;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    grant execute on function public.container_group_summary(uuid) to authenticated;
  end if;
end;
$do$;
