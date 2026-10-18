-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261018100000_test_builder.sql
-- (release 47) on the scratch database of test_builder_run.sh. One transaction, rolled back. A = author aaaa…1 (exams X
-- and Y), B = bbbb…2 (a member of X), C = cccc…3 and D = dddd…4 (signed-in takers), E = eeee…5 (practice); guests are
-- anon with tokens tok(n). now() is one moment inside the transaction, so «a minute ago» is made by moving started_at
-- back as postgres. Covers: explanations (add, update, the limit, no rev bump, members read them); reorder (owner only,
-- the exact set); the four settings (defaults, refusals, members_only ⇒ no guests, not locked after the start); the guest
-- path (preview «me» without and with a token, start / resume / answer / finish / result, a wrong token, guests off,
-- members only, the attempt JSON without key or explanation); the result's explanation only with the answers, accent,
-- practice; quiz_results' guest flag and person; started by a guest; MC016 per quiz (121 starts in a minute) and per
-- address (x-forwarded-for), the pruning of the throttle; MC014 past 2000 guest attempts (2000 rows inserted, no session
-- setting); claim; practice join (off, unfinished, joined like container_join, again, left and back, removed, the author,
-- full at 200); pictures: anon reads no question picture at all (no policy), quiz_guest_media_paths runs for
-- service_role only and gives a guest attempt's own picture paths by its token (not other items of the subject, not
-- another exam's; a wrong token, a user's attempt → empty; at most 60 paths); the quiz-covers policies. A failure
-- raises; success prints BUILDER BEHAVIOUR PASSED.
-- After 20261018130000_quiz_guards.sql (pg_temp.guards()) the same flows hold with its rules: the result's practice
-- carries ready (compared here without it; quiz_guards_behaviour.sql pins it), the practice joins of section 12 run
-- while exam X's quizzes are closed for the moment (pg_temp.x_quizzes), and the address hash is the HMAC under the
-- private secret.
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
-- adds «design» to QuizRow, the preview, the attempt and the result, «band», «score» and «max_score» to the result, and
-- «score» / «max_score» to the attempt rows of quiz_results and the preview's results; test_docs_behaviour.sql pins those
-- shapes, so once it is applied the pins here leave those keys out (before it, they must not be there).
create or replace function pg_temp.keys(p jsonb) returns text language sql stable as $fn$
  select string_agg(k, ',' order by k) from jsonb_object_keys(p) k
   where not (k in ('design', 'band', 'score', 'max_score') and to_regclass('public.test_docs') is not null)
$fn$;
create or replace function pg_temp.find(p_list jsonb, p_key text, p_val text) returns jsonb language sql immutable as $fn$
  select x from jsonb_array_elements(p_list) x where x ->> p_key = p_val limit 1
$fn$;
-- a guest token (43 base64url characters) and the hash the server keeps
create or replace function pg_temp.tok(p_n integer) returns text language sql immutable as $fn$
  select 'tok' || lpad(p_n::text, 8, '0') || repeat('Z', 32)
$fn$;
create or replace function pg_temp.hash(p_token text) returns text language sql immutable as $fn$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$fn$;
create or replace function pg_temp.item(p_ref text) returns uuid language sql stable as $fn$
  select v::uuid from pg_temp.ctx where k = 'item:' || p_ref
$fn$;
-- a picture path in the folder of exam p_container
create or replace function pg_temp.pic(p_container text, p_n integer) returns text language sql immutable as $fn$
  select p_container || '/' || encode(sha256(convert_to('pic' || p_n, 'UTF8')), 'hex') || '.png'
$fn$;
-- 20261018130000_quiz_guards.sql applied (its secret table exists; read from the catalog, which every role may read)
create or replace function pg_temp.guards() returns boolean language sql stable as $fn$
  select exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'meldy_private' and c.relname = 'quiz_ip_secret')
$fn$;
-- the result's practice as release 47 shapes it: with the guards, ready must be there (a boolean) and is left out
create or replace function pg_temp.practice47(p jsonb) returns jsonb language sql stable as $fn$
  select case when not pg_temp.guards() or jsonb_typeof(p) is distinct from 'object' then p
              when jsonb_typeof(p -> 'ready') = 'boolean' then p - 'ready'
              else jsonb_build_object('ready_missing', p) end
$fn$;
-- the throttle's hash of an address (as postgres): release 47's prefixed sha256, or the HMAC under the guards' secret
create or replace function pg_temp.ip_hash(p_ip text) returns text language plpgsql stable as $fn$
declare v text;
begin
  if not pg_temp.guards() then
    return encode(sha256(convert_to('meldy-quiz-ip:' || p_ip, 'UTF8')), 'hex');
  end if;
  execute 'select encode(extensions.hmac(convert_to($1, ''UTF8''), s.secret, ''sha256''), ''hex'') from meldy_private.quiz_ip_secret s'
    into v using p_ip;
  return v;
end;
$fn$;
-- With the guards, «Тренироваться» joins only while no quiz of the exam is open: close exam X's open quizzes for the
-- moment (true) and open them again (false). Without the guards it does nothing. Runs as its owner (postgres).
create or replace function pg_temp.x_quizzes(p_closed boolean) returns void language plpgsql security definer as $fn$
begin
  if not pg_temp.guards() then
    return;
  end if;
  if p_closed then
    perform pg_temp.put('x_closed', coalesce((select string_agg(q.id::text, ',') from public.quizzes q
                                              where q.container_id = pg_temp.c('x')::uuid and q.closed_at is null), ''));
    update public.quizzes q set closed_at = now() where q.container_id = pg_temp.c('x')::uuid and q.closed_at is null;
  else
    update public.quizzes q set closed_at = null
     where q.id::text = any (string_to_array(coalesce(pg_temp.c('x_closed'), ''), ','));
    perform pg_temp.put('x_closed', '');
  end if;
end;
$fn$;
grant all on ctx to authenticated, anon, service_role;
grant execute on function pg_temp.expect_error(text, text, text, text), pg_temp.c(text), pg_temp.put(text, text),
  pg_temp.keys(jsonb), pg_temp.find(jsonb, text, text), pg_temp.tok(integer), pg_temp.hash(text), pg_temp.item(text),
  pg_temp.pic(text, integer), pg_temp.guards(), pg_temp.practice47(jsonb), pg_temp.x_quizzes(boolean)
  to authenticated, anon, service_role;

-- 1. A: exam X (S1 «Вопросы»: four questions with explanations and pictures; S2 «Ещё»: one question with a picture; S3:
--    an unkeyed question with a picture, so no quiz takes S3), exam Y (a picture, a quiz without guests). Explanations: add, refusals, update, no rev bump.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare
  r jsonb; v_x text; v_y text; s1 uuid; s2 uuid; s3 uuid; v_rev integer; v_bad record;
begin
  r := public.container_create('Конструктор проверка', null, '[{"title":"Вопросы"},{"title":"Ещё"},{"title":"Без контрольной"}]');
  v_x := r ->> 'container_id';
  s1 := (r -> 'subjects' -> 0 ->> 'id')::uuid;
  s2 := (r -> 'subjects' -> 1 ->> 'id')::uuid;
  s3 := (r -> 'subjects' -> 2 ->> 'id')::uuid;
  perform pg_temp.put('x', v_x);
  perform pg_temp.put('s1', s1::text);
  perform pg_temp.put('s2', s2::text);
  perform pg_temp.put('s3', s3::text);
  r := public.container_items_add(s1, jsonb_build_array(
    jsonb_build_object('ref', 'b:1', 'stem', 'Сколько будет 2+2?', 'options', jsonb_build_array('3', '4'), 'correct', jsonb_build_array(1),
                       'explanation', '  Потому что 2+2=4  ', 'images', jsonb_build_object('stem', jsonb_build_array(pg_temp.pic(v_x, 1)))),
    jsonb_build_object('ref', 'b:2', 'stem', 'Чётные', 'options', jsonb_build_array('1', '2', '4'), 'correct', jsonb_build_array(1, 2),
                       'images', jsonb_build_object('options', jsonb_build_array(jsonb_build_array(pg_temp.pic(v_x, 2)), '[]'::jsonb))),
    jsonb_build_object('ref', 'b:3', 'stem', 'Столица Франции', 'answers', jsonb_build_array('Париж'), 'explanation', 'Столица — Париж'),
    jsonb_build_object('ref', 'b:4', 'stem', 'Длинное пояснение', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0),
                       'explanation', repeat('я', 2000))));
  perform public.container_items_add(s2, jsonb_build_array(
    jsonb_build_object('ref', 'b:5', 'stem', 'Второй предмет', 'options', jsonb_build_array('а', 'б'), 'correct', jsonb_build_array(0),
                       'images', jsonb_build_object('stem', jsonb_build_array(pg_temp.pic(v_x, 3))))));
  perform public.container_items_add(s3, jsonb_build_array(
    jsonb_build_object('ref', 'b:6', 'stem', 'Без контрольной', 'options', jsonb_build_array('а', 'б'), 'correct', '[]'::jsonb,
                       'images', jsonb_build_object('stem', jsonb_build_array(pg_temp.pic(v_x, 4))))));
  insert into pg_temp.ctx select 'item:' || i.import_ref, i.id::text from public.test_items i where i.container_id = v_x::uuid;
  -- trimmed, '' when absent, 2000 characters fit
  if (select explanation from public.test_items where id = pg_temp.item('b:1')) is distinct from 'Потому что 2+2=4'
     or (select explanation from public.test_items where id = pg_temp.item('b:2')) is distinct from ''
     or (select char_length(explanation) from public.test_items where id = pg_temp.item('b:4')) is distinct from 2000 then
    raise exception 'FAILED: explanations as added';
  end if;
  -- refusals of the add: the rule «explanation» of that item
  for v_bad in select * from (values
      (jsonb_build_array(jsonb_build_object('ref', 'e:1', 'stem', 'x', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(0),
                                            'explanation', repeat('я', 2001))), 'item 1: explanation'),
      (jsonb_build_array(jsonb_build_object('ref', 'e:1', 'stem', 'x', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(0)),
                         jsonb_build_object('ref', 'e:2', 'stem', 'x', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(0),
                                            'explanation', 5)), 'item 2: explanation'),
      (jsonb_build_array(jsonb_build_object('ref', 'e:1', 'stem', 'x', 'options', jsonb_build_array('a', 'b'), 'correct', jsonb_build_array(0),
                                            'explanation', null)), 'item 1: explanation')) b(items, detail) loop
    perform pg_temp.expect_error(format('select public.container_items_add(%L, %L)', s1, v_bad.items), '22023', 'add ' || v_bad.detail, v_bad.detail);
  end loop;
  if exists (select 1 from public.test_items where container_id = v_x::uuid and import_ref like 'e:%') then
    raise exception 'FAILED: a refused add kept an item';
  end if;
  -- the update: trimmed, no rev bump, the limit, the type
  select rev into v_rev from public.test_items where id = pg_temp.item('b:2');
  r := public.container_item_update(pg_temp.item('b:2'), '{"explanation": "  Новое пояснение "}');
  if (r ->> 'rev')::int is distinct from v_rev or (r ->> 'rev_changed')::boolean
     or (select explanation from public.test_items where id = pg_temp.item('b:2')) is distinct from 'Новое пояснение' then
    raise exception 'FAILED: an explanation update %', r;
  end if;
  perform pg_temp.expect_error(format('select public.container_item_update(%L, %L)', pg_temp.item('b:2'),
    jsonb_build_object('explanation', repeat('я', 2001))), '22023', 'a long explanation', 'explanation');
  perform pg_temp.expect_error(format('select public.container_item_update(%L, %L)', pg_temp.item('b:2'), '{"explanation": 7}'),
    '22023', 'an explanation that is not a string', 'explanation');
  perform pg_temp.expect_error(format('select public.container_item_update(%L, %L)', pg_temp.item('b:2'), '{"explanation": null}'),
    '22023', 'a null explanation', 'explanation');
  r := public.container_item_update(pg_temp.item('b:2'), '{"explanation": "", "stem": "Чётные числа"}');
  if (r ->> 'rev')::int is distinct from v_rev
     or (select explanation from public.test_items where id = pg_temp.item('b:2')) is distinct from '' then
    raise exception 'FAILED: the explanation taken back %', r;
  end if;
  -- a key change still bumps rev (the guard compares the key, not the explanation)
  r := public.container_item_update(pg_temp.item('b:4'), '{"correct": [1], "explanation": "Ключ исправлен"}');
  if not (r ->> 'rev_changed')::boolean then raise exception 'FAILED: a key change with an explanation %', r; end if;
  r := public.container_item_update(pg_temp.item('b:4'), '{"correct": [0]}');

  -- exam Y: a picture and a quiz without guests
  r := public.container_create('Чужой экзамен', null, '[{"title":"Один"}]');
  v_y := r ->> 'container_id';
  perform pg_temp.put('y', v_y);
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'y:1', 'stem', 'Игрек', 'options', jsonb_build_array('а', 'б'), 'correct', jsonb_build_array(0),
                       'images', jsonb_build_object('stem', jsonb_build_array(pg_temp.pic(v_y, 5))))));
  r := public.quiz_create(v_y::uuid, '{"guests": false}');
  perform pg_temp.put('qy', r ->> 'id');
end
$t$;

-- 2. postgres: the pictures in the bucket, an unreferenced file of X; B becomes a member of X; the guard keeps rev for a
--    direct change of the explanation.
reset role;
insert into storage.objects (bucket_id, name)
select 'test-item-images', p from (values (pg_temp.pic(pg_temp.c('x'), 1)), (pg_temp.pic(pg_temp.c('x'), 2)),
  (pg_temp.pic(pg_temp.c('x'), 3)), (pg_temp.pic(pg_temp.c('x'), 4)), (pg_temp.pic(pg_temp.c('y'), 5)),
  (pg_temp.pic(pg_temp.c('x'), 6))) v(p);
insert into public.container_members (container_id, user_id) values (pg_temp.c('x')::uuid, 'bbbbbbbb-0000-0000-0000-000000000002');
do $t$
declare v_rev integer;
begin
  select rev into v_rev from public.test_items where id = pg_temp.item('b:3');
  update public.test_items set explanation = 'Столица Франции — Париж' where id = pg_temp.item('b:3');
  if (select rev from public.test_items where id = pg_temp.item('b:3')) is distinct from v_rev then
    raise exception 'FAILED: test_items_guard bumped rev for an explanation';
  end if;
end
$t$;

-- 3. Members read the explanation through the existing select; a stranger does not.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
begin
  if (select explanation from public.test_items where id = pg_temp.item('b:1')) is distinct from 'Потому что 2+2=4' then
    raise exception 'FAILED: a member reads the explanation';
  end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare v_sql text;
begin
  if exists (select 1 from public.test_items where id = pg_temp.item('b:1')) then
    raise exception 'FAILED: a stranger reads the items';
  end if;
  -- reorder: not the owner → 42501
  perform pg_temp.expect_error(format('select public.container_items_reorder(%L, %L)', pg_temp.c('s1'),
    array[pg_temp.item('b:4'), pg_temp.item('b:3'), pg_temp.item('b:2'), pg_temp.item('b:1')]), '42501', 'a stranger reorders');
end
$t$;

-- 4. A: reorder (the exact set; positions 1..n; rev stays) and the quiz settings.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare
  r jsonb; v_x uuid := pg_temp.c('x')::uuid; v_s1 uuid := pg_temp.c('s1')::uuid; v_bad record; v_revs text; v_pos text;
  v_row_keys constant text := 'accent,allow_back,attempts,closed_at,closes_at,code,container_id,cover_path,created_at,grading,'
    'guests,id,item_count,members_only,offer_practice,opens_at,pass_percent,review,same_set,shuffle_items,shuffle_options,'
    'started,state,subject_ids,time_limit_s,title,updated_at';
  v_cover text := pg_temp.c('x') || '/' || repeat('ab', 32) || '.webp';
begin
  perform pg_temp.expect_error(format('select public.container_items_reorder(%L, %L)', '99999999-0000-0000-0000-000000000009',
    array[pg_temp.item('b:1')]), 'P0002', 'reorder a missing subject', 'subject');
  for v_bad in select * from (values
      (array[pg_temp.item('b:1'), pg_temp.item('b:2'), pg_temp.item('b:3')], 'one missing'),
      (array[pg_temp.item('b:1'), pg_temp.item('b:1'), pg_temp.item('b:2'), pg_temp.item('b:3')], 'a duplicate'),
      (array[pg_temp.item('b:1'), pg_temp.item('b:2'), pg_temp.item('b:3'), pg_temp.item('b:5')], 'an item of another subject'),
      (array[pg_temp.item('b:1'), pg_temp.item('b:2'), pg_temp.item('b:3'), null], 'a null'),
      (array[pg_temp.item('b:1'), pg_temp.item('b:2'), pg_temp.item('b:3'), pg_temp.item('b:4'), pg_temp.item('b:5')], 'one too many'),
      (null::uuid[], 'null')) b(ids, what) loop
    perform pg_temp.expect_error(format('select public.container_items_reorder(%L, %L)', v_s1, v_bad.ids), '22023', 'reorder: ' || v_bad.what, 'items');
  end loop;
  select string_agg(rev::text, ',' order by import_ref) into v_revs from public.test_items where subject_id = v_s1;
  perform public.container_items_reorder(v_s1, array[pg_temp.item('b:4'), pg_temp.item('b:3'), pg_temp.item('b:2'), pg_temp.item('b:1')]);
  select string_agg(import_ref || '=' || position, ' ' order by position) into v_pos from public.test_items where subject_id = v_s1;
  if v_pos is distinct from 'b:4=1 b:3=2 b:2=3 b:1=4'
     or (select string_agg(rev::text, ',' order by import_ref) from public.test_items where subject_id = v_s1) is distinct from v_revs then
    raise exception 'FAILED: reorder %', v_pos;
  end if;
  perform public.container_items_reorder(v_s1, array[pg_temp.item('b:1'), pg_temp.item('b:2'), pg_temp.item('b:3'), pg_temp.item('b:4')]);
  select string_agg(import_ref || '=' || position, ' ' order by position) into v_pos from public.test_items where subject_id = v_s1;
  if v_pos is distinct from 'b:1=1 b:2=2 b:3=3 b:4=4' then raise exception 'FAILED: reorder back %', v_pos; end if;

  -- QG: the main guest quiz (S1, all four in exam order, review «answers», two attempts, the practice offer)
  r := public.quiz_create(v_x, jsonb_build_object('title', 'Гостевая', 'subject_ids', jsonb_build_array(v_s1), 'item_count', 4,
         'shuffle_items', false, 'review', 'answers', 'attempts', 2, 'offer_practice', true));
  if pg_temp.keys(r) is distinct from v_row_keys then raise exception 'FAILED: QuizRow keys %', pg_temp.keys(r); end if;
  if not (r ->> 'guests')::boolean or r ->> 'accent' is distinct from 'blue' or r -> 'cover_path' is distinct from 'null'::jsonb
     or not (r ->> 'offer_practice')::boolean or (r ->> 'members_only')::boolean then
    raise exception 'FAILED: the new defaults %', r;
  end if;
  perform pg_temp.put('qg', r ->> 'id');
  perform pg_temp.put('code_g', r ->> 'code');
  r := public.quiz_create(v_x, '{}');
  if not (r ->> 'guests')::boolean or (r ->> 'offer_practice')::boolean then raise exception 'FAILED: defaults of {} %', r; end if;
  perform pg_temp.put('q_default', r ->> 'id');
  -- refusals: 22023 with the key
  for v_bad in select * from (values
      ('{"guests": "yes"}', 'guests'), ('{"guests": null}', 'guests'), ('{"accent": "red"}', 'accent'), ('{"accent": 1}', 'accent'),
      ('{"accent": null}', 'accent'), ('{"cover_path": "x.png"}', 'cover_path'), ('{"cover_path": 5}', 'cover_path'),
      ('{"cover_path": "' || pg_temp.c('y') || '/' || repeat('ab', 32) || '.png"}', 'cover_path'),
      ('{"cover_path": "' || pg_temp.c('x') || '/' || repeat('ab', 32) || '.bmp"}', 'cover_path'),
      ('{"cover_path": "' || pg_temp.c('x') || '/' || repeat('AB', 32) || '.png"}', 'cover_path'),
      ('{"offer_practice": "true"}', 'offer_practice'), ('{"members_only": true, "guests": true}', 'guests')) b(settings, detail) loop
    perform pg_temp.expect_error(format('select public.quiz_create(%L, %L)', v_x, v_bad.settings), '22023', 'create ' || v_bad.settings, v_bad.detail);
  end loop;
  -- members_only turns guests off; guests cannot come back while members_only stays
  r := public.quiz_create(v_x, '{"members_only": true}');
  if (r ->> 'guests')::boolean or not (r ->> 'members_only')::boolean then raise exception 'FAILED: members_only ⇒ no guests %', r; end if;
  perform pg_temp.put('qm', r ->> 'id');
  perform pg_temp.put('code_m', r ->> 'code');
  perform pg_temp.expect_error(format('select public.quiz_update(%L, %L)', r ->> 'id', '{"guests": true}'), '22023', 'guests on a members-only quiz', 'guests');
  r := public.quiz_update((r ->> 'id')::uuid, '{"members_only": false, "guests": true}');
  if not (r ->> 'guests')::boolean or (r ->> 'members_only')::boolean then raise exception 'FAILED: members_only off, guests on %', r; end if;
  r := public.quiz_update((r ->> 'id')::uuid, '{"members_only": true}');
  if (r ->> 'guests')::boolean then raise exception 'FAILED: members_only on again %', r; end if;
  -- cover and colour
  r := public.quiz_update(pg_temp.c('q_default')::uuid, jsonb_build_object('cover_path', v_cover, 'accent', 'violet'));
  if r ->> 'cover_path' is distinct from v_cover or r ->> 'accent' is distinct from 'violet' then raise exception 'FAILED: cover %', r; end if;
  r := public.quiz_update(pg_temp.c('q_default')::uuid, '{"cover_path": null, "accent": "graphite"}');
  if r -> 'cover_path' is distinct from 'null'::jsonb or r ->> 'accent' is distinct from 'graphite' then raise exception 'FAILED: cover off %', r; end if;
  -- QH: review «mistakes_then_answers» (open: mistakes), one attempt, no offer. QOFF: no guests. QT, QI, QF, QP: S2.
  r := public.quiz_create(v_x, jsonb_build_object('title', 'Без ответов', 'subject_ids', jsonb_build_array(v_s1), 'item_count', 4, 'shuffle_items', false));
  perform pg_temp.put('qh', r ->> 'id');
  perform pg_temp.put('code_h', r ->> 'code');
  r := public.quiz_create(v_x, '{"guests": false}');
  if (r ->> 'guests')::boolean then raise exception 'FAILED: guests off %', r; end if;
  perform pg_temp.put('qoff', r ->> 'id');
  perform pg_temp.put('code_off', r ->> 'code');
  r := public.quiz_create(v_x, jsonb_build_object('subject_ids', jsonb_build_array(pg_temp.c('s2')), 'attempts', null));
  perform pg_temp.put('qt', r ->> 'id');
  perform pg_temp.put('code_t', r ->> 'code');
  r := public.quiz_create(v_x, jsonb_build_object('subject_ids', jsonb_build_array(pg_temp.c('s2')), 'attempts', null));
  perform pg_temp.put('code_i', r ->> 'code');
  r := public.quiz_create(v_x, jsonb_build_object('subject_ids', jsonb_build_array(pg_temp.c('s2')), 'attempts', null));
  perform pg_temp.put('qf', r ->> 'id');
  perform pg_temp.put('code_f', r ->> 'code');
  r := public.quiz_create(v_x, jsonb_build_object('subject_ids', jsonb_build_array(pg_temp.c('s2')), 'attempts', null, 'offer_practice', true));
  perform pg_temp.put('qp', r ->> 'id');
  perform pg_temp.put('code_p', r ->> 'code');
  -- the signed-in preview: the top level carries the settings; «me» as release 46 (no guest key)
  r := public.quiz_preview(pg_temp.c('code_g'), pg_temp.tok(1));
  if pg_temp.keys(r) is distinct from 'accent,allow_back,attempts,author_name,closes_at,cover_path,exam_title,grading,guests,item_count,'
       'me,members_only,offer_practice,opens_at,pass_percent,review,server_now,status,time_limit_s,title'
     or pg_temp.keys(r -> 'me') is distinct from 'attempts_used,can_start,is_author,is_member,name_hint,open_attempt,reason,results'
     or not (r -> 'me' ->> 'is_author')::boolean or not (r ->> 'guests')::boolean or not (r ->> 'offer_practice')::boolean then
    raise exception 'FAILED: the author''s preview %', r;
  end if;
end
$t$;

-- 5. postgres: the CHECK keeps members_only and guests apart.
reset role;
do $t$
begin
  perform pg_temp.expect_error(format('update public.quizzes set guests = true where id = %L', pg_temp.c('qm')), '23514', 'members_only and guests in the table');
  perform pg_temp.expect_error(format('update public.quizzes set cover_path = %L where id = %L',
    pg_temp.c('y') || '/' || repeat('ab', 32) || '.png', pg_temp.c('qg')), '23514', 'a cover of another exam in the table');
  perform pg_temp.expect_error(format('insert into public.quiz_attempts (quiz_id, name, n, item_ids) values (%L, %L, 1, %L)',
    pg_temp.c('qg'), 'Никто', array[pg_temp.item('b:1')]), '23514', 'an attempt of nobody');
  perform pg_temp.expect_error(format('insert into public.quiz_attempts (quiz_id, user_id, guest_hash, name, n, item_ids) values (%L, %L, %L, %L, 1, %L)',
    pg_temp.c('qg'), 'cccccccc-0000-0000-0000-000000000003', pg_temp.hash(pg_temp.tok(1)), 'Двое', array[pg_temp.item('b:1')]),
    '23514', 'an attempt of a user and a guest');
end
$t$;

-- 6. Anon, the guest: previews, refusals, the start without key or explanation, resume, answers, a wrong token, the
--    finish with the explanations of «answers», the second attempt, no third, «mistakes» hides the explanation.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare
  r jsonb; r2 jsonb; v_att text; v_sql text; v_me_keys constant text :=
    'attempts_used,can_start,guest,is_author,is_member,name_hint,open_attempt,reason,results';
begin
  -- the preview without a token, with one, with a malformed one: the device's «me» (nothing yet)
  foreach v_sql in array array[null, pg_temp.tok(1), 'короткий'] loop
    r := public.quiz_preview(pg_temp.c('code_g'), v_sql);
    if pg_temp.keys(r) is distinct from 'accent,allow_back,attempts,author_name,closes_at,cover_path,exam_title,grading,guests,item_count,'
         'me,members_only,offer_practice,opens_at,pass_percent,review,server_now,status,time_limit_s,title'
       or pg_temp.keys(r -> 'me') is distinct from v_me_keys
       or r -> 'me' -> 'name_hint' is distinct from 'null'::jsonb or not (r -> 'me' ->> 'guest')::boolean
       or (r -> 'me' ->> 'is_author')::boolean or (r -> 'me' ->> 'is_member')::boolean
       or (r -> 'me' ->> 'attempts_used')::int is distinct from 0 or r -> 'me' -> 'open_attempt' is distinct from 'null'::jsonb
       or not (r -> 'me' ->> 'can_start')::boolean or r -> 'me' -> 'reason' is distinct from 'null'::jsonb
       or r -> 'me' -> 'results' is distinct from '[]'::jsonb or not (r ->> 'guests')::boolean
       or r ->> 'accent' is distinct from 'blue' or not (r ->> 'offer_practice')::boolean
       or position('Потому что' in r::text) > 0 then
      raise exception 'FAILED: a guest''s preview (token %) %', v_sql, r;
    end if;
  end loop;
  -- the preview of the release-46 form (one argument) still answers
  if public.quiz_preview(pg_temp.c('code_g')) -> 'me' ->> 'guest' is distinct from 'true' then raise exception 'FAILED: preview(code)'; end if;
  -- signed out, no guests: «me» null (the page asks to sign in)
  r := public.quiz_preview(pg_temp.c('code_off'), pg_temp.tok(1));
  if r -> 'me' is distinct from 'null'::jsonb or (r ->> 'guests')::boolean then raise exception 'FAILED: preview without guests %', r; end if;
  r := public.quiz_preview(pg_temp.c('code_m'), pg_temp.tok(1));
  if r -> 'me' is distinct from 'null'::jsonb then raise exception 'FAILED: preview members only %', r; end if;
  -- refusals of the start
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', pg_temp.c('code_g'), 'Гость', 'короткий'), '22023', 'a malformed token', 'token');
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', pg_temp.c('code_g'), 'Гость', pg_temp.tok(1) || 'x'), '22023', 'a 44-character token', 'token');
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, null)', pg_temp.c('code_g'), 'Гость'), '22023', 'no token', 'token');
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', 'zzzzzzzzzzzz', 'Гость', pg_temp.tok(1)), 'P0002', 'an unknown code', 'quiz');
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', 'нет', 'Гость', pg_temp.tok(1)), 'P0002', 'a malformed code', 'quiz');
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', pg_temp.c('code_off'), 'Гость', pg_temp.tok(1)), 'MC017', 'guests off', 'guests');
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', pg_temp.c('code_m'), 'Гость', pg_temp.tok(1)), 'MC017', 'members only', 'guests');
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', pg_temp.c('code_g'), '  ', pg_temp.tok(1)), '22023', 'an empty name', 'name');
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', pg_temp.c('code_g'), ' Г ', pg_temp.tok(1)), '22023', 'a one-letter name', 'name');
  -- the signed-in functions stay closed to anon
  foreach v_sql in array array[
      format('select public.quiz_start(%L, %L)', pg_temp.c('code_g'), 'Гость'),
      format('select public.quiz_guest_claim(%L, %L)', pg_temp.c('code_g'), pg_temp.tok(1)),
      format('select public.quiz_practice_join(%L)', pg_temp.c('code_g')),
      format('select public.container_items_reorder(%L, %L)', pg_temp.c('s1'), array[pg_temp.item('b:1')]),
      format('select public.quiz_results(%L)', pg_temp.c('qg'))] loop
    perform pg_temp.expect_error(v_sql, '42501', 'anon: ' || v_sql);
  end loop;

  -- the start: the attempt as quiz_start gives it, without key or explanation
  r := public.quiz_guest_start(pg_temp.c('code_g'), '  Гость Г.  ', pg_temp.tok(1));
  if pg_temp.keys(r) is distinct from 'allow_back,answers,attempt_id,deadline_at,items,n,quiz_title,server_now,shuffle_options,started_at'
     or (r ->> 'n')::int is distinct from 1 or jsonb_array_length(r -> 'items') <> 4 or r -> 'answers' is distinct from '[]'::jsonb
     or r ->> 'quiz_title' is distinct from 'Гостевая' then
    raise exception 'FAILED: a guest''s start %', r;
  end if;
  if exists (select 1 from jsonb_array_elements(r -> 'items') x where pg_temp.keys(x) is distinct from 'code,id,images,keep_order,kind,options,stem')
     or position('"correct"' in r::text) > 0 or position('Париж' in r::text) > 0 or position('Потому что' in r::text) > 0
     or position('explanation' in r::text) > 0 or position('Столица Франции —' in r::text) > 0 then
    raise exception 'FAILED: the key or the explanation left the server %', r;
  end if;
  if (select string_agg(x ->> 'id', ',' order by o) from jsonb_array_elements(r -> 'items') with ordinality y(x, o))
     is distinct from concat_ws(',', pg_temp.item('b:1'), pg_temp.item('b:2'), pg_temp.item('b:3'), pg_temp.item('b:4')) then
    raise exception 'FAILED: a guest''s items in exam order %', r -> 'items';
  end if;
  v_att := r ->> 'attempt_id';
  perform pg_temp.put('g_att1', v_att);
  -- resume: the same attempt, the new name ignored
  r2 := public.quiz_guest_start(pg_temp.c('code_g'), 'Другое имя', pg_temp.tok(1));
  if r2 ->> 'attempt_id' is distinct from v_att or r2 -> 'items' is distinct from r -> 'items' then raise exception 'FAILED: a guest''s resume %', r2; end if;
  -- the preview knows the device's open attempt; another token knows nothing
  r := public.quiz_preview(pg_temp.c('code_g'), pg_temp.tok(1));
  if r -> 'me' ->> 'open_attempt' is distinct from v_att or (r -> 'me' ->> 'attempts_used')::int is distinct from 1
     or not (r -> 'me' ->> 'can_start')::boolean then
    raise exception 'FAILED: the device''s preview with an open attempt %', r -> 'me';
  end if;
  if (public.quiz_preview(pg_temp.c('code_g'), pg_temp.tok(2)) -> 'me' ->> 'attempts_used')::int is distinct from 0 then
    raise exception 'FAILED: another device sees the attempt';
  end if;
  -- answers: right b:1, wrong b:2, right b:3 (case and spaces)
  r := public.quiz_guest_answer(v_att::uuid, pg_temp.tok(1), jsonb_build_array(
         jsonb_build_object('item_id', pg_temp.item('b:1'), 'chosen', jsonb_build_array(1)),
         jsonb_build_object('item_id', pg_temp.item('b:2'), 'chosen', jsonb_build_array(0)),
         jsonb_build_object('item_id', pg_temp.item('b:3'), 'text', ' париж ')));
  if pg_temp.keys(r) is distinct from 'deadline_at,saved,server_now' or (r ->> 'saved')::int is distinct from 3 then
    raise exception 'FAILED: a guest''s answers %', r;
  end if;
  -- a wrong token: «no such attempt», for every call; a malformed one: 22023 token
  foreach v_sql in array array[
      format('select public.quiz_guest_answer(%L, %L, %L)', v_att, pg_temp.tok(2), jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('b:4'), 'chosen', jsonb_build_array(0)))),
      format('select public.quiz_guest_finish(%L, %L)', v_att, pg_temp.tok(2)),
      format('select public.quiz_guest_result(%L, %L)', v_att, pg_temp.tok(2)),
      format('select public.quiz_guest_finish(%L, %L)', '99999999-0000-0000-0000-000000000009', pg_temp.tok(1))] loop
    perform pg_temp.expect_error(v_sql, 'P0002', 'a wrong token: ' || v_sql, 'attempt');
  end loop;
  perform pg_temp.expect_error(format('select public.quiz_guest_finish(%L, %L)', v_att, 'короткий'), '22023', 'finish, a malformed token', 'token');
  perform pg_temp.expect_error(format('select public.quiz_guest_result(%L, %L)', v_att, pg_temp.tok(1)), '22023', 'the result of an open attempt', 'unfinished');
  -- the finish: Result + accent, practice; the explanations of «answers» ('' → null)
  r := public.quiz_guest_finish(v_att::uuid, pg_temp.tok(1));
  if pg_temp.keys(r) is distinct from 'accent,answers_after,attempt_id,attempts_left,can_retry,code,correct,finish_reason,finished_at,'
       'items,n,pass_percent,passed,percent,practice,quiz_title,review_now,shuffle_options,started_at,total' then
    raise exception 'FAILED: Result keys %', pg_temp.keys(r);
  end if;
  if exists (select 1 from jsonb_array_elements(r -> 'items') x
              where pg_temp.keys(x) is distinct from 'chosen,code,explanation,forms,id,images,keep_order,key,kind,options,right,stem,text') then
    raise exception 'FAILED: Result item keys %', pg_temp.keys(r -> 'items' -> 0);
  end if;
  if r ->> 'review_now' is distinct from 'answers' or (r ->> 'correct')::int is distinct from 2 or (r ->> 'total')::int is distinct from 4
     or r ->> 'finish_reason' is distinct from 'sent' or (r ->> 'attempts_left')::int is distinct from 1 or not (r ->> 'can_retry')::boolean
     or r ->> 'accent' is distinct from 'blue'
     or pg_temp.practice47(r -> 'practice') is distinct from jsonb_build_object('exam_title', 'Конструктор проверка', 'member', false)
     or pg_temp.find(r -> 'items', 'id', pg_temp.item('b:1')::text) ->> 'explanation' is distinct from 'Потому что 2+2=4'
     or pg_temp.find(r -> 'items', 'id', pg_temp.item('b:2')::text) -> 'explanation' is distinct from 'null'::jsonb
     or pg_temp.find(r -> 'items', 'id', pg_temp.item('b:3')::text) ->> 'explanation' is distinct from 'Столица Франции — Париж'
     or pg_temp.find(r -> 'items', 'id', pg_temp.item('b:4')::text) ->> 'explanation' is distinct from 'Ключ исправлен'
     or pg_temp.find(r -> 'items', 'id', pg_temp.item('b:1')::text) -> 'key' is distinct from '[1]'::jsonb then
    raise exception 'FAILED: a guest''s result %', r;
  end if;
  if public.quiz_guest_result(v_att::uuid, pg_temp.tok(1)) is distinct from r then raise exception 'FAILED: guest_result differs from guest_finish'; end if;
  if public.quiz_guest_finish(v_att::uuid, pg_temp.tok(1)) is distinct from r then raise exception 'FAILED: a second guest finish'; end if;
  perform pg_temp.expect_error(format('select public.quiz_guest_answer(%L, %L, %L)', v_att, pg_temp.tok(1),
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('b:4'), 'chosen', jsonb_build_array(0)))), 'MC012', 'a guest answers after the finish');
  -- the second attempt, then no third
  r := public.quiz_guest_start(pg_temp.c('code_g'), 'Гость Г.', pg_temp.tok(1));
  if (r ->> 'n')::int is distinct from 2 then raise exception 'FAILED: the guest''s second attempt %', r; end if;
  perform pg_temp.put('g_att2', r ->> 'attempt_id');
  r := public.quiz_guest_finish((r ->> 'attempt_id')::uuid, pg_temp.tok(1));
  if (r ->> 'attempts_left')::int is distinct from 0 or (r ->> 'can_retry')::boolean then raise exception 'FAILED: the second finish %', r; end if;
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', pg_temp.c('code_g'), 'Гость Г.', pg_temp.tok(1)), 'MC014', 'a third guest attempt of two', 'attempts');
  r := public.quiz_preview(pg_temp.c('code_g'), pg_temp.tok(1));
  if (r -> 'me' ->> 'attempts_used')::int is distinct from 2 or (r -> 'me' ->> 'can_start')::boolean
     or r -> 'me' ->> 'reason' is distinct from 'no_attempts' or jsonb_array_length(r -> 'me' -> 'results') <> 2
     or pg_temp.keys(r -> 'me' -> 'results' -> 0) is distinct from 'attempt_id,correct,finished_at,n,total'
     or (r -> 'me' -> 'results' -> 0 ->> 'correct')::int is distinct from 2 then
    raise exception 'FAILED: the device''s preview without attempts left %', r -> 'me';
  end if;
  -- another device writes QG once (for the claim later)
  r := public.quiz_guest_start(pg_temp.c('code_g'), 'Гость Д.', pg_temp.tok(2));
  perform pg_temp.put('g2_att', r ->> 'attempt_id');
  -- QH: «mistakes» while open — no key, no explanation; no practice offered
  r := public.quiz_guest_start(pg_temp.c('code_h'), 'Гость Г.', pg_temp.tok(1));
  r := public.quiz_guest_finish((r ->> 'attempt_id')::uuid, pg_temp.tok(1));
  if r ->> 'review_now' is distinct from 'mistakes' or r -> 'practice' is distinct from 'null'::jsonb
     or exists (select 1 from jsonb_array_elements(r -> 'items') x
                 where x -> 'explanation' is distinct from 'null'::jsonb or x -> 'key' is distinct from 'null'::jsonb)
     or position('Потому что' in r::text) > 0 then
    raise exception 'FAILED: «mistakes» shows an explanation %', r;
  end if;
  perform pg_temp.put('h_att', r ->> 'attempt_id');
  -- pictures: anon reads none of the bucket (no policy; the Storage API's list shows nothing), runs neither the media
  -- paths (service_role only) nor a listing function of an earlier draft
  if exists (select 1 from storage.objects where bucket_id = 'test-item-images') then
    raise exception 'FAILED: anon reads pictures %', (select string_agg(name, ',') from storage.objects);
  end if;
  perform pg_temp.expect_error(format('select public.quiz_guest_media_paths(%L, %L, %L)', pg_temp.c('g_att1'), pg_temp.tok(1),
    array[pg_temp.pic(pg_temp.c('x'), 1)]), '42501', 'anon runs quiz_guest_media_paths');
  perform pg_temp.expect_error('select public.guest_quiz_picture_paths()', '42883', 'anon calls public.guest_quiz_picture_paths');
end
$t$;

-- 7. C signed in on QG with the device's token: «me» is C's own (the token ignored), as release 46.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb;
begin
  r := public.quiz_preview(pg_temp.c('code_g'), pg_temp.tok(1));
  if pg_temp.keys(r -> 'me') is distinct from 'attempts_used,can_start,is_author,is_member,name_hint,open_attempt,reason,results'
     or (r -> 'me' ->> 'attempts_used')::int is distinct from 0 or r -> 'me' ->> 'name_hint' is distinct from 'Вера' then
    raise exception 'FAILED: a signed-in preview with a token %', r -> 'me';
  end if;
  -- a signed-in taker can write as the device too (its token), and sees the device's attempts by it
  r := public.quiz_guest_result(pg_temp.c('g_att1')::uuid, pg_temp.tok(1));
  if r ->> 'attempt_id' is distinct from pg_temp.c('g_att1') then raise exception 'FAILED: a signed-in caller with the token %', r; end if;
  -- the media paths are not for clients, signed in or not
  perform pg_temp.expect_error(format('select public.quiz_guest_media_paths(%L, %L, %L)', pg_temp.c('g_att1'), pg_temp.tok(1),
    array[pg_temp.pic(pg_temp.c('x'), 1)]), '42501', 'authenticated runs quiz_guest_media_paths');
end
$t$;

-- 7b. service_role (the Edge Function that signs a guest's picture URLs): the paths asked that are pictures of the
--     attempt's items, in the order asked, once; nothing for a wrong, malformed or missing token, another device's
--     attempt or no attempt; at most 60 paths.
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare
  v_x text := pg_temp.c('x');
  v_asked text[] := array[pg_temp.pic(v_x, 3), pg_temp.pic(v_x, 2), pg_temp.pic(v_x, 1), pg_temp.pic(v_x, 4),
                          pg_temp.pic(pg_temp.c('y'), 5), pg_temp.pic(v_x, 6), 'ничего', pg_temp.pic(v_x, 2), null];
  v_case record;
begin
  -- QG's attempt holds b:1..b:4 (S1): b:1's stem picture and b:2's option picture; not b:5's (S2, an item of the exam
  -- outside this attempt), not S3's, not exam Y's, not a file no item names
  if public.quiz_guest_media_paths(pg_temp.c('g_att1')::uuid, pg_temp.tok(1), v_asked)
     is distinct from array[pg_temp.pic(v_x, 2), pg_temp.pic(v_x, 1)] then
    raise exception 'FAILED: media paths of the attempt %', public.quiz_guest_media_paths(pg_temp.c('g_att1')::uuid, pg_temp.tok(1), v_asked);
  end if;
  -- the second device's open attempt: the same items, its own token
  if public.quiz_guest_media_paths(pg_temp.c('g2_att')::uuid, pg_temp.tok(2), v_asked)
     is distinct from array[pg_temp.pic(v_x, 2), pg_temp.pic(v_x, 1)] then
    raise exception 'FAILED: media paths of an open attempt';
  end if;
  for v_case in select * from (values
      (pg_temp.c('g_att1'), pg_temp.tok(2), 'another device''s token'), (pg_temp.c('g_att1'), 'короткий', 'a malformed token'),
      (pg_temp.c('g_att1'), null, 'no token'), (pg_temp.c('g2_att'), pg_temp.tok(1), 'the attempt of another device'),
      ('99999999-0000-0000-0000-000000000009', pg_temp.tok(1), 'no such attempt'), (null, pg_temp.tok(1), 'no attempt id')) c(att, token, what) loop
    if public.quiz_guest_media_paths(v_case.att::uuid, v_case.token, v_asked) is distinct from '{}'::text[] then
      raise exception 'FAILED: media paths for %', v_case.what;
    end if;
  end loop;
  if public.quiz_guest_media_paths(pg_temp.c('g_att1')::uuid, pg_temp.tok(1), null) is distinct from '{}'::text[]
     or public.quiz_guest_media_paths(pg_temp.c('g_att1')::uuid, pg_temp.tok(1), '{}') is distinct from '{}'::text[] then
    raise exception 'FAILED: media paths of no paths';
  end if;
  -- 60 paths at once pass; 61 are refused (22023 paths), whatever the token
  if public.quiz_guest_media_paths(pg_temp.c('g_att1')::uuid, pg_temp.tok(1), array_fill(pg_temp.pic(v_x, 1), array[60]))
     is distinct from array[pg_temp.pic(v_x, 1)] then
    raise exception 'FAILED: 60 paths';
  end if;
  perform pg_temp.expect_error(format('select public.quiz_guest_media_paths(%L, %L, %L)', pg_temp.c('g_att1'), pg_temp.tok(2),
    array_fill(pg_temp.pic(v_x, 1), array[61])), '22023', '61 paths', 'paths');
end
$t$;
reset role;
set local role authenticated;

-- 8. A: the results with the guest flag and person; a guest's attempt starts the quiz (locks the draw settings); the
--    four settings stay free; guests off for a while.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb; a jsonb; v_row jsonb;
begin
  r := public.quiz_results(pg_temp.c('qg')::uuid);
  if not (r -> 'quiz' ->> 'started')::boolean or jsonb_array_length(r -> 'attempts') <> 3 then
    raise exception 'FAILED: results of guests %', r;
  end if;
  a := pg_temp.find(r -> 'attempts', 'id', pg_temp.c('g_att1'));
  if pg_temp.keys(a) is distinct from 'answered,correct,deadline_at,finish_reason,finished_at,guest,id,n,name,own,person,started_at,total' then
    raise exception 'FAILED: attempt row keys %', pg_temp.keys(a);
  end if;
  if not (a ->> 'guest')::boolean or (a ->> 'own')::boolean or a ->> 'name' is distinct from 'Гость Г.' or (a ->> 'correct')::int is distinct from 2
     or a ->> 'person' is distinct from left(md5(pg_temp.hash(pg_temp.tok(1)) || pg_temp.c('qg')), 16)
     or pg_temp.find(r -> 'attempts', 'id', pg_temp.c('g_att2')) ->> 'person' is distinct from a ->> 'person'
     or pg_temp.find(r -> 'attempts', 'id', pg_temp.c('g2_att')) ->> 'person' = a ->> 'person' then
    raise exception 'FAILED: a guest''s row %', r -> 'attempts';
  end if;
  -- the guests' answers count in the question stats
  if (pg_temp.find(r -> 'items', 'item_id', pg_temp.item('b:1')::text) ->> 'shown')::int is distinct from 3
     or (pg_temp.find(r -> 'items', 'item_id', pg_temp.item('b:1')::text) ->> 'correct')::int is distinct from 1 then
    raise exception 'FAILED: guests in the question stats %', r -> 'items';
  end if;
  -- quiz_list: two devices are two people; the average counts the guests' finished attempts (2/4 and 0/4 → 25.0)
  v_row := pg_temp.find(public.quiz_list(pg_temp.c('x')::uuid), 'id', pg_temp.c('qg'));
  if (v_row ->> 'people')::int is distinct from 2 or (v_row ->> 'finished')::int is distinct from 2 or (v_row ->> 'writing')::int is distinct from 1
     or (v_row ->> 'avg_percent')::numeric is distinct from 25.0 or not (v_row ->> 'started')::boolean or not (v_row ? 'guests') then
    raise exception 'FAILED: quiz_list with guests %', v_row;
  end if;
  -- started by guests only: the draw settings are locked, the four new ones are not
  perform pg_temp.expect_error(format('select public.quiz_update(%L, %L)', pg_temp.c('qg'), '{"item_count": 3}'), 'MC011', 'locked after a guest started', 'item_count');
  r := public.quiz_update(pg_temp.c('qg')::uuid, jsonb_build_object('accent', 'green', 'offer_practice', true, 'guests', true,
         'cover_path', pg_temp.c('x') || '/' || repeat('cd', 32) || '.jpg'));
  if r ->> 'accent' is distinct from 'green' or r ->> 'cover_path' is distinct from pg_temp.c('x') || '/' || repeat('cd', 32) || '.jpg' then
    raise exception 'FAILED: the new settings after the start %', r;
  end if;
  r := public.quiz_update(pg_temp.c('qg')::uuid, '{"guests": false}');
  if (r ->> 'guests')::boolean then raise exception 'FAILED: guests off %', r; end if;
end
$t$;

-- 9. Anon while QG takes no guests: «me» null, no start; the device's result is still readable (no retry).
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare r jsonb;
begin
  if public.quiz_preview(pg_temp.c('code_g'), pg_temp.tok(1)) -> 'me' is distinct from 'null'::jsonb then
    raise exception 'FAILED: guests off, «me» shown';
  end if;
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', pg_temp.c('code_g'), 'Гость', pg_temp.tok(3)), 'MC017', 'guests switched off', 'guests');
  r := public.quiz_guest_result(pg_temp.c('g_att1')::uuid, pg_temp.tok(1));
  if (r ->> 'can_retry')::boolean or r ->> 'accent' is distinct from 'green' then raise exception 'FAILED: a result with guests off %', r; end if;
  -- the open attempt of the second device still takes answers and finishes
  r := public.quiz_guest_finish(pg_temp.c('g2_att')::uuid, pg_temp.tok(2));
  if (r ->> 'can_retry')::boolean then raise exception 'FAILED: a retry with guests off %', r; end if;
end
$t$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select public.quiz_update(pg_temp.c('qg')::uuid, '{"guests": true}') is null;

-- 10. The throttle. QT: 120 guest starts in a minute from 120 addresses pass, the 121st is refused (MC016); a resume is
--     not a start; a signed-in start is not throttled. QI: 30 starts a minute from one address pass, the 31st is refused;
--     another address and no address pass.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare r jsonb;
begin
  for i in 1..120 loop
    perform set_config('request.headers', json_build_object('x-forwarded-for', '10.9.' || (i / 200) || '.' || (i % 200))::text, true);
    perform public.quiz_guest_start(pg_temp.c('code_t'), 'Гость ' || i, pg_temp.tok(1000 + i));
  end loop;
  perform set_config('request.headers', '{"x-forwarded-for": "10.8.0.1"}', true);
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', pg_temp.c('code_t'), 'Гость 121', pg_temp.tok(1121)), 'MC016', 'the 121st guest start in a minute', 'busy');
  r := public.quiz_guest_start(pg_temp.c('code_t'), 'Гость 1', pg_temp.tok(1001));
  if (r ->> 'n')::int is distinct from 1 then raise exception 'FAILED: a resume under the throttle %', r; end if;
  -- one address: «203.0.113.7» first in x-forwarded-for
  perform set_config('request.headers', '{"x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "test"}', true);
  for i in 1..30 loop
    perform public.quiz_guest_start(pg_temp.c('code_i'), 'Адрес ' || i, pg_temp.tok(2000 + i));
  end loop;
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', pg_temp.c('code_i'), 'Адрес 31', pg_temp.tok(2031)), 'MC016', 'the 31st start from one address', 'busy');
  perform set_config('request.headers', '{"x-forwarded-for": " 203.0.113.7 "}', true);
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', pg_temp.c('code_i'), 'Адрес 31', pg_temp.tok(2031)), 'MC016', 'the same address with spaces', 'busy');
  perform set_config('request.headers', '{"x-forwarded-for": "198.51.100.1"}', true);
  perform public.quiz_guest_start(pg_temp.c('code_i'), 'Другой адрес', pg_temp.tok(2032));
  perform set_config('request.headers', '', true);
  perform public.quiz_guest_start(pg_temp.c('code_i'), 'Без адреса', pg_temp.tok(2033));
  perform set_config('request.headers', 'не json', true);
  perform public.quiz_guest_start(pg_temp.c('code_i'), 'Сломанный заголовок', pg_temp.tok(2034));
end
$t$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.7"}', true);
do $t$
begin
  -- a signed-in start meets neither throttle
  perform public.quiz_start(pg_temp.c('code_t'), 'Вера');
  perform public.quiz_start(pg_temp.c('code_i'), 'Вера');
end
$t$;
-- postgres: the addresses are kept hashed; a minute later the throttles let guests in again, and the old rows go.
reset role;
do $t$
begin
  if (select count(*) from meldy_private.quiz_guest_starts where ip_hash = pg_temp.ip_hash('203.0.113.7')) <> 30
     or (select count(*) from meldy_private.quiz_guest_starts) <> 151 then
    raise exception 'FAILED: the address rows %', (select count(*) from meldy_private.quiz_guest_starts);
  end if;
  update meldy_private.quiz_guest_starts set started_at = now() - interval '2 minutes';
  update public.quiz_attempts set started_at = now() - interval '2 minutes' where quiz_id = pg_temp.c('qt')::uuid and guest_hash is not null;
end
$t$;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.7"}', true);
do $t$
begin
  perform public.quiz_guest_start(pg_temp.c('code_t'), 'Через минуту', pg_temp.tok(1122));
  perform public.quiz_guest_start(pg_temp.c('code_i'), 'Через минуту', pg_temp.tok(2035));
end
$t$;
reset role;
do $t$
begin
  if (select count(*) from meldy_private.quiz_guest_starts) <> 2
     or exists (select 1 from meldy_private.quiz_guest_starts where started_at < now()) then
    raise exception 'FAILED: the throttle rows after a minute %', (select count(*) from meldy_private.quiz_guest_starts);
  end if;
  -- QF: 2000 guest attempts (finished, two minutes ago)
  insert into public.quiz_attempts (quiz_id, guest_hash, name, n, item_ids, started_at, finished_at, finish_reason)
  select pg_temp.c('qf')::uuid, encode(sha256(convert_to('filler' || g, 'UTF8')), 'hex'), 'Гость', 1, array[pg_temp.item('b:5')],
         now() - interval '2 minutes', now() - interval '1 minute', 'sent'
    from generate_series(1, 2000) g;
end
$t$;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.headers', '', true);
do $t$
declare r jsonb;
begin
  perform pg_temp.expect_error(format('select public.quiz_guest_start(%L, %L, %L)', pg_temp.c('code_f'), 'Гость', pg_temp.tok(3000)), 'MC014', 'past 2000 guest attempts', 'full');
  r := public.quiz_preview(pg_temp.c('code_f'), pg_temp.tok(3000));
  if (r -> 'me' ->> 'can_start')::boolean or r -> 'me' ->> 'reason' is distinct from 'no_attempts' then
    raise exception 'FAILED: the preview of a quiz full of guests %', r -> 'me';
  end if;
end
$t$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
do $t$
declare r jsonb;
begin
  -- the 2000 is the guests' room only: a signed-in taker still starts
  r := public.quiz_start(pg_temp.c('code_f'), 'Дмитрий');
  if (r ->> 'n')::int is distinct from 1 then raise exception 'FAILED: a signed-in start on a quiz full of guests %', r; end if;
end
$t$;

-- 11. The claim: C has nothing in QH → the device's attempt becomes C's; QG: C has none → two move; again with another
--     token while C has attempts → 0; refusals.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb;
begin
  perform pg_temp.expect_error(format('select public.quiz_guest_claim(%L, %L)', pg_temp.c('code_h'), 'короткий'), '22023', 'claim, a malformed token', 'token');
  perform pg_temp.expect_error(format('select public.quiz_guest_claim(%L, %L)', 'zzzzzzzzzzzz', pg_temp.tok(1)), 'P0002', 'claim, an unknown code', 'quiz');
  if public.quiz_guest_claim(pg_temp.c('code_h'), pg_temp.tok(77)) is distinct from '{"claimed": 0}'::jsonb then
    raise exception 'FAILED: a claim of a token without attempts';
  end if;
  r := public.quiz_guest_claim(pg_temp.c('code_h'), pg_temp.tok(1));
  if r is distinct from '{"claimed": 1}'::jsonb then raise exception 'FAILED: claim QH %', r; end if;
  r := public.quiz_preview(pg_temp.c('code_h'));
  if (r -> 'me' ->> 'attempts_used')::int is distinct from 1 or r -> 'me' ->> 'name_hint' is distinct from 'Гость Г.'
     or jsonb_array_length(r -> 'me' -> 'results') <> 1 then
    raise exception 'FAILED: C after the claim %', r -> 'me';
  end if;
  r := public.quiz_result(pg_temp.c('h_att')::uuid);
  if r ->> 'attempt_id' is distinct from pg_temp.c('h_att') then raise exception 'FAILED: C reads the claimed result %', r; end if;
  r := public.quiz_guest_claim(pg_temp.c('code_g'), pg_temp.tok(1));
  if r is distinct from '{"claimed": 2}'::jsonb then raise exception 'FAILED: claim QG %', r; end if;
  -- the second device's attempt stays the device's: C has attempts now
  r := public.quiz_guest_claim(pg_temp.c('code_g'), pg_temp.tok(2));
  if r is distinct from '{"claimed": 0}'::jsonb then raise exception 'FAILED: a claim on top of own attempts %', r; end if;
  -- C continues as C: two attempts used of two
  r := public.quiz_preview(pg_temp.c('code_g'));
  if (r -> 'me' ->> 'attempts_used')::int is distinct from 2 or r -> 'me' ->> 'reason' is distinct from 'no_attempts' then
    raise exception 'FAILED: C''s preview after the claim %', r -> 'me';
  end if;
end
$t$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
begin
  -- the token no longer opens the claimed attempts
  perform pg_temp.expect_error(format('select public.quiz_guest_result(%L, %L)', pg_temp.c('g_att1'), pg_temp.tok(1)), 'P0002', 'a claimed attempt by its old token', 'attempt');
  if (public.quiz_preview(pg_temp.c('code_g'), pg_temp.tok(1)) -> 'me' ->> 'attempts_used')::int is distinct from 0 then
    raise exception 'FAILED: the device still counts the claimed attempts';
  end if;
  if (public.quiz_preview(pg_temp.c('code_g'), pg_temp.tok(2)) -> 'me' ->> 'attempts_used')::int is distinct from 1 then
    raise exception 'FAILED: the second device lost its attempt';
  end if;
end
$t$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare a jsonb; r jsonb;
begin
  r := public.quiz_results(pg_temp.c('qg')::uuid);
  a := pg_temp.find(r -> 'attempts', 'id', pg_temp.c('g_att1'));
  if (a ->> 'guest')::boolean or a ->> 'person' is distinct from left(md5('cccccccc-0000-0000-0000-000000000003' || pg_temp.c('qg')), 16)
     or not (pg_temp.find(r -> 'attempts', 'id', pg_temp.c('g2_att')) ->> 'guest')::boolean then
    raise exception 'FAILED: the claimed rows %', r -> 'attempts';
  end if;
end
$t$;
-- service_role after the claim: a user's attempt gives no paths by its old token; a guest's attempt on S2 (QT) gives
-- b:5's picture only.
reset role;
select pg_temp.put('t_att', (select id::text from public.quiz_attempts where guest_hash = pg_temp.hash(pg_temp.tok(1001))));
set local role service_role;
do $t$
declare v_x text := pg_temp.c('x');
begin
  if public.quiz_guest_media_paths(pg_temp.c('g_att1')::uuid, pg_temp.tok(1), array[pg_temp.pic(v_x, 1), pg_temp.pic(v_x, 2)])
     is distinct from '{}'::text[] then
    raise exception 'FAILED: media paths of a claimed (user''s) attempt';
  end if;
  if public.quiz_guest_media_paths(pg_temp.c('t_att')::uuid, pg_temp.tok(1001),
       array[pg_temp.pic(v_x, 1), pg_temp.pic(v_x, 2), pg_temp.pic(v_x, 3), pg_temp.pic(v_x, 4)])
     is distinct from array[pg_temp.pic(v_x, 3)] then
    raise exception 'FAILED: media paths of a QT attempt';
  end if;
end
$t$;
reset role;
set local role authenticated;

-- 12. Practice. QH offers none (MC018 practice); QP: E without a finished attempt → MC018; finished → a member row as
--     container_join writes one; again → nothing new; left → back; removed → MC018 removed; the author → own exam,
--     nothing written; 200 active members → MC018 full; a guest's result offers it with member false.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
begin
  perform pg_temp.expect_error(format('select public.quiz_practice_join(%L)', pg_temp.c('code_h')), 'MC018', 'no practice offered', 'practice');
  perform pg_temp.expect_error(format('select public.quiz_practice_join(%L)', 'zzzzzzzzzzzz'), 'P0002', 'practice, an unknown code', 'quiz');
end
$t$;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', true);
do $t$
declare r jsonb; v_att uuid; m record;
begin
  r := public.quiz_start(pg_temp.c('code_p'), 'Ева');
  v_att := (r ->> 'attempt_id')::uuid;
  perform pg_temp.expect_error(format('select public.quiz_practice_join(%L)', pg_temp.c('code_p')), 'MC018', 'practice before the finish', 'practice');
  r := public.quiz_finish(v_att);
  if pg_temp.practice47(r -> 'practice') is distinct from jsonb_build_object('exam_title', 'Конструктор проверка', 'member', false) then
    raise exception 'FAILED: practice offered to a signed-in taker %', r -> 'practice';
  end if;
  if exists (select 1 from public.test_items where container_id = pg_temp.c('x')::uuid) then
    raise exception 'FAILED: E reads the items before joining';
  end if;
  -- with the guards the join waits for the closing: exam X's quizzes closed until the author's start below
  perform pg_temp.x_quizzes(true);
  r := public.quiz_practice_join(pg_temp.c('code_p'));
  if r is distinct from jsonb_build_object('container_id', pg_temp.c('x')) then raise exception 'FAILED: practice join %', r; end if;
  perform pg_temp.put('e_att', v_att::text);
end
$t$;
-- the member row: link_id null, active, joined now (as container_join writes one, without a link)
reset role;
do $t$
declare m record;
begin
  select * into m from public.container_members where container_id = pg_temp.c('x')::uuid and user_id = 'eeeeeeee-0000-0000-0000-000000000005';
  if not found or m.link_id is not null or m.left_at is not null or m.removed_at is not null or m.joined_at is distinct from now() then
    raise exception 'FAILED: the member row %', row_to_json(m);
  end if;
end
$t$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', true);
do $t$
declare v_att uuid := pg_temp.c('e_att')::uuid;
begin
  -- the items readable at once
  if (select count(*) from public.test_items where container_id = pg_temp.c('x')::uuid) <> 6 then
    raise exception 'FAILED: a practice member reads the items';
  end if;
  if (public.quiz_result(v_att) -> 'practice' ->> 'member')::boolean is distinct from true then
    raise exception 'FAILED: practice.member after the join';
  end if;
  if public.quiz_practice_join(pg_temp.c('code_p')) is distinct from jsonb_build_object('container_id', pg_temp.c('x')) then
    raise exception 'FAILED: practice join again';
  end if;
  -- left → back
  perform public.container_leave(pg_temp.c('x')::uuid);
  if exists (select 1 from public.test_items where container_id = pg_temp.c('x')::uuid) then raise exception 'FAILED: E left'; end if;
  perform public.quiz_practice_join(pg_temp.c('code_p'));
  if (select count(*) from public.test_items where container_id = pg_temp.c('x')::uuid) <> 6 then raise exception 'FAILED: E back'; end if;
end
$t$;
reset role;
do $t$
begin
  if (select count(*) from public.container_members where container_id = pg_temp.c('x')::uuid and user_id = 'eeeeeeee-0000-0000-0000-000000000005') <> 1 then
    raise exception 'FAILED: one member row for E';
  end if;
end
$t$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare r jsonb;
begin
  perform public.container_member_remove(pg_temp.c('x')::uuid, 'eeeeeeee-0000-0000-0000-000000000005');
  perform pg_temp.x_quizzes(false);
  -- the author: their own exam back, nothing written; their own result offers nothing
  r := public.quiz_start(pg_temp.c('code_p'), 'Автор');
  r := public.quiz_finish((r ->> 'attempt_id')::uuid);
  if r -> 'practice' is distinct from 'null'::jsonb then raise exception 'FAILED: practice offered to the author %', r -> 'practice'; end if;
  r := public.quiz_practice_join(pg_temp.c('code_p'));
  if r is distinct from jsonb_build_object('container_id', pg_temp.c('x')) then raise exception 'FAILED: the author''s practice %', r; end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-0000-0000-000000000005', true);
do $t$
begin
  perform pg_temp.x_quizzes(true);
  perform pg_temp.expect_error(format('select public.quiz_practice_join(%L)', pg_temp.c('code_p')), 'MC018', 'removed by the author', 'removed');
end
$t$;
reset role;
do $t$
begin
  if exists (select 1 from public.container_members where container_id = pg_temp.c('x')::uuid and user_id = 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'FAILED: the author became a member';
  end if;
  -- 200 active members (B and 199 more)
  insert into auth.users (id) select ('f0000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 199) g;
  insert into public.container_members (container_id, user_id)
  select pg_temp.c('x')::uuid, ('f0000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 199) g;
end
$t$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', true);
do $t$
declare r jsonb;
begin
  perform pg_temp.x_quizzes(false);
  r := public.quiz_start(pg_temp.c('code_p'), 'Дмитрий');
  perform public.quiz_finish((r ->> 'attempt_id')::uuid);
  perform pg_temp.x_quizzes(true);
  perform pg_temp.expect_error(format('select public.quiz_practice_join(%L)', pg_temp.c('code_p')), 'MC018', 'the 201st member', 'full');
end
$t$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
declare r jsonb;
begin
  perform pg_temp.x_quizzes(false);
  r := public.quiz_guest_start(pg_temp.c('code_p'), 'Гость практики', pg_temp.tok(4000));
  r := public.quiz_guest_finish((r ->> 'attempt_id')::uuid, pg_temp.tok(4000));
  if pg_temp.practice47(r -> 'practice') is distinct from jsonb_build_object('exam_title', 'Конструктор проверка', 'member', false) then
    raise exception 'FAILED: practice offered to a guest %', r -> 'practice';
  end if;
end
$t$;

-- 13. Pictures: anon reads no question picture whatever the quizzes — here exam Y's quiz takes guests and is closed,
--     and guests have written X's quizzes.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select public.quiz_update(pg_temp.c('qy')::uuid, '{"guests": true}') is null;
select public.quiz_close(pg_temp.c('qy')::uuid) is null;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
begin
  if exists (select 1 from storage.objects where bucket_id = 'test-item-images') then
    raise exception 'FAILED: anon reads a question picture %', (select string_agg(name, ',') from storage.objects);
  end if;
end
$t$;

-- 14. Covers: only the exam's owner writes (and reads through the API) its folder of quiz-covers.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare r jsonb;
begin
  r := public.container_create('Экзамен Веры', null, '[{"title":"Один"}]');
  perform pg_temp.put('c_exam', r ->> 'container_id');
end
$t$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare v_n integer; v_cover text := pg_temp.c('x') || '/' || repeat('ef', 32) || '.png';
begin
  insert into storage.objects (bucket_id, name) values ('quiz-covers', v_cover);
  perform pg_temp.put('cover', v_cover);
  perform pg_temp.expect_error(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'quiz-covers',
    pg_temp.c('c_exam') || '/' || repeat('ef', 32) || '.png'), '42501', 'a cover into another author''s folder');
  perform pg_temp.expect_error(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'quiz-covers', 'cover.png'),
    '42501', 'a cover outside any folder');
  update storage.objects set metadata = '{"size": 1}' where bucket_id = 'quiz-covers' and name = v_cover;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'FAILED: the owner updates the cover'; end if;
  perform pg_temp.expect_error(format('update storage.objects set name = %L where bucket_id = %L and name = %L',
    pg_temp.c('c_exam') || '/' || repeat('ef', 32) || '.png', 'quiz-covers', v_cover), '42501', 'a cover moved to another folder');
end
$t$;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare v_n integer;
begin
  if exists (select 1 from storage.objects where bucket_id = 'quiz-covers') then raise exception 'FAILED: C lists A''s covers'; end if;
  update storage.objects set metadata = '{}' where bucket_id = 'quiz-covers' and name = pg_temp.c('cover');
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAILED: C updates A''s cover'; end if;
  delete from storage.objects where bucket_id = 'quiz-covers' and name = pg_temp.c('cover');
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAILED: C deletes A''s cover'; end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare v_n integer;
begin
  delete from storage.objects where bucket_id = 'quiz-covers' and name = pg_temp.c('cover');
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'FAILED: the owner deletes the cover'; end if;
end
$t$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $t$
begin
  perform pg_temp.expect_error(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'quiz-covers',
    pg_temp.c('x') || '/' || repeat('ef', 32) || '.png'), '42501', 'anon uploads a cover');
end
$t$;
reset role;
select 'BUILDER BEHAVIOUR PASSED';
rollback;
