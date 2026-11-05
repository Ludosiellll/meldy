-- item_points: a question's own points, for a «Контрольная» of the exam's subjects (owner's spec meldy-notes
-- 10_Project/Test_Builder_Spec_2026-10-18.md «Выпуск 48»: «баллы за вопрос»). Repo file:
-- supabase/migrations/20261107090700_item_points.sql. Base: the live order up to 20261107090500_studio_pages.sql. Each
-- function replaced here is its newest earlier body with this file's change: meldy_private.quiz_start_for
-- (20261020120000_quiz_protection.sql), public.container_items_add (20261101090000_question_kinds.sql),
-- public.container_item_update (20261107090300_ai_key_flag.sql).
-- Check after the apply: supabase/tests/item_points.sql (read-only). Local rehearsal (never live):
-- supabase/tests/local/item_points_run.sh. Rollback: supabase/rollback/20261107090700_item_points_down.sql (the three
-- bodies back byte for byte, the helper and the column dropped).
--
-- Why: until now a question's points lived only on a question block of the studio's page (test_docs, «points»), so only
-- a quiz «как в студии» weighed its questions; a quiz of the exam's subjects, and the author's numbers for it, counted
-- every question as 1.
-- 1. public.test_items.points: smallint, not null, default 1 (every existing row reads 1 at once: the table is not
--    rewritten), and the check test_items_points_check 1..100, validated as every check of test_items is
--    (supabase/tests/containers.sql «item_limits_validated»): one read of the table under the ADD's ACCESS EXCLUSIVE
--    lock, no rewrite (20261101090000_question_kinds.sql validated three costlier checks of it the same way). The check
--    is added only when missing, so a second apply reads nothing. lock_timeout 2s: a busy table makes the apply fail at
--    once instead of queueing answers behind it.
-- 2. meldy_private.quiz_item_points(p_items): the points of the drawn questions in the attempt's order, or null when
--    every one of them weighs 1 (such an attempt is stored exactly as before).
-- 3. meldy_private.quiz_start_for: a new attempt of a quiz of subjects keeps its questions' points in
--    quiz_attempts.item_points, beside item_ids, as an attempt of a design quiz keeps its blocks' points since
--    20261019100000_test_docs.sql. Every reader of a score already weighs by item_points (quiz_result_json: score,
--    max_score, percent, passed, band; quiz_results; quiz_me; quiz_list; quiz_score and quiz_close_summary for
--    Telegram), so the result, the pass mark and the author's results and statistics follow without another change. A
--    later edit of a question's points changes no started or finished attempt; attempts started before this file keep
--    item_points null and their scores. A design quiz keeps its blocks' points: the studio stays the source there.
-- 4. public.container_items_add: an element may carry points (a JSON whole number 1..100; absent or null — 1); anything
--    else is 22023 detail «item <n>: points».
-- 5. public.container_item_update: p_patch may carry points (a JSON whole number 1..100, else 22023 detail 'points'); it
--    is not the key: rev, key_source, the key-change history and the AI's mark are untouched by it. The result adds
--    points (as stored).
-- Nothing else reads the column: the study core (sessions, the plan, the bot's «занятие») and the live games count as before.
-- Re-runnable: IF NOT EXISTS, OR REPLACE (each replaced function keeps its grants), the check added only when missing;
-- a second apply leaves the catalog as the first one did. The whole file is one request (supabase/migrate.py).

set local lock_timeout = '2s';

do $do$
begin
  if pg_catalog.to_regprocedure('meldy_private.quiz_start_for(text, text, uuid, text)') is null
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('meldy_private.quiz_start_for(text, text, uuid, text)'::regprocedure),
                          'meldy_private.quiz_doc_points(v_q.container_id, v_items)') = 0
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('meldy_private.quiz_start_for(text, text, uuid, text)'::regprocedure),
                          '''reload''') = 0
     or pg_catalog.to_regprocedure('public.container_items_add(uuid, jsonb)') is null
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.container_items_add(uuid, jsonb)'::regprocedure),
                          'meldy_private.kind_keys_bad(e.x, v_user)') = 0
     or pg_catalog.to_regprocedure('public.container_item_update(uuid, jsonb)') is null
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.container_item_update(uuid, jsonb)'::regprocedure),
                          '''ai_key'', ''ai_key'' = any (v_new.flags)') = 0
     or not exists (select 1 from pg_catalog.pg_attribute a
                     where a.attrelid = 'public.quiz_attempts'::regclass and a.attname = 'item_points' and not a.attisdropped)
     or not exists (select 1 from pg_catalog.pg_proc p
                     where p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_graded(uuid, uuid)')
                       and 'credit' = any (p.proargnames)) then
    raise exception 'the base is expected: 20261107090300_ai_key_flag.sql on 20261101090200_question_kinds_quiz.sql and 20261020120000_quiz_protection.sql';
  end if;
end;
$do$;

-- 1. The column.
alter table public.test_items add column if not exists points smallint not null default 1;
do $do$
begin
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.test_items'::regclass and k.conname = 'test_items_points_check') then
    alter table public.test_items add constraint test_items_points_check check (points between 1 and 100);
  end if;
end;
$do$;
comment on column public.test_items.points is
  'The question''s points in a quiz of the exam''s subjects (1..100, default 1); a quiz «как в студии» weighs its blocks'' points instead. 20261107090700_item_points.';

-- 2. The points of the drawn questions, in the attempt's order; null when every one weighs 1. A question gone between
--    the draw and this read weighs 1.
create or replace function meldy_private.quiz_item_points(p_items uuid[])
returns smallint[]
language sql
stable
set search_path = ''
as $fn$
  select case when exists (select 1 from public.test_items i where i.id = any (p_items) and i.points <> 1)
              then (select pg_catalog.array_agg(coalesce(i.points, 1)::smallint order by x.ord)
                      from pg_catalog.unnest(p_items) with ordinality as x(id, ord)
                      left join public.test_items i on i.id = x.id) end
$fn$;
revoke all on function meldy_private.quiz_item_points(uuid[]) from public, anon, authenticated;

-- 3. «Начать» for a person (meldy_private.quiz_start_for (20261020120000_quiz_protection.sql)) + the points of a quiz of
--    subjects stored with the attempt (item_points: its questions' own points, null when all are 1).
create or replace function meldy_private.quiz_start_for(p_code text, p_name text, p_user uuid, p_guest text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_q public.quizzes%rowtype;
  v_a public.quiz_attempts%rowtype;
  v_state text;
  v_items uuid[];
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_ip text;
begin
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    raise sqlstate 'PGRST' using
      message = '{"code":"P0002","message":"quiz not found","details":"quiz","hint":null}',
      detail = '{"status":404,"headers":{}}';
  end if;
  select q.* into v_q from public.quizzes q where q.code = p_code for update;
  if not found then
    raise sqlstate 'PGRST' using
      message = '{"code":"P0002","message":"quiz not found","details":"quiz","hint":null}',
      detail = '{"status":404,"headers":{}}';
  end if;
  if p_user is null and not v_q.guests then
    raise exception 'sign in to write this quiz' using errcode = 'MC017', detail = 'guests';
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  select a.* into v_a from public.quiz_attempts a
   where a.quiz_id = v_q.id and (a.user_id = p_user or a.guest_hash = p_guest) and a.finished_at is null
   order by a.n desc
   limit 1;
  if found then
    if v_q.protection <> 'off'
       and (select pg_catalog.count(*) from public.quiz_events e where e.attempt_id = v_a.id) < 500 then
      insert into public.quiz_events (attempt_id, cid, kind, at, source)
      values (v_a.id, 'srv-' || (extract(epoch from pg_catalog.clock_timestamp()) * 1000)::bigint, 'reload',
              pg_catalog.now(), 'server')
      on conflict (attempt_id, cid) do nothing;
    end if;
    return meldy_private.quiz_attempt_json(v_a, v_q);
  end if;
  v_state := meldy_private.quiz_state(v_q);
  if v_state <> 'open' then
    raise exception 'quiz not open' using errcode = 'MC013', detail = v_state;
  end if;
  if v_q.members_only and meldy_private.role_in(p_user, v_q.container_id) is null then
    raise exception 'members only' using errcode = 'MC015', detail = 'members_only';
  end if;
  if (select pg_catalog.count(*) from public.quiz_attempts a
       where a.quiz_id = v_q.id and (a.user_id = p_user or a.guest_hash = p_guest))
       >= coalesce(v_q.attempts_allowed, 50) then
    raise exception 'no attempts left' using errcode = 'MC014', detail = 'attempts';
  end if;
  if (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = v_q.id) >= 3000
     or (p_user is null
         and (select pg_catalog.count(*) from public.quiz_attempts a
               where a.quiz_id = v_q.id and a.guest_hash is not null) >= 2000) then
    raise exception 'no attempts left' using errcode = 'MC014', detail = 'full';
  end if;
  if pg_catalog.char_length(v_name) not between 2 and 80 then
    raise exception 'invalid name' using errcode = '22023', detail = 'name';
  end if;
  if p_user is null then
    -- The check reads the last minute; rows older than two minutes go at every check, before the count.
    delete from meldy_private.quiz_guest_starts s where s.started_at <= pg_catalog.now() - interval '2 minutes';
    if (select pg_catalog.count(*) from public.quiz_attempts a
         where a.quiz_id = v_q.id and a.guest_hash is not null
           and a.started_at > pg_catalog.now() - interval '1 minute') >= 120 then
      raise exception 'too many starts' using errcode = 'MC016', detail = 'busy';
    end if;
    v_ip := meldy_private.quiz_ip_hash();
    if v_ip is not null
       and (select pg_catalog.count(*) from meldy_private.quiz_guest_starts s
             where s.ip_hash = v_ip and s.started_at > pg_catalog.now() - interval '1 minute') >= 30 then
      raise exception 'too many starts' using errcode = 'MC016', detail = 'busy';
    end if;
  end if;
  v_items := meldy_private.quiz_draw(v_q);
  if pg_catalog.cardinality(v_items) = 0 then
    raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
  end if;
  insert into public.quiz_attempts (quiz_id, user_id, guest_hash, name, n, item_ids, item_points, started_at, deadline_at)
  values (v_q.id, p_user, case when p_user is null then p_guest end, v_name,
          (select coalesce(pg_catalog.max(a.n), 0) + 1 from public.quiz_attempts a
            where a.quiz_id = v_q.id and (a.user_id = p_user or a.guest_hash = p_guest)),
          -- 20261107090700_item_points: a design quiz weighs its blocks' points (never null), any other its
          -- questions' own (null when all are 1)
          v_items, coalesce(case when v_q.design then meldy_private.quiz_doc_points(v_q.container_id, v_items) end,
                            meldy_private.quiz_item_points(v_items)),
          pg_catalog.now(), meldy_private.quiz_deadline(pg_catalog.now(), v_q))
  returning * into v_a;
  if p_user is null and v_ip is not null then
    insert into meldy_private.quiz_guest_starts (ip_hash, started_at) values (v_ip, pg_catalog.now());
  end if;
  return meldy_private.quiz_attempt_json(v_a, v_q);
end;
$fn$;

-- 4. The author adds questions (public.container_items_add (20261101090000_question_kinds.sql)) + points.
create or replace function public.container_items_add(p_subject_id uuid, p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_container uuid;
  v_have integer;
  v_new integer;
  v_pos integer;
  v_bad text;
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select s.container_id into v_container
    from public.container_subjects s join public.containers c on c.id = s.container_id
   where s.id = p_subject_id and c.owner_id = v_user;
  if v_container is null then
    raise exception 'subject not found' using errcode = 'P0002';
  end if;
  if p_items is null or pg_catalog.jsonb_typeof(p_items) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_items) not between 1 and 300
     or pg_catalog.octet_length(p_items::text) > 1048576 then
    raise exception 'invalid items' using errcode = '22023';
  end if;

  -- The first element that breaks a rule, with its number (1-based) and the rule.
  with e as (
    select x.ord, x.x,
           case when pg_catalog.jsonb_typeof(x.x) = 'object' then meldy_private.item_kind(x.x) end as kind
      from pg_catalog.jsonb_array_elements(p_items) with ordinality as x(x, ord)
  )
  select pg_catalog.format('item %s: %s', y.ord, y.why) into v_bad
    from (
      select e.ord,
             case
               when pg_catalog.jsonb_typeof(e.x) <> 'object' then 'not an object'
               when coalesce(e.x ->> 'ref', '') !~ '^[A-Za-z0-9_:.-]{1,80}$' then 'ref'
               when (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_items) o
                      where o ->> 'ref' = e.x ->> 'ref') > 1 then 'ref repeated'
               when pg_catalog.jsonb_typeof(e.x -> 'stem') is distinct from 'string'
                    or pg_catalog.char_length(pg_catalog.btrim(e.x ->> 'stem')) not between 1 and 4000 then 'stem'
               when e.kind is null
                    or e.kind not in ('single', 'multiple', 'short', 'number', 'order', 'match', 'cloze', 'essay') then 'kind'
               -- kinds without options: short, number, cloze, essay
               when e.kind in ('short', 'number', 'cloze', 'essay')
                    and coalesce(pg_catalog.jsonb_typeof(e.x -> 'options'), 'null') <> 'null'
                    and e.x -> 'options' <> '[]'::jsonb then 'options'
               when e.kind in ('short', 'number', 'cloze', 'essay', 'match')
                    and coalesce(pg_catalog.jsonb_typeof(e.x -> 'correct'), 'null') <> 'null'
                    and e.x -> 'correct' <> '[]'::jsonb then 'correct'
               when e.kind in ('short', 'number', 'cloze', 'match')
                    and (pg_catalog.jsonb_typeof(e.x -> 'answers') is distinct from 'array'
                    or exists (select 1 from pg_catalog.jsonb_array_elements(e.x -> 'answers') a
                                where pg_catalog.jsonb_typeof(a) <> 'string')
                    or not public.meldy_answers_ok(array(select case when e.kind = 'cloze' then meldy_private.cloze_forms(a)
                                                                     else pg_catalog.btrim(a) end
                                                          from pg_catalog.jsonb_array_elements_text(e.x -> 'answers') a),
                                                    e.kind)) then 'answers'
               when e.kind = 'cloze'
                    and public.meldy_cloze_gaps(e.x ->> 'stem') <> pg_catalog.jsonb_array_length(e.x -> 'answers') then 'answers'
               when e.kind in ('single', 'multiple', 'order', 'match') and not public.meldy_options_ok(e.x -> 'options') then 'options'
               when e.kind = 'match'
                    and pg_catalog.jsonb_array_length(e.x -> 'answers') < pg_catalog.jsonb_array_length(e.x -> 'options') then 'answers'
               when e.kind in ('single', 'multiple') and (pg_catalog.jsonb_typeof(e.x -> 'correct') is distinct from 'array'
                    or exists (select 1 from pg_catalog.jsonb_array_elements(e.x -> 'correct') k
                                where pg_catalog.jsonb_typeof(k) <> 'number' or (k #>> '{}') !~ '^[0-7]$')) then 'correct'
               when e.kind in ('single', 'multiple') and not public.meldy_key_ok(array(select (k #>> '{}')::smallint
                                                                        from pg_catalog.jsonb_array_elements(e.x -> 'correct') k),
                                                                  pg_catalog.jsonb_array_length(e.x -> 'options'), e.kind) then 'correct'
               when e.kind = 'order' and coalesce(pg_catalog.jsonb_typeof(e.x -> 'correct'), 'null') <> 'null'
                    and e.x -> 'correct' <> '[]'::jsonb
                    and e.x -> 'correct' <> (select pg_catalog.jsonb_agg(k order by k)
                                               from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(e.x -> 'options') - 1) k)
                    then 'correct'
               when e.kind in ('single', 'multiple', 'order', 'essay')
                    and coalesce(pg_catalog.jsonb_typeof(e.x -> 'answers'), 'null') <> 'null'
                    and e.x -> 'answers' <> '[]'::jsonb then 'answers'
               when e.x ? 'topic' and pg_catalog.jsonb_typeof(e.x -> 'topic') <> 'null'
                    and coalesce(e.x ->> 'topic', '') !~ '^([1-9]|[1-9][0-9])$' then 'topic'
               when coalesce(pg_catalog.jsonb_typeof(e.x -> 'file_no'), 'null') not in ('null', 'string', 'number')
                    or pg_catalog.char_length(coalesce(e.x ->> 'file_no', '')) > 16 then 'file_no'
               when coalesce(e.x ->> 'key_source', 'none') not in ('bold', 'underline', 'italic', 'color', 'highlight',
                    'shade', 'marker', 'key_column', 'answer_line', 'key_list', 'key_text', 'gift', 'first_option',
                    'manual', 'none') then 'key_source'
               when coalesce(pg_catalog.jsonb_typeof(e.x -> 'code'), 'null') not in ('null', 'boolean') then 'code'
               when coalesce(pg_catalog.jsonb_typeof(e.x -> 'keep_order'), 'null') not in ('null', 'boolean') then 'keep_order'
               when coalesce(pg_catalog.jsonb_typeof(e.x -> 'flags'), 'null') not in ('null', 'array')
                    or (pg_catalog.jsonb_typeof(e.x -> 'flags') = 'array'
                        and (exists (select 1 from pg_catalog.jsonb_array_elements(e.x -> 'flags') f
                                      where pg_catalog.jsonb_typeof(f) <> 'string')
                             or not public.meldy_flags_ok(array(select pg_catalog.jsonb_array_elements_text(e.x -> 'flags'))))) then 'flags'
               -- pictures (2026-10-14): paths of this container only
               when coalesce(pg_catalog.jsonb_typeof(e.x -> 'images'), 'null') not in ('null', 'object')
                    or (pg_catalog.jsonb_typeof(e.x -> 'images') = 'object'
                        and not public.meldy_images_ok(e.x -> 'images', v_container)) then 'images'
               -- the explanation (release 47): a string of at most 2000 characters once trimmed
               when e.x ? 'explanation'
                    and (pg_catalog.jsonb_typeof(e.x -> 'explanation') is distinct from 'string'
                         or pg_catalog.char_length(pg_catalog.btrim(e.x ->> 'explanation')) > 2000) then 'explanation'
               -- the new keys (release 48): their shape, then the kinds they belong to
               when meldy_private.kind_keys_bad(e.x, v_user) is not null then meldy_private.kind_keys_bad(e.x, v_user)
               when e.kind <> 'number' and pg_catalog.jsonb_typeof(e.x -> 'tolerance') in ('number', 'string') then 'tolerance'
               when e.kind <> 'number' and pg_catalog.jsonb_typeof(e.x -> 'unit') = 'string' then 'unit'
               when e.kind not in ('multiple', 'order', 'match', 'cloze') and (e.x ->> 'partial') = 'true' then 'partial'
               when e.kind <> 'essay' and pg_catalog.jsonb_typeof(e.x -> 'material_ids') = 'array'
                    and pg_catalog.jsonb_array_length(e.x -> 'material_ids') > 0 then 'material_ids'
               -- 20261107090700_item_points: the question's points, a whole number 1..100 (absent or null: 1)
               when coalesce(pg_catalog.jsonb_typeof(e.x -> 'points'), 'null') <> 'null'
                    and case when pg_catalog.jsonb_typeof(e.x -> 'points') <> 'number' then true
                             when (e.x ->> 'points') !~ '^[0-9]{1,3}$' then true
                             else (e.x ->> 'points')::integer not between 1 and 100 end then 'points'
             end as why
        from e
    ) y
   where y.why is not null
   order by y.ord
   limit 1;
  if v_bad is not null then
    raise exception 'invalid item' using errcode = '22023', detail = v_bad;
  end if;

  -- One writer per container at a time: the count below holds until commit.
  perform 1 from public.containers c where c.id = v_container for update;
  select pg_catalog.count(*) into v_have from public.test_items i where i.container_id = v_container;
  select pg_catalog.count(*) into v_new
    from pg_catalog.jsonb_array_elements(p_items) e(x)
   where not exists (select 1 from public.test_items i
                      where i.container_id = v_container and i.import_ref = e.x ->> 'ref');
  if v_have + v_new > 2000 then
    raise exception 'at most 2000 items in a container' using errcode = 'MC007',
      detail = pg_catalog.format('%s in the container, %s more do not fit', v_have, v_new);
  end if;
  select coalesce(pg_catalog.max(i.position), 0) into v_pos from public.test_items i where i.subject_id = p_subject_id;
  if v_pos + v_new > 2000 then
    raise exception 'at most 2000 items in a subject' using errcode = 'MC007';
  end if;

  insert into public.test_items (container_id, subject_id, position, file_no, topic, kind, stem, options, correct, answers,
                                 key_source, code, keep_order, flags, import_ref, images, explanation,
                                 tolerance, unit, partial, material_ids, points)
  select v_container, p_subject_id, v_pos + (pg_catalog.row_number() over (order by n.ord))::integer,
         coalesce(n.x ->> 'file_no', ''),
         case when coalesce(n.x ->> 'topic', '') ~ '^\d+$' then (n.x ->> 'topic')::smallint end,
         n.kind, n.x ->> 'stem',
         case when n.kind in ('short', 'number', 'cloze', 'essay') then '[]'::jsonb else n.x -> 'options' end,
         case when n.kind in ('short', 'number', 'cloze', 'essay', 'match') then '{}'::smallint[]
              when n.kind = 'order'
                then array(select k::smallint from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(n.x -> 'options') - 1) k)
              else array(select (k #>> '{}')::smallint from pg_catalog.jsonb_array_elements(n.x -> 'correct') k) end,
         case when n.kind in ('short', 'number', 'match')
                then array(select pg_catalog.btrim(a) from pg_catalog.jsonb_array_elements_text(n.x -> 'answers') a)
              when n.kind = 'cloze'
                then array(select meldy_private.cloze_forms(a.value)
                             from pg_catalog.jsonb_array_elements_text(n.x -> 'answers') with ordinality as a(value, ord)
                            order by a.ord)
              else '{}'::text[] end,
         coalesce(n.x ->> 'key_source',
                  case when n.kind in ('short', 'number', 'order', 'match', 'cloze')
                         or pg_catalog.jsonb_array_length(n.x -> 'correct') > 0 then 'manual' else 'none' end),
         coalesce((n.x ->> 'code')::boolean, false), coalesce((n.x ->> 'keep_order')::boolean, false),
         case when pg_catalog.jsonb_typeof(n.x -> 'flags') = 'array'
              then array(select pg_catalog.jsonb_array_elements_text(n.x -> 'flags')) else '{}'::text[] end,
         n.x ->> 'ref',
         case when pg_catalog.jsonb_typeof(n.x -> 'images') = 'object' then n.x -> 'images' else '{}'::jsonb end,
         coalesce(pg_catalog.btrim(n.x ->> 'explanation'), ''),
         case when n.kind = 'number' and pg_catalog.jsonb_typeof(n.x -> 'tolerance') in ('number', 'string')
              then (n.x ->> 'tolerance')::numeric end,
         case when n.kind = 'number' and pg_catalog.jsonb_typeof(n.x -> 'unit') = 'string'
              then pg_catalog.btrim(n.x ->> 'unit') end,
         coalesce((n.x ->> 'partial')::boolean, false),
         case when n.kind = 'essay' and pg_catalog.jsonb_typeof(n.x -> 'material_ids') = 'array'
              then array(select m::uuid from pg_catalog.jsonb_array_elements_text(n.x -> 'material_ids') m)
              else '{}'::uuid[] end,
         case when pg_catalog.jsonb_typeof(n.x -> 'points') = 'number' then (n.x ->> 'points')::smallint else 1 end
    from (select x.ord, x.x, meldy_private.item_kind(x.x) as kind
            from pg_catalog.jsonb_array_elements(p_items) with ordinality as x(x, ord)
           where not exists (select 1 from public.test_items i
                              where i.container_id = v_container and i.import_ref = x.x ->> 'ref')) n
  on conflict (container_id, import_ref) where import_ref is not null do nothing;

  select pg_catalog.jsonb_build_object('subject_id', p_subject_id, 'added', v_new, 'in_container', v_have + v_new,
           'items', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('ref', i.import_ref, 'id', i.id,
                                                                                 'position', i.position)
                                                  order by i.position), '[]'::jsonb))
    into v_out
    from public.test_items i
   where i.container_id = v_container
     and i.import_ref in (select e.x ->> 'ref' from pg_catalog.jsonb_array_elements(p_items) e(x));
  return v_out;
end;
$fn$;

-- 5. The author's patch of a question (public.container_item_update (20261107090300_ai_key_flag.sql)) + points.
create or replace function public.container_item_update(p_item_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_old public.test_items%rowtype;
  v_new public.test_items%rowtype;
  v_kind text;
  v_bad text;
  v_resolved integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid patch' using errcode = '22023';
  end if;
  select i.* into v_old from public.test_items i
    join public.containers c on c.id = i.container_id
   where i.id = p_item_id and c.owner_id = v_user
     for update of i;
  if not found then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  if (p_patch ? 'correct' and (pg_catalog.jsonb_typeof(p_patch -> 'correct') <> 'array'
        or exists (select 1 from pg_catalog.jsonb_array_elements(p_patch -> 'correct') k
                    where pg_catalog.jsonb_typeof(k) <> 'number' or (k #>> '{}') !~ '^[0-7]$')))
     or (p_patch ? 'answers' and (pg_catalog.jsonb_typeof(p_patch -> 'answers') <> 'array'
        or exists (select 1 from pg_catalog.jsonb_array_elements(p_patch -> 'answers') a
                    where pg_catalog.jsonb_typeof(a) <> 'string')))
     or (p_patch ? 'options' and pg_catalog.jsonb_typeof(p_patch -> 'options') <> 'array')
     or (p_patch ? 'stem' and pg_catalog.jsonb_typeof(p_patch -> 'stem') <> 'string')
     or (p_patch ? 'kind' and pg_catalog.jsonb_typeof(p_patch -> 'kind') <> 'string')
     or (p_patch ? 'images' and pg_catalog.jsonb_typeof(p_patch -> 'images') <> 'object')
     or (p_patch ? 'file_no' and pg_catalog.jsonb_typeof(p_patch -> 'file_no') not in ('string', 'number'))
     or (p_patch ? 'key_source' and pg_catalog.jsonb_typeof(p_patch -> 'key_source') <> 'string')
     or (p_patch ? 'code' and pg_catalog.jsonb_typeof(p_patch -> 'code') <> 'boolean')
     or (p_patch ? 'keep_order' and pg_catalog.jsonb_typeof(p_patch -> 'keep_order') <> 'boolean')
     or (p_patch ? 'topic' and pg_catalog.jsonb_typeof(p_patch -> 'topic') <> 'null'
         and coalesce(p_patch ->> 'topic', '') !~ '^([1-9]|[1-9][0-9])$') then
    raise exception 'invalid patch' using errcode = '22023';
  end if;
  if p_patch ? 'explanation'
     and (pg_catalog.jsonb_typeof(p_patch -> 'explanation') <> 'string'
          or pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'explanation')) > 2000) then
    raise exception 'invalid patch' using errcode = '22023', detail = 'explanation';
  end if;
  -- 20261107090300_ai_key_flag: ai_key true marks the key the patch sets as one «Подобрать ключи с ИИ» suggested (a
  -- boolean, and only with the key itself: a non-empty correct); false or a key change without it drops the mark.
  if p_patch ? 'ai_key'
     and (case when pg_catalog.jsonb_typeof(p_patch -> 'ai_key') <> 'boolean' then true
               else p_patch -> 'ai_key' = 'true'::jsonb and not p_patch ? 'correct' end) then
    raise exception 'invalid patch' using errcode = '22023', detail = 'ai_key';
  end if;
  -- 20261107090700_item_points: points, the question's weight in a quiz of subjects: a whole number 1..100. They are
  -- not the key: rev, key_source and the AI's mark stay as they are.
  if p_patch ? 'points'
     and (case when pg_catalog.jsonb_typeof(p_patch -> 'points') <> 'number' then true
               when (p_patch ->> 'points') !~ '^[0-9]{1,3}$' then true
               else (p_patch ->> 'points')::integer not between 1 and 100 end) then
    raise exception 'invalid patch' using errcode = '22023', detail = 'points';
  end if;
  v_bad := meldy_private.kind_keys_bad(p_patch, v_user);
  if v_bad is not null then
    raise exception 'invalid patch' using errcode = '22023', detail = v_bad;
  end if;
  v_kind := coalesce(p_patch ->> 'kind', v_old.kind);
  -- 20261107090300_ai_key_flag: the AI picks options of a choice question, and only for a question without a key: a key
  -- the author set meanwhile (by hand, in another tab) stays and the AI's is refused.
  if p_patch -> 'ai_key' = 'true'::jsonb then
    if v_kind not in ('single', 'multiple') or pg_catalog.jsonb_typeof(p_patch -> 'correct') <> 'array'
       or pg_catalog.jsonb_array_length(p_patch -> 'correct') = 0 then
      raise exception 'invalid patch' using errcode = '22023', detail = 'ai_key';
    end if;
    if v_old.keyed then
      raise exception 'invalid patch' using errcode = '22023', detail = 'keyed';
    end if;
  end if;
  begin
    update public.test_items i set
      stem = case when p_patch ? 'stem' then p_patch ->> 'stem' else i.stem end,
      options = case when p_patch ? 'options' then p_patch -> 'options' else i.options end,
      correct = case when v_kind = 'order'
                     then array(select k::smallint
                                  from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(
                                         case when p_patch ? 'options' then p_patch -> 'options' else i.options end) - 1) k)
                     when p_patch ? 'correct'
                     then array(select (k #>> '{}')::smallint from pg_catalog.jsonb_array_elements(p_patch -> 'correct') k)
                     else i.correct end,
      answers = case when p_patch ? 'answers' and v_kind = 'cloze'
                     then array(select meldy_private.cloze_forms(a.value)
                                  from pg_catalog.jsonb_array_elements_text(p_patch -> 'answers') with ordinality as a(value, ord)
                                 order by a.ord)
                     when p_patch ? 'answers'
                     then array(select pg_catalog.btrim(a) from pg_catalog.jsonb_array_elements_text(p_patch -> 'answers') a)
                     else i.answers end,
      kind = v_kind,
      topic = case when p_patch ? 'topic' then (p_patch ->> 'topic')::smallint else i.topic end,
      file_no = coalesce(p_patch ->> 'file_no', i.file_no),
      keep_order = coalesce((p_patch ->> 'keep_order')::boolean, i.keep_order),
      code = coalesce((p_patch ->> 'code')::boolean, i.code),
      images = case when p_patch ? 'images' then p_patch -> 'images' else i.images end,
      explanation = case when p_patch ? 'explanation' then pg_catalog.btrim(p_patch ->> 'explanation') else i.explanation end,
      points = case when p_patch ? 'points' then (p_patch ->> 'points')::smallint else i.points end,
      key_source = case when p_patch ? 'key_source' then p_patch ->> 'key_source'
                        when p_patch ? 'correct' or p_patch ? 'answers' or p_patch ? 'tolerance' or p_patch ? 'unit'
                             or (v_kind = 'order' and p_patch ? 'options') then 'manual'
                        else i.key_source end,
      tolerance = case when v_kind <> 'number' then null
                       when p_patch ? 'tolerance' then (p_patch ->> 'tolerance')::numeric
                       else i.tolerance end,
      unit = case when v_kind <> 'number' then null
                  when p_patch ? 'unit' then nullif(pg_catalog.btrim(p_patch ->> 'unit'), '')
                  else i.unit end,
      partial = case when v_kind not in ('multiple', 'order', 'match', 'cloze') then false
                     when p_patch ? 'partial' then (p_patch ->> 'partial')::boolean
                     else i.partial end,
      material_ids = case when v_kind <> 'essay' then '{}'::uuid[]
                          when p_patch ? 'material_ids'
                          then array(select m::uuid from pg_catalog.jsonb_array_elements_text(p_patch -> 'material_ids') m)
                          else i.material_ids end,
      flags = case when p_patch -> 'ai_key' = 'true'::jsonb
                   then pg_catalog.array_append(pg_catalog.array_remove(i.flags, 'ai_key'), 'ai_key')
                   when p_patch ? 'ai_key' or p_patch ? 'correct' or p_patch ? 'answers' or p_patch ? 'tolerance'
                        or p_patch ? 'unit' or (v_kind = 'order' and p_patch ? 'options')
                   then pg_catalog.array_remove(i.flags, 'ai_key')
                   else i.flags end
     where i.id = p_item_id
    returning i.* into v_new;
  exception
    when check_violation or not_null_violation then
      raise exception 'invalid patch' using errcode = '22023', detail = sqlerrm;
  end;
  -- 20261107090300_ai_key_flag: any other change that moved rev (an option added, single turned multiple) is the
  -- author's change of the question too: the AI's mark goes. Flags alone do not move rev.
  if v_new.rev <> v_old.rev and p_patch -> 'ai_key' is distinct from 'true'::jsonb and 'ai_key' = any (v_new.flags) then
    update public.test_items i set flags = pg_catalog.array_remove(i.flags, 'ai_key')
     where i.id = p_item_id
    returning i.* into v_new;
  end if;
  -- A picture list per option at most: a list past the last option would show under no option.
  if v_new.images ? 'options'
     and pg_catalog.jsonb_array_length(v_new.images -> 'options') > pg_catalog.jsonb_array_length(v_new.options) then
    raise exception 'invalid patch' using errcode = '22023', detail = 'images';
  end if;
  if v_new.rev <> v_old.rev then
    insert into public.test_item_key_changes (item_id, container_id, rev, old_correct, new_correct, old_answers, new_answers)
    values (v_new.id, v_new.container_id, v_new.rev, v_old.correct, v_new.correct, v_old.answers, v_new.answers);
    update public.test_key_doubts d set resolved_at = pg_catalog.now(), resolution = 'fixed'
     where d.item_id = p_item_id and d.resolved_at is null;
    get diagnostics v_resolved = row_count;
  end if;
  return pg_catalog.jsonb_build_object('id', v_new.id, 'rev', v_new.rev, 'rev_changed', v_new.rev <> v_old.rev,
                                       'doubts_resolved', v_resolved,
                                       -- 20261107090300_ai_key_flag: the mark as stored
                                       'ai_key', 'ai_key' = any (v_new.flags),
                                       -- 20261107090700_item_points: the points as stored
                                       'points', v_new.points);
end;
$fn$;
