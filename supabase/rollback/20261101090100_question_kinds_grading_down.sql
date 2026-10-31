-- Rollback of 20261101090100_question_kinds_grading.sql (release 48, part 2) back to 20261101090000_question_kinds.sql:
-- the two replaced bodies exactly as their last earlier migrations left them, then grade_item dropped. Roll back
-- 20261101090200 (and anything after it) first. Re-runnable. Nothing is lost: answers already recorded stay in the log.

-- meldy_private.record_test_answers_for: as 20261018120000_exam_move_bot_exams.sql left it.
create or replace function meldy_private.record_test_answers_for(p_user uuid, p_answers jsonb,
                                                                 p_source text default 'web', p_max integer default 50,
                                                                 p_mode text default null, p_session uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_cls constant text[] := array['relearn', 'confirm', 'new_floor', 'confirm_ai', 'start_ai', 'check', 'final',
                                 'new_fill', 'free'];
  v_now timestamptz := pg_catalog.now();
  v_out jsonb[];
  v_a jsonb;
  v_ord integer;
  v_id text;
  v_iid uuid;
  v_item public.test_items%rowtype;
  v_prev_item uuid;
  v_g record;
  v_r record;
  v_s public.test_item_states%rowtype;
  v_exam date;
  v_day date;
  v_mode text;
  v_retry boolean;
  v_misclick boolean;
  v_ms integer;
  v_cls text;
  v_session uuid;
  v_log bigint;
begin
  if p_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_source is null or p_source not in ('web', 'bot', 'bot_group')
     or (p_mode is not null and p_mode not in ('learn', 'mock')) then
    raise exception 'invalid source' using errcode = '22023';
  end if;
  if p_answers is null or pg_catalog.jsonb_typeof(p_answers) is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_answers) not between 1 and coalesce(p_max, 50)
     or pg_catalog.octet_length(p_answers::text) > 524288 then
    raise exception 'invalid answers' using errcode = '22023';
  end if;
  v_out := pg_catalog.array_fill(null::jsonb, array[pg_catalog.jsonb_array_length(p_answers)]);

  for v_a, v_ord in
    select a.value, a.ord::integer
      from pg_catalog.jsonb_array_elements(p_answers) with ordinality as a(value, ord)
     order by (case when pg_catalog.jsonb_typeof(a.value) = 'object' then pg_catalog.lower(a.value ->> 'item_id') end), a.ord
  loop
    v_id := case when pg_catalog.jsonb_typeof(v_a) = 'object' then v_a ->> 'client_event_id' end;
    if v_id is null or v_id !~ '^[A-Za-z0-9_:-]{8,120}$' or coalesce(v_a ->> 'item_id', '') !~* c_uuid then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'status', 'invalid');
      continue;
    end if;
    v_iid := (v_a ->> 'item_id')::uuid;

    select t.item_id into v_prev_item from public.test_answers t where t.user_id = p_user and t.client_event_id = v_id;
    if found then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid,
        'status', case when v_prev_item is distinct from v_iid and v_prev_item is not null then 'conflict' else 'duplicate' end);
      continue;
    end if;

    select i.* into v_item from public.test_items i where i.id = v_iid;
    if not found or meldy_private.role_in(p_user, v_item.container_id) is null then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'gone');
      continue;
    end if;
    if not v_item.keyed then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'no_key');
      continue;
    end if;
    if pg_catalog.jsonb_typeof(v_a -> 'rev') = 'number' and (v_a ->> 'rev') is distinct from v_item.rev::text then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'stale',
                                                    'rev', v_item.rev);
      continue;
    end if;
    select * into v_g from meldy_private.grade_answer(v_item.kind, pg_catalog.jsonb_array_length(v_item.options),
                                                      v_item.correct, v_item.answers, v_a);
    if not v_g.o_valid then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'invalid');
      continue;
    end if;

    v_day := meldy_private.clamp_day(v_a ->> 'local_date');
    v_mode := coalesce(p_mode, case when v_a ->> 'mode' = 'mock' then 'mock' else 'learn' end);
    v_retry := v_mode = 'learn' and coalesce(v_a ->> 'retry', '') = 'true';
    -- «Нажали не туда?» under a wrong option or a «Не знаю» pressed by mistake (never under a right answer, never in a mock)
    v_misclick := v_mode = 'learn' and coalesce(v_a ->> 'misclick', '') = 'true' and v_g.o_result <> 'right';
    v_ms := case when coalesce(v_a ->> 'ms', '') ~ '^\d{1,7}$' then least((v_a ->> 'ms')::integer, 600000) end;
    v_cls := case when (v_a ->> 'cls') = any (c_cls) then v_a ->> 'cls' end;
    v_session := coalesce(p_session, case when coalesce(v_a ->> 'session_id', '') ~* c_uuid
                                          then (v_a ->> 'session_id')::uuid end);
    -- The exam-eve rule takes this user's own date of the exam first (container_plans.own_exam_date).
    select coalesce(p.own_exam_date, s.exam_date, c.exam_date) into v_exam
      from public.container_subjects s join public.containers c on c.id = s.container_id
      left join public.container_plans p on p.user_id = p_user and p.container_id = s.container_id
     where s.id = v_item.subject_id;

    -- The state row exists before it is locked: a concurrent first answer waits here instead of being lost.
    insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev)
    values (p_user, v_iid, v_item.container_id, v_item.subject_id, v_item.rev)
    on conflict (user_id, item_id) do nothing;
    select s.* into v_s from public.test_item_states s where s.user_id = p_user and s.item_id = v_iid for update;
    v_s.container_id := v_item.container_id;
    v_s.subject_id := v_item.subject_id;
    select * into v_r from meldy_private.rule_step(v_s, v_item.rev, v_now, v_day, v_g.o_result, v_retry, v_misclick, v_exam);
    v_s := v_r.o_state;

    insert into public.test_answers (user_id, client_event_id, local_date, container_id, subject_id, item_id, item_rev,
                                     kind, mode, source, chosen, answer_text, shown_order, correct, misclick, retry, step,
                                     two_days_before, due_before, checks_before, cls, ms, session_id)
    values (p_user, v_id, v_day, v_item.container_id, v_item.subject_id, v_iid, v_item.rev, v_item.kind, v_mode,
            p_source, v_g.o_chosen, v_g.o_text, v_g.o_order, v_g.o_correct, v_misclick, v_retry, v_r.o_step,
            v_r.o_two_days_before, v_r.o_due_before, v_r.o_checks_before, v_cls, v_ms, v_session)
    on conflict (user_id, client_event_id) do nothing
    returning id into v_log;
    if v_log is null then
      v_out[v_ord] := pg_catalog.jsonb_build_object('client_event_id', v_id, 'item_id', v_iid, 'status', 'duplicate');
      continue;
    end if;

    if v_r.o_step <> 'late' then
      update public.test_item_states s
         set container_id = v_s.container_id, subject_id = v_s.subject_id, item_rev = v_s.item_rev, seen = v_s.seen,
             right_count = v_s.right_count, wrong_count = v_s.wrong_count, first_seen_at = v_s.first_seen_at,
             first_seen_day = v_s.first_seen_day, last_answer_at = v_s.last_answer_at,
             last_answer_day = v_s.last_answer_day, last_result = v_s.last_result, streak_at = v_s.streak_at,
             streak_day = v_s.streak_day, two_days_at = v_s.two_days_at, two_days_day = v_s.two_days_day,
             named_at = v_s.named_at, checks = v_s.checks, peek_day = v_s.peek_day, was_two_days = v_s.was_two_days,
             clean_ok_at = v_s.clean_ok_at, updated_at = v_s.updated_at
       where s.user_id = p_user and s.item_id = v_iid;
    end if;

    v_out[v_ord] := pg_catalog.jsonb_build_object(
        'client_event_id', v_id, 'item_id', v_iid, 'status', case when v_r.o_step = 'late' then 'late' else 'saved' end,
        'correct', v_g.o_correct, 'step', v_r.o_step, 'rev', v_item.rev, 'state', meldy_private.state_json(v_s))
      || case when v_item.kind = 'short'
              then pg_catalog.jsonb_build_object('answers', pg_catalog.to_jsonb(v_item.answers))
              else pg_catalog.jsonb_build_object('key', (select pg_catalog.to_jsonb(coalesce(pg_catalog.array_agg(k order by k),
                                                                                         '{}'::smallint[]))
                                                            from pg_catalog.unnest(v_item.correct) k)) end;
  end loop;
  return pg_catalog.jsonb_build_object('v', 1, 'server_day', (v_now at time zone 'utc')::date,
                                       'results', pg_catalog.to_jsonb(v_out));
end;
$fn$;

-- public.container_mock_finish: as 20261009093500_containers.sql left it.
create or replace function public.container_mock_finish(p_run jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_container uuid;
  v_run public.test_mock_runs%rowtype;
  v_id uuid := pg_catalog.gen_random_uuid();
  v_day date;
  v_answers jsonb;
  v_res jsonb;
  v_items integer;
  v_correct integer;
  v_unanswered integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_run is null or pg_catalog.jsonb_typeof(p_run) <> 'object'
     or coalesce(p_run ->> 'client_run_id', '') !~ '^[A-Za-z0-9_:-]{8,120}$'
     or coalesce(p_run ->> 'container_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or pg_catalog.jsonb_typeof(p_run -> 'answers') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_run -> 'answers') not between 1 and 200 then
    raise exception 'invalid run' using errcode = '22023';
  end if;
  v_container := (p_run ->> 'container_id')::uuid;
  if meldy_private.role_in(v_user, v_container) is null then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  select r.* into v_run from public.test_mock_runs r where r.user_id = v_user and r.client_run_id = p_run ->> 'client_run_id';
  if not found and exists (
       select 1 from public.test_items i
        where i.id = any (array(select (a ->> 'item_id')::uuid from pg_catalog.jsonb_array_elements(p_run -> 'answers') a
                                 where pg_catalog.jsonb_typeof(a) = 'object'
                                   and coalesce(a ->> 'item_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
          and i.container_id <> v_container) then
    raise exception 'an answer of another container in the run' using errcode = '22023';
  end if;
  if found then
    return pg_catalog.jsonb_build_object('run_id', v_run.id, 'items', v_run.items, 'correct', v_run.correct,
                                         'unanswered', v_run.unanswered, 'duplicate', true);
  end if;
  v_day := meldy_private.clamp_day(p_run ->> 'local_date');
  select pg_catalog.jsonb_agg(case when pg_catalog.jsonb_typeof(a.value) = 'object'
                                   then a.value || pg_catalog.jsonb_build_object('local_date', p_run ->> 'local_date')
                                   else a.value end
                              order by a.ord)
    into v_answers
    from pg_catalog.jsonb_array_elements(p_run -> 'answers') with ordinality as a(value, ord);
  v_res := meldy_private.record_test_answers_for(v_user, v_answers, 'web', 200, 'mock', v_id);
  select pg_catalog.count(*) filter (where r ->> 'status' in ('saved', 'late', 'duplicate')),
         pg_catalog.count(*) filter (where r ->> 'status' in ('saved', 'late') and (r ->> 'correct')::boolean)
    into v_items, v_correct
    from pg_catalog.jsonb_array_elements(v_res -> 'results') r;
  select pg_catalog.count(*) into v_unanswered
    from pg_catalog.jsonb_array_elements(p_run -> 'answers') a
   where pg_catalog.jsonb_typeof(a) = 'object'
     and coalesce(pg_catalog.jsonb_typeof(a -> 'chosen'), 'null') = 'null'
     and coalesce(pg_catalog.jsonb_typeof(a -> 'text'), 'null') = 'null'
     and (a ? 'chosen' or a ? 'text');
  if v_items = 0 then
    raise exception 'no answer of the run could be recorded' using errcode = '22023';
  end if;
  insert into public.test_mock_runs (id, user_id, container_id, client_run_id, local_date, subject_ids, items, correct,
                                     unanswered, time_limit_s, duration_s)
  values (v_id, v_user, v_container, p_run ->> 'client_run_id', v_day,
          coalesce(array(select x::uuid from pg_catalog.jsonb_array_elements_text(
                     case when pg_catalog.jsonb_typeof(p_run -> 'subject_ids') = 'array' then p_run -> 'subject_ids'
                          else '[]'::jsonb end) x
                   where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' limit 20), '{}'::uuid[]),
          v_items, v_correct, least(v_unanswered, v_items),
          case when coalesce(p_run ->> 'time_limit_s', '') ~ '^\d{1,5}$' then (p_run ->> 'time_limit_s')::integer end,
          case when coalesce(p_run ->> 'duration_s', '') ~ '^\d{1,5}$' then (p_run ->> 'duration_s')::integer end);
  return pg_catalog.jsonb_build_object('run_id', v_id, 'items', v_items, 'correct', v_correct,
                                       'unanswered', least(v_unanswered, v_items), 'duplicate', false,
                                       'results', v_res -> 'results');
end;
$fn$;

drop function if exists meldy_private.grade_item(public.test_items, jsonb);
