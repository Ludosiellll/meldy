-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261101090000_question_kinds.sql
-- (release 48, part 1: the data of the new question kinds, docs/kinds/CONTRACT.md §1) on the scratch database of
-- question_kinds_run.sh. One transaction, rolled back. A = author aaaa…1, B = bbbb…2 (another user with a lecture of
-- their own). psql variable :numbers holds contracts/kinds/number_vectors.json. Covers: meldy_number_right against every
-- shared case; meldy_cloze_gaps; the validators answer as before for the old kinds; container_items_add takes every new
-- kind with its keys and refuses each broken rule with its name; what is stored (order's identity key, cloze forms one
-- per line, the unit trimmed, keyed); container_item_update: rev by the key of each kind (and not by what is not the
-- key), a change of kind clears what the new kind does not have, the refusals; the old kinds' rev rule unchanged.
-- A failure raises; success prints QUESTION KINDS BEHAVIOUR PASSED.
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
    if sqlstate is distinct from p_state then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_state;
    end if;
    if p_detail is not null and v_detail is distinct from p_detail and v_detail not like p_detail then
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
grant all on ctx to authenticated;
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = p_k
$fn$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into pg_temp.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;

-- 1. The number rule, every shared case.
select pg_temp.ok(public.meldy_number_right(c ->> 'text',
                    array(select jsonb_array_elements_text(c -> 'answers')),
                    (c ->> 'tolerance')::numeric, c ->> 'unit') = (c ->> 'right')::boolean,
                  'number case ' || (c ->> 'name'))
  from jsonb_array_elements((:'numbers')::jsonb -> 'cases') c;
select pg_temp.ok((select count(*) from jsonb_array_elements((:'numbers')::jsonb -> 'cases')) >= 50, 'number cases read');
select pg_temp.ok(public.meldy_cloze_gaps('Москва — ___ России, основана в _____ году. __ не пропуск') = 2, 'cloze gaps');
select pg_temp.ok(public.meldy_cloze_gaps(null) = 0 and public.meldy_cloze_gaps('нет') = 0, 'cloze gaps none');
-- the immutable, empty-search_path function the live game builds on
select pg_temp.ok((select p.provolatile = 'i' and p.proconfig = array['search_path=""']
                     from pg_proc p where p.oid = 'public.meldy_number_right(text, text[], numeric, text)'::regprocedure),
                  'meldy_number_right immutable with an empty search_path');

-- 2. The validators: the old kinds as before.
select pg_temp.ok(public.meldy_key_ok('{1}', 3, 'single') and not public.meldy_key_ok('{0,1}', 3, 'single')
                  and public.meldy_key_ok('{0,2}', 3, 'multiple') and not public.meldy_key_ok('{3}', 3, 'multiple')
                  and public.meldy_key_ok('{}', 0, 'short') and not public.meldy_key_ok('{0}', 1, 'short')
                  and public.meldy_key_ok('{}', 3, 'single') and not public.meldy_key_ok('{1,1}', 3, 'multiple'),
                  'meldy_key_ok old kinds');
select pg_temp.ok(public.meldy_answers_ok('{Москва}', 'short') and not public.meldy_answers_ok('{}', 'short')
                  and public.meldy_answers_ok('{}', 'single') and not public.meldy_answers_ok('{a}', 'multiple'),
                  'meldy_answers_ok old kinds');
-- the new kinds
select pg_temp.ok(public.meldy_key_ok('{0,1,2}', 3, 'order') and not public.meldy_key_ok('{1,0,2}', 3, 'order')
                  and not public.meldy_key_ok('{}', 3, 'order') and not public.meldy_key_ok('{0,1}', 3, 'order')
                  and public.meldy_key_ok('{}', 0, 'number') and not public.meldy_key_ok('{0}', 3, 'match')
                  and public.meldy_key_ok('{}', 0, 'essay'), 'meldy_key_ok new kinds');
select pg_temp.ok(public.meldy_answers_ok('{9.8,-1,0.25}', 'number') and public.meldy_answers_ok('{9,8}', 'number')
                  and not public.meldy_answers_ok('{"9,8"}', 'number') and not public.meldy_answers_ok('{+1}', 'number')
                  and not public.meldy_answers_ok('{}', 'number') and not public.meldy_answers_ok('{.5}', 'number'),
                  'meldy_answers_ok number');
select pg_temp.ok(public.meldy_answers_ok('{Париж,Берлин,Рим}', 'match') and not public.meldy_answers_ok('{Париж,париж}', 'match')
                  and not public.meldy_answers_ok('{Париж}', 'match'), 'meldy_answers_ok match');
select pg_temp.ok(public.meldy_answers_ok(array[E'Москва\nмосква-град', '1147'], 'cloze')
                  and not public.meldy_answers_ok(array[E'Москва\n\nград'], 'cloze')
                  and not public.meldy_answers_ok('{}', 'cloze') and public.meldy_answers_ok('{}', 'essay'),
                  'meldy_answers_ok cloze');

-- 3. Writing the new kinds.
insert into public.materials (id, user_id, title, original_text) values
  ('0f000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Лекция А', 'Текст лекции'),
  ('0f000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000002', 'Лекция Б', 'Чужая лекция');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select pg_temp.put('s', (public.container_create('Типы вопросов', null, '[{"title":"Вопросы"}]') -> 'subjects' -> 0 ->> 'id'));
select pg_temp.put('added', public.container_items_add(pg_temp.c('s')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'k:1', 'kind', 'number', 'stem', 'Ускорение свободного падения', 'answers', jsonb_build_array('9.8', '9.81'),
                     'tolerance', 0.05, 'unit', '  м/с² '),
  jsonb_build_object('ref', 'k:2', 'kind', 'order', 'stem', 'По порядку', 'options', jsonb_build_array('Один', 'Два', 'Три'), 'partial', true),
  jsonb_build_object('ref', 'k:3', 'kind', 'match', 'stem', 'Столицы', 'options', jsonb_build_array('Франция', 'Германия'),
                     'answers', jsonb_build_array('Париж', 'Берлин', 'Рим')),
  jsonb_build_object('ref', 'k:4', 'kind', 'cloze', 'stem', 'Столица России — ___, основана в ___ году.',
                     'answers', jsonb_build_array(E' Москва \n\n москва ', '1147')),
  jsonb_build_object('ref', 'k:5', 'kind', 'essay', 'stem', 'Расскажите о реформах', 'material_ids',
                     jsonb_build_array('0f000000-0000-4000-8000-0000000000a1')),
  jsonb_build_object('ref', 'k:6', 'kind', 'multiple', 'stem', 'Несколько', 'options', jsonb_build_array('a', 'b', 'c'),
                     'correct', jsonb_build_array(0, 2), 'partial', true),
  jsonb_build_object('ref', 'k:7', 'stem', 'Старый один', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0)),
  jsonb_build_object('ref', 'k:8', 'kind', 'number', 'stem', 'Ровно', 'answers', jsonb_build_array('-3')))) ::text);
select pg_temp.ok((pg_temp.c('added')::jsonb ->> 'added')::integer = 8, 'eight added');
create temp view kinds_rows as
  select i.import_ref as ref, i.* from public.test_items i where i.subject_id = pg_temp.c('s')::uuid;
grant select on kinds_rows to authenticated;
select pg_temp.ok((select kind = 'number' and options = '[]' and correct = '{}' and answers = '{9.8,9.81}' and tolerance = 0.05
                          and unit = 'м/с²' and keyed and not partial and key_source = 'manual'
                     from kinds_rows where ref = 'k:1'), 'number stored');
select pg_temp.ok((select correct = '{0,1,2}' and answers = '{}' and keyed and partial from kinds_rows where ref = 'k:2'),
                  'order stored with the identity key');
select pg_temp.ok((select correct = '{}' and answers = '{Париж,Берлин,Рим}' and keyed and tolerance is null
                     from kinds_rows where ref = 'k:3'), 'match stored');
select pg_temp.ok((select answers = array[E'Москва\nмосква', '1147'] and options = '[]' and keyed from kinds_rows where ref = 'k:4'),
                  'cloze stored, forms trimmed one per line');
select pg_temp.ok((select not keyed and material_ids = '{0f000000-0000-4000-8000-0000000000a1}' from kinds_rows where ref = 'k:5'),
                  'essay stored, not keyed');
select pg_temp.ok((select partial and correct = '{0,2}' from kinds_rows where ref = 'k:6'), 'multiple with partial credit');
select pg_temp.ok((select kind = 'single' and not partial and tolerance is null and unit is null and material_ids = '{}'
                     from kinds_rows where ref = 'k:7'), 'an old item as before');

-- the refusals, each with its rule
create or replace function pg_temp.add_bad(p_item jsonb, p_rule text) returns void language plpgsql as $fn$
begin
  perform pg_temp.expect_error(format('select public.container_items_add(%L::uuid, %L::jsonb)', pg_temp.c('s'),
                                      jsonb_build_array(p_item || '{"ref":"bad:1"}')), '22023', 'refused: ' || p_rule,
                               'item 1: ' || p_rule);
end;
$fn$;
select pg_temp.add_bad('{"kind":"number","stem":"x","answers":["9,8"]}', 'answers');
select pg_temp.add_bad('{"kind":"number","stem":"x","answers":[]}', 'answers');
select pg_temp.add_bad('{"kind":"number","stem":"x","answers":["1"],"options":["a","b"]}', 'options');
select pg_temp.add_bad('{"kind":"number","stem":"x","answers":["1"],"tolerance":-1}', 'tolerance');
select pg_temp.add_bad('{"kind":"number","stem":"x","answers":["1"],"tolerance":"0.1234567"}', 'tolerance');
select pg_temp.add_bad('{"kind":"number","stem":"x","answers":["1"],"tolerance":"много"}', 'tolerance');
select pg_temp.add_bad('{"kind":"number","stem":"x","answers":["1"],"unit":"слишком длинная единица"}', 'unit');
select pg_temp.add_bad('{"kind":"number","stem":"x","answers":["1"],"unit":"   "}', 'unit');
select pg_temp.add_bad('{"kind":"number","stem":"x","answers":["1"],"partial":true}', 'partial');
select pg_temp.add_bad('{"kind":"single","stem":"x","options":["a","b"],"correct":[0],"tolerance":1}', 'tolerance');
select pg_temp.add_bad('{"kind":"single","stem":"x","options":["a","b"],"correct":[0],"unit":"м"}', 'unit');
select pg_temp.add_bad('{"kind":"single","stem":"x","options":["a","b"],"correct":[0],"partial":true}', 'partial');
select pg_temp.add_bad('{"kind":"short","stem":"x","answers":["a"],"partial":true}', 'partial');
select pg_temp.add_bad('{"kind":"order","stem":"x","options":["a","b"],"correct":[1,0]}', 'correct');
select pg_temp.add_bad('{"kind":"order","stem":"x","options":["a"]}', 'options');
select pg_temp.add_bad('{"kind":"order","stem":"x","options":["a","b"],"answers":["a"]}', 'answers');
select pg_temp.add_bad('{"kind":"match","stem":"x","options":["a","b","c"],"answers":["1","2"]}', 'answers');
select pg_temp.add_bad('{"kind":"match","stem":"x","options":["a","b"],"answers":["1","1"]}', 'answers');
select pg_temp.add_bad('{"kind":"match","stem":"x","options":["a","b"],"answers":["1","2"],"correct":[0]}', 'correct');
select pg_temp.add_bad('{"kind":"match","stem":"x","options":["a","b"],"answers":["1","2","3","4","5","6","7","8","9","10","11"]}', 'answers');
select pg_temp.add_bad('{"kind":"cloze","stem":"Один ___ и два ___","answers":["a"]}', 'answers');
select pg_temp.add_bad('{"kind":"cloze","stem":"Без пропусков","answers":["a"]}', 'answers');
select pg_temp.add_bad('{"kind":"cloze","stem":"Пусто ___","answers":["  \n "]}', 'answers');
select pg_temp.add_bad('{"kind":"essay","stem":"x","answers":["a"]}', 'answers');
select pg_temp.add_bad('{"kind":"essay","stem":"x","material_ids":["0f000000-0000-4000-8000-0000000000b1"]}', 'material_ids');
select pg_temp.add_bad('{"kind":"essay","stem":"x","material_ids":["нет"]}', 'material_ids');
select pg_temp.add_bad('{"kind":"essay","stem":"x","material_ids":["0f000000-0000-4000-8000-0000000000a1","0f000000-0000-4000-8000-0000000000a1"]}', 'material_ids');
select pg_temp.add_bad('{"kind":"single","stem":"x","options":["a","b"],"correct":[0],"material_ids":["0f000000-0000-4000-8000-0000000000a1"]}', 'material_ids');
select pg_temp.add_bad('{"kind":"truefalse","stem":"x","options":["a","b"],"correct":[0]}', 'kind');

-- 4. rev of the new kinds: what is the key moves it, the rest does not.
create or replace function pg_temp.rev(p_ref text) returns integer language sql stable as $fn$
  select rev from kinds_rows where ref = p_ref
$fn$;
create or replace function pg_temp.upd(p_ref text, p_patch jsonb) returns jsonb language sql as $fn$
  select public.container_item_update((select id from kinds_rows where ref = p_ref), p_patch)
$fn$;
select pg_temp.ok((pg_temp.upd('k:1', '{"answers":["9.80","9.810"]}') ->> 'rev_changed')::boolean = false, 'number: 9.8 = 9.80');
select pg_temp.ok((pg_temp.upd('k:1', '{"unit":"М/С²"}') ->> 'rev_changed')::boolean = false, 'number: the unit''s case');
select pg_temp.ok((pg_temp.upd('k:1', '{"tolerance":"0.050"}') ->> 'rev_changed')::boolean = false, 'number: 0.05 = 0.050');
select pg_temp.ok((pg_temp.upd('k:1', '{"tolerance":0.1}') ->> 'rev_changed')::boolean, 'number: the tolerance');
select pg_temp.ok((pg_temp.upd('k:1', '{"answers":["9.8"]}') ->> 'rev_changed')::boolean, 'number: an accepted value');
select pg_temp.ok((pg_temp.upd('k:1', '{"unit":null}') ->> 'rev_changed')::boolean, 'number: the unit');
select pg_temp.ok((pg_temp.upd('k:1', '{"stem":"Ускорение g","explanation":"Почти 9,8"}') ->> 'rev_changed')::boolean = false,
                  'number: the stem and the explanation');
select pg_temp.ok((select unit is null and tolerance = 0.1 and explanation = 'Почти 9,8' from kinds_rows where ref = 'k:1'),
                  'number patched');
select pg_temp.ok((pg_temp.upd('k:2', '{"options":["один","ДВА","Три"]}') ->> 'rev_changed')::boolean = false, 'order: case');
select pg_temp.ok((pg_temp.upd('k:2', '{"partial":false}') ->> 'rev_changed')::boolean = false, 'order: partial is not the key');
select pg_temp.ok((pg_temp.upd('k:2', '{"options":["Два","Один","Три"]}') ->> 'rev_changed')::boolean, 'order: the order');
select pg_temp.ok((pg_temp.upd('k:2', '{"options":["Два","Один","Три","Четыре"]}') ->> 'rev_changed')::boolean, 'order: one more');
select pg_temp.ok((select correct = '{0,1,2,3}' and not partial from kinds_rows where ref = 'k:2'), 'order: the identity follows the options');
select pg_temp.ok((pg_temp.upd('k:3', '{"answers":["Берлин","Париж","Рим"]}') ->> 'rev_changed')::boolean, 'match: a pair');
select pg_temp.ok((pg_temp.upd('k:3', '{"answers":["берлин","ПАРИЖ","Рим"]}') ->> 'rev_changed')::boolean = false, 'match: case');
select pg_temp.ok((pg_temp.upd('k:3', '{"answers":["берлин","ПАРИЖ"]}') ->> 'rev_changed')::boolean, 'match: an extra item');
select pg_temp.ok((pg_temp.upd('k:4', '{"answers":["москва\nМосква","1147"]}') ->> 'rev_changed')::boolean = false,
                  'cloze: the forms of a gap are a set');
select pg_temp.ok((pg_temp.upd('k:4', '{"stem":"Основана в ___ году, столица — ___.","answers":["1147","Москва"]}') ->> 'rev_changed')::boolean,
                  'cloze: the gaps in another order');
select pg_temp.expect_error($$select pg_temp.upd('k:4', '{"stem":"Без пропуска"}')$$, '22023', 'cloze: the gaps must match');
select pg_temp.ok((pg_temp.upd('k:5', '{"material_ids":[]}') ->> 'rev_changed')::boolean = false, 'essay: lectures are not a key');
select pg_temp.expect_error($$select pg_temp.upd('k:5', '{"material_ids":["0f000000-0000-4000-8000-0000000000b1"]}')$$, '22023',
                            'essay: another''s lecture', 'material_ids');
select pg_temp.expect_error($$select pg_temp.upd('k:1', '{"tolerance":-0.5}')$$, '22023', 'number: a negative tolerance', 'tolerance');
select pg_temp.expect_error($$select pg_temp.upd('k:1', '{"answers":["abc"]}')$$, '22023', 'number: a word');
-- partial on single is cleared, not refused: the update clears what the kind does not have
select pg_temp.upd('k:7', '{"partial":true}');
select pg_temp.ok((select not partial from kinds_rows where ref = 'k:7'), 'single never keeps partial');
-- a change of kind clears what the new kind does not have
select pg_temp.ok((pg_temp.upd('k:8', '{"kind":"single","options":["−3","3"],"correct":[0],"answers":[]}') ->> 'rev_changed')::boolean,
                  'number → single moves rev');
select pg_temp.ok((select kind = 'single' and tolerance is null and unit is null and answers = '{}' from kinds_rows where ref = 'k:8'),
                  'number → single');
select pg_temp.ok((pg_temp.upd('k:8', '{"kind":"number","options":[],"correct":[],"answers":["-3"],"tolerance":"0.5","unit":"°C"}')
                   ->> 'rev_changed')::boolean, 'single → number');
select pg_temp.ok((select kind = 'number' and tolerance = 0.5 and unit = '°C' from kinds_rows where ref = 'k:8'), 'single → number stored');
select pg_temp.ok((pg_temp.upd('k:6', '{"kind":"single","correct":[0]}') ->> 'rev_changed')::boolean, 'multiple → single');
select pg_temp.ok((select not partial from kinds_rows where ref = 'k:6'), 'multiple → single clears partial');
-- the old kinds' rule as before: an option's words keep rev, the key moves it
select pg_temp.ok((pg_temp.upd('k:7', '{"options":["Да","Нет"]}') ->> 'rev_changed')::boolean = false, 'single: option words');
select pg_temp.ok((pg_temp.upd('k:7', '{"correct":[1]}') ->> 'rev_changed')::boolean, 'single: the key');
-- another user cannot write here
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
select pg_temp.expect_error(format('select public.container_items_add(%L::uuid, %L::jsonb)', pg_temp.c('s'),
                                   '[{"ref":"b:1","kind":"number","stem":"x","answers":["1"]}]'), 'P0002', 'not the author');
reset role;
select 'QUESTION KINDS BEHAVIOUR PASSED';
rollback;
