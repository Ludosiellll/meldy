-- question_kinds (release 48, part 1: the data of the new question kinds)
-- Repo file: supabase/migrations/20261101090000_question_kinds.sql. Spec: meldy-notes 10_Project/Test_Builder_Spec_2026-10-18.md
-- «Выпуск 48 — типы вопросов»; contract: docs/kinds/CONTRACT.md §1 (the row, the number rule, the checks, rev). Base: the
-- live order up to 20261031090000_live_wide_rounds.sql. Each function redefined here is its newest earlier body with this
-- file's changes: test_items_guard (20261009093500_containers), container_items_add and container_item_update
-- (20261018100000_test_builder); meldy_key_ok and meldy_answers_ok (20261009093500_containers) answer as before for every
-- kind they knew.
-- Check after the apply: supabase/tests/question_kinds.sql. Local rehearsal (never live):
-- supabase/tests/local/question_kinds_run.sh. Rollback: supabase/rollback/20261101090000_question_kinds_down.sql.
--
-- Additive: every existing row, answer and call behaves as before. New kinds of test_items: number, order, match, cloze,
-- essay (truefalse stays a preset of single). New columns, each with a default every row already meets: tolerance and
-- unit (number), partial (partial credit, by the author's choice: multiple, order, match, cloze), material_ids (essay: the
-- author's lectures its check reads). The checks take the new kinds; test_answers takes them too. The writes
-- (container_items_add, container_item_update) take the new kinds and keys. Grading and recording come in
-- 20261101090100_question_kinds_grading.sql; until then a new kind can be written but is answered nowhere.
--   number: options [] and correct {}; answers = 1..10 accepted numbers as canonical text (-?digits(.digits)?);
--           public.meldy_number_right(text, answers, tolerance, unit) is the rule (fixed: the live game builds on it).
--   order:  options = 2..8 items in the right order; correct = {0..n-1} (the identity, so the row is keyed); answers {}.
--   match:  options = 2..8 left items; answers = their right items in the same order, then up to 10 - n extra ones.
--   cloze:  options [] and correct {}; the stem's gaps are runs of three or more underscores; answers = one element per
--           gap: its accepted forms joined by a newline.
--   essay:  options [], correct {}, answers {} (not keyed: never in a session, the plan or the bot; the quiz takes it).
-- Re-runnable: IF NOT EXISTS, OR REPLACE, constraints dropped and added again by name (the same definition each time);
-- CREATE OR REPLACE keeps the grants of replaced functions; a second apply leaves the catalog as the first one did.
-- Errors as before: 22023 detail «item <n>: <rule>» of container_items_add (new rules: tolerance, unit, partial,
-- material_ids; kind, options, correct, answers for the new kinds), 22023 of container_item_update.

-- 1. Columns.
alter table public.test_items add column if not exists tolerance numeric;
alter table public.test_items add column if not exists unit text;
alter table public.test_items add column if not exists partial boolean not null default false;
alter table public.test_items add column if not exists material_ids uuid[] not null default '{}'::uuid[];

-- 2. Pure helpers (callable by anyone, as the other validators: they read nothing).
-- 2a. The number of gaps of a cloze stem: runs of three or more underscores.
create or replace function public.meldy_cloze_gaps(p_stem text)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select case when p_stem is null then 0
              else (select pg_catalog.count(*)::integer from pg_catalog.regexp_matches(p_stem, '_{3,}', 'g') m) end
$fn$;

-- 2b. A typed number against the accepted ones (docs/kinds/CONTRACT.md §1.1; TS twin frontend/src/lib/kinds/number.ts,
--     shared cases contracts/kinds/number_vectors.json). Whitespace (meldy_short_norm's set) removed, «,» → «.», «−» → «-»,
--     lower case and one trailing «.» dropped as meldy_short_norm does, a trailing unit equal to p_unit (normalised the same
--     way, without spaces) cut off; what is left must be a plain decimal of at most 40 characters, else false. Right when
--     |x − a| ≤ coalesce(p_tolerance, 0) for some canonical accepted a (exact numeric).
create or replace function public.meldy_number_right(p_text text, p_answers text[], p_tolerance numeric, p_unit text)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $fn$
declare
  c_space constant text := '[' || pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11) || pg_catalog.chr(12)
                             || pg_catalog.chr(13) || ' ' || pg_catalog.chr(160) || pg_catalog.chr(5760) || pg_catalog.chr(8192) || '-'
                             || pg_catalog.chr(8203) || pg_catalog.chr(8232) || pg_catalog.chr(8233) || pg_catalog.chr(8239)
                             || pg_catalog.chr(8287) || pg_catalog.chr(12288) || pg_catalog.chr(65279) || ']+';
  v_t text;
  v_u text;
  v_x numeric;
begin
  if p_text is null or p_answers is null or pg_catalog.char_length(p_text) > 1000 then
    return false;
  end if;
  v_t := public.meldy_short_norm(pg_catalog.translate(pg_catalog.regexp_replace(p_text, c_space, '', 'g'), ',−', '.-'));
  if p_unit is not null then
    v_u := public.meldy_short_norm(pg_catalog.translate(pg_catalog.regexp_replace(p_unit, c_space, '', 'g'), ',−', '.-'));
    if v_u <> '' and pg_catalog.char_length(v_t) > pg_catalog.char_length(v_u)
       and pg_catalog.right(v_t, pg_catalog.char_length(v_u)) = v_u then
      v_t := pg_catalog.left(v_t, - pg_catalog.char_length(v_u));
    end if;
  end if;
  if pg_catalog.char_length(v_t) > 40 or v_t !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$' then
    return false;
  end if;
  v_x := v_t::numeric;
  return exists (select 1 from pg_catalog.unnest(p_answers) a
                  where a ~ '^-?[0-9]+(\.[0-9]+)?$' and pg_catalog.char_length(a) <= 40
                    and pg_catalog.abs(v_x - a::numeric) <= coalesce(p_tolerance, 0));
end;
$fn$;

-- 2c. Key (20261009093500 + the new kinds): order — exactly the identity {0..n-1}; number, match, cloze, essay — none
--     (their key is answers, or there is none). single / multiple / short and any other kind: the rule as before.
create or replace function public.meldy_key_ok(p_key smallint[], p_options integer, p_kind text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select p_key is not null
     and pg_catalog.array_ndims(p_key) is distinct from 2
     and case
       when p_kind = 'order' then
         p_options between 2 and 8
         and p_key = coalesce((select pg_catalog.array_agg(k::smallint order by k)
                                 from pg_catalog.generate_series(0, p_options - 1) k), '{}'::smallint[])
       when p_kind in ('number', 'match', 'cloze', 'essay') then coalesce(pg_catalog.cardinality(p_key), 0) = 0
       else coalesce(pg_catalog.cardinality(p_key), 0) <= case when p_kind = 'single' then 1
                                                                when p_kind = 'short' then 0 else p_options end
            and not exists (select 1 from pg_catalog.unnest(p_key) k where k is null or k < 0 or k >= p_options)
            and (select pg_catalog.count(distinct k) from pg_catalog.unnest(p_key) k) = coalesce(pg_catalog.cardinality(p_key), 0)
     end
$fn$;

-- 2d. Accepted answers (20261009093500 + the new kinds): short as before; number — 1..10 canonical numbers of at most 40
--     characters; match — the 2..10 right items, 1..200 characters, not empty and distinct once normalised; cloze — one
--     element per gap (1..10), each 1..10 forms joined by a newline, a form 1..200 characters and not empty once
--     normalised; every other kind none.
create or replace function public.meldy_answers_ok(p_answers text[], p_kind text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select case
    when p_answers is null or pg_catalog.array_ndims(p_answers) = 2 then false
    when p_kind = 'short' then
      pg_catalog.cardinality(p_answers) between 1 and 10
      and not exists (select 1 from pg_catalog.unnest(p_answers) a
                       where a is null or pg_catalog.char_length(a) not between 1 and 200
                          or public.meldy_short_norm(a) = '')
    when p_kind = 'number' then
      pg_catalog.cardinality(p_answers) between 1 and 10
      and not exists (select 1 from pg_catalog.unnest(p_answers) a
                       where a is null or pg_catalog.char_length(a) > 40 or a !~ '^-?[0-9]+(\.[0-9]+)?$')
    when p_kind = 'match' then
      pg_catalog.cardinality(p_answers) between 2 and 10
      and not exists (select 1 from pg_catalog.unnest(p_answers) a
                       where a is null or pg_catalog.char_length(a) not between 1 and 200
                          or public.meldy_short_norm(a) = '')
      and (select pg_catalog.count(distinct public.meldy_short_norm(a)) from pg_catalog.unnest(p_answers) a)
          = pg_catalog.cardinality(p_answers)
    when p_kind = 'cloze' then
      pg_catalog.cardinality(p_answers) between 1 and 10
      and not exists (select 1 from pg_catalog.unnest(p_answers) a
                       where a is null or pg_catalog.char_length(a) > 2100
                          or pg_catalog.cardinality(pg_catalog.string_to_array(a, E'\n')) not between 1 and 10
                          or exists (select 1 from pg_catalog.unnest(pg_catalog.string_to_array(a, E'\n')) f
                                      where pg_catalog.char_length(f) not between 1 and 200
                                         or public.meldy_short_norm(f) = ''))
    else coalesce(pg_catalog.cardinality(p_answers), 0) = 0
  end
$fn$;

-- 3. Checks (dropped and added again by name: the same definition on every apply; each validates every row, and every
--    existing row meets it — the old kinds' rules are unchanged).
alter table public.test_items drop constraint if exists test_items_kind_check;
alter table public.test_items add constraint test_items_kind_check
  check (kind in ('single', 'multiple', 'short', 'number', 'order', 'match', 'cloze', 'essay'));
alter table public.test_items drop constraint if exists test_items_options_check;
alter table public.test_items add constraint test_items_options_check
  check (case when kind in ('short', 'number', 'cloze', 'essay') then options = '[]'::jsonb
              else public.meldy_options_ok(options) end);
alter table public.test_items drop constraint if exists test_items_kind_fields_check;
alter table public.test_items add constraint test_items_kind_fields_check
  check ((tolerance is null or (kind = 'number' and tolerance >= 0))
         and (unit is null or (kind = 'number' and char_length(unit) between 1 and 20 and btrim(unit) <> ''))
         and (not partial or kind in ('multiple', 'order', 'match', 'cloze'))
         and (cardinality(material_ids) = 0
              or (kind = 'essay' and cardinality(material_ids) <= 10 and array_position(material_ids, null) is null))
         and (kind <> 'match' or cardinality(answers) between jsonb_array_length(options) and 10)
         and (kind <> 'cloze' or public.meldy_cloze_gaps(stem) = cardinality(answers)));
alter table public.test_answers drop constraint if exists test_answers_kind_check;
alter table public.test_answers add constraint test_answers_kind_check
  check (kind in ('single', 'multiple', 'short', 'number', 'order', 'match', 'cloze', 'essay'));

comment on column public.test_items.tolerance is
  'number: the accepted distance (>= 0; null = exact). docs/kinds/CONTRACT.md §1.';
comment on column public.test_items.unit is
  'number: the unit typed after the number may carry (1..20 characters; null = none). docs/kinds/CONTRACT.md §1.';
comment on column public.test_items.partial is
  'Partial credit in a quiz, by the author''s choice (multiple, order, match, cloze). docs/kinds/CONTRACT.md §2.2.';
comment on column public.test_items.material_ids is
  'essay: the author''s lectures (public.materials) the check reads (0..10). docs/kinds/CONTRACT.md §3.4.';

-- 4. rev. The key of a new kind as one value (docs/kinds/CONTRACT.md §1.3): number — the accepted values as numbers,
--    the tolerance, the unit; order — the options in order; match — the options and the right items in order; cloze —
--    per gap the set of forms; all normalised as meldy_short_norm does. null for the old kinds and essay.
create or replace function meldy_private.kind_key(p_kind text, p_options jsonb, p_answers text[], p_tolerance numeric,
                                                   p_unit text)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select case p_kind
    when 'number' then pg_catalog.jsonb_build_object(
      'v', (select pg_catalog.jsonb_agg(distinct pg_catalog.trim_scale(a::numeric) order by pg_catalog.trim_scale(a::numeric))
              from pg_catalog.unnest(p_answers) a where a ~ '^-?[0-9]+(\.[0-9]+)?$'),
      't', pg_catalog.trim_scale(p_tolerance),
      'u', pg_catalog.replace(public.meldy_short_norm(p_unit), ' ', ''))
    when 'order' then (select pg_catalog.jsonb_agg(public.meldy_short_norm(o.value) order by o.ord)
                         from pg_catalog.jsonb_array_elements_text(p_options) with ordinality as o(value, ord))
    when 'match' then pg_catalog.jsonb_build_object(
      'l', (select pg_catalog.jsonb_agg(public.meldy_short_norm(o.value) order by o.ord)
              from pg_catalog.jsonb_array_elements_text(p_options) with ordinality as o(value, ord)),
      'r', (select pg_catalog.jsonb_agg(public.meldy_short_norm(a.value) order by a.ord)
              from pg_catalog.unnest(p_answers) with ordinality as a(value, ord)))
    when 'cloze' then (select pg_catalog.jsonb_agg(
                                (select pg_catalog.jsonb_agg(distinct public.meldy_short_norm(f) order by public.meldy_short_norm(f))
                                   from pg_catalog.unnest(pg_catalog.string_to_array(g.value, E'\n')) f)
                                order by g.ord)
                         from pg_catalog.unnest(p_answers) with ordinality as g(value, ord))
  end
$fn$;
revoke all on function meldy_private.kind_key(text, jsonb, text[], numeric, text) from public, anon, authenticated;

-- test_items_guard (20261009093500) + the new kinds: a change of kind moves rev as before; the old kinds keep their rule
-- exactly; a new kind moves rev when its key (kind_key) changes.
create or replace function public.test_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_container uuid;
begin
  select s.container_id into v_container from public.container_subjects s where s.id = new.subject_id;
  if v_container is null then
    raise exception 'no such subject' using errcode = 'P0002';
  end if;
  if tg_op = 'UPDATE' and v_container is distinct from old.container_id then
    raise exception 'an item does not move to another container' using errcode = '22023';
  end if;
  new.container_id := v_container;
  new.updated_at := pg_catalog.now();
  if tg_op = 'INSERT' then
    new.rev := 1;
  elsif new.kind is distinct from old.kind then
    new.rev := old.rev + 1;
  elsif new.kind not in ('number', 'order', 'match', 'cloze', 'essay') then
    if pg_catalog.jsonb_array_length(new.options) <> pg_catalog.jsonb_array_length(old.options)
       or (select coalesce(pg_catalog.array_agg(k order by k), '{}'::smallint[]) from pg_catalog.unnest(new.correct) k)
          is distinct from
          (select coalesce(pg_catalog.array_agg(k order by k), '{}'::smallint[]) from pg_catalog.unnest(old.correct) k)
       or (select coalesce(pg_catalog.array_agg(distinct public.meldy_short_norm(a) order by public.meldy_short_norm(a)), '{}'::text[])
             from pg_catalog.unnest(new.answers) a)
          is distinct from
          (select coalesce(pg_catalog.array_agg(distinct public.meldy_short_norm(a) order by public.meldy_short_norm(a)), '{}'::text[])
             from pg_catalog.unnest(old.answers) a) then
      new.rev := old.rev + 1;
    else
      new.rev := old.rev;
    end if;
  elsif meldy_private.kind_key(new.kind, new.options, new.answers, new.tolerance, new.unit)
        is distinct from meldy_private.kind_key(old.kind, old.options, old.answers, old.tolerance, old.unit) then
    new.rev := old.rev + 1;
  else
    new.rev := old.rev;
  end if;
  return new;
end;
$fn$;

-- 5. Writes.
-- 5a. The accepted forms of a cloze gap as stored: each form trimmed, empty ones dropped, joined by a newline.
create or replace function meldy_private.cloze_forms(p_gap text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.string_agg(pg_catalog.btrim(f.value), E'\n' order by f.ord), '')
    from pg_catalog.unnest(pg_catalog.string_to_array(
           pg_catalog.replace(pg_catalog.replace(coalesce(p_gap, ''), E'\r\n', E'\n'), E'\r', E'\n'), E'\n'))
         with ordinality as f(value, ord)
   where pg_catalog.btrim(f.value) <> ''
$fn$;
revoke all on function meldy_private.cloze_forms(text) from public, anon, authenticated;

-- 5b. The new keys of an item, written by the author (container_items_add and container_item_update read them alike):
--     tolerance (a JSON number ≥ 0 or a string ^[0-9]+(\.[0-9]{1,6})?$, at most 10^9, or null), unit (a string of 1..20
--     characters once trimmed, or null), partial (a boolean), material_ids (0..10 distinct uuids of the author's own
--     materials). The first key that breaks its rule, or null.
create or replace function meldy_private.kind_keys_bad(p_x jsonb, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when p_x ? 'tolerance' and pg_catalog.jsonb_typeof(p_x -> 'tolerance') <> 'null'
         and case when pg_catalog.jsonb_typeof(p_x -> 'tolerance') not in ('number', 'string') then true
                  when (p_x ->> 'tolerance') !~ '^[0-9]+(\.[0-9]{1,6})?$' then true
                  else (p_x ->> 'tolerance')::numeric > 1000000000 end then 'tolerance'
    when p_x ? 'unit' and pg_catalog.jsonb_typeof(p_x -> 'unit') <> 'null'
         and case when pg_catalog.jsonb_typeof(p_x -> 'unit') <> 'string' then true
                  else pg_catalog.char_length(pg_catalog.btrim(p_x ->> 'unit')) not between 1 and 20 end then 'unit'
    when p_x ? 'partial' and pg_catalog.jsonb_typeof(p_x -> 'partial') <> 'boolean' then 'partial'
    when p_x ? 'material_ids'
         and case when pg_catalog.jsonb_typeof(p_x -> 'material_ids') <> 'array' then true
                  when pg_catalog.jsonb_array_length(p_x -> 'material_ids') > 10 then true
                  when exists (select 1 from pg_catalog.jsonb_array_elements(p_x -> 'material_ids') m
                                where pg_catalog.jsonb_typeof(m) <> 'string'
                                   or (m #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then true
                  when (select pg_catalog.count(distinct pg_catalog.lower(m))
                          from pg_catalog.jsonb_array_elements_text(p_x -> 'material_ids') m)
                       <> pg_catalog.jsonb_array_length(p_x -> 'material_ids') then true
                  else exists (select 1 from pg_catalog.jsonb_array_elements_text(p_x -> 'material_ids') m
                                where not exists (select 1 from public.materials t
                                                   where t.id = m::uuid and t.user_id = p_user)) end then 'material_ids'
  end
$fn$;
revoke all on function meldy_private.kind_keys_bad(jsonb, uuid) from public, anon, authenticated;

-- 5c. container_items_add (20261018100000_test_builder) + the new kinds and keys. An element of kind number: answers
--     (canonical numbers), tolerance, unit; order: options in the right order (correct, when given, must be the
--     identity; it is stored as the identity); match: options (left) and answers (right, then extras); cloze: the stem's
--     gaps and answers (one element per gap, its forms joined by a newline); essay: material_ids. partial for multiple,
--     order, match, cloze. The old kinds' rules and rows are as before.
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
                                 tolerance, unit, partial, material_ids)
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
              else '{}'::uuid[] end
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

-- 5d. container_item_update (20261018100000_test_builder) + the new keys tolerance, unit, partial, material_ids (the
--     rules of kind_keys_bad; 22023 detail names the key) and the new kinds: an order item's correct is always the
--     identity of its options; a cloze gap's forms are stored trimmed, one per line. A patch that changes the kind
--     clears what the new kind does not have (tolerance and unit outside number, partial outside multiple / order /
--     match / cloze, material_ids outside essay); the options, correct and answers of the new kind come in the patch,
--     as before. The table's checks decide the rest (22023 with the violated rule). The old kinds' patches are as before.
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
  v_bad := meldy_private.kind_keys_bad(p_patch, v_user);
  if v_bad is not null then
    raise exception 'invalid patch' using errcode = '22023', detail = v_bad;
  end if;
  v_kind := coalesce(p_patch ->> 'kind', v_old.kind);
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
                          else i.material_ids end
     where i.id = p_item_id
    returning i.* into v_new;
  exception
    when check_violation or not_null_violation then
      raise exception 'invalid patch' using errcode = '22023', detail = sqlerrm;
  end;
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
                                       'doubts_resolved', v_resolved);
end;
$fn$;
