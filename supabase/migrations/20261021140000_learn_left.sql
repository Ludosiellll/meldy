-- learn_left
-- Repo file: supabase/migrations/20261021140000_learn_left.sql («Осталось выучить», the owner, 2026-10-21: the exam's
-- cheat sheet gives way to topics that close when learned; design learn-left §4).
-- Rollback: supabase/rollback/20261021140000_learn_left_down.sql. Contract after the apply: supabase/tests/learn_left.sql.
-- Local rehearsal (never live): supabase/tests/local/learn_left_run.sh — the migration twice, the equivalence with the
-- site's line rule on contracts/learn_left/vectors.json, the behaviour of public.learn_left and public.bot_learn_left on
-- a fixture, the contract, the rollback.
--
-- What the oral topics need from the server, in ONE call (the site groups them itself: frontend/src/lib/containers/
-- topics.ts, copied to the bot): for each oral exam its questions with the fact «learned» under the plan's own rule,
-- the lecture that answers each, the department's section titles and the questions outside the plan. Before this the
-- oral page read the cheat sheet from the Space (GET /api/oral/sheet, about 1.1 s) and then its journal (two more reads)
-- and built 600 elements of paper; «Сегодня» did the same per exam card.
--
--   * meldy_private.norm_point_title(text) — lib/exams/cheatSheet.ts normalizeTitle: lower case, «ё» as «е», the signs
--     of comparison, arithmetic and direction as words of their own, every other run of non-letters and non-digits one
--     space, trimmed. Letters and digits are the database's [[:alnum:]] (the live UTF-8 locale) where JS has \p{L}\p{N}.
--   * meldy_private.learn_left_facts(p_sheet jsonb, p_events jsonb, p_now timestamptz, p_tz text) — pure: a sheet as
--     meldy_private.oral_sheet_for gives it (parsed as parseSheetResponse keeps it) and the journal rows of its written
--     questions (as fetchSheetEvents reads them: oral_point and sheet_peek by payload.question_hash) → per question, in the
--     sheet's order: its kind (cheatSheet.ts blockKind; 'none' for a question in no lecture), state (0 not answered · 1
--     some main points named · 2 every main point named, waiting for another day · 3 learned), the main points named and
--     in all, learned_at, ready_at (state 2: from when an answer makes it learned) and missed (the last checked answer
--     missed a main point). Main points: the essential ones, or every point when none is essential (oralParts.ts
--     decidingLines). A point's line rule is lineStatus of cheatSheet.ts, without recursion: its events by the point's
--     words (or, without words, by its key; twin words of one rubric by the point's id), one per answer; a naming after a
--     peek of the point earlier the same local day is skipped; the series is the namings after the last miss (a naming
--     after the examiner's question is a miss); the point is learned once a naming of the series falls on another local
--     day than its first and at least 20 hours after it (milliseconds, as Date.parse). A due check stays learned.
--     contracts/learn_left/vectors.json holds shared cases the site's rule and this function both answer.
--   * meldy_private.learn_left_for(p_user, p_exam_ids, p_tz, p_now) jsonb — [{exam_id, title, mapping_state, lectures:
--     [[id, title]], section_titles, to_write, units, q: [[id, position, label, section, lecture, kind, state, named, of,
--     learned_at, ready_at, missed]]}] for p_user's exams (all of them, the 50 newest, when p_exam_ids is null); moments
--     in epoch seconds (learned_at down, ready_at up); lecture = the index into lectures (the exam's order, oral_sheet_for's)
--     of the lecture with the most fragments in exam_questions.evidence, the earlier one on a tie, null when none.
--   * public.learn_left(p_exam_ids uuid[] default null, p_tz text default null) jsonb {v: 1, tz, exams} — the signed-in
--     user's (28000 otherwise); p_tz an IANA zone of the device (a bad or missing one: Europe/Minsk); at most 100 ids
--     (22023). One call serves the oral exam page (its id) and «Сегодня» (no ids).
--   * public.bot_learn_left(p_tg_user_id bigint) jsonb — the bot (service role, the user only through bot.active_link):
--     {linked: true, parts: [{container_id, subject_id, exam_id}] (bot_oral_inputs' parts), subjects: [{id, topics}] (the
--     titles of the file's topics of every subject of the user's exams), exams: learn_left_for(… the parts' exams, the
--     link's zone)} | {linked: false}.
--   * The index learning_events_user_qhash_idx (user_id, payload->>'question_hash', created_at) for the two kinds: the
--     journal read by question hash (learn_left, the bot's oral_events_for, the site's fetchSheetEvents).
-- Additive and re-runnable: new functions (CREATE OR REPLACE) and an index (IF NOT EXISTS); no table, column, policy or
-- existing function is touched. SECURITY DEFINER with an empty search_path where clients or the bot call; explicit grants.

-- 1. normalizeTitle.
create or replace function meldy_private.norm_point_title(p_text text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select pg_catalog.btrim(
           pg_catalog.regexp_replace(
             pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.lower(coalesce(p_text, '')), 'ё', 'е'),
                                       '([<>=≤≥≠+−×÷↑↓→←⇒])', ' \1 ', 'g'),
             '[^[:alnum:]<>=≤≥≠+−×÷↑↓→←⇒]+', ' ', 'g'),
           ' ')
$fn$;

-- 2. The facts per question of one sheet, from its journal rows (pure).
create or replace function meldy_private.learn_left_facts(p_sheet jsonb, p_events jsonb, p_now timestamptz, p_tz text)
returns table (question_id text, ord bigint, kind text, state integer, named integer, deciding integer,
               learned_at timestamptz, ready_at timestamptz, missed boolean)
language sql
stable
set search_path = ''
as $fn$
  with
  -- The questions parseSheetResponse keeps (a uuid and a text), with a rubric when its id is a uuid (parseRubric).
  q0 as (
    select x.value as j, x.ord, x.value ->> 'question_id' as qid,
           case when pg_catalog.jsonb_typeof(x.value -> 'question_hash') = 'string'
                 and pg_catalog.lower(x.value ->> 'question_hash') ~ '^[0-9a-f]{32}$'
                then pg_catalog.lower(x.value ->> 'question_hash') else '' end as hash,
           case when pg_catalog.jsonb_typeof(x.value -> 'coverage') = 'string'
                 and (x.value ->> 'coverage') in ('full', 'partial', 'none', 'unverified') then x.value ->> 'coverage' end as coverage,
           case when pg_catalog.jsonb_typeof(x.value -> 'rubric') = 'object'
                 and pg_catalog.jsonb_typeof(x.value -> 'rubric' -> 'rubric_id') = 'string'
                 and (x.value -> 'rubric' ->> 'rubric_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                then x.value -> 'rubric' end as rubric
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_sheet -> 'questions') = 'array'
                                                then p_sheet -> 'questions' else '[]'::jsonb end) with ordinality as x(value, ord)
     where pg_catalog.jsonb_typeof(x.value) = 'object'
       and pg_catalog.jsonb_typeof(x.value -> 'question_id') = 'string'
       and (x.value ->> 'question_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       and pg_catalog.jsonb_typeof(x.value -> 'text') = 'string'
       and pg_catalog.btrim(pg_catalog.left(x.value ->> 'text', 1000), E'\t\n\x0b\x0c\r                  　﻿') <> ''
  ),
  -- Its points as parseRubric keeps them: an id p1..p6 and a title, the first of an id; none under coverage «none».
  p0 as (
    select q0.qid, p.ord as pord, p.value ->> 'id' as pid,
           pg_catalog.btrim(pg_catalog.left(p.value ->> 'title', 240), E'\t\n\x0b\x0c\r                  　﻿') as title,
           (p.value -> 'essential') = 'true'::jsonb as essential
      from q0
      cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(q0.rubric -> 'points') = 'array'
                                                              then q0.rubric -> 'points' else '[]'::jsonb end) with ordinality as p(value, ord)
     where q0.rubric is not null
       and not ((q0.rubric -> 'coverage') = '"none"'::jsonb)
       and pg_catalog.jsonb_typeof(p.value) = 'object'
       and pg_catalog.jsonb_typeof(p.value -> 'id') = 'string' and (p.value ->> 'id') ~ '^p[1-6]$'
       and pg_catalog.jsonb_typeof(p.value -> 'title') = 'string'
  ),
  p1 as (
    select distinct on (p0.qid, p0.pid) p0.* from p0 where p0.title <> '' order by p0.qid, p0.pid, p0.pord
  ),
  -- The block kind (cheatSheet.ts blockKind), a question in no lecture told apart as 'none'.
  q as (
    select q0.*, pg_catalog.lower(q0.rubric ->> 'rubric_id') as rubric_id,
           case when q0.coverage = 'none' then 'none'
                when q0.rubric is not null then
                  case when (q0.rubric -> 'coverage') = '"none"'::jsonb or not exists (select 1 from p1 where p1.qid = q0.qid)
                       then 'gap' else 'lines' end
                when q0.coverage is null then 'unmapped'
                when q0.coverage = 'unverified' then 'unverified'
                when (q0.j -> 'unwritable') = 'true'::jsonb then 'gap'
                when (q0.j -> 'rebuilt') = 'true'::jsonb then 'rebuilt'
                else 'unwritten' end as kind
      from q0
  ),
  -- The written questions' points with their words; twins: another point of the rubric has the same words.
  pw as (
    select p1.qid, p1.pid, p1.essential, q.hash, q.rubric_id, meldy_private.norm_point_title(p1.title) as words
      from p1 join q on q.qid = p1.qid
     where q.kind = 'lines'
  ),
  pt as (
    select pw.*, pg_catalog.count(*) over (partition by pw.qid, pw.words) > 1 as twin,
           pg_catalog.bool_or(pw.essential) over (partition by pw.qid) as any_essential
      from pw
  ),
  -- The deciding lines: the essential points, or every point when none is essential.
  d as (select pt.* from pt where pt.essential or not pt.any_essential),
  -- The journal rows (api/learning.ts normalizeEvent's fields).
  e as (
    select (x.value ->> 'id')::uuid as id, (x.value ->> 'created_at')::timestamptz as at,
           coalesce(x.value ->> 'local_date', '') as day, x.value ->> 'kind' as ekind,
           coalesce(x.value ->> 'item_key', '') as item_key,
           case when pg_catalog.jsonb_typeof(x.value -> 'correct') = 'boolean' then (x.value -> 'correct')::boolean end as correct,
           nullif(x.value ->> 'session_id', '') as session_id,
           case when pg_catalog.jsonb_typeof(x.value -> 'payload' -> 'question_hash') = 'string' then x.value -> 'payload' ->> 'question_hash' else '' end as hash,
           case when pg_catalog.jsonb_typeof(x.value -> 'payload' -> 'title') = 'string'
                then meldy_private.norm_point_title(x.value -> 'payload' ->> 'title') else '' end as words,
           case when pg_catalog.jsonb_typeof(x.value -> 'payload' -> 'rubric_id') = 'string' then pg_catalog.lower(x.value -> 'payload' ->> 'rubric_id') else '' end as rubric,
           case when pg_catalog.jsonb_typeof(x.value -> 'payload' -> 'point_id') = 'string' then x.value -> 'payload' ->> 'point_id' else '' end as point_id,
           case when pg_catalog.jsonb_typeof(x.value -> 'payload' -> 'status') = 'string' then x.value -> 'payload' ->> 'status' else '' end as status,
           (x.value -> 'payload' -> 'followup_status') = '"covered"'::jsonb as followup
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_events) = 'array' then p_events else '[]'::jsonb end) as x(value)
     where pg_catalog.jsonb_typeof(x.value) = 'object' and (x.value ->> 'kind') in ('oral_point', 'sheet_peek')
  ),
  -- Each line's events (cheatSheet.ts belongs): the question's hash and the point's words; without words, its key.
  m as (
    select d.qid, d.pid, e.*
      from d join e on e.hash = d.hash and d.hash <> ''
     where case when e.words <> '' then
                  e.words = d.words
                  and not (d.twin and e.rubric <> '' and e.rubric = d.rubric_id and e.point_id <> '' and e.point_id <> d.pid)
                else e.item_key = (case when e.ekind = 'sheet_peek' then 'peek:' else 'oral:' end) || d.rubric_id || ':' || d.pid end
  ),
  -- One answer names a line once (onePerAnswer): its own point's event, else the lower id.
  k as (
    select m.* from m where not (m.ekind = 'oral_point' and m.session_id is not null)
    union all
    select y.* from (select distinct on (m.qid, m.pid, m.session_id) m.*
                       from m where m.ekind = 'oral_point' and m.session_id is not null
                      order by m.qid, m.pid, m.session_id, (m.point_id = m.pid) desc, m.id) y
  ),
  o as (
    select k.*,
           case when k.ekind = 'sheet_peek' then 'peek'
                when k.correct is null then null
                when k.correct and k.status in ('missing', 'partial', 'wrong') and k.followup then 'missed'
                when k.correct then 'named'
                else 'missed' end as outcome
      from k
  ),
  -- The checked answers that count: a naming after a peek of the line earlier that local day is skipped.
  c as (
    select o.* from o
     where o.outcome in ('named', 'missed')
       and not (o.outcome = 'named' and o.day <> '' and exists (
                  select 1 from o p where p.qid = o.qid and p.pid = o.pid and p.outcome = 'peek' and p.day = o.day
                     and (p.at, p.id) < (o.at, o.id)))
  ),
  lm as (
    select distinct on (c.qid, c.pid) c.qid, c.pid, c.at, c.id from c where c.outcome = 'missed'
     order by c.qid, c.pid, c.at desc, c.id desc
  ),
  la as (
    select distinct on (c.qid, c.pid) c.qid, c.pid, c.outcome from c order by c.qid, c.pid, c.at desc, c.id desc
  ),
  -- The series: the namings after the last miss; its first, and the naming that completes the rule.
  s as (
    select c.* from c left join lm on lm.qid = c.qid and lm.pid = c.pid
     where c.outcome = 'named' and (lm.qid is null or (c.at, c.id) > (lm.at, lm.id))
  ),
  f as (
    select distinct on (s.qid, s.pid) s.qid, s.pid, s.at, s.day from s order by s.qid, s.pid, s.at, s.id
  ),
  er as (
    select distinct on (s.qid, s.pid) s.qid, s.pid, s.at
      from s join f on f.qid = s.qid and f.pid = s.pid
     where s.day <> '' and f.day <> '' and s.day <> f.day
       and pg_catalog.date_trunc('milliseconds', s.at) - pg_catalog.date_trunc('milliseconds', f.at) >= interval '20 hours'
     order by s.qid, s.pid, s.at, s.id
  ),
  pk as (
    select distinct o.qid, o.pid from o
     where o.outcome = 'peek' and o.day = pg_catalog.to_char((p_now at time zone p_tz)::date, 'YYYY-MM-DD')
  ),
  l as (
    select d.qid, d.pid,
           case when la.qid is null then 'fresh'
                when la.outcome = 'missed' then 'missed'
                when er.qid is not null then 'erased'
                else 'rubbed' end as st,
           er.at as erased_at,
           -- rubbed: lineStatus's erasableFrom (20 hours, the next local midnight, not today after a peek today)
           greatest(
             pg_catalog.date_trunc('milliseconds', f.at) + interval '20 hours',
             case when f.day ~ '^\d{4}-\d{2}-\d{2}$' then ((f.day::date + 1)::timestamp at time zone p_tz) end,
             case when pk.qid is not null then (((p_now at time zone p_tz)::date + 1)::timestamp at time zone p_tz) end) as ready
      from d
      left join la on la.qid = d.qid and la.pid = d.pid
      left join er on er.qid = d.qid and er.pid = d.pid
      left join f on f.qid = d.qid and f.pid = d.pid
      left join pk on pk.qid = d.qid and pk.pid = d.pid
  ),
  a as (
    select l.qid, pg_catalog.count(*)::integer as deciding,
           (pg_catalog.count(*) filter (where l.st in ('rubbed', 'erased')))::integer as named,
           pg_catalog.bool_and(l.st = 'erased') as learned,
           pg_catalog.bool_or(l.st = 'missed') as missed,
           pg_catalog.max(l.erased_at) as learned_at,
           pg_catalog.max(l.ready) filter (where l.st = 'rubbed') as ready
      from l group by l.qid
  )
  select q.qid, q.ord, q.kind,
         case when a.learned then 3 when a.deciding > 0 and a.named = a.deciding then 2 when a.named > 0 then 1 else 0 end,
         coalesce(a.named, 0), coalesce(a.deciding, 0),
         case when a.learned then a.learned_at end,
         case when not a.learned and a.deciding > 0 and a.named = a.deciding then a.ready end,
         coalesce(a.missed, false)
    from q left join a on a.qid = q.qid and q.kind = 'lines'
   order by q.ord
$fn$;

-- 3. The oral exams of a user with their facts, lectures and sections.
create or replace function meldy_private.learn_left_for(p_user uuid, p_exam_ids uuid[], p_tz text,
                                                        p_now timestamptz default pg_catalog.now())
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_exam record;
  v_sheet jsonb;
  v_hashes text[];
  v_events jsonb;
  v_lectures uuid[];
  v_lecture_rows jsonb;
  v_q jsonb;
  v_out jsonb := '[]'::jsonb;
begin
  for v_exam in
    select x.id, x.title, x.ticket_layout, x.mapping_state
      from (select e.id, e.title, e.ticket_layout, e.mapping_state, e.created_at from public.exams e
             where e.user_id = p_user and (p_exam_ids is null or e.id = any (p_exam_ids))
             order by e.created_at desc, e.id desc
             limit case when p_exam_ids is null then 50 end) x
     order by x.created_at, x.id
  loop
    v_sheet := meldy_private.oral_sheet_for(p_user, v_exam.id);
    -- The journal of its written questions (sheetHashes; fetchSheetEvents), through learning_events_user_qhash_idx.
    select coalesce(pg_catalog.array_agg(distinct q ->> 'question_hash'), '{}'::text[]) into v_hashes
      from pg_catalog.jsonb_array_elements(v_sheet -> 'questions') as q
     where pg_catalog.jsonb_typeof(q -> 'rubric') = 'object' and (q ->> 'question_hash') ~ '^[0-9a-f]{32}$';
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', ev.id, 'created_at', ev.created_at, 'local_date', pg_catalog.to_char(ev.local_date, 'YYYY-MM-DD'),
             'kind', ev.kind, 'item_key', ev.item_key, 'correct', ev.correct, 'session_id', ev.session_id,
             'payload', pg_catalog.jsonb_build_object(
               'question_hash', ev.payload -> 'question_hash', 'title', ev.payload -> 'title',
               'rubric_id', ev.payload -> 'rubric_id', 'point_id', ev.payload -> 'point_id',
               'status', ev.payload -> 'status', 'followup_status', ev.payload -> 'followup_status'))), '[]'::jsonb)
      into v_events
      from public.learning_events ev
     where pg_catalog.cardinality(v_hashes) > 0
       and ev.user_id = p_user and ev.kind in ('oral_point', 'sheet_peek')
       and (ev.payload ->> 'question_hash') = any (v_hashes);
    -- The exam's lectures in oral_sheet_for's order (oral_api._exam_material_ids).
    select coalesce(pg_catalog.array_agg(m.material_id order by m.added_at, m.material_id), '{}'::uuid[]) into v_lectures
      from (select em.material_id, em.added_at from public.exam_materials em
             where em.exam_id = v_exam.id and em.user_id = p_user
             order by em.added_at, em.material_id limit 1000) m;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(l.mid, coalesce(mt.title, '')) order by l.idx), '[]'::jsonb)
      into v_lecture_rows
      from pg_catalog.unnest(v_lectures) with ordinality as l(mid, idx)
      left join public.materials mt on mt.id = l.mid;
    with ev as (
      -- Fragments per lecture of each question (the mapping's evidence).
      select x.id as qid, pg_catalog.lower(el ->> 'material_id') as mid, pg_catalog.count(*) as n
        from public.exam_questions x
        cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(x.evidence) = 'array'
                                                                then x.evidence else '[]'::jsonb end) as el
       where x.exam_id = v_exam.id and x.user_id = p_user and pg_catalog.jsonb_typeof(el) = 'object'
       group by 1, 2
    ),
    best as (
      select distinct on (ev.qid) ev.qid, (l.idx - 1)::integer as lecture
        from ev join pg_catalog.unnest(v_lectures) with ordinality as l(mid, idx) on l.mid::text = ev.mid
       order by ev.qid, ev.n desc, l.idx
    )
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
             f.question_id,
             case when pg_catalog.jsonb_typeof(sq.j -> 'position') = 'number' then (sq.j ->> 'position')::numeric::integer end,
             coalesce(sq.j ->> 'label', ''),
             case when pg_catalog.jsonb_typeof(sq.j -> 'section') = 'number' then sq.j -> 'section' end,
             b.lecture, f.kind, f.state, f.named, f.deciding,
             pg_catalog.floor(extract(epoch from pg_catalog.date_trunc('milliseconds', f.learned_at)))::bigint,
             pg_catalog.ceil(extract(epoch from pg_catalog.date_trunc('milliseconds', f.ready_at)))::bigint,
             case when f.missed then 1 else 0 end) order by f.ord), '[]'::jsonb)
      into v_q
      from meldy_private.learn_left_facts(v_sheet, v_events, p_now, p_tz) f
      cross join lateral (select v_sheet -> 'questions' -> ((f.ord - 1)::integer) as j) sq
      left join best b on b.qid::text = pg_catalog.lower(f.question_id);
    v_out := v_out || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'exam_id', v_exam.id,
      'title', v_exam.title,
      'mapping_state', coalesce(v_sheet ->> 'mapping_state', v_exam.mapping_state),
      'lectures', v_lecture_rows,
      'section_titles', case when pg_catalog.jsonb_typeof(v_exam.ticket_layout -> 'section_titles') = 'array'
                             then (select coalesce(pg_catalog.jsonb_agg(case when pg_catalog.jsonb_typeof(t.value) = 'string'
                                                                             then t.value else '""'::jsonb end order by t.ord), '[]'::jsonb)
                                     from pg_catalog.jsonb_array_elements(v_exam.ticket_layout -> 'section_titles') with ordinality as t(value, ord))
                             else '[]'::jsonb end,
      'to_write', coalesce((v_sheet ->> 'to_write')::integer, 0),
      'units', coalesce((v_sheet ->> 'units')::integer, 0),
      'q', v_q));
  end loop;
  return v_out;
end;
$fn$;

-- 4. The site: the signed-in user's oral exams (these ids, or all of them) in the device's zone.
create or replace function public.learn_left(p_exam_ids uuid[] default null, p_tz text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_tz text := 'Europe/Minsk';
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_exam_ids is not null and pg_catalog.cardinality(p_exam_ids) > 100 then
    raise exception 'exam_ids' using errcode = '22023';
  end if;
  if p_tz is not null and p_tz ~ '^[A-Za-z][A-Za-z0-9_+/-]{0,63}$' then
    begin
      perform pg_catalog.now() at time zone p_tz;
      v_tz := p_tz;
    exception when others then
      v_tz := 'Europe/Minsk';
    end;
  end if;
  return pg_catalog.jsonb_build_object('v', 1, 'tz', v_tz,
                                       'exams', meldy_private.learn_left_for(v_uid, p_exam_ids, v_tz, pg_catalog.now()));
end;
$fn$;

-- 5. The bot (service role): the oral parts it plans (bot_oral_inputs' parts), the file's topic titles of the user's
--    subjects, and the facts of the parts' exams in the link's zone.
create or replace function public.bot_learn_left(p_tg_user_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_l bot.links%rowtype;
  v_parts jsonb;
  v_ids uuid[];
  v_subjects jsonb;
begin
  perform meldy_private.require_service_role();
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('linked', false);
  end if;
  -- The parts the site plans (bot_oral_inputs, 20261018120000): the author's oral exam, or a member's bound copy.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('container_id', w.container_id, 'subject_id', w.subject_id,
                                                                     'exam_id', w.exam_id) order by w.n), '[]'::jsonb),
         coalesce(pg_catalog.array_agg(w.exam_id order by w.n), '{}'::uuid[])
    into v_parts, v_ids
    from (select c.id as container_id, s.id as subject_id, x.exam_id,
                 pg_catalog.row_number() over (order by c.exam_date nulls last, c.created_at desc, c.id, s.position, s.created_at, s.id) as n
            from public.containers c
            join public.container_subjects s on s.container_id = c.id and s.exam_id is not null
            cross join lateral (select case meldy_private.role_in(v_l.user_id, c.id)
                                         when 'owner' then s.exam_id
                                         when 'member' then (select me.exam_id from public.container_member_exams me
                                                              where me.subject_id = s.id and me.user_id = v_l.user_id) end as exam_id) x
            join public.exams e on e.id = x.exam_id and e.user_id = v_l.user_id
           where c.id in (select y.id from meldy_private.container_ids_of(v_l.user_id) as y(id))) w;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', s.id, 'topics', s.topics)
                                       order by s.container_id, s.position, s.created_at, s.id), '[]'::jsonb)
    into v_subjects
    from public.container_subjects s
   where s.container_id in (select y.id from meldy_private.container_ids_of(v_l.user_id) as y(id));
  return pg_catalog.jsonb_build_object(
    'linked', true,
    'parts', v_parts,
    'subjects', v_subjects,
    'exams', case when pg_catalog.cardinality(v_ids) = 0 then '[]'::jsonb
                  else meldy_private.learn_left_for(v_l.user_id, v_ids, coalesce(nullif(v_l.tz, ''), 'Europe/Minsk'), pg_catalog.now()) end);
end;
$fn$;

-- 6. The journal by question hash, for the two kinds the line rule reads.
create index if not exists learning_events_user_qhash_idx
  on public.learning_events (user_id, (payload ->> 'question_hash'), created_at)
  where kind in ('oral_point', 'sheet_peek');

-- 7. Grants. PostgreSQL gives PUBLIC EXECUTE on a new function and Supabase's default privileges give anon and
--    authenticated more: taken back here. The site's function for authenticated, the bot's for the service role, the
--    cores for their owner only.
revoke all on function meldy_private.norm_point_title(text), meldy_private.learn_left_facts(jsonb, jsonb, timestamptz, text),
  meldy_private.learn_left_for(uuid, uuid[], text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.learn_left(uuid[], text) from public, anon;
grant execute on function public.learn_left(uuid[], text) to authenticated;
revoke all on function public.bot_learn_left(bigint) from public, anon, authenticated;
grant execute on function public.bot_learn_left(bigint) to service_role;
