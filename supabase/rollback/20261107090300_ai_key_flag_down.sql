-- Rollback of 20261107090300_ai_key_flag.sql back to 20261107090000_container_orals_go.sql: the three replaced bodies
-- exactly as their last earlier migrations left them. Re-runnable. The flags already written stay in test_items (the
-- import wrote ai_key before this file too); container_item_update ignores ai_key again and keeps flags as they are.

set local lock_timeout = '2s';

-- public.container_item_update (20261101090000_question_kinds.sql)
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
  v_kind text;
  v_bad text;
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
     or (p_patch ? 'images' and pg_catalog.jsonb_typeof(p_patch -> 'images') <> 'object')
     or (p_patch ? 'file_no' and pg_catalog.jsonb_typeof(p_patch -> 'file_no') not in ('string', 'number'))
     or (p_patch ? 'key_source' and pg_catalog.jsonb_typeof(p_patch -> 'key_source') <> 'string')
     or (p_patch ? 'code' and pg_catalog.jsonb_typeof(p_patch -> 'code') <> 'boolean')
     or (p_patch ? 'keep_order' and pg_catalog.jsonb_typeof(p_patch -> 'keep_order') <> 'boolean')
     or (p_patch ? 'topic' and pg_catalog.jsonb_typeof(p_patch -> 'topic') <> 'null'
         and coalesce(p_patch ->> 'topic', '') !~ '^([1-9]|[1-9][0-9])$') then
    raise exception 'invalid patch' using errcode = '22023';
  end if;
  if p_patch ? 'explanation'
     and (pg_catalog.jsonb_typeof(p_patch -> 'explanation') <> 'string'
          or pg_catalog.char_length(pg_catalog.btrim(p_patch ->> 'explanation')) > 2000) then
    raise exception 'invalid patch' using errcode = '22023', detail = 'explanation';
  end if;
  v_bad := meldy_private.kind_keys_bad(p_patch, v_user);
  if v_bad is not null then
    raise exception 'invalid patch' using errcode = '22023', detail = v_bad;
  end if;
  v_kind := coalesce(p_patch ->> 'kind', v_old.kind);
  begin
    update public.test_items i set
      stem = case when p_patch ? 'stem' then p_patch ->> 'stem' else i.stem end,
      options = case when p_patch ? 'options' then p_patch -> 'options' else i.options end,
      correct = case when v_kind = 'order'
                     then array(select k::smallint
                                  from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(
                                         case when p_patch ? 'options' then p_patch -> 'options' else i.options end) - 1) k)
                     when p_patch ? 'correct'
                     then array(select (k #>> '{}')::smallint from pg_catalog.jsonb_array_elements(p_patch -> 'correct') k)
                     else i.correct end,
      answers = case when p_patch ? 'answers' and v_kind = 'cloze'
                     then array(select meldy_private.cloze_forms(a.value)
                                  from pg_catalog.jsonb_array_elements_text(p_patch -> 'answers') with ordinality as a(value, ord)
                                 order by a.ord)
                     when p_patch ? 'answers'
                     then array(select pg_catalog.btrim(a) from pg_catalog.jsonb_array_elements_text(p_patch -> 'answers') a)
                     else i.answers end,
      kind = v_kind,
      topic = case when p_patch ? 'topic' then (p_patch ->> 'topic')::smallint else i.topic end,
      file_no = coalesce(p_patch ->> 'file_no', i.file_no),
      keep_order = coalesce((p_patch ->> 'keep_order')::boolean, i.keep_order),
      code = coalesce((p_patch ->> 'code')::boolean, i.code),
      images = case when p_patch ? 'images' then p_patch -> 'images' else i.images end,
      explanation = case when p_patch ? 'explanation' then pg_catalog.btrim(p_patch ->> 'explanation') else i.explanation end,
      key_source = case when p_patch ? 'key_source' then p_patch ->> 'key_source'
                        when p_patch ? 'correct' or p_patch ? 'answers' or p_patch ? 'tolerance' or p_patch ? 'unit'
                             or (v_kind = 'order' and p_patch ? 'options') then 'manual'
                        else i.key_source end,
      tolerance = case when v_kind <> 'number' then null
                       when p_patch ? 'tolerance' then (p_patch ->> 'tolerance')::numeric
                       else i.tolerance end,
      unit = case when v_kind <> 'number' then null
                  when p_patch ? 'unit' then nullif(pg_catalog.btrim(p_patch ->> 'unit'), '')
                  else i.unit end,
      partial = case when v_kind not in ('multiple', 'order', 'match', 'cloze') then false
                     when p_patch ? 'partial' then (p_patch ->> 'partial')::boolean
                     else i.partial end,
      material_ids = case when v_kind <> 'essay' then '{}'::uuid[]
                          when p_patch ? 'material_ids'
                          then array(select m::uuid from pg_catalog.jsonb_array_elements_text(p_patch -> 'material_ids') m)
                          else i.material_ids end
     where i.id = p_item_id
    returning i.* into v_new;
  exception
    when check_violation or not_null_violation then
      raise exception 'invalid patch' using errcode = '22023', detail = sqlerrm;
  end;
  -- A picture list per option at most: a list past the last option would show under no option.
  if v_new.images ? 'options'
     and pg_catalog.jsonb_array_length(v_new.images -> 'options') > pg_catalog.jsonb_array_length(v_new.options) then
    raise exception 'invalid patch' using errcode = '22023', detail = 'images';
  end if;
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

-- bot.session_view_json (20261101090300_question_kinds_bot.sql)
create or replace function bot.session_view_json(p_s bot.sessions)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_item public.test_items%rowtype;
  v_topics jsonb;
  v_pos integer := p_s.position;
  v_cell jsonb;
  v_order jsonb;
  v_p jsonb := p_s.pending;
  v_review jsonb;
begin
  if p_s.sid is null or p_s.status <> 'open' or v_pos >= pg_catalog.cardinality(p_s.items) then
    return null;
  end if;
  select i.* into v_item from public.test_items i where i.id = p_s.items[v_pos + 1];
  if v_item.id is null then
    return null;
  end if;
  select s.topics into v_topics from public.container_subjects s where s.id = v_item.subject_id;
  v_cell := coalesce(p_s.shown -> v_pos, '{}'::jsonb);
  v_order := case when v_item.kind in ('short', 'number', 'cloze') then '[]'::jsonb else coalesce(v_cell -> 'o', '[]'::jsonb) end;
  if v_p is not null and (v_p ->> 'pos')::integer = v_pos then
    v_review := pg_catalog.jsonb_build_object(
      'correct', coalesce((v_p ->> 'correct')::boolean, false),
      'dont_know', coalesce((v_p ->> 'dont_know')::boolean, false),
      'choice', coalesce(v_p -> 'choice', '[]'::jsonb),
      'text', v_p -> 'text',
      'key', (select coalesce(pg_catalog.jsonb_agg(o.ord - 1 order by o.ord), '[]'::jsonb)
                from pg_catalog.jsonb_array_elements_text(v_order) with ordinality o(f, ord)
               where o.f::smallint = any (v_item.correct)),
      'answers', case when v_item.kind = 'cloze'
                      then pg_catalog.to_jsonb(pg_catalog.string_to_array(v_item.answers[1], E'\n'))
                      when v_item.kind = 'number' and v_item.unit is not null
                      then (select pg_catalog.jsonb_agg(a || ' ' || v_item.unit order by o)
                              from pg_catalog.unnest(v_item.answers) with ordinality as x(a, o))
                      else pg_catalog.to_jsonb(v_item.answers) end,
      'recorded', coalesce((v_p ->> 'recorded')::boolean, false),
      'misclick', coalesce((v_p ->> 'misclick')::boolean, false),
      'doubt', coalesce((v_p ->> 'doubt')::boolean, false),
      'status', v_p -> 'status', 'step', v_p -> 'step',
      'key_source', v_item.key_source,
      'key_changed_at', (select pg_catalog.max(k.changed_at) from public.test_item_key_changes k
                          where k.item_id = v_item.id and k.rev = v_item.rev))
      -- release 48: the author's explanation after the answer, when there is one
      || case when v_item.explanation <> '' then pg_catalog.jsonb_build_object('explanation', v_item.explanation)
              else '{}'::jsonb end;
  end if;
  return pg_catalog.jsonb_build_object(
    'pos', v_pos, 'item_id', v_item.id, 'rev', coalesce(v_cell -> 'r', pg_catalog.to_jsonb(v_item.rev)),
    'kind', v_item.kind, 'code', v_item.code, 'keep_order', v_item.keep_order, 'stem', v_item.stem,
    'options', (select coalesce(pg_catalog.jsonb_agg(v_item.options -> (o.f::integer) order by o.ord), '[]'::jsonb)
                  from pg_catalog.jsonb_array_elements_text(v_order) with ordinality o(f, ord)),
    'order', v_order, 'file_no', v_item.file_no, 'number', v_item.position, 'topic', v_item.topic,
    'topic_title', case when v_item.topic is not null then v_topics ->> (v_item.topic - 1) end,
    'retry', p_s.retry[v_pos + 1], 'review', v_review);
end;
$fn$;

-- bot.group_item_ok (20261014150000_bot_skips_pictures.sql)
create or replace function bot.group_item_ok(p_i public.test_items)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select p_i.id is not null and p_i.kind = 'single' and p_i.keyed and pg_catalog.cardinality(p_i.correct) = 1
     and not ('has_image' = any (p_i.flags))
     and p_i.images = '{}'::jsonb
     and pg_catalog.jsonb_array_length(p_i.options) between 2 and 8
     and pg_catalog.char_length(p_i.stem)
         + coalesce((select pg_catalog.sum(pg_catalog.char_length(o.value))
                       from pg_catalog.jsonb_array_elements_text(p_i.options) o), 0) <= 1500
     and not exists (select 1 from public.test_key_doubts d where d.item_id = p_i.id and d.resolved_at is null)
$fn$;
