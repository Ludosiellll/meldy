-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261019110000_doc_video.sql (the
-- studio's video block) on the scratch database of test_docs_run.sh, after 20261019100000_test_docs.sql. One
-- transaction, rolled back. A = author aaaa…1 (exam V: one keyed question), C = cccc…3 (a signed-in taker).
-- Covers: test_doc_save keeps a page with videos of the three hosts (and test_doc_get gives it back as saved); a broken
-- video is refused with 22023 and its rule (block:<n>:url — another host, http, HTML of a player; block:<n>:caption;
-- block:<n>:type for an extra key); a quiz «как в студии» carries the video blocks to the participant as stored (the
-- preview and the attempt's design), the question drawn as before. A failure raises; success prints
-- DOC VIDEO BEHAVIOUR PASSED.
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
    -- 20261020120000_quiz_protection: «not found» of the functions it rewrote is PostgREST's 404 with P0002 inside.
    if sqlstate = 'PGRST' and p_state = 'P0002' and (sqlerrm::jsonb ->> 'code') = 'P0002'
       and (v_detail::jsonb ->> 'status') = '404' then
      v_detail := sqlerrm::jsonb ->> 'details';
    elsif sqlstate is distinct from p_state then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_state;
    end if;
    if p_detail is not null and v_detail is distinct from p_detail then
      raise exception 'FAILED: % — detail %, expected %', p_what, v_detail, p_detail;
    end if;
end;
$fn$;
create temp table ctx (k text primary key, v text);
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = p_k
$fn$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into pg_temp.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
-- The page of exam V: a heading, three videos (YouTube with a start, RuTube, VK Видео), the question.
create or replace function pg_temp.doc() returns jsonb language sql stable as $fn$
  select jsonb_build_object(
    'v', 1, 'title', 'Опыты на видео',
    'theme', jsonb_build_object('accent', 'green', 'background', jsonb_build_object('kind', 'plain'), 'font', 'onest',
                                'radius', 'soft', 'density', 'airy', 'answers', 'list', 'buttons', 'pill'),
    'layout', 'one_page',
    'blocks', jsonb_build_array(
      jsonb_build_object('type', 'heading', 'id', 'heading001', 'text', 'Посмотрите опыт', 'size', 'l'),
      jsonb_build_object('type', 'video', 'id', 'video00001', 'url', 'https://youtu.be/dQw4w9WgXcQ?t=42', 'caption', 'Натрий в воде'),
      jsonb_build_object('type', 'video', 'id', 'video00002', 'url', 'https://rutube.ru/video/c6cc4d620b1d4338901770a44b3e82f4/',
                         'caption', ''),
      jsonb_build_object('type', 'video', 'id', 'video00003', 'url', 'https://vkvideo.ru/video-22822305_456242110', 'caption', 'VK'),
      jsonb_build_object('type', 'question', 'id', 'question01', 'item_id', pg_temp.c('item')::uuid, 'points', 1, 'required', false)),
    'results', jsonb_build_object('bands', '[]'::jsonb, 'cta', null))
$fn$;
grant all on ctx to authenticated, anon, service_role;
grant execute on function pg_temp.expect_error(text, text, text, text), pg_temp.c(text), pg_temp.put(text, text), pg_temp.doc()
  to authenticated, anon, service_role;

-- 1. A: exam V with one keyed question; the page saved with its videos and read back as saved.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; v_x uuid; v_doc jsonb;
begin
  r := public.container_create('Видео в студии', null, '[{"title":"Опыты"}]');
  v_x := (r ->> 'container_id')::uuid;
  perform pg_temp.put('x', v_x::text);
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'v:1', 'stem', 'Какой газ выделяется?', 'options', jsonb_build_array('водород', 'кислород'),
                       'correct', jsonb_build_array(0))));
  perform pg_temp.put('item', (select i.id::text from public.test_items i where i.container_id = v_x));
  v_doc := pg_temp.doc();
  r := public.test_doc_save(v_x, v_doc, 0);
  if (r ->> 'rev')::int is distinct from 1 then raise exception 'FAILED: the first save with videos %', r; end if;
  r := public.test_doc_get(v_x);
  if r -> 'doc' is distinct from v_doc then raise exception 'FAILED: the page comes back as saved %', r -> 'doc'; end if;

  -- 2. Broken videos are refused with their rule; the stored page stays.
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 1)', v_x,
    jsonb_set(v_doc, '{blocks,1,url}', '"https://vimeo.com/76979871"')), '22023', 'another host', 'block:1:url');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 1)', v_x,
    jsonb_set(v_doc, '{blocks,2,url}', '"http://rutube.ru/video/c6cc4d620b1d4338901770a44b3e82f4/"')), '22023', 'http', 'block:2:url');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 1)', v_x,
    jsonb_set(v_doc, '{blocks,1,url}', to_jsonb('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>'::text))),
    '22023', 'HTML of a player', 'block:1:url');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 1)', v_x,
    jsonb_set(v_doc, '{blocks,3,caption}', to_jsonb(repeat('в', 301)))), '22023', 'a caption of 301', 'block:3:caption');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 1)', v_x,
    jsonb_set(v_doc, '{blocks,1,html}', '"<b>x</b>"')), '22023', 'an extra key', 'block:1:type');
  r := public.test_doc_get(v_x);
  if (r ->> 'rev')::int is distinct from 1 or r -> 'doc' is distinct from v_doc then raise exception 'FAILED: refused saves changed the page %', r; end if;

  -- 3. A quiz «как в студии»: the preview carries the page with its videos as stored.
  r := public.quiz_create(v_x, jsonb_build_object('title', 'С видео', 'design', true, 'review', 'answers', 'attempts', null));
  perform pg_temp.put('code', r ->> 'code');
  r := public.quiz_preview(r ->> 'code');
  if r -> 'design' is distinct from v_doc - 'v' or (r ->> 'item_count')::int is distinct from 1 then
    raise exception 'FAILED: the preview of a page with videos %', r;
  end if;
end
$t$;

-- 4. C starts the quiz: the attempt's design holds the videos; the question is the one drawn.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_start(pg_temp.c('code'), 'Вера');
  if r -> 'design' is distinct from pg_temp.doc() - 'v' then raise exception 'FAILED: the attempt''s design %', r -> 'design'; end if;
  if jsonb_array_length(r -> 'items') <> 1 or r -> 'items' -> 0 ->> 'id' is distinct from pg_temp.c('item') then
    raise exception 'FAILED: the attempt''s question %', r -> 'items';
  end if;
  if (select count(*) from jsonb_array_elements(r -> 'design' -> 'blocks') b where b ->> 'type' = 'video') <> 3 then
    raise exception 'FAILED: three videos for the participant %', r -> 'design';
  end if;
end
$t$;

reset role;
select 'DOC VIDEO BEHAVIOUR PASSED';
rollback;
