import { botName } from './telegram/links';

/**
 * Support goes through the main Telegram bot (the owner, 09.11: «поддержку можно сделать через бота»): the link opens
 * the bot with `start=support`, the bot asks for one message, passes it to the author of Meldy and brings the answer
 * back to the same chat (supabase/functions/_shared/bot, docs/telegram-bot.md).
 */
export function supportUrl(bot: string | null = null): string {
  return `https://t.me/${botName(bot)}?start=support`;
}

export const SUPPORT_LABEL = 'Написать автору Meldy';
export const SUPPORT_NOTE = 'Откроется бот Meldy в Telegram: он передаст сообщение автору, ответ придёт туда же.';
