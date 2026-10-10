-- telegram_bot_files rollback (20261010120005_telegram_bot_files.sql, package T9). The owner runs it by hand in the SQL
-- Editor, never an agent: it deletes the open tickets of files forwarded to the bot (a student then forwards the file
-- again). Nothing else changes: no object of T1 (schema bot, bot.links), of the exam container or of the oral path.
-- Run it before T1's rollback (20261010120000_telegram_bot_down.sql drops schema bot without CASCADE and stops while
-- bot.files is there). Before it, unwire the file package in the function (index.ts back to `files: STUBS.files`):
-- while it stays wired, GET /telegram/file answers 503 and a forwarded document gets no answer (bot_file_offer is
-- gone; the update is logged as failed). Re-runnable. Locally the catalog fingerprint after it equals the one before
-- the migration.
begin;
drop function if exists public.telegram_file_take(text), public.bot_file_redeem(text),
  public.bot_file_offer(bigint, text, text, bigint, text);
drop table if exists bot.files;
commit;
