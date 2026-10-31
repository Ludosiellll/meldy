-- Rollback of supabase/migrations/20261105090100_quiz_telegram.sql: the four public functions, the five private helpers
-- and the three tables go. The authors' choices and what waited are forgotten. Quiz messages the bot had not sent yet
-- (bot.deliveries kind notice, ref qz:/qd:/qc:/qs:, claimed or sending) are closed as skipped first, so nothing left
-- claimed waits for good; the sent ones stay as T1 keeps every delivery. Roll back the telegram function's step «quiz»
-- first or with it: without bot_quiz_notices the step answers «missing» and does nothing. The site's Telegram block
-- then says it cannot load. Re-runnable.
set lock_timeout = '5s';

do $do$
begin
  if pg_catalog.to_regclass('bot.deliveries') is not null then
    update bot.deliveries d set status = 'skipped', error = 'rolled back'
     where d.kind = 'notice' and d.ref ~ '^q[zdcs]:' and d.status in ('claimed', 'sending');
  end if;
end;
$do$;
drop function if exists public.bot_quiz_notices(integer, timestamptz);
drop function if exists public.telegram_quiz_share(uuid, bigint);
drop function if exists public.telegram_quiz_notice(uuid, text);
drop function if exists public.telegram_quiz_state(uuid);
drop function if exists meldy_private.quiz_tg_row(bigint);
drop function if exists meldy_private.quiz_close_summary(public.quizzes);
drop function if exists meldy_private.quiz_of_author(uuid, uuid);
drop function if exists meldy_private.quiz_tg_state(public.quizzes, uuid);
drop function if exists meldy_private.quiz_score(uuid);
drop table if exists bot.quiz_notices;
drop table if exists bot.quiz_sends;
drop table if exists bot.quiz_watch;
