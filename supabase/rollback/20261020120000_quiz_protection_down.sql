-- Rollback of supabase/migrations/20261020120000_quiz_protection.sql («Защита от списывания»).
-- Puts back the ten functions it changed exactly as 20261016120000_quizzes.sql (quiz_settle) and
-- 20261019100000_test_docs.sql (the other nine) left them, drops its new calls and helpers, the events table and the
-- three columns. An attempt the strict level ended keeps its end and becomes finish_reason 'sent' (the old CHECK has
-- no 'protection'); its events are gone with the table. Re-runnable: OR REPLACE, IF EXISTS, a guarded DO block.
-- Local rehearsal: supabase/tests/local/quiz_protection_run.sh (the catalog after it equals the one before the
-- migration, the functions byte for byte).

-- 1. The calls and helpers of the migration.
drop function if exists public.quiz_events_add(uuid, jsonb);
drop function if exists public.quiz_guest_events_add(uuid, text, jsonb);
drop function if exists public.quiz_attempt_events(uuid);
drop function if exists meldy_private.quiz_events_for(uuid, uuid, text, jsonb);
drop function if exists meldy_private.quiz_guard_rank(text);
drop function if exists meldy_private.quiz_guard_counted(text);

-- 2. The changed functions as they were.
create or replace function meldy_private.quiz_settle(p_quiz uuid)
returns integer
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_q public.quizzes%rowtype;
  v_n integer;
  v_m integer;
begin
  select q.* into v_q from public.quizzes q where q.id = p_quiz;
  if not found then
    return 0;
  end if;
  update public.quiz_attempts a
     set finished_at = a.deadline_at,
         finish_reason = meldy_private.quiz_end_reason(a.started_at, a.deadline_at, v_q.time_limit_s)
   where a.quiz_id = p_quiz and a.finished_at is null and a.deadline_at is not null
     and pg_catalog.now() >= a.deadline_at + interval '20 seconds';
  get diagnostics v_n = row_count;
  update public.quiz_attempts a
     set finished_at = greatest(a.started_at, coalesce(v_q.closed_at, v_q.closes_at)), finish_reason = 'closed'
   where a.quiz_id = p_quiz and a.finished_at is null
     and (v_q.closed_at is not null
          or (a.deadline_at is null and v_q.closes_at is not null
              and pg_catalog.now() >= v_q.closes_at + interval '20 seconds'));
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$fn$;

create or replace function meldy_private.quiz_row(p_q public.quizzes)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'id', p_q.id, 'container_id', p_q.container_id, 'code', p_q.code, 'title', p_q.title,
    'subject_ids', pg_catalog.to_jsonb(p_q.subject_ids), 'item_count', p_q.item_count, 'same_set', p_q.same_set,
    'shuffle_items', p_q.shuffle_items, 'shuffle_options', p_q.shuffle_options, 'time_limit_s', p_q.time_limit_s,
    'opens_at', p_q.opens_at, 'closes_at', p_q.closes_at, 'closed_at', p_q.closed_at, 'attempts', p_q.attempts_allowed,
    'grading', p_q.grading, 'allow_back', p_q.allow_back, 'pass_percent', p_q.pass_percent, 'review', p_q.review,
    'members_only', p_q.members_only, 'guests', p_q.guests, 'cover_path', p_q.cover_path, 'accent', p_q.accent,
    'offer_practice', p_q.offer_practice, 'design', p_q.design, 'created_at', p_q.created_at, 'updated_at', p_q.updated_at,
    'state', meldy_private.quiz_state(p_q), 'started', meldy_private.quiz_started(p_q))
$fn$;

create or replace function meldy_private.quiz_apply(p_q public.quizzes, p_settings jsonb)
returns public.quizzes
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_q public.quizzes := p_q;
  v jsonb;
  v_ids uuid[];
begin
  if p_settings is null or pg_catalog.jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'invalid settings' using errcode = '22023', detail = 'settings';
  end if;
  if p_settings ? 'title' then
    v := p_settings -> 'title';
    if pg_catalog.jsonb_typeof(v) is distinct from 'string'
       or pg_catalog.char_length(pg_catalog.btrim(v #>> '{}')) not between 1 and 120 then
      raise exception 'invalid settings' using errcode = '22023', detail = 'title';
    end if;
    v_q.title := pg_catalog.btrim(v #>> '{}');
  end if;
  if p_settings ? 'subject_ids' then
    v := p_settings -> 'subject_ids';
    if pg_catalog.jsonb_typeof(v) is distinct from 'array' then
      raise exception 'invalid settings' using errcode = '22023', detail = 'subject_ids';
    end if;
    if pg_catalog.jsonb_array_length(v) not between 1 and 50
       or exists (select 1 from pg_catalog.jsonb_array_elements(v) x
                   where pg_catalog.jsonb_typeof(x) is distinct from 'string'
                      or (x #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'invalid settings' using errcode = '22023', detail = 'subject_ids';
    end if;
    select pg_catalog.array_agg(s.id order by s.position, s.created_at, s.id) into v_ids
      from public.container_subjects s
     where s.container_id = v_q.container_id
       and s.id in (select (x #>> '{}')::uuid from pg_catalog.jsonb_array_elements(v) x);
    if coalesce(pg_catalog.cardinality(v_ids), 0)
       <> (select pg_catalog.count(distinct (x #>> '{}')::uuid) from pg_catalog.jsonb_array_elements(v) x) then
      raise exception 'invalid settings' using errcode = '22023', detail = 'subject_ids';
    end if;
    v_q.subject_ids := v_ids;
  end if;
  if p_settings ? 'item_count' then
    v_q.item_count := meldy_private.quiz_int(p_settings, 'item_count', 1, 200, false);
  end if;
  if p_settings ? 'same_set' then
    v_q.same_set := meldy_private.quiz_bool(p_settings, 'same_set');
  end if;
  if p_settings ? 'shuffle_items' then
    v_q.shuffle_items := meldy_private.quiz_bool(p_settings, 'shuffle_items');
  end if;
  if p_settings ? 'shuffle_options' then
    v_q.shuffle_options := meldy_private.quiz_bool(p_settings, 'shuffle_options');
  end if;
  if p_settings ? 'time_limit_min' then
    v_q.time_limit_s := meldy_private.quiz_int(p_settings, 'time_limit_min', 1, 240, true) * 60;
  end if;
  if p_settings ? 'opens_at' then
    v_q.opens_at := meldy_private.quiz_time(p_settings, 'opens_at');
  end if;
  if p_settings ? 'closes_at' then
    v_q.closes_at := meldy_private.quiz_time(p_settings, 'closes_at');
  end if;
  if p_settings ? 'attempts' then
    v_q.attempts_allowed := meldy_private.quiz_int(p_settings, 'attempts', 1, 50, true);
  end if;
  if p_settings ? 'grading' then
    if pg_catalog.jsonb_typeof(p_settings -> 'grading') is distinct from 'string'
       or (p_settings ->> 'grading') not in ('best', 'last') then
      raise exception 'invalid settings' using errcode = '22023', detail = 'grading';
    end if;
    v_q.grading := p_settings ->> 'grading';
  end if;
  if p_settings ? 'allow_back' then
    v_q.allow_back := meldy_private.quiz_bool(p_settings, 'allow_back');
  end if;
  if p_settings ? 'pass_percent' then
    v_q.pass_percent := meldy_private.quiz_int(p_settings, 'pass_percent', 1, 100, true);
  end if;
  if p_settings ? 'review' then
    if pg_catalog.jsonb_typeof(p_settings -> 'review') is distinct from 'string'
       or (p_settings ->> 'review') not in ('score', 'mistakes', 'answers', 'mistakes_then_answers') then
      raise exception 'invalid settings' using errcode = '22023', detail = 'review';
    end if;
    v_q.review := p_settings ->> 'review';
  end if;
  if p_settings ? 'members_only' then
    v_q.members_only := meldy_private.quiz_bool(p_settings, 'members_only');
  end if;
  if p_settings ? 'guests' then
    v_q.guests := meldy_private.quiz_bool(p_settings, 'guests');
  end if;
  if p_settings ? 'cover_path' then
    v := p_settings -> 'cover_path';
    if pg_catalog.jsonb_typeof(v) = 'null' then
      v_q.cover_path := null;
    elsif pg_catalog.jsonb_typeof(v) is distinct from 'string'
          or (v #>> '{}') !~ '^[0-9a-f-]{36}/[0-9a-f]{64}[.](png|jpg|gif|webp)$'
          or pg_catalog.split_part(v #>> '{}', '/', 1) <> v_q.container_id::text then
      raise exception 'invalid settings' using errcode = '22023', detail = 'cover_path';
    else
      v_q.cover_path := v #>> '{}';
    end if;
  end if;
  if p_settings ? 'accent' then
    if pg_catalog.jsonb_typeof(p_settings -> 'accent') is distinct from 'string'
       or (p_settings ->> 'accent') not in ('blue', 'green', 'orange', 'violet', 'pink', 'graphite') then
      raise exception 'invalid settings' using errcode = '22023', detail = 'accent';
    end if;
    v_q.accent := p_settings ->> 'accent';
  end if;
  if p_settings ? 'offer_practice' then
    v_q.offer_practice := meldy_private.quiz_bool(p_settings, 'offer_practice');
  end if;
  if p_settings ? 'design' then
    v_q.design := meldy_private.quiz_bool(p_settings, 'design');
  end if;
  if v_q.members_only and v_q.guests then
    if p_settings ? 'guests' then
      raise exception 'invalid settings' using errcode = '22023', detail = 'guests';
    end if;
    v_q.guests := false;
  end if;
  if v_q.opens_at is not null and v_q.closes_at is not null and v_q.closes_at <= v_q.opens_at then
    raise exception 'invalid settings' using errcode = '22023', detail = 'closes_at';
  end if;
  return v_q;
end;
$fn$;

create or replace function public.quiz_create(p_container_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_pool uuid[];
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- One creator per exam at a time: the count below holds until commit.
  perform 1 from public.containers c where c.id = p_container_id and c.owner_id = v_user for update;
  if not found then
    raise exception 'container not found' using errcode = 'P0002', detail = 'container';
  end if;
  if (select pg_catalog.count(*) from public.quizzes q where q.container_id = p_container_id) >= 50 then
    raise exception 'too many quizzes' using errcode = 'MC010', detail = 'quizzes';
  end if;
  v_q.id := pg_catalog.gen_random_uuid();
  v_q.container_id := p_container_id;
  v_q.owner_id := v_user;
  v_q.title := 'Контрольная · ' || pg_catalog.to_char(pg_catalog.now() at time zone 'Europe/Minsk', 'DD.MM');
  select coalesce(pg_catalog.array_agg(s.id order by s.position, s.created_at, s.id), '{}'::uuid[]) into v_q.subject_ids
    from public.container_subjects s
   where s.container_id = p_container_id
     and exists (select 1 from public.test_items i where i.subject_id = s.id and i.keyed);
  v_q.item_count := 20;
  v_q.same_set := false;
  v_q.shuffle_items := true;
  v_q.shuffle_options := true;
  v_q.attempts_allowed := 1;
  v_q.grading := 'best';
  v_q.allow_back := true;
  v_q.review := 'mistakes_then_answers';
  v_q.members_only := false;
  v_q.guests := true;
  v_q.cover_path := null;
  v_q.accent := 'blue';
  v_q.offer_practice := false;
  v_q.design := false;
  v_q := meldy_private.quiz_apply(v_q, coalesce(p_settings, '{}'::jsonb));
  v_pool := meldy_private.quiz_pool(p_container_id, v_q.subject_ids);
  if v_q.design then
    if pg_catalog.cardinality(meldy_private.quiz_doc_items(p_container_id)) = 0 then
      raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
    end if;
  elsif pg_catalog.cardinality(v_pool) = 0 then
    raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
  end if;
  if pg_catalog.cardinality(v_pool) > 0 then
    v_q.item_count := least(v_q.item_count::integer, pg_catalog.cardinality(v_pool));
    if v_q.same_set then
      v_q.fixed_item_ids := meldy_private.quiz_fixed(v_q, v_pool);
    end if;
  end if;
  loop
    v_q.code := meldy_private.random_code();
    exit when not exists (select 1 from public.quizzes q where q.code = v_q.code);
  end loop;
  v_q.created_at := pg_catalog.now();
  v_q.updated_at := pg_catalog.now();
  insert into public.quizzes values (v_q.*);
  return meldy_private.quiz_row(v_q);
end;
$fn$;

create or replace function public.quiz_update(p_quiz_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_old public.quizzes%rowtype;
  v_new public.quizzes%rowtype;
  v_pool uuid[];
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select q.* into v_old from public.quizzes q
    join public.containers c on c.id = q.container_id
   where q.id = p_quiz_id and c.owner_id = v_user
     for update of q;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  perform meldy_private.quiz_settle(v_old.id);
  v_new := meldy_private.quiz_apply(v_old, p_settings);
  v_pool := meldy_private.quiz_pool(v_old.container_id, v_new.subject_ids);
  if meldy_private.quiz_started(v_old) then
    if p_settings ? 'subject_ids' and v_new.subject_ids is distinct from v_old.subject_ids then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'subject_ids';
    end if;
    if p_settings ? 'item_count' and v_new.item_count <> v_old.item_count
       and least(v_new.item_count::integer, pg_catalog.cardinality(v_pool)) <> v_old.item_count then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'item_count';
    end if;
    if v_new.same_set is distinct from v_old.same_set then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'same_set';
    end if;
    if v_new.shuffle_items is distinct from v_old.shuffle_items then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'shuffle_items';
    end if;
    if v_new.shuffle_options is distinct from v_old.shuffle_options then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'shuffle_options';
    end if;
    if v_new.time_limit_s is distinct from v_old.time_limit_s then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'time_limit_min';
    end if;
    if v_new.design is distinct from v_old.design then
      raise exception 'quiz already started' using errcode = 'MC011', detail = 'design';
    end if;
    v_new.item_count := v_old.item_count;
  elsif p_settings ?| array['subject_ids', 'item_count', 'same_set', 'design'] then
    if v_new.design then
      if pg_catalog.cardinality(meldy_private.quiz_doc_items(v_old.container_id)) = 0 then
        raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
      end if;
    elsif pg_catalog.cardinality(v_pool) = 0 then
      raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
    end if;
    if pg_catalog.cardinality(v_pool) = 0 then
      v_new.fixed_item_ids := null;
    else
      v_new.item_count := least(v_new.item_count::integer, pg_catalog.cardinality(v_pool));
      if not v_new.same_set then
        v_new.fixed_item_ids := null;
      elsif v_new.fixed_item_ids is null or not v_old.same_set or v_new.subject_ids is distinct from v_old.subject_ids
            or v_new.item_count <> v_old.item_count then
        v_new.fixed_item_ids := meldy_private.quiz_fixed(v_new, v_pool);
      end if;
    end if;
  end if;
  if p_settings ? 'closes_at' and v_new.closes_at > pg_catalog.now() then
    v_new.closed_at := null;
  end if;
  v_new.updated_at := pg_catalog.now();
  update public.quizzes q set
    title = v_new.title, subject_ids = v_new.subject_ids, item_count = v_new.item_count, same_set = v_new.same_set,
    fixed_item_ids = v_new.fixed_item_ids, shuffle_items = v_new.shuffle_items, shuffle_options = v_new.shuffle_options,
    time_limit_s = v_new.time_limit_s, opens_at = v_new.opens_at, closes_at = v_new.closes_at,
    attempts_allowed = v_new.attempts_allowed, grading = v_new.grading, allow_back = v_new.allow_back,
    pass_percent = v_new.pass_percent, review = v_new.review, members_only = v_new.members_only,
    guests = v_new.guests, cover_path = v_new.cover_path, accent = v_new.accent, offer_practice = v_new.offer_practice,
    design = v_new.design, closed_at = v_new.closed_at, updated_at = v_new.updated_at
   where q.id = v_old.id;
  update public.quiz_attempts a set deadline_at = meldy_private.quiz_deadline(a.started_at, v_new)
   where a.quiz_id = v_old.id and a.finished_at is null
     and a.deadline_at is distinct from meldy_private.quiz_deadline(a.started_at, v_new);
  return meldy_private.quiz_row(v_new);
end;
$fn$;

create or replace function public.quiz_preview(p_code text, p_token text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_me jsonb;
begin
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  select q.* into v_q from public.quizzes q where q.code = p_code;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  if v_user is not null then
    v_me := meldy_private.quiz_me(v_q, v_user, null);
  elsif v_q.guests then
    v_me := meldy_private.quiz_me(v_q, null, meldy_private.quiz_token_hash(p_token));
  end if;
  return pg_catalog.jsonb_build_object(
    'status', meldy_private.quiz_state(v_q), 'title', v_q.title,
    'exam_title', (select c.title from public.containers c where c.id = v_q.container_id),
    'author_name', coalesce((select nullif(pg_catalog.btrim(p.full_name), '') from public.profiles p
                              where p.id = v_q.owner_id), 'Без имени'),
    'item_count', meldy_private.quiz_draw_count(v_q), 'time_limit_s', v_q.time_limit_s,
    'opens_at', v_q.opens_at, 'closes_at', v_q.closes_at, 'attempts', v_q.attempts_allowed, 'grading', v_q.grading,
    'allow_back', v_q.allow_back, 'pass_percent', v_q.pass_percent, 'review', v_q.review,
    'members_only', v_q.members_only, 'guests', v_q.guests, 'cover_path', v_q.cover_path, 'accent', v_q.accent,
    'offer_practice', v_q.offer_practice, 'design', meldy_private.quiz_design(v_q),
    'server_now', pg_catalog.now(), 'me', v_me);
end;
$fn$;

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

create or replace function meldy_private.quiz_start_for(p_code text, p_name text, p_user uuid, p_guest text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_q public.quizzes%rowtype;
  v_a public.quiz_attempts%rowtype;
  v_state text;
  v_items uuid[];
  v_name text := pg_catalog.btrim(coalesce(p_name, ''));
  v_ip text;
begin
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  select q.* into v_q from public.quizzes q where q.code = p_code for update;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  if p_user is null and not v_q.guests then
    raise exception 'sign in to write this quiz' using errcode = 'MC017', detail = 'guests';
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  select a.* into v_a from public.quiz_attempts a
   where a.quiz_id = v_q.id and (a.user_id = p_user or a.guest_hash = p_guest) and a.finished_at is null
   order by a.n desc
   limit 1;
  if found then
    return meldy_private.quiz_attempt_json(v_a, v_q);
  end if;
  v_state := meldy_private.quiz_state(v_q);
  if v_state <> 'open' then
    raise exception 'quiz not open' using errcode = 'MC013', detail = v_state;
  end if;
  if v_q.members_only and meldy_private.role_in(p_user, v_q.container_id) is null then
    raise exception 'members only' using errcode = 'MC015', detail = 'members_only';
  end if;
  if (select pg_catalog.count(*) from public.quiz_attempts a
       where a.quiz_id = v_q.id and (a.user_id = p_user or a.guest_hash = p_guest))
       >= coalesce(v_q.attempts_allowed, 50) then
    raise exception 'no attempts left' using errcode = 'MC014', detail = 'attempts';
  end if;
  if (select pg_catalog.count(*) from public.quiz_attempts a where a.quiz_id = v_q.id) >= 3000
     or (p_user is null
         and (select pg_catalog.count(*) from public.quiz_attempts a
               where a.quiz_id = v_q.id and a.guest_hash is not null) >= 2000) then
    raise exception 'no attempts left' using errcode = 'MC014', detail = 'full';
  end if;
  if pg_catalog.char_length(v_name) not between 2 and 80 then
    raise exception 'invalid name' using errcode = '22023', detail = 'name';
  end if;
  if p_user is null then
    -- The check reads the last minute; rows older than two minutes go at every check, before the count.
    delete from meldy_private.quiz_guest_starts s where s.started_at <= pg_catalog.now() - interval '2 minutes';
    if (select pg_catalog.count(*) from public.quiz_attempts a
         where a.quiz_id = v_q.id and a.guest_hash is not null
           and a.started_at > pg_catalog.now() - interval '1 minute') >= 120 then
      raise exception 'too many starts' using errcode = 'MC016', detail = 'busy';
    end if;
    v_ip := meldy_private.quiz_ip_hash();
    if v_ip is not null
       and (select pg_catalog.count(*) from meldy_private.quiz_guest_starts s
             where s.ip_hash = v_ip and s.started_at > pg_catalog.now() - interval '1 minute') >= 30 then
      raise exception 'too many starts' using errcode = 'MC016', detail = 'busy';
    end if;
  end if;
  v_items := meldy_private.quiz_draw(v_q);
  if pg_catalog.cardinality(v_items) = 0 then
    raise exception 'no questions to draw' using errcode = 'MC013', detail = 'no_questions';
  end if;
  insert into public.quiz_attempts (quiz_id, user_id, guest_hash, name, n, item_ids, item_points, started_at, deadline_at)
  values (v_q.id, p_user, case when p_user is null then p_guest end, v_name,
          (select coalesce(pg_catalog.max(a.n), 0) + 1 from public.quiz_attempts a
            where a.quiz_id = v_q.id and (a.user_id = p_user or a.guest_hash = p_guest)),
          v_items, case when v_q.design then meldy_private.quiz_doc_points(v_q.container_id, v_items) end,
          pg_catalog.now(), meldy_private.quiz_deadline(pg_catalog.now(), v_q))
  returning * into v_a;
  if p_user is null and v_ip is not null then
    insert into meldy_private.quiz_guest_starts (ip_hash, started_at) values (v_ip, pg_catalog.now());
  end if;
  return meldy_private.quiz_attempt_json(v_a, v_q);
end;
$fn$;

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
    'items', v_items);
end;
$fn$;

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
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
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
                   'score', coalesce(s.score, 0), 'max_score', coalesce(s.max_score, 0))
                   order by a.started_at, a.user_id, a.guest_hash, a.n), '[]'::jsonb)
                   from public.quiz_attempts a
                   left join s on s.attempt_id = a.id
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


-- 3. The data and the schema.
update public.quiz_attempts a set finish_reason = 'sent' where a.finish_reason = 'protection';
do $do$
begin
  if exists (select 1 from pg_catalog.pg_constraint
              where conrelid = 'public.quiz_attempts'::regclass and conname = 'quiz_attempts_finish_reason_check'
                and pg_catalog.pg_get_constraintdef(oid) like '%protection%') then
    alter table public.quiz_attempts drop constraint quiz_attempts_finish_reason_check;
    alter table public.quiz_attempts add constraint quiz_attempts_finish_reason_check
      check (finish_reason in ('sent', 'time', 'closed'));
  end if;
end;
$do$;
drop table if exists public.quiz_events;
alter table public.quiz_attempts drop column if exists guard_count;
alter table public.quizzes drop column if exists protection_limit;
alter table public.quizzes drop column if exists protection;
