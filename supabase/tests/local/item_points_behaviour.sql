-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261107090700_item_points.sql on the
-- scratch database of item_points_run.sh. One transaction, rolled back. A = aaaa…1 (the author); B, C, D, E, F take
-- the quizzes. Covers: container_items_add takes points (absent or null — 1) and refuses 0, 101, 2.5, "3", true with
-- 22023 «item 1: points», writing nothing; container_item_update takes points alone (rev, key_source, flags and the
-- key-change history untouched, the result says the points as stored), with a key change (rev raised, the AI's mark gone
-- as before), refuses 0, 101, 2.5, "5", null, true with 22023 'points' and changes nothing, and is the owner's only; a
-- quiz of subjects keeps its questions' points with each attempt (item_points beside item_ids), so the result's score,
-- max_score, percent and pass mark, the preview's results, the author's quiz_results and quiz_list and the Telegram
-- score weigh them (8.5 of 10 · 85 % · passed at 80, where the old count said 63 %); a later edit of a question's points
-- changes no finished attempt and weighs the next start; an attempt without item_points (started before the migration)
-- keeps its unweighted score; a quiz whose questions all weigh 1 stores item_points null, as before; a quiz «как в
-- студии» weighs its blocks' points, not the questions' own. A failure raises; success prints ITEM POINTS BEHAVIOUR
-- PASSED.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.ok(p boolean, p_what text) returns void language plpgsql as $fn$
begin
  if p is distinct from true then raise exception 'FAILED: %', p_what; end if;
end;
$fn$;
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_detail text, p_what text)
returns void language plpgsql as $fn$
declare
  v_detail text;
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_state;
exception
  when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if sqlstate = 'PGRST' and p_state = 'P0002' and (sqlerrm::jsonb ->> 'code') = 'P0002' then return; end if;
    if sqlstate is distinct from p_state or (p_detail is not null and v_detail is distinct from p_detail) then
      raise exception 'FAILED: % — SQLSTATE % (%, %), expected % %', p_what, sqlstate, sqlerrm, v_detail, p_state, p_detail;
    end if;
end;
$fn$;
create temp table ctx (k text primary key, v text);
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = p_k
$fn$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into pg_temp.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
-- a question's id by its ref (kept while the author reads them: others may not read the exam)
create or replace function pg_temp.id(p_ref text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = 'id:' || p_ref
$fn$;
-- as a signed-in user ('' = anon)
create or replace function pg_temp.as_user(p_user text) returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', p_user, true);
  perform set_config('role', case when p_user = '' then 'anon' else 'authenticated' end, true);
end;
$fn$;
-- the row as postgres sees it: points, rev, key_source, flags
create or replace function pg_temp.row(p_ref text) returns text language sql stable security definer as $fn$
  select i.points || ' ' || i.rev || ' ' || i.key_source || ' ' || i.flags::text
    from public.test_items i where i.id = (select v from pg_temp.ctx where k = 'id:' || p_ref)::uuid
$fn$;
-- an attempt's points as stored, and the points of its questions now, in the attempt's order
create or replace function pg_temp.stored(p_attempt text) returns text language sql stable security definer as $fn$
  select coalesce(a.item_points::text, 'null') from public.quiz_attempts a where a.id = p_attempt::uuid
$fn$;
create or replace function pg_temp.live(p_attempt text) returns text language sql stable security definer as $fn$
  select pg_catalog.array_agg(i.points order by x.ord)::text
    from public.quiz_attempts a
   cross join lateral pg_catalog.unnest(a.item_ids) with ordinality as x(id, ord)
    join public.test_items i on i.id = x.id
   where a.id = p_attempt::uuid
$fn$;
grant all on ctx to authenticated, anon;
grant execute on all functions in schema pg_temp to anon, authenticated;
insert into auth.users (id) values
  ('aaaaaaaa-0000-0000-0000-000000000001'), ('bbbbbbbb-0000-0000-0000-000000000002'), ('cccccccc-0000-0000-0000-000000000003'),
  ('dddddddd-0000-0000-0000-000000000004'), ('eeeeeeee-0000-0000-0000-000000000005'), ('ffffffff-0000-0000-0000-000000000006')
on conflict do nothing;

-- 1. A's exam: four questions of «Вопросы» (one with points from the start), one of «Прочее» with the AI's key.
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('s', (public.container_create('Баллы', null, '[{"title":"Вопросы"},{"title":"Прочее"}]') -> 'subjects' -> 0 ->> 'id'));
select pg_temp.put('x', (select container_id::text from public.container_subjects where id = pg_temp.c('s')::uuid));
select pg_temp.put('s2', (select id::text from public.container_subjects where container_id = pg_temp.c('x')::uuid and title = 'Прочее'));
do $do$
begin
  -- refused points: the whole call writes nothing
  perform pg_temp.expect_error(format('select public.container_items_add(%L, %L)', pg_temp.c('s'), jsonb_build_array(
    jsonb_build_object('ref', 'bad:1', 'kind', 'single', 'stem', 'Плохие баллы', 'options', jsonb_build_array('а', 'б'),
                       'correct', jsonb_build_array(0), 'points', v.p))), '22023', 'item 1: points', 'container_items_add points ' || v.p::text)
    from (values ('0'::jsonb), ('101'), ('2.5'), ('"3"'), ('true'), ('-1')) v(p);
  perform pg_temp.ok((select count(*) from public.test_items where container_id = pg_temp.c('x')::uuid) = 0, 'a refused call writes nothing');
end
$do$;
select public.container_items_add(pg_temp.c('s')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'q:1', 'kind', 'single', 'stem', 'Один', 'options', jsonb_build_array('да', 'нет', 'может'),
                     'correct', jsonb_build_array(0), 'points', 3),
  jsonb_build_object('ref', 'q:2', 'kind', 'multiple', 'stem', 'Несколько', 'options', jsonb_build_array('a', 'b', 'c', 'd'),
                     'correct', jsonb_build_array(0, 2), 'partial', true),
  jsonb_build_object('ref', 'q:3', 'kind', 'short', 'stem', 'Столица Франции', 'answers', jsonb_build_array('Париж'), 'points', null),
  jsonb_build_object('ref', 'q:4', 'kind', 'single', 'stem', 'Четыре', 'options', jsonb_build_array('x', 'y'),
                     'correct', jsonb_build_array(1), 'points', 1)));
select public.container_items_add(pg_temp.c('s2')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'q:5', 'kind', 'single', 'stem', 'Пять', 'options', jsonb_build_array('p', 'q'),
                     'correct', jsonb_build_array(0), 'key_source', 'manual', 'flags', jsonb_build_array('ai_key'), 'points', 100)));
select pg_temp.put('id:' || i.import_ref, i.id::text) from public.test_items i where i.container_id = pg_temp.c('x')::uuid;
reset role;
select pg_temp.ok(pg_temp.row('q:1') = '3 1 manual {}' and pg_temp.row('q:2') = '1 1 manual {}' and pg_temp.row('q:3') = '1 1 manual {}'
                  and pg_temp.row('q:4') = '1 1 manual {}' and pg_temp.row('q:5') = '100 1 manual {ai_key}',
                  'container_items_add writes the points: ' || concat_ws(' | ', pg_temp.row('q:1'), pg_temp.row('q:2'), pg_temp.row('q:3'),
                                                                        pg_temp.row('q:4'), pg_temp.row('q:5')));

-- 2. container_item_update: points alone are not the key.
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
do $do$
declare
  r jsonb;
begin
  r := public.container_item_update(pg_temp.id('q:4')::uuid, '{"points": 5}');
  perform pg_temp.ok((r ->> 'points')::integer = 5 and not (r ->> 'rev_changed')::boolean and (r ->> 'rev')::integer = 1,
                     'points alone: ' || r::text);
  r := public.container_item_update(pg_temp.id('q:5')::uuid, '{"points": 7}');
  perform pg_temp.ok((r ->> 'points')::integer = 7 and (r -> 'ai_key') = 'true'::jsonb and not (r ->> 'rev_changed')::boolean,
                     'points keep the AI''s mark: ' || r::text);
  perform pg_temp.expect_error(format('select public.container_item_update(%L, %L)', pg_temp.id('q:4'), jsonb_build_object('points', v.p)),
                               '22023', 'points', 'container_item_update points ' || v.p::text)
    from (values ('0'::jsonb), ('101'), ('2.5'), ('"5"'), ('null'), ('true'), ('[5]')) v(p);
  -- with a key change: rev moves for the key, the points are written, the AI's mark goes as before
  r := public.container_item_update(pg_temp.id('q:5')::uuid, '{"correct": [1], "points": 2}');
  perform pg_temp.ok((r ->> 'points')::integer = 2 and (r ->> 'rev_changed')::boolean and (r -> 'ai_key') = 'false'::jsonb,
                     'points with a key change: ' || r::text);
end
$do$;
reset role;
select pg_temp.ok(pg_temp.row('q:4') = '5 1 manual {}', 'q:4 after the refusals: ' || pg_temp.row('q:4'));
select pg_temp.ok(pg_temp.row('q:5') = '2 2 manual {}', 'q:5 after the key change: ' || pg_temp.row('q:5'));
select pg_temp.ok((select count(*) from public.test_item_key_changes where item_id = pg_temp.id('q:4')::uuid) = 0,
                  'points alone write no key change');
select pg_temp.ok((select count(*) from public.test_item_key_changes where item_id = pg_temp.id('q:5')::uuid) = 1,
                  'the key change is in the history once');
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.expect_error(format('select public.container_item_update(%L, %L)', pg_temp.id('q:4'), '{"points": 9}'),
                            'P0002', null, 'someone else''s question');
select pg_temp.expect_error(format('select public.container_items_add(%L, %L)', pg_temp.c('s'),
                            '[{"ref": "b:1", "kind": "single", "stem": "Чужой", "options": ["а", "б"], "correct": [0], "points": 2}]'),
                            'P0002', null, 'someone else''s subject');
reset role;
select pg_temp.ok(pg_temp.row('q:4') = '5 1 manual {}', 'q:4 untouched by B: ' || pg_temp.row('q:4'));

-- 3. A quiz of «Вопросы» (3 + 1 + 1 + 5 = 10 points), pass mark 80 %; an exam whose questions all weigh 1 and its quiz.
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('qobj', public.quiz_create(pg_temp.c('x')::uuid, jsonb_build_object(
  'title', 'Контрольная с баллами', 'subject_ids', jsonb_build_array(pg_temp.c('s')), 'item_count', 4, 'shuffle_items', false,
  'shuffle_options', false, 'same_set', true, 'attempts', null, 'pass_percent', 80))::text);
select pg_temp.put('q', pg_temp.c('qobj')::jsonb ->> 'id'), pg_temp.put('code', pg_temp.c('qobj')::jsonb ->> 'code');
select pg_temp.put('s3', (public.container_create('Без баллов', null, '[{"title":"Всё по одному"}]') -> 'subjects' -> 0 ->> 'id'));
select pg_temp.put('y', (select container_id::text from public.container_subjects where id = pg_temp.c('s3')::uuid));
select public.container_items_add(pg_temp.c('s3')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'o:1', 'kind', 'single', 'stem', 'Раз', 'options', jsonb_build_array('1', '2'), 'correct', jsonb_build_array(0)),
  jsonb_build_object('ref', 'o:2', 'kind', 'single', 'stem', 'Два', 'options', jsonb_build_array('1', '2'), 'correct', jsonb_build_array(1))));
select pg_temp.put('oobj', public.quiz_create(pg_temp.c('y')::uuid, jsonb_build_object(
  'title', 'Контрольная без баллов', 'subject_ids', jsonb_build_array(pg_temp.c('s3')), 'item_count', 2, 'same_set', true))::text);
select pg_temp.put('ocode', pg_temp.c('oobj')::jsonb ->> 'code');

-- 4. B: right (3), a half of the multiple (0.5 of 1), wrong (0 of 1), right (5): 8.5 of 10.
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.put('b1', public.quiz_start(pg_temp.c('code'), 'Борис Б') ->> 'attempt_id');
select pg_temp.ok(pg_temp.stored(pg_temp.c('b1')) = pg_temp.live(pg_temp.c('b1'))
                  and (select sum(p) from unnest(pg_temp.stored(pg_temp.c('b1'))::smallint[]) p) = 10,
                  'the attempt keeps its questions'' points: ' || pg_temp.stored(pg_temp.c('b1')) || ' / ' || pg_temp.live(pg_temp.c('b1')));
select public.quiz_answer(pg_temp.c('b1')::uuid, jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.id('q:1'), 'chosen', jsonb_build_array(0)),
  jsonb_build_object('item_id', pg_temp.id('q:2'), 'chosen', jsonb_build_array(0)),
  jsonb_build_object('item_id', pg_temp.id('q:3'), 'text', 'Лондон'),
  jsonb_build_object('item_id', pg_temp.id('q:4'), 'chosen', jsonb_build_array(1))));
do $do$
declare
  r jsonb := public.quiz_finish(pg_temp.c('b1')::uuid);
begin
  perform pg_temp.ok((r ->> 'correct')::integer = 2 and (r ->> 'total')::integer = 4 and (r ->> 'score')::numeric = 8.5
                     and (r ->> 'max_score')::integer = 10 and (r ->> 'percent')::integer = 85 and (r ->> 'passed')::boolean,
                     'the result weighs the points (the old count: 63 %, not passed): ' || r::text);
  perform pg_temp.ok(public.quiz_result(pg_temp.c('b1')::uuid) = r, 'the result read again');
  r := public.quiz_preview(pg_temp.c('code'));
  perform pg_temp.ok((r -> 'me' -> 'results' -> 0 ->> 'score')::numeric = 8.5 and (r -> 'me' -> 'results' -> 0 ->> 'max_score')::integer = 10,
                     'the preview''s results: ' || (r -> 'me' -> 'results')::text);
end
$do$;

-- 5. The author's numbers.
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
do $do$
declare
  r jsonb := public.quiz_results(pg_temp.c('q')::uuid);
  a jsonb;
begin
  select x into a from jsonb_array_elements(r -> 'attempts') x where x ->> 'id' = pg_temp.c('b1');
  perform pg_temp.ok((a ->> 'score')::numeric = 8.5 and (a ->> 'max_score')::integer = 10 and (a ->> 'correct')::integer = 2,
                     'quiz_results weighs the points: ' || coalesce(a::text, 'no row'));
  select x into a from jsonb_array_elements(public.quiz_list(pg_temp.c('x')::uuid)) x where x ->> 'id' = pg_temp.c('q');
  perform pg_temp.ok((a ->> 'avg_percent')::numeric = 85.0, 'quiz_list''s average: ' || coalesce(a ->> 'avg_percent', 'null'));
end
$do$;
reset role;
select pg_temp.ok((select s.score = 8.5 and s.max_score = 10 from meldy_private.quiz_score(pg_temp.c('b1')::uuid) s),
                  'the Telegram score weighs the points');

-- 6. A later edit: B's finished attempt keeps its points; C's new attempt weighs the new ones (q:4 back to 1: 6 points).
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select public.container_item_update(pg_temp.id('q:4')::uuid, '{"points": 1}');
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
do $do$
declare
  r jsonb := public.quiz_result(pg_temp.c('b1')::uuid);
begin
  perform pg_temp.ok((r ->> 'score')::numeric = 8.5 and (r ->> 'max_score')::integer = 10 and (r ->> 'percent')::integer = 85,
                     'a finished attempt keeps its points: ' || r::text);
end
$do$;
select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.put('c1', public.quiz_start(pg_temp.c('code'), 'Вера В') ->> 'attempt_id');
select pg_temp.ok(pg_temp.stored(pg_temp.c('c1')) = pg_temp.live(pg_temp.c('c1'))
                  and (select sum(p) from unnest(pg_temp.stored(pg_temp.c('c1'))::smallint[]) p) = 6,
                  'the next start weighs the edit: ' || pg_temp.stored(pg_temp.c('c1')));
select public.quiz_answer(pg_temp.c('c1')::uuid, jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.id('q:1'), 'chosen', jsonb_build_array(0)),
  jsonb_build_object('item_id', pg_temp.id('q:2'), 'chosen', jsonb_build_array(0, 2)),
  jsonb_build_object('item_id', pg_temp.id('q:3'), 'text', 'париж'),
  jsonb_build_object('item_id', pg_temp.id('q:4'), 'chosen', jsonb_build_array(0))));
do $do$
declare
  r jsonb := public.quiz_finish(pg_temp.c('c1')::uuid);
begin
  perform pg_temp.ok((r ->> 'score')::numeric = 5 and (r ->> 'max_score')::integer = 6 and (r ->> 'percent')::integer = 83
                     and (r ->> 'passed')::boolean, 'C: 5 of 6: ' || r::text);
end
$do$;

-- 7. An attempt started before the migration (item_points null) keeps its unweighted score.
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.put('d1', public.quiz_start(pg_temp.c('code'), 'Дмитрий Д') ->> 'attempt_id');
reset role;
update public.quiz_attempts set item_points = null where id = pg_temp.c('d1')::uuid;
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select public.quiz_answer(pg_temp.c('d1')::uuid, jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.id('q:1'), 'chosen', jsonb_build_array(0))));
do $do$
declare
  r jsonb := public.quiz_finish(pg_temp.c('d1')::uuid);
begin
  perform pg_temp.ok((r ->> 'score')::numeric = 1 and (r ->> 'max_score')::integer = 4 and (r ->> 'percent')::integer = 25
                     and not (r ->> 'passed')::boolean, 'an old attempt counts every question as 1: ' || r::text);
end
$do$;

-- 8. A quiz whose questions all weigh 1: item_points null, as before this file.
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.put('e1', public.quiz_start(pg_temp.c('ocode'), 'Ещё Е') ->> 'attempt_id');
reset role;
select pg_temp.ok(pg_temp.stored(pg_temp.c('e1')) = 'null', 'all of weight 1: ' || pg_temp.stored(pg_temp.c('e1')));

-- 9. A quiz «как в студии»: the blocks' points (q:1 — 2, q:4 — 1), not the questions' own (3 and 1).
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select public.test_doc_save(pg_temp.c('x')::uuid, jsonb_build_object(
  'v', 1, 'title', 'Страница с баллами',
  'theme', '{"accent": "blue", "background": {"kind": "plain"}, "font": "onest", "radius": "soft", "density": "airy", "answers": "list", "buttons": "pill"}'::jsonb,
  'layout', 'one_by_one',
  'blocks', jsonb_build_array(
    jsonb_build_object('type', 'heading', 'id', 'heading001', 'text', 'Баллы', 'size', 'l'),
    jsonb_build_object('type', 'question', 'id', 'question01', 'item_id', pg_temp.id('q:1'), 'points', 2, 'required', false),
    jsonb_build_object('type', 'question', 'id', 'question02', 'item_id', pg_temp.id('q:4'), 'points', 1, 'required', false)),
  'results', '{"bands": [], "cta": null}'::jsonb), 0);
select pg_temp.put('dobj', public.quiz_create(pg_temp.c('x')::uuid, jsonb_build_object('title', 'Как в студии', 'design', true))::text);
select pg_temp.put('dcode', pg_temp.c('dobj')::jsonb ->> 'code');
select pg_temp.as_user('ffffffff-0000-0000-0000-000000000006');
select pg_temp.put('f1', public.quiz_start(pg_temp.c('dcode'), 'Фёдор Ф') ->> 'attempt_id');
reset role;
select pg_temp.ok(pg_temp.stored(pg_temp.c('f1')) = '{2,1}' and pg_temp.live(pg_temp.c('f1')) = '{3,1}',
                  'a design quiz weighs its blocks: ' || pg_temp.stored(pg_temp.c('f1')) || ' (the questions: ' || pg_temp.live(pg_temp.c('f1')) || ')');

select 'ITEM POINTS BEHAVIOUR PASSED';
rollback;
