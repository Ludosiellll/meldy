-- Rollback of 20261018130000_quiz_guards.sql back to release 47 as 20261018100000_test_builder.sql left it: the four
-- replaced bodies exactly as that file wrote them (CREATE OR REPLACE keeps their grants), then the readiness helper and
-- the secret table go. Re-runnable.
-- What changes back: «Тренироваться» joins while the exam's quizzes are open again (the key of a running quiz readable
-- by whoever joined), the result's practice has no ready, the address hash is the sha256 of a fixed prefix and the
-- address again, and the throttle rows are pruned after a guest start only. The throttle rows of the HMAC go (the old
-- hash would not match them; at most two minutes of guest starts are forgotten).

-- 5h. «Начать» for a person (quiz_start of release 46 with the guest's rules added): the person's unfinished attempt
--     comes back as it is (the name ignored); else a new attempt when the quiz takes guests (MC017, a guest), is open
--     (MC013), the person may write it (MC015, a user), has attempts left and the quiz has room (MC014 attempts / full;
--     a guest also past 2000 guest attempts), with a name of 2–80 characters (22023 name); a guest's start is refused
--     past 120 guest starts a minute on the quiz or 30 a minute from the address (MC016 busy). The quiz row is locked
--     first: two tabs pressing «Начать» together get one attempt.
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
  insert into public.quiz_attempts (quiz_id, user_id, guest_hash, name, n, item_ids, started_at, deadline_at)
  values (v_q.id, p_user, case when p_user is null then p_guest end, v_name,
          (select coalesce(pg_catalog.max(a.n), 0) + 1 from public.quiz_attempts a
            where a.quiz_id = v_q.id and (a.user_id = p_user or a.guest_hash = p_guest)),
          v_items, pg_catalog.now(), meldy_private.quiz_deadline(pg_catalog.now(), v_q))
  returning * into v_a;
  if p_user is null then
    -- The rows of the last minute are all the throttle reads; older ones go here (a few per start at most).
    delete from meldy_private.quiz_guest_starts s where s.started_at <= pg_catalog.now() - interval '1 minute';
    if v_ip is not null then
      insert into meldy_private.quiz_guest_starts (ip_hash, started_at) values (v_ip, pg_catalog.now());
    end if;
  end if;
  return meldy_private.quiz_attempt_json(v_a, v_q);
end;
$fn$;

-- 5f. The caller's address as the API saw it (the first x-forwarded-for of request.headers, as Supabase's own rate
--     limit example reads it), hashed; null when there is none or the header cannot be read.
create or replace function meldy_private.quiz_ip_hash()
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_ip text;
begin
  begin
    v_ip := pg_catalog.btrim(pg_catalog.split_part(
              (nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb) ->> 'x-forwarded-for', ',', 1));
  exception
    when others then
      return null;
  end;
  if v_ip is null or v_ip = '' then
    return null;
  end if;
  return pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('meldy-quiz-ip:' || v_ip, 'UTF8')), 'hex');
end;
$fn$;

-- 7e. «Тренировать эти вопросы»: the author offers it (offer_practice) and the caller has a finished attempt in the
--     quiz (else MC018 practice); the author gets their exam back, nothing written; removed by the author → MC018
--     removed; 200 active members → MC018 full; an active member → as they are; left before → back (left_at null);
--     else a member row as container_join writes one (no link: link_id null, no link seat). The exam row is locked:
--     the count of members holds until commit.
create or replace function public.quiz_practice_join(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_m public.container_members%rowtype;
  v_found boolean;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  select q.* into v_q from public.quizzes q where q.code = p_code;
  if not found then
    raise exception 'quiz not found' using errcode = 'P0002', detail = 'quiz';
  end if;
  perform meldy_private.quiz_settle(v_q.id);
  if not v_q.offer_practice
     or not exists (select 1 from public.quiz_attempts a
                     where a.quiz_id = v_q.id and a.user_id = v_user and a.finished_at is not null) then
    raise exception 'no practice offered' using errcode = 'MC018', detail = 'practice';
  end if;
  if exists (select 1 from public.containers c where c.id = v_q.container_id and c.owner_id = v_user) then
    return pg_catalog.jsonb_build_object('container_id', v_q.container_id);
  end if;
  perform 1 from public.containers c where c.id = v_q.container_id for update;
  select m.* into v_m from public.container_members m
   where m.container_id = v_q.container_id and m.user_id = v_user
     for update;
  v_found := found;
  if v_found and v_m.removed_at is not null then
    raise exception 'removed from this container' using errcode = 'MC018', detail = 'removed';
  end if;
  if v_found and v_m.left_at is null then
    return pg_catalog.jsonb_build_object('container_id', v_q.container_id);
  end if;
  if (select pg_catalog.count(*) from public.container_members m
       where m.container_id = v_q.container_id and m.left_at is null and m.removed_at is null) >= 200 then
    raise exception 'no seat left' using errcode = 'MC018', detail = 'full';
  end if;
  if v_found then
    update public.container_members m set left_at = null
     where m.container_id = v_q.container_id and m.user_id = v_user;
  else
    insert into public.container_members (container_id, user_id) values (v_q.container_id, v_user);
  end if;
  return pg_catalog.jsonb_build_object('container_id', v_q.container_id);
end;
$fn$;

-- 5l. Result (release 46.1) for the attempt's person, plus: each item's explanation only when the review shows the
--     answers ('' → null); accent; practice = {exam_title, member} when the author offers it and the taker is not the
--     author (a guest: member false), else null. A guest whose quiz no longer takes guests cannot retry.
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
begin
  select a.* into v_a from public.quiz_attempts a where a.id = p_attempt;
  select q.* into v_q from public.quizzes q where q.id = v_a.quiz_id;
  select pg_catalog.count(*)::integer, (pg_catalog.count(*) filter (where g.correct))::integer into v_total, v_correct
    from meldy_private.quiz_graded(null, p_attempt) g;
  v_percent := case when v_total > 0 then pg_catalog.round(100.0 * v_correct / v_total)::integer else 0 end;
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
  return pg_catalog.jsonb_build_object(
    'attempt_id', v_a.id, 'n', v_a.n, 'quiz_title', v_q.title, 'code', v_q.code, 'started_at', v_a.started_at,
    'finished_at', v_a.finished_at, 'finish_reason', v_a.finish_reason, 'correct', v_correct, 'total', v_total,
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
                            'member', coalesce(meldy_private.role_in(v_a.user_id, v_q.container_id) = 'member', false)) end,
    'items', v_items);
end;
$fn$;

-- The helper and the secret of 20261018130000.
drop function if exists meldy_private.quiz_practice_ready(uuid);
drop table if exists meldy_private.quiz_ip_secret;
delete from meldy_private.quiz_guest_starts;
