-- oral_formula_v2 (an oral ticket's protocol names the grade formula it was graded with: v2)
-- Repo file: supabase/migrations/20261103090000_oral_formula_v2.sql. Base: 20261003083154_hackathon_journal_exams_oral.sql
-- (public.record_oral_attempt) and 20261010120006_telegram_bot_voice.sql (meldy_private.record_oral_attempt_for, the
-- bot's copy of it).
-- Why: the site and the bot grade an answer with formula v2 (frontend/src/lib/oral/oralGrade.ts, contracts §7.6 with
-- Jury_Check 2026-10-03 item 3; supabase/functions/_shared/bot/voice.ts gradeAnswer), but both functions still wrote
-- «formula: v1» into the protocol (exam_sessions.questions_json[0].formula of kind oral_ticket). Nothing reads the
-- field yet; a protocol that names the wrong formula would mislead the first reader that does. Rows written before
-- stay as they are (the client grades with v2 since 2026-10-04, commit 1c1bd10; a row does not say which client wrote it).
-- Changed: the one line «'formula', 'v1'» → «'formula', 'v2'» in both functions; every other line is the base's, so the
-- bot's contract (supabase/tests/telegram_bot.sql: record_oral_attempt_for = record_oral_attempt but the line that
-- reads the user) still holds. Grants and owners stay (OR REPLACE).
-- Check after the apply: supabase/tests/oral_formula_v2.sql (catalog only; read-only). Local rehearsal (never live):
-- supabase/tests/local/oral_journal_sweep_run.sh. Rollback: supabase/rollback/20261103090000_oral_formula_v2_down.sql.
-- Re-runnable.

do $do$
begin
  if pg_catalog.to_regprocedure('public.record_oral_attempt(jsonb)') is null
     or pg_catalog.to_regprocedure('meldy_private.record_oral_attempt_for(uuid, jsonb)') is null then
    raise exception 'the base is expected: 20261003083154_hackathon_journal_exams_oral.sql and 20261010120006_telegram_bot_voice.sql';
  end if;
end;
$do$;

-- 1. The site's function, as 20261003083154_hackathon_journal_exams_oral.sql 7c with formula v2.
create or replace function public.record_oral_attempt(p_attempt jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_attempt_id text;
  v_question_id uuid;
  v_exam_id uuid;
  v_hash text;
  v_question text;
  v_subject text;
  v_session_id uuid;
  v_material uuid;
  v_local_date date;
  v_score integer;
  v_grade integer;
  v_confidence smallint;
  v_rubric_id text;
  v_input text;
  v_raw jsonb;
  v_point jsonb;
  v_points jsonb := '[]'::jsonb;
  v_ids text[] := '{}'::text[];
  v_point_id text;
  v_status text;
  v_point_material uuid;
  v_sources text[];
  v_title text;
  v_quote text;
  v_label text;
  v_credit real;
  v_followup jsonb;
  v_followup_point jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_recovered boolean;
  v_inserted boolean;
  v_card_material uuid;
  v_card_question text;
  v_events integer := 0;
  v_added integer := 0;
  v_existing integer := 0;
  v_card boolean := false;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_attempt is null or pg_catalog.jsonb_typeof(p_attempt) <> 'object'
     or pg_catalog.jsonb_typeof(p_attempt -> 'points') is distinct from 'array'
     or pg_catalog.octet_length(p_attempt::text) > 32768 then
    raise exception 'invalid oral attempt' using errcode = '22023';
  end if;
  v_attempt_id := p_attempt ->> 'attempt_id';
  if v_attempt_id is null or v_attempt_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'attempt_id is required' using errcode = '22023';
  end if;
  if coalesce(p_attempt ->> 'exam_question_id', '') !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'exam_question_id must be a uuid' using errcode = '22023';
  end if;
  v_question_id := (p_attempt ->> 'exam_question_id')::uuid;
  v_score := case when coalesce(p_attempt ->> 'score', '') ~ '^\d{1,3}$' then (p_attempt ->> 'score')::integer end;
  v_grade := case when coalesce(p_attempt ->> 'grade', '') ~ '^[2-5]$' then (p_attempt ->> 'grade')::integer end;
  if v_score is null or v_score > 100 or v_grade is null then
    raise exception 'score (0..100) and grade (2..5) are required' using errcode = '22023';
  end if;

  select q.question_hash, q.text, q.exam_id, e.title
    into v_hash, v_question, v_exam_id, v_subject
    from public.exam_questions q
    join public.exams e on e.id = q.exam_id
   where q.id = v_question_id and q.user_id = v_user;
  if not found then
    raise exception 'exam question not found' using errcode = 'P0002';
  end if;

  -- Serialise retries of the same attempt, then answer a retry with the first result.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':' || v_attempt_id, 0));
  select e.session_id into v_session_id
    from public.learning_events e
   where e.user_id = v_user and e.client_event_id = v_attempt_id || ':answer';
  if found then
    return pg_catalog.jsonb_build_object('session_id', v_session_id, 'duplicate', true,
      'events', 0, 'mistakes_added', 0, 'mistakes_existing', 0, 'card_added', false);
  end if;

  if coalesce(p_attempt ->> 'material_id', '') ~ '^[0-9a-fA-F-]{36}$' then
    select m.id into v_material
      from public.materials m
     where m.id = (p_attempt ->> 'material_id')::uuid and m.user_id = v_user;
  end if;
  v_local_date := case when coalesce(p_attempt ->> 'local_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
                       then (p_attempt ->> 'local_date')::date end;
  v_confidence := case when coalesce(p_attempt ->> 'confidence', '') ~ '^[1-3]$'
                       then (p_attempt ->> 'confidence')::smallint end;
  v_rubric_id := case when coalesce(p_attempt ->> 'rubric_id', '') ~ '^[0-9a-fA-F-]{36}$'
                      then p_attempt ->> 'rubric_id' end;
  v_input := case when p_attempt ->> 'input' in ('speech', 'text', 'mixed') then p_attempt ->> 'input' else 'text' end;

  -- Clean points: valid unique ids p1..p6, known statuses, short quotes, own materials only.
  for v_raw in select value from pg_catalog.jsonb_array_elements(p_attempt -> 'points') loop
    v_point_id := v_raw ->> 'id';
    continue when v_point_id is null or v_point_id !~ '^p[1-6]$' or v_point_id = any (v_ids);
    v_ids := v_ids || v_point_id;
    v_point_material := null;
    if coalesce(v_raw ->> 'material_id', '') ~ '^[0-9a-fA-F-]{36}$' then
      select m.id into v_point_material
        from public.materials m
       where m.id = (v_raw ->> 'material_id')::uuid and m.user_id = v_user;
    end if;
    v_points := v_points || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', v_point_id,
      'title', pg_catalog.left(pg_catalog.btrim(coalesce(v_raw ->> 'title', '')), 120),
      'essential', coalesce(v_raw ->> 'essential', '') = 'true',
      'status', case when v_raw ->> 'status' in ('covered', 'partial', 'missing', 'wrong', 'unrated')
                     then v_raw ->> 'status' else 'unrated' end,
      'credit', case when pg_catalog.jsonb_typeof(v_raw -> 'credit') = 'number'
                     then least(1, greatest(0, (v_raw ->> 'credit')::real)) end,
      'student_quote', pg_catalog.left(coalesce(v_raw ->> 'student_quote', ''), 160),
      'comment', pg_catalog.left(coalesce(v_raw ->> 'comment', ''), 200),
      'source_ids', pg_catalog.to_jsonb(coalesce(array(
         select s from pg_catalog.jsonb_array_elements_text(
           case when pg_catalog.jsonb_typeof(v_raw -> 'source_ids') = 'array' then v_raw -> 'source_ids' else '[]'::jsonb end) s
          where s ~ '^S[0-9]{1,3}$' limit 6), '{}'::text[])),
      'material_id', v_point_material,
      'source_quote', pg_catalog.left(coalesce(v_raw ->> 'source_quote', ''), 300),
      'source_label', pg_catalog.left(coalesce(v_raw ->> 'source_label', ''), 120),
      'live', coalesce(v_raw ->> 'live', '') = 'true'));
  end loop;
  if pg_catalog.jsonb_array_length(v_points) = 0 then
    raise exception 'at least one rubric point is required' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_attempt -> 'followup') = 'object'
     and (p_attempt -> 'followup' ->> 'point_id') = any (v_ids) then
    v_followup := pg_catalog.jsonb_build_object(
      'point_id', p_attempt -> 'followup' ->> 'point_id',
      'question', pg_catalog.left(pg_catalog.btrim(coalesce(p_attempt -> 'followup' ->> 'question', '')), 200),
      'expected', pg_catalog.left(pg_catalog.btrim(coalesce(p_attempt -> 'followup' ->> 'expected', '')), 300),
      'status', case when p_attempt -> 'followup' ->> 'status' in ('covered', 'partial', 'missing', 'wrong')
                     then p_attempt -> 'followup' ->> 'status' else 'missing' end,
      'student_quote', pg_catalog.left(coalesce(p_attempt -> 'followup' ->> 'student_quote', ''), 160),
      'chosen_by', case when p_attempt -> 'followup' ->> 'chosen_by' = 'check' then 'check' else 'client' end);
  end if;

  if pg_catalog.jsonb_typeof(p_attempt -> 'errors') = 'array' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'point_id', x ->> 'point_id',
             'student_quote', pg_catalog.left(coalesce(x ->> 'student_quote', ''), 160),
             'correction', pg_catalog.left(coalesce(x ->> 'correction', ''), 160))), '[]'::jsonb)
      into v_errors
      from (select value as x from pg_catalog.jsonb_array_elements(p_attempt -> 'errors') limit 10) t
     where (x ->> 'point_id') = any (v_ids);
  end if;

  insert into public.exam_sessions
    (user_id, material_id, subject, kind, questions_json, total_questions, score, duration_seconds, status, completed_at)
  values
    (v_user, v_material, pg_catalog.left(v_subject, 200), 'oral_ticket',
     pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
       'v', 1,
       'exam_id', v_exam_id,
       'exam_question_id', v_question_id,
       'rubric_id', v_rubric_id,
       'question_hash', v_hash,
       'question', v_question,
       'input', v_input,
       'points', v_points,
       'followup', v_followup,
       'errors', v_errors,
       'verdict', pg_catalog.left(coalesce(p_attempt ->> 'verdict', ''), 600),
       'grade', v_grade,
       'formula', 'v2')),
     1, v_score,
     case when coalesce(p_attempt ->> 'duration_seconds', '') ~ '^\d{1,6}$'
          then least((p_attempt ->> 'duration_seconds')::integer, 3600) else 0 end,
     'completed', pg_catalog.now())
  returning id into v_session_id;

  insert into public.learning_events
    (user_id, local_date, material_id, kind, item_key, correct, score, confidence, session_id, client_event_id, payload)
  values
    (v_user, v_local_date, v_material, 'exam_answer', 'q:' || v_hash, v_grade >= 4, v_score / 100.0,
     v_confidence, v_session_id, v_attempt_id || ':answer',
     pg_catalog.jsonb_build_object(
       'v', 1,
       'exam_id', v_exam_id,
       'exam_question_id', v_question_id,
       'grade', v_grade, 'score_pct', v_score,
       'input', v_input,
       'rubric_id', v_rubric_id,
       'followup_point', v_followup ->> 'point_id',
       'followup_status', v_followup ->> 'status',
       'chosen_by', v_followup ->> 'chosen_by'));
  v_events := 1;

  for v_point in select value from pg_catalog.jsonb_array_elements(v_points) loop
    v_point_id := v_point ->> 'id';
    v_status := v_point ->> 'status';
    v_recovered := v_followup is not null and v_followup ->> 'point_id' = v_point_id
                   and v_followup ->> 'status' = 'covered';
    v_point_material := coalesce((v_point ->> 'material_id')::uuid, v_material);
    v_sources := coalesce(array(select pg_catalog.jsonb_array_elements_text(v_point -> 'source_ids')), '{}'::text[]);
    v_title := v_point ->> 'title';
    v_credit := (v_point ->> 'credit')::real;

    insert into public.learning_events
      (user_id, local_date, material_id, kind, item_key, correct, score, source_ids, session_id, client_event_id, payload)
    values
      (v_user, v_local_date, v_point_material, 'oral_point',
       'oral:' || coalesce(v_rubric_id, v_hash) || ':' || v_point_id,
       case when v_status = 'unrated' then null else v_status = 'covered' or v_recovered end,
       v_credit, v_sources, v_session_id, v_attempt_id || ':' || v_point_id,
       pg_catalog.jsonb_build_object(
         'v', 1, 'question_hash', v_hash, 'rubric_id', v_rubric_id,
         'point_id', v_point_id, 'title', v_title, 'status', v_status,
         'essential', (v_point ->> 'essential')::boolean,
         'live', (v_point ->> 'live')::boolean,
         'followup_status', case when v_followup ->> 'point_id' = v_point_id then v_followup ->> 'status' end));
    v_events := v_events + 1;

    if v_status in ('partial', 'missing', 'wrong') and not v_recovered and pg_catalog.char_length(v_title) > 0 then
      v_quote := v_point ->> 'source_quote';
      v_label := coalesce(nullif(v_point ->> 'source_label', ''), 'Лекция');
      insert into public.mistake_diary
        (user_id, material_id, exam_session_id, question, correct_answer, student_answer, topic,
         is_resolved, origin, item_key, source_ids, rubric_point_id)
      values
        (v_user, v_point_material, v_session_id, v_question,
         pg_catalog.left(v_title || case when v_quote <> '' then '. ' || v_label || ': «' || v_quote || '»' else '' end, 1000),
         coalesce(nullif(v_point ->> 'student_quote', ''), '(не названо)'),
         pg_catalog.left(v_subject, 200), false, 'oral_ticket',
         'oral:' || v_hash || ':' || pg_catalog.left(public.meldy_question_hash(v_title), 12),
         v_sources, v_point_id)
      on conflict (user_id, item_key) where item_key is not null and not is_resolved
      do update set student_answer = excluded.student_answer, exam_session_id = excluded.exam_session_id
      returning (xmax = 0) into v_inserted;
      if v_inserted then
        v_added := v_added + 1;
      else
        v_existing := v_existing + 1;
      end if;
    end if;
  end loop;

  if coalesce(p_attempt ->> 'make_card', '') = 'true' and v_followup is not null
     and v_followup ->> 'status' <> 'covered' then
    select value into v_followup_point
      from pg_catalog.jsonb_array_elements(v_points)
     where value ->> 'id' = v_followup ->> 'point_id'
     limit 1;
    v_card_material := coalesce((v_followup_point ->> 'material_id')::uuid, v_material);
    v_card_question := v_followup ->> 'question';
    if v_card_material is not null and pg_catalog.char_length(v_card_question) >= 5
       and not exists (select 1 from public.flashcard_progress f
                       where f.user_id = v_user and f.material_id = v_card_material and f.question = v_card_question) then
      v_quote := v_followup_point ->> 'source_quote';
      v_label := coalesce(nullif(v_followup_point ->> 'source_label', ''), 'Лекция');
      insert into public.flashcard_progress
        (user_id, material_id, question, answer, origin, source_ids, next_review, interval_days, repetitions)
      values
        (v_user, v_card_material, v_card_question,
         pg_catalog.left(coalesce(nullif(v_followup ->> 'expected', ''), v_followup_point ->> 'title', '')
           || case when v_quote <> '' then E'\n\n' || v_label || ': «' || v_quote || '»' else '' end, 2000),
         'oral_followup',
         coalesce(array(select pg_catalog.jsonb_array_elements_text(v_followup_point -> 'source_ids')), '{}'::text[]),
         pg_catalog.now() + interval '1 day', 1, 0);
      v_card := true;
    end if;
  end if;

  return pg_catalog.jsonb_build_object('session_id', v_session_id, 'duplicate', false,
    'events', v_events, 'mistakes_added', v_added, 'mistakes_existing', v_existing, 'card_added', v_card);
end;
$fn$;

-- 2. The bot's copy, as 20261010120006_telegram_bot_voice.sql 1 with formula v2.
create or replace function meldy_private.record_oral_attempt_for(p_user uuid, p_attempt jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_user uuid := p_user;
  v_attempt_id text;
  v_question_id uuid;
  v_exam_id uuid;
  v_hash text;
  v_question text;
  v_subject text;
  v_session_id uuid;
  v_material uuid;
  v_local_date date;
  v_score integer;
  v_grade integer;
  v_confidence smallint;
  v_rubric_id text;
  v_input text;
  v_raw jsonb;
  v_point jsonb;
  v_points jsonb := '[]'::jsonb;
  v_ids text[] := '{}'::text[];
  v_point_id text;
  v_status text;
  v_point_material uuid;
  v_sources text[];
  v_title text;
  v_quote text;
  v_label text;
  v_credit real;
  v_followup jsonb;
  v_followup_point jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_recovered boolean;
  v_inserted boolean;
  v_card_material uuid;
  v_card_question text;
  v_events integer := 0;
  v_added integer := 0;
  v_existing integer := 0;
  v_card boolean := false;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_attempt is null or pg_catalog.jsonb_typeof(p_attempt) <> 'object'
     or pg_catalog.jsonb_typeof(p_attempt -> 'points') is distinct from 'array'
     or pg_catalog.octet_length(p_attempt::text) > 32768 then
    raise exception 'invalid oral attempt' using errcode = '22023';
  end if;
  v_attempt_id := p_attempt ->> 'attempt_id';
  if v_attempt_id is null or v_attempt_id !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'attempt_id is required' using errcode = '22023';
  end if;
  if coalesce(p_attempt ->> 'exam_question_id', '') !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'exam_question_id must be a uuid' using errcode = '22023';
  end if;
  v_question_id := (p_attempt ->> 'exam_question_id')::uuid;
  v_score := case when coalesce(p_attempt ->> 'score', '') ~ '^\d{1,3}$' then (p_attempt ->> 'score')::integer end;
  v_grade := case when coalesce(p_attempt ->> 'grade', '') ~ '^[2-5]$' then (p_attempt ->> 'grade')::integer end;
  if v_score is null or v_score > 100 or v_grade is null then
    raise exception 'score (0..100) and grade (2..5) are required' using errcode = '22023';
  end if;

  select q.question_hash, q.text, q.exam_id, e.title
    into v_hash, v_question, v_exam_id, v_subject
    from public.exam_questions q
    join public.exams e on e.id = q.exam_id
   where q.id = v_question_id and q.user_id = v_user;
  if not found then
    raise exception 'exam question not found' using errcode = 'P0002';
  end if;

  -- Serialise retries of the same attempt, then answer a retry with the first result.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':' || v_attempt_id, 0));
  select e.session_id into v_session_id
    from public.learning_events e
   where e.user_id = v_user and e.client_event_id = v_attempt_id || ':answer';
  if found then
    return pg_catalog.jsonb_build_object('session_id', v_session_id, 'duplicate', true,
      'events', 0, 'mistakes_added', 0, 'mistakes_existing', 0, 'card_added', false);
  end if;

  if coalesce(p_attempt ->> 'material_id', '') ~ '^[0-9a-fA-F-]{36}$' then
    select m.id into v_material
      from public.materials m
     where m.id = (p_attempt ->> 'material_id')::uuid and m.user_id = v_user;
  end if;
  v_local_date := case when coalesce(p_attempt ->> 'local_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
                       then (p_attempt ->> 'local_date')::date end;
  v_confidence := case when coalesce(p_attempt ->> 'confidence', '') ~ '^[1-3]$'
                       then (p_attempt ->> 'confidence')::smallint end;
  v_rubric_id := case when coalesce(p_attempt ->> 'rubric_id', '') ~ '^[0-9a-fA-F-]{36}$'
                      then p_attempt ->> 'rubric_id' end;
  v_input := case when p_attempt ->> 'input' in ('speech', 'text', 'mixed') then p_attempt ->> 'input' else 'text' end;

  -- Clean points: valid unique ids p1..p6, known statuses, short quotes, own materials only.
  for v_raw in select value from pg_catalog.jsonb_array_elements(p_attempt -> 'points') loop
    v_point_id := v_raw ->> 'id';
    continue when v_point_id is null or v_point_id !~ '^p[1-6]$' or v_point_id = any (v_ids);
    v_ids := v_ids || v_point_id;
    v_point_material := null;
    if coalesce(v_raw ->> 'material_id', '') ~ '^[0-9a-fA-F-]{36}$' then
      select m.id into v_point_material
        from public.materials m
       where m.id = (v_raw ->> 'material_id')::uuid and m.user_id = v_user;
    end if;
    v_points := v_points || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'id', v_point_id,
      'title', pg_catalog.left(pg_catalog.btrim(coalesce(v_raw ->> 'title', '')), 120),
      'essential', coalesce(v_raw ->> 'essential', '') = 'true',
      'status', case when v_raw ->> 'status' in ('covered', 'partial', 'missing', 'wrong', 'unrated')
                     then v_raw ->> 'status' else 'unrated' end,
      'credit', case when pg_catalog.jsonb_typeof(v_raw -> 'credit') = 'number'
                     then least(1, greatest(0, (v_raw ->> 'credit')::real)) end,
      'student_quote', pg_catalog.left(coalesce(v_raw ->> 'student_quote', ''), 160),
      'comment', pg_catalog.left(coalesce(v_raw ->> 'comment', ''), 200),
      'source_ids', pg_catalog.to_jsonb(coalesce(array(
         select s from pg_catalog.jsonb_array_elements_text(
           case when pg_catalog.jsonb_typeof(v_raw -> 'source_ids') = 'array' then v_raw -> 'source_ids' else '[]'::jsonb end) s
          where s ~ '^S[0-9]{1,3}$' limit 6), '{}'::text[])),
      'material_id', v_point_material,
      'source_quote', pg_catalog.left(coalesce(v_raw ->> 'source_quote', ''), 300),
      'source_label', pg_catalog.left(coalesce(v_raw ->> 'source_label', ''), 120),
      'live', coalesce(v_raw ->> 'live', '') = 'true'));
  end loop;
  if pg_catalog.jsonb_array_length(v_points) = 0 then
    raise exception 'at least one rubric point is required' using errcode = '22023';
  end if;

  if pg_catalog.jsonb_typeof(p_attempt -> 'followup') = 'object'
     and (p_attempt -> 'followup' ->> 'point_id') = any (v_ids) then
    v_followup := pg_catalog.jsonb_build_object(
      'point_id', p_attempt -> 'followup' ->> 'point_id',
      'question', pg_catalog.left(pg_catalog.btrim(coalesce(p_attempt -> 'followup' ->> 'question', '')), 200),
      'expected', pg_catalog.left(pg_catalog.btrim(coalesce(p_attempt -> 'followup' ->> 'expected', '')), 300),
      'status', case when p_attempt -> 'followup' ->> 'status' in ('covered', 'partial', 'missing', 'wrong')
                     then p_attempt -> 'followup' ->> 'status' else 'missing' end,
      'student_quote', pg_catalog.left(coalesce(p_attempt -> 'followup' ->> 'student_quote', ''), 160),
      'chosen_by', case when p_attempt -> 'followup' ->> 'chosen_by' = 'check' then 'check' else 'client' end);
  end if;

  if pg_catalog.jsonb_typeof(p_attempt -> 'errors') = 'array' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'point_id', x ->> 'point_id',
             'student_quote', pg_catalog.left(coalesce(x ->> 'student_quote', ''), 160),
             'correction', pg_catalog.left(coalesce(x ->> 'correction', ''), 160))), '[]'::jsonb)
      into v_errors
      from (select value as x from pg_catalog.jsonb_array_elements(p_attempt -> 'errors') limit 10) t
     where (x ->> 'point_id') = any (v_ids);
  end if;

  insert into public.exam_sessions
    (user_id, material_id, subject, kind, questions_json, total_questions, score, duration_seconds, status, completed_at)
  values
    (v_user, v_material, pg_catalog.left(v_subject, 200), 'oral_ticket',
     pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
       'v', 1,
       'exam_id', v_exam_id,
       'exam_question_id', v_question_id,
       'rubric_id', v_rubric_id,
       'question_hash', v_hash,
       'question', v_question,
       'input', v_input,
       'points', v_points,
       'followup', v_followup,
       'errors', v_errors,
       'verdict', pg_catalog.left(coalesce(p_attempt ->> 'verdict', ''), 600),
       'grade', v_grade,
       'formula', 'v2')),
     1, v_score,
     case when coalesce(p_attempt ->> 'duration_seconds', '') ~ '^\d{1,6}$'
          then least((p_attempt ->> 'duration_seconds')::integer, 3600) else 0 end,
     'completed', pg_catalog.now())
  returning id into v_session_id;

  insert into public.learning_events
    (user_id, local_date, material_id, kind, item_key, correct, score, confidence, session_id, client_event_id, payload)
  values
    (v_user, v_local_date, v_material, 'exam_answer', 'q:' || v_hash, v_grade >= 4, v_score / 100.0,
     v_confidence, v_session_id, v_attempt_id || ':answer',
     pg_catalog.jsonb_build_object(
       'v', 1,
       'exam_id', v_exam_id,
       'exam_question_id', v_question_id,
       'grade', v_grade, 'score_pct', v_score,
       'input', v_input,
       'rubric_id', v_rubric_id,
       'followup_point', v_followup ->> 'point_id',
       'followup_status', v_followup ->> 'status',
       'chosen_by', v_followup ->> 'chosen_by'));
  v_events := 1;

  for v_point in select value from pg_catalog.jsonb_array_elements(v_points) loop
    v_point_id := v_point ->> 'id';
    v_status := v_point ->> 'status';
    v_recovered := v_followup is not null and v_followup ->> 'point_id' = v_point_id
                   and v_followup ->> 'status' = 'covered';
    v_point_material := coalesce((v_point ->> 'material_id')::uuid, v_material);
    v_sources := coalesce(array(select pg_catalog.jsonb_array_elements_text(v_point -> 'source_ids')), '{}'::text[]);
    v_title := v_point ->> 'title';
    v_credit := (v_point ->> 'credit')::real;

    insert into public.learning_events
      (user_id, local_date, material_id, kind, item_key, correct, score, source_ids, session_id, client_event_id, payload)
    values
      (v_user, v_local_date, v_point_material, 'oral_point',
       'oral:' || coalesce(v_rubric_id, v_hash) || ':' || v_point_id,
       case when v_status = 'unrated' then null else v_status = 'covered' or v_recovered end,
       v_credit, v_sources, v_session_id, v_attempt_id || ':' || v_point_id,
       pg_catalog.jsonb_build_object(
         'v', 1, 'question_hash', v_hash, 'rubric_id', v_rubric_id,
         'point_id', v_point_id, 'title', v_title, 'status', v_status,
         'essential', (v_point ->> 'essential')::boolean,
         'live', (v_point ->> 'live')::boolean,
         'followup_status', case when v_followup ->> 'point_id' = v_point_id then v_followup ->> 'status' end));
    v_events := v_events + 1;

    if v_status in ('partial', 'missing', 'wrong') and not v_recovered and pg_catalog.char_length(v_title) > 0 then
      v_quote := v_point ->> 'source_quote';
      v_label := coalesce(nullif(v_point ->> 'source_label', ''), 'Лекция');
      insert into public.mistake_diary
        (user_id, material_id, exam_session_id, question, correct_answer, student_answer, topic,
         is_resolved, origin, item_key, source_ids, rubric_point_id)
      values
        (v_user, v_point_material, v_session_id, v_question,
         pg_catalog.left(v_title || case when v_quote <> '' then '. ' || v_label || ': «' || v_quote || '»' else '' end, 1000),
         coalesce(nullif(v_point ->> 'student_quote', ''), '(не названо)'),
         pg_catalog.left(v_subject, 200), false, 'oral_ticket',
         'oral:' || v_hash || ':' || pg_catalog.left(public.meldy_question_hash(v_title), 12),
         v_sources, v_point_id)
      on conflict (user_id, item_key) where item_key is not null and not is_resolved
      do update set student_answer = excluded.student_answer, exam_session_id = excluded.exam_session_id
      returning (xmax = 0) into v_inserted;
      if v_inserted then
        v_added := v_added + 1;
      else
        v_existing := v_existing + 1;
      end if;
    end if;
  end loop;

  if coalesce(p_attempt ->> 'make_card', '') = 'true' and v_followup is not null
     and v_followup ->> 'status' <> 'covered' then
    select value into v_followup_point
      from pg_catalog.jsonb_array_elements(v_points)
     where value ->> 'id' = v_followup ->> 'point_id'
     limit 1;
    v_card_material := coalesce((v_followup_point ->> 'material_id')::uuid, v_material);
    v_card_question := v_followup ->> 'question';
    if v_card_material is not null and pg_catalog.char_length(v_card_question) >= 5
       and not exists (select 1 from public.flashcard_progress f
                       where f.user_id = v_user and f.material_id = v_card_material and f.question = v_card_question) then
      v_quote := v_followup_point ->> 'source_quote';
      v_label := coalesce(nullif(v_followup_point ->> 'source_label', ''), 'Лекция');
      insert into public.flashcard_progress
        (user_id, material_id, question, answer, origin, source_ids, next_review, interval_days, repetitions)
      values
        (v_user, v_card_material, v_card_question,
         pg_catalog.left(coalesce(nullif(v_followup ->> 'expected', ''), v_followup_point ->> 'title', '')
           || case when v_quote <> '' then E'\n\n' || v_label || ': «' || v_quote || '»' else '' end, 2000),
         'oral_followup',
         coalesce(array(select pg_catalog.jsonb_array_elements_text(v_followup_point -> 'source_ids')), '{}'::text[]),
         pg_catalog.now() + interval '1 day', 1, 0);
      v_card := true;
    end if;
  end if;

  return pg_catalog.jsonb_build_object('session_id', v_session_id, 'duplicate', false,
    'events', v_events, 'mistakes_added', v_added, 'mistakes_existing', v_existing, 'card_added', v_card);
end;
$fn$;
