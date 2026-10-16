-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261016100000_item_update_images.sql
-- on the scratch database of item_update_images_run.sh: the author puts pictures on a question through
-- container_item_update (rev stays), with new options in the same patch; a path in another exam's folder, images that
-- are not an object and more option lists than options are refused (22023, the last with detail «images»); a member
-- cannot. One transaction, rolled back. A = author aaaa…1, B = member bbbb…2. Success prints ITEM IMAGES CHECKS PASSED.
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
    if p_detail is not null and v_detail is distinct from p_detail then
      raise exception 'FAILED: % — detail %, expected %', p_what, v_detail, p_detail;
    end if;
end;
$fn$;
create temp table ctx (k text primary key, v text);
grant all on ctx to authenticated;
grant execute on function pg_temp.expect_error(text, text, text, text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; v_c uuid; s1 uuid; v_item uuid; p text; q text; v_rev int; d date := (now() at time zone 'utc')::date;
begin
  r := public.container_create('Правка картинок', d + 3, jsonb_build_array(jsonb_build_object('title', 'ТРПО')));
  v_c := (r ->> 'container_id')::uuid;
  s1 := (r -> 'subjects' -> 0 ->> 'id')::uuid;
  p := v_c::text || '/' || repeat('a1', 32) || '.png';
  q := v_c::text || '/' || repeat('b2', 32) || '.jpg';
  r := public.container_items_add(s1, jsonb_build_array(jsonb_build_object('ref', 'ed:1', 'stem', 'Что на схеме?',
         'options', jsonb_build_array('Вход', 'Выход'), 'correct', jsonb_build_array(0))));
  v_item := (r -> 'items' -> 0 ->> 'id')::uuid;
  insert into ctx values ('item', v_item::text), ('c', v_c::text);
  select rev into v_rev from public.test_items where id = v_item;

  -- a picture under the stem: saved, rev kept
  r := public.container_item_update(v_item, jsonb_build_object('images', jsonb_build_object('stem', jsonb_build_array(p))));
  if (r ->> 'rev_changed')::boolean or (select images -> 'stem' ->> 0 from public.test_items where id = v_item) <> p then
    raise exception 'FAILED: stem picture %', r;
  end if;
  -- a third option with its picture, in one patch: saved; the option count moves rev (the trigger's rule)
  r := public.container_item_update(v_item, jsonb_build_object(
         'options', jsonb_build_array('Вход', 'Выход', 'Рисунок В'),
         'images', jsonb_build_object('stem', jsonb_build_array(p), 'options', jsonb_build_array('[]'::jsonb, '[]'::jsonb, jsonb_build_array(q)))));
  if not (r ->> 'rev_changed')::boolean or (r ->> 'rev')::int <> v_rev + 1
     or (select images -> 'options' -> 2 ->> 0 from public.test_items where id = v_item) <> q then
    raise exception 'FAILED: options with pictures %', r;
  end if;
  -- the pictures taken off again
  r := public.container_item_update(v_item, '{"images": {}}'::jsonb);
  if (select images from public.test_items where id = v_item) <> '{}'::jsonb or (r ->> 'rev_changed')::boolean then
    raise exception 'FAILED: pictures off %', r;
  end if;
  -- refusals
  perform pg_temp.expect_error(format($$select public.container_item_update(%L, %L)$$, v_item, jsonb_build_object('images',
    jsonb_build_object('stem', jsonb_build_array('99999999-2222-4333-8444-555555555555/' || repeat('a1', 32) || '.png')))), '22023', 'another exam''s folder');
  perform pg_temp.expect_error(format($$select public.container_item_update(%L, %L)$$, v_item, '{"images": "x"}'), '22023', 'images not an object');
  perform pg_temp.expect_error(format($$select public.container_item_update(%L, %L)$$, v_item, '{"images": []}'), '22023', 'images an array');
  perform pg_temp.expect_error(format($$select public.container_item_update(%L, %L)$$, v_item,
    '{"images": {"options": [[], [], [], []]}}'), '22023', 'more option lists than options', 'images');
  -- a refused patch changed nothing
  if (select images from public.test_items where id = v_item) <> '{}'::jsonb then raise exception 'FAILED: a refusal wrote'; end if;
  -- the old keys still work: a typo fix keeps rev
  select rev into v_rev from public.test_items where id = v_item;
  r := public.container_item_update(v_item, '{"stem": "Что показано на схеме?"}'::jsonb);
  if (r ->> 'rev')::int <> v_rev then raise exception 'FAILED: a typo moved rev %', r; end if;
end
$t$;

-- B, a member, cannot change the question.
reset role;
insert into public.container_members (container_id, user_id) values ((select v from ctx where k = 'c')::uuid, 'bbbbbbbb-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
begin
  perform pg_temp.expect_error(format($$select public.container_item_update(%L, '{"images": {}}')$$, (select v from ctx where k = 'item')),
    'P0002', 'a member edits');
end
$t$;
select 'ITEM IMAGES CHECKS PASSED';
rollback;
