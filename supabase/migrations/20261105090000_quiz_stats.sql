-- quiz_stats (release 49, part B: the author's statistics of a «Контрольная», spec Test_Builder_Spec_2026-10-18 «Выпуск 49»)
-- Repo file: supabase/migrations/20261105090000_quiz_stats.sql. Base: 20261101090200_question_kinds_quiz.sql
-- (meldy_private.quiz_graded with credit and pending, quiz_answer_json), 20261101090100_question_kinds_grading.sql
-- (meldy_private.record_test_answers_for graded by grade_item) and the Telegram bot's T1 (bot.answered_since).
-- Why: quiz_results gives a question's share of right answers and its picks, but not who got which question right, so
-- the page could not say whether a question tells those who know from those who do not, how long people spend on it,
-- who should repeat what, or how this quiz went next to another one of the same test. And the author had no way to put
-- the participants' mistakes into their training: only a participant could, through «Тренироваться дальше» (and that
-- joins the exam without recording a mistake).
-- What this file adds or changes:
--   1. public.quiz_analysis(p_quiz_id): the quiz's finished attempts of others than the author — the latest ones up to
--      25 000 answers (their questions; `capped` says when older ones were left out) — each with its cells
--      [question index, credit 0..1 (null while an essay waits for its mark), seconds (null: no answer)] and with
--      «member» (an account in the exam now: its mistakes can go to training) and «sent» (they went already); the
--      questions as a list of ids the cells point into (the exam's order); and «others»: up to 10 other quizzes of the
--      same exam or test, named and counted only (nothing graded). Seconds of an answer: from the answer saved before
--      it in the attempt (the start for the first), by the server's time of the last save, at most a day. The page
--      computes the rest (discrimination, the trap option, the median time, «кому что повторить»):
--      frontend/src/lib/quizzes/analysis.ts.
--   2. public.quiz_compare(p_quiz_id, p_other): the one other quiz the author picked to compare with — per question
--      [item id, shown, credit] over its finished attempts of others, the latest up to 25 000 answers.
--   3. public.quiz_send_mistakes(p_quiz_id, p_after): a batch of people after the cursor p_after — at most 50,
--      fewer when 1500 mistakes or 4 seconds are reached (Supabase stops an authenticated statement at 8 s) — each one's
--      latest finished attempt: its questions answered wrong, in part or not at all (not essays) go into that person's
--      training through meldy_private.record_test_answers_for (mode learn, as the live game's «тренировать ошибки» does)
--      with client_event_id qz:<attempt>:<item> (hex), so a second press writes nothing; but not a question the person
--      has answered in training since the attempt (test_item_states.last_answer_at after its finish, unless that last
--      answer is one this function wrote: what was learned since stays learned). Only for people in the exam now (the
--      core takes no one else; the author never adds anyone). The rows written are relabelled at once: source 'quiz'
--      (not the person's own activity: bot.answered_since leaves them out, so the bot's K2 «Присылать план дальше?» is
--      not fooled) and local_date the day of the attempt (they are its answers; «answers_today» and the day's pace stay
--      the person's own). Guests have no training: counted
--      and said. → {people, answers, again, clean, learned, outside, guests, practice, next, left, total}; the page calls
--      again with p_after = next until next is null. The cursor is the person's hash as quiz_results gives it (16 hex,
--      the order of the batches), never an account id.
--   4. public.test_item_percents(p_container_id): per question of the author's exam or test, how many finished attempts
--      of others got it (shown) and their credit, over all its quizzes — the latest attempts up to 20 000 answers — the
--      studio's canvas shows «верно N %». → {items: [{item_id, shown, credit}], attempts, capped}.
--   5. public.test_answers.source takes 'quiz' too (the check widened and left NOT VALID: no scan under the lock; new
--      and changed rows are checked), and bot.answered_since skips source 'quiz'. Nothing else reads the source (checked 2026-11-05).
-- Errors (SQLSTATE): 28000 not signed in; P0002 as HTTP 404 (raise sqlstate 'PGRST', as quiz_results) detail quiz /
-- container: not the author's.
-- Check after the apply: supabase/tests/quiz_stats.sql (catalog only; read-only). Local rehearsal (never live):
-- supabase/tests/local/quiz_stats_telegram_run.sh (quiz_stats_behaviour.sql). Rollback:
-- supabase/rollback/20261105090000_quiz_stats_down.sql. Re-runnable: OR REPLACE, guarded blocks; the grants are set again.
set lock_timeout = '5s';

do $do$
begin
  if pg_catalog.to_regprocedure('meldy_private.quiz_graded(uuid, uuid)') is null
     or not exists (select 1 from pg_catalog.pg_proc p
                     where p.oid = pg_catalog.to_regprocedure('meldy_private.quiz_graded(uuid, uuid)')
                       and 'credit' = any (p.proargnames))
     or pg_catalog.to_regprocedure('meldy_private.record_test_answers_for(uuid, jsonb, text, integer, text, uuid)') is null
     or pg_catalog.to_regprocedure('meldy_private.quiz_answer_json(text, smallint[], text)') is null
     or pg_catalog.to_regprocedure('bot.answered_since(uuid, timestamptz)') is null then
    raise exception 'the base is expected: 20261101090200_question_kinds_quiz.sql and the Telegram bot (T1)';
  end if;
end;
$do$;

-- 0. The answers the author puts into training: their own source. The check is widened as NOT VALID and left so:
--    migrate.py runs the file as one transaction, so the DROP/ADD holds ACCESS EXCLUSIVE on test_answers to the end and
--    a VALIDATE here would scan the table under it. Unvalidated, it costs no scan and still checks every new or changed
--    row (the old rows were checked by the narrower check). A second apply finds it and changes nothing.
do $do$
begin
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'public.test_answers'::regclass and k.conname = 'test_answers_source_check'
                    and pg_catalog.pg_get_constraintdef(k.oid) like '%''quiz''%') then
    alter table public.test_answers drop constraint if exists test_answers_source_check;
    alter table public.test_answers add constraint test_answers_source_check
      check (source in ('web', 'bot', 'bot_group', 'quiz')) not valid;
  end if;
end;
$do$;

-- The bot's «answered since» (K2's silence, T1 2f): the author's sending is not the person answering.
create or replace function bot.answered_since(p_user uuid, p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (select 1 from public.test_answers a
                  where a.user_id = p_user and a.local_date >= (p_at at time zone 'utc')::date - 2
                    and a.created_at > p_at and a.source <> 'quiz')
$fn$;

-- 1. The author's analysis of one quiz.
create or replace function public.quiz_analysis(p_quiz_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_answers constant integer := 25000;
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
  with f as (  -- the finished attempts of others than the author, the latest first, with the answers before each
    select t.id, t.user_id, t.guest_hash, t.n, t.started_at, t.finished_at,
           pg_catalog.sum(pg_catalog.cardinality(t.item_ids)) over (order by t.finished_at desc, t.id) as upto
      from public.quiz_attempts t
     where t.quiz_id = v_q.id and t.finished_at is not null and t.user_id is distinct from v_q.owner_id
  ), a as materialized (
    select f.* from f where f.upto <= c_answers
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
    'capped', exists (select 1 from f where f.upto > c_answers),
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
    'others', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'id', q2.id, 'title', q2.title, 'created_at', q2.created_at,
                 'closed', meldy_private.quiz_state(q2) = 'closed',
                 'attempts', (select pg_catalog.count(*) from public.quiz_attempts t2
                               where t2.quiz_id = q2.id and t2.finished_at is not null
                                 and t2.user_id is distinct from q2.owner_id))
                 order by q2.created_at desc, q2.id)
          from (select q2.* from public.quizzes q2
                 where q2.container_id = v_q.container_id and q2.id <> v_q.id
                 order by q2.created_at desc, q2.id
                 limit 10) q2), '[]'::jsonb))
    into v_out;
  return v_out;
end;
$fn$;
comment on function public.quiz_analysis(uuid) is 'Quiz statistics (the author): finished attempts of others (the latest up to 25 000 answers) with their cells [question index, credit or null, seconds or null], member and sent; the questions; up to 10 other quizzes of the exam, named and counted.';

-- 2. The other quiz the author compares with.
create or replace function public.quiz_compare(p_quiz_id uuid, p_other uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_answers constant integer := 25000;
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_o public.quizzes%rowtype;
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select q.* into v_q from public.quizzes q
    join public.containers c on c.id = q.container_id
   where q.id = p_quiz_id and c.owner_id = v_user;
  if found then
    select q.* into v_o from public.quizzes q where q.id = p_other and q.container_id = v_q.container_id;
  end if;
  if v_q.id is null or v_o.id is null then
    raise sqlstate 'PGRST' using
      message = '{"code":"P0002","message":"quiz not found","details":"quiz","hint":null}',
      detail = '{"status":404,"headers":{}}';
  end if;
  perform meldy_private.quiz_settle(v_o.id);
  with f as (
    select t.id, pg_catalog.sum(pg_catalog.cardinality(t.item_ids)) over (order by t.finished_at desc, t.id) as upto
      from public.quiz_attempts t
     where t.quiz_id = v_o.id and t.finished_at is not null and t.user_id is distinct from v_o.owner_id
  ), s as (
    select g.item_id, pg_catalog.count(*) as shown, pg_catalog.trim_scale(pg_catalog.sum(g.credit)) as credit
      from f cross join lateral meldy_private.quiz_graded(null, f.id) g
     where f.upto <= c_answers and not g.pending
     group by g.item_id
  )
  select pg_catalog.jsonb_build_object(
           'id', v_o.id, 'title', v_o.title,
           'attempts', (select pg_catalog.count(*) from f),
           'capped', exists (select 1 from f where f.upto > c_answers),
           'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(s.item_id, s.shown, s.credit) order by s.item_id)
                                from s), '[]'::jsonb))
    into v_out;
  return v_out;
end;
$fn$;
comment on function public.quiz_compare(uuid, uuid) is 'Quiz statistics (the author): another quiz of the same exam per question [item id, shown, credit] over its finished attempts of others (the latest up to 25 000 answers).';

-- 3. The participants' mistakes into their training, by the author, a batch at a time.
drop function if exists public.quiz_send_mistakes(uuid);
drop function if exists public.quiz_send_mistakes(uuid, uuid);
create or replace function public.quiz_send_mistakes(p_quiz_id uuid, p_after text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_people constant integer := 50;
  c_answers constant integer := 1500;
  c_time constant interval := interval '4 seconds';
  v_start timestamptz := pg_catalog.clock_timestamp();
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_a record;
  v_answers jsonb;
  v_res jsonb;
  v_saved text[];
  v_dup integer;
  v_learned integer;
  v_done integer := 0;     -- people looked at in this call
  v_people integer := 0;   -- people with at least one mistake recorded now
  v_count integer := 0;    -- the mistakes recorded now
  v_again integer := 0;    -- people whose mistakes were all recorded before
  v_clean integer := 0;    -- people without a mistake left to send
  v_skipped integer := 0;  -- mistakes not sent: answered in training since the attempt
  v_outside integer := 0;  -- accounts not in the exam now (they get nothing)
  v_last text;             -- the cursor: the last person looked at (their hash, as quiz_results' «person»)
  v_left integer;
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
  if p_after is not null and p_after !~ '^[0-9a-f]{16}$' then
    raise exception 'invalid cursor' using errcode = '22023', detail = 'after';
  end if;
  if p_after is null then
    perform meldy_private.quiz_settle(v_q.id);
  end if;
  for v_a in
    select p.* from (
      select distinct on (t.user_id) t.id, t.user_id, t.finished_at,
             pg_catalog.left(pg_catalog.md5(t.user_id::text || v_q.id::text), 16) as person
        from public.quiz_attempts t
       where t.quiz_id = v_q.id and t.finished_at is not null and t.user_id is not null and t.user_id <> v_q.owner_id
       order by t.user_id, t.n desc) p
     where p_after is null or p.person collate "C" > p_after collate "C"
     order by p.person collate "C"
  loop
    exit when v_done >= c_people or v_count >= c_answers or pg_catalog.clock_timestamp() - v_start > c_time;
    v_done := v_done + 1;
    v_last := v_a.person;
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
             order by g.ord) filter (where not g.since),
           pg_catalog.count(*) filter (where g.since)
      into v_answers, v_learned
      from (select g.*,
                   -- answered in training after the attempt: the state's last answer is later than the finish and is
                   -- not one this function wrote (a second press must not take its own sending for learning)
                   coalesce(s.last_answer_at > v_a.finished_at
                            and not exists (select 1 from public.test_answers x
                                             where x.item_id = g.item_id and x.user_id = v_a.user_id and x.source = 'quiz'
                                               and x.created_at >= s.last_answer_at), false) as since
              from meldy_private.quiz_graded(null, v_a.id) g
              left join public.test_item_states s on s.user_id = v_a.user_id and s.item_id = g.item_id) g
      join public.test_items i on i.id = g.item_id
     where i.kind <> 'essay' and i.keyed and (not g.answered or g.credit < 1);
    v_skipped := v_skipped + coalesce(v_learned, 0);
    if v_answers is null then
      v_clean := v_clean + 1;
      continue;
    end if;
    v_res := meldy_private.record_test_answers_for(v_a.user_id, v_answers, 'web', 200, 'learn');
    select coalesce(pg_catalog.array_agg(r ->> 'client_event_id') filter (where r ->> 'status' in ('saved', 'late')), '{}'),
           pg_catalog.count(*) filter (where r ->> 'status' = 'duplicate')
      into v_saved, v_dup
      from pg_catalog.jsonb_array_elements(v_res -> 'results') r;
    if pg_catalog.cardinality(v_saved) > 0 then
      -- The author's sending, not the person's answering: its own source, on the day of the attempt.
      update public.test_answers x
         set source = 'quiz', local_date = (v_a.finished_at at time zone 'utc')::date
       where x.user_id = v_a.user_id and x.client_event_id = any (v_saved);
      v_people := v_people + 1;
      v_count := v_count + pg_catalog.cardinality(v_saved);
    elsif v_dup > 0 then
      v_again := v_again + 1;
    end if;
  end loop;
  -- the people after the last one looked at (none looked at: nobody is left)
  v_left := case when v_last is null then 0
                 else (select pg_catalog.count(*)::integer
                         from (select distinct t.user_id from public.quiz_attempts t
                                where t.quiz_id = v_q.id and t.finished_at is not null and t.user_id is not null
                                  and t.user_id <> v_q.owner_id) u
                        where pg_catalog.left(pg_catalog.md5(u.user_id::text || v_q.id::text), 16) collate "C" > v_last collate "C") end;
  return pg_catalog.jsonb_build_object(
    'people', v_people, 'answers', v_count, 'again', v_again, 'clean', v_clean, 'learned', v_skipped,
    'outside', v_outside, 'practice', v_q.offer_practice,
    'guests', (select pg_catalog.count(distinct t.guest_hash)::integer from public.quiz_attempts t
                where t.quiz_id = v_q.id and t.finished_at is not null and t.guest_hash is not null),
    'total', (select pg_catalog.count(distinct t.user_id)::integer from public.quiz_attempts t
               where t.quiz_id = v_q.id and t.finished_at is not null and t.user_id is not null and t.user_id <> v_q.owner_id),
    'left', v_left,
    'next', case when v_left > 0 then v_last end);
end;
$fn$;
comment on function public.quiz_send_mistakes(uuid, text) is 'Quiz (the author): a batch (≤ 50 people, ≤ 1500 mistakes, ≤ 4 s) after the cursor p_after (a person''s hash, never an account id): each member''s latest finished attempt''s mistakes not answered in training since, into their training (record_test_answers_for, learn, qz:<attempt>:<item>, then source quiz on the attempt''s day); idempotent → {people, answers, again, clean, learned, outside, guests, practice, total, left, next}.';

-- 4. The share of right answers of each question of an exam or test, over its quizzes (the studio's canvas).
create or replace function public.test_item_percents(p_container_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_answers constant integer := 20000;
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
  with f as materialized (  -- the latest finished attempts of others, with the answers up to each
    select a.id, pg_catalog.sum(pg_catalog.cardinality(a.item_ids)) over (order by a.finished_at desc, a.id) as upto
      from public.quizzes q
      join public.quiz_attempts a on a.quiz_id = q.id
     where q.container_id = p_container_id and a.finished_at is not null and a.user_id is distinct from q.owner_id
  ), t as (
    select f.id from f where f.upto <= c_answers
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
           'attempts', (select pg_catalog.count(*) from t),
           'capped', exists (select 1 from f where f.upto > c_answers))
    into v_out;
  return v_out;
end;
$fn$;
comment on function public.test_item_percents(uuid) is 'The author''s exam or test: per question, finished quiz attempts of others that got it (shown) and their credit, the latest up to 20 000 answers → {items: [{item_id, shown, credit}], attempts, capped}.';

-- 5. Grants (re-runnable): the signed-in author only. PostgreSQL gives a new function to PUBLIC and Supabase to anon
--    and authenticated: taken back, then given to authenticated.
revoke all on function public.quiz_analysis(uuid), public.quiz_compare(uuid, uuid), public.quiz_send_mistakes(uuid, text),
  public.test_item_percents(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.quiz_analysis(uuid), public.quiz_compare(uuid, uuid), public.quiz_send_mistakes(uuid, text),
  public.test_item_percents(uuid)
  to authenticated;
