-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261014120000_test_item_images.sql
-- on the scratch database of test_item_images_run.sh. One transaction, rolled back. A = author aaaa…1, B = member
-- bbbb…2, C = stranger cccc…3. A failure raises; success prints IMAGE CHECKS PASSED.
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
grant all on ctx to authenticated;
grant execute on function pg_temp.expect_error(text, text, text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; v_c uuid; s1 uuid; p text; q text; d date := (now() at time zone 'utc')::date;
begin
  r := public.container_create('Тест с картинками', d + 3, jsonb_build_array(jsonb_build_object('title', 'ТРПО')));
  v_c := (r ->> 'container_id')::uuid;
  s1 := (r -> 'subjects' -> 0 ->> 'id')::uuid;
  p := v_c::text || '/' || repeat('a1', 32) || '.png';
  q := v_c::text || '/' || repeat('b2', 32) || '.jpg';
  insert into ctx values ('c', v_c::text), ('s', s1::text), ('p', p);
  -- a question that is a picture, an option that is a picture, a question without pictures
  r := public.container_items_add(s1, jsonb_build_array(
         jsonb_build_object('ref', 'img:1', 'stem', 'Вопрос на картинке', 'options', jsonb_build_array('1', '2'), 'correct', jsonb_build_array(0),
                            'images', jsonb_build_object('stem', jsonb_build_array(p), 'options', jsonb_build_array('[]'::jsonb, '[]'::jsonb))),
         jsonb_build_object('ref', 'img:2', 'stem', 'Какой рисунок — блок-схема?', 'options', jsonb_build_array('этот', 'Рисунок Б'), 'correct', jsonb_build_array(1),
                            'images', jsonb_build_object('stem', '[]'::jsonb, 'options', jsonb_build_array('[]'::jsonb, jsonb_build_array(q)))),
         jsonb_build_object('ref', 'img:3', 'stem', 'Без картинки', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0))));
  if (r ->> 'added')::int <> 3 then raise exception 'FAILED: added %', r; end if;
  if (select images from public.test_items where import_ref = 'img:1') -> 'stem' ->> 0 <> p
     or (select images from public.test_items where import_ref = 'img:2') -> 'options' -> 1 ->> 0 <> q
     or (select images from public.test_items where import_ref = 'img:3') <> '{}'::jsonb then
    raise exception 'FAILED: images stored %', (select jsonb_agg(images) from public.test_items where container_id = v_c);
  end if;
  -- another container's folder, a bad shape, a bad path: refused with the rule's name
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, %L)$$, s1, jsonb_build_array(jsonb_build_object(
    'ref', 'img:9', 'stem', 'x', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(0),
    'images', jsonb_build_object('stem', jsonb_build_array('99999999-2222-4333-8444-555555555555/' || repeat('a1', 32) || '.png'))))), '22023', 'another container');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, %L)$$, s1, jsonb_build_array(jsonb_build_object(
    'ref', 'img:9', 'stem', 'x', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(0), 'images', '[]'::jsonb))), '22023', 'images not an object');
  perform pg_temp.expect_error(format($$select public.container_items_add(%L, %L)$$, s1, jsonb_build_array(jsonb_build_object(
    'ref', 'img:9', 'stem', 'x', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(0),
    'images', jsonb_build_object('stem', jsonb_build_array(v_c::text || '/../x.png'))))), '22023', 'a path out of the folder');
  -- the author uploads into the exam's folder, not into another's
  insert into storage.objects (bucket_id, name) values ('test-item-images', p);
  perform pg_temp.expect_error(format($$insert into storage.objects (bucket_id, name) values ('test-item-images', %L)$$,
    '99999999-2222-4333-8444-555555555555/' || repeat('a1', 32) || '.png'), '42501', 'upload into a stranger folder');
  if (select count(*) from storage.objects where bucket_id = 'test-item-images') <> 1 then raise exception 'FAILED: author reads'; end if;
end
$t$;

-- B joins (as the join function would: a member row); C is nobody's.
reset role;
insert into public.container_members (container_id, user_id) values ((select v from ctx where k = 'c')::uuid, 'bbbbbbbb-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
begin
  if (select count(*) from storage.objects where bucket_id = 'test-item-images') <> 1 then raise exception 'FAILED: member reads the picture'; end if;
  if (select count(*) from public.test_items where images <> '{}'::jsonb) <> 2 then raise exception 'FAILED: member reads the paths'; end if;
  perform pg_temp.expect_error(format($$insert into storage.objects (bucket_id, name) values ('test-item-images', %L)$$,
    (select v from ctx where k = 'c') || '/' || repeat('c3', 32) || '.png'), '42501', 'a member uploads');
  delete from storage.objects where bucket_id = 'test-item-images';
end
$t$;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
begin
  if (select count(*) from storage.objects where bucket_id = 'test-item-images') <> 0 then raise exception 'FAILED: stranger reads'; end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
begin
  if (select count(*) from storage.objects where bucket_id = 'test-item-images') <> 1 then raise exception 'FAILED: the member deleted the picture'; end if;
  delete from storage.objects where bucket_id = 'test-item-images';
  if (select count(*) from storage.objects where bucket_id = 'test-item-images') <> 0 then raise exception 'FAILED: author deletes'; end if;
end
$t$;
reset role;
-- the column's own check: a row cannot point into another exam's folder (a write that skips the function)
do $t$
begin
  perform pg_temp.expect_error(format($$update public.test_items set images = %L where import_ref = 'img:3'$$,
    jsonb_build_object('stem', jsonb_build_array('99999999-2222-4333-8444-555555555555/' || repeat('a1', 32) || '.png'))), '23514', 'check constraint');
end
$t$;
select 'IMAGE CHECKS PASSED';
rollback;
