-- Rollback of 20261019110000_doc_video.sql back to 20261019100000_test_docs.sql: meldy_private.test_doc_ok exactly as
-- that file wrote it (CREATE OR REPLACE keeps its grants). Re-runnable.
-- What is lost: nothing stored changes, but a saved page with a video block no longer passes the rules — its next save
-- is refused (block:<n>:type) until the block is removed; the readers skip the block (an unknown type).

-- 20261019100000 §2f. The whole document: null when valid, else the first broken rule (the order of that file's
-- header, §2).
create or replace function meldy_private.test_doc_ok(p_doc jsonb, p_container_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  c_accents constant text[] := array['blue', 'green', 'orange', 'violet', 'pink', 'graphite'];
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v jsonb;
  v_theme jsonb;
  v_bg jsonb;
  v_res jsonb;
  v_b jsonb;
  v_n integer;
  v_type text;
  v_why text;
  v_ids text[] := '{}';
  v_items uuid[] := '{}';
  v_item uuid;
begin
  -- version
  if pg_catalog.jsonb_typeof(p_doc) is distinct from 'object' or p_doc -> 'v' is distinct from '1'::jsonb then
    return 'version';
  end if;
  if exists (select 1 from pg_catalog.jsonb_object_keys(p_doc) k
              where k not in ('v', 'title', 'theme', 'layout', 'blocks', 'results')) then
    return 'version';
  end if;
  -- title
  if not meldy_private.test_doc_str(p_doc -> 'title', 1, 200) then
    return 'title';
  end if;
  -- theme
  v_theme := p_doc -> 'theme';
  if not meldy_private.test_doc_keys(v_theme, array['accent', 'background', 'font', 'radius', 'density', 'answers', 'buttons']) then
    return 'theme';
  end if;
  v := v_theme -> 'accent';
  if not (meldy_private.test_doc_enum(v, c_accents)
          or (meldy_private.test_doc_keys(v, array['custom'])
              and pg_catalog.jsonb_typeof(v -> 'custom') = 'string' and (v ->> 'custom') ~ '^#[0-9a-f]{6}$')) then
    return 'theme';
  end if;
  v_bg := v_theme -> 'background';
  if not coalesce(case when pg_catalog.jsonb_typeof(v_bg) <> 'object' then false
                       when v_bg -> 'kind' = '"plain"'::jsonb then meldy_private.test_doc_keys(v_bg, array['kind'])
                       when v_bg -> 'kind' = '"soft"'::jsonb
                       then meldy_private.test_doc_keys(v_bg, array['kind', 'tone'])
                            and meldy_private.test_doc_enum(v_bg -> 'tone', c_accents)
                       when v_bg -> 'kind' = '"image"'::jsonb
                       then meldy_private.test_doc_keys(v_bg, array['kind', 'path', 'dim'])
                            and meldy_private.test_doc_image(v_bg -> 'path', p_container_id, false)
                            and meldy_private.test_doc_int(v_bg -> 'dim', 0, 80)
                       else false end, false) then
    return 'theme';
  end if;
  if not (meldy_private.test_doc_enum(v_theme -> 'font', array['onest', 'serif', 'mono'])
          and meldy_private.test_doc_enum(v_theme -> 'radius', array['soft', 'round', 'square'])
          and meldy_private.test_doc_enum(v_theme -> 'density', array['airy', 'compact'])
          and meldy_private.test_doc_enum(v_theme -> 'answers', array['list', 'grid'])
          and meldy_private.test_doc_enum(v_theme -> 'buttons', array['pill', 'rounded', 'square'])) then
    return 'theme';
  end if;
  -- layout
  if not meldy_private.test_doc_enum(p_doc -> 'layout', array['one_by_one', 'one_page', 'pages']) then
    return 'layout';
  end if;
  -- blocks
  if pg_catalog.jsonb_typeof(p_doc -> 'blocks') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_doc -> 'blocks') > 400 then
    return 'blocks';
  end if;
  for v_b, v_n in select e.x, (e.o - 1)::integer
                    from pg_catalog.jsonb_array_elements(p_doc -> 'blocks') with ordinality as e(x, o)
                   order by e.o loop
    v_type := case when pg_catalog.jsonb_typeof(v_b) = 'object' and pg_catalog.jsonb_typeof(v_b -> 'type') = 'string'
                   then v_b ->> 'type' end;
    if v_type is null or v_type not in ('cover', 'heading', 'text', 'image', 'note', 'divider', 'page', 'question') then
      return pg_catalog.format('block:%s:type', v_n);
    end if;
    if not coalesce(pg_catalog.jsonb_typeof(v_b -> 'id') = 'string' and (v_b ->> 'id') ~ '^[a-z0-9]{8,24}$', false)
       or (v_b ->> 'id') = any (v_ids) then
      return pg_catalog.format('block:%s:id', v_n);
    end if;
    v_ids := v_ids || (v_b ->> 'id');
    v_why := null;
    if v_type = 'question' then
      if not coalesce(pg_catalog.jsonb_typeof(v_b -> 'item_id') = 'string' and (v_b ->> 'item_id') ~* c_uuid, false) then
        v_why := 'item_id';
      else
        v_item := (v_b ->> 'item_id')::uuid;
        if v_item = any (v_items)
           or not exists (select 1 from public.test_items i where i.id = v_item and i.container_id = p_container_id) then
          v_why := 'item_id';
        elsif not meldy_private.test_doc_int(v_b -> 'points', 1, 100) then
          v_why := 'points';
        elsif pg_catalog.jsonb_typeof(v_b -> 'required') is distinct from 'boolean' then
          v_why := 'required';
        elsif not meldy_private.test_doc_keys(v_b, array['type', 'id', 'item_id', 'points', 'required']) then
          v_why := 'type';
        end if;
        v_items := v_items || v_item;
      end if;
    else
      v_why := case v_type
        when 'cover' then case
          when not meldy_private.test_doc_str(v_b -> 'title', 1, 200) then 'title'
          when not meldy_private.test_doc_str(v_b -> 'subtitle', 0, 300) then 'subtitle'
          when not meldy_private.test_doc_image(v_b -> 'image', p_container_id, true) then 'image'
          when not meldy_private.test_doc_enum(v_b -> 'align', array['left', 'center']) then 'align'
          when not meldy_private.test_doc_keys(v_b, array['type', 'id', 'title', 'subtitle', 'image', 'align']) then 'type' end
        when 'heading' then case
          when not meldy_private.test_doc_str(v_b -> 'text', 1, 200) then 'text'
          when not meldy_private.test_doc_enum(v_b -> 'size', array['l', 'm']) then 'size'
          when not meldy_private.test_doc_keys(v_b, array['type', 'id', 'text', 'size']) then 'type' end
        when 'text' then case
          when not meldy_private.test_doc_str(v_b -> 'text', 1, 4000) then 'text'
          when not meldy_private.test_doc_enum(v_b -> 'align', array['left', 'center']) then 'align'
          when not meldy_private.test_doc_keys(v_b, array['type', 'id', 'text', 'align']) then 'type' end
        when 'image' then case
          when not meldy_private.test_doc_image(v_b -> 'path', p_container_id, false) then 'path'
          when not meldy_private.test_doc_str(v_b -> 'caption', 0, 300) then 'caption'
          when not meldy_private.test_doc_enum(v_b -> 'width', array['narrow', 'wide', 'full']) then 'width'
          when not meldy_private.test_doc_keys(v_b, array['type', 'id', 'path', 'caption', 'width']) then 'type' end
        when 'note' then case
          when not meldy_private.test_doc_enum(v_b -> 'tone', array['info', 'tip', 'warn']) then 'tone'
          when not meldy_private.test_doc_str(v_b -> 'text', 1, 4000) then 'text'
          when not meldy_private.test_doc_keys(v_b, array['type', 'id', 'tone', 'text']) then 'type' end
        when 'divider' then case
          when not meldy_private.test_doc_keys(v_b, array['type', 'id']) then 'type' end
        when 'page' then case
          when not meldy_private.test_doc_str(v_b -> 'title', 0, 200) then 'title'
          when not meldy_private.test_doc_keys(v_b, array['type', 'id', 'title']) then 'type' end
      end;
    end if;
    if v_why is not null then
      return pg_catalog.format('block:%s:%s', v_n, v_why);
    end if;
  end loop;
  -- results
  v_res := p_doc -> 'results';
  if not meldy_private.test_doc_keys(v_res, array['bands', 'cta'])
     or pg_catalog.jsonb_typeof(v_res -> 'bands') is distinct from 'array'
     or pg_catalog.jsonb_array_length(v_res -> 'bands') > 6 then
    return 'results';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_res -> 'bands') b
              where not (meldy_private.test_doc_keys(b, array['from', 'to', 'title', 'text', 'image'])
                         and meldy_private.test_doc_int(b -> 'from', 0, 100) and meldy_private.test_doc_int(b -> 'to', 0, 100)
                         and meldy_private.test_doc_str(b -> 'title', 1, 200)
                         and meldy_private.test_doc_str(b -> 'text', 0, 4000)
                         and meldy_private.test_doc_image(b -> 'image', p_container_id, true))) then
    return 'results';
  end if;
  -- (from and to are whole numbers now) each band in order, no two sharing a percent
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_res -> 'bands') b
              where (b ->> 'from')::integer > (b ->> 'to')::integer)
     or exists (select 1
                  from pg_catalog.jsonb_array_elements(v_res -> 'bands') with ordinality as a(x, i)
                  join pg_catalog.jsonb_array_elements(v_res -> 'bands') with ordinality as b(x, j) on a.i < b.j
                 where (a.x ->> 'from')::integer <= (b.x ->> 'to')::integer
                   and (b.x ->> 'from')::integer <= (a.x ->> 'to')::integer) then
    return 'results';
  end if;
  v := v_res -> 'cta';
  if pg_catalog.jsonb_typeof(v) <> 'null'
     and not (meldy_private.test_doc_keys(v, array['label', 'url'])
              and meldy_private.test_doc_str(v -> 'label', 1, 200)
              and meldy_private.test_doc_str(v -> 'url', 1, 300) and (v ->> 'url') ~ '^https://') then
    return 'results';
  end if;
  return null;
end;
$fn$;
