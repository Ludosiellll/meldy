-- Rollback of 20261016100000_item_update_images.sql: container_item_update exactly as 20261009093500_containers.sql
-- left it (no «images» in a patch). Pictures already saved stay on their questions.

create or replace function public.container_item_update(p_item_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_old public.test_items%rowtype;
  v_new public.test_items%rowtype;
  v_resolved integer := 0;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid patch' using errcode = '22023';
  end if;
  select i.* into v_old from public.test_items i
    join public.containers c on c.id = i.container_id
   where i.id = p_item_id and c.owner_id = v_user
     for update of i;
  if not found then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  if (p_patch ? 'correct' and (pg_catalog.jsonb_typeof(p_patch -> 'correct') <> 'array'
        or exists (select 1 from pg_catalog.jsonb_array_elements(p_patch -> 'correct') k
                    where pg_catalog.jsonb_typeof(k) <> 'number' or (k #>> '{}') !~ '^[0-7]$')))
     or (p_patch ? 'answers' and (pg_catalog.jsonb_typeof(p_patch -> 'answers') <> 'array'
        or exists (select 1 from pg_catalog.jsonb_array_elements(p_patch -> 'answers') a
                    where pg_catalog.jsonb_typeof(a) <> 'string')))
     or (p_patch ? 'options' and pg_catalog.jsonb_typeof(p_patch -> 'options') <> 'array')
     or (p_patch ? 'stem' and pg_catalog.jsonb_typeof(p_patch -> 'stem') <> 'string')
     or (p_patch ? 'kind' and pg_catalog.jsonb_typeof(p_patch -> 'kind') <> 'string')
     or (p_patch ? 'file_no' and pg_catalog.jsonb_typeof(p_patch -> 'file_no') not in ('string', 'number'))
     or (p_patch ? 'key_source' and pg_catalog.jsonb_typeof(p_patch -> 'key_source') <> 'string')
     or (p_patch ? 'code' and pg_catalog.jsonb_typeof(p_patch -> 'code') <> 'boolean')
     or (p_patch ? 'keep_order' and pg_catalog.jsonb_typeof(p_patch -> 'keep_order') <> 'boolean')
     or (p_patch ? 'topic' and pg_catalog.jsonb_typeof(p_patch -> 'topic') <> 'null'
         and coalesce(p_patch ->> 'topic', '') !~ '^([1-9]|[1-9][0-9])$') then
    raise exception 'invalid patch' using errcode = '22023';
  end if;
  begin
    update public.test_items i set
      stem = case when p_patch ? 'stem' then p_patch ->> 'stem' else i.stem end,
      options = case when p_patch ? 'options' then p_patch -> 'options' else i.options end,
      correct = case when p_patch ? 'correct'
                     then array(select (k #>> '{}')::smallint from pg_catalog.jsonb_array_elements(p_patch -> 'correct') k)
                     else i.correct end,
      answers = case when p_patch ? 'answers'
                     then array(select pg_catalog.btrim(a) from pg_catalog.jsonb_array_elements_text(p_patch -> 'answers') a)
                     else i.answers end,
      kind = coalesce(p_patch ->> 'kind', i.kind),
      topic = case when p_patch ? 'topic' then (p_patch ->> 'topic')::smallint else i.topic end,
      file_no = coalesce(p_patch ->> 'file_no', i.file_no),
      keep_order = coalesce((p_patch ->> 'keep_order')::boolean, i.keep_order),
      code = coalesce((p_patch ->> 'code')::boolean, i.code),
      key_source = case when p_patch ? 'key_source' then p_patch ->> 'key_source'
                        when p_patch ? 'correct' or p_patch ? 'answers' then 'manual' else i.key_source end
     where i.id = p_item_id
    returning i.* into v_new;
  exception
    when check_violation or not_null_violation then
      raise exception 'invalid patch' using errcode = '22023', detail = sqlerrm;
  end;
  if v_new.rev <> v_old.rev then
    insert into public.test_item_key_changes (item_id, container_id, rev, old_correct, new_correct, old_answers, new_answers)
    values (v_new.id, v_new.container_id, v_new.rev, v_old.correct, v_new.correct, v_old.answers, v_new.answers);
    update public.test_key_doubts d set resolved_at = pg_catalog.now(), resolution = 'fixed'
     where d.item_id = p_item_id and d.resolved_at is null;
    get diagnostics v_resolved = row_count;
  end if;
  return pg_catalog.jsonb_build_object('id', v_new.id, 'rev', v_new.rev, 'rev_changed', v_new.rev <> v_old.rev,
                                       'doubts_resolved', v_resolved);
end;
$fn$;
