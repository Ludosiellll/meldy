-- Pictures of test questions (owner, 2026-10-14: «картинки он не ест, а если вопрос является картинкой, что делать?»).
-- The importer (backend/bank_parse.py) now carries the pictures of a DOCX: each item has `images`
-- {"stem": [path…], "options": [[path…] per option]}, a path being «<container id>/<sha256>.<ext>» in the private bucket
-- test-item-images, where the import page puts the pictures before it saves the items.
--   1. public.meldy_images_ok(images, container): the shape (stem ≤ 8 paths, ≤ 20 options × ≤ 4) and every path inside
--      the container's own folder; test_items.images (jsonb, '{}' — no pictures) with that check.
--   2. container_items_add: the same function plus «images» per item ('images' — the rule a bad one breaks).
--   3. The bucket test-item-images (private; 3 MB; PNG, JPEG, GIF, WebP, BMP) and three storage policies: the
--      container's owner uploads and deletes in the container's folder; the owner and its members read it
--      (public.my_container_ids(), as «Test items: read own or joined»). The Telegram bot reads with the service key.
-- Re-runnable; CREATE OR REPLACE keeps the function's grants. Check: supabase/tests/test_item_images.sql.
-- Rollback: supabase/rollback/20261014120000_test_item_images_down.sql.

-- 1. The shape of the pictures and the column.
create or replace function public.meldy_images_ok(p_images jsonb, p_container uuid default null)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = ''
as $fn$
declare
  v_key text;
  v_list jsonb;
  v_path jsonb;
  v_paths jsonb := '[]'::jsonb;
begin
  if p_images is null or pg_catalog.jsonb_typeof(p_images) <> 'object' then
    return false;
  end if;
  for v_key in select k from pg_catalog.jsonb_object_keys(p_images) k loop
    if v_key not in ('stem', 'options') then
      return false;
    end if;
  end loop;
  if p_images ? 'stem' then
    if pg_catalog.jsonb_typeof(p_images -> 'stem') <> 'array' or pg_catalog.jsonb_array_length(p_images -> 'stem') > 8 then
      return false;
    end if;
    v_paths := v_paths || (p_images -> 'stem');
  end if;
  if p_images ? 'options' then
    if pg_catalog.jsonb_typeof(p_images -> 'options') <> 'array' or pg_catalog.jsonb_array_length(p_images -> 'options') > 20 then
      return false;
    end if;
    for v_list in select o from pg_catalog.jsonb_array_elements(p_images -> 'options') o loop
      if pg_catalog.jsonb_typeof(v_list) <> 'array' or pg_catalog.jsonb_array_length(v_list) > 4 then
        return false;
      end if;
      v_paths := v_paths || v_list;
    end loop;
  end if;
  for v_path in select p from pg_catalog.jsonb_array_elements(v_paths) p loop
    if pg_catalog.jsonb_typeof(v_path) <> 'string'
       or (v_path #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}[.](png|jpg|gif|webp|bmp)$'
       or (p_container is not null and pg_catalog.split_part(v_path #>> '{}', '/', 1) <> p_container::text) then
      return false;
    end if;
  end loop;
  return true;
end;
$fn$;
revoke all on function public.meldy_images_ok(jsonb, uuid) from public, anon;
grant execute on function public.meldy_images_ok(jsonb, uuid) to authenticated, service_role;

alter table public.test_items add column if not exists images jsonb not null default '{}'::jsonb;
do $do$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conrelid = 'public.test_items'::regclass and conname = 'test_items_images_check') then
    alter table public.test_items add constraint test_items_images_check check (public.meldy_images_ok(images, container_id));
  end if;
end;
$do$;

-- 2. Items with their pictures.
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
               when e.kind is null or e.kind not in ('single', 'multiple', 'short') then 'kind'
               when e.kind = 'short' and coalesce(pg_catalog.jsonb_typeof(e.x -> 'options'), 'null') <> 'null'
                    and e.x -> 'options' <> '[]'::jsonb then 'options'
               when e.kind = 'short' and coalesce(pg_catalog.jsonb_typeof(e.x -> 'correct'), 'null') <> 'null'
                    and e.x -> 'correct' <> '[]'::jsonb then 'correct'
               when e.kind = 'short' and (pg_catalog.jsonb_typeof(e.x -> 'answers') is distinct from 'array'
                    or exists (select 1 from pg_catalog.jsonb_array_elements(e.x -> 'answers') a
                                where pg_catalog.jsonb_typeof(a) <> 'string')
                    or not public.meldy_answers_ok(array(select pg_catalog.btrim(a)
                                                          from pg_catalog.jsonb_array_elements_text(e.x -> 'answers') a),
                                                    'short')) then 'answers'
               when e.kind <> 'short' and not public.meldy_options_ok(e.x -> 'options') then 'options'
               when e.kind <> 'short' and (pg_catalog.jsonb_typeof(e.x -> 'correct') is distinct from 'array'
                    or exists (select 1 from pg_catalog.jsonb_array_elements(e.x -> 'correct') k
                                where pg_catalog.jsonb_typeof(k) <> 'number' or (k #>> '{}') !~ '^[0-7]$')) then 'correct'
               when e.kind <> 'short' and not public.meldy_key_ok(array(select (k #>> '{}')::smallint
                                                                        from pg_catalog.jsonb_array_elements(e.x -> 'correct') k),
                                                                  pg_catalog.jsonb_array_length(e.x -> 'options'), e.kind) then 'correct'
               when e.kind <> 'short' and coalesce(pg_catalog.jsonb_typeof(e.x -> 'answers'), 'null') <> 'null'
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
                                 key_source, code, keep_order, flags, import_ref, images)
  select v_container, p_subject_id, v_pos + (pg_catalog.row_number() over (order by n.ord))::integer,
         coalesce(n.x ->> 'file_no', ''),
         case when coalesce(n.x ->> 'topic', '') ~ '^\d+$' then (n.x ->> 'topic')::smallint end,
         n.kind, n.x ->> 'stem',
         case when n.kind = 'short' then '[]'::jsonb else n.x -> 'options' end,
         case when n.kind = 'short' then '{}'::smallint[]
              else array(select (k #>> '{}')::smallint from pg_catalog.jsonb_array_elements(n.x -> 'correct') k) end,
         case when n.kind = 'short'
              then array(select pg_catalog.btrim(a) from pg_catalog.jsonb_array_elements_text(n.x -> 'answers') a)
              else '{}'::text[] end,
         coalesce(n.x ->> 'key_source',
                  case when n.kind = 'short' or pg_catalog.jsonb_array_length(n.x -> 'correct') > 0 then 'manual' else 'none' end),
         coalesce((n.x ->> 'code')::boolean, false), coalesce((n.x ->> 'keep_order')::boolean, false),
         case when pg_catalog.jsonb_typeof(n.x -> 'flags') = 'array'
              then array(select pg_catalog.jsonb_array_elements_text(n.x -> 'flags')) else '{}'::text[] end,
         n.x ->> 'ref',
         case when pg_catalog.jsonb_typeof(n.x -> 'images') = 'object' then n.x -> 'images' else '{}'::jsonb end
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


-- 3. The bucket and who may use it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('test-item-images', 'test-item-images', false, 3145728,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

do $do$
begin
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Test item images: owner uploads') then
    create policy "Test item images: owner uploads" on storage.objects for insert to authenticated
      with check (bucket_id = 'test-item-images'
                  and (storage.foldername(name))[1] in (select c.id::text from public.containers c
                                                          where c.owner_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Test item images: read own or joined') then
    create policy "Test item images: read own or joined" on storage.objects for select to authenticated
      using (bucket_id = 'test-item-images'
             and (storage.foldername(name))[1] in (select x::text from public.my_container_ids() x));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Test item images: owner deletes') then
    create policy "Test item images: owner deletes" on storage.objects for delete to authenticated
      using (bucket_id = 'test-item-images'
             and (storage.foldername(name))[1] in (select c.id::text from public.containers c
                                                     where c.owner_id = (select auth.uid())));
  end if;
end;
$do$;
