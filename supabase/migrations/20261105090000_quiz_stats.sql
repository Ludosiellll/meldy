-- quiz_stats (release 49, part B: the author's statistics of a «Контрольная», spec Test_Builder_Spec_2026-10-18 «Выпуск 49»)
-- Repo file: supabase/migrations/20261105090000_quiz_stats.sql. Base: 20261101090200_question_kinds_quiz.sql
-- (meldy_private.quiz_graded with credit and pending, quiz_answer_json) and 20261101090100_question_kinds_grading.sql
-- (meldy_private.record_test_answers_for graded by grade_item).
-- Why: quiz_results gives a question's share of right answers and its picks, but not who got which question right, so
-- the page could not say whether a question tells those who know from those who do not, how long people spend on it,
-- who should repeat what, or how this quiz went next to another one of the same test. And the author had no way to put
-- the participants' mistakes into their training: only a participant could, through «Тренироваться дальше» (and that
-- joins the exam without recording a mistake).
-- What this file adds (nothing existing changes; three new functions for the signed-in author):
--   1. public.quiz_analysis(p_quiz_id): the quiz's finished attempts of others than the author, each with its cells —
--      [question index, credit 0..1 (null while an essay waits for its mark), seconds (null: no answer)] — and with
--      «member» (an account in the exam now: its mistakes can go to training) and «sent» (they went already); the
--      questions as a list of ids the cells point into (the exam's order); and «others»: up to 10 other quizzes of the
--      same exam or test with the shown count and the credit of each of those questions, for the comparison of groups.
--      Seconds of an answer: from the answer saved before it in the attempt (the start for the first), by the server's
--      time of the last save, at most a day. The page computes the rest (discrimination, the trap option, the median
--      time, «кому что повторить»): frontend/src/lib/quizzes/analysis.ts.
--   2. public.quiz_send_mistakes(p_quiz_id): for each account's latest finished attempt, its questions answered wrong,
--      in part or not at all (not essays) go into that person's training through meldy_private.record_test_answers_for
--      (mode learn, as the live game's «тренировать ошибки» does) with client_event_id qz:<attempt>:<item> (hex), so a
--      second press writes nothing; only for people in the exam now (the core takes no one else; the author never
--      adds anyone). Guests have no training: counted and said. → {people, answers, again, clean, outside, guests,
--      practice}.
--   3. public.test_item_percents(p_container_id): per question of the author's exam or test, how many finished attempts
--      of others got it (shown) and their credit, over all its quizzes (the latest 2000 attempts) — the studio's canvas
--      shows «верно N %». → {items: [{item_id, shown, credit}], attempts}.
-- Errors (SQLSTATE): 28000 not signed in; P0002 as HTTP 404 (raise sqlstate 'PGRST', as quiz_results) detail quiz /
-- container: not the author's.
-- Check after the apply: supabase/tests/quiz_stats.sql (catalog only; read-only). Local rehearsal (never live):
-- supabase/tests/local/quiz_stats_telegram_run.sh (quiz_stats_behaviour.sql). Rollback:
-- supabase/rollback/20261105090000_quiz_stats_down.sql. Re-runnable: OR REPLACE; the grants are set again.

do $do$
begin
  if pg_catalog.to_regprocedure('meldy_private.quiz_graded(uuid, uuid)') is null
     or not exists (select 1 from pg_catalog.pg_proc p
                     where p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_graded(uuid, uuid)')
                       and 'credit' = any (p.proargnames))
     or pg_catalog.to_regprocedure('meldy_private.record_test_answers_for(uuid, jsonb, text, integer, text, uuid)') is null
     or pg_catalog.to_regprocedure('meldy_private.quiz_answer_json(text, smallint[], text)') is null then
    raise exception 'the base is expected: 20261101090200_question_kinds_quiz.sql';
  end if;
end;
$do$;

-- 1. The author's analysis of one quiz.
create or replace function public.quiz_analysis(p_quiz_id uuid)
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
  with a as materialized (  -- the finished attempts of others than the author
    select t.id, t.user_id, t.guest_hash, t.n, t.started_at, t.finished_at
      from public.quiz_attempts t
     where t.quiz_id = v_q.id and t.finished_at is not null and t.user_id is distinct from v_q.owner_id
  ), g as materialized (
    select g.attempt_id, g.item_id, g.ord, g.answered, g.credit, g.pending, g.answered_at, a.started_at
      from a cross join lateral meldy_private.quiz_graded(null, a.id) g
  ), t as (  -- the seconds of an answered question: from the answer saved before it (the start for the first)
    select g.attempt_id, g.item_id,
           least(86400, greatest(0, pg_catalog.round(extract(epoch from g.answered_at - coalesce(
             pg_catalog.lag(g.answered_at) over (partition by g.attempt_id order by g.answered_at, g.ord), g.started_at)))))::integer
             as sec
      from g where g.answered
  ), ix as (  -- the questions in the exam's order; the cells point into this list
    select i.id, (pg_catalog.row_number() over (order by cs.position, cs.created_at, i.position, i.id) - 1)::integer as k
      from public.test_items i
      join public.container_subjects cs on cs.id = i.subject_id
     where i.id in (select g.item_id from g)
  )
  select pg_catalog.jsonb_build_object(
    'quiz_id', v_q.id, 'server_now', pg_catalog.now(),
    'items', coalesce((select pg_catalog.jsonb_agg(ix.id order by ix.k) from ix), '[]'::jsonb),
    'attempts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', a.id,
        'person', pg_catalog.left(pg_catalog.md5(coalesce(a.user_id::text, a.guest_hash) || v_q.id::text), 16),
        'n', a.n, 'guest', a.guest_hash is not null,
        'member', a.user_id is not null and coalesce(meldy_private.role_in(a.user_id, v_q.container_id) = 'member', false),
        'sent', a.user_id is not null
                and exists (select 1 from public.test_answers x
                             where x.user_id = a.user_id
                               and x.client_event_id like 'qz:' || pg_catalog.replace(a.id::text, '-', '') || ':%'),
        'started_at', a.started_at, 'finished_at', a.finished_at,
        'cells', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
                                    ix.k, case when g.pending then null else g.credit end, t.sec) order by g.ord)
                             from g
                             join ix on ix.id = g.item_id
                             left join t on t.attempt_id = g.attempt_id and t.item_id = g.item_id
                            where g.attempt_id = a.id), '[]'::jsonb))
        order by a.started_at, a.id) from a), '[]'::jsonb),
    'others', coalesce((select pg_catalog.jsonb_agg(o.j order by o.created_at desc, o.id) from (
        select q2.created_at, q2.id, pg_catalog.jsonb_build_object(
                 'id', q2.id, 'title', q2.title, 'created_at', q2.created_at,
                 'closed', meldy_private.quiz_state(q2) = 'closed',
                 'attempts', (select pg_catalog.count(*) from public.quiz_attempts t2
                               where t2.quiz_id = q2.id and t2.finished_at is not null
                                 and t2.user_id is distinct from q2.owner_id),
                 'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(ix.k, s.shown, s.credit) order by ix.k)
                                      from (select g2.item_id, pg_catalog.count(*) as shown,
                                                   pg_catalog.trim_scale(pg_catalog.sum(g2.credit)) as credit
                                              from public.quiz_attempts t2
                                             cross join lateral meldy_private.quiz_graded(null, t2.id) g2
                                             where t2.quiz_id = q2.id and t2.finished_at is not null
                                               and t2.user_id is distinct from q2.owner_id and not g2.pending
                                             group by g2.item_id) s
                                      join ix on ix.id = s.item_id), '[]'::jsonb)) as j
          from public.quizzes q2
         where q2.container_id = v_q.container_id and q2.id <> v_q.id
         order by q2.created_at desc, q2.id
         limit 10) o), '[]'::jsonb))
    into v_out;
  return v_out;
end;
$fn$;
comment on function public.quiz_analysis(uuid) is 'Quiz statistics (the author): finished attempts of others with their cells [question index, credit or null, seconds or null], member and sent; the questions; up to 10 other quizzes of the exam with their per-question shown and credit.';

-- 2. The participants' mistakes into their training, by the author.
create or replace function public.quiz_send_mistakes(p_quiz_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_a record;
  v_answers jsonb;
  v_res jsonb;
  v_saved integer;
  v_dup integer;
  v_people integer := 0;  -- people with at least one mistake recorded now
  v_count integer := 0;   -- the mistakes recorded now
  v_again integer := 0;   -- people whose mistakes were all recorded before
  v_clean integer := 0;   -- people without a mistake
  v_outside integer := 0; -- accounts not in the exam now (they get nothing)
  v_guests integer;
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
  for v_a in
    select distinct on (t.user_id) t.id, t.user_id
      from public.quiz_attempts t
     where t.quiz_id = v_q.id and t.finished_at is not null and t.user_id is not null and t.user_id <> v_q.owner_id
     order by t.user_id, t.n desc
  loop
    if meldy_private.role_in(v_a.user_id, v_q.container_id) is distinct from 'member' then
      v_outside := v_outside + 1;
      continue;
    end if;
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'client_event_id', 'qz:' || pg_catalog.replace(v_a.id::text, '-', '') || ':' || pg_catalog.replace(g.item_id::text, '-', ''),
             'item_id', g.item_id, 'mode', 'learn')
             || coalesce(meldy_private.quiz_answer_json(i.kind, g.chosen, g.typed),
                         case when i.kind in ('short', 'number') then '{"text": null}'::jsonb
                              when i.kind = 'cloze' then '{"texts": null}'::jsonb
                              else '{"chosen": null}'::jsonb end)
             order by g.ord)
      into v_answers
      from meldy_private.quiz_graded(null, v_a.id) g
      join public.test_items i on i.id = g.item_id
     where i.kind <> 'essay' and i.keyed and (not g.answered or g.credit < 1);
    if v_answers is null then
      v_clean := v_clean + 1;
      continue;
    end if;
    v_res := meldy_private.record_test_answers_for(v_a.user_id, v_answers, 'web', 200, 'learn');
    select pg_catalog.count(*) filter (where r ->> 'status' in ('saved', 'late')),
           pg_catalog.count(*) filter (where r ->> 'status' = 'duplicate')
      into v_saved, v_dup
      from pg_catalog.jsonb_array_elements(v_res -> 'results') r;
    if v_saved > 0 then
      v_people := v_people + 1;
      v_count := v_count + v_saved;
    elsif v_dup > 0 then
      v_again := v_again + 1;
    end if;
  end loop;
  select pg_catalog.count(distinct t.guest_hash)::integer into v_guests
    from public.quiz_attempts t
   where t.quiz_id = v_q.id and t.finished_at is not null and t.guest_hash is not null;
  return pg_catalog.jsonb_build_object('people', v_people, 'answers', v_count, 'again', v_again, 'clean', v_clean,
                                       'outside', v_outside, 'guests', v_guests, 'practice', v_q.offer_practice);
end;
$fn$;
comment on function public.quiz_send_mistakes(uuid) is 'Quiz (the author): each member''s latest finished attempt''s mistakes into their training (record_test_answers_for, learn, client_event_id qz:<attempt>:<item>); idempotent → {people, answers, again, clean, outside, guests, practice}.';

-- 3. The share of right answers of each question of an exam or test, over its quizzes (the studio's canvas).
create or replace function public.test_item_percents(p_container_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.containers c where c.id = p_container_id and c.owner_id = v_user) then
    raise sqlstate 'PGRST' using
      message = '{"code":"P0002","message":"container not found","details":"container","hint":null}',
      detail = '{"status":404,"headers":{}}';
  end if;
  perform meldy_private.quiz_settle(q.id) from public.quizzes q where q.container_id = p_container_id;
  with t as materialized (
    select a.id
      from public.quizzes q
      join public.quiz_attempts a on a.quiz_id = q.id
     where q.container_id = p_container_id and a.finished_at is not null and a.user_id is distinct from q.owner_id
     order by a.finished_at desc
     limit 2000
  ), s as (
    select g.item_id, pg_catalog.count(*) as shown, pg_catalog.trim_scale(pg_catalog.sum(g.credit)) as credit
      from t cross join lateral meldy_private.quiz_graded(null, t.id) g
     where not g.pending
     group by g.item_id
  )
  select pg_catalog.jsonb_build_object(
           'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('item_id', s.item_id, 'shown', s.shown,
                                                                                          'credit', s.credit)
                                                        order by s.item_id) from s), '[]'::jsonb),
           'attempts', (select pg_catalog.count(*) from t))
    into v_out;
  return v_out;
end;
$fn$;
comment on function public.test_item_percents(uuid) is 'The author''s exam or test: per question, finished quiz attempts of others that got it (shown) and their credit, over the latest 2000 → {items: [{item_id, shown, credit}], attempts}.';

-- 4. Grants (re-runnable): the signed-in author only. PostgreSQL gives a new function to PUBLIC and Supabase to anon
--    and authenticated: taken back, then given to authenticated.
revoke all on function public.quiz_analysis(uuid), public.quiz_send_mistakes(uuid), public.test_item_percents(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.quiz_analysis(uuid), public.quiz_send_mistakes(uuid), public.test_item_percents(uuid)
  to authenticated;
