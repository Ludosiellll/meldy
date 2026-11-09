-- Rollback of supabase/migrations/20261109090100_bot_support.sql (support through the bot, account deletion requests).
-- The owner runs it by hand, never an agent: it DELETES what people wrote to support (bot.support_messages, sent or
-- waiting), every account deletion request (public.account_deletion_requests) and the binding of the owner's chat
-- (bot.config.support_chat_id / support_tg_user_id, with the username's hash). Read the open requests first:
--   select user_id, requested_at from public.account_deletion_requests where cancelled_at is null order by requested_at;
-- Nothing else changes: no other object of the bot, of the exam container or of the site.
-- Roll back the function's support first or with it (the function `telegram` without support.ts): otherwise the tick's
-- step «support» only counts «missing», /support still answers with its prompt and a reply to it fails (nothing is kept,
-- the person gets no confirmation); the site's page «Данные и приватность» cannot ask, cancel or read a request.
-- Run it before T1's rollback (20261010120000_telegram_bot_down.sql drops schema bot without CASCADE and stops while
-- bot.support_messages is there). Re-runnable. Locally the catalog fingerprint after it equals the one before the
-- migration (supabase/tests/local/bot_support_run.sh).
set local lock_timeout = '2s';

drop function if exists public.account_deletion_status();
drop function if exists public.account_deletion_cancel();
drop function if exists public.account_deletion_request();
drop function if exists public.bot_support_answered(bigint, timestamptz);
drop function if exists public.bot_support_reply(bigint, bigint, bigint);
drop function if exists public.bot_support_done(bigint, bigint, bigint, text, timestamptz);
drop function if exists public.bot_support_claim(integer, timestamptz);
drop function if exists public.bot_support_owner(bigint, bigint, text);
drop function if exists public.bot_support_add(bigint, bigint, bigint, text, text, text, timestamptz);
drop function if exists bot.support_cleanup(timestamptz);
drop table if exists bot.support_messages;
alter table if exists bot.config drop constraint if exists config_support_ids_check,
  drop constraint if exists config_support_hash_check;
alter table if exists bot.config drop column if exists support_tg_user_id, drop column if exists support_chat_id,
  drop column if exists support_username_hash;
drop table if exists public.account_deletion_requests;
