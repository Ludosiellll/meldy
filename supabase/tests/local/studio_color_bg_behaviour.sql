-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261107090400_studio_color_bg.sql
-- (the studio's own background colour) on the scratch database of studio_color_bg_run.sh. One transaction, rolled back.
-- A = author aaaa…1 (exam X: two questions), B = bbbb…2 (a signed-in taker, a stranger to X).
-- Covers: A saves a page on its own colour through test_doc_save (the first revision, then the next ones) and reads it
-- back with test_doc_get as sent; the other backgrounds still save; a broken colour is refused as 22023 «theme» and the
-- stored page stays as it was; a quiz «как в студии» carries the colour to the preview and the attempt, and a colour
-- saved later in the studio reaches the preview and B's next start at once (the quiz reads the live document).
-- A failure raises; success prints COLOR BG BEHAVIOUR PASSED.
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
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = p_k
$fn$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into pg_temp.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
-- The page of X on background p_bg: a cover, a text and both questions.
create or replace function pg_temp.doc(p_bg jsonb) returns jsonb language sql stable as $fn$
  select jsonb_build_object(
    'v', 1, 'title', 'Аккредитация, полный тест',
    'theme', jsonb_build_object('accent', 'orange', 'background', p_bg, 'font', 'onest', 'radius', 'soft', 'density', 'airy',
                                'answers', 'list', 'buttons', 'pill'),
    'layout', 'one_by_one',
    'blocks', jsonb_build_array(
      jsonb_build_object('type', 'cover', 'id', 'cover00001', 'title', 'Аккредитация', 'subtitle', 'Полный тест', 'image', null, 'align', 'left'),
      jsonb_build_object('type', 'text', 'id', 'text000001', 'text', 'Выберите **один** ответ.', 'align', 'left'),
      jsonb_build_object('type', 'question', 'id', 'question01', 'item_id', pg_temp.c('item:c:1'), 'points', 1, 'required', false),
      jsonb_build_object('type', 'question', 'id', 'question02', 'item_id', pg_temp.c('item:c:2'), 'points', 1, 'required', false)),
    'results', jsonb_build_object('bands', '[]'::jsonb, 'cta', null))
$fn$;
create or replace function pg_temp.bg(p_color text) returns jsonb language sql immutable as $fn$
  select jsonb_build_object('kind', 'color', 'color', p_color)
$fn$;
grant all on ctx to authenticated, anon, service_role;
grant execute on function pg_temp.expect_error(text, text, text, text), pg_temp.c(text), pg_temp.put(text, text),
  pg_temp.doc(jsonb), pg_temp.bg(text) to authenticated, anon, service_role;

-- 1. A: exam X with two questions; the page on its own colour, saved and read back.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; v_x text; s1 uuid;
begin
  r := public.container_create('Свой фон', null, '[{"title":"Вопросы"}]');
  v_x := r ->> 'container_id';
  s1 := (r -> 'subjects' -> 0 ->> 'id')::uuid;
  perform pg_temp.put('x', v_x);
  perform public.container_items_add(s1, jsonb_build_array(
    jsonb_build_object('ref', 'c:1', 'stem', 'Срок хранения амбулаторной карты', 'options', jsonb_build_array('5 лет', '25 лет'), 'correct', jsonb_build_array(1)),
    jsonb_build_object('ref', 'c:2', 'stem', 'Согласие на вмешательство', 'options', jsonb_build_array('устно', 'письменно'), 'correct', jsonb_build_array(1))));
  insert into pg_temp.ctx select 'item:' || i.import_ref, i.id::text from public.test_items i where i.container_id = v_x::uuid;
  if pg_temp.c('item:c:1') is null or pg_temp.c('item:c:2') is null then raise exception 'FAILED: the questions of X'; end if;

  r := public.test_doc_save(v_x::uuid, pg_temp.doc(pg_temp.bg('#f3e3c3')), 0);
  if (r ->> 'rev')::int is distinct from 1 then raise exception 'FAILED: the first save on a colour %', r; end if;
  r := public.test_doc_get(v_x::uuid);
  if r -> 'doc' is distinct from pg_temp.doc(pg_temp.bg('#f3e3c3')) or r -> 'doc' #>> '{theme,background,color}' is distinct from '#f3e3c3' then
    raise exception 'FAILED: the colour read back %', r -> 'doc' -> 'theme';
  end if;
  -- the colour changed, then every other background, then a colour again: each a revision
  r := public.test_doc_save(v_x::uuid, pg_temp.doc(pg_temp.bg('#2b3a55')), 1);
  r := public.test_doc_save(v_x::uuid, pg_temp.doc('{"kind": "plain"}'), 2);
  r := public.test_doc_save(v_x::uuid, pg_temp.doc('{"kind": "soft", "tone": "orange"}'), 3);
  r := public.test_doc_save(v_x::uuid, pg_temp.doc(jsonb_build_object('kind', 'image', 'dim', 30,
         'path', v_x || '/' || encode(sha256(convert_to('colorbg', 'UTF8')), 'hex') || '.png')), 4);
  r := public.test_doc_save(v_x::uuid, pg_temp.doc(pg_temp.bg('#000000')), 5);
  if (r ->> 'rev')::int is distinct from 6 then raise exception 'FAILED: the revisions of the backgrounds %', r; end if;
  if public.test_doc_get(v_x::uuid) #>> '{doc,theme,background,color}' is distinct from '#000000' then
    raise exception 'FAILED: the last colour %', public.test_doc_get(v_x::uuid) #> '{doc,theme}';
  end if;

  -- refusals: «theme», nothing stored
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 6)', v_x, pg_temp.doc(pg_temp.bg('#F3E3C3'))), '22023', 'a colour in capitals', 'theme');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 6)', v_x, pg_temp.doc(pg_temp.bg('#fff'))), '22023', 'a colour of three digits', 'theme');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 6)', v_x, pg_temp.doc(pg_temp.bg('orange'))), '22023', 'a colour by name', 'theme');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 6)', v_x, pg_temp.doc('{"kind": "color"}')), '22023', 'a colour missing', 'theme');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 6)', v_x, pg_temp.doc('{"kind": "color", "color": "#f3e3c3", "dim": 10}')),
                               '22023', 'a colour with another key', 'theme');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 6)', v_x, pg_temp.doc('{"kind": "color", "color": 0}')), '22023', 'a colour not a string', 'theme');
  r := public.test_doc_get(v_x::uuid);
  if (r ->> 'rev')::int is distinct from 6 or r #>> '{doc,theme,background,color}' is distinct from '#000000' then
    raise exception 'FAILED: a refused save changed the page %', r;
  end if;

  -- a quiz «как в студии» on X
  r := public.test_doc_save(v_x::uuid, pg_temp.doc(pg_temp.bg('#f3e3c3')), 6);
  r := public.quiz_create(v_x::uuid, jsonb_build_object('title', 'Аккредитация, полный тест', 'design', true));
  if not (r ->> 'design')::boolean then raise exception 'FAILED: the design quiz %', r; end if;
  perform pg_temp.put('code', r ->> 'code');
  r := public.quiz_preview(r ->> 'code');
  if r #> '{design,theme,background}' is distinct from pg_temp.bg('#f3e3c3') then
    raise exception 'FAILED: the preview''s background %', r #> '{design,theme}';
  end if;
end
$t$;

-- 2. B starts the quiz: the attempt carries the colour.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_start(pg_temp.c('code'), 'Вера');
  if r #> '{design,theme,background}' is distinct from pg_temp.bg('#f3e3c3') then
    raise exception 'FAILED: the attempt''s background %', r #> '{design,theme}';
  end if;
  if jsonb_array_length(r -> 'items') is distinct from 2 then raise exception 'FAILED: the attempt''s questions %', r -> 'items'; end if;
  perform pg_temp.put('attempt', r ->> 'attempt_id');
end
$t$;

-- 3. A changes the colour in the studio: the preview and B's attempt read it at once.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb;
begin
  r := public.test_doc_save(pg_temp.c('x')::uuid, pg_temp.doc(pg_temp.bg('#1d4ed8')), 7);
  if (r ->> 'rev')::int is distinct from 8 then raise exception 'FAILED: the new colour saved %', r; end if;
  r := public.quiz_preview(pg_temp.c('code'));
  if r #> '{design,theme,background}' is distinct from pg_temp.bg('#1d4ed8') then
    raise exception 'FAILED: the preview after the change %', r #> '{design,theme}';
  end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_start(pg_temp.c('code'), 'Вера');
  if r ->> 'attempt_id' is distinct from pg_temp.c('attempt') then raise exception 'FAILED: B resumes the same attempt %', r ->> 'attempt_id'; end if;
  if r #> '{design,theme,background}' is distinct from pg_temp.bg('#1d4ed8') then
    raise exception 'FAILED: the attempt after the change %', r #> '{design,theme}';
  end if;
end
$t$;
reset role;
select 'COLOR BG BEHAVIOUR PASSED';
rollback;
