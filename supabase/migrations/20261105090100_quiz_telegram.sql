-- quiz_telegram (release 49, part B: «Telegram: автору — «Иванов сдал: 17 из 20» и итог по закрытию; ссылку на
-- контрольную — в группу одной кнопкой», spec Test_Builder_Spec_2026-10-18 «Выпуск 49»)
-- Repo file: supabase/migrations/20261105090100_quiz_telegram.sql. Base: the Telegram bot (20261010120000_telegram_bot.sql:
-- bot.links, bot.deliveries and its sending / done / retry; 20261010120004_telegram_bot_groups.sql: bot.groups) and
-- the quizzes (20261020120000_quiz_protection.sql quiz_settle, 20261101090200_question_kinds_quiz.sql quiz_graded).
-- What it adds (nothing existing changes; no trigger on a quiz table: the bot's minute tick looks for new finishes):
--   1. bot.quiz_watch: the author's choice per quiz — each (a message a finish, at most 3 in 10 minutes, then a digest
--      at most every 10 minutes), digest (one message at most an hour, from 10 minutes after the first finish), off
--      (the default: nothing new is switched on by itself, spec «Принципы»; on only with a linked Telegram). `since`:
--      finishes from here are told (no flood of old ones when it is switched on). `closed_at`: the close summary was
--      queued; cleared when the quiz is open again (a later close gets its own summary). `checked_at`: the tick looks at
--      the watches it saw longest ago first.
--   2. bot.quiz_notices: a finish to tell (kind done, one per attempt, its score kept as it was graded when noted) or a
--      close (kind close, one per quiz and close time, its summary kept as computed once when queued), and the delivery
--      that told it. bot.quiz_sends: per bot.deliveries row of a quiz (kind notice, ref qz:/qd:/qc:/qs: and hex ids)
--      its quiz, its kind (one, digest, close, share), when it was made and when the tick was last handed it.
--   3. For the signed-in author: public.telegram_quiz_state(p_quiz_id) → {linked, blocked, notice, groups: [{chat_id,
--      title, shared_at}]} (the group chats bound to the quiz's exam where the bot still is);
--      public.telegram_quiz_notice(p_quiz_id, p_mode) → the state after the change (off drops what waits; each or
--      digest without a linked Telegram: 22023 detail link);
--      public.telegram_quiz_share(p_quiz_id, p_chat_id) → {status: queued | already | closed | no_group | no_link,
--      title}: the quiz's link into a bound group chat, once a day per chat, sent by the next tick.
--   4. For the bot (service role): public.bot_quiz_notices(p_limit, p_now) → {rows: [...], errors}. Its work is bounded
--      (the bot's call times out at 10 s): at most 50 watches a call (with an active, unblocked link, recently active
--      or closing, the longest unseen first), at most 200 new finishes noted a quiz, at most one close summary computed
--      a call (graded over the latest finishes up to 10 000 answers), and no new work after 3 s; each quiz and each row
--      in its own subtransaction, so one that fails never stops the rest (it is counted in `errors`). Steps:
--      a. the watches: a quiz open again is watched again; settled; its new finishes of others (of the last 3 days)
--         noted with their score;
--         the close summary computed and kept once when it has closed (within 3 days of the close);
--      b. the claimed quiz deliveries not handed in the last minute (a share the site queued, a 429 put back, a tick
--         that died) come again under the same rules as new ones; what can never go is closed first (the author's
--         link off or blocked, made more than 3 days ago — skipped; out of tries, a share to a group no longer bound —
--         failed: never left claimed for good), and only rows that may go now are taken (not a message to the author
--         while the link is paused or between 22:00 and 08:00 in its zone), so waiting rows hold back none behind them;
--      c. new ones under the author's rules: the close summary first (it takes the finishes that wait), each finish or
--         a digest as chosen, the same hours and pause. Waiting notices older than 3 days are dropped.
--      Each row carries what the message says, read from what was kept (no grading on a hand-out): one — the name and
--      score; digest — up to 30 names and scores, how many, how many finished in all; close — the kept summary (people,
--      the average percent, how many passed, the three hardest questions, `sample` when it was graded over the latest
--      finishes only); share — the code, the deadline, the count, the timer. The bot sends them through
--      bot_delivery_sending → sendMessage → bot_delivery_done (at most once, as T1).
-- Errors of the site functions (SQLSTATE): 28000 not signed in; P0002 as HTTP 404 (raise sqlstate 'PGRST') detail quiz:
-- not the author's; 22023 detail mode: an unknown mode, detail link: notices without a linked Telegram. Bot function:
-- 42501 not the service role, 22023 a bad limit.
-- Check after the apply: supabase/tests/quiz_telegram.sql (catalog only; read-only). Local rehearsal (never live):
-- supabase/tests/local/quiz_stats_telegram_run.sh (quiz_telegram_behaviour.sql). Rollback:
-- supabase/rollback/20261105090100_quiz_telegram_down.sql. Release order: this file, then the telegram function with
-- quiz.ts (until then nothing is sent; the author's choice is kept), then the site. Re-runnable: IF NOT EXISTS, OR
-- REPLACE; the grants are set again.
set lock_timeout = '5s';

do $do$
begin
  if pg_catalog.to_regclass('bot.deliveries') is null or pg_catalog.to_regclass('bot.groups') is null
     or pg_catalog.to_regprocedure('meldy_private.quiz_settle(uuid)') is null
     or pg_catalog.to_regprocedure('meldy_private.quiz_graded(uuid, uuid)') is null then
    raise exception 'the base is expected: the Telegram bot (T1, T8) and 20261101090200_question_kinds_quiz.sql';
  end if;
end;
$do$;

-- 1. Tables (row security on, no policy, no grant: only the functions below reach them).
create table if not exists bot.quiz_watch (
  quiz_id uuid primary key references public.quizzes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'off',
  since timestamptz not null default now(),
  closed_at timestamptz,
  checked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint quiz_watch_mode_check check (mode in ('each', 'digest', 'off'))
);
create index if not exists quiz_watch_owner_idx on bot.quiz_watch (owner_id);
comment on table bot.quiz_watch is 'Telegram notices of a quiz for its author: each | digest | off; since (finishes told from), closed_at (the close summary queued; cleared on a reopen), checked_at (the tick''s round).';

create table if not exists bot.quiz_sends (
  delivery_id bigint primary key references bot.deliveries(id) on delete cascade,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  kind text not null,
  made_at timestamptz not null default now(),
  handed_at timestamptz,
  constraint quiz_sends_kind_check check (kind in ('one', 'digest', 'close', 'share'))
);
create index if not exists quiz_sends_quiz_idx on bot.quiz_sends (quiz_id, kind);
comment on table bot.quiz_sends is 'The bot.deliveries rows of quizzes (kind notice, ref qz:/qd:/qc:/qs:): their quiz, kind, when made (the pace of the next) and when the tick was last handed them.';

create table if not exists bot.quiz_notices (
  id bigint generated always as identity primary key,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  attempt_id uuid references public.quiz_attempts(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now(),
  score numeric,
  max_score numeric,
  close_at timestamptz,
  summary jsonb,
  delivery_id bigint references bot.deliveries(id) on delete set null,
  handled_at timestamptz,
  constraint quiz_notices_kind_check check (kind in ('done', 'close')),
  constraint quiz_notices_attempt_check check ((kind = 'done') = (attempt_id is not null)),
  constraint quiz_notices_close_check check ((kind = 'close') = (close_at is not null and summary is not null))
);
create unique index if not exists quiz_notices_done_key on bot.quiz_notices (attempt_id) where kind = 'done';
create unique index if not exists quiz_notices_close_key on bot.quiz_notices (quiz_id, close_at) where kind = 'close';
create index if not exists quiz_notices_open_idx on bot.quiz_notices (quiz_id) where handled_at is null;
create index if not exists quiz_notices_delivery_idx on bot.quiz_notices (delivery_id);
comment on table bot.quiz_notices is 'A quiz finish (done, one per attempt, its score kept) or close (one per quiz and close time, its summary kept) to tell its author in Telegram, and the delivery that told it.';

alter table bot.quiz_watch enable row level security;
alter table bot.quiz_sends enable row level security;
alter table bot.quiz_notices enable row level security;

-- 2. Private helpers.
-- 2a. An attempt's score as quiz_results counts it: the weights of a quiz «как в студии», credit for the rest.
create or replace function meldy_private.quiz_score(p_attempt uuid)
returns table (score numeric, max_score numeric)
language sql
stable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.trim_scale(pg_catalog.round(pg_catalog.sum(coalesce(a.item_points[g.ord], 1) * g.credit), 2)), 0),
         coalesce(pg_catalog.sum(coalesce(a.item_points[g.ord], 1)), 0)
    from public.quiz_attempts a
   cross join lateral meldy_private.quiz_graded(null, a.id) g
   where a.id = p_attempt
$fn$;

-- 2b. The author's Telegram state of a quiz.
create or replace function meldy_private.quiz_tg_state(p_q public.quizzes, p_user uuid)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'linked', l.id is not null,
    'blocked', l.blocked_at is not null,
    'notice', coalesce((select w.mode from bot.quiz_watch w where w.quiz_id = p_q.id), 'off'),
    'groups', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                          'chat_id', g.chat_id, 'title', g.title,
                          'shared_at', (select pg_catalog.max(coalesce(d.sent_at, d.claimed_at))
                                          from bot.quiz_sends s join bot.deliveries d on d.id = s.delivery_id
                                         where s.quiz_id = p_q.id and s.kind = 'share' and d.chat_id = g.chat_id
                                           and d.status in ('claimed', 'sending', 'sent')))
                          order by g.bound_at, g.chat_id)
                          from bot.groups g
                         where g.container_id = p_q.container_id and g.left_at is null), '[]'::jsonb))
    from (select 1) one
    left join bot.links l on l.user_id = p_user and l.unlinked_at is null
$fn$;

-- 2c. The author's quiz (the 404 of the quiz functions otherwise).
create or replace function meldy_private.quiz_of_author(p_quiz uuid, p_user uuid)
returns public.quizzes
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_q public.quizzes%rowtype;
begin
  if p_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select q.* into v_q from public.quizzes q
    join public.containers c on c.id = q.container_id
   where q.id = p_quiz and c.owner_id = p_user;
  if not found then
    raise sqlstate 'PGRST' using
      message = '{"code":"P0002","message":"quiz not found","details":"quiz","hint":null}',
      detail = '{"status":404,"headers":{}}';
  end if;
  return v_q;
end;
$fn$;

-- 2d. The close summary, computed once when the close is queued: the people (every finish of others, by account or
--     device), and graded over the latest finishes up to 10 000 answers (`sample`: how many people those are, when that
--     left some out) — the average percent of each person's counted attempt (best or last, as the quiz grades), how many
--     reached the pass mark, the three hardest questions answered 3 times or more (their number in the file, else the
--     position).
create or replace function meldy_private.quiz_close_summary(p_q public.quizzes)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  with f as (
    select a.id, coalesce(a.user_id::text, a.guest_hash) as who, a.n, a.item_points,
           pg_catalog.sum(pg_catalog.cardinality(a.item_ids)) over (order by a.finished_at desc, a.id) as upto
      from public.quiz_attempts a
     where a.quiz_id = p_q.id and a.finished_at is not null and a.user_id is distinct from p_q.owner_id
  ), s as materialized (
    select f.* from f where f.upto <= 10000
  ), g as materialized (
    select s.id, s.who, s.n, g.item_id, g.credit, g.pending, coalesce(s.item_points[g.ord], 1) as weight
      from s cross join lateral meldy_private.quiz_graded(null, s.id) g
  ), per as (
    select g.id, g.who, g.n,
           case when pg_catalog.sum(g.weight) > 0 then 100 * pg_catalog.sum(g.weight * g.credit) / pg_catalog.sum(g.weight) end as pct
      from g group by g.id, g.who, g.n
  ), pick as (
    select distinct on (per.who) per.who, per.pct
      from per
     order by per.who, case when p_q.grading = 'last' then per.n end desc nulls last, per.pct desc nulls last, per.n desc
  ), hard as (
    select g.item_id, pg_catalog.count(*) as shown, pg_catalog.sum(g.credit) as credit
      from g where not g.pending
     group by g.item_id
    having pg_catalog.count(*) >= 3
     order by pg_catalog.sum(g.credit) / pg_catalog.count(*), g.item_id
     limit 3
  )
  select pg_catalog.jsonb_build_object(
           'people', (select pg_catalog.count(distinct f.who) from f),
           'avg_percent', (select pg_catalog.round(pg_catalog.avg(pick.pct)) from pick),
           'passed', case when p_q.pass_percent is null then null
                          else (select pg_catalog.count(*) from pick where pick.pct >= p_q.pass_percent) end,
           'sample', case when exists (select 1 from f where f.upto > 10000) then (select pg_catalog.count(*) from pick) end,
           'hardest', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                         'no', coalesce(nullif(i.file_no, ''), i.position::text),
                                         'percent', pg_catalog.round(100 * hard.credit / hard.shown))
                                       order by hard.credit / hard.shown, i.position)
                                  from hard join public.test_items i on i.id = hard.item_id), '[]'::jsonb))
$fn$;

-- 2e. What a quiz delivery says (bot_quiz_notices' row), from what was kept: no grading on a hand-out.
create or replace function meldy_private.quiz_tg_row(p_delivery bigint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_s bot.quiz_sends%rowtype;
  v_d bot.deliveries%rowtype;
  v_q public.quizzes%rowtype;
  v_out jsonb;
  v_a record;
begin
  select s.* into v_s from bot.quiz_sends s where s.delivery_id = p_delivery;
  select d.* into v_d from bot.deliveries d where d.id = p_delivery;
  select q.* into v_q from public.quizzes q where q.id = v_s.quiz_id;
  v_out := pg_catalog.jsonb_build_object('delivery_id', v_d.id, 'chat_id', v_d.chat_id, 'kind', v_s.kind,
                                         'quiz_id', v_q.id, 'container_id', v_q.container_id, 'title', v_q.title,
                                         'pass_percent', v_q.pass_percent);
  if v_s.kind = 'one' then
    select a.name, n.score, n.max_score into v_a
      from bot.quiz_notices n
      left join public.quiz_attempts a on a.id = n.attempt_id
     where n.delivery_id = p_delivery and n.kind = 'done'
     limit 1;
    return v_out || pg_catalog.jsonb_build_object('name', v_a.name, 'score', coalesce(v_a.score, 0), 'max', coalesce(v_a.max_score, 0));
  elsif v_s.kind = 'digest' then
    return v_out || pg_catalog.jsonb_build_object(
      'people', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', x.name, 'score', x.score, 'max', x.max_score)
                                                      order by x.finished_at, x.id)
                            from (select a.id, a.name, a.finished_at, coalesce(n.score, 0) as score, coalesce(n.max_score, 0) as max_score
                                    from bot.quiz_notices n
                                    join public.quiz_attempts a on a.id = n.attempt_id
                                   where n.delivery_id = p_delivery and n.kind = 'done'
                                   order by a.finished_at, a.id
                                   limit 30) x), '[]'::jsonb),
      'count', (select pg_catalog.count(*) from bot.quiz_notices n where n.delivery_id = p_delivery and n.kind = 'done'),
      'done', (select pg_catalog.count(*) from public.quiz_attempts a
                where a.quiz_id = v_q.id and a.finished_at is not null and a.user_id is distinct from v_q.owner_id));
  elsif v_s.kind = 'close' then
    return v_out || coalesce((select n.summary from bot.quiz_notices n
                               where n.delivery_id = p_delivery and n.kind = 'close'
                               order by n.close_at desc limit 1),
                             '{"people": 0, "avg_percent": null, "passed": null, "sample": null, "hardest": []}'::jsonb);
  end if;
  -- share
  return v_out || pg_catalog.jsonb_build_object(
    'code', v_q.code, 'closes_at', v_q.closes_at, 'item_count', v_q.item_count, 'time_limit_s', v_q.time_limit_s,
    'guests', v_q.guests,
    'tz', coalesce((select g.tz from bot.groups g where g.chat_id = v_d.chat_id), 'Europe/Minsk'),
    'chat_title', (select g.title from bot.groups g where g.chat_id = v_d.chat_id));
end;
$fn$;

-- 3. The site (the signed-in author).
create or replace function public.telegram_quiz_state(p_quiz_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
begin
  v_q := meldy_private.quiz_of_author(p_quiz_id, v_user);
  return meldy_private.quiz_tg_state(v_q, v_user);
end;
$fn$;
comment on function public.telegram_quiz_state(uuid) is 'Quiz (the author): {linked, blocked, notice each|digest|off, groups: [{chat_id, title, shared_at}]} — the Telegram side of the results page.';

create or replace function public.telegram_quiz_notice(p_quiz_id uuid, p_mode text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_now timestamptz := pg_catalog.now();
begin
  v_q := meldy_private.quiz_of_author(p_quiz_id, v_user);
  if p_mode is null or p_mode not in ('each', 'digest', 'off') then
    raise exception 'invalid mode' using errcode = '22023', detail = 'mode';
  end if;
  -- Notices go to the author's Telegram: switched on only with one linked (the page offers «Подключить Telegram»).
  if p_mode <> 'off' and not exists (select 1 from bot.links l where l.user_id = v_user and l.unlinked_at is null) then
    raise exception 'telegram not linked' using errcode = '22023', detail = 'link';
  end if;
  insert into bot.quiz_watch as w (quiz_id, owner_id, mode, since, updated_at)
  values (v_q.id, v_user, p_mode, v_now, v_now)
  on conflict (quiz_id) do update
    set mode = excluded.mode,
        since = case when w.mode = 'off' and excluded.mode <> 'off' then v_now else w.since end,
        updated_at = v_now;
  if p_mode = 'off' then
    update bot.quiz_notices n set handled_at = v_now where n.quiz_id = v_q.id and n.handled_at is null;
  end if;
  return meldy_private.quiz_tg_state(v_q, v_user);
end;
$fn$;
comment on function public.telegram_quiz_notice(uuid, text) is 'Quiz (the author): Telegram notices each | digest | off (off drops what waits; on only with a linked Telegram) → the state.';

create or replace function public.telegram_quiz_share(p_quiz_id uuid, p_chat_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_q public.quizzes%rowtype;
  v_g bot.groups%rowtype;
  v_l bot.links%rowtype;
  v_id bigint;
begin
  v_q := meldy_private.quiz_of_author(p_quiz_id, v_user);
  if meldy_private.quiz_state(v_q) = 'closed' then
    return pg_catalog.jsonb_build_object('status', 'closed');
  end if;
  select g.* into v_g from bot.groups g
   where g.chat_id = p_chat_id and g.container_id = v_q.container_id and g.left_at is null;
  if v_g.chat_id is null then
    return pg_catalog.jsonb_build_object('status', 'no_group');
  end if;
  select l.* into v_l from bot.links l where l.user_id = v_user and l.unlinked_at is null and l.blocked_at is null;
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'no_link');
  end if;
  insert into bot.deliveries (kind, chat_id, link_id, local_day, ref)
  values ('notice', v_g.chat_id, v_l.id, (pg_catalog.now() at time zone v_g.tz)::date,
          'qs:' || pg_catalog.replace(v_q.id::text, '-', ''))
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return pg_catalog.jsonb_build_object('status', 'already', 'title', v_g.title);
  end if;
  insert into bot.quiz_sends (delivery_id, quiz_id, kind) values (v_id, v_q.id, 'share');
  return pg_catalog.jsonb_build_object('status', 'queued', 'title', v_g.title);
end;
$fn$;
comment on function public.telegram_quiz_share(uuid, bigint) is 'Quiz (the author): its link into a group chat bound to the exam, once a day per chat, sent by the next tick → {status queued|already|closed|no_group|no_link, title}.';

-- 4. The bot (service role).
create or replace function public.bot_quiz_notices(p_limit integer default 20, p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_watch constant integer := 50;       -- watches looked at a call
  c_finishes constant integer := 200;   -- new finishes noted a quiz a call
  c_time constant interval := interval '3 seconds';  -- no new work after this (the bot's call times out at 10 s)
  v_start timestamptz := pg_catalog.clock_timestamp();
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_out jsonb[] := '{}';
  v_errors integer := 0;
  v_summaries integer := 0;
  v_w record;
  v_s record;
  v_q public.quizzes%rowtype;
  v_local timestamp;
  v_close integer;
  v_close_at timestamptz;
  v_pending integer;
  v_oldest timestamptz;
  v_last timestamptz;
  v_recent integer;
  v_kind text;
  v_ref text;
  v_id bigint;
  v_hex text;
  v_row jsonb;
begin
  perform meldy_private.require_service_role();
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;

  -- a. The watches of linked authors: recently active, closing, or open again after a close; the longest unseen first.
  for v_w in
    select w.quiz_id, w.owner_id, w.since, w.closed_at
      from bot.quiz_watch w
      join public.quizzes q on q.id = w.quiz_id
     where w.mode <> 'off'
       and exists (select 1 from bot.links l where l.user_id = w.owner_id and l.unlinked_at is null and l.blocked_at is null)
       and case when w.closed_at is not null then meldy_private.quiz_state(q) <> 'closed'
                else q.closed_at is not null or (q.closes_at is not null and q.closes_at <= v_now + interval '1 minute')
                     or exists (select 1 from public.quiz_attempts a
                                 where a.quiz_id = q.id and (a.finished_at is null or a.started_at > v_now - interval '2 days')) end
     order by w.checked_at nulls first, w.quiz_id
     limit c_watch
  loop
    exit when pg_catalog.clock_timestamp() - v_start > c_time;
    begin
      update bot.quiz_watch w set checked_at = v_now, closed_at = null where w.quiz_id = v_w.quiz_id;
      perform meldy_private.quiz_settle(v_w.quiz_id);
      insert into bot.quiz_notices (quiz_id, attempt_id, kind, created_at, score, max_score)
      select x.quiz_id, x.id, 'done', v_now, sc.score, sc.max_score
        from (select a.quiz_id, a.id
                from public.quiz_attempts a
               where a.quiz_id = v_w.quiz_id and a.finished_at is not null and a.finished_at >= v_w.since
                 and a.finished_at > v_now - interval '3 days' and a.user_id is distinct from v_w.owner_id
                 and not exists (select 1 from bot.quiz_notices n where n.attempt_id = a.id and n.kind = 'done')
               order by a.finished_at, a.id
               limit c_finishes) x
       cross join lateral meldy_private.quiz_score(x.id) sc
      on conflict do nothing;
      select q.* into v_q from public.quizzes q where q.id = v_w.quiz_id;
      if meldy_private.quiz_state(v_q) = 'closed' then
        v_close_at := coalesce(v_q.closed_at, v_q.closes_at);
        if v_close_at <= v_now - interval '3 days' then
          update bot.quiz_watch w set closed_at = v_now where w.quiz_id = v_q.id;  -- long closed: no summary
        elsif v_summaries = 0 then
          -- the summary once, now, and kept: at most one a call (the rest wait for the next)
          insert into bot.quiz_notices (quiz_id, kind, created_at, close_at, summary)
          values (v_q.id, 'close', v_now, v_close_at, meldy_private.quiz_close_summary(v_q))
          on conflict do nothing;
          v_summaries := 1;
          update bot.quiz_watch w set closed_at = v_now where w.quiz_id = v_q.id;
        end if;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      update bot.quiz_watch w set checked_at = v_now where w.quiz_id = v_w.quiz_id;  -- the others first next time
    end;
  end loop;
  -- Waiting too long (a pause, a blocked bot): dropped; told ones are kept 90 days.
  update bot.quiz_notices n set handled_at = v_now where n.handled_at is null and n.created_at < v_now - interval '3 days';
  delete from bot.quiz_notices n
   where n.id in (select x.id from bot.quiz_notices x where x.handled_at < v_now - interval '90 days' limit 5000);

  -- b. Claimed quiz deliveries not handed in the last minute (a share the site queued, a 429 put back, a dead tick),
  --    under the rules of new ones. First what can never go is closed, never left claimed: the author's link is off
  --    or blocked (skipped), out of tries (failed), made more than 3 days ago (skipped), a share to a group no longer
  --    bound (failed). Then only rows that may go now are taken, oldest first: one waiting out the night or a pause is
  --    not taken at all, so it never holds back the rows behind it.
  update bot.deliveries d set status = 'skipped', error = 'link off'
    from bot.quiz_sends s
   where s.delivery_id = d.id and d.status = 'claimed'
     and not exists (select 1 from bot.links l where l.id = d.link_id and l.unlinked_at is null and l.blocked_at is null);
  update bot.deliveries d set status = 'failed', error = 'out of tries'
    from bot.quiz_sends s
   where s.delivery_id = d.id and d.status = 'claimed' and d.attempts >= 3;
  update bot.deliveries d set status = 'skipped', error = 'too old'
    from bot.quiz_sends s
   where s.delivery_id = d.id and d.status = 'claimed' and s.made_at < v_now - interval '3 days';
  update bot.deliveries d set status = 'failed', error = 'group gone'
    from bot.quiz_sends s
   where s.delivery_id = d.id and d.status = 'claimed' and s.kind = 'share'
     and not exists (select 1 from bot.groups g join public.quizzes q on q.container_id = g.container_id
                      where g.chat_id = d.chat_id and g.left_at is null and q.id = s.quiz_id);
  for v_s in
    select s.delivery_id, s.handed_at
      from bot.quiz_sends s
      join bot.deliveries d on d.id = s.delivery_id
      join bot.links l on l.id = d.link_id and l.unlinked_at is null and l.blocked_at is null
     where d.status = 'claimed' and (s.handed_at is null or s.handed_at < v_now - interval '1 minute')
       and (s.kind = 'share'
            or (extract(hour from v_now at time zone l.tz) between 8 and 21
                and (l.paused_until is null or l.paused_until <= (v_now at time zone l.tz)::date)))
     order by d.claimed_at, d.id
     limit p_limit
  loop
    exit when pg_catalog.cardinality(v_out) >= p_limit or pg_catalog.clock_timestamp() - v_start > c_time;
    begin
      v_row := meldy_private.quiz_tg_row(v_s.delivery_id);
      if v_s.handed_at is not null then
        update bot.deliveries d set attempts = d.attempts + 1 where d.id = v_s.delivery_id;
      end if;
      update bot.quiz_sends s set handed_at = v_now where s.delivery_id = v_s.delivery_id;
      v_out := v_out || v_row;
    exception when others then
      v_errors := v_errors + 1;
      update bot.deliveries d set status = 'failed', error = 'unreadable' where d.id = v_s.delivery_id and d.status = 'claimed';
    end;
  end loop;

  -- c. New messages to authors, under their rules.
  for v_w in
    select w.quiz_id, w.mode, l.id as link_id, l.chat_id, l.tz, l.paused_until
      from bot.quiz_watch w
      join bot.links l on l.user_id = w.owner_id and l.unlinked_at is null and l.blocked_at is null
     where w.mode <> 'off'
       and exists (select 1 from bot.quiz_notices n where n.quiz_id = w.quiz_id and n.handled_at is null)
     order by w.quiz_id
     limit 200
  loop
    exit when pg_catalog.cardinality(v_out) >= p_limit or pg_catalog.clock_timestamp() - v_start > c_time;
    v_local := v_now at time zone v_w.tz;
    continue when extract(hour from v_local) < 8 or extract(hour from v_local) >= 22;
    continue when v_w.paused_until is not null and v_w.paused_until > v_local::date;
    begin
      select pg_catalog.count(*) filter (where n.kind = 'close'), pg_catalog.count(*), pg_catalog.min(n.created_at),
             pg_catalog.max(n.close_at)
        into v_close, v_pending, v_oldest, v_close_at
        from bot.quiz_notices n where n.quiz_id = v_w.quiz_id and n.handled_at is null;
      select pg_catalog.max(s.made_at), pg_catalog.count(*) filter (where s.made_at > v_now - interval '10 minutes')
        into v_last, v_recent
        from bot.quiz_sends s join bot.deliveries d on d.id = s.delivery_id
       where s.quiz_id = v_w.quiz_id and s.kind in ('one', 'digest', 'close') and d.chat_id = v_w.chat_id;
      v_hex := pg_catalog.replace(v_w.quiz_id::text, '-', '');
      v_kind := null;
      if v_close > 0 then
        v_kind := 'close';
        v_ref := 'qc:' || v_hex || ':' || pg_catalog.floor(extract(epoch from v_close_at))::bigint::text;
      elsif v_w.mode = 'each' and v_pending = 1 and v_recent < 3 then
        v_kind := 'one';
        v_ref := 'qz:' || pg_catalog.replace((select n.attempt_id::text from bot.quiz_notices n
                                               where n.quiz_id = v_w.quiz_id and n.handled_at is null), '-', '');
      elsif (v_w.mode = 'each' and (v_last is null or v_last <= v_now - interval '10 minutes'))
            or (v_w.mode = 'digest' and (v_last is null or v_last <= v_now - interval '60 minutes')
                and v_oldest <= v_now - interval '10 minutes') then
        v_kind := 'digest';
        v_ref := 'qd:' || v_hex || ':' || (select pg_catalog.count(*) + 1 from bot.quiz_sends s
                                             where s.quiz_id = v_w.quiz_id and s.kind = 'digest')::text;
      end if;
      if v_kind is not null then
        insert into bot.deliveries (kind, chat_id, link_id, local_day, ref, claimed_at)
        values ('notice', v_w.chat_id, v_w.link_id, v_local::date, v_ref, v_now)
        on conflict do nothing
        returning id into v_id;
        if v_id is null then
          -- the same message this day already (a summary or a finish told before): what it would say is told
          update bot.quiz_notices n set handled_at = v_now where n.quiz_id = v_w.quiz_id and n.handled_at is null;
        else
          insert into bot.quiz_sends (delivery_id, quiz_id, kind, made_at, handed_at) values (v_id, v_w.quiz_id, v_kind, v_now, v_now);
          update bot.quiz_notices n set delivery_id = v_id, handled_at = v_now
           where n.quiz_id = v_w.quiz_id and n.handled_at is null;
          v_out := v_out || meldy_private.quiz_tg_row(v_id);
        end if;
      end if;
    exception when others then
      v_errors := v_errors + 1;
    end;
  end loop;
  return pg_catalog.jsonb_build_object('rows', pg_catalog.to_jsonb(v_out), 'errors', v_errors);
end;
$fn$;
comment on function public.bot_quiz_notices(integer, timestamptz) is 'Quiz notices (service role), bounded (50 watches, 200 finishes a quiz, one close summary, 3 s): settles watched quizzes of linked authors, notes finishes with their score, keeps the close summary once; hands claimed quiz deliveries and makes new ones under the author''s rules → {rows: [{delivery_id, chat_id, kind one|digest|close|share, …}], errors}.';

-- 5. Grants (re-runnable). The tables: nobody but the functions. The private helpers: nobody. The site's: authenticated.
--    The bot's: service_role.
revoke all on table bot.quiz_watch, bot.quiz_sends, bot.quiz_notices from public, anon, authenticated, service_role;
revoke all on function meldy_private.quiz_score(uuid), meldy_private.quiz_tg_state(public.quizzes, uuid),
  meldy_private.quiz_of_author(uuid, uuid), meldy_private.quiz_tg_row(bigint), meldy_private.quiz_close_summary(public.quizzes)
  from public, anon, authenticated, service_role;
revoke all on function public.telegram_quiz_state(uuid), public.telegram_quiz_notice(uuid, text),
  public.telegram_quiz_share(uuid, bigint), public.bot_quiz_notices(integer, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.telegram_quiz_state(uuid), public.telegram_quiz_notice(uuid, text),
  public.telegram_quiz_share(uuid, bigint) to authenticated;
grant execute on function public.bot_quiz_notices(integer, timestamptz) to service_role;
