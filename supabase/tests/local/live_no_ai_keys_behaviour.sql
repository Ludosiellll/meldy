-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261107090600_live_no_ai_keys.sql on
-- the scratch database of live_no_ai_keys_run.sh. One transaction, rolled back. A = aaaa…1 (the author). An exam of
-- seven questions: four choice questions with one right option (one of them with the key from the AI), two with two
-- right options (one from the AI), a text answer. Covers: a battle drawn from it with room for all seven takes the five
-- without the AI's key and counts two skipped; «Встань на ответ» takes four (no text answer there) and counts three; a
-- challenge and a duel take five; the author sets the key of one AI question by hand, the flag goes, and the next battle
-- takes six. A failure raises; success prints LIVE NO AI KEYS BEHAVIOUR PASSED.
\set ON_ERROR_STOP 1
begin;
create temp table ctx (k text primary key, v text);
grant all on ctx to anon, authenticated, service_role;
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from pg_temp.ctx where k = p_k
$fn$;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into pg_temp.ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
create or replace function pg_temp.ok(p boolean, p_what text) returns void language plpgsql as $fn$
begin
  if p is distinct from true then raise exception 'FAILED: %', p_what; end if;
end;
$fn$;
-- Who calls: a role ('postgres' = the session's own), the JWT's sub, and the caller's address (x-forwarded-for).
create or replace function pg_temp.who(p_role text, p_sub text default null, p_ip text default null) returns void
language plpgsql as $fn$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', coalesce(p_sub, ''), true);
  perform set_config('request.jwt.claim.role', case when p_role = 'postgres' then '' else p_role end, true);
  perform set_config('request.jwt.claims', case when p_role = 'postgres' then ''
                                                else json_build_object('role', p_role, 'sub', p_sub)::text end, true);
  perform set_config('request.headers', case when p_ip is null then '{}' else jsonb_build_object('x-forwarded-for', p_ip)::text end, true);
  if p_role <> 'postgres' then
    perform set_config('role', p_role, true);
  end if;
end;
$fn$;
-- The refs (n1…n7) of the questions a game, a challenge or a duel drew, sorted: read as postgres.
create or replace function pg_temp.drawn(p_table text, p_col text, p_id text) returns text language plpgsql security definer as $fn$
declare v text;
begin
  execute format('select string_agg(replace(i.import_ref, '':'', ''''), '','' order by i.import_ref)
                    from public.%I q join public.test_items i on i.id = q.item_id where q.%I = %L', p_table, p_col, p_id) into v;
  return coalesce(v, '');
end;
$fn$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

select pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $do$
declare
  r jsonb;
begin
  r := public.container_create('Игры без ключей ИИ', null, '[{"title":"Сети"}]');
  perform pg_temp.put('x', r ->> 'container_id');
  perform pg_temp.put('s', r -> 'subjects' -> 0 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
    jsonb_build_object('ref', 'n:1', 'kind', 'single', 'stem', 'Какой порт у HTTP?', 'options', jsonb_build_array('21', '80', '443'),
                       'correct', jsonb_build_array(1)),
    jsonb_build_object('ref', 'n:2', 'kind', 'single', 'stem', 'Какой порт у DNS?', 'options', jsonb_build_array('53', '67'),
                       'correct', jsonb_build_array(0), 'key_source', 'manual', 'flags', jsonb_build_array('ai_key')),
    jsonb_build_object('ref', 'n:3', 'kind', 'multiple', 'stem', 'Какие порты у почты?', 'options', jsonb_build_array('25', '110', '80', '22'),
                       'correct', jsonb_build_array(0, 1), 'key_source', 'manual', 'flags', jsonb_build_array('ai_key')),
    jsonb_build_object('ref', 'n:4', 'kind', 'single', 'stem', 'Какой порт у SSH?', 'options', jsonb_build_array('22', '25'),
                       'correct', jsonb_build_array(0)),
    jsonb_build_object('ref', 'n:5', 'kind', 'multiple', 'stem', 'Какие порты у веба?', 'options', jsonb_build_array('80', '443', '21'),
                       'correct', jsonb_build_array(0, 1)),
    jsonb_build_object('ref', 'n:6', 'kind', 'short', 'stem', 'Как называется порт 80?', 'answers', jsonb_build_array('HTTP'),
                       'key_source', 'answer_line'),
    jsonb_build_object('ref', 'n:7', 'kind', 'single', 'stem', 'Какой порт у FTP?', 'options', jsonb_build_array('21', '20'),
                       'correct', jsonb_build_array(0))));
end;
$do$;
select pg_temp.who('postgres');
insert into pg_temp.ctx select replace(i.import_ref, ':', ''), i.id::text from public.test_items i where i.subject_id = pg_temp.c('s')::uuid;
select pg_temp.ok((select flags from public.test_items where id = pg_temp.c('n2')::uuid) = '{ai_key}', 'the import keeps the flag');

-- A battle, «Встань на ответ», a challenge and a duel, each with room for all seven.
select pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001', '203.0.113.7');
do $do$
declare
  v_src jsonb := jsonb_build_object('container_id', pg_temp.c('x'), 'subject_ids', jsonb_build_array(pg_temp.c('s')), 'count', 7);
  r jsonb;
begin
  r := public.live_create(v_src, '{}');
  perform pg_temp.put('g1', r ->> 'game_id');
  perform pg_temp.put('g1skip', r ->> 'skipped');
  r := public.live_create(v_src, '{"mode": "stand"}');
  perform pg_temp.put('g2', r ->> 'game_id');
  perform pg_temp.put('g2skip', r ->> 'skipped');
  r := public.challenge_create(v_src, jsonb_build_object('deadline', (now() + interval '1 day')::text));
  perform pg_temp.put('ch', r ->> 'challenge_id');
  perform pg_temp.put('chskip', r ->> 'skipped');
  r := public.duel_create(v_src, '{}', 'Аня', 'tok' || lpad('1', 40, '0'), null);
  perform pg_temp.put('du', r -> 'duel' ->> 'code');
end;
$do$;
select pg_temp.who('postgres');
select pg_temp.ok(pg_temp.drawn('live_questions', 'game_id', pg_temp.c('g1')) = 'n1,n4,n5,n6,n7',
                  'a battle takes the five without the AI''s key: ' || pg_temp.drawn('live_questions', 'game_id', pg_temp.c('g1')));
select pg_temp.ok(pg_temp.c('g1skip') = '2', 'a battle counts two skipped: ' || coalesce(pg_temp.c('g1skip'), 'null'));
select pg_temp.ok(pg_temp.drawn('live_questions', 'game_id', pg_temp.c('g2')) = 'n1,n4,n5,n7',
                  '«Встань на ответ» takes four: ' || pg_temp.drawn('live_questions', 'game_id', pg_temp.c('g2')));
select pg_temp.ok(pg_temp.c('g2skip') = '3', '«Встань на ответ» counts three skipped: ' || coalesce(pg_temp.c('g2skip'), 'null'));
select pg_temp.ok(pg_temp.drawn('live_challenge_questions', 'challenge_id', pg_temp.c('ch')) = 'n1,n4,n5,n6,n7',
                  'a challenge takes the five: ' || pg_temp.drawn('live_challenge_questions', 'challenge_id', pg_temp.c('ch')));
select pg_temp.ok(pg_temp.c('chskip') = '2', 'a challenge counts two skipped: ' || coalesce(pg_temp.c('chskip'), 'null'));
select pg_temp.put('duid', (select d.id::text from public.live_duels d where d.code = pg_temp.c('du')));
select pg_temp.ok(pg_temp.drawn('live_duel_questions', 'duel_id', pg_temp.c('duid')) = 'n1,n4,n5,n6,n7',
                  'a duel takes the five: ' || pg_temp.drawn('live_duel_questions', 'duel_id', pg_temp.c('duid')));

-- The author sets the key of the DNS question by hand: the flag goes, and the next battle takes it.
select pg_temp.who('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
select public.container_item_update(pg_temp.c('n2')::uuid, '{"correct": [0]}');
do $do$
declare
  r jsonb;
begin
  r := public.live_create(jsonb_build_object('container_id', pg_temp.c('x'), 'subject_ids', jsonb_build_array(pg_temp.c('s')), 'count', 7), '{}');
  perform pg_temp.put('g3', r ->> 'game_id');
end;
$do$;
select pg_temp.who('postgres');
select pg_temp.ok((select flags from public.test_items where id = pg_temp.c('n2')::uuid) = '{}', 'a key set by hand takes the flag out');
select pg_temp.ok(pg_temp.drawn('live_questions', 'game_id', pg_temp.c('g3')) = 'n1,n2,n4,n5,n6,n7',
                  'the next battle takes six: ' || pg_temp.drawn('live_questions', 'game_id', pg_temp.c('g3')));
select 'LIVE NO AI KEYS BEHAVIOUR PASSED';
rollback;
