-- oral_plan_inputs
-- Repo file: supabase/migrations/20261010120007_oral_plan_inputs.sql (package T11 of the Telegram bot, 2026-10-10).
-- Rollback: supabase/rollback/20261010120007_oral_plan_inputs_down.sql. Local rehearsal (never live):
-- supabase/tests/local/oral_plan_inputs.sql (behaviour) and supabase/tests/local/oral_plan_inputs_equivalence.sh (the
-- equivalence with the Space's Python and the site's TS, the rollback, the re-run). Contract: the T11 block of
-- supabase/tests/telegram_bot.sql.
--
-- The oral part of the day plan on the server, so the Telegram bot plans the same day as the site (spec
-- Telegram_Bot_Spec_2026-10-09 §6.8; one plan a day and one figure). The site plans an exam's oral questions from three
-- reads: the cheat sheet (GET /api/oral/sheet: backend/oral_sheet.py _load_state + _sheet_response, database reads
-- only, no AI), the sheet's journal events (frontend api/learning.ts fetchSheetEvents, fetchQuestionEvents) and the oral
-- exam's date; the pure core frontend/src/lib/containers/oralParts.ts turns them into plan items. The bot (service
-- role, no Space) gets the same three reads here and runs a copy of the same core:
--   * meldy_private.oral_sheet_for(p_user, p_exam_id) jsonb — the JSON of GET /api/oral/sheet for an exam of p_user
--     (P0002 for any other exam), field for field what parseSheetResponse, buildSheet and oralPlanPart read: the
--     questions in the department's order, the current rubric by the rubric key (oral.rubric_key, ported byte for byte:
--     meldy_private.oral_rubric_key), its usability, the cleaned points and lectures (_clean_points, _clean_materials),
--     rebuilt, unwritable, to_write, units. One field is passed through as stored: a point's `short` (the cheat-sheet
--     line, display only: the Space re-checks it with short_problem, here only its version and its cleaning apply);
--     `job` is null (the bot never starts a writing job);
--   * meldy_private.oral_events_for(p_user, p_hashes) — the learning_events rows of the two TS reads for these question
--     hashes: oral_point / sheet_peek by payload.question_hash, exam_answer / self_rating by item_key 'q:<hash>'; the
--     same columns, kinds and filters, only p_user's rows (the policy «Learning events: read own»), oldest first;
--   * public.bot_oral_inputs(p_tg_user_id) jsonb — the service role's read for the bot: the user only through
--     bot.active_link; for each oral part of the user's exams, the parts the site plans (container_summary_for's
--     subjects[].oral.exam_id: the author's oral exam, or a member's bound copy):
--       {linked: true, cap: 300, parts: [{container_id, subject_id, exam_id, exam_date, questions, capped, sheet,
--        line_events, meta_events}]} | {linked: false}
--     parts in the order of plan_inputs' containers, then the subjects' order (position, created_at); exam_date = the
--     oral exam's own date; line_events = the events fetchSheetEvents reads for the sheet's written questions;
--     meta_events = those fetchQuestionEvents reads for the questions in the plan (a superset only when the browser's
--     parser drops a point the Space keeps: oralMeta reads a question's own key, so extra events change nothing); events
--     as api/learning.ts normalizeEvent gives them. Cap: a part with more than 300 questions (the parser keeps 150 per
--     exam, positions are 1..300) is `capped: true` with `sheet: null` and no events — the bot leaves it out.
-- Python's semantics, ported: str(x or "") of a JSON value (meldy_private.py_str: int / float repr / True, containers
-- by repr for printable text — Unicode-version-dependent non-printables aside), str.strip()'s whitespace, re's `$`
-- before a final newline (point ids), sorted() by code point (COLLATE "C"), sha256 over UTF-8.
-- Additive and re-runnable: new functions only (CREATE OR REPLACE), no table, column, policy or old function touched.
-- Errors: 42501 not the service role (bot_oral_inputs) or no privilege; P0002 not the user's exam (oral_sheet_for).
-- The bot's functions answer every input with JSON, never an error: bot_oral_inputs raises only 42501.

-- 1. Python's str(x or "") of a JSON value, as the Space reads it (PostgREST's JSON → json.loads → str()).
-- 1a. repr() of a str: the quote Python picks, backslash escapes, \xNN / \uNNNN / \UNNNNNNNN for the non-printables
--     (controls, the spaces and separators but U+0020, the format characters and the private use planes of Unicode 15;
--     an unassigned code point, which Python escapes too, is printed as it is: that set changes with Python's Unicode).
create or replace function meldy_private.py_repr_text(p_text text)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $fn$
declare
  v_quote text := case when pg_catalog.strpos(p_text, '''') > 0 and pg_catalog.strpos(p_text, '"') = 0 then '"' else '''' end;
  v_out text := v_quote;
  v_ch text;
  v_cp integer;
begin
  if p_text = '' then
    return v_out || v_quote;
  end if;
  foreach v_ch in array pg_catalog.regexp_split_to_array(p_text, '') loop
    v_cp := pg_catalog.ascii(v_ch);
    if v_ch = '\' or v_ch = v_quote then
      v_out := v_out || '\' || v_ch;
    elsif v_cp = 9 then
      v_out := v_out || '\t';
    elsif v_cp = 10 then
      v_out := v_out || '\n';
    elsif v_cp = 13 then
      v_out := v_out || '\r';
    elsif v_cp < 32 or (v_cp between 127 and 160) or v_cp = 173 then
      v_out := v_out || '\x' || pg_catalog.lpad(pg_catalog.to_hex(v_cp), 2, '0');
    elsif (v_cp between 1536 and 1541) or v_cp in (1564, 1757, 1807, 2192, 2193, 2274, 5760, 6158, 12288, 65279)
          or (v_cp between 8192 and 8207) or (v_cp between 8232 and 8239) or (v_cp between 8287 and 8292)
          or (v_cp between 8294 and 8303) or (v_cp between 57344 and 63743) or (v_cp between 65529 and 65531) then
      v_out := v_out || '\u' || pg_catalog.lpad(pg_catalog.to_hex(v_cp), 4, '0');
    elsif v_cp in (69821, 69837) or (v_cp between 77872 and 77887) or (v_cp between 113824 and 113827)
          or (v_cp between 119155 and 119162) or v_cp = 917505 or (v_cp between 917536 and 917631) or v_cp >= 983040 then
      v_out := v_out || '\U' || pg_catalog.lpad(pg_catalog.to_hex(v_cp), 8, '0');
    else
      v_out := v_out || v_ch;
    end if;
  end loop;
  return v_out || v_quote;
end;
$fn$;

-- 1b. repr() of a float given as the decimal text of a JSON number: the shortest digits that read back as the same
--     double (PostgreSQL's float8 output with extra_float_digits 1 and Python's repr pick the same ones), in Python's
--     layout: fixed with «.0» when the decimal point is within 16 digits, else d.ddde±XX; inf beyond a double.
create or replace function meldy_private.py_float_repr(p_number text)
returns text
language plpgsql
immutable
strict
set search_path = ''
set extra_float_digits = 1
as $fn$
declare
  v_double double precision;
  v_parts text[];
  v_digits text;
  v_point integer;
  v_body text;
begin
  begin
    v_double := p_number::double precision;
  exception when numeric_value_out_of_range then
    -- Beyond a double: Python reads inf (or 0.0 below the smallest one).
    return case when pg_catalog.abs(p_number::numeric) >= 1 then
                  case when p_number like '-%' then '-inf' else 'inf' end
                else case when p_number like '-%' then '-0.0' else '0.0' end end;
  end;
  if v_double = 0 then
    return case when p_number like '-%' then '-0.0' else '0.0' end;
  end if;
  v_parts := pg_catalog.regexp_match(v_double::text, '^(-?)([0-9]+)(?:\.([0-9]+))?(?:e([+-][0-9]+))?$');
  v_digits := v_parts[2] || coalesce(v_parts[3], '');
  v_point := pg_catalog.length(v_parts[2]) + coalesce(v_parts[4]::integer, 0);
  while pg_catalog.left(v_digits, 1) = '0' and pg_catalog.length(v_digits) > 1 loop
    v_digits := pg_catalog.substr(v_digits, 2);
    v_point := v_point - 1;
  end loop;
  v_digits := pg_catalog.rtrim(v_digits, '0');
  if v_point > -4 and v_point <= 16 then
    v_body := case
      when v_point <= 0 then '0.' || pg_catalog.repeat('0', -v_point) || v_digits
      when v_point >= pg_catalog.length(v_digits) then v_digits || pg_catalog.repeat('0', v_point - pg_catalog.length(v_digits)) || '.0'
      else pg_catalog.substr(v_digits, 1, v_point) || '.' || pg_catalog.substr(v_digits, v_point + 1) end;
  else
    v_body := pg_catalog.left(v_digits, 1)
              || case when pg_catalog.length(v_digits) > 1 then '.' || pg_catalog.substr(v_digits, 2) else '' end
              || 'e' || case when v_point - 1 < 0 then '-' else '+' end
              || case when pg_catalog.abs(v_point - 1) < 10 then '0' else '' end || pg_catalog.abs(v_point - 1)::text;
  end if;
  return v_parts[1] || v_body;
end;
$fn$;

-- 1c. repr() of a JSON value (None, True, False, int, float, str, list, dict in the order PostgREST gives the keys).
create or replace function meldy_private.py_repr(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  return case pg_catalog.jsonb_typeof(p_value)
    when 'string' then meldy_private.py_repr_text(p_value #>> '{}')
    when 'boolean' then case when p_value = 'true'::jsonb then 'True' else 'False' end
    when 'number' then case when pg_catalog.strpos(p_value #>> '{}', '.') = 0 then p_value #>> '{}'
                            else meldy_private.py_float_repr(p_value #>> '{}') end
    when 'array' then '[' || coalesce((select pg_catalog.string_agg(meldy_private.py_repr(e.value), ', ' order by e.ord)
                                         from pg_catalog.jsonb_array_elements(p_value) with ordinality as e(value, ord)), '') || ']'
    when 'object' then '{' || coalesce((select pg_catalog.string_agg(meldy_private.py_repr_text(e.key) || ': ' || meldy_private.py_repr(e.value),
                                                                  ', ' order by e.ord)
                                          from pg_catalog.jsonb_each(p_value) with ordinality as e(key, value, ord)), '') || '}'
    else 'None' end;
end;
$fn$;

-- 1d. str(x or ""): "" for a missing key, null, false, 0, 0.0, "", [], {}; else str(x).
create or replace function meldy_private.py_str(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case pg_catalog.jsonb_typeof(p_value)
    when 'string' then p_value #>> '{}'
    when 'boolean' then case when p_value = 'true'::jsonb then 'True' else '' end
    when 'number' then case
      when pg_catalog.strpos(p_value #>> '{}', '.') = 0 then case when (p_value #>> '{}')::numeric = 0 then '' else p_value #>> '{}' end
      else (select case when f.r in ('0.0', '-0.0') then '' else f.r end
              from (select meldy_private.py_float_repr(p_value #>> '{}') as r) f) end
    when 'array' then case when pg_catalog.jsonb_array_length(p_value) = 0 then '' else meldy_private.py_repr(p_value) end
    when 'object' then case when p_value = '{}'::jsonb then '' else meldy_private.py_repr(p_value) end
    else '' end
$fn$;

-- 2. backend/oral.py rubric_key → source_key: sha256("v1|" + fp + "|" + proofs + "|" + method)[:40]. fp = the
--    question's materials_fingerprint, else "ids:" + the exam's lecture ids sorted; proofs = the sorted distinct
--    "<material_id>:<source_id>" of the evidence items whose both values are truthy (f-string = str()).
create or replace function meldy_private.oral_rubric_key(p_fingerprint text, p_material_ids text[], p_evidence jsonb, p_method text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select pg_catalog.left(pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
           'v1|'
           || case when p_fingerprint is not null and p_fingerprint <> '' then p_fingerprint
                   else 'ids:' || coalesce((select pg_catalog.string_agg(d.m, ',' order by d.m collate "C")
                                              from (select distinct m from pg_catalog.unnest(p_material_ids) as u(m)
                                                     where m is not null and m <> '') d), '') end
           || '|'
           || coalesce((select pg_catalog.string_agg(d.p, ',' order by d.p collate "C")
                          from (select distinct meldy_private.py_str(e -> 'material_id') || ':' || meldy_private.py_str(e -> 'source_id') as p
                                  from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_evidence) = 'array'
                                                                             then p_evidence else '[]'::jsonb end) as e
                                 where pg_catalog.jsonb_typeof(e) = 'object'
                                   and meldy_private.py_str(e -> 'material_id') <> ''
                                   and meldy_private.py_str(e -> 'source_id') <> '') d), '')
           || '|' || coalesce(p_method, ''),
           'UTF8')), 'hex'), 40)
$fn$;

-- 3. backend/oral_sheet.py _clean_points: the points of a rubric for the sheet, in order — an object with a string id
--    matching ^p[1-6]$ (Python's $ also before a final newline) not taken yet by an earlier kept point, and a string
--    title that str.strip() leaves non-empty; essential is true only for JSON true; source_quote a string or "";
--    source_ids the string elements of a list.
create or replace function meldy_private.oral_clean_points(p_points jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', k.item -> 'id',
           'title', k.item -> 'title',
           'essential', coalesce((k.item -> 'essential') = 'true'::jsonb, false),
           'source_quote', case when pg_catalog.jsonb_typeof(k.item -> 'source_quote') = 'string' then k.item -> 'source_quote'
                                else '""'::jsonb end,
           'source_ids', case when pg_catalog.jsonb_typeof(k.item -> 'source_ids') = 'array'
                              then coalesce((select pg_catalog.jsonb_agg(s.value order by s.ord)
                                               from pg_catalog.jsonb_array_elements(k.item -> 'source_ids') with ordinality as s(value, ord)
                                              where pg_catalog.jsonb_typeof(s.value) = 'string'), '[]'::jsonb)
                              else '[]'::jsonb end)
           order by k.ord), '[]'::jsonb)
    from (select v.item, v.ord, pg_catalog.row_number() over (partition by v.item ->> 'id' order by v.ord) as nth
            from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_points) = 'array' then p_points else '[]'::jsonb end)
                 with ordinality as v(item, ord)
           where pg_catalog.jsonb_typeof(v.item) = 'object'
             and pg_catalog.jsonb_typeof(v.item -> 'id') = 'string'
             and (v.item ->> 'id') ~ '^p[1-6]\n?$'
             and pg_catalog.jsonb_typeof(v.item -> 'title') = 'string'
             and (v.item ->> 'title') ~ '[^\u0009\u000a\u000b\u000c\u000d\u001c-\u001f \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]') k
   where k.nth = 1
$fn$;

-- 4. backend/oral_sheet.py _clean_materials: every object item as {key, material_id, title} = str(value or "").
create or replace function meldy_private.oral_clean_materials(p_materials jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'key', meldy_private.py_str(m.item -> 'key'),
           'material_id', meldy_private.py_str(m.item -> 'material_id'),
           'title', meldy_private.py_str(m.item -> 'title')) order by m.ord), '[]'::jsonb)
    from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_materials) = 'array' then p_materials else '[]'::jsonb end)
         with ordinality as m(item, ord)
   where pg_catalog.jsonb_typeof(m.item) = 'object'
$fn$;

-- 5. A point's stored cheat-sheet line (oral_rubrics.sheet, _sheet_state): only a record of this rubric's version
--    ({"v": 1, "for": <created_at>}), a string that is 1..56 characters once NFC-normalised and its whitespace collapsed.
--    Display only (the plan never reads it): the Space's short_problem re-check is not ported.
create or replace function meldy_private.oral_sheet_short(p_sheet jsonb, p_created_at timestamptz, p_point_id text)
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_for timestamptz;
  v_line text;
begin
  if pg_catalog.jsonb_typeof(p_sheet) is distinct from 'object' or (p_sheet -> 'v') is distinct from '1'::jsonb
     or pg_catalog.jsonb_typeof(p_sheet -> 'for') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_sheet -> 'short') is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_sheet -> 'short' -> p_point_id) is distinct from 'string' then
    return '';
  end if;
  if (p_sheet ->> 'for') !~ '^\s*[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}' then
    return '';
  end if;
  begin
    v_for := (p_sheet ->> 'for')::timestamptz;
  exception when others then
    return '';
  end;
  if v_for is distinct from p_created_at then
    return '';
  end if;
  v_line := pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.normalize(p_sheet -> 'short' ->> p_point_id, 'NFC'),
                             '[\u0009\u000a\u000b\u000c\u000d\u001c-\u001f \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+',
                             ' ', 'g'), ' ');
  return case when pg_catalog.char_length(v_line) between 1 and 56 then v_line else '' end;
end;
$fn$;

-- 6. GET /api/oral/sheet for an exam of p_user (backend/oral_sheet.py _load_state + _sheet_response, job null), the
--    rows the Space reads with the user's token (the policies «… read own»): the exam, its questions in the
--    department's order (position, created_at, id), its lectures (exam_materials, PostgREST's first 1000 rows by
--    added_at, material_id), the user's rubric rows of version 1 and quote-check failures for the questions' hashes.
--    A question's rubric is the row of its hash and key when usable (coverage full | partial | none, points a list);
--    rebuilt = no usable row by its key, but a usable row with points by another key whose lectures are all this exam's;
--    unwritable = mapped full | partial, no usable row, and a failure by its key; to_write = the other full | partial
--    questions without a usable row; units = their distinct (hash, key) × 1 (AI_COSTS answerPoints).
create or replace function meldy_private.oral_sheet_for(p_user uuid, p_exam_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_exam public.exams%rowtype;
  v_lectures text[];
  v_out jsonb;
begin
  select e.* into v_exam from public.exams e where e.id = p_exam_id and e.user_id = p_user;
  if v_exam.id is null then
    raise exception 'exam not found' using errcode = 'P0002';
  end if;
  -- oral_api._exam_material_ids: one PostgREST page (1000 rows) in its order; the primary key keeps ids distinct.
  select coalesce(pg_catalog.array_agg(m.material_id::text order by m.added_at, m.material_id), '{}'::text[]) into v_lectures
    from (select em.material_id, em.added_at from public.exam_materials em
           where em.exam_id = p_exam_id and em.user_id = p_user
           order by em.added_at, em.material_id limit 1000) m;

  with q as (
    select x.*, pg_catalog.row_number() over (order by x.position, x.created_at, x.id) as ord,
           meldy_private.oral_rubric_key(x.materials_fingerprint, v_lectures, x.evidence, x.coverage_method) as key,
           coalesce(x.question_hash, '') as hash
      from public.exam_questions x
     where x.exam_id = p_exam_id and x.user_id = p_user
  ),
  r as (
    select y.id, y.question_hash, y.source_key, y.created_at, y.sheet, y.rubric,
           (pg_catalog.jsonb_typeof(y.rubric -> 'points') = 'array'
            and pg_catalog.jsonb_typeof(y.rubric -> 'coverage') = 'string'
            and (y.rubric ->> 'coverage') in ('full', 'partial', 'none')) as usable
      from public.oral_rubrics y
     where y.user_id = p_user and y.rubric_version = 1
       and y.question_hash in (select q.hash from q where q.hash ~ '^[0-9a-f]{32}$')
  ),
  -- Usable rows with points (any key) all of whose lectures are this exam's (_built_from).
  built as (
    select distinct r.question_hash
      from r
     where r.usable
       and pg_catalog.jsonb_array_length(meldy_private.oral_clean_points(r.rubric -> 'points')) > 0
       and exists (select 1 from pg_catalog.jsonb_array_elements(meldy_private.oral_clean_materials(r.rubric -> 'materials')) m
                    where m ->> 'material_id' <> '')
       and not exists (select 1 from pg_catalog.jsonb_array_elements(meldy_private.oral_clean_materials(r.rubric -> 'materials')) m
                        where m ->> 'material_id' <> ''
                          and pg_catalog.lower(m ->> 'material_id') <> all (select pg_catalog.lower(l) from pg_catalog.unnest(v_lectures) l))
  ),
  f as (
    select distinct z.question_hash, z.source_key
      from public.oral_rubric_failures z
     where z.user_id = p_user and z.rubric_version = 1
       and z.question_hash in (select q.hash from q where q.hash ~ '^[0-9a-f]{32}$')
  ),
  s as (
    select q.*, cur.id as rubric_id, cur.created_at as rubric_at, cur.sheet as rubric_sheet, cur.rubric as rubric,
           coalesce(cur.usable, false) as usable,
           (q.coverage in ('full', 'partial') and not coalesce(cur.usable, false)
            and exists (select 1 from f where f.question_hash = q.hash and f.source_key = q.key)) as failed
      from q
      left join r cur on cur.question_hash = q.hash and cur.source_key = q.key
  )
  select pg_catalog.jsonb_build_object(
           'exam_id', v_exam.id,
           'mapping_state', coalesce(nullif(v_exam.mapping_state, ''), 'none'),
           'questions', coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
              'question_id', s.id,
              'position', s.position,
              'label', coalesce(s.label, ''),
              'section', s.section,
              'text', coalesce(s.text, ''),
              'question_hash', s.hash,
              'coverage', case when s.coverage in ('full', 'partial', 'none', 'unverified') then s.coverage end,
              'coverage_method', case when s.coverage_method in ('llm', 'lexical', 'manual') then s.coverage_method end,
              'coverage_reason', coalesce(s.coverage_reason, ''),
              'missing_note', coalesce(s.missing_note, ''),
              'rubric', case when s.usable then pg_catalog.jsonb_build_object(
                  'rubric_id', s.rubric_id,
                  'built_at', s.rubric_at,
                  'coverage', s.rubric ->> 'coverage',
                  'coverage_note', case when pg_catalog.jsonb_typeof(s.rubric -> 'coverage_note') = 'string'
                                        then s.rubric -> 'coverage_note' else '""'::jsonb end,
                  'materials', meldy_private.oral_clean_materials(s.rubric -> 'materials'),
                  'points', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                     'id', p.value -> 'id', 'title', p.value -> 'title',
                                     'short', meldy_private.oral_sheet_short(s.rubric_sheet, s.rubric_at, p.value ->> 'id'),
                                     'essential', p.value -> 'essential', 'source_quote', p.value -> 'source_quote',
                                     'source_ids', p.value -> 'source_ids') order by p.ord), '[]'::jsonb)
                               from pg_catalog.jsonb_array_elements(meldy_private.oral_clean_points(s.rubric -> 'points'))
                                    with ordinality as p(value, ord))) end,
              'rebuilt', not s.usable and not s.failed and s.hash in (select built.question_hash from built),
              'unwritable', s.failed)
              order by s.ord), '[]'::jsonb),
           'to_write', pg_catalog.count(*) filter (where not s.failed and s.coverage in ('full', 'partial') and not s.usable
                                                      and s.hash ~ '^[0-9a-f]{32}$'),
           'units', (select pg_catalog.count(*) from (select distinct t.hash, t.key from s t
                                                        where not t.failed and t.coverage in ('full', 'partial') and not t.usable
                                                          and t.hash ~ '^[0-9a-f]{32}$') u) * 1,
           'unwritable', pg_catalog.count(*) filter (where s.failed),
           'job', null)
    into v_out
    from s;
  return v_out;
end;
$fn$;

-- 7. The journal rows of frontend api/learning.ts fetchSheetEvents(p_hashes) and fetchQuestionEvents(p_hashes,
--    ['exam_answer', 'self_rating']), p_user's only («Learning events: read own»): the hashes as the TS reads take them
--    (trimmed as String.prototype.trim does, lower case, ^[0-9a-f]{32}$, distinct); oral_point / sheet_peek whose
--    payload.question_hash is one of them, exam_answer / self_rating whose item_key is 'q:' + one of them; the reads'
--    columns, oldest first (created_at, id — the order of their compareEventTime).
create or replace function meldy_private.oral_events_for(p_user uuid, p_hashes text[])
returns table (id uuid, created_at timestamptz, local_date date, material_id uuid, kind text, item_key text,
               correct boolean, score real, confidence smallint, source_ids text[], session_id uuid, payload jsonb)
language sql
stable
set search_path = ''
as $fn$
  with h as (
    select distinct x.h
      from (select pg_catalog.lower(pg_catalog.btrim(t, E'\t\n\x0b\x0c\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')) as h
              from pg_catalog.unnest(p_hashes) as u(t) where t is not null) x
     where x.h ~ '^[0-9a-f]{32}$'
  )
  select e.id, e.created_at, e.local_date, e.material_id, e.kind, e.item_key, e.correct, e.score, e.confidence,
         e.source_ids, e.session_id, e.payload
    from public.learning_events e
   where e.user_id = p_user
     and ((e.kind in ('oral_point', 'sheet_peek') and (e.payload ->> 'question_hash') in (select h.h from h))
          or (e.kind in ('exam_answer', 'self_rating') and e.item_key in (select 'q:' || h.h from h)))
   order by e.created_at, e.id
$fn$;

-- 7a. One journal row as the site's reads give it (api/learning.ts normalizeEvent over PostgREST's JSON): the twelve
--     fields, numbers as PostgREST writes them (score through real's own output), null elements of source_ids dropped.
create or replace function meldy_private.oral_event_json(p_id uuid, p_created_at timestamptz, p_local_date date, p_material_id uuid,
  p_kind text, p_item_key text, p_correct boolean, p_score real, p_confidence smallint, p_source_ids text[], p_session_id uuid,
  p_payload jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'id', p_id, 'created_at', p_created_at, 'local_date', coalesce(pg_catalog.to_jsonb(p_local_date), '""'::jsonb),
    'material_id', p_material_id, 'kind', p_kind, 'item_key', p_item_key, 'correct', p_correct,
    'score', case when p_score is null or p_score = 'NaN'::real or p_score in ('Infinity'::real, '-Infinity'::real) then null
                  else pg_catalog.to_json(p_score)::jsonb end,
    'confidence', case when p_confidence in (1, 2, 3) then p_confidence end,
    'source_ids', coalesce(pg_catalog.to_jsonb(pg_catalog.array_remove(p_source_ids, null)), '[]'::jsonb),
    'session_id', p_session_id,
    'payload', case when pg_catalog.jsonb_typeof(p_payload) = 'object' then p_payload else '{}'::jsonb end)
$fn$;

-- 8. The bot's read (service role): the oral parts of the Telegram user's exams with their sheets and events.
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
  v_line_events jsonb;
  v_meta_events jsonb;
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
    select c.id as container_id, s.id as subject_id, x.exam_id, e.exam_date
      from public.containers c
      join public.container_subjects s on s.container_id = c.id and s.exam_id is not null
      cross join lateral (select case meldy_private.role_in(v_l.user_id, c.id)
                                   when 'owner' then s.exam_id
                                   when 'member' then (select me.exam_id from public.container_member_exams me
                                                        where me.subject_id = s.id and me.user_id = v_l.user_id) end as exam_id) x
      join public.exams e on e.id = x.exam_id and e.user_id = v_l.user_id
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
    select coalesce(pg_catalog.jsonb_agg(ev.j order by ev.created_at, ev.id) filter (where ev.line), '[]'::jsonb),
           coalesce(pg_catalog.jsonb_agg(ev.j order by ev.created_at, ev.id) filter (where not ev.line), '[]'::jsonb)
      into v_line_events, v_meta_events
      from (select o.created_at, o.id, o.kind in ('oral_point', 'sheet_peek') as line,
                   meldy_private.oral_event_json(o.id, o.created_at, o.local_date, o.material_id, o.kind, o.item_key, o.correct,
                                                 o.score, o.confidence, o.source_ids, o.session_id, o.payload) as j
              from meldy_private.oral_events_for(v_l.user_id, v_line || v_meta) o
             where (o.kind in ('oral_point', 'sheet_peek') and (o.payload ->> 'question_hash') = any (v_line))
                or (o.kind in ('exam_answer', 'self_rating') and pg_catalog.substr(o.item_key, 3) = any (v_meta))) ev;
    v_parts := v_parts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'container_id', v_part.container_id, 'subject_id', v_part.subject_id, 'exam_id', v_part.exam_id,
      'exam_date', v_part.exam_date, 'questions', v_count, 'capped', false, 'sheet', v_sheet,
      'line_events', v_line_events, 'meta_events', v_meta_events));
  end loop;
  return pg_catalog.jsonb_build_object('linked', true, 'cap', v_cap, 'parts', v_parts);
end;
$fn$;

-- 9. Grants (as 20261010120002_telegram_bot_revokes.sql): what PostgreSQL gives PUBLIC on a new function and Supabase's
--    default privileges give anon and authenticated are taken back; the bot's read runs for the service role only, the
--    helpers for their owner only. Safety does not depend on it: bot_oral_inputs checks the service role first, and
--    meldy_private has no USAGE for clients.
revoke all on function meldy_private.py_repr_text(text), meldy_private.py_float_repr(text), meldy_private.py_repr(jsonb),
  meldy_private.py_str(jsonb), meldy_private.oral_rubric_key(text, text[], jsonb, text), meldy_private.oral_clean_points(jsonb),
  meldy_private.oral_clean_materials(jsonb), meldy_private.oral_sheet_short(jsonb, timestamptz, text),
  meldy_private.oral_sheet_for(uuid, uuid), meldy_private.oral_events_for(uuid, text[]),
  meldy_private.oral_event_json(uuid, timestamptz, date, uuid, text, text, boolean, real, smallint, text[], uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.bot_oral_inputs(bigint) from public, anon, authenticated;
grant execute on function public.bot_oral_inputs(bigint) to service_role;
