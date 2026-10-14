-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261014150000_bot_skips_pictures.sql
-- on a scratch database with the Telegram bot's packages, the pictures migration (20261014120000) and this one: a
-- question with pictures is never given to the bot's session (bot_session_items leaves it out, so startQueue does) and
-- never posted as «Вопрос дня» (bot.group_item_ok); a question without pictures is as before. One transaction, rolled
-- back; success prints BOT SKIPS PICTURES CHECKS PASSED.
\set ON_ERROR_STOP 1
begin;

create temp table ctx (k text primary key, v text);
grant all on ctx to anon, authenticated, service_role;
create or replace function pg_temp.check(p_ok boolean, p_what text, p_detail jsonb default null)
returns void language plpgsql as $fn$
begin
  if p_ok is not true then
    raise exception 'FAILED: % %', p_what, coalesce(p_detail::text, '');
  end if;
end;
$fn$;
grant execute on function pg_temp.check(boolean, text, jsonb) to anon, authenticated, service_role;

insert into auth.users (id) values ('abababab-0000-0000-0000-000000000001') on conflict do nothing;

-- The author builds an exam with three questions: plain, a picture under the stem, pictures in the options.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'abababab-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"abababab-0000-0000-0000-000000000001"}', true);
do $t$
declare
  r jsonb;
  c text;
  s text;
begin
  r := public.container_create('Схемы', null, '[{"title":"Моделирование","topics":[]}]');
  c := r ->> 'container_id';
  s := r -> 'subjects' -> 0 ->> 'id';
  insert into ctx values ('c', c), ('s', s);
  perform public.container_items_add(s::uuid, pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('ref', 'p:1', 'file_no', '1', 'stem', 'Что такое IDEF0?', 'options', '["Методология","Язык"]'::jsonb,
                                  'correct', '[0]'::jsonb, 'key_source', 'bold'),
    pg_catalog.jsonb_build_object('ref', 'p:2', 'file_no', '2', 'stem', 'Что означает выделенная стрелка?',
                                  'options', '["Вход","Выход","Управление"]'::jsonb, 'correct', '[2]'::jsonb, 'key_source', 'bold',
                                  'images', pg_catalog.jsonb_build_object('stem', pg_catalog.jsonb_build_array(c || '/' || pg_catalog.repeat('a', 64) || '.png'))),
    pg_catalog.jsonb_build_object('ref', 'p:3', 'file_no', '3', 'stem', 'Вопрос на картинке', 'options', '["Рисунок А","Рисунок Б"]'::jsonb,
                                  'correct', '[1]'::jsonb, 'key_source', 'bold',
                                  'images', pg_catalog.jsonb_build_object('stem', '[]'::jsonb, 'options', pg_catalog.jsonb_build_array(
                                    pg_catalog.jsonb_build_array(c || '/' || pg_catalog.repeat('b', 64) || '.png'),
                                    pg_catalog.jsonb_build_array(c || '/' || pg_catalog.repeat('c', 64) || '.jpg'))))));
end
$t$;
reset role;
insert into ctx select i.import_ref, i.id::text from public.test_items i where i.container_id = (select v::uuid from ctx where k = 'c');
insert into bot.links (user_id, tg_user_id, chat_id, tz) values ('abababab-0000-0000-0000-000000000001', 7701, 7701, 'Europe/Minsk');

-- 1. bot_session_items: the plain question only.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $t$
declare
  r jsonb;
begin
  r := public.bot_session_items(7701, (select v::uuid from ctx where k = 'c'),
         array[(select v::uuid from ctx where k = 'p:1'), (select v::uuid from ctx where k = 'p:2'), (select v::uuid from ctx where k = 'p:3')]);
  perform pg_temp.check(r ->> 'status' = 'ok', 'bot_session_items answers', r);
  perform pg_temp.check(pg_catalog.jsonb_array_length(r -> 'items') = 1, 'only the question without pictures', r);
  perform pg_temp.check(r -> 'items' -> 0 ->> 'id' = (select v from ctx where k = 'p:1'), 'it is the plain one', r);
end
$t$;
reset role;

-- 2. bot.group_item_ok: the plain question may be posted, the two with pictures never.
do $t$
declare
  v_ok boolean;
begin
  select bot.group_item_ok(i) into v_ok from public.test_items i where i.id = (select v::uuid from ctx where k = 'p:1');
  perform pg_temp.check(v_ok, 'a question without pictures may be «Вопрос дня»');
  select bot.group_item_ok(i) into v_ok from public.test_items i where i.id = (select v::uuid from ctx where k = 'p:2');
  perform pg_temp.check(not v_ok, 'a picture under the stem keeps it out of the group');
  select bot.group_item_ok(i) into v_ok from public.test_items i where i.id = (select v::uuid from ctx where k = 'p:3');
  perform pg_temp.check(not v_ok, 'pictures in the options keep it out of the group');
end
$t$;

select 'BOT SKIPS PICTURES CHECKS PASSED';
rollback;
