-- telegram_bot_monitor
-- Repo file: supabase/migrations/20261012100000_telegram_bot_monitor.sql (the site's outage monitor in the bot's tick,
-- 2026-10-12). Plan: meldy-notes/10_Project/Project_Review_2026-10-11.md and Roadmap.md («монитор с сообщением в
-- Telegram»): on 2026-10-12 the voice was down 02:51–03:38 UTC (/api/tts 502, /api/health/deep `tts: network`) and was
-- found by hand. The function side: supabase/functions/_shared/bot/monitor.ts (the tick's step «monitor»).
-- Needs 20261010120000_telegram_bot.sql (schema bot, bot.config, bot.tick_mode) and the container's
-- meldy_private.require_service_role(). Rollback: supabase/rollback/20261012100000_telegram_bot_monitor_down.sql.
-- Local rehearsal (never live): supabase/tests/local/telegram_bot_monitor.sql, run by
-- supabase/tests/local/telegram_bot_run.sh (stage MON). The read-only contract supabase/tests/telegram_bot.sql carries
-- this package as «MON» (checks 100–109).
--
-- The monitor is OFF until the owner sets bot.config.monitor_chat_id by hand: while it is null every function below
-- answers {"status": "off"} and changes nothing, and the tick's step does nothing more. Each tick reads
-- bot_monitor_state; when a slot is due (/api/health and /try every 5 minutes, every 15 on the saving mode's beat;
-- /api/health/deep every 30) the function claims it with bot_monitor_claim, checks the site, writes to the owner's
-- chat when something is down or back, and saves the checks' state with bot_monitor_save. The rule (2 failures in a
-- row → an alert, again at most every 6 hours, one recovery) is in monitor.ts; the database keeps the state and makes
-- the claims atomic: two ticks at once never run the same checks.
-- Every expected outcome is a status. Errors: 42501 (without the service role), 22023 (a call the function never
-- means). Additive and re-runnable (IF NOT EXISTS, OR REPLACE; the two checks of bot.config are dropped and made again):
-- bot.config gets two nullable columns with their checks, and nothing else of T1 changes. The grants of section 4
-- follow T1's revokes file.

-- 1. The switch and the site (bot.config; the owner sets them by hand in the SQL Editor).
--    monitor_chat_id: the chat the monitor writes to — the owner's private chat with the bot (the owner's Telegram user
--    id, after /start in the bot) or a group's; null: the monitor is off. monitor_site: the site to check,
--    https://<host>[:port] with no path, query or credentials; null: the bot's site (https://ludosiel-studyforge.hf.space).
alter table bot.config add column if not exists monitor_chat_id bigint;
alter table bot.config add column if not exists monitor_site text;
alter table bot.config drop constraint if exists config_monitor_chat_check;
alter table bot.config add constraint config_monitor_chat_check check (monitor_chat_id is null or monitor_chat_id <> 0);
alter table bot.config drop constraint if exists config_monitor_site_check;
alter table bot.config add constraint config_monitor_site_check check (monitor_site is null
  or monitor_site ~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$');
comment on column bot.config.monitor_chat_id is 'The outage monitor writes here (the owner''s chat with the bot); null: the monitor is off.';
comment on column bot.config.monitor_site is 'The site the outage monitor checks: https://<host>[:port]; null: https://ludosiel-studyforge.hf.space.';

-- 2. The monitor's state: one row, written only by the functions below. checks: per check (health, try, deep, tts,
--    gemini, groq, supabase) {fails, since, alerted, ok, code} — failures in a row, when the failure began, when its last
--    alert went out, when the check was last OK (ISO times), and the last failure's short code (an HTTP status,
--    timeout, network, no_bundle, bad_json, not_ok, or a deep check's own: network, rate_limited, http_503 …); never a
--    text. health_slot / deep_slot: the start of the last slot a run claimed (5 or 15 minutes; 30 minutes).
create table if not exists bot.monitor (
  id smallint primary key default 1,
  checks jsonb not null default '{}'::jsonb,
  health_slot timestamptz,
  deep_slot timestamptz,
  updated_at timestamptz not null default now(),
  constraint monitor_one_row check (id = 1),
  constraint monitor_checks_check check (jsonb_typeof(checks) = 'object' and octet_length(checks::text) <= 4096)
);
insert into bot.monitor (id) values (1) on conflict (id) do nothing;
alter table bot.monitor enable row level security;
comment on table bot.monitor is 'One row: the outage monitor''s state per check (failures in a row, since, last alert, last OK, a short code) and the slots its runs claimed.';

-- 3. The bot (service role): the tick's step «monitor».
-- 3a. Every tick: off (no chat set), or what a run needs — the chat, the site (null: the bot's), the tick's mode
--     (when_due: the five-minute checks go on the 15-minute beat), the slots claimed last and the state per check.
--     Reads only. p_now is for tests; the function passes nothing.
create or replace function public.bot_monitor_state(p_now timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_chat bigint;
  v_site text;
  v_m bot.monitor%rowtype;
begin
  perform meldy_private.require_service_role();
  select c.monitor_chat_id, c.monitor_site into v_chat, v_site from bot.config c where c.id = 1;
  if v_chat is null then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  select m.* into v_m from bot.monitor m where m.id = 1;
  return pg_catalog.jsonb_build_object(
    'status', 'on', 'chat_id', v_chat, 'site', v_site, 'tick_mode', bot.tick_mode(v_now),
    'health_slot', v_m.health_slot, 'deep_slot', v_m.deep_slot, 'checks', coalesce(v_m.checks, '{}'::jsonb));
end;
$fn$;
comment on function public.bot_monitor_state(timestamptz) is 'Outage monitor (service role): {status: off} | {status: on, chat_id, site, tick_mode, health_slot, deep_slot, checks}. Reads only.';

-- 3b. A run claims its slots before it checks anything: p_health_slot (the five-minute checks) and p_deep_slot (the
--     deep check), each the start of the function's current slot, or null (not this time). A slot is taken when it is
--     after the one claimed last and at most an hour ahead of the database's clock: two ticks at once never take the
--     same slot. Answers what was taken and the state per check as it is now (the run judges its results against it).
--     After a day without a run (the monitor was off, or the tick stopped) the state starts over, so an old failure
--     never ends in a recovery message days later. p_now is for tests.
create or replace function public.bot_monitor_claim(p_health_slot timestamptz default null,
                                                    p_deep_slot timestamptz default null,
                                                    p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_m bot.monitor%rowtype;
  v_health boolean;
  v_deep boolean;
begin
  perform meldy_private.require_service_role();
  if (select c.monitor_chat_id from bot.config c where c.id = 1) is null then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  insert into bot.monitor (id) values (1) on conflict (id) do nothing;
  select m.* into v_m from bot.monitor m where m.id = 1 for update;
  v_health := p_health_slot is not null and p_health_slot <= v_now + interval '1 hour'
              and (v_m.health_slot is null or p_health_slot > v_m.health_slot);
  v_deep := p_deep_slot is not null and p_deep_slot <= v_now + interval '1 hour'
            and (v_m.deep_slot is null or p_deep_slot > v_m.deep_slot);
  if v_health or v_deep then
    update bot.monitor m
       set health_slot = case when v_health then p_health_slot else m.health_slot end,
           deep_slot = case when v_deep then p_deep_slot else m.deep_slot end,
           checks = case when greatest(m.health_slot, m.deep_slot) < v_now - interval '1 day' then '{}'::jsonb
                         else m.checks end,
           updated_at = v_now
     where m.id = 1
    returning m.* into v_m;
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'health', v_health, 'deep', v_deep, 'checks', v_m.checks);
end;
$fn$;
comment on function public.bot_monitor_claim(timestamptz, timestamptz, timestamptz) is 'Outage monitor (service role): claims the slots of a run → {status: ok, health, deep, checks} | {status: off}. A slot is taken once.';

-- 3c. After a run: the state of the checks it ran (their keys are replaced, the others stay), as monitor.ts judged them
--     — `alerted` only after its message went out. Each check is {fails, since, alerted, ok, code} with fails a whole
--     number, the times ISO 8601 UTC (or null) and the code a short word (or null): anything else, a name that is not
--     a check's, or more than 4 KB is 22023, so no provider's text is ever kept. off: no chat set, nothing changes.
create or replace function public.bot_monitor_save(p_checks jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_name text;
  v_check jsonb;
  v_time constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$';
begin
  perform meldy_private.require_service_role();
  if p_checks is null or pg_catalog.jsonb_typeof(p_checks) <> 'object' or pg_catalog.octet_length(p_checks::text) > 4096 then
    raise exception 'bad monitor state' using errcode = '22023';
  end if;
  for v_name, v_check in select e.key, e.value from pg_catalog.jsonb_each(p_checks) e loop
    if v_name !~ '^[a-z][a-z0-9_]{0,15}$' or pg_catalog.jsonb_typeof(v_check) <> 'object' then
      raise exception 'bad monitor state' using errcode = '22023';
    end if;
    if exists (select 1 from pg_catalog.jsonb_object_keys(v_check) k where k not in ('fails', 'since', 'alerted', 'ok', 'code'))
       or pg_catalog.jsonb_typeof(v_check -> 'fails') is distinct from 'number' or (v_check ->> 'fails') !~ '^[0-9]{1,6}$'
       or coalesce(v_check ->> 'since', '1970-01-01T00:00:00Z') !~ v_time
       or coalesce(v_check ->> 'alerted', '1970-01-01T00:00:00Z') !~ v_time
       or coalesce(v_check ->> 'ok', '1970-01-01T00:00:00Z') !~ v_time
       or coalesce(v_check ->> 'code', 'none') !~ '^[a-z0-9_]{1,32}$' then
      raise exception 'bad monitor state' using errcode = '22023';
    end if;
  end loop;
  if (select c.monitor_chat_id from bot.config c where c.id = 1) is null then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  insert into bot.monitor (id) values (1) on conflict (id) do nothing;
  update bot.monitor m set checks = m.checks || p_checks, updated_at = pg_catalog.now() where m.id = 1;
  return pg_catalog.jsonb_build_object('status', 'ok');
end;
$fn$;
comment on function public.bot_monitor_save(jsonb) is 'Outage monitor (service role): the state of the checks a run ran, per check {fails, since, alerted, ok, code} → {status: ok} | {status: off}. Codes and ISO times only (else 22023).';

-- 4. Grants, as T1's revokes file does for its objects (re-runnable). Supabase gives new public functions to anon and
--    authenticated, PostgreSQL gives every new function to PUBLIC: taken back here. Safety does not depend on it: the
--    functions check the service role first, schema bot has no USAGE for clients and bot.monitor has row security
--    without a policy.
revoke all on table bot.monitor from public, anon, authenticated;
revoke all on function public.bot_monitor_state(timestamptz), public.bot_monitor_claim(timestamptz, timestamptz, timestamptz),
  public.bot_monitor_save(jsonb) from public, anon, authenticated;
grant execute on function public.bot_monitor_state(timestamptz), public.bot_monitor_claim(timestamptz, timestamptz, timestamptz),
  public.bot_monitor_save(jsonb) to service_role;
