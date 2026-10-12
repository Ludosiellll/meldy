-- telegram_bot_monitor rollback (20261012100000_telegram_bot_monitor.sql, the site's outage monitor). The owner runs it
-- by hand in the SQL Editor, never an agent: it deletes the monitor's state (failures in a row, the last alerts) and
-- its switch (bot.config.monitor_chat_id and monitor_site). Nothing else changes: no other object of T1 or of the later
-- packages, of the exam container or of the oral path.
-- Run it before T1's rollback (20261010120000_telegram_bot_down.sql drops schema bot without CASCADE and stops while
-- bot.monitor is there). Before it, redeploy the function without the monitor's port (index.ts without `monitor`, so
-- STUBS.monitor), or accept that meanwhile the tick's step only counts «missing» (bot_monitor_state is gone; nothing is
-- checked or sent, the other steps go on). Re-runnable. Locally the catalog fingerprint after it equals the one before
-- the migration.
begin;
drop function if exists public.bot_monitor_save(jsonb), public.bot_monitor_claim(timestamptz, timestamptz, timestamptz),
  public.bot_monitor_state(timestamptz);
drop table if exists bot.monitor;
alter table if exists bot.config drop constraint if exists config_monitor_site_check,
  drop constraint if exists config_monitor_chat_check;
alter table if exists bot.config drop column if exists monitor_site, drop column if exists monitor_chat_id;
commit;
