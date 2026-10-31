-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261101090300_question_kinds_bot.sql
-- (release 48, part 4; docs/kinds/CONTRACT.md §4) on the scratch database of question_kinds_run.sh. One transaction,
-- rolled back. A = aaaa…1 linked as Telegram user 4801. Covers: bot_session_items gives number and a one-gap cloze, leaves
-- out order, match and a cloze of two gaps and counts them (in_app), and gives the old kinds as before (no in_app when
-- nothing is left out); a session with a number and a cloze: the view (the true kind, no option order), a typed number
-- right (recorded at once, the reply «correct»), the review's accepted value with its unit and the explanation; a typed
-- cloze wrong (waits for «Дальше»), its review gives the gap's forms; «Дальше» records it as a miss; a typed message with
-- no sid answers the current number question. A failure raises; success prints QUESTION KINDS BOT BEHAVIOUR PASSED.
\set ON_ERROR_STOP 1
begin;
create or replace function pg_temp.ok(p boolean, p_what text) returns void language plpgsql as $fn$
begin
  if p is distinct from true then raise exception 'FAILED: %', p_what; end if;
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
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.put('s', (public.container_create('Бот и типы', null, '[{"title":"Физика"}]') -> 'subjects' -> 0 ->> 'id'));
select public.container_items_add(pg_temp.c('s')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'b:1', 'kind', 'number', 'stem', 'Ускорение свободного падения', 'answers', jsonb_build_array('9.8'),
                     'tolerance', 0.1, 'unit', 'м/с²', 'explanation', 'У поверхности Земли.'),
  jsonb_build_object('ref', 'b:2', 'kind', 'cloze', 'stem', 'Сила измеряется в ___', 'answers', jsonb_build_array(E'ньютонах\nН')),
  jsonb_build_object('ref', 'b:3', 'kind', 'order', 'stem', 'По порядку', 'options', jsonb_build_array('один', 'два')),
  jsonb_build_object('ref', 'b:4', 'kind', 'match', 'stem', 'Пары', 'options', jsonb_build_array('а', 'б'), 'answers', jsonb_build_array('1', '2')),
  jsonb_build_object('ref', 'b:5', 'kind', 'cloze', 'stem', '___ и ___', 'answers', jsonb_build_array('x', 'y')),
  jsonb_build_object('ref', 'b:6', 'kind', 'single', 'stem', 'Да?', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0)),
  jsonb_build_object('ref', 'b:7', 'kind', 'essay', 'stem', 'Эссе')));
select pg_temp.as_role('postgres');
insert into pg_temp.ctx select replace(i.import_ref, ':', ''), i.id::text from public.test_items i where i.subject_id = pg_temp.c('s')::uuid;
select pg_temp.put('x', (select container_id::text from public.container_subjects where id = pg_temp.c('s')::uuid));
insert into bot.links (user_id, tg_user_id, chat_id, tz) values ('aaaaaaaa-0000-0000-0000-000000000001', 4801, 4801, 'Europe/Minsk');

select pg_temp.as_role('service_role');
do $do$
declare
  r jsonb := public.bot_session_items(4801, pg_temp.c('x')::uuid,
               array[pg_temp.c('b1'), pg_temp.c('b2'), pg_temp.c('b3'), pg_temp.c('b4'), pg_temp.c('b5'), pg_temp.c('b6'), pg_temp.c('b7')]::uuid[]);
  r2 jsonb := public.bot_session_items(4801, pg_temp.c('x')::uuid, array[pg_temp.c('b6')]::uuid[]);
begin
  perform pg_temp.ok(r ->> 'status' = 'ok', 'items ok');
  perform pg_temp.ok((select array_agg(i ->> 'kind' order by o) from jsonb_array_elements(r -> 'items') with ordinality x(i, o))
                     = '{number,cloze,single}', 'number, one-gap cloze and single are asked: ' || r::text);
  perform pg_temp.ok((r ->> 'in_app')::integer = 3, 'order, match, two gaps left to the site');
  perform pg_temp.ok((select string_agg(k, ',' order by k) from jsonb_object_keys(r2) k) = 'items,status', 'old kinds: as before');
end;
$do$;
select pg_temp.put('start', public.bot_session_start(4801, 'kd000001', pg_temp.c('x')::uuid, pg_temp.c('s')::uuid, 'plan',
  jsonb_build_array(jsonb_build_object('id', pg_temp.c('b1'), 'shown', '[]'::jsonb, 'cls', 'new_floor'),
                    jsonb_build_object('id', pg_temp.c('b2'), 'shown', '[]'::jsonb, 'cls', 'new_floor')))::text);
select pg_temp.ok(pg_temp.c('start')::jsonb ->> 'status' = 'ok', 'session started: ' || pg_temp.c('start'));
do $do$
declare
  v jsonb := public.bot_session_view(4801, 'kd000001');
  a jsonb;
begin
  perform pg_temp.ok(v -> 'view' ->> 'kind' = 'number' and v -> 'view' -> 'order' = '[]' and v -> 'view' -> 'options' = '[]'
                     and v -> 'view' -> 'review' = 'null', 'the number question: ' || (v -> 'view')::text);
  -- a typed message with no sid answers the current question
  a := public.bot_session_answer(4801, null, null, '{"text": "9,75 м/с²"}');
  perform pg_temp.ok(a ->> 'status' = 'ok' and (a -> 'answer' ->> 'correct')::boolean, 'a typed number, right: ' || a::text);
  v := public.bot_session_view(4801, 'kd000001', 0);
  perform pg_temp.ok(v -> 'view' -> 'review' -> 'answers' = '["9.8 м/с²"]'
                     and v -> 'view' -> 'review' ->> 'explanation' = 'У поверхности Земли.', 'review of the number: ' || (v -> 'view' -> 'review')::text);
end;
$do$;
select pg_temp.as_role('postgres');
select pg_temp.ok((select kind = 'number' and source = 'bot' and correct and answer_text = '9,75 м/с²'
                     from public.test_answers where item_id = pg_temp.c('b1')::uuid), 'the number is in the log');
select pg_temp.as_role('service_role');
do $do$
declare
  a jsonb;
  v jsonb;
begin
  a := public.bot_session_resolve(4801, 'kd000001', 0, 'next');
  v := public.bot_session_view(4801, 'kd000001');
  perform pg_temp.ok(v -> 'view' ->> 'kind' = 'cloze' and (v -> 'view' ->> 'pos')::integer = 1, 'the cloze comes: ' || v::text);
  a := public.bot_session_answer(4801, 'kd000001', 1, '{"text": "джоулях"}');
  perform pg_temp.ok(a ->> 'status' = 'ok' and a -> 'answer' ->> 'status' = 'pending', 'a typed cloze, wrong: waits');
  v := public.bot_session_view(4801, 'kd000001', 1);
  perform pg_temp.ok(v -> 'view' -> 'review' -> 'answers' = '["ньютонах", "Н"]' and not (v -> 'view' -> 'review' ? 'explanation'),
                     'review of the cloze: its forms, no explanation key without one');
  -- «Дальше» after a counted miss carries the queue with its repeat (afterAnswer's queue)
  a := public.bot_session_resolve(4801, 'kd000001', 1, 'next', jsonb_build_array(
         jsonb_build_object('id', pg_temp.c('b1'), 'retry', 0), jsonb_build_object('id', pg_temp.c('b2'), 'retry', 0),
         jsonb_build_object('id', pg_temp.c('b2'), 'retry', 1, 'shown', '[]'::jsonb)));
  perform pg_temp.ok(a ->> 'status' = 'ok', '«Дальше» after the cloze: ' || a::text);
end;
$do$;
select pg_temp.as_role('postgres');
select pg_temp.ok((select kind = 'cloze' and not correct and answer_text = 'джоулях'
                     from public.test_answers where item_id = pg_temp.c('b2')::uuid), 'the cloze miss is in the log');
select pg_temp.as_role('postgres');
select 'QUESTION KINDS BOT BEHAVIOUR PASSED';
rollback;
