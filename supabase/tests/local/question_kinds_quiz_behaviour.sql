-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261101090200_question_kinds_quiz.sql
-- (release 48, part 3; docs/kinds/CONTRACT.md §3) on the scratch database of question_kinds_run.sh. One transaction,
-- rolled back. A = author aaaa…1, B = bbbb…2; the participant is a guest (anon with a token). Covers: the attempt with
-- every new kind (order shuffled and never in the file order, match's right items shuffled, unit, gaps, partial) and an
-- old item key for key as before; answers in shown indices mapped to file indices and back after a reload; the
-- refusals with their field; an emptied answer taken back; the score by credit (partial multiple, partial cloze, an
-- essay waiting) and pending; the review's keys only with the answers; the author's stats (no picks for order / match,
-- wrong numbers, credit, pending), quiz_attempt_answers, quiz_list; the essay task and mark (the author only, an empty
-- essay refused, the mark changes the score at once); an attempt of old kinds only: the same keys and numbers as before.
-- A failure raises; success prints QUESTION KINDS QUIZ BEHAVIOUR PASSED.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_what text, p_detail text default null)
returns void language plpgsql as $fn$
declare v_detail text;
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_state;
exception
  when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if sqlstate = 'PGRST' and p_state = 'P0002' and (sqlerrm::jsonb ->> 'code') = 'P0002' then
      v_detail := sqlerrm::jsonb ->> 'details';
    elsif sqlstate is distinct from p_state then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_state;
    end if;
    if p_detail is not null and v_detail is distinct from p_detail then
      raise exception 'FAILED: % — detail %, expected %', p_what, v_detail, p_detail;
    end if;
end;
$fn$;
create or replace function pg_temp.ok(p boolean, p_what text) returns void language plpgsql as $fn$
begin
  if p is distinct from true then raise exception 'FAILED: %', p_what; end if;
end;
$fn$;
create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated, anon;
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = p_k
$fn$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into pg_temp.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
create or replace function pg_temp.keys(p jsonb) returns text language sql stable as $fn$
  select string_agg(k, ',' order by k) from jsonb_object_keys(p) k
$fn$;
create or replace function pg_temp.tok(p_n integer) returns text language sql immutable as $fn$
  select 'tok' || lpad(p_n::text, 8, '0') || repeat('Z', 32)
$fn$;
-- an item of a JSON list by its id
create or replace function pg_temp.of(p_list jsonb, p_key text, p_id text) returns jsonb language sql stable as $fn$
  select x from jsonb_array_elements(p_list) x where x ->> p_key = p_id
$fn$;
grant execute on all functions in schema pg_temp to anon, authenticated;

create temp view q_rows as select i.import_ref as ref, i.* from public.test_items i where i.subject_id = pg_temp.c('s')::uuid;
grant select on q_rows to authenticated, anon;
create or replace function pg_temp.id(p_ref text) returns text language sql stable as $fn$
  select id::text from q_rows where ref = p_ref
$fn$;
grant execute on function pg_temp.id(text) to anon, authenticated;

insert into public.materials (id, user_id, title, original_text) values
  ('0f000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'Реформы', 'Текст лекции о реформах');

-- 1. The test and its quiz.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select pg_temp.put('s', (public.container_create('Типы в контрольной', null, '[{"title":"Вопросы"}]') -> 'subjects' -> 0 ->> 'id'));
select pg_temp.put('x', (select container_id::text from public.container_subjects where id = pg_temp.c('s')::uuid));
select public.container_items_add(pg_temp.c('s')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'q:1', 'kind', 'number', 'stem', 'g', 'answers', jsonb_build_array('9.8'), 'tolerance', 0.1, 'unit', 'м/с²'),
  jsonb_build_object('ref', 'q:2', 'kind', 'order', 'stem', 'По порядку', 'options', jsonb_build_array('А', 'Б', 'В', 'Г')),
  jsonb_build_object('ref', 'q:3', 'kind', 'match', 'stem', 'Столицы', 'options', jsonb_build_array('Франция', 'Германия'),
                     'answers', jsonb_build_array('Париж', 'Берлин', 'Рим')),
  jsonb_build_object('ref', 'q:4', 'kind', 'cloze', 'stem', '___ — столица, основана в ___ году', 'answers', jsonb_build_array('Москва', '1147'),
                     'partial', true),
  jsonb_build_object('ref', 'q:5', 'kind', 'essay', 'stem', 'Расскажите о реформах',
                     'material_ids', jsonb_build_array('0f000000-0000-4000-8000-0000000000a2'), 'explanation', 'Образец: три реформы'),
  jsonb_build_object('ref', 'q:6', 'kind', 'single', 'stem', 'Один', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0)),
  jsonb_build_object('ref', 'q:7', 'kind', 'multiple', 'stem', 'Несколько', 'options', jsonb_build_array('a', 'b', 'c', 'd'),
                     'correct', jsonb_build_array(0, 2), 'partial', true)));
select pg_temp.put('qobj', public.quiz_create(pg_temp.c('x')::uuid, jsonb_build_object(
  'title', 'Все типы', 'subject_ids', jsonb_build_array(pg_temp.c('s')), 'item_count', 7, 'shuffle_items', false,
  'same_set', true, 'review', 'answers', 'attempts', null))::text);
select pg_temp.put('q', pg_temp.c('qobj')::jsonb ->> 'code');
select pg_temp.put('qid', pg_temp.c('qobj')::jsonb ->> 'id');
select pg_temp.ok((public.quiz_preview(pg_temp.c('q')) ->> 'item_count')::integer = 7, 'the pool takes the essay');

-- 2. The guest's attempt.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.put('a', public.quiz_guest_start(pg_temp.c('q'), 'Гость Г', pg_temp.tok(1))::text);
do $do$
declare
  a jsonb := pg_temp.c('a')::jsonb;
  o jsonb := pg_temp.of(a -> 'items', 'id', pg_temp.id('q:2'));
  m jsonb := pg_temp.of(a -> 'items', 'id', pg_temp.id('q:3'));
begin
  perform pg_temp.ok(jsonb_array_length(a -> 'items') = 7, 'seven items');
  perform pg_temp.ok(pg_temp.keys(pg_temp.of(a -> 'items', 'id', pg_temp.id('q:6'))) = 'code,id,images,keep_order,kind,options,stem',
                     'a single item as before');
  perform pg_temp.ok(pg_temp.of(a -> 'items', 'id', pg_temp.id('q:7')) ->> 'partial' = 'true', 'partial credit is said');
  perform pg_temp.ok(pg_temp.of(a -> 'items', 'id', pg_temp.id('q:1')) ->> 'unit' = 'м/с²', 'number: unit');
  perform pg_temp.ok((pg_temp.of(a -> 'items', 'id', pg_temp.id('q:4')) ->> 'gaps')::integer = 2, 'cloze: gaps');
  perform pg_temp.ok(o -> 'options' <> '["А", "Б", "В", "Г"]'::jsonb
                     and (select array_agg(x order by x) from jsonb_array_elements_text(o -> 'options') x) = '{А,Б,В,Г}',
                     'order: the options shuffled, never in the right order');
  perform pg_temp.ok((select array_agg(x order by x) from jsonb_array_elements_text(m -> 'right') x) = '{Берлин,Париж,Рим}'
                     and m -> 'options' = '["Франция", "Германия"]', 'match: the right items shuffled');
  perform pg_temp.ok(a::text not like '%Образец%' and a::text not like '%0f000000-0000-4000-8000-0000000000a2%'
                     and a::text not like '%"tolerance"%' and a::text not like '%1147%', 'no key, explanation or lectures');
  -- the right answers in shown indices
  perform pg_temp.put('order_key', (select jsonb_agg((select o2.ord - 1 from jsonb_array_elements_text(o -> 'options') with ordinality o2(v, ord)
                                                       where o2.v = f.v) order by f.ord)
                                      from jsonb_array_elements_text('["А", "Б", "В", "Г"]'::jsonb) with ordinality f(v, ord))::text);
  perform pg_temp.put('match_key', (select jsonb_agg((select r.ord - 1 from jsonb_array_elements_text(m -> 'right') with ordinality r(v, ord)
                                                       where r.v = f.v) order by f.ord)
                                      from jsonb_array_elements_text('["Париж", "Берлин"]'::jsonb) with ordinality f(v, ord))::text);
end;
$do$;
select pg_temp.put('att', pg_temp.c('a')::jsonb ->> 'attempt_id');
select public.quiz_guest_answer(pg_temp.c('att')::uuid, pg_temp.tok(1), jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.id('q:1'), 'text', '9,75 м/с²'),
  jsonb_build_object('item_id', pg_temp.id('q:2'), 'chosen', pg_temp.c('order_key')::jsonb),
  jsonb_build_object('item_id', pg_temp.id('q:3'), 'chosen', pg_temp.c('match_key')::jsonb),
  jsonb_build_object('item_id', pg_temp.id('q:4'), 'texts', jsonb_build_array('Москва', '')),
  jsonb_build_object('item_id', pg_temp.id('q:5'), 'text', 'Были три реформы: денежная, военная, судебная.'),
  jsonb_build_object('item_id', pg_temp.id('q:6'), 'chosen', 0),
  jsonb_build_object('item_id', pg_temp.id('q:7'), 'chosen', jsonb_build_array(0))));
-- the refusals
select pg_temp.expect_error(format('select public.quiz_guest_answer(%L, %L, %L)', pg_temp.c('att'), pg_temp.tok(1),
         jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('q:2'), 'chosen', '[0, 0, 1, 2]'::jsonb))), '22023', 'order twice', 'chosen');
select pg_temp.expect_error(format('select public.quiz_guest_answer(%L, %L, %L)', pg_temp.c('att'), pg_temp.tok(1),
         jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('q:2'), 'chosen', '[0, 1, 2, 4]'::jsonb))), '22023', 'order out of range', 'chosen');
select pg_temp.expect_error(format('select public.quiz_guest_answer(%L, %L, %L)', pg_temp.c('att'), pg_temp.tok(1),
         jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('q:3'), 'chosen', '[0, 3]'::jsonb))), '22023', 'match out of range', 'chosen');
select pg_temp.expect_error(format('select public.quiz_guest_answer(%L, %L, %L)', pg_temp.c('att'), pg_temp.tok(1),
         jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('q:4'), 'texts', '["Москва"]'::jsonb))), '22023', 'cloze one gap of two', 'texts');
select pg_temp.expect_error(format('select public.quiz_guest_answer(%L, %L, %L)', pg_temp.c('att'), pg_temp.tok(1),
         jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('q:1'), 'text', repeat('1', 201)))), '22023', 'number too long', 'text');
select pg_temp.expect_error(format('select public.quiz_guest_answer(%L, %L, %L)', pg_temp.c('att'), pg_temp.tok(1),
         jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('q:5'), 'text', repeat('слово ', 1001)))), '22023', 'essay too long', 'text');
select pg_temp.expect_error(format('select public.quiz_guest_answer(%L, %L, %L)', pg_temp.c('att'), pg_temp.tok(2),
         jsonb_build_array(jsonb_build_object('item_id', pg_temp.id('q:1'), 'text', '1'))), 'P0002', 'another token');
-- after a reload the answers come back as they were sent
do $do$
declare
  a jsonb := public.quiz_guest_start(pg_temp.c('q'), 'Гость Г', pg_temp.tok(1));
begin
  perform pg_temp.ok(a ->> 'attempt_id' = pg_temp.c('att'), 'the same attempt');
  perform pg_temp.ok(pg_temp.of(a -> 'items', 'id', pg_temp.id('q:2')) -> 'options'
                     = pg_temp.of(pg_temp.c('a')::jsonb -> 'items', 'id', pg_temp.id('q:2')) -> 'options', 'the same order after a reload');
  perform pg_temp.ok(pg_temp.of(a -> 'answers', 'item_id', pg_temp.id('q:2')) -> 'chosen' = pg_temp.c('order_key')::jsonb, 'order back in shown indices');
  perform pg_temp.ok(pg_temp.of(a -> 'answers', 'item_id', pg_temp.id('q:3')) -> 'chosen' = pg_temp.c('match_key')::jsonb, 'match back in shown indices');
  perform pg_temp.ok(pg_temp.of(a -> 'answers', 'item_id', pg_temp.id('q:4')) -> 'texts' = '["Москва", ""]', 'cloze back as texts');
  perform pg_temp.ok(pg_temp.of(a -> 'answers', 'item_id', pg_temp.id('q:1')) ->> 'text' = '9,75 м/с²', 'number back');
  perform pg_temp.ok(pg_temp.keys(pg_temp.of(a -> 'answers', 'item_id', pg_temp.id('q:6'))) = 'chosen,item_id,text', 'a single answer as before');
end;
$do$;
reset role;
select pg_temp.ok((select chosen = '{0,1,2,3}' from public.quiz_answers where attempt_id = pg_temp.c('att')::uuid
                    and item_id = pg_temp.id('q:2')::uuid), 'order stored in file indices');
select pg_temp.ok((select chosen = '{0,1}' from public.quiz_answers where attempt_id = pg_temp.c('att')::uuid
                    and item_id = pg_temp.id('q:3')::uuid), 'match stored in file indices');
select pg_temp.ok((select text = E'Москва\n' from public.quiz_answers where attempt_id = pg_temp.c('att')::uuid
                    and item_id = pg_temp.id('q:4')::uuid), 'cloze stored one gap per line');

-- 3. Finish: the score by credit.
set local role anon;
select pg_temp.put('r', public.quiz_guest_finish(pg_temp.c('att')::uuid, pg_temp.tok(1))::text);
do $do$
declare
  r jsonb := pg_temp.c('r')::jsonb;
  it jsonb;
begin
  -- number 1 + order 1 + match 1 + cloze 0.5 + essay 0 (waiting) + single 1 + multiple 0.5 = 5 of 7
  perform pg_temp.ok((r ->> 'score')::numeric = 5 and r -> 'score' = '5'::jsonb and (r ->> 'max_score')::integer = 7
                     and (r ->> 'percent')::integer = 71 and (r ->> 'correct')::integer = 4 and (r ->> 'total')::integer = 7
                     and (r ->> 'pending')::integer = 1, 'score by credit: ' || r::text);
  it := pg_temp.of(r -> 'items', 'id', pg_temp.id('q:2'));
  perform pg_temp.ok((it ->> 'right')::boolean and it -> 'chosen' = pg_temp.c('order_key')::jsonb and it -> 'key' = it -> 'chosen'
                     and it -> 'options' = pg_temp.of(pg_temp.c('a')::jsonb -> 'items', 'id', pg_temp.id('q:2')) -> 'options',
                     'order review in shown indices');
  it := pg_temp.of(r -> 'items', 'id', pg_temp.id('q:3'));
  perform pg_temp.ok((it ->> 'right')::boolean and it -> 'key' = pg_temp.c('match_key')::jsonb
                     and it -> 'right_items' = pg_temp.of(pg_temp.c('a')::jsonb -> 'items', 'id', pg_temp.id('q:3')) -> 'right',
                     'match review');
  it := pg_temp.of(r -> 'items', 'id', pg_temp.id('q:4'));
  perform pg_temp.ok(not (it ->> 'right')::boolean and (it ->> 'credit')::numeric = 0.5 and it -> 'gaps_right' = '[true, false]'
                     and it -> 'gap_forms' = '[["Москва"], ["1147"]]' and it -> 'forms' = 'null' and it -> 'texts' = '["Москва", ""]' and it ->> 'partial' = 'true',
                     'cloze review: ' || it::text);
  it := pg_temp.of(r -> 'items', 'id', pg_temp.id('q:1'));
  perform pg_temp.ok((it ->> 'right')::boolean and it -> 'forms' = '["9.8"]' and (it ->> 'tolerance')::numeric = 0.1
                     and it ->> 'unit' = 'м/с²' and it ->> 'text' = '9,75 м/с²', 'number review');
  it := pg_temp.of(r -> 'items', 'id', pg_temp.id('q:5'));
  perform pg_temp.ok((it ->> 'pending')::boolean and it -> 'mark' = 'null' and (it ->> 'credit')::numeric = 0
                     and it ->> 'explanation' = 'Образец: три реформы', 'essay review: waiting');
  it := pg_temp.of(r -> 'items', 'id', pg_temp.id('q:7'));
  perform pg_temp.ok((it ->> 'credit')::numeric = 0.5 and it ->> 'partial' = 'true' and not (it ->> 'right')::boolean, 'multiple partial review');
  it := pg_temp.of(r -> 'items', 'id', pg_temp.id('q:6'));
  perform pg_temp.ok(pg_temp.keys(it) = 'chosen,code,explanation,forms,id,images,keep_order,key,kind,options,right,stem,text',
                     'a single review item as before');
end;
$do$;

-- 4. The author's side.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $do$
declare
  r jsonb := public.quiz_results(pg_temp.c('qid')::uuid);
  it jsonb;
begin
  perform pg_temp.ok((r -> 'attempts' -> 0 ->> 'score')::numeric = 5 and (r -> 'attempts' -> 0 ->> 'max_score')::integer = 7,
                     'quiz_results: the score');
  perform pg_temp.ok(pg_temp.of(r -> 'items', 'item_id', pg_temp.id('q:2')) -> 'picks' = '[]'
                     and pg_temp.of(r -> 'items', 'item_id', pg_temp.id('q:3')) -> 'picks' = '[]', 'no picks for order and match');
  it := pg_temp.of(r -> 'items', 'item_id', pg_temp.id('q:5'));
  perform pg_temp.ok((it ->> 'pending')::integer = 1 and (it ->> 'credit')::numeric = 0, 'essay waits');
  perform pg_temp.ok(pg_temp.keys(pg_temp.of(r -> 'items', 'item_id', pg_temp.id('q:6'))) = 'answered,correct,item_id,picks,shown,wrong_texts',
                     'a single item''s stats as before');
  perform pg_temp.ok((pg_temp.of(r -> 'items', 'item_id', pg_temp.id('q:4')) ->> 'credit')::numeric = 0.5, 'cloze credit');
end;
$do$;
do $do$
declare
  r jsonb := public.quiz_attempt_answers(pg_temp.c('att')::uuid);
begin
  perform pg_temp.ok(pg_temp.of(r, 'item_id', pg_temp.id('q:4')) -> 'texts' = '["Москва", ""]', 'author: cloze texts');
  perform pg_temp.ok(pg_temp.of(r, 'item_id', pg_temp.id('q:5')) -> 'mark' = 'null'
                     and (pg_temp.of(r, 'item_id', pg_temp.id('q:5')) ->> 'pending')::boolean, 'author: essay waits');
  perform pg_temp.ok(pg_temp.keys(pg_temp.of(r, 'item_id', pg_temp.id('q:6'))) = 'answered_at,chosen,correct,item_id,text', 'author: single as before');
end;
$do$;
-- the essay task and mark
do $do$
declare
  t jsonb := public.quiz_essay_task(pg_temp.c('att')::uuid, pg_temp.id('q:5')::uuid);
  m jsonb;
  r jsonb;
begin
  perform pg_temp.ok(t ->> 'stem' = 'Расскажите о реформах' and t ->> 'text' like 'Были три реформы%'
                     and t -> 'material_ids' = '["0f000000-0000-4000-8000-0000000000a2"]' and (t ->> 'finished')::boolean
                     and t -> 'mark' = 'null', 'the essay task');
  m := public.quiz_essay_mark(pg_temp.c('att')::uuid, pg_temp.id('q:5')::uuid, 'partial', '«Реформы шли в три этапа»', 'ai');
  perform pg_temp.ok(m ->> 'verdict' = 'partial' and m ->> 'source' = 'ai', 'marked by the check');
  m := public.quiz_essay_mark(pg_temp.c('att')::uuid, pg_temp.id('q:5')::uuid, 'full');
  perform pg_temp.ok(m ->> 'verdict' = 'full' and m ->> 'source' = 'author' and m -> 'quote' = 'null', 'the author''s word wins');
  r := public.quiz_results(pg_temp.c('qid')::uuid);
  perform pg_temp.ok((r -> 'attempts' -> 0 ->> 'score')::numeric = 6, 'the mark counts at once');
  m := public.quiz_essay_mark(pg_temp.c('att')::uuid, pg_temp.id('q:5')::uuid, 'partial');
  r := public.quiz_results(pg_temp.c('qid')::uuid);
  perform pg_temp.ok(r -> 'attempts' -> 0 -> 'score' = '5.5'::jsonb, 'half a point: ' || (r -> 'attempts' -> 0 ->> 'score'));
  perform pg_temp.ok((select (x ->> 'avg_percent')::numeric = 78.6 from jsonb_array_elements(public.quiz_list(pg_temp.c('x')::uuid)) x
                       where x ->> 'id' = pg_temp.c('qid')), 'quiz_list average by credit');
end;
$do$;
select pg_temp.expect_error(format('select public.quiz_essay_mark(%L, %L, %L)', pg_temp.c('att'), pg_temp.id('q:5'), 'excellent'),
                            '22023', 'a bad verdict', 'verdict');
select pg_temp.expect_error(format('select public.quiz_essay_mark(%L, %L, %L, %L)', pg_temp.c('att'), pg_temp.id('q:5'), 'full', repeat('ц', 601)),
                            '22023', 'a long quote', 'quote');
select pg_temp.expect_error(format('select public.quiz_essay_task(%L, %L)', pg_temp.c('att'), pg_temp.id('q:6')),
                            'P0002', 'not an essay', 'essay');
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
select pg_temp.expect_error(format('select public.quiz_essay_task(%L, %L)', pg_temp.c('att'), pg_temp.id('q:5')),
                            'P0002', 'another user', 'essay');
select pg_temp.expect_error(format('select public.quiz_essay_mark(%L, %L, %L)', pg_temp.c('att'), pg_temp.id('q:5'), 'none'),
                            'P0002', 'another user cannot mark', 'essay');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.of(public.quiz_guest_result(pg_temp.c('att')::uuid, pg_temp.tok(1)) -> 'items', 'id', pg_temp.id('q:5')) -> 'mark' ->> 'verdict' = 'partial'
                  and (public.quiz_guest_result(pg_temp.c('att')::uuid, pg_temp.tok(1)) ->> 'pending')::integer = 0,
                  'the participant sees the mark');
-- an emptied answer is taken back; an empty essay cannot be marked
select pg_temp.put('a2', public.quiz_guest_start(pg_temp.c('q'), 'Гость Д', pg_temp.tok(3)) ->> 'attempt_id');
select public.quiz_guest_answer(pg_temp.c('a2')::uuid, pg_temp.tok(3), jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.id('q:2'), 'chosen', '[3, 2, 1, 0]'::jsonb),
  jsonb_build_object('item_id', pg_temp.id('q:3'), 'chosen', '[1, -1]'::jsonb)));
select public.quiz_guest_answer(pg_temp.c('a2')::uuid, pg_temp.tok(3), jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.id('q:2'), 'chosen', '[]'::jsonb),
  jsonb_build_object('item_id', pg_temp.id('q:3'), 'chosen', '[-1, -1]'::jsonb),
  jsonb_build_object('item_id', pg_temp.id('q:4'), 'texts', '[" ", ""]'::jsonb),
  jsonb_build_object('item_id', pg_temp.id('q:5'), 'text', '   ')));
reset role;
select pg_temp.ok(not exists (select 1 from public.quiz_answers where attempt_id = pg_temp.c('a2')::uuid), 'emptied answers taken back');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select pg_temp.expect_error(format('select public.quiz_essay_mark(%L, %L, %L)', pg_temp.c('a2'), pg_temp.id('q:5'), 'none'),
                            '22023', 'an empty essay', 'unanswered');

-- 5. Old kinds only: the same keys and numbers as before.
select pg_temp.put('s2', (public.container_create('Старые типы', null, '[{"title":"Вопросы"}]') -> 'subjects' -> 0 ->> 'id'));
select public.container_items_add(pg_temp.c('s2')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'o:1', 'stem', 'Один', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0)),
  jsonb_build_object('ref', 'o:2', 'kind', 'short', 'stem', 'Столица', 'answers', jsonb_build_array('Москва')),
  jsonb_build_object('ref', 'o:3', 'kind', 'multiple', 'stem', 'Несколько', 'options', jsonb_build_array('a', 'b', 'c'), 'correct', jsonb_build_array(0, 1))));
select pg_temp.put('q2', public.quiz_create((select container_id from public.container_subjects where id = pg_temp.c('s2')::uuid),
  jsonb_build_object('title', 'Старая', 'subject_ids', jsonb_build_array(pg_temp.c('s2')), 'item_count', 3, 'shuffle_items', false,
                     'review', 'answers', 'attempts', null)) ->> 'code');
reset role;
set local role anon;
do $do$
declare
  a jsonb := public.quiz_guest_start(pg_temp.c('q2'), 'Гость Е', pg_temp.tok(4));
  r jsonb;
  it jsonb;
begin
  for it in select x from jsonb_array_elements(a -> 'items') x loop
    perform pg_temp.ok(pg_temp.keys(it) = 'code,id,images,keep_order,kind,options,stem', 'old item keys ' || it::text);
  end loop;
  perform public.quiz_guest_answer((a ->> 'attempt_id')::uuid, pg_temp.tok(4), (
    select jsonb_agg(case when x ->> 'kind' = 'short' then jsonb_build_object('item_id', x ->> 'id', 'text', 'москва')
                          when x ->> 'kind' = 'single' then jsonb_build_object('item_id', x ->> 'id', 'chosen', 0)
                          else jsonb_build_object('item_id', x ->> 'id', 'chosen', '[0]'::jsonb) end)
      from jsonb_array_elements(a -> 'items') x));
  r := public.quiz_guest_finish((a ->> 'attempt_id')::uuid, pg_temp.tok(4));
  perform pg_temp.ok(r -> 'score' = '2'::jsonb and r -> 'max_score' = '3'::jsonb and (r ->> 'percent')::integer = 67
                     and not (r ? 'pending'), 'old kinds: the same numbers, no pending ' || r::text);
  for it in select x from jsonb_array_elements(r -> 'items') x loop
    perform pg_temp.ok(pg_temp.keys(it) = 'chosen,code,explanation,forms,id,images,keep_order,key,kind,options,right,stem,text',
                       'old review keys ' || it::text);
  end loop;
end;
$do$;
reset role;
select 'QUESTION KINDS QUIZ BEHAVIOUR PASSED';
rollback;
