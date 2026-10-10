-- telegram_bot_sessions rollback (20261010120003_telegram_bot_sessions.sql). The owner runs it by hand in the SQL
-- Editor, never an agent: it deletes the bot's sessions (the «занятия» in progress in the chats). The answers recorded
-- through them stay: they are the container's (public.test_answers, source 'bot', session_id md5('tg:' || sid)).
-- Nothing of T1, the exam container or the oral path changes. In order: the public functions, the helpers of schema
-- bot (with the tick's hook bot.tick_due_sessions: T1's bot.tick_due then falls back to its own check), the table.
-- Run it BEFORE supabase/rollback/20261010120000_telegram_bot_down.sql: that file drops schema bot without CASCADE and
-- stops while bot.sessions exists. Re-runnable. Locally the catalog fingerprint after it equals the one before the
-- migration (supabase/tests/local/containers_fingerprint.sql).
begin;
drop function if exists public.bot_session_items(bigint, uuid, uuid[]),
  public.bot_session_start(bigint, text, uuid, uuid, text, jsonb, bigint, jsonb),
  public.bot_session_view(bigint, text, integer), public.bot_session_answer(bigint, text, integer, jsonb),
  public.bot_session_resolve(bigint, text, integer, text, jsonb), public.bot_session_finish(bigint, text),
  public.bot_session_move(bigint, text, bigint), public.bot_key_doubt(bigint, text, integer),
  public.bot_flush_pending(timestamptz);
drop function if exists bot.tick_due_sessions(timestamptz), bot.session_order_ok(jsonb, integer),
  bot.session_identity(integer), bot.session_count(jsonb, text, integer), bot.session_set_add(jsonb, text),
  bot.session_counts_json(jsonb), bot.session_figure_json(jsonb), bot.session_logged(uuid, text, integer);
-- These take or return the row type of bot.sessions: they go before the table.
do $do$
begin
  if pg_catalog.to_regclass('bot.sessions') is not null then
    drop function if exists bot.session_take(bigint, text, timestamptz, boolean),
      bot.session_live(bot.sessions, text, timestamptz, boolean), bot.session_save(bot.sessions),
      bot.session_stamp(bot.sessions, timestamptz), bot.session_tally(bot.sessions, jsonb, jsonb),
      bot.session_record(bot.sessions, boolean), bot.session_close(bot.sessions, text, boolean, timestamptz),
      bot.session_json(bot.sessions, text, timestamptz), bot.session_view_json(bot.sessions),
      bot.session_reply(text, bot.sessions, text, timestamptz, jsonb),
      bot.session_refusal(text, bot.sessions, text, timestamptz, jsonb), bot.session_requeue(bot.sessions, jsonb),
      bot.session_drop(bot.sessions, integer, uuid, smallint);
  end if;
end
$do$;
drop table if exists bot.sessions;
commit;
