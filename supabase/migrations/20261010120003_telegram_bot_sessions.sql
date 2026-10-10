-- telegram_bot_sessions
-- Repo file: supabase/migrations/20261010120003_telegram_bot_sessions.sql (package T5 of the Telegram bot
-- @Meldyteach_bot, 2026-10-10). Spec: meldy-notes/10_Project/Telegram_Bot_Spec_2026-10-09.md (§2 decisions 11–17, 25;
-- §4.3, §4.4, §4.8; §6.2 «sessions»; §6.3 «занятие» and «Ответ в занятии»; §6.5; §8.2 «Занятие»).
-- Stands on 20261010120000_telegram_bot.sql (schema bot, bot.links, bot.active_link, bot.local_day; T1's bot_today
-- reads bot.sessions (user_id, status = 'open'), the night's close reads bot.sessions (chat_id, message_id), the tick's
-- saving mode calls bot.tick_due_sessions) and on the exam container (meldy_private.record_test_answers_for,
-- grade_answer, test_key_doubt_for, role_in; public.test_items).
-- Rollback: supabase/rollback/20261010120003_telegram_bot_sessions_down.sql. Contract: the T5 block of
-- supabase/tests/telegram_bot.sql. Local rehearsal (never live): supabase/tests/local/telegram_bot_sessions.sql.
-- Signatures and JSON shapes for the function: supabase/functions/_shared/bot/CONTRACT_T5.md.
--
-- A «занятие» in the chat (spec §4.3): one message, the queue of session.ts (20 questions of one subject, a mistake
-- back 3–5 questions later, at most twice), seeded by the sid. What is computed where:
--   * the function's TypeScript (its copy of lib/containers/session.ts) builds the queue, the option order of every
--     question (optionOrder: seeded, keep_order, «все перечисленные» last), the plan class of every question and,
--     after an answer, afterAnswer's queue; this file stores them and never re-implements them;
--   * this file maps a pressed (shown) index to the file's index, grades with test_items.correct through the
--     container's own meldy_private.grade_answer, and writes answers only through meldy_private.record_test_answers_for
--     (source 'bot', client_event_id tg:<sid>:<pos>, local_date in the link's zone, ms from the show to the tap by the
--     server clock and at most 180 s, the class, the repeat flag, session_id = md5('tg:' || sid)::uuid);
--   * a right answer goes to the core at once; a wrong one or «Не знаю» waits in pending until «Дальше» (as given),
--     «Нажали не туда?» (misclick), «Отметить» (the doubt), any other action in the session (as given) or the tick's
--     flush after 30 minutes (as given).
-- The key never leaves before the answer: a view carries the text and the options in the shown order, and the key
-- (in shown indices) only for a question already answered.
-- Every public.bot_session_* / bot_key_doubt / bot_flush_pending is SECURITY DEFINER with an empty search_path, starts
-- with meldy_private.require_service_role(), takes the user only through bot.active_link(p_tg_user_id) and checks
-- that the session is that user's (the flush: the session's own link), and answers every input problem with a
-- status, never an error.
-- Additive and re-runnable (IF NOT EXISTS, OR REPLACE). Grants and revokes of this file's own objects are at its end:
-- 20261010120002_telegram_bot_revokes.sql ran before they existed.

-- 1. The table (spec §6.2): one row per «занятие». The spec's columns, plus: session_uuid (test_answers.session_id of
--    its answers: md5('tg:' || sid)::uuid, so the log joins a session even after it is cleaned up), link_id (the link
--    that started it: the flush records only while it is active), pending_at (the tap of a pending answer not yet
--    recorded: the flush's index), exam_title (for «Экзамен «…» больше недоступен»), created_at, active_at (the
--    user's last action in it) and finished_at.
--    The queue is four arrays and one jsonb array aligned by position (0-based in the API, items[pos + 1] in SQL):
--      items[]    the question (test_items.id); (item, retry) is unique in a queue;
--      retry[]    0 for the planned question, 1 and 2 for its repeats («повтор — не в счёт»);
--      cls[]      the plan class it was asked under (record_test_answers_for cls; 'free' when none);
--      shown      [{o: file indices in display order ([] for a short answer), r: the item's rev when shown}, …];
--      shown_at[] when it was first shown (ms of the answer).
--    position = the current question; = cardinality(items) once the queue is done (status finished).
--    pending = the answer at `position` awaiting «Дальше»: {pos, item_id, rev, kind, choice (shown indices), chosen
--    (file indices), text, dont_know, correct, at, local_date, ms, cls, retry, order, recorded, misclick, doubt,
--    status, step}. counts and figure feed the summary (I1, I2).
create table if not exists bot.sessions (
  sid text primary key,
  session_uuid uuid generated always as (pg_catalog.md5('tg:' || sid)::uuid) stored,
  user_id uuid not null references auth.users(id) on delete cascade,
  link_id bigint references bot.links(id) on delete cascade,
  chat_id bigint not null,
  message_id bigint,
  container_id uuid not null,
  subject_id uuid not null,
  kind text not null default 'plan',
  local_day date not null,
  items uuid[] not null,
  retry smallint[] not null,
  cls text[] not null,
  shown jsonb not null,
  shown_at timestamptz[] not null,
  position integer not null default 0,
  pending jsonb,
  pending_at timestamptz,
  counts jsonb not null default '{}'::jsonb,
  figure jsonb,
  status text not null default 'open',
  exam_title text,
  created_at timestamptz not null default now(),
  active_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint sessions_sid_check check (sid ~ '^[0-9a-z]{8}$'),
  constraint sessions_kind_check check (kind in ('plan', 'errors', 'extra')),
  constraint sessions_status_check check (status in ('open', 'finished', 'abandoned')),
  constraint sessions_ids_check check (chat_id > 0 and (message_id is null or message_id > 0)),
  constraint sessions_queue_check check (
    array_ndims(items) = 1 and cardinality(items) between 1 and 60
    and cardinality(retry) = cardinality(items) and cardinality(cls) = cardinality(items)
    and cardinality(shown_at) = cardinality(items)
    and jsonb_typeof(shown) = 'array' and jsonb_array_length(shown) = cardinality(items)
    and retry <@ array[0, 1, 2]::smallint[]
    and cls <@ array['relearn', 'confirm', 'new_floor', 'confirm_ai', 'start_ai', 'check', 'final', 'new_fill',
                     'free']::text[]),
  constraint sessions_position_check check (position between 0 and cardinality(items)),
  constraint sessions_pending_check check ((pending is null or jsonb_typeof(pending) = 'object')
                                           and (pending_at is null or (pending is not null and status = 'open'))),
  constraint sessions_counts_check check (jsonb_typeof(counts) = 'object'),
  constraint sessions_figure_check check (figure is null or jsonb_typeof(figure) = 'object'),
  constraint sessions_title_check check (exam_title is null or char_length(exam_title) <= 200),
  constraint sessions_finished_check check ((status = 'open') = (finished_at is null))
);
-- One open session per user (spec §6.2); bot_session_start closes the previous one first.
create unique index if not exists sessions_open_user_key on bot.sessions (user_id) where status = 'open';
create unique index if not exists sessions_uuid_key on bot.sessions (session_uuid);
-- T1's night's close (bot.session_message): is this message a session?
create index if not exists sessions_message_idx on bot.sessions (chat_id, message_id) where message_id is not null;
-- The tick: pending answers older than 30 minutes (bot_flush_pending, bot.tick_due_sessions).
create index if not exists sessions_flush_idx on bot.sessions (pending_at) where pending_at is not null;
-- The tick: open sessions idle for 30 minutes (a past day or an ended link closes them); closed ones go after 30 days.
create index if not exists sessions_open_active_idx on bot.sessions (active_at) where status = 'open';
create index if not exists sessions_closed_idx on bot.sessions (finished_at) where status <> 'open';
create index if not exists sessions_user_idx on bot.sessions (user_id, created_at desc);
create index if not exists sessions_link_idx on bot.sessions (link_id);
alter table bot.sessions enable row level security;
comment on table bot.sessions is 'Telegram «занятие» (spec §6.2): the queue, option orders and classes the function computed (session.ts), the position, the answer awaiting «Дальше», counts and the figure. One open per user.';

-- 2. Helpers (schema bot: not reachable by clients; they run inside the DEFINER functions below, as the migration
--    role).
-- 2a. Is p_order a permutation of 0..p_n-1 (file indices in display order; [] for a short answer, n = 0)?
create or replace function bot.session_order_ok(p_order jsonb, p_n integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $fn$
begin
  if p_order is null or p_n is null or p_n < 0 or p_n > 8 or pg_catalog.jsonb_typeof(p_order) <> 'array'
     or pg_catalog.jsonb_array_length(p_order) <> p_n then
    return false;
  end if;
  return not exists (select 1 from pg_catalog.jsonb_array_elements(p_order) x
                      where case when pg_catalog.jsonb_typeof(x) = 'number' and (x #>> '{}') ~ '^[0-7]$'
                                 then (x #>> '{}')::integer >= p_n else true end)
     and (select pg_catalog.count(distinct x #>> '{}') from pg_catalog.jsonb_array_elements(p_order) x) = p_n;
end;
$fn$;

-- 2b. The file's own order (the fallback when an item changed its number of options under a running session).
create or replace function bot.session_identity(p_n integer)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.jsonb_agg(g order by g), '[]'::jsonb) from pg_catalog.generate_series(0, p_n - 1) g
$fn$;

-- 2c. counts[key] += by.
create or replace function bot.session_count(p_counts jsonb, p_key text, p_by integer default 1)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(p_counts, '{}'::jsonb)
      || pg_catalog.jsonb_build_object(p_key, coalesce((p_counts ->> p_key)::integer, 0) + p_by)
$fn$;

-- 2d. A set of item ids kept as a jsonb array of strings.
create or replace function bot.session_set_add(p_set jsonb, p_id text)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select case when coalesce(p_set, '[]'::jsonb) ? p_id then coalesce(p_set, '[]'::jsonb)
              else coalesce(p_set, '[]'::jsonb) || pg_catalog.to_jsonb(p_id) end
$fn$;

-- 2e. The summary's numbers, every key present (0 when nothing happened). questions = planned questions answered (their
--     first answer, «Нажали не туда?» included); right / wrong / dont_know / misclick split those first answers;
--     retries = answers to repeats; skipped = questions the function could not show (over 4096 characters); gone =
--     questions left out (deleted, without a key, not recorded as gone / no_key); stale = answers not recorded because
--     the author changed the key meanwhile; doubted = «Сомневаюсь в ключе» → «Отметить».
create or replace function bot.session_counts_json(p_counts jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select '{"questions": 0, "right": 0, "wrong": 0, "dont_know": 0, "misclick": 0, "retries": 0, "skipped": 0,
           "gone": 0, "stale": 0, "doubted": 0}'::jsonb || coalesce(p_counts, '{}'::jsonb)
$fn$;

-- 2f. The figure «N из M — верно в два разных дня»: in_plan and two_days as the plan gave them at the start; now =
--     two_days + gained − dropped (null without a start figure); the session's changes, each question once (session.ts
--     figureChange): gained = reached the rule (step two_days), dropped = were in the figure and missed, started = a
--     first clean right answer (step start), too_early = right again before their moment, with the state rule.ts
--     countableFrom needs («войдут в счёт, если ответите после 19:00»).
create or replace function bot.session_figure_json(p_f jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'in_plan', p_f -> 'in_plan', 'two_days', p_f -> 'two_days',
    'now', case when pg_catalog.jsonb_typeof(p_f -> 'two_days') = 'number'
                then greatest(0, (p_f ->> 'two_days')::integer
                                 + coalesce(pg_catalog.jsonb_array_length(p_f -> 'gained'), 0)
                                 - coalesce(pg_catalog.jsonb_array_length(p_f -> 'dropped'), 0)) end,
    'gained', coalesce(pg_catalog.jsonb_array_length(p_f -> 'gained'), 0),
    'dropped', coalesce(pg_catalog.jsonb_array_length(p_f -> 'dropped'), 0),
    'started', coalesce(pg_catalog.jsonb_array_length(p_f -> 'started'), 0),
    'too_early', (select pg_catalog.count(*)
                    from pg_catalog.jsonb_object_keys(coalesce(p_f -> 'too_early', '{}'::jsonb))),
    'too_early_states', (select coalesce(pg_catalog.jsonb_agg(e.value order by e.key), '[]'::jsonb)
                           from pg_catalog.jsonb_each(coalesce(p_f -> 'too_early', '{}'::jsonb)) e))
$fn$;

-- 2g. May the session still be used? On its own local day, or (not for «Продолжить») while active: its last action
--     less than 30 minutes ago (a session running past midnight goes on; after midnight it is not continued later).
create or replace function bot.session_live(p_s bot.sessions, p_tz text, p_now timestamptz, p_today_only boolean)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select p_s.local_day >= bot.local_day(p_tz, p_now)
      or (not p_today_only and p_s.active_at > p_now - interval '30 minutes')
$fn$;

-- 2h. Writes the mutable columns of a session row back.
create or replace function bot.session_save(p_s bot.sessions)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  update bot.sessions s
     set chat_id = p_s.chat_id, message_id = p_s.message_id, items = p_s.items, retry = p_s.retry, cls = p_s.cls,
         shown = p_s.shown, shown_at = p_s.shown_at, position = p_s.position, pending = p_s.pending,
         pending_at = p_s.pending_at, counts = p_s.counts, figure = p_s.figure, status = p_s.status,
         active_at = p_s.active_at, finished_at = p_s.finished_at
   where s.sid = p_s.sid;
end;
$fn$;

-- 2i. The current question becomes showable: questions that are gone (deleted, without a key) are stepped over and
--     counted; a done queue finishes the session. The question shown gets its order checked (the file's order if the
--     item's number of options changed since), its rev stamped (again while unanswered: the student sees the current
--     version) and its first show time.
create or replace function bot.session_stamp(p_s bot.sessions, p_now timestamptz)
returns bot.sessions
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_item public.test_items%rowtype;
  v_n integer;
  v_cell jsonb;
  v_order jsonb;
  v_answered boolean;
begin
  if p_s.status <> 'open' then
    return p_s;
  end if;
  loop
    if p_s.position >= pg_catalog.cardinality(p_s.items) then
      p_s.status := 'finished';
      p_s.finished_at := p_now;
      p_s.pending := null;
      p_s.pending_at := null;
      return p_s;
    end if;
    v_item := null;
    select i.* into v_item from public.test_items i where i.id = p_s.items[p_s.position + 1];
    exit when v_item.id is not null and v_item.container_id = p_s.container_id and v_item.keyed;
    p_s.counts := bot.session_count(p_s.counts, 'gone');
    p_s.position := p_s.position + 1;
    p_s.pending := null;
    p_s.pending_at := null;
  end loop;
  v_n := case when v_item.kind = 'short' then 0 else pg_catalog.jsonb_array_length(v_item.options) end;
  v_cell := coalesce(p_s.shown -> p_s.position, '{}'::jsonb);
  v_order := v_cell -> 'o';
  if not bot.session_order_ok(v_order, v_n) then
    v_order := bot.session_identity(v_n);
  end if;
  v_answered := p_s.pending is not null and (p_s.pending ->> 'pos')::integer = p_s.position;
  p_s.shown := pg_catalog.jsonb_set(p_s.shown, array[p_s.position::text], pg_catalog.jsonb_build_object(
    'o', v_order,
    'r', case when v_answered and pg_catalog.jsonb_typeof(v_cell -> 'r') = 'number' then v_cell -> 'r'
              else pg_catalog.to_jsonb(v_item.rev) end));
  if p_s.shown_at[p_s.position + 1] is null then
    p_s.shown_at[p_s.position + 1] := p_now;
  end if;
  return p_s;
end;
$fn$;

-- 2j. What one recorded answer does to counts and the figure. p_p = the answer (pos, item_id, retry, correct,
--     dont_know, misclick); p_result = the core's result for it. dropped reads the log row's two_days_before (the
--     item was in the figure just before this answer); an item gained and then missed in the same session leaves
--     gained instead.
create or replace function bot.session_tally(p_s bot.sessions, p_p jsonb, p_result jsonb)
returns bot.sessions
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_status text := p_result ->> 'status';
  v_step text := p_result ->> 'step';
  v_id text := p_p ->> 'item_id';
  v_f jsonb := coalesce(p_s.figure, '{}'::jsonb);
  v_two boolean;
begin
  if v_status in ('saved', 'late', 'duplicate') then
    if coalesce((p_p ->> 'retry')::integer, 0) > 0 then
      p_s.counts := bot.session_count(p_s.counts, 'retries');
    else
      p_s.counts := bot.session_count(p_s.counts, 'questions');
      p_s.counts := bot.session_count(p_s.counts,
        case when coalesce((p_p ->> 'misclick')::boolean, false) then 'misclick'
             when coalesce((p_p ->> 'correct')::boolean, false) then 'right'
             when coalesce((p_p ->> 'dont_know')::boolean, false) then 'dont_know'
             else 'wrong' end);
    end if;
    if v_status = 'saved' then
      if v_step = 'two_days' then
        v_f := pg_catalog.jsonb_set(v_f, '{gained}', bot.session_set_add(v_f -> 'gained', v_id));
        v_f := v_f #- array['too_early', v_id];
      elsif v_step = 'miss' then
        select a.two_days_before into v_two from public.test_answers a
         where a.user_id = p_s.user_id and a.client_event_id = 'tg:' || p_s.sid || ':' || (p_p ->> 'pos');
        if coalesce(v_two, false) then
          if coalesce(v_f -> 'gained', '[]'::jsonb) ? v_id then
            v_f := pg_catalog.jsonb_set(v_f, '{gained}', (v_f -> 'gained') - v_id);
          else
            v_f := pg_catalog.jsonb_set(v_f, '{dropped}', bot.session_set_add(v_f -> 'dropped', v_id));
          end if;
        end if;
      elsif v_step = 'too_early' and not (coalesce(v_f -> 'gained', '[]'::jsonb) ? v_id) then
        v_f := pg_catalog.jsonb_set(v_f, '{too_early}', coalesce(v_f -> 'too_early', '{}'::jsonb)
          || pg_catalog.jsonb_build_object(v_id, pg_catalog.jsonb_build_object(
               'streak_at', p_result -> 'state' -> 'streak_at', 'streak_day', p_result -> 'state' -> 'streak_day',
               'peek_day', p_result -> 'state' -> 'peek_day')));
      elsif v_step = 'start' then
        v_f := pg_catalog.jsonb_set(v_f, '{started}', bot.session_set_add(v_f -> 'started', v_id));
      end if;
      p_s.figure := v_f;
    end if;
  elsif v_status = 'stale' then
    p_s.counts := bot.session_count(p_s.counts, 'stale');
  elsif v_status in ('gone', 'no_key', 'conflict') then
    p_s.counts := bot.session_count(p_s.counts, 'gone');
  end if;
  return p_s;
end;
$fn$;

-- 2k. The waiting answer goes to the core, once: as given, or with misclick (spec §6.3). An answer already recorded
--     is left as it is; the core itself refuses a second row for tg:<sid>:<pos> (duplicate).
create or replace function bot.session_record(p_s bot.sessions, p_misclick boolean)
returns bot.sessions
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_p jsonb := p_s.pending;
  v_el jsonb;
  v_res jsonb;
begin
  if v_p is null or coalesce((v_p ->> 'recorded')::boolean, false) then
    return p_s;
  end if;
  v_el := pg_catalog.jsonb_build_object(
      'client_event_id', 'tg:' || p_s.sid || ':' || (v_p ->> 'pos'), 'item_id', v_p ->> 'item_id',
      'rev', v_p -> 'rev', 'mode', 'learn', 'local_date', v_p ->> 'local_date', 'ms', v_p -> 'ms',
      'cls', v_p ->> 'cls', 'retry', coalesce((v_p ->> 'retry')::integer, 0) > 0,
      'misclick', coalesce(p_misclick, false))
    || case when v_p ->> 'kind' = 'short'
              then pg_catalog.jsonb_build_object('text', v_p -> 'text')
            when v_p ->> 'kind' = 'single'
              then pg_catalog.jsonb_build_object(
                     'chosen', case when pg_catalog.jsonb_array_length(v_p -> 'chosen') = 1 then v_p -> 'chosen' -> 0
                                    else 'null'::jsonb end,
                     'shown_order', v_p -> 'order')
            else pg_catalog.jsonb_build_object(
                   'chosen', case when pg_catalog.jsonb_array_length(v_p -> 'chosen') > 0 then v_p -> 'chosen'
                                  else 'null'::jsonb end,
                   'shown_order', v_p -> 'order') end;
  v_res := meldy_private.record_test_answers_for(p_s.user_id, pg_catalog.jsonb_build_array(v_el), 'bot', 1, null,
                                                 p_s.session_uuid) -> 'results' -> 0;
  v_p := v_p || pg_catalog.jsonb_build_object('misclick', coalesce(p_misclick, false));
  p_s := bot.session_tally(p_s, v_p, v_res);
  p_s.pending := v_p || pg_catalog.jsonb_build_object('recorded', true, 'status', v_res -> 'status',
                                                      'step', v_res -> 'step');
  p_s.pending_at := null;
  return p_s;
end;
$fn$;

-- 2l. The session ends (finished | abandoned). p_record: its waiting answer goes in as given first (any other action
--     in the session); not when the link has ended («ответы здесь не будут сохраняться») or the exam is gone.
create or replace function bot.session_close(p_s bot.sessions, p_status text, p_record boolean, p_now timestamptz)
returns bot.sessions
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  if p_record then
    p_s := bot.session_record(p_s, false);
  end if;
  p_s.status := p_status;
  p_s.finished_at := p_now;
  p_s.pending_at := null;
  return p_s;
end;
$fn$;

-- 2m. The outcome already recorded for a position of this session (a replay of the same press: «Повторить», a lost
--     response), read from the answer log itself; null when nothing was recorded there.
create or replace function bot.session_logged(p_user uuid, p_sid text, p_pos integer)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object('status', 'duplicate', 'correct', a.correct,
           'dont_know', pg_catalog.cardinality(a.chosen) = 0 and a.answer_text is null, 'misclick', a.misclick,
           'step', a.step)
    from public.test_answers a
   where p_pos is not null and a.user_id = p_user and a.client_event_id = 'tg:' || p_sid || ':' || p_pos
$fn$;

-- 2n. SESSION, as the session calls return it (CONTRACT_T5.md): the queue as session.ts reads it ({id, retry}), where
--     it stands, the message, counts and the figure; role = the user's role in the exam (owner: «Ключ неверный?»;
--     member: «Сомневаюсь в ключе»). No key, no user id.
create or replace function bot.session_json(p_s bot.sessions, p_role text, p_now timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'sid', p_s.sid, 'kind', p_s.kind, 'status', p_s.status,
    'container_id', p_s.container_id, 'subject_id', p_s.subject_id,
    'exam_title', coalesce((select c.title from public.containers c where c.id = p_s.container_id), p_s.exam_title),
    'subject_title', (select s.title from public.container_subjects s where s.id = p_s.subject_id),
    'role', p_role, 'local_day', p_s.local_day, 'position', p_s.position,
    'length', pg_catalog.cardinality(p_s.items),
    'queue', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', u.i, 'retry', u.r)
                                                   order by u.o), '[]'::jsonb)
                from rows from (pg_catalog.unnest(p_s.items), pg_catalog.unnest(p_s.retry)) with ordinality u(i, r, o)),
    'answered', coalesce(p_s.pending is not null and (p_s.pending ->> 'pos')::integer = p_s.position, false),
    'chat_id', p_s.chat_id, 'message_id', p_s.message_id,
    'counts', bot.session_counts_json(p_s.counts), 'figure', bot.session_figure_json(p_s.figure),
    'created_at', p_s.created_at, 'active_at', p_s.active_at, 'finished_at', p_s.finished_at, 'now', p_now)
$fn$;

-- 2o. VIEW: the current question in the shown order (spec §6.3: the text and the options without the key). review
--     only once it is answered: the student's choice and the file's key in SHOWN indices (short: the accepted forms),
--     the flags, the core's status and step, key_source and the moment of the key's change («Ключ исправлен автором
--     16 октября.», «В файле ответ не был выделен — ключ поставил автор.»). null when there is no current question.
create or replace function bot.session_view_json(p_s bot.sessions)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_item public.test_items%rowtype;
  v_topics jsonb;
  v_pos integer := p_s.position;
  v_cell jsonb;
  v_order jsonb;
  v_p jsonb := p_s.pending;
  v_review jsonb;
begin
  if p_s.sid is null or p_s.status <> 'open' or v_pos >= pg_catalog.cardinality(p_s.items) then
    return null;
  end if;
  select i.* into v_item from public.test_items i where i.id = p_s.items[v_pos + 1];
  if v_item.id is null then
    return null;
  end if;
  select s.topics into v_topics from public.container_subjects s where s.id = v_item.subject_id;
  v_cell := coalesce(p_s.shown -> v_pos, '{}'::jsonb);
  v_order := case when v_item.kind = 'short' then '[]'::jsonb else coalesce(v_cell -> 'o', '[]'::jsonb) end;
  if v_p is not null and (v_p ->> 'pos')::integer = v_pos then
    v_review := pg_catalog.jsonb_build_object(
      'correct', coalesce((v_p ->> 'correct')::boolean, false),
      'dont_know', coalesce((v_p ->> 'dont_know')::boolean, false),
      'choice', coalesce(v_p -> 'choice', '[]'::jsonb),
      'text', v_p -> 'text',
      'key', (select coalesce(pg_catalog.jsonb_agg(o.ord - 1 order by o.ord), '[]'::jsonb)
                from pg_catalog.jsonb_array_elements_text(v_order) with ordinality o(f, ord)
               where o.f::smallint = any (v_item.correct)),
      'answers', pg_catalog.to_jsonb(v_item.answers),
      'recorded', coalesce((v_p ->> 'recorded')::boolean, false),
      'misclick', coalesce((v_p ->> 'misclick')::boolean, false),
      'doubt', coalesce((v_p ->> 'doubt')::boolean, false),
      'status', v_p -> 'status', 'step', v_p -> 'step',
      'key_source', v_item.key_source,
      'key_changed_at', (select pg_catalog.max(k.changed_at) from public.test_item_key_changes k
                          where k.item_id = v_item.id and k.rev = v_item.rev));
  end if;
  return pg_catalog.jsonb_build_object(
    'pos', v_pos, 'item_id', v_item.id, 'rev', coalesce(v_cell -> 'r', pg_catalog.to_jsonb(v_item.rev)),
    'kind', v_item.kind, 'code', v_item.code, 'keep_order', v_item.keep_order, 'stem', v_item.stem,
    'options', (select coalesce(pg_catalog.jsonb_agg(v_item.options -> (o.f::integer) order by o.ord), '[]'::jsonb)
                  from pg_catalog.jsonb_array_elements_text(v_order) with ordinality o(f, ord)),
    'order', v_order, 'file_no', v_item.file_no, 'number', v_item.position, 'topic', v_item.topic,
    'topic_title', case when v_item.topic is not null then v_topics ->> (v_item.topic - 1) end,
    'retry', p_s.retry[v_pos + 1], 'review', v_review);
end;
$fn$;

-- 2p. The reply of a session call once the session is found: {status, …p_extra, session, view}.
create or replace function bot.session_reply(p_status text, p_s bot.sessions, p_role text, p_now timestamptz,
                                             p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object('status', p_status) || coalesce(p_extra, '{}'::jsonb)
      || pg_catalog.jsonb_build_object('session', bot.session_json(p_s, p_role, p_now),
                                       'view', bot.session_view_json(p_s))
$fn$;

-- 2q. A refusal of a session call: unavailable names the exam («Экзамен «…» больше недоступен — занятие закрыто.»);
--     ended and unavailable carry the session as it was closed (view null).
create or replace function bot.session_refusal(p_status text, p_s bot.sessions, p_role text, p_now timestamptz,
                                               p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object('status', p_status) || coalesce(p_extra, '{}'::jsonb)
      || case when p_status = 'unavailable'
              then pg_catalog.jsonb_build_object('exam_title',
                     coalesce((select c.title from public.containers c where c.id = p_s.container_id), p_s.exam_title))
              else '{}'::jsonb end
      || case when p_s.sid is not null and p_status in ('ended', 'unavailable')
              then pg_catalog.jsonb_build_object('session', bot.session_json(p_s, p_role, p_now), 'view', null)
              else '{}'::jsonb end
$fn$;

-- 2r. The common start of a session call: the user only through bot.active_link (spec decision 3), then the session
--     by sid AND that user, locked (the presses of one session run one after another: a double tap waits, then finds
--     the first tap's state). status: ok | unlinked | not_found (no such sid for this user: unknown, cleaned up or
--     someone else's) | ended (finished or abandoned; a session whose day has passed is closed here, its waiting answer
--     recorded as given) | unavailable (the user lost the exam: closed, nothing recorded). Marks the user as seen in
--     bot.links (an action in the bot: the day card waits 30 minutes after it, as after bot_whoami).
create or replace function bot.session_take(p_tg_user_id bigint, p_sid text, p_now timestamptz, p_today_only boolean,
                                            out o_status text, out o_s bot.sessions, out o_l bot.links,
                                            out o_role text)
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  select * into o_l from bot.active_link(p_tg_user_id);
  if o_l.id is null then
    o_status := 'unlinked';
    return;
  end if;
  update bot.links l set last_seen_at = p_now where l.id = o_l.id;
  if p_sid is null or p_sid !~ '^[0-9a-z]{8}$' then
    o_status := 'not_found';
    return;
  end if;
  select s.* into o_s from bot.sessions s where s.sid = p_sid and s.user_id = o_l.user_id for update;
  if o_s.sid is null then
    o_status := 'not_found';
    return;
  end if;
  o_role := meldy_private.role_in(o_l.user_id, o_s.container_id);
  if o_s.status <> 'open' then
    o_status := 'ended';
    return;
  end if;
  if o_role is null then
    o_s := bot.session_close(o_s, 'abandoned', false, p_now);
    perform bot.session_save(o_s);
    o_status := 'unavailable';
    return;
  end if;
  if not bot.session_live(o_s, o_l.tz, p_now, p_today_only) then
    o_s := bot.session_close(o_s, 'abandoned', true, p_now);
    perform bot.session_save(o_s);
    o_status := 'ended';
    return;
  end if;
  o_status := 'ok';
end;
$fn$;

-- 2s. The session with the queue the function computed after an answer (spec §6.3: afterAnswer of session.ts), or
--     null when it does not fit. p_queue = [{id, retry, shown?}] (1..60). The answered part and the current question
--     stay as they are; the kept entries keep their order (with their class, order, rev and show time); the one new
--     entry allowed is the repeat of the current question ((id, retry + 1) after it, its new option order in
--     `shown`); only later entries of the current question may be left out.
create or replace function bot.session_requeue(p_s bot.sessions, p_queue jsonb)
returns bot.sessions
language plpgsql
stable
set search_path = ''
as $fn$
declare
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_pos integer := p_s.position;
  v_cur uuid := p_s.items[p_s.position + 1];
  v_cur_retry smallint := p_s.retry[p_s.position + 1];
  v_items uuid[] := '{}'::uuid[];
  v_retry smallint[] := '{}'::smallint[];
  v_cls text[] := '{}'::text[];
  v_shown jsonb := '[]'::jsonb;
  v_at timestamptz[] := '{}'::timestamptz[];
  v_seen text[] := '{}'::text[];
  v_e jsonb;
  v_k integer;
  v_id uuid;
  v_r smallint;
  v_idx integer;
  v_last integer := -1;
  v_item public.test_items%rowtype;
  v_n integer;
  v_order jsonb;
begin
  if p_queue is null or pg_catalog.jsonb_typeof(p_queue) <> 'array'
     or pg_catalog.jsonb_array_length(p_queue) not between 1 and 60 then
    return null;
  end if;
  for v_e, v_k in select q.value, (q.ord - 1)::integer
                    from pg_catalog.jsonb_array_elements(p_queue) with ordinality q(value, ord) loop
    if pg_catalog.jsonb_typeof(v_e) <> 'object' or coalesce(v_e ->> 'id', '') !~* c_uuid
       or (v_e ? 'retry' and (pg_catalog.jsonb_typeof(v_e -> 'retry') <> 'number'
                              or (v_e ->> 'retry') !~ '^[0-2]$')) then
      return null;
    end if;
    v_id := (v_e ->> 'id')::uuid;
    v_r := coalesce((v_e ->> 'retry')::smallint, 0::smallint);
    if (v_id::text || ':' || v_r::text) = any (v_seen) then
      return null;
    end if;
    v_seen := v_seen || (v_id::text || ':' || v_r::text);
    v_idx := null;
    select (u.o - 1)::integer into v_idx
      from rows from (pg_catalog.unnest(p_s.items), pg_catalog.unnest(p_s.retry)) with ordinality u(i, r, o)
     where u.i = v_id and u.r = v_r;
    if v_k <= v_pos and v_idx is distinct from v_k then
      return null;
    end if;
    if v_idx is not null then
      if v_idx <= v_last then
        return null;
      end if;
      v_last := v_idx;
      v_items := v_items || v_id;
      v_retry := v_retry || v_r;
      v_cls := v_cls || p_s.cls[v_idx + 1];
      v_shown := v_shown || pg_catalog.jsonb_build_array(p_s.shown -> v_idx);
      v_at := v_at || p_s.shown_at[v_idx + 1];
    else
      if v_id <> v_cur or v_r <> v_cur_retry + 1 or v_k <= v_pos then
        return null;
      end if;
      v_item := null;
      select i.* into v_item from public.test_items i where i.id = v_id;
      if v_item.id is null then
        return null;
      end if;
      v_n := case when v_item.kind = 'short' then 0 else pg_catalog.jsonb_array_length(v_item.options) end;
      v_order := coalesce(v_e -> 'shown', case when v_n = 0 then '[]'::jsonb end);
      if not bot.session_order_ok(v_order, v_n) then
        return null;
      end if;
      v_items := v_items || v_id;
      v_retry := v_retry || v_r;
      v_cls := v_cls || p_s.cls[v_pos + 1];
      v_shown := v_shown || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('o', v_order, 'r', null));
      v_at := v_at || null::timestamptz;
    end if;
  end loop;
  if exists (select 1
               from rows from (pg_catalog.unnest(p_s.items), pg_catalog.unnest(p_s.retry)) with ordinality u(i, r, o)
              where u.o - 1 > v_pos and u.i <> v_cur and not ((u.i::text || ':' || u.r::text) = any (v_seen))) then
    return null;
  end if;
  p_s.items := v_items;
  p_s.retry := v_retry;
  p_s.cls := v_cls;
  p_s.shown := v_shown;
  p_s.shown_at := v_at;
  return p_s;
end;
$fn$;

-- 2t. Leaves out the entries after p_after of one question (p_retry null: all of them; else that one repeat).
--     Positions up to p_after keep their meaning (tg:<sid>:<pos> of answers already given).
create or replace function bot.session_drop(p_s bot.sessions, p_after integer, p_id uuid, p_retry smallint)
returns bot.sessions
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_keep integer[];
begin
  select pg_catalog.array_agg(u.o::integer order by u.o) into v_keep
    from rows from (pg_catalog.unnest(p_s.items), pg_catalog.unnest(p_s.retry)) with ordinality u(i, r, o)
   where not (u.o - 1 > p_after and u.i = p_id and (p_retry is null or u.r = p_retry));
  if pg_catalog.cardinality(v_keep) = pg_catalog.cardinality(p_s.items) then
    return p_s;
  end if;
  p_s.items := array(select p_s.items[x.k] from pg_catalog.unnest(v_keep) with ordinality x(k, o) order by x.o);
  p_s.retry := array(select p_s.retry[x.k] from pg_catalog.unnest(v_keep) with ordinality x(k, o) order by x.o);
  p_s.cls := array(select p_s.cls[x.k] from pg_catalog.unnest(v_keep) with ordinality x(k, o) order by x.o);
  p_s.shown_at := array(select p_s.shown_at[x.k] from pg_catalog.unnest(v_keep) with ordinality x(k, o) order by x.o);
  p_s.shown := (select pg_catalog.jsonb_agg(p_s.shown -> (x.k - 1) order by x.o)
                  from pg_catalog.unnest(v_keep) with ordinality x(k, o));
  return p_s;
end;
$fn$;

-- 2u. The tick's hook (T1's bot.tick_due in the saving mode): may bot_flush_pending have work — a pending answer older
--     than 30 minutes? An index-backed EXISTS (sessions_flush_idx).
create or replace function bot.tick_due_sessions(p_now timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (select 1 from bot.sessions s where s.pending_at < p_now - interval '30 minutes')
$fn$;

-- 3. The bot's functions (service role only; spec §6.3 «занятие»). Shapes and the order of calls: CONTRACT_T5.md.
-- 3a. Before «Начать»: what the function's optionOrder needs for the questions of the queue it built (kind,
--     keep_order, the options in file order), never the key; only items of this exam with a key. status: ok | unlinked
--     | unavailable (not the user's exam) | invalid.
create or replace function public.bot_session_items(p_tg_user_id bigint, p_container_id uuid, p_item_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_l bot.links%rowtype;
begin
  perform meldy_private.require_service_role();
  select * into v_l from bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_container_id is null or p_item_ids is null or pg_catalog.array_ndims(p_item_ids) is distinct from 1
     or pg_catalog.cardinality(p_item_ids) not between 1 and 60 then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'arguments');
  end if;
  if meldy_private.role_in(v_l.user_id, p_container_id) is null then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'items', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', i.id, 'subject_id', i.subject_id, 'kind', i.kind, 'keep_order', i.keep_order, 'code', i.code,
             'rev', i.rev, 'options', i.options) order by x.o), '[]'::jsonb)
      from pg_catalog.unnest(p_item_ids) with ordinality x(id, o)
      join public.test_items i on i.id = x.id
     where i.container_id = p_container_id and i.keyed));
end;
$fn$;

-- 3b. «Начать» / «Ещё 20 вопросов» / «Дальше: …» / «Только ошибки» / «Ещё 20 новых» (spec §4.3): a new session.
--     p_sid = the seed the function drew (8 × [0-9a-z]); p_queue = buildSession's questions in order, [{id, cls?,
--     shown}] (1..20; shown = optionOrder's file indices in display order, [] for a short answer); p_message_id = the
--     card that becomes the session (null when the function sends a new message: then bot_session_move); p_figure =
--     {in_plan, two_days} of the exam from the plan («N из M»). Questions of another subject, deleted or without a key
--     are left out (all of them: empty). One open session per user: the previous one is closed (abandoned), its
--     waiting answer recorded as given (replaced = its sid, chat and message). The same card pressed twice, or the
--     same call again: the session already there comes back (resumed). status: ok | unlinked | unavailable | invalid
--     (+ reason: arguments, subject, queue, shown) | conflict (the sid is taken: draw another) | empty.
create or replace function public.bot_session_start(p_tg_user_id bigint, p_sid text, p_container_id uuid,
                                                    p_subject_id uuid, p_kind text, p_queue jsonb,
                                                    p_message_id bigint default null, p_figure jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  c_cls constant text[] := array['relearn', 'confirm', 'new_floor', 'confirm_ai', 'start_ai', 'check', 'final',
                                 'new_fill', 'free'];
  c_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_role text;
  v_s bot.sessions%rowtype;
  v_old bot.sessions%rowtype;
  v_replaced jsonb;
  v_e jsonb;
  v_item public.test_items%rowtype;
  v_items uuid[] := '{}'::uuid[];
  v_retry smallint[] := '{}'::smallint[];
  v_cls text[] := '{}'::text[];
  v_shown jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}'::uuid[];
  v_n integer;
  v_order jsonb;
  v_figure jsonb;
begin
  perform meldy_private.require_service_role();
  select * into v_l from bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  update bot.links l set last_seen_at = v_now where l.id = v_l.id;
  if p_sid is null or p_sid !~ '^[0-9a-z]{8}$' or p_container_id is null or p_subject_id is null
     or p_kind is null or p_kind not in ('plan', 'errors', 'extra') or p_queue is null
     or pg_catalog.jsonb_typeof(p_queue) <> 'array' or pg_catalog.jsonb_array_length(p_queue) not between 1 and 20
     or (p_message_id is not null and p_message_id <= 0) then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'arguments');
  end if;
  v_role := meldy_private.role_in(v_l.user_id, p_container_id);
  if v_role is null then
    return pg_catalog.jsonb_build_object('status', 'unavailable',
      'exam_title', (select c.title from public.containers c where c.id = p_container_id));
  end if;
  if not exists (select 1 from public.container_subjects s
                  where s.id = p_subject_id and s.container_id = p_container_id) then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'subject');
  end if;
  -- One user's starts in turn: the open session is replaced once, never twice at the same moment.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bot.sessions:' || v_l.user_id::text, 0));
  -- The same call again, or the same card pressed twice: the session that already lives there comes back.
  select s.* into v_old from bot.sessions s
   where s.user_id = v_l.user_id and s.status = 'open'
     and (s.sid = p_sid or (p_message_id is not null and s.chat_id = v_l.chat_id and s.message_id = p_message_id))
     for update;
  if v_old.sid is not null and bot.session_live(v_old, v_l.tz, v_now, false) then
    v_old := bot.session_stamp(v_old, v_now);
    v_old.active_at := v_now;
    perform bot.session_save(v_old);
    return bot.session_reply('ok', v_old, v_role, v_now,
                             pg_catalog.jsonb_build_object('resumed', true, 'replaced', null));
  end if;
  if exists (select 1 from bot.sessions s where s.sid = p_sid) then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;
  -- The queue as the function built it: questions of this subject with a key, each with its option order.
  for v_e in select q.value from pg_catalog.jsonb_array_elements(p_queue) q loop
    if pg_catalog.jsonb_typeof(v_e) <> 'object' or coalesce(v_e ->> 'id', '') !~* c_uuid
       or (v_e ? 'retry' and v_e -> 'retry' <> '0'::jsonb)
       or (v_e ? 'cls' and pg_catalog.jsonb_typeof(v_e -> 'cls') not in ('string', 'null')) then
      return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'queue');
    end if;
    if (v_e ->> 'id')::uuid = any (v_seen) then
      return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'queue');
    end if;
    v_seen := v_seen || (v_e ->> 'id')::uuid;
    v_item := null;
    select i.* into v_item from public.test_items i
     where i.id = (v_e ->> 'id')::uuid and i.subject_id = p_subject_id and i.container_id = p_container_id
       and i.keyed;
    if v_item.id is null then
      continue;   -- deleted, changed or of another subject since the plan was read: left out
    end if;
    v_n := case when v_item.kind = 'short' then 0 else pg_catalog.jsonb_array_length(v_item.options) end;
    v_order := coalesce(v_e -> 'shown', case when v_n = 0 then '[]'::jsonb end);
    if not bot.session_order_ok(v_order, v_n) then
      if pg_catalog.jsonb_typeof(v_order) = 'array'
         and bot.session_order_ok(v_order, pg_catalog.jsonb_array_length(v_order)) then
        v_order := bot.session_identity(v_n);   -- well formed for another number of options: the item changed since
      else
        return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'shown');
      end if;
    end if;
    v_items := v_items || v_item.id;
    v_retry := v_retry || 0::smallint;
    v_cls := v_cls || case when (v_e ->> 'cls') = any (c_cls) then v_e ->> 'cls' else 'free' end;
    v_shown := v_shown || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('o', v_order, 'r', null));
  end loop;
  if pg_catalog.cardinality(v_items) = 0 then
    return pg_catalog.jsonb_build_object('status', 'empty');
  end if;
  -- One open session per user: the previous one ends here, its waiting answer recorded as given.
  for v_old in select s.* from bot.sessions s where s.user_id = v_l.user_id and s.status = 'open' for update loop
    v_old := bot.session_close(v_old, 'abandoned', true, v_now);
    perform bot.session_save(v_old);
    v_replaced := pg_catalog.jsonb_build_object('sid', v_old.sid, 'chat_id', v_old.chat_id,
                                                'message_id', v_old.message_id);
  end loop;
  v_figure := pg_catalog.jsonb_build_object(
    'in_plan', case when pg_catalog.jsonb_typeof(p_figure -> 'in_plan') = 'number'
                         and (p_figure ->> 'in_plan') ~ '^\d{1,6}$' then (p_figure ->> 'in_plan')::integer end,
    'two_days', case when pg_catalog.jsonb_typeof(p_figure -> 'two_days') = 'number'
                          and (p_figure ->> 'two_days') ~ '^\d{1,6}$' then (p_figure ->> 'two_days')::integer end,
    'gained', '[]'::jsonb, 'dropped', '[]'::jsonb, 'started', '[]'::jsonb, 'too_early', '{}'::jsonb);
  insert into bot.sessions (sid, user_id, link_id, chat_id, message_id, container_id, subject_id, kind, local_day,
                            items, retry, cls, shown, shown_at, position, counts, figure, status, exam_title,
                            created_at, active_at)
  values (p_sid, v_l.user_id, v_l.id, v_l.chat_id, p_message_id, p_container_id, p_subject_id, p_kind,
          bot.local_day(v_l.tz, v_now), v_items, v_retry, v_cls, v_shown,
          pg_catalog.array_fill(null::timestamptz, array[pg_catalog.cardinality(v_items)]), 0, '{}'::jsonb, v_figure,
          'open', (select pg_catalog.left(c.title, 200) from public.containers c where c.id = p_container_id),
          v_now, v_now)
  on conflict (sid) do nothing
  returning * into v_s;
  if v_s.sid is null then
    return pg_catalog.jsonb_build_object('status', 'conflict');
  end if;
  v_s := bot.session_stamp(v_s, v_now);
  perform bot.session_save(v_s);
  return bot.session_reply('ok', v_s, v_role, v_now,
                           pg_catalog.jsonb_build_object('resumed', false, 'replaced', v_replaced));
end;
$fn$;

-- 3c. The current question again: before «Дальше» (the queue and the order for afterAnswer), «Сомневаюсь в ключе»
--     and «Отмена» (the review again), a message to edit that was deleted. p_pos (optional) = the press's position:
--     another one → old (+ what was recorded there). status: ok | old | unlinked | not_found | ended | unavailable.
create or replace function public.bot_session_view(p_tg_user_id bigint, p_sid text, p_pos integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_t record;
  v_s bot.sessions%rowtype;
begin
  perform meldy_private.require_service_role();
  select * into v_t from bot.session_take(p_tg_user_id, p_sid, v_now, false);
  if v_t.o_status <> 'ok' then
    return bot.session_refusal(v_t.o_status, v_t.o_s, v_t.o_role, v_now);
  end if;
  v_s := bot.session_stamp(v_t.o_s, v_now);
  v_s.active_at := v_now;
  perform bot.session_save(v_s);
  if p_pos is not null and p_pos <> v_s.position then
    return bot.session_reply('old', v_s, v_t.o_role, v_now,
                             pg_catalog.jsonb_build_object('answer', bot.session_logged(v_s.user_id, v_s.sid, p_pos)));
  end if;
  return bot.session_reply('ok', v_s, v_t.o_role, v_now);
end;
$fn$;

-- 3d. An answer (spec §6.3 «Ответ в занятии»). p_choice: {"i": <shown index>} (single), {"mask": <bit k = the option
--     shown k-th>} («Ответить» of a multiple), {"text": "…"} (a short answer typed as a message), {"dont_know": true}
--     («Не знаю»). A typed message passes p_sid = p_pos = null: the open session's current question, when it is a short
--     one. Locks the session; checks its owner, the position and the range; maps the shown index to the file's; grades
--     with test_items.correct (short: the container's normalisation). Right → recorded at once (tg:<sid>:<pos>, source
--     bot, local_date in the link's zone, ms ≤ 180 s, cls, retry, session) and the next question comes in the same
--     reply (a short answer stays with its result until «Дальше»); wrong / «Не знаю» → pending, nothing recorded, the
--     review carries the key. stale (the author changed the key after the question was shown) and gone (deleted) are
--     not recorded: the next question comes. status: ok | repeat (this question is answered already: the first answer
--     stands) | old (+ what was recorded at that position) | invalid (+ reason: choice) | no_question (a typed message,
--     but no short question waits for it) | unlinked | not_found | ended | unavailable.
create or replace function public.bot_session_answer(p_tg_user_id bigint, p_sid text, p_pos integer, p_choice jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_t record;
  v_s bot.sessions%rowtype;
  v_sid text := p_sid;
  v_pos integer;
  v_item public.test_items%rowtype;
  v_n integer;
  v_order jsonb;
  v_rev integer;
  v_keys text[];
  v_choice integer[];
  v_chosen integer[];
  v_text text;
  v_dont boolean := false;
  v_mask integer;
  v_el jsonb;
  v_g record;
  v_ms integer;
  v_answer jsonb;
begin
  perform meldy_private.require_service_role();
  if p_sid is null then
    -- a typed message: the open session of this Telegram user's account, if any
    select * into v_l from bot.active_link(p_tg_user_id);
    if v_l.id is null then
      return pg_catalog.jsonb_build_object('status', 'unlinked');
    end if;
    select s.sid into v_sid from bot.sessions s where s.user_id = v_l.user_id and s.status = 'open';
    if v_sid is null then
      return pg_catalog.jsonb_build_object('status', 'no_question');
    end if;
  end if;
  select * into v_t from bot.session_take(p_tg_user_id, v_sid, v_now, false);
  if v_t.o_status <> 'ok' then
    if p_sid is null and v_t.o_status = 'ended' then
      return pg_catalog.jsonb_build_object('status', 'no_question');
    end if;
    return bot.session_refusal(v_t.o_status, v_t.o_s, v_t.o_role, v_now,
      case when v_t.o_status = 'ended' and p_pos is not null
           then pg_catalog.jsonb_build_object('answer', bot.session_logged((v_t.o_s).user_id, v_sid, p_pos))
           else '{}'::jsonb end);
  end if;
  v_s := v_t.o_s;
  v_pos := case when p_sid is null then v_s.position else p_pos end;
  if v_pos is null or v_pos <> v_s.position then
    v_s := bot.session_stamp(v_s, v_now);
    v_s.active_at := v_now;
    perform bot.session_save(v_s);
    return bot.session_reply('old', v_s, v_t.o_role, v_now,
                             pg_catalog.jsonb_build_object('answer', bot.session_logged(v_s.user_id, v_s.sid, v_pos)));
  end if;
  v_item := null;
  select i.* into v_item from public.test_items i where i.id = v_s.items[v_pos + 1];
  -- A typed message counts only while the current question is a short one.
  if p_sid is null and (v_item.id is null or v_item.kind <> 'short') then
    return pg_catalog.jsonb_build_object('status', 'no_question');
  end if;
  -- This question is answered already (a double tap, a second message): the first answer stands.
  if v_s.pending is not null and (v_s.pending ->> 'pos')::integer = v_pos then
    return bot.session_reply('repeat', v_s, v_t.o_role, v_now);
  end if;
  v_s.active_at := v_now;
  -- Gone (deleted, without a key) or changed since it was shown (stale): not recorded, the next question comes.
  v_rev := coalesce((v_s.shown -> v_pos ->> 'r')::integer, v_item.rev);
  if v_item.id is null or v_item.container_id <> v_s.container_id or not v_item.keyed or v_rev <> v_item.rev then
    v_answer := pg_catalog.jsonb_build_object('status',
      case when v_item.id is not null and v_item.container_id = v_s.container_id and v_item.keyed then 'stale'
           else 'gone' end);
    v_s.counts := bot.session_count(v_s.counts, v_answer ->> 'status');
    v_s.position := v_pos + 1;
    v_s := bot.session_stamp(v_s, v_now);
    perform bot.session_save(v_s);
    return bot.session_reply('ok', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('answer', v_answer));
  end if;
  -- The choice in shown indices, mapped through the order the question was shown in.
  v_n := case when v_item.kind = 'short' then 0 else pg_catalog.jsonb_array_length(v_item.options) end;
  v_order := v_s.shown -> v_pos -> 'o';
  if not bot.session_order_ok(v_order, v_n) then
    v_order := bot.session_identity(v_n);
  end if;
  if p_choice is null or pg_catalog.jsonb_typeof(p_choice) <> 'object' then
    return bot.session_reply('invalid', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('reason', 'choice'));
  end if;
  select pg_catalog.array_agg(k) into v_keys from pg_catalog.jsonb_object_keys(p_choice) k;
  if coalesce(pg_catalog.cardinality(v_keys), 0) <> 1 then
    return bot.session_reply('invalid', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('reason', 'choice'));
  end if;
  if v_keys[1] = 'dont_know' and p_choice -> 'dont_know' = 'true'::jsonb then
    v_dont := true;
    v_choice := '{}'::integer[];
    v_chosen := '{}'::integer[];
  elsif v_keys[1] = 'i' and v_item.kind = 'single' and pg_catalog.jsonb_typeof(p_choice -> 'i') = 'number'
        and (p_choice ->> 'i') ~ '^[0-7]$' and (p_choice ->> 'i')::integer < v_n then
    v_choice := array[(p_choice ->> 'i')::integer];
    v_chosen := array[(v_order ->> (p_choice ->> 'i')::integer)::integer];
  elsif v_keys[1] = 'mask' and v_item.kind = 'multiple' and pg_catalog.jsonb_typeof(p_choice -> 'mask') = 'number'
        and (p_choice ->> 'mask') ~ '^[0-9]{1,3}$'
        and (p_choice ->> 'mask')::integer between 1 and (1 << v_n) - 1 then
    v_mask := (p_choice ->> 'mask')::integer;
    select pg_catalog.array_agg(k order by k),
           pg_catalog.array_agg((v_order ->> k)::integer order by (v_order ->> k)::integer)
      into v_choice, v_chosen
      from pg_catalog.generate_series(0, v_n - 1) k
     where (v_mask >> k) & 1 = 1;
  elsif v_keys[1] = 'text' and v_item.kind = 'short' and pg_catalog.jsonb_typeof(p_choice -> 'text') = 'string'
        and pg_catalog.char_length(p_choice ->> 'text') <= 1000
        and public.meldy_short_norm(p_choice ->> 'text') <> '' then
    v_text := p_choice ->> 'text';
    v_choice := '{}'::integer[];
    v_chosen := '{}'::integer[];
  else
    return bot.session_reply('invalid', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('reason', 'choice'));
  end if;
  -- The verdict: the container's own grading against the key in file order.
  v_el := case when v_item.kind = 'short'
                 then pg_catalog.jsonb_build_object('text', case when v_dont then 'null'::jsonb
                                                                 else pg_catalog.to_jsonb(v_text) end)
               when v_dont then pg_catalog.jsonb_build_object('chosen', 'null'::jsonb, 'shown_order', v_order)
               when v_item.kind = 'single'
                 then pg_catalog.jsonb_build_object('chosen', v_chosen[1], 'shown_order', v_order)
               else pg_catalog.jsonb_build_object('chosen', pg_catalog.to_jsonb(v_chosen), 'shown_order', v_order) end;
  select * into v_g from meldy_private.grade_answer(v_item.kind, v_n, v_item.correct, v_item.answers, v_el);
  if not v_g.o_valid then
    return bot.session_reply('invalid', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('reason', 'choice'));
  end if;
  v_ms := case when v_s.shown_at[v_pos + 1] is not null
               then least(180000, greatest(0, pg_catalog.floor(
                      extract(epoch from (v_now - v_s.shown_at[v_pos + 1])) * 1000)))::integer end;
  v_s.pending := pg_catalog.jsonb_build_object(
    'pos', v_pos, 'item_id', v_item.id, 'rev', v_item.rev, 'kind', v_item.kind,
    'choice', pg_catalog.to_jsonb(v_choice), 'chosen', pg_catalog.to_jsonb(v_chosen), 'text', v_text,
    'dont_know', v_dont, 'correct', v_g.o_correct, 'at', v_now,
    'local_date', pg_catalog.to_char(bot.local_day((v_t.o_l).tz, v_now), 'YYYY-MM-DD'), 'ms', v_ms,
    'cls', v_s.cls[v_pos + 1], 'retry', v_s.retry[v_pos + 1], 'order', v_order,
    'recorded', false, 'misclick', false, 'doubt', false);
  if v_g.o_correct then
    -- Right: to the core at once.
    v_s := bot.session_record(v_s, false);
    v_answer := pg_catalog.jsonb_build_object('status', v_s.pending -> 'status', 'correct', true, 'dont_know', false,
                                              'step', v_s.pending -> 'step');
    if (v_s.pending ->> 'status') not in ('saved', 'late', 'duplicate') or v_item.kind <> 'short' then
      -- «Верно.» and the next question in the same edit (or the question changed under the press: the next one)
      v_s.pending := null;
      v_s.position := v_pos + 1;
    end if;                             -- a short answer stays with «Верно: …» until «Дальше»
    v_s := bot.session_stamp(v_s, v_now);
  else
    -- Wrong or «Не знаю»: waits for «Дальше» / «Нажали не туда?» / the doubt (spec decision 16).
    v_s.pending_at := v_now;
    v_answer := pg_catalog.jsonb_build_object('status', 'pending', 'correct', false, 'dont_know', v_dont,
                                              'step', null);
  end if;
  perform bot.session_save(v_s);
  return bot.session_reply('ok', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('answer',
    v_answer || pg_catalog.jsonb_build_object('figure', bot.session_figure_json(v_s.figure) - 'too_early_states')));
end;
$fn$;

-- 3e. After an answer (spec §6.3). p_action:
--       next («Дальше»): the waiting answer recorded as given, then the next question. p_queue = afterAnswer's queue
--         ([{id, retry, shown?}], shown = the repeat's new option order): required when the answer was a counted miss
--         of a question not repeated twice yet (it must hold that repeat), optional otherwise; a repeat the answer
--         does not call for (right, misclick, set aside by the doubt, not recorded) is left out;
--       misclick («Нажали не туда?»): recorded with misclick; the question stays with its review; not for a typed
--         answer, not once the answer is recorded (the flush, the doubt);
--       skip: the function cannot show this question (over 4096 characters): the next one comes; counted.
--     status: ok | old | invalid (+ reason: action, no_answer, answered, recorded, correct, typed, queue) | unlinked |
--     not_found | ended | unavailable. Every reply once the session is found carries session and view (for queue:
--     what afterAnswer needs).
create or replace function public.bot_session_resolve(p_tg_user_id bigint, p_sid text, p_pos integer, p_action text,
                                                      p_queue jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_t record;
  v_s bot.sessions%rowtype;
  v_q bot.sessions%rowtype;
  v_p jsonb;
  v_pos integer;
  v_cur uuid;
  v_cur_retry smallint;
  v_answered boolean;
  v_expect boolean;
  v_has_new boolean;
  v_answer jsonb;
begin
  perform meldy_private.require_service_role();
  select * into v_t from bot.session_take(p_tg_user_id, p_sid, v_now, false);
  if v_t.o_status <> 'ok' then
    return bot.session_refusal(v_t.o_status, v_t.o_s, v_t.o_role, v_now);
  end if;
  v_s := v_t.o_s;
  v_pos := v_s.position;
  if p_action is null or p_action not in ('next', 'misclick', 'skip') then
    return bot.session_reply('invalid', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('reason', 'action'));
  end if;
  if p_pos is null or p_pos <> v_pos then
    v_s := bot.session_stamp(v_s, v_now);
    v_s.active_at := v_now;
    perform bot.session_save(v_s);
    return bot.session_reply('old', v_s, v_t.o_role, v_now,
                             pg_catalog.jsonb_build_object('answer', bot.session_logged(v_s.user_id, v_s.sid, p_pos)));
  end if;
  v_p := v_s.pending;
  v_answered := v_p is not null and (v_p ->> 'pos')::integer = v_pos;
  v_cur := v_s.items[v_pos + 1];
  v_cur_retry := v_s.retry[v_pos + 1];

  if p_action = 'misclick' then
    if not v_answered then
      return bot.session_reply('invalid', v_s, v_t.o_role, v_now, '{"reason": "no_answer"}'::jsonb);
    elsif coalesce((v_p ->> 'recorded')::boolean, false) then
      return bot.session_reply('invalid', v_s, v_t.o_role, v_now, '{"reason": "recorded"}'::jsonb);
    elsif coalesce((v_p ->> 'correct')::boolean, false) then
      return bot.session_reply('invalid', v_s, v_t.o_role, v_now, '{"reason": "correct"}'::jsonb);
    elsif v_p ->> 'kind' = 'short' and not coalesce((v_p ->> 'dont_know')::boolean, false) then
      return bot.session_reply('invalid', v_s, v_t.o_role, v_now, '{"reason": "typed"}'::jsonb);
    end if;
    v_s.active_at := v_now;
    v_s := bot.session_record(v_s, true);
    v_answer := pg_catalog.jsonb_build_object('status', v_s.pending -> 'status', 'correct', false,
                                              'dont_know', v_s.pending -> 'dont_know', 'misclick', true,
                                              'step', v_s.pending -> 'step');
    perform bot.session_save(v_s);
    return bot.session_reply('ok', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('answer', v_answer));
  end if;

  if p_action = 'skip' then
    if v_answered then
      return bot.session_reply('invalid', v_s, v_t.o_role, v_now, '{"reason": "answered"}'::jsonb);
    end if;
    v_s.active_at := v_now;
    v_s.counts := bot.session_count(v_s.counts, 'skipped');
    v_s.position := v_pos + 1;
    v_s := bot.session_stamp(v_s, v_now);
    perform bot.session_save(v_s);
    return bot.session_reply('ok', v_s, v_t.o_role, v_now, '{"answer": null}'::jsonb);
  end if;

  -- next
  if not v_answered then
    return bot.session_reply('invalid', v_s, v_t.o_role, v_now, '{"reason": "no_answer"}'::jsonb);
  end if;
  -- The queue first: nothing is recorded when it does not fit.
  if p_queue is not null then
    v_q := bot.session_requeue(v_s, p_queue);
    if v_q.sid is null then
      return bot.session_reply('invalid', v_s, v_t.o_role, v_now, '{"reason": "queue"}'::jsonb);
    end if;
  else
    v_q := v_s;
  end if;
  v_has_new := exists (
    select 1 from rows from (pg_catalog.unnest(v_q.items), pg_catalog.unnest(v_q.retry)) with ordinality u(i, r, o)
     where u.o - 1 > v_pos and u.i = v_cur and u.r = v_cur_retry + 1);
  v_expect := not coalesce((v_p ->> 'correct')::boolean, false) and not coalesce((v_p ->> 'misclick')::boolean, false)
              and not coalesce((v_p ->> 'doubt')::boolean, false)
              and coalesce(v_p ->> 'status', 'saved') in ('saved', 'late', 'duplicate') and v_cur_retry < 2;
  if v_expect and not v_has_new then
    return bot.session_reply('invalid', v_s, v_t.o_role, v_now, '{"reason": "queue"}'::jsonb);
  end if;
  v_s := v_q;
  v_s.active_at := v_now;
  if not coalesce((v_p ->> 'recorded')::boolean, false) then
    v_s := bot.session_record(v_s, false);
    v_answer := pg_catalog.jsonb_build_object('status', v_s.pending -> 'status', 'correct', v_s.pending -> 'correct',
                                              'dont_know', v_s.pending -> 'dont_know', 'misclick', false,
                                              'step', v_s.pending -> 'step');
    if (v_s.pending ->> 'status') not in ('saved', 'late', 'duplicate') then
      v_expect := false;               -- not recorded after all (stale, gone): no repeat in this session
    end if;
  end if;
  if not v_expect and v_has_new then
    -- no repeat after a right answer, a misclick, the doubt (set aside) or an answer the core did not record
    v_s := bot.session_drop(v_s, v_pos, v_cur, (v_cur_retry + 1)::smallint);
  end if;
  v_s.pending := null;
  v_s.pending_at := null;
  v_s.position := v_pos + 1;
  v_s := bot.session_stamp(v_s, v_now);
  perform bot.session_save(v_s);
  return bot.session_reply('ok', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('answer', v_answer));
end;
$fn$;

-- 3f. «Закончить» (spec §4.4 I2): the waiting answer recorded as given and stepped over; the session stays open
--     («Продолжить: 8 из 20» today through bot_session_move) unless its queue is done (finished) or nothing was
--     answered (abandoned: «Начать» again). A finished session answers ok again (a double tap). status: ok | unlinked
--     | not_found | ended | unavailable.
create or replace function public.bot_session_finish(p_tg_user_id bigint, p_sid text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_t record;
  v_s bot.sessions%rowtype;
  v_answer jsonb;
begin
  perform meldy_private.require_service_role();
  select * into v_t from bot.session_take(p_tg_user_id, p_sid, v_now, false);
  if v_t.o_status = 'ended' and (v_t.o_s).status = 'finished' then
    return bot.session_reply('ok', v_t.o_s, v_t.o_role, v_now, '{"answer": null}'::jsonb);
  end if;
  if v_t.o_status <> 'ok' then
    return bot.session_refusal(v_t.o_status, v_t.o_s, v_t.o_role, v_now);
  end if;
  v_s := v_t.o_s;
  v_s.active_at := v_now;
  if v_s.pending is not null and (v_s.pending ->> 'pos')::integer = v_s.position then
    if not coalesce((v_s.pending ->> 'recorded')::boolean, false) then
      v_s := bot.session_record(v_s, false);
      v_answer := pg_catalog.jsonb_build_object('status', v_s.pending -> 'status', 'correct', v_s.pending -> 'correct',
                                                'dont_know', v_s.pending -> 'dont_know', 'misclick', false,
                                                'step', v_s.pending -> 'step');
    end if;
    v_s.pending := null;
    v_s.pending_at := null;
    v_s.position := v_s.position + 1;
  end if;
  if v_s.position >= pg_catalog.cardinality(v_s.items) then
    v_s.status := 'finished';
    v_s.finished_at := v_now;
  elsif (bot.session_counts_json(v_s.counts) ->> 'questions')::integer
        + (bot.session_counts_json(v_s.counts) ->> 'retries')::integer = 0 then
    v_s.status := 'abandoned';
    v_s.finished_at := v_now;
  end if;
  perform bot.session_save(v_s);
  return bot.session_reply('ok', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('answer', v_answer));
end;
$fn$;

-- 3g. The session moves to another message (spec §4.4 I3, §4.8): «Продолжить» on today's card or on the summary (the
--     same message), a new message after «Ещё 20 вопросов», a message to edit that was deleted. Only on the session's
--     own day. prev_message_id = the message it left (delete it, or edit it into «Занятие продолжено ниже.»). The
--     waiting answer stays as it is. status: ok | invalid | unlinked | not_found | ended | unavailable.
create or replace function public.bot_session_move(p_tg_user_id bigint, p_sid text, p_message_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_t record;
  v_s bot.sessions%rowtype;
  v_prev bigint;
begin
  perform meldy_private.require_service_role();
  if p_message_id is null or p_message_id <= 0 then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'message');
  end if;
  select * into v_t from bot.session_take(p_tg_user_id, p_sid, v_now, true);
  if v_t.o_status <> 'ok' then
    return bot.session_refusal(v_t.o_status, v_t.o_s, v_t.o_role, v_now);
  end if;
  v_s := v_t.o_s;
  v_prev := v_s.message_id;
  v_s.message_id := p_message_id;
  v_s.chat_id := (v_t.o_l).chat_id;
  v_s.active_at := v_now;
  v_s := bot.session_stamp(v_s, v_now);
  perform bot.session_save(v_s);
  return bot.session_reply('ok', v_s, v_t.o_role, v_now,
                           pg_catalog.jsonb_build_object('prev_message_id', nullif(v_prev, p_message_id)));
end;
$fn$;

-- 3h. «Сомневаюсь в ключе» → «Отметить» (spec §4.3 Z11, decision 17): the answer is recorded as given (once) and
--     meldy_private.test_key_doubt_for sets the question aside for this user (proposed = the chosen options in file
--     order; a comment only on the site); the question stays with its review until «Дальше», which gives it no
--     repeat. Again → ok, nothing new. status: ok | old | invalid (no_answer) | unlinked | not_found | ended |
--     unavailable.
create or replace function public.bot_key_doubt(p_tg_user_id bigint, p_sid text, p_pos integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_t record;
  v_s bot.sessions%rowtype;
  v_answer jsonb;
begin
  perform meldy_private.require_service_role();
  select * into v_t from bot.session_take(p_tg_user_id, p_sid, v_now, false);
  if v_t.o_status <> 'ok' then
    return bot.session_refusal(v_t.o_status, v_t.o_s, v_t.o_role, v_now);
  end if;
  v_s := v_t.o_s;
  if p_pos is null or p_pos <> v_s.position then
    return bot.session_reply('old', v_s, v_t.o_role, v_now,
                             pg_catalog.jsonb_build_object('answer', bot.session_logged(v_s.user_id, v_s.sid, p_pos)));
  end if;
  if v_s.pending is null or (v_s.pending ->> 'pos')::integer <> v_s.position then
    return bot.session_reply('invalid', v_s, v_t.o_role, v_now, '{"reason": "no_answer"}'::jsonb);
  end if;
  v_s.active_at := v_now;
  if not coalesce((v_s.pending ->> 'doubt')::boolean, false) then
    if not coalesce((v_s.pending ->> 'recorded')::boolean, false) then
      v_s := bot.session_record(v_s, false);
      v_answer := pg_catalog.jsonb_build_object('status', v_s.pending -> 'status', 'correct', v_s.pending -> 'correct',
                                                'dont_know', v_s.pending -> 'dont_know', 'misclick', false,
                                                'step', v_s.pending -> 'step');
    end if;
    begin
      perform meldy_private.test_key_doubt_for(v_s.user_id, (v_s.pending ->> 'item_id')::uuid,
                                               coalesce(v_s.pending -> 'chosen', '[]'::jsonb), '');
    exception when sqlstate 'P0002' then
      -- the question is gone meanwhile: it leaves the session
      v_s.counts := bot.session_count(v_s.counts, 'gone');
      v_s.pending := null;
      v_s.pending_at := null;
      v_s.position := v_s.position + 1;
      v_s := bot.session_stamp(v_s, v_now);
      perform bot.session_save(v_s);
      return bot.session_reply('ok', v_s, v_t.o_role, v_now, '{"answer": {"status": "gone"}}'::jsonb);
    end;
    v_s.pending := v_s.pending || '{"doubt": true}'::jsonb;
    v_s.counts := bot.session_count(v_s.counts, 'doubted');
  end if;
  perform bot.session_save(v_s);
  return bot.session_reply('ok', v_s, v_t.o_role, v_now, pg_catalog.jsonb_build_object('answer', v_answer));
end;
$fn$;

-- 3i. The tick's step 7 (spec §6.6): pending answers older than 30 minutes go to the core as given (the question stays
--     with its review; «Нажали не туда?» is no longer possible); open sessions idle for 30 minutes whose day has
--     passed or whose link has ended are closed (abandoned; an ended link records nothing); closed sessions go after
--     30 days. Bounded (200 / 200 / 500 a call); rows another call holds are skipped. p_now is for tests.
create or replace function public.bot_flush_pending(p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_s bot.sessions%rowtype;
  v_active boolean;
  v_flushed integer := 0;
  v_closed integer := 0;
  v_deleted integer := 0;
begin
  perform meldy_private.require_service_role();
  for v_s in select s.* from bot.sessions s
              where s.pending_at < v_now - interval '30 minutes'
              order by s.pending_at
              limit 200
                for update skip locked loop
    v_active := exists (select 1 from bot.links l where l.id = v_s.link_id and l.unlinked_at is null);
    if v_active then
      v_s := bot.session_record(v_s, false);
    else
      v_s := bot.session_close(v_s, 'abandoned', false, v_now);
    end if;
    perform bot.session_save(v_s);
    v_flushed := v_flushed + 1;
  end loop;
  for v_s in select s.* from bot.sessions s
               left join bot.links l on l.id = s.link_id and l.unlinked_at is null
              where s.status = 'open' and s.active_at < v_now - interval '30 minutes'
                and (l.id is null or s.local_day < bot.local_day(l.tz, v_now))
              order by s.active_at
              limit 200
                for update of s skip locked loop
    v_active := exists (select 1 from bot.links l where l.id = v_s.link_id and l.unlinked_at is null);
    v_s := bot.session_close(v_s, 'abandoned', v_active, v_now);
    perform bot.session_save(v_s);
    v_closed := v_closed + 1;
  end loop;
  delete from bot.sessions s
   where s.sid in (select x.sid from bot.sessions x
                    where x.status <> 'open' and x.finished_at < v_now - interval '30 days'
                    order by x.finished_at limit 500);
  get diagnostics v_deleted = row_count;
  return pg_catalog.jsonb_build_object('status', 'ok', 'flushed', v_flushed, 'closed', v_closed,
                                       'deleted', v_deleted);
end;
$fn$;

comment on function public.bot_session_items(bigint, uuid, uuid[]) is 'Telegram bot (T5): options in file order, kind and keep_order of a queue''s questions (no key), for optionOrder before bot_session_start.';
comment on function public.bot_session_start(bigint, text, uuid, uuid, text, jsonb, bigint, jsonb) is 'Telegram bot (T5): a new «занятие» from the queue, option orders and classes the function computed; one open per user.';
comment on function public.bot_session_view(bigint, text, integer) is 'Telegram bot (T5): the session and its current question in the shown order (the key only after an answer).';
comment on function public.bot_session_answer(bigint, text, integer, jsonb) is 'Telegram bot (T5): an answer; right recorded at once (tg:<sid>:<pos>), wrong / «Не знаю» pending until «Дальше».';
comment on function public.bot_session_resolve(bigint, text, integer, text, jsonb) is 'Telegram bot (T5): «Дальше» (as given, afterAnswer''s queue), «Нажали не туда?» (misclick) or skip.';
comment on function public.bot_session_finish(bigint, text) is 'Telegram bot (T5): «Закончить»: the waiting answer as given; open for «Продолжить» today unless done.';
comment on function public.bot_session_move(bigint, text, bigint) is 'Telegram bot (T5): the session moves to another message (I3, a new message, a deleted one).';
comment on function public.bot_key_doubt(bigint, text, integer) is 'Telegram bot (T5): «Сомневаюсь в ключе» → «Отметить»: the answer as given and test_key_doubt_for.';
comment on function public.bot_flush_pending(timestamptz) is 'Telegram bot (T5): the tick''s step 7: pending answers older than 30 minutes as given; stale open sessions closed; closed ones kept 30 days.';

-- 4. Grants of this file's objects (20261010120002_telegram_bot_revokes.sql ran before they existed): the service role
--    runs the bot's functions; nobody else runs them or the helpers of schema bot, or reads the table.
revoke all on table bot.sessions from public, anon, authenticated;
revoke all on function bot.session_order_ok(jsonb, integer), bot.session_identity(integer),
  bot.session_count(jsonb, text, integer), bot.session_set_add(jsonb, text), bot.session_counts_json(jsonb),
  bot.session_figure_json(jsonb), bot.session_live(bot.sessions, text, timestamptz, boolean),
  bot.session_save(bot.sessions), bot.session_stamp(bot.sessions, timestamptz),
  bot.session_tally(bot.sessions, jsonb, jsonb), bot.session_record(bot.sessions, boolean),
  bot.session_close(bot.sessions, text, boolean, timestamptz), bot.session_logged(uuid, text, integer),
  bot.session_json(bot.sessions, text, timestamptz), bot.session_view_json(bot.sessions),
  bot.session_reply(text, bot.sessions, text, timestamptz, jsonb),
  bot.session_refusal(text, bot.sessions, text, timestamptz, jsonb),
  bot.session_take(bigint, text, timestamptz, boolean), bot.session_requeue(bot.sessions, jsonb),
  bot.session_drop(bot.sessions, integer, uuid, smallint), bot.tick_due_sessions(timestamptz)
  from public, anon, authenticated;
revoke all on function public.bot_session_items(bigint, uuid, uuid[]),
  public.bot_session_start(bigint, text, uuid, uuid, text, jsonb, bigint, jsonb),
  public.bot_session_view(bigint, text, integer), public.bot_session_answer(bigint, text, integer, jsonb),
  public.bot_session_resolve(bigint, text, integer, text, jsonb), public.bot_session_finish(bigint, text),
  public.bot_session_move(bigint, text, bigint), public.bot_key_doubt(bigint, text, integer),
  public.bot_flush_pending(timestamptz)
  from public, anon, authenticated;
grant execute on function public.bot_session_items(bigint, uuid, uuid[]),
  public.bot_session_start(bigint, text, uuid, uuid, text, jsonb, bigint, jsonb),
  public.bot_session_view(bigint, text, integer), public.bot_session_answer(bigint, text, integer, jsonb),
  public.bot_session_resolve(bigint, text, integer, text, jsonb), public.bot_session_finish(bigint, text),
  public.bot_session_move(bigint, text, bigint), public.bot_key_doubt(bigint, text, integer),
  public.bot_flush_pending(timestamptz)
  to service_role;
