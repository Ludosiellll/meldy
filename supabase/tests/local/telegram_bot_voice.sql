-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of the bot's voice stage (package T10:
-- supabase/migrations/20261010120006_telegram_bot_voice.sql) on the scratch database of telegram_bot_run.sh (stage T10), on top of
-- T1's bot core, the exam container and T11's oral sheet read (or its local stub). Spec §4.9 and the T10 brief:
--   the switch (off by default; off answers «off» everywhere, the Space gets nothing); the gates (anon and authenticated
--   get 42501 from bot_voice_*; the Space's entry points need a ticket); single-use tickets (hash only, 2 minutes, one
--   take whatever it answers, bound to user, question and job; used twice, a foreign or unknown one, an expired one);
--   the student's ceiling and the shared 70 % stop (in the ticket and again in the take, at least 10 s a voice); the AI
--   limit; units charged only by a check's take, once per attempt, given back on a failure (bridge_voice_refund,
--   bot_voice_release) and never twice; V1–V4 states; «Сначала»; the 4000-character text; the self-check (a sheet_peek
--   of every point, a self_rating); «Не знаю»; the record (the site's rows); consent texts; «Следующий»; expiry and the
--   housekeeping; the four cores are the site's functions word for word.
-- One transaction, rolled back. A failure raises (FAILED: …); each section prints «ok <name>»; success prints
-- TELEGRAM BOT VOICE CHECKS PASSED. Roles as PostgREST sets them (request.jwt.claims); postgres for fixtures.
\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.expect_error(p_sql text, p_states text[], p_what text)
returns void language plpgsql as $fn$
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_states;
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if not (sqlstate = any (p_states)) then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_states;
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
create or replace function pg_temp.is(p_ok boolean, p_what text) returns void language plpgsql as $fn$
begin
  if p_ok is not true then raise exception 'FAILED: %', p_what; end if;
end;
$fn$;
create temp table ctx (k text primary key, v text);
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from ctx where k = p_k
$fn$;
create or replace function pg_temp.sq(p_sql text) returns text
language plpgsql security definer set search_path = '' as $fn$
declare v text;
begin
  execute p_sql into v;
  return v;
end;
$fn$;
create or replace function pg_temp.sx(p_sql text) returns void
language plpgsql security definer set search_path = '' as $fn$
begin
  execute p_sql;
end;
$fn$;
grant all on ctx to anon, authenticated, service_role;
grant execute on function pg_temp.expect_error(text, text[], text), pg_temp.as_role(text, uuid), pg_temp.is(boolean, text),
  pg_temp.put(text, text), pg_temp.c(text), pg_temp.sq(text), pg_temp.sx(text) to anon, authenticated, service_role;

-- ── 0. Fixtures (postgres). A (FREE, 12 units used today) owns the oral exam «Операционные системы» with four questions
--       (the spec's invented example: question 9 is V1's), rubrics for three of them (p1–p3, p1 and p2 main), the subject
--       of the container «Осенняя сессия»; B (PRO) is another linked student; C mirrors A's questions for the core check.
select pg_temp.as_role('postgres');
do $f$
declare
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  c uuid := 'cccccccc-0000-0000-0000-000000000003';
  exam uuid := 'e0e00000-0000-4000-8000-000000000001';
  exam_c uuid := 'e0e00000-0000-4000-8000-000000000003';
  mat uuid := '11111111-1111-1111-1111-111111111111';
  mat_c uuid := '33333333-3333-3333-3333-333333333333';
  q text[] := array['Взаимоблокировка: условия возникновения и способы предотвращения.',
                    'Планирование процессов: вытесняющие и невытесняющие алгоритмы.',
                    'Виртуальная память: страничная организация и замещение страниц.',
                    'Файловые системы: журналирование и восстановление после сбоя.'];
  rubric jsonb;
  r jsonb;
begin
  insert into bot.links (user_id, tg_user_id, chat_id, tz, linked_at, last_seen_at) values
    (a, 810001, 810001, 'Europe/Minsk', now() - interval '3 days', now() - interval '3 days'),
    ('bbbbbbbb-0000-0000-0000-000000000002', 810002, 810002, 'Europe/Minsk', now() - interval '3 days', null),
    ('eeeeeeee-0000-0000-0000-000000000005', 810005, 810005, 'Asia/Vladivostok', now() - interval '3 days', null);
  insert into public.materials (id, user_id, title, subject, original_text) values
    (mat_c, c, 'Операционные системы', 'ОС', 'Текст лекции');
  insert into public.exams (id, user_id, title, exam_date) values
    (exam, a, 'Операционные системы', (now() at time zone 'utc')::date + 20),
    (exam_c, c, 'Операционные системы', (now() at time zone 'utc')::date + 20);
  insert into public.exam_materials (exam_id, material_id, user_id) values (exam, mat, a), (exam_c, mat_c, c);
  for i in 1..4 loop
    insert into public.exam_questions (id, exam_id, user_id, position, label, text, coverage, coverage_method, evidence)
    values (('e0e00000-0000-4000-8000-00000000010' || i)::uuid, exam, a, 8 + i, (8 + i)::text, q[i],
            case when i = 4 then 'none' else 'full' end, 'llm',
            case when i = 1 then jsonb_build_array(jsonb_build_object('material_id', mat, 'source_id', 'S03')) else '[]'::jsonb end),
           (('e0e00000-0000-4000-8000-00000000030' || i)::uuid, exam_c, c, 8 + i, (8 + i)::text, q[i],
            case when i = 4 then 'none' else 'full' end, 'llm', '[]'::jsonb);
  end loop;
  for i in 1..3 loop
    rubric := jsonb_build_object('v', 1, 'question', q[i], 'coverage', 'full', 'coverage_note', '',
      'materials', jsonb_build_array(jsonb_build_object('key', 'M1', 'material_id', mat, 'title', 'Операционные системы')),
      'points', jsonb_build_array(
        jsonb_build_object('id', 'p1', 'title', 'Взаимное исключение: ресурс занят одним процессом', 'essential', true,
          'source_quote', 'ресурс может использовать только один процесс', 'source_ids', jsonb_build_array('M1:S03'),
          'anchors', '[["взаимн"]]'::jsonb, 'followup', jsonb_build_object('question', 'Что значит взаимное исключение?', 'expected', 'Ресурс занят одним процессом.')),
        jsonb_build_object('id', 'p2', 'title', 'Удержание и ожидание: процесс держит ресурс и ждёт другой', 'essential', true,
          'source_quote', 'процесс удерживает ресурс и ожидает другой', 'source_ids', jsonb_build_array('M1:S04'),
          'anchors', '[["удерж"]]'::jsonb, 'followup', jsonb_build_object('question', 'Какие условия должны выполняться одновременно, чтобы возникла взаимоблокировка?', 'expected', 'Четыре условия Коффмана.')),
        jsonb_build_object('id', 'p3', 'title', 'Круговое ожидание: цепочка процессов ждёт друг друга', 'essential', false,
          'source_quote', 'процессы образуют замкнутую цепь ожидания', 'source_ids', jsonb_build_array('M1:S05'),
          'anchors', '[["кругов"]]'::jsonb, 'followup', jsonb_build_object('question', 'Что такое круговое ожидание?', 'expected', 'Замкнутая цепь.'))));
    insert into public.oral_rubrics (id, user_id, question_hash, source_key, material_id, material_ids, question, rubric, model)
    values (('e0e00000-0000-4000-8000-00000000020' || i)::uuid, a, public.meldy_question_hash(q[i]), 'key-' || i || '-current-0000',
            mat, array[mat], q[i], rubric, 'test');
  end loop;
  perform pg_temp.put('exam', exam::text);
  perform pg_temp.put('exam_c', exam_c::text);
  for i in 1..4 loop
    perform pg_temp.put('q' || i, 'e0e00000-0000-4000-8000-00000000010' || i);
  end loop;
end
$f$;
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $f$
declare r jsonb;
begin
  r := public.container_create('Осенняя сессия', (now() at time zone 'utc')::date + 18,
                               jsonb_build_array(jsonb_build_object('title', 'Операционные системы', 'exam_id', pg_temp.c('exam'))));
  perform pg_temp.put('cid', r ->> 'container_id');
  perform pg_temp.put('sid', r -> 'subjects' -> 0 ->> 'id');
end
$f$;
select pg_temp.as_role('postgres');
-- The bot's own call: the service role, as PostgREST presents the Edge Function's key.
create or replace function pg_temp.svc(p_sql text) returns jsonb language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp.as_role('service_role');
  execute p_sql into v;
  perform pg_temp.as_role('postgres');
  return v;
end;
$fn$;
-- The Space's call: the public key (anon), a ticket.
create or replace function pg_temp.space(p_fn text, p_ticket text) returns jsonb language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp.as_role('anon');
  execute format('select public.%I(%L)', p_fn, p_ticket) into v;
  perform pg_temp.as_role('postgres');
  return v;
end;
$fn$;
create or replace function pg_temp.start(p_tg bigint, p_pos integer default 0) returns jsonb language sql as $fn$
  select pg_temp.svc(format('select public.bot_voice_start(%s, %L, %L, %L, %L, %L::uuid[], %s)', p_tg, pg_temp.c('cid'),
    pg_temp.c('sid'), pg_temp.c('exam'), 'Операционные системы',
    '{' || pg_temp.c('q1') || ',' || pg_temp.c('q4') || ',' || pg_temp.c('q2') || '}', p_pos))
$fn$;
create or replace function pg_temp.ticket(p_tg bigint, p_aid text, p_job text, p_seconds integer default 0) returns jsonb language sql as $fn$
  select pg_temp.svc(format('select public.bot_voice_ticket(%s, %L, %L, %s)', p_tg, p_aid, p_job, p_seconds))
$fn$;
create or replace function pg_temp.used_today(p_user uuid) returns integer language sql as $fn$
  select coalesce(sum(requests_count), 0)::integer from public.ai_usage where user_id = p_user and date = (now() at time zone 'utc')::date
$fn$;
select 'ok fixtures';

-- ── 1. The switch: off after the migration, off answers «off» everywhere; anything but JSON true is off. ───────────────
do $t$
begin
  perform pg_temp.is((select flags -> 'voice' = 'false'::jsonb from bot.config), 'the migration leaves voice = false');
  perform pg_temp.is(pg_temp.svc('select public.bot_voice_state(810001)') = '{"voice": false}'::jsonb, 'state off');
  perform pg_temp.is(pg_temp.start(810001) ->> 'status' = 'off', 'start off');
  perform pg_temp.is(pg_temp.ticket(810001, 'abcdefgh', 'transcribe', 20) ->> 'status' = 'off', 'ticket off');
  perform pg_temp.is(pg_temp.svc($$select public.bot_voice_record(810001, 'abcdefgh', '{}'::jsonb)$$) ->> 'status' = 'off', 'record off');
  perform pg_temp.is((select count(*) from bot.voice_attempts) = 0 and (select count(*) from bot.voice_tickets) = 0, 'nothing written while off');
  update bot.config set flags = flags || '{"voice": "true"}'::jsonb;
  perform pg_temp.is(pg_temp.svc('select public.bot_voice_state(810001)') ->> 'voice' = 'false', 'the string "true" is off');
  update bot.config set flags = flags || '{"voice": 1}'::jsonb;
  perform pg_temp.is(pg_temp.svc('select public.bot_voice_state(810001)') ->> 'voice' = 'false', 'the number 1 is off');
  update bot.config set flags = flags || '{"voice": true}'::jsonb;
  perform pg_temp.is(pg_temp.svc('select public.bot_voice_state(810001)') ->> 'voice' = 'true', 'JSON true is on');
end
$t$;
select 'ok switch';

-- ── 2. Gates: bot_voice_* only for the service role; the Space's entry points for anon (and the service role), never for
--       a signed-in user; the cores and helpers for nobody but the owner.
do $t$
begin
  perform pg_temp.as_role('anon');
  perform pg_temp.expect_error('select public.bot_voice_state(810001)', array['42501'], 'anon → bot_voice_state');
  perform pg_temp.expect_error($$select public.bot_voice_ticket(810001, 'abcdefgh', 'check', 0)$$, array['42501'], 'anon → bot_voice_ticket');
  perform pg_temp.expect_error($$select meldy_private.consume_ai_units_for('aaaaaaaa-0000-0000-0000-000000000001', 1, 'answer')$$, array['42501'], 'anon → the core');
  perform pg_temp.expect_error('select bot.voice_on()', array['42501'], 'anon → a helper');
  perform pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
  perform pg_temp.expect_error('select public.bot_voice_state(810001)', array['42501'], 'authenticated → bot_voice_state');
  perform pg_temp.expect_error($$select public.bridge_voice_take(repeat('a', 64))$$, array['42501'], 'authenticated → bridge_voice_take');
  perform pg_temp.expect_error($$select public.bridge_voice_refund(repeat('a', 64))$$, array['42501'], 'authenticated → bridge_voice_refund');
  perform pg_temp.as_role('postgres');
  perform pg_temp.is(pg_temp.space('bridge_voice_take', repeat('a', 64)) = '{"status": "invalid"}'::jsonb, 'anon: an unknown ticket is invalid');
  perform pg_temp.is(pg_temp.space('bridge_voice_take', 'not a ticket') = '{"status": "invalid"}'::jsonb, 'anon: a malformed ticket is invalid');
  perform pg_temp.is(pg_temp.space('bridge_voice_take', null) = '{"status": "invalid"}'::jsonb, 'anon: no ticket');
  perform pg_temp.is(pg_temp.space('bridge_voice_refund', repeat('b', 64)) = '{"status": "invalid"}'::jsonb, 'anon: refund of nothing');
end
$t$;
select 'ok gates';

-- ── 3. The four cores are the site's functions word for word (only the line that reads the user differs). ─────────────
do $t$
begin
  perform pg_temp.is((select pg_catalog.replace(c.prosrc, 'v_uid uuid := p_user;', 'v_uid uuid := auth.uid();') = s.prosrc
                        from pg_proc c, pg_proc s
                       where c.oid = 'meldy_private.ai_quota_status_for(uuid)'::regprocedure and s.oid = 'public.ai_quota_status()'::regprocedure),
                     'ai_quota_status_for = ai_quota_status');
  perform pg_temp.is((select pg_catalog.replace(c.prosrc, 'v_uid uuid := p_user;', 'v_uid uuid := auth.uid();') = s.prosrc
                        from pg_proc c, pg_proc s
                       where c.oid = 'meldy_private.consume_ai_units_for(uuid,integer,text)'::regprocedure
                         and s.oid = 'public.consume_ai_units(integer,text)'::regprocedure),
                     'consume_ai_units_for = consume_ai_units (the lockdown version)');
  perform pg_temp.is((select pg_catalog.replace(c.prosrc, 'v_uid uuid := p_user;', 'v_uid uuid := auth.uid();') = s.prosrc
                        from pg_proc c, pg_proc s
                       where c.oid = 'meldy_private.refund_ai_units_for(uuid,integer,text,uuid)'::regprocedure
                         and s.oid = 'public.refund_ai_units(integer,text,uuid)'::regprocedure),
                     'refund_ai_units_for = refund_ai_units');
  perform pg_temp.is((select pg_catalog.replace(c.prosrc, 'v_user uuid := p_user;', 'v_user uuid := auth.uid();') = s.prosrc
                        from pg_proc c, pg_proc s
                       where c.oid = 'meldy_private.record_oral_attempt_for(uuid,jsonb)'::regprocedure
                         and s.oid = 'public.record_oral_attempt(jsonb)'::regprocedure),
                     'record_oral_attempt_for = record_oral_attempt');
end
$t$;
-- The same answer through the site's function (A, signed in) and through the core (C, the same questions): the same rows.
select pg_temp.as_role('authenticated', 'aaaaaaaa-0000-0000-0000-000000000001');
do $t$
declare attempt jsonb := '{"score": 61, "grade": 3, "confidence": 2, "verdict": "Назван главный пункт, круговое ожидание пропущено.",
  "input": "speech", "duration_seconds": 102, "make_card": true, "local_date": null,
  "points": [{"id": "p1", "title": "Взаимное исключение: ресурс занят одним процессом", "essential": true, "status": "covered", "credit": 1,
              "student_quote": "ресурс занят одним процессом", "comment": "Сказано.", "source_ids": ["S03"], "source_quote": "ресурс может использовать только один процесс", "source_label": "«Операционные системы», фрагмент 3", "live": false},
             {"id": "p2", "title": "Удержание и ожидание: процесс держит ресурс и ждёт другой", "essential": true, "status": "missing", "credit": 0.5,
              "student_quote": "", "comment": "", "source_ids": ["S04"], "source_quote": "процесс удерживает ресурс и ожидает другой", "source_label": "«Операционные системы», фрагмент 4", "live": false},
             {"id": "p3", "title": "Круговое ожидание: цепочка процессов ждёт друг друга", "essential": false, "status": "wrong", "credit": 0,
              "student_quote": "процессы ждут сами себя", "comment": "", "source_ids": ["S05"], "source_quote": "процессы образуют замкнутую цепь ожидания", "source_label": "«Операционные системы», фрагмент 5", "live": false}],
  "followup": {"point_id": "p2", "question": "Какие условия должны выполняться одновременно, чтобы возникла взаимоблокировка?", "expected": "Четыре условия Коффмана.",
               "status": "covered", "student_quote": "удержание и ожидание", "chosen_by": "check"},
  "errors": [{"point_id": "p3", "student_quote": "процессы ждут сами себя", "correction": "процессы образуют замкнутую цепь ожидания"}]}'::jsonb;
  site jsonb;
  core jsonb;
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  c uuid := 'cccccccc-0000-0000-0000-000000000003';
begin
  site := public.record_oral_attempt(attempt || jsonb_build_object('attempt_id', 'site-attempt-0001', 'exam_question_id', pg_temp.c('q1'),
                                                                  'material_id', '11111111-1111-1111-1111-111111111111'));
  perform pg_temp.as_role('postgres');
  core := meldy_private.record_oral_attempt_for(c, attempt || jsonb_build_object('attempt_id', 'core-attempt-0001',
                                                   'exam_question_id', 'e0e00000-0000-4000-8000-000000000301', 'material_id', '33333333-3333-3333-3333-333333333333'));
  perform pg_temp.is((site - 'session_id') = (core - 'session_id') and (site ->> 'events')::integer = 4, 'the same result: ' || site::text || ' / ' || core::text);
  perform pg_temp.is(
    (select array_agg(kind || '|' || item_key || '|' || coalesce(correct::text, '-') || '|' || coalesce(score::text, '-') || '|' || coalesce(confidence::text, '-') order by item_key)
       from public.learning_events where user_id = a and session_id = (site ->> 'session_id')::uuid)
    = (select array_agg(kind || '|' || item_key || '|' || coalesce(correct::text, '-') || '|' || coalesce(score::text, '-') || '|' || coalesce(confidence::text, '-') order by item_key)
         from public.learning_events where user_id = c and session_id = (core ->> 'session_id')::uuid),
    'the same journal rows');
  perform pg_temp.is(
    (select array_agg(item_key || '|' || student_answer || '|' || origin || '|' || coalesce(rubric_point_id, '-') order by item_key)
       from public.mistake_diary where user_id = a and exam_session_id = (site ->> 'session_id')::uuid)
    = (select array_agg(item_key || '|' || student_answer || '|' || origin || '|' || coalesce(rubric_point_id, '-') order by item_key)
         from public.mistake_diary where user_id = c and exam_session_id = (core ->> 'session_id')::uuid),
    'the same mistakes');
  perform pg_temp.is(
    (select (questions_json -> 0) - 'exam_id' - 'exam_question_id' from public.exam_sessions where id = (site ->> 'session_id')::uuid)
    = (select (questions_json -> 0) - 'exam_id' - 'exam_question_id' from public.exam_sessions where id = (core ->> 'session_id')::uuid),
    'the same exam_sessions record');
  -- Clean up both (they are not the bot's).
  delete from public.mistake_diary where exam_session_id in ((site ->> 'session_id')::uuid, (core ->> 'session_id')::uuid);
  delete from public.flashcard_progress where origin = 'oral_followup' and user_id in (a, c);
  delete from public.learning_events where session_id in ((site ->> 'session_id')::uuid, (core ->> 'session_id')::uuid);
  delete from public.exam_sessions where id in ((site ->> 'session_id')::uuid, (core ->> 'session_id')::uuid);
end
$t$;
select pg_temp.as_role('postgres');
select 'ok cores';

-- ── 4. V1: start. The queue skips a question without points (q4); one open attempt per user; the snapshot. ────────────
do $t$
declare
  r jsonb;
  a jsonb;
begin
  perform pg_temp.is(pg_temp.svc('select public.bot_voice_start(819999, null, null, null, null, null, 0)') ->> 'status' = 'unlinked', 'start: unlinked');
  perform pg_temp.is(pg_temp.svc(format('select public.bot_voice_start(810001, %L, %L, %L, %L, %L::uuid[], 5)', pg_temp.c('cid'), pg_temp.c('sid'),
                       pg_temp.c('exam'), 'x', '{' || pg_temp.c('q1') || '}')) ->> 'status' = 'invalid', 'start: position out of the queue');
  -- B is not in A's container and the exam is not B's oral part.
  perform pg_temp.is(pg_temp.start(810002) ->> 'status' = 'gone', 'start: another student''s exam is gone');
  r := pg_temp.start(810001);
  perform pg_temp.is(r ->> 'status' = 'ok', 'start ok: ' || r::text);
  a := r -> 'attempt';
  perform pg_temp.is(a ->> 'phase' = 'asked' and (a ->> 'n')::int = 1 and (a ->> 'of')::int = 3 and (a ->> 'has_next')::boolean, 'V1: 1 из 3, asked');
  perform pg_temp.is(a -> 'question' ->> 'text' = 'Взаимоблокировка: условия возникновения и способы предотвращения.'
                     and a -> 'question' ->> 'label' = '9' and a ->> 'subject_title' = 'Операционные системы', 'V1: the question and the subject');
  perform pg_temp.is(jsonb_array_length(a -> 'points') = 3 and a -> 'points' -> 0 ->> 'title' like 'Взаимное исключение%'
                     and (a -> 'points' -> 0 ->> 'essential')::boolean and not (a -> 'points' -> 2 ->> 'essential')::boolean, 'the points');
  perform pg_temp.is(a ->> 'evidence_material_id' = '11111111-1111-1111-1111-111111111111', 'evidence[0].material_id kept for the record');
  perform pg_temp.is((r -> 'units' ->> 'left')::int = 88 and (r -> 'units' ->> 'price')::int = 4, 'units: 100 − 12 = 88, price 4: ' || (r -> 'units')::text);
  perform pg_temp.is((r -> 'audio' ->> 'left_s')::int = 1800 and (r -> 'audio' ->> 'day_s')::int = 1800 and not (r -> 'audio' ->> 'stop')::boolean,
                     'audio: 30 minutes left of 30, no stop');
  perform pg_temp.is(r ->> 'tz' = 'Europe/Minsk', 'the link''s zone (the limit line''s clock): ' || coalesce(r ->> 'tz', 'null'));
  perform pg_temp.is(not (a ? 'charge_id') and not (a ? 'user_id'), 'no user id or charge id goes out');
  perform pg_temp.is(pg_temp.sq(format($$select (rubric -> 'points' -> 1 -> 'followup' ->> 'question') from bot.voice_attempts where aid = %L$$, a ->> 'aid'))
                     = 'Какие условия должны выполняться одновременно, чтобы возникла взаимоблокировка?', 'the follow-ups come from oral_rubrics');
  perform pg_temp.put('aid1', a ->> 'aid');
  -- The second question of the queue has no points (coverage none): start at 1 opens the third (q2).
  r := pg_temp.start(810001, 1);
  perform pg_temp.is(r ->> 'status' = 'ok' and (r -> 'attempt' ->> 'n')::int = 3 and r -> 'attempt' ->> 'question_id' = pg_temp.c('q2'), 'skips a question without points');
  perform pg_temp.is(pg_temp.sq(format($$select phase from bot.voice_attempts where aid = %L$$, pg_temp.c('aid1'))) = 'closed', 'the earlier open attempt is closed');
  perform pg_temp.is(pg_temp.sq('select count(*) from bot.voice_attempts where user_id = ''aaaaaaaa-0000-0000-0000-000000000001'' and phase in (''asked'',''answering'',''followup'',''ready'',''self'')') = '1', 'one open attempt');
  perform pg_temp.is(pg_temp.svc(format('select public.bot_voice_start(810001, %L, %L, %L, %L, %L::uuid[], 0)', pg_temp.c('cid'), pg_temp.c('sid'),
                       pg_temp.c('exam'), 'x', '{' || pg_temp.c('q4') || '}')) ->> 'status' = 'empty', 'a queue without points is empty');
  -- Back to question 9.
  r := pg_temp.start(810001);
  perform pg_temp.put('aid', r -> 'attempt' ->> 'aid');
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_sent(810001, %L, 'v1', 501)$$, pg_temp.c('aid'))) ->> 'status' = 'ok', 'V1 sent');
  perform pg_temp.is(pg_temp.svc('select public.bot_voice_state(810001)') -> 'attempt' -> 'messages' ->> 'v1' = '501', 'the state has V1''s message');
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_sent(810002, %L, 'v1', 502)$$, pg_temp.c('aid'))) ->> 'status' = 'gone', 'another student''s handle is gone');
end
$t$;
select 'ok start';

-- ── 5. Tickets: hash only, 2 minutes, one take whatever it answers, bound to the job. ───────────────────────────────────
do $t$
declare
  r jsonb;
  t text;
  h text;
begin
  perform pg_temp.is(pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 0) ->> 'status' = 'invalid', 'a voice of 0 s is invalid');
  perform pg_temp.is(pg_temp.ticket(810001, pg_temp.c('aid'), 'check') ->> 'status' = 'gone', 'no check before a voice');
  perform pg_temp.is(pg_temp.ticket(810001, pg_temp.c('aid'), 'followup', 10) ->> 'status' = 'gone', 'no follow-up before a check');
  perform pg_temp.is(pg_temp.ticket(810002, pg_temp.c('aid'), 'transcribe', 20) ->> 'status' = 'gone', 'a foreign handle gets no ticket');
  r := pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 102);
  t := r ->> 'ticket';
  perform pg_temp.is(r ->> 'status' = 'ok' and t ~ '^[0-9a-f]{64}$', 'a ticket: ' || r::text);
  h := encode(sha256(convert_to(t, 'UTF8')), 'hex');
  perform pg_temp.is(pg_temp.sq(format($$select count(*) from bot.voice_tickets where ticket_hash = %L and job = 'transcribe' and seconds = 102
                                         and expires_at = created_at + interval '2 minutes' and taken_at is null$$, h)) = '1', 'stored as its hash, 2 minutes');
  perform pg_temp.is(pg_temp.sq(format($$select count(*) from bot.voice_tickets t where t.ticket_hash = %L or t::text like %L$$, t, '%' || t || '%')) = '0',
                     'the ticket itself is stored nowhere');
  r := pg_temp.space('bridge_voice_take', t);
  perform pg_temp.is(r ->> 'status' = 'ok' and r ->> 'job' = 'transcribe' and (r ->> 'min_words')::int = 8
                     and r ->> 'hint' = 'Взаимоблокировка: условия возникновения и способы предотвращения.', 'the take: ' || r::text);
  perform pg_temp.is(pg_temp.space('bridge_voice_take', t) = '{"status": "used"}'::jsonb, 'the same ticket again: used');
  perform pg_temp.is(pg_temp.sq(format($$select seconds || '/' || takes from bot.voice_audio where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and day = (now() at time zone 'utc')::date$$)) = '102/1'
                     and pg_temp.sq($$select seconds || '/' || takes from bot.voice_days where day = (now() at time zone 'utc')::date$$) = '102/1', 'the take counted 102 s');
  -- A short voice counts 10 s (Groq's least billed request).
  r := pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 3);
  perform pg_temp.is(pg_temp.space('bridge_voice_take', r ->> 'ticket') ->> 'status' = 'ok', 'a 3 s voice is taken');
  perform pg_temp.is(pg_temp.sq($$select seconds from bot.voice_days where day = (now() at time zone 'utc')::date$$) = '112', 'and counts 10 s');
  -- Expired: refused and burned.
  r := pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20);
  perform pg_temp.sx(format($$update bot.voice_tickets set expires_at = now() - interval '1 second', created_at = now() - interval '121 seconds'
                              where ticket_hash = %L$$, encode(sha256(convert_to(r ->> 'ticket', 'UTF8')), 'hex')));
  perform pg_temp.is(pg_temp.space('bridge_voice_take', r ->> 'ticket') = '{"status": "expired"}'::jsonb, 'an expired ticket');
  perform pg_temp.is(pg_temp.space('bridge_voice_take', r ->> 'ticket') = '{"status": "used"}'::jsonb, 'an expired ticket is burned too');
  perform pg_temp.is(pg_temp.sq($$select seconds from bot.voice_days where day = (now() at time zone 'utc')::date$$) = '112', 'an expired take counts nothing');
  -- Bound to the item: a ticket whose attempt moved on to another question is gone.
  r := pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20);
  perform pg_temp.sx(format($$update bot.voice_tickets set question_id = %L where ticket_hash = %L$$, pg_temp.c('q2'),
                              encode(sha256(convert_to(r ->> 'ticket', 'UTF8')), 'hex')));
  perform pg_temp.is(pg_temp.space('bridge_voice_take', r ->> 'ticket') = '{"status": "gone"}'::jsonb, 'a ticket bound to another question');
  -- The switch off between the ticket and the take: the Space gets «off» and the ticket is burned.
  r := pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20);
  update bot.config set flags = flags || '{"voice": false}'::jsonb;
  perform pg_temp.is(pg_temp.space('bridge_voice_take', r ->> 'ticket') = '{"status": "off"}'::jsonb, 'switched off before the take');
  update bot.config set flags = flags || '{"voice": true}'::jsonb;
  perform pg_temp.is(pg_temp.space('bridge_voice_take', r ->> 'ticket') = '{"status": "used"}'::jsonb, 'and burned');
  -- Unlinked between the ticket and the take.
  r := pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20);
  update bot.links set unlinked_at = now() where tg_user_id = 810001;
  perform pg_temp.is(pg_temp.space('bridge_voice_take', r ->> 'ticket') = '{"status": "gone"}'::jsonb, 'unlinked before the take');
  perform pg_temp.is(pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20) ->> 'status' = 'unlinked', 'no ticket for an unlinked user');
  update bot.links set unlinked_at = null where tg_user_id = 810001;
end
$t$;
select 'ok tickets';

-- ── 6. V2: the answer's voices; 4000 characters; «Сначала». ────────────────────────────────────────────────────────────
do $t$
declare r jsonb;
begin
  r := pg_temp.svc(format($$select public.bot_voice_part(810001, %L, %L, 102, 7001)$$, pg_temp.c('aid'),
         'Взаимоблокировка — это когда процессы ждут ресурсы, занятые друг другом. Ресурс занят одним процессом, процесс держит ресурс и ждёт другой.'));
  perform pg_temp.is(r ->> 'status' = 'ok' and r -> 'attempt' ->> 'phase' = 'answering' and (r -> 'attempt' ->> 'seconds')::int = 102
                     and r -> 'attempt' -> 'messages' ->> 'voice' = '7001', 'V2: the first voice');
  r := pg_temp.svc(format($$select public.bot_voice_part(810001, %L, %L, 30, 7002)$$, pg_temp.c('aid'), 'Ещё круговое ожидание.'));
  perform pg_temp.is(jsonb_array_length(r -> 'attempt' -> 'parts') = 2 and (r -> 'attempt' ->> 'seconds')::int = 132, 'V2: the second voice is appended');
  r := pg_temp.svc(format($$select public.bot_voice_part(810001, %L, %L, 30, 7002)$$, pg_temp.c('aid'), 'Ещё круговое ожидание.'));
  perform pg_temp.is((r ->> 'duplicate')::boolean and jsonb_array_length(r -> 'attempt' -> 'parts') = 2, 'the same voice twice is added once');
  r := pg_temp.svc(format($$select public.bot_voice_ticket(810001, %L, 'transcribe', 30, 7002)$$, pg_temp.c('aid')));
  perform pg_temp.is(r ->> 'status' = 'duplicate', 'and gets no second ticket');
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_part(810001, %L, %L, 30)$$, pg_temp.c('aid'), repeat('слово ', 700))) ->> 'status' = 'too_long',
                     'over 4000 characters: too_long');
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_part(810001, %L, '   ', 30)$$, pg_temp.c('aid'))) ->> 'status' = 'invalid', 'an empty text');
  perform pg_temp.svc(format($$select public.bot_voice_sent(810001, %L, 'v2', 601)$$, pg_temp.c('aid')));
  r := pg_temp.svc(format($$select public.bot_voice_restart(810001, %L)$$, pg_temp.c('aid')));
  perform pg_temp.is(r ->> 'status' = 'ok' and (r ->> 'v2')::int = 601 and r -> 'attempt' ->> 'phase' = 'asked'
                     and r -> 'attempt' -> 'parts' = '[]'::jsonb and not (r -> 'attempt' -> 'messages' ? 'v2'), '«Сначала»: the text and V2 go');
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_restart(810001, %L)$$, pg_temp.c('aid'))) ->> 'status' = 'gone', '«Сначала» twice');
  perform pg_temp.svc(format($$select public.bot_voice_part(810001, %L, %L, 102, 7003)$$, pg_temp.c('aid'),
         'Взаимоблокировка — это когда процессы ждут ресурсы, занятые друг другом. Ресурс занят одним процессом, процесс держит ресурс и ждёт другой.'));
  r := pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 40);
  perform pg_temp.is((pg_temp.space('bridge_voice_take', r ->> 'ticket') ->> 'min_words')::int = 1, 'a later voice needs only to be recognised');
end
$t$;
select 'ok answer';

-- ── 7. Limits: the AI limit, the student's ceiling, the shared stop (ticket first, take again). ─────────────────────────
do $t$
declare
  r jsonb;
  t text;
  d date := (now() at time zone 'utc')::date;
begin
  -- The student's ceiling: 1800 s a day.
  perform pg_temp.sx(format($$update bot.voice_audio set seconds = 1795 where day = %L and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, d));
  perform pg_temp.is(pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20) ->> 'status' = 'ceiling', 'ceiling in the ticket');
  perform pg_temp.sx(format($$update bot.voice_audio set seconds = 1700 where day = %L and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, d));
  t := pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20) ->> 'ticket';
  perform pg_temp.sx(format($$update bot.voice_audio set seconds = 1795 where day = %L and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, d));
  perform pg_temp.is(pg_temp.space('bridge_voice_take', t) = '{"status": "ceiling"}'::jsonb, 'ceiling again in the take');
  perform pg_temp.is(pg_temp.sq(format($$select seconds || '/' || refused from bot.voice_audio where day = %L and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, d)) = '1795/1',
                     'a refused take counts no seconds');
  perform pg_temp.sx(format($$update bot.voice_audio set seconds = 100 where day = %L and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$, d));
  -- The owner's override of the ceiling, in range only.
  update bot.config set flags = flags || '{"voice_user_day_s": 110}'::jsonb;
  perform pg_temp.is(pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20) ->> 'status' = 'ceiling', 'override 110 s');
  update bot.config set flags = flags || '{"voice_user_day_s": 5}'::jsonb;
  perform pg_temp.is(pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20) ->> 'status' = 'ok', 'an override out of range is ignored');
  update bot.config set flags = flags - 'voice_user_day_s';
  -- The shared stop: 70 % of 28 800 = 20 160 s for the whole bot.
  perform pg_temp.is((select stop_s from bot.voice_limits()) = 20160, 'the stop is 70 % of 28 800 s');
  perform pg_temp.sx(format($$update bot.voice_days set seconds = 20155 where day = %L$$, d));
  r := pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20);
  perform pg_temp.is(r ->> 'status' = 'stop' and (r -> 'audio' ->> 'stop')::boolean is false, 'the stop in the ticket (the next 20 s would cross it): ' || r::text);
  perform pg_temp.sx(format($$update bot.voice_days set seconds = 20100 where day = %L$$, d));
  t := pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20) ->> 'ticket';
  perform pg_temp.sx(format($$update bot.voice_days set seconds = 20155 where day = %L$$, d));
  perform pg_temp.is(pg_temp.space('bridge_voice_take', t) = '{"status": "stop"}'::jsonb, 'the stop again in the take');
  perform pg_temp.is(pg_temp.sq(format($$select refused from bot.voice_days where day = %L$$, d)) = '1', 'the stop is counted');
  perform pg_temp.sx(format($$update bot.voice_days set seconds = 20160 where day = %L$$, d));
  perform pg_temp.is((pg_temp.svc('select public.bot_voice_state(810001)') -> 'audio' ->> 'stop')::boolean, 'the state says stop');
  perform pg_temp.sx(format($$update bot.voice_days set seconds = 500 where day = %L$$, d));
  update bot.config set flags = flags || '{"voice_stop_share": 0.01}'::jsonb;
  perform pg_temp.is((select stop_s from bot.voice_limits()) = 20160, 'a share out of range is ignored');
  update bot.config set flags = flags - 'voice_stop_share';
  -- The AI limit: a voice that cannot be checked today is not recognised.
  update public.ai_usage set requests_count = 97 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and date = d;
  r := pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20);
  perform pg_temp.is(r ->> 'status' = 'limit' and (r -> 'units' ->> 'left')::int = 3, 'the limit in the ticket: ' || r::text);
  perform pg_temp.is(pg_temp.ticket(810001, pg_temp.c('aid'), 'check') ->> 'status' = 'limit', 'no check with 3 units');
  update public.ai_usage set requests_count = 12 where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and date = d;
end
$t$;
select 'ok limits';

-- ── 8. «Проверить»: the take charges once; busy; refusals and failures give the units back, never twice. ──────────────
do $t$
declare
  r jsonb;
  t text;
  d date := (now() at time zone 'utc')::date;
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  perform pg_temp.is(pg_temp.used_today(a) = 12, 'nothing charged so far');
  t := pg_temp.ticket(810001, pg_temp.c('aid'), 'check') ->> 'ticket';
  perform pg_temp.is(t is not null, 'a check ticket');
  perform pg_temp.is(pg_temp.ticket(810001, pg_temp.c('aid'), 'check') ->> 'status' = 'busy', 'a second «Проверить» while one is in flight: busy');
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_self(810001, %L)$$, pg_temp.c('aid'))) ->> 'status' = 'busy', 'no self-check during a check');
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_part(810001, %L, 'Ещё', 10)$$, pg_temp.c('aid'))) ->> 'status' = 'busy', 'no voice part during a check');
  perform pg_temp.is(pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 10) ->> 'status' = 'busy', 'no voice ticket during a check');
  perform pg_temp.is(pg_temp.used_today(a) = 12, 'the ticket charges nothing');
  r := pg_temp.space('bridge_voice_take', t);
  perform pg_temp.is(r ->> 'status' = 'ok' and r ->> 'job' = 'check' and (r -> 'units' ->> 'charged')::int = 4 and (r -> 'units' ->> 'left')::int = 84,
                     'the take charges 4: ' || (r -> 'units')::text);
  perform pg_temp.is(pg_temp.used_today(a) = 16 and (select count(*) from public.ai_charges where user_id = a and kind = 'answer' and units = 4) = 1, 'ai_usage +4, one receipt');
  perform pg_temp.is(r ->> 'transcript' like 'Взаимоблокировка — это когда%' and jsonb_array_length(r -> 'points') = 3
                     and r -> 'points' -> 1 -> 'followup' ->> 'question' like 'Какие условия%' and r -> 'points' -> 0 ->> 'source_quote' <> '', 'the check''s context');
  perform pg_temp.is(r ->> 'question' = 'Взаимоблокировка: условия возникновения и способы предотвращения.', 'the question');
  -- The model failed: the Space gives the units back with the same ticket, once.
  perform pg_temp.is(pg_temp.space('bridge_voice_refund', t) = '{"status": "ok", "refunded": 4}'::jsonb, 'refund');
  perform pg_temp.is(pg_temp.space('bridge_voice_refund', t) = '{"status": "no"}'::jsonb, 'no second refund');
  perform pg_temp.is(pg_temp.used_today(a) = 12, 'the units are back');
  perform pg_temp.is(pg_temp.svc('select public.bot_voice_state(810001)') -> 'attempt' ->> 'busy' = 'false', 'not busy after the refund');
  -- A transcribe ticket is never refunded (it charged nothing).
  t := pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20) ->> 'ticket';
  perform pg_temp.space('bridge_voice_take', t);
  perform pg_temp.is(pg_temp.space('bridge_voice_refund', t) = '{"status": "no"}'::jsonb, 'no refund of a voice');
  -- The call never came back: the function releases the attempt (the units back, once).
  t := pg_temp.ticket(810001, pg_temp.c('aid'), 'check') ->> 'ticket';
  perform pg_temp.space('bridge_voice_take', t);
  perform pg_temp.is(pg_temp.used_today(a) = 16, 'charged again');
  r := pg_temp.svc(format($$select public.bot_voice_release(810001, %L)$$, pg_temp.c('aid')));
  perform pg_temp.is((r ->> 'refunded')::int = 4 and pg_temp.used_today(a) = 12, 'release gives them back');
  perform pg_temp.is(pg_temp.space('bridge_voice_refund', t) = '{"status": "no"}'::jsonb, 'and the Space''s late refund does nothing');
  perform pg_temp.is((pg_temp.svc(format($$select public.bot_voice_release(810001, %L)$$, pg_temp.c('aid'))) ->> 'refunded')::int = 0, 'release twice: nothing');
  -- The limit at the take (the site spent the units meanwhile): no charge, the attempt free again.
  t := pg_temp.ticket(810001, pg_temp.c('aid'), 'check') ->> 'ticket';
  update public.ai_usage set requests_count = 98 where user_id = a and date = d;
  perform pg_temp.is(pg_temp.space('bridge_voice_take', t) = '{"status": "limit"}'::jsonb, 'the limit at the take');
  perform pg_temp.is(pg_temp.used_today(a) = 98, 'nothing charged');
  perform pg_temp.svc(format($$select public.bot_voice_release(810001, %L)$$, pg_temp.c('aid')));
  update public.ai_usage set requests_count = 12 where user_id = a and date = d;
  -- The real check: charged once; a lost answer and a second ticket charge nothing again.
  t := pg_temp.ticket(810001, pg_temp.c('aid'), 'check') ->> 'ticket';
  perform pg_temp.space('bridge_voice_take', t);
  perform pg_temp.sx(format($$update bot.voice_attempts set busy_until = null where aid = %L$$, pg_temp.c('aid')));
  t := pg_temp.ticket(810001, pg_temp.c('aid'), 'check') ->> 'ticket';
  r := pg_temp.space('bridge_voice_take', t);
  perform pg_temp.is(r ->> 'status' = 'ok' and pg_temp.used_today(a) = 16, 'a repeated check takes no units again');
  perform pg_temp.put('check_ticket', t);
end
$t$;
select 'ok check';

-- ── 9. V3: the check asks; the follow-up voice; «Не знаю». ─────────────────────────────────────────────────────────────
do $t$
declare
  r jsonb;
  t text;
begin
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_checked(810001, %L, '{"statuses": {}}'::jsonb)$$, pg_temp.c('aid'))) ->> 'status' = 'invalid',
                     'a result without a protocol');
  r := pg_temp.svc(format($$select public.bot_voice_checked(810001, %L, %L::jsonb)$$, pg_temp.c('aid'),
         '{"statuses": {"p1": "covered", "p2": "missing", "p3": "covered"}, "ask": {"point_id": "p2", "question": "Подсунутый вопрос"},
           "protocol": {"points": [{"id": "p1", "status": "covered", "student_quote": "ресурс занят одним процессом", "comment": ""},
                                   {"id": "p2", "status": "missing", "student_quote": "", "comment": ""},
                                   {"id": "p3", "status": "covered", "student_quote": "круговое ожидание", "comment": ""}],
                        "errors": [], "verdict": "Назван главный пункт."}}'));
  perform pg_temp.is(r ->> 'status' = 'ok' and r -> 'attempt' ->> 'phase' = 'followup' and r -> 'attempt' ->> 'busy' = 'false', 'V3: followup');
  perform pg_temp.is(r -> 'attempt' -> 'followup' ->> 'question' = 'Какие условия должны выполняться одновременно, чтобы возникла взаимоблокировка?',
                     'the examiner''s question is the snapshot''s, never the call''s');
  perform pg_temp.is(pg_temp.space('bridge_voice_refund', pg_temp.c('check_ticket')) = '{"status": "no"}'::jsonb, 'no refund once the result is stored');
  perform pg_temp.is(pg_temp.ticket(810001, pg_temp.c('aid'), 'transcribe', 20) ->> 'status' = 'gone', 'no more answer voices after the check');
  r := pg_temp.ticket(810001, pg_temp.c('aid'), 'followup', 6);
  t := r ->> 'ticket';
  r := pg_temp.space('bridge_voice_take', t);
  perform pg_temp.is(r ->> 'status' = 'ok' and r ->> 'job' = 'followup' and r ->> 'point_id' = 'p2' and r ->> 'hint' like 'Какие условия%'
                     and r -> 'followup' ->> 'expected' = 'Четыре условия Коффмана.', 'the follow-up take: ' || r::text);
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_followup(810001, %L, 'excellent')$$, pg_temp.c('aid'))) ->> 'status' = 'invalid', 'a status out of the list');
  r := pg_temp.svc(format($$select public.bot_voice_followup(810001, %L, 'covered', 'Удержание и ожидание, взаимное исключение', 'check')$$, pg_temp.c('aid')));
  perform pg_temp.is(r -> 'attempt' ->> 'phase' = 'ready' and r -> 'attempt' -> 'followup' ->> 'status' = 'covered'
                     and r -> 'attempt' -> 'followup' ->> 'judged_by' = 'check', 'ready to record');
end
$t$;
select 'ok followup';

-- ── 10. V4: the record — the site's rows, the server's keys; consent; twice = once. ───────────────────────────────────
do $t$
declare
  r jsonb;
  s uuid;
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  payload jsonb := '{"score": 77, "grade": 4, "confidence": null, "verdict": "Назван главный пункт.", "duration_seconds": 102,
    "material_id": "11111111-1111-1111-1111-111111111111",
    "attempt_id": "forged-by-client", "exam_question_id": "e0e00000-0000-4000-8000-000000000103", "input": "text",
    "points": [{"id": "p1", "title": "Взаимное исключение: ресурс занят одним процессом", "essential": true, "status": "covered", "credit": 1,
                "student_quote": "ресурс занят одним процессом", "comment": "", "source_ids": ["S03"], "material_id": "11111111-1111-1111-1111-111111111111",
                "source_quote": "ресурс может использовать только один процесс", "source_label": "«Операционные системы», фрагмент 3", "live": false},
               {"id": "p2", "title": "Удержание и ожидание: процесс держит ресурс и ждёт другой", "essential": true, "status": "missing", "credit": 0.5,
                "student_quote": "", "comment": "", "source_ids": ["S04"], "material_id": "11111111-1111-1111-1111-111111111111",
                "source_quote": "процесс удерживает ресурс и ожидает другой", "source_label": "«Операционные системы», фрагмент 4", "live": false},
               {"id": "p3", "title": "Круговое ожидание: цепочка процессов ждёт друг друга", "essential": false, "status": "covered", "credit": 1,
                "student_quote": "круговое ожидание", "comment": "", "source_ids": ["S05"], "material_id": "11111111-1111-1111-1111-111111111111",
                "source_quote": "процессы образуют замкнутую цепь ожидания", "source_label": "«Операционные системы», фрагмент 5", "live": false}],
    "followup": {"point_id": "p2", "question": "Какие условия должны выполняться одновременно, чтобы возникла взаимоблокировка?",
                 "expected": "Четыре условия Коффмана.", "status": "covered", "student_quote": "Удержание и ожидание", "chosen_by": "check"},
    "errors": []}'::jsonb;
begin
  insert into public.oral_answer_consent (user_id, granted, version) values (a, true, 1);
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_record(810001, %L, '{}'::jsonb, 'dont_know')$$, pg_temp.c('aid'))) ->> 'status' = 'gone',
                     '«Не знаю» after the check is the follow-up''s, not V1''s');
  r := pg_temp.svc(format($$select public.bot_voice_record(810001, %L, %L::jsonb)$$, pg_temp.c('aid'), payload));
  perform pg_temp.is(r ->> 'status' = 'ok' and (r ->> 'charged')::int = 4 and (r -> 'units' ->> 'left')::int = 84, 'recorded: ' || r::text);
  s := (r ->> 'session_id')::uuid;
  perform pg_temp.is((select count(*) from public.exam_sessions where id = s and user_id = a and kind = 'oral_ticket' and score = 77) = 1, 'the exam_sessions row');
  perform pg_temp.is((select questions_json -> 0 ->> 'exam_question_id' from public.exam_sessions where id = s) = pg_temp.c('q1'),
                     'the question is the attempt''s, not the payload''s');
  perform pg_temp.is((select questions_json -> 0 ->> 'input' from public.exam_sessions where id = s) = 'speech', 'input speech');
  perform pg_temp.is((select count(*) from public.learning_events where session_id = s and kind = 'exam_answer' and correct
                        and client_event_id = 'tgv-' || replace(pg_temp.sq(format($$select id from bot.voice_attempts where aid = %L$$, pg_temp.c('aid'))), '-', '') || ':answer') = 1,
                     'exam_answer with the server''s attempt id');
  perform pg_temp.is((select count(*) from public.learning_events where session_id = s and kind = 'oral_point') = 3, 'three oral_point rows');
  perform pg_temp.is((select local_date from public.learning_events where session_id = s and kind = 'exam_answer')
                     = (now() at time zone 'Europe/Minsk')::date, 'the link''s local day');
  perform pg_temp.is((select count(*) from public.oral_answer_texts where user_id = a and session_id = s and input = 'speech'
                        and text like 'Взаимоблокировка — это когда%' and consent_version = 1) = 1, 'the text kept with consent');
  perform pg_temp.is(pg_temp.sq(format($$select (phase = 'done' and parts::text not like '%%Взаимоблокировка%%' and jsonb_array_length(parts) = 1)::text
                                           from bot.voice_attempts where aid = %L$$, pg_temp.c('aid'))) = 'true', 'done; the recognised text is gone from bot.voice_attempts');
  r := pg_temp.svc(format($$select public.bot_voice_record(810001, %L, %L::jsonb)$$, pg_temp.c('aid'), payload));
  perform pg_temp.is(r ->> 'status' = 'ok' and (r ->> 'session_id')::uuid = s and (r ->> 'duplicate')::boolean, 'twice = once');
  perform pg_temp.is((select count(*) from public.exam_sessions where user_id = a and kind = 'oral_ticket') = 1, 'one session');
end
$t$;
select 'ok record';

-- ── 11. «Следующий», the self-check, «Не знаю» under V1. ───────────────────────────────────────────────────────────────
do $t$
declare
  r jsonb;
  aid2 text;
  a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
begin
  r := pg_temp.svc(format($$select public.bot_voice_next(810001, %L)$$, pg_temp.c('aid')));
  perform pg_temp.is(r ->> 'status' = 'ok' and r -> 'attempt' ->> 'question_id' = pg_temp.c('q2') and (r -> 'attempt' ->> 'n')::int = 3,
                     '«Следующий» skips the question without points: ' || (r -> 'attempt' ->> 'n'));
  perform pg_temp.is(r -> 'prev' ->> 'aid' = pg_temp.c('aid') and r -> 'prev' ->> 'phase' = 'done' and r -> 'prev' ->> 'session_id' is not null
                     and r ->> 'tz' = 'Europe/Minsk', 'prev: the answered question (its «Протокол» stays)');
  aid2 := r -> 'attempt' ->> 'aid';
  r := pg_temp.svc(format($$select public.bot_voice_next(810001, %L)$$, pg_temp.c('aid')));
  perform pg_temp.is(r ->> 'status' = 'ok' and (r ->> 'again')::boolean and r -> 'attempt' ->> 'aid' = aid2 and r -> 'prev' ->> 'aid' = pg_temp.c('aid'),
                     '«Следующий» twice: the same open question');
  -- The self-check: a sheet_peek of every point, then the rating; nothing charged.
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_rate(810001, %L, 'know')$$, aid2)) ->> 'status' = 'gone', 'no rating before the points');
  r := pg_temp.svc(format($$select public.bot_voice_self(810001, %L)$$, aid2));
  perform pg_temp.is(r ->> 'status' = 'ok' and r -> 'attempt' ->> 'phase' = 'self', 'the self-check');
  perform pg_temp.is((select count(*) from public.learning_events where user_id = a and kind = 'sheet_peek'
                        and item_key like 'peek:e0e00000-0000-4000-8000-000000000202:p_' and payload ->> 'question_hash' = public.meldy_question_hash(
                          'Планирование процессов: вытесняющие и невытесняющие алгоритмы.') and payload ->> 'exam_id' = pg_temp.c('exam')
                        and local_date = (now() at time zone 'Europe/Minsk')::date) = 3, 'three peeks, as «Показать пункты»');
  r := pg_temp.svc(format($$select public.bot_voice_self(810001, %L)$$, aid2));
  perform pg_temp.is(r ->> 'status' = 'ok' and r -> 'attempt' ->> 'phase' = 'self', 'pressed twice: ok, the same points');
  perform pg_temp.is((select count(*) from public.learning_events where user_id = a and kind = 'sheet_peek') = 3, 'peeks once');
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_rate(810001, %L, 'excellent')$$, aid2)) ->> 'status' = 'invalid', 'an unknown rating');
  r := pg_temp.svc(format($$select public.bot_voice_rate(810001, %L, 'unsure')$$, aid2));
  perform pg_temp.is(r -> 'attempt' ->> 'phase' = 'rated', 'rated');
  perform pg_temp.is((select count(*) from public.learning_events where user_id = a and kind = 'self_rating' and confidence = 2
                        and item_key = 'q:' || public.meldy_question_hash('Планирование процессов: вытесняющие и невытесняющие алгоритмы.')
                        and material_id = '11111111-1111-1111-1111-111111111111' and payload ->> 'exam_question_id' = pg_temp.c('q2')) = 1, 'the self_rating');
  perform pg_temp.is(pg_temp.used_today(a) = 16, 'the self-check charges nothing');
  r := pg_temp.svc(format($$select public.bot_voice_next(810001, %L)$$, aid2));
  perform pg_temp.is(r ->> 'status' = 'end' and r -> 'prev' ->> 'aid' = aid2 and r -> 'prev' ->> 'session_id' is null, 'the last question: end');
  -- «Не знаю» under V1: the site's «не знаю» answer, no units.
  r := pg_temp.start(810001);
  r := pg_temp.svc(format($$select public.bot_voice_record(810001, %L, %L::jsonb, 'dont_know')$$, r -> 'attempt' ->> 'aid',
         '{"score": 0, "grade": 2, "verdict": "Ответ «не знаю»: ни один из пунктов не прозвучал.", "points": [
           {"id": "p1", "title": "Взаимное исключение: ресурс занят одним процессом", "essential": true, "status": "missing", "credit": 0},
           {"id": "p2", "title": "Удержание и ожидание: процесс держит ресурс и ждёт другой", "essential": true, "status": "missing", "credit": 0},
           {"id": "p3", "title": "Круговое ожидание: цепочка процессов ждёт друг друга", "essential": false, "status": "missing", "credit": 0}],
           "followup": null, "errors": []}'));
  perform pg_temp.is(r ->> 'status' = 'ok' and (r ->> 'charged')::int = 0 and pg_temp.used_today(a) = 16, '«Не знаю»: recorded, no units');
  perform pg_temp.is((select count(*) from public.learning_events where session_id = (r ->> 'session_id')::uuid and kind = 'oral_point' and correct is false) = 3,
                     'three missed points');
  perform pg_temp.is((select count(*) from public.oral_answer_texts where session_id = (r ->> 'session_id')::uuid) = 0, 'no text for «Не знаю»');
end
$t$;
select 'ok next and self-check';

-- ── 12. Another student, another day, the housekeeping. ────────────────────────────────────────────────────────────────
do $t$
declare
  r jsonb;
  aid3 text;
begin
  r := pg_temp.start(810001);
  aid3 := r -> 'attempt' ->> 'aid';
  perform pg_temp.svc(format($$select public.bot_voice_part(810001, %L, 'Ответ', 20)$$, aid3));
  -- B cannot touch A's attempt with its handle.
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_part(810002, %L, 'Чужой ответ', 20)$$, aid3)) ->> 'status' = 'gone', 'B: part of A''s attempt');
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_self(810002, %L)$$, aid3)) ->> 'status' = 'gone', 'B: self-check of A''s attempt');
  perform pg_temp.is(pg_temp.svc(format($$select public.bot_voice_release(810002, %L)$$, aid3)) ->> 'status' = 'gone', 'B: release of A''s attempt');
  -- An attempt of yesterday ends when the student comes back; its text goes.
  perform pg_temp.sx(format($$update bot.voice_attempts set local_day = local_day - 1 where aid = %L$$, aid3));
  r := pg_temp.svc('select public.bot_voice_state(810001)');
  perform pg_temp.is(r -> 'attempt' = 'null'::jsonb, 'yesterday''s attempt is not open');
  perform pg_temp.is(pg_temp.sq(format($$select phase || ' ' || parts::text from bot.voice_attempts where aid = %L$$, aid3)) = 'closed []', 'closed, text gone');
  -- Housekeeping: a ticket a day after it expired, an attempt after 3 days, a text left a day.
  perform pg_temp.sx($$update bot.voice_tickets set created_at = now() - interval '2 days', expires_at = now() - interval '2 days'$$);
  perform pg_temp.sx(format($$update bot.voice_attempts set updated_at = now() - interval '4 days' where aid = %L$$, aid3));
  perform pg_temp.start(810001);
  perform pg_temp.is(pg_temp.sq('select count(*) from bot.voice_tickets') = '0', 'old tickets deleted');
  perform pg_temp.is(pg_temp.sq(format($$select count(*) from bot.voice_attempts where aid = %L$$, aid3)) = '0', 'old attempts deleted');
  -- E in Vladivostok: the local day is the link's.
  perform pg_temp.is(pg_temp.svc('select public.bot_voice_state(810005)') ->> 'local_day' = ((now() at time zone 'Asia/Vladivostok')::date)::text, 'Vladivostok''s day');
end
$t$;
select 'ok others and housekeeping';

rollback;
select 'TELEGRAM BOT VOICE CHECKS PASSED';
