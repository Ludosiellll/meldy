-- telegram_bot rollback (20261010120000_telegram_bot.sql, 20261010120001_telegram_bot_cron.sql,
-- 20261010120002_telegram_bot_revokes.sql). The owner runs it by hand in the SQL Editor, never an agent: it deletes the
-- bot's state (links, codes, deliveries, the ledger). Nothing of the exam container or the oral path changes; test
-- answers made in the bot stay (they are the container's). In order: the tick job (and its run history), the public
-- functions, the helpers of schema bot, the tables, the schema. The schema is dropped without CASCADE: while objects of
-- later packages remain in it (bot.sessions of T5, the group tables of T7, bot.files of T9) the drop stops and the whole
-- file rolls back — run those packages' rollbacks first. pg_cron and pg_net stay installed (enabling them was additive;
-- drop them by hand only if nothing else uses them). Re-runnable. Locally (telegram_bot_run.sh) the catalog fingerprint
-- after it equals the one before the migration.
begin;
do $do$
begin
  if pg_catalog.to_regclass('cron.job') is not null then
    if pg_catalog.to_regclass('cron.job_run_details') is not null then
      delete from cron.job_run_details r
       where r.jobid in (select j.jobid from cron.job j where j.jobname = 'meldy-telegram-tick');
    end if;
    if exists (select 1 from cron.job j where j.jobname = 'meldy-telegram-tick') then
      perform cron.unschedule('meldy-telegram-tick');
    end if;
  end if;
end
$do$;
drop function if exists public.bot_setup(text, bigint, text, text, text), public.bot_update_begin(bigint, timestamptz),
  public.bot_update_done(bigint), public.bot_update_failed(bigint, text), public.bot_tick_beat(jsonb), public.bot_status(),
  public.bot_link_claim(text, bigint, bigint, text, timestamptz), public.bot_chat_event(bigint, text),
  public.bot_whoami(bigint), public.bot_settings(bigint, jsonb), public.bot_today(bigint),
  public.bot_card_sent(bigint, bigint, text), public.bot_claim_reminders(integer, timestamptz),
  public.bot_reminder_context(bigint), public.bot_delivery_sending(bigint, timestamptz),
  public.bot_delivery_retry(bigint, text, timestamptz), public.bot_delivery_done(bigint, text, bigint, text, timestamptz),
  public.bot_claim_day_close(integer, timestamptz), public.bot_claim_after_date(integer, timestamptz);
drop function if exists public.telegram_link_start(text), public.telegram_link_state(),
  public.telegram_settings(boolean, time, text), public.telegram_unlink();
drop function if exists bot.tick(timestamptz), bot.tick_due(timestamptz), bot.tick_mode(timestamptz),
  bot.cleanup(timestamptz), bot.session_message(bigint, bigint),
  bot.after_date_json(uuid, uuid, date), bot.sweep(text[], timestamptz), bot.calls_json(timestamptz),
  bot.site_state(uuid), bot.exams_json(uuid), bot.answered_since(uuid, timestamptz),
  bot.recently_active(uuid, timestamptz, date), bot.in_window(timestamp, time), bot.tz_ok(text),
  bot.local_day(text, timestamptz);
-- These two take the row type of bot.links: they go before the table.
do $do$
begin
  if pg_catalog.to_regclass('bot.links') is not null then
    drop function if exists bot.link_json(bot.links, timestamptz), bot.active_link(bigint);
  end if;
end
$do$;
drop table if exists bot.days, bot.deliveries, bot.claim_failures, bot.updates, bot.usage, bot.link_codes, bot.links,
  bot.config;
drop schema if exists bot;
commit;
