-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261016120000_quizzes.sql
-- (+ 20261016140000_quiz_result_order.sql)
-- («Контрольная») on the scratch database of quizzes_run.sh. One transaction, rolled back. A = author aaaa…1,
-- B = bbbb…2 (becomes a member of exam K1 half way), C = stranger cccc…3 (the participant), D = dddd…4 (3000 filler
-- attempts), E = eeee…5 (no attempt anywhere).
-- now() is one moment inside a transaction, so time passes by moving started_at / deadline_at / closes_at back as
-- postgres. Covers the plan's Task 1 Step 1 and the five Review Focus points the database can show: resume after a
-- reload (same attempt, items, order, answers, deadline); a key change by container_item_update changes the result for
-- the author and the participant; an answer 10 s after the deadline is saved, 30 s after → MC012; a second start while
-- an attempt is open returns that attempt (the two-tabs race itself: quizzes_run.sh); the author's own attempt has
-- own = true and stays out of the question stats and quiz_list's averages. A failure raises; success prints
-- QUIZ CHECKS PASSED.
-- Release 47 (20261018100000_test_builder.sql) adds keys to QuizRow, the preview, the attempt rows of quiz_results, the
-- result and its items, and gives a signed-out visitor of a quiz with guests a guest «me». pg_temp.r47() tells which
-- release is applied, and the pins take that release's shape: the same flows run on 46.1 (quizzes_run.sh, and
-- test_builder_run.sh before the migration and after its rollback) and on 47 (test_builder_run.sh).
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
-- the sorted key set of a JSON object (pins the contract's field names). Release 47.1 (20261019100000_test_docs.sql)
-- adds «design» to QuizRow, the preview, the attempt and the result, and «band» to the result; test_docs_behaviour.sql
-- pins those shapes, so once it is applied the pins here leave the two keys out (before it, they must not be there).
create or replace function pg_temp.keys(p jsonb) returns text language sql stable as $fn$
  select string_agg(k, ',' order by k) from jsonb_object_keys(p) k
   where not (k in ('design', 'band') and to_regclass('public.test_docs') is not null)
$fn$;
-- release 47 applied (its guest functions exist)
create or replace function pg_temp.r47() returns boolean language sql stable as $fn$
  select to_regprocedure('public.quiz_guest_start(text,text,text)') is not null
$fn$;
-- a pinned key list: the 46.1 one, or the 47 one when release 47 is applied
create or replace function pg_temp.pin(p_46 text, p_47 text) returns text language sql stable as $fn$
  select case when pg_temp.r47() then p_47 else p_46 end
$fn$;
create or replace function pg_temp.item(p_ref text) returns uuid language sql stable as $fn$
  select v::uuid from pg_temp.ctx where k = 'item:' || p_ref
$fn$;
create or replace function pg_temp.ref(p_id text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = 'ref:' || p_id
$fn$;
-- the element of a JSON array whose p_key equals p_val
create or replace function pg_temp.find(p_list jsonb, p_key text, p_val text) returns jsonb language sql immutable as $fn$
  select x from jsonb_array_elements(p_list) x where x ->> p_key = p_val limit 1
$fn$;
-- a quiz_answer element for an item: the right answer (as A wrote it into ctx) or a wrong one
create or replace function pg_temp.answer(p_id text, p_right boolean) returns jsonb language sql stable as $fn$
  select jsonb_build_object('item_id', p_id) || (select v::jsonb from pg_temp.ctx
                                                   where k = case when p_right then 'ans:' else 'bad:' end || p_id)
$fn$;
grant all on ctx to authenticated, anon;
grant execute on function pg_temp.expect_error(text, text, text, text), pg_temp.c(text), pg_temp.put(text, text),
  pg_temp.keys(jsonb), pg_temp.item(text), pg_temp.ref(text), pg_temp.find(jsonb, text, text), pg_temp.answer(text, boolean),
  pg_temp.r47(), pg_temp.pin(text, text)
  to authenticated, anon;

-- 1. A: exam K1 (three subjects: 4 + 1 unkeyed, 3, 1 unkeyed), the defaults, the clamp, every refusal of a setting,
--    no_questions, MC010 at 51, the main quiz Q1 (all 7 questions in exam order, 10 min, 2 attempts, pass 50 %).
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare
  r jsonb; v_k1 uuid; v_k2 uuid; v_k3 uuid; s1 uuid; s2 uuid; s3 uuid; v_pic text; v_bad record;
  d date := (now() at time zone 'utc')::date;
  v_row_keys constant text := pg_temp.pin(
    'allow_back,attempts,closed_at,closes_at,code,container_id,created_at,grading,id,item_count,'
    'members_only,opens_at,pass_percent,review,same_set,shuffle_items,shuffle_options,started,state,subject_ids,'
    'time_limit_s,title,updated_at',
    'accent,allow_back,attempts,closed_at,closes_at,code,container_id,cover_path,created_at,grading,guests,id,item_count,'
    'members_only,offer_practice,opens_at,pass_percent,review,same_set,shuffle_items,shuffle_options,started,state,subject_ids,'
    'time_limit_s,title,updated_at');
begin
  r := public.container_create('Контрольная проверка', d + 10, jsonb_build_array(jsonb_build_object('title', 'Алгоритмы'),
         jsonb_build_object('title', 'Сети'), jsonb_build_object('title', 'Без ключей')));
  v_k1 := (r ->> 'container_id')::uuid;
  s1 := (r -> 'subjects' -> 0 ->> 'id')::uuid;
  s2 := (r -> 'subjects' -> 1 ->> 'id')::uuid;
  s3 := (r -> 'subjects' -> 2 ->> 'id')::uuid;
  v_pic := v_k1::text || '/' || repeat('c4', 32) || '.png';
  perform public.container_items_add(s1, jsonb_build_array(
    jsonb_build_object('ref', 'q:11', 'stem', 'Сколько будет 2+2?', 'options', jsonb_build_array('3', '4', '5'),
                       'correct', jsonb_build_array(1), 'images', jsonb_build_object('stem', jsonb_build_array(v_pic))),
    jsonb_build_object('ref', 'q:12', 'stem', 'Чётные числа', 'options', jsonb_build_array('1', '2', '3', '4'), 'correct', jsonb_build_array(1, 3)),
    jsonb_build_object('ref', 'q:13', 'stem', 'Столица Франции', 'answers', jsonb_build_array('Париж')),
    jsonb_build_object('ref', 'q:14', 'stem', 'Цвет неба', 'options', jsonb_build_array('синий', 'зелёный'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'q:15', 'stem', 'Без ключа', 'options', jsonb_build_array('а', 'б'), 'correct', '[]'::jsonb)));
  perform public.container_items_add(s2, jsonb_build_array(
    jsonb_build_object('ref', 'q:21', 'stem', 'TCP', 'options', jsonb_build_array('надёжный', 'ненадёжный'), 'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'q:22', 'stem', 'UDP', 'options', jsonb_build_array('надёжный', 'ненадёжный'), 'correct', jsonb_build_array(1)),
    jsonb_build_object('ref', 'q:23', 'stem', 'Порт HTTP', 'answers', jsonb_build_array('80'))));
  perform public.container_items_add(s3, jsonb_build_array(
    jsonb_build_object('ref', 'q:31', 'stem', 'Тоже без ключа', 'options', jsonb_build_array('а', 'б'), 'correct', '[]'::jsonb)));
  perform pg_temp.put('k1', v_k1::text);
  perform pg_temp.put('s1', s1::text);
  perform pg_temp.put('s2', s2::text);
  perform pg_temp.put('pic', v_pic);
  insert into pg_temp.ctx
  select 'item:' || i.import_ref, i.id::text from public.test_items i where i.container_id = v_k1
  union all
  select 'ref:' || i.id, i.import_ref from public.test_items i where i.container_id = v_k1
  union all
  select 'rank:' || i.id, (row_number() over (order by s.position, i.position))::text
    from public.test_items i join public.container_subjects s on s.id = i.subject_id where i.container_id = v_k1 and i.keyed
  union all
  select 'ans:' || i.id, case when i.kind = 'short' then jsonb_build_object('text', i.answers[1])
                              else jsonb_build_object('chosen', to_jsonb(i.correct)) end::text
    from public.test_items i where i.container_id = v_k1 and i.keyed
  union all
  select 'bad:' || i.id, case when i.kind = 'short' then '{"text": "неверно"}'::jsonb
                              else jsonb_build_object('chosen', jsonb_build_array((select min(g) from generate_series(0, jsonb_array_length(i.options) - 1) g
                                                                                    where g <> all (i.correct)))) end::text
    from public.test_items i where i.container_id = v_k1 and i.keyed;

  -- K2: one unkeyed question only → nothing to draw
  r := public.container_create('Без ключей', d + 10, jsonb_build_array(jsonb_build_object('title', 'Пусто')));
  v_k2 := (r ->> 'container_id')::uuid;
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'e:1', 'stem', 'Нет ключа', 'options', jsonb_build_array('а', 'б'), 'correct', '[]'::jsonb)));
  perform pg_temp.expect_error(format('select public.quiz_create(%L, %L)', v_k2, '{}'), 'MC013', 'an exam without keyed questions', 'no_questions');
  perform pg_temp.expect_error(format('select public.quiz_create(%L, %L)', v_k2, jsonb_build_object('subject_ids', jsonb_build_array(s1))),
    '22023', 'a subject of another exam', 'subject_ids');

  -- the defaults: every subject with keyed questions (not «Без ключей»), least(20, pool) = 7, the rest of the table
  r := public.quiz_create(v_k1, '{}'::jsonb);
  if pg_temp.keys(r) is distinct from v_row_keys then raise exception 'FAILED: QuizRow keys %', pg_temp.keys(r); end if;
  if r ->> 'code' !~ '^[0-9a-hjkmnp-tv-z]{12}$' or r ->> 'title' !~ '^Контрольная · \d\d\.\d\d$'
     or r -> 'subject_ids' is distinct from jsonb_build_array(s1, s2) or (r ->> 'item_count')::int is distinct from 7
     or (r ->> 'same_set')::boolean or not (r ->> 'shuffle_items')::boolean or not (r ->> 'shuffle_options')::boolean
     or r -> 'time_limit_s' is distinct from 'null'::jsonb or r -> 'opens_at' is distinct from 'null'::jsonb
     or r -> 'closes_at' is distinct from 'null'::jsonb or r -> 'closed_at' is distinct from 'null'::jsonb
     or (r ->> 'attempts')::int is distinct from 1 or r ->> 'grading' is distinct from 'best' or not (r ->> 'allow_back')::boolean
     or r -> 'pass_percent' is distinct from 'null'::jsonb or r ->> 'review' is distinct from 'mistakes_then_answers'
     or (r ->> 'members_only')::boolean or r ->> 'state' is distinct from 'open' or (r ->> 'started')::boolean
     or r ->> 'container_id' is distinct from v_k1::text then
    raise exception 'FAILED: defaults %', r;
  end if;
  perform pg_temp.put('q0', r ->> 'id');
  -- the clamp to the pool
  r := public.quiz_create(v_k1, '{"item_count": 150}');
  if (r ->> 'item_count')::int is distinct from 7 then raise exception 'FAILED: clamp %', r; end if;
  -- refusals: 22023 with the key in detail
  for v_bad in select * from (values
      ('{"item_count": 0}', 'item_count'), ('{"item_count": 201}', 'item_count'), ('{"item_count": "20"}', 'item_count'),
      ('{"item_count": 2.5}', 'item_count'), ('{"grading": "avg"}', 'grading'), ('{"time_limit_min": 0}', 'time_limit_min'),
      ('{"time_limit_min": 241}', 'time_limit_min'), ('{"subject_ids": []}', 'subject_ids'), ('{"subject_ids": ["x"]}', 'subject_ids'),
      ('{"subject_ids": "' || s1 || '"}', 'subject_ids'),
      ('{"opens_at": "2026-10-20T10:00:00Z", "closes_at": "2026-10-20T09:00:00Z"}', 'closes_at'),
      ('{"opens_at": "завтра"}', 'opens_at'), ('{"closes_at": "now"}', 'closes_at'), ('{"attempts": 0}', 'attempts'),
      ('{"attempts": 51}', 'attempts'), ('{"review": "all"}', 'review'), ('{"title": "  "}', 'title'),
      ('{"title": "' || repeat('я', 121) || '"}', 'title'), ('{"title": null}', 'title'), ('[]', 'settings'),
      ('{"pass_percent": 0}', 'pass_percent'), ('{"pass_percent": 101}', 'pass_percent'), ('{"same_set": "yes"}', 'same_set'),
      ('{"shuffle_items": 1}', 'shuffle_items'), ('{"shuffle_options": null}', 'shuffle_options'),
      ('{"allow_back": null}', 'allow_back'), ('{"members_only": 1}', 'members_only')) b(settings, detail) loop
    perform pg_temp.expect_error(format('select public.quiz_create(%L, %L)', v_k1, v_bad.settings), '22023', 'create ' || v_bad.settings, v_bad.detail);
  end loop;
  perform pg_temp.expect_error(format('select public.quiz_create(%L, %L)', v_k1, jsonb_build_object('subject_ids', jsonb_build_array(s3))),
    'MC013', 'only a subject without keys', 'no_questions');
  perform pg_temp.expect_error(format('select public.quiz_create(%L, %L)', '99999999-0000-0000-0000-000000000009', '{}'), 'P0002', 'no such exam');
  -- time_limit_min → time_limit_s, nullable settings take null
  r := public.quiz_create(v_k1, '{"time_limit_min": 45, "attempts": null, "pass_percent": null, "opens_at": null, "closes_at": null}');
  if (r ->> 'time_limit_s')::int is distinct from 2700 or r -> 'attempts' is distinct from 'null'::jsonb then
    raise exception 'FAILED: minutes into seconds, null attempts %', r;
  end if;

  -- MC010: 50 quizzes per exam, the 51st refused
  r := public.container_create('Пятьдесят', d + 10, jsonb_build_array(jsonb_build_object('title', 'Один')));
  v_k3 := (r ->> 'container_id')::uuid;
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'f:1', 'stem', 'Один вопрос', 'options', jsonb_build_array('а', 'б'), 'correct', jsonb_build_array(0))));
  for i in 1..50 loop
    perform public.quiz_create(v_k3, jsonb_build_object('title', 'Контрольная ' || i));
  end loop;
  perform pg_temp.expect_error(format('select public.quiz_create(%L, %L)', v_k3, '{}'), 'MC010', 'the 51st quiz');

  -- Q1: the subjects given in another order are kept in exam order; all 7 questions, exam order, 10 minutes
  r := public.quiz_create(v_k1, jsonb_build_object('title', 'Контрольная 1', 'subject_ids', jsonb_build_array(s2, s1), 'item_count', 7,
         'shuffle_items', false, 'time_limit_min', 10, 'closes_at', now() + interval '7 days', 'attempts', 2, 'pass_percent', 50));
  if r -> 'subject_ids' is distinct from jsonb_build_array(s1, s2) or (r ->> 'time_limit_s')::int is distinct from 600
     or (r ->> 'closes_at')::timestamptz is distinct from now() + interval '7 days' or (r ->> 'attempts')::int is distinct from 2
     or (r ->> 'pass_percent')::int is distinct from 50 or (r ->> 'shuffle_items')::boolean then
    raise exception 'FAILED: Q1 %', r;
  end if;
  perform pg_temp.put('q1', r ->> 'id');
  perform pg_temp.put('code1', r ->> 'code');
end
$t$;

-- 2. The picture of q:11 in the bucket (as the editor's upload would put it).
reset role;
insert into storage.objects (bucket_id, name) values ('test-item-images', pg_temp.c('pic'));

-- 3. Anon: the preview without a key; nothing else runs.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_preview(pg_temp.c('code1'));
  if pg_temp.keys(r) is distinct from pg_temp.pin(
       'allow_back,attempts,author_name,closes_at,exam_title,grading,item_count,me,members_only,'
       'opens_at,pass_percent,review,server_now,status,time_limit_s,title',
       'accent,allow_back,attempts,author_name,closes_at,cover_path,exam_title,grading,guests,item_count,me,members_only,'
       'offer_practice,opens_at,pass_percent,review,server_now,status,time_limit_s,title') then
    raise exception 'FAILED: preview keys %', pg_temp.keys(r);
  end if;
  -- 46.1: no «me» signed out; 47: a quiz takes guests by default, so a signed-out visitor gets a guest «me» (no attempt)
  if r ->> 'status' is distinct from 'open' or position('"correct"' in r::text) > 0
     or (not pg_temp.r47() and r -> 'me' is distinct from 'null'::jsonb)
     or (pg_temp.r47() and (r -> 'me' ->> 'guest' is distinct from 'true' or (r -> 'me' ->> 'attempts_used')::int is distinct from 0
                            or not (r ->> 'guests')::boolean))
     or position('Париж' in r::text) > 0 or (r ->> 'item_count')::int is distinct from 7 or r ->> 'title' is distinct from 'Контрольная 1'
     or r ->> 'exam_title' is distinct from 'Контрольная проверка' or r ->> 'author_name' is distinct from 'Автор А'
     or (r ->> 'time_limit_s')::int is distinct from 600 or (r ->> 'attempts')::int is distinct from 2
     or r ->> 'grading' is distinct from 'best' or not (r ->> 'allow_back')::boolean or (r ->> 'pass_percent')::int is distinct from 50
     or r ->> 'review' is distinct from 'mistakes_then_answers' or (r ->> 'members_only')::boolean
     or (r ->> 'server_now')::timestamptz is distinct from now() or r -> 'opens_at' is distinct from 'null'::jsonb
     or (r ->> 'closes_at')::timestamptz is distinct from now() + interval '7 days' then
    raise exception 'FAILED: anon preview %', r;
  end if;
  if public.quiz_preview('zzzzzzzzzzzz') is distinct from '{"status": "not_found"}'::jsonb
     or public.quiz_preview('нет такого') is distinct from '{"status": "not_found"}'::jsonb
     or public.quiz_preview(null) is distinct from '{"status": "not_found"}'::jsonb then
    raise exception 'FAILED: not_found carries only the status';
  end if;
  perform pg_temp.expect_error(format('select public.quiz_start(%L, %L)', pg_temp.c('code1'), 'Аноним'), '42501', 'anon starts');
  perform pg_temp.expect_error(format('select public.quiz_list(%L)', pg_temp.c('k1')), '42501', 'anon lists');
  perform pg_temp.expect_error('select public.my_quiz_container_ids()', '42501', 'anon runs the storage helper');
end
$t$;

-- 4. C, a stranger: the preview, the author's functions refused, the start (no key; exam order; deadline = start + 10
--    min), pictures readable only after the start, resume, answers (valid, invalid, not in the attempt, emptied).
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb; r2 jsonb; v_att text; v_sql text; v_x jsonb; v_prev int := 0; v_refs text;
begin
  r := public.quiz_preview(pg_temp.c('code1'));
  if pg_temp.keys(r -> 'me') is distinct from 'attempts_used,can_start,is_author,is_member,name_hint,open_attempt,reason,results' then
    raise exception 'FAILED: me keys %', pg_temp.keys(r -> 'me');
  end if;
  if r -> 'me' ->> 'name_hint' is distinct from 'Вера' or (r -> 'me' ->> 'is_author')::boolean or (r -> 'me' ->> 'is_member')::boolean
     or (r -> 'me' ->> 'attempts_used')::int is distinct from 0 or r -> 'me' -> 'open_attempt' is distinct from 'null'::jsonb
     or not (r -> 'me' ->> 'can_start')::boolean or r -> 'me' -> 'reason' is distinct from 'null'::jsonb
     or r -> 'me' -> 'results' is distinct from '[]'::jsonb or position('"correct"' in r::text) > 0 then
    raise exception 'FAILED: a stranger''s preview %', r;
  end if;
  -- the author's functions: P0002 for anyone else
  foreach v_sql in array array[
      format('select public.quiz_results(%L)', pg_temp.c('q1')), format('select public.quiz_update(%L, %L)', pg_temp.c('q1'), '{"title": "Моя"}'),
      format('select public.quiz_close(%L)', pg_temp.c('q1')), format('select public.quiz_delete(%L)', pg_temp.c('q1')),
      format('select public.quiz_marks(%L)', pg_temp.c('q1')), format('select public.quiz_list(%L)', pg_temp.c('k1')),
      format('select public.quiz_create(%L, %L)', pg_temp.c('k1'), '{}')] loop
    perform pg_temp.expect_error(v_sql, 'P0002', 'a stranger: ' || v_sql);
  end loop;
  -- no pictures of the exam before a start
  if (select count(*) from storage.objects where bucket_id = 'test-item-images') <> 0 then
    raise exception 'FAILED: a stranger reads the pictures before a start';
  end if;
  -- the name; an unknown code
  perform pg_temp.expect_error(format('select public.quiz_start(%L, %L)', pg_temp.c('code1'), '   '), '22023', 'an empty name', 'name');
  perform pg_temp.expect_error(format('select public.quiz_start(%L, %L)', pg_temp.c('code1'), ' В '), '22023', 'a one-letter name', 'name');
  perform pg_temp.expect_error(format('select public.quiz_start(%L, %L)', pg_temp.c('code1'), repeat('я', 81)), '22023', 'a long name', 'name');
  perform pg_temp.expect_error(format('select public.quiz_start(%L, %L)', 'zzzzzzzzzzzz', 'Вера'), 'P0002', 'an unknown code');
  perform pg_temp.expect_error(format('select public.quiz_start(%L, %L)', 'нет', 'Вера'), 'P0002', 'a malformed code');

  -- the start
  r := public.quiz_start(pg_temp.c('code1'), '  Вера С.  ');
  if pg_temp.keys(r) is distinct from 'allow_back,answers,attempt_id,deadline_at,items,n,quiz_title,server_now,shuffle_options,started_at' then
    raise exception 'FAILED: Attempt keys %', pg_temp.keys(r);
  end if;
  if (r ->> 'n')::int is distinct from 1 or r ->> 'quiz_title' is distinct from 'Контрольная 1' or jsonb_array_length(r -> 'items') <> 7
     or r -> 'answers' is distinct from '[]'::jsonb or not (r ->> 'allow_back')::boolean or not (r ->> 'shuffle_options')::boolean
     or (r ->> 'deadline_at')::timestamptz - (r ->> 'started_at')::timestamptz is distinct from interval '10 minutes'
     or (r ->> 'server_now')::timestamptz is distinct from now() then
    raise exception 'FAILED: start %', r;
  end if;
  -- no key anywhere: not the field, not an accepted short form
  if position('"correct"' in r::text) > 0 or position('Париж' in r::text) > 0 or position('"80"' in r::text) > 0
     or exists (select 1 from jsonb_array_elements(r -> 'items') x
                 where pg_temp.keys(x) is distinct from 'code,id,images,keep_order,kind,options,stem') then
    raise exception 'FAILED: the key left the server %', r;
  end if;
  select string_agg(pg_temp.ref(x ->> 'id'), ' ' order by o) into v_refs from jsonb_array_elements(r -> 'items') with ordinality y(x, o);
  if v_refs is distinct from 'q:11 q:12 q:13 q:14 q:21 q:22 q:23' then raise exception 'FAILED: exam order %', v_refs; end if;
  if pg_temp.find(r -> 'items', 'id', pg_temp.item('q:11')::text) -> 'images' -> 'stem' ->> 0 is distinct from pg_temp.c('pic') then
    raise exception 'FAILED: the picture path %', r -> 'items' -> 0;
  end if;
  v_att := r ->> 'attempt_id';
  perform pg_temp.put('att1', v_att);
  perform pg_temp.put('att1_deadline', r ->> 'deadline_at');
  -- the pictures of the exam are readable now
  if (select count(*) from storage.objects where bucket_id = 'test-item-images') <> 1 then
    raise exception 'FAILED: a taker cannot read the picture after the start';
  end if;
  -- reload: the same attempt (the name of the new call ignored)
  r2 := public.quiz_start(pg_temp.c('code1'), 'Другое имя');
  if r2 ->> 'attempt_id' is distinct from v_att or r2 -> 'items' is distinct from r -> 'items' or r2 ->> 'n' is distinct from '1'
     or r2 ->> 'started_at' is distinct from r ->> 'started_at' or r2 ->> 'deadline_at' is distinct from r ->> 'deadline_at' then
    raise exception 'FAILED: resume %', r2;
  end if;

  -- answers: right on q:11 (key 1 for now), q:12 (any order), q:13 (case and spaces), q:21; wrong on q:14, q:23
  r := public.quiz_answer(v_att::uuid, jsonb_build_array(
         jsonb_build_object('item_id', pg_temp.item('q:11'), 'chosen', jsonb_build_array(1)),
         jsonb_build_object('item_id', pg_temp.item('q:12'), 'chosen', jsonb_build_array(3, 1)),
         jsonb_build_object('item_id', pg_temp.item('q:13'), 'text', ' париж '),
         jsonb_build_object('item_id', pg_temp.item('q:14'), 'chosen', jsonb_build_array(1)),
         jsonb_build_object('item_id', pg_temp.item('q:21'), 'chosen', jsonb_build_array(0)),
         jsonb_build_object('item_id', pg_temp.item('q:22'), 'chosen', jsonb_build_array(1)),
         jsonb_build_object('item_id', pg_temp.item('q:23'), 'text', '8080')));
  if pg_temp.keys(r) is distinct from 'deadline_at,saved,server_now' or (r ->> 'saved')::int is distinct from 7
     or r ->> 'deadline_at' is distinct from pg_temp.c('att1_deadline') or (r ->> 'server_now')::timestamptz is distinct from now() then
    raise exception 'FAILED: answer %', r;
  end if;
  -- an empty choice and an empty text delete the answer; q:23 sent again
  r := public.quiz_answer(v_att::uuid, jsonb_build_array(
         jsonb_build_object('item_id', pg_temp.item('q:22'), 'chosen', '[]'::jsonb),
         jsonb_build_object('item_id', pg_temp.item('q:23'), 'text', '   ')));
  r := public.quiz_start(pg_temp.c('code1'), 'Вера С.');
  if jsonb_array_length(r -> 'answers') <> 5 or pg_temp.find(r -> 'answers', 'item_id', pg_temp.item('q:22')::text) is not null
     or pg_temp.find(r -> 'answers', 'item_id', pg_temp.item('q:23')::text) is not null then
    raise exception 'FAILED: emptied answers %', r -> 'answers';
  end if;
  perform public.quiz_answer(v_att::uuid, jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('q:23'), 'text', '8080')));
  -- refusals: invalid by grade_answer, not in the attempt, the shape of p_answers; nothing of a refused call is kept
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', v_att,
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('q:11'), 'chosen', jsonb_build_array(7)))), '22023', 'an option out of range', 'chosen');
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', v_att,
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('q:11'), 'chosen', jsonb_build_array(0, 1)))), '22023', 'two options on a single', 'chosen');
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', v_att,
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('q:12'), 'chosen', jsonb_build_array('a')))), '22023', 'a letter', 'chosen');
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', v_att,
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('q:13'), 'text', repeat('я', 201)))), '22023', 'a long text', 'text');
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', v_att,
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('q:21'), 'chosen', jsonb_build_array(1)),
                      jsonb_build_object('item_id', pg_temp.item('q:15'), 'chosen', jsonb_build_array(0)))), '22023', 'an item outside the attempt', 'item');
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', v_att,
    jsonb_build_array(jsonb_build_object('item_id', '99999999-0000-0000-0000-000000000009', 'chosen', jsonb_build_array(0)))), '22023', 'no such item', 'item');
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', v_att, '[{"item_id": "x", "chosen": [0]}]'), '22023', 'a bad item id', 'item');
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', v_att, '["x"]'), '22023', 'not an object', 'item');
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', v_att, '[]'), '22023', 'no answers', 'answers');
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', v_att, '{}'), '22023', 'not an array', 'answers');
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', v_att,
    (select jsonb_agg(jsonb_build_object('item_id', pg_temp.item('q:21'), 'chosen', jsonb_build_array(0))) from generate_series(1, 201))),
    '22023', '201 answers', 'answers');
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', '99999999-0000-0000-0000-000000000009', '[]'), 'P0002', 'no such attempt');
  -- after the reload: six answers back, as sent (choices in file order, the text as typed)
  r := public.quiz_start(pg_temp.c('code1'), 'Вера С.');
  if jsonb_array_length(r -> 'answers') <> 6
     or pg_temp.find(r -> 'answers', 'item_id', pg_temp.item('q:12')::text) is distinct from
        jsonb_build_object('item_id', pg_temp.item('q:12'), 'chosen', jsonb_build_array(1, 3), 'text', null)
     or pg_temp.find(r -> 'answers', 'item_id', pg_temp.item('q:13')::text) is distinct from
        jsonb_build_object('item_id', pg_temp.item('q:13'), 'chosen', null, 'text', ' париж ')
     or pg_temp.find(r -> 'answers', 'item_id', pg_temp.item('q:21')::text) -> 'chosen' is distinct from '[0]'::jsonb then
    raise exception 'FAILED: answers after a reload %', r -> 'answers';
  end if;
  -- the preview knows the open attempt
  r := public.quiz_preview(pg_temp.c('code1'));
  if r -> 'me' ->> 'open_attempt' is distinct from v_att or (r -> 'me' ->> 'attempts_used')::int is distinct from 1
     or not (r -> 'me' ->> 'can_start')::boolean or r -> 'me' -> 'reason' is distinct from 'null'::jsonb then
    raise exception 'FAILED: preview with an open attempt %', r -> 'me';
  end if;
end
$t$;

-- 5. A while C writes: the results (live), the key change, the marks, a person's answers, the locked settings.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; a jsonb; it jsonb; v_bad record;
begin
  r := public.quiz_results(pg_temp.c('q1')::uuid);
  if pg_temp.keys(r) is distinct from 'attempts,items,quiz,server_now' or not (r -> 'quiz' ->> 'started')::boolean
     or jsonb_array_length(r -> 'attempts') <> 1 or (r ->> 'server_now')::timestamptz is distinct from now() then
    raise exception 'FAILED: results %', r;
  end if;
  a := r -> 'attempts' -> 0;
  if pg_temp.keys(a) is distinct from pg_temp.pin(
       'answered,correct,deadline_at,finish_reason,finished_at,id,n,name,own,person,started_at,total',
       'answered,correct,deadline_at,finish_reason,finished_at,guest,id,n,name,own,person,started_at,total')
     or (pg_temp.r47() and (a ->> 'guest')::boolean) then
    raise exception 'FAILED: attempt row keys %', pg_temp.keys(a);
  end if;
  if a ->> 'id' is distinct from pg_temp.c('att1') or a ->> 'name' is distinct from 'Вера С.' or (a ->> 'own')::boolean
     or (a ->> 'n')::int is distinct from 1 or a -> 'finished_at' is distinct from 'null'::jsonb or a -> 'finish_reason' is distinct from 'null'::jsonb
     or (a ->> 'total')::int is distinct from 7 or (a ->> 'answered')::int is distinct from 6 or (a ->> 'correct')::int is distinct from 4
     or a ->> 'person' !~ '^[0-9a-f]{16}$' or a ->> 'deadline_at' is distinct from pg_temp.c('att1_deadline') then
    raise exception 'FAILED: C''s row while writing %', a;
  end if;
  perform pg_temp.put('person_c', a ->> 'person');
  if jsonb_array_length(r -> 'items') <> 7 then raise exception 'FAILED: item stats %', r -> 'items'; end if;
  it := pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:11')::text);
  if pg_temp.keys(it) is distinct from 'answered,correct,item_id,picks,shown,wrong_texts' or it -> 'picks' is distinct from '[0, 1, 0]'::jsonb
     or (it ->> 'shown')::int is distinct from 1 or (it ->> 'answered')::int is distinct from 1 or (it ->> 'correct')::int is distinct from 1
     or it -> 'wrong_texts' is distinct from '[]'::jsonb then
    raise exception 'FAILED: q:11 stats %', it;
  end if;
  if pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:12')::text) -> 'picks' is distinct from '[0, 1, 0, 1]'::jsonb
     or (pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:14')::text) ->> 'correct')::int is distinct from 0
     or (pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:22')::text) ->> 'answered')::int is distinct from 0
     or pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:22')::text) -> 'picks' is distinct from '[0, 0]'::jsonb
     or pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:23')::text) -> 'wrong_texts' is distinct from '[{"n": 1, "text": "8080"}]'::jsonb
     or pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:23')::text) -> 'picks' is distinct from '[]'::jsonb
     or (pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:13')::text) ->> 'correct')::int is distinct from 1 then
    raise exception 'FAILED: item stats %', r -> 'items';
  end if;

  -- the author fixes the key of q:11 (1 → 2) while C writes: C's right answer becomes wrong at once
  perform public.container_item_update(pg_temp.item('q:11'), '{"correct": [2]}');
  perform pg_temp.put('ans:' || pg_temp.item('q:11'), '{"chosen": [2]}');
  perform pg_temp.put('bad:' || pg_temp.item('q:11'), '{"chosen": [0]}');
  r := public.quiz_results(pg_temp.c('q1')::uuid);
  if (r -> 'attempts' -> 0 ->> 'correct')::int is distinct from 3
     or (pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:11')::text) ->> 'correct')::int is distinct from 0 then
    raise exception 'FAILED: the new key in the results %', r;
  end if;
  -- the marks (every saved answer graded now) and the person's answers
  r := public.quiz_marks(pg_temp.c('q1')::uuid);
  if jsonb_array_length(r) <> 6 or pg_temp.keys(r -> 0) is distinct from 'attempt_id,correct,item_id'
     or (pg_temp.find(r, 'item_id', pg_temp.item('q:11')::text) ->> 'correct')::boolean
     or not (pg_temp.find(r, 'item_id', pg_temp.item('q:13')::text) ->> 'correct')::boolean
     or (select count(*) from jsonb_array_elements(r) x where (x ->> 'correct')::boolean) <> 3 then
    raise exception 'FAILED: marks %', r;
  end if;
  r := public.quiz_attempt_answers(pg_temp.c('att1')::uuid);
  if jsonb_array_length(r) <> 6 or pg_temp.keys(r -> 0) is distinct from 'answered_at,chosen,correct,item_id,text'
     or pg_temp.find(r, 'item_id', pg_temp.item('q:13')::text) ->> 'text' is distinct from ' париж '
     or not (pg_temp.find(r, 'item_id', pg_temp.item('q:13')::text) ->> 'correct')::boolean
     or pg_temp.find(r, 'item_id', pg_temp.item('q:12')::text) -> 'chosen' is distinct from '[1, 3]'::jsonb
     or r -> 0 ->> 'item_id' is distinct from pg_temp.item('q:11')::text then
    raise exception 'FAILED: a person''s answers %', r;
  end if;

  -- locked after the first attempt: a new value of a locked key → MC011 with the key
  for v_bad in select * from (values
      ('{"item_count": 5}', 'item_count'), ('{"subject_ids": ["' || pg_temp.c('s1') || '"]}', 'subject_ids'),
      ('{"same_set": true}', 'same_set'), ('{"shuffle_items": true}', 'shuffle_items'),
      ('{"shuffle_options": false}', 'shuffle_options'), ('{"time_limit_min": 20}', 'time_limit_min'),
      ('{"time_limit_min": null}', 'time_limit_min'), ('{"title": "Новое", "item_count": 6}', 'item_count')) b(settings, detail) loop
    perform pg_temp.expect_error(format('select public.quiz_update(%L, %L)', pg_temp.c('q1'), v_bad.settings), 'MC011', 'locked ' || v_bad.settings, v_bad.detail);
  end loop;
  -- the same values are not a change (the subjects as a set, the count clamped)
  r := public.quiz_update(pg_temp.c('q1')::uuid, jsonb_build_object('item_count', 30, 'subject_ids', jsonb_build_array(pg_temp.c('s2'), pg_temp.c('s1')),
         'same_set', false, 'shuffle_items', false, 'shuffle_options', true, 'time_limit_min', 10));
  if (r ->> 'item_count')::int is distinct from 7 then raise exception 'FAILED: same values %', r; end if;
  -- unlocked keys change
  r := public.quiz_update(pg_temp.c('q1')::uuid, '{"title": "Контрольная 1 (правка)", "allow_back": false, "grading": "last"}');
  if r ->> 'title' is distinct from 'Контрольная 1 (правка)' or (r ->> 'allow_back')::boolean or r ->> 'grading' is distinct from 'last'
     or not (r ->> 'started')::boolean or (r ->> 'pass_percent')::int is distinct from 50 then
    raise exception 'FAILED: unlocked keys %', r;
  end if;
  perform pg_temp.expect_error(format('select public.quiz_update(%L, %L)', pg_temp.c('q1'), '{"pass_percent": 0}'), '22023', 'a bad unlocked value', 'pass_percent');
  perform pg_temp.expect_error(format('select public.quiz_update(%L, %L)', pg_temp.c('q1'), 'null'), '22023', 'no settings', 'settings');
end
$t$;

-- 6. C finishes: the new key counts, mistakes without keys (the quiz is open), idempotent finish, MC012 after it,
--    the second attempt, MC014.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb; r2 jsonb; it jsonb;
begin
  r := public.quiz_finish(pg_temp.c('att1')::uuid);
  if pg_temp.keys(r) is distinct from pg_temp.pin(
       'answers_after,attempt_id,attempts_left,can_retry,code,correct,finish_reason,finished_at,items,n,'
       'pass_percent,passed,percent,quiz_title,review_now,shuffle_options,started_at,total',
       'accent,answers_after,attempt_id,attempts_left,can_retry,code,correct,finish_reason,finished_at,items,n,'
       'pass_percent,passed,percent,practice,quiz_title,review_now,shuffle_options,started_at,total') then
    raise exception 'FAILED: Result keys %', pg_temp.keys(r);
  end if;
  -- 47: the colour; no practice (the author did not offer it)
  if pg_temp.r47() and (r ->> 'accent' is distinct from 'blue' or r -> 'practice' is distinct from 'null'::jsonb) then
    raise exception 'FAILED: Result accent / practice %', r;
  end if;
  -- 20261016140000_quiz_result_order: the review orders the options as the attempt did (shuffle_options + keep_order)
  if not (r ->> 'shuffle_options')::boolean
     or exists (select 1 from jsonb_array_elements(r -> 'items') x where jsonb_typeof(x -> 'keep_order') is distinct from 'boolean') then
    raise exception 'FAILED: the review cannot order the options %', r;
  end if;
  if r ->> 'attempt_id' is distinct from pg_temp.c('att1') or (r ->> 'n')::int is distinct from 1
     or r ->> 'quiz_title' is distinct from 'Контрольная 1 (правка)' or r ->> 'code' is distinct from pg_temp.c('code1')
     or r ->> 'finish_reason' is distinct from 'sent' or (r ->> 'finished_at')::timestamptz is distinct from now()
     or (r ->> 'correct')::int is distinct from 3 or (r ->> 'total')::int is distinct from 7 or (r ->> 'percent')::int is distinct from 43
     or (r ->> 'pass_percent')::int is distinct from 50 or (r ->> 'passed')::boolean is distinct from false
     or r ->> 'review_now' is distinct from 'mistakes' or (r ->> 'answers_after')::timestamptz is distinct from now() + interval '7 days'
     or (r ->> 'attempts_left')::int is distinct from 1 or not (r ->> 'can_retry')::boolean or jsonb_array_length(r -> 'items') <> 7 then
    raise exception 'FAILED: finish %', r;
  end if;
  if exists (select 1 from jsonb_array_elements(r -> 'items') x
              where pg_temp.keys(x) is distinct from pg_temp.pin(
                      'chosen,code,forms,id,images,keep_order,key,kind,options,right,stem,text',
                      'chosen,code,explanation,forms,id,images,keep_order,key,kind,options,right,stem,text')
                 or x -> 'key' is distinct from 'null'::jsonb or x -> 'forms' is distinct from 'null'::jsonb
                 or (pg_temp.r47() and x -> 'explanation' is distinct from 'null'::jsonb))
     or position('Париж' in r::text) > 0 then
    raise exception 'FAILED: a key in «mistakes» %', r -> 'items';
  end if;
  it := pg_temp.find(r -> 'items', 'id', pg_temp.item('q:11')::text);
  if (it ->> 'right')::boolean or it -> 'chosen' is distinct from '[1]'::jsonb then raise exception 'FAILED: q:11 under the new key %', it; end if;
  it := pg_temp.find(r -> 'items', 'id', pg_temp.item('q:13')::text);
  if not (it ->> 'right')::boolean or it ->> 'text' is distinct from ' париж ' then raise exception 'FAILED: q:13 %', it; end if;
  it := pg_temp.find(r -> 'items', 'id', pg_temp.item('q:22')::text);
  if (it ->> 'right')::boolean or it -> 'chosen' is distinct from 'null'::jsonb or it -> 'text' is distinct from 'null'::jsonb then
    raise exception 'FAILED: an unanswered item %', it;
  end if;
  -- finishing again changes nothing; the result reads the same; answering is over
  r2 := public.quiz_finish(pg_temp.c('att1')::uuid);
  if r2 is distinct from r then raise exception 'FAILED: a second finish %', r2; end if;
  r2 := public.quiz_result(pg_temp.c('att1')::uuid);
  if r2 is distinct from r then raise exception 'FAILED: quiz_result differs from quiz_finish %', r2; end if;
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', pg_temp.c('att1'),
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('q:22'), 'chosen', jsonb_build_array(1)))), 'MC012', 'an answer after the finish');
  -- the second attempt (allow_back is false now), finished empty; then no attempts left
  r := public.quiz_start(pg_temp.c('code1'), 'Вера С.');
  if (r ->> 'n')::int is distinct from 2 or (r ->> 'allow_back')::boolean or r -> 'answers' is distinct from '[]'::jsonb
     or r ->> 'attempt_id' = pg_temp.c('att1') then
    raise exception 'FAILED: the second attempt %', r;
  end if;
  perform pg_temp.put('att2', r ->> 'attempt_id');
  r := public.quiz_finish(pg_temp.c('att2')::uuid);
  if (r ->> 'correct')::int is distinct from 0 or (r ->> 'percent')::int is distinct from 0 or (r ->> 'attempts_left')::int is distinct from 0
     or (r ->> 'can_retry')::boolean or (r ->> 'passed')::boolean then
    raise exception 'FAILED: the second finish %', r;
  end if;
  perform pg_temp.expect_error(format('select public.quiz_start(%L, %L)', pg_temp.c('code1'), 'Вера С.'), 'MC014', 'a third attempt of two', 'attempts');
  r := public.quiz_preview(pg_temp.c('code1'));
  if (r -> 'me' ->> 'attempts_used')::int is distinct from 2 or (r -> 'me' ->> 'can_start')::boolean
     or r -> 'me' ->> 'reason' is distinct from 'no_attempts' or r -> 'me' -> 'open_attempt' is distinct from 'null'::jsonb
     or jsonb_array_length(r -> 'me' -> 'results') <> 2
     or pg_temp.keys(r -> 'me' -> 'results' -> 0) is distinct from 'attempt_id,correct,finished_at,n,total'
     or r -> 'me' -> 'results' -> 0 ->> 'attempt_id' is distinct from pg_temp.c('att1')
     or (r -> 'me' -> 'results' -> 0 ->> 'correct')::int is distinct from 3 or (r -> 'me' -> 'results' -> 0 ->> 'total')::int is distinct from 7 then
    raise exception 'FAILED: preview without attempts left %', r -> 'me';
  end if;
end
$t$;

-- 7. A: the own test attempt (own = true, out of the item stats and the average), quiz_list, an own attempt does not
--    lock the settings, the reset gives C an attempt back.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; v_own text; v_row jsonb; v_q6 jsonb;
begin
  r := public.quiz_start(pg_temp.c('code1'), 'Автор (проверка)');
  v_own := r ->> 'attempt_id';
  perform public.quiz_answer(v_own::uuid, (select jsonb_agg(pg_temp.answer(x ->> 'id', true)) from jsonb_array_elements(r -> 'items') x));
  r := public.quiz_finish(v_own::uuid);
  if (r ->> 'correct')::int is distinct from 7 or (r ->> 'percent')::int is distinct from 100 or not (r ->> 'passed')::boolean then
    raise exception 'FAILED: the author''s own attempt %', r;
  end if;
  r := public.quiz_results(pg_temp.c('q1')::uuid);
  if jsonb_array_length(r -> 'attempts') <> 3
     or not (pg_temp.find(r -> 'attempts', 'id', v_own) ->> 'own')::boolean
     or pg_temp.find(r -> 'attempts', 'id', v_own) ->> 'person' = pg_temp.c('person_c')
     or pg_temp.find(r -> 'attempts', 'id', pg_temp.c('att2')) ->> 'person' is distinct from pg_temp.c('person_c')
     or (pg_temp.find(r -> 'attempts', 'id', pg_temp.c('att2')) ->> 'own')::boolean then
    raise exception 'FAILED: own / person %', r -> 'attempts';
  end if;
  -- item stats: C's two attempts only (the author's would make 3 shown, 2 answered, 1 right)
  if (pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:11')::text) ->> 'shown')::int is distinct from 2
     or (pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:11')::text) ->> 'answered')::int is distinct from 1
     or (pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:11')::text) ->> 'correct')::int is distinct from 0
     or pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:11')::text) -> 'picks' is distinct from '[0, 1, 0]'::jsonb then
    raise exception 'FAILED: the own attempt in the item stats %', r -> 'items';
  end if;
  -- quiz_list: people / avg without the author (C: 3/7 and 0/7 → 21.4), writing / finished count attempts
  r := public.quiz_list(pg_temp.c('k1')::uuid);
  v_row := pg_temp.find(r, 'id', pg_temp.c('q1'));
  if pg_temp.keys(v_row) is distinct from pg_temp.pin(
       'allow_back,attempts,avg_percent,closed_at,closes_at,code,container_id,created_at,finished,'
       'grading,id,item_count,members_only,opens_at,pass_percent,people,review,same_set,shuffle_items,shuffle_options,started,state,'
       'subject_ids,time_limit_s,title,updated_at,writing',
       'accent,allow_back,attempts,avg_percent,closed_at,closes_at,code,container_id,cover_path,created_at,finished,'
       'grading,guests,id,item_count,members_only,offer_practice,opens_at,pass_percent,people,review,same_set,shuffle_items,'
       'shuffle_options,started,state,subject_ids,time_limit_s,title,updated_at,writing') then
    raise exception 'FAILED: list row keys %', pg_temp.keys(v_row);
  end if;
  if (v_row ->> 'people')::int is distinct from 1 or (v_row ->> 'writing')::int is distinct from 0
     or (v_row ->> 'finished')::int is distinct from 3 or (v_row ->> 'avg_percent')::numeric is distinct from 21.4 then
    raise exception 'FAILED: list row %', v_row;
  end if;
  v_row := pg_temp.find(r, 'id', pg_temp.c('q0'));
  if (v_row ->> 'people')::int is distinct from 0 or v_row -> 'avg_percent' is distinct from 'null'::jsonb or (v_row ->> 'started')::boolean then
    raise exception 'FAILED: an untouched quiz in the list %', v_row;
  end if;
  if jsonb_array_length(r) <> 4 then raise exception 'FAILED: K1 has 4 quizzes, the list %', jsonb_array_length(r); end if;
  -- Q6: only the author has written it — not started, the locked keys still change
  v_q6 := public.quiz_create(pg_temp.c('k1')::uuid, '{"item_count": 3}');
  r := public.quiz_start(v_q6 ->> 'code', 'Автор');
  perform public.quiz_finish((r ->> 'attempt_id')::uuid);
  r := public.quiz_update((v_q6 ->> 'id')::uuid, '{"item_count": 2, "time_limit_min": 5}');
  if (r ->> 'started')::boolean or (r ->> 'item_count')::int is distinct from 2 or (r ->> 'time_limit_s')::int is distinct from 300 then
    raise exception 'FAILED: an own attempt locked the settings %', r;
  end if;
  -- the reset: C's second attempt is gone, C may start again
  r := public.quiz_attempt_reset(pg_temp.c('att2')::uuid);
  if r is distinct from '{"deleted": true}'::jsonb then raise exception 'FAILED: reset %', r; end if;
  perform pg_temp.expect_error(format('select public.quiz_attempt_reset(%L)', pg_temp.c('att2')), 'P0002', 'a reset of a reset');
end
$t$;

-- 8. C after the reset: one attempt back; the third attempt stays open.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_preview(pg_temp.c('code1'));
  if (r -> 'me' ->> 'attempts_used')::int is distinct from 1 or not (r -> 'me' ->> 'can_start')::boolean
     or r -> 'me' -> 'reason' is distinct from 'null'::jsonb then
    raise exception 'FAILED: preview after the reset %', r -> 'me';
  end if;
  r := public.quiz_start(pg_temp.c('code1'), 'Вера С.');
  if (r ->> 'n')::int is distinct from 2 then raise exception 'FAILED: the attempt given back %', r; end if;
  perform pg_temp.put('att3', r ->> 'attempt_id');
  perform pg_temp.expect_error(format('select public.quiz_result(%L)', pg_temp.c('att3')), '22023', 'the result of an open attempt', 'unfinished');
  perform public.quiz_answer(pg_temp.c('att3')::uuid, jsonb_build_array(pg_temp.answer(pg_temp.item('q:21')::text, true)));
end
$t$;

-- 9. A closes Q1: C's open attempt settles as «closed»; a closing time in the past keeps it closed, a future one
--    opens it again.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; a jsonb;
begin
  r := public.quiz_close(pg_temp.c('q1')::uuid);
  if r ->> 'state' is distinct from 'closed' or (r ->> 'closed_at')::timestamptz is distinct from now() then
    raise exception 'FAILED: close %', r;
  end if;
  a := pg_temp.find(public.quiz_results(pg_temp.c('q1')::uuid) -> 'attempts', 'id', pg_temp.c('att3'));
  if a ->> 'finish_reason' is distinct from 'closed' or (a ->> 'finished_at')::timestamptz is distinct from now()
     or (a ->> 'correct')::int is distinct from 1 then
    raise exception 'FAILED: an open attempt at the close %', a;
  end if;
end
$t$;

-- 10. C after the close: answering over, no start, the keys shown (mistakes_then_answers after the close).
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb;
begin
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', pg_temp.c('att3'),
    jsonb_build_array(pg_temp.answer(pg_temp.item('q:22')::text, true))), 'MC012', 'an answer after the close');
  perform pg_temp.expect_error(format('select public.quiz_start(%L, %L)', pg_temp.c('code1'), 'Вера С.'), 'MC013', 'a start after the close', 'closed');
  r := public.quiz_preview(pg_temp.c('code1'));
  if r ->> 'status' is distinct from 'closed' or (r -> 'me' ->> 'can_start')::boolean or r -> 'me' ->> 'reason' is distinct from 'closed' then
    raise exception 'FAILED: preview of a closed quiz %', r;
  end if;
  r := public.quiz_result(pg_temp.c('att1')::uuid);
  if r ->> 'review_now' is distinct from 'answers' or r -> 'answers_after' is distinct from 'null'::jsonb
     or pg_temp.find(r -> 'items', 'id', pg_temp.item('q:11')::text) -> 'key' is distinct from '[2]'::jsonb
     or pg_temp.find(r -> 'items', 'id', pg_temp.item('q:12')::text) -> 'key' is distinct from '[1, 3]'::jsonb
     or pg_temp.find(r -> 'items', 'id', pg_temp.item('q:12')::text) -> 'forms' is distinct from 'null'::jsonb
     or pg_temp.find(r -> 'items', 'id', pg_temp.item('q:13')::text) -> 'forms' is distinct from '["Париж"]'::jsonb
     or pg_temp.find(r -> 'items', 'id', pg_temp.item('q:13')::text) -> 'key' is distinct from 'null'::jsonb then
    raise exception 'FAILED: answers after the close %', r;
  end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_update(pg_temp.c('q1')::uuid, jsonb_build_object('closes_at', now() - interval '1 hour'));
  if r -> 'closed_at' = 'null'::jsonb or r ->> 'state' is distinct from 'closed' then raise exception 'FAILED: a past closing time reopened %', r; end if;
  r := public.quiz_update(pg_temp.c('q1')::uuid, jsonb_build_object('closes_at', now() + interval '1 day'));
  if r -> 'closed_at' is distinct from 'null'::jsonb or r ->> 'state' is distinct from 'open' then raise exception 'FAILED: reopen %', r; end if;
  -- quizzes for the next checks
  perform pg_temp.put('code2', public.quiz_create(pg_temp.c('k1')::uuid, '{"review": "score", "item_count": 3, "attempts": null}') ->> 'code');
  perform pg_temp.put('code3', public.quiz_create(pg_temp.c('k1')::uuid, '{"review": "answers", "item_count": 2, "shuffle_items": false}') ->> 'code');
  perform pg_temp.put('code4', public.quiz_create(pg_temp.c('k1')::uuid, '{"time_limit_min": 5}') ->> 'code');
  perform pg_temp.put('code5', public.quiz_create(pg_temp.c('k1')::uuid, '{"members_only": true}') ->> 'code');
  perform pg_temp.put('code7', public.quiz_create(pg_temp.c('k1')::uuid, jsonb_build_object('opens_at', now() + interval '1 day')) ->> 'code');
  r := public.quiz_create(pg_temp.c('k1')::uuid, '{}');
  perform pg_temp.put('q8', r ->> 'id');
  perform pg_temp.put('code8', r ->> 'code');
  r := public.quiz_create(pg_temp.c('k1')::uuid, '{"same_set": true, "item_count": 3}');
  perform pg_temp.put('q9', r ->> 'id');
  perform pg_temp.put('code9', r ->> 'code');
  r := public.quiz_create(pg_temp.c('k1')::uuid, jsonb_build_object('time_limit_min', 60, 'closes_at', now() + interval '10 minutes'));
  perform pg_temp.put('code10', r ->> 'code');
  r := public.quiz_create(pg_temp.c('k1')::uuid, '{"attempts": null}');
  perform pg_temp.put('q11', r ->> 'id');
  perform pg_temp.put('code11', r ->> 'code');
end
$t$;
reset role;
do $t$
begin
  -- same_set draws its set at the create; the others have none
  if (select cardinality(fixed_item_ids) from public.quizzes where id = pg_temp.c('q9')::uuid) is distinct from 3
     or (select fixed_item_ids from public.quizzes where id = pg_temp.c('q8')::uuid) is not null then
    raise exception 'FAILED: fixed_item_ids';
  end if;
  -- 3000 attempts on Q11 (D, finished): the quiz is full
  insert into public.quiz_attempts (quiz_id, user_id, name, n, item_ids, finished_at, finish_reason)
  select pg_temp.c('q11')::uuid, 'dddddddd-0000-0000-0000-000000000004', 'Дмитрий', g, array[pg_temp.item('q:21')], now(), 'sent'
    from generate_series(1, 3000) g;
end
$t$;
set local role authenticated;

-- 11. C: score only; answers at once; a sample in exam order; the timer; members only; not yet; the deadline from the
--     closing; the full quiz.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb; v_refs text;
begin
  r := public.quiz_start(pg_temp.c('code2'), 'Вера');
  if jsonb_array_length(r -> 'items') <> 3
     or (select count(distinct x ->> 'id') from jsonb_array_elements(r -> 'items') x where pg_temp.c('rank:' || (x ->> 'id')) is not null) <> 3 then
    raise exception 'FAILED: a sample of 3 keyed questions %', r -> 'items';
  end if;
  r := public.quiz_finish((r ->> 'attempt_id')::uuid);
  if r ->> 'review_now' is distinct from 'score' or r -> 'items' is distinct from '[]'::jsonb or r -> 'attempts_left' is distinct from 'null'::jsonb
     or not (r ->> 'can_retry')::boolean or r -> 'answers_after' is distinct from 'null'::jsonb or r -> 'passed' is distinct from 'null'::jsonb then
    raise exception 'FAILED: score only %', r;
  end if;
  r := public.quiz_start(pg_temp.c('code3'), 'Вера');
  if jsonb_array_length(r -> 'items') <> 2
     or (pg_temp.c('rank:' || (r -> 'items' -> 0 ->> 'id')))::int >= (pg_temp.c('rank:' || (r -> 'items' -> 1 ->> 'id')))::int then
    raise exception 'FAILED: a sample kept in exam order %', r -> 'items';
  end if;
  perform public.quiz_answer((r ->> 'attempt_id')::uuid, jsonb_build_array(pg_temp.answer(r -> 'items' -> 0 ->> 'id', true)));
  r := public.quiz_finish((r ->> 'attempt_id')::uuid);
  if r ->> 'review_now' is distinct from 'answers' or (r ->> 'correct')::int is distinct from 1
     or exists (select 1 from jsonb_array_elements(r -> 'items') x where (x -> 'key') = 'null'::jsonb and (x -> 'forms') = 'null'::jsonb) then
    raise exception 'FAILED: answers at once %', r;
  end if;
  r := public.quiz_start(pg_temp.c('code4'), 'Вера');
  if (r ->> 'deadline_at')::timestamptz - (r ->> 'started_at')::timestamptz is distinct from interval '5 minutes' then
    raise exception 'FAILED: a 5-minute deadline %', r;
  end if;
  perform pg_temp.put('att4', r ->> 'attempt_id');
  perform pg_temp.put('att4_item', r -> 'items' -> 0 ->> 'id');
  perform pg_temp.put('att4_item2', r -> 'items' -> 1 ->> 'id');
  perform pg_temp.expect_error(format('select public.quiz_start(%L, %L)', pg_temp.c('code5'), 'Вера'), 'MC015', 'members only, a stranger');
  r := public.quiz_preview(pg_temp.c('code5'));
  if (r -> 'me' ->> 'can_start')::boolean or r -> 'me' ->> 'reason' is distinct from 'members_only' or not (r ->> 'members_only')::boolean then
    raise exception 'FAILED: preview members only %', r;
  end if;
  r := public.quiz_preview(pg_temp.c('code7'));
  if r ->> 'status' is distinct from 'not_yet' or r -> 'me' ->> 'reason' is distinct from 'not_yet' or (r -> 'me' ->> 'can_start')::boolean then
    raise exception 'FAILED: preview not yet %', r;
  end if;
  perform pg_temp.expect_error(format('select public.quiz_start(%L, %L)', pg_temp.c('code7'), 'Вера'), 'MC013', 'not yet open', 'not_yet');
  r := public.quiz_start(pg_temp.c('code8'), 'Вера');
  if r -> 'deadline_at' is distinct from 'null'::jsonb then raise exception 'FAILED: no timer, no closing → no deadline %', r; end if;
  perform pg_temp.put('att8', r ->> 'attempt_id');
  r := public.quiz_start(pg_temp.c('code9'), 'Вера');
  perform pg_temp.put('att9', r ->> 'attempt_id');
  perform pg_temp.put('set9', (select string_agg(x ->> 'id', ',' order by x ->> 'id') from jsonb_array_elements(r -> 'items') x));
  r := public.quiz_start(pg_temp.c('code10'), 'Вера');
  if (r ->> 'deadline_at')::timestamptz is distinct from now() + interval '10 minutes' then
    raise exception 'FAILED: the deadline from the closing time %', r;
  end if;
  perform pg_temp.put('att10', r ->> 'attempt_id');
  perform pg_temp.expect_error(format('select public.quiz_start(%L, %L)', pg_temp.c('code11'), 'Вера'), 'MC014', 'a full quiz', 'full');
  r := public.quiz_preview(pg_temp.c('code11'));
  if r -> 'me' ->> 'reason' is distinct from 'no_attempts' or (r -> 'me' ->> 'can_start')::boolean then
    raise exception 'FAILED: preview of a full quiz %', r -> 'me';
  end if;
end
$t$;

-- 12. Time passes for Q4 and Q10 (postgres): Q4's deadline was 10 s ago; Q10 closed 30 s ago. B joins K1.
reset role;
update public.quiz_attempts set started_at = started_at - interval '5 minutes 10 seconds',
                                deadline_at = deadline_at - interval '5 minutes 10 seconds'
 where id = pg_temp.c('att4')::uuid;
update public.quizzes set closes_at = closes_at - interval '10 minutes 30 seconds'
 where id = (select quiz_id from public.quiz_attempts where id = pg_temp.c('att10')::uuid);
update public.quiz_attempts set started_at = started_at - interval '10 minutes 30 seconds',
                                deadline_at = deadline_at - interval '10 minutes 30 seconds'
 where id = pg_temp.c('att10')::uuid;
insert into public.container_members (container_id, user_id) values (pg_temp.c('k1')::uuid, 'bbbbbbbb-0000-0000-0000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb;
begin
  -- 10 s after the deadline: saved (the grace of 20 s)
  r := public.quiz_answer(pg_temp.c('att4')::uuid, jsonb_build_array(pg_temp.answer(pg_temp.c('att4_item'), true)));
  if (r ->> 'saved')::int is distinct from 1 or (r ->> 'deadline_at')::timestamptz is distinct from now() - interval '10 seconds' then
    raise exception 'FAILED: an answer inside the grace %', r;
  end if;
  -- the deadline from the closing: settled as «closed», not «time»
  r := public.quiz_result(pg_temp.c('att10')::uuid);
  if r ->> 'finish_reason' is distinct from 'closed' or (r ->> 'finished_at')::timestamptz is distinct from now() - interval '30 seconds' then
    raise exception 'FAILED: a deadline from the closing %', r;
  end if;
end
$t$;
reset role;
update public.quiz_attempts set started_at = started_at - interval '20 seconds', deadline_at = deadline_at - interval '20 seconds'
 where id = pg_temp.c('att4')::uuid;
set local role authenticated;
do $t$
declare r jsonb;
begin
  -- 30 s after: MC012, and the attempt is settled at its deadline as «time»; the answer of the grace counts
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', pg_temp.c('att4'),
    jsonb_build_array(pg_temp.answer(pg_temp.c('att4_item2'), true))), 'MC012', 'an answer 30 s after the deadline');
  r := public.quiz_result(pg_temp.c('att4')::uuid);
  if r ->> 'finish_reason' is distinct from 'time' or (r ->> 'finished_at')::timestamptz is distinct from now() - interval '30 seconds'
     or (r ->> 'correct')::int is distinct from 1 then
    raise exception 'FAILED: settled by time %', r;
  end if;
  -- a finish after the deadline (inside or past the grace) is «time» too, never «sent»
  r := public.quiz_finish(pg_temp.c('att4')::uuid);
  if r ->> 'finish_reason' is distinct from 'time' then raise exception 'FAILED: finish after time %', r; end if;
end
$t$;

-- 13. B, now a member of K1: members only lets B in; B gets Q9's set; B cannot touch C's attempt or the author's data.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare r jsonb; v_sql text;
begin
  r := public.quiz_preview(pg_temp.c('code5'));
  if not (r -> 'me' ->> 'is_member')::boolean or not (r -> 'me' ->> 'can_start')::boolean or r -> 'me' ->> 'name_hint' is distinct from 'Борис' then
    raise exception 'FAILED: a member''s preview %', r -> 'me';
  end if;
  r := public.quiz_start(pg_temp.c('code5'), 'Борис');
  if (r ->> 'n')::int is distinct from 1 then raise exception 'FAILED: a member starts %', r; end if;
  r := public.quiz_start(pg_temp.c('code9'), 'Борис');
  if (select string_agg(x ->> 'id', ',' order by x ->> 'id') from jsonb_array_elements(r -> 'items') x) is distinct from pg_temp.c('set9') then
    raise exception 'FAILED: same_set gives another set %', r -> 'items';
  end if;
  -- B writes Q1 twice: wrong short answers for the stats (« 8080. » is the same normalised form as C's «8080»)
  r := public.quiz_start(pg_temp.c('code1'), 'Борис');
  perform public.quiz_answer((r ->> 'attempt_id')::uuid, jsonb_build_array(
    jsonb_build_object('item_id', pg_temp.item('q:13'), 'text', 'Лондон'),
    jsonb_build_object('item_id', pg_temp.item('q:23'), 'text', ' 8080. ')));
  perform public.quiz_finish((r ->> 'attempt_id')::uuid);
  r := public.quiz_start(pg_temp.c('code1'), 'Борис');
  perform public.quiz_answer((r ->> 'attempt_id')::uuid, jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('q:13'), 'text', 'Рим')));
  perform public.quiz_finish((r ->> 'attempt_id')::uuid);
  foreach v_sql in array array[
      format('select public.quiz_result(%L)', pg_temp.c('att1')), format('select public.quiz_finish(%L)', pg_temp.c('att8')),
      format('select public.quiz_answer(%L, %L)', pg_temp.c('att8'), jsonb_build_array(pg_temp.answer(pg_temp.item('q:21')::text, true))),
      format('select public.quiz_attempt_answers(%L)', pg_temp.c('att1')), format('select public.quiz_attempt_reset(%L)', pg_temp.c('att1')),
      format('select public.quiz_results(%L)', pg_temp.c('q1')), format('select public.quiz_list(%L)', pg_temp.c('k1'))] loop
    perform pg_temp.expect_error(v_sql, 'P0002', 'a member: ' || v_sql);
  end loop;
end
$t$;

-- D (an empty profile name): no name hint; two more wrong short answers on Q1.
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_preview(pg_temp.c('code1'));
  if r -> 'me' -> 'name_hint' is distinct from 'null'::jsonb then raise exception 'FAILED: a name hint from an empty name %', r -> 'me'; end if;
  r := public.quiz_start(pg_temp.c('code1'), 'Дмитрий');
  perform public.quiz_answer((r ->> 'attempt_id')::uuid, jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('q:13'), 'text', 'Берлин')));
  perform public.quiz_finish((r ->> 'attempt_id')::uuid);
  r := public.quiz_start(pg_temp.c('code1'), 'Дмитрий');
  perform public.quiz_answer((r ->> 'attempt_id')::uuid, jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('q:13'), 'text', 'Мадрид')));
  perform public.quiz_finish((r ->> 'attempt_id')::uuid);
end
$t$;

-- 14. A: the wrong short answers (one per normalised form, the 3 most common); a closing time set later gives the open
--     attempt a deadline (and takes it back); the close settles an attempt without a deadline as «closed»; the delete.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; a jsonb;
begin
  r := public.quiz_results(pg_temp.c('q1')::uuid);
  if pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:23')::text) -> 'wrong_texts' is distinct from '[{"n": 2, "text": "8080"}]'::jsonb
     or pg_temp.find(r -> 'items', 'item_id', pg_temp.item('q:13')::text) -> 'wrong_texts' is distinct from
        '[{"n": 1, "text": "Берлин"}, {"n": 1, "text": "Лондон"}, {"n": 1, "text": "Мадрид"}]'::jsonb
     or (select count(distinct x ->> 'person') from jsonb_array_elements(r -> 'attempts') x where not (x ->> 'own')::boolean) <> 3 then
    raise exception 'FAILED: wrong texts / persons %', r;
  end if;
  if (pg_temp.find(public.quiz_list(pg_temp.c('k1')::uuid), 'id', pg_temp.c('q1')) ->> 'people')::int is distinct from 3 then
    raise exception 'FAILED: three people on Q1';
  end if;
  a := pg_temp.find(public.quiz_results(pg_temp.c('q8')::uuid) -> 'attempts', 'id', pg_temp.c('att8'));
  if a -> 'deadline_at' is distinct from 'null'::jsonb or a -> 'finished_at' is distinct from 'null'::jsonb then
    raise exception 'FAILED: Q8 before %', a;
  end if;
  perform public.quiz_update(pg_temp.c('q8')::uuid, jsonb_build_object('closes_at', now() + interval '1 hour'));
  a := pg_temp.find(public.quiz_results(pg_temp.c('q8')::uuid) -> 'attempts', 'id', pg_temp.c('att8'));
  if (a ->> 'deadline_at')::timestamptz is distinct from now() + interval '1 hour' then raise exception 'FAILED: a new closing time %', a; end if;
  perform public.quiz_update(pg_temp.c('q8')::uuid, '{"closes_at": null}');
  a := pg_temp.find(public.quiz_results(pg_temp.c('q8')::uuid) -> 'attempts', 'id', pg_temp.c('att8'));
  if a -> 'deadline_at' is distinct from 'null'::jsonb then raise exception 'FAILED: the closing time taken back %', a; end if;
  r := public.quiz_close(pg_temp.c('q8')::uuid);
  a := pg_temp.find(public.quiz_results(pg_temp.c('q8')::uuid) -> 'attempts', 'id', pg_temp.c('att8'));
  if a ->> 'finish_reason' is distinct from 'closed' then raise exception 'FAILED: no deadline, closed %', a; end if;
  -- the delete
  r := public.quiz_delete(pg_temp.c('q9')::uuid);
  if r is distinct from '{"deleted": true}'::jsonb then raise exception 'FAILED: delete %', r; end if;
  if pg_temp.find(public.quiz_list(pg_temp.c('k1')::uuid), 'id', pg_temp.c('q9')) is not null then raise exception 'FAILED: a deleted quiz listed'; end if;
  perform pg_temp.expect_error(format('select public.quiz_delete(%L)', pg_temp.c('q9')), 'P0002', 'delete twice');
end
$t$;

-- 15. C after the delete and the close; E (no attempt anywhere) reads no picture.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
begin
  perform pg_temp.expect_error(format('select public.quiz_result(%L)', pg_temp.c('att9')), 'P0002', 'the result of a deleted quiz');
  if public.quiz_preview(pg_temp.c('code9')) is distinct from '{"status": "not_found"}'::jsonb then raise exception 'FAILED: a deleted code'; end if;
  perform pg_temp.expect_error(format('select public.quiz_answer(%L, %L)', pg_temp.c('att8'),
    jsonb_build_array(pg_temp.answer(pg_temp.item('q:21')::text, true))), 'MC012', 'an answer after a close without a deadline');
  if not exists (select 1 from public.my_quiz_container_ids() x where x = pg_temp.c('k1')::uuid) then
    raise exception 'FAILED: my_quiz_container_ids';
  end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', true);
do $t$
begin
  if (select count(*) from storage.objects where bucket_id = 'test-item-images') <> 0 then raise exception 'FAILED: E reads a picture'; end if;
  if exists (select 1 from public.my_quiz_container_ids()) then raise exception 'FAILED: E has quiz containers'; end if;
end
$t$;
select 'QUIZ CHECKS PASSED';
rollback;
