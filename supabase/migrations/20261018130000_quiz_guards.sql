-- quiz_guards (release 47 security fixes: «Тренироваться» waits for the closing; the address throttle under a secret)
-- Repo file: supabase/migrations/20261018130000_quiz_guards.sql. Base: 20261018100000_test_builder.sql (release 47, live).
-- Check after the apply: supabase/tests/quiz_guards.sql (test_builder.sql, quizzes.sql and quiz_result_order.sql still
-- hold). Local rehearsal (never live): supabase/tests/local/quiz_guards_run.sh. Rollback:
-- supabase/rollback/20261018130000_quiz_guards_down.sql (the bodies of 20261018100000 again, byte for byte).
--
-- 1. Practice is ready only when no quiz of the exam is open or not yet open. A member reads every question of the exam
--    with its key and explanation (by design: they study it), so a taker who joined through «Тренироваться» while a
--    quiz of that exam was running could read the key and pass it on, or use it on their own next attempt.
--    quiz_practice_join refuses with MC018 detail open until then (after the offer / finished-attempt check and the
--    author's own exam, before anything is written); the result's practice object says ready (the same rule), so the
--    page shows the button only when it works. A quiz past its closes_at reads closed (meldy_private.quiz_state) whether
--    or not its attempts were settled yet.
-- 2. The address of a guest start (the first x-forwarded-for of request.headers) is kept as HMAC-SHA256 under a random
--    secret of meldy_private.quiz_ip_secret (one row, 32 bytes, made here when missing, no grants). The sha256 of a fixed
--    prefix and the address could be turned back into the address by trying every IPv4 address. The rows of the old
--    hash go when the secret is made. The throttle rows older than two minutes are pruned at every check, before the
--    count (the check reads the last minute). 30 starts a minute from one address and 120 a minute on a quiz, as before.
--
-- Redefined (CREATE OR REPLACE keeps their grants): meldy_private.quiz_ip_hash(), meldy_private.quiz_start_for(text, text,
-- uuid, text), meldy_private.quiz_result_json(uuid), public.quiz_practice_join(text). New: meldy_private.quiz_practice_ready(uuid),
-- table meldy_private.quiz_ip_secret. New error: MC018 detail open. New key: Result.practice.ready (boolean).
-- 20261019100000_test_docs.sql (not live, later in order) redefines meldy_private.quiz_result_json: it must carry the
-- practice object of this file (with ready) when it is rebased.
-- Needs pgcrypto in schema extensions (hmac, gen_random_bytes), as every Supabase project has it.
-- Re-runnable: IF NOT EXISTS, OR REPLACE, guarded blocks; a second apply leaves the catalog and the secret as they were.
-- The whole file is one request (supabase/migrate.py).

do $do$
begin
  if pg_catalog.to_regprocedure('extensions.hmac(bytea,bytea,text)') is null
     or pg_catalog.to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'pgcrypto is expected in schema extensions (hmac, gen_random_bytes)';
  end if;
end;
$do$;

-- 1. Practice.
-- 1a. Ready: no quiz of the exam is open or not yet open.
create or replace function meldy_private.quiz_practice_ready(p_container uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select not exists (select 1 from public.quizzes z
                      where z.container_id = p_container and meldy_private.quiz_state(z) in ('open', 'not_yet'))
$fn$;

-- 1b. Result (20261018100000) with practice = {exam_title, member, ready}; everything else as it was.
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
                            'member', coalesce(meldy_private.role_in(v_a.user_id, v_q.container_id) = 'member', false),
                            'ready', meldy_private.quiz_practice_ready(v_q.container_id)) end,
    'items', v_items);
end;
$fn$;

-- 1c. «Тренировать эти вопросы» (20261018100000) with the wait: the offer and a finished attempt (else MC018 practice);
--     the author gets their exam back, nothing written; while a quiz of the exam is open or not yet open → MC018 open;
--     then as before: removed → MC018 removed; 200 active members → MC018 full; an active member → as they are; left
--     before → back; else a member row as container_join writes one. The exam row is locked for the count of members.
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
  if not meldy_private.quiz_practice_ready(v_q.container_id) then
    raise exception 'practice opens when the quizzes close' using errcode = 'MC018', detail = 'open';
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

-- 2. The address throttle.
-- 2a. The secret of the address hash: one row of 32 random bytes, made once. Row security on and no policy, no grant:
--     only the private functions (run by the SECURITY DEFINER quiz calls) read it. When it is made, the throttle rows of
--     the old hash go (at most a minute of guest starts; their hashes could be turned back into addresses).
create table if not exists meldy_private.quiz_ip_secret (
  id boolean primary key default true,
  secret bytea not null,
  created_at timestamptz not null default now(),
  constraint quiz_ip_secret_one_row check (id),
  constraint quiz_ip_secret_length check (octet_length(secret) = 32)
);
alter table meldy_private.quiz_ip_secret enable row level security;
revoke all on table meldy_private.quiz_ip_secret from public, anon, authenticated, service_role;
do $do$
begin
  if not exists (select 1 from meldy_private.quiz_ip_secret) then
    insert into meldy_private.quiz_ip_secret (id, secret) values (true, extensions.gen_random_bytes(32));
    delete from meldy_private.quiz_guest_starts;
  end if;
end;
$do$;

-- 2b. The caller's address as the API saw it (the first x-forwarded-for of request.headers; the site's /sb/ proxy puts
--     the visitor's own address there), as HMAC-SHA256 under the secret (hex); null when there is no address, the header
--     cannot be read or the secret is missing (then only the per-quiz limit holds).
create or replace function meldy_private.quiz_ip_hash()
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_ip text;
  v_key bytea;
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
  select s.secret into v_key from meldy_private.quiz_ip_secret s where s.id;
  if v_key is null then
    return null;
  end if;
  return pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(v_ip, 'UTF8'), v_key, 'sha256'), 'hex');
end;
$fn$;

-- 2c. «Начать» for a person (20261018100000) with the prune moved to the check: before a guest's start is counted, the
--     throttle rows older than two minutes go (whatever the start comes to); the row of a guest start is kept after its
--     attempt is made, as before. Everything else as it was.
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
  insert into public.quiz_attempts (quiz_id, user_id, guest_hash, name, n, item_ids, started_at, deadline_at)
  values (v_q.id, p_user, case when p_user is null then p_guest end, v_name,
          (select coalesce(pg_catalog.max(a.n), 0) + 1 from public.quiz_attempts a
            where a.quiz_id = v_q.id and (a.user_id = p_user or a.guest_hash = p_guest)),
          v_items, pg_catalog.now(), meldy_private.quiz_deadline(pg_catalog.now(), v_q))
  returning * into v_a;
  if p_user is null and v_ip is not null then
    insert into meldy_private.quiz_guest_starts (ip_hash, started_at) values (v_ip, pg_catalog.now());
  end if;
  return meldy_private.quiz_attempt_json(v_a, v_q);
end;
$fn$;

-- 3. Grants: the new helper stays private like the others (meldy_private has no USAGE for clients anyway).
revoke all on function meldy_private.quiz_practice_ready(uuid) from public, anon, authenticated;
