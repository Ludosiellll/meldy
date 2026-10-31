-- Rollback of 20261101090000_question_kinds.sql (release 48, part 1) back to the catalog of 20261031090000: every replaced
-- body exactly as its last earlier migration left it, the new helpers dropped, the checks as before, then the columns.
-- Roll back 20261101090100_question_kinds_grading.sql (and anything after it) first. Re-runnable.
-- What is lost: every question of a new kind (number, order, match, cloze, essay) with its states, key changes and doubts
-- (their rows cascade), the answers of the log recorded for them, and the four columns (tolerance, unit, partial,
-- material_ids: a multiple question keeps its key and loses only the partial-credit setting).

-- 1. Rows the old checks would refuse.
delete from public.test_answers where kind not in ('single', 'multiple', 'short');
delete from public.test_items where kind not in ('single', 'multiple', 'short');

-- 2. Checks as before (the old definitions, by name).
alter table public.test_items drop constraint if exists test_items_kind_fields_check;
alter table public.test_items drop constraint if exists test_items_kind_check;
alter table public.test_items add constraint test_items_kind_check check (kind in ('single', 'multiple', 'short'));
alter table public.test_items drop constraint if exists test_items_options_check;
alter table public.test_items add constraint test_items_options_check
  check (case when kind = 'short' then options = '[]'::jsonb else public.meldy_options_ok(options) end);
alter table public.test_answers drop constraint if exists test_answers_kind_check;
alter table public.test_answers add constraint test_answers_kind_check check (kind in ('single', 'multiple', 'short'));

-- 3. The replaced bodies.
-- public.meldy_key_ok: as 20261009093500_containers.sql left it.
create or replace function public.meldy_key_ok(p_key smallint[], p_options integer, p_kind text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select p_key is not null
     and pg_catalog.array_ndims(p_key) is distinct from 2
     and coalesce(pg_catalog.cardinality(p_key), 0) <= case when p_kind = 'single' then 1
                                                            when p_kind = 'short' then 0 else p_options end
     and not exists (select 1 from pg_catalog.unnest(p_key) k where k is null or k < 0 or k >= p_options)
     and (select pg_catalog.count(distinct k) from pg_catalog.unnest(p_key) k) = coalesce(pg_catalog.cardinality(p_key), 0)
$fn$;

-- public.meldy_answers_ok: as 20261009093500_containers.sql left it.
create or replace function public.meldy_answers_ok(p_answers text[], p_kind text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select case
    when p_answers is null or pg_catalog.array_ndims(p_answers) = 2 then false
    when p_kind = 'short' then
      pg_catalog.cardinality(p_answers) between 1 and 10
      and not exists (select 1 from pg_catalog.unnest(p_answers) a
                       where a is null or pg_catalog.char_length(a) not between 1 and 200
                          or public.meldy_short_norm(a) = '')
    else coalesce(pg_catalog.cardinality(p_answers), 0) = 0
  end
$fn$;

-- public.test_items_guard: as 20261009093500_containers.sql left it.
create or replace function public.test_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_container uuid;
begin
  select s.container_id into v_container from public.container_subjects s where s.id = new.subject_id;
  if v_container is null then
    raise exception 'no such subject' using errcode = 'P0002';
  end if;
  if tg_op = 'UPDATE' and v_container is distinct from old.container_id then
    raise exception 'an item does not move to another container' using errcode = '22023';
  end if;
  new.container_id := v_container;
  new.updated_at := pg_catalog.now();
  if tg_op = 'INSERT' then
    new.rev := 1;
  elsif new.kind is distinct from old.kind
        or pg_catalog.jsonb_array_length(new.options) <> pg_catalog.jsonb_array_length(old.options)
        or (select coalesce(pg_catalog.array_agg(k order by k), '{}'::smallint[]) from pg_catalog.unnest(new.correct) k)
           is distinct from
           (select coalesce(pg_catalog.array_agg(k order by k), '{}'::smallint[]) from pg_catalog.unnest(old.correct) k)
        or (select coalesce(pg_catalog.array_agg(distinct public.meldy_short_norm(a) order by public.meldy_short_norm(a)), '{}'::text[])
              from pg_catalog.unnest(new.answers) a)
           is distinct from
           (select coalesce(pg_catalog.array_agg(distinct public.meldy_short_norm(a) order by public.meldy_short_norm(a)), '{}'::text[])
              from pg_catalog.unnest(old.answers) a) then
    new.rev := old.rev + 1;
  else
    new.rev := old.rev;
  end if;
  return new;
end;
$fn$;

-- public.container_items_add: as 20261018100000_test_builder.sql left it.
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
               -- the explanation (release 47): a string of at most 2000 characters once trimmed
               when e.x ? 'explanation'
                    and (pg_catalog.jsonb_typeof(e.x -> 'explanation') is distinct from 'string'
                         or pg_catalog.char_length(pg_catalog.btrim(e.x ->> 'explanation')) > 2000) then 'explanation'
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
                                 key_source, code, keep_order, flags, import_ref, images, explanation)
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
         case when pg_catalog.jsonb_typeof(n.x -> 'images') = 'object' then n.x -> 'images' else '{}'::jsonb end,
         coalesce(pg_catalog.btrim(n.x ->> 'explanation'), '')
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

-- public.container_item_update: as 20261018100000_test_builder.sql left it.
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
      images = case when p_patch ? 'images' then p_patch -> 'images' else i.images end,
      explanation = case when p_patch ? 'explanation' then pg_catalog.btrim(p_patch ->> 'explanation') else i.explanation end,
      key_source = case when p_patch ? 'key_source' then p_patch ->> 'key_source'
                        when p_patch ? 'correct' or p_patch ? 'answers' then 'manual' else i.key_source end
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

-- 4. The new helpers, then the columns.
drop function if exists meldy_private.kind_keys_bad(jsonb, uuid);
drop function if exists meldy_private.cloze_forms(text);
drop function if exists meldy_private.kind_key(text, jsonb, text[], numeric, text);
drop function if exists public.meldy_number_right(text, text[], numeric, text);
drop function if exists public.meldy_cloze_gaps(text);
alter table public.test_items drop column if exists material_ids;
alter table public.test_items drop column if exists partial;
alter table public.test_items drop column if exists unit;
alter table public.test_items drop column if exists tolerance;
