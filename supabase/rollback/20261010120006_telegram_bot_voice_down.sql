-- telegram_bot_voice — rollback of supabase/migrations/20261010120006_telegram_bot_voice.sql (package T10, stage 5).
-- Drops everything that file adds, in dependency order, without CASCADE: an object of a later package that leans on one of
-- these stops the rollback, and the whole file rolls back (nothing is half-dropped). Re-runnable. Removes the voice keys
-- of bot.config.flags (the switch and the owner's overrides): without the stage they mean nothing.
-- The tables go with their rows: open questions, single-use tickets and the audio counters (their AI charges stay in
-- public.ai_charges / ai_usage as the site's own; answers already recorded stay in the journal, as answers on the site).
-- Local check: supabase/tests/local/telegram_bot_run.sh, stage T10 (rollback twice → the catalog before T10).
begin;

drop function if exists public.bridge_voice_refund(text);
drop function if exists public.bridge_voice_take(text);

drop function if exists public.bot_voice_rate(bigint, text, text);
drop function if exists public.bot_voice_self(bigint, text);
drop function if exists public.bot_voice_record(bigint, text, jsonb, text);
drop function if exists public.bot_voice_release(bigint, text);
drop function if exists public.bot_voice_followup(bigint, text, text, text, text);
drop function if exists public.bot_voice_checked(bigint, text, jsonb);
drop function if exists public.bot_voice_restart(bigint, text);
drop function if exists public.bot_voice_part(bigint, text, text, integer, bigint);
drop function if exists public.bot_voice_ticket(bigint, text, text, integer, bigint);
drop function if exists public.bot_voice_sent(bigint, text, text, bigint);
drop function if exists public.bot_voice_next(bigint, text);
drop function if exists public.bot_voice_start(bigint, uuid, uuid, uuid, text, uuid[], integer);
drop function if exists public.bot_voice_state(bigint);

drop function if exists bot.voice_open(bot.links, uuid, uuid, uuid, text, uuid[], integer, timestamptz);
drop function if exists bot.voice_cleanup(timestamptz);
drop function if exists bot.voice_expire(uuid, date);
drop function if exists bot.voice_attempt_json(bot.voice_attempts, timestamptz);
drop function if exists bot.voice_audio_state(uuid, timestamptz);
drop function if exists bot.voice_units(uuid);
drop function if exists bot.voice_aid();
drop function if exists bot.voice_limits();
drop function if exists bot.voice_on();

drop function if exists meldy_private.record_oral_attempt_for(uuid, jsonb);
drop function if exists meldy_private.refund_ai_units_for(uuid, integer, text, uuid);
drop function if exists meldy_private.consume_ai_units_for(uuid, integer, text);
drop function if exists meldy_private.ai_quota_status_for(uuid);

drop table if exists bot.voice_tickets;
drop table if exists bot.voice_attempts;
drop table if exists bot.voice_audio;
drop table if exists bot.voice_days;

do $$
begin
  if pg_catalog.to_regclass('bot.config') is not null then
    update bot.config
       set flags = flags - 'voice' - 'voice_user_day_s' - 'voice_day_audio_s' - 'voice_stop_share'
     where flags ?| array['voice', 'voice_user_day_s', 'voice_day_audio_s', 'voice_stop_share'];
  end if;
end
$$;

commit;
