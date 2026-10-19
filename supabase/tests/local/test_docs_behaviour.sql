-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261019100000_test_docs.sql
-- (release 47.1, «Студия теста») on the scratch database of test_docs_run.sh. One transaction, rolled back.
-- A = author aaaa…1 (exams X, Y, Z), B = bbbb…2 (a member of X), C = cccc…3 (a signed-in taker; a stranger to X);
-- guests are anon with tokens tok(n).
-- X: subject S1 with d:1 (single, an explanation), d:2 (multiple), d:3 (short, an explanation), d:4 (keyed, not on the
-- page), d:5 (on the page, deleted half way), d:6 (no key, on the page); subject S2 with d:7. Y: one question y:1 (an
-- item of another exam). Z: 201 questions (the 200 cap of an attempt).
-- Covers: every rule of meldy_private.test_doc_ok with documents that pass and documents that break it (the rule names
-- of the plan, the first broken rule wins, blocks counted from 0); test_doc_get / test_doc_save for the owner only (anon
-- 42501, not signed in 28000, a stranger, a member, a missing exam → P0002 container); the first save with rev 0; MC020
-- stale on an old, a future and a null rev; 22023 with the rule (a question of another exam); 22023 size past 200 KB and
-- the table's CHECK; a deleted question leaves its block dangling (the stored document unchanged, a save must drop it)
-- and the quiz skips it; design quizzes: the settings (stored as given, MC013 without a document or questions, 22023
-- design), the attempt's items = the page's question blocks in order (all of them, whatever shuffle_items, same_set,
-- item_count and subject_ids say; no question without a key; at most 200), locked after the start (MC011 design);
-- QuizRow / the preview / the attempt / the result carry design (the stored document without v; null without design)
-- and the result band (the matching one, null in a gap or without design); guests the same; the attempt JSON carries
-- no key or explanation; points count (score / max_score, the percent, passed and band by them; the points of the start
-- kept with the attempt; the author's views and the preview read the same). A failure raises; success prints
-- TEST DOCS BEHAVIOUR PASSED.
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
-- the sorted key set of a JSON object (pins the contract's field names)
create or replace function pg_temp.keys(p jsonb) returns text language sql immutable as $fn$
  select string_agg(k, ',' order by k) from jsonb_object_keys(p) k
$fn$;
create or replace function pg_temp.find(p_list jsonb, p_key text, p_val text) returns jsonb language sql immutable as $fn$
  select x from jsonb_array_elements(p_list) x where x ->> p_key = p_val limit 1
$fn$;
-- a guest token (43 base64url characters)
create or replace function pg_temp.tok(p_n integer) returns text language sql immutable as $fn$
  select 'doc' || lpad(p_n::text, 8, '0') || repeat('Q', 32)
$fn$;
create or replace function pg_temp.item(p_ref text) returns uuid language sql stable as $fn$
  select v::uuid from pg_temp.ctx where k = 'item:' || p_ref
$fn$;
-- a picture path in the folder of exam p_container
create or replace function pg_temp.pic(p_container text, p_n integer) returns text language sql immutable as $fn$
  select p_container || '/' || encode(sha256(convert_to('docpic' || p_n, 'UTF8')), 'hex') || '.png'
$fn$;
-- the ids of an attempt's items, in order
create or replace function pg_temp.ids(p_items jsonb) returns text language sql immutable as $fn$
  select string_agg(x ->> 'id', ',' order by o) from jsonb_array_elements(p_items) with ordinality y(x, o)
$fn$;
create or replace function pg_temp.refs(variadic p_refs text[]) returns text language sql stable as $fn$
  select string_agg(pg_temp.item(r)::text, ',' order by o) from unnest(p_refs) with ordinality u(r, o)
$fn$;
-- The page of exam X: every block type, a theme, the result screen. Its question blocks, in order: d:3, d:1, d:7, d:6
-- (no key), d:2, d:5.
create or replace function pg_temp.doc() returns jsonb language sql stable as $fn$
  select jsonb_build_object(
    'v', 1, 'title', 'Проверочная страница',
    'theme', jsonb_build_object('accent', 'blue', 'background', jsonb_build_object('kind', 'plain'), 'font', 'onest',
                                'radius', 'soft', 'density', 'airy', 'answers', 'list', 'buttons', 'pill'),
    'layout', 'one_by_one',
    'blocks', jsonb_build_array(
      jsonb_build_object('type', 'cover', 'id', 'cover00001', 'title', 'Контрольная по теме', 'subtitle', 'Двадцать минут',
                         'image', pg_temp.pic(pg_temp.c('x'), 1), 'align', 'center'),
      jsonb_build_object('type', 'heading', 'id', 'heading001', 'text', 'Начнём', 'size', 'l'),
      jsonb_build_object('type', 'question', 'id', 'question01', 'item_id', pg_temp.item('d:3'), 'points', 2, 'required', true),
      jsonb_build_object('type', 'text', 'id', 'text000001', 'text', 'Прочитайте **внимательно** и [посмотрите](https://example.org/a)',
                         'align', 'left'),
      jsonb_build_object('type', 'question', 'id', 'question02', 'item_id', pg_temp.item('d:1'), 'points', 1, 'required', false),
      jsonb_build_object('type', 'page', 'id', 'page000001', 'title', 'Вторая часть'),
      jsonb_build_object('type', 'question', 'id', 'question03', 'item_id', pg_temp.item('d:7'), 'points', 1, 'required', false),
      jsonb_build_object('type', 'image', 'id', 'image00001', 'path', pg_temp.pic(pg_temp.c('x'), 2), 'caption', 'Схема', 'width', 'wide'),
      jsonb_build_object('type', 'note', 'id', 'note000001', 'tone', 'tip', 'text', '*Подсказка* рядом'),
      jsonb_build_object('type', 'divider', 'id', 'divider001'),
      jsonb_build_object('type', 'question', 'id', 'question04', 'item_id', pg_temp.item('d:6'), 'points', 1, 'required', false),
      jsonb_build_object('type', 'question', 'id', 'question05', 'item_id', pg_temp.item('d:2'), 'points', 3, 'required', true),
      jsonb_build_object('type', 'question', 'id', 'question06', 'item_id', pg_temp.item('d:5'), 'points', 1, 'required', false)),
    'results', jsonb_build_object(
      'bands', jsonb_build_array(
        jsonb_build_object('from', 0, 'to', 49, 'title', 'Ещё рано', 'text', 'Повторите тему', 'image', null),
        jsonb_build_object('from', 50, 'to', 79, 'title', 'Хорошо', 'text', '', 'image', pg_temp.pic(pg_temp.c('x'), 3)),
        jsonb_build_object('from', 80, 'to', 100, 'title', 'Отлично', 'text', '**Так держать**', 'image', null)),
      'cta', jsonb_build_object('label', 'Тренироваться дальше', 'url', 'https://meldy.example/train')))
$fn$;
grant all on ctx to authenticated, anon, service_role;
grant execute on function pg_temp.expect_error(text, text, text, text), pg_temp.c(text), pg_temp.put(text, text),
  pg_temp.keys(jsonb), pg_temp.find(jsonb, text, text), pg_temp.tok(integer), pg_temp.item(text), pg_temp.pic(text, integer),
  pg_temp.ids(jsonb), pg_temp.refs(text[]), pg_temp.doc()
  to authenticated, anon, service_role;

-- 1. A: exams X (S1: d:1..d:6, S2: d:7), Y (y:1) and Z (201 questions).
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; v_x text; s1 uuid; s2 uuid;
begin
  r := public.container_create('Студия проверка', null, '[{"title":"Основной"},{"title":"Второй"}]');
  v_x := r ->> 'container_id';
  s1 := (r -> 'subjects' -> 0 ->> 'id')::uuid;
  s2 := (r -> 'subjects' -> 1 ->> 'id')::uuid;
  perform pg_temp.put('x', v_x);
  perform pg_temp.put('s1', s1::text);
  perform pg_temp.put('s2', s2::text);
  perform public.container_items_add(s1, jsonb_build_array(
    jsonb_build_object('ref', 'd:1', 'stem', 'Сколько будет 2+2?', 'options', jsonb_build_array('3', '4'), 'correct', jsonb_build_array(1),
                       'explanation', 'Потому что четыре'),
    jsonb_build_object('ref', 'd:2', 'stem', 'Чётные числа', 'options', jsonb_build_array('1', '2', '4'), 'correct', jsonb_build_array(1, 2)),
    jsonb_build_object('ref', 'd:3', 'stem', 'Столица Франции', 'answers', jsonb_build_array('Париж'), 'explanation', 'Столица — город П.'),
    jsonb_build_object('ref', 'd:4', 'stem', 'Не на странице', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'd:5', 'stem', 'Этот удалят', 'options', jsonb_build_array('а', 'б'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'd:6', 'stem', 'Без ключа', 'options', jsonb_build_array('а', 'б'), 'correct', '[]'::jsonb)));
  perform public.container_items_add(s2, jsonb_build_array(
    jsonb_build_object('ref', 'd:7', 'stem', 'Из второго предмета', 'options', jsonb_build_array('а', 'б'), 'correct', jsonb_build_array(1))));
  insert into pg_temp.ctx select 'item:' || i.import_ref, i.id::text from public.test_items i where i.container_id = v_x::uuid;

  r := public.container_create('Другой экзамен', null, '[{"title":"Один"}]');
  perform pg_temp.put('y', r ->> 'container_id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'y:1', 'stem', 'Игрек', 'options', jsonb_build_array('а', 'б'), 'correct', jsonb_build_array(0))));
  insert into pg_temp.ctx select 'item:' || i.import_ref, i.id::text from public.test_items i where i.container_id = (r ->> 'container_id')::uuid;

  r := public.container_create('Большой экзамен', null, '[{"title":"Много"}]');
  perform pg_temp.put('z', r ->> 'container_id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid,
    (select jsonb_agg(jsonb_build_object('ref', 'z:' || i, 'stem', 'Вопрос ' || i, 'options', jsonb_build_array('а', 'б'),
                                         'correct', jsonb_build_array(0)) order by i)
       from generate_series(1, 201) i));
  insert into pg_temp.ctx select 'item:' || i.import_ref, i.id::text from public.test_items i where i.container_id = (r ->> 'container_id')::uuid;
end
$t$;

-- 2. postgres: B becomes a member of X; the rules of the document (meldy_private.test_doc_ok).
reset role;
insert into public.container_members (container_id, user_id) values (pg_temp.c('x')::uuid, 'bbbbbbbb-0000-0000-0000-000000000002');
do $t$
declare
  v_x uuid := pg_temp.c('x')::uuid;
  d jsonb := pg_temp.doc();
  v_other text := pg_temp.pic(pg_temp.c('y'), 1);
  v_case record;
  v_got text;
  v_n integer := 0;
begin
  -- documents that pass
  for v_case in select * from (values
      ('the page of X', d),
      ('a custom accent, a soft background, one page', d || jsonb_build_object('layout', 'one_page')
         || jsonb_build_object('theme', d -> 'theme' || jsonb_build_object('accent', jsonb_build_object('custom', '#0a7cff'),
                                                                           'background', jsonb_build_object('kind', 'soft', 'tone', 'green')))),
      ('a picture background, dim 0', jsonb_set(d, '{theme,background}', jsonb_build_object('kind', 'image', 'path', pg_temp.pic(v_x::text, 4), 'dim', 0))),
      ('a picture background, dim 80', jsonb_set(d, '{theme,background}', jsonb_build_object('kind', 'image', 'path', pg_temp.pic(v_x::text, 4), 'dim', 80))),
      ('the other fonts, radii, densities, answers and buttons (1)', jsonb_set(d, '{theme}', d -> 'theme'
         || '{"font": "serif", "radius": "round", "density": "compact", "answers": "grid", "buttons": "rounded"}')),
      ('the other fonts, radii, densities, answers and buttons (2)', jsonb_set(d, '{theme}', d -> 'theme'
         || '{"font": "mono", "radius": "square", "buttons": "square"}')),
      ('pages, no blocks, no bands, no cta', d || '{"layout": "pages", "blocks": [], "results": {"bands": [], "cta": null}}'),
      ('empty texts where 0 is allowed, a cover without a picture', jsonb_set(jsonb_set(jsonb_set(jsonb_set(d,
         '{blocks,0}', d -> 'blocks' -> 0 || '{"subtitle": "", "image": null, "align": "left"}'),
         '{blocks,5,title}', '""'), '{blocks,7,caption}', '""'), '{results,bands,1,text}', '""')),
      ('the longest texts, ids of 8 and 24', jsonb_set(jsonb_set(jsonb_set(jsonb_set(d || jsonb_build_object('title', repeat('я', 200)),
         '{blocks,3,text}', to_jsonb(repeat('я', 4000))), '{blocks,1}', jsonb_build_object('type', 'heading', 'id', 'abcdefgh',
         'text', repeat('я', 200), 'size', 'm')), '{blocks,9,id}', to_jsonb(repeat('a1', 12))), '{blocks,8,text}', to_jsonb(repeat('я', 4000)))),
      ('points 1 and 100, required both ways, the other tones and widths', jsonb_set(jsonb_set(jsonb_set(jsonb_set(d,
         '{blocks,2,points}', '100'), '{blocks,4,required}', 'true'), '{blocks,8,tone}', '"warn"'), '{blocks,7,width}', '"full"')),
      ('note info, image narrow', jsonb_set(jsonb_set(d, '{blocks,8,tone}', '"info"'), '{blocks,7,width}', '"narrow"')),
      ('one band 0..100 with a picture, touching bands elsewhere', jsonb_set(d, '{results,bands}', jsonb_build_array(
         jsonb_build_object('from', 0, 'to', 100, 'title', 'Всё', 'text', repeat('я', 4000), 'image', pg_temp.pic(v_x::text, 5))))),
      ('six bands', jsonb_set(d, '{results,bands}', (select jsonb_agg(jsonb_build_object('from', i * 10, 'to', i * 10 + 9,
         'title', 'Полоса ' || i, 'text', '', 'image', null)) from generate_series(0, 5) i))),
      ('a cta of 300 characters', jsonb_set(d, '{results,cta,url}', to_jsonb('https://' || repeat('a', 292)))),
      ('400 blocks', jsonb_set(d, '{blocks}', (select jsonb_agg(jsonb_build_object('type', 'divider', 'id', 'div' || lpad(i::text, 5, '0')))
         from generate_series(1, 400) i)))) c(what, doc) loop
    v_got := meldy_private.test_doc_ok(v_case.doc, v_x);
    if v_got is not null then raise exception 'FAILED: % is valid, got %', v_case.what, v_got; end if;
    v_n := v_n + 1;
  end loop;
  if v_n <> 15 then raise exception 'FAILED: % valid documents checked', v_n; end if;

  -- documents that break a rule: the rule's name (blocks counted from 0)
  v_n := 0;
  for v_case in select * from (values
      -- version
      ('an array', '[]'::jsonb, 'version'), ('a string', '"doc"'::jsonb, 'version'), ('JSON null', 'null'::jsonb, 'version'),
      ('no v', d - 'v', 'version'), ('v 2', d || '{"v": 2}', 'version'), ('v "1"', d || '{"v": "1"}', 'version'),
      ('a key of no rule', d || '{"html": "<b>"}', 'version'),
      -- title
      ('no title', d - 'title', 'title'), ('an empty title', d || '{"title": ""}', 'title'), ('a title of spaces', d || jsonb_build_object('title', E' \n\t '), 'title'),
      ('a title of 201', d || jsonb_build_object('title', repeat('я', 201)), 'title'), ('a number title', d || '{"title": 5}', 'title'),
      -- theme
      ('no theme', d - 'theme', 'theme'), ('a theme key of no rule', jsonb_set(d, '{theme,shadow}', 'true'), 'theme'),
      ('no accent', d #- '{theme,accent}', 'theme'), ('accent red', jsonb_set(d, '{theme,accent}', '"red"'), 'theme'),
      ('a custom colour in capitals', jsonb_set(d, '{theme,accent}', '{"custom": "#ABCDEF"}'), 'theme'),
      ('a short custom colour', jsonb_set(d, '{theme,accent}', '{"custom": "#abc"}'), 'theme'),
      ('a custom colour with another key', jsonb_set(d, '{theme,accent}', '{"custom": "#abcdef", "name": "x"}'), 'theme'),
      ('a background of no kind', jsonb_set(d, '{theme,background}', '{"kind": "video"}'), 'theme'),
      ('a plain background with a tone', jsonb_set(d, '{theme,background}', '{"kind": "plain", "tone": "blue"}'), 'theme'),
      ('a soft background of red', jsonb_set(d, '{theme,background}', '{"kind": "soft", "tone": "red"}'), 'theme'),
      ('a soft background without a tone', jsonb_set(d, '{theme,background}', '{"kind": "soft"}'), 'theme'),
      ('a background picture of another exam', jsonb_set(d, '{theme,background}', jsonb_build_object('kind', 'image', 'path', v_other, 'dim', 10)), 'theme'),
      ('a background picture outside a folder', jsonb_set(d, '{theme,background}', jsonb_build_object('kind', 'image', 'path', repeat('ab', 32) || '.png', 'dim', 10)), 'theme'),
      ('dim 81', jsonb_set(d, '{theme,background}', jsonb_build_object('kind', 'image', 'path', pg_temp.pic(v_x::text, 4), 'dim', 81)), 'theme'),
      ('dim 2.5', jsonb_set(d, '{theme,background}', jsonb_build_object('kind', 'image', 'path', pg_temp.pic(v_x::text, 4), 'dim', 2.5)), 'theme'),
      ('dim -1', jsonb_set(d, '{theme,background}', jsonb_build_object('kind', 'image', 'path', pg_temp.pic(v_x::text, 4), 'dim', -1)), 'theme'),
      ('a picture background without dim', jsonb_set(d, '{theme,background}', jsonb_build_object('kind', 'image', 'path', pg_temp.pic(v_x::text, 4))), 'theme'),
      ('font arial', jsonb_set(d, '{theme,font}', '"arial"'), 'theme'), ('radius none', jsonb_set(d, '{theme,radius}', '"none"'), 'theme'),
      ('density tight', jsonb_set(d, '{theme,density}', '"tight"'), 'theme'), ('answers cards', jsonb_set(d, '{theme,answers}', '"cards"'), 'theme'),
      ('buttons ghost', jsonb_set(d, '{theme,buttons}', '"ghost"'), 'theme'), ('no buttons', d #- '{theme,buttons}', 'theme'),
      -- layout
      ('layout grid', d || '{"layout": "grid"}', 'layout'), ('no layout', d - 'layout', 'layout'), ('layout null', d || '{"layout": null}', 'layout'),
      -- blocks
      ('no blocks', d - 'blocks', 'blocks'), ('blocks as an object', d || '{"blocks": {}}', 'blocks'),
      ('401 blocks', jsonb_set(d, '{blocks}', (select jsonb_agg(jsonb_build_object('type', 'divider', 'id', 'div' || lpad(i::text, 5, '0')))
         from generate_series(1, 401) i)), 'blocks'),
      -- a block: type, id
      ('a block that is a string', jsonb_set(d, '{blocks,3}', '"текст"'), 'block:3:type'),
      -- (not «video»: 20261019110000_doc_video.sql made it a type of its own)
      ('a block of no type', jsonb_set(d, '{blocks,3,type}', '"audio"'), 'block:3:type'),
      ('a block without a type', d #- '{blocks,3,type}', 'block:3:type'),
      ('a heading with a key of no rule', jsonb_set(d, '{blocks,1,html}', '"<b>x</b>"'), 'block:1:type'),
      ('a divider with a text', jsonb_set(d, '{blocks,9,text}', '"x"'), 'block:9:type'),
      ('an id in capitals', jsonb_set(d, '{blocks,4,id}', '"Question02"'), 'block:4:id'),
      ('an id of 7', jsonb_set(d, '{blocks,4,id}', '"abcdefg"'), 'block:4:id'),
      ('an id of 25', jsonb_set(d, '{blocks,4,id}', to_jsonb(repeat('a', 25))), 'block:4:id'),
      ('an id with a dash', jsonb_set(d, '{blocks,4,id}', '"abc-defgh"'), 'block:4:id'),
      ('a number id', jsonb_set(d, '{blocks,4,id}', '12345678'), 'block:4:id'),
      ('no id', d #- '{blocks,4,id}', 'block:4:id'),
      ('an id twice', jsonb_set(d, '{blocks,6,id}', '"question01"'), 'block:6:id'),
      -- cover
      ('a cover without a title', jsonb_set(d, '{blocks,0,title}', '"  "'), 'block:0:title'),
      ('a cover title of 201', jsonb_set(d, '{blocks,0,title}', to_jsonb(repeat('я', 201))), 'block:0:title'),
      ('a subtitle of 301', jsonb_set(d, '{blocks,0,subtitle}', to_jsonb(repeat('я', 301))), 'block:0:subtitle'),
      ('a null subtitle', jsonb_set(d, '{blocks,0,subtitle}', 'null'), 'block:0:subtitle'),
      ('a cover picture of another exam', jsonb_set(d, '{blocks,0,image}', to_jsonb(v_other)), 'block:0:image'),
      ('a cover picture .bmp', jsonb_set(d, '{blocks,0,image}', to_jsonb(replace(pg_temp.pic(v_x::text, 1), '.png', '.bmp'))), 'block:0:image'),
      ('a cover aligned right', jsonb_set(d, '{blocks,0,align}', '"right"'), 'block:0:align'),
      -- heading
      ('an empty heading', jsonb_set(d, '{blocks,1,text}', '""'), 'block:1:text'),
      ('a heading of 201', jsonb_set(d, '{blocks,1,text}', to_jsonb(repeat('я', 201))), 'block:1:text'),
      ('a heading of size xl', jsonb_set(d, '{blocks,1,size}', '"xl"'), 'block:1:size'),
      -- text
      ('an empty text', jsonb_set(d, '{blocks,3,text}', '""'), 'block:3:text'),
      ('a text of 4001', jsonb_set(d, '{blocks,3,text}', to_jsonb(repeat('я', 4001))), 'block:3:text'),
      ('a text justified', jsonb_set(d, '{blocks,3,align}', '"justify"'), 'block:3:align'),
      -- image
      ('a picture block without a path', jsonb_set(d, '{blocks,7,path}', 'null'), 'block:7:path'),
      ('a picture of another exam', jsonb_set(d, '{blocks,7,path}', to_jsonb(v_other)), 'block:7:path'),
      ('a caption of 301', jsonb_set(d, '{blocks,7,caption}', to_jsonb(repeat('я', 301))), 'block:7:caption'),
      ('a picture of width huge', jsonb_set(d, '{blocks,7,width}', '"huge"'), 'block:7:width'),
      -- note
      ('a note of tone error', jsonb_set(d, '{blocks,8,tone}', '"error"'), 'block:8:tone'),
      ('a note of 4001', jsonb_set(d, '{blocks,8,text}', to_jsonb(repeat('я', 4001))), 'block:8:text'),
      ('a note without a text', d #- '{blocks,8,text}', 'block:8:text'),
      -- page
      ('a page title of 201', jsonb_set(d, '{blocks,5,title}', to_jsonb(repeat('я', 201))), 'block:5:title'),
      ('a page title null', jsonb_set(d, '{blocks,5,title}', 'null'), 'block:5:title'),
      -- question
      ('an item id that is no uuid', jsonb_set(d, '{blocks,4,item_id}', '"не-uuid"'), 'block:4:item_id'),
      ('a question of another exam', jsonb_set(d, '{blocks,4,item_id}', to_jsonb(pg_temp.item('y:1'))), 'block:4:item_id'),
      ('a question that does not exist', jsonb_set(d, '{blocks,4,item_id}', '"99999999-0000-4000-8000-000000000009"'), 'block:4:item_id'),
      ('a question twice', jsonb_set(d, '{blocks,6,item_id}', to_jsonb(pg_temp.item('d:3'))), 'block:6:item_id'),
      ('the same question in capitals', jsonb_set(d, '{blocks,6,item_id}', to_jsonb(upper(pg_temp.item('d:3')::text))), 'block:6:item_id'),
      ('points 0', jsonb_set(d, '{blocks,4,points}', '0'), 'block:4:points'),
      ('points 101', jsonb_set(d, '{blocks,4,points}', '101'), 'block:4:points'),
      ('points 1.5', jsonb_set(d, '{blocks,4,points}', '1.5'), 'block:4:points'),
      ('points "1"', jsonb_set(d, '{blocks,4,points}', '"1"'), 'block:4:points'),
      ('required "yes"', jsonb_set(d, '{blocks,4,required}', '"yes"'), 'block:4:required'),
      ('no required', d #- '{blocks,4,required}', 'block:4:required'),
      ('a question with a key', jsonb_set(d, '{blocks,4,correct}', '[1]'), 'block:4:type'),
      -- results
      ('no results', d - 'results', 'results'), ('results with a key of no rule', jsonb_set(d, '{results,review}', 'true'), 'results'),
      ('bands as an object', jsonb_set(d, '{results,bands}', '{}'), 'results'),
      ('seven bands', jsonb_set(d, '{results,bands}', (select jsonb_agg(jsonb_build_object('from', i * 10, 'to', i * 10 + 9,
         'title', 'Полоса ' || i, 'text', '', 'image', null)) from generate_series(0, 6) i)), 'results'),
      ('a band to 101', jsonb_set(d, '{results,bands,2,to}', '101'), 'results'),
      ('a band from 2.5', jsonb_set(d, '{results,bands,0,from}', '2.5'), 'results'),
      ('a band to before its from', jsonb_set(d, '{results,bands,1,to}', '45'), 'results'),
      ('overlapping bands', jsonb_set(d, '{results,bands,2,from}', '79'), 'results'),
      ('a band inside another', jsonb_set(d, '{results,bands}', '[{"from": 0, "to": 100, "title": "a", "text": "", "image": null},
         {"from": 40, "to": 60, "title": "b", "text": "", "image": null}]'), 'results'),
      ('a band without a title', jsonb_set(d, '{results,bands,0,title}', '" "'), 'results'),
      ('a band text of 4001', jsonb_set(d, '{results,bands,0,text}', to_jsonb(repeat('я', 4001))), 'results'),
      ('a band picture of another exam', jsonb_set(d, '{results,bands,0,image}', to_jsonb(v_other)), 'results'),
      ('a band with a key of no rule', jsonb_set(d, '{results,bands,0,emoji}', '"!"'), 'results'),
      ('a band without image', d #- '{results,bands,0,image}', 'results'),
      ('a cta over http', jsonb_set(d, '{results,cta,url}', '"http://meldy.example/"'), 'results'),
      ('a cta to javascript', jsonb_set(d, '{results,cta,url}', '"javascript:alert(1)"'), 'results'),
      ('a cta of 301', jsonb_set(d, '{results,cta,url}', to_jsonb('https://' || repeat('a', 293))), 'results'),
      ('a cta without a label', jsonb_set(d, '{results,cta,label}', '""'), 'results'),
      ('a cta with a key of no rule', jsonb_set(d, '{results,cta,target}', '"_blank"'), 'results'),
      ('no cta', d #- '{results,cta}', 'results'),
      -- the first broken rule wins
      ('title and layout broken', d || '{"title": "", "layout": "grid"}', 'title'),
      ('theme and results broken', jsonb_set(d, '{theme,font}', '"arial"') - 'results', 'theme'),
      ('blocks 3 and 7 broken', jsonb_set(jsonb_set(d, '{blocks,7,width}', '"huge"'), '{blocks,3,align}', '"x"'), 'block:3:align'),
      ('a block''s id and its text broken', jsonb_set(jsonb_set(d, '{blocks,1,text}', '""'), '{blocks,1,id}', '"x"'), 'block:1:id'),
      ('a block and the results broken', jsonb_set(d, '{blocks,12,points}', '0') - 'results', 'block:12:points')) c(what, doc, rule) loop
    v_got := meldy_private.test_doc_ok(v_case.doc, v_x);
    if v_got is distinct from v_case.rule then
      raise exception 'FAILED: % — rule %, expected %', v_case.what, coalesce(v_got, 'none'), v_case.rule;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n < 100 then raise exception 'FAILED: only % broken documents checked', v_n; end if;
  -- the page of X is valid for X only: in Y its pictures and questions are another exam's
  if meldy_private.test_doc_ok(d, pg_temp.c('y')::uuid) is distinct from 'block:0:image'
     or meldy_private.test_doc_ok(d #- '{blocks,0}', pg_temp.c('y')::uuid) is distinct from 'block:1:item_id' then
    raise exception 'FAILED: the page of X in Y %', meldy_private.test_doc_ok(d, pg_temp.c('y')::uuid);
  end if;
end
$t$;

-- 3. Who reaches the document: anon runs neither function; a signed-out caller, a stranger, a member and a missing exam
--    get nothing.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
begin
  perform pg_temp.expect_error(format('select public.test_doc_get(%L)', pg_temp.c('x')), '42501', 'anon reads the document');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 0)', pg_temp.c('x'), pg_temp.doc()), '42501', 'anon saves the document');
  if exists (select 1 from information_schema.role_table_grants where table_name = 'test_docs' and grantee in ('anon', 'PUBLIC')) then
    raise exception 'FAILED: anon has a right on test_docs';
  end if;
end
$t$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
do $t$
begin
  perform pg_temp.expect_error(format('select public.test_doc_get(%L)', pg_temp.c('x')), '28000', 'a signed-out get');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 0)', pg_temp.c('x'), pg_temp.doc()), '28000', 'a signed-out save');
end
$t$;
do $t$
declare v_user text;
begin
  foreach v_user in array array['cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002'] loop
    perform set_config('request.jwt.claim.sub', v_user, true);
    perform pg_temp.expect_error(format('select public.test_doc_get(%L)', pg_temp.c('x')), 'P0002', 'get by ' || v_user, 'container');
    perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 0)', pg_temp.c('x'), pg_temp.doc()), 'P0002', 'save by ' || v_user, 'container');
    perform pg_temp.expect_error('select * from public.test_docs', '42501', 'the table read by ' || v_user);
  end loop;
end
$t$;

-- 4. A: get before the first save (null), the first save with rev 0, revisions, stale, refusals, size.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare
  r jsonb; g jsonb; v_x uuid := pg_temp.c('x')::uuid; d jsonb := pg_temp.doc(); v_big jsonb; v_at text;
begin
  perform pg_temp.expect_error(format('select public.test_doc_get(%L)', '99999999-0000-4000-8000-000000000009'), 'P0002', 'get of a missing exam', 'container');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 0)', '99999999-0000-4000-8000-000000000009', d), 'P0002', 'save into a missing exam', 'container');
  if public.test_doc_get(v_x) is not null then raise exception 'FAILED: a document before the first save'; end if;
  -- no document yet: only rev 0 saves
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 1)', v_x, d), 'MC020', 'rev 1 before the first save', 'stale');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, null)', v_x, d), 'MC020', 'a null rev', 'stale');
  -- a broken document saves nothing (22023 with the rule): a question of another exam, a key of no rule
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 0)', v_x, jsonb_set(d, '{blocks,4,item_id}', to_jsonb(pg_temp.item('y:1')))),
    '22023', 'a question of another exam', 'block:4:item_id');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 0)', v_x, d || '{"html": "<script>"}'), '22023', 'an unknown key', 'version');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, null, 0)', v_x), '22023', 'no document', 'version');
  if public.test_doc_get(v_x) is not null then raise exception 'FAILED: a refused save kept a document'; end if;
  -- the first save
  r := public.test_doc_save(v_x, d, 0);
  if pg_temp.keys(r) is distinct from 'rev,updated_at' or (r ->> 'rev')::int is distinct from 1 then
    raise exception 'FAILED: the first save %', r;
  end if;
  g := public.test_doc_get(v_x);
  if pg_temp.keys(g) is distinct from 'container_id,doc,rev,updated_at' or g -> 'doc' is distinct from d
     or (g ->> 'rev')::int is distinct from 1 or g ->> 'container_id' is distinct from v_x::text
     or (g ->> 'updated_at')::timestamptz is distinct from (r ->> 'updated_at')::timestamptz then
    raise exception 'FAILED: get after the first save %', g;
  end if;
  -- a second «first save» (another tab) is stale; so is a future rev
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 0)', v_x, d), 'MC020', 'rev 0 over a document', 'stale');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 2)', v_x, d), 'MC020', 'a future rev', 'stale');
  -- the next save over rev 1 → 2; the old rev 1 is stale now; the message carries nothing
  r := public.test_doc_save(v_x, d || '{"layout": "pages"}', 1);
  if (r ->> 'rev')::int is distinct from 2 or public.test_doc_get(v_x) -> 'doc' ->> 'layout' is distinct from 'pages' then
    raise exception 'FAILED: the second save %', r;
  end if;
  begin
    perform public.test_doc_save(v_x, d, 1);
    raise exception 'FAILED: an old rev saved';
  exception
    when sqlstate 'MC020' then
      if sqlerrm <> 'stale' then raise exception 'FAILED: the stale message %', sqlerrm; end if;
  end;
  -- a broken document over the right rev: refused, rev and document stay
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 2)', v_x, jsonb_set(d, '{blocks,7,width}', '"huge"')),
    '22023', 'a broken document over the right rev', 'block:7:width');
  g := public.test_doc_get(v_x);
  if (g ->> 'rev')::int is distinct from 2 or g -> 'doc' ->> 'layout' is distinct from 'pages' then
    raise exception 'FAILED: a refused save changed the document %', g ->> 'rev';
  end if;
  -- size: 20 texts of 4000 letters (≈ 160 KB) save; 30 (≈ 240 KB) are refused (22023 size), whatever else they hold
  v_big := jsonb_set(d, '{blocks}', (select jsonb_agg(jsonb_build_object('type', 'text', 'id', 'big' || lpad(i::text, 5, '0'),
                                                                          'text', repeat('я', 4000), 'align', 'left'))
                                       from generate_series(1, 20) i));
  if octet_length(v_big::text) not between 150000 and 204800 then raise exception 'FAILED: the size fixture %', octet_length(v_big::text); end if;
  r := public.test_doc_save(v_x, v_big, 2);
  if (r ->> 'rev')::int is distinct from 3 then raise exception 'FAILED: a document of 160 KB %', r; end if;
  v_big := jsonb_set(d, '{blocks}', (select jsonb_agg(jsonb_build_object('type', 'text', 'id', 'big' || lpad(i::text, 5, '0'),
                                                                          'text', repeat('я', 4000), 'align', 'left'))
                                       from generate_series(1, 30) i));
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 3)', v_x, v_big), '22023', 'a document over 200 KB', 'size');
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 3)', v_x, v_big || '{"v": 7}'), '22023', 'a broken document over 200 KB', 'size');
  -- back to the page of X (rev 4)
  r := public.test_doc_save(v_x, d, 3);
  if (r ->> 'rev')::int is distinct from 4 then raise exception 'FAILED: the page of X saved again %', r; end if;
  perform pg_temp.put('rev_x', '4');
  -- the documents are per exam: Y has none
  if public.test_doc_get(pg_temp.c('y')::uuid) is not null then raise exception 'FAILED: Y has a document'; end if;
end
$t$;

-- 5. postgres: the table keeps 200 KB even past the functions; the documents of X only.
reset role;
do $t$
begin
  perform pg_temp.expect_error(format('update public.test_docs set doc = %L where container_id = %L',
    jsonb_build_object('pad', repeat('я', 110000)), pg_temp.c('x')), '23514', 'a document over 200 KB in the table');
  perform pg_temp.expect_error(format('update public.test_docs set rev = 0 where container_id = %L', pg_temp.c('x')), '23514', 'rev 0 in the table');
  if (select count(*) from public.test_docs) <> 1 then raise exception 'FAILED: documents %', (select count(*) from public.test_docs); end if;
end
$t$;

-- 6. A: quizzes «как в студии» — the settings and their refusals; QD (design) and QN (without) on X.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare
  r jsonb; v_x uuid := pg_temp.c('x')::uuid; v_y uuid := pg_temp.c('y')::uuid; v_design jsonb := pg_temp.doc() - 'v';
  v_row_keys constant text := 'accent,allow_back,attempts,closed_at,closes_at,code,container_id,cover_path,created_at,design,'
    'grading,guests,id,item_count,members_only,offer_practice,opens_at,pass_percent,review,same_set,shuffle_items,'
    'shuffle_options,started,state,subject_ids,time_limit_s,title,updated_at';
  v_preview_keys constant text := 'accent,allow_back,attempts,author_name,closes_at,cover_path,design,exam_title,grading,'
    'guests,item_count,me,members_only,offer_practice,opens_at,pass_percent,review,server_now,status,time_limit_s,title';
begin
  perform pg_temp.put('design', v_design::text);
  -- QD: design on, the draw settings given as an ordinary quiz would take them (S1 only, 2 questions, shuffled, a new
  -- draw per attempt): stored as given, ignored by the draw
  r := public.quiz_create(v_x, jsonb_build_object('title', 'Как в студии', 'design', true, 'subject_ids', jsonb_build_array(pg_temp.c('s1')),
         'item_count', 2, 'shuffle_items', true, 'same_set', false, 'shuffle_options', false, 'review', 'answers', 'attempts', null));
  if pg_temp.keys(r) is distinct from v_row_keys then raise exception 'FAILED: QuizRow keys %', pg_temp.keys(r); end if;
  if not (r ->> 'design')::boolean or not (r ->> 'shuffle_items')::boolean or (r ->> 'same_set')::boolean
     or (r ->> 'item_count')::int is distinct from 2 or r -> 'subject_ids' is distinct from jsonb_build_array(pg_temp.c('s1')) then
    raise exception 'FAILED: a design quiz stores its settings as given %', r;
  end if;
  perform pg_temp.put('qd', r ->> 'id');
  perform pg_temp.put('code_d', r ->> 'code');
  -- QN: no design (the default)
  r := public.quiz_create(v_x, jsonb_build_object('title', 'Обычная', 'subject_ids', jsonb_build_array(pg_temp.c('s1')), 'item_count', 5,
         'shuffle_items', false, 'review', 'answers'));
  if (r ->> 'design')::boolean or pg_temp.keys(r) is distinct from v_row_keys then raise exception 'FAILED: design off by default %', r; end if;
  perform pg_temp.put('qn', r ->> 'id');
  perform pg_temp.put('code_n', r ->> 'code');
  -- refusals: not a boolean; Y has no document; switching design on where there is nothing to draw
  perform pg_temp.expect_error(format('select public.quiz_create(%L, %L)', v_x, '{"design": "yes"}'), '22023', 'design "yes"', 'design');
  perform pg_temp.expect_error(format('select public.quiz_create(%L, %L)', v_x, '{"design": null}'), '22023', 'design null', 'design');
  perform pg_temp.expect_error(format('select public.quiz_create(%L, %L)', v_y, '{"design": true}'), 'MC013', 'design without a document', 'no_questions');
  r := public.quiz_create(v_y, '{}');
  if (r ->> 'design')::boolean then raise exception 'FAILED: Y''s quiz %', r; end if;
  perform pg_temp.put('qy', r ->> 'id');
  perform pg_temp.expect_error(format('select public.quiz_update(%L, %L)', r ->> 'id', '{"design": true}'), 'MC013', 'design on without a document', 'no_questions');
  -- before the start design switches both ways
  r := public.quiz_create(v_x, '{"title": "Переключатель"}');
  r := public.quiz_update((r ->> 'id')::uuid, '{"design": true}');
  if not (r ->> 'design')::boolean then raise exception 'FAILED: design switched on %', r; end if;
  r := public.quiz_update((r ->> 'id')::uuid, '{"design": false}');
  if (r ->> 'design')::boolean then raise exception 'FAILED: design switched off %', r; end if;
  -- the preview: item_count = the questions the page draws (d:3, d:1, d:7, d:2, d:5: not d:6 without a key, not d:4 off
  -- the page), design = the stored document without v
  r := public.quiz_preview(pg_temp.c('code_d'));
  if pg_temp.keys(r) is distinct from v_preview_keys or (r ->> 'item_count')::int is distinct from 5 or r -> 'design' is distinct from v_design
     or pg_temp.keys(r -> 'design') is distinct from 'blocks,layout,results,theme,title' then
    raise exception 'FAILED: the preview of a design quiz %', r;
  end if;
  r := public.quiz_preview(pg_temp.c('code_n'));
  if pg_temp.keys(r) is distinct from v_preview_keys or r -> 'design' is distinct from 'null'::jsonb or (r ->> 'item_count')::int is distinct from 5 then
    raise exception 'FAILED: the preview without design %', r;
  end if;
end
$t$;

-- 7. C (signed in) writes QD: the page's questions in its order, all of them, no key or explanation; QN: design null.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare
  r jsonb; r2 jsonb; v_design jsonb := pg_temp.c('design')::jsonb;
  v_attempt_keys constant text := 'allow_back,answers,attempt_id,deadline_at,design,items,n,quiz_title,server_now,shuffle_options,started_at';
begin
  r := public.quiz_preview(pg_temp.c('code_d'));
  if r -> 'design' is distinct from v_design or not (r -> 'me' ->> 'can_start')::boolean then raise exception 'FAILED: C''s preview %', r; end if;
  r := public.quiz_start(pg_temp.c('code_d'), 'Вера');
  if pg_temp.keys(r) is distinct from v_attempt_keys then raise exception 'FAILED: Attempt keys %', pg_temp.keys(r); end if;
  if pg_temp.ids(r -> 'items') is distinct from pg_temp.refs('d:3', 'd:1', 'd:7', 'd:2', 'd:5') then
    raise exception 'FAILED: the page''s questions in order %', r -> 'items';
  end if;
  if r -> 'design' is distinct from v_design or (r ->> 'shuffle_options')::boolean then
    raise exception 'FAILED: the attempt''s design %', r -> 'design';
  end if;
  if exists (select 1 from jsonb_array_elements(r -> 'items') x where pg_temp.keys(x) is distinct from 'code,id,images,keep_order,kind,options,stem')
     or position('"correct"' in r::text) > 0 or position('Париж' in r::text) > 0 or position('Потому что' in r::text) > 0
     or position('explanation' in r::text) > 0 or position('город П.' in r::text) > 0 or position('"answers": [{' in r::text) > 0 then
    raise exception 'FAILED: the key or the explanation left the server %', r;
  end if;
  perform pg_temp.put('c_att', r ->> 'attempt_id');
  -- resume: the same attempt and items
  r2 := public.quiz_start(pg_temp.c('code_d'), 'Вера');
  if r2 ->> 'attempt_id' is distinct from r ->> 'attempt_id' or r2 -> 'items' is distinct from r -> 'items' or r2 -> 'design' is distinct from v_design then
    raise exception 'FAILED: a resume %', r2;
  end if;
  -- 3 of 5 right: d:3 (2 points), d:1 (1), d:2 (3); d:7 (1) wrong; d:5 (1) unanswered → 6 of 8 points, 75 % → «Хорошо»
  perform public.quiz_answer((r ->> 'attempt_id')::uuid, jsonb_build_array(
    jsonb_build_object('item_id', pg_temp.item('d:3'), 'text', 'париж'),
    jsonb_build_object('item_id', pg_temp.item('d:1'), 'chosen', jsonb_build_array(1)),
    jsonb_build_object('item_id', pg_temp.item('d:7'), 'chosen', jsonb_build_array(0)),
    jsonb_build_object('item_id', pg_temp.item('d:2'), 'chosen', jsonb_build_array(1, 2))));
  r := public.quiz_finish((r ->> 'attempt_id')::uuid);
  if pg_temp.keys(r) is distinct from 'accent,answers_after,attempt_id,attempts_left,band,can_retry,code,correct,design,finish_reason,'
       'finished_at,items,max_score,n,pass_percent,passed,percent,practice,quiz_title,review_now,score,shuffle_options,started_at,total' then
    raise exception 'FAILED: Result keys %', pg_temp.keys(r);
  end if;
  if (r ->> 'correct')::int is distinct from 3 or (r ->> 'total')::int is distinct from 5 or (r ->> 'percent')::int is distinct from 75
     or (r ->> 'score')::int is distinct from 6 or (r ->> 'max_score')::int is distinct from 8
     or r -> 'band' is distinct from v_design -> 'results' -> 'bands' -> 1 or r -> 'design' is distinct from v_design
     or pg_temp.ids(r -> 'items') is distinct from pg_temp.refs('d:3', 'd:1', 'd:7', 'd:2', 'd:5')
     or pg_temp.find(r -> 'items', 'id', pg_temp.item('d:1')::text) ->> 'explanation' is distinct from 'Потому что четыре' then
    raise exception 'FAILED: C''s result %', r;
  end if;
  if public.quiz_result((r ->> 'attempt_id')::uuid) is distinct from r then raise exception 'FAILED: quiz_result differs from quiz_finish'; end if;
  -- QN: design null in the attempt and the result, band null
  r := public.quiz_start(pg_temp.c('code_n'), 'Вера');
  if pg_temp.keys(r) is distinct from v_attempt_keys or r -> 'design' is distinct from 'null'::jsonb
     or pg_temp.ids(r -> 'items') is distinct from pg_temp.refs('d:1', 'd:2', 'd:3', 'd:4', 'd:5') then
    raise exception 'FAILED: an attempt without design %', r;
  end if;
  r := public.quiz_finish((r ->> 'attempt_id')::uuid);
  if r -> 'design' is distinct from 'null'::jsonb or r -> 'band' is distinct from 'null'::jsonb or not (r ? 'band') or not (r ? 'design')
     or (r ->> 'score')::int is distinct from (r ->> 'correct')::int or (r ->> 'max_score')::int is distinct from 5 then
    raise exception 'FAILED: a result without design %', r;
  end if;
end
$t$;

-- 8. Guests write QD the same way: the same set in the same order, design in the attempt, a band in the result.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare r jsonb; v_design jsonb := pg_temp.c('design')::jsonb;
begin
  r := public.quiz_preview(pg_temp.c('code_d'), pg_temp.tok(1));
  if r -> 'design' is distinct from v_design or not (r -> 'me' ->> 'guest')::boolean then raise exception 'FAILED: a guest''s preview %', r; end if;
  -- guest 1: everything right → 100 % → «Отлично»
  r := public.quiz_guest_start(pg_temp.c('code_d'), 'Гость Один', pg_temp.tok(1));
  if pg_temp.ids(r -> 'items') is distinct from pg_temp.refs('d:3', 'd:1', 'd:7', 'd:2', 'd:5') or r -> 'design' is distinct from v_design
     or position('Потому что' in r::text) > 0 or position('"correct"' in r::text) > 0 then
    raise exception 'FAILED: a guest''s design attempt %', r;
  end if;
  perform public.quiz_guest_answer((r ->> 'attempt_id')::uuid, pg_temp.tok(1), jsonb_build_array(
    jsonb_build_object('item_id', pg_temp.item('d:3'), 'text', 'Париж'),
    jsonb_build_object('item_id', pg_temp.item('d:1'), 'chosen', jsonb_build_array(1)),
    jsonb_build_object('item_id', pg_temp.item('d:7'), 'chosen', jsonb_build_array(1)),
    jsonb_build_object('item_id', pg_temp.item('d:2'), 'chosen', jsonb_build_array(1, 2)),
    jsonb_build_object('item_id', pg_temp.item('d:5'), 'chosen', jsonb_build_array(0))));
  r := public.quiz_guest_finish((r ->> 'attempt_id')::uuid, pg_temp.tok(1));
  if (r ->> 'percent')::int is distinct from 100 or r -> 'band' ->> 'title' is distinct from 'Отлично' or r -> 'design' is distinct from v_design
     or (r ->> 'score')::int is distinct from 8 or (r ->> 'max_score')::int is distinct from 8 then
    raise exception 'FAILED: a guest''s result %', r;
  end if;
  perform pg_temp.put('g1_att', r ->> 'attempt_id');
  if public.quiz_guest_result((r ->> 'attempt_id')::uuid, pg_temp.tok(1)) is distinct from r then raise exception 'FAILED: guest_result'; end if;
  -- guest 2: nothing → 0 % → «Ещё рано»
  r := public.quiz_guest_start(pg_temp.c('code_d'), 'Гость Два', pg_temp.tok(2));
  r := public.quiz_guest_finish((r ->> 'attempt_id')::uuid, pg_temp.tok(2));
  if (r ->> 'percent')::int is distinct from 0 or r -> 'band' ->> 'title' is distinct from 'Ещё рано' then raise exception 'FAILED: a band at 0 %', r; end if;
end
$t$;

-- 9. A: started, design is locked (MC011 design); the unlocked settings still change; the author's views carry design.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb;
begin
  perform pg_temp.expect_error(format('select public.quiz_update(%L, %L)', pg_temp.c('qd'), '{"design": false}'), 'MC011', 'design after the start', 'design');
  perform pg_temp.expect_error(format('select public.quiz_update(%L, %L)', pg_temp.c('qn'), '{"design": true}'), 'MC011', 'design on after the start', 'design');
  r := public.quiz_update(pg_temp.c('qd')::uuid, '{"design": true, "title": "Как в студии, 2", "accent": "violet"}');
  if not (r ->> 'design')::boolean or r ->> 'title' is distinct from 'Как в студии, 2' or not (r ->> 'started')::boolean then
    raise exception 'FAILED: the unlocked settings of a started design quiz %', r;
  end if;
  r := public.quiz_results(pg_temp.c('qd')::uuid);
  if not (r -> 'quiz' ->> 'design')::boolean or jsonb_array_length(r -> 'attempts') <> 3 then raise exception 'FAILED: the results of QD %', r; end if;
  r := pg_temp.find(public.quiz_list(pg_temp.c('x')::uuid), 'id', pg_temp.c('qd'));
  if not (r ->> 'design')::boolean or (r ->> 'people')::int is distinct from 3 then raise exception 'FAILED: quiz_list with design %', r; end if;
end
$t$;

-- 10. A deletes d:5 (the owner may delete a question row): its block stays in the document as it was (no cascade into
--     the JSON); a save of that document is refused until the block goes; the quiz skips it.
do $t$
declare g jsonb; r jsonb; v_x uuid := pg_temp.c('x')::uuid;
begin
  delete from public.test_items where id = pg_temp.item('d:5');
  if not found then raise exception 'FAILED: the owner deletes a question'; end if;
  g := public.test_doc_get(v_x);
  if g -> 'doc' is distinct from pg_temp.doc() or (g ->> 'rev')::int is distinct from pg_temp.c('rev_x')::int
     or g -> 'doc' -> 'blocks' -> 12 ->> 'item_id' is distinct from pg_temp.item('d:5')::text then
    raise exception 'FAILED: the document after a deleted question %', g;
  end if;
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, %s)', v_x, g -> 'doc', g ->> 'rev'),
    '22023', 'a save with a dangling block', 'block:12:item_id');
  -- the preview draws the four left; the design still holds the dangling block (the readers skip it)
  r := public.quiz_preview(pg_temp.c('code_d'));
  if (r ->> 'item_count')::int is distinct from 4 or r -> 'design' -> 'blocks' -> 12 ->> 'item_id' is distinct from pg_temp.item('d:5')::text then
    raise exception 'FAILED: the preview after a deleted question %', r;
  end if;
end
$t$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_guest_start(pg_temp.c('code_d'), 'Гость Три', pg_temp.tok(3));
  if pg_temp.ids(r -> 'items') is distinct from pg_temp.refs('d:3', 'd:1', 'd:7', 'd:2') then
    raise exception 'FAILED: a new attempt skips the dangling block %', r -> 'items';
  end if;
  perform pg_temp.put('g3_att', r ->> 'attempt_id');
  -- guest 1's finished attempt is graded over what is left: 4 of 4, 7 of 7 points
  r := public.quiz_guest_result(pg_temp.c('g1_att')::uuid, pg_temp.tok(1));
  if (r ->> 'total')::int is distinct from 4 or (r ->> 'correct')::int is distinct from 4
     or (r ->> 'score')::int is distinct from 7 or (r ->> 'max_score')::int is distinct from 7 then
    raise exception 'FAILED: a result after the delete %', r;
  end if;
end
$t$;

-- 11. A drops the dangling block and leaves a gap between the bands; C's result (6 of 7 points = 86 %) falls in the gap:
--     band null, the design the new document.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; d jsonb := pg_temp.doc() #- '{blocks,12}';
begin
  d := jsonb_set(d, '{results,bands}', jsonb_build_array(d -> 'results' -> 'bands' -> 0,
         jsonb_build_object('from', 90, 'to', 100, 'title', 'Почти идеально', 'text', '', 'image', null)));
  r := public.test_doc_save(pg_temp.c('x')::uuid, d, pg_temp.c('rev_x')::int);
  if (r ->> 'rev')::int is distinct from pg_temp.c('rev_x')::int + 1 then raise exception 'FAILED: the save without the dangling block %', r; end if;
  perform pg_temp.put('design2', (d - 'v')::text);
end
$t$;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_result(pg_temp.c('c_att')::uuid);
  if (r ->> 'percent')::int is distinct from 86 or (r ->> 'score')::int is distinct from 6 or (r ->> 'max_score')::int is distinct from 7
     or r -> 'band' is distinct from 'null'::jsonb
     or r -> 'design' is distinct from pg_temp.c('design2')::jsonb then
    raise exception 'FAILED: a result in a gap between the bands %', r;
  end if;
end
$t$;

-- 12. Z: a page of 201 questions draws the first 200 (an attempt's limit), in order.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; v_z uuid := pg_temp.c('z')::uuid; d jsonb;
begin
  d := jsonb_set(pg_temp.doc(), '{blocks}', (select jsonb_agg(jsonb_build_object('type', 'question', 'id', 'zq' || lpad(i::text, 6, '0'),
         'item_id', pg_temp.item('z:' || i), 'points', 1, 'required', false) order by i) from generate_series(1, 201) i));
  d := jsonb_set(d, '{results,bands,1,image}', 'null');
  r := public.test_doc_save(v_z, d, 0);
  if (r ->> 'rev')::int is distinct from 1 then raise exception 'FAILED: the page of Z %', r; end if;
  r := public.quiz_create(v_z, '{"design": true, "item_count": 5}');
  perform pg_temp.put('code_z', r ->> 'code');
  if (public.quiz_preview(r ->> 'code') ->> 'item_count')::int is distinct from 200 then
    raise exception 'FAILED: the preview of 201 questions %', public.quiz_preview(r ->> 'code') ->> 'item_count';
  end if;
end
$t$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_guest_start(pg_temp.c('code_z'), 'Гость Зет', pg_temp.tok(4));
  if jsonb_array_length(r -> 'items') <> 200 or r -> 'items' -> 0 ->> 'id' is distinct from pg_temp.item('z:1')::text
     or r -> 'items' -> 199 ->> 'id' is distinct from pg_temp.item('z:200')::text then
    raise exception 'FAILED: 201 questions on the page → % in the attempt', jsonb_array_length(r -> 'items');
  end if;
end
$t$;

-- 13. Points count. W: three questions worth 1, 1 and 5 on the page; C starts, then A changes the points to 1, 1, 1; C
--     answers only the 5-point one right: 1 of 3 right, 5 of 7 points → 71 %, passed (pass mark 70), the band of 71 —
--     the points of C's start, kept with the attempt. A guest who starts after the edit weighs 1, 1, 1: 33 %, not
--     passed. The author's views read the same percent (quiz_results' score / max_score, quiz_list's avg_percent), and
--     so does C's preview.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; v_w uuid; d jsonb;
begin
  r := public.container_create('Баллы', null, '[{"title":"Один"}]');
  v_w := (r ->> 'container_id')::uuid;
  perform pg_temp.put('w', v_w::text);
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'w:1', 'stem', 'Первый', 'options', jsonb_build_array('а', 'б'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'w:2', 'stem', 'Второй', 'options', jsonb_build_array('а', 'б'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'w:3', 'stem', 'Главный', 'options', jsonb_build_array('а', 'б'), 'correct', jsonb_build_array(0))));
  insert into pg_temp.ctx select 'item:' || i.import_ref, i.id::text from public.test_items i where i.container_id = v_w;
  d := jsonb_set(jsonb_set(pg_temp.doc(), '{blocks}', jsonb_build_array(
         jsonb_build_object('type', 'question', 'id', 'wq000001', 'item_id', pg_temp.item('w:1'), 'points', 1, 'required', false),
         jsonb_build_object('type', 'question', 'id', 'wq000002', 'item_id', pg_temp.item('w:2'), 'points', 1, 'required', false),
         jsonb_build_object('type', 'question', 'id', 'wq000003', 'item_id', pg_temp.item('w:3'), 'points', 5, 'required', false))),
       '{results,bands}', jsonb_build_array(
         jsonb_build_object('from', 0, 'to', 69, 'title', 'Меньше семидесяти', 'text', '', 'image', null),
         jsonb_build_object('from', 70, 'to', 79, 'title', 'Семьдесят с лишним', 'text', '', 'image', null),
         jsonb_build_object('from', 80, 'to', 100, 'title', 'Больше восьмидесяти', 'text', '', 'image', null)));
  perform pg_temp.put('doc_w', d::text);
  r := public.test_doc_save(v_w, d, 0);
  r := public.quiz_create(v_w, '{"design": true, "pass_percent": 70, "review": "answers", "attempts": null}');
  perform pg_temp.put('qw', r ->> 'id');
  perform pg_temp.put('code_w', r ->> 'code');
end
$t$;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_start(pg_temp.c('code_w'), 'Вера');
  if pg_temp.ids(r -> 'items') is distinct from pg_temp.refs('w:1', 'w:2', 'w:3') then raise exception 'FAILED: W''s items %', r -> 'items'; end if;
  perform pg_temp.put('cw_att', r ->> 'attempt_id');
end
$t$;
-- A edits the points after C's start: 1, 1, 1
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb;
begin
  r := public.test_doc_save(pg_temp.c('w')::uuid, jsonb_set(pg_temp.c('doc_w')::jsonb, '{blocks,2,points}', '1'), 1);
  if (r ->> 'rev')::int is distinct from 2 then raise exception 'FAILED: the points edited %', r; end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb;
begin
  perform public.quiz_answer(pg_temp.c('cw_att')::uuid, jsonb_build_array(
    jsonb_build_object('item_id', pg_temp.item('w:1'), 'chosen', jsonb_build_array(1)),
    jsonb_build_object('item_id', pg_temp.item('w:2'), 'chosen', jsonb_build_array(1)),
    jsonb_build_object('item_id', pg_temp.item('w:3'), 'chosen', jsonb_build_array(0))));
  r := public.quiz_finish(pg_temp.c('cw_att')::uuid);
  if (r ->> 'correct')::int is distinct from 1 or (r ->> 'total')::int is distinct from 3 or (r ->> 'score')::int is distinct from 5
     or (r ->> 'max_score')::int is distinct from 7 or (r ->> 'percent')::int is distinct from 71 or not (r ->> 'passed')::boolean
     or r -> 'band' ->> 'title' is distinct from 'Семьдесят с лишним' then
    raise exception 'FAILED: 5 of 7 points %', r;
  end if;
  if public.quiz_result(pg_temp.c('cw_att')::uuid) is distinct from r then raise exception 'FAILED: the weighted result read again'; end if;
  r := public.quiz_preview(pg_temp.c('code_w'));
  if pg_temp.keys(r -> 'me' -> 'results' -> 0) is distinct from 'attempt_id,correct,finished_at,max_score,n,score,total'
     or (r -> 'me' -> 'results' -> 0 ->> 'score')::int is distinct from 5 or (r -> 'me' -> 'results' -> 0 ->> 'max_score')::int is distinct from 7 then
    raise exception 'FAILED: the preview''s results with points %', r -> 'me' -> 'results';
  end if;
end
$t$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_guest_start(pg_temp.c('code_w'), 'Гость Баллов', pg_temp.tok(5));
  perform public.quiz_guest_answer((r ->> 'attempt_id')::uuid, pg_temp.tok(5), jsonb_build_array(
    jsonb_build_object('item_id', pg_temp.item('w:3'), 'chosen', jsonb_build_array(0))));
  r := public.quiz_guest_finish((r ->> 'attempt_id')::uuid, pg_temp.tok(5));
  if (r ->> 'score')::int is distinct from 1 or (r ->> 'max_score')::int is distinct from 3 or (r ->> 'percent')::int is distinct from 33
     or (r ->> 'passed')::boolean or r -> 'band' ->> 'title' is distinct from 'Меньше семидесяти' then
    raise exception 'FAILED: a start after the edit weighs 1, 1, 1 %', r;
  end if;
  perform pg_temp.put('gw_att', r ->> 'attempt_id');
end
$t$;
-- postgres: the points live with the attempts (C's from its start, the guest's from the edited page); none for a quiz
-- without design
reset role;
do $t$
begin
  if (select item_points from public.quiz_attempts where id = pg_temp.c('cw_att')::uuid) is distinct from '{1,1,5}'::smallint[]
     or (select item_points from public.quiz_attempts where id = pg_temp.c('gw_att')::uuid) is distinct from '{1,1,1}'::smallint[]
     or (select item_points from public.quiz_attempts where id = pg_temp.c('c_att')::uuid) is distinct from '{2,1,1,3,1}'::smallint[]
     or exists (select 1 from public.quiz_attempts a where a.quiz_id = pg_temp.c('qn')::uuid and a.item_points is not null) then
    raise exception 'FAILED: the points kept with the attempts %',
      (select string_agg(coalesce(item_points::text, 'null'), ' ') from public.quiz_attempts);
  end if;
  perform pg_temp.expect_error(format('update public.quiz_attempts set item_points = %L where id = %L', '{1,1}', pg_temp.c('cw_att')),
    '23514', 'points that do not match the items');
  perform pg_temp.expect_error(format('update public.quiz_attempts set item_points = %L where id = %L', '{1,1,0}', pg_temp.c('cw_att')),
    '23514', 'a question worth 0');
  perform pg_temp.expect_error(format('update public.quiz_attempts set item_points = %L where id = %L', '{1,null,5}', pg_temp.c('cw_att')),
    '23514', 'a question worth null');
end
$t$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_results(pg_temp.c('qw')::uuid);
  if pg_temp.keys(pg_temp.find(r -> 'attempts', 'id', pg_temp.c('cw_att')))
       is distinct from 'answered,correct,deadline_at,finish_reason,finished_at,guest,id,max_score,n,name,own,person,score,started_at,total'
     or (pg_temp.find(r -> 'attempts', 'id', pg_temp.c('cw_att')) ->> 'score')::int is distinct from 5
     or (pg_temp.find(r -> 'attempts', 'id', pg_temp.c('cw_att')) ->> 'max_score')::int is distinct from 7
     or (pg_temp.find(r -> 'attempts', 'id', pg_temp.c('gw_att')) ->> 'score')::int is distinct from 1
     or (pg_temp.find(r -> 'attempts', 'id', pg_temp.c('gw_att')) ->> 'max_score')::int is distinct from 3 then
    raise exception 'FAILED: quiz_results with points %', r -> 'attempts';
  end if;
  -- avg_percent: (5/7 + 1/3) / 2 = 52.4 %
  if (pg_temp.find(public.quiz_list(pg_temp.c('w')::uuid), 'id', pg_temp.c('qw')) ->> 'avg_percent')::numeric is distinct from 52.4 then
    raise exception 'FAILED: quiz_list''s avg_percent with points %', pg_temp.find(public.quiz_list(pg_temp.c('w')::uuid), 'id', pg_temp.c('qw'));
  end if;
  -- QD (points 2, 1, 1, 3 left after d:5 went): C 6 of 7, guest 1 7 of 7, guest 2 0 of 7 → (85.71 + 100 + 0) / 3 = 61.9
  if (pg_temp.find(public.quiz_list(pg_temp.c('x')::uuid), 'id', pg_temp.c('qd')) ->> 'avg_percent')::numeric is distinct from 61.9 then
    raise exception 'FAILED: QD''s avg_percent %', pg_temp.find(public.quiz_list(pg_temp.c('x')::uuid), 'id', pg_temp.c('qd'));
  end if;
end
$t$;

-- 14. Deleting an exam takes its document with it.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
delete from public.containers where id = pg_temp.c('z')::uuid;
reset role;
do $t$
begin
  if exists (select 1 from public.test_docs where container_id = pg_temp.c('z')::uuid) then raise exception 'FAILED: a document outlived its exam'; end if;
end
$t$;
select 'TEST DOCS BEHAVIOUR PASSED';
rollback;
