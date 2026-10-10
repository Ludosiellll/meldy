-- telegram_bot_voice
-- Repo file: supabase/migrations/20261010120006_telegram_bot_voice.sql (package T10 of the Telegram bot @Meldyteach_bot:
-- stage 5, answers by voice, 2026-10-10). Spec: meldy-notes/10_Project/Telegram_Bot_Spec_2026-10-09.md §2 decisions 28–29,
-- §4.9 (V1–V4, the refusals, the self-check), §6.2 (bot.config.flags.voice), §6.4, §10 (the Groq quota).
-- Rollback: supabase/rollback/20261010120006_telegram_bot_voice_down.sql. Local rehearsal (never live):
-- supabase/tests/local/telegram_bot_voice.sql. The read-only contract: the T10 block of supabase/tests/telegram_bot.sql.
--
-- Decision 28: the stage is built now and stays OFF. Everything here answers «off» unless bot.config.flags has
-- {"voice": true} (JSON true; absent, false or anything else is off). This file only adds "voice": false when the key
-- is missing; it never turns the switch either way after that. Enabling it is the owner's word after the live check.
--
-- How one oral question goes (the Edge Function `telegram` drives it, voice.ts):
--   V1  bot_voice_start → the question of the plan's AI-check session, its current rubric snapshot (one open per user);
--   voice → bot_voice_ticket(transcribe) → the function downloads the voice from Telegram and posts the bytes with the
--       ticket to the Space (backend/bot_bridge.py) → the Space calls bridge_voice_take(ticket) ONCE, which counts the
--       audio seconds (the student's ceiling, the shared 70 % stop) and gives the job's context → stt.transcribe_answer
--       → the text back to the function → bot_voice_part (V2);
--   «Проверить — 4 единицы» → bot_voice_ticket(check) → the Space takes it: bridge_voice_take CHARGES the units
--       (meldy_private.consume_ai_units_for, kind 'answer' = AI_COSTS.answer = 4) and gives the transcript and the points
--       → the site's quick check and protocol (oral_api) → bot_voice_checked (V3 when the check asks, else ready);
--       a model failure on the Space → bridge_voice_refund(ticket); a call that never came back → bot_voice_release;
--   the voice to V3 → bot_voice_ticket(followup) → the Space: the audio counted, the text, the site's one-point check →
--       bot_voice_followup; «Не знаю» under V3 → bot_voice_followup(missing) without the Space;
--   bot_voice_record → meldy_private.record_oral_attempt_for: the same exam_sessions row, journal events, mistakes and
--       review card as the site's record_oral_attempt (V4); «Не знаю» under V1 records the site's «не знаю» answer;
--   «Проверить себя без Meldy» → bot_voice_self (a sheet_peek of every point, as «Показать пункты» on the site) →
--       bot_voice_rate (the site's self_rating). «Следующий» → bot_voice_next.
-- Refusals never charge: too short (the first voice under 5 s, by Telegram's duration — the function; under 8 words — the
-- Space), not recognised, the AI limit, the student's ceiling and the shared stop.
--
-- Single-use tickets (spec: «Space with single-use tickets, no shared secret», tech report §0.4): 64 hex characters from
-- two gen_random_uuid() (244 random bits); only sha256 hex is stored; 2 minutes; one take, whatever it answers; bound to
-- the user, the attempt (the item) and the job. The Space holds no service key: it calls bridge_voice_take and
-- bridge_voice_refund with the project's public key (role anon); the ticket is their whole authority.
--
-- Limits (defaults; the owner may override them in bot.config.flags, each checked against a range):
--   voice_user_day_s 1800 (the student's audio a UTC day: 30 minutes), voice_day_audio_s 28800 (Groq's audio seconds a day
--   per organisation, free tier, whisper-large-v3-turbo; checked 2026-10-10 against Groq's rate-limit table), voice_stop_share
--   0.7 (the bot stops new voices at 70 % of the day's Groq audio, so the site's oral path keeps the rest). A voice counts
--   at least 10 s (Groq bills short requests as 10 s; whether its rate counter does the same is not documented).
--   The counter sees the bot's audio only: the site's /api/oral/transcribe records nothing (spec §10, the T10 report).
--
-- Cores (schema meldy_private, invoker, no client EXECUTE): the four site functions the bot needs for a given user, copied
-- verbatim except the one line that reads the user (auth.uid() → p_user): ai_quota_status_for, consume_ai_units_for,
-- refund_ai_units_for, record_oral_attempt_for. The contract compares their prosrc with the live functions: any later
-- change of the site's function shows as a drift. Nothing of the site changes: no ALTER and no REPLACE of an existing
-- object; the oral, quota and container functions stay as they are.
-- Reads: the oral exam's questions and their CURRENT rubric come from package T11's meldy_private.oral_sheet_for(p_user,
-- p_exam_id) (20261010120007_oral_plan_inputs.sql, the same JSON as GET /api/oral/sheet), called at run time from
-- plpgsql: this file applies before or after T11's; until T11's is in, bot_voice_start answers «not_ready».
-- Dependencies: T1's schema bot (bot.config, bot.links, bot.active_link), the container's meldy_private
-- (require_service_role, container_ids_of), the quota tables (20261004205613, 20261005031722), the journal
-- (20261003083154, 20261005143420 sheet_peek), oral_answer_texts (20261007103621).
-- Bot functions answer every input problem with a status, never an error (an error turns a message into 503 and a
-- 24-hour retry). They raise only 42501 (not the service role). Additive and re-runnable.

-- 0. The switch: off unless the owner says so.
update bot.config set flags = flags || '{"voice": false}'::jsonb where id = 1 and not (flags ? 'voice');

-- 1. Cores (copies of the site's functions for a given user; see the header).
create or replace function meldy_private.ai_quota_status_for(p_user uuid)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $fn$
DECLARE
  v_uid uuid := p_user;
  v_day date := (pg_catalog.now() AT TIME ZONE 'UTC')::date;
  v_pro boolean;
  v_used integer;
  v_limit integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ai_quota_status: no signed-in user' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(p.is_pro, false) INTO v_pro FROM public.profiles p WHERE p.id = v_uid;
  v_pro := COALESCE(v_pro, false);
  v_limit := public.ai_daily_limit(v_pro);
  SELECT COALESCE(pg_catalog.sum(GREATEST(COALESCE(u.requests_count, 0), 0)), 0)::integer
    INTO v_used
    FROM public.ai_usage u
   WHERE u.user_id = v_uid AND u.date = v_day;
  RETURN pg_catalog.jsonb_build_object(
    'pro', v_pro,
    'used', v_used,
    'limit', v_limit,
    'day', v_day,
    'resets_at', pg_catalog.to_char(v_day + 1, 'YYYY-MM-DD') || 'T00:00:00Z');
END
$fn$;

create or replace function meldy_private.consume_ai_units_for(p_user uuid, p_units integer, p_kind text)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $fn$
DECLARE
  v_uid uuid := p_user;
  v_day date := (pg_catalog.now() AT TIME ZONE 'UTC')::date;
  v_pro boolean;
  v_limit integer;
  v_used integer;
  v_allowed boolean;
  v_charge uuid;
  v_receipts_from timestamptz := pg_catalog.now() - interval '2 days';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'consume_ai_units: no signed-in user' USING ERRCODE = '42501';
  END IF;
  IF p_units IS NULL OR p_units < 0 OR p_units > 1000 THEN
    RAISE EXCEPTION 'consume_ai_units: units must be 0..1000' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind !~ '^[A-Za-z0-9_.:-]{1,40}$' THEN
    RAISE EXCEPTION 'consume_ai_units: kind must be a short identifier' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(p.is_pro, false) INTO v_pro FROM public.profiles p WHERE p.id = v_uid;
  v_pro := COALESCE(v_pro, false);
  v_limit := public.ai_daily_limit(v_pro);

  -- The day row first (a parallel charge may create it: then nothing happens here), then one
  -- guarded UPDATE: concurrent charges serialise on the row and each sees the other's sum.
  INSERT INTO public.ai_usage (user_id, date, requests_count)
  VALUES (v_uid, v_day, 0)
  ON CONFLICT (user_id, date) DO NOTHING;

  UPDATE public.ai_usage u
     SET requests_count = GREATEST(COALESCE(u.requests_count, 0), 0) + p_units
   WHERE u.user_id = v_uid AND u.date = v_day
     AND GREATEST(COALESCE(u.requests_count, 0), 0) + p_units <= v_limit
  RETURNING u.requests_count INTO v_used;
  v_allowed := FOUND;

  IF v_allowed THEN
    IF p_units > 0 THEN
      INSERT INTO public.ai_charges (user_id, day, kind, units)
      VALUES (v_uid, v_day, p_kind, p_units)
      RETURNING id INTO v_charge;
      -- Receipts are refundable for an hour; older ones of this user are not needed.
      DELETE FROM public.ai_charges c
       WHERE c.user_id = v_uid AND c.created_at < v_receipts_from;
    END IF;
  ELSE
    SELECT GREATEST(COALESCE(u.requests_count, 0), 0) INTO v_used
      FROM public.ai_usage u
     WHERE u.user_id = v_uid AND u.date = v_day;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'allowed', v_allowed,
    'pro', v_pro,
    'used', COALESCE(v_used, 0),
    'limit', v_limit,
    'resets_at', pg_catalog.to_char(v_day + 1, 'YYYY-MM-DD') || 'T00:00:00Z',
    'charge_id', v_charge);
END
$fn$;

create or replace function meldy_private.refund_ai_units_for(p_user uuid, p_units integer, p_kind text, p_charge uuid)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $fn$
DECLARE
  v_uid uuid := p_user;
  v_today date := (pg_catalog.now() AT TIME ZONE 'UTC')::date;
  v_charge public.ai_charges%ROWTYPE;
  v_refundable_from timestamptz := pg_catalog.now() - interval '1 hour';
  v_back integer := 0;
  v_pro boolean;
  v_used integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'refund_ai_units: no signed-in user' USING ERRCODE = '42501';
  END IF;
  IF p_units IS NULL OR p_units < 1 OR p_units > 1000 THEN
    RAISE EXCEPTION 'refund_ai_units: units must be 1..1000' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind !~ '^[A-Za-z0-9_.:-]{1,40}$' OR p_charge IS NULL THEN
    RAISE EXCEPTION 'refund_ai_units: kind and charge are required' USING ERRCODE = '22023';
  END IF;

  -- Only the caller's own charge of that kind, within an hour, and never more than it spent;
  -- an unknown or foreign charge refunds nothing and says nothing about it.
  SELECT * INTO v_charge
    FROM public.ai_charges c
   WHERE c.id = p_charge AND c.user_id = v_uid AND c.kind = p_kind
     AND c.created_at > v_refundable_from
   FOR UPDATE;
  IF FOUND THEN
    v_back := LEAST(p_units, v_charge.units - v_charge.refunded);
    IF v_back > 0 THEN
      UPDATE public.ai_charges SET refunded = refunded + v_back WHERE id = v_charge.id;
      -- The day of the charge, not today's: a refund after midnight UTC fixes the right day.
      UPDATE public.ai_usage u
         SET requests_count = GREATEST(COALESCE(u.requests_count, 0) - v_back, 0)
       WHERE u.user_id = v_uid AND u.date = v_charge.day;
    END IF;
  END IF;

  SELECT COALESCE(p.is_pro, false) INTO v_pro FROM public.profiles p WHERE p.id = v_uid;
  SELECT COALESCE(pg_catalog.sum(GREATEST(COALESCE(u.requests_count, 0), 0)), 0)::integer
    INTO v_used
    FROM public.ai_usage u
   WHERE u.user_id = v_uid AND u.date = v_today;
  RETURN pg_catalog.jsonb_build_object(
    'refunded', v_back,
    'used', v_used,
    'limit', public.ai_daily_limit(COALESCE(v_pro, false)),
    'resets_at', pg_catalog.to_char(v_today + 1, 'YYYY-MM-DD') || 'T00:00:00Z');
END
$fn$;

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
       'formula', 'v1')),
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

-- 2. Tables (schema bot: no client access, row security on, no policy; only the functions below touch them).
-- 2a. One oral question in the chat: V1 to the result or the self-check. One OPEN attempt per user (asked, answering,
--     followup, ready, self). aid = the 8 base36 characters of its callback data (client input: every function matches
--     it with the user it resolves). queue = the question ids of the plan's AI-check session, pos = this one's index.
--     question / rubric = the snapshot taken at V1 from T11's oral_sheet_for (+ each point's follow-up question from
--     public.oral_rubrics): the answer is checked against what V1 promised. parts = the answer's recognised text,
--     [{text, seconds}], cleared when the attempt ends (the site keeps a whole text only with consent, oral_answer_texts).
--     checked = the Space's quick check and protocol; followup = {point_id, question, expected, status, student_quote,
--     judged_by}. charge_id / charged = the units of «Проверить» (server only, never returned). busy_until = a call to
--     the Space in flight. messages = the bot's message ids {v1, v2, v3, v4, voice}.
create table if not exists bot.voice_attempts (
  id uuid primary key default gen_random_uuid(),
  aid text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id bigint not null,
  container_id uuid not null,
  subject_id uuid not null,
  exam_id uuid not null,
  question_id uuid not null,
  queue uuid[] not null,
  pos smallint not null,
  local_day date not null,
  subject_title text not null default '',
  question jsonb not null,
  rubric jsonb not null,
  phase text not null default 'asked',
  parts jsonb not null default '[]'::jsonb,
  seconds integer not null default 0,
  checked jsonb,
  followup jsonb,
  charge_id uuid,
  charged smallint not null default 0,
  busy_until timestamptz,
  session_id uuid,
  messages jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_attempts_aid_key unique (aid),
  constraint voice_attempts_aid_check check (aid ~ '^[0-9a-z]{8}$'),
  constraint voice_attempts_chat_check check (chat_id > 0),
  constraint voice_attempts_queue_check check (pg_catalog.cardinality(queue) between 1 and 10
                                               and pos >= 0 and pos < pg_catalog.cardinality(queue)),
  constraint voice_attempts_phase_check check (phase in ('asked', 'answering', 'followup', 'ready', 'self', 'done', 'rated', 'closed')),
  constraint voice_attempts_title_check check (char_length(subject_title) <= 200),
  constraint voice_attempts_json_check check (jsonb_typeof(question) = 'object' and jsonb_typeof(rubric) = 'object'
                                              and octet_length(rubric::text) <= 65536 and jsonb_typeof(messages) = 'object'),
  constraint voice_attempts_parts_check check (jsonb_typeof(parts) = 'array' and octet_length(parts::text) <= 32768),
  constraint voice_attempts_checked_check check (checked is null or (jsonb_typeof(checked) = 'object' and octet_length(checked::text) <= 32768)),
  constraint voice_attempts_followup_check check (followup is null or (jsonb_typeof(followup) = 'object' and octet_length(followup::text) <= 4096)),
  constraint voice_attempts_charged_check check (charged between 0 and 1000 and seconds between 0 and 86400)
);
create unique index if not exists voice_attempts_open_key on bot.voice_attempts (user_id)
  where phase in ('asked', 'answering', 'followup', 'ready', 'self');
create index if not exists voice_attempts_user_idx on bot.voice_attempts (user_id, created_at desc);
create index if not exists voice_attempts_updated_idx on bot.voice_attempts (updated_at);
comment on table bot.voice_attempts is 'Telegram voice answers (stage 5): one oral question from V1 to the result; one open per user; the recognised text is cleared when it ends.';

-- 2b. Single-use tickets from the bot to the Space: sha256 hex only, 2 minutes, one take (taken_at, whatever the take
--     answers), bound to the user, the attempt and its question (the item) and the job. seconds = the voice's length
--     by Telegram (the audio jobs). outcome = what the take said. charge_id / charged = the units a check took.
create table if not exists bot.voice_tickets (
  ticket_hash text primary key,
  attempt_id uuid not null references bot.voice_attempts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null,
  job text not null,
  seconds integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  taken_at timestamptz,
  outcome text,
  charge_id uuid,
  charged smallint not null default 0,
  refunded_at timestamptz,
  constraint voice_tickets_hash_check check (ticket_hash ~ '^[0-9a-f]{64}$'),
  constraint voice_tickets_job_check check (job in ('transcribe', 'check', 'followup')),
  constraint voice_tickets_seconds_check check (seconds between 0 and 3600),
  constraint voice_tickets_outcome_check check (outcome is null or outcome ~ '^[a-z_]{1,24}$'),
  constraint voice_tickets_charged_check check (charged between 0 and 1000)
);
create index if not exists voice_tickets_attempt_idx on bot.voice_tickets (attempt_id);
create index if not exists voice_tickets_user_idx on bot.voice_tickets (user_id);
create index if not exists voice_tickets_expires_idx on bot.voice_tickets (expires_at);
comment on table bot.voice_tickets is 'Single-use tickets bot → Space for one voice job: sha256 only, 2 minutes, one take; bound to user, question and job.';

-- 2c. Audio sent to recognition, per UTC day (Groq counts its quota per organisation and day): per student (the
--     ceiling) and in all (the shared stop). A take counts its voice, at least 10 s; refused = takes the limit stopped.
create table if not exists bot.voice_audio (
  day date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  seconds integer not null default 0,
  takes integer not null default 0,
  refused integer not null default 0,
  primary key (day, user_id),
  constraint voice_audio_counts_check check (seconds >= 0 and takes >= 0 and refused >= 0)
);
create index if not exists voice_audio_user_idx on bot.voice_audio (user_id);
create table if not exists bot.voice_days (
  day date primary key,
  seconds integer not null default 0,
  takes integer not null default 0,
  refused integer not null default 0,
  constraint voice_days_counts_check check (seconds >= 0 and takes >= 0 and refused >= 0)
);
comment on table bot.voice_audio is 'Voice seconds sent to recognition per UTC day and student (the student''s ceiling).';
comment on table bot.voice_days is 'Voice seconds sent to recognition per UTC day by the whole bot (the shared stop at 70 % of Groq''s day).';

alter table bot.voice_attempts enable row level security;
alter table bot.voice_tickets enable row level security;
alter table bot.voice_audio enable row level security;
alter table bot.voice_days enable row level security;

-- 3. Helpers (schema bot, not reachable by clients; they run inside the DEFINER functions as the migration role).
-- 3a. The switch: true only for {"voice": true}.
create or replace function bot.voice_on()
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce((select c.flags -> 'voice' = 'true'::jsonb from bot.config c where c.id = 1), false)
$fn$;

-- 3b. The limits, with the owner's overrides from bot.config.flags (each read only when it is a number in range).
--     price = AI_COSTS.answer of backend/plans.py and frontend/src/lib/plans.ts (a backend test pins it).
create or replace function bot.voice_limits(out user_day_s integer, out day_audio_s integer, out stop_s integer, out price integer)
language sql
stable
set search_path = ''
as $fn$
  with f as (select coalesce((select c.flags from bot.config c where c.id = 1), '{}'::jsonb) as flags),
  v as (
    select case when pg_catalog.jsonb_typeof(f.flags -> 'voice_user_day_s') = 'number'
                then (case when (f.flags ->> 'voice_user_day_s')::numeric between 60 and 14400
                           then pg_catalog.floor((f.flags ->> 'voice_user_day_s')::numeric)::integer else 1800 end)
                else 1800 end as u,
           case when pg_catalog.jsonb_typeof(f.flags -> 'voice_day_audio_s') = 'number'
                then (case when (f.flags ->> 'voice_day_audio_s')::numeric between 600 and 10000000
                           then pg_catalog.floor((f.flags ->> 'voice_day_audio_s')::numeric)::integer else 28800 end)
                else 28800 end as d,
           case when pg_catalog.jsonb_typeof(f.flags -> 'voice_stop_share') = 'number'
                then (case when (f.flags ->> 'voice_stop_share')::numeric between 0.05 and 1
                           then (f.flags ->> 'voice_stop_share')::numeric else 0.7 end)
                else 0.7 end as s
      from f
  )
  select v.u, v.d, pg_catalog.floor(v.d * v.s)::integer, 4 from v
$fn$;

-- 3c. A fresh attempt handle: 8 base36 characters from sha256 of a random uuid.
create or replace function bot.voice_aid()
returns text
language sql
volatile
set search_path = ''
as $fn$
  select pg_catalog.string_agg(pg_catalog.substr('0123456789abcdefghijklmnopqrstuvwxyz', (pg_catalog.get_byte(x.b, i) % 36) + 1, 1), '' order by i)
    from (select pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')) as b) x,
         pg_catalog.generate_series(0, 7) as i
$fn$;

-- 3d. Today's AI units for the bot's lines («сегодня осталось 87»): the site's own count (ai_quota_status_for).
create or replace function bot.voice_units(p_user uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_q jsonb := meldy_private.ai_quota_status_for(p_user);
  v_limit integer := coalesce((v_q ->> 'limit')::integer, 0);
  v_used integer := coalesce((v_q ->> 'used')::integer, 0);
begin
  return pg_catalog.jsonb_build_object('left', greatest(v_limit - v_used, 0), 'used', v_used, 'limit', v_limit,
    'price', (select l.price from bot.voice_limits() l), 'resets_at', v_q ->> 'resets_at');
end;
$fn$;

-- 3e. The student's audio left today and whether the shared stop is on (read only; bridge_voice_take decides).
create or replace function bot.voice_audio_state(p_user uuid, p_now timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'left_s', greatest(l.user_day_s - coalesce((select a.seconds from bot.voice_audio a
                                                  where a.day = (p_now at time zone 'utc')::date and a.user_id = p_user), 0), 0),
    'stop', coalesce((select d.seconds from bot.voice_days d where d.day = (p_now at time zone 'utc')::date), 0) >= l.stop_s)
    from bot.voice_limits() l
$fn$;

-- 3f. An attempt as the function needs it (no user id, no charge id).
create or replace function bot.voice_attempt_json(p_a bot.voice_attempts, p_now timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'aid', p_a.aid, 'phase', p_a.phase, 'container_id', p_a.container_id, 'subject_id', p_a.subject_id,
    'subject_title', p_a.subject_title, 'exam_id', p_a.exam_id, 'question_id', p_a.question_id, 'question', p_a.question,
    'n', p_a.pos + 1, 'of', pg_catalog.cardinality(p_a.queue), 'has_next', p_a.pos + 1 < pg_catalog.cardinality(p_a.queue),
    'rubric_id', p_a.rubric ->> 'id', 'evidence_material_id', p_a.rubric ->> 'evidence_material_id',
    'points', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                          'id', x.p ->> 'id', 'title', x.p ->> 'title', 'essential', x.p -> 'essential',
                          'source_quote', x.p -> 'source_quote', 'source_ids', x.p -> 'source_ids') order by x.o)
                          from pg_catalog.jsonb_array_elements(p_a.rubric -> 'points') with ordinality as x(p, o)), '[]'::jsonb),
    'materials', coalesce(p_a.rubric -> 'materials', '[]'::jsonb),
    'parts', p_a.parts, 'seconds', p_a.seconds, 'checked', p_a.checked, 'followup', p_a.followup,
    'charged', p_a.charged, 'session_id', p_a.session_id, 'messages', p_a.messages,
    'busy', coalesce(p_a.busy_until > p_now, false), 'local_day', p_a.local_day, 'updated_at', p_a.updated_at)
$fn$;

-- 3g. An open attempt of an earlier local day ends (its text goes).
create or replace function bot.voice_expire(p_user uuid, p_today date)
returns void
language sql
volatile
set search_path = ''
as $fn$
  update bot.voice_attempts a
     set phase = 'closed', parts = '[]'::jsonb, busy_until = null, updated_at = pg_catalog.now()
   where a.user_id = p_user and a.phase in ('asked', 'answering', 'followup', 'ready', 'self') and a.local_day < p_today
$fn$;

-- 3h. Housekeeping (from bot_voice_start, in small batches): tickets a day after they expired, attempts after 3 days,
--     any recognised text left a day after its last change, audio counters after 40 days (per student) / 400 (in all).
create or replace function bot.voice_cleanup(p_now timestamptz)
returns void
language sql
volatile
set search_path = ''
as $fn$
  delete from bot.voice_tickets t
   where t.ticket_hash in (select x.ticket_hash from bot.voice_tickets x where x.expires_at < p_now - interval '1 day' limit 500);
  delete from bot.voice_attempts a
   where a.id in (select x.id from bot.voice_attempts x where x.updated_at < p_now - interval '3 days' limit 200);
  update bot.voice_attempts a
     set phase = case when a.phase in ('asked', 'answering', 'followup', 'ready', 'self') then 'closed' else a.phase end,
         parts = '[]'::jsonb, busy_until = null
   where a.id in (select x.id from bot.voice_attempts x
                   where x.updated_at < p_now - interval '1 day' and x.parts <> '[]'::jsonb limit 200);
  delete from bot.voice_audio u where u.day < (p_now at time zone 'utc')::date - 40;
  delete from bot.voice_days d where d.day < (p_now at time zone 'utc')::date - 400;
$fn$;

-- 3i. Open the question at p_pos of the queue (or the next one with written points): read the exam's sheet through
--     T11's meldy_private.oral_sheet_for (the current rubric by the rubric key, as GET /api/oral/sheet), take each
--     point's follow-up from its public.oral_rubrics row, close the user's earlier open attempt, insert the new one.
--     status: ok (+ attempt, units, audio) | empty (no question of the queue has written points from p_pos on) |
--     gone (not this user's exam) | not_ready (T11's reads are not installed yet).
create or replace function bot.voice_open(p_l bot.links, p_container uuid, p_subject uuid, p_exam uuid, p_title text,
                                          p_queue uuid[], p_pos integer, p_now timestamptz)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_user uuid := p_l.user_id;
  v_sheet jsonb;
  v_q jsonb;
  v_rubric jsonb;
  v_full jsonb;
  v_points jsonb;
  v_pos integer := greatest(coalesce(p_pos, 0), 0);
  v_evidence text;
  v_a bot.voice_attempts%rowtype;
begin
  begin
    v_sheet := meldy_private.oral_sheet_for(v_user, p_exam);
  exception
    when undefined_function then
      return pg_catalog.jsonb_build_object('status', 'not_ready');
    when no_data_found or insufficient_privilege then
      return pg_catalog.jsonb_build_object('status', 'gone');
  end;
  loop
    exit when v_pos >= pg_catalog.cardinality(p_queue);
    v_q := null;
    select q into v_q
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(v_sheet -> 'questions') = 'array'
                                                then v_sheet -> 'questions' else '[]'::jsonb end) as q
     where q ->> 'question_id' = p_queue[v_pos + 1]::text
     limit 1;
    v_rubric := case when v_q is not null and pg_catalog.jsonb_typeof(v_q -> 'rubric') = 'object' then v_q -> 'rubric' end;
    exit when v_rubric is not null
          and pg_catalog.jsonb_typeof(v_rubric -> 'points') = 'array' and pg_catalog.jsonb_array_length(v_rubric -> 'points') > 0
          and coalesce(v_rubric ->> 'rubric_id', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          and coalesce(v_q ->> 'question_hash', '') ~ '^[0-9a-f]{32}$';
    v_pos := v_pos + 1;
  end loop;
  if v_pos >= pg_catalog.cardinality(p_queue) then
    return pg_catalog.jsonb_build_object('status', 'empty');
  end if;

  -- The sheet leaves out each point's follow-up (the examiner's question and what must sound): the stored rubric has it.
  select r.rubric into v_full from public.oral_rubrics r where r.id = (v_rubric ->> 'rubric_id')::uuid and r.user_id = v_user;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', x.p ->> 'id', 'title', coalesce(x.p ->> 'title', ''),
           'essential', coalesce(x.p -> 'essential', 'false'::jsonb) = 'true'::jsonb,
           'source_quote', coalesce(x.p ->> 'source_quote', ''),
           'source_ids', case when pg_catalog.jsonb_typeof(x.p -> 'source_ids') = 'array' then x.p -> 'source_ids' else '[]'::jsonb end,
           'followup', coalesce((select pg_catalog.jsonb_build_object(
                                          'question', coalesce(f.fp -> 'followup' ->> 'question', ''),
                                          'expected', coalesce(f.fp -> 'followup' ->> 'expected', ''))
                                   from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(v_full -> 'points') = 'array'
                                                                             then v_full -> 'points' else '[]'::jsonb end) as f(fp)
                                  where f.fp ->> 'id' = x.p ->> 'id'
                                  limit 1), '{"question": "", "expected": ""}'::jsonb))
           order by x.o), '[]'::jsonb)
    into v_points
    from pg_catalog.jsonb_array_elements(v_rubric -> 'points') with ordinality as x(p, o);
  select q.evidence -> 0 ->> 'material_id' into v_evidence
    from public.exam_questions q
   where q.id = p_queue[v_pos + 1] and q.user_id = v_user and pg_catalog.jsonb_typeof(q.evidence) = 'array';

  update bot.voice_attempts a
     set phase = 'closed', parts = '[]'::jsonb, busy_until = null, updated_at = p_now
   where a.user_id = v_user and a.phase in ('asked', 'answering', 'followup', 'ready', 'self');
  for i in 1..5 loop
    begin
      insert into bot.voice_attempts (aid, user_id, chat_id, container_id, subject_id, exam_id, question_id, queue, pos, local_day,
                                      subject_title, question, rubric, created_at, updated_at)
      values (bot.voice_aid(), v_user, p_l.chat_id, p_container, p_subject, p_exam, p_queue[v_pos + 1], p_queue, v_pos,
              (p_now at time zone p_l.tz)::date, pg_catalog.left(pg_catalog.btrim(coalesce(p_title, '')), 200),
              pg_catalog.jsonb_build_object('text', coalesce(v_q ->> 'text', ''), 'label', coalesce(v_q ->> 'label', ''),
                                            'position', v_q -> 'position', 'hash', v_q ->> 'question_hash'),
              pg_catalog.jsonb_build_object('id', pg_catalog.lower(v_rubric ->> 'rubric_id'), 'points', v_points,
                                            'materials', case when pg_catalog.jsonb_typeof(v_rubric -> 'materials') = 'array'
                                                              then v_rubric -> 'materials' else '[]'::jsonb end,
                                            'evidence_material_id', v_evidence),
              p_now, p_now)
      returning * into v_a;
      exit;
    exception when unique_violation then
      -- Only the 8-character handle can collide here (the caller holds the user's link row): draw another.
      if i = 5 then raise; end if;
    end;
  end loop;
  return pg_catalog.jsonb_build_object('status', 'ok', 'attempt', bot.voice_attempt_json(v_a, p_now),
    'units', bot.voice_units(v_user), 'audio', bot.voice_audio_state(v_user, p_now));
end;
$fn$;

-- 4. The bot's functions (service role). Every one: SECURITY DEFINER, search_path '', the gate first, the user only from
--    bot.links by the Telegram user id; the switch off → {"status": "off"} (bot_voice_state: {"voice": false}).
--    ATTEMPT = bot.voice_attempt_json. Statuses: off | unlinked | invalid (a call the code never means) | gone (no such
--    attempt of this user, or not in a state for this) | busy (a check or follow-up in flight) | ok.

-- 4a. Where the user is: the open attempt (after closing one of an earlier day), the units and the audio left.
create or replace function public.bot_voice_state(p_tg_user_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_a bot.voice_attempts%rowtype;
begin
  perform meldy_private.require_service_role();
  if not bot.voice_on() then
    return pg_catalog.jsonb_build_object('voice', false);
  end if;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('voice', true, 'linked', false);
  end if;
  perform bot.voice_expire(v_l.user_id, (v_now at time zone v_l.tz)::date);
  select a.* into v_a from bot.voice_attempts a
   where a.user_id = v_l.user_id and a.phase in ('asked', 'answering', 'followup', 'ready', 'self');
  return pg_catalog.jsonb_build_object('voice', true, 'linked', true,
    'attempt', case when v_a.id is null then null else bot.voice_attempt_json(v_a, v_now) end,
    'units', bot.voice_units(v_l.user_id), 'audio', bot.voice_audio_state(v_l.user_id, v_now),
    'local_day', (v_now at time zone v_l.tz)::date, 'tz', v_l.tz);
end;
$fn$;

-- 4b. V1: open the question at p_pos of the plan's AI-check session p_question_ids (1–10 ids, the oral exam p_exam_id of
--     the subject p_subject_id in the container p_container_id: the owner's own oral exam or the member's bound copy).
--     status: ok (+ attempt, units, audio) | empty | gone | not_ready | invalid | unlinked | off.
create or replace function public.bot_voice_start(p_tg_user_id bigint, p_container_id uuid, p_subject_id uuid, p_exam_id uuid,
                                                 p_subject_title text, p_question_ids uuid[], p_pos integer default 0)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
begin
  perform meldy_private.require_service_role();
  if not bot.voice_on() then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_container_id is null or p_subject_id is null or p_exam_id is null or p_question_ids is null
     or pg_catalog.cardinality(p_question_ids) not between 1 and 10 or pg_catalog.array_position(p_question_ids, null) is not null
     or p_pos is null or p_pos < 0 or p_pos >= pg_catalog.cardinality(p_question_ids) then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  -- The user's link row is locked from here: one start (or next) of this user at a time.
  update bot.links l set last_seen_at = v_now where l.id = v_l.id;
  if not exists (
    select 1 from public.container_subjects s
     where s.id = p_subject_id and s.container_id = p_container_id
       and s.container_id in (select x.id from meldy_private.container_ids_of(v_l.user_id) as x(id))
       and ((s.owner_id = v_l.user_id and s.exam_id = p_exam_id)
            or exists (select 1 from public.container_member_exams me
                        where me.subject_id = s.id and me.user_id = v_l.user_id and me.exam_id = p_exam_id))) then
    return pg_catalog.jsonb_build_object('status', 'gone');
  end if;
  perform bot.voice_cleanup(v_now);
  perform bot.voice_expire(v_l.user_id, (v_now at time zone v_l.tz)::date);
  return bot.voice_open(v_l, p_container_id, p_subject_id, p_exam_id, p_subject_title, p_question_ids, p_pos, v_now);
end;
$fn$;

-- 4c. «Следующий: 2 из 3»: the next question of the session after an answer (done) or a self-check (rated).
--     status: ok (+ attempt, units, audio; again = it was open already) | end | empty | gone | not_ready | off | unlinked.
create or replace function public.bot_voice_next(p_tg_user_id bigint, p_aid text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_a bot.voice_attempts%rowtype;
  v_open bot.voice_attempts%rowtype;
begin
  perform meldy_private.require_service_role();
  if not bot.voice_on() then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_aid is null or p_aid !~ '^[0-9a-z]{8}$' then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  update bot.links l set last_seen_at = v_now where l.id = v_l.id;
  perform bot.voice_expire(v_l.user_id, (v_now at time zone v_l.tz)::date);
  select a.* into v_a from bot.voice_attempts a where a.aid = p_aid and a.user_id = v_l.user_id;
  if v_a.id is null or v_a.phase not in ('done', 'rated') or v_a.local_day <> (v_now at time zone v_l.tz)::date then
    return pg_catalog.jsonb_build_object('status', 'gone');
  end if;
  if v_a.pos + 1 >= pg_catalog.cardinality(v_a.queue) then
    return pg_catalog.jsonb_build_object('status', 'end');
  end if;
  -- Pressed twice: the next question is open already.
  select o.* into v_open from bot.voice_attempts o
   where o.user_id = v_l.user_id and o.phase in ('asked', 'answering', 'followup', 'ready', 'self')
     and o.queue = v_a.queue and o.pos > v_a.pos;
  if v_open.id is not null then
    return pg_catalog.jsonb_build_object('status', 'ok', 'again', true, 'attempt', bot.voice_attempt_json(v_open, v_now),
      'units', bot.voice_units(v_l.user_id), 'audio', bot.voice_audio_state(v_l.user_id, v_now));
  end if;
  return bot.voice_open(v_l, v_a.container_id, v_a.subject_id, v_a.exam_id, v_a.subject_title, v_a.queue, v_a.pos + 1, v_now);
end;
$fn$;

-- 4d. The bot's message ids of an attempt: p_which v1 | v2 | v3 | v4 | voice (the student's last voice); null forgets one.
create or replace function public.bot_voice_sent(p_tg_user_id bigint, p_aid text, p_which text, p_message_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_l bot.links%rowtype;
begin
  perform meldy_private.require_service_role();
  if not bot.voice_on() then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_aid is null or p_aid !~ '^[0-9a-z]{8}$' or p_which is null or p_which not in ('v1', 'v2', 'v3', 'v4', 'voice')
     or (p_message_id is not null and p_message_id <= 0) then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  update bot.voice_attempts a
     set messages = case when p_message_id is null then a.messages - p_which
                         else a.messages || pg_catalog.jsonb_build_object(p_which, p_message_id) end
   where a.aid = p_aid and a.user_id = v_l.user_id;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'gone');
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok');
end;
$fn$;

-- 4e. A ticket for one job of the Space (the voice's length p_seconds from Telegram, for transcribe and followup):
--     transcribe — a voice of the answer (phase asked | answering), check — «Проверить» (phase answering, some text),
--     followup — the voice to the examiner's question (phase followup). The limits are checked here first, so a refused
--     voice is never downloaded; bridge_voice_take decides again. status: ok (+ ticket, expires_at) | limit (+ units) |
--     ceiling | stop (+ audio) | busy | gone | invalid | unlinked | off.
create or replace function public.bot_voice_ticket(p_tg_user_id bigint, p_aid text, p_job text, p_seconds integer default 0)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_day date := (v_now at time zone 'utc')::date;
  v_l bot.links%rowtype;
  v_a bot.voice_attempts%rowtype;
  v_lim record;
  v_units jsonb;
  v_cost integer;
  v_ticket text;
begin
  perform meldy_private.require_service_role();
  if not bot.voice_on() then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_aid is null or p_aid !~ '^[0-9a-z]{8}$' or p_job is null or p_job not in ('transcribe', 'check', 'followup')
     or (p_job <> 'check' and (p_seconds is null or p_seconds < 1 or p_seconds > 3600)) then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  update bot.links l set last_seen_at = v_now where l.id = v_l.id;
  perform bot.voice_expire(v_l.user_id, (v_now at time zone v_l.tz)::date);
  select a.* into v_a from bot.voice_attempts a where a.aid = p_aid and a.user_id = v_l.user_id for update;
  if v_a.id is null
     or (p_job = 'transcribe' and v_a.phase not in ('asked', 'answering'))
     or (p_job = 'check' and (v_a.phase <> 'answering' or pg_catalog.jsonb_array_length(v_a.parts) = 0))
     or (p_job = 'followup' and v_a.phase <> 'followup') then
    return pg_catalog.jsonb_build_object('status', 'gone', 'phase', v_a.phase);
  end if;
  if v_a.busy_until > v_now then
    return pg_catalog.jsonb_build_object('status', 'busy');
  end if;
  select * into v_lim from bot.voice_limits();
  if p_job <> 'check' then
    v_cost := greatest(p_seconds, 10);
    if coalesce((select u.seconds from bot.voice_audio u where u.day = v_day and u.user_id = v_l.user_id), 0) + v_cost > v_lim.user_day_s then
      return pg_catalog.jsonb_build_object('status', 'ceiling', 'audio', bot.voice_audio_state(v_l.user_id, v_now));
    end if;
    if coalesce((select d.seconds from bot.voice_days d where d.day = v_day), 0) + v_cost > v_lim.stop_s then
      return pg_catalog.jsonb_build_object('status', 'stop', 'audio', bot.voice_audio_state(v_l.user_id, v_now));
    end if;
  end if;
  -- Recognising an answer that cannot be checked today wastes the shared audio: the units go first.
  if p_job = 'transcribe' or (p_job = 'check' and v_a.charge_id is null) then
    v_units := bot.voice_units(v_l.user_id);
    if (v_units ->> 'left')::integer < v_lim.price then
      return pg_catalog.jsonb_build_object('status', 'limit', 'units', v_units);
    end if;
  end if;
  v_ticket := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '') || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  insert into bot.voice_tickets (ticket_hash, attempt_id, user_id, question_id, job, seconds, created_at, expires_at)
  values (pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_ticket, 'UTF8')), 'hex'), v_a.id, v_l.user_id, v_a.question_id,
          p_job, case when p_job = 'check' then 0 else p_seconds end, v_now, v_now + interval '2 minutes');
  if p_job <> 'transcribe' then
    update bot.voice_attempts a set busy_until = v_now + interval '150 seconds', updated_at = v_now where a.id = v_a.id;
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'ticket', v_ticket, 'expires_at', v_now + interval '2 minutes');
end;
$fn$;

-- 4f. A recognised voice of the answer (V2): appended to the text (at most 4000 characters in all: the site's quick check
--     takes no more). status: ok (+ attempt) | too_long | busy | gone | invalid | unlinked | off.
create or replace function public.bot_voice_part(p_tg_user_id bigint, p_aid text, p_text text, p_seconds integer,
                                                p_voice_message_id bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_a bot.voice_attempts%rowtype;
  v_text text := pg_catalog.btrim(coalesce(p_text, ''));
  v_total integer;
begin
  perform meldy_private.require_service_role();
  if not bot.voice_on() then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_aid is null or p_aid !~ '^[0-9a-z]{8}$' or v_text = '' or p_seconds is null or p_seconds < 0 or p_seconds > 3600
     or (p_voice_message_id is not null and p_voice_message_id <= 0) then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  select a.* into v_a from bot.voice_attempts a where a.aid = p_aid and a.user_id = v_l.user_id for update;
  if v_a.id is null or v_a.phase not in ('asked', 'answering') then
    return pg_catalog.jsonb_build_object('status', 'gone', 'phase', v_a.phase);
  end if;
  -- A voice and a button press reach the bot through different queues: no part while a check is in flight.
  if v_a.busy_until > v_now then
    return pg_catalog.jsonb_build_object('status', 'busy');
  end if;
  select coalesce(pg_catalog.sum(pg_catalog.char_length(x.p ->> 'text')), 0) + pg_catalog.count(*) into v_total
    from pg_catalog.jsonb_array_elements(v_a.parts) as x(p);
  if v_total + pg_catalog.char_length(v_text) > 4000 then
    return pg_catalog.jsonb_build_object('status', 'too_long');
  end if;
  update bot.voice_attempts a
     set parts = a.parts || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('text', v_text, 'seconds', p_seconds)),
         seconds = least(a.seconds + p_seconds, 86400), phase = 'answering', updated_at = v_now,
         messages = case when p_voice_message_id is null then a.messages
                         else a.messages || pg_catalog.jsonb_build_object('voice', p_voice_message_id) end
   where a.id = v_a.id
  returning * into v_a;
  return pg_catalog.jsonb_build_object('status', 'ok', 'attempt', bot.voice_attempt_json(v_a, v_now));
end;
$fn$;

-- 4g. «Сначала»: the recognised text goes, the question waits for a voice again. status: ok (+ attempt, v2 = the message
--     to delete) | gone | busy | invalid | unlinked | off.
create or replace function public.bot_voice_restart(p_tg_user_id bigint, p_aid text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_a bot.voice_attempts%rowtype;
  v_v2 bigint;
begin
  perform meldy_private.require_service_role();
  if not bot.voice_on() then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_aid is null or p_aid !~ '^[0-9a-z]{8}$' then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  update bot.links l set last_seen_at = v_now where l.id = v_l.id;
  select a.* into v_a from bot.voice_attempts a where a.aid = p_aid and a.user_id = v_l.user_id for update;
  if v_a.id is null or v_a.phase <> 'answering' then
    return pg_catalog.jsonb_build_object('status', 'gone', 'phase', v_a.phase);
  end if;
  if v_a.busy_until > v_now then
    return pg_catalog.jsonb_build_object('status', 'busy');
  end if;
  v_v2 := (v_a.messages ->> 'v2')::bigint;
  update bot.voice_attempts a
     set parts = '[]'::jsonb, seconds = 0, phase = 'asked', messages = a.messages - 'v2', updated_at = v_now
   where a.id = v_a.id
  returning * into v_a;
  return pg_catalog.jsonb_build_object('status', 'ok', 'v2', v_v2, 'attempt', bot.voice_attempt_json(v_a, v_now));
end;
$fn$;

-- 4h. The Space checked the answer (ticket job check): p_result = {statuses, ask: {point_id} | null, protocol: {points,
--     errors, verdict}}. The examiner's question and what must sound come from the snapshot, never from the call.
--     → followup (V3) or ready (record now). status: ok (+ attempt) | gone | invalid | unlinked | off.
create or replace function public.bot_voice_checked(p_tg_user_id bigint, p_aid text, p_result jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_a bot.voice_attempts%rowtype;
  v_ask text;
  v_point jsonb;
begin
  perform meldy_private.require_service_role();
  if not bot.voice_on() then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_aid is null or p_aid !~ '^[0-9a-z]{8}$' or p_result is null or pg_catalog.jsonb_typeof(p_result) is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_result -> 'protocol') is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_result -> 'protocol' -> 'points') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_result -> 'statuses') is distinct from 'object'
     or pg_catalog.octet_length(p_result::text) > 30000 then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  select a.* into v_a from bot.voice_attempts a where a.aid = p_aid and a.user_id = v_l.user_id for update;
  if v_a.id is null or v_a.phase <> 'answering' then
    return pg_catalog.jsonb_build_object('status', 'gone', 'phase', v_a.phase);
  end if;
  v_ask := case when pg_catalog.jsonb_typeof(p_result -> 'ask') = 'object' then p_result -> 'ask' ->> 'point_id' end;
  if v_ask is not null then
    select x.p into v_point from pg_catalog.jsonb_array_elements(v_a.rubric -> 'points') as x(p) where x.p ->> 'id' = v_ask limit 1;
    if v_point is null or coalesce(v_point -> 'followup' ->> 'question', '') = '' then
      v_ask := null;
    end if;
  end if;
  update bot.voice_attempts a
     set checked = pg_catalog.jsonb_build_object('statuses', p_result -> 'statuses', 'protocol', p_result -> 'protocol'),
         followup = case when v_ask is null then null
                         else pg_catalog.jsonb_build_object('point_id', v_ask, 'question', v_point -> 'followup' ->> 'question',
                                                            'expected', coalesce(v_point -> 'followup' ->> 'expected', '')) end,
         phase = case when v_ask is null then 'ready' else 'followup' end,
         busy_until = null, updated_at = v_now
   where a.id = v_a.id
  returning * into v_a;
  return pg_catalog.jsonb_build_object('status', 'ok', 'attempt', bot.voice_attempt_json(v_a, v_now));
end;
$fn$;

-- 4i. The answer to the examiner's question: p_status covered | partial | missing | wrong (the Space's one-point check,
--     or «Не знаю» → missing without it), p_quote = the answer's start (≤ 160), p_judged 'check' | null (the «Не знаю»
--     button: a trustworthy verdict, as on the site). → ready. status: ok (+ attempt) | gone | invalid | unlinked | off.
create or replace function public.bot_voice_followup(p_tg_user_id bigint, p_aid text, p_status text, p_quote text default null,
                                                    p_judged text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_a bot.voice_attempts%rowtype;
begin
  perform meldy_private.require_service_role();
  if not bot.voice_on() then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_aid is null or p_aid !~ '^[0-9a-z]{8}$' or p_status is null or p_status not in ('covered', 'partial', 'missing', 'wrong')
     or (p_judged is not null and p_judged <> 'check') then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  update bot.links l set last_seen_at = v_now where l.id = v_l.id;
  select a.* into v_a from bot.voice_attempts a where a.aid = p_aid and a.user_id = v_l.user_id for update;
  if v_a.id is null or v_a.phase <> 'followup' or v_a.followup is null then
    return pg_catalog.jsonb_build_object('status', 'gone', 'phase', v_a.phase);
  end if;
  update bot.voice_attempts a
     set followup = a.followup || pg_catalog.jsonb_build_object('status', p_status,
                                    'student_quote', pg_catalog.left(pg_catalog.btrim(coalesce(p_quote, '')), 160), 'judged_by', p_judged),
         phase = 'ready', busy_until = null, updated_at = v_now
   where a.id = v_a.id
  returning * into v_a;
  return pg_catalog.jsonb_build_object('status', 'ok', 'attempt', bot.voice_attempt_json(v_a, v_now));
end;
$fn$;

-- 4j. A call to the Space came back with nothing (timeout, network, 5xx, a refusal after the take): the job is no longer
--     in flight, and units a check took without a stored result go back (refund_ai_units_for, once). status: ok
--     (+ refunded, attempt) | gone | invalid | unlinked | off.
create or replace function public.bot_voice_release(p_tg_user_id bigint, p_aid text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_a bot.voice_attempts%rowtype;
  v_back integer := 0;
begin
  perform meldy_private.require_service_role();
  if not bot.voice_on() then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_aid is null or p_aid !~ '^[0-9a-z]{8}$' then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  select a.* into v_a from bot.voice_attempts a where a.aid = p_aid and a.user_id = v_l.user_id for update;
  if v_a.id is null then
    return pg_catalog.jsonb_build_object('status', 'gone');
  end if;
  if v_a.charge_id is not null and v_a.checked is null and v_a.session_id is null and v_a.charged > 0 then
    v_back := coalesce((meldy_private.refund_ai_units_for(v_l.user_id, v_a.charged, 'answer', v_a.charge_id) ->> 'refunded')::integer, 0);
    update bot.voice_tickets t set refunded_at = v_now where t.charge_id = v_a.charge_id and t.refunded_at is null;
    update bot.voice_attempts a set charge_id = null, charged = 0 where a.id = v_a.id;
  end if;
  update bot.voice_attempts a set busy_until = null, updated_at = v_now where a.id = v_a.id returning * into v_a;
  return pg_catalog.jsonb_build_object('status', 'ok', 'refunded', v_back, 'attempt', bot.voice_attempt_json(v_a, v_now));
end;
$fn$;

-- 4k. The answer is saved (V4): p_attempt = p_attempt of record_oral_attempt as the function builds it from the protocol,
--     the follow-up and the site's grade formula (oralGrade.ts): score, grade, points, followup, errors, verdict,
--     duration_seconds, confidence, material_id. The keys of the attempt itself are the server's: attempt_id
--     (tgv-<attempt>), exam_question_id, rubric_id, local_date (the link's day), input 'speech', make_card true.
--     p_how: 'checked' (phase ready) | 'dont_know' («Не знаю» under V1, phase asked | answering: the site's «не знаю»
--     answer, no units). With the student's consent (oral_answer_consent, version 1 of the site's text) the recognised
--     text goes to oral_answer_texts as the site's does. A second call answers with the first result.
--     status: ok (+ session_id, duplicate, charged, units, attempt) | gone | invalid | unlinked | off.
create or replace function public.bot_voice_record(p_tg_user_id bigint, p_aid text, p_attempt jsonb, p_how text default 'checked')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_a bot.voice_attempts%rowtype;
  v_attempt_id text;
  v_result jsonb;
  v_session uuid;
  v_text text;
begin
  perform meldy_private.require_service_role();
  if not bot.voice_on() then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_aid is null or p_aid !~ '^[0-9a-z]{8}$' or p_how is null or p_how not in ('checked', 'dont_know')
     or p_attempt is null or pg_catalog.jsonb_typeof(p_attempt) is distinct from 'object' or pg_catalog.octet_length(p_attempt::text) > 30000 then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  update bot.links l set last_seen_at = v_now where l.id = v_l.id;
  select a.* into v_a from bot.voice_attempts a where a.aid = p_aid and a.user_id = v_l.user_id for update;
  if v_a.id is null then
    return pg_catalog.jsonb_build_object('status', 'gone');
  end if;
  if v_a.phase = 'done' and v_a.session_id is not null then
    return pg_catalog.jsonb_build_object('status', 'ok', 'session_id', v_a.session_id, 'duplicate', true, 'charged', v_a.charged,
      'units', bot.voice_units(v_l.user_id), 'attempt', bot.voice_attempt_json(v_a, v_now));
  end if;
  if (p_how = 'checked' and v_a.phase <> 'ready') or (p_how = 'dont_know' and v_a.phase not in ('asked', 'answering')) then
    return pg_catalog.jsonb_build_object('status', 'gone', 'phase', v_a.phase);
  end if;
  v_attempt_id := 'tgv-' || pg_catalog.replace(v_a.id::text, '-', '');
  begin
    v_result := meldy_private.record_oral_attempt_for(v_l.user_id, p_attempt || pg_catalog.jsonb_build_object(
      'attempt_id', v_attempt_id, 'exam_question_id', v_a.question_id, 'rubric_id', v_a.rubric ->> 'id',
      'local_date', v_a.local_day, 'input', 'speech', 'make_card', true));
  exception
    when no_data_found then
      return pg_catalog.jsonb_build_object('status', 'gone');
    when invalid_parameter_value then
      return pg_catalog.jsonb_build_object('status', 'invalid');
  end;
  v_session := (v_result ->> 'session_id')::uuid;
  v_text := (select pg_catalog.string_agg(x.p ->> 'text', E'\n' order by x.o)
               from pg_catalog.jsonb_array_elements(v_a.parts) with ordinality as x(p, o));
  if p_how = 'checked' and coalesce(pg_catalog.btrim(v_text), '') <> '' then
    -- The site keeps the whole text only with the student's consent to the current text of the request (version 1,
    -- frontend/src/lib/oral/answerTexts.ts); its failure never undoes the saved answer.
    begin
      insert into public.oral_answer_texts (user_id, exam_id, question_hash, attempt_id, session_id, input, text, consent_version)
      select v_l.user_id, e.id, v_a.question ->> 'hash', v_attempt_id, v_session, 'speech', pg_catalog.left(v_text, 20000), 1
        from public.oral_answer_consent c
        left join public.exams e on e.id = v_a.exam_id and e.user_id = v_l.user_id
       where c.user_id = v_l.user_id and c.granted and c.version = 1
      on conflict (user_id, attempt_id) do nothing;
    exception when others then
      null;
    end;
  end if;
  update bot.voice_attempts a
     set phase = 'done', session_id = v_session, busy_until = null, updated_at = v_now,
         parts = coalesce((select pg_catalog.jsonb_agg(x.p - 'text' order by x.o)
                             from pg_catalog.jsonb_array_elements(a.parts) with ordinality as x(p, o)), '[]'::jsonb)
   where a.id = v_a.id
  returning * into v_a;
  return pg_catalog.jsonb_build_object('status', 'ok', 'session_id', v_session, 'duplicate', coalesce((v_result ->> 'duplicate')::boolean, false),
    'charged', v_a.charged, 'units', bot.voice_units(v_l.user_id), 'attempt', bot.voice_attempt_json(v_a, v_now));
end;
$fn$;

-- 4l. «Проверить себя без Meldy» (phase asked | answering): the points are shown — a sheet_peek of every point, as
--     «Показать пункты» on the site (api/learning.ts recordSheetPeek: item_key peek:<rubric>:<point>, the question hash
--     and the point's words in the payload); the recognised text goes. status: ok (+ attempt) | gone | busy | invalid |
--     unlinked | off.
create or replace function public.bot_voice_self(p_tg_user_id bigint, p_aid text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_a bot.voice_attempts%rowtype;
begin
  perform meldy_private.require_service_role();
  if not bot.voice_on() then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_aid is null or p_aid !~ '^[0-9a-z]{8}$' then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  update bot.links l set last_seen_at = v_now where l.id = v_l.id;
  select a.* into v_a from bot.voice_attempts a where a.aid = p_aid and a.user_id = v_l.user_id for update;
  if v_a.id is null or v_a.phase not in ('asked', 'answering') then
    return pg_catalog.jsonb_build_object('status', 'gone', 'phase', v_a.phase);
  end if;
  if v_a.busy_until > v_now then
    return pg_catalog.jsonb_build_object('status', 'busy');
  end if;
  insert into public.learning_events (user_id, local_date, kind, item_key, client_event_id, payload)
  select v_l.user_id, v_a.local_day, 'sheet_peek', 'peek:' || pg_catalog.lower(v_a.rubric ->> 'id') || ':' || (x.p ->> 'id'),
         'tgpeek-' || v_a.aid || '-' || (x.p ->> 'id'),
         pg_catalog.jsonb_build_object('v', 1, 'question_hash', v_a.question ->> 'hash', 'rubric_id', pg_catalog.lower(v_a.rubric ->> 'id'),
                                       'point_id', x.p ->> 'id', 'title', pg_catalog.left(coalesce(x.p ->> 'title', ''), 120),
                                       'exam_id', v_a.exam_id)
    from pg_catalog.jsonb_array_elements(v_a.rubric -> 'points') as x(p)
   where coalesce(x.p ->> 'id', '') ~ '^p[1-6]$'
  on conflict (user_id, client_event_id) do nothing;
  update bot.voice_attempts a
     set phase = 'self', parts = '[]'::jsonb, seconds = 0, busy_until = null, updated_at = v_now
   where a.id = v_a.id
  returning * into v_a;
  return pg_catalog.jsonb_build_object('status', 'ok', 'attempt', bot.voice_attempt_json(v_a, v_now));
end;
$fn$;

-- 4m. The self-check's mark (phase self): p_rating know | unsure | dont_know → the site's self_rating (confidence 3 | 2 |
--     1, item_key q:<hash>, the exam and the question in the payload, the rubric's first lecture when it is the user's).
--     status: ok (+ attempt) | gone | invalid | unlinked | off.
create or replace function public.bot_voice_rate(p_tg_user_id bigint, p_aid text, p_rating text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_a bot.voice_attempts%rowtype;
  v_material text;
  v_material_id uuid;
begin
  perform meldy_private.require_service_role();
  if not bot.voice_on() then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  v_l := bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_aid is null or p_aid !~ '^[0-9a-z]{8}$' or p_rating is null or p_rating not in ('know', 'unsure', 'dont_know') then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  update bot.links l set last_seen_at = v_now where l.id = v_l.id;
  select a.* into v_a from bot.voice_attempts a where a.aid = p_aid and a.user_id = v_l.user_id for update;
  if v_a.id is null or v_a.phase <> 'self' then
    return pg_catalog.jsonb_build_object('status', 'gone', 'phase', v_a.phase);
  end if;
  -- The rubric's first lecture, only when it is the user's own (the journal links only own materials; a rating does not
  -- need the link at all, as on the site). The cast waits for the format check in its own statement.
  v_material := v_a.rubric -> 'materials' -> 0 ->> 'material_id';
  if coalesce(v_material, '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    v_material_id := v_material::uuid;
    select m.id into v_material_id from public.materials m where m.id = v_material_id and m.user_id = v_l.user_id;
  end if;
  insert into public.learning_events (user_id, local_date, material_id, kind, item_key, confidence, client_event_id, payload)
  values (v_l.user_id, v_a.local_day, v_material_id,
          'self_rating', 'q:' || (v_a.question ->> 'hash'),
          case p_rating when 'know' then 3 when 'unsure' then 2 else 1 end,
          'tgrate-' || v_a.aid,
          pg_catalog.jsonb_build_object('v', 1, 'exam_id', v_a.exam_id, 'exam_question_id', v_a.question_id))
  on conflict (user_id, client_event_id) do nothing;
  update bot.voice_attempts a set phase = 'rated', updated_at = v_now where a.id = v_a.id returning * into v_a;
  return pg_catalog.jsonb_build_object('status', 'ok', 'attempt', bot.voice_attempt_json(v_a, v_now));
end;
$fn$;

-- 5. The Space's two entry points (backend/bot_bridge.py). No service role: the Space has none and must not get one; it
--    calls them with the project's public key (role anon). The ticket is the whole authority: a malformed, unknown, used
--    or expired ticket gets only a status (never whose it is). SECURITY DEFINER, search_path ''.
-- 5a. The one use of a ticket. Burns it, whatever follows. Audio jobs (transcribe, followup): the student's ceiling and
--     the shared stop, then the voice's seconds (at least 10) are counted. check: the units are charged here (kind
--     'answer'; once per attempt — a check repeated after a lost answer takes nothing again). Returns the job's context:
--       transcribe: {status: ok, job, hint (the question, ≤ 300), min_words (8 for the answer's first voice, else 1)}
--       check:      {status: ok, job, question (≤ 1000), transcript (≤ 4000), points: [{id, title, essential,
--                    source_quote, followup: {question, expected}}], units: {charged, left}}
--       followup:   {status: ok, job, question, hint (the examiner's question), point_id, followup: {question, expected},
--                    points: [{id, title, essential}]}
--     or {status: invalid | used | expired | off | gone | ceiling | stop | limit}.
create or replace function public.bridge_voice_take(p_ticket text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_day date := (v_now at time zone 'utc')::date;
  v_hash text;
  v_t bot.voice_tickets%rowtype;
  v_a bot.voice_attempts%rowtype;
  v_lim record;
  v_cost integer;
  v_global integer;
  v_mine integer;
  v_charge jsonb;
  v_outcome text := 'ok';
  v_units jsonb;
begin
  if p_ticket is null or p_ticket !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_ticket, 'UTF8')), 'hex');
  select t.* into v_t from bot.voice_tickets t where t.ticket_hash = v_hash for update;
  if v_t.ticket_hash is null then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  if v_t.taken_at is not null then
    return pg_catalog.jsonb_build_object('status', 'used');
  end if;
  select a.* into v_a from bot.voice_attempts a where a.id = v_t.attempt_id for update;
  select * into v_lim from bot.voice_limits();
  if v_t.expires_at <= v_now then
    v_outcome := 'expired';
  elsif not bot.voice_on() then
    v_outcome := 'off';
  elsif v_a.id is null or v_a.user_id <> v_t.user_id or v_a.question_id <> v_t.question_id
        or not exists (select 1 from bot.links l where l.user_id = v_t.user_id and l.unlinked_at is null)
        or (v_t.job = 'transcribe' and v_a.phase not in ('asked', 'answering'))
        or (v_t.job = 'check' and (v_a.phase <> 'answering' or pg_catalog.jsonb_array_length(v_a.parts) = 0))
        or (v_t.job = 'followup' and (v_a.phase <> 'followup' or v_a.followup is null)) then
    v_outcome := 'gone';
  elsif v_t.job in ('transcribe', 'followup') then
    v_cost := greatest(v_t.seconds, 10);
    insert into bot.voice_days (day) values (v_day) on conflict (day) do nothing;
    insert into bot.voice_audio (day, user_id) values (v_day, v_t.user_id) on conflict (day, user_id) do nothing;
    select d.seconds into v_global from bot.voice_days d where d.day = v_day for update;
    select u.seconds into v_mine from bot.voice_audio u where u.day = v_day and u.user_id = v_t.user_id for update;
    if v_mine + v_cost > v_lim.user_day_s then
      v_outcome := 'ceiling';
      update bot.voice_audio u set refused = u.refused + 1 where u.day = v_day and u.user_id = v_t.user_id;
    elsif v_global + v_cost > v_lim.stop_s then
      v_outcome := 'stop';
      update bot.voice_days d set refused = d.refused + 1 where d.day = v_day;
    else
      update bot.voice_days d set seconds = d.seconds + v_cost, takes = d.takes + 1 where d.day = v_day;
      update bot.voice_audio u set seconds = u.seconds + v_cost, takes = u.takes + 1 where u.day = v_day and u.user_id = v_t.user_id;
    end if;
  elsif v_t.job = 'check' and v_a.charge_id is null then
    v_charge := meldy_private.consume_ai_units_for(v_t.user_id, v_lim.price, 'answer');
    if coalesce((v_charge ->> 'allowed')::boolean, false) and v_charge ->> 'charge_id' is not null then
      update bot.voice_attempts a set charge_id = (v_charge ->> 'charge_id')::uuid, charged = v_lim.price where a.id = v_a.id;
      update bot.voice_tickets t set charge_id = (v_charge ->> 'charge_id')::uuid, charged = v_lim.price where t.ticket_hash = v_hash;
    else
      v_outcome := 'limit';
    end if;
  end if;
  update bot.voice_tickets t set taken_at = v_now, outcome = v_outcome where t.ticket_hash = v_hash;
  if v_outcome <> 'ok' then
    return pg_catalog.jsonb_build_object('status', v_outcome);
  end if;
  if v_t.job = 'transcribe' then
    return pg_catalog.jsonb_build_object('status', 'ok', 'job', 'transcribe',
      'hint', pg_catalog.left(coalesce(v_a.question ->> 'text', ''), 300),
      'min_words', case when pg_catalog.jsonb_array_length(v_a.parts) = 0 then 8 else 1 end);
  end if;
  if v_t.job = 'check' then
    v_units := bot.voice_units(v_t.user_id);
    return pg_catalog.jsonb_build_object('status', 'ok', 'job', 'check',
      'question', pg_catalog.left(coalesce(v_a.question ->> 'text', ''), 1000),
      'transcript', pg_catalog.left(coalesce((select pg_catalog.string_agg(x.p ->> 'text', E'\n' order by x.o)
                                                from pg_catalog.jsonb_array_elements(v_a.parts) with ordinality as x(p, o)), ''), 4000),
      'points', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.p ->> 'id', 'title', x.p ->> 'title',
                          'essential', x.p -> 'essential', 'source_quote', x.p -> 'source_quote', 'followup', x.p -> 'followup') order by x.o)
                   from pg_catalog.jsonb_array_elements(v_a.rubric -> 'points') with ordinality as x(p, o)),
      'units', pg_catalog.jsonb_build_object('charged', (select a.charged from bot.voice_attempts a where a.id = v_a.id),
                                             'left', v_units -> 'left'));
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'job', 'followup',
    'question', pg_catalog.left(coalesce(v_a.question ->> 'text', ''), 1000),
    'hint', pg_catalog.left(coalesce(v_a.followup ->> 'question', ''), 300),
    'point_id', v_a.followup ->> 'point_id',
    'followup', pg_catalog.jsonb_build_object('question', v_a.followup ->> 'question', 'expected', coalesce(v_a.followup ->> 'expected', '')),
    'points', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', x.p ->> 'id', 'title', x.p ->> 'title',
                        'essential', x.p -> 'essential') order by x.o)
                 from pg_catalog.jsonb_array_elements(v_a.rubric -> 'points') with ordinality as x(p, o)));
end;
$fn$;

-- 5b. The model failed after a check's take (or the answer was empty or «не знаю», which the site never charges): the
--     units of THIS ticket go back, once, within 10 minutes of its take, and only while the attempt holds that charge
--     with no stored result. status: ok (+ refunded) | no | invalid.
create or replace function public.bridge_voice_refund(p_ticket text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_hash text;
  v_t bot.voice_tickets%rowtype;
  v_a bot.voice_attempts%rowtype;
  v_back integer;
begin
  if p_ticket is null or p_ticket !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_ticket, 'UTF8')), 'hex');
  select t.* into v_t from bot.voice_tickets t where t.ticket_hash = v_hash for update;
  if v_t.ticket_hash is null then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  if v_t.job <> 'check' or v_t.taken_at is null or v_t.taken_at < v_now - interval '10 minutes' or v_t.charge_id is null
     or v_t.refunded_at is not null then
    return pg_catalog.jsonb_build_object('status', 'no');
  end if;
  select a.* into v_a from bot.voice_attempts a where a.id = v_t.attempt_id for update;
  if v_a.id is null or v_a.charge_id is distinct from v_t.charge_id or v_a.checked is not null or v_a.session_id is not null then
    return pg_catalog.jsonb_build_object('status', 'no');
  end if;
  v_back := coalesce((meldy_private.refund_ai_units_for(v_t.user_id, v_t.charged, 'answer', v_t.charge_id) ->> 'refunded')::integer, 0);
  update bot.voice_tickets t set refunded_at = v_now where t.ticket_hash = v_hash;
  update bot.voice_attempts a set charge_id = null, charged = 0, busy_until = null, updated_at = v_now where a.id = v_a.id;
  return pg_catalog.jsonb_build_object('status', 'ok', 'refunded', v_back);
end;
$fn$;

-- 6. Grants: what Supabase's default privileges (and PostgreSQL's PUBLIC EXECUTE) give NEW objects, taken back. Safety
--    does not depend on it: every bot_voice_* checks the service role first, the bridge needs a ticket, schema bot and
--    meldy_private have no USAGE for clients. Re-runnable; names only this file's objects.
revoke all on table bot.voice_attempts, bot.voice_tickets, bot.voice_audio, bot.voice_days from public, anon, authenticated;
revoke all on function bot.voice_on(), bot.voice_limits(), bot.voice_aid(), bot.voice_units(uuid),
  bot.voice_audio_state(uuid, timestamptz), bot.voice_attempt_json(bot.voice_attempts, timestamptz),
  bot.voice_expire(uuid, date), bot.voice_cleanup(timestamptz),
  bot.voice_open(bot.links, uuid, uuid, uuid, text, uuid[], integer, timestamptz)
  from public, anon, authenticated;
revoke all on function meldy_private.ai_quota_status_for(uuid), meldy_private.consume_ai_units_for(uuid, integer, text),
  meldy_private.refund_ai_units_for(uuid, integer, text, uuid), meldy_private.record_oral_attempt_for(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.bot_voice_state(bigint), public.bot_voice_start(bigint, uuid, uuid, uuid, text, uuid[], integer),
  public.bot_voice_next(bigint, text), public.bot_voice_sent(bigint, text, text, bigint),
  public.bot_voice_ticket(bigint, text, text, integer), public.bot_voice_part(bigint, text, text, integer, bigint),
  public.bot_voice_restart(bigint, text), public.bot_voice_checked(bigint, text, jsonb),
  public.bot_voice_followup(bigint, text, text, text, text), public.bot_voice_release(bigint, text),
  public.bot_voice_record(bigint, text, jsonb, text), public.bot_voice_self(bigint, text), public.bot_voice_rate(bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.bot_voice_state(bigint), public.bot_voice_start(bigint, uuid, uuid, uuid, text, uuid[], integer),
  public.bot_voice_next(bigint, text), public.bot_voice_sent(bigint, text, text, bigint),
  public.bot_voice_ticket(bigint, text, text, integer), public.bot_voice_part(bigint, text, text, integer, bigint),
  public.bot_voice_restart(bigint, text), public.bot_voice_checked(bigint, text, jsonb),
  public.bot_voice_followup(bigint, text, text, text, text), public.bot_voice_release(bigint, text),
  public.bot_voice_record(bigint, text, jsonb, text), public.bot_voice_self(bigint, text), public.bot_voice_rate(bigint, text, text)
  to service_role;
revoke all on function public.bridge_voice_take(text), public.bridge_voice_refund(text) from public, authenticated;
grant execute on function public.bridge_voice_take(text), public.bridge_voice_refund(text) to anon, service_role;
