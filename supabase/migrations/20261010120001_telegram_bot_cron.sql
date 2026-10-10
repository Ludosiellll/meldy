-- telegram_bot_cron (second file of 20261010120000_telegram_bot.sql): the minute tick (spec §6.6, decision 8).
-- pg_cron runs `select bot.tick()` every minute; bot.tick() reads the function's URL and the tick token from bot.config
-- and POSTs to …/telegram/tick through pg_net. The function checks x-meldy-tick (HMAC of the bot token), answers 202 at
-- once and works in EdgeRuntime.waitUntil; pg_net only waits up to 10 s for that answer. Until POST /telegram/setup has
-- filled bot.config (bot_setup) the job fires but bot.tick() returns null without a request.
-- This file holds no secret and no project value: the URL and the token come from bot.config.
-- Enabling the extensions, as the Supabase docs give it (guides/cron/install; database/extensions/pg_net and the
-- automatic-embeddings guide, read 2026-10-10): pg_cron into pg_catalog (it makes its own schema cron, with grants to
-- postgres), pg_net into extensions (its functions live in schema net). Both were available but not installed on the
-- live project (pg_cron 1.6.4, pg_net 0.20.0). If the connector cannot create them, the owner enables both in
-- Dashboard → Database → Extensions and this file runs again (spec §9, step 2).
-- pg_net keeps queued requests (with their headers: the tick token) in net.http_request_queue until sent and the
-- responses 6 hours in net._http_response; schema net is not exposed by the API, and anon/authenticated cannot log in.
-- Re-runnable: IF NOT EXISTS, OR REPLACE, cron.schedule replaces a job of the same name.
-- Local rehearsal: supabase/tests/local/telegram_bot_run.sh stubs cron and net (the two CREATE EXTENSION lines are the
-- only ones it skips). Rollback: supabase/rollback/20261010120000_telegram_bot_down.sql (unschedules the job).
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
create extension if not exists pg_net with schema extensions;

-- One POST to the bot's tick route. forceFunctionRegion keeps the function next to the database (eu-north-1).
create or replace function bot.tick()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_url text;
  v_token text;
begin
  perform meldy_private.require_service_role();
  select c.function_url, c.tick_token into v_url, v_token from bot.config c where c.id = 1;
  if v_url is null or v_token is null then
    return null;   -- /setup has not run yet: stay quiet
  end if;
  return net.http_post(
    url := v_url || '/tick?forceFunctionRegion=eu-north-1',
    body := pg_catalog.jsonb_build_object('at', pg_catalog.now()),
    headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'x-meldy-tick', v_token),
    timeout_milliseconds := 10000);
end;
$fn$;
comment on function bot.tick() is 'The minute tick (pg_cron job meldy-telegram-tick): POST <function_url>/tick with x-meldy-tick, or null before /setup.';

-- Every minute (spec §6.6). Re-running replaces the job of the same name.
select cron.schedule('meldy-telegram-tick', '* * * * *', 'select bot.tick()');
