-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261107090300_ai_key_flag.sql on the
-- scratch database of ai_key_flag_run.sh. One transaction, rolled back. A = aaaa…1 (the author, linked as Telegram user
-- 4807), B = aaaa…2 (someone else). Covers: container_item_update with correct and ai_key true puts 'ai_key' into flags
-- once (key_source 'manual', rev raised, the key-change history as before) and says ai_key in its result; ai_key true on
-- a question that has a key already (the author set one by hand during the run) is 22023 'keyed' and changes nothing;
-- a change that is not the key keeps the flag; a key change without ai_key takes it out, ai_key false alone too, and so
-- does any other change that moves rev (an option added, single turned multiple); ai_key that is not a boolean, true
-- without a non-empty correct, or true on a question that is not single or multiple choice is 22023 'ai_key' and
-- changes nothing; B cannot patch A's question (P0002) and no API role writes test_items directly; container_items_add
-- keeps the flag the import sends; the bot's review after an answer says ai_key true for such a key and false for
-- another; «Вопрос дня» (bot.group_item_ok) never takes a key from the AI. A failure raises; success prints AI KEY FLAG
-- BEHAVIOUR PASSED.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.ok(p boolean, p_what text) returns void language plpgsql as $fn$
begin
  if p is distinct from true then raise exception 'FAILED: %', p_what; end if;
end;
$fn$;
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_detail text, p_what text)
returns void language plpgsql as $fn$
declare
  v_detail text;
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_state;
exception
  when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if sqlstate is distinct from p_state or (p_detail is not null and v_detail is distinct from p_detail) then
      raise exception 'FAILED: % — SQLSTATE % (%, %), expected % %', p_what, sqlstate, sqlerrm, v_detail, p_state, p_detail;
    end if;
end;
$fn$;
create or replace function pg_temp.as_role(p_role text, p_sub uuid default null)
returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  perform set_config('request.jwt.claim.role', '', true);
  if p_role = 'postgres' then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', p_sub)::text, true);
    execute format('set local role %I', p_role);
  end if;
end;
$fn$;
create temp table ctx (k text primary key, v text);
grant all on ctx to anon, authenticated, service_role;
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = p_k
$fn$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into pg_temp.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
-- the row as postgres sees it: flags, key_source, rev, correct
create or replace function pg_temp.row(p_ref text) returns text language sql stable security definer as $fn$
  select i.flags::text || ' ' || i.key_source || ' ' || i.rev || ' ' || i.correct::text
    from public.test_items i where i.id = (select v from pg_temp.ctx where k = p_ref)::uuid
$fn$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('s', (public.container_create('Ключи от ИИ', null, '[{"title":"Сети"}]') -> 'subjects' -> 0 ->> 'id'));
select public.container_items_add(pg_temp.c('s')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'k:1', 'kind', 'single', 'stem', 'Какой порт у HTTP?', 'options', jsonb_build_array('21', '80', '443'),
                     'correct', '[]'::jsonb, 'flags', jsonb_build_array('no_key')),
  jsonb_build_object('ref', 'k:2', 'kind', 'single', 'stem', 'Какой порт у SSH?', 'options', jsonb_build_array('22', '25'),
                     'correct', jsonb_build_array(0)),
  -- the import's own path: a key from the AI comes with its flag (container_items_add took flags before this file)
  jsonb_build_object('ref', 'k:3', 'kind', 'single', 'stem', 'Какой порт у DNS?', 'options', jsonb_build_array('53', '67'),
                     'correct', jsonb_build_array(0), 'key_source', 'manual', 'flags', jsonb_build_array('ai_key')),
  jsonb_build_object('ref', 'k:4', 'kind', 'single', 'stem', 'Какой порт у FTP?', 'options', jsonb_build_array('21', '20'),
                     'correct', '[]'::jsonb, 'flags', jsonb_build_array('ai_key')),
  jsonb_build_object('ref', 'k:5', 'kind', 'single', 'stem', 'Какой порт у SMTP?', 'options', jsonb_build_array('25', '110', '143'),
                     'correct', '[]'::jsonb),
  jsonb_build_object('ref', 'k:6', 'kind', 'single', 'stem', 'Какие порты у почты?', 'options', jsonb_build_array('25', '110', '80'),
                     'correct', '[]'::jsonb),
  jsonb_build_object('ref', 'k:7', 'kind', 'single', 'stem', 'Какой порт у DHCP?', 'options', jsonb_build_array('67', '53'),
                     'correct', jsonb_build_array(0), 'key_source', 'manual', 'flags', jsonb_build_array('ai_key')),
  jsonb_build_object('ref', 'k:8', 'kind', 'short', 'stem', 'Как называется порт 80?', 'answers', jsonb_build_array('HTTP'),
                     'key_source', 'answer_line'),
  jsonb_build_object('ref', 'k:9', 'kind', 'single', 'stem', 'Какой порт у POP3?', 'options', jsonb_build_array('110', '995'),
                     'correct', '[]'::jsonb)));
select pg_temp.as_role('postgres');
insert into pg_temp.ctx select replace(i.import_ref, ':', ''), i.id::text from public.test_items i where i.subject_id = pg_temp.c('s')::uuid;
select pg_temp.put('x', (select container_id::text from public.container_subjects where id = pg_temp.c('s')::uuid));
select pg_temp.ok(pg_temp.row('k3') = '{ai_key} manual 1 {0}', 'the import keeps the flag: ' || pg_temp.row('k3'));

select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $do$
declare
  r jsonb;
begin
  -- a key from «Подобрать ключи с ИИ»: the key, key_source 'manual', the flag once; the history as for any key change
  r := public.container_item_update(pg_temp.c('k1')::uuid, '{"correct": [1], "ai_key": true}');
  perform pg_temp.ok((r ->> 'rev_changed')::boolean and (r ->> 'rev')::integer = 2 and (r -> 'ai_key') = 'true'::jsonb,
                     'the key changed, the mark stored: ' || r::text);
  perform pg_temp.ok(pg_temp.row('k1') = '{no_key,ai_key} manual 2 {1}', 'ai_key true: ' || pg_temp.row('k1'));
  -- a keyless row that carries the mark already gets it once
  r := public.container_item_update(pg_temp.c('k4')::uuid, '{"correct": [0], "ai_key": true}');
  perform pg_temp.ok(pg_temp.row('k4') = '{ai_key} manual 2 {0}', 'the flag once: ' || pg_temp.row('k4'));
  -- not the key: the flag stays
  r := public.container_item_update(pg_temp.c('k1')::uuid, '{"stem": "Какой порт у HTTP по умолчанию?"}');
  perform pg_temp.ok(pg_temp.row('k1') = '{no_key,ai_key} manual 2 {1}' and (r -> 'ai_key') = 'true'::jsonb,
                     'a change of the text keeps it: ' || pg_temp.row('k1'));
  -- the author changes the key: the flag goes
  r := public.container_item_update(pg_temp.c('k1')::uuid, '{"correct": [2]}');
  perform pg_temp.ok(pg_temp.row('k1') = '{no_key} manual 3 {2}' and (r -> 'ai_key') = 'false'::jsonb,
                     'a key change without ai_key drops it: ' || pg_temp.row('k1'));
  -- ai_key false alone takes it out, the key as it is
  r := public.container_item_update(pg_temp.c('k4')::uuid, '{"ai_key": false}');
  perform pg_temp.ok(pg_temp.row('k4') = '{} manual 2 {0}', 'ai_key false: ' || pg_temp.row('k4'));
  -- any other change that moves rev is the author's too: an option added, single turned multiple
  r := public.container_item_update(pg_temp.c('k5')::uuid, '{"correct": [0], "ai_key": true}');
  perform pg_temp.ok(pg_temp.row('k5') = '{ai_key} manual 2 {0}', 'k5 marked: ' || pg_temp.row('k5'));
  r := public.container_item_update(pg_temp.c('k5')::uuid, '{"options": ["25", "110", "143", "587"]}');
  perform pg_temp.ok(pg_temp.row('k5') = '{} manual 3 {0}' and (r -> 'ai_key') = 'false'::jsonb,
                     'an option added drops it: ' || pg_temp.row('k5'));
  r := public.container_item_update(pg_temp.c('k6')::uuid, '{"correct": [0], "ai_key": true}');
  r := public.container_item_update(pg_temp.c('k6')::uuid, '{"kind": "multiple"}');
  perform pg_temp.ok(pg_temp.row('k6') = '{} manual 3 {0}', 'single turned multiple drops it: ' || pg_temp.row('k6'));
  -- the import's flag goes the same way when the author changes that key
  r := public.container_item_update(pg_temp.c('k3')::uuid, '{"correct": [1]}');
  perform pg_temp.ok(pg_temp.row('k3') = '{} manual 2 {1}', 'the import''s flag goes with a key change: ' || pg_temp.row('k3'));
end;
$do$;
-- the author set a key by hand while the AI was answering: the AI's key is refused, the author's stays
select pg_temp.expect_error(format($$select public.container_item_update(%L, '{"correct": [0], "ai_key": true}')$$, pg_temp.c('k1')), '22023', 'keyed', 'the AI over a hand key');
select pg_temp.ok(pg_temp.row('k1') = '{no_key} manual 3 {2}', 'the hand key stays: ' || pg_temp.row('k1'));
select pg_temp.expect_error(format($$select public.container_item_update(%L, '{"correct": [1], "ai_key": true}')$$, pg_temp.c('k2')), '22023', 'keyed', 'the AI over a file key');
-- refused: ai_key not a boolean, or true without a non-empty key, or on a question the AI does not answer; nothing changes
select pg_temp.expect_error(format($$select public.container_item_update(%L, '{"ai_key": "yes"}')$$, pg_temp.c('k2')), '22023', 'ai_key', 'a string');
select pg_temp.expect_error(format($$select public.container_item_update(%L, '{"ai_key": 1, "correct": [0]}')$$, pg_temp.c('k2')), '22023', 'ai_key', 'a number');
select pg_temp.expect_error(format($$select public.container_item_update(%L, '{"ai_key": true}')$$, pg_temp.c('k2')), '22023', 'ai_key', 'true without correct');
select pg_temp.expect_error(format($$select public.container_item_update(%L, '{"ai_key": null}')$$, pg_temp.c('k2')), '22023', 'ai_key', 'null');
select pg_temp.expect_error(format($$select public.container_item_update(%L, '{"correct": [], "ai_key": true}')$$, pg_temp.c('k9')), '22023', 'ai_key', 'an empty key');
select pg_temp.expect_error(format($$select public.container_item_update(%L, '{"correct": [0], "ai_key": true}')$$, pg_temp.c('k8')), '22023', 'ai_key', 'a short answer');
select pg_temp.expect_error(format($$select public.container_item_update(%L, '{"correct": [0], "ai_key": true, "kind": "order"}')$$, pg_temp.c('k9')), '22023', 'ai_key', 'turned into order');
select pg_temp.ok(pg_temp.row('k2') like '{} % 1 {0}', 'refused patches changed nothing: ' || pg_temp.row('k2'));
select pg_temp.ok(pg_temp.row('k9') like '{} % 1 {}', 'k9 untouched: ' || pg_temp.row('k9'));
-- the old checks hold as before
select pg_temp.expect_error(format($$select public.container_item_update(%L, '{"correct": "x"}')$$, pg_temp.c('k2')), '22023', null, 'a bad key as before');

-- nobody else: B is not the author; no API role writes the row
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.expect_error(format($$select public.container_item_update(%L, '{"correct": [1], "ai_key": true}')$$, pg_temp.c('k2')), 'P0002', null, 'B patches A''s question');
select pg_temp.expect_error(format($$update public.test_items set flags = '{ai_key}' where id = %L$$, pg_temp.c('k2')), '42501', null, 'B updates the row');
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.expect_error(format($$update public.test_items set flags = '{ai_key}' where id = %L$$, pg_temp.c('k2')), '42501', null, 'A updates the row directly');
select pg_temp.as_role('anon');
select pg_temp.expect_error(format($$select public.container_item_update(%L, '{"correct": [1], "ai_key": true}')$$, pg_temp.c('k2')), '42501', null, 'anon');
select pg_temp.as_role('postgres');
select pg_temp.ok(pg_temp.row('k2') like '{} % 1 {0}', 'k2 untouched: ' || pg_temp.row('k2'));

-- the bot: the review after an answer says whether the key is the AI's
insert into bot.links (user_id, tg_user_id, chat_id, tz) values ('aaaaaaaa-0000-0000-0000-000000000001', 4807, 4807, 'Europe/Minsk');
select pg_temp.as_role('service_role');
select pg_temp.put('start', public.bot_session_start(4807, 'ak000001', pg_temp.c('x')::uuid, pg_temp.c('s')::uuid, 'plan',
  jsonb_build_array(jsonb_build_object('id', pg_temp.c('k7'), 'shown', '[0,1]'::jsonb, 'cls', 'new_floor')))::text);
select pg_temp.ok(pg_temp.c('start')::jsonb ->> 'status' = 'ok', 'session started: ' || pg_temp.c('start'));
do $do$
declare
  a jsonb;
  v jsonb;
begin
  v := public.bot_session_view(4807, 'ak000001');
  perform pg_temp.ok(v -> 'view' -> 'review' = 'null', 'no review before the answer: ' || (v -> 'view')::text);
  a := public.bot_session_answer(4807, 'ak000001', 0, '{"i": 1}');   -- wrong: the key is 67
  perform pg_temp.ok(a ->> 'status' = 'ok' and a -> 'answer' ->> 'status' = 'pending', 'a wrong answer waits: ' || a::text);
  v := public.bot_session_view(4807, 'ak000001', 0);
  perform pg_temp.ok(v -> 'view' -> 'review' ->> 'key_source' = 'manual' and (v -> 'view' -> 'review' -> 'ai_key') = 'true'::jsonb,
                     'the review of an AI key: ' || (v -> 'view' -> 'review')::text);
  a := public.bot_session_finish(4807, 'ak000001');
end;
$do$;
-- another session: a key from the file
select pg_temp.put('start2', public.bot_session_start(4807, 'ak000002', pg_temp.c('x')::uuid, pg_temp.c('s')::uuid, 'plan',
  jsonb_build_array(jsonb_build_object('id', pg_temp.c('k2'), 'shown', '[0,1]'::jsonb, 'cls', 'new_floor')))::text);
select pg_temp.ok(pg_temp.c('start2')::jsonb ->> 'status' = 'ok' and not coalesce((pg_temp.c('start2')::jsonb ->> 'resumed')::boolean, false),
                  'a second session started: ' || pg_temp.c('start2'));
do $do$
declare
  a jsonb;
  v jsonb;
begin
  a := public.bot_session_answer(4807, 'ak000002', 0, '{"i": 1}');   -- wrong: the key is 22
  v := public.bot_session_view(4807, 'ak000002', 0);
  perform pg_temp.ok(v -> 'view' -> 'item_id' = to_jsonb(pg_temp.c('k2')) and (v -> 'view' -> 'review' -> 'ai_key') = 'false'::jsonb,
                     'the review of a file''s key: ' || (v -> 'view' -> 'review')::text);
end;
$do$;
select pg_temp.as_role('postgres');
-- «Вопрос дня»: a key from the AI is never posted to a group; the same question with a file's key is
select pg_temp.ok(not bot.group_item_ok(i), 'the group skips an AI key') from public.test_items i where i.id = pg_temp.c('k7')::uuid;
select pg_temp.ok(bot.group_item_ok(i), 'the group takes a file''s key') from public.test_items i where i.id = pg_temp.c('k2')::uuid;
update public.test_items set flags = '{}' where id = pg_temp.c('k7')::uuid;
select pg_temp.ok(bot.group_item_ok(i), 'the same question without the mark may be posted') from public.test_items i where i.id = pg_temp.c('k7')::uuid;
select 'AI KEY FLAG BEHAVIOUR PASSED';
rollback;
