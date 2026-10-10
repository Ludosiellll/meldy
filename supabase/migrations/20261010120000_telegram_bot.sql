-- telegram_bot
-- Repo file: supabase/migrations/20261010120000_telegram_bot.sql (package T1 of the Telegram bot @Meldyteach_bot, 2026-10-10).
-- Spec: meldy-notes/10_Project/Telegram_Bot_Spec_2026-10-09.md (§2 decisions 3, 5–9, 20–23, 31–33; §6.2–§6.6; §8.2).
-- Next files: 20261010120001_telegram_bot_cron.sql (pg_cron + pg_net, the minute tick) and 20261010120002_telegram_bot_revokes.sql
-- (takes back the default grants Supabase gives new objects). Rollback: supabase/rollback/20261010120000_telegram_bot_down.sql.
-- Contract check after the apply: supabase/tests/telegram_bot.sql. Local rehearsal (never live):
-- supabase/tests/local/telegram_bot_run.sh. Signatures and JSON shapes for the function and the site:
-- supabase/functions/_shared/bot/CONTRACT_T1.md.
--
-- What it adds:
--   * schema bot: the bot's own state (config, link codes, links, the update ledger, failed claims, deliveries, days, usage).
--     Not exposed by the API, no USAGE for anon/authenticated, row security on every table and no policy: only the
--     functions below (SECURITY DEFINER, owned by the migration role) read and write it;
--   * public.telegram_*: the site, as the signed-in user (auth.uid()), for authenticated only;
--   * public.bot_*: the Edge Function `telegram` with the service role key. Each one starts with
--     meldy_private.require_service_role() (anon and authenticated get 42501), takes the user only from bot.links by the
--     Telegram user id (or from a row the bot claimed itself) and never from the caller. Exam data is read only through
--     the container's cores (meldy_private.plan_inputs_for, containers_overview_for, subject_facts_for, container_ids_of).
-- Nothing existing changes: no ALTER and no REPLACE of a container or oral object. Additive and re-runnable (IF NOT EXISTS,
-- OR REPLACE, ON CONFLICT DO NOTHING); no DELETE, no REVOKE (those are in the revokes file).
-- Bot functions answer every input problem with a status, not an error: an error turns a message update into 503 and
-- Telegram retries it for 24 hours. They raise only for a caller that is not the service role (42501) and for a call the
-- function could never mean (22023).
-- Errors of the site functions (SQLSTATE): 28000 not signed in; 22023 bad input; P0002 Telegram not linked; MT001 more
-- than 5 link codes in an hour.

create schema if not exists bot;
comment on schema bot is 'Telegram bot state (@Meldyteach_bot). Not exposed through the API; reached only by the SECURITY DEFINER functions public.bot_* (service role) and public.telegram_* (the signed-in user).';

-- 1. Tables.
-- 1a. One row: what the bot registers about itself (bot_setup, after getMe) and the tick's heartbeat. tick_token =
--     HMAC(TELEGRAM_BOT_TOKEN, 'meldy:tick:v1'), sent back by bot.tick() in x-meldy-tick; never shown by bot_status.
--     function_region = the region the function is pinned to (forceFunctionRegion; the function passes the same
--     constant it gives setWebhook, so the value lives in one place). flags: switches the owner sets by hand
--     ({"voice": true}; {"tick": "when_due"} forces the tick's saving mode).
create table if not exists bot.config (
  id smallint primary key default 1,
  bot_username text,
  bot_id bigint,
  tick_token text,
  function_url text,
  function_region text,
  last_setup_at timestamptz,
  last_tick_at timestamptz,
  last_tick jsonb,
  flags jsonb not null default '{}'::jsonb,
  last_cleanup_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint config_one_row check (id = 1),
  constraint config_username_check check (bot_username is null or bot_username ~ '^[A-Za-z0-9_]{5,32}$'),
  constraint config_bot_id_check check (bot_id is null or bot_id > 0),
  constraint config_tick_token_check check (tick_token is null or tick_token ~ '^[A-Za-z0-9_-]{32,128}$'),
  constraint config_function_url_check check (function_url is null
    or function_url ~ '^https://[a-z0-9-]{1,63}\.supabase\.co/functions/v1/telegram$'),
  constraint config_region_check check (function_region is null or function_region ~ '^[a-z]{2}-[a-z]+-[0-9]$'),
  constraint config_flags_check check (jsonb_typeof(flags) = 'object')
);
insert into bot.config (id) values (1) on conflict (id) do nothing;
comment on table bot.config is 'One row: the bot''s username and id, the tick token, the function URL and region (bot_setup), the last tick (bot_tick_beat), owner flags.';

-- 1b. One-time codes, stored only as sha256 hex (meldy_private.code_hash). purpose 'link': «Подключить Telegram» in the
--     profile, L + 32 hex, 15 minutes, tz = the browser's zone (spec decision 32). purpose 'group': the author's
--     «Подключить беседу» (package T7: container_id, post_hour). used_by_tg = the Telegram user who claimed it.
create table if not exists bot.link_codes (
  code_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null default 'link',
  container_id uuid references public.containers(id) on delete cascade,
  tz text,
  post_hour smallint,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_tg bigint,
  constraint link_codes_hash_check check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint link_codes_purpose_check check (purpose in ('link', 'group')),
  constraint link_codes_group_check check (purpose = 'link' or container_id is not null),
  constraint link_codes_tz_check check (tz is null or tz ~ '^[A-Za-z0-9_+/-]{1,64}$'),
  constraint link_codes_post_hour_check check (post_hour is null or post_hour between 0 and 23),
  constraint link_codes_used_check check ((used_at is null) = (used_by_tg is null))
);
create index if not exists link_codes_user_idx on bot.link_codes (user_id, created_at desc);
create index if not exists link_codes_container_idx on bot.link_codes (container_id);
comment on table bot.link_codes is 'One-time codes (sha256 only): L… links a Telegram account (15 min), G… binds a group chat (package T7).';

-- 1c. Links: one active Telegram account per Meldy account and one Meldy account per Telegram account (the newest link
--     wins on both sides). Unlinking sets unlinked_at. We keep the Telegram user and chat ids, the language and the
--     settings; no name, @username or phone (spec §6.4). remind_at 07:00–22:59 (M4); paused_until = the first day the
--     card comes again (S3); asked_at = when «Присылать план дальше?» (K2) went out; last_seen_at = the user's last
--     action in the bot or in its settings (ends K2's silence); hint_at = the last «Здесь отвечают кнопками…» (S6, at
--     most once an hour); prompt = the function's pending ForceReply (M4, S3).
create table if not exists bot.links (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  tg_user_id bigint not null,
  chat_id bigint not null,
  tg_lang text,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz,
  blocked_at timestamptz,
  remind_on boolean not null default true,
  remind_at time not null default '20:00',
  tz text not null default 'Europe/Minsk',
  paused_until date,
  asked_at timestamptz,
  last_seen_at timestamptz,
  hint_at timestamptz,
  prompt jsonb,
  updated_at timestamptz not null default now(),
  constraint links_ids_check check (tg_user_id > 0 and chat_id > 0),
  constraint links_lang_check check (tg_lang is null or tg_lang ~ '^[A-Za-z0-9-]{2,16}$'),
  constraint links_remind_at_check check (remind_at between time '07:00' and time '22:59'
                                          and extract(second from remind_at) = 0),
  constraint links_tz_check check (tz ~ '^[A-Za-z0-9_+/-]{1,64}$'),
  constraint links_prompt_check check (prompt is null
    or (jsonb_typeof(prompt) = 'object' and octet_length(prompt::text) <= 1024))
);
create unique index if not exists links_user_active_key on bot.links (user_id) where unlinked_at is null;
create unique index if not exists links_tg_active_key on bot.links (tg_user_id) where unlinked_at is null;
create index if not exists links_user_idx on bot.links (user_id);
comment on table bot.links is 'Telegram ↔ Meldy links: one active per user and per Telegram account; reminder settings; no names or phone numbers.';

-- 1d. The update ledger (spec decision 6): begin → new | retry | done | busy with a lease of 30 seconds; done only
--     after the handler succeeded. Rows are kept 3 days (Telegram retries an update for at most 24 hours).
create table if not exists bot.updates (
  update_id bigint primary key,
  status text not null default 'started',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  attempts integer not null default 1,
  error_name text,
  constraint updates_id_check check (update_id >= 0),
  constraint updates_status_check check (status in ('started', 'failed', 'done')),
  constraint updates_error_check check (error_name is null or error_name ~ '^[A-Za-z0-9_.:-]{1,64}$')
);
create index if not exists updates_started_idx on bot.updates (started_at);
comment on table bot.updates is 'Webhook update ledger: started (30 s lease) | failed | done. Error names only, never texts.';

-- 1e. Failed code claims per Telegram user: 10 in an hour → slow_down (spec §8.2). Kept one day.
create table if not exists bot.claim_failures (
  id bigint generated always as identity primary key,
  tg_user_id bigint not null,
  failed_at timestamptz not null default now()
);
create index if not exists claim_failures_tg_idx on bot.claim_failures (tg_user_id, failed_at desc);
comment on table bot.claim_failures is 'Failed link-code claims per Telegram user (the brake: 10 an hour).';

-- 1f. Everything the bot writes or changes on its own (the tick): one row per (kind, chat, local day, ref) — the
--     idempotency key of every send (spec §6.5). kind: reminder = the day card K1; ask = «Присылать план дальше?» K2
--     (it takes the reminder's place: at most one of the two per chat and day, even when a K1 row turns into K2);
--     after_date = K3, ref = the exam (container id); day_close = the night after a day: delete the unused card, take
--     the keyboard off the last summary; notice = a one-off message. status: claimed → sending (right before the call
--     to Telegram) → sent | failed | skipped; a row left in sending for 10 minutes becomes unknown and is never sent
--     again (at most once, spec decision 7). answer = the student's answer to a K2 (yes | pause | stop), for the
--     pilot's numbers.
create table if not exists bot.deliveries (
  id bigint generated always as identity primary key,
  kind text not null,
  chat_id bigint not null,
  link_id bigint references bot.links(id) on delete cascade,
  local_day date not null,
  ref text,
  status text not null default 'claimed',
  attempts smallint not null default 1,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  tg_message_id bigint,
  error text,
  answer text,
  constraint deliveries_kind_check check (kind in ('reminder', 'ask', 'after_date', 'day_close', 'notice')),
  constraint deliveries_status_check check (status in ('claimed', 'sending', 'sent', 'failed', 'skipped', 'unknown')),
  constraint deliveries_ref_check check (ref is null or char_length(ref) between 1 and 64),
  constraint deliveries_error_check check (error is null or char_length(error) <= 200),
  constraint deliveries_answer_check check (answer is null or (kind = 'ask' and answer in ('yes', 'pause', 'stop'))),
  constraint deliveries_once unique nulls not distinct (kind, chat_id, local_day, ref)
);
create unique index if not exists deliveries_day_card_key on bot.deliveries (chat_id, local_day)
  where kind in ('reminder', 'ask');
create index if not exists deliveries_open_idx on bot.deliveries (kind, claimed_at) where status in ('claimed', 'sending');
create index if not exists deliveries_link_idx on bot.deliveries (link_id, kind, local_day);
create index if not exists deliveries_day_idx on bot.deliveries (local_day);
comment on table bot.deliveries is 'What the tick sends or changes, once: unique (kind, chat, local day, ref) nulls not distinct; one day card (reminder or ask) per chat and day.';

-- 1g. One row per link and local day: today's card (K1, from the reminder or /today) and whether «Начать» used it, the
--     last summary with a keyboard (I1/I2), and when the day was closed (spec §6.6 step 5).
create table if not exists bot.days (
  link_id bigint not null references bot.links(id) on delete cascade,
  local_day date not null,
  card_message_id bigint,
  card_used boolean not null default false,
  last_message_id bigint,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (link_id, local_day)
);
create index if not exists days_open_idx on bot.days (local_day) where closed_at is null;
comment on table bot.days is 'Per link and local day: the card message, whether it became a session, the last summary, the night''s close.';

-- 1h. Calls of the function per UTC day (bot_status «вызовов за месяц», spec §6.1 and §10): webhook updates
--     (bot_update_begin) and ticks (bot_tick_beat). Kept 400 days.
create table if not exists bot.usage (
  day date primary key,
  updates integer not null default 0,
  ticks integer not null default 0
);
comment on table bot.usage is 'Function calls per UTC day: updates (webhook) and ticks.';

alter table bot.config enable row level security;
alter table bot.link_codes enable row level security;
alter table bot.links enable row level security;
alter table bot.updates enable row level security;
alter table bot.claim_failures enable row level security;
alter table bot.deliveries enable row level security;
alter table bot.days enable row level security;
alter table bot.usage enable row level security;

-- 2. Helpers (schema bot: not reachable by clients). They run inside the DEFINER functions, as the migration role.
-- 2a. A time zone the server knows (pg_timezone_names): the browser's Intl zone at linking, the settings.
create or replace function bot.tz_ok(p_tz text)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select p_tz is not null and p_tz ~ '^[A-Za-z0-9_+/-]{1,64}$'
     and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_tz)
$fn$;

-- 2b. The local day of a moment in a zone (the packages after T1 date answers and sessions the same way).
create or replace function bot.local_day(p_tz text, p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $fn$
  select (p_at at time zone p_tz)::date
$fn$;

-- 2c. The active link of a Telegram user, or null: the only way any bot function finds its user (spec decision 3).
create or replace function bot.active_link(p_tg_user_id bigint)
returns bot.links
language sql
stable
set search_path = ''
as $fn$
  select l.* from bot.links l where l.tg_user_id = p_tg_user_id and l.unlinked_at is null
$fn$;

-- 2d. The window of a reminder in local wall time (spec decision 20, §6.6): from the chosen time, at most 3 hours
--     late, never at 23:00 or later.
create or replace function bot.in_window(p_local timestamp, p_at time)
returns boolean
language sql
immutable
cost 1
set search_path = ''
as $fn$
  select p_local::time >= p_at
     and p_local < p_local::date + p_at + interval '3 hours'
     and p_local::time < time '23:00'
$fn$;

-- 2e. An answer in the last 30 minutes, on the site or in the bot (spec decision 20, §6.6: the card waits). Only
--     answers count, as the spec says: an action in the bot (/settings, a new time) does not delay the card.
--     local_date is the device's day kept within a day of the server's, hence the bounded range of the index.
create or replace function bot.recently_active(p_user uuid, p_now timestamptz, p_day date)
returns boolean
language sql
stable
cost 1000
set search_path = ''
as $fn$
  select exists (select 1 from public.test_answers a
                  where a.user_id = p_user and a.local_date >= p_day - 2
                    and a.created_at > p_now - interval '30 minutes')
$fn$;

-- 2f. Any answer (site or bot) after a moment.
create or replace function bot.answered_since(p_user uuid, p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (select 1 from public.test_answers a
                  where a.user_id = p_user and a.local_date >= (p_at at time zone 'utc')::date - 2
                    and a.created_at > p_at)
$fn$;

-- 2g. One link as the bot sees it: settings and the local clock; no account data (spec decision 32).
create or replace function bot.link_json(p_l bot.links, p_now timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'linked', true, 'chat_id', p_l.chat_id, 'tg_lang', p_l.tg_lang, 'linked_at', p_l.linked_at,
    'blocked', p_l.blocked_at is not null, 'remind_on', p_l.remind_on,
    'remind_at', pg_catalog.to_char(p_l.remind_at, 'HH24:MI'), 'tz', p_l.tz,
    'paused_until', case when p_l.paused_until > (p_now at time zone p_l.tz)::date then p_l.paused_until end,
    'asked_at', p_l.asked_at, 'last_seen_at', p_l.last_seen_at, 'prompt', p_l.prompt,
    'local_day', (p_now at time zone p_l.tz)::date,
    'local_time', pg_catalog.to_char(p_now at time zone p_l.tz, 'HH24:MI'),
    'now', pg_catalog.floor(extract(epoch from p_now))::bigint)
$fn$;

-- 2h. The user's exams for the bot's lines (M2, S1): every container the user owns or joined, nearest date first.
--     last_date = the last test date of its subjects (a subject's own date, else the exam's).
create or replace function bot.exams_json(p_user uuid)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', c.id, 'title', c.title, 'exam_date', c.exam_date,
           'last_date', coalesce((select pg_catalog.max(coalesce(s.exam_date, c.exam_date)) from public.container_subjects s
                                   where s.container_id = c.id), c.exam_date),
           'role', case when c.owner_id = p_user then 'owner' else 'member' end)
           order by c.exam_date nulls last, c.created_at desc), '[]'::jsonb)
    from public.containers c
   where c.id in (select x.id from meldy_private.container_ids_of(p_user) as x(id))
$fn$;

-- 2i. The site's view of its own link (telegram_link_state and the others).
create or replace function bot.site_state(p_user uuid)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select coalesce(
    (select pg_catalog.jsonb_build_object(
              'linked', true, 'linked_at', l.linked_at, 'blocked', l.blocked_at is not null,
              'remind_on', l.remind_on, 'remind_at', pg_catalog.to_char(l.remind_at, 'HH24:MI'), 'tz', l.tz,
              'paused_until', case when l.paused_until > (pg_catalog.now() at time zone l.tz)::date then l.paused_until end,
              'bot_username', (select c.bot_username from bot.config c where c.id = 1))
       from bot.links l
      where l.user_id = p_user and l.unlinked_at is null),
    pg_catalog.jsonb_build_object('linked', false,
                                  'bot_username', (select c.bot_username from bot.config c where c.id = 1)))
$fn$;

-- 2j. Function calls this month (UTC), from bot.usage.
create or replace function bot.calls_json(p_now timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
           'month', pg_catalog.to_char(p_now at time zone 'utc', 'YYYY-MM'),
           'updates', coalesce(pg_catalog.sum(u.updates), 0)::bigint,
           'ticks', coalesce(pg_catalog.sum(u.ticks), 0)::bigint,
           'total', coalesce(pg_catalog.sum(u.updates + u.ticks), 0)::bigint)
    from bot.usage u
   where u.day >= pg_catalog.date_trunc('month', p_now at time zone 'utc')::date
$fn$;

-- 2k. The sweep before every claim (spec decision 7): a row left in sending for 10 minutes becomes unknown and is never
--     sent again (a K2 that died while sending counts as asked); a row claimed and never tried for 3 hours is failed.
create or replace function bot.sweep(p_kinds text[], p_now timestamptz)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  update bot.links l set asked_at = d.claimed_at
    from bot.deliveries d
   where 'ask' = any (p_kinds) and d.kind = 'ask' and d.status = 'sending'
     and d.claimed_at < p_now - interval '10 minutes'
     and l.id = d.link_id and (l.asked_at is null or l.asked_at < d.claimed_at);
  update bot.deliveries d set status = 'unknown', error = 'died while sending'
   where d.kind = any (p_kinds) and d.status = 'sending' and d.claimed_at < p_now - interval '10 minutes';
  update bot.deliveries d set status = 'failed', error = 'abandoned'
   where d.kind = any (p_kinds) and d.status = 'claimed' and d.claimed_at < p_now - interval '3 hours';
end;
$fn$;

-- 2l. What K3 says about one exam (spec §4.2): its dates, the first plan day, the days with answers and the answers up
--     to the last test date, and the figure «N из M — верно в два разных дня» as the site counts it (subject_facts_for).
create or replace function bot.after_date_json(p_user uuid, p_container uuid, p_last date)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'container_id', c.id, 'title', c.title, 'exam_date', c.exam_date, 'last_date', p_last,
    'first_plan_day', meldy_private.first_plan_day(p_user, c.id, p_last),
    'active_days', (select pg_catalog.count(distinct a.local_date) from public.test_answers a
                     where a.user_id = p_user and a.container_id = c.id and a.local_date <= p_last),
    'answers', (select pg_catalog.count(*) from public.test_answers a
                 where a.user_id = p_user and a.container_id = c.id and a.local_date <= p_last),
    'two_days', (select coalesce(pg_catalog.sum(f.two_days), 0)::bigint
                   from meldy_private.subject_facts_for(p_user, array[c.id], p_last) f),
    'keyed', (select coalesce(pg_catalog.sum(f.keyed), 0)::bigint
                from meldy_private.subject_facts_for(p_user, array[c.id], p_last) f))
    from public.containers c
   where c.id = p_container
$fn$;

-- 2m. Is this message a session of package T5 (bot.sessions, spec §6.2: chat_id, message_id)? false while that table
--     does not exist. The night's close never deletes such a message, even if «used» was not reported.
create or replace function bot.session_message(p_chat_id bigint, p_message_id bigint)
returns boolean
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_found boolean := false;
begin
  if p_message_id is null then
    return false;
  end if;
  if exists (select 1 from pg_catalog.pg_attribute a
              where a.attrelid = pg_catalog.to_regclass('bot.sessions') and a.attname in ('chat_id', 'message_id')
                and not a.attisdropped
             having pg_catalog.count(*) = 2) then
    execute 'select exists (select 1 from bot.sessions s where s.chat_id = $1 and s.message_id = $2)'
      into v_found using p_chat_id, p_message_id;
  end if;
  return coalesce(v_found, false);
end;
$fn$;

-- 2n. The tick's mode (spec §10: the free plan has 500 000 function calls a month; a minute tick is 43 200 of them).
--     every_minute while this month's calls (bot.usage, UTC) are under 300 000 (60 %) and the owner has not set
--     flags.tick = 'when_due'; when_due otherwise: bot.tick() then posts only when bot.tick_due() says something may be
--     due, and every 15th minute regardless (housekeeping, /status).
create or replace function bot.tick_mode(p_now timestamptz)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case when coalesce((select c.flags ->> 'tick' from bot.config c where c.id = 1), '') = 'when_due'
                or (bot.calls_json(p_now) ->> 'total')::bigint >= 300000
              then 'when_due' else 'every_minute' end
$fn$;

-- 2o. May anything be due this minute? Cheap and conservative (true when unsure): a day card window open for a link
--     with no card claimed today (the 30-minute rule is left to the claim), a K3 window, a night's close, a claimed
--     row the next claim would take again or give up; package T5's pending answers and package T7's group posts
--     through their hooks (see the two marked blocks).
create or replace function bot.tick_due(p_now timestamptz default pg_catalog.now())
returns boolean
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_due boolean := false;
begin
  -- the day card (K1/K2)
  if exists (select 1 from bot.links l
              where l.unlinked_at is null and l.blocked_at is null and l.remind_on
                and bot.in_window(p_now at time zone l.tz, l.remind_at)
                and (l.paused_until is null or l.paused_until <= (p_now at time zone l.tz)::date)
                and not exists (select 1 from bot.deliveries d
                                 where d.chat_id = l.chat_id and d.local_day = (p_now at time zone l.tz)::date
                                   and d.kind in ('reminder', 'ask'))) then
    return true;
  end if;
  -- K3: an exam whose last test date was 1–3 days ago, no K3 for this user yet
  if exists (select 1 from bot.links l
              cross join lateral meldy_private.container_ids_of(l.user_id) as x(id)
              join public.containers c on c.id = x.id
             where l.unlinked_at is null and l.blocked_at is null and l.remind_on
               and bot.in_window(p_now at time zone l.tz, l.remind_at)
               and (l.paused_until is null or l.paused_until <= (p_now at time zone l.tz)::date)
               and (p_now at time zone l.tz)::date
                   - coalesce((select pg_catalog.max(coalesce(s.exam_date, c.exam_date)) from public.container_subjects s
                                where s.container_id = c.id), c.exam_date) between 1 and 3
               and not exists (select 1 from bot.deliveries d join bot.links l2 on l2.id = d.link_id
                                where d.kind = 'after_date' and d.ref = c.id::text and l2.user_id = l.user_id)) then
    return true;
  end if;
  -- the night's close
  if exists (select 1 from bot.days dy join bot.links l on l.id = dy.link_id
              where l.unlinked_at is null and l.blocked_at is null and dy.closed_at is null
                and dy.local_day < (p_now at time zone l.tz)::date and dy.local_day >= (p_now at time zone l.tz)::date - 2
                and ((dy.card_message_id is not null and not dy.card_used) or dy.last_message_id is not null)
                and not exists (select 1 from bot.deliveries d
                                 where d.kind = 'day_close' and d.chat_id = l.chat_id and d.local_day = dy.local_day)) then
    return true;
  end if;
  -- a worker died after a claim: the row waits to be taken again (after 10 minutes, 3 tries) or given up (3 hours)
  if exists (select 1 from bot.deliveries d
              where d.status = 'claimed' and d.kind in ('reminder', 'ask', 'after_date', 'day_close')
                and ((d.attempts < 3 and d.claimed_at < p_now - interval '10 minutes')
                     or d.claimed_at < p_now - interval '3 hours')) then
    return true;
  end if;
  -- ── package T5 hook: bot.tick_due_sessions(p_now timestamptz) returns boolean (a pending answer older than 30
  --    minutes, spec §6.6 step 7). Until T5 defines it: any pending answer in bot.sessions counts.
  if pg_catalog.to_regprocedure('bot.tick_due_sessions(timestamptz)') is not null then
    execute 'select bot.tick_due_sessions($1)' into v_due using p_now;
    if v_due then
      return true;
    end if;
  elsif exists (select 1 from pg_catalog.pg_attribute a
                 where a.attrelid = pg_catalog.to_regclass('bot.sessions') and a.attname = 'pending' and not a.attisdropped) then
    execute 'select exists (select 1 from bot.sessions s where s.pending is not null)' into v_due;
    if v_due then
      return true;
    end if;
  end if;
  -- ── package T7 hook: bot.tick_due_groups(p_now timestamptz) returns boolean (a group post, its counter or its close
  --    due, spec §6.6 steps 1, 2, 4). Until T7 defines it while its tables exist: every minute.
  if pg_catalog.to_regprocedure('bot.tick_due_groups(timestamptz)') is not null then
    execute 'select bot.tick_due_groups($1)' into v_due using p_now;
    if v_due then
      return true;
    end if;
  elsif pg_catalog.to_regclass('bot.group_posts') is not null then
    return true;
  end if;
  return false;
end;
$fn$;

-- 2p. Housekeeping, at most once an hour from bot_tick_beat. Bounded deletes; the tick job's own run history too
--     (Supabase never cleans cron.job_run_details). Codes stay 30 days after they expire (the pilot counts the link
--     funnel over 14–30 days).
create or replace function bot.cleanup(p_now timestamptz)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_out jsonb := '{}'::jsonb;
  v_n integer;
  v_utc date := (p_now at time zone 'utc')::date;
begin
  delete from bot.updates u
   where u.update_id in (select x.update_id from bot.updates x where x.started_at < p_now - interval '3 days' limit 20000);
  get diagnostics v_n = row_count;
  v_out := v_out || pg_catalog.jsonb_build_object('updates', v_n);
  delete from bot.claim_failures f where f.failed_at < p_now - interval '1 day';
  get diagnostics v_n = row_count;
  v_out := v_out || pg_catalog.jsonb_build_object('claim_failures', v_n);
  delete from bot.link_codes c where c.expires_at < p_now - interval '30 days';
  get diagnostics v_n = row_count;
  v_out := v_out || pg_catalog.jsonb_build_object('link_codes', v_n);
  delete from bot.deliveries d
   where d.id in (select x.id from bot.deliveries x
                   where x.local_day < v_utc - 90 and x.status not in ('claimed', 'sending') limit 20000);
  get diagnostics v_n = row_count;
  v_out := v_out || pg_catalog.jsonb_build_object('deliveries', v_n);
  delete from bot.days d where d.local_day < v_utc - 30;
  get diagnostics v_n = row_count;
  v_out := v_out || pg_catalog.jsonb_build_object('days', v_n);
  delete from bot.links l where l.unlinked_at < p_now - interval '30 days';
  get diagnostics v_n = row_count;
  v_out := v_out || pg_catalog.jsonb_build_object('links', v_n);
  delete from bot.usage u where u.day < v_utc - 400;
  if pg_catalog.to_regclass('cron.job_run_details') is not null and pg_catalog.to_regclass('cron.job') is not null then
    begin
      execute 'delete from cron.job_run_details r
                where r.jobid in (select j.jobid from cron.job j where j.jobname = ''meldy-telegram-tick'')
                  and r.end_time < $1 - interval ''7 days'''
        using p_now;
      get diagnostics v_n = row_count;
      v_out := v_out || pg_catalog.jsonb_build_object('cron_runs', v_n);
    exception when insufficient_privilege or undefined_table or undefined_column then
      v_out := v_out || pg_catalog.jsonb_build_object('cron_runs', null);
    end;
  end if;
  return v_out;
end;
$fn$;

-- 3. The site (spec §6.3 «Сайт»): the signed-in user's own link.
-- 3a. «Подключить Telegram»: a fresh code, shown once, 15 minutes; the deep link is t.me/<bot_username>?start=<code>.
--     At most 5 codes an hour (MT001); a new code ends the user's earlier unused link codes. p_tz = the browser's
--     zone (Intl), applied when the code is claimed; null keeps the link's zone (Europe/Minsk for a new link).
create or replace function public.telegram_link_start(p_tz text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_expires timestamptz := pg_catalog.now() + interval '15 minutes';
  v_code text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_tz is not null and not bot.tz_ok(p_tz) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  -- One user's requests in turn, so the limit and «the older code stops working» hold under concurrency.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bot.link_codes:' || v_uid::text, 0));
  if (select pg_catalog.count(*) from bot.link_codes c
       where c.user_id = v_uid and c.purpose = 'link' and c.created_at > v_now - interval '1 hour') >= 5 then
    raise exception 'too many link codes: try again in an hour' using errcode = 'MT001';
  end if;
  update bot.link_codes c set expires_at = v_now - interval '1 microsecond'
   where c.user_id = v_uid and c.purpose = 'link' and c.used_at is null and c.expires_at >= v_now;
  v_code := 'L' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');   -- 122 random bits
  insert into bot.link_codes (code_hash, user_id, purpose, tz, created_at, expires_at)
  values (meldy_private.code_hash(v_code), v_uid, 'link', p_tz, v_now, v_expires);
  return pg_catalog.jsonb_build_object('code', v_code, 'expires_at', v_expires,
                                       'bot_username', (select c.bot_username from bot.config c where c.id = 1));
end;
$fn$;

-- 3b. The profile card's state (polled every 3 s while a code is open).
create or replace function public.telegram_link_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  return bot.site_state(auth.uid());
end;
$fn$;

-- 3c. Settings from the site: null keeps a value. The time 07:00–22:59 (seconds dropped), the zone from
--     pg_timezone_names. Counts as the user's action (ends K2's silence).
create or replace function public.telegram_settings(p_remind_on boolean default null, p_remind_at time default null,
                                                    p_tz text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_at time;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_tz is not null and not bot.tz_ok(p_tz) then
    raise exception 'unknown time zone' using errcode = '22023';
  end if;
  if p_remind_at is not null then
    v_at := pg_catalog.make_time(extract(hour from p_remind_at)::integer, extract(minute from p_remind_at)::integer, 0);
    if v_at < time '07:00' or v_at > time '22:59' then
      raise exception 'the reminder time must be 07:00–22:59' using errcode = '22023';
    end if;
  end if;
  update bot.links l
     set remind_on = coalesce(p_remind_on, l.remind_on), remind_at = coalesce(v_at, l.remind_at),
         tz = coalesce(p_tz, l.tz), last_seen_at = pg_catalog.now(), updated_at = pg_catalog.now()
   where l.user_id = v_uid and l.unlinked_at is null;
  if not found then
    raise exception 'telegram is not linked' using errcode = 'P0002';
  end if;
  return bot.site_state(v_uid);
end;
$fn$;

-- 3d. «Отключить» on the site: the link ends (nothing is deleted); the bot then treats this Telegram as not linked.
create or replace function public.telegram_unlink()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  update bot.links l set unlinked_at = pg_catalog.now(), updated_at = pg_catalog.now()
   where l.user_id = v_uid and l.unlinked_at is null;
  return bot.site_state(v_uid);
end;
$fn$;

-- 4. The bot: service role only (spec §6.3 «Бот»).
-- 4a. POST /telegram/setup registers what the bot derives (getMe; the tick token; its own URL and the region it pins
--     with forceFunctionRegion — the same constant it gives setWebhook). At most once a minute: a call within 60 s of
--     the last one changes nothing and answers slow_down.
create or replace function public.bot_setup(p_bot_username text, p_bot_id bigint, p_tick_token text, p_function_url text,
                                            p_function_region text default 'eu-central-1')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_c bot.config%rowtype;
begin
  perform meldy_private.require_service_role();
  if p_bot_username is null or p_bot_username !~ '^[A-Za-z0-9_]{5,32}$' or p_bot_id is null or p_bot_id <= 0
     or p_tick_token is null or p_tick_token !~ '^[A-Za-z0-9_-]{32,128}$' or p_function_url is null
     or p_function_url !~ '^https://[a-z0-9-]{1,63}\.supabase\.co/functions/v1/telegram$'
     or p_function_region is null or p_function_region !~ '^[a-z]{2}-[a-z]+-[0-9]$' then
    raise exception 'invalid setup values' using errcode = '22023';
  end if;
  insert into bot.config (id) values (1) on conflict (id) do nothing;
  select c.* into v_c from bot.config c where c.id = 1 for update;
  if v_c.last_setup_at > v_now - interval '1 minute' then
    return pg_catalog.jsonb_build_object('status', 'slow_down', 'retry_after',
      greatest(1, pg_catalog.ceil(extract(epoch from (v_c.last_setup_at + interval '1 minute' - v_now)))::integer));
  end if;
  update bot.config c
     set bot_username = p_bot_username, bot_id = p_bot_id, tick_token = p_tick_token, function_url = p_function_url,
         function_region = p_function_region, last_setup_at = v_now, updated_at = v_now
   where c.id = 1;
  return pg_catalog.jsonb_build_object('status', 'ok', 'bot_username', p_bot_username, 'function_region', p_function_region,
                                       'last_tick_at', v_c.last_tick_at, 'flags', v_c.flags);
end;
$fn$;

-- 4b. The update ledger (spec decision 6). begin: new (first time) | retry (an earlier attempt failed, or its 30 s lease
--     ran out) | done (finished: answer 200) | busy (another worker holds the lease: answer 200). Every call is counted
--     in bot.usage. p_now is for tests; the function passes nothing.
create or replace function public.bot_update_begin(p_update_id bigint, p_now timestamptz default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_u bot.updates%rowtype;
begin
  perform meldy_private.require_service_role();
  if p_update_id is null or p_update_id < 0 then
    raise exception 'invalid update id' using errcode = '22023';
  end if;
  insert into bot.usage as u (day, updates) values ((v_now at time zone 'utc')::date, 1)
  on conflict (day) do update set updates = u.updates + 1;
  insert into bot.updates (update_id, status, started_at) values (p_update_id, 'started', v_now)
  on conflict (update_id) do nothing;
  if found then
    return 'new';
  end if;
  select x.* into v_u from bot.updates x where x.update_id = p_update_id for update;
  if v_u.status = 'done' then
    return 'done';
  end if;
  if v_u.status = 'started' and v_u.started_at > v_now - interval '30 seconds' then
    return 'busy';
  end if;
  update bot.updates x
     set status = 'started', started_at = v_now, finished_at = null, error_name = null, attempts = x.attempts + 1
   where x.update_id = p_update_id;
  return 'retry';
end;
$fn$;

create or replace function public.bot_update_done(p_update_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform meldy_private.require_service_role();
  update bot.updates x set status = 'done', finished_at = pg_catalog.now(), error_name = null
   where x.update_id = p_update_id;
end;
$fn$;

-- The error's name only (TypeError, TelegramError:429, …): never a text, an address or a token.
create or replace function public.bot_update_failed(p_update_id bigint, p_error text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform meldy_private.require_service_role();
  update bot.updates x
     set status = 'failed', finished_at = pg_catalog.now(),
         error_name = case when p_error ~ '^[A-Za-z0-9_.:-]{1,64}$' then p_error else 'Error' end
   where x.update_id = p_update_id and x.status <> 'done';
end;
$fn$;

-- 4c. The tick's last step (spec §6.6 step 8): the heartbeat with the tick's own numbers (≤ 2000 bytes), the tick
--     counted in bot.usage, and the hourly housekeeping. Returns the calls of this month.
create or replace function public.bot_tick_beat(p_stats jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_last timestamptz;
  v_cleanup jsonb;
begin
  perform meldy_private.require_service_role();
  insert into bot.usage as u (day, ticks) values ((v_now at time zone 'utc')::date, 1)
  on conflict (day) do update set ticks = u.ticks + 1;
  insert into bot.config (id) values (1) on conflict (id) do nothing;
  select c.last_cleanup_at into v_last from bot.config c where c.id = 1 for update;
  update bot.config c
     set last_tick_at = v_now,
         last_tick = case when p_stats is null or pg_catalog.octet_length(p_stats::text) <= 2000 then p_stats
                          else pg_catalog.jsonb_build_object('truncated', true) end,
         updated_at = v_now
   where c.id = 1;
  if v_last is null or v_last < v_now - interval '1 hour' then
    v_cleanup := bot.cleanup(v_now);
    update bot.config c set last_cleanup_at = v_now where c.id = 1;
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'calls', bot.calls_json(v_now), 'cleanup', v_cleanup);
end;
$fn$;

-- 4d. GET /telegram/status (anyone may call the route): no secret, no URL, no user count. tick_mode = every_minute |
--     when_due (bot.tick_mode), tick_threshold = the month's calls where when_due starts.
create or replace function public.bot_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_c bot.config%rowtype;
begin
  perform meldy_private.require_service_role();
  select c.* into v_c from bot.config c where c.id = 1;
  return pg_catalog.jsonb_build_object(
    'configured', v_c.function_url is not null and v_c.tick_token is not null and v_c.function_region is not null,
    'bot_username', v_c.bot_username, 'function_region', v_c.function_region, 'last_setup_at', v_c.last_setup_at,
    'tick_mode', bot.tick_mode(v_now), 'tick_threshold', 300000,
    'last_tick_at', v_c.last_tick_at, 'last_tick', v_c.last_tick, 'flags', coalesce(v_c.flags, '{}'::jsonb),
    'calls', bot.calls_json(v_now),
    'ledger', (select pg_catalog.jsonb_build_object(
                        'started', pg_catalog.count(*) filter (where x.status = 'started'),
                        'failed', pg_catalog.count(*) filter (where x.status = 'failed'),
                        'done', pg_catalog.count(*) filter (where x.status = 'done'))
                 from bot.updates x where x.started_at > v_now - interval '24 hours'));
end;
$fn$;

-- 4e. /start L<code> in a private chat (spec §4.1 M2/M5, §6.5). status: linked | used | expired | invalid | slow_down |
--     private_only. The code is judged by the message's date (a delayed delivery does not expire it). The same code from
--     the same Telegram again (a redelivery, a second tap) → linked again, nothing changes. The newest link wins on both
--     sides: this Meldy account's earlier Telegram is unlinked (replaced_chat_id = its chat, for M6) and so is this
--     Telegram's earlier Meldy account. Re-linking the same pair keeps the settings. 10 failed claims an hour per
--     Telegram → slow_down. The new link takes the code's zone (the browser's).
create or replace function public.bot_link_claim(p_code text, p_tg_user_id bigint, p_chat_id bigint,
                                                 p_lang text default null, p_message_date timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_code bot.link_codes%rowtype;
  v_row bot.links%rowtype;
  v_mine bot.links%rowtype;
  v_theirs bot.links%rowtype;
  v_lang text;
  v_replaced bigint;
begin
  perform meldy_private.require_service_role();
  if p_tg_user_id is null or p_chat_id is null or p_tg_user_id <= 0 or p_chat_id <> p_tg_user_id then
    return pg_catalog.jsonb_build_object('status', 'private_only');
  end if;
  if (select pg_catalog.count(*) from bot.claim_failures f
       where f.tg_user_id = p_tg_user_id and f.failed_at > v_now - interval '1 hour') >= 10 then
    return pg_catalog.jsonb_build_object('status', 'slow_down');
  end if;
  if p_code is null or p_code !~ '^L[0-9a-f]{32}$' then
    insert into bot.claim_failures (tg_user_id, failed_at) values (p_tg_user_id, v_now);
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  select c.* into v_code from bot.link_codes c
   where c.code_hash = meldy_private.code_hash(p_code) and c.purpose = 'link'
     for update;
  if not found then
    insert into bot.claim_failures (tg_user_id, failed_at) values (p_tg_user_id, v_now);
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  v_lang := case when p_lang ~ '^[A-Za-z0-9-]{2,16}$' then p_lang end;

  if v_code.used_at is not null then
    if v_code.used_by_tg = p_tg_user_id then
      update bot.links l set blocked_at = null, last_seen_at = v_now
       where l.user_id = v_code.user_id and l.tg_user_id = p_tg_user_id and l.unlinked_at is null;
      if found then
        return pg_catalog.jsonb_build_object('status', 'linked', 'replaced_chat_id', null);
      end if;
    end if;
    return pg_catalog.jsonb_build_object('status', 'used');
  end if;
  if least(coalesce(p_message_date, v_now), v_now) > v_code.expires_at then
    return pg_catalog.jsonb_build_object('status', 'expired');
  end if;

  -- Both sides' active links, locked in id order (two crossed claims never deadlock).
  for v_row in
    select l.* from bot.links l
     where l.unlinked_at is null and (l.user_id = v_code.user_id or l.tg_user_id = p_tg_user_id)
     order by l.id
       for update
  loop
    if v_row.user_id = v_code.user_id then
      v_mine := v_row;
    end if;
    if v_row.tg_user_id = p_tg_user_id then
      v_theirs := v_row;
    end if;
  end loop;
  update bot.link_codes c set used_at = v_now, used_by_tg = p_tg_user_id where c.code_hash = v_code.code_hash;

  if v_mine.id is not null and v_mine.tg_user_id = p_tg_user_id then
    update bot.links l
       set chat_id = p_chat_id, tg_lang = coalesce(v_lang, l.tg_lang), tz = coalesce(v_code.tz, l.tz),
           blocked_at = null, last_seen_at = v_now, updated_at = v_now
     where l.id = v_mine.id;
  else
    if v_mine.id is not null then
      update bot.links l set unlinked_at = v_now, updated_at = v_now where l.id = v_mine.id;
      v_replaced := nullif(v_mine.chat_id, p_chat_id);
    end if;
    if v_theirs.id is not null then
      update bot.links l set unlinked_at = v_now, updated_at = v_now where l.id = v_theirs.id;
    end if;
    insert into bot.links (user_id, tg_user_id, chat_id, tg_lang, tz, linked_at, last_seen_at, updated_at)
    values (v_code.user_id, p_tg_user_id, p_chat_id, v_lang, coalesce(v_code.tz, 'Europe/Minsk'), v_now, v_now, v_now);
  end if;
  return pg_catalog.jsonb_build_object('status', 'linked', 'replaced_chat_id', v_replaced);
end;
$fn$;

-- 4f. Chat events: stop (/stop, «Отключить» S4: the link ends), blocked (403 «bot was blocked», my_chat_member kicked),
--     unblocked (my_chat_member member). changed = a link was there to change.
create or replace function public.bot_chat_event(p_tg_user_id bigint, p_event text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
begin
  perform meldy_private.require_service_role();
  if p_event is null or p_event not in ('stop', 'blocked', 'unblocked') then
    raise exception 'unknown chat event' using errcode = '22023';
  end if;
  if p_event = 'stop' then
    update bot.links l set unlinked_at = v_now, prompt = null, updated_at = v_now
     where l.tg_user_id = p_tg_user_id and l.unlinked_at is null;
  elsif p_event = 'blocked' then
    update bot.links l set blocked_at = coalesce(l.blocked_at, v_now), updated_at = v_now
     where l.tg_user_id = p_tg_user_id and l.unlinked_at is null;
  else
    update bot.links l set blocked_at = null, last_seen_at = v_now, updated_at = v_now
     where l.tg_user_id = p_tg_user_id and l.unlinked_at is null;
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'changed', found);
end;
$fn$;

-- 4g. Who writes: not linked → {linked: false}; linked → the link (bot.link_json), the user's exams and today's day card
--     delivery. Marks the user as seen (an action in the bot ends K2's silence): call it only for updates the user sent,
--     never from the tick.
create or replace function public.bot_whoami(p_tg_user_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_day date;
begin
  perform meldy_private.require_service_role();
  update bot.links l set last_seen_at = v_now
   where l.tg_user_id = p_tg_user_id and l.unlinked_at is null
  returning l.* into v_l;
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('linked', false);
  end if;
  v_day := (v_now at time zone v_l.tz)::date;
  return bot.link_json(v_l, v_now)
      || pg_catalog.jsonb_build_object(
           'exams', bot.exams_json(v_l.user_id),
           'reminder_today', (select pg_catalog.jsonb_build_object('kind', d.kind, 'status', d.status)
                                from bot.deliveries d
                               where d.chat_id = v_l.chat_id and d.local_day = v_day and d.kind in ('reminder', 'ask')));
end;
$fn$;

-- 4h. Settings from the bot (M2–M4, S1–S3, K2, S6). p_patch keys (any subset; an unknown key is invalid):
--       remind_at "H:MM" | "HH:MM" 07:00–22:59 (choosing a time turns the plan on unless remind_on is given);
--       remind_on boolean; tz an IANA zone; paused_until "YYYY-MM-DD" after today and within a year, or null to end the
--       pause; prompt {…} (≤ 1 KB) or null — the function's pending ForceReply; hint true — «may S6 be sent now?»
--       (true at most once an hour, stamped); ask "yes" | "pause" | "stop" — the answer to the last K2, kept on its
--       delivery row (send it with the K2 button's own patch: {} / the pause / {"remind_on": false}).
--     status: ok (+ link, + hint when asked) | invalid (+ field, reason) | unlinked. All or nothing. An empty patch only
--     marks the user as seen (K2 «Да»).
create or replace function public.bot_settings(p_tg_user_id bigint, p_patch jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_key text;
  v_on boolean;
  v_at time;
  v_tz text;
  v_day date;
  v_pause date;
  v_pause_set boolean := false;
  v_prompt jsonb;
  v_prompt_set boolean := false;
  v_hint boolean;
  v_ask text;
begin
  perform meldy_private.require_service_role();
  select l.* into v_l from bot.links l where l.tg_user_id = p_tg_user_id and l.unlinked_at is null for update;
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_patch is null or pg_catalog.jsonb_typeof(p_patch) <> 'object' then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'field', null, 'reason', 'format');
  end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_patch) loop
    if v_key not in ('remind_at', 'remind_on', 'tz', 'paused_until', 'prompt', 'hint', 'ask') then
      return pg_catalog.jsonb_build_object('status', 'invalid', 'field', v_key, 'reason', 'unknown');
    end if;
  end loop;
  if p_patch ? 'remind_on' then
    if pg_catalog.jsonb_typeof(p_patch -> 'remind_on') <> 'boolean' then
      return pg_catalog.jsonb_build_object('status', 'invalid', 'field', 'remind_on', 'reason', 'format');
    end if;
    v_on := (p_patch ->> 'remind_on')::boolean;
  end if;
  if p_patch ? 'remind_at' then
    if pg_catalog.jsonb_typeof(p_patch -> 'remind_at') <> 'string'
       or (p_patch ->> 'remind_at') !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' then
      return pg_catalog.jsonb_build_object('status', 'invalid', 'field', 'remind_at', 'reason', 'format');
    end if;
    v_at := (p_patch ->> 'remind_at')::time;
    if v_at < time '07:00' or v_at > time '22:59' then
      return pg_catalog.jsonb_build_object('status', 'invalid', 'field', 'remind_at', 'reason', 'range');
    end if;
    v_on := coalesce(v_on, true);
  end if;
  if p_patch ? 'tz' then
    if pg_catalog.jsonb_typeof(p_patch -> 'tz') <> 'string' or not bot.tz_ok(p_patch ->> 'tz') then
      return pg_catalog.jsonb_build_object('status', 'invalid', 'field', 'tz', 'reason', 'unknown');
    end if;
    v_tz := p_patch ->> 'tz';
  end if;
  v_day := (v_now at time zone coalesce(v_tz, v_l.tz))::date;
  if p_patch ? 'paused_until' then
    v_pause_set := true;
    if pg_catalog.jsonb_typeof(p_patch -> 'paused_until') <> 'null' then
      if pg_catalog.jsonb_typeof(p_patch -> 'paused_until') <> 'string'
         or (p_patch ->> 'paused_until') !~ '^\d{4}-\d{2}-\d{2}$' then
        return pg_catalog.jsonb_build_object('status', 'invalid', 'field', 'paused_until', 'reason', 'format');
      end if;
      begin
        v_pause := (p_patch ->> 'paused_until')::date;
      exception when others then
        return pg_catalog.jsonb_build_object('status', 'invalid', 'field', 'paused_until', 'reason', 'format');
      end;
      if v_pause <= v_day then
        return pg_catalog.jsonb_build_object('status', 'invalid', 'field', 'paused_until', 'reason', 'past');
      end if;
      if v_pause > v_day + 366 then
        return pg_catalog.jsonb_build_object('status', 'invalid', 'field', 'paused_until', 'reason', 'far');
      end if;
    end if;
  end if;
  if p_patch ? 'prompt' then
    v_prompt_set := true;
    if pg_catalog.jsonb_typeof(p_patch -> 'prompt') = 'object'
       and pg_catalog.octet_length((p_patch -> 'prompt')::text) <= 1024 then
      v_prompt := p_patch -> 'prompt';
    elsif pg_catalog.jsonb_typeof(p_patch -> 'prompt') <> 'null' then
      return pg_catalog.jsonb_build_object('status', 'invalid', 'field', 'prompt', 'reason', 'format');
    end if;
  end if;
  if p_patch ? 'hint' then
    if p_patch -> 'hint' <> 'true'::jsonb then
      return pg_catalog.jsonb_build_object('status', 'invalid', 'field', 'hint', 'reason', 'format');
    end if;
    v_hint := v_l.hint_at is null or v_l.hint_at <= v_now - interval '1 hour';
  end if;
  if p_patch ? 'ask' then
    if pg_catalog.jsonb_typeof(p_patch -> 'ask') <> 'string' or (p_patch ->> 'ask') not in ('yes', 'pause', 'stop') then
      return pg_catalog.jsonb_build_object('status', 'invalid', 'field', 'ask', 'reason', 'format');
    end if;
    v_ask := p_patch ->> 'ask';
  end if;
  update bot.links l
     set remind_on = coalesce(v_on, l.remind_on), remind_at = coalesce(v_at, l.remind_at), tz = coalesce(v_tz, l.tz),
         paused_until = case when v_pause_set then v_pause else l.paused_until end,
         prompt = case when v_prompt_set then v_prompt else l.prompt end,
         hint_at = case when v_hint then v_now else l.hint_at end,
         last_seen_at = v_now, updated_at = v_now
   where l.id = v_l.id
  returning l.* into v_l;
  if v_ask is not null then
    update bot.deliveries d set answer = v_ask
     where d.id = (select x.id from bot.deliveries x
                    where x.link_id = v_l.id and x.kind = 'ask' and x.status in ('sent', 'unknown')
                    order by coalesce(x.sent_at, x.claimed_at) desc limit 1);
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'link', bot.link_json(v_l, v_now))
      || case when v_hint is not null then pg_catalog.jsonb_build_object('hint', v_hint) else '{}'::jsonb end;
end;
$fn$;

-- 4i. /today, «Начать»: everything for today's card and a session. plan = plan_inputs_for over every exam of the user
--     (the function gzips the response), overview = containers_overview_for (facts: stale keys, oral parts), session =
--     the open session of package T5 (bot.sessions row without user_id; null while that table does not exist), day =
--     today's bot.days row. Marks the user as seen.
create or replace function public.bot_today(p_tg_user_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_day date;
  v_session jsonb;
  v_dayrow jsonb;
begin
  perform meldy_private.require_service_role();
  update bot.links l set last_seen_at = v_now
   where l.tg_user_id = p_tg_user_id and l.unlinked_at is null
  returning l.* into v_l;
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('linked', false);
  end if;
  v_day := (v_now at time zone v_l.tz)::date;
  if pg_catalog.to_regclass('bot.sessions') is not null then
    execute 'select pg_catalog.to_jsonb(s) - ''user_id'' from bot.sessions s
              where s.user_id = $1 and s.status = ''open'' limit 1'
      into v_session using v_l.user_id;
  end if;
  select pg_catalog.jsonb_build_object('local_day', d.local_day, 'card_message_id', d.card_message_id,
                                       'card_used', d.card_used, 'last_message_id', d.last_message_id,
                                       'closed_at', d.closed_at)
    into v_dayrow
    from bot.days d where d.link_id = v_l.id and d.local_day = v_day;
  return pg_catalog.jsonb_build_object(
    'linked', true, 'link', bot.link_json(v_l, v_now), 'local_day', v_day,
    'plan', meldy_private.plan_inputs_for(v_l.user_id, v_day),
    'overview', meldy_private.containers_overview_for(v_l.user_id, v_day),
    'session', v_session, 'day', v_dayrow);
end;
$fn$;

-- 4j. The day's messages: p_event card (a K1 card was sent: /today; the tick's card goes through bot_delivery_done) →
--     prev_message_id = an earlier unused card of the same day, to delete; used («Начать»/«Продолжить» turned that card
--     into a session: the night's close then keeps it); last (a summary with a keyboard, I1/I2) → prev_message_id = the
--     earlier summary, whose keyboard comes off now. status: ok | invalid | unlinked.
create or replace function public.bot_card_sent(p_tg_user_id bigint, p_message_id bigint, p_event text default 'card')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_l bot.links%rowtype;
  v_day date;
  v_card bigint;
  v_used boolean;
  v_last bigint;
begin
  perform meldy_private.require_service_role();
  if p_message_id is null or p_message_id <= 0 or p_event is null or p_event not in ('card', 'used', 'last') then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  select l.* into v_l from bot.links l where l.tg_user_id = p_tg_user_id and l.unlinked_at is null;
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  v_day := (v_now at time zone v_l.tz)::date;
  if p_event = 'used' then
    update bot.days d set card_used = true, updated_at = v_now
     where d.link_id = v_l.id and d.card_message_id = p_message_id;
    return pg_catalog.jsonb_build_object('status', 'ok', 'local_day', v_day, 'updated', found);
  end if;
  insert into bot.days (link_id, local_day) values (v_l.id, v_day) on conflict (link_id, local_day) do nothing;
  select d.card_message_id, d.card_used, d.last_message_id into v_card, v_used, v_last
    from bot.days d where d.link_id = v_l.id and d.local_day = v_day
     for update;
  if p_event = 'card' then
    update bot.days d set card_message_id = p_message_id, card_used = false, updated_at = v_now
     where d.link_id = v_l.id and d.local_day = v_day;
    return pg_catalog.jsonb_build_object('status', 'ok', 'local_day', v_day, 'prev_message_id',
      case when v_card is distinct from p_message_id and not v_used then v_card end);
  end if;
  update bot.days d set last_message_id = p_message_id, updated_at = v_now
   where d.link_id = v_l.id and d.local_day = v_day;
  return pg_catalog.jsonb_build_object('status', 'ok', 'local_day', v_day, 'prev_message_id', nullif(v_last, p_message_id));
end;
$fn$;

-- 4k. The reminders' claim (spec §6.6 step 3; the engineer's fix): a link is due when its local time is in the window
--     (bot.in_window), the plan is on, not paused (paused_until = the first day back), not blocked, no answer in the
--     last 30 minutes, and no day card claimed for its chat today — that last filter runs BEFORE the limit, so a big
--     20:00 cohort drains over a few ticks. A row claimed but never tried is taken again after 10 minutes (at most 3
--     tries, still in the window); a row in sending never is (bot.sweep). Order: remind_at, link id. p_now is for tests.
create or replace function public.bot_claim_reminders(p_limit integer default 50, p_now timestamptz default null)
returns table (delivery_id bigint, chat_id bigint, local_day date, tz text)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
begin
  perform meldy_private.require_service_role();
  perform bot.sweep(array['reminder', 'ask'], v_now);
  return query
  with active as (
    select l.id as link_id, l.user_id, l.chat_id, l.tz, l.remind_at, l.paused_until,
           (v_now at time zone l.tz) as local_ts
      from bot.links l
     where l.unlinked_at is null and l.blocked_at is null and l.remind_on
  ),
  due as (
    select a.link_id, a.chat_id, a.local_ts::date as day
      from active a
     where bot.in_window(a.local_ts, a.remind_at)
       and (a.paused_until is null or a.paused_until <= a.local_ts::date)
       and not exists (select 1 from bot.deliveries d
                        where d.chat_id = a.chat_id and d.local_day = a.local_ts::date and d.kind in ('reminder', 'ask'))
       and not bot.recently_active(a.user_id, v_now, a.local_ts::date)
     order by a.remind_at, a.link_id
     limit v_limit
  ),
  fresh as (
    insert into bot.deliveries (kind, chat_id, link_id, local_day, claimed_at)
    select 'reminder', d.chat_id, d.link_id, d.day, v_now from due d
    on conflict do nothing
    returning bot.deliveries.id, bot.deliveries.chat_id, bot.deliveries.local_day, bot.deliveries.link_id
  ),
  stale as (
    update bot.deliveries d
       set claimed_at = v_now, attempts = d.attempts + 1
      from active a
     where a.link_id = d.link_id and d.kind in ('reminder', 'ask') and d.status = 'claimed' and d.attempts < 3
       and d.claimed_at < v_now - interval '10 minutes'
       and d.local_day = a.local_ts::date
       and bot.in_window(a.local_ts, a.remind_at)
       and (a.paused_until is null or a.paused_until <= a.local_ts::date)
       and not bot.recently_active(a.user_id, v_now, a.local_ts::date)
    returning d.id, d.chat_id, d.local_day, d.link_id
  )
  select x.id, x.chat_id, x.local_day, a.tz
    from (select f.id, f.chat_id, f.local_day, f.link_id from fresh f
          union all
          select s.id, s.chat_id, s.local_day, s.link_id from stale s) x
    join active a on a.link_id = x.link_id
   order by x.id;
end;
$fn$;

-- 4l. What the tick needs for one claimed day card. card: skip (the row is already closed as skipped, or not ours any
--     more: reason not_claimed | unlinked | blocked | off | paused | silent) | K2 (three cards sent in a row and no
--     answer, on the site or in the bot, and no action in the bot since the first of them: «Присылать план дальше?»
--     instead of the fourth; the row becomes kind ask) | K1. silent = K2 went out and nothing happened since. For K1
--     and K2: the link, plan (plan_inputs_for on the row's local day) and overview; the function's own plan then says
--     done | nothing | exam_today → bot_delivery_done(id, 'skipped', null, <that word>).
create or replace function public.bot_reminder_context(p_delivery_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_d bot.deliveries%rowtype;
  v_l bot.links%rowtype;
  v_reason text;
  v_sent timestamptz[];
  v_k2 boolean := false;
begin
  perform meldy_private.require_service_role();
  select d.* into v_d from bot.deliveries d where d.id = p_delivery_id for update;
  if v_d.id is null or v_d.kind not in ('reminder', 'ask') or v_d.status <> 'claimed' then
    return pg_catalog.jsonb_build_object('status', 'gone', 'delivery_id', p_delivery_id, 'card', 'skip',
                                         'reason', 'not_claimed');
  end if;
  select l.* into v_l from bot.links l where l.id = v_d.link_id;
  v_reason := case when v_l.id is null or v_l.unlinked_at is not null then 'unlinked'
                   when v_l.blocked_at is not null then 'blocked'
                   when not v_l.remind_on then 'off'
                   when v_l.paused_until > v_d.local_day then 'paused'
                   when v_l.asked_at is not null and coalesce(v_l.last_seen_at, '-infinity'::timestamptz) <= v_l.asked_at
                        and not bot.answered_since(v_l.user_id, v_l.asked_at) then 'silent' end;
  if v_reason is not null then
    update bot.deliveries d set status = 'skipped', error = v_reason where d.id = v_d.id;
    return pg_catalog.jsonb_build_object('status', 'ok', 'delivery_id', v_d.id, 'card', 'skip', 'reason', v_reason);
  end if;
  select pg_catalog.array_agg(x.t order by x.t desc) into v_sent
    from (select coalesce(d.sent_at, d.claimed_at) as t from bot.deliveries d
           where d.link_id = v_l.id and d.kind = 'reminder' and d.status in ('sent', 'unknown') and d.id <> v_d.id
           order by 1 desc limit 3) x;
  if coalesce(pg_catalog.cardinality(v_sent), 0) = 3 then
    v_k2 := coalesce(v_l.last_seen_at, '-infinity'::timestamptz) <= v_sent[3]
            and not bot.answered_since(v_l.user_id, v_sent[3]);
  end if;
  update bot.deliveries d set kind = case when v_k2 then 'ask' else 'reminder' end
   where d.id = v_d.id and d.kind <> case when v_k2 then 'ask' else 'reminder' end;
  return pg_catalog.jsonb_build_object(
    'status', 'ok', 'delivery_id', v_d.id, 'card', case when v_k2 then 'K2' else 'K1' end,
    'kind', case when v_k2 then 'ask' else 'reminder' end, 'reason', null,
    'chat_id', v_d.chat_id, 'local_day', v_d.local_day, 'tz', v_l.tz,
    'link', bot.link_json(v_l, v_now),
    'plan', meldy_private.plan_inputs_for(v_l.user_id, v_d.local_day),
    'overview', meldy_private.containers_overview_for(v_l.user_id, v_d.local_day));
end;
$fn$;

-- 4m. Right before sendMessage / the day close's calls: claimed → sending. false: someone else took the row, it was
--     given up, or the link ended or was blocked meanwhile — do NOT send.
create or replace function public.bot_delivery_sending(p_delivery_id bigint, p_now timestamptz default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform meldy_private.require_service_role();
  update bot.deliveries d set status = 'sending', claimed_at = coalesce(p_now, pg_catalog.now())
    from bot.links l
   where d.id = p_delivery_id and d.status = 'claimed'
     and l.id = d.link_id and l.unlinked_at is null and l.blocked_at is null;
  return found;
end;
$fn$;

-- 4n. Telegram answered 429 (spec §6.7): nothing went out, so the row may still go out once — back from sending to
--     claimed, its attempts kept, and a later claim takes it again after 10 minutes under its own rules (at most 3
--     tries in all). Only while the row is in sending and still due: the link active and not blocked; for the day
--     card and K3 the plan on, no pause, the same local day and the window still open; for the night's close one of
--     the last two days; a try left. true → back to claimed. false → not in sending (nothing changes), or no longer due
--     (closed as failed with p_error; no further call). Then the step stops: the rows not tried yet stay claimed.
create or replace function public.bot_delivery_retry(p_delivery_id bigint, p_error text default '429',
                                                     p_now timestamptz default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_d bot.deliveries%rowtype;
  v_l bot.links%rowtype;
  v_local timestamp;
  v_due boolean;
  v_error text := pg_catalog.left(coalesce(nullif(p_error, ''), '429'), 200);
begin
  perform meldy_private.require_service_role();
  select d.* into v_d from bot.deliveries d where d.id = p_delivery_id for update;
  if v_d.id is null or v_d.status <> 'sending' then
    return false;
  end if;
  select l.* into v_l from bot.links l where l.id = v_d.link_id;
  v_local := v_now at time zone v_l.tz;
  v_due := v_l.id is not null and v_l.unlinked_at is null and v_l.blocked_at is null and v_d.attempts < 3
           and case when v_d.kind = 'day_close' then v_d.local_day >= v_local::date - 2
                    when v_d.kind in ('reminder', 'ask', 'after_date') then
                      v_l.remind_on and (v_l.paused_until is null or v_l.paused_until <= v_local::date)
                      and v_d.local_day = v_local::date and bot.in_window(v_local, v_l.remind_at)
                    else true end;
  if coalesce(v_due, false) then
    update bot.deliveries d set status = 'claimed', claimed_at = v_now, error = v_error where d.id = v_d.id;
    return true;
  end if;
  update bot.deliveries d set status = 'failed', error = v_error where d.id = v_d.id;
  return false;
end;
$fn$;

-- 4o. The outcome: sent (+ the message id) | failed (+ the code: 403, 400 …) | skipped (+ a short reason: done, nothing,
--     exam_today …). A 429 is not an outcome: bot_delivery_retry. A sent K1 becomes today's card (prev_card_message_id
--     = an unused /today card of that day, to delete); a sent K2 sets asked_at; a day_close closes its day. An unknown
--     row may still be resolved. status: ok | ignored.
create or replace function public.bot_delivery_done(p_delivery_id bigint, p_status text, p_tg_message_id bigint default null,
                                                    p_error text default null, p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_d bot.deliveries%rowtype;
  v_card bigint;
  v_used boolean;
  v_prev bigint;
begin
  perform meldy_private.require_service_role();
  if p_status is null or p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'invalid delivery status' using errcode = '22023';
  end if;
  update bot.deliveries d
     set status = p_status,
         sent_at = case when p_status = 'sent' then v_now end,
         tg_message_id = case when p_status = 'sent' then p_tg_message_id end,
         error = case when p_status = 'sent' then null else pg_catalog.left(p_error, 200) end
   where d.id = p_delivery_id and d.status in ('claimed', 'sending', 'unknown')
  returning d.* into v_d;
  if v_d.id is null then
    return pg_catalog.jsonb_build_object('status', 'ignored');
  end if;
  if p_status = 'sent' and v_d.kind = 'ask' then
    update bot.links l set asked_at = v_now, updated_at = v_now where l.id = v_d.link_id;
  elsif p_status = 'sent' and v_d.kind = 'reminder' and p_tg_message_id is not null then
    insert into bot.days (link_id, local_day) values (v_d.link_id, v_d.local_day) on conflict (link_id, local_day) do nothing;
    select dy.card_message_id, dy.card_used into v_card, v_used
      from bot.days dy where dy.link_id = v_d.link_id and dy.local_day = v_d.local_day
       for update;
    update bot.days dy set card_message_id = p_tg_message_id, card_used = false, updated_at = v_now
     where dy.link_id = v_d.link_id and dy.local_day = v_d.local_day;
    v_prev := case when v_card is distinct from p_tg_message_id and not v_used then v_card end;
  elsif v_d.kind = 'day_close' then
    update bot.days dy set closed_at = v_now, updated_at = v_now
     where dy.link_id = v_d.link_id and dy.local_day = v_d.local_day;
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'kind', v_d.kind, 'prev_card_message_id', v_prev);
end;
$fn$;

-- 4p. The night's close (spec §6.6 step 5, decision 20): for each link a day of the last two local days that has an
--     unused card (delete it) or a summary with a keyboard (take the keyboard off), once (kind day_close). A card that
--     became a session (card_used, or a session of package T5 in that message: bot.session_message) is never deleted.
--     Blocked and unlinked chats are left alone.
create or replace function public.bot_claim_day_close(p_limit integer default 50, p_now timestamptz default null)
returns table (delivery_id bigint, chat_id bigint, local_day date, card_message_id bigint, last_message_id bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
begin
  perform meldy_private.require_service_role();
  perform bot.sweep(array['day_close'], v_now);
  return query
  with active as (
    select l.id as link_id, l.chat_id, (v_now at time zone l.tz)::date as today
      from bot.links l
     where l.unlinked_at is null and l.blocked_at is null
  ),
  due as (
    select a.link_id, a.chat_id, dy.local_day
      from bot.days dy
      join active a on a.link_id = dy.link_id
     where dy.closed_at is null and dy.local_day < a.today and dy.local_day >= a.today - 2
       and ((dy.card_message_id is not null and not dy.card_used) or dy.last_message_id is not null)
       and not exists (select 1 from bot.deliveries d
                        where d.kind = 'day_close' and d.chat_id = a.chat_id and d.local_day = dy.local_day)
     order by dy.local_day, a.link_id
     limit v_limit
  ),
  fresh as (
    insert into bot.deliveries (kind, chat_id, link_id, local_day, claimed_at)
    select 'day_close', d.chat_id, d.link_id, d.local_day, v_now from due d
    on conflict do nothing
    returning bot.deliveries.id, bot.deliveries.chat_id, bot.deliveries.local_day, bot.deliveries.link_id
  ),
  stale as (
    update bot.deliveries d
       set claimed_at = v_now, attempts = d.attempts + 1
      from active a
     where a.link_id = d.link_id and d.kind = 'day_close' and d.status = 'claimed' and d.attempts < 3
       and d.claimed_at < v_now - interval '10 minutes' and d.local_day >= a.today - 2
    returning d.id, d.chat_id, d.local_day, d.link_id
  )
  select x.id, x.chat_id, x.local_day,
         case when not dy.card_used and not bot.session_message(x.chat_id, dy.card_message_id)
              then dy.card_message_id end,
         dy.last_message_id
    from (select f.id, f.chat_id, f.local_day, f.link_id from fresh f
          union all
          select s.id, s.chat_id, s.local_day, s.link_id from stale s) x
    join bot.days dy on dy.link_id = x.link_id and dy.local_day = x.local_day
   order by x.id;
end;
$fn$;

-- 4q. K3 «Экзамен прошёл …» (spec §4.2, §8.2 «после даты — по одному разу»): on the day after an exam's last test date
--     (or within two more days, if the bot could not send it then), at the link's usual time, under the reminder's
--     rules (window, plan on, no pause, not blocked, no answer in the last 30 minutes); once per user and exam, ever.
--     exam = bot.after_date_json (title, dates, active days, answers, the figure). ref = the container id.
create or replace function public.bot_claim_after_date(p_limit integer default 50, p_now timestamptz default null)
returns table (delivery_id bigint, chat_id bigint, local_day date, tz text, container_id uuid, exam jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
#variable_conflict use_column
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 500));
begin
  perform meldy_private.require_service_role();
  perform bot.sweep(array['after_date'], v_now);
  return query
  with ready as (
    select l.id as link_id, l.user_id, l.chat_id, l.tz, (v_now at time zone l.tz)::date as day
      from bot.links l
     where l.unlinked_at is null and l.blocked_at is null and l.remind_on
       and bot.in_window(v_now at time zone l.tz, l.remind_at)
       and (l.paused_until is null or l.paused_until <= (v_now at time zone l.tz)::date)
       and not bot.recently_active(l.user_id, v_now, (v_now at time zone l.tz)::date)
  ),
  exams as (
    select r.link_id, r.user_id, r.chat_id, r.tz, r.day, c.id as cid,
           coalesce((select pg_catalog.max(coalesce(s.exam_date, c.exam_date)) from public.container_subjects s
                      where s.container_id = c.id), c.exam_date) as last_date
      from ready r
      cross join lateral meldy_private.container_ids_of(r.user_id) as x(id)
      join public.containers c on c.id = x.id
  ),
  due as (
    select e.* from exams e
     where e.last_date is not null and e.day between e.last_date + 1 and e.last_date + 3
       and not exists (select 1 from bot.deliveries d join bot.links l2 on l2.id = d.link_id
                        where d.kind = 'after_date' and d.ref = e.cid::text and l2.user_id = e.user_id)
     order by e.day, e.link_id, e.cid
     limit v_limit
  ),
  fresh as (
    insert into bot.deliveries (kind, chat_id, link_id, local_day, ref, claimed_at)
    select 'after_date', d.chat_id, d.link_id, d.day, d.cid::text, v_now from due d
    on conflict do nothing
    returning bot.deliveries.id, bot.deliveries.chat_id, bot.deliveries.local_day, bot.deliveries.link_id,
              bot.deliveries.ref
  ),
  stale as (
    update bot.deliveries d
       set claimed_at = v_now, attempts = d.attempts + 1
      from ready r
     where r.link_id = d.link_id and d.kind = 'after_date' and d.status = 'claimed' and d.attempts < 3
       and d.claimed_at < v_now - interval '10 minutes' and d.local_day = r.day
    returning d.id, d.chat_id, d.local_day, d.link_id, d.ref
  )
  -- the rows come from RETURNING: a data-modifying CTE's rows are not visible to a join on bot.deliveries here
  select x.id, x.chat_id, x.local_day, l.tz, x.ref::uuid,
         bot.after_date_json(l.user_id, x.ref::uuid,
                             coalesce((select pg_catalog.max(coalesce(s.exam_date, c.exam_date))
                                         from public.container_subjects s where s.container_id = c.id), c.exam_date))
    from (select f.id, f.chat_id, f.local_day, f.link_id, f.ref from fresh f
          union all
          select s.id, s.chat_id, s.local_day, s.link_id, s.ref from stale s) x
    join bot.links l on l.id = x.link_id
    left join public.containers c on c.id = x.ref::uuid
   order by x.id;
end;
$fn$;

-- 5. Grants of this file: the API roles run what is theirs. The revokes file takes back what Supabase's default
--    privileges give anon and authenticated on new functions (the functions check their callers themselves).
grant execute on function public.telegram_link_start(text), public.telegram_link_state(),
  public.telegram_settings(boolean, time, text), public.telegram_unlink() to authenticated;
grant execute on function public.bot_setup(text, bigint, text, text, text), public.bot_update_begin(bigint, timestamptz),
  public.bot_update_done(bigint), public.bot_update_failed(bigint, text), public.bot_tick_beat(jsonb), public.bot_status(),
  public.bot_link_claim(text, bigint, bigint, text, timestamptz), public.bot_chat_event(bigint, text),
  public.bot_whoami(bigint), public.bot_settings(bigint, jsonb), public.bot_today(bigint),
  public.bot_card_sent(bigint, bigint, text), public.bot_claim_reminders(integer, timestamptz),
  public.bot_reminder_context(bigint), public.bot_delivery_sending(bigint, timestamptz),
  public.bot_delivery_retry(bigint, text, timestamptz), public.bot_delivery_done(bigint, text, bigint, text, timestamptz),
  public.bot_claim_day_close(integer, timestamptz), public.bot_claim_after_date(integer, timestamptz) to service_role;
