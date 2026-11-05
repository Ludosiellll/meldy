-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261107090500_studio_pages.sql (the
-- studio's page holds every question of the exam) on the scratch database of studio_pages_run.sh. One transaction,
-- rolled back. The case file contracts/studio/test_doc_pages_cases.json comes in as the psql variable `pages`.
-- A = author aaaa…1: exam E of four subjects of 500 questions each (2000, the most an exam holds), exam F of 30 keyed
-- questions and 2 without a key; B = bbbb…2 and C = cccc…3, signed-in takers; guests are anon with tokens.
-- Covers: A saves E's page of 2100 blocks (the 2000 questions, a page break and a heading per subject, notes) through
-- test_doc_save and reads it back as sent (NOTICE: how long the save took); 2101 blocks are refused (22023 blocks) and
-- the page stays; the documents of the case file's «sizes» have octet_length(doc::text) as the file says, the one of
-- exactly 512 KB saves and one byte more is refused (22023 size), one past the old 200 KB saves; the table's own check
-- refuses a row past 512 KB written without test_doc_save; a quiz «как в студии» on E: quiz_doc_items gives all 2000
-- in the page's order, the preview says item_count (200), B's attempt holds 200 different questions of the page in its
-- order, some past the page's 200th, C's and a guest's attempts other samples; item_count 5 gives 5; F (a page of 32
-- blocks) is drawn whole as before, in its order, the questions without a key left out, whatever item_count says.
-- A failure raises; success prints STUDIO PAGES BEHAVIOUR PASSED.
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
create temp table pages_input (c jsonb not null);
insert into pages_input values (:'pages'::jsonb);
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = p_k
$fn$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into pg_temp.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
create or replace function pg_temp.tok(p_n integer) returns text language sql immutable as $fn$
  select 'pages-guest-token-' || lpad(p_n::text, 4, '0') || '-' || repeat('x', 20)
$fn$;
create or replace function pg_temp.theme() returns jsonb language sql immutable as $fn$
  select '{"accent": "blue", "background": {"kind": "plain"}, "font": "onest", "radius": "soft", "density": "airy", "answers": "list", "buttons": "pill"}'::jsonb
$fn$;
-- E's page: per subject a page break titled by it (none before the first), a heading and its 500 questions in exam
-- order; then p_notes notes.
create or replace function pg_temp.page_e(p_notes integer) returns jsonb language sql stable as $fn$
  with s as (select s.id, s.title, row_number() over (order by s.position, s.created_at, s.id) as n
               from public.container_subjects s where s.container_id = pg_temp.c('e')::uuid)
  select jsonb_build_object('v', 1, 'title', 'Итоговый экзамен', 'theme', pg_temp.theme(), 'layout', 'pages',
    'blocks', (select jsonb_agg(b order by o1, o2, o3) from (
                 select s.n as o1, 0 as o2, 0 as o3, jsonb_build_object('type', 'page', 'id', 'epage' || lpad(s.n::text, 7, '0'), 'title', s.title) as b
                   from s where s.n > 1
                 union all
                 select s.n, 1, 0, jsonb_build_object('type', 'heading', 'id', 'ehead' || lpad(s.n::text, 7, '0'), 'text', s.title, 'size', 'l')
                   from s
                 union all
                 select s.n, 2, i.position, jsonb_build_object('type', 'question', 'id', 'eq' || lpad((s.n * 100000 + i.position)::text, 10, '0'),
                                                               'item_id', i.id, 'points', 1, 'required', false)
                   from public.test_items i join s on s.id = i.subject_id
                 union all
                 select 9, 3, n, jsonb_build_object('type', 'note', 'id', 'enote' || lpad(n::text, 7, '0'), 'tone', 'info', 'text', 'Заметка ' || n)
                   from generate_series(1, p_notes) n) x),
    'results', '{"bands": [], "cta": null}'::jsonb)
$fn$;
-- A document of the case file's «sizes»: `texts` text blocks of 4000 «я», then one of `ya` «я» and `a` «a».
create or replace function pg_temp.size_doc(p jsonb) returns jsonb language sql immutable as $fn$
  select jsonb_build_object('v', 1, 'title', 'Размер', 'theme', pg_temp.theme(), 'layout', 'one_page',
    'blocks', (select jsonb_agg(b order by o) from (
                 select i as o, jsonb_build_object('type', 'text', 'id', 'size' || lpad(i::text, 6, '0'), 'text', repeat('я', 4000), 'align', 'left') as b
                   from generate_series(1, (p ->> 'texts')::integer) i
                 union all
                 select 1000000, jsonb_build_object('type', 'text', 'id', 'sizepad0',
                                                    'text', repeat('я', (p ->> 'ya')::integer) || repeat('a', (p ->> 'a')::integer), 'align', 'left')) x),
    'results', '{"bands": [], "cta": null}'::jsonb)
$fn$;
-- The places of an attempt's questions on E's page, counted from 1 (null for one that is not on it): E's page as A saved
-- it is kept in e_order (the takers cannot read test_docs).
create temp table e_order (item text primary key, o integer not null);
create or replace function pg_temp.places(p_items jsonb) returns integer[] language sql stable as $fn$
  select array_agg(e.o order by x.n)
    from jsonb_array_elements(p_items) with ordinality x(it, n)
    left join pg_temp.e_order e on e.item = x.it ->> 'id'
$fn$;
create or replace function pg_temp.check_sample(p_r jsonb, p_n integer, p_what text) returns void language plpgsql stable as $fn$
declare v_places integer[] := pg_temp.places(p_r -> 'items');
begin
  if jsonb_array_length(p_r -> 'items') is distinct from p_n then
    raise exception 'FAILED: % holds % questions, expected %', p_what, jsonb_array_length(p_r -> 'items'), p_n;
  end if;
  if array_position(v_places, null) is not null then raise exception 'FAILED: % has a question that is not on the page', p_what; end if;
  if (select count(distinct p) from unnest(v_places) p) <> p_n then raise exception 'FAILED: % repeats a question', p_what; end if;
  if exists (select 1 from generate_subscripts(v_places, 1) i where i > 1 and v_places[i] <= v_places[i - 1]) then
    raise exception 'FAILED: % is not in the page''s order', p_what;
  end if;
end;
$fn$;
grant all on ctx, pages_input, e_order to authenticated, anon, service_role;
grant execute on function pg_temp.expect_error(text, text, text, text), pg_temp.c(text), pg_temp.put(text, text), pg_temp.tok(integer),
  pg_temp.theme(), pg_temp.page_e(integer), pg_temp.size_doc(jsonb), pg_temp.places(jsonb), pg_temp.check_sample(jsonb, integer, text)
  to authenticated, anon, service_role;

-- 1. A: exam E (four subjects of 500) and exam F (30 keyed, 2 without a key).
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; v_s uuid; k integer; b integer;
begin
  r := public.container_create('Итоговый экзамен', null, '[{"title":"Анатомия"},{"title":"Физиология"},{"title":"Фармакология"},{"title":"Гигиена"}]');
  perform pg_temp.put('e', r ->> 'container_id');
  for k in 0..3 loop
    v_s := (r -> 'subjects' -> k ->> 'id')::uuid;
    for b in 0..1 loop
      perform public.container_items_add(v_s,
        (select jsonb_agg(jsonb_build_object('ref', 'e:' || k || ':' || i, 'stem', 'Вопрос ' || (k + 1) || '.' || i,
                                             'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(i % 2)) order by i)
           from generate_series(b * 250 + 1, b * 250 + 250) i));
    end loop;
  end loop;
  if (select count(*) from public.test_items i where i.container_id = pg_temp.c('e')::uuid) <> 2000 then
    raise exception 'FAILED: the 2000 questions of E';
  end if;
  r := public.container_create('Короткий тест', null, '[{"title":"Вопросы"}]');
  perform pg_temp.put('f', r ->> 'container_id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid,
    (select jsonb_agg(jsonb_build_object('ref', 'f:' || i, 'stem', 'Короткий ' || i, 'options', jsonb_build_array('а', 'б'),
                                         'correct', case when i <= 30 then jsonb_build_array(0) else '[]'::jsonb end) order by i)
       from generate_series(1, 32) i));
  perform pg_temp.put('f_keyed', (select string_agg(i.id::text, ',' order by i.position) from public.test_items i
                                   where i.container_id = pg_temp.c('f')::uuid and i.import_ref like 'f:%' and (i.correct <> '{}')));
end
$t$;

-- 2. E's page of 2100 blocks saved and read back; 2101 refused.
do $t$
declare r jsonb; d jsonb := pg_temp.page_e(93); v_at timestamptz;
begin
  if jsonb_array_length(d -> 'blocks') <> 2100 then raise exception 'FAILED: the page fixture has % blocks', jsonb_array_length(d -> 'blocks'); end if;
  v_at := clock_timestamp();
  r := public.test_doc_save(pg_temp.c('e')::uuid, d, 0);
  raise notice 'PAGES TIMING test_doc_save of 2100 blocks (2000 questions): % ms', round(extract(epoch from clock_timestamp() - v_at) * 1000);
  if (r ->> 'rev')::int is distinct from 1 then raise exception 'FAILED: the page of 2100 blocks %', r; end if;
  r := public.test_doc_get(pg_temp.c('e')::uuid);
  if r -> 'doc' is distinct from d then raise exception 'FAILED: the page read back is not the page sent'; end if;
  insert into pg_temp.e_order select b ->> 'item_id', o from jsonb_array_elements(r -> 'doc' -> 'blocks') with ordinality t(b, o) where b ->> 'type' = 'question';
  perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, 1)', pg_temp.c('e'),
            jsonb_set(d, '{blocks}', (d -> 'blocks') || '[{"type": "divider", "id": "onemore01"}]'::jsonb)), '22023', '2101 blocks', 'blocks');
  if (public.test_doc_get(pg_temp.c('e')::uuid) ->> 'rev')::int is distinct from 1 then raise exception 'FAILED: a refused page was stored'; end if;
end
$t$;

-- 3. The sizes of the case file: the bytes as the file says; 512 KB saves, one byte more does not.
do $t$
declare v_case jsonb; d jsonb; v_rev integer := 0; r jsonb; v_n integer := 0;
begin
  for v_case in select x from pg_temp.pages_input p, jsonb_array_elements(p.c -> 'sizes') x loop
    v_n := v_n + 1;
    d := pg_temp.size_doc(v_case);
    if v_case ->> 'bytes' is not null and octet_length(d::text) is distinct from (v_case ->> 'bytes')::integer then
      raise exception 'FAILED: % is % bytes, the file says %', v_case ->> 'name', octet_length(d::text), v_case ->> 'bytes';
    end if;
    if v_case ->> 'expect' is null then
      r := public.test_doc_save(pg_temp.c('f')::uuid, d, v_rev);
      v_rev := (r ->> 'rev')::integer;
      if (public.test_doc_get(pg_temp.c('f')::uuid) -> 'doc') is distinct from d then raise exception 'FAILED: % read back', v_case ->> 'name'; end if;
    else
      perform pg_temp.expect_error(format('select public.test_doc_save(%L, %L, %s)', pg_temp.c('f'), d, v_rev), '22023', v_case ->> 'name', v_case ->> 'expect');
    end if;
  end loop;
  if v_n < 3 or v_rev <> 2 then raise exception 'FAILED: the sizes of the case file (% of them, rev %)', v_n, v_rev; end if;
  perform pg_temp.put('rev_f', v_rev::text);
end
$t$;
-- the table's own check, past test_doc_save
reset role;
do $t$
declare v_before integer := (select octet_length(d.doc::text) from public.test_docs d where d.container_id = pg_temp.c('f')::uuid);
begin
  perform pg_temp.expect_error(format('update public.test_docs set doc = %L where container_id = %L',
            pg_temp.size_doc((select x from pg_temp.pages_input p, jsonb_array_elements(p.c -> 'sizes') x where x ->> 'expect' = 'size' limit 1)),
            pg_temp.c('f')), '23514', 'a row past 512 KB written directly');
  if (select octet_length(d.doc::text) from public.test_docs d where d.container_id = pg_temp.c('f')::uuid) is distinct from v_before then
    raise exception 'FAILED: the stored page changed';
  end if;
  -- the pool of a design quiz: the whole page of E, in its order
  if cardinality(meldy_private.quiz_doc_items(pg_temp.c('e')::uuid)) <> 2000
     or (meldy_private.quiz_doc_items(pg_temp.c('e')::uuid))[2000] is distinct from
        (select (d.doc -> 'blocks' -> 2006 ->> 'item_id')::uuid from public.test_docs d where d.container_id = pg_temp.c('e')::uuid) then
    raise exception 'FAILED: quiz_doc_items of a page of 2000 questions';
  end if;
end
$t$;

-- 4. Quizzes «как в студии» on E (2000 questions) and on F (30 keyed of 32).
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; d jsonb;
begin
  r := public.quiz_create(pg_temp.c('e')::uuid, '{"title": "Итоговый, 200 вопросов", "design": true, "item_count": 200}');
  perform pg_temp.put('code_e', r ->> 'code');
  if (public.quiz_preview(r ->> 'code') ->> 'item_count')::int is distinct from 200 then
    raise exception 'FAILED: the preview of 2000 questions, 200 a time: %', public.quiz_preview(r ->> 'code') ->> 'item_count';
  end if;
  r := public.quiz_create(pg_temp.c('e')::uuid, '{"title": "Итоговый, пять", "design": true, "item_count": 5}');
  perform pg_temp.put('code_e5', r ->> 'code');
  if (public.quiz_preview(r ->> 'code') ->> 'item_count')::int is distinct from 5 then
    raise exception 'FAILED: the preview of five: %', public.quiz_preview(r ->> 'code') ->> 'item_count';
  end if;
  -- F: a page of its 32 questions (two without a key)
  d := jsonb_build_object('v', 1, 'title', 'Короткий тест', 'theme', pg_temp.theme(), 'layout', 'one_by_one',
    'blocks', (select jsonb_agg(jsonb_build_object('type', 'question', 'id', 'fq' || lpad(i.position::text, 8, '0'), 'item_id', i.id,
                                                   'points', 1, 'required', false) order by i.position)
                 from public.test_items i where i.container_id = pg_temp.c('f')::uuid),
    'results', '{"bands": [], "cta": null}'::jsonb);
  r := public.test_doc_save(pg_temp.c('f')::uuid, d, pg_temp.c('rev_f')::integer);
  r := public.quiz_create(pg_temp.c('f')::uuid, '{"title": "Короткий", "design": true, "item_count": 5}');
  perform pg_temp.put('code_f', r ->> 'code');
  if (public.quiz_preview(r ->> 'code') ->> 'item_count')::int is distinct from 30 then
    raise exception 'FAILED: a page of 30 keyed questions is drawn whole: %', public.quiz_preview(r ->> 'code') ->> 'item_count';
  end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare r jsonb; v_places integer[];
begin
  r := public.quiz_start(pg_temp.c('code_e'), 'Вера');
  perform pg_temp.check_sample(r, 200, 'B''s attempt of 200');
  v_places := pg_temp.places(r -> 'items');
  -- the page's 200th question is its block 201 (a heading first; places count from 1): a sample of 200 out of 2000 reaches past it
  if v_places[200] <= 201 then raise exception 'FAILED: B''s attempt holds only the first 200 questions of the page'; end if;
  perform pg_temp.put('b_items', (r -> 'items')::text);
  r := public.quiz_start(pg_temp.c('code_e5'), 'Вера');
  perform pg_temp.check_sample(r, 5, 'B''s attempt of five');
  r := public.quiz_start(pg_temp.c('code_f'), 'Вера');
  if jsonb_array_length(r -> 'items') <> 30
     or (select string_agg(x ->> 'id', ',' order by n) from jsonb_array_elements(r -> 'items') with ordinality t(x, n))
        is distinct from pg_temp.c('f_keyed') then
    raise exception 'FAILED: F''s attempt is not its 30 keyed questions in order: %', jsonb_array_length(r -> 'items');
  end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_start(pg_temp.c('code_e'), 'Ольга');
  perform pg_temp.check_sample(r, 200, 'C''s attempt of 200');
  if (select array_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(r -> 'items') x)
     = (select array_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(pg_temp.c('b_items')::jsonb) x) then
    raise exception 'FAILED: C drew the same 200 as B';
  end if;
end
$t$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_guest_start(pg_temp.c('code_e'), 'Гость', pg_temp.tok(1));
  perform pg_temp.check_sample(r, 200, 'a guest''s attempt of 200');
  if r -> 'design' -> 'blocks' -> 2006 ->> 'type' is distinct from 'question' or jsonb_array_length(r -> 'design' -> 'blocks') <> 2100 then
    raise exception 'FAILED: the attempt carries the whole page as its design';
  end if;
end
$t$;
reset role;
select 'STUDIO PAGES BEHAVIOUR PASSED';
rollback;
