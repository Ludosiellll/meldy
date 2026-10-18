-- test_docs («Студия теста», release 47.1: the test as a page of blocks; quizzes «как в студии»)
-- Repo file: supabase/migrations/20261019100000_test_docs.sql. Spec: meldy-notes 10_Project/Test_Builder_Spec_2026-10-18.md
-- §47.6; plan: docs/superpowers/plans/2026-10-18-studio.md («Data contract — database (agent S1)», items 1–4; the
-- document's shape is frontend/src/types/testDoc.ts, and meldy_private.test_doc_ok below mirrors it). Base: release 47
-- (20261018100000_test_builder.sql on 20261016120000_quizzes.sql + 20261016140000_quiz_result_order.sql).
-- Check after the apply: supabase/tests/test_docs.sql (test_builder.sql, quizzes.sql, quiz_result_order.sql still hold).
-- Local rehearsal (never live): supabase/tests/local/test_docs_run.sh. Rollback: supabase/rollback/20261019100000_test_docs_down.sql.
--
-- 1. public.test_docs: one document per exam (blocks, theme, layout, the result screen), at most 200 KB as jsonb text,
--    with a revision for two tabs. RLS on, no policy, no client right: test_doc_get / test_doc_save are the only door,
--    for the exam's owner only. The questions stay rows of test_items; a question block points at one by id. Deleting a
--    row leaves its block dangling (nothing cascades into the JSON): the readers skip such blocks, and a save must drop
--    them (the rule block:<n>:item_id).
-- 2. meldy_private.test_doc_ok(doc, exam) → null when the document is valid, else the first broken rule, in this order:
--    version (an object of the keys v, title, theme, layout, blocks, results and no other, v = 1), title, theme,
--    layout, blocks (an array of at most 400), block:<n>:<rule> per block (n counts from 0, the index in blocks), results.
--    A block's rules, in this order: type (an object of a known type), id (^[a-z0-9]{8,24}$, unique in the document),
--    then its fields in the order of types/testDoc.ts (title, subtitle, image, align / text, size / text, align / path,
--    caption, width / tone, text / — / title / item_id, points, required), then type again for a key the type does not
--    have. Texts «1..N» need a character that is not a space; «0..N» may be empty. Pictures: the exam's own folder of
--    quiz-covers («<exam id>/<sha256>.<png|jpg|gif|webp>», as the quiz cover). item_id: a test_items row of this exam,
--    at most once in the document. points 1..100, a band's from / to and the background's dim: whole numbers.
--    results: at most 6 bands, each 0 ≤ from ≤ to ≤ 100, no two overlapping; cta null or {label 1..200, url ^https://,
--    ≤ 300}.
-- 3. Quizzes «как в студии»: quizzes.design (quiz_apply key «design», locked after the start like the set: MC011
--    design). A design quiz draws the document's question blocks in their order, all of them (at most 200, the limit of
--    an attempt), those whose row is a keyed question of the exam (a dangling block or a question without a key is
--    skipped, as the pool skips them); shuffle_items, same_set, item_count and subject_ids are stored as given and
--    ignored by the draw (the preview's item_count is the number drawn). shuffle_options still applies. QuizRow, the
--    preview, the taker's attempt and the result carry «design»: QuizRow the flag, the others the stored document
--    {title, theme, layout, blocks, results} of a design quiz (it holds no key: the questions are not in it), null
--    otherwise; the result also «band», the result band whose from..to holds its percent (null when none does).
-- The key and the explanation still leave the server only through the result, and only when the review allows it.
-- Re-runnable: IF NOT EXISTS, OR REPLACE, guarded DO blocks; CREATE OR REPLACE keeps the grants of replaced functions;
-- a second apply leaves the catalog as the first one did. The whole file is one request (supabase/migrate.py).
-- New errors (SQLSTATE): MC020 stale (test_doc_save: p_rev is not the stored revision, 0 when there is none; the
-- message carries nothing, the client refetches). 22023 detail size (more than 200 KB) or the rule of test_doc_ok;
-- MC011 detail design; P0002 detail container (not the caller's exam).

-- 1. The document of an exam.
create table if not exists public.test_docs (
  container_id uuid primary key references public.containers(id) on delete cascade,
  doc jsonb not null,
  rev integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint test_docs_doc_check check (octet_length(doc::text) <= 204800),
  constraint test_docs_rev_check check (rev >= 1)
);
alter table public.test_docs enable row level security;
revoke all on table public.test_docs from public, anon, authenticated;

-- 2. The document's rules.
-- 2a. A JSON string of p_min..p_max characters; p_min > 0 also needs a character that is not a space.
create or replace function meldy_private.test_doc_str(p jsonb, p_min integer, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case when pg_catalog.jsonb_typeof(p) = 'string'
              then pg_catalog.char_length(p #>> '{}') <= p_max and (p_min = 0 or (p #>> '{}') ~ '[^[:space:]]')
              else false end
$fn$;

-- 2b. A JSON string that is one of p_values.
create or replace function meldy_private.test_doc_enum(p jsonb, p_values text[])
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case when pg_catalog.jsonb_typeof(p) = 'string' then coalesce((p #>> '{}') = any (p_values), false) else false end
$fn$;

-- 2c. A JSON whole number p_min..p_max (0..999 written without a fraction or a sign).
create or replace function meldy_private.test_doc_int(p jsonb, p_min integer, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select case when pg_catalog.jsonb_typeof(p) = 'number' and (p #>> '{}') ~ '^[0-9]{1,3}$'
              then (p #>> '{}')::integer between p_min and p_max
              else false end
$fn$;

-- 2d. A JSON object with exactly the keys p_keys.
create or replace function meldy_private.test_doc_keys(p jsonb, p_keys text[])
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if pg_catalog.jsonb_typeof(p) is distinct from 'object' then
    return false;
  end if;
  return (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(p) k)
         is not distinct from (select pg_catalog.array_agg(k order by k) from pg_catalog.unnest(p_keys) k);
end;
$fn$;

-- 2e. A picture of the page: «<exam id>/<sha256>.<ext>» in the folder of p_container (quiz-covers); JSON null when
--     p_nullable.
create or replace function meldy_private.test_doc_image(p jsonb, p_container uuid, p_nullable boolean)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(case when pg_catalog.jsonb_typeof(p) = 'null' then p_nullable
                       when pg_catalog.jsonb_typeof(p) = 'string'
                       then (p #>> '{}') ~ '^[0-9a-f-]{36}/[0-9a-f]{64}[.](png|jpg|gif|webp)$'
                            and pg_catalog.split_part(p #>> '{}', '/', 1) = p_container::text
                       else false end, false)
$fn$;

-- 2f. The whole document: null when valid, else the first broken rule (the order of the header, §2).
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

-- 3. The author's functions (the exam's owner only; anyone else, and a missing exam → P0002 container).
-- 3a. The document with its revision, or null when the exam has none yet. Dangling question blocks come as stored.
create or replace function public.test_doc_get(p_container_id uuid)
returns jsonb
language plpgsql
stable
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
  return (select pg_catalog.jsonb_build_object('container_id', d.container_id, 'doc', d.doc, 'rev', d.rev,
                                               'updated_at', d.updated_at)
            from public.test_docs d where d.container_id = p_container_id);
end;
$fn$;

-- 3b. Save the whole document over revision p_rev (0 = the first save): a stored revision other than p_rev (another
--     tab saved since) → MC020 stale; more than 200 KB → 22023 size; a broken rule → 22023 with the rule. Returns the
--     new revision and its time. The exam row is locked first: two tabs saving together get one revision each, in turn.
create or replace function public.test_doc_save(p_container_id uuid, p_doc jsonb, p_rev integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_rev integer;
  v_why text;
  v_d public.test_docs%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform 1 from public.containers c where c.id = p_container_id and c.owner_id = v_user for update;
  if not found then
    raise exception 'container not found' using errcode = 'P0002', detail = 'container';
  end if;
  select d.rev into v_rev from public.test_docs d where d.container_id = p_container_id;
  if p_rev is null or p_rev <> coalesce(v_rev, 0) then
    raise exception 'stale' using errcode = 'MC020', detail = 'stale';
  end if;
  if pg_catalog.octet_length(p_doc::text) > 204800 then
    raise exception 'invalid document' using errcode = '22023', detail = 'size';
  end if;
  v_why := meldy_private.test_doc_ok(p_doc, p_container_id);
  if v_why is not null then
    raise exception 'invalid document' using errcode = '22023', detail = v_why;
  end if;
  if v_rev is null then
    insert into public.test_docs (container_id, doc, rev, updated_at)
    values (p_container_id, p_doc, 1, pg_catalog.now())
    returning * into v_d;
  else
    update public.test_docs d set doc = p_doc, rev = d.rev + 1, updated_at = pg_catalog.now()
     where d.container_id = p_container_id
    returning d.* into v_d;
  end if;
  return pg_catalog.jsonb_build_object('rev', v_d.rev, 'updated_at', v_d.updated_at);
end;
$fn$;

-- 4. Quizzes «как в студии».
alter table public.quizzes add column if not exists design boolean not null default false;

-- 4a. The questions of a design quiz: the document's question blocks in order whose row is a keyed question of the exam
--     (a dangling block or a question without a key is skipped), each once, at most 200 (an attempt's limit).
create or replace function meldy_private.quiz_doc_items(p_container uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $fn$
  select coalesce((pg_catalog.array_agg(x.id order by x.ord))[1:200], '{}'::uuid[])
    from (select i.id, pg_catalog.min(b.ord) as ord
            from public.test_docs d
           cross join lateral pg_catalog.jsonb_array_elements(
                   case when pg_catalog.jsonb_typeof(d.doc -> 'blocks') = 'array' then d.doc -> 'blocks' else '[]'::jsonb end)
                   with ordinality as b(x, ord)
            join public.test_items i
              on i.id = case when pg_catalog.jsonb_typeof(b.x) = 'object' and b.x ->> 'type' = 'question'
                                  and (b.x ->> 'item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             then (b.x ->> 'item_id')::uuid end
             and i.container_id = d.container_id and i.keyed
           where d.container_id = p_container
           group by i.id) x
$fn$;

-- 4b. «design» of the preview, the attempt and the result: the stored document of a design quiz without its version
--     ({title, theme, layout, blocks, results}; no key is in it), null for any other quiz or when there is no document.
create or replace function meldy_private.quiz_design(p_q public.quizzes)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select case when p_q.design
              then (select pg_catalog.jsonb_build_object('title', d.doc -> 'title', 'theme', d.doc -> 'theme',
                                                         'layout', d.doc -> 'layout', 'blocks', d.doc -> 'blocks',
                                                         'results', d.doc -> 'results')
                      from public.test_docs d where d.container_id = p_q.container_id) end
$fn$;

-- 4c. QuizRow (release 47) + design.
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
    'offer_practice', p_q.offer_practice, 'design', p_q.design, 'created_at', p_q.created_at, 'updated_at', p_q.updated_at,
    'state', meldy_private.quiz_state(p_q), 'started', meldy_private.quiz_started(p_q))
$fn$;

-- 4d. The settings applied on a quiz row (release 47) + design (a boolean; 22023 design).
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
  if p_settings ? 'design' then
    v_q.design := meldy_private.quiz_bool(p_settings, 'design');
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

-- 4e. The questions of a new attempt (release 46) — a design quiz: the document's (4a), in its order.
create or replace function meldy_private.quiz_draw(p_q public.quizzes)
returns uuid[]
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_pool uuid[];
  v_set uuid[];
begin
  if p_q.design then
    return meldy_private.quiz_doc_items(p_q.container_id);
  end if;
  v_pool := meldy_private.quiz_pool(p_q.container_id, p_q.subject_ids);
  if p_q.same_set and p_q.fixed_item_ids is not null then
    select coalesce(pg_catalog.array_agg(f.id order by f.ord), '{}'::uuid[]) into v_set
      from pg_catalog.unnest(p_q.fixed_item_ids) with ordinality as f(id, ord)
     where f.id = any (v_pool);
  else
    v_set := meldy_private.quiz_fixed(p_q, v_pool);
  end if;
  if p_q.shuffle_items then
    return (select coalesce(pg_catalog.array_agg(s.id order by pg_catalog.random()), '{}'::uuid[])
              from pg_catalog.unnest(v_set) as s(id));
  end if;
  return (select coalesce(pg_catalog.array_agg(s.id order by pg_catalog.array_position(v_pool, s.id)), '{}'::uuid[])
            from pg_catalog.unnest(v_set) as s(id));
end;
$fn$;

-- 4f. How many questions a start would draw now (release 46) — a design quiz: the document's.
create or replace function meldy_private.quiz_draw_count(p_q public.quizzes)
returns integer
language sql
stable
set search_path = ''
as $fn$
  select case when p_q.design then pg_catalog.cardinality(meldy_private.quiz_doc_items(p_q.container_id))
              when p_q.same_set and p_q.fixed_item_ids is not null
              then (select pg_catalog.count(*)::integer from pg_catalog.unnest(p_q.fixed_item_ids) f
                     where f = any (meldy_private.quiz_pool(p_q.container_id, p_q.subject_ids)))
              else least(p_q.item_count::integer,
                         pg_catalog.cardinality(meldy_private.quiz_pool(p_q.container_id, p_q.subject_ids))) end
$fn$;

-- 4g. Attempt (release 46) + design. Still without correct / answers / explanation.
create or replace function meldy_private.quiz_attempt_json(p_a public.quiz_attempts, p_q public.quizzes)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'attempt_id', p_a.id, 'n', p_a.n, 'quiz_title', p_q.title, 'server_now', pg_catalog.now(),
    'started_at', p_a.started_at, 'deadline_at', p_a.deadline_at, 'allow_back', p_q.allow_back,
    'shuffle_options', p_q.shuffle_options, 'design', meldy_private.quiz_design(p_q),
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'id', i.id, 'kind', i.kind, 'stem', i.stem, 'options', i.options, 'code', i.code,
                                'keep_order', i.keep_order, 'images', i.images) order by x.ord)
                         from pg_catalog.unnest(p_a.item_ids) with ordinality as x(id, ord)
                         join public.test_items i on i.id = x.id), '[]'::jsonb),
    'answers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                  'item_id', w.item_id, 'chosen', pg_catalog.to_jsonb(w.chosen), 'text', w.text)
                                order by pg_catalog.array_position(p_a.item_ids, w.item_id))
                           from public.quiz_answers w where w.attempt_id = p_a.id), '[]'::jsonb))
$fn$;

-- 4h. Result (release 47) + design and band: the band of the document whose from..to holds the percent (null when
--     none does, and for a quiz without design).
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
  v_design jsonb;
  v_band jsonb;
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
  v_design := meldy_private.quiz_design(v_q);
  select b.x into v_band
    from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(v_design -> 'results' -> 'bands') = 'array'
                                              then v_design -> 'results' -> 'bands' else '[]'::jsonb end)
         with ordinality as b(x, o)
   where case when b.x ->> 'from' ~ '^[0-9]{1,3}$' and b.x ->> 'to' ~ '^[0-9]{1,3}$'
              then (b.x ->> 'from')::integer <= v_percent and v_percent <= (b.x ->> 'to')::integer
              else false end
   order by b.o
   limit 1;
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
    'design', v_design,
    'band', v_band,
    'items', v_items);
end;
$fn$;

-- 4i. quiz_create (release 47): design starts false. A design quiz needs a question to draw from the document (MC013
--     no_questions); its draw settings are stored as given (item_count clamped to a non-empty pool, as before).
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
  v_q.design := false;
  v_q := meldy_private.quiz_apply(v_q, coalesce(p_settings, '{}'::jsonb));
  v_pool := meldy_private.quiz_pool(p_container_id, v_q.subject_ids);
  if v_q.design then
    if pg_catalog.cardinality(meldy_private.quiz_doc_items(p_container_id)) = 0 then
      raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
    end if;
  elsif pg_catalog.cardinality(v_pool) = 0 then
    raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
  end if;
  if pg_catalog.cardinality(v_pool) > 0 then
    v_q.item_count := least(v_q.item_count::integer, pg_catalog.cardinality(v_pool));
    if v_q.same_set then
      v_q.fixed_item_ids := meldy_private.quiz_fixed(v_q, v_pool);
    end if;
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

-- 4j. quiz_update (release 47) + design: locked after the start (MC011 design); switched on, the document must have a
--     question to draw (MC013 no_questions); with design the pool may be empty (the draw settings stay as given).
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
    if v_new.design is distinct from v_old.design then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'design';
    end if;
    v_new.item_count := v_old.item_count;
  elsif p_settings ?| array['subject_ids', 'item_count', 'same_set', 'design'] then
    if v_new.design then
      if pg_catalog.cardinality(meldy_private.quiz_doc_items(v_old.container_id)) = 0 then
        raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
      end if;
    elsif pg_catalog.cardinality(v_pool) = 0 then
      raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
    end if;
    if pg_catalog.cardinality(v_pool) = 0 then
      v_new.fixed_item_ids := null;
    else
      v_new.item_count := least(v_new.item_count::integer, pg_catalog.cardinality(v_pool));
      if not v_new.same_set then
        v_new.fixed_item_ids := null;
      elsif v_new.fixed_item_ids is null or not v_old.same_set or v_new.subject_ids is distinct from v_old.subject_ids
            or v_new.item_count <> v_old.item_count then
        v_new.fixed_item_ids := meldy_private.quiz_fixed(v_new, v_pool);
      end if;
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
    design = v_new.design, closed_at = v_new.closed_at, updated_at = v_new.updated_at
   where q.id = v_old.id;
  update public.quiz_attempts a set deadline_at = meldy_private.quiz_deadline(a.started_at, v_new)
   where a.quiz_id = v_old.id and a.finished_at is null
     and a.deadline_at is distinct from meldy_private.quiz_deadline(a.started_at, v_new);
  return meldy_private.quiz_row(v_new);
end;
$fn$;

-- 4k. The page /k/<code> (release 47) + design (the document of a design quiz, null otherwise).
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
    'offer_practice', v_q.offer_practice, 'design', meldy_private.quiz_design(v_q),
    'server_now', pg_catalog.now(), 'me', v_me);
end;
$fn$;

-- 5. Grants. The author's two functions need an account; the rules and the quiz helpers stay private (meldy_private
--    has no USAGE for clients anyway). The replaced functions keep their grants (CREATE OR REPLACE).
revoke all on function public.test_doc_get(uuid), public.test_doc_save(uuid, jsonb, integer) from public, anon;
grant execute on function public.test_doc_get(uuid), public.test_doc_save(uuid, jsonb, integer) to authenticated;
revoke all on function meldy_private.test_doc_str(jsonb, integer, integer), meldy_private.test_doc_enum(jsonb, text[]),
  meldy_private.test_doc_int(jsonb, integer, integer), meldy_private.test_doc_keys(jsonb, text[]),
  meldy_private.test_doc_image(jsonb, uuid, boolean), meldy_private.test_doc_ok(jsonb, uuid),
  meldy_private.quiz_doc_items(uuid), meldy_private.quiz_design(public.quizzes)
  from public, anon, authenticated;
