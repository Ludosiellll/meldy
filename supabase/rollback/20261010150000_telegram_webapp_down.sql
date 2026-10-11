-- telegram_webapp rollback (20261010150000_telegram_webapp.sql, the Mini App). The owner runs it by hand in the SQL
-- Editor, never an agent: it deletes the record of recent Mini App sign-ins (their replay protection; at most two
-- hours of it). The Mini App links nothing, so bot.links is untouched. Nothing else changes: no object of T1 or of the
-- later packages, of the exam container or of the oral path.
-- Run it before T1's rollback (20261010120000_telegram_bot_down.sql drops schema bot without CASCADE and stops while
-- bot.webapp_uses is there). Before it, redeploy the function without the Mini App's port, or accept that
-- /telegram/webapp/session answers 503 meanwhile (bot_webapp_session is gone; the site's /tg then says Meldy is
-- unavailable and offers the site in the browser). Re-runnable. Locally the catalog fingerprint after it equals the
-- one before the migration.
begin;
drop function if exists public.bot_webapp_session(bigint, text, timestamptz, timestamptz);
drop table if exists bot.webapp_uses;
commit;
