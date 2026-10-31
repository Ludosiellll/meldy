-- question_kinds_quiz (release 48, part 3: the new question kinds in the «Контрольная»)
-- Repo file: supabase/migrations/20261101090200_question_kinds_quiz.sql. Contract: docs/kinds/CONTRACT.md §3 (what the
-- participant receives and sends, the score, essays, the review and the author's view). Base:
-- 20261101090100_question_kinds_grading.sql on the live order. Each function redefined here is its newest earlier body
-- with this file's changes: meldy_private.quiz_pool (20261016120000_quizzes.sql), meldy_private.quiz_doc_items (20261019100000_test_docs.sql), meldy_private.quiz_attempt_json (20261020120000_quiz_protection.sql), meldy_private.quiz_answer_for (20261018100000_test_builder.sql), meldy_private.quiz_graded (20261016120000_quizzes.sql), meldy_private.quiz_result_json (20261020120000_quiz_protection.sql), public.quiz_results (20261020120000_quiz_protection.sql), meldy_private.quiz_me (20261019100000_test_docs.sql), public.quiz_list (20261019100000_test_docs.sql), public.quiz_attempt_answers (20261016120000_quizzes.sql).
-- Check after the apply: supabase/tests/question_kinds_quiz.sql. Local rehearsal (never live):
-- supabase/tests/local/question_kinds_run.sh. Rollback: supabase/rollback/20261101090200_question_kinds_quiz_down.sql.
--
-- What changes, and only for the new kinds or partial credit (an attempt of old kinds without partial credit gives the
-- same JSON as before, key for key, and the same numbers):
--   * the pool takes essays (keyed or essay); a design quiz's questions too;
--   * the attempt: an item of a new kind adds partial, unit (number), options in the attempt's order (order), right —
--     the right items in the attempt's order (match), gaps (cloze); a saved answer of a new kind comes back in shown
--     indices (order, match) or as texts (cloze). The permutation is meldy_private.quiz_perm, fixed per attempt and item;
--   * saving: number {text}, essay {text}, cloze {texts}, order and match {chosen} in shown indices, mapped to file
--     indices, graded by grade_item (22023 detail text / texts / chosen); quiz_answers.text takes up to 6000 characters;
--   * quiz_graded gives credit (0..1) and pending (an essay not marked yet) — DROP and CREATE, the same name and
--     arguments; the score is Σ weight × credit everywhere it is counted (result, the preview's results, quiz_results,
--     quiz_list); a whole score stays a whole number;
--   * the review adds what docs/kinds/CONTRACT.md §3.5 lists; the result adds pending when the attempt has essays;
--   * quiz_results: picks only for single / multiple, wrong_texts for short and number, credit (and pending) for the
--     new kinds and partial credit; quiz_attempt_answers adds credit, texts (cloze), mark (essay);
--   * quiz_essay_marks with quiz_essay_task and quiz_essay_mark (the author).
-- Re-runnable: IF NOT EXISTS, OR REPLACE, the constraint dropped and added again by name, quiz_graded dropped when it
-- has the older columns; a second apply leaves the catalog as the first one did.

-- 1. Answers of a new kind need more room: a cloze keeps its gaps one per line, an essay up to 6000 characters
--    (quiz_answer_for keeps every kind's own limit: short and number 200, a cloze gap 200, an essay 6000).
alter table public.quiz_answers drop constraint if exists quiz_answers_text_check;
alter table public.quiz_answers add constraint quiz_answers_text_check
  check (text is null or char_length(text) between 1 and 6000);

-- 2. Essay marks: one per (attempt, essay). verdict full (credit 1) | partial (0.5) | none (0); source ai (the check
--    by the lectures, POST /api/quiz/essay-check) | author; quote: from a lecture, ≤ 600 characters. RLS on, no policy,
--    no client right: quiz_essay_task / quiz_essay_mark (the author only) and the readers below are the door.
create table if not exists public.quiz_essay_marks (
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  item_id uuid not null references public.test_items(id) on delete cascade,
  verdict text not null,
  quote text,
  source text not null default 'author',
  checked_at timestamptz not null default now(),
  primary key (attempt_id, item_id),
  constraint quiz_essay_marks_verdict_check check (verdict in ('full', 'partial', 'none')),
  constraint quiz_essay_marks_quote_check check (quote is null or char_length(quote) <= 600),
  constraint quiz_essay_marks_source_check check (source in ('ai', 'author'))
);
create index if not exists quiz_essay_marks_item_idx on public.quiz_essay_marks (item_id);
alter table public.quiz_essay_marks enable row level security;
revoke all on table public.quiz_essay_marks from public, anon, authenticated;

-- 3. Private helpers.
-- 3a. The order an attempt shows a list in: shown position k (1-based) → file index. Fixed per attempt and item (a reload
--     shows the same order), never the identity when there are two or more (for order the file order is the key).
create or replace function meldy_private.quiz_perm(p_seed text, p_n integer)
returns smallint[]
language sql
immutable
set search_path = ''
as $fn$
  select case when coalesce(p_n, 0) < 2
              then coalesce((select pg_catalog.array_agg(k::smallint order by k) from pg_catalog.generate_series(0, p_n - 1) k),
                            '{}'::smallint[])
              when p.a = (select pg_catalog.array_agg(k::smallint order by k) from pg_catalog.generate_series(0, p_n - 1) k)
              then p.a[2:] || p.a[1:1]
              else p.a end
    from (select pg_catalog.array_agg(k::smallint order by pg_catalog.md5(p_seed || ':' || k::text), k) as a
            from pg_catalog.generate_series(0, greatest(coalesce(p_n, 0), 1) - 1) k) p
$fn$;

-- 3b. A list in an attempt's order: element k of the result is p_list's element p_perm[k].
create or replace function meldy_private.quiz_permuted(p_list jsonb, p_perm smallint[])
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.jsonb_agg(coalesce(p_list -> (p_perm[k])::integer, '[]'::jsonb) order by k), '[]'::jsonb)
    from pg_catalog.generate_subscripts(p_perm, 1) k
$fn$;

-- 3c. The permutation of an item's options (order) or right items (match) in an attempt.
create or replace function meldy_private.quiz_item_perm(p_i public.test_items, p_attempt uuid)
returns smallint[]
language sql
immutable
set search_path = ''
as $fn$
  select case p_i.kind
    when 'order' then meldy_private.quiz_perm(p_attempt::text || p_i.id::text, pg_catalog.jsonb_array_length(p_i.options))
    when 'match' then meldy_private.quiz_perm(p_attempt::text || p_i.id::text || ':r', pg_catalog.cardinality(p_i.answers))
  end
$fn$;

-- 3d. What the participant's item of a new kind adds (docs/kinds/CONTRACT.md §3.1): partial; number — unit; order — the
--     options (and their pictures) in the attempt's order; match — right, the right items in the attempt's order; cloze
--     — gaps. An item of an old kind adds only «partial: true», and only when it has partial credit.
create or replace function meldy_private.quiz_kind_json(p_i public.test_items, p_attempt uuid)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_i.kind in ('single', 'multiple', 'short')
      then case when p_i.partial then '{"partial": true}'::jsonb else '{}'::jsonb end
    else pg_catalog.jsonb_build_object('partial', p_i.partial)
         || case p_i.kind
              when 'number' then pg_catalog.jsonb_build_object('unit', p_i.unit)
              when 'order' then pg_catalog.jsonb_build_object(
                'options', meldy_private.quiz_permuted(p_i.options, meldy_private.quiz_item_perm(p_i, p_attempt)),
                'images', case when pg_catalog.jsonb_typeof(p_i.images -> 'options') = 'array'
                               then p_i.images || pg_catalog.jsonb_build_object('options',
                                      meldy_private.quiz_permuted(p_i.images -> 'options', meldy_private.quiz_item_perm(p_i, p_attempt)))
                               else p_i.images end)
              when 'match' then pg_catalog.jsonb_build_object(
                'right', meldy_private.quiz_permuted(pg_catalog.to_jsonb(p_i.answers), meldy_private.quiz_item_perm(p_i, p_attempt)))
              when 'cloze' then pg_catalog.jsonb_build_object('gaps', pg_catalog.cardinality(p_i.answers))
              else '{}'::jsonb end
  end
$fn$;

-- 3e. A file index list → the attempt's shown indices (order: the arrangement; match: per left item, -1 kept).
create or replace function meldy_private.quiz_shown(p_i public.test_items, p_attempt uuid, p_chosen smallint[])
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select case when p_chosen is null then null
              else coalesce((select pg_catalog.jsonb_agg(case when c.value < 0 then -1
                                                              else pg_catalog.array_position(meldy_private.quiz_item_perm(p_i, p_attempt), c.value) - 1 end
                                                         order by c.ord)
                               from pg_catalog.unnest(p_chosen) with ordinality as c(value, ord)), '[]'::jsonb) end
$fn$;

-- 3f. A saved answer of a new kind as the participant's page reads it: chosen in shown indices (order, match), text
--     (number, essay), texts (cloze).
create or replace function meldy_private.quiz_answer_shown(p_i public.test_items, p_attempt uuid, p_chosen smallint[], p_text text)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_i.kind in ('order', 'match')
      then pg_catalog.jsonb_build_object('chosen', meldy_private.quiz_shown(p_i, p_attempt, p_chosen), 'text', null)
    when p_i.kind = 'cloze'
      then pg_catalog.jsonb_build_object('chosen', null, 'text', null,
                                         'texts', pg_catalog.to_jsonb(pg_catalog.string_to_array(p_text, E'\n')))
    else pg_catalog.jsonb_build_object('chosen', null, 'text', p_text)
  end
$fn$;

-- 3g. A participant's element of a new kind (docs/kinds/CONTRACT.md §3.2) as grade_item reads it, shown indices mapped to
--     file indices; null when it is empty (the saved answer is taken back). A shown index out of range becomes -99, so
--     grade_item finds the element invalid.
create or replace function meldy_private.quiz_answer_file(p_i public.test_items, p_attempt uuid, p_x jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select case
    when p_i.kind in ('number', 'essay') then
      case when coalesce(pg_catalog.jsonb_typeof(p_x -> 'text'), 'null') = 'null'
                or (pg_catalog.jsonb_typeof(p_x -> 'text') = 'string' and public.meldy_short_norm(p_x ->> 'text') = '') then null
           else pg_catalog.jsonb_build_object('text', p_x -> 'text') end
    when p_i.kind = 'cloze' then
      case when coalesce(pg_catalog.jsonb_typeof(p_x -> 'texts'), 'null') = 'null' then null
           when pg_catalog.jsonb_typeof(p_x -> 'texts') = 'array'
                and not exists (select 1 from pg_catalog.jsonb_array_elements(p_x -> 'texts') t
                                 where pg_catalog.jsonb_typeof(t) <> 'string' or public.meldy_short_norm(t #>> '{}') <> '') then null
           else pg_catalog.jsonb_build_object('texts', p_x -> 'texts') end
    when p_i.kind in ('order', 'match') then
      case when coalesce(pg_catalog.jsonb_typeof(p_x -> 'chosen'), 'null') = 'null' or p_x -> 'chosen' = '[]'::jsonb then null
           when pg_catalog.jsonb_typeof(p_x -> 'chosen') <> 'array' then pg_catalog.jsonb_build_object('chosen', p_x -> 'chosen')
           when p_i.kind = 'match' and not exists (select 1 from pg_catalog.jsonb_array_elements(p_x -> 'chosen') e
                                                    where e is distinct from '-1'::jsonb) then null
           else pg_catalog.jsonb_build_object('chosen', (
             select pg_catalog.jsonb_agg(
                      case when pg_catalog.jsonb_typeof(e.value) = 'number' and (e.value #>> '{}') ~ '^[0-9]$'
                                and (e.value #>> '{}')::integer < pg_catalog.cardinality(meldy_private.quiz_item_perm(p_i, p_attempt))
                           then pg_catalog.to_jsonb((meldy_private.quiz_item_perm(p_i, p_attempt))[(e.value #>> '{}')::integer + 1])
                           when p_i.kind = 'match' and e.value = '-1'::jsonb then '-1'::jsonb
                           else '-99'::jsonb end
                      order by e.ord)
               from pg_catalog.jsonb_array_elements(p_x -> 'chosen') with ordinality as e(value, ord)))
      end
  end
$fn$;

-- 3h. A saved answer as grade_item reads it (the old kinds exactly as quiz_graded built it before).
create or replace function meldy_private.quiz_answer_json(p_kind text, p_chosen smallint[], p_text text)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select case when p_kind = 'cloze' and p_text is not null
                then pg_catalog.jsonb_build_object('texts', pg_catalog.to_jsonb(pg_catalog.string_to_array(p_text, E'\n')))
              when p_text is not null then pg_catalog.jsonb_build_object('text', p_text)
              when p_chosen is not null then pg_catalog.jsonb_build_object('chosen', pg_catalog.to_jsonb(p_chosen))
         end
$fn$;

-- 3i. What the review adds to an item of a new kind, or of an old kind with partial credit (docs/kinds/CONTRACT.md
--     §3.5): credit (and partial); order — options and chosen in the attempt's order, key = the right arrangement in
--     shown indices; match — right_items in the attempt's order, chosen shown, key = per left the shown index of its
--     pair; number — unit, and with the answers forms (the accepted numbers) and tolerance; cloze — texts, gaps_right,
--     and with the answers forms (per gap); essay — the mark and pending. Keys only with p_answers.
create or replace function meldy_private.quiz_review_json(p_i public.test_items, p_attempt uuid, p_chosen smallint[],
                                                          p_text text, p_credit numeric, p_answers boolean)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object('credit', p_credit)
         || case when p_i.partial then '{"partial": true}'::jsonb else '{}'::jsonb end
         || case p_i.kind
              when 'order' then meldy_private.quiz_kind_json(p_i, p_attempt) - 'partial'
                || pg_catalog.jsonb_build_object(
                     'chosen', meldy_private.quiz_shown(p_i, p_attempt, p_chosen),
                     'key', case when p_answers then (
                              select pg_catalog.jsonb_agg(pg_catalog.array_position(meldy_private.quiz_item_perm(p_i, p_attempt), k::smallint) - 1
                                                          order by k)
                                from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(p_i.options) - 1) k) end)
              when 'match' then pg_catalog.jsonb_build_object(
                     'right_items', meldy_private.quiz_permuted(pg_catalog.to_jsonb(p_i.answers), meldy_private.quiz_item_perm(p_i, p_attempt)),
                     'chosen', meldy_private.quiz_shown(p_i, p_attempt, p_chosen),
                     'key', case when p_answers then (
                              select pg_catalog.jsonb_agg(pg_catalog.array_position(meldy_private.quiz_item_perm(p_i, p_attempt), k::smallint) - 1
                                                          order by k)
                                from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(p_i.options) - 1) k) end)
              when 'number' then pg_catalog.jsonb_build_object(
                     'unit', p_i.unit, 'key', null,
                     'forms', case when p_answers then pg_catalog.to_jsonb(p_i.answers) end,
                     'tolerance', case when p_answers then p_i.tolerance end)
              when 'cloze' then pg_catalog.jsonb_build_object(
                     'key', null, 'text', null,
                     'texts', pg_catalog.to_jsonb(pg_catalog.string_to_array(p_text, E'\n')),
                     'gaps_right', (select pg_catalog.jsonb_agg(
                                             p_text is not null
                                             and public.meldy_short_norm(coalesce((pg_catalog.string_to_array(p_text, E'\n'))[g.ord], '')) <> ''
                                             and exists (select 1 from pg_catalog.unnest(pg_catalog.string_to_array(g.value, E'\n')) f
                                                          where public.meldy_short_norm(f) = public.meldy_short_norm(
                                                                  (pg_catalog.string_to_array(p_text, E'\n'))[g.ord]))
                                             order by g.ord)
                                      from pg_catalog.unnest(p_i.answers) with ordinality as g(value, ord)),
                     'forms', case when p_answers then (
                                select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(pg_catalog.string_to_array(g.value, E'\n')) order by g.ord)
                                  from pg_catalog.unnest(p_i.answers) with ordinality as g(value, ord)) end)
              when 'essay' then pg_catalog.jsonb_build_object(
                     'key', null,
                     'mark', (select pg_catalog.jsonb_build_object('verdict', m.verdict, 'quote', m.quote, 'source', m.source)
                                from public.quiz_essay_marks m where m.attempt_id = p_attempt and m.item_id = p_i.id),
                     'pending', p_text is not null
                                and not exists (select 1 from public.quiz_essay_marks m
                                                 where m.attempt_id = p_attempt and m.item_id = p_i.id))
              else '{}'::jsonb end
$fn$;

-- 4. The functions this changes.
-- 4a. The pool (meldy_private.quiz_pool (20261016120000_quizzes.sql)) and a design quiz's questions (meldy_private.quiz_doc_items (20261019100000_test_docs.sql)): essays too.
create or replace function meldy_private.quiz_pool(p_container uuid, p_subjects uuid[])
returns uuid[]
language sql
stable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.array_agg(i.id order by s.position, s.created_at, i.position, i.id), '{}'::uuid[])
    from public.test_items i
    join public.container_subjects s on s.id = i.subject_id
   where i.container_id = p_container and i.subject_id = any (p_subjects)
     and (i.keyed or i.kind = 'essay')
$fn$;

create or replace function meldy_private.quiz_doc_items(p_container uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $fn$
  select coalesce((pg_catalog.array_agg(x.id order by x.ord))[1:200], '{}'::uuid[])
    from (select i.id, pg_catalog.min(b.ord) as ord
            from public.test_docs d
           cross join lateral pg_catalog.jsonb_array_elements(
                   case when pg_catalog.jsonb_typeof(d.doc -> 'blocks') = 'array' then d.doc -> 'blocks' else '[]'::jsonb end)
                   with ordinality as b(x, ord)
            join public.test_items i
              on i.id = case when pg_catalog.jsonb_typeof(b.x) = 'object' and b.x ->> 'type' = 'question'
                                  and (b.x ->> 'item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             then (b.x ->> 'item_id')::uuid end
             and i.container_id = d.container_id and (i.keyed or i.kind = 'essay')
           where d.container_id = p_container
           group by i.id) x
$fn$;

-- 4b. Grading (meldy_private.quiz_graded (20261016120000_quizzes.sql)) + credit and pending. A new return type: dropped first (no other object
--     depends on it; the callers below read it by column name).
do $do$
begin
  if exists (select 1 from pg_catalog.pg_proc p
              where p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_graded(uuid, uuid)')
                and not ('credit' = any (p.proargnames))) then
    drop function meldy_private.quiz_graded(uuid, uuid);
  end if;
end;
$do$;
create or replace function meldy_private.quiz_graded(p_quiz uuid, p_attempt uuid)
returns table (attempt_id uuid, item_id uuid, ord integer, answered boolean, correct boolean, chosen smallint[],
               typed text, answered_at timestamptz, credit numeric, pending boolean)
language plpgsql
stable
set search_path = ''
as $fn$
begin
  return query
  select t.id, x.id, x.ord::integer, w.attempt_id is not null,
         case when i.kind = 'essay' then coalesce(m.verdict = 'full', false) else coalesce(g.o_correct, false) end,
         w.chosen, w.text, w.answered_at,
         case when i.kind = 'essay' then case m.verdict when 'full' then 1 when 'partial' then 0.5 else 0 end
              else coalesce(pg_catalog.trim_scale(g.o_credit), 0) end,
         i.kind = 'essay' and w.attempt_id is not null and m.verdict is null
    from public.quiz_attempts t
   cross join lateral pg_catalog.unnest(t.item_ids) with ordinality as x(id, ord)
    join public.test_items i on i.id = x.id and (i.keyed or i.kind = 'essay')
    left join public.quiz_answers w on w.attempt_id = t.id and w.item_id = x.id
    left join public.quiz_essay_marks m on m.attempt_id = t.id and m.item_id = x.id
    left join lateral meldy_private.grade_item(i, meldy_private.quiz_answer_json(i.kind, w.chosen, w.text)) g on true
   where (p_attempt is null or t.id = p_attempt) and (p_quiz is null or t.quiz_id = p_quiz);
end;
$fn$;

-- 4c. The attempt (meldy_private.quiz_attempt_json (20261020120000_quiz_protection.sql)) + the new kinds' items and answers.
create or replace function meldy_private.quiz_attempt_json(p_a public.quiz_attempts, p_q public.quizzes)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'attempt_id', p_a.id, 'n', p_a.n, 'quiz_title', p_q.title, 'server_now', pg_catalog.now(),
    'started_at', p_a.started_at, 'deadline_at', p_a.deadline_at, 'allow_back', p_q.allow_back,
    'shuffle_options', p_q.shuffle_options, 'design', meldy_private.quiz_design(p_q),
    'taker_name', p_a.name, 'protection', p_q.protection, 'protection_limit', p_q.protection_limit,
    'guard_count', p_a.guard_count,
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'id', i.id, 'kind', i.kind, 'stem', i.stem, 'options', i.options, 'code', i.code,
                                'keep_order', i.keep_order, 'images', i.images)
                                || meldy_private.quiz_kind_json(i, p_a.id) order by x.ord)
                         from pg_catalog.unnest(p_a.item_ids) with ordinality as x(id, ord)
                         join public.test_items i on i.id = x.id), '[]'::jsonb),
    'answers', coalesce((select pg_catalog.jsonb_agg(case when i.kind in ('single', 'multiple', 'short')
                                  then pg_catalog.jsonb_build_object(
                                         'item_id', w.item_id, 'chosen', pg_catalog.to_jsonb(w.chosen), 'text', w.text)
                                  else meldy_private.quiz_answer_shown(i, p_a.id, w.chosen, w.text)
                                       || pg_catalog.jsonb_build_object('item_id', w.item_id) end
                                order by pg_catalog.array_position(p_a.item_ids, w.item_id))
                           from public.quiz_answers w
                           join public.test_items i on i.id = w.item_id
                          where w.attempt_id = p_a.id), '[]'::jsonb))
$fn$;

-- 4d. Saving (meldy_private.quiz_answer_for (20261018100000_test_builder.sql)) + the new kinds.
create or replace function meldy_private.quiz_answer_for(p_attempt_id uuid, p_user uuid, p_guest text, p_answers jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_a public.quiz_attempts%rowtype;
  v_i public.test_items%rowtype;
  v_x jsonb;
  v_item uuid;
  v_empty boolean;
  v_valid boolean;
  v_chosen smallint[];
  v_text text;
  v_el jsonb;
  v_n integer := 0;
begin
  select a.quiz_id into v_a.quiz_id from public.quiz_attempts a
   where a.id = p_attempt_id and (a.user_id = p_user or a.guest_hash = p_guest);
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002', detail = 'attempt';
  end if;
  perform meldy_private.quiz_settle(v_a.quiz_id);
  select a.* into v_a from public.quiz_attempts a where a.id = p_attempt_id for update;
  if v_a.finished_at is not null then
    raise exception 'attempt is over' using errcode = 'MC012', detail = 'finished';
  end if;
  if v_a.deadline_at is not null and pg_catalog.now() > v_a.deadline_at + interval '20 seconds' then
    raise exception 'attempt is over' using errcode = 'MC012', detail = 'time';
  end if;
  if p_answers is null or pg_catalog.jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'invalid answers' using errcode = '22023', detail = 'answers';
  end if;
  if pg_catalog.jsonb_array_length(p_answers) not between 1 and 200 then
    raise exception 'invalid answers' using errcode = '22023', detail = 'answers';
  end if;
  for v_x in select x from pg_catalog.jsonb_array_elements(p_answers) x loop
    if pg_catalog.jsonb_typeof(v_x) is distinct from 'object' or pg_catalog.jsonb_typeof(v_x -> 'item_id') is distinct from 'string'
       or (v_x ->> 'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid answers' using errcode = '22023', detail = 'item';
    end if;
    v_item := (v_x ->> 'item_id')::uuid;
    if not (v_item = any (v_a.item_ids)) then
      raise exception 'invalid answers' using errcode = '22023', detail = 'item';
    end if;
    select i.* into v_i from public.test_items i where i.id = v_item;
    if not found then
      raise exception 'invalid answers' using errcode = '22023', detail = 'item';
    end if;
    if v_i.kind not in ('single', 'multiple', 'short') then
      -- a new kind (release 48): shown indices → file indices, graded by grade_item, the per-kind limits
      v_el := meldy_private.quiz_answer_file(v_i, v_a.id, v_x);
      v_empty := v_el is null;
      if not v_empty then
        select g.o_valid, g.o_chosen, g.o_text into v_valid, v_chosen, v_text from meldy_private.grade_item(v_i, v_el) g;
        if not v_valid or (v_i.kind = 'number' and pg_catalog.char_length(v_text) > 200) then
          raise exception 'invalid answers' using errcode = '22023',
            detail = case when v_i.kind in ('number', 'essay') then 'text' when v_i.kind = 'cloze' then 'texts'
                          else 'chosen' end;
        end if;
      end if;
    elsif v_i.kind = 'short' then
      v_empty := coalesce(pg_catalog.jsonb_typeof(v_x -> 'text'), 'null') = 'null'
                 or (pg_catalog.jsonb_typeof(v_x -> 'text') = 'string' and public.meldy_short_norm(v_x ->> 'text') = '');
    else
      v_empty := coalesce(pg_catalog.jsonb_typeof(v_x -> 'chosen'), 'null') = 'null' or v_x -> 'chosen' = '[]'::jsonb;
    end if;
    if v_empty then
      delete from public.quiz_answers w where w.attempt_id = v_a.id and w.item_id = v_item;
    elsif v_i.kind not in ('single', 'multiple', 'short') then
      insert into public.quiz_answers (attempt_id, item_id, chosen, text, answered_at)
      values (v_a.id, v_item, case when v_i.kind in ('order', 'match') then v_chosen end,
              case when v_i.kind in ('number', 'cloze', 'essay') then v_text end, pg_catalog.now())
      on conflict (attempt_id, item_id) do update
        set chosen = excluded.chosen, text = excluded.text, answered_at = excluded.answered_at;
    else
      select g.o_valid, g.o_chosen, g.o_text into v_valid, v_chosen, v_text
        from meldy_private.grade_answer(v_i.kind, pg_catalog.jsonb_array_length(v_i.options), v_i.correct, v_i.answers,
               case when v_i.kind = 'short' then pg_catalog.jsonb_build_object('text', v_x -> 'text')
                    else pg_catalog.jsonb_build_object('chosen', v_x -> 'chosen') end) g;
      if not v_valid or (v_i.kind = 'short' and pg_catalog.char_length(v_text) > 200) then
        raise exception 'invalid answers' using errcode = '22023',
          detail = case when v_i.kind = 'short' then 'text' else 'chosen' end;
      end if;
      insert into public.quiz_answers (attempt_id, item_id, chosen, text, answered_at)
      values (v_a.id, v_item, case when v_i.kind <> 'short' then v_chosen end,
              case when v_i.kind = 'short' then v_text end, pg_catalog.now())
      on conflict (attempt_id, item_id) do update
        set chosen = excluded.chosen, text = excluded.text, answered_at = excluded.answered_at;
    end if;
    v_n := v_n + 1;
  end loop;
  return pg_catalog.jsonb_build_object('saved', v_n, 'server_now', pg_catalog.now(), 'deadline_at', v_a.deadline_at);
end;
$fn$;

-- 4e. The result (meldy_private.quiz_result_json (20261020120000_quiz_protection.sql)) + the score by credit, the new kinds' review, pending.
create or replace function meldy_private.quiz_result_json(p_attempt uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_a public.quiz_attempts%rowtype;
  v_q public.quizzes%rowtype;
  v_total integer;
  v_correct integer;
  v_percent integer;
  v_review text;
  v_used integer;
  v_items jsonb := '[]'::jsonb;
  v_design jsonb;
  v_band jsonb;
  v_score numeric;
  v_max integer;
  v_essays integer;
  v_pending integer;
begin
  select a.* into v_a from public.quiz_attempts a where a.id = p_attempt;
  select q.* into v_q from public.quizzes q where q.id = v_a.quiz_id;
  select pg_catalog.count(*)::integer, (pg_catalog.count(*) filter (where g.correct))::integer,
         coalesce(pg_catalog.trim_scale(pg_catalog.round(pg_catalog.sum(coalesce(v_a.item_points[g.ord], 1) * g.credit), 2)), 0),
         coalesce(pg_catalog.sum(coalesce(v_a.item_points[g.ord], 1)), 0)::integer,
         (pg_catalog.count(*) filter (where g.pending))::integer
    into v_total, v_correct, v_score, v_max, v_pending
    from meldy_private.quiz_graded(null, p_attempt) g;
  select pg_catalog.count(*)::integer into v_essays
    from pg_catalog.unnest(v_a.item_ids) x(id) join public.test_items i on i.id = x.id where i.kind = 'essay';
  v_percent := case when v_max > 0 then pg_catalog.round(100.0 * v_score / v_max)::integer else 0 end;
  v_review := case when v_q.review <> 'mistakes_then_answers' then v_q.review
                   when meldy_private.quiz_state(v_q) = 'closed' then 'answers'
                   else 'mistakes' end;
  select pg_catalog.count(*)::integer into v_used
    from public.quiz_attempts a
   where a.quiz_id = v_q.id and (a.user_id = v_a.user_id or a.guest_hash = v_a.guest_hash);
  if v_review <> 'score' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', i.id, 'kind', i.kind, 'stem', i.stem, 'options', i.options, 'code', i.code, 'images', i.images,
             'keep_order', i.keep_order,
             'chosen', pg_catalog.to_jsonb(g.chosen), 'text', g.typed, 'right', g.correct,
             'key', case when v_review = 'answers' and i.kind <> 'short' then pg_catalog.to_jsonb(i.correct) end,
             'forms', case when v_review = 'answers' and i.kind = 'short' then pg_catalog.to_jsonb(i.answers) end,
             'explanation', case when v_review = 'answers' then nullif(i.explanation, '') end)
             || case when i.kind in ('single', 'multiple', 'short') and not i.partial then '{}'::jsonb
                     else meldy_private.quiz_review_json(i, p_attempt, g.chosen, g.typed, g.credit, v_review = 'answers') end
             order by g.ord), '[]'::jsonb)
      into v_items
      from meldy_private.quiz_graded(null, p_attempt) g
      join public.test_items i on i.id = g.item_id;
  end if;
  v_design := meldy_private.quiz_design(v_q);
  select b.x into v_band
    from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(v_design -> 'results' -> 'bands') = 'array'
                                              then v_design -> 'results' -> 'bands' else '[]'::jsonb end)
         with ordinality as b(x, o)
   where case when b.x ->> 'from' ~ '^[0-9]{1,3}$' and b.x ->> 'to' ~ '^[0-9]{1,3}$'
              then (b.x ->> 'from')::integer <= v_percent and v_percent <= (b.x ->> 'to')::integer
              else false end
   order by b.o
   limit 1;
  return pg_catalog.jsonb_build_object(
    'attempt_id', v_a.id, 'n', v_a.n, 'quiz_title', v_q.title, 'code', v_q.code, 'started_at', v_a.started_at,
    'finished_at', v_a.finished_at, 'finish_reason', v_a.finish_reason, 'correct', v_correct, 'total', v_total,
    'score', v_score, 'max_score', v_max,
    'percent', v_percent, 'pass_percent', v_q.pass_percent, 'shuffle_options', v_q.shuffle_options,
    'passed', case when v_q.pass_percent is not null then v_percent >= v_q.pass_percent end,
    'review_now', v_review,
    'answers_after', case when v_q.review = 'mistakes_then_answers' and v_review = 'mistakes'
                          then coalesce(v_q.closed_at, v_q.closes_at) end,
    'attempts_left', case when v_q.attempts_allowed is not null then greatest(v_q.attempts_allowed - v_used, 0) end,
    'can_retry', meldy_private.quiz_block_for(v_q, v_a.user_id, v_a.guest_hash) is null
                 and (v_a.user_id is not null or v_q.guests)
                 and not exists (select 1 from public.quiz_attempts a
                                  where a.quiz_id = v_q.id and (a.user_id = v_a.user_id or a.guest_hash = v_a.guest_hash)
                                    and a.finished_at is null),
    'accent', v_q.accent,
    'practice', case when v_q.offer_practice and v_a.user_id is distinct from v_q.owner_id
                     then pg_catalog.jsonb_build_object(
                            'exam_title', (select c.title from public.containers c where c.id = v_q.container_id),
                            'member', coalesce(meldy_private.role_in(v_a.user_id, v_q.container_id) = 'member', false),
                            'ready', meldy_private.quiz_practice_ready(v_q.container_id)) end,
    'design', v_design,
    'band', v_band,
    'guard', case when v_q.protection <> 'off'
                  then pg_catalog.jsonb_build_object('level', v_q.protection, 'count', v_a.guard_count,
                                                     'limit', v_q.protection_limit) end,
    'items', v_items)
    || case when v_essays > 0 then pg_catalog.jsonb_build_object('pending', v_pending) else '{}'::jsonb end;
end;
$fn$;

-- 4f. quiz_results (public.quiz_results (20261020120000_quiz_protection.sql)) + the score by credit, picks, wrong_texts, credit and pending.
create or replace function public.quiz_results(p_quiz_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select q.* into v_q from public.quizzes q
    join public.containers c on c.id = q.container_id
   where q.id = p_quiz_id and c.owner_id = v_user;
  if not found then
    raise sqlstate 'PGRST' using
      message = '{"code":"P0002","message":"quiz not found","details":"quiz","hint":null}',
      detail = '{"status":404,"headers":{}}';
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  -- One grading pass (g0) for both lists.
  with g0 as materialized (
    select g.*, a.user_id is distinct from v_q.owner_id as counted, coalesce(a.item_points[g.ord], 1) as weight
      from meldy_private.quiz_graded(v_q.id, null) g
      join public.quiz_attempts a on a.id = g.attempt_id
  ), s as (  -- the live score of each attempt
    select g0.attempt_id, pg_catalog.count(*) as total, pg_catalog.count(*) filter (where g0.answered) as answered,
           pg_catalog.count(*) filter (where g0.correct) as correct, pg_catalog.sum(g0.weight) as max_score,
           coalesce(pg_catalog.trim_scale(pg_catalog.round(pg_catalog.sum(g0.weight * g0.credit), 2)), 0) as score
      from g0 group by g0.attempt_id
  ), g as (  -- the question stats count the attempts of others than the author only
    select g0.* from g0 where g0.counted
  ), x as (
    select g.item_id, pg_catalog.count(*) as shown, pg_catalog.count(*) filter (where g.answered) as answered,
           pg_catalog.count(*) filter (where g.correct) as correct,
           pg_catalog.trim_scale(pg_catalog.sum(g.credit)) as credit, pg_catalog.count(*) filter (where g.pending) as pending
      from g group by g.item_id
  ), p as (  -- answers that chose option k of a question
    select g.item_id, c.k::integer as k, pg_catalog.count(*) as n
      from g cross join lateral pg_catalog.unnest(g.chosen) as c(k)
     group by g.item_id, c.k
  ), wt as (  -- the 3 most common wrong short answers of a question (one spelling per normalised form)
    select z.item_id, z.t, z.n
      from (select y.item_id, y.t, y.n, pg_catalog.row_number() over (partition by y.item_id order by y.n desc, y.t) as r
              from (select g.item_id, pg_catalog.min(pg_catalog.btrim(g.typed)) as t, pg_catalog.count(*) as n
                      from g where g.answered and not g.correct and g.typed is not null
                     group by g.item_id, public.meldy_short_norm(g.typed)) y) z
     where z.r <= 3
  )
  select pg_catalog.jsonb_build_object(
    'quiz', meldy_private.quiz_row(v_q), 'server_now', pg_catalog.now(),
    'attempts', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'id', a.id,
                   'person', pg_catalog.left(pg_catalog.md5(coalesce(a.user_id::text, a.guest_hash) || a.quiz_id::text), 16),
                   'name', a.name, 'own', coalesce(a.user_id = v_q.owner_id, false), 'guest', a.guest_hash is not null,
                   'n', a.n, 'started_at', a.started_at,
                   'deadline_at', a.deadline_at, 'finished_at', a.finished_at, 'finish_reason', a.finish_reason,
                   'total', coalesce(s.total, 0), 'answered', coalesce(s.answered, 0), 'correct', coalesce(s.correct, 0),
                   'score', coalesce(s.score, 0), 'max_score', coalesce(s.max_score, 0),
                   'guard_count', a.guard_count, 'guard_events', coalesce(ev.n, 0),
                   'flagged', a.guard_count > 0 or coalesce(ev.copied, 0) > 0)
                   order by a.started_at, a.user_id, a.guest_hash, a.n), '[]'::jsonb)
                   from public.quiz_attempts a
                   left join s on s.attempt_id = a.id
                   left join (select e.attempt_id, pg_catalog.count(*) as n,
                                     pg_catalog.count(*) filter (where e.kind in ('copy', 'paste')) as copied
                                from public.quiz_events e
                                join public.quiz_attempts a2 on a2.id = e.attempt_id
                               where a2.quiz_id = v_q.id
                               group by e.attempt_id) ev on ev.attempt_id = a.id
                  where a.quiz_id = v_q.id),
    'items', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'item_id', i.id, 'shown', x.shown, 'answered', x.answered, 'correct', x.correct,
                'picks', case when i.kind not in ('single', 'multiple') then '[]'::jsonb
                              else (select pg_catalog.jsonb_agg(coalesce(p.n, 0) order by o.k)
                                      from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(i.options) - 1) as o(k)
                                      left join p on p.item_id = i.id and p.k = o.k) end,
                'wrong_texts', case when i.kind not in ('short', 'number') then '[]'::jsonb
                                    else coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('text', wt.t, 'n', wt.n)
                                                                               order by wt.n desc, wt.t)
                                                     from wt where wt.item_id = i.id), '[]'::jsonb) end)
                || case when i.kind in ('single', 'multiple', 'short') and not i.partial then '{}'::jsonb
                        else pg_catalog.jsonb_build_object('credit', x.credit)
                             || case when i.kind = 'essay' then pg_catalog.jsonb_build_object('pending', x.pending)
                                     else '{}'::jsonb end end
                order by cs.position, cs.created_at, i.position, i.id), '[]'::jsonb)
                from x
                join public.test_items i on i.id = x.item_id
                join public.container_subjects cs on cs.id = i.subject_id))
    into v_out;
  return v_out;
end;
$fn$;

-- 4g. «me» of the preview (meldy_private.quiz_me (20261019100000_test_docs.sql)) and quiz_list (public.quiz_list (20261019100000_test_docs.sql)): the score by credit.
create or replace function meldy_private.quiz_me(p_q public.quizzes, p_user uuid, p_guest text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_role text;
  v_used integer;
  v_open uuid;
  v_reason text;
  v_results jsonb;
begin
  select pg_catalog.count(*)::integer, (pg_catalog.array_agg(a.id) filter (where a.finished_at is null))[1]
    into v_used, v_open
    from public.quiz_attempts a where a.quiz_id = p_q.id and (a.user_id = p_user or a.guest_hash = p_guest);
  v_reason := case when v_open is null then meldy_private.quiz_block_for(p_q, p_user, p_guest) end;
  v_results := coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                  'attempt_id', a.id, 'n', a.n, 'finished_at', a.finished_at,
                                  'correct', s.correct, 'total', s.total, 'score', s.score, 'max_score', s.max_score)
                                  order by a.n)
                           from public.quiz_attempts a
                           cross join lateral (select pg_catalog.count(*) filter (where g.correct) as correct,
                                                      pg_catalog.count(*) as total,
                                                      coalesce(pg_catalog.trim_scale(pg_catalog.round(pg_catalog.sum(
                                                                 coalesce(a.item_points[g.ord], 1) * g.credit), 2)), 0) as score,
                                                      coalesce(pg_catalog.sum(coalesce(a.item_points[g.ord], 1)), 0) as max_score
                                                 from meldy_private.quiz_graded(null, a.id) g) s
                          where a.quiz_id = p_q.id and (a.user_id = p_user or a.guest_hash = p_guest)
                            and a.finished_at is not null), '[]'::jsonb);
  if p_user is null then
    return pg_catalog.jsonb_build_object(
      'name_hint', null, 'is_author', false, 'is_member', false, 'guest', true, 'attempts_used', v_used,
      'open_attempt', v_open, 'can_start', v_open is not null or v_reason is null, 'reason', v_reason,
      'results', v_results);
  end if;
  v_role := meldy_private.role_in(p_user, p_q.container_id);
  return pg_catalog.jsonb_build_object(
    'name_hint', coalesce((select a.name from public.quiz_attempts a
                            where a.quiz_id = p_q.id and a.user_id = p_user order by a.n desc limit 1),
                          (select nullif(pg_catalog.btrim(p.full_name), '') from public.profiles p where p.id = p_user)),
    'is_author', p_q.owner_id = p_user,
    'is_member', coalesce(v_role = 'member', false),
    'attempts_used', v_used,
    'open_attempt', v_open,
    'can_start', v_open is not null or v_reason is null,
    'reason', v_reason,
    'results', v_results);
end;
$fn$;

create or replace function public.quiz_list(p_container_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.containers c where c.id = p_container_id and c.owner_id = v_user) then
    raise exception 'container not found' using errcode = 'P0002', detail = 'container';
  end if;
  perform meldy_private.quiz_settle(q.id) from public.quizzes q where q.container_id = p_container_id;
  return coalesce((
    select pg_catalog.jsonb_agg(meldy_private.quiz_row(q) || pg_catalog.jsonb_build_object(
             'people', (select pg_catalog.count(distinct coalesce(a.user_id::text, a.guest_hash)) from public.quiz_attempts a
                         where a.quiz_id = q.id and a.user_id is distinct from q.owner_id),
             'writing', (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = q.id and a.finished_at is null),
             'finished', (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = q.id and a.finished_at is not null),
             'avg_percent', (select pg_catalog.round(pg_catalog.avg(100.0 * s.score / s.max_score), 1)
                               from (select g.attempt_id, pg_catalog.sum(coalesce(a.item_points[g.ord], 1)) as max_score,
                                            coalesce(pg_catalog.sum(coalesce(a.item_points[g.ord], 1) * g.credit), 0) as score
                                       from meldy_private.quiz_graded(q.id, null) g
                                       join public.quiz_attempts a on a.id = g.attempt_id
                                      where a.finished_at is not null and a.user_id is distinct from q.owner_id
                                      group by g.attempt_id) s))
             order by q.created_at desc, q.id desc)
      from public.quizzes q where q.container_id = p_container_id), '[]'::jsonb);
end;
$fn$;

-- 4h. One attempt for its author (public.quiz_attempt_answers (20261016120000_quizzes.sql)) + credit, texts, mark.
create or replace function public.quiz_attempt_answers(p_attempt_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_quiz uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select a.quiz_id into v_quiz from public.quiz_attempts a
    join public.quizzes q on q.id = a.quiz_id
    join public.containers c on c.id = q.container_id
   where a.id = p_attempt_id and c.owner_id = v_user;
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002', detail = 'attempt';
  end if;
  perform meldy_private.quiz_settle(v_quiz);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', g.item_id, 'chosen', pg_catalog.to_jsonb(g.chosen),
                                                              'text', g.typed, 'correct', g.correct,
                                                              'answered_at', g.answered_at)
                                || case when i.kind in ('single', 'multiple', 'short') and not i.partial then '{}'::jsonb
                                        else pg_catalog.jsonb_build_object('credit', g.credit)
                                             || case when i.kind = 'cloze'
                                                     then pg_catalog.jsonb_build_object('texts',
                                                            pg_catalog.to_jsonb(pg_catalog.string_to_array(g.typed, E'\n')))
                                                     when i.kind = 'essay'
                                                     then pg_catalog.jsonb_build_object('pending', g.pending, 'mark',
                                                            (select pg_catalog.jsonb_build_object('verdict', m.verdict, 'quote', m.quote,
                                                                                                  'source', m.source, 'checked_at', m.checked_at)
                                                               from public.quiz_essay_marks m
                                                              where m.attempt_id = g.attempt_id and m.item_id = g.item_id))
                                                     else '{}'::jsonb end end
                                order by g.ord)
      from meldy_private.quiz_graded(null, p_attempt_id) g
      join public.test_items i on i.id = g.item_id
     where g.answered), '[]'::jsonb);
end;
$fn$;

-- 5. Essays: what the check needs, and the mark (the author of the attempt's exam only; anyone else, a missing attempt,
--    an item that is not an essay of the attempt → 404 P0002 detail essay).
-- 5a. The task: the stem, the answer (null when the participant wrote none), the lectures to check by, the mark.
create or replace function public.quiz_essay_task(p_attempt_id uuid, p_item_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_a public.quiz_attempts%rowtype;
  v_i public.test_items%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select a.* into v_a from public.quiz_attempts a
    join public.quizzes q on q.id = a.quiz_id
    join public.containers c on c.id = q.container_id
   where a.id = p_attempt_id and c.owner_id = v_user;
  if found then
    select i.* into v_i from public.test_items i where i.id = p_item_id and i.kind = 'essay' and i.id = any (v_a.item_ids);
  end if;
  if v_a.id is null or v_i.id is null then
    raise sqlstate 'PGRST' using
      message = '{"code":"P0002","message":"essay not found","details":"essay","hint":null}',
      detail = '{"status":404,"headers":{}}';
  end if;
  perform meldy_private.quiz_settle(v_a.quiz_id);
  return pg_catalog.jsonb_build_object(
    'attempt_id', v_a.id, 'item_id', v_i.id, 'stem', v_i.stem, 'explanation', nullif(v_i.explanation, ''),
    'material_ids', pg_catalog.to_jsonb(v_i.material_ids),
    'text', (select w.text from public.quiz_answers w where w.attempt_id = v_a.id and w.item_id = v_i.id),
    'finished', (select a.finished_at is not null from public.quiz_attempts a where a.id = v_a.id),
    'mark', (select pg_catalog.jsonb_build_object('verdict', m.verdict, 'quote', m.quote, 'source', m.source,
                                                  'checked_at', m.checked_at)
               from public.quiz_essay_marks m where m.attempt_id = v_a.id and m.item_id = v_i.id));
end;
$fn$;

-- 5b. The mark: verdict full | partial | none sets it (the author's word always wins: source author unless 'ai' is
--     given), null takes it back. An essay the participant left empty cannot be marked (22023 detail unanswered); a bad
--     verdict, source or a quote over 600 characters → 22023 detail verdict / source / quote. Returns the mark (or null).
create or replace function public.quiz_essay_mark(p_attempt_id uuid, p_item_id uuid, p_verdict text,
                                                  p_quote text default null, p_source text default 'author')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_task jsonb;
begin
  v_task := public.quiz_essay_task(p_attempt_id, p_item_id);
  if p_verdict is null then
    delete from public.quiz_essay_marks m where m.attempt_id = p_attempt_id and m.item_id = p_item_id;
    return null;
  end if;
  if p_verdict not in ('full', 'partial', 'none') then
    raise exception 'invalid mark' using errcode = '22023', detail = 'verdict';
  end if;
  if coalesce(p_source, '') not in ('ai', 'author') then
    raise exception 'invalid mark' using errcode = '22023', detail = 'source';
  end if;
  if p_quote is not null and pg_catalog.char_length(p_quote) > 600 then
    raise exception 'invalid mark' using errcode = '22023', detail = 'quote';
  end if;
  if v_task ->> 'text' is null then
    raise exception 'invalid mark' using errcode = '22023', detail = 'unanswered';
  end if;
  insert into public.quiz_essay_marks (attempt_id, item_id, verdict, quote, source, checked_at)
  values (p_attempt_id, p_item_id, p_verdict, nullif(pg_catalog.btrim(coalesce(p_quote, '')), ''), p_source, pg_catalog.now())
  on conflict (attempt_id, item_id) do update
    set verdict = excluded.verdict, quote = excluded.quote, source = excluded.source, checked_at = excluded.checked_at;
  return (select pg_catalog.jsonb_build_object('verdict', m.verdict, 'quote', m.quote, 'source', m.source,
                                               'checked_at', m.checked_at)
            from public.quiz_essay_marks m where m.attempt_id = p_attempt_id and m.item_id = p_item_id);
end;
$fn$;

-- 6. Grants. The new private helpers are closed; the essay calls are the author's (authenticated).
revoke all on function meldy_private.quiz_perm(text, integer), meldy_private.quiz_permuted(jsonb, smallint[]),
  meldy_private.quiz_item_perm(public.test_items, uuid), meldy_private.quiz_kind_json(public.test_items, uuid),
  meldy_private.quiz_shown(public.test_items, uuid, smallint[]),
  meldy_private.quiz_answer_shown(public.test_items, uuid, smallint[], text),
  meldy_private.quiz_answer_file(public.test_items, uuid, jsonb), meldy_private.quiz_answer_json(text, smallint[], text),
  meldy_private.quiz_review_json(public.test_items, uuid, smallint[], text, numeric, boolean),
  meldy_private.quiz_graded(uuid, uuid) from public, anon, authenticated;
revoke all on function public.quiz_essay_task(uuid, uuid), public.quiz_essay_mark(uuid, uuid, text, text, text)
  from public, anon;
grant execute on function public.quiz_essay_task(uuid, uuid), public.quiz_essay_mark(uuid, uuid, text, text, text)
  to authenticated;
