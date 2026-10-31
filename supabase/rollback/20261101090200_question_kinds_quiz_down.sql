-- Rollback of 20261101090200_question_kinds_quiz.sql (release 48, part 3) back to 20261101090100_question_kinds_grading.sql:
-- the essay calls and marks dropped, quiz_graded with its older columns again, every replaced body exactly as its last
-- earlier migration left it, the new helpers dropped, quiz_answers.text at most 200 characters again. Roll back
-- 20261101090300 (and anything after it) first. Re-runnable.
-- What is lost: essay marks, and saved answers longer than 200 characters (essays and long cloze answers).

drop function if exists public.quiz_essay_mark(uuid, uuid, text, text, text);
drop function if exists public.quiz_essay_task(uuid, uuid);

-- quiz_graded with its older columns (dropped first: another return type).
drop function if exists meldy_private.quiz_graded(uuid, uuid);
-- meldy_private.quiz_graded (20261016120000_quizzes.sql)
create or replace function meldy_private.quiz_graded(p_quiz uuid, p_attempt uuid)
returns table (attempt_id uuid, item_id uuid, ord integer, answered boolean, correct boolean, chosen smallint[],
               typed text, answered_at timestamptz)
language plpgsql
stable
set search_path = ''
as $fn$
begin
  return query
  select t.id, x.id, x.ord::integer, w.attempt_id is not null, coalesce(g.o_correct, false), w.chosen, w.text,
         w.answered_at
    from public.quiz_attempts t
   cross join lateral pg_catalog.unnest(t.item_ids) with ordinality as x(id, ord)
    join public.test_items i on i.id = x.id and i.keyed
    left join public.quiz_answers w on w.attempt_id = t.id and w.item_id = x.id
    left join lateral meldy_private.grade_answer(i.kind, pg_catalog.jsonb_array_length(i.options), i.correct, i.answers,
                case when w.text is not null then pg_catalog.jsonb_build_object('text', w.text)
                     when w.chosen is not null then pg_catalog.jsonb_build_object('chosen', pg_catalog.to_jsonb(w.chosen))
                end) g on true
   where (p_attempt is null or t.id = p_attempt) and (p_quiz is null or t.quiz_id = p_quiz);
end;
$fn$;
revoke all on function meldy_private.quiz_graded(uuid, uuid) from public, anon, authenticated;

-- meldy_private.quiz_pool (20261016120000_quizzes.sql)
create or replace function meldy_private.quiz_pool(p_container uuid, p_subjects uuid[])
returns uuid[]
language sql
stable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.array_agg(i.id order by s.position, s.created_at, i.position, i.id), '{}'::uuid[])
    from public.test_items i
    join public.container_subjects s on s.id = i.subject_id
   where i.container_id = p_container and i.subject_id = any (p_subjects) and i.keyed
$fn$;

-- meldy_private.quiz_doc_items (20261019100000_test_docs.sql)
create or replace function meldy_private.quiz_doc_items(p_container uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $fn$
  select coalesce((pg_catalog.array_agg(x.id order by x.ord))[1:200], '{}'::uuid[])
    from (select i.id, pg_catalog.min(b.ord) as ord
            from public.test_docs d
           cross join lateral pg_catalog.jsonb_array_elements(
                   case when pg_catalog.jsonb_typeof(d.doc -> 'blocks') = 'array' then d.doc -> 'blocks' else '[]'::jsonb end)
                   with ordinality as b(x, ord)
            join public.test_items i
              on i.id = case when pg_catalog.jsonb_typeof(b.x) = 'object' and b.x ->> 'type' = 'question'
                                  and (b.x ->> 'item_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             then (b.x ->> 'item_id')::uuid end
             and i.container_id = d.container_id and i.keyed
           where d.container_id = p_container
           group by i.id) x
$fn$;

-- meldy_private.quiz_attempt_json (20261020120000_quiz_protection.sql)
create or replace function meldy_private.quiz_attempt_json(p_a public.quiz_attempts, p_q public.quizzes)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'attempt_id', p_a.id, 'n', p_a.n, 'quiz_title', p_q.title, 'server_now', pg_catalog.now(),
    'started_at', p_a.started_at, 'deadline_at', p_a.deadline_at, 'allow_back', p_q.allow_back,
    'shuffle_options', p_q.shuffle_options, 'design', meldy_private.quiz_design(p_q),
    'taker_name', p_a.name, 'protection', p_q.protection, 'protection_limit', p_q.protection_limit,
    'guard_count', p_a.guard_count,
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'id', i.id, 'kind', i.kind, 'stem', i.stem, 'options', i.options, 'code', i.code,
                                'keep_order', i.keep_order, 'images', i.images) order by x.ord)
                         from pg_catalog.unnest(p_a.item_ids) with ordinality as x(id, ord)
                         join public.test_items i on i.id = x.id), '[]'::jsonb),
    'answers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                  'item_id', w.item_id, 'chosen', pg_catalog.to_jsonb(w.chosen), 'text', w.text)
                                order by pg_catalog.array_position(p_a.item_ids, w.item_id))
                           from public.quiz_answers w where w.attempt_id = p_a.id), '[]'::jsonb))
$fn$;

-- meldy_private.quiz_answer_for (20261018100000_test_builder.sql)
create or replace function meldy_private.quiz_answer_for(p_attempt_id uuid, p_user uuid, p_guest text, p_answers jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_a public.quiz_attempts%rowtype;
  v_i public.test_items%rowtype;
  v_x jsonb;
  v_item uuid;
  v_empty boolean;
  v_valid boolean;
  v_chosen smallint[];
  v_text text;
  v_n integer := 0;
begin
  select a.quiz_id into v_a.quiz_id from public.quiz_attempts a
   where a.id = p_attempt_id and (a.user_id = p_user or a.guest_hash = p_guest);
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002', detail = 'attempt';
  end if;
  perform meldy_private.quiz_settle(v_a.quiz_id);
  select a.* into v_a from public.quiz_attempts a where a.id = p_attempt_id for update;
  if v_a.finished_at is not null then
    raise exception 'attempt is over' using errcode = 'MC012', detail = 'finished';
  end if;
  if v_a.deadline_at is not null and pg_catalog.now() > v_a.deadline_at + interval '20 seconds' then
    raise exception 'attempt is over' using errcode = 'MC012', detail = 'time';
  end if;
  if p_answers is null or pg_catalog.jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'invalid answers' using errcode = '22023', detail = 'answers';
  end if;
  if pg_catalog.jsonb_array_length(p_answers) not between 1 and 200 then
    raise exception 'invalid answers' using errcode = '22023', detail = 'answers';
  end if;
  for v_x in select x from pg_catalog.jsonb_array_elements(p_answers) x loop
    if pg_catalog.jsonb_typeof(v_x) is distinct from 'object' or pg_catalog.jsonb_typeof(v_x -> 'item_id') is distinct from 'string'
       or (v_x ->> 'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'invalid answers' using errcode = '22023', detail = 'item';
    end if;
    v_item := (v_x ->> 'item_id')::uuid;
    if not (v_item = any (v_a.item_ids)) then
      raise exception 'invalid answers' using errcode = '22023', detail = 'item';
    end if;
    select i.* into v_i from public.test_items i where i.id = v_item;
    if not found then
      raise exception 'invalid answers' using errcode = '22023', detail = 'item';
    end if;
    if v_i.kind = 'short' then
      v_empty := coalesce(pg_catalog.jsonb_typeof(v_x -> 'text'), 'null') = 'null'
                 or (pg_catalog.jsonb_typeof(v_x -> 'text') = 'string' and public.meldy_short_norm(v_x ->> 'text') = '');
    else
      v_empty := coalesce(pg_catalog.jsonb_typeof(v_x -> 'chosen'), 'null') = 'null' or v_x -> 'chosen' = '[]'::jsonb;
    end if;
    if v_empty then
      delete from public.quiz_answers w where w.attempt_id = v_a.id and w.item_id = v_item;
    else
      select g.o_valid, g.o_chosen, g.o_text into v_valid, v_chosen, v_text
        from meldy_private.grade_answer(v_i.kind, pg_catalog.jsonb_array_length(v_i.options), v_i.correct, v_i.answers,
               case when v_i.kind = 'short' then pg_catalog.jsonb_build_object('text', v_x -> 'text')
                    else pg_catalog.jsonb_build_object('chosen', v_x -> 'chosen') end) g;
      if not v_valid or (v_i.kind = 'short' and pg_catalog.char_length(v_text) > 200) then
        raise exception 'invalid answers' using errcode = '22023',
          detail = case when v_i.kind = 'short' then 'text' else 'chosen' end;
      end if;
      insert into public.quiz_answers (attempt_id, item_id, chosen, text, answered_at)
      values (v_a.id, v_item, case when v_i.kind <> 'short' then v_chosen end,
              case when v_i.kind = 'short' then v_text end, pg_catalog.now())
      on conflict (attempt_id, item_id) do update
        set chosen = excluded.chosen, text = excluded.text, answered_at = excluded.answered_at;
    end if;
    v_n := v_n + 1;
  end loop;
  return pg_catalog.jsonb_build_object('saved', v_n, 'server_now', pg_catalog.now(), 'deadline_at', v_a.deadline_at);
end;
$fn$;

-- meldy_private.quiz_result_json (20261020120000_quiz_protection.sql)
create or replace function meldy_private.quiz_result_json(p_attempt uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_a public.quiz_attempts%rowtype;
  v_q public.quizzes%rowtype;
  v_total integer;
  v_correct integer;
  v_percent integer;
  v_review text;
  v_used integer;
  v_items jsonb := '[]'::jsonb;
  v_design jsonb;
  v_band jsonb;
  v_score integer;
  v_max integer;
begin
  select a.* into v_a from public.quiz_attempts a where a.id = p_attempt;
  select q.* into v_q from public.quizzes q where q.id = v_a.quiz_id;
  select pg_catalog.count(*)::integer, (pg_catalog.count(*) filter (where g.correct))::integer,
         coalesce(pg_catalog.sum(coalesce(v_a.item_points[g.ord], 1)) filter (where g.correct), 0)::integer,
         coalesce(pg_catalog.sum(coalesce(v_a.item_points[g.ord], 1)), 0)::integer
    into v_total, v_correct, v_score, v_max
    from meldy_private.quiz_graded(null, p_attempt) g;
  v_percent := case when v_max > 0 then pg_catalog.round(100.0 * v_score / v_max)::integer else 0 end;
  v_review := case when v_q.review <> 'mistakes_then_answers' then v_q.review
                   when meldy_private.quiz_state(v_q) = 'closed' then 'answers'
                   else 'mistakes' end;
  select pg_catalog.count(*)::integer into v_used
    from public.quiz_attempts a
   where a.quiz_id = v_q.id and (a.user_id = v_a.user_id or a.guest_hash = v_a.guest_hash);
  if v_review <> 'score' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', i.id, 'kind', i.kind, 'stem', i.stem, 'options', i.options, 'code', i.code, 'images', i.images,
             'keep_order', i.keep_order,
             'chosen', pg_catalog.to_jsonb(g.chosen), 'text', g.typed, 'right', g.correct,
             'key', case when v_review = 'answers' and i.kind <> 'short' then pg_catalog.to_jsonb(i.correct) end,
             'forms', case when v_review = 'answers' and i.kind = 'short' then pg_catalog.to_jsonb(i.answers) end,
             'explanation', case when v_review = 'answers' then nullif(i.explanation, '') end)
             order by g.ord), '[]'::jsonb)
      into v_items
      from meldy_private.quiz_graded(null, p_attempt) g
      join public.test_items i on i.id = g.item_id;
  end if;
  v_design := meldy_private.quiz_design(v_q);
  select b.x into v_band
    from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(v_design -> 'results' -> 'bands') = 'array'
                                              then v_design -> 'results' -> 'bands' else '[]'::jsonb end)
         with ordinality as b(x, o)
   where case when b.x ->> 'from' ~ '^[0-9]{1,3}$' and b.x ->> 'to' ~ '^[0-9]{1,3}$'
              then (b.x ->> 'from')::integer <= v_percent and v_percent <= (b.x ->> 'to')::integer
              else false end
   order by b.o
   limit 1;
  return pg_catalog.jsonb_build_object(
    'attempt_id', v_a.id, 'n', v_a.n, 'quiz_title', v_q.title, 'code', v_q.code, 'started_at', v_a.started_at,
    'finished_at', v_a.finished_at, 'finish_reason', v_a.finish_reason, 'correct', v_correct, 'total', v_total,
    'score', v_score, 'max_score', v_max,
    'percent', v_percent, 'pass_percent', v_q.pass_percent, 'shuffle_options', v_q.shuffle_options,
    'passed', case when v_q.pass_percent is not null then v_percent >= v_q.pass_percent end,
    'review_now', v_review,
    'answers_after', case when v_q.review = 'mistakes_then_answers' and v_review = 'mistakes'
                          then coalesce(v_q.closed_at, v_q.closes_at) end,
    'attempts_left', case when v_q.attempts_allowed is not null then greatest(v_q.attempts_allowed - v_used, 0) end,
    'can_retry', meldy_private.quiz_block_for(v_q, v_a.user_id, v_a.guest_hash) is null
                 and (v_a.user_id is not null or v_q.guests)
                 and not exists (select 1 from public.quiz_attempts a
                                  where a.quiz_id = v_q.id and (a.user_id = v_a.user_id or a.guest_hash = v_a.guest_hash)
                                    and a.finished_at is null),
    'accent', v_q.accent,
    'practice', case when v_q.offer_practice and v_a.user_id is distinct from v_q.owner_id
                     then pg_catalog.jsonb_build_object(
                            'exam_title', (select c.title from public.containers c where c.id = v_q.container_id),
                            'member', coalesce(meldy_private.role_in(v_a.user_id, v_q.container_id) = 'member', false),
                            'ready', meldy_private.quiz_practice_ready(v_q.container_id)) end,
    'design', v_design,
    'band', v_band,
    'guard', case when v_q.protection <> 'off'
                  then pg_catalog.jsonb_build_object('level', v_q.protection, 'count', v_a.guard_count,
                                                     'limit', v_q.protection_limit) end,
    'items', v_items);
end;
$fn$;

-- public.quiz_results (20261020120000_quiz_protection.sql)
create or replace function public.quiz_results(p_quiz_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select q.* into v_q from public.quizzes q
    join public.containers c on c.id = q.container_id
   where q.id = p_quiz_id and c.owner_id = v_user;
  if not found then
    raise sqlstate 'PGRST' using
      message = '{"code":"P0002","message":"quiz not found","details":"quiz","hint":null}',
      detail = '{"status":404,"headers":{}}';
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  -- One grading pass (g0) for both lists.
  with g0 as materialized (
    select g.*, a.user_id is distinct from v_q.owner_id as counted, coalesce(a.item_points[g.ord], 1) as weight
      from meldy_private.quiz_graded(v_q.id, null) g
      join public.quiz_attempts a on a.id = g.attempt_id
  ), s as (  -- the live score of each attempt
    select g0.attempt_id, pg_catalog.count(*) as total, pg_catalog.count(*) filter (where g0.answered) as answered,
           pg_catalog.count(*) filter (where g0.correct) as correct, pg_catalog.sum(g0.weight) as max_score,
           coalesce(pg_catalog.sum(g0.weight) filter (where g0.correct), 0) as score
      from g0 group by g0.attempt_id
  ), g as (  -- the question stats count the attempts of others than the author only
    select g0.* from g0 where g0.counted
  ), x as (
    select g.item_id, pg_catalog.count(*) as shown, pg_catalog.count(*) filter (where g.answered) as answered,
           pg_catalog.count(*) filter (where g.correct) as correct
      from g group by g.item_id
  ), p as (  -- answers that chose option k of a question
    select g.item_id, c.k::integer as k, pg_catalog.count(*) as n
      from g cross join lateral pg_catalog.unnest(g.chosen) as c(k)
     group by g.item_id, c.k
  ), wt as (  -- the 3 most common wrong short answers of a question (one spelling per normalised form)
    select z.item_id, z.t, z.n
      from (select y.item_id, y.t, y.n, pg_catalog.row_number() over (partition by y.item_id order by y.n desc, y.t) as r
              from (select g.item_id, pg_catalog.min(pg_catalog.btrim(g.typed)) as t, pg_catalog.count(*) as n
                      from g where g.answered and not g.correct and g.typed is not null
                     group by g.item_id, public.meldy_short_norm(g.typed)) y) z
     where z.r <= 3
  )
  select pg_catalog.jsonb_build_object(
    'quiz', meldy_private.quiz_row(v_q), 'server_now', pg_catalog.now(),
    'attempts', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'id', a.id,
                   'person', pg_catalog.left(pg_catalog.md5(coalesce(a.user_id::text, a.guest_hash) || a.quiz_id::text), 16),
                   'name', a.name, 'own', coalesce(a.user_id = v_q.owner_id, false), 'guest', a.guest_hash is not null,
                   'n', a.n, 'started_at', a.started_at,
                   'deadline_at', a.deadline_at, 'finished_at', a.finished_at, 'finish_reason', a.finish_reason,
                   'total', coalesce(s.total, 0), 'answered', coalesce(s.answered, 0), 'correct', coalesce(s.correct, 0),
                   'score', coalesce(s.score, 0), 'max_score', coalesce(s.max_score, 0),
                   'guard_count', a.guard_count, 'guard_events', coalesce(ev.n, 0),
                   'flagged', a.guard_count > 0 or coalesce(ev.copied, 0) > 0)
                   order by a.started_at, a.user_id, a.guest_hash, a.n), '[]'::jsonb)
                   from public.quiz_attempts a
                   left join s on s.attempt_id = a.id
                   left join (select e.attempt_id, pg_catalog.count(*) as n,
                                     pg_catalog.count(*) filter (where e.kind in ('copy', 'paste')) as copied
                                from public.quiz_events e
                                join public.quiz_attempts a2 on a2.id = e.attempt_id
                               where a2.quiz_id = v_q.id
                               group by e.attempt_id) ev on ev.attempt_id = a.id
                  where a.quiz_id = v_q.id),
    'items', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'item_id', i.id, 'shown', x.shown, 'answered', x.answered, 'correct', x.correct,
                'picks', case when i.kind = 'short' then '[]'::jsonb
                              else (select pg_catalog.jsonb_agg(coalesce(p.n, 0) order by o.k)
                                      from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(i.options) - 1) as o(k)
                                      left join p on p.item_id = i.id and p.k = o.k) end,
                'wrong_texts', case when i.kind <> 'short' then '[]'::jsonb
                                    else coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('text', wt.t, 'n', wt.n)
                                                                               order by wt.n desc, wt.t)
                                                     from wt where wt.item_id = i.id), '[]'::jsonb) end)
                order by cs.position, cs.created_at, i.position, i.id), '[]'::jsonb)
                from x
                join public.test_items i on i.id = x.item_id
                join public.container_subjects cs on cs.id = i.subject_id))
    into v_out;
  return v_out;
end;
$fn$;

-- meldy_private.quiz_me (20261019100000_test_docs.sql)
create or replace function meldy_private.quiz_me(p_q public.quizzes, p_user uuid, p_guest text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_role text;
  v_used integer;
  v_open uuid;
  v_reason text;
  v_results jsonb;
begin
  select pg_catalog.count(*)::integer, (pg_catalog.array_agg(a.id) filter (where a.finished_at is null))[1]
    into v_used, v_open
    from public.quiz_attempts a where a.quiz_id = p_q.id and (a.user_id = p_user or a.guest_hash = p_guest);
  v_reason := case when v_open is null then meldy_private.quiz_block_for(p_q, p_user, p_guest) end;
  v_results := coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                  'attempt_id', a.id, 'n', a.n, 'finished_at', a.finished_at,
                                  'correct', s.correct, 'total', s.total, 'score', s.score, 'max_score', s.max_score)
                                  order by a.n)
                           from public.quiz_attempts a
                           cross join lateral (select pg_catalog.count(*) filter (where g.correct) as correct,
                                                      pg_catalog.count(*) as total,
                                                      coalesce(pg_catalog.sum(coalesce(a.item_points[g.ord], 1))
                                                                 filter (where g.correct), 0) as score,
                                                      coalesce(pg_catalog.sum(coalesce(a.item_points[g.ord], 1)), 0) as max_score
                                                 from meldy_private.quiz_graded(null, a.id) g) s
                          where a.quiz_id = p_q.id and (a.user_id = p_user or a.guest_hash = p_guest)
                            and a.finished_at is not null), '[]'::jsonb);
  if p_user is null then
    return pg_catalog.jsonb_build_object(
      'name_hint', null, 'is_author', false, 'is_member', false, 'guest', true, 'attempts_used', v_used,
      'open_attempt', v_open, 'can_start', v_open is not null or v_reason is null, 'reason', v_reason,
      'results', v_results);
  end if;
  v_role := meldy_private.role_in(p_user, p_q.container_id);
  return pg_catalog.jsonb_build_object(
    'name_hint', coalesce((select a.name from public.quiz_attempts a
                            where a.quiz_id = p_q.id and a.user_id = p_user order by a.n desc limit 1),
                          (select nullif(pg_catalog.btrim(p.full_name), '') from public.profiles p where p.id = p_user)),
    'is_author', p_q.owner_id = p_user,
    'is_member', coalesce(v_role = 'member', false),
    'attempts_used', v_used,
    'open_attempt', v_open,
    'can_start', v_open is not null or v_reason is null,
    'reason', v_reason,
    'results', v_results);
end;
$fn$;

-- public.quiz_list (20261019100000_test_docs.sql)
create or replace function public.quiz_list(p_container_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.containers c where c.id = p_container_id and c.owner_id = v_user) then
    raise exception 'container not found' using errcode = 'P0002', detail = 'container';
  end if;
  perform meldy_private.quiz_settle(q.id) from public.quizzes q where q.container_id = p_container_id;
  return coalesce((
    select pg_catalog.jsonb_agg(meldy_private.quiz_row(q) || pg_catalog.jsonb_build_object(
             'people', (select pg_catalog.count(distinct coalesce(a.user_id::text, a.guest_hash)) from public.quiz_attempts a
                         where a.quiz_id = q.id and a.user_id is distinct from q.owner_id),
             'writing', (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = q.id and a.finished_at is null),
             'finished', (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = q.id and a.finished_at is not null),
             'avg_percent', (select pg_catalog.round(pg_catalog.avg(100.0 * s.score / s.max_score), 1)
                               from (select g.attempt_id, pg_catalog.sum(coalesce(a.item_points[g.ord], 1)) as max_score,
                                            coalesce(pg_catalog.sum(coalesce(a.item_points[g.ord], 1))
                                                       filter (where g.correct), 0) as score
                                       from meldy_private.quiz_graded(q.id, null) g
                                       join public.quiz_attempts a on a.id = g.attempt_id
                                      where a.finished_at is not null and a.user_id is distinct from q.owner_id
                                      group by g.attempt_id) s))
             order by q.created_at desc, q.id desc)
      from public.quizzes q where q.container_id = p_container_id), '[]'::jsonb);
end;
$fn$;

-- public.quiz_attempt_answers (20261016120000_quizzes.sql)
create or replace function public.quiz_attempt_answers(p_attempt_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_quiz uuid;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select a.quiz_id into v_quiz from public.quiz_attempts a
    join public.quizzes q on q.id = a.quiz_id
    join public.containers c on c.id = q.container_id
   where a.id = p_attempt_id and c.owner_id = v_user;
  if not found then
    raise exception 'attempt not found' using errcode = 'P0002', detail = 'attempt';
  end if;
  perform meldy_private.quiz_settle(v_quiz);
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', g.item_id, 'chosen', pg_catalog.to_jsonb(g.chosen),
                                                              'text', g.typed, 'correct', g.correct,
                                                              'answered_at', g.answered_at) order by g.ord)
      from meldy_private.quiz_graded(null, p_attempt_id) g
     where g.answered), '[]'::jsonb);
end;
$fn$;

drop function if exists meldy_private.quiz_review_json(public.test_items, uuid, smallint[], text, numeric, boolean);
drop function if exists meldy_private.quiz_answer_json(text, smallint[], text);
drop function if exists meldy_private.quiz_answer_file(public.test_items, uuid, jsonb);
drop function if exists meldy_private.quiz_answer_shown(public.test_items, uuid, smallint[], text);
drop function if exists meldy_private.quiz_shown(public.test_items, uuid, smallint[]);
drop function if exists meldy_private.quiz_kind_json(public.test_items, uuid);
drop function if exists meldy_private.quiz_item_perm(public.test_items, uuid);
drop function if exists meldy_private.quiz_permuted(jsonb, smallint[]);
drop function if exists meldy_private.quiz_perm(text, integer);
drop table if exists public.quiz_essay_marks;

delete from public.quiz_answers where char_length(text) > 200;
alter table public.quiz_answers drop constraint if exists quiz_answers_text_check;
alter table public.quiz_answers add constraint quiz_answers_text_check
  check (text is null or char_length(text) between 1 and 200);
