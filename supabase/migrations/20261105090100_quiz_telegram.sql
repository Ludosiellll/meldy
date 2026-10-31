-- quiz_telegram (release 49, part B: «Telegram: автору — «Иванов сдал: 17 из 20» и итог по закрытию; ссылку на
-- контрольную — в группу одной кнопкой», spec Test_Builder_Spec_2026-10-18 «Выпуск 49»)
-- Repo file: supabase/migrations/20261105090100_quiz_telegram.sql. Base: the Telegram bot (20261010120000_telegram_bot.sql:
-- bot.links, bot.deliveries and its sending / done / retry; 20261010120004_telegram_bot_groups.sql: bot.groups) and
-- the quizzes (20261020120000_quiz_protection.sql quiz_settle, 20261101090200_question_kinds_quiz.sql quiz_graded).
-- What it adds (nothing existing changes; no trigger on a quiz table: the bot's minute tick looks for new finishes):
--   1. bot.quiz_watch: the author's choice per quiz — each (a message a finish, at most 3 in 10 minutes, then a digest
--      at most every 10 minutes), digest (one message at most an hour, from 10 minutes after the first finish), off
--      (the default: nothing new is switched on by itself, spec «Принципы»). `since`: finishes from here are told (no
--      flood of old ones when it is switched on). `closed_at`: the close summary was queued (once).
--   2. bot.quiz_notices: a finish to tell (kind done, one per attempt) or the close (kind close, one per quiz), and the
--      delivery that told it. bot.quiz_sends: per bot.deliveries row of a quiz (kind notice, ref qz:/qd:/qc:/qs: and
--      hex ids) its quiz, its kind (one, digest, close, share) and when the tick was last handed it.
--   3. For the signed-in author: public.telegram_quiz_state(p_quiz_id) → {linked, blocked, notice, groups: [{chat_id,
--      title, shared_at}]} (the group chats bound to the quiz's exam where the bot still is);
--      public.telegram_quiz_notice(p_quiz_id, p_mode) → the state after the change (off drops what waits);
--      public.telegram_quiz_share(p_quiz_id, p_chat_id) → {status: queued | already | closed | no_group | no_link,
--      title}: the quiz's link into a bound group chat, once a day per chat, sent by the next tick.
--   4. For the bot (service role): public.bot_quiz_notices(p_limit, p_now) → {rows: [...]}: first every watched
--      quiz with recent activity (an open attempt, a start in 2 days, a close) is settled, its new finishes of others noted, and the close summary queued once
--      when it has closed (within 3 days of the close); then the claimed quiz deliveries not handed in the last
--      minute (a 429 put back, a tick that died) come again, and new ones are made under the author's rules: only to an
--      active, unblocked link, never while it is paused (paused_until), never between 22:00 and 08:00 in the link's
--      zone (what waits goes as a digest in the morning), the close summary first (it takes the finishes that wait).
--      Waiting notices older than 3 days are dropped. Each row carries what the message says: one — the name and
--      score; digest — up to 30 names and scores, how many, how many finished in all; close — people, the average
--      percent, how many passed, the three hardest questions; share — the code, the deadline, the count, the timer.
--      The bot sends them through bot_delivery_sending → sendMessage → bot_delivery_done (at most once, as T1).
-- Errors of the site functions (SQLSTATE): 28000 not signed in; P0002 as HTTP 404 (raise sqlstate 'PGRST') detail quiz:
-- not the author's; 22023 detail mode: an unknown mode. Bot function: 42501 not the service role, 22023 a bad limit.
-- Check after the apply: supabase/tests/quiz_telegram.sql (catalog only; read-only). Local rehearsal (never live):
-- supabase/tests/local/quiz_stats_telegram_run.sh (quiz_telegram_behaviour.sql). Rollback:
-- supabase/rollback/20261105090100_quiz_telegram_down.sql. Release order: this file, then the telegram function with
-- quiz.ts (until then nothing is sent; the author's choice is kept), then the site. Re-runnable: IF NOT EXISTS, OR
-- REPLACE; the grants are set again.

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
  updated_at timestamptz not null default now(),
  constraint quiz_watch_mode_check check (mode in ('each', 'digest', 'off'))
);
create index if not exists quiz_watch_owner_idx on bot.quiz_watch (owner_id);
comment on table bot.quiz_watch is 'Telegram notices of a quiz for its author: each | digest | off; since (finishes told from), closed_at (the close summary queued).';

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
  delivery_id bigint references bot.deliveries(id) on delete set null,
  handled_at timestamptz,
  constraint quiz_notices_kind_check check (kind in ('done', 'close')),
  constraint quiz_notices_attempt_check check ((kind = 'done') = (attempt_id is not null))
);
create unique index if not exists quiz_notices_done_key on bot.quiz_notices (attempt_id) where kind = 'done';
create unique index if not exists quiz_notices_close_key on bot.quiz_notices (quiz_id) where kind = 'close';
create index if not exists quiz_notices_open_idx on bot.quiz_notices (quiz_id) where handled_at is null;
create index if not exists quiz_notices_delivery_idx on bot.quiz_notices (delivery_id);
comment on table bot.quiz_notices is 'A quiz finish (done, one per attempt) or close (one per quiz) to tell its author in Telegram, and the delivery that told it.';

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

-- 2d. What a quiz delivery says (bot_quiz_notices' row).
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
    select a.name, sc.score, sc.max_score into v_a
      from bot.quiz_notices n
      join public.quiz_attempts a on a.id = n.attempt_id
     cross join lateral meldy_private.quiz_score(a.id) sc
     where n.delivery_id = p_delivery
     limit 1;
    return v_out || pg_catalog.jsonb_build_object('name', v_a.name, 'score', coalesce(v_a.score, 0), 'max', coalesce(v_a.max_score, 0));
  elsif v_s.kind = 'digest' then
    return v_out || pg_catalog.jsonb_build_object(
      'people', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', x.name, 'score', x.score, 'max', x.max_score)
                                                      order by x.finished_at, x.id)
                            from (select a.id, a.name, a.finished_at, sc.score, sc.max_score
                                    from bot.quiz_notices n
                                    join public.quiz_attempts a on a.id = n.attempt_id
                                   cross join lateral meldy_private.quiz_score(a.id) sc
                                   where n.delivery_id = p_delivery
                                   order by a.finished_at, a.id
                                   limit 30) x), '[]'::jsonb),
      'count', (select pg_catalog.count(*) from bot.quiz_notices n where n.delivery_id = p_delivery and n.kind = 'done'),
      'done', (select pg_catalog.count(*) from public.quiz_attempts a
                where a.quiz_id = v_q.id and a.finished_at is not null and a.user_id is distinct from v_q.owner_id));
  elsif v_s.kind = 'close' then
    with per as (
      select coalesce(a.user_id::text, a.guest_hash) as who, a.n,
             case when sc.max_score > 0 then 100 * sc.score / sc.max_score end as pct
        from public.quiz_attempts a
       cross join lateral meldy_private.quiz_score(a.id) sc
       where a.quiz_id = v_q.id and a.finished_at is not null and a.user_id is distinct from v_q.owner_id
    ), pick as (
      select distinct on (per.who) per.who, per.pct
        from per
       order by per.who, case when v_q.grading = 'last' then per.n end desc nulls last, per.pct desc nulls last, per.n desc
    ), hard as (
      select g.item_id, pg_catalog.count(*) as shown, pg_catalog.sum(g.credit) as credit
        from public.quiz_attempts a
       cross join lateral meldy_private.quiz_graded(null, a.id) g
       where a.quiz_id = v_q.id and a.finished_at is not null and a.user_id is distinct from v_q.owner_id and not g.pending
       group by g.item_id
      having pg_catalog.count(*) >= 3
       order by pg_catalog.sum(g.credit) / pg_catalog.count(*), g.item_id
       limit 3
    )
    select v_out || pg_catalog.jsonb_build_object(
             'people', (select pg_catalog.count(*) from pick),
             'avg_percent', (select pg_catalog.round(pg_catalog.avg(pick.pct)) from pick),
             'passed', case when v_q.pass_percent is null then null
                            else (select pg_catalog.count(*) from pick where pick.pct >= v_q.pass_percent) end,
             'hardest', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                           'no', coalesce(nullif(i.file_no, ''), i.position::text), 'percent', pg_catalog.round(100 * hard.credit / hard.shown))
                                         order by hard.credit / hard.shown, i.position)
                                    from hard join public.test_items i on i.id = hard.item_id), '[]'::jsonb))
      into v_out;
    return v_out;
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
comment on function public.telegram_quiz_notice(uuid, text) is 'Quiz (the author): Telegram notices each | digest | off (off drops what waits) → the state.';

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
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_out jsonb[] := '{}';
  v_w record;
  v_q public.quizzes%rowtype;
  v_local timestamp;
  v_close integer;
  v_pending integer;
  v_oldest timestamptz;
  v_last timestamptz;
  v_recent integer;
  v_kind text;
  v_ref text;
  v_id bigint;
  v_prev timestamptz;
  v_hex text;
begin
  perform meldy_private.require_service_role();
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;

  -- a. Watched quizzes with recent activity: settled, their new finishes of others noted, the close queued once.
  for v_w in
    select w.quiz_id, w.owner_id, w.since
      from bot.quiz_watch w
      join public.quizzes q on q.id = w.quiz_id
     where w.mode <> 'off' and w.closed_at is null
       and (q.closed_at is not null or (q.closes_at is not null and q.closes_at <= v_now + interval '1 minute')
            or exists (select 1 from public.quiz_attempts a
                        where a.quiz_id = q.id and (a.finished_at is null or a.started_at > v_now - interval '2 days')))
  loop
    perform meldy_private.quiz_settle(v_w.quiz_id);
    insert into bot.quiz_notices (quiz_id, attempt_id, kind, created_at)
    select a.quiz_id, a.id, 'done', v_now
      from public.quiz_attempts a
     where a.quiz_id = v_w.quiz_id and a.finished_at is not null and a.finished_at >= v_w.since
       and a.user_id is distinct from v_w.owner_id
    on conflict do nothing;
    select q.* into v_q from public.quizzes q where q.id = v_w.quiz_id;
    if meldy_private.quiz_state(v_q) = 'closed' then
      if coalesce(v_q.closed_at, v_q.closes_at) > v_now - interval '3 days' then
        insert into bot.quiz_notices (quiz_id, kind, created_at) values (v_q.id, 'close', v_now) on conflict do nothing;
      end if;
      update bot.quiz_watch w set closed_at = v_now where w.quiz_id = v_q.id;
    end if;
  end loop;
  -- Waiting too long (a pause, a blocked bot): dropped; told ones are kept 90 days.
  update bot.quiz_notices n set handled_at = v_now where n.handled_at is null and n.created_at < v_now - interval '3 days';
  delete from bot.quiz_notices n
   where n.id in (select x.id from bot.quiz_notices x where x.handled_at < v_now - interval '90 days' limit 5000);

  -- b. Claimed quiz deliveries not handed in the last minute (a share the site queued, a 429 put back, a dead tick), to
  --    an active, unblocked link (bot_delivery_sending would refuse the rest).
  for v_id, v_prev in
    select s.delivery_id, s.handed_at
      from bot.quiz_sends s
      join bot.deliveries d on d.id = s.delivery_id
      join bot.links l on l.id = d.link_id and l.unlinked_at is null and l.blocked_at is null
     where d.status = 'claimed' and d.attempts < 3 and (s.handed_at is null or s.handed_at < v_now - interval '1 minute')
     order by d.claimed_at, d.id
     limit p_limit
  loop
    if v_prev is not null then
      update bot.deliveries d set attempts = d.attempts + 1 where d.id = v_id;
    end if;
    update bot.quiz_sends s set handed_at = v_now where s.delivery_id = v_id;
    v_out := v_out || meldy_private.quiz_tg_row(v_id);
  end loop;

  -- c. New messages to authors, under their rules.
  for v_w in
    select w.quiz_id, w.mode, l.id as link_id, l.chat_id, l.tz, l.paused_until
      from bot.quiz_watch w
      join bot.links l on l.user_id = w.owner_id and l.unlinked_at is null and l.blocked_at is null
     where w.mode <> 'off'
       and exists (select 1 from bot.quiz_notices n where n.quiz_id = w.quiz_id and n.handled_at is null)
     order by w.quiz_id
  loop
    exit when pg_catalog.cardinality(v_out) >= p_limit;
    v_local := v_now at time zone v_w.tz;
    continue when extract(hour from v_local) < 8 or extract(hour from v_local) >= 22;
    continue when v_w.paused_until is not null and v_w.paused_until > v_local::date;
    select pg_catalog.count(*) filter (where n.kind = 'close'), pg_catalog.count(*), pg_catalog.min(n.created_at)
      into v_close, v_pending, v_oldest
      from bot.quiz_notices n where n.quiz_id = v_w.quiz_id and n.handled_at is null;
    select pg_catalog.max(s.made_at), pg_catalog.count(*) filter (where s.made_at > v_now - interval '10 minutes')
      into v_last, v_recent
      from bot.quiz_sends s join bot.deliveries d on d.id = s.delivery_id
     where s.quiz_id = v_w.quiz_id and s.kind in ('one', 'digest', 'close') and d.chat_id = v_w.chat_id;
    v_hex := pg_catalog.replace(v_w.quiz_id::text, '-', '');
    v_kind := null;
    if v_close > 0 then
      v_kind := 'close';
      v_ref := 'qc:' || v_hex;
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
    continue when v_kind is null;
    insert into bot.deliveries (kind, chat_id, link_id, local_day, ref, claimed_at)
    values ('notice', v_w.chat_id, v_w.link_id, v_local::date, v_ref, v_now)
    on conflict do nothing
    returning id into v_id;
    if v_id is null then
      -- the same message this day already (a summary or a finish told before): what it would say is told
      update bot.quiz_notices n set handled_at = v_now where n.quiz_id = v_w.quiz_id and n.handled_at is null;
      continue;
    end if;
    insert into bot.quiz_sends (delivery_id, quiz_id, kind, made_at, handed_at) values (v_id, v_w.quiz_id, v_kind, v_now, v_now);
    update bot.quiz_notices n set delivery_id = v_id, handled_at = v_now where n.quiz_id = v_w.quiz_id and n.handled_at is null;
    v_out := v_out || meldy_private.quiz_tg_row(v_id);
  end loop;
  return pg_catalog.jsonb_build_object('rows', pg_catalog.to_jsonb(v_out));
end;
$fn$;
comment on function public.bot_quiz_notices(integer, timestamptz) is 'Quiz notices (service role): settles watched quizzes, notes finishes, queues the close once; hands claimed quiz deliveries and makes new ones under the author''s rules → {rows: [{delivery_id, chat_id, kind one|digest|close|share, …}]}.';

-- 5. Grants (re-runnable). The tables: nobody but the functions. The private helpers: nobody. The site's: authenticated.
--    The bot's: service_role.
revoke all on table bot.quiz_watch, bot.quiz_sends, bot.quiz_notices from public, anon, authenticated, service_role;
revoke all on function meldy_private.quiz_score(uuid), meldy_private.quiz_tg_state(public.quizzes, uuid),
  meldy_private.quiz_of_author(uuid, uuid), meldy_private.quiz_tg_row(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.telegram_quiz_state(uuid), public.telegram_quiz_notice(uuid, text),
  public.telegram_quiz_share(uuid, bigint), public.bot_quiz_notices(integer, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.telegram_quiz_state(uuid), public.telegram_quiz_notice(uuid, text),
  public.telegram_quiz_share(uuid, bigint) to authenticated;
grant execute on function public.bot_quiz_notices(integer, timestamptz) to service_role;
