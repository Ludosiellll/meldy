-- studio_pages: the studio's page holds every question of the exam (owner, 2026-11-05: an exam of 960 questions, the
-- studio showed 400 of them — «можно ли показать остальные на второй странице, потом на третьей»). Repo file:
-- supabase/migrations/20261107090500_studio_pages.sql. Base: the live order up to 20261107090400_studio_color_bg.sql.
-- Each function replaced here is its newest body with this file's change: meldy_private.test_doc_ok
-- (20261107090400_studio_color_bg.sql), public.test_doc_save (20261019100000_test_docs.sql), meldy_private.quiz_doc_items
-- (20261101090200_question_kinds_quiz.sql), meldy_private.quiz_draw and meldy_private.quiz_draw_count
-- (20261019100000_test_docs.sql). The client's caps are frontend/src/types/testDoc.ts DOC_MAX_BLOCKS and DOC_MAX_BYTES.
-- Check after the apply: supabase/tests/studio_pages.sql (read-only; test_docs.sql, doc_video.sql and studio_color_bg.sql
-- still hold). Local rehearsal (never live): supabase/tests/local/studio_pages_run.sh. Rollback:
-- supabase/rollback/20261107090500_studio_pages_down.sql (the five bodies back byte for byte, the 200 KB check back).
--
-- 1. public.test_docs: a document of at most 512 KB of jsonb text (524288 bytes, was 204800). A question block is about
--    128 bytes (live, 2026-11-05: 400 of them in 51 102 bytes), so the exam's 2000 questions take ≈ 256 KB and leave
--    ≈ 256 KB for the rest of the page (texts, notes, pictures' captions, the result screen): about 30 texts of 4000
--    Cyrillic letters, where 200 KB left room for 19. The check is widened as NOT VALID and left so (as
--    20261105090000_quiz_stats.sql did): the file is one transaction, the DROP/ADD holds ACCESS EXCLUSIVE to its end, and
--    every stored row already passed the narrower check; each new or changed row is checked. lock_timeout 2s: a busy
--    table makes the apply fail at once instead of queueing saves behind it.
-- 2. meldy_private.test_doc_ok: at most 2100 blocks (was 400): the exam's 2000 questions (MC007) and 100 more blocks
--    (a page break per subject, headings, texts). Nothing else changes: the rules and their order are 20261107090400's.
-- 3. public.test_doc_save: more than 524288 bytes → 22023 size (was 204800).
-- 4. meldy_private.quiz_doc_items: every question block of the page whose row is a keyed question (or an essay) of the
--    exam, in the page's order — no longer the first 200. A link «как в студии» draws from the whole test.
-- 5. meldy_private.quiz_draw / quiz_draw_count, a design quiz: a page of at most 200 such questions is drawn whole, in its
--    order, as before (item_count is ignored there, as 20261019100000 has it). A page of more than 200 — more than an
--    attempt holds (quiz_attempts_item_ids_check) — gives each attempt item_count of them (1..200, the author's choice in
--    the quiz setup) at random, in the page's order (meldy_private.quiz_fixed, the same sample as a quiz of subjects);
--    the preview's count says the same. same_set, shuffle_items and subject_ids are still ignored by a design quiz.
-- The readers need nothing else: test_doc_get and meldy_private.quiz_design hand the stored page over as it is; the
-- participant's page leaves out the question blocks its attempt does not hold (lib/quizzes/design.ts attemptDoc).
-- Re-runnable: CREATE OR REPLACE (each function keeps its grants), the check replaced only while it is not the new one.
-- Grants are not touched. The whole file is one request (supabase/migrate.py).

set local lock_timeout = '2s';

do $do$
begin
  if pg_catalog.to_regprocedure('meldy_private.test_doc_ok(jsonb, uuid)') is null
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('meldy_private.test_doc_ok(jsonb, uuid)'::regprocedure),
                          'when v_bg -> ''kind'' = ''"color"''::jsonb') = 0
     or pg_catalog.to_regprocedure('meldy_private.quiz_doc_items(uuid)') is null
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('meldy_private.quiz_doc_items(uuid)'::regprocedure), 'i.kind = ''essay''') = 0
     or pg_catalog.to_regprocedure('meldy_private.quiz_fixed(public.quizzes, uuid[])') is null
     or pg_catalog.to_regclass('public.test_docs') is null then
    raise exception 'the base is expected: 20261107090400_studio_color_bg.sql on 20261101090200_question_kinds_quiz.sql';
  end if;
end;
$do$;

-- 1. The document's size: 512 KB of jsonb text.
do $do$
begin
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.test_docs'::regclass and k.conname = 'test_docs_doc_check'
                    and pg_catalog.pg_get_constraintdef(k.oid) like '%<= 524288)%') then
    alter table public.test_docs drop constraint if exists test_docs_doc_check;
    alter table public.test_docs add constraint test_docs_doc_check check (octet_length(doc::text) <= 524288) not valid;
  end if;
end;
$do$;

-- 2. The whole document (20261107090400 §1): null when valid, else the first broken rule; blocks: at most 2100.
create or replace function meldy_private.test_doc_ok(p_doc jsonb, p_container_id uuid)
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  c_accents constant text[] := array['blue', 'green', 'orange', 'violet', 'pink', 'graphite'];
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  -- A video's link: frontend/src/types/testDoc.ts DOC_VIDEO_PATTERN, character for character.
  c_video constant text := '^https://(?:(?:www[.]|m[.])?youtube[.]com/(?:watch[?](?:[A-Za-z0-9._~%+=;,:@!$&/-]*&)?v=|shorts/|embed/|live/)[A-Za-z0-9_-]{11}|youtu[.]be/[A-Za-z0-9_-]{11}|www[.]youtube-nocookie[.]com/embed/[A-Za-z0-9_-]{11}|rutube[.]ru/(?:video/(?:private/)?|play/embed/|shorts/)[0-9a-f]{32}|(?:m[.])?(?:vk[.]com|vk[.]ru|vkvideo[.]ru)/(?:video|clip)-?[0-9]{1,20}_[0-9]{1,20}|(?:vk[.]com|vk[.]ru|vkvideo[.]ru)/video_ext[.]php[?]oid=-?[0-9]{1,20}&id=[0-9]{1,20})(?:[/?&#][A-Za-z0-9._~%+=;,:@!$&#?/-]*)?$';
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
                       when v_bg -> 'kind' = '"color"'::jsonb
                       then meldy_private.test_doc_keys(v_bg, array['kind', 'color'])
                            and pg_catalog.jsonb_typeof(v_bg -> 'color') = 'string' and (v_bg ->> 'color') ~ '^#[0-9a-f]{6}$'
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
     or pg_catalog.jsonb_array_length(p_doc -> 'blocks') > 2100 then
    return 'blocks';
  end if;
  for v_b, v_n in select e.x, (e.o - 1)::integer
                    from pg_catalog.jsonb_array_elements(p_doc -> 'blocks') with ordinality as e(x, o)
                   order by e.o loop
    v_type := case when pg_catalog.jsonb_typeof(v_b) = 'object' and pg_catalog.jsonb_typeof(v_b -> 'type') = 'string'
                   then v_b ->> 'type' end;
    if v_type is null or v_type not in ('cover', 'heading', 'text', 'image', 'video', 'note', 'divider', 'page', 'question') then
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
        when 'video' then case
          when not (meldy_private.test_doc_str(v_b -> 'url', 1, 300) and coalesce((v_b ->> 'url') ~ c_video, false)) then 'url'
          when not meldy_private.test_doc_str(v_b -> 'caption', 0, 300) then 'caption'
          when not meldy_private.test_doc_keys(v_b, array['type', 'id', 'url', 'caption']) then 'type' end
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

-- 3. Save the whole document (20261019100000 §3b): more than 524288 bytes → 22023 size.
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
  if pg_catalog.octet_length(p_doc::text) > 524288 then
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

-- 4. The questions of a design quiz (20261101090200 §4a): every keyed question (or essay) on the page, in its order.
create or replace function meldy_private.quiz_doc_items(p_container uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.array_agg(x.id order by x.ord), '{}'::uuid[])
    from (select i.id, pg_catalog.min(b.ord) as ord
            from public.test_docs d
           cross join lateral pg_catalog.jsonb_array_elements(
                   case when pg_catalog.jsonb_typeof(d.doc -> 'blocks') = 'array' then d.doc -> 'blocks' else '[]'::jsonb end)
                   with ordinality as b(x, ord)
            join public.test_items i
              on i.id = case when pg_catalog.jsonb_typeof(b.x) = 'object' and b.x ->> 'type' = 'question'
                                  and (b.x ->> 'item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             then (b.x ->> 'item_id')::uuid end
             and i.container_id = d.container_id and (i.keyed or i.kind = 'essay')
           where d.container_id = p_container
           group by i.id) x
$fn$;

-- 5. The questions of a new attempt (20261019100000 §4e) — a design quiz: the page's, all of them while they fit in an
--    attempt, else item_count of them at random in the page's order.
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
    v_pool := meldy_private.quiz_doc_items(p_q.container_id);
    -- More questions than an attempt holds: item_count of them at random, in the page's order (quiz_fixed).
    if pg_catalog.cardinality(v_pool) > 200 then
      return meldy_private.quiz_fixed(p_q, v_pool);
    end if;
    return v_pool;
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

-- 5b. How many questions a start would draw now (20261019100000 §4f) — a design quiz: the page's while they fit, else
--     item_count.
create or replace function meldy_private.quiz_draw_count(p_q public.quizzes)
returns integer
language sql
stable
set search_path = ''
as $fn$
  select case when p_q.design
              then (select case when d.n > 200 then least(p_q.item_count::integer, d.n) else d.n end
                      from (select pg_catalog.cardinality(meldy_private.quiz_doc_items(p_q.container_id)) as n) d)
              when p_q.same_set and p_q.fixed_item_ids is not null
              then (select pg_catalog.count(*)::integer from pg_catalog.unnest(p_q.fixed_item_ids) f
                     where f = any (meldy_private.quiz_pool(p_q.container_id, p_q.subject_ids)))
              else least(p_q.item_count::integer,
                         pg_catalog.cardinality(meldy_private.quiz_pool(p_q.container_id, p_q.subject_ids))) end
$fn$;
