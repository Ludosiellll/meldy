-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/*_containers.sql on the scratch
-- database of containers_run_all.sh. One transaction, rolled back. A = author aaaa…1, B = member bbbb…2,
-- C = stranger cccc…3, D and E = more members. A failure raises; success prints CONTAINER CHECKS PASSED. Roles:
-- authenticated with request.jwt.claim.sub switching, anon at the end. Runs under both grant modes (before and after
-- *_containers_revokes.sql).
-- Optional psql variables (containers_run_all.sh passes them on the first run):
--   samples_out  a file for the real RPC outputs (one line each: name <tab> rpc <tab> json), checked by tsc --strict
--                against frontend/src/types/container.ts;
--   vectors_out  a file for contracts/container/rule_vectors.json (section R: the rule on named cases, asserted here,
--                and 320 seeded random sequences).
\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.expect_error(p_sql text, p_state text, p_what text)
returns void language plpgsql as $fn$
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_state;
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if sqlstate is distinct from p_state then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_state;
    end if;
end;
$fn$;
create temp table ctx (k text primary key, v text);
create temp table samples (name text primary key, rpc text not null, j jsonb not null);
create or replace function pg_temp.keep(p_name text, p_rpc text, p_j jsonb) returns void language sql as $fn$
  insert into samples values (p_name, p_rpc, p_j) on conflict (name) do update set rpc = excluded.rpc, j = excluded.j
$fn$;
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from ctx where k = p_k
$fn$;
grant all on ctx, samples to authenticated, anon;
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.keep(text, text, jsonb), pg_temp.c(text)
  to authenticated, anon;

-- The author's oral exam (lecture 1111… of the baseline), mapped, with an answer key: share-ready.
insert into public.exams (id, user_id, title, exam_date, mapping_state) values
  ('e0000000-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Базы данных: билеты',
   (now() at time zone 'utc')::date + 19, 'done');
insert into public.exam_materials (exam_id, material_id, user_id) values
  ('e0000000-0000-4000-8000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.exam_questions (exam_id, user_id, position, text, coverage, coverage_method, materials_fingerprint, mapping_version) values
  ('e0000000-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', 1, 'Нормальные формы отношений', 'full', 'llm', 'fp-c1', 1);
-- B's own unrelated exam (to try binding a non-copy), and A's second exam (for the subject limit).
insert into public.exams (id, user_id, title) values
  ('e0000000-0000-4000-8000-0000000000b9', 'bbbbbbbb-0000-0000-0000-000000000002', 'Своё');

set local role authenticated;

-- 1. The author: a container with a test subject and a subject whose oral part is the exam above; one more subject
--    added later; items of every kind; the limits; the group link.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; v_c uuid; s1 uuid; s2 uuid; s3 uuid; v_x uuid; d date := (now() at time zone 'utc')::date;
begin
  r := public.container_create('Сессия: зимняя', d + 19, jsonb_build_array(
         jsonb_build_object('title', 'C# и .NET', 'topics', jsonb_build_array('Делегаты', 'События')),
         jsonb_build_object('title', 'Базы данных', 'exam_id', 'e0000000-0000-4000-8000-0000000000c1')));
  perform pg_temp.keep('created', 'container_create', r);
  v_c := (r ->> 'container_id')::uuid;
  s1 := (r -> 'subjects' -> 0 ->> 'id')::uuid;
  s2 := (r -> 'subjects' -> 1 ->> 'id')::uuid;
  if (r -> 'subjects' -> 1 ->> 'position')::int <> 2 then raise exception 'FAILED: positions %', r; end if;
  -- One more subject at the end (its own date); the oral exam cannot be a subject twice.
  r := public.container_subject_add(v_c, jsonb_build_object('title', '  Сети  ', 'exam_date', to_char(d + 25, 'YYYY-MM-DD')));
  perform pg_temp.keep('subject_added', 'container_subject_add', r);
  if (r ->> 'position')::int <> 3 or r ->> 'title' <> 'Сети' then raise exception 'FAILED: subject add %', r; end if;
  s3 := (r ->> 'id')::uuid;
  perform pg_temp.expect_error(format($$select public.container_subject_add(%L, '{"title":"Ещё раз","exam_id":"e0000000-0000-4000-8000-0000000000c1"}')$$, v_c),
                               '22023', 'the same oral exam twice');
  perform pg_temp.expect_error(format($$select public.container_subject_add(%L, '{"title":"   "}')$$, v_c), '22023', 'empty title');
  perform pg_temp.expect_error(format($$select public.container_subject_add(%L, '[]')$$, v_c), '22023', 'subject not an object');
  perform pg_temp.expect_error($$select public.container_subject_add('00000000-0000-4000-8000-000000000000', '{"title":"x"}')$$,
                               'P0002', 'subject add to no container');
  insert into ctx values ('c', v_c), ('s1', s1), ('s2', s2), ('s3', s3);

  -- Items: single, code, multiple (two keys), no key, short (accepted forms; kind from the answers), short (explicit).
  r := public.container_items_add(s1, jsonb_build_array(
    jsonb_build_object('ref', 'imp1:1', 'file_no', '1', 'topic', 1, 'stem', 'Что такое делегат?', 'options', '["тип-ссылка на метод","класс","структура","интерфейс","событие"]'::jsonb, 'correct', '[0]'::jsonb, 'key_source', 'bold'),
    jsonb_build_object('ref', 'imp1:2', 'file_no', '2', 'topic', 1, 'stem', 'a -= 1 делает', 'options', '["уменьшает a на 1","ничего","ошибку"]'::jsonb, 'correct', '[0]'::jsonb, 'key_source', 'bold', 'code', true),
    jsonb_build_object('ref', 'imp1:3', 'file_no', '3', 'topic', 2, 'stem', '#region нужен для', 'options', '["сворачивания кода","компиляции","отладки"]'::jsonb, 'correct', '[0]'::jsonb, 'key_source', 'bold'),
    jsonb_build_object('ref', 'imp1:4', 'file_no', '4', 'topic', 2, 'stem', 'event объявляет', 'options', '["событие","поле","свойство","метод"]'::jsonb, 'correct', '[0]'::jsonb, 'key_source', 'bold'),
    jsonb_build_object('ref', 'imp1:5', 'file_no', '5', 'topic', 2, 'stem', 'Отметьте ссылочные типы', 'options', '["string","int","object","bool"]'::jsonb, 'correct', '[2,0]'::jsonb, 'key_source', 'bold'),
    jsonb_build_object('ref', 'imp1:6', 'file_no', '6', 'topic', 1, 'stem', 'Без ключа', 'options', '["да","нет"]'::jsonb, 'correct', '[]'::jsonb),
    jsonb_build_object('ref', 'imp1:7', 'file_no', '7', 'topic', 1, 'stem', 'Ещё вопрос', 'options', '["а","б","в"]'::jsonb, 'correct', '[1]'::jsonb, 'key_source', 'bold'),
    jsonb_build_object('ref', 'imp1:8', 'file_no', '8', 'topic', 1, 'stem', 'Впишите: какое дерево наряжают на Новый год?', 'answers', '[" Ёлка ","ель."]'::jsonb, 'key_source', 'answer_line'),
    jsonb_build_object('ref', 'imp1:9', 'file_no', '9', 'kind', 'short', 'stem', 'Метод делегата, который его вызывает', 'options', '[]'::jsonb, 'correct', '[]'::jsonb, 'answers', '["Invoke"]'::jsonb, 'key_source', 'gift')));
  perform pg_temp.keep('items_added', 'container_items_add', r);
  if (r ->> 'added')::int <> 9 or jsonb_array_length(r -> 'items') <> 9 or (r ->> 'in_container')::int <> 9 then
    raise exception 'FAILED: add 9: %', r; end if;
  insert into ctx select 'q' || split_part(x ->> 'ref', ':', 2), x ->> 'id' from jsonb_array_elements(r -> 'items') x;
  r := public.container_items_add(s3, '[{"ref":"imp3:1","stem":"Порт HTTP по умолчанию","options":["80","443"],"correct":[0]},
                                        {"ref":"imp3:2","stem":"Порт HTTPS","options":["80","443"],"correct":[1],"topic":1}]');
  insert into ctx select 't' || split_part(x ->> 'ref', ':', 2), x ->> 'id' from jsonb_array_elements(r -> 'items') x;
  r := public.container_items_add(s1, jsonb_build_array(
    jsonb_build_object('ref', 'imp1:1', 'stem', 'Что такое делегат?', 'options', '["тип-ссылка на метод","класс"]'::jsonb, 'correct', '[0]'::jsonb)));
  if (r ->> 'added')::int <> 0 or (r ->> 'in_container')::int <> 11 then raise exception 'FAILED: resend added %', r; end if;
  if (select kind from public.test_items where id = pg_temp.c('q5')::uuid) <> 'multiple' then
    raise exception 'FAILED: kind multiple from two keys'; end if;
  if (select row(kind, options, correct, answers, keyed) from public.test_items where id = pg_temp.c('q8')::uuid)
     is distinct from row('short'::text, '[]'::jsonb, '{}'::smallint[], array['Ёлка', 'ель.'], true) then
    raise exception 'FAILED: short item stored % ', (select row(kind, options, correct, answers) from public.test_items where id = pg_temp.c('q8')::uuid); end if;
  if (select keyed from public.test_items where id = pg_temp.c('q6')::uuid) then raise exception 'FAILED: no key is keyed'; end if;
  if (select stem from public.test_items where id = pg_temp.c('q2')::uuid) <> 'a -= 1 делает' then
    raise exception 'FAILED: code text changed'; end if;
  -- Every element rule refuses the whole call.
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"ref":"x:1","stem":"x","options":["a"],"correct":[0]}]')$$, s1), '22023', 'one option');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"ref":"x:1","stem":"x","options":["a","b"],"correct":[2]}]')$$, s1), '22023', 'key out of range');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"ref":"x:1","stem":"x","options":["a","b"],"correct":[0,1],"kind":"single"}]')$$, s1), '22023', 'two keys on a single');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"ref":"x:1","stem":"x","kind":"short","options":["a","b"],"answers":["a"]}]')$$, s1), '22023', 'short with options');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"ref":"x:1","stem":"x","kind":"short","answers":[]}]')$$, s1), '22023', 'short without answers');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"ref":"x:1","stem":"x","kind":"short","answers":["1","2","3","4","5","6","7","8","9","10","11"]}]')$$, s1), '22023', 'eleven accepted forms');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, %L)$$, s1,
                               jsonb_build_array(jsonb_build_object('ref', 'x:1', 'stem', 'x', 'kind', 'short', 'answers', jsonb_build_array(repeat('я', 201))))), '22023', 'a form of 201 characters');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"ref":"x:1","stem":"x","kind":"short","answers":[" . "]}]')$$, s1), '22023', 'a form empty after normalising');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"ref":"x:1","stem":"x","options":["a","b"],"correct":[0],"answers":["a"]}]')$$, s1), '22023', 'answers on a single');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"stem":"x","options":["a","b"],"correct":[0]}]')$$, s1), '22023', 'no ref');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"ref":"x:1","stem":"x","options":["a","b"],"correct":[0]},{"ref":"x:1","stem":"y","options":["a","b"],"correct":[1]}]')$$, s1), '22023', 'a ref twice in one call');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"ref":"x:1","stem":"x","options":["a","b"],"correct":[0],"key_source":"teacher"}]')$$, s1), '22023', 'unknown key source');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"ref":"x:1","stem":"x","options":["a","b"],"correct":[0],"code":"yes"}]')$$, s1), '22023', 'code not a boolean');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"ref":"x:1","stem":"x","options":["a","b"],"correct":[0],"kind":"order"}]')$$, s1), '22023', 'kind order');

  -- 20 subjects at most (a scratch container: create, fill through container_subject_add, the 21st is refused, delete).
  r := public.container_create('Лимит предметов', null, '[{"title":"1"}]');
  v_x := (r ->> 'container_id')::uuid;
  for i in 2..20 loop
    r := public.container_subject_add(v_x, jsonb_build_object('title', 'S' || i));
  end loop;
  if (r ->> 'position')::int <> 20 then raise exception 'FAILED: 20th position %', r; end if;
  perform pg_temp.expect_error(format($$select public.container_subject_add(%L, '{"title":"S21"}')$$, v_x), 'MC007', '21st subject');
  perform pg_temp.expect_error(format($$insert into public.container_subjects (container_id, position, title) values (%L, 20, 'S21')$$, v_x),
                               'MC007', '21st subject by a direct insert');
  delete from public.containers where id = v_x;

  -- The group link: oral subjects need the consent.
  perform pg_temp.expect_error(format($$select public.container_link_create(%L)$$, v_c), 'MC008', 'oral needs consent');
  r := public.container_link_create(v_c, 30, 'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа. Мои ответы и прогресс никто не увидит.');
  perform pg_temp.keep('link_created', 'container_link_create', r);
  if r ->> 'code' !~ '^[0-9a-hjkmnp-tv-z]{12}$' or (r ->> 'oral_subjects')::int <> 1 or r ->> 'path' <> '/g/' || (r ->> 'code') then
    raise exception 'FAILED: link %', r; end if;
  insert into ctx values ('code', r ->> 'code'), ('link', r ->> 'link_id');
  if (select count(*) from public.exam_shares where exam_id = 'e0000000-0000-4000-8000-0000000000c1' and revoked_at is null) <> 1 then
    raise exception 'FAILED: derived oral share'; end if;
  r := public.container_link_preview(r ->> 'code');
  perform pg_temp.keep('preview_own', 'container_link_preview', r);
  if r ->> 'status' <> 'own' or (r ->> 'container_id')::uuid <> v_c then raise exception 'FAILED: own preview %', r; end if;
  perform pg_temp.expect_error(format($$select public.container_join(%L)$$, pg_temp.c('code')), 'MC005', 'own link');
end
$t$;

-- 2. B: a stranger before joining; another's exam cannot be attached to B's container; joining.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare r jsonb; n int;
begin
  select count(*) into n from public.containers; if n <> 0 then raise exception 'FAILED: B sees containers before joining'; end if;
  select count(*) into n from public.test_items; if n <> 0 then raise exception 'FAILED: B sees items before joining'; end if;
  perform pg_temp.expect_error($$select public.container_create('Моё', null, '[{"title":"x","exam_id":"e0000000-0000-4000-8000-0000000000c1"}]')$$,
                               '42501', 'another''s exam as an oral part');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, '[{"ref":"b:1","stem":"x","options":["a","b"],"correct":[0]}]')$$,
                                      pg_temp.c('s1')), 'P0002', 'B adds to A''s subject');
  perform pg_temp.expect_error(format($$select public.container_subject_add(%L, '{"title":"x"}')$$, pg_temp.c('c')),
                               'P0002', 'B adds a subject to A''s container');
  r := public.container_link_preview(pg_temp.c('code'));
  perform pg_temp.keep('preview_active', 'container_link_preview', r);
  if r ->> 'status' <> 'active' or r ? 'container_id' and r ->> 'container_id' is not null
     or (r ->> 'needs_consent_text')::boolean is not true or jsonb_array_length(r -> 'subjects') <> 3
     or (r -> 'subjects' -> 0 ->> 'items')::int <> 8 or (r -> 'subjects' -> 1 ->> 'oral')::boolean is not true then
    raise exception 'FAILED: active preview %', r; end if;
  r := public.container_join(pg_temp.c('code'));
  perform pg_temp.keep('joined', 'container_join', r);
  if (r ->> 'joined')::boolean is not true or (r ->> 'oral_subjects')::int <> 1 then raise exception 'FAILED: join %', r; end if;
  r := public.container_join(pg_temp.c('code'));
  perform pg_temp.keep('joined_again', 'container_join', r);
  if (r ->> 'joined')::boolean is not false then raise exception 'FAILED: rejoin %', r; end if;
  select count(*) into n from public.test_items; if n <> 11 then raise exception 'FAILED: member reads % items', n; end if;
  select count(*) into n from public.container_subjects; if n <> 3 then raise exception 'FAILED: member reads % subjects', n; end if;
  select count(*) into n from public.container_links; if n <> 0 then raise exception 'FAILED: member reads links'; end if;
  perform pg_temp.keep('item_rows', 'TestItem[]', (select jsonb_agg(to_jsonb(t) order by t.position) from (
    select id, container_id, subject_id, position, file_no, topic, kind, stem, options, correct, answers, key_source, code,
           keep_order, flags, rev, updated_at
      from public.test_items where subject_id = pg_temp.c('s1')::uuid order by position) t));
  -- direct writes are refused
  perform pg_temp.expect_error(format($$insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev) values (%L, %L, %L, %L, 1)$$,
           'bbbbbbbb-0000-0000-0000-000000000002', pg_temp.c('q1'), pg_temp.c('c'), pg_temp.c('s1')),
           '42501', 'member writes a state by hand');
  perform pg_temp.expect_error(format($$insert into public.test_items (container_id, subject_id, position, stem, options) values (%L, %L, 99, 'x', '["a","b"]')$$,
           pg_temp.c('c'), pg_temp.c('s1')), '42501', 'member inserts an item');
  delete from public.test_items;  -- RLS: nothing of A's goes
  select count(*) into n from public.test_items; if n <> 11 then raise exception 'FAILED: member deleted items'; end if;
end
$t$;

-- 3. The answer core, as B. One call with every status, in input order.
create or replace function pg_temp.ans(p_item text, p_body text, p_id text, p_extra text default '') returns jsonb language sql as $fn$
  select public.record_test_answers(('[{"client_event_id":"' || p_id || '","item_id":"' || pg_temp.c(p_item)
    || '",' || p_body || ',"local_date":"' || to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD') || '"' || p_extra || '}]')::jsonb) -> 'results' -> 0
$fn$;
create or replace function pg_temp.st(p_item text, p_user uuid default 'bbbbbbbb-0000-0000-0000-000000000002') returns public.test_item_states language sql as $fn$
  select s.* from public.test_item_states s where s.item_id = pg_temp.c(p_item)::uuid and s.user_id = p_user
$fn$;
grant execute on function pg_temp.ans(text, text, text, text), pg_temp.st(text, uuid) to authenticated;

do $t$
declare r jsonb; x jsonb; s public.test_item_states; d date := (now() at time zone 'utc')::date; n int; ld text;
begin
  ld := to_char(d, 'YYYY-MM-DD');
  r := public.record_test_answers(jsonb_build_array(
    jsonb_build_object('client_event_id', 'b-ans-0001', 'item_id', pg_temp.c('q1'), 'chosen', 0, 'local_date', ld, 'ms', 9000, 'cls', 'new_floor', 'correct', false),
    jsonb_build_object('client_event_id', 'b-ans-0002', 'item_id', pg_temp.c('q2'), 'chosen', 1, 'local_date', ld, 'ms', 12000, 'cls', 'new_floor'),
    jsonb_build_object('client_event_id', 'b-ans-0003', 'item_id', pg_temp.c('q3'), 'chosen', null, 'local_date', ld, 'ms', 200000, 'cls', 'new_floor'),
    jsonb_build_object('client_event_id', 'b-ans-0004', 'item_id', pg_temp.c('q4'), 'chosen', 'A', 'local_date', ld),
    jsonb_build_object('client_event_id', 'b-ans-0005', 'item_id', pg_temp.c('q8'), 'text', '  ЕЛКА. ', 'local_date', ld, 'ms', 15000, 'cls', 'new_fill'),
    jsonb_build_object('client_event_id', 'b-ans-0006', 'item_id', pg_temp.c('q6'), 'chosen', 0, 'local_date', ld),
    jsonb_build_object('client_event_id', 'b-ans-0007', 'item_id', pg_temp.c('q7'), 'chosen', 1, 'rev', 5, 'local_date', ld),
    '5'::jsonb,
    jsonb_build_object('client_event_id', 'b-ans-0008', 'item_id', '00000000-0000-4000-8000-000000000000', 'chosen', 0),
    jsonb_build_object('client_event_id', 'b-ans-0009', 'item_id', pg_temp.c('q9'), 'text', 'invoke', 'local_date', ld, 'cls', 'oops'),
    jsonb_build_object('client_event_id', 'b-ans-0010', 'item_id', pg_temp.c('q5'), 'chosen', jsonb_build_array(2, 0), 'local_date', ld,
                       'shown_order', jsonb_build_array(3, 1, 2, 0), 'session_id', '11111111-2222-4333-8444-555555555555')));
  perform pg_temp.keep('answers', 'record_test_answers', r);
  if r ->> 'server_day' <> ld or (r ->> 'v')::int <> 1 or jsonb_array_length(r -> 'results') <> 11 then raise exception 'FAILED: answers %', r; end if;
  if array(select e ->> 'status' from jsonb_array_elements(r -> 'results') e)
     <> array['saved','saved','saved','invalid','saved','no_key','stale','invalid','gone','saved','saved'] then
    raise exception 'FAILED: statuses in input order %', r; end if;
  if array(select e ->> 'client_event_id' from jsonb_array_elements(r -> 'results') e) is distinct from
     array['b-ans-0001','b-ans-0002','b-ans-0003','b-ans-0004','b-ans-0005','b-ans-0006','b-ans-0007',null,'b-ans-0008','b-ans-0009','b-ans-0010'] then
    raise exception 'FAILED: results not in input order %', r; end if;
  x := r -> 'results' -> 0;
  if x ->> 'step' <> 'start' or (x ->> 'correct')::boolean is not true or x -> 'key' <> '[0]'::jsonb or x ? 'answers'
     or (x -> 'state' ->> 'seen')::int <> 1 or (x -> 'state' ->> 'right')::int <> 1 or x -> 'state' ->> 'streak_day' <> ld
     or x -> 'state' -> 'named_at' = 'null'::jsonb or (x -> 'state' ->> 'checks')::int <> 0
     or (x -> 'state' ->> 'item_rev')::int <> 1 or (x -> 'state' ->> 'was_two_days')::boolean then
    raise exception 'FAILED: first clean right %', x; end if;
  x := r -> 'results' -> 1;
  if x ->> 'step' <> 'miss' or (x ->> 'correct')::boolean or x -> 'key' <> '[0]'::jsonb or x -> 'state' ->> 'peek_day' <> ld
     or x -> 'state' ->> 'last_result' <> 'wrong' or (x -> 'state' ->> 'wrong')::int <> 1 then raise exception 'FAILED: wrong %', x; end if;
  if r -> 'results' -> 2 -> 'state' ->> 'last_result' <> 'dont_know' or r -> 'results' -> 2 ->> 'step' <> 'miss' then
    raise exception 'FAILED: dont know %', r -> 'results' -> 2; end if;
  x := r -> 'results' -> 4;
  if x ->> 'step' <> 'start' or (x ->> 'correct')::boolean is not true or x -> 'answers' <> '["Ёлка","ель."]'::jsonb or x ? 'key' then
    raise exception 'FAILED: short answer normalised %', x; end if;
  if (r -> 'results' -> 6 ->> 'rev')::int <> 1 or pg_temp.st('q7') is not null then raise exception 'FAILED: stale %', r -> 'results' -> 6; end if;
  if r -> 'results' -> 7 -> 'client_event_id' <> 'null'::jsonb then raise exception 'FAILED: not an object %', r -> 'results' -> 7; end if;
  if (r -> 'results' -> 9 ->> 'correct')::boolean is not true then raise exception 'FAILED: short case-free %', r -> 'results' -> 9; end if;
  if (r -> 'results' -> 10 ->> 'correct')::boolean is not true or r -> 'results' -> 10 -> 'key' <> '[0,2]'::jsonb then
    raise exception 'FAILED: multiple order-free %', r -> 'results' -> 10; end if;
  -- What the log keeps: cls and ms of the plan, the typed text, the kind, the shown order, the session; never a client verdict.
  if (select row(cls, ms, correct, kind, step) from public.test_answers where client_event_id = 'b-ans-0001')
     is distinct from row('new_floor'::text, 9000, true, 'single'::text, 'start'::text) then raise exception 'FAILED: log of b-ans-0001'; end if;
  if (select row(ms, chosen) from public.test_answers where client_event_id = 'b-ans-0003') is distinct from row(200000, '{}'::smallint[]) then
    raise exception 'FAILED: log of «Не знаю»'; end if;
  if (select row(answer_text, kind, cls) from public.test_answers where client_event_id = 'b-ans-0005')
     is distinct from row('  ЕЛКА. '::text, 'short'::text, 'new_fill'::text) then raise exception 'FAILED: log of a short answer'; end if;
  if (select cls from public.test_answers where client_event_id = 'b-ans-0009') is not null then raise exception 'FAILED: unknown cls kept'; end if;
  if (select row(shown_order, chosen, session_id) from public.test_answers where client_event_id = 'b-ans-0010')
     is distinct from row('{3,1,2,0}'::smallint[], '{0,2}'::smallint[], '11111111-2222-4333-8444-555555555555'::uuid) then
    raise exception 'FAILED: shown order kept'; end if;

  r := pg_temp.ans('q1', '"chosen":0', 'b-ans-0001');
  if r ->> 'status' <> 'duplicate' then raise exception 'FAILED: duplicate %', r; end if;
  r := pg_temp.ans('q2', '"chosen":0', 'b-ans-0001');
  if r ->> 'status' <> 'conflict' then raise exception 'FAILED: conflict %', r; end if;
  -- The same day again: too early (named_at moves, nothing counts).
  r := pg_temp.ans('q1', '"chosen":0', 'b-ans-0011');
  if r ->> 'step' <> 'too_early' or (pg_temp.st('q1')).seen <> 2 or (pg_temp.st('q1')).two_days_at is not null then
    raise exception 'FAILED: same day again %', r; end if;
  -- After the key was seen today: training; it does not change «ошибок сейчас» (last_result stays wrong).
  r := pg_temp.ans('q2', '"chosen":0', 'b-ans-0012');
  s := pg_temp.st('q2');
  if r ->> 'step' <> 'training' or s.seen <> 2 or s.right_count <> 1 or s.wrong_count <> 1 or s.last_result <> 'wrong'
     or s.streak_at is not null or s.clean_ok_at is not null then raise exception 'FAILED: right after seeing the key % %', r, s; end if;
  -- A retry: not counted in seen; a right retry is training, a wrong one a miss (wrong+1).
  r := pg_temp.ans('q2', '"chosen":0', 'b-ans-0013', ',"retry":true');
  if r ->> 'step' <> 'training' or (pg_temp.st('q2')).seen <> 2 then raise exception 'FAILED: right retry %', r; end if;
  r := pg_temp.ans('q2', '"chosen":2', 'b-ans-0014', ',"retry":true');
  s := pg_temp.st('q2');
  if r ->> 'step' <> 'miss' or s.seen <> 2 or s.wrong_count <> 2 or s.right_count <> 1 then raise exception 'FAILED: wrong retry % %', r, s; end if;
  -- «Нажали не туда?» on a first sight: a peek — counters unchanged, the item is seen today, a right answer today is training.
  r := pg_temp.ans('q4', '"chosen":2', 'b-ans-0015', ',"misclick":true');
  s := pg_temp.st('q4');
  if r ->> 'step' <> 'misclick' or (r ->> 'correct')::boolean or s.wrong_count <> 0 or s.seen <> 0 or s.peek_day <> d
     or s.first_seen_day <> d or s.last_result is not null then
    raise exception 'FAILED: misclick % %', r, s; end if;
  r := pg_temp.ans('q4', '"chosen":0', 'b-ans-0016');
  if r ->> 'step' <> 'training' or (pg_temp.st('q4')).seen <> 1 then raise exception 'FAILED: right after a misclick %', r; end if;
  -- «Не знаю» pressed by mistake and marked «Нажали не туда?» is a peek too: nothing counts against the item.
  s := pg_temp.st('q3');
  r := pg_temp.ans('q3', '"chosen":null', 'b-ans-0017', ',"misclick":true');
  if r ->> 'step' <> 'misclick' or r ->> 'status' <> 'saved' or (r ->> 'correct')::boolean
     or (pg_temp.st('q3')).wrong_count <> s.wrong_count or (pg_temp.st('q3')).seen <> s.seen or (pg_temp.st('q3')).peek_day <> d then
    raise exception 'FAILED: «Не знаю» marked as a misclick % %', r, pg_temp.st('q3'); end if;
  if (select row(misclick, step, chosen) from public.test_answers where client_event_id = 'b-ans-0017')
     is distinct from row(true, 'misclick'::text, '{}'::smallint[]) then raise exception 'FAILED: log of a «Не знаю» misclick'; end if;
  -- a misclick flag under a right answer changes nothing: it is a right answer
  r := pg_temp.ans('t2', '"chosen":1', 'b-ans-0029', ',"misclick":true');
  if r ->> 'step' <> 'start' or (select misclick from public.test_answers where client_event_id = 'b-ans-0029') then
    raise exception 'FAILED: misclick under a right answer %', r; end if;
  -- multiple: all or nothing, in any order
  r := pg_temp.ans('q5', '"chosen":[0]', 'b-ans-0018');
  if (r ->> 'correct')::boolean is not false or r ->> 'step' <> 'miss' then raise exception 'FAILED: multiple all-or-nothing %', r; end if;
  r := pg_temp.ans('q5', '"chosen":[0,1,2]', 'b-ans-0019');
  if (r ->> 'correct')::boolean is not false then raise exception 'FAILED: multiple with an extra %', r; end if;
  -- invalid shapes: nothing recorded
  r := pg_temp.ans('q1', '"chosen":[0,1]', 'b-ans-0020');
  if r ->> 'status' <> 'invalid' then raise exception 'FAILED: two on a single %', r; end if;
  r := pg_temp.ans('q8', '"text":"   "', 'b-ans-0021');
  if r ->> 'status' <> 'invalid' then raise exception 'FAILED: empty short text %', r; end if;
  r := pg_temp.ans('q8', '"chosen":0', 'b-ans-0022');
  if r ->> 'status' <> 'invalid' then raise exception 'FAILED: chosen on a short item %', r; end if;
  r := pg_temp.ans('q1', '"text":"x"', 'b-ans-0023');
  if r ->> 'status' <> 'invalid' then raise exception 'FAILED: no chosen on a single %', r; end if;
  r := pg_temp.ans('q7', '"chosen":1', 'b-ans-0024', ',"shown_order":[0,0,1]');
  if r ->> 'status' <> 'invalid' then raise exception 'FAILED: shown_order %', r; end if;
  r := pg_temp.ans('q8', format('"text":%s', to_jsonb(repeat('я', 1001))), 'b-ans-0025');
  if r ->> 'status' <> 'invalid' then raise exception 'FAILED: a text over 1000 characters %', r; end if;
  -- short: «Не знаю» is a miss; a near miss is wrong
  r := pg_temp.ans('q9', '"text":null', 'b-ans-0026');
  if r ->> 'step' <> 'miss' or (pg_temp.st('q9')).last_result <> 'dont_know' then raise exception 'FAILED: short «Не знаю» %', r; end if;
  r := pg_temp.ans('q8', '"text":"ель.."', 'b-ans-0027');
  if (r ->> 'correct')::boolean or r ->> 'step' <> 'miss' then raise exception 'FAILED: ель.. %', r; end if;
  perform pg_temp.expect_error($$select public.record_test_answers((select jsonb_agg(jsonb_build_object('client_event_id', 'bulk-' || g, 'item_id', gen_random_uuid(), 'chosen', 0)) from generate_series(1, 51) g))$$,
                               '22023', '51 answers refused');
  perform pg_temp.expect_error($$select public.record_test_answers('[]')$$, '22023', 'no answers');
  perform pg_temp.expect_error($$select public.record_test_answers('{"a":1}')$$, '22023', 'not an array');
  -- a far local_date is clamped in the log and the state alike
  r := public.record_test_answers(format('[{"client_event_id":"b-ans-0028","item_id":"%s","chosen":0,"local_date":"2030-02-31"}]', pg_temp.c('q3'))::jsonb) -> 'results' -> 0;
  if (select local_date from public.test_answers where client_event_id = 'b-ans-0028') <> d or (pg_temp.st('q3')).last_answer_day <> d then
    raise exception 'FAILED: clamp'; end if;
  -- B's log rows are B's only; correctness came from the key
  select count(*) into n from public.test_answers;
  if n <> 19 then raise exception 'FAILED: log rows %', n; end if;  -- 6 of the first call + 13 single answers; duplicates, conflicts, invalid ones and errors leave nothing
  -- RLS has no UPDATE/DELETE policy on the log or the states: a client's write changes nothing (0 rows), or is
  -- refused outright once the revokes file has run (42501). Either way nothing moves.
  begin
    update public.test_answers set correct = true where not correct;
    get diagnostics n = row_count; if n <> 0 then raise exception 'FAILED: member edited the log (% rows)', n; end if;
  exception when insufficient_privilege then null; end;
  begin
    update public.test_item_states set two_days_at = now();
    get diagnostics n = row_count; if n <> 0 then raise exception 'FAILED: member edited states (% rows)', n; end if;
  exception when insufficient_privilege then null; end;
  begin
    delete from public.test_answers;
    get diagnostics n = row_count; if n <> 0 then raise exception 'FAILED: member deleted the log'; end if;
  exception when insufficient_privilege then null; end;
end
$t$;

-- 3b. The day rules on the real path (time moved by hand as postgres: the streak started 21 h ago, yesterday). The
--     full table of cases with exact moments is section R.
reset role;
update public.test_item_states set streak_at = now() - interval '21 hours', streak_day = streak_day - 1,
       named_at = now() - interval '21 hours', clean_ok_at = now() - interval '21 hours',
       first_seen_day = first_seen_day - 1, last_answer_day = last_answer_day - 1
 where item_id = pg_temp.c('q1')::uuid and user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare r jsonb; s public.test_item_states; d date := (now() at time zone 'utc')::date;
begin
  r := pg_temp.ans('q1', '"chosen":0', 'b-ans-0101');
  s := pg_temp.st('q1');
  if r ->> 'step' <> 'two_days' or s.two_days_day <> d or s.checks <> 0 or s.named_at <> now() or s.two_days_at <> now() then
    raise exception 'FAILED: two days % %', r, s; end if;
  r := pg_temp.ans('q1', '"chosen":0', 'b-ans-0102');
  if r ->> 'step' <> 'early' or (pg_temp.st('q1')).checks <> 0 then raise exception 'FAILED: early %', r; end if;
  if (select row(two_days_before, due_before, checks_before) from public.test_answers where client_event_id = 'b-ans-0102')
     is distinct from row(true, now() + interval '120 hours', 0::smallint) then raise exception 'FAILED: due_before of an early answer'; end if;
end
$t$;
-- Five days and a minute after the last naming: the check is due.
reset role;
update public.test_item_states set named_at = now() - interval '120 hours 1 minute', two_days_at = now() - interval '121 hours'
 where item_id = pg_temp.c('q1')::uuid and user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare r jsonb;
begin
  r := pg_temp.ans('q1', '"chosen":0', 'b-ans-0103');
  if r ->> 'step' <> 'check' or (pg_temp.st('q1')).checks <> 1 or (pg_temp.st('q1')).named_at <> now() then raise exception 'FAILED: check %', r; end if;
end
$t$;
-- Four days and a minute after the last naming, checks 1 (+12 days): early — unless the subject's date is tomorrow
-- (the exam-eve rule: at most 4 days), then it is a check.
reset role;
update public.test_item_states set named_at = now() - interval '96 hours 1 minute'
 where item_id = pg_temp.c('q1')::uuid and user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare r jsonb; d date := (now() at time zone 'utc')::date;
begin
  r := pg_temp.ans('q1', '"chosen":0', 'b-ans-0104');
  if r ->> 'step' <> 'early' then raise exception 'FAILED: +12 days not reached %', r; end if;
end
$t$;
reset role;
update public.test_item_states set named_at = now() - interval '96 hours 1 minute'
 where item_id = pg_temp.c('q1')::uuid and user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.container_subjects set exam_date = (now() at time zone 'utc')::date + 1 where id = pg_temp.c('s1')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare r jsonb; d date := (now() at time zone 'utc')::date;
begin
  r := pg_temp.ans('q1', '"chosen":0', 'b-ans-0105');
  if r ->> 'step' <> 'check' or (pg_temp.st('q1')).checks <> 2 then raise exception 'FAILED: exam-eve check %', r; end if;
  -- an older local day arriving after a newer one: journal only, the state comes back unchanged
  r := public.record_test_answers(format('[{"client_event_id":"b-ans-0106","item_id":"%s","chosen":1,"local_date":"%s"}]',
         pg_temp.c('q1'), to_char(d - 1, 'YYYY-MM-DD'))::jsonb) -> 'results' -> 0;
  if r ->> 'status' <> 'late' or r ->> 'step' <> 'late' or (pg_temp.st('q1')).wrong_count <> 0 or (r -> 'state' ->> 'checks')::int <> 2
     or (select local_date from public.test_answers where client_event_id = 'b-ans-0106') <> d - 1 then
    raise exception 'FAILED: late %', r; end if;
  -- a wrong answer after «верно в два разных дня» takes it out of the figure
  r := pg_temp.ans('q1', '"chosen":1', 'b-ans-0107');
  if (pg_temp.st('q1')).two_days_at is not null or (pg_temp.st('q1')).checks <> 0 or not (pg_temp.st('q1')).was_two_days
     or r -> 'state' ->> 'was_two_days' <> 'true' then raise exception 'FAILED: lost %', r; end if;
  if (select row(two_days_before, checks_before, due_before is not null) from public.test_answers where client_event_id = 'b-ans-0107')
     is distinct from row(true, 2::smallint, true) then raise exception 'FAILED: the log keeps the state before the miss'; end if;
end
$t$;
reset role;
update public.container_subjects set exam_date = null where id = pg_temp.c('s1')::uuid;
set local role authenticated;

-- 4. A stranger cannot answer; plan settings; doubts; the author fixes keys (single and short).
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb;
begin
  r := pg_temp.ans('q7', '"chosen":1', 'c-ans-0001');
  if r ->> 'status' <> 'gone' then raise exception 'FAILED: stranger answered %', r; end if;
  perform pg_temp.expect_error(format($$select public.container_summary(%L)$$, pg_temp.c('c')), 'P0002', 'stranger summary');
  perform pg_temp.expect_error(format($$select public.plan_inputs(null, %L)$$, pg_temp.c('c')), 'P0002', 'stranger plan inputs');
  perform pg_temp.expect_error(format($$insert into public.container_plans (container_id, minutes_per_day) values (%L, 45)$$, pg_temp.c('c')),
                               '42501', 'stranger plan row');
  perform pg_temp.expect_error(format($$select public.test_key_doubt(%L)$$, pg_temp.c('q7')), 'P0002', 'stranger doubt');
  if jsonb_array_length(public.containers_overview(null) -> 'containers') <> 0 then raise exception 'FAILED: stranger overview'; end if;
end
$t$;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare r jsonb; p jsonb;
begin
  insert into public.container_plans (container_id, minutes_per_day) values (pg_temp.c('c')::uuid, 45);
  update public.container_plans set minutes_per_day = 30 where container_id = pg_temp.c('c')::uuid;
  r := public.test_key_doubt(pg_temp.c('q4')::uuid, '[1]'::jsonb, 'В файле, кажется, ошибка');
  perform pg_temp.keep('doubt', 'test_key_doubt', r);
  r := public.test_key_doubt(pg_temp.c('q7')::uuid, '[2]'::jsonb, '');
  r := public.test_key_doubt_withdraw(pg_temp.c('q7')::uuid);
  perform pg_temp.keep('doubt_withdraw', 'test_key_doubt_withdraw', r);
  if (r ->> 'open')::boolean then raise exception 'FAILED: withdraw %', r; end if;
  r := public.containers_overview(to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD'));
  if (r -> 'containers' -> 0 -> 'subjects' -> 0 ->> 'doubted')::int <> 1 or (r -> 'containers' -> 0 -> 'settings' ->> 'minutes_per_day')::int <> 30 then
    raise exception 'FAILED: overview doubted/settings %', r -> 'containers' -> 0; end if;
  -- the doubted item leaves the plan: not in items, and doubted stays [] (no index points at a missing item)
  p := public.plan_inputs(null, pg_temp.c('c')::uuid);
  if exists (select 1 from jsonb_array_elements(p -> 'items') it where it ->> 0 = pg_temp.c('q4'))
     or p -> 'doubted' <> '[]'::jsonb or jsonb_array_length(p -> 'items') <> 9 then
    raise exception 'FAILED: plan inputs keep the doubted item out %', p -> 'items'; end if;
end
$t$;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb;
begin
  r := public.container_doubts(pg_temp.c('c')::uuid);
  if jsonb_array_length(r) <> 1 or (r -> 0 ->> 'doubts')::int <> 1 or r -> 0 -> 'notes' -> 0 #>> '{}' <> 'В файле, кажется, ошибка'
     or r -> 0 -> 'proposed' <> '[[1]]'::jsonb then
    raise exception 'FAILED: author doubts %', r; end if;
  -- a typo fix keeps progress
  r := public.container_item_update(pg_temp.c('q2')::uuid, '{"stem":"a -= 1 делает с a"}');
  if (r ->> 'rev_changed')::boolean then raise exception 'FAILED: typo bumped rev %', r; end if;
  -- the same key in another order is the same key
  r := public.container_item_update(pg_temp.c('q5')::uuid, '{"correct":[0,2]}');
  if (r ->> 'rev_changed')::boolean then raise exception 'FAILED: reordered key bumped rev %', r; end if;
  -- the key of q1 changes: rev 2 for everyone, B's doubt about q4 untouched, a key-change row
  r := public.container_item_update(pg_temp.c('q1')::uuid, '{"correct":[1]}');
  perform pg_temp.keep('item_updated', 'container_item_update', r);
  if (r ->> 'rev')::int <> 2 or not (r ->> 'rev_changed')::boolean then raise exception 'FAILED: key fix %', r; end if;
  if (select count(*) from public.test_item_key_changes) <> 1 then raise exception 'FAILED: key change logged'; end if;
  if (select key_source from public.test_items where id = pg_temp.c('q1')::uuid) <> 'manual' then
    raise exception 'FAILED: manual key source'; end if;
  -- short: case, spaces and ё of an accepted form keep progress; another accepted set raises rev
  r := public.container_item_update(pg_temp.c('q8')::uuid, '{"answers":["ёлка","  Ель "]}');
  if (r ->> 'rev_changed')::boolean then raise exception 'FAILED: a cosmetic edit of accepted answers bumped rev %', r; end if;
  r := public.container_item_update(pg_temp.c('q8')::uuid, '{"answers":["Ёлка","ель","сосна"]}');
  if not (r ->> 'rev_changed')::boolean or (r ->> 'rev')::int <> 2 then raise exception 'FAILED: answers change %', r; end if;
  if (select new_answers from public.test_item_key_changes where item_id = pg_temp.c('q8')::uuid) <> array['Ёлка', 'ель', 'сосна'] then
    raise exception 'FAILED: answers change logged'; end if;
  -- the number of options and the kind raise rev too (a scratch item, deleted again)
  r := public.container_items_add(pg_temp.c('s3')::uuid, '[{"ref":"imp3:9","stem":"Черновик","options":["a","b"],"correct":[1]}]');
  r := public.container_item_update((r -> 'items' -> 0 ->> 'id')::uuid, '{"options":["a","b","c"]}');
  if (r ->> 'rev')::int <> 2 then raise exception 'FAILED: option count %', r; end if;
  r := public.container_item_update((r ->> 'id')::uuid, '{"kind":"multiple"}');
  if (r ->> 'rev')::int <> 3 then raise exception 'FAILED: kind change %', r; end if;
  r := public.container_item_update((r ->> 'id')::uuid, '{"options":["а","b","c"],"file_no":"12","topic":3,"keep_order":true}');
  if (r ->> 'rev')::int <> 3 or (r ->> 'rev_changed')::boolean then raise exception 'FAILED: a text edit %', r; end if;
  delete from public.test_items where id = (r ->> 'id')::uuid;
  perform pg_temp.expect_error(format($$select public.container_item_update(%L, '{"answers":[]}')$$, pg_temp.c('q8')), '22023', 'short without answers');
  perform pg_temp.expect_error(format($$select public.container_item_update(%L, '{"answers":["a"]}')$$, pg_temp.c('q7')), '22023', 'answers on a single');
  perform pg_temp.expect_error(format($$select public.container_item_update(%L, '{"kind":"short"}')$$, pg_temp.c('q7')), '22023', 'short with options');
  perform pg_temp.expect_error(format($$select public.container_item_update(%L, '{"correct":[9]}')$$, pg_temp.c('q3')), '22023', 'bad key fix');
  perform pg_temp.expect_error(format($$select public.container_item_update(%L, '{"topic":0}')$$, pg_temp.c('q3')), '22023', 'topic 0');
  perform pg_temp.expect_error(format($$select public.container_item_update(%L, '{"code":"yes"}')$$, pg_temp.c('q3')), '22023', 'code not a boolean');
  -- the author keeps the key of q4: B's doubt resolves
  r := public.container_doubt_keep(pg_temp.c('q4')::uuid);
  perform pg_temp.keep('doubt_keep', 'container_doubt_keep', r);
  if (r ->> 'resolved')::int <> 1 then raise exception 'FAILED: keep %', r; end if;
  -- «Сомневаюсь в ключе» sets an item aside for its author too (spec decision 37): out of the author's plan, counted
  -- in the author's facts and in the list of doubts; withdrawing brings it back.
  r := public.test_key_doubt(pg_temp.c('t1')::uuid, '[1]', 'Проверю по учебнику');
  if (r ->> 'open')::boolean is not true then raise exception 'FAILED: the author doubts %', r; end if;
  if exists (select 1 from jsonb_array_elements(public.plan_inputs(null, pg_temp.c('c')::uuid) -> 'items') it where it ->> 0 = pg_temp.c('t1'))
     or (public.containers_overview(null) -> 'containers' -> 0 -> 'subjects' -> 2 ->> 'doubted')::int <> 1
     or not exists (select 1 from jsonb_array_elements(public.container_doubts(pg_temp.c('c')::uuid)) e
                     where e ->> 'item_id' = pg_temp.c('t1') and (e ->> 'doubts')::int = 1) then
    raise exception 'FAILED: the author''s own doubt sets the item aside'; end if;
  r := public.test_key_doubt_withdraw(pg_temp.c('t1')::uuid);
  if (r ->> 'open')::boolean or not exists (select 1 from jsonb_array_elements(public.plan_inputs(null, pg_temp.c('c')::uuid) -> 'items') it
                                             where it ->> 0 = pg_temp.c('t1')) then
    raise exception 'FAILED: the author withdraws %', r; end if;
end
$t$;

select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare r jsonb; o jsonb;
begin
  o := public.containers_overview(null) -> 'containers' -> 0 -> 'subjects' -> 0;
  if (o ->> 'stale')::int <> 2 or (o ->> 'doubted')::int <> 0 then raise exception 'FAILED: stale after key fixes %', o; end if;
  r := public.container_summary(pg_temp.c('c')::uuid);
  if (r ->> 'key_changes_unseen')::int <> 2 then raise exception 'FAILED: key changes unseen %', r ->> 'key_changes_unseen'; end if;
  r := pg_temp.ans('q1', '"chosen":0', 'b-ans-0201', ',"rev":1');
  if r ->> 'status' <> 'stale' or (r ->> 'rev')::int <> 2 then raise exception 'FAILED: answer to the old key %', r; end if;
  r := pg_temp.ans('q1', '"chosen":1', 'b-ans-0202', ',"rev":2');
  if r ->> 'step' <> 'start' or (pg_temp.st('q1')).seen <> 1 or (pg_temp.st('q1')).item_rev <> 2 or (pg_temp.st('q1')).was_two_days then
    raise exception 'FAILED: restart after key fix % %', r, pg_temp.st('q1'); end if;
  r := pg_temp.ans('q8', '"text":"Сосна"', 'b-ans-0203');
  if r ->> 'step' <> 'start' or r -> 'answers' <> '["Ёлка","ель","сосна"]'::jsonb then raise exception 'FAILED: the new short key %', r; end if;
  if (public.container_summary(pg_temp.c('c')::uuid) ->> 'key_changes_unseen')::int <> 0 then raise exception 'FAILED: key changes seen'; end if;
  -- «Как на экзамене»: four answers, one unanswered; resent → the same run
  r := public.container_mock_finish(jsonb_build_object('client_run_id', 'mock-run-0001', 'container_id', pg_temp.c('c'),
         'local_date', to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD'), 'time_limit_s', 600, 'duration_s', 410,
         'subject_ids', jsonb_build_array(pg_temp.c('s1')),
         'answers', jsonb_build_array(
            jsonb_build_object('client_event_id', 'mock-a-0001', 'item_id', pg_temp.c('q7'), 'chosen', 1),
            jsonb_build_object('client_event_id', 'mock-a-0002', 'item_id', pg_temp.c('q3'), 'chosen', 2),
            jsonb_build_object('client_event_id', 'mock-a-0003', 'item_id', pg_temp.c('q4'), 'chosen', null),
            jsonb_build_object('client_event_id', 'mock-a-0004', 'item_id', pg_temp.c('q9'), 'text', 'Invoke', 'retry', true, 'misclick', true))));
  perform pg_temp.keep('mock', 'container_mock_finish', r);
  if (r ->> 'items')::int <> 4 or (r ->> 'correct')::int <> 2 or (r ->> 'unanswered')::int <> 1 or (r ->> 'duplicate')::boolean then
    raise exception 'FAILED: mock %', r; end if;
  if (select count(*) from public.test_answers where mode = 'mock' and session_id = (r ->> 'run_id')::uuid and not retry and not misclick) <> 4 then
    raise exception 'FAILED: mock answers in the log'; end if;
  r := public.container_mock_finish(jsonb_build_object('client_run_id', 'mock-run-0001', 'container_id', pg_temp.c('c'),
         'answers', '[{"client_event_id":"mock-a-0009","item_id":"00000000-0000-4000-8000-000000000000","chosen":0}]'::jsonb));
  perform pg_temp.keep('mock_again', 'container_mock_finish', r);
  if (r ->> 'duplicate')::boolean is not true then raise exception 'FAILED: mock resend %', r; end if;
  perform pg_temp.expect_error(format($$select public.container_mock_finish('{"client_run_id":"mock-run-0002","container_id":"%s","answers":[]}')$$, pg_temp.c('c')),
                               '22023', 'empty mock run');
  -- a run holds answers of its own container only (B's own scratch container, deleted again)
  r := public.container_create('Своё', null, '[{"title":"x"}]');
  o := public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, '[{"ref":"own:1","stem":"Своё","options":["a","b"],"correct":[0]}]');
  perform pg_temp.expect_error(format($$select public.container_mock_finish('{"client_run_id":"mock-run-0003","container_id":"%s","answers":[{"client_event_id":"mock-x-0001","item_id":"%s","chosen":0}]}')$$,
                                      pg_temp.c('c'), o -> 'items' -> 0 ->> 'id'), '22023', 'a mock run with an answer of another container');
  delete from public.containers where id = (r ->> 'container_id')::uuid;
end
$t$;

-- 4b. plan_inputs and container_summary as B (the member): the whole wire shape, today's start and time, the pace,
--     the AI units (B is PRO with 990 of 1000 used today in the quota baseline).
do $t$
declare p jsonb; c jsonb; x jsonb; d date := (now() at time zone 'utc')::date; v_done bigint; v_first bigint; n int;
begin
  p := public.plan_inputs(to_char(d, 'YYYY-MM-DD'));
  perform pg_temp.keep('plan_member', 'plan_inputs', p);
  if (p ->> 'v')::int <> 1 or p ->> 'day' <> to_char(d, 'YYYY-MM-DD') or jsonb_typeof(p -> 'now') <> 'number'
     or abs((p ->> 'now')::bigint - floor(extract(epoch from now()))) > 1 then raise exception 'FAILED: plan header %', p; end if;
  c := p -> 'containers' -> 0;
  if jsonb_array_length(p -> 'containers') <> 1 or c ->> 'role' <> 'member' or c ->> 'first_plan_day' <> to_char(d, 'YYYY-MM-DD')
     or (c -> 'settings' ->> 'minutes_per_day')::int <> 30 then raise exception 'FAILED: plan container %', c; end if;
  select round(sum(least(coalesce(ms, 0), 180000)) / 1000.0)::bigint into v_done
    from public.test_answers where container_id = pg_temp.c('c')::uuid and local_date = d and mode = 'learn';
  select floor(extract(epoch from min(created_at)))::bigint into v_first
    from public.test_answers where container_id = pg_temp.c('c')::uuid and local_date = d;
  if (c -> 'today' ->> 'done_s')::bigint <> v_done + 410 or (c -> 'today' ->> 'first_at')::bigint <> v_first then
    raise exception 'FAILED: today % (done % + 410, first %)', c -> 'today', v_done, v_first; end if;
  if jsonb_array_length(p -> 'subjects') <> 3 or p -> 'subjects' -> 0 ->> 'test_date' <> to_char(d + 19, 'YYYY-MM-DD')
     or p -> 'subjects' -> 2 ->> 'test_date' <> to_char(d + 25, 'YYYY-MM-DD') or (p -> 'subjects' -> 0 ->> 'topics')::int <> 2
     or (p -> 'subjects' -> 0 ->> 'new_today')::int <> 8 or (p -> 'subjects' -> 2 ->> 'new_today')::int <> 1
     or p -> 'subjects' -> 1 -> 'oral_exam_id' <> 'null'::jsonb then
    raise exception 'FAILED: plan subjects %', p -> 'subjects'; end if;
  -- items: [id, subject, topic, position, kind, rev, slow]
  if exists (select 1 from jsonb_array_elements(p -> 'items') it where jsonb_array_length(it) <> 7) then raise exception 'FAILED: item tuples'; end if;
  select it into x from jsonb_array_elements(p -> 'items') it where it ->> 0 = pg_temp.c('q2');
  if x <> jsonb_build_array(pg_temp.c('q2'), 0, 1, 2, 0, 1, 1) then raise exception 'FAILED: code item row %', x; end if;
  select it into x from jsonb_array_elements(p -> 'items') it where it ->> 0 = pg_temp.c('q5');
  if x <> jsonb_build_array(pg_temp.c('q5'), 0, 2, 5, 1, 1, 1) then raise exception 'FAILED: multiple item row %', x; end if;
  select it into x from jsonb_array_elements(p -> 'items') it where it ->> 0 = pg_temp.c('q8');
  if x <> jsonb_build_array(pg_temp.c('q8'), 0, 1, 8, 2, 2, 0) then raise exception 'FAILED: short item row %', x; end if;
  if exists (select 1 from jsonb_array_elements(p -> 'items') it where it ->> 0 = pg_temp.c('q6')) then raise exception 'FAILED: an item without a key planned'; end if;
  -- states: 14 fields; q1 restarted under rev 2 (a start today)
  if exists (select 1 from jsonb_array_elements(p -> 'states') s where jsonb_array_length(s) <> 14) then raise exception 'FAILED: state tuples'; end if;
  select s into x from jsonb_array_elements(p -> 'states') s
   where (p -> 'items' -> ((s ->> 0)::int) ->> 0) = pg_temp.c('q1');
  if x -> 1 <> '1'::jsonb or x -> 2 <> '0'::jsonb or x -> 3 <> '0'::jsonb or x -> 5 <> '0'::jsonb or x -> 6 <> '0'::jsonb
     or (x ->> 7)::bigint <> ceil(extract(epoch from (pg_temp.st('q1')).streak_at)) or x -> 8 <> 'null'::jsonb
     or (x ->> 9)::bigint <> ceil(extract(epoch from (pg_temp.st('q1')).named_at)) or x -> 10 <> '0'::jsonb or x -> 12 <> '0'::jsonb then
    raise exception 'FAILED: q1 state row %', x; end if;
  select s into x from jsonb_array_elements(p -> 'states') s where (p -> 'items' -> ((s ->> 0)::int) ->> 0) = pg_temp.c('q2');
  if x -> 1 <> '2'::jsonb or x -> 2 <> '2'::jsonb or x -> 5 <> '1'::jsonb or x -> 11 <> '0'::jsonb or x -> 7 <> 'null'::jsonb then
    raise exception 'FAILED: q2 state row %', x; end if;
  -- pace: the plan classes the client sent; retries, misclicks and the mock left out; ms capped at 180 s
  select e into x from jsonb_array_elements(p -> 'pace') e where e ->> 'cls' = 'new_floor' and (e ->> 'subject')::int = 0;
  if x is null or (x ->> 'n')::int <> 3 or (x ->> 'median_ms')::int <> 12000 or (x ->> 'p_wrong')::numeric <> 0.6667 then
    raise exception 'FAILED: pace new_floor %', p -> 'pace'; end if;
  select count(*) into n from jsonb_array_elements(p -> 'pace') e where e ->> 'cls' = 'free';
  if n <> 0 then raise exception 'FAILED: answers without ms counted in the pace %', p -> 'pace'; end if;
  -- AI units: read only from ai_usage (UTC day) and profiles.is_pro
  if p -> 'ai' is null or p -> 'ai' = 'null'::jsonb or (p -> 'ai' ->> 'left')::int <> 10
     or (p -> 'ai' ->> 'resets_at')::bigint <> extract(epoch from (((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc'))::bigint then
    raise exception 'FAILED: ai %', p -> 'ai'; end if;
  c := public.container_summary(pg_temp.c('c')::uuid, to_char(d, 'YYYY-MM-DD'));
  perform pg_temp.keep('summary_member', 'container_summary', c);
  if c ->> 'role' <> 'member' or c -> 'owner' <> 'null'::jsonb or c ->> 'first_plan_day' <> to_char(d, 'YYYY-MM-DD')
     or jsonb_array_length(c -> 'mock_runs') <> 1 or c -> 'mock_runs' -> 0 -> 'subject_ids' <> jsonb_build_array(pg_temp.c('s1'))
     or (c -> 'mock_runs' -> 0 ->> 'items')::int <> 4 or (c -> 'settings' ->> 'minutes_per_day')::int <> 30 then
    raise exception 'FAILED: member summary %', c; end if;
  if c -> 'subjects' -> 0 -> 'kinds' <> '{"single": 5, "multiple": 1, "short": 2}'::jsonb
     or c -> 'subjects' -> 2 -> 'kinds' <> '{"single": 2, "multiple": 0, "short": 0}'::jsonb then
    raise exception 'FAILED: kinds %', c -> 'subjects'; end if;
  -- topic 1: q1 q2 q7 q8 (q6 has no key), q2 wrong; topic 2: q3 q4 q5, all wrong now; q9 has no topic (its error counts
  -- for the subject only)
  if c -> 'subjects' -> 0 -> 'topics' <> '[{"topic": 1, "keyed": 4, "seen": 4, "two_days": 0, "open_errors": 1},
                                           {"topic": 2, "keyed": 3, "seen": 3, "two_days": 0, "open_errors": 3}]'::jsonb
     or (c -> 'subjects' -> 0 ->> 'open_errors')::int <> 5 or (c -> 'subjects' -> 2 -> 'topics') <> '[{"topic": 1, "keyed": 1, "seen": 1, "two_days": 0, "open_errors": 0}]'::jsonb then
    raise exception 'FAILED: topics with open errors %', c -> 'subjects'; end if;
  perform pg_temp.keep('overview_member', 'containers_overview', public.containers_overview(to_char(d, 'YYYY-MM-DD')));
  perform pg_temp.keep('answer_days', 'test_answer_days', (select jsonb_agg(to_jsonb(t)) from public.test_answer_days(d - 30) t));
end
$t$;

-- 5. The mass-wrong signal: D, E and C join and pick the same wrong option of q3 first; B's first was «Не знаю».
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
select public.container_join(pg_temp.c('code')) is not null;
select pg_temp.ans('q3', '"chosen":2', 'd-ans-0001') is not null;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', true);
select public.container_join(pg_temp.c('code')) is not null;
select pg_temp.ans('q3', '"chosen":2', 'e-ans-0001') is not null;
select pg_temp.ans('q8', '"text":"сосна"', 'e-ans-0002') is not null;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
select public.container_join(pg_temp.c('code')) is not null;
select pg_temp.ans('q3', '"chosen":2', 'c-ans-0002') is not null;
-- The _for cores as the bot will call them (its own SECURITY DEFINER functions, the user resolved by the bot).
reset role;
do $t$
declare E constant uuid := 'eeeeeeee-0000-0000-0000-000000000005'; r jsonb;
begin
  r := meldy_private.record_test_answers_for(E, jsonb_build_array(jsonb_build_object(
         'client_event_id', 'tgq:post-1:12345', 'item_id', pg_temp.c('q7'), 'chosen', 1)), 'bot_group', 1);
  if r -> 'results' -> 0 ->> 'status' <> 'saved' or (select source from public.test_answers where client_event_id = 'tgq:post-1:12345') <> 'bot_group' then
    raise exception 'FAILED: the answer core for the bot %', r; end if;
  if meldy_private.record_test_answers_for(E, jsonb_build_array(jsonb_build_object(
       'client_event_id', 'tgq:post-1:12345', 'item_id', pg_temp.c('q7'), 'chosen', 1)), 'bot_group', 1) -> 'results' -> 0 ->> 'status' <> 'duplicate' then
    raise exception 'FAILED: the bot''s re-delivery is a duplicate'; end if;
  perform pg_temp.expect_error(format($$select meldy_private.record_test_answers_for(%L, '[{"client_event_id":"tgq:x:1","item_id":"%s","chosen":1}]', 'telegram')$$,
                                      E, pg_temp.c('q7')), '22023', 'an unknown source');
  r := meldy_private.test_key_doubt_for(E, pg_temp.c('q7')::uuid, '[2]', 'из бота');
  if r <> jsonb_build_object('item_id', pg_temp.c('q7'), 'open', true)
     or (select row(proposed, note, resolved_at is null) from public.test_key_doubts where item_id = pg_temp.c('q7')::uuid and user_id = E)
        is distinct from row('{2}'::smallint[], 'из бота'::text, true) then
    raise exception 'FAILED: the doubt core %', r; end if;
  r := meldy_private.test_key_doubt_withdraw_for(E, pg_temp.c('q7')::uuid);
  if r <> jsonb_build_object('item_id', pg_temp.c('q7'), 'open', false)
     or (select resolution from public.test_key_doubts where item_id = pg_temp.c('q7')::uuid and user_id = E) <> 'withdrawn' then
    raise exception 'FAILED: the withdraw core %', r; end if;
  perform pg_temp.expect_error(format($$select meldy_private.test_key_doubt_for(null, %L)$$, pg_temp.c('q7')), '28000', 'a doubt without a user');
  perform pg_temp.expect_error(format($$select meldy_private.test_key_doubt_for('ffffffff-0000-0000-0000-00000000000f', %L)$$, pg_temp.c('q7')),
                               'P0002', 'a doubt of a stranger');
  perform pg_temp.expect_error($$select meldy_private.test_key_doubt_withdraw_for(null, gen_random_uuid())$$, '28000', 'a withdraw without a user');
end
$t$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; x jsonb; d date := (now() at time zone 'utc')::date;
begin
  r := public.container_doubts(pg_temp.c('c')::uuid);
  perform pg_temp.keep('doubts', 'container_doubts', r);
  select e into x from jsonb_array_elements(r) e where e ->> 'item_id' = pg_temp.c('q3');
  if x is null or (x ->> 'first_answers')::int <> 4 or x -> 'top_wrong' <> '[2]'::jsonb or (x ->> 'top_wrong_n')::int <> 3 then
    raise exception 'FAILED: mass-wrong signal %', r; end if;
  if exists (select 1 from jsonb_array_elements(r) e where e ->> 'item_id' = pg_temp.c('q8')) then
    raise exception 'FAILED: a short item without doubts listed %', r; end if;
  r := public.container_members_list(pg_temp.c('c')::uuid);
  perform pg_temp.keep('members', 'container_members_list', r);
  if jsonb_array_length(r) <> 4 or r -> 0 ->> 'name' <> 'Борис' or not exists (select 1 from jsonb_array_elements(r) e where e ->> 'name' = 'Без имени') then
    raise exception 'FAILED: members list %', r; end if;
  r := public.container_summary(pg_temp.c('c')::uuid);
  perform pg_temp.keep('summary_owner', 'container_summary', r);
  if (r -> 'owner' ->> 'members')::int <> 4 or r ->> 'role' <> 'owner' or jsonb_array_length(r -> 'subjects' -> 0 -> 'topics') <> 2
     or r ->> 'first_plan_day' <> to_char(d, 'YYYY-MM-DD') or (r -> 'owner' ->> 'doubts_open')::int <> 0
     or jsonb_array_length(r -> 'owner' -> 'links') <> 1 or (r -> 'owner' -> 'links' -> 0 ->> 'oral')::int <> 1
     or (r -> 'subjects' -> 1 -> 'oral' ->> 'questions')::int <> 1 or (r -> 'key_changes_unseen')::int <> 0
     or (r -> 'items_version' ->> 'count')::int <> 11 then
    raise exception 'FAILED: owner summary %', r; end if;
  perform pg_temp.keep('overview_owner', 'containers_overview', public.containers_overview(to_char(d, 'YYYY-MM-DD')));
  r := public.plan_inputs(to_char(d, 'YYYY-MM-DD'), pg_temp.c('c')::uuid);
  perform pg_temp.keep('plan_owner', 'plan_inputs', r);
  if r -> 'containers' -> 0 ->> 'role' <> 'owner' or (r -> 'ai' ->> 'left')::int <> 88 or r -> 'states' <> '[]'::jsonb
     or r -> 'containers' -> 0 -> 'today' -> 'first_at' <> 'null'::jsonb or (r -> 'containers' -> 0 -> 'today' ->> 'done_s')::int <> 0
     or r -> 'containers' -> 0 -> 'settings' <> '{"minutes_per_day": 60, "study_weekdays": 127}'::jsonb then
    raise exception 'FAILED: owner plan inputs %', r; end if;
  -- remove D: {removed: 1}; a second time changes nobody
  r := public.container_member_remove(pg_temp.c('c')::uuid, 'dddddddd-0000-0000-0000-000000000004');
  perform pg_temp.keep('member_removed', 'container_member_remove', r);
  if r <> '{"removed": 1}'::jsonb then raise exception 'FAILED: remove D %', r; end if;
  if public.container_member_remove(pg_temp.c('c')::uuid, 'dddddddd-0000-0000-0000-000000000004') <> '{"removed": 0}'::jsonb then
    raise exception 'FAILED: remove D twice'; end if;
  perform pg_temp.expect_error(format($$select public.container_member_remove(%L, 'ffffffff-0000-0000-0000-000000000009')$$, pg_temp.c('c')),
                               'P0002', 'remove a stranger');
end
$t$;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
do $t$
declare n int; r jsonb;
begin
  select count(*) into n from public.test_items; if n <> 0 then raise exception 'FAILED: removed member reads items'; end if;
  r := public.container_link_preview(pg_temp.c('code'));
  perform pg_temp.keep('preview_removed', 'container_link_preview', r);
  if r <> '{"status": "removed"}'::jsonb then raise exception 'FAILED: removed preview %', r; end if;
  perform pg_temp.expect_error(format($$select public.container_join(%L)$$, pg_temp.c('code')), 'MC006', 'removed rejoins');
  if (pg_temp.ans('q7', '"chosen":1', 'd-ans-0002') ->> 'status') <> 'gone' then raise exception 'FAILED: removed answers'; end if;
  select count(*) into n from public.test_item_states; if n <> 1 then raise exception 'FAILED: removed member keeps own state rows (%).', n; end if;
  if jsonb_array_length(public.containers_overview(null) -> 'containers') <> 0 then raise exception 'FAILED: removed member overview'; end if;
end
$t$;

-- 6. The oral part reaches B as a COPY through the unchanged exam_share_* functions.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare r jsonb; v_code text; v_bundle jsonb; v_copy uuid := gen_random_uuid(); v_mat uuid := gen_random_uuid(); n int;
begin
  r := public.container_oral_codes(pg_temp.c('c')::uuid);
  perform pg_temp.keep('oral_codes', 'container_oral_codes', r);
  if r ->> 'status' <> 'open' or jsonb_array_length(r -> 'subjects') <> 1 or r -> 'subjects' -> 0 -> 'existing_exam_id' <> 'null'::jsonb then
    raise exception 'FAILED: oral codes %', r; end if;
  v_code := r -> 'subjects' -> 0 ->> 'code';
  v_bundle := public.exam_share_bundle(v_code);   -- the oral bundle, unchanged function
  if jsonb_array_length(v_bundle -> 'questions') <> 1 or v_bundle -> 'exam' ->> 'title' <> 'Базы данных: билеты' then
    raise exception 'FAILED: bundle %', v_bundle; end if;
  r := public.exam_share_join(v_code, jsonb_build_object('v', 1,
         'exam', jsonb_build_object('id', v_copy, 'title', 'Базы данных: билеты', 'kind', 'exam',
                                    'exam_date', to_char((now() at time zone 'utc')::date + 19, 'YYYY-MM-DD'),
                                    'mapping_state', 'done', 'mapped_material_ids', jsonb_build_array(v_mat)),
         'materials', jsonb_build_array(jsonb_build_object('id', v_mat, 'title', 'Денежный рынок', 'subject', '', 'original_text', 'Текст лекции')),
         'links', jsonb_build_array(jsonb_build_object('material_id', v_mat)),
         'questions', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'position', 1, 'label', '1', 'section', null,
                                         'text', 'Нормальные формы отношений', 'coverage', 'full')),
         'rubrics', '[]'::jsonb));
  if (r ->> 'exam_id')::uuid <> v_copy then raise exception 'FAILED: oral join %', r; end if;
  -- binding: only that copy; not B's own unrelated exam
  perform pg_temp.expect_error(format($$select public.container_bind_copy(%L, 'e0000000-0000-4000-8000-0000000000b9')$$, pg_temp.c('s2')),
                               '42501', 'bind a non-copy');
  r := public.container_bind_copy(pg_temp.c('s2')::uuid, v_copy);
  perform pg_temp.keep('bound', 'container_bind_copy', r);
  if (r ->> 'exam_id')::uuid <> v_copy then raise exception 'FAILED: bind %', r; end if;
  r := public.containers_overview(null);
  if (r -> 'containers' -> 0 -> 'subjects' -> 1 ->> 'oral_exam_id')::uuid <> v_copy or not (r -> 'attached_exam_ids' @> to_jsonb(array[v_copy])) then
    raise exception 'FAILED: overview oral copy %', r; end if;
  if (public.container_summary(pg_temp.c('c')::uuid) -> 'subjects' -> 1 -> 'oral' ->> 'exam_id')::uuid <> v_copy then
    raise exception 'FAILED: member summary shows the copy'; end if;
  if (public.plan_inputs(null) -> 'subjects' -> 1 ->> 'oral_exam_id')::uuid <> v_copy then raise exception 'FAILED: plan inputs show the copy'; end if;
  if jsonb_array_length(public.container_oral_codes(pg_temp.c('c')::uuid) -> 'subjects') <> 0 then
    raise exception 'FAILED: oral codes after the copy'; end if;
  -- the copy cannot be shared on (the unchanged exam_shares policy sees the seat)
  perform pg_temp.expect_error(format($$insert into public.exam_shares (exam_id, owner_id, code_hash, consent) values (%L, %L, repeat('a', 64), 'Делюсь с группой вопросами и текстом')$$,
                                      v_copy, 'bbbbbbbb-0000-0000-0000-000000000002'), '42501', 'share a copy on');
  -- leaving: no items, the copy and own states stay
  r := public.container_leave(pg_temp.c('c')::uuid);
  perform pg_temp.keep('left', 'container_leave', r);
  select count(*) into n from public.test_items; if n <> 0 then raise exception 'FAILED: left member reads items'; end if;
  select count(*) into n from public.exams where id = v_copy; if n <> 1 then raise exception 'FAILED: copy kept after leaving'; end if;
  r := public.container_join(pg_temp.c('code'));
  if (r ->> 'joined')::boolean is not true then raise exception 'FAILED: rejoin after leaving %', r; end if;
  select count(*) into n from public.test_items; if n <> 11 then raise exception 'FAILED: rejoined reads items'; end if;
  if (public.container_summary(pg_temp.c('c')::uuid) ->> 'first_plan_day') <> to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD') then
    raise exception 'FAILED: first plan day after rejoining'; end if;
end
$t$;

-- 7. The author revokes: no newcomers, no new oral copies; members stay; D comes back.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb;
begin
  r := public.container_link_revoke(pg_temp.c('link')::uuid);
  perform pg_temp.keep('link_revoked', 'container_link_revoke', r);
  if exists (select 1 from public.exam_shares where exam_id = 'e0000000-0000-4000-8000-0000000000c1' and revoked_at is null) then
    raise exception 'FAILED: derived oral share left open'; end if;
  r := public.container_member_remove(pg_temp.c('c')::uuid, 'dddddddd-0000-0000-0000-000000000004', true);
  if r <> '{"removed": 1}'::jsonb then raise exception 'FAILED: restore D %', r; end if;
end
$t$;
reset role;
insert into auth.users (id) values ('ffffffff-0000-0000-0000-000000000006');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'ffffffff-0000-0000-0000-000000000006', true);
do $t$
declare r jsonb;
begin
  perform pg_temp.expect_error(format($$select public.container_join(%L)$$, pg_temp.c('code')), 'MC002', 'newcomer joins a revoked link');
  r := public.container_link_preview(pg_temp.c('code'));
  perform pg_temp.keep('preview_revoked', 'container_link_preview', r);
  if r <> '{"status": "revoked"}'::jsonb then raise exception 'FAILED: revoked preview %', r; end if;
  if public.container_link_preview('zzzzzzzzzzzz') <> '{"status": "not_found"}'::jsonb then raise exception 'FAILED: unknown code'; end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
do $t$
declare n int;
begin
  select count(*) into n from public.test_items; if n <> 11 then raise exception 'FAILED: restored member reads % items', n; end if;
  if (public.container_join(pg_temp.c('code')) ->> 'joined')::boolean is not false then
    raise exception 'FAILED: restored member is in already'; end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare n int;
begin
  select count(*) into n from public.test_items; if n <> 11 then raise exception 'FAILED: member after revoke'; end if;
  if public.container_oral_codes(pg_temp.c('c')::uuid) ->> 'status' <> 'closed' then raise exception 'FAILED: oral after revoke'; end if;
  perform pg_temp.expect_error($$select meldy_private.clamp_day('x')$$, '42501', 'private schema closed to clients');
  perform pg_temp.expect_error($$select * from meldy_private.rule_step(null, 1, now(), current_date, 'right', false, false, null)$$, '42501', 'the rule is not an API');
  perform pg_temp.expect_error(format($$select meldy_private.test_key_doubt_for('bbbbbbbb-0000-0000-0000-000000000002', %L)$$, pg_temp.c('q7')),
                               '42501', 'the doubt core is not an API');
  -- today and yesterday (the late answer keeps its own local day)
  if (select count(*) from public.test_answer_days(((now() at time zone 'utc')::date - 30))) <> 2 then raise exception 'FAILED: answer days'; end if;
  if (select count(*) from public.test_answer_days('2000-01-01')) <> 2 then raise exception 'FAILED: answer days from 2000'; end if;
end
$t$;

-- 8. The author deletes an item: everyone's state of it goes, the log keeps the rows (item_id null).
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
begin
  delete from public.test_items where id = pg_temp.c('q3')::uuid;
  if (select count(*) from public.test_items where id = pg_temp.c('q3')::uuid) <> 0 then raise exception 'FAILED: owner delete'; end if;
end
$t$;
reset role;
do $t$
begin
  if exists (select 1 from public.test_item_states where item_id = pg_temp.c('q3')::uuid) then raise exception 'FAILED: states cascade'; end if;
  if (select count(*) from public.test_answers where client_event_id in ('b-ans-0003', 'd-ans-0001') and item_id is null) <> 2 then
    raise exception 'FAILED: log kept with item_id null'; end if;
end
$t$;

-- 8b. Deleting a container with members: refused; after «Закрыть доступ всем» it goes. An account's deletion cascades.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
set local role authenticated;
do $t$
declare n int; r jsonb;
begin
  perform pg_temp.expect_error(format($$delete from public.containers where id = %L$$, pg_temp.c('c')), 'MC009', 'delete with members');
  r := public.container_member_remove(pg_temp.c('c')::uuid, null);
  if r <> '{"removed": 4}'::jsonb then raise exception 'FAILED: remove everyone %', r; end if;
  delete from public.containers where id = pg_temp.c('c')::uuid;
  get diagnostics n = row_count; if n <> 1 then raise exception 'FAILED: delete after removing everyone'; end if;
end
$t$;
reset role;
do $t$
declare v_c uuid;
begin
  insert into public.containers (owner_id, title) values ('cccccccc-0000-0000-0000-000000000003', 'Удаляемый аккаунт') returning id into v_c;
  insert into public.container_members (container_id, user_id) values (v_c, 'bbbbbbbb-0000-0000-0000-000000000002');
  delete from auth.users where id = 'cccccccc-0000-0000-0000-000000000003';
  if exists (select 1 from public.containers where id = v_c) then raise exception 'FAILED: account deletion did not cascade'; end if;
end
$t$;

-- 9. anon: nothing but the preview.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare n int;
begin
  -- 0 rows under RLS, or refused once the revokes file has run.
  begin
    select count(*) into n from public.containers; if n <> 0 then raise exception 'FAILED: anon reads containers'; end if;
  exception when insufficient_privilege then null; end;
  begin
    select count(*) into n from public.test_items; if n <> 0 then raise exception 'FAILED: anon reads items'; end if;
  exception when insufficient_privilege then null; end;
  -- 28000 (no user) under the grants of the migration, 42501 (no EXECUTE) after the revokes file.
  begin
    perform public.record_test_answers('[{"client_event_id":"anon-0001","item_id":"00000000-0000-4000-8000-000000000000","chosen":0}]');
    raise exception 'FAILED: anon answered';
  exception when sqlstate '28000' or insufficient_privilege then null; end;
  begin
    perform public.containers_overview();
    raise exception 'FAILED: anon overview';
  exception when sqlstate '28000' or insufficient_privilege then null; end;
  begin
    perform public.plan_inputs();
    raise exception 'FAILED: anon plan inputs';
  exception when sqlstate '28000' or insufficient_privilege then null; end;
  begin
    perform public.container_subject_add('00000000-0000-4000-8000-000000000000', '{"title":"x"}');
    raise exception 'FAILED: anon adds a subject';
  exception when sqlstate '28000' or insufficient_privilege then null; end;
  -- the container (and its link) was deleted in 8b
  if public.container_link_preview(pg_temp.c('code')) ->> 'status' <> 'not_found' then raise exception 'FAILED: anon preview after delete'; end if;
end
$t$;
reset role;

-- R. The rule vectors (contracts/container/rule_vectors.json): meldy_private.rule_step and meldy_private.grade_answer —
--    exactly what record_test_answers_for calls — on named cases (asserted here: the expected step of every event and
--    the state fields named in `check`) and on 320 sequences from a seeded md5 generator. Moments are fixed, so the file
--    is the same on every run. Local days are Europe/Minsk days of the moment unless an event gives its own (late).
create temp table rv_case (n integer primary key, id text not null, name text not null, kind text not null default 'single',
                           options integer not null default 3, key jsonb not null default '[0]', exam_day date, events jsonb not null);
create temp table rv_out (n integer primary key, j jsonb not null);
create or replace function pg_temp.ms(p_t timestamptz) returns bigint language sql immutable as $fn$
  select (extract(epoch from p_t) * 1000)::bigint
$fn$;
create or replace function pg_temp.rnd(p_key text) returns double precision language sql immutable as $fn$
  select ('x' || substr(md5(p_key), 1, 8))::bit(32)::bigint / 4294967296.0
$fn$;

insert into rv_case (n, id, name, kind, options, key, exam_day, events) values
(1, 'hand:23-to-15', '23:00, then 15:00 the next day: too early until 19:00 (20 hours); 19:00 meets the rule', 'single', 3, '[0]', null, '[
  {"at":"2026-10-01 23:00:00+03","result":"right","expect":"start"},
  {"at":"2026-10-02 15:00:00+03","result":"right","expect":"too_early","check":{"twoDaysAt":null}},
  {"at":"2026-10-02 18:59:59+03","result":"right","expect":"too_early"},
  {"at":"2026-10-02 19:00:00+03","result":"right","expect":"two_days","check":{"checks":0,"seriesDay":"2026-10-01","twoDaysDay":"2026-10-02"}}]'),
(2, 'hand:same-day-23h', 'one local day never counts, even 23 hours apart; the next day after 20 hours does', 'single', 3, '[0]', null, '[
  {"at":"2026-10-01 00:30:00+03","result":"right","expect":"start"},
  {"at":"2026-10-01 23:30:00+03","result":"right","expect":"too_early"},
  {"at":"2026-10-02 00:10:00+03","result":"right","expect":"two_days"}]'),
(3, 'hand:exam-eve', 'the exam-eve rule: one day before the date a check is due 4 days after the last naming (not 5)', 'single', 3, '[0]', '2026-10-20', '[
  {"at":"2026-10-10 10:00:00+03","result":"right","expect":"start"},
  {"at":"2026-10-11 10:00:00+03","result":"right","expect":"two_days"},
  {"at":"2026-10-15 11:00:00+03","result":"right","expect":"early","check":{"checks":0}},
  {"at":"2026-10-19 12:00:00+03","result":"right","expect":"check","check":{"checks":1}}]'),
(4, 'hand:exam-eve-far', 'the same moments with the date 6 days away: no eve rule, the 5-day wait is not over', 'single', 3, '[0]', '2026-10-25', '[
  {"at":"2026-10-10 10:00:00+03","result":"right","expect":"start"},
  {"at":"2026-10-11 10:00:00+03","result":"right","expect":"two_days"},
  {"at":"2026-10-15 11:00:00+03","result":"right","expect":"early"},
  {"at":"2026-10-19 12:00:00+03","result":"right","expect":"early","check":{"checks":0}}]'),
(5, 'hand:exam-day', 'on the date itself (0 days left) the eve rule still applies; two days before too', 'single', 3, '[0]', '2026-10-20', '[
  {"at":"2026-10-12 08:00:00+03","result":"right","expect":"start"},
  {"at":"2026-10-13 09:00:00+03","result":"right","expect":"two_days"},
  {"at":"2026-10-17 09:00:00+03","result":"right","expect":"early"},
  {"at":"2026-10-18 09:00:00+03","result":"right","expect":"early"},
  {"at":"2026-10-20 08:00:00+03","result":"right","expect":"early"},
  {"at":"2026-10-20 08:59:59+03","result":"right","expect":"early","check":{"checks":0}}]'),
(6, 'hand:misclick', '«Нажали не туда?»: a peek — counters and the series stay, peek day = today, a right answer that day is training', 'single', 3, '[0]', null, '[
  {"at":"2026-10-01 20:00:00+03","result":"right","expect":"start"},
  {"at":"2026-10-02 18:00:00+03","result":"wrong","misclick":true,"expect":"misclick","check":{"seen":1,"wrong":0,"right":1,"peekDay":"2026-10-02","seriesDay":"2026-10-01","lastResult":"right"}},
  {"at":"2026-10-02 20:30:00+03","result":"right","expect":"training","check":{"seen":2,"right":2}},
  {"at":"2026-10-03 09:00:00+03","result":"right","expect":"two_days","check":{"seriesDay":"2026-10-01"}}]'),
(7, 'hand:misclick-first-sight', 'a misclick on the first sight: seen today (no counted answer), a right answer that day is training', 'single', 3, '[0]', null, '[
  {"at":"2026-10-01 10:00:00+03","result":"wrong","misclick":true,"expect":"misclick","check":{"seen":0,"wrong":0,"firstDay":"2026-10-01","lastDay":"2026-10-01","peekDay":"2026-10-01","lastResult":null}},
  {"at":"2026-10-01 10:05:00+03","result":"right","expect":"training","check":{"seen":1,"right":1,"seriesAt":null}},
  {"at":"2026-10-02 10:05:00+03","result":"right","expect":"start"}]'),
(8, 'hand:misclick-dont-know', '«Не знаю» pressed by mistake and marked «Нажали не туда?»: a peek like any misclick; a misclick flag under a right answer is ignored', 'single', 3, '[0]', null, '[
  {"at":"2026-10-01 10:00:00+03","result":"right","misclick":true,"expect":"start","check":{"seen":1,"peekDay":null}},
  {"at":"2026-10-02 11:00:00+03","result":"dont_know","misclick":true,"expect":"misclick","check":{"seen":1,"wrong":0,"lastResult":"right","peekDay":"2026-10-02","seriesDay":"2026-10-01"}},
  {"at":"2026-10-02 12:00:00+03","result":"right","expect":"training"},
  {"at":"2026-10-03 09:00:00+03","result":"right","expect":"two_days"}]'),
(9, 'hand:retry', 'a retry is not counted in seen; right in a retry is training, wrong in a retry is a miss', 'single', 3, '[0]', null, '[
  {"at":"2026-10-01 10:00:00+03","result":"wrong","expect":"miss","check":{"seen":1,"wrong":1,"peekDay":"2026-10-01"}},
  {"at":"2026-10-01 10:03:00+03","result":"right","retry":true,"expect":"training","check":{"seen":1,"right":0,"lastResult":"wrong"}},
  {"at":"2026-10-01 10:06:00+03","result":"wrong","retry":true,"expect":"miss","check":{"seen":1,"wrong":2}},
  {"at":"2026-10-02 10:00:00+03","result":"right","expect":"start","check":{"seen":2,"right":1,"lastResult":"right"}},
  {"at":"2026-10-03 10:00:00+03","result":"right","expect":"two_days"}]'),
(10, 'hand:retry-first', 'a retry flag on an item never answered under this rev is an ordinary answer', 'single', 3, '[0]', null, '[
  {"at":"2026-10-01 10:00:00+03","result":"right","retry":true,"expect":"start","check":{"seen":1}}]'),
(11, 'hand:peek-day', 'after a miss the key was seen: a right answer the same day is training; the next day starts the series', 'single', 3, '[0]', null, '[
  {"at":"2026-10-01 09:00:00+03","result":"wrong","expect":"miss"},
  {"at":"2026-10-01 21:00:00+03","result":"right","expect":"training","check":{"seen":2,"right":1,"lastResult":"wrong","cleanOkAt":null}},
  {"at":"2026-10-02 08:00:00+03","result":"right","expect":"start"},
  {"at":"2026-10-02 21:00:00+03","result":"right","expect":"too_early"},
  {"at":"2026-10-03 08:00:00+03","result":"right","expect":"two_days"}]'),
(12, 'hand:check-moment', 'a check one second before its moment is early (the same wait starts again); at the moment it is a check; 5, 12, 25, then 50 days, and 50 again after the third', 'single', 3, '[0]', null, '[
  {"at":"2026-10-01 10:00:00+03","result":"right","expect":"start"},
  {"at":"2026-10-02 10:00:00+03","result":"right","expect":"two_days"},
  {"at":"2026-10-07 09:59:59+03","result":"right","expect":"early","check":{"checks":0}},
  {"at":"2026-10-12 09:59:59+03","result":"right","expect":"check","check":{"checks":1}},
  {"at":"2026-10-24 09:59:58+03","result":"right","expect":"early","check":{"checks":1}},
  {"at":"2026-11-05 09:59:58+03","result":"right","expect":"check","check":{"checks":2}},
  {"at":"2026-11-30 09:59:57+03","result":"right","expect":"early","check":{"checks":2}},
  {"at":"2026-12-25 09:59:57+03","result":"right","expect":"check","check":{"checks":3}},
  {"at":"2027-02-13 09:59:57+03","result":"right","expect":"check","check":{"checks":4}},
  {"at":"2027-04-04 09:59:56+03","result":"right","expect":"early","check":{"checks":4}},
  {"at":"2027-05-24 09:59:56+03","result":"right","expect":"check","check":{"checks":5}}]'),
(13, 'hand:late', 'an answer for an older local day after a newer one (another device): late, the state does not move', 'single', 3, '[0]', null, '[
  {"at":"2026-10-02 10:00:00+03","result":"right","expect":"start"},
  {"at":"2026-10-02 12:00:00+03","day":"2026-10-01","result":"wrong","expect":"late","check":{"seen":1,"wrong":0,"lastDay":"2026-10-02"}},
  {"at":"2026-10-03 11:00:00+03","result":"right","expect":"two_days"}]'),
(14, 'hand:rev-change', 'the author changed the key (rev 2): the state starts from zero', 'single', 3, '[0]', null, '[
  {"at":"2026-10-01 10:00:00+03","rev":1,"result":"right","expect":"start"},
  {"at":"2026-10-02 10:30:00+03","rev":1,"result":"right","expect":"two_days"},
  {"at":"2026-10-03 10:00:00+03","rev":2,"result":"right","expect":"start","check":{"seen":1,"right":1,"wrong":0,"itemRev":2,"wasTwoDays":false,"firstDay":"2026-10-03","twoDaysAt":null}},
  {"at":"2026-10-04 10:00:00+03","rev":2,"result":"right","expect":"two_days"}]'),
(15, 'hand:lost', 'a miss takes a counted item out of the figure (wasTwoDays), checks back to 0, named_at cleared', 'single', 3, '[0]', null, '[
  {"at":"2026-10-01 10:00:00+03","result":"right","expect":"start"},
  {"at":"2026-10-02 10:00:00+03","result":"right","expect":"two_days"},
  {"at":"2026-10-08 10:00:00+03","result":"right","expect":"check","check":{"checks":1}},
  {"at":"2026-10-09 10:00:00+03","result":"wrong","expect":"miss","check":{"checks":0,"wasTwoDays":true,"twoDaysAt":null,"namedAt":null,"seriesAt":null,"peekDay":"2026-10-09"}},
  {"at":"2026-10-10 10:00:00+03","result":"right","expect":"start","check":{"wasTwoDays":true}}]'),
(16, 'hand:multiple', 'several correct options: all or nothing, in any order; nothing chosen = «Не знаю»', 'multiple', 4, '[0,2]', null, '[
  {"at":"2026-10-01 10:00:00+03","answer":{"chosen":[2,0]},"expect":"start"},
  {"at":"2026-10-02 10:30:00+03","answer":{"chosen":[0]},"expect":"miss"},
  {"at":"2026-10-03 10:00:00+03","answer":{"chosen":[0,1,2]},"expect":"miss"},
  {"at":"2026-10-04 10:00:00+03","answer":{"chosen":null},"expect":"miss","check":{"lastResult":"dont_know"}},
  {"at":"2026-10-05 10:00:00+03","answer":{"chosen":[0,2]},"expect":"start"}]'),
(17, 'hand:short', 'a short answer: case, spaces, ё/е and one final dot do not matter; any accepted form counts', 'short', 0, '["Ёлка","ель."]', null, '[
  {"at":"2026-10-01 10:00:00+03","answer":{"text":"  ЕЛКА.  "},"expect":"start"},
  {"at":"2026-10-02 10:30:00+03","answer":{"text":"ель"},"expect":"two_days"},
  {"at":"2026-10-08 10:30:00+03","answer":{"text":"Ель."},"expect":"check"},
  {"at":"2026-10-09 10:00:00+03","answer":{"text":"ель.."},"expect":"miss","check":{"wasTwoDays":true}},
  {"at":"2026-10-10 10:00:00+03","answer":{"text":"е л к а"},"expect":"miss"},
  {"at":"2026-10-11 10:00:00+03","answer":{"text":null},"expect":"miss","check":{"lastResult":"dont_know"}},
  {"at":"2026-10-12 10:00:00+03","answer":{"text":"ёлка "},"expect":"start"}]'),
(18, 'hand:single-key', 'a single item: the key index in file order; another index is wrong', 'single', 4, '[3]', null, '[
  {"at":"2026-10-01 10:00:00+03","answer":{"chosen":3},"expect":"start"},
  {"at":"2026-10-02 10:00:00+03","answer":{"chosen":[3]},"expect":"two_days"},
  {"at":"2026-10-07 10:00:00+03","answer":{"chosen":0},"expect":"miss"}]');

do $rv$
declare
  c record; e jsonb; k integer; s public.test_item_states; r record; g record; v_at timestamptz; v_day date; v_rev integer;
  v_result text; v_correct boolean; v_retry boolean; v_misclick boolean; v_out jsonb; v_state jsonb; evs jsonb;
  v_key smallint[]; v_answers text[];
  -- the random generator
  v_seed text; v_n integer; v_t timestamptz; v_last date; v_gap double precision; v_exam date; v_x double precision;
  c_gaps constant double precision[] := array[0.02, 0.3, 2, 6, 15.9, 16.5, 19.5, 20, 20.5, 23, 28, 44, 72, 96, 100, 110,
                                               120, 121, 130, 200, 288, 290, 300, 400, 600, 610, 1200, 1210];
  c_exam constant integer[] := array[2, 4, 6, 9, 14, 21, 30, 60];
begin
  -- 320 seeded sequences: single items, results given, 1..14 events each.
  for i in 1..320 loop
    v_seed := 'rv:' || i;
    v_x := pg_temp.rnd(v_seed || ':exam');
    v_exam := case when v_x < 0.3 then null
                   else date '2026-09-01' + c_exam[1 + floor(pg_temp.rnd(v_seed || ':examd') * 8)::integer] end;
    v_n := 1 + floor(pg_temp.rnd(v_seed || ':n') * 14)::integer;
    v_t := timestamptz '2026-09-01 08:00:00+03' + make_interval(secs => floor(pg_temp.rnd(v_seed || ':t0') * 54000));
    v_rev := 1;
    v_last := null;
    evs := '[]'::jsonb;
    for j in 1..v_n loop
      if j > 1 then
        v_gap := c_gaps[1 + floor(pg_temp.rnd(v_seed || ':g' || j) * array_length(c_gaps, 1))::integer];
        if pg_temp.rnd(v_seed || ':exact' || j) >= 0.25 then
          v_gap := v_gap * (0.97 + 0.06 * pg_temp.rnd(v_seed || ':jit' || j));
        end if;
        v_t := v_t + make_interval(secs => round(v_gap * 3600));
      end if;
      v_x := pg_temp.rnd(v_seed || ':r' || j);
      v_result := case when v_x < 0.62 then 'right' when v_x < 0.84 then 'wrong' else 'dont_know' end;
      e := jsonb_build_object('at', to_char(v_t at time zone 'Europe/Minsk', 'YYYY-MM-DD HH24:MI:SS') || '+03', 'result', v_result);
      if pg_temp.rnd(v_seed || ':late' || j) < 0.05 and v_last is not null then
        e := e || jsonb_build_object('day', v_last - 1 - floor(pg_temp.rnd(v_seed || ':lated' || j) * 2)::integer);
      end if;
      if pg_temp.rnd(v_seed || ':retry' || j) < 0.10 then e := e || '{"retry":true}'; end if;
      if v_result <> 'right' and pg_temp.rnd(v_seed || ':mis' || j) < 0.12 then e := e || '{"misclick":true}'; end if;
      if pg_temp.rnd(v_seed || ':rev' || j) < 0.03 then v_rev := v_rev + 1; end if;
      if v_rev > 1 then e := e || jsonb_build_object('rev', v_rev); end if;
      v_last := greatest(v_last, (v_t at time zone 'Europe/Minsk')::date);
      evs := evs || jsonb_build_array(e);
    end loop;
    insert into rv_case (n, id, name, exam_day, events)
    values (100 + i, 'rand:' || lpad(i::text, 3, '0'), 'seeded sequence ' || i, v_exam, evs);
  end loop;

  for c in select * from rv_case order by n loop
    s := null;
    evs := '[]'::jsonb;
    v_key := case when c.kind <> 'short' then array(select (x #>> '{}')::smallint from jsonb_array_elements(c.key) x) else '{}' end;
    v_answers := case when c.kind = 'short' then array(select jsonb_array_elements_text(c.key)) else '{}' end;
    k := 0;
    for e in select x from jsonb_array_elements(c.events) x loop
      k := k + 1;
      v_at := (e ->> 'at')::timestamptz;
      v_day := coalesce((e ->> 'day')::date, (v_at at time zone 'Europe/Minsk')::date);
      v_rev := coalesce((e ->> 'rev')::integer, 1);
      if e ? 'answer' then
        select * into g from meldy_private.grade_answer(c.kind, c.options, v_key, v_answers, e -> 'answer');
        if not g.o_valid then raise exception 'FAILED: vector % event %: answer not valid', c.id, k; end if;
        v_result := g.o_result;
        v_correct := g.o_correct;
      else
        v_result := e ->> 'result';
        v_correct := v_result = 'right';
      end if;
      v_retry := coalesce((e ->> 'retry')::boolean, false);
      -- the answer core's rule: a misclick is a wrong answer or a «Не знаю» the student marked; under a right answer it is ignored
      v_misclick := coalesce((e ->> 'misclick')::boolean, false) and v_result <> 'right';
      select * into r from meldy_private.rule_step(s, v_rev, v_at, v_day, v_result, v_retry, v_misclick, c.exam_day);
      s := r.o_state;
      v_state := jsonb_build_object(
        'seen', s.seen, 'wrong', s.wrong_count, 'right', s.right_count, 'firstDay', s.first_seen_day, 'lastDay', s.last_answer_day,
        'seriesAt', pg_temp.ms(s.streak_at), 'seriesDay', s.streak_day, 'twoDaysAt', pg_temp.ms(s.two_days_at),
        'twoDaysDay', s.two_days_day, 'namedAt', pg_temp.ms(s.named_at), 'checks', s.checks, 'peekDay', s.peek_day,
        'wasTwoDays', s.was_two_days, 'cleanOkAt', pg_temp.ms(s.clean_ok_at), 'lastResult', s.last_result, 'itemRev', s.item_rev);
      if e ? 'expect' and e ->> 'expect' is distinct from r.o_step then
        raise exception 'FAILED: vector % event %: step %, expected %', c.id, k, r.o_step, e ->> 'expect';
      end if;
      if e ? 'check' and not (v_state @> (e -> 'check')) then
        raise exception 'FAILED: vector % event %: state %, expected %', c.id, k, v_state, e -> 'check';
      end if;
      v_out := jsonb_build_object('at', pg_temp.ms(v_at), 'day', v_day, 'rev', v_rev, 'result', v_result, 'correct', v_correct,
                                  'retry', v_retry, 'misclick', coalesce((e ->> 'misclick')::boolean, false),
                                  'step', r.o_step, 'due_before', pg_temp.ms(r.o_due_before), 'state', v_state);
      if e ? 'answer' then v_out := v_out || jsonb_build_object('answer', e -> 'answer'); end if;
      evs := evs || jsonb_build_array(v_out);
    end loop;
    insert into rv_out values (c.n, jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind,
      'key', case when c.kind = 'short' then '[]'::jsonb else c.key end,
      'answers', case when c.kind = 'short' then c.key else '[]'::jsonb end,
      'options', c.options, 'exam_day', c.exam_day, 'events', evs));
  end loop;
end
$rv$;
-- Coverage of the generated sequences: every step occurs.
do $t$
declare v_missing text;
begin
  select string_agg(s, ', ') into v_missing
    from unnest(array['miss','misclick','training','start','too_early','two_days','check','early','late']) s
   where not exists (select 1 from rv_out o, jsonb_array_elements(o.j -> 'events') e where o.n > 100 and e ->> 'step' = s);
  if v_missing is not null then raise exception 'FAILED: the random sequences never reach %', v_missing; end if;
  if (select count(*) from rv_out where n > 100) < 300 then raise exception 'FAILED: fewer than 300 sequences'; end if;
end
$t$;

\pset format unaligned
\pset tuples_only on
\if :{?vectors_out}
\o :vectors_out
select concat_ws(E'\n',
  '{"v": 1,',
  ' "about": ' || to_jsonb('The rule «верно в два разных дня» exactly as the database applies it (supabase/migrations/20261009093500_containers.sql: meldy_private.rule_step after meldy_private.grade_answer, the two functions record_test_answers_for calls). Generated by supabase/tests/local/containers_behaviour.sql (containers_run_all.sh); do not edit by hand.'::text)::text || ',',
  ' "tz": "Europe/Minsk",',
  ' "units": "at, due_before and every moment of the state are epoch milliseconds (whole seconds); days are local days YYYY-MM-DD; the wire (plan_inputs) sends the same moments as epoch seconds.",',
  ' "constants": {"confirm_min_hours": 20, "due_days": [5, 12, 25, 50], "exam_eve_days": 2, "exam_eve_stale_days": 4},',
  ' "rules": ' || to_jsonb(array[
    'Rev: when the event''s rev differs from the state''s itemRev, the state first starts from zero (seen, right, wrong, checks 0; every day and moment null; wasTwoDays false).',
    'late: lastDay is set and the event''s day is before it — the state does not move (the log keeps the answer).',
    'misclick: a wrong answer or a «Не знаю» pressed by mistake that the student marked «Нажали не туда?» — peekDay = day; firstDay ??= day; lastDay = max(lastDay, day); seen, right, wrong, the series and lastResult stay. A misclick flag on a right answer is ignored (the answer is a right answer).',
    'Otherwise a retry counts as a retry only when firstDay is set. A non-retry answer: seen+1, firstDay ??= day, lastDay = max(lastDay, day).',
    'miss: wrong or «Не знаю» (retries included): wrong+1; lastResult = wrong | dont_know; wasTwoDays ||= twoDaysAt != null; seriesAt/Day, twoDaysAt/Day, namedAt = null; checks = 0; peekDay = day.',
    'training: right in a retry, or peekDay = day: a non-retry one adds right+1; nothing else moves (lastResult, cleanOkAt, namedAt stay).',
    'A clean right answer: right+1, lastResult = right, cleanOkAt = at, namedAt = at, then: in the figure (twoDaysAt set) — check (checks+1) when at >= due_before, else early; no series — start (seriesAt = at, seriesDay = day); day != seriesDay and at - seriesAt >= 20 h — two_days (twoDaysAt = at, twoDaysDay = day, checks = 0); else too_early.',
    'due_before = namedAt + 24 h × [5, 12, 25, 50][min(checks, 3)]; when exam_day - day is 0, 1 or 2 days: min(that, namedAt + 96 h). Null when the item is not in the figure.',
    'Grading: single/multiple — the chosen index or set equals the key (file order, any order of the set, all or nothing); null or [] = «Не знаю». short — normalise both sides (lower case; ё → е; every run of whitespace → one space; trim; drop one final «.» and trim again) and compare with each accepted form; null = «Не знаю».'
  ])::text || ',',
  ' "derive": ' || to_jsonb('How to test derive with these vectors: for each event k+1 of a case, derive(state after event k, at_(k+1), day_(k+1), exam_day) must agree with the step the database gave event k+1 when that event is a clean right answer (not retry, not misclick, not late, peekDay != day): status started with from <= at → two_days, from > at → too_early; status due → check; two_days → early; new or learning → start.'::text)::text || ',',
  ' "cases": [',
  (select string_agg(j::text, E',\n' order by n) from rv_out),
  ']}');
\o
\endif
\if :{?samples_out}
\o :samples_out
select name || E'\t' || rpc || E'\t' || j::text from samples order by name;
\o
\endif
\pset format aligned
\pset tuples_only off

\echo CONTAINER CHECKS PASSED
rollback;
