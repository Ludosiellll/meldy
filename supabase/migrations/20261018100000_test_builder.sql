-- test_builder (release 47: guests by token, «Новый тест», explanations, cover and colour, «тренироваться дальше»)
-- Repo file: supabase/migrations/20261018100000_test_builder.sql. Spec: meldy-notes 10_Project/Test_Builder_Spec_2026-10-18.md
-- §47; plan: docs/superpowers/plans/2026-10-18-test-builder-r47.md («Data contract (database — agent A)», items 1–10: the
-- shapes frontend/src/types/quiz.ts and types/container.ts mirror). Base: 20261016120000_quizzes.sql +
-- 20261016140000_quiz_result_order.sql (release 46.1).
-- Check after the apply: supabase/tests/test_builder.sql (quizzes.sql pins the old quiz_preview(text) and no longer
-- applies; quiz_result_order.sql, item_update_images.sql, test_item_images.sql and containers.sql still hold).
-- Local rehearsal (never live): supabase/tests/local/test_builder_run.sh. Rollback: supabase/rollback/20261018100000_test_builder_down.sql.
--
-- 1. test_items.explanation (≤ 2000 characters, '' = none): container_items_add and container_item_update take it; it
--    never moves rev (test_items_guard compares the key, the kind and the option count only — not changed here).
-- 2. container_items_reorder: the constructor's «вверх / вниз» rewrites the positions of a whole subject at once.
-- 3. A quiz may be written without an account (quizzes.guests). The guest never becomes a Supabase user (no anonymous
--    sign-in: it would give every guest the role authenticated in every function); the browser holds a secret token
--    (32 random bytes, base64url) and the server keeps only its sha256 in quiz_attempts.guest_hash. Whoever holds the
--    token continues that device's attempts; a wrong token reads as «no such attempt» (P0002), never as «not yours».
--    The signed-in and the guest paths run the same private helpers (meldy_private.quiz_*_for, quiz_me, quiz_block_for)
--    with a «person» = user_id or guest_hash, so the rules (deadline, grace, limits, review) cannot drift apart.
--    Existing quizzes keep «со входом» (guests = false); new ones default to «без входа» (spec §47.1 «по умолчанию для
--    новых», «новое — включается автором»).
-- 4. Against spam, a guest start is refused with MC016 busy past 120 guest starts a minute on a quiz or 30 a minute from
--    one address (the first x-forwarded-for of request.headers, kept hashed for a minute in
--    meldy_private.quiz_guest_starts), and with MC014 full past 2000 guest attempts on a quiz.
-- 5. Cover and colour (cover_path in the public bucket quiz-covers, accent), and «тренироваться дальше»
--    (offer_practice → quiz_practice_join makes the taker a member of the exam, as a group link would).
-- 6. Pictures for guests: anon reads test-item-images only at the paths of the items of guest quizzes' subjects
--    (public.guest_quiz_picture_paths()), not whole exam folders.
-- The key and the explanation leave the server only through the result, and only when the review shows the answers.
-- Re-runnable: IF NOT EXISTS, OR REPLACE, guarded DO blocks; CREATE OR REPLACE keeps the grants of replaced functions;
-- a second apply leaves the catalog as the first one did. The whole file is one request (supabase/migrate.py).
-- New errors (SQLSTATE): MC016 busy (too many guest starts); MC017 guests (the quiz needs an account); MC018 practice /
-- removed / full (quiz_practice_join). 22023 detail token / explanation / items / guests / cover_path / accent /
-- offer_practice; P0002 detail subject (reorder).

-- 1. Explanations.
alter table public.test_items add column if not exists explanation text not null default '';
do $do$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conrelid = 'public.test_items'::regclass and conname = 'test_items_explanation_check') then
    alter table public.test_items add constraint test_items_explanation_check check (char_length(explanation) <= 2000);
  end if;
end;
$do$;

-- 1a. container_items_add as 20261014120000_test_item_images.sql left it, plus «explanation» per item: a string
--     (trimmed, at most 2000 characters); anything else is the rule «explanation» of that item.
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

-- 1b. container_item_update as 20261016100000_item_update_images.sql left it, plus the patch key «explanation» (the same
--     rule; 22023 detail explanation). The explanation is not part of the key: rev stays (test_items_guard).
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

-- 2. The order of a subject's questions (the constructor's «вверх / вниз»). The whole subject at once, so two tabs
--    cannot leave two questions on one position: the ids must be exactly the subject's items, each once (22023 items);
--    positions become 1..n in that order. Only the owner (42501); a missing subject → P0002 subject. rev and
--    progress stay (the position is not part of the key); updated_at moves only for the items that moved.
create or replace function public.container_items_reorder(p_subject_id uuid, p_item_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_container uuid;
  v_owner uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select s.container_id, c.owner_id into v_container, v_owner
    from public.container_subjects s join public.containers c on c.id = s.container_id
   where s.id = p_subject_id;
  if v_container is null then
    raise exception 'subject not found' using errcode = 'P0002', detail = 'subject';
  end if;
  if v_owner is distinct from v_user then
    raise exception 'only the author reorders' using errcode = '42501';
  end if;
  -- One writer per container at a time (as container_items_add): the set checked below holds until commit.
  perform 1 from public.containers c where c.id = v_container for update;
  if p_item_ids is null
     or pg_catalog.cardinality(p_item_ids)
        <> (select pg_catalog.count(*) from public.test_items i where i.subject_id = p_subject_id)
     or (select pg_catalog.count(distinct x) from pg_catalog.unnest(p_item_ids) x) <> pg_catalog.cardinality(p_item_ids)
     or exists (select 1 from pg_catalog.unnest(p_item_ids) x
                 where not exists (select 1 from public.test_items i where i.id = x and i.subject_id = p_subject_id)) then
    raise exception 'invalid items' using errcode = '22023', detail = 'items';
  end if;
  update public.test_items i set position = x.ord::integer
    from pg_catalog.unnest(p_item_ids) with ordinality as x(id, ord)
   where i.id = x.id and i.subject_id = p_subject_id and i.position <> x.ord;
end;
$fn$;

-- 3. Quizzes: who may write (guests), cover, colour, the practice offer. Existing quizzes get guests = false (they were
--    made as «со входом»); the column's default for new rows is true. members_only and guests never go together.
alter table public.quizzes add column if not exists guests boolean not null default false;
alter table public.quizzes alter column guests set default true;
alter table public.quizzes add column if not exists cover_path text;
alter table public.quizzes add column if not exists accent text not null default 'blue';
alter table public.quizzes add column if not exists offer_practice boolean not null default false;
update public.quizzes q set guests = false where q.members_only and q.guests;
do $do$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conrelid = 'public.quizzes'::regclass and conname = 'quizzes_guests_check') then
    alter table public.quizzes add constraint quizzes_guests_check check (not (members_only and guests));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conrelid = 'public.quizzes'::regclass and conname = 'quizzes_cover_path_check') then
    -- «<the quiz's exam id>/<sha256>.<ext>»: the storage policy lets only the exam's owner write that folder.
    alter table public.quizzes add constraint quizzes_cover_path_check check (cover_path is null or
      (cover_path ~ '^[0-9a-f-]{36}/[0-9a-f]{64}[.](png|jpg|gif|webp)$' and split_part(cover_path, '/', 1) = container_id::text));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conrelid = 'public.quizzes'::regclass and conname = 'quizzes_accent_check') then
    alter table public.quizzes add constraint quizzes_accent_check
      check (accent in ('blue', 'green', 'orange', 'violet', 'pink', 'graphite'));
  end if;
end;
$do$;

-- 4. Attempts of guests: user_id or guest_hash (sha256 hex of the token), exactly one. A guest's attempt numbers are per
--    token, as a user's are per account.
alter table public.quiz_attempts alter column user_id drop not null;
alter table public.quiz_attempts add column if not exists guest_hash text;
do $do$
begin
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conrelid = 'public.quiz_attempts'::regclass and conname = 'quiz_attempts_guest_hash_check') then
    alter table public.quiz_attempts add constraint quiz_attempts_guest_hash_check
      check (guest_hash is null or guest_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint
                  where conrelid = 'public.quiz_attempts'::regclass and conname = 'quiz_attempts_person_check') then
    alter table public.quiz_attempts add constraint quiz_attempts_person_check check ((user_id is null) <> (guest_hash is null));
  end if;
end;
$do$;
create unique index if not exists quiz_attempts_guest_n_key on public.quiz_attempts (quiz_id, guest_hash, n)
  where guest_hash is not null;
create index if not exists quiz_attempts_guest_idx on public.quiz_attempts (quiz_id, guest_hash) where guest_hash is not null;

-- 4a. Guest starts per address for the last minute (the sha256 of the address, never the address; rows older than a
--     minute are pruned by every guest start). In the private schema: no client reaches it.
create table if not exists meldy_private.quiz_guest_starts (
  ip_hash text not null,
  started_at timestamptz not null default now(),
  constraint quiz_guest_starts_ip_hash_check check (ip_hash ~ '^[0-9a-f]{64}$')
);
create index if not exists quiz_guest_starts_ip_idx on meldy_private.quiz_guest_starts (ip_hash, started_at);
alter table meldy_private.quiz_guest_starts enable row level security;
revoke all on table meldy_private.quiz_guest_starts from public, anon, authenticated;

-- 5. Private helpers. meldy_private.quiz_block (release 46) stays as it was; the functions below use quiz_block_for.
-- 5a. Started = someone other than the author has an attempt; a guest's attempt counts (user_id null is «not the author»).
create or replace function meldy_private.quiz_started(p_q public.quizzes)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (select 1 from public.quiz_attempts a where a.quiz_id = p_q.id and a.user_id is distinct from p_q.owner_id)
$fn$;

-- 5b. QuizRow: release 46's fields + guests, cover_path, accent, offer_practice.
create or replace function meldy_private.quiz_row(p_q public.quizzes)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'id', p_q.id, 'container_id', p_q.container_id, 'code', p_q.code, 'title', p_q.title,
    'subject_ids', pg_catalog.to_jsonb(p_q.subject_ids), 'item_count', p_q.item_count, 'same_set', p_q.same_set,
    'shuffle_items', p_q.shuffle_items, 'shuffle_options', p_q.shuffle_options, 'time_limit_s', p_q.time_limit_s,
    'opens_at', p_q.opens_at, 'closes_at', p_q.closes_at, 'closed_at', p_q.closed_at, 'attempts', p_q.attempts_allowed,
    'grading', p_q.grading, 'allow_back', p_q.allow_back, 'pass_percent', p_q.pass_percent, 'review', p_q.review,
    'members_only', p_q.members_only, 'guests', p_q.guests, 'cover_path', p_q.cover_path, 'accent', p_q.accent,
    'offer_practice', p_q.offer_practice, 'created_at', p_q.created_at, 'updated_at', p_q.updated_at,
    'state', meldy_private.quiz_state(p_q), 'started', meldy_private.quiz_started(p_q))
$fn$;

-- 5c. The settings applied on a quiz row (release 46's keys, then guests, cover_path, accent, offer_practice; none of
--     the four is locked after the start). members_only given true without guests turns guests off; members_only and
--     guests true together → 22023 guests.
create or replace function meldy_private.quiz_apply(p_q public.quizzes, p_settings jsonb)
returns public.quizzes
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_q public.quizzes := p_q;
  v jsonb;
  v_ids uuid[];
begin
  if p_settings is null or pg_catalog.jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'invalid settings' using errcode = '22023', detail = 'settings';
  end if;
  if p_settings ? 'title' then
    v := p_settings -> 'title';
    if pg_catalog.jsonb_typeof(v) is distinct from 'string'
       or pg_catalog.char_length(pg_catalog.btrim(v #>> '{}')) not between 1 and 120 then
      raise exception 'invalid settings' using errcode = '22023', detail = 'title';
    end if;
    v_q.title := pg_catalog.btrim(v #>> '{}');
  end if;
  if p_settings ? 'subject_ids' then
    v := p_settings -> 'subject_ids';
    if pg_catalog.jsonb_typeof(v) is distinct from 'array' then
      raise exception 'invalid settings' using errcode = '22023', detail = 'subject_ids';
    end if;
    if pg_catalog.jsonb_array_length(v) not between 1 and 50
       or exists (select 1 from pg_catalog.jsonb_array_elements(v) x
                   where pg_catalog.jsonb_typeof(x) is distinct from 'string'
                      or (x #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'invalid settings' using errcode = '22023', detail = 'subject_ids';
    end if;
    select pg_catalog.array_agg(s.id order by s.position, s.created_at, s.id) into v_ids
      from public.container_subjects s
     where s.container_id = v_q.container_id
       and s.id in (select (x #>> '{}')::uuid from pg_catalog.jsonb_array_elements(v) x);
    if coalesce(pg_catalog.cardinality(v_ids), 0)
       <> (select pg_catalog.count(distinct (x #>> '{}')::uuid) from pg_catalog.jsonb_array_elements(v) x) then
      raise exception 'invalid settings' using errcode = '22023', detail = 'subject_ids';
    end if;
    v_q.subject_ids := v_ids;
  end if;
  if p_settings ? 'item_count' then
    v_q.item_count := meldy_private.quiz_int(p_settings, 'item_count', 1, 200, false);
  end if;
  if p_settings ? 'same_set' then
    v_q.same_set := meldy_private.quiz_bool(p_settings, 'same_set');
  end if;
  if p_settings ? 'shuffle_items' then
    v_q.shuffle_items := meldy_private.quiz_bool(p_settings, 'shuffle_items');
  end if;
  if p_settings ? 'shuffle_options' then
    v_q.shuffle_options := meldy_private.quiz_bool(p_settings, 'shuffle_options');
  end if;
  if p_settings ? 'time_limit_min' then
    v_q.time_limit_s := meldy_private.quiz_int(p_settings, 'time_limit_min', 1, 240, true) * 60;
  end if;
  if p_settings ? 'opens_at' then
    v_q.opens_at := meldy_private.quiz_time(p_settings, 'opens_at');
  end if;
  if p_settings ? 'closes_at' then
    v_q.closes_at := meldy_private.quiz_time(p_settings, 'closes_at');
  end if;
  if p_settings ? 'attempts' then
    v_q.attempts_allowed := meldy_private.quiz_int(p_settings, 'attempts', 1, 50, true);
  end if;
  if p_settings ? 'grading' then
    if pg_catalog.jsonb_typeof(p_settings -> 'grading') is distinct from 'string'
       or (p_settings ->> 'grading') not in ('best', 'last') then
      raise exception 'invalid settings' using errcode = '22023', detail = 'grading';
    end if;
    v_q.grading := p_settings ->> 'grading';
  end if;
  if p_settings ? 'allow_back' then
    v_q.allow_back := meldy_private.quiz_bool(p_settings, 'allow_back');
  end if;
  if p_settings ? 'pass_percent' then
    v_q.pass_percent := meldy_private.quiz_int(p_settings, 'pass_percent', 1, 100, true);
  end if;
  if p_settings ? 'review' then
    if pg_catalog.jsonb_typeof(p_settings -> 'review') is distinct from 'string'
       or (p_settings ->> 'review') not in ('score', 'mistakes', 'answers', 'mistakes_then_answers') then
      raise exception 'invalid settings' using errcode = '22023', detail = 'review';
    end if;
    v_q.review := p_settings ->> 'review';
  end if;
  if p_settings ? 'members_only' then
    v_q.members_only := meldy_private.quiz_bool(p_settings, 'members_only');
  end if;
  if p_settings ? 'guests' then
    v_q.guests := meldy_private.quiz_bool(p_settings, 'guests');
  end if;
  if p_settings ? 'cover_path' then
    v := p_settings -> 'cover_path';
    if pg_catalog.jsonb_typeof(v) = 'null' then
      v_q.cover_path := null;
    elsif pg_catalog.jsonb_typeof(v) is distinct from 'string'
          or (v #>> '{}') !~ '^[0-9a-f-]{36}/[0-9a-f]{64}[.](png|jpg|gif|webp)$'
          or pg_catalog.split_part(v #>> '{}', '/', 1) <> v_q.container_id::text then
      raise exception 'invalid settings' using errcode = '22023', detail = 'cover_path';
    else
      v_q.cover_path := v #>> '{}';
    end if;
  end if;
  if p_settings ? 'accent' then
    if pg_catalog.jsonb_typeof(p_settings -> 'accent') is distinct from 'string'
       or (p_settings ->> 'accent') not in ('blue', 'green', 'orange', 'violet', 'pink', 'graphite') then
      raise exception 'invalid settings' using errcode = '22023', detail = 'accent';
    end if;
    v_q.accent := p_settings ->> 'accent';
  end if;
  if p_settings ? 'offer_practice' then
    v_q.offer_practice := meldy_private.quiz_bool(p_settings, 'offer_practice');
  end if;
  if v_q.members_only and v_q.guests then
    if p_settings ? 'guests' then
      raise exception 'invalid settings' using errcode = '22023', detail = 'guests';
    end if;
    v_q.guests := false;
  end if;
  if v_q.opens_at is not null and v_q.closes_at is not null and v_q.closes_at <= v_q.opens_at then
    raise exception 'invalid settings' using errcode = '22023', detail = 'closes_at';
  end if;
  return v_q;
end;
$fn$;

-- 5d. What keeps a person from starting a new attempt now (null = nothing): quiz_block of release 46 for a person —
--     p_user, or (p_user null) the guest of p_guest (null: a guest without a token yet, no attempt). A guest also meets
--     the 2000 guest attempts of a quiz.
create or replace function meldy_private.quiz_block_for(p_q public.quizzes, p_user uuid, p_guest text)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case
    when meldy_private.quiz_state(p_q) = 'closed' or meldy_private.quiz_draw_count(p_q) = 0 then 'closed'
    when meldy_private.quiz_state(p_q) = 'not_yet' then 'not_yet'
    when p_q.members_only and meldy_private.role_in(p_user, p_q.container_id) is null then 'members_only'
    when (select pg_catalog.count(*) from public.quiz_attempts a
           where a.quiz_id = p_q.id and (a.user_id = p_user or a.guest_hash = p_guest))
           >= coalesce(p_q.attempts_allowed, 50)
      or (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = p_q.id) >= 3000
      or (p_user is null
          and (select pg_catalog.count(*) from public.quiz_attempts a
                where a.quiz_id = p_q.id and a.guest_hash is not null) >= 2000) then 'no_attempts'
  end
$fn$;

-- 5e. The guest's token → its sha256 (hex); null when it is not 43 base64url characters.
create or replace function meldy_private.quiz_token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select case when p_token ~ '^[A-Za-z0-9_-]{43}$'
              then pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex') end
$fn$;

-- 5f. The caller's address as the API saw it (the first x-forwarded-for of request.headers, as Supabase's own rate
--     limit example reads it), hashed; null when there is none or the header cannot be read.
create or replace function meldy_private.quiz_ip_hash()
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_ip text;
begin
  begin
    v_ip := pg_catalog.btrim(pg_catalog.split_part(
              (nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for', ',', 1));
  exception
    when others then
      return null;
  end;
  if v_ip is null or v_ip = '' then
    return null;
  end if;
  return pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('meldy-quiz-ip:' || v_ip, 'UTF8')), 'hex');
end;
$fn$;

-- 5g. «me» of the preview for a person: a signed-in user exactly as release 46 (name hint, author, member, attempts,
--     the open one, whether a start is possible and why not, the finished attempts with their score); a guest (p_user
--     null) the same with name_hint null, is_author / is_member false and guest true.
create or replace function meldy_private.quiz_me(p_q public.quizzes, p_user uuid, p_guest text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_role text;
  v_used integer;
  v_open uuid;
  v_reason text;
  v_results jsonb;
begin
  select pg_catalog.count(*)::integer, (pg_catalog.array_agg(a.id) filter (where a.finished_at is null))[1]
    into v_used, v_open
    from public.quiz_attempts a where a.quiz_id = p_q.id and (a.user_id = p_user or a.guest_hash = p_guest);
  v_reason := case when v_open is null then meldy_private.quiz_block_for(p_q, p_user, p_guest) end;
  v_results := coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                  'attempt_id', a.id, 'n', a.n, 'finished_at', a.finished_at,
                                  'correct', s.correct, 'total', s.total) order by a.n)
                           from public.quiz_attempts a
                           cross join lateral (select pg_catalog.count(*) filter (where g.correct) as correct,
                                                      pg_catalog.count(*) as total
                                                 from meldy_private.quiz_graded(null, a.id) g) s
                          where a.quiz_id = p_q.id and (a.user_id = p_user or a.guest_hash = p_guest)
                            and a.finished_at is not null), '[]'::jsonb);
  if p_user is null then
    return pg_catalog.jsonb_build_object(
      'name_hint', null, 'is_author', false, 'is_member', false, 'guest', true, 'attempts_used', v_used,
      'open_attempt', v_open, 'can_start', v_open is not null or v_reason is null, 'reason', v_reason,
      'results', v_results);
  end if;
  v_role := meldy_private.role_in(p_user, p_q.container_id);
  return pg_catalog.jsonb_build_object(
    'name_hint', coalesce((select a.name from public.quiz_attempts a
                            where a.quiz_id = p_q.id and a.user_id = p_user order by a.n desc limit 1),
                          (select nullif(pg_catalog.btrim(p.full_name), '') from public.profiles p where p.id = p_user)),
    'is_author', p_q.owner_id = p_user,
    'is_member', coalesce(v_role = 'member', false),
    'attempts_used', v_used,
    'open_attempt', v_open,
    'can_start', v_open is not null or v_reason is null,
    'reason', v_reason,
    'results', v_results);
end;
$fn$;

-- 5h. «Начать» for a person (quiz_start of release 46 with the guest's rules added): the person's unfinished attempt
--     comes back as it is (the name ignored); else a new attempt when the quiz takes guests (MC017, a guest), is open
--     (MC013), the person may write it (MC015, a user), has attempts left and the quiz has room (MC014 attempts / full;
--     a guest also past 2000 guest attempts), with a name of 2–80 characters (22023 name); a guest's start is refused
--     past 120 guest starts a minute on the quiz or 30 a minute from the address (MC016 busy). The quiz row is locked
--     first: two tabs pressing «Начать» together get one attempt.
create or replace function meldy_private.quiz_start_for(p_code text, p_name text, p_user uuid, p_guest text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_q public.quizzes%rowtype;
  v_a public.quiz_attempts%rowtype;
  v_state text;
  v_items uuid[];
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_ip text;
begin
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  select q.* into v_q from public.quizzes q where q.code = p_code for update;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  if p_user is null and not v_q.guests then
    raise exception 'sign in to write this quiz' using errcode = 'MC017', detail = 'guests';
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  select a.* into v_a from public.quiz_attempts a
   where a.quiz_id = v_q.id and (a.user_id = p_user or a.guest_hash = p_guest) and a.finished_at is null
   order by a.n desc
   limit 1;
  if found then
    return meldy_private.quiz_attempt_json(v_a, v_q);
  end if;
  v_state := meldy_private.quiz_state(v_q);
  if v_state <> 'open' then
    raise exception 'quiz not open' using errcode = 'MC013', detail = v_state;
  end if;
  if v_q.members_only and meldy_private.role_in(p_user, v_q.container_id) is null then
    raise exception 'members only' using errcode = 'MC015', detail = 'members_only';
  end if;
  if (select pg_catalog.count(*) from public.quiz_attempts a
       where a.quiz_id = v_q.id and (a.user_id = p_user or a.guest_hash = p_guest))
       >= coalesce(v_q.attempts_allowed, 50) then
    raise exception 'no attempts left' using errcode = 'MC014', detail = 'attempts';
  end if;
  if (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = v_q.id) >= 3000
     or (p_user is null
         and (select pg_catalog.count(*) from public.quiz_attempts a
               where a.quiz_id = v_q.id and a.guest_hash is not null) >= 2000) then
    raise exception 'no attempts left' using errcode = 'MC014', detail = 'full';
  end if;
  if pg_catalog.char_length(v_name) not between 2 and 80 then
    raise exception 'invalid name' using errcode = '22023', detail = 'name';
  end if;
  if p_user is null then
    if (select pg_catalog.count(*) from public.quiz_attempts a
         where a.quiz_id = v_q.id and a.guest_hash is not null
           and a.started_at > pg_catalog.now() - interval '1 minute') >= 120 then
      raise exception 'too many starts' using errcode = 'MC016', detail = 'busy';
    end if;
    v_ip := meldy_private.quiz_ip_hash();
    if v_ip is not null
       and (select pg_catalog.count(*) from meldy_private.quiz_guest_starts s
             where s.ip_hash = v_ip and s.started_at > pg_catalog.now() - interval '1 minute') >= 30 then
      raise exception 'too many starts' using errcode = 'MC016', detail = 'busy';
    end if;
  end if;
  v_items := meldy_private.quiz_draw(v_q);
  if pg_catalog.cardinality(v_items) = 0 then
    raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
  end if;
  insert into public.quiz_attempts (quiz_id, user_id, guest_hash, name, n, item_ids, started_at, deadline_at)
  values (v_q.id, p_user, case when p_user is null then p_guest end, v_name,
          (select coalesce(pg_catalog.max(a.n), 0) + 1 from public.quiz_attempts a
            where a.quiz_id = v_q.id and (a.user_id = p_user or a.guest_hash = p_guest)),
          v_items, pg_catalog.now(), meldy_private.quiz_deadline(pg_catalog.now(), v_q))
  returning * into v_a;
  if p_user is null then
    -- The rows of the last minute are all the throttle reads; older ones go here (a few per start at most).
    delete from meldy_private.quiz_guest_starts s where s.started_at <= pg_catalog.now() - interval '1 minute';
    if v_ip is not null then
      insert into meldy_private.quiz_guest_starts (ip_hash, started_at) values (v_ip, pg_catalog.now());
    end if;
  end if;
  return meldy_private.quiz_attempt_json(v_a, v_q);
end;
$fn$;

-- 5i. Save answers of a person's attempt (quiz_answer of release 46; an attempt that is not the person's → P0002
--     attempt, whatever the reason). An emptied answer is taken back: its row goes (the table has no «empty» answer).
create or replace function meldy_private.quiz_answer_for(p_attempt_id uuid, p_user uuid, p_guest text, p_answers jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_a public.quiz_attempts%rowtype;
  v_i public.test_items%rowtype;
  v_x jsonb;
  v_item uuid;
  v_empty boolean;
  v_valid boolean;
  v_chosen smallint[];
  v_text text;
  v_n integer := 0;
begin
  select a.quiz_id into v_a.quiz_id from public.quiz_attempts a
   where a.id = p_attempt_id and (a.user_id = p_user or a.guest_hash = p_guest);
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002', detail = 'attempt';
  end if;
  perform meldy_private.quiz_settle(v_a.quiz_id);
  select a.* into v_a from public.quiz_attempts a where a.id = p_attempt_id for update;
  if v_a.finished_at is not null then
    raise exception 'attempt is over' using errcode = 'MC012', detail = 'finished';
  end if;
  if v_a.deadline_at is not null and pg_catalog.now() > v_a.deadline_at + interval '20 seconds' then
    raise exception 'attempt is over' using errcode = 'MC012', detail = 'time';
  end if;
  if p_answers is null or pg_catalog.jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'invalid answers' using errcode = '22023', detail = 'answers';
  end if;
  if pg_catalog.jsonb_array_length(p_answers) not between 1 and 200 then
    raise exception 'invalid answers' using errcode = '22023', detail = 'answers';
  end if;
  for v_x in select x from pg_catalog.jsonb_array_elements(p_answers) x loop
    if pg_catalog.jsonb_typeof(v_x) is distinct from 'object' or pg_catalog.jsonb_typeof(v_x -> 'item_id') is distinct from 'string'
       or (v_x ->> 'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid answers' using errcode = '22023', detail = 'item';
    end if;
    v_item := (v_x ->> 'item_id')::uuid;
    if not (v_item = any (v_a.item_ids)) then
      raise exception 'invalid answers' using errcode = '22023', detail = 'item';
    end if;
    select i.* into v_i from public.test_items i where i.id = v_item;
    if not found then
      raise exception 'invalid answers' using errcode = '22023', detail = 'item';
    end if;
    if v_i.kind = 'short' then
      v_empty := coalesce(pg_catalog.jsonb_typeof(v_x -> 'text'), 'null') = 'null'
                 or (pg_catalog.jsonb_typeof(v_x -> 'text') = 'string' and public.meldy_short_norm(v_x ->> 'text') = '');
    else
      v_empty := coalesce(pg_catalog.jsonb_typeof(v_x -> 'chosen'), 'null') = 'null' or v_x -> 'chosen' = '[]'::jsonb;
    end if;
    if v_empty then
      delete from public.quiz_answers w where w.attempt_id = v_a.id and w.item_id = v_item;
    else
      select g.o_valid, g.o_chosen, g.o_text into v_valid, v_chosen, v_text
        from meldy_private.grade_answer(v_i.kind, pg_catalog.jsonb_array_length(v_i.options), v_i.correct, v_i.answers,
               case when v_i.kind = 'short' then pg_catalog.jsonb_build_object('text', v_x -> 'text')
                    else pg_catalog.jsonb_build_object('chosen', v_x -> 'chosen') end) g;
      if not v_valid or (v_i.kind = 'short' and pg_catalog.char_length(v_text) > 200) then
        raise exception 'invalid answers' using errcode = '22023',
          detail = case when v_i.kind = 'short' then 'text' else 'chosen' end;
      end if;
      insert into public.quiz_answers (attempt_id, item_id, chosen, text, answered_at)
      values (v_a.id, v_item, case when v_i.kind <> 'short' then v_chosen end,
              case when v_i.kind = 'short' then v_text end, pg_catalog.now())
      on conflict (attempt_id, item_id) do update
        set chosen = excluded.chosen, text = excluded.text, answered_at = excluded.answered_at;
    end if;
    v_n := v_n + 1;
  end loop;
  return pg_catalog.jsonb_build_object('saved', v_n, 'server_now', pg_catalog.now(), 'deadline_at', v_a.deadline_at);
end;
$fn$;

-- 5j. «Завершить» for a person (quiz_finish of release 46): an unfinished attempt ends now («sent»), or at its deadline
--     when that has passed («time» / «closed»); a finished one stays. Returns Result.
create or replace function meldy_private.quiz_finish_for(p_attempt_id uuid, p_user uuid, p_guest text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_a public.quiz_attempts%rowtype;
  v_limit integer;
begin
  select a.quiz_id into v_a.quiz_id from public.quiz_attempts a
   where a.id = p_attempt_id and (a.user_id = p_user or a.guest_hash = p_guest);
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002', detail = 'attempt';
  end if;
  perform meldy_private.quiz_settle(v_a.quiz_id);
  select a.* into v_a from public.quiz_attempts a where a.id = p_attempt_id for update;
  if v_a.finished_at is null then
    if v_a.deadline_at is not null and pg_catalog.now() > v_a.deadline_at then
      select q.time_limit_s into v_limit from public.quizzes q where q.id = v_a.quiz_id;
      update public.quiz_attempts a
         set finished_at = a.deadline_at, finish_reason = meldy_private.quiz_end_reason(a.started_at, a.deadline_at, v_limit)
       where a.id = p_attempt_id;
    else
      update public.quiz_attempts a set finished_at = pg_catalog.now(), finish_reason = 'sent' where a.id = p_attempt_id;
    end if;
  end if;
  return meldy_private.quiz_result_json(p_attempt_id);
end;
$fn$;

-- 5k. The result of a person's finished attempt (an unfinished one → 22023 unfinished).
create or replace function meldy_private.quiz_result_for(p_attempt_id uuid, p_user uuid, p_guest text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_quiz uuid;
begin
  select a.quiz_id into v_quiz from public.quiz_attempts a
   where a.id = p_attempt_id and (a.user_id = p_user or a.guest_hash = p_guest);
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002', detail = 'attempt';
  end if;
  perform meldy_private.quiz_settle(v_quiz);
  if exists (select 1 from public.quiz_attempts a where a.id = p_attempt_id and a.finished_at is null) then
    raise exception 'attempt not finished' using errcode = '22023', detail = 'unfinished';
  end if;
  return meldy_private.quiz_result_json(p_attempt_id);
end;
$fn$;

-- 5l. Result (release 46.1) for the attempt's person, plus: each item's explanation only when the review shows the
--     answers ('' → null); accent; practice = {exam_title, member} when the author offers it and the taker is not the
--     author (a guest: member false), else null. A guest whose quiz no longer takes guests cannot retry.
create or replace function meldy_private.quiz_result_json(p_attempt uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_a public.quiz_attempts%rowtype;
  v_q public.quizzes%rowtype;
  v_total integer;
  v_correct integer;
  v_percent integer;
  v_review text;
  v_used integer;
  v_items jsonb := '[]'::jsonb;
begin
  select a.* into v_a from public.quiz_attempts a where a.id = p_attempt;
  select q.* into v_q from public.quizzes q where q.id = v_a.quiz_id;
  select pg_catalog.count(*)::integer, (pg_catalog.count(*) filter (where g.correct))::integer into v_total, v_correct
    from meldy_private.quiz_graded(null, p_attempt) g;
  v_percent := case when v_total > 0 then pg_catalog.round(100.0 * v_correct / v_total)::integer else 0 end;
  v_review := case when v_q.review <> 'mistakes_then_answers' then v_q.review
                   when meldy_private.quiz_state(v_q) = 'closed' then 'answers'
                   else 'mistakes' end;
  select pg_catalog.count(*)::integer into v_used
    from public.quiz_attempts a
   where a.quiz_id = v_q.id and (a.user_id = v_a.user_id or a.guest_hash = v_a.guest_hash);
  if v_review <> 'score' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', i.id, 'kind', i.kind, 'stem', i.stem, 'options', i.options, 'code', i.code, 'images', i.images,
             'keep_order', i.keep_order,
             'chosen', pg_catalog.to_jsonb(g.chosen), 'text', g.typed, 'right', g.correct,
             'key', case when v_review = 'answers' and i.kind <> 'short' then pg_catalog.to_jsonb(i.correct) end,
             'forms', case when v_review = 'answers' and i.kind = 'short' then pg_catalog.to_jsonb(i.answers) end,
             'explanation', case when v_review = 'answers' then nullif(i.explanation, '') end)
             order by g.ord), '[]'::jsonb)
      into v_items
      from meldy_private.quiz_graded(null, p_attempt) g
      join public.test_items i on i.id = g.item_id;
  end if;
  return pg_catalog.jsonb_build_object(
    'attempt_id', v_a.id, 'n', v_a.n, 'quiz_title', v_q.title, 'code', v_q.code, 'started_at', v_a.started_at,
    'finished_at', v_a.finished_at, 'finish_reason', v_a.finish_reason, 'correct', v_correct, 'total', v_total,
    'percent', v_percent, 'pass_percent', v_q.pass_percent, 'shuffle_options', v_q.shuffle_options,
    'passed', case when v_q.pass_percent is not null then v_percent >= v_q.pass_percent end,
    'review_now', v_review,
    'answers_after', case when v_q.review = 'mistakes_then_answers' and v_review = 'mistakes'
                          then coalesce(v_q.closed_at, v_q.closes_at) end,
    'attempts_left', case when v_q.attempts_allowed is not null then greatest(v_q.attempts_allowed - v_used, 0) end,
    'can_retry', meldy_private.quiz_block_for(v_q, v_a.user_id, v_a.guest_hash) is null
                 and (v_a.user_id is not null or v_q.guests)
                 and not exists (select 1 from public.quiz_attempts a
                                  where a.quiz_id = v_q.id and (a.user_id = v_a.user_id or a.guest_hash = v_a.guest_hash)
                                    and a.finished_at is null),
    'accent', v_q.accent,
    'practice', case when v_q.offer_practice and v_a.user_id is distinct from v_q.owner_id
                     then pg_catalog.jsonb_build_object(
                            'exam_title', (select c.title from public.containers c where c.id = v_q.container_id),
                            'member', coalesce(meldy_private.role_in(v_a.user_id, v_q.container_id) = 'member', false)) end,
    'items', v_items);
end;
$fn$;

-- 6. The author.
-- 6a. quiz_create of release 46; the new settings start as guests true («без входа»), accent blue, no cover, no offer.
create or replace function public.quiz_create(p_container_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_pool uuid[];
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- One creator per exam at a time: the count below holds until commit.
  perform 1 from public.containers c where c.id = p_container_id and c.owner_id = v_user for update;
  if not found then
    raise exception 'container not found' using errcode = 'P0002', detail = 'container';
  end if;
  if (select pg_catalog.count(*) from public.quizzes q where q.container_id = p_container_id) >= 50 then
    raise exception 'too many quizzes' using errcode = 'MC010', detail = 'quizzes';
  end if;
  v_q.id := pg_catalog.gen_random_uuid();
  v_q.container_id := p_container_id;
  v_q.owner_id := v_user;
  v_q.title := 'Контрольная · ' || pg_catalog.to_char(pg_catalog.now() at time zone 'Europe/Minsk', 'DD.MM');
  select coalesce(pg_catalog.array_agg(s.id order by s.position, s.created_at, s.id), '{}'::uuid[]) into v_q.subject_ids
    from public.container_subjects s
   where s.container_id = p_container_id
     and exists (select 1 from public.test_items i where i.subject_id = s.id and i.keyed);
  v_q.item_count := 20;
  v_q.same_set := false;
  v_q.shuffle_items := true;
  v_q.shuffle_options := true;
  v_q.attempts_allowed := 1;
  v_q.grading := 'best';
  v_q.allow_back := true;
  v_q.review := 'mistakes_then_answers';
  v_q.members_only := false;
  v_q.guests := true;
  v_q.cover_path := null;
  v_q.accent := 'blue';
  v_q.offer_practice := false;
  v_q := meldy_private.quiz_apply(v_q, coalesce(p_settings, '{}'::jsonb));
  v_pool := meldy_private.quiz_pool(p_container_id, v_q.subject_ids);
  if pg_catalog.cardinality(v_pool) = 0 then
    raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
  end if;
  v_q.item_count := least(v_q.item_count::integer, pg_catalog.cardinality(v_pool));
  if v_q.same_set then
    v_q.fixed_item_ids := meldy_private.quiz_fixed(v_q, v_pool);
  end if;
  loop
    v_q.code := meldy_private.random_code();
    exit when not exists (select 1 from public.quizzes q where q.code = v_q.code);
  end loop;
  v_q.created_at := pg_catalog.now();
  v_q.updated_at := pg_catalog.now();
  insert into public.quizzes values (v_q.*);
  return meldy_private.quiz_row(v_q);
end;
$fn$;

-- 6b. quiz_update of release 46, writing the four new settings too (none of them is locked after the start).
create or replace function public.quiz_update(p_quiz_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_old public.quizzes%rowtype;
  v_new public.quizzes%rowtype;
  v_pool uuid[];
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select q.* into v_old from public.quizzes q
    join public.containers c on c.id = q.container_id
   where q.id = p_quiz_id and c.owner_id = v_user
     for update of q;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  perform meldy_private.quiz_settle(v_old.id);
  v_new := meldy_private.quiz_apply(v_old, p_settings);
  v_pool := meldy_private.quiz_pool(v_old.container_id, v_new.subject_ids);
  if meldy_private.quiz_started(v_old) then
    if p_settings ? 'subject_ids' and v_new.subject_ids is distinct from v_old.subject_ids then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'subject_ids';
    end if;
    if p_settings ? 'item_count' and v_new.item_count <> v_old.item_count
       and least(v_new.item_count::integer, pg_catalog.cardinality(v_pool)) <> v_old.item_count then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'item_count';
    end if;
    if v_new.same_set is distinct from v_old.same_set then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'same_set';
    end if;
    if v_new.shuffle_items is distinct from v_old.shuffle_items then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'shuffle_items';
    end if;
    if v_new.shuffle_options is distinct from v_old.shuffle_options then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'shuffle_options';
    end if;
    if v_new.time_limit_s is distinct from v_old.time_limit_s then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'time_limit_min';
    end if;
    v_new.item_count := v_old.item_count;
  elsif p_settings ?| array['subject_ids', 'item_count', 'same_set'] then
    if pg_catalog.cardinality(v_pool) = 0 then
      raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
    end if;
    v_new.item_count := least(v_new.item_count::integer, pg_catalog.cardinality(v_pool));
    if not v_new.same_set then
      v_new.fixed_item_ids := null;
    elsif v_new.fixed_item_ids is null or not v_old.same_set or v_new.subject_ids is distinct from v_old.subject_ids
          or v_new.item_count <> v_old.item_count then
      v_new.fixed_item_ids := meldy_private.quiz_fixed(v_new, v_pool);
    end if;
  end if;
  if p_settings ? 'closes_at' and v_new.closes_at > pg_catalog.now() then
    v_new.closed_at := null;
  end if;
  v_new.updated_at := pg_catalog.now();
  update public.quizzes q set
    title = v_new.title, subject_ids = v_new.subject_ids, item_count = v_new.item_count, same_set = v_new.same_set,
    fixed_item_ids = v_new.fixed_item_ids, shuffle_items = v_new.shuffle_items, shuffle_options = v_new.shuffle_options,
    time_limit_s = v_new.time_limit_s, opens_at = v_new.opens_at, closes_at = v_new.closes_at,
    attempts_allowed = v_new.attempts_allowed, grading = v_new.grading, allow_back = v_new.allow_back,
    pass_percent = v_new.pass_percent, review = v_new.review, members_only = v_new.members_only,
    guests = v_new.guests, cover_path = v_new.cover_path, accent = v_new.accent, offer_practice = v_new.offer_practice,
    closed_at = v_new.closed_at, updated_at = v_new.updated_at
   where q.id = v_old.id;
  update public.quiz_attempts a set deadline_at = meldy_private.quiz_deadline(a.started_at, v_new)
   where a.quiz_id = v_old.id and a.finished_at is null
     and a.deadline_at is distinct from meldy_private.quiz_deadline(a.started_at, v_new);
  return meldy_private.quiz_row(v_new);
end;
$fn$;

-- 6c. quiz_list of release 46; guests count as people (one per token) and in the average.
create or replace function public.quiz_list(p_container_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.containers c where c.id = p_container_id and c.owner_id = v_user) then
    raise exception 'container not found' using errcode = 'P0002', detail = 'container';
  end if;
  perform meldy_private.quiz_settle(q.id) from public.quizzes q where q.container_id = p_container_id;
  return coalesce((
    select pg_catalog.jsonb_agg(meldy_private.quiz_row(q) || pg_catalog.jsonb_build_object(
             'people', (select pg_catalog.count(distinct coalesce(a.user_id::text, a.guest_hash)) from public.quiz_attempts a
                         where a.quiz_id = q.id and a.user_id is distinct from q.owner_id),
             'writing', (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = q.id and a.finished_at is null),
             'finished', (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = q.id and a.finished_at is not null),
             'avg_percent', (select pg_catalog.round(pg_catalog.avg(100.0 * s.correct / s.total), 1)
                               from (select g.attempt_id, pg_catalog.count(*) as total,
                                            pg_catalog.count(*) filter (where g.correct) as correct
                                       from meldy_private.quiz_graded(q.id, null) g
                                       join public.quiz_attempts a on a.id = g.attempt_id
                                      where a.finished_at is not null and a.user_id is distinct from q.owner_id
                                      group by g.attempt_id) s))
             order by q.created_at desc, q.id desc)
      from public.quizzes q where q.container_id = p_container_id), '[]'::jsonb);
end;
$fn$;

-- 6d. quiz_results of release 46; each attempt row also says guest (written without an account); a guest's person is
--     the first 16 hex of md5(guest_hash || quiz id), as a user's is of md5(user id || quiz id). Guests count in the
--     question stats (only the author's own attempts stay out).
create or replace function public.quiz_results(p_quiz_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select q.* into v_q from public.quizzes q
    join public.containers c on c.id = q.container_id
   where q.id = p_quiz_id and c.owner_id = v_user;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  -- One grading pass (g0) for both lists.
  with g0 as materialized (
    select g.*, a.user_id is distinct from v_q.owner_id as counted
      from meldy_private.quiz_graded(v_q.id, null) g
      join public.quiz_attempts a on a.id = g.attempt_id
  ), s as (  -- the live score of each attempt
    select g0.attempt_id, pg_catalog.count(*) as total, pg_catalog.count(*) filter (where g0.answered) as answered,
           pg_catalog.count(*) filter (where g0.correct) as correct
      from g0 group by g0.attempt_id
  ), g as (  -- the question stats count the attempts of others than the author only
    select g0.* from g0 where g0.counted
  ), x as (
    select g.item_id, pg_catalog.count(*) as shown, pg_catalog.count(*) filter (where g.answered) as answered,
           pg_catalog.count(*) filter (where g.correct) as correct
      from g group by g.item_id
  ), p as (  -- answers that chose option k of a question
    select g.item_id, c.k::integer as k, pg_catalog.count(*) as n
      from g cross join lateral pg_catalog.unnest(g.chosen) as c(k)
     group by g.item_id, c.k
  ), wt as (  -- the 3 most common wrong short answers of a question (one spelling per normalised form)
    select z.item_id, z.t, z.n
      from (select y.item_id, y.t, y.n, pg_catalog.row_number() over (partition by y.item_id order by y.n desc, y.t) as r
              from (select g.item_id, pg_catalog.min(pg_catalog.btrim(g.typed)) as t, pg_catalog.count(*) as n
                      from g where g.answered and not g.correct and g.typed is not null
                     group by g.item_id, public.meldy_short_norm(g.typed)) y) z
     where z.r <= 3
  )
  select pg_catalog.jsonb_build_object(
    'quiz', meldy_private.quiz_row(v_q), 'server_now', pg_catalog.now(),
    'attempts', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'id', a.id,
                   'person', pg_catalog.left(pg_catalog.md5(coalesce(a.user_id::text, a.guest_hash) || a.quiz_id::text), 16),
                   'name', a.name, 'own', coalesce(a.user_id = v_q.owner_id, false), 'guest', a.guest_hash is not null,
                   'n', a.n, 'started_at', a.started_at,
                   'deadline_at', a.deadline_at, 'finished_at', a.finished_at, 'finish_reason', a.finish_reason,
                   'total', coalesce(s.total, 0), 'answered', coalesce(s.answered, 0), 'correct', coalesce(s.correct, 0))
                   order by a.started_at, a.user_id, a.guest_hash, a.n), '[]'::jsonb)
                   from public.quiz_attempts a
                   left join s on s.attempt_id = a.id
                  where a.quiz_id = v_q.id),
    'items', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'item_id', i.id, 'shown', x.shown, 'answered', x.answered, 'correct', x.correct,
                'picks', case when i.kind = 'short' then '[]'::jsonb
                              else (select pg_catalog.jsonb_agg(coalesce(p.n, 0) order by o.k)
                                      from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(i.options) - 1) as o(k)
                                      left join p on p.item_id = i.id and p.k = o.k) end,
                'wrong_texts', case when i.kind <> 'short' then '[]'::jsonb
                                    else coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('text', wt.t, 'n', wt.n)
                                                                               order by wt.n desc, wt.t)
                                                     from wt where wt.item_id = i.id), '[]'::jsonb) end)
                order by cs.position, cs.created_at, i.position, i.id), '[]'::jsonb)
                from x
                join public.test_items i on i.id = x.item_id
                join public.container_subjects cs on cs.id = i.subject_id))
    into v_out;
  return v_out;
end;
$fn$;

-- 7. The participant.
-- 7a. The page /k/<code>: release 46's card + guests, cover_path, accent, offer_practice. «me»: signed in — as before
--     (the token ignored); signed out on a quiz that takes guests — the device's by the token's hash (no token or a
--     malformed one: no attempt yet); signed out otherwise — null (the page asks to sign in). Replaces
--     quiz_preview(text): one function, so PostgREST never has two candidates for {p_code}.
drop function if exists public.quiz_preview(text);
create or replace function public.quiz_preview(p_code text, p_token text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_me jsonb;
begin
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  select q.* into v_q from public.quizzes q where q.code = p_code;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  if v_user is not null then
    v_me := meldy_private.quiz_me(v_q, v_user, null);
  elsif v_q.guests then
    v_me := meldy_private.quiz_me(v_q, null, meldy_private.quiz_token_hash(p_token));
  end if;
  return pg_catalog.jsonb_build_object(
    'status', meldy_private.quiz_state(v_q), 'title', v_q.title,
    'exam_title', (select c.title from public.containers c where c.id = v_q.container_id),
    'author_name', coalesce((select nullif(pg_catalog.btrim(p.full_name), '') from public.profiles p
                              where p.id = v_q.owner_id), 'Без имени'),
    'item_count', meldy_private.quiz_draw_count(v_q), 'time_limit_s', v_q.time_limit_s,
    'opens_at', v_q.opens_at, 'closes_at', v_q.closes_at, 'attempts', v_q.attempts_allowed, 'grading', v_q.grading,
    'allow_back', v_q.allow_back, 'pass_percent', v_q.pass_percent, 'review', v_q.review,
    'members_only', v_q.members_only, 'guests', v_q.guests, 'cover_path', v_q.cover_path, 'accent', v_q.accent,
    'offer_practice', v_q.offer_practice, 'server_now', pg_catalog.now(), 'me', v_me);
end;
$fn$;

-- 7b. The signed-in participant: release 46's functions, now through the person helpers (same checks, same output).
create or replace function public.quiz_start(p_code text, p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return meldy_private.quiz_start_for(p_code, p_name, v_user, null);
end;
$fn$;

create or replace function public.quiz_answer(p_attempt_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return meldy_private.quiz_answer_for(p_attempt_id, v_user, null, p_answers);
end;
$fn$;

create or replace function public.quiz_finish(p_attempt_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return meldy_private.quiz_finish_for(p_attempt_id, v_user, null);
end;
$fn$;

create or replace function public.quiz_result(p_attempt_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  return meldy_private.quiz_result_for(p_attempt_id, v_user, null);
end;
$fn$;

-- 7c. The guest (anon, or a signed-in caller writing as the device): the same four calls by token. A token that is not
--     43 base64url characters → 22023 token; a well-formed token that is not the attempt's → P0002 attempt.
create or replace function public.quiz_guest_start(p_code text, p_name text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_hash text := meldy_private.quiz_token_hash(p_token);
begin
  if v_hash is null then
    raise exception 'invalid token' using errcode = '22023', detail = 'token';
  end if;
  return meldy_private.quiz_start_for(p_code, p_name, null, v_hash);
end;
$fn$;

create or replace function public.quiz_guest_answer(p_attempt_id uuid, p_token text, p_answers jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_hash text := meldy_private.quiz_token_hash(p_token);
begin
  if v_hash is null then
    raise exception 'invalid token' using errcode = '22023', detail = 'token';
  end if;
  return meldy_private.quiz_answer_for(p_attempt_id, null, v_hash, p_answers);
end;
$fn$;

create or replace function public.quiz_guest_finish(p_attempt_id uuid, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_hash text := meldy_private.quiz_token_hash(p_token);
begin
  if v_hash is null then
    raise exception 'invalid token' using errcode = '22023', detail = 'token';
  end if;
  return meldy_private.quiz_finish_for(p_attempt_id, null, v_hash);
end;
$fn$;

create or replace function public.quiz_guest_result(p_attempt_id uuid, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_hash text := meldy_private.quiz_token_hash(p_token);
begin
  if v_hash is null then
    raise exception 'invalid token' using errcode = '22023', detail = 'token';
  end if;
  return meldy_private.quiz_result_for(p_attempt_id, null, v_hash);
end;
$fn$;

-- 7d. After signing in on /k/<code>: when the caller has no attempt in the quiz, the device's attempts become theirs
--     (user_id set, guest_hash cleared; the numbers stay); else nothing moves ({claimed: 0}: two people's attempts are
--     never merged). The quiz row is locked as a start locks it.
create or replace function public.quiz_guest_claim(p_code text, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_hash text := meldy_private.quiz_token_hash(p_token);
  v_quiz uuid;
  v_n integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if v_hash is null then
    raise exception 'invalid token' using errcode = '22023', detail = 'token';
  end if;
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  select q.id into v_quiz from public.quizzes q where q.code = p_code for update;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  if exists (select 1 from public.quiz_attempts a where a.quiz_id = v_quiz and a.user_id = v_user) then
    return pg_catalog.jsonb_build_object('claimed', 0);
  end if;
  update public.quiz_attempts a set user_id = v_user, guest_hash = null
   where a.quiz_id = v_quiz and a.guest_hash = v_hash;
  get diagnostics v_n = row_count;
  return pg_catalog.jsonb_build_object('claimed', v_n);
end;
$fn$;

-- 7e. «Тренировать эти вопросы»: the author offers it (offer_practice) and the caller has a finished attempt in the
--     quiz (else MC018 practice); the author gets their exam back, nothing written; removed by the author → MC018
--     removed; 200 active members → MC018 full; an active member → as they are; left before → back (left_at null);
--     else a member row as container_join writes one (no link: link_id null, no link seat). The exam row is locked:
--     the count of members holds until commit.
create or replace function public.quiz_practice_join(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_m public.container_members%rowtype;
  v_found boolean;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  select q.* into v_q from public.quizzes q where q.code = p_code;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  if not v_q.offer_practice
     or not exists (select 1 from public.quiz_attempts a
                     where a.quiz_id = v_q.id and a.user_id = v_user and a.finished_at is not null) then
    raise exception 'no practice offered' using errcode = 'MC018', detail = 'practice';
  end if;
  if exists (select 1 from public.containers c where c.id = v_q.container_id and c.owner_id = v_user) then
    return pg_catalog.jsonb_build_object('container_id', v_q.container_id);
  end if;
  perform 1 from public.containers c where c.id = v_q.container_id for update;
  select m.* into v_m from public.container_members m
   where m.container_id = v_q.container_id and m.user_id = v_user
     for update;
  v_found := found;
  if v_found and v_m.removed_at is not null then
    raise exception 'removed from this container' using errcode = 'MC018', detail = 'removed';
  end if;
  if v_found and v_m.left_at is null then
    return pg_catalog.jsonb_build_object('container_id', v_q.container_id);
  end if;
  if (select pg_catalog.count(*) from public.container_members m
       where m.container_id = v_q.container_id and m.left_at is null and m.removed_at is null) >= 200 then
    raise exception 'no seat left' using errcode = 'MC018', detail = 'full';
  end if;
  if v_found then
    update public.container_members m set left_at = null
     where m.container_id = v_q.container_id and m.user_id = v_user;
  else
    insert into public.container_members (container_id, user_id) values (v_q.container_id, v_user);
  end if;
  return pg_catalog.jsonb_build_object('container_id', v_q.container_id);
end;
$fn$;

-- 8. Pictures and covers.
-- 8a. The picture paths a guest may read: stems and options of every item in the subjects of quizzes that take guests
--     (any state: the review after the closing still shows them). The storage policy below reads it for anon.
create or replace function public.guest_quiz_picture_paths()
returns setof text
language sql
stable
security definer
set search_path = ''
as $fn$
  select distinct p.path
    from public.quizzes q
    join public.test_items i on i.subject_id = any (q.subject_ids) and i.container_id = q.container_id
   cross join lateral (
           select s.path from pg_catalog.jsonb_array_elements_text(coalesce(i.images -> 'stem', '[]'::jsonb)) as s(path)
           union all
           select o.path from pg_catalog.jsonb_array_elements(coalesce(i.images -> 'options', '[]'::jsonb)) as l(list)
            cross join lateral pg_catalog.jsonb_array_elements_text(l.list) as o(path)
         ) p
   where q.guests and i.images <> '{}'::jsonb
$fn$;

-- 8b. The public bucket of covers (3 MB; PNG, JPEG, GIF, WebP): anyone opens a cover by its address; only the owner of
--     an exam writes its folder. The owner's read policy is there because the Storage API reads the row before an
--     update or a remove (supabase-js reference: remove needs select and delete).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quiz-covers', 'quiz-covers', true, 3145728, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

do $do$
begin
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Test item images: quiz guests read') then
    create policy "Test item images: quiz guests read" on storage.objects for select to anon
      using (bucket_id = 'test-item-images' and name in (select public.guest_quiz_picture_paths()));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Quiz covers: owner uploads') then
    create policy "Quiz covers: owner uploads" on storage.objects for insert to authenticated
      with check (bucket_id = 'quiz-covers'
                  and (storage.foldername(name))[1] in (select c.id::text from public.containers c
                                                          where c.owner_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Quiz covers: owner reads') then
    create policy "Quiz covers: owner reads" on storage.objects for select to authenticated
      using (bucket_id = 'quiz-covers'
             and (storage.foldername(name))[1] in (select c.id::text from public.containers c
                                                     where c.owner_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Quiz covers: owner updates') then
    create policy "Quiz covers: owner updates" on storage.objects for update to authenticated
      using (bucket_id = 'quiz-covers'
             and (storage.foldername(name))[1] in (select c.id::text from public.containers c
                                                     where c.owner_id = (select auth.uid())))
      with check (bucket_id = 'quiz-covers'
                  and (storage.foldername(name))[1] in (select c.id::text from public.containers c
                                                          where c.owner_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Quiz covers: owner deletes') then
    create policy "Quiz covers: owner deletes" on storage.objects for delete to authenticated
      using (bucket_id = 'quiz-covers'
             and (storage.foldername(name))[1] in (select c.id::text from public.containers c
                                                     where c.owner_id = (select auth.uid())));
  end if;
end;
$do$;

-- 9. Grants. Guests (anon) run the preview, the four guest calls and the picture paths; claim, practice and reorder
--    need an account; the helpers stay private (meldy_private has no USAGE for clients anyway).
revoke all on function public.quiz_preview(text, text), public.quiz_guest_start(text, text, text),
  public.quiz_guest_answer(uuid, text, jsonb), public.quiz_guest_finish(uuid, text), public.quiz_guest_result(uuid, text),
  public.guest_quiz_picture_paths()
  from public;
grant execute on function public.quiz_preview(text, text), public.quiz_guest_start(text, text, text),
  public.quiz_guest_answer(uuid, text, jsonb), public.quiz_guest_finish(uuid, text), public.quiz_guest_result(uuid, text),
  public.guest_quiz_picture_paths()
  to anon, authenticated;
revoke all on function public.quiz_guest_claim(text, text), public.quiz_practice_join(text),
  public.container_items_reorder(uuid, uuid[])
  from public, anon;
grant execute on function public.quiz_guest_claim(text, text), public.quiz_practice_join(text),
  public.container_items_reorder(uuid, uuid[])
  to authenticated;
revoke all on function meldy_private.quiz_block_for(public.quizzes, uuid, text), meldy_private.quiz_token_hash(text),
  meldy_private.quiz_ip_hash(), meldy_private.quiz_me(public.quizzes, uuid, text),
  meldy_private.quiz_start_for(text, text, uuid, text), meldy_private.quiz_answer_for(uuid, uuid, text, jsonb),
  meldy_private.quiz_finish_for(uuid, uuid, text), meldy_private.quiz_result_for(uuid, uuid, text)
  from public, anon, authenticated;
