-- telegram_bot_revokes (third file of 20261010120000_telegram_bot.sql). Takes back what Supabase's default privileges
-- give NEW objects (and what PostgreSQL gives PUBLIC on every new function): anon and authenticated run no bot_*
-- function and no helper of schema bot, anon runs no telegram_* function, nobody but the owner touches schema bot.
-- Safety does not depend on it: every bot_* starts with meldy_private.require_service_role(), every telegram_* checks
-- auth.uid(), schema bot has no USAGE for clients and every table has row security without a policy. A normal
-- migration (applied with the other two); re-runnable; names only objects of 20261010120000_telegram_bot.sql and
-- _cron.sql (schema-wide statements also cover tables and functions of schema bot that later packages add).
-- After it, supabase/tests/telegram_bot.sql reports contract_ok: true.
revoke all on schema bot from public, anon, authenticated;
revoke all on all tables in schema bot from public, anon, authenticated;
revoke all on all sequences in schema bot from public, anon, authenticated;
revoke all on all functions in schema bot from public, anon, authenticated;

revoke all on function public.bot_setup(text, bigint, text, text, text), public.bot_update_begin(bigint, timestamptz),
  public.bot_update_done(bigint), public.bot_update_failed(bigint, text), public.bot_tick_beat(jsonb), public.bot_status(),
  public.bot_link_claim(text, bigint, bigint, text, timestamptz), public.bot_chat_event(bigint, text),
  public.bot_whoami(bigint), public.bot_settings(bigint, jsonb), public.bot_today(bigint),
  public.bot_card_sent(bigint, bigint, text), public.bot_claim_reminders(integer, timestamptz),
  public.bot_reminder_context(bigint), public.bot_delivery_sending(bigint, timestamptz),
  public.bot_delivery_done(bigint, text, bigint, text, timestamptz), public.bot_claim_day_close(integer, timestamptz),
  public.bot_claim_after_date(integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.bot_setup(text, bigint, text, text, text), public.bot_update_begin(bigint, timestamptz),
  public.bot_update_done(bigint), public.bot_update_failed(bigint, text), public.bot_tick_beat(jsonb), public.bot_status(),
  public.bot_link_claim(text, bigint, bigint, text, timestamptz), public.bot_chat_event(bigint, text),
  public.bot_whoami(bigint), public.bot_settings(bigint, jsonb), public.bot_today(bigint),
  public.bot_card_sent(bigint, bigint, text), public.bot_claim_reminders(integer, timestamptz),
  public.bot_reminder_context(bigint), public.bot_delivery_sending(bigint, timestamptz),
  public.bot_delivery_done(bigint, text, bigint, text, timestamptz), public.bot_claim_day_close(integer, timestamptz),
  public.bot_claim_after_date(integer, timestamptz)
  to service_role;

revoke all on function public.telegram_link_start(text), public.telegram_link_state(),
  public.telegram_settings(boolean, time, text), public.telegram_unlink() from public, anon;
grant execute on function public.telegram_link_start(text), public.telegram_link_state(),
  public.telegram_settings(boolean, time, text), public.telegram_unlink() to authenticated;
