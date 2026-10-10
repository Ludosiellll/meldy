-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261010120007_oral_plan_inputs.sql
-- (package T11: the oral part of the day plan on the server) on the scratch database of oral_plan_inputs_equivalence.sh,
-- on top of the exam container's and T1's migrations: who may call what; the Python ports on values the backend's own
-- functions were run on (oral.rubric_key, _clean_points, str()); oral_sheet_for, oral_events_for and bot_oral_inputs on
-- a small fixture of their own (the equivalence with the Space's Python and the site's TS on a larger one is the .sh's).
-- One transaction, rolled back. A failure raises (FAILED: …); success prints ORAL PLAN INPUTS CHECKS PASSED. Roles as
-- PostgREST sets them: anon, authenticated (request.jwt.claim.sub), service_role (request.jwt.claims); postgres for
-- the fixture.
\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.expect_error(p_sql text, p_states text[], p_what text)
returns void language plpgsql as $fn$
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_states;
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if not (sqlstate = any (p_states)) then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_states;
    end if;
end;
$fn$;
create or replace function pg_temp.as_role(p_role text, p_sub uuid default null)
returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  perform set_config('request.jwt.claim.role', '', true);
  if p_role = 'postgres' then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', p_sub)::text, true);
    execute format('set local role %I', p_role);
  end if;
end;
$fn$;
grant execute on function pg_temp.expect_error(text, text[], text), pg_temp.as_role(text, uuid) to anon, authenticated, service_role;

-- 1. Who may call what: the bot's read is the service role's only; the cores live in meldy_private (no USAGE for clients).
do $t$
begin
  perform pg_temp.as_role('anon');
  perform pg_temp.expect_error('select public.bot_oral_inputs(70101)', array['42501'], 'anon runs bot_oral_inputs');
  perform pg_temp.as_role('authenticated', 'e1100000-0000-4000-8000-000000000001');
  perform pg_temp.expect_error('select public.bot_oral_inputs(70101)', array['42501'], 'authenticated runs bot_oral_inputs');
  perform pg_temp.expect_error($q$select meldy_private.oral_sheet_for('e1100000-0000-4000-8000-000000000001', gen_random_uuid())$q$,
                               array['42501'], 'authenticated reaches meldy_private.oral_sheet_for');
  perform pg_temp.expect_error($q$select * from meldy_private.oral_events_for('e1100000-0000-4000-8000-000000000001', '{}')$q$,
                               array['42501'], 'authenticated reaches meldy_private.oral_events_for');
  perform pg_temp.as_role('postgres');
end
$t$;
-- The function's own gate, with EXECUTE given back for a moment (as before a revoke): still 42501 for a client.
grant execute on function public.bot_oral_inputs(bigint) to authenticated;
do $t$
begin
  perform pg_temp.as_role('authenticated', 'e1100000-0000-4000-8000-000000000001');
  perform pg_temp.expect_error('select public.bot_oral_inputs(70101)', array['42501'], 'the gate of bot_oral_inputs');
  perform pg_temp.as_role('postgres');
end
$t$;
revoke execute on function public.bot_oral_inputs(bigint) from authenticated;
do $t$
begin
  if not has_function_privilege('service_role', 'public.bot_oral_inputs(bigint)', 'EXECUTE')
     or has_function_privilege('anon', 'public.bot_oral_inputs(bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.bot_oral_inputs(bigint)', 'EXECUTE')
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'meldy_private'
                   and p.proname in ('py_repr_text', 'py_float_repr', 'py_repr', 'py_str', 'oral_rubric_key', 'oral_clean_points',
                                     'oral_clean_materials', 'oral_sheet_short', 'oral_sheet_for', 'oral_events_for', 'oral_events_json')
                   and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     or (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'meldy_private'
            and p.proname in ('py_repr_text', 'py_float_repr', 'py_repr', 'py_str', 'oral_rubric_key', 'oral_clean_points',
                              'oral_clean_materials', 'oral_sheet_short', 'oral_sheet_for', 'oral_events_for', 'oral_events_json')
            and array_to_string(p.proconfig, ',') like 'search_path=%') <> 11
     or (select provolatile from pg_proc where oid = 'public.bot_oral_inputs(bigint)'::regprocedure) <> 's'
     or not (select prosecdef from pg_proc where oid = 'public.bot_oral_inputs(bigint)'::regprocedure) then
    raise exception 'FAILED: grants, search_path or volatility';
  end if;
end
$t$;

-- 2. The Python ports, on values the backend's own functions were run on (python -I, backend/oral.py, oral_sheet.py).
do $t$
declare
  v_cases text[][] := array[
    ['"abc"', 'abc'], ['""', ''], ['null', ''], ['true', 'True'], ['false', ''], ['0', ''], ['0.0', ''], ['-0.0', ''],
    ['12', '12'], ['-7', '-7'], ['1.50', '1.5'], ['0.1', '0.1'], ['1e-5', '1e-05'], ['0.0001', '0.0001'],
    ['1000000000000000.0', '1000000000000000.0'], ['10000000000000000.0', '1e+16'], ['123456789012345678.0', '1.2345678901234568e+17'],
    ['-2.5', '-2.5'], ['3.0', '3.0'], ['[]', ''], ['{}', ''],
    ['[1, "a", true, null, 2.5, {"k": "it''s"}]', $$[1, 'a', True, None, 2.5, {'k': "it's"}]$$],
    ['{"b": 1, "a": ["x\ty"]}', $$ {'a': ['x\ty'], 'b': 1}$$],
    ['["a\"b", "a''b", "a''b\"c", "\u0085\u00a0\u200b\u3000\ufeff\u007f\u0001", "Ж😀"]',
     $$['a"b', "a'b", 'a\'b"c', '\x85\xa0\u200b\u3000\ufeff\x7f\x01', 'Ж😀']$$]];
  v_got text;
begin
  for i in 1 .. array_length(v_cases, 1) loop
    v_got := meldy_private.py_str(v_cases[i][1]::jsonb);
    if v_got is distinct from ltrim(v_cases[i][2]) then
      raise exception 'FAILED: py_str(%) = %, Python says %', v_cases[i][1], v_got, ltrim(v_cases[i][2]);
    end if;
  end loop;
  if meldy_private.py_float_repr('1' || repeat('0', 400) || '.0') <> 'inf'
     or meldy_private.py_float_repr('0.' || repeat('0', 400) || '1') <> '0.0' then
    raise exception 'FAILED: floats beyond a double';
  end if;
  if meldy_private.oral_rubric_key(null, array['b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
                                               'b0000000-0000-4000-8000-000000000002'],
                                   '[{"material_id": "m-1", "source_id": "S2"}, {"material_id": "m-1", "source_id": "S1"},
                                     {"material_id": 5, "source_id": "S1"}, {"material_id": "", "source_id": "S9"}, "x"]', 'llm')
       <> 'e92d165712be2988fe947063b182da8760ab971a'
     or meldy_private.oral_rubric_key('fp:v1:x', '{}', '[]', null) <> 'bf62da19654469de368d28d63a2121c2c8972867'
     or meldy_private.oral_rubric_key('', '{}', '[{"material_id": "Лекция", "source_id": "S1"}]', 'manual')
       <> '66edd22e267030e6045b2ea026aed5ab4f64e3ff' then
    raise exception 'FAILED: oral_rubric_key differs from oral.rubric_key';
  end if;
  if meldy_private.oral_clean_points('[{"id": "p1", "title": "A"}, {"id": "p1", "title": "B"}, {"id": "p2", "title": " \u3000"},
                                       {"id": "p2\n", "title": "C", "essential": true, "source_ids": ["M1:S1", 3], "source_quote": 7}, "x"]')
     <> '[{"id": "p1", "title": "A", "essential": false, "source_quote": "", "source_ids": []},
          {"id": "p2\n", "title": "C", "essential": true, "source_quote": "", "source_ids": ["M1:S1"]}]'::jsonb then
    raise exception 'FAILED: oral_clean_points differs from _clean_points';
  end if;
  if meldy_private.oral_clean_materials('[{"key": "M1", "material_id": "x", "title": 2}, {"material_id": null}, 7]')
     <> '[{"key": "M1", "material_id": "x", "title": "2"}, {"key": "", "material_id": "", "title": ""}]'::jsonb then
    raise exception 'FAILED: oral_clean_materials differs from _clean_materials';
  end if;
end
$t$;

-- 3. A small fixture: U owns «Осенняя сессия» with Экономика (oral exam EU: four questions); M joined and bound the copy
--    EM; O is a stranger whose rows share U's hashes. Links: U 70101, M 70102; 70103 linked once and unlinked.
do $t$
declare
  u uuid := 'e1100000-0000-4000-8000-000000000001';
  m uuid := 'e1100000-0000-4000-8000-000000000002';
  o uuid := 'e1100000-0000-4000-8000-000000000003';
  c uuid := 'e1200000-0000-4000-8000-000000000001';
  s1 uuid := 'e1300000-0000-4000-8000-000000000001';
  s2 uuid := 'e1300000-0000-4000-8000-000000000002';
  eu uuid := 'e1400000-0000-4000-8000-000000000001';
  em uuid := 'e1400000-0000-4000-8000-000000000002';
  eo uuid := 'e1400000-0000-4000-8000-000000000003';
  eb uuid := 'e1400000-0000-4000-8000-000000000004';
  lu uuid := 'e1500000-0000-4000-8000-000000000001';
  lm uuid := 'e1500000-0000-4000-8000-000000000002';
  lo uuid := 'e1500000-0000-4000-8000-000000000003';
  q record;
  v_key text;
begin
  insert into auth.users (id) values (u), (m), (o);
  insert into public.materials (id, user_id, title) values (lu, u, 'Лекция'), (lm, m, 'Лекция (копия)'), (lo, o, 'Чужая');
  insert into public.exams (id, user_id, title, exam_date) values (eu, u, 'Экономика', '2026-12-23'), (em, m, 'Экономика', null),
    (eo, o, 'Чужой', null), (eb, u, 'Большой', null);
  insert into public.exam_materials (exam_id, material_id, user_id) values (eu, lu, u), (em, lm, m);
  insert into public.exam_questions (id, exam_id, user_id, position, text, coverage, coverage_method, evidence) values
    ('e1600000-0000-4000-8000-000000000001', eu, u, 1, 'Рыночное равновесие', 'full', 'llm', jsonb_build_array(jsonb_build_object('material_id', lu, 'source_id', 'S1'))),
    ('e1600000-0000-4000-8000-000000000002', eu, u, 2, 'Закон спроса', 'full', 'llm', '[]'),
    ('e1600000-0000-4000-8000-000000000003', eu, u, 3, 'Эластичность', 'partial', 'llm', '[]'),
    ('e1600000-0000-4000-8000-000000000004', eu, u, 4, 'Теория игр', null, null, '[]'),
    ('e1600000-0000-4000-8000-000000000011', em, m, 1, 'Рыночное равновесие', 'full', 'llm', '[]'),
    ('e1600000-0000-4000-8000-000000000021', eo, o, 1, 'Рыночное равновесие', 'full', 'llm', '[]');
  insert into public.exam_questions (exam_id, user_id, position, text) select eb, u, least(g, 300), 'Вопрос № ' || g from generate_series(1, 301) g;
  -- Rubrics by each question's key (U's rows; O's row under U's key must stay invisible; a version 2 row is ignored).
  for q in select x.*, (select coalesce(array_agg(em2.material_id::text order by em2.added_at, em2.material_id), '{}')
                          from public.exam_materials em2 where em2.exam_id = x.exam_id and em2.user_id = x.user_id) as lectures
             from public.exam_questions x where x.exam_id in (eu, em) loop
    v_key := meldy_private.oral_rubric_key(q.materials_fingerprint, q.lectures, q.evidence, q.coverage_method);
    if q.position = 1 or q.exam_id = em then
      insert into public.oral_rubrics (user_id, question_hash, source_key, material_id, question, rubric, created_at)
      values (q.user_id, q.question_hash, v_key, case when q.user_id = u then lu else lm end, q.text,
              jsonb_build_object('coverage', 'full', 'coverage_note', '', 'materials', jsonb_build_array(jsonb_build_object('key', 'M1', 'material_id', case when q.user_id = u then lu else lm end, 'title', 'Лекция')),
                                 'points', '[{"id": "p1", "title": "Спрос равен предложению", "essential": true, "source_quote": "цитата", "source_ids": ["M1:S1"]}, {"id": "p2", "title": "Цена уравновешивает рынок", "essential": false, "source_quote": "цитата", "source_ids": []}]'::jsonb),
              '2026-12-05 10:00+00');
      if q.user_id = u then
        insert into public.oral_rubrics (user_id, question_hash, source_key, material_id, question, rubric, rubric_version)
        values (u, q.question_hash, v_key, lu, q.text, '{"coverage": "full", "points": [{"id": "p1", "title": "Версия 2"}]}', 2),
               (o, q.question_hash, v_key, lo, q.text, '{"coverage": "full", "points": [{"id": "p1", "title": "Чужой"}]}', 1);
      end if;
    elsif q.position = 3 then
      insert into public.oral_rubric_failures (user_id, question_hash, source_key) values (u, q.question_hash, v_key);
    end if;
  end loop;
  -- The journal (the trigger would put now() and today in): U's line events, self-checks, an AI check, a quiz answer;
  -- O's events with U's hashes; M's line event.
  perform set_config('session_replication_role', 'replica', true);
  insert into public.learning_events (id, user_id, created_at, local_date, kind, item_key, correct, confidence, score, source_ids,
                                      session_id, client_event_id, payload)
  select ('e1700000-0000-4000-8000-0000000000' || lpad(x.n::text, 2, '0'))::uuid, x.usr, x.at, x.day, x.kind,
         replace(x.key0, 'H', public.meldy_question_hash(x.qtext)), x.correct, x.conf, x.score, x.ids, null, 'oral-t11-' || x.n,
         case when x.kind in ('oral_point', 'sheet_peek')
              then jsonb_build_object('question_hash', public.meldy_question_hash(x.qtext), 'point_id', 'p1',
                                      'title', 'Спрос равен предложению', 'status', 'covered')
              else '{}'::jsonb end
    from (values
      (1, u, timestamptz '2026-12-08 10:00+00', date '2026-12-08', 'oral_point', 'oral:r:p1', true, null::smallint, null::real, '{}'::text[], 'Рыночное равновесие'),
      (2, u, timestamptz '2026-12-09 09:00+00', date '2026-12-09', 'oral_point', 'oral:r:p1', true, null, null, '{}', 'Рыночное равновесие'),
      (3, u, timestamptz '2026-12-09 09:00+00', date '2026-12-09', 'sheet_peek', 'peek:r:p2', null, null, null, '{}', 'Рыночное равновесие'),
      (4, u, timestamptz '2026-12-10 09:00+00', date '2026-12-10', 'self_rating', 'q:H', null, 3, null, '{}', 'Рыночное равновесие'),
      (5, u, timestamptz '2026-12-10 09:00+00', date '2026-12-10', 'exam_answer', 'q:H', true, null, 0.75, '{S1,NULL}', 'Рыночное равновесие'),
      (6, u, timestamptz '2026-12-10 09:00+00', date '2026-12-10', 'quiz_answer', 'q:H', true, null, null, '{}', 'Рыночное равновесие'),
      (7, u, timestamptz '2026-12-11 09:00+00', date '2026-12-11', 'self_rating', 'q:H', null, 1, null, '{}', 'Закон спроса'),
      (8, o, timestamptz '2026-12-11 09:00+00', date '2026-12-11', 'oral_point', 'oral:r:p1', true, null, null, '{}', 'Рыночное равновесие'),
      (9, o, timestamptz '2026-12-11 09:00+00', date '2026-12-11', 'self_rating', 'q:H', null, 2, null, '{}', 'Рыночное равновесие'),
      (10, m, timestamptz '2026-12-12 09:00+00', date '2026-12-12', 'oral_point', 'oral:r:p1', true, null, null, '{}', 'Рыночное равновесие')
    ) as x(n, usr, at, day, kind, key0, correct, conf, score, ids, qtext);
  perform set_config('session_replication_role', 'origin', true);
  insert into public.containers (id, owner_id, title, exam_date) values (c, u, 'Осенняя сессия', '2026-12-24');
  insert into public.container_subjects (id, container_id, owner_id, position, title, exam_id)
  values (s1, c, u, 1, 'Экономика', eu), (s2, c, u, 2, 'Большой список', eb);
  insert into public.container_members (container_id, user_id) values (c, m);
  insert into public.container_member_exams (container_id, subject_id, user_id, exam_id) values (c, s1, m, em);
  insert into bot.links (user_id, tg_user_id, chat_id) values (u, 70101, 70101), (m, 70102, 70102);
  insert into bot.links (user_id, tg_user_id, chat_id, unlinked_at) values (o, 70103, 70103, now());
end
$t$;

-- 4. oral_sheet_for: the user's own exam only; the rubric by the question's key; failures, the other rows invisible.
do $t$
declare
  u uuid := 'e1100000-0000-4000-8000-000000000001';
  m uuid := 'e1100000-0000-4000-8000-000000000002';
  s jsonb;
begin
  perform pg_temp.expect_error($q$select meldy_private.oral_sheet_for('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000003')$q$,
                               array['P0002'], 'another user''s exam');
  perform pg_temp.expect_error($q$select meldy_private.oral_sheet_for('e1100000-0000-4000-8000-000000000002', 'e1400000-0000-4000-8000-000000000001')$q$,
                               array['P0002'], 'the author''s exam read by the member');
  perform pg_temp.expect_error($q$select meldy_private.oral_sheet_for('e1100000-0000-4000-8000-000000000001', gen_random_uuid())$q$,
                               array['P0002'], 'a missing exam');
  s := meldy_private.oral_sheet_for(u, 'e1400000-0000-4000-8000-000000000001');
  if (select array_agg(k order by k) from jsonb_object_keys(s) k)
       <> array['exam_id', 'job', 'mapping_state', 'questions', 'to_write', 'units', 'unwritable']
     or s -> 'job' <> 'null'::jsonb or jsonb_array_length(s -> 'questions') <> 4
     or (select array_agg(k order by k) from jsonb_object_keys(s -> 'questions' -> 0) k)
       <> array['coverage', 'coverage_method', 'coverage_reason', 'label', 'missing_note', 'position', 'question_hash', 'question_id',
                'rebuilt', 'rubric', 'section', 'text', 'unwritable']
     or (select array_agg(k order by k) from jsonb_object_keys(s -> 'questions' -> 0 -> 'rubric') k)
       <> array['built_at', 'coverage', 'coverage_note', 'materials', 'points', 'rubric_id']
     or s -> 'questions' -> 0 -> 'rubric' -> 'points' -> 0
       <> '{"id": "p1", "title": "Спрос равен предложению", "short": "", "essential": true, "source_quote": "цитата", "source_ids": ["M1:S1"]}'
     or jsonb_array_length(s -> 'questions' -> 0 -> 'rubric' -> 'points') <> 2
     or s -> 'questions' -> 1 -> 'rubric' <> 'null'::jsonb or (s -> 'questions' -> 2 ->> 'unwritable')::boolean is not true
     or (s ->> 'to_write')::int <> 1 or (s ->> 'units')::int <> 1 or (s ->> 'unwritable')::int <> 1
     or s -> 'questions' -> 3 ->> 'coverage' is not null then
    raise exception 'FAILED: oral_sheet_for %', s;
  end if;
  s := meldy_private.oral_sheet_for(m, 'e1400000-0000-4000-8000-000000000002');
  if jsonb_array_length(s -> 'questions') <> 1 or s -> 'questions' -> 0 -> 'rubric' -> 'materials' -> 0 ->> 'material_id' <> 'e1500000-0000-4000-8000-000000000002' then
    raise exception 'FAILED: the member''s copy %', s;
  end if;
end
$t$;

-- 5. oral_events_for: p_user's rows of the two reads only, the hashes as the TS reads take them, oldest first.
do $t$
declare
  u uuid := 'e1100000-0000-4000-8000-000000000001';
  h1 text := public.meldy_question_hash('Рыночное равновесие');
  h2 text := public.meldy_question_hash('Закон спроса');
  ids text[];
begin
  select array_agg(right(e.id::text, 2) order by e.created_at, e.id) into ids
    from meldy_private.oral_events_for(u, array[' ' || upper(h1) || E'\u3000', h2, 'nothex', null, h1]) e;
  if ids <> array['01', '02', '03', '04', '05', '07'] then
    raise exception 'FAILED: oral_events_for %', ids;
  end if;
  if exists (select 1 from meldy_private.oral_events_for(u, array[left(h1, 31), h1 || 'a', '']) e)
     or exists (select 1 from meldy_private.oral_events_for(u, '{}') e) then
    raise exception 'FAILED: oral_events_for reads invalid hashes';
  end if;
  -- The two lists as the site's reads return them: score as real prints it, source_ids without nulls.
  if (select e -> 'score' from jsonb_array_elements(meldy_private.oral_events_json(u, array[h1], array[h1]) -> 'meta_events') e
       where e ->> 'kind' = 'exam_answer') <> '0.75'
     or (select e -> 'source_ids' from jsonb_array_elements(meldy_private.oral_events_json(u, array[h1], array[h1]) -> 'meta_events') e
          where e ->> 'kind' = 'exam_answer') <> '["S1"]'
     or (select array_agg(right(e ->> 'id', 2) order by ord)
           from jsonb_array_elements(meldy_private.oral_events_json(u, array[h1], array[h2]) -> 'line_events') with ordinality x(e, ord))
        <> array['01', '02', '03']
     or (select array_agg(right(e ->> 'id', 2) order by ord)
           from jsonb_array_elements(meldy_private.oral_events_json(u, array[h1], array[h2]) -> 'meta_events') with ordinality x(e, ord))
        <> array['07']
     or meldy_private.oral_events_json(u, '{}', null) <> '{"line_events": [], "meta_events": []}' then
    raise exception 'FAILED: oral_events_json';
  end if;
end
$t$;

-- 6. bot_oral_inputs (the service role): parts of the user's exams, the member's bound copy, the cap, not linked.
do $t$
declare
  r jsonb;
  p jsonb;
  v_seen timestamptz;
begin
  perform pg_temp.as_role('service_role');
  if public.bot_oral_inputs(79999) <> '{"linked": false}' or public.bot_oral_inputs(70103) <> '{"linked": false}' then
    raise exception 'FAILED: not linked';
  end if;
  perform pg_temp.as_role('postgres');
  select last_seen_at into v_seen from bot.links where tg_user_id = 70101 and unlinked_at is null;
  perform pg_temp.as_role('service_role');
  r := public.bot_oral_inputs(70101);
  perform pg_temp.as_role('postgres');
  if r ->> 'linked' <> 'true' or (r ->> 'cap')::int <> 300 or jsonb_array_length(r -> 'parts') <> 2 then
    raise exception 'FAILED: the author''s parts %', left(r::text, 300);
  end if;
  p := r -> 'parts' -> 0;
  if (select array_agg(k order by k) from jsonb_object_keys(p) k)
       <> array['capped', 'container_id', 'exam_date', 'exam_id', 'line_events', 'meta_events', 'questions', 'sheet', 'subject_id']
     or p ->> 'exam_id' <> 'e1400000-0000-4000-8000-000000000001' or p ->> 'exam_date' <> '2026-12-23'
     or p ->> 'subject_id' <> 'e1300000-0000-4000-8000-000000000001' or (p ->> 'capped')::boolean or (p ->> 'questions')::int <> 4
     or p -> 'sheet' <> meldy_private.oral_sheet_for('e1100000-0000-4000-8000-000000000001', 'e1400000-0000-4000-8000-000000000001')
     -- Line events of the written question 1 (its own two namings and the peek), self-checks and AI checks of the planned
     -- questions (1 written, 2 to write; 3 cannot be written, 4 waits for lectures): no quiz answer, nothing of O's.
     or (select array_agg(right(e ->> 'id', 2) order by ord) from jsonb_array_elements(p -> 'line_events') with ordinality x(e, ord))
        <> array['01', '02', '03']
     or (select array_agg(right(e ->> 'id', 2) order by ord) from jsonb_array_elements(p -> 'meta_events') with ordinality x(e, ord))
        <> array['04', '05', '07'] then
    raise exception 'FAILED: the author''s first part %', left(p::text, 400);
  end if;
  p := r -> 'parts' -> 1;
  if p ->> 'exam_id' <> 'e1400000-0000-4000-8000-000000000004' or not (p ->> 'capped')::boolean or (p ->> 'questions')::int <> 301
     or p -> 'sheet' <> 'null'::jsonb or p -> 'line_events' <> '[]' or p -> 'meta_events' <> '[]' then
    raise exception 'FAILED: a part over the cap %', left(p::text, 300);
  end if;
  if (select last_seen_at from bot.links where tg_user_id = 70101 and unlinked_at is null) is distinct from v_seen then
    raise exception 'FAILED: bot_oral_inputs marked the user as seen';
  end if;
  perform pg_temp.as_role('service_role');
  r := public.bot_oral_inputs(70102);
  perform pg_temp.as_role('postgres');
  if jsonb_array_length(r -> 'parts') <> 1 or r -> 'parts' -> 0 ->> 'exam_id' <> 'e1400000-0000-4000-8000-000000000002'
     or r -> 'parts' -> 0 ->> 'subject_id' <> 'e1300000-0000-4000-8000-000000000001' or r -> 'parts' -> 0 -> 'exam_date' <> 'null'
     or jsonb_array_length(r -> 'parts' -> 0 -> 'line_events') <> 1 then
    raise exception 'FAILED: the member''s bound copy %', left(r::text, 300);
  end if;
  -- A member who left reads no parts of that exam (role_in); the author's oral exam removed from the subject: none either.
  update public.container_members set left_at = now() where user_id = 'e1100000-0000-4000-8000-000000000002';
  update public.container_subjects set exam_id = null where id = 'e1300000-0000-4000-8000-000000000001';
  perform pg_temp.as_role('service_role');
  if public.bot_oral_inputs(70102) -> 'parts' <> '[]' or jsonb_array_length(public.bot_oral_inputs(70101) -> 'parts') <> 1 then
    raise exception 'FAILED: parts after leaving / without the oral part';
  end if;
  perform pg_temp.as_role('postgres');
end
$t$;

do $t$ begin raise notice 'ORAL PLAN INPUTS CHECKS PASSED'; end $t$;
rollback;
