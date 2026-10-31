-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261101090100_question_kinds_grading.sql
-- (release 48, part 2; docs/kinds/CONTRACT.md §2) on the scratch database of question_kinds_run.sh. One transaction,
-- rolled back. A = author aaaa…1. psql variable :grades holds contracts/kinds/grade_vectors.json. Covers: grade_item
-- against every shared case; the answer core with every new kind (saved, the verdict, the rule's state, what the log
-- keeps, the reply with the kind's key), essay → no_key, a broken answer → invalid, a partial-credit answer counts as a
-- miss in the rule, the old kinds' reply key for key as before; «Как на экзамене» counts an empty cloze as unanswered.
-- A failure raises; success prints QUESTION KINDS GRADING BEHAVIOUR PASSED.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.ok(p boolean, p_what text) returns void language plpgsql as $fn$
begin
  if p is distinct from true then raise exception 'FAILED: %', p_what; end if;
end;
$fn$;
create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated;
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = p_k
$fn$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into pg_temp.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;

-- 1. grade_item: every shared case.
select pg_temp.ok((c ->> 'valid')::boolean = g.o_valid
                  and (not g.o_valid or ((c ->> 'correct')::boolean = g.o_correct and c ->> 'result' = g.o_result
                                         and (c ->> 'credit')::numeric = g.o_credit)),
                  format('grade case %s: %s %s %s %s', c ->> 'name', g.o_valid, g.o_correct, g.o_result, g.o_credit))
  from jsonb_array_elements((:'grades')::jsonb -> 'cases') c,
       lateral meldy_private.grade_item(jsonb_populate_record(null::public.test_items,
                 jsonb_build_object('kind', c -> 'item' ->> 'kind', 'options', coalesce(c -> 'item' -> 'options', '[]'::jsonb),
                                    'correct', coalesce(c -> 'item' -> 'correct', '[]'::jsonb),
                                    'answers', coalesce(c -> 'item' -> 'answers', '[]'::jsonb),
                                    'tolerance', c -> 'item' -> 'tolerance', 'unit', c -> 'item' -> 'unit',
                                    'partial', coalesce(c -> 'item' -> 'partial', 'false'::jsonb))),
                 c -> 'answer') g;
select pg_temp.ok((select count(*) from jsonb_array_elements((:'grades')::jsonb -> 'cases')) >= 50, 'grade cases read');
-- the old kinds give grade_answer's six columns exactly
select pg_temp.ok((select (g.o_valid, g.o_correct, g.o_result, g.o_chosen, g.o_text, g.o_order)
                          is not distinct from (o.o_valid, o.o_correct, o.o_result, o.o_chosen, o.o_text, o.o_order)
                     from meldy_private.grade_item(jsonb_populate_record(null::public.test_items,
                            '{"kind":"multiple","options":["a","b","c"],"correct":[0,2],"answers":[],"partial":false}'),
                            '{"chosen":[2,0],"shown_order":[2,1,0]}') g,
                          meldy_private.grade_answer('multiple', 3, '{0,2}', '{}', '{"chosen":[2,0],"shown_order":[2,1,0]}') o),
                  'old kinds = grade_answer');

-- 2. The answer core with every kind.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select pg_temp.put('s', (public.container_create('Типы в занятии', null, '[{"title":"Вопросы"}]') -> 'subjects' -> 0 ->> 'id'));
select public.container_items_add(pg_temp.c('s')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'g:1', 'kind', 'number', 'stem', 'g', 'answers', jsonb_build_array('9.8'), 'tolerance', 0.1, 'unit', 'м/с²'),
  jsonb_build_object('ref', 'g:2', 'kind', 'order', 'stem', 'По порядку', 'options', jsonb_build_array('Один', 'Два', 'Три')),
  jsonb_build_object('ref', 'g:3', 'kind', 'match', 'stem', 'Столицы', 'options', jsonb_build_array('Франция', 'Германия'),
                     'answers', jsonb_build_array('Париж', 'Берлин', 'Рим'), 'partial', true),
  jsonb_build_object('ref', 'g:4', 'kind', 'cloze', 'stem', '___ — столица, основана в ___ году', 'answers', jsonb_build_array('Москва', '1147')),
  jsonb_build_object('ref', 'g:5', 'kind', 'essay', 'stem', 'Эссе'),
  jsonb_build_object('ref', 'g:6', 'kind', 'single', 'stem', 'Один', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0)),
  jsonb_build_object('ref', 'g:7', 'kind', 'multiple', 'stem', 'Несколько', 'options', jsonb_build_array('a', 'b', 'c'),
                     'correct', jsonb_build_array(0, 1), 'partial', true)));
create temp view g_rows as select i.import_ref as ref, i.* from public.test_items i where i.subject_id = pg_temp.c('s')::uuid;
grant select on g_rows to authenticated;
create or replace function pg_temp.id(p_ref text) returns uuid language sql stable as $fn$
  select id from g_rows where ref = p_ref
$fn$;
select pg_temp.put('r', public.record_test_answers(jsonb_build_array(
  jsonb_build_object('client_event_id', 'kinds-ev-01', 'item_id', pg_temp.id('g:1'), 'text', '9,75 м/с²', 'local_date', '2026-11-01'),
  jsonb_build_object('client_event_id', 'kinds-ev-02', 'item_id', pg_temp.id('g:2'), 'chosen', jsonb_build_array(1, 0, 2),
                     'shown_order', jsonb_build_array(2, 1, 0), 'local_date', '2026-11-01'),
  jsonb_build_object('client_event_id', 'kinds-ev-03', 'item_id', pg_temp.id('g:3'), 'chosen', jsonb_build_array(0, 1), 'local_date', '2026-11-01'),
  jsonb_build_object('client_event_id', 'kinds-ev-04', 'item_id', pg_temp.id('g:4'), 'texts', jsonb_build_array(E'мос\nква', '1147'), 'local_date', '2026-11-01'),
  jsonb_build_object('client_event_id', 'kinds-ev-05', 'item_id', pg_temp.id('g:5'), 'text', 'Ответ', 'local_date', '2026-11-01'),
  jsonb_build_object('client_event_id', 'kinds-ev-06', 'item_id', pg_temp.id('g:6'), 'chosen', 0, 'local_date', '2026-11-01'),
  jsonb_build_object('client_event_id', 'kinds-ev-07', 'item_id', pg_temp.id('g:7'), 'chosen', jsonb_build_array(0), 'local_date', '2026-11-01'),
  jsonb_build_object('client_event_id', 'kinds-ev-08', 'item_id', pg_temp.id('g:2'), 'chosen', jsonb_build_array(0, 0, 1), 'local_date', '2026-11-01'),
  jsonb_build_object('client_event_id', 'kinds-ev-09', 'item_id', pg_temp.id('g:4'), 'text', 'Москва', 'local_date', '2026-11-01')))::text);
create or replace function pg_temp.res(p_ev text) returns jsonb language sql stable as $fn$
  select r from jsonb_array_elements(pg_temp.c('r')::jsonb -> 'results') r where r ->> 'client_event_id' = p_ev
$fn$;
select pg_temp.ok(pg_temp.res('kinds-ev-01') ->> 'status' = 'saved' and (pg_temp.res('kinds-ev-01') ->> 'correct')::boolean
                  and pg_temp.res('kinds-ev-01') -> 'answers' = '["9.8"]' and pg_temp.res('kinds-ev-01') -> 'key' = '[]'
                  and (pg_temp.res('kinds-ev-01') ->> 'tolerance')::numeric = 0.1 and pg_temp.res('kinds-ev-01') ->> 'unit' = 'м/с²'
                  and pg_temp.res('kinds-ev-01') -> 'state' ->> 'last_result' = 'right', 'number saved with its key');
select pg_temp.ok(pg_temp.res('kinds-ev-02') ->> 'status' = 'saved' and not (pg_temp.res('kinds-ev-02') ->> 'correct')::boolean
                  and pg_temp.res('kinds-ev-02') -> 'key' = '[0, 1, 2]' and pg_temp.res('kinds-ev-02') ->> 'step' = 'miss',
                  'order saved, a miss');
select pg_temp.ok(pg_temp.res('kinds-ev-03') ->> 'status' = 'saved' and (pg_temp.res('kinds-ev-03') ->> 'correct')::boolean
                  and pg_temp.res('kinds-ev-03') -> 'answers' = '["Париж", "Берлин", "Рим"]', 'match saved, right');
select pg_temp.ok(pg_temp.res('kinds-ev-04') ->> 'status' = 'saved' and not (pg_temp.res('kinds-ev-04') ->> 'correct')::boolean,
                  'cloze saved (a newline inside a gap is a space)');
select pg_temp.ok(pg_temp.res('kinds-ev-05') ->> 'status' = 'no_key', 'essay is not answered here');
select pg_temp.ok(pg_temp.res('kinds-ev-06') - 'state' - 'item_id'
                  = jsonb_build_object('client_event_id', 'kinds-ev-06', 'status', 'saved', 'correct', true, 'step', 'start',
                                       'rev', 1, 'key', jsonb_build_array(0)), 'single reply as before');
select pg_temp.ok((select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.res('kinds-ev-06')) k)
                  = 'client_event_id,correct,item_id,key,rev,state,status,step', 'single reply keys as before');
select pg_temp.ok(pg_temp.res('kinds-ev-07') ->> 'status' = 'saved' and not (pg_temp.res('kinds-ev-07') ->> 'correct')::boolean
                  and pg_temp.res('kinds-ev-07') -> 'state' ->> 'last_result' = 'wrong'
                  and (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.res('kinds-ev-07')) k)
                      = 'client_event_id,correct,item_id,key,rev,state,status,step',
                  'partial credit is a miss for the rule; the multiple reply as before');
select pg_temp.ok(pg_temp.res('kinds-ev-08') ->> 'status' = 'invalid', 'order: not a permutation');
select pg_temp.ok(pg_temp.res('kinds-ev-09') ->> 'status' = 'invalid', 'cloze: a text instead of texts');
reset role;
select pg_temp.ok((select kind = 'order' and chosen = '{1,0,2}' and shown_order = '{2,1,0}' and not correct
                     from public.test_answers where client_event_id = 'kinds-ev-02'), 'order logged as the arrangement');
select pg_temp.ok((select kind = 'cloze' and answer_text = E'мос ква\n1147' from public.test_answers where client_event_id = 'kinds-ev-04'),
                  'cloze logged, gaps one per line');
select pg_temp.ok((select kind = 'number' and answer_text = '9,75 м/с²' and correct from public.test_answers where client_event_id = 'kinds-ev-01'),
                  'number logged');
select pg_temp.ok((select chosen = '{0,1}' and correct from public.test_answers where client_event_id = 'kinds-ev-03'), 'match logged');
select pg_temp.ok(not exists (select 1 from public.test_answers where client_event_id in ('kinds-ev-05', 'kinds-ev-08', 'kinds-ev-09')),
                  'nothing logged for the refused');

-- 3. «Как на экзамене»: an empty cloze is unanswered.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select pg_temp.put('m', public.container_mock_finish(jsonb_build_object(
  'client_run_id', 'kinds-run-01', 'container_id', (select container_id from g_rows limit 1), 'local_date', '2026-11-02',
  'answers', jsonb_build_array(
    jsonb_build_object('client_event_id', 'kinds-mk-01', 'item_id', pg_temp.id('g:4'), 'texts', null),
    jsonb_build_object('client_event_id', 'kinds-mk-02', 'item_id', pg_temp.id('g:1'), 'text', '9.8'),
    jsonb_build_object('client_event_id', 'kinds-mk-03', 'item_id', pg_temp.id('g:2'), 'chosen', jsonb_build_array(0, 1, 2)))))::text);
select pg_temp.ok((pg_temp.c('m')::jsonb ->> 'items')::integer = 3 and (pg_temp.c('m')::jsonb ->> 'correct')::integer = 2
                  and (pg_temp.c('m')::jsonb ->> 'unanswered')::integer = 1, 'mock: 3 items, 2 right, 1 unanswered');
reset role;
select 'QUESTION KINDS GRADING BEHAVIOUR PASSED';
rollback;
