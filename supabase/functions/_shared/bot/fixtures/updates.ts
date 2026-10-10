// Telegram updates for the router's tests (spec §8.1 «Фикстуры»): private messages and commands, replies to the bot's
// prompts, button presses, my_chat_member in private chats and groups, group commands, migrate_to_chat_id, documents,
// voice notes, edited messages and channel posts. Ids are made up.
import type { TgChatMemberUpdated, TgUpdate } from '../router.ts';
import type { TgMessage } from '../tg.ts';
import { NOW, TG } from './scenario.ts';

export const DATE = Math.floor(NOW / 1000);
export const GROUP = -1001234567890;
export const OTHER_TG = 700200;

let nextUpdate = 5000;
let nextMessage = 300;
export const uid = () => nextUpdate++;
const mid = () => nextMessage++;

const user = (id = TG) => ({ id, is_bot: false, first_name: 'Студент', language_code: 'ru' });
const bot = { id: 123456, is_bot: true, first_name: 'Meldy', username: 'Meldyteach_bot' };

export function message(text: string | undefined, opts: { from?: number; chatId?: number; type?: 'private' | 'group' | 'supergroup' | 'channel'; date?: number; replyTo?: TgMessage; id?: number; extra?: Partial<TgMessage> } = {}): TgMessage {
  const from = opts.from ?? TG;
  const chatId = opts.chatId ?? from;
  const msg: TgMessage = {
    message_id: opts.id ?? mid(),
    date: opts.date ?? DATE,
    chat: { id: chatId, type: opts.type ?? 'private', ...(opts.type && opts.type !== 'private' ? { title: '3-ПО' } : {}) },
    from: user(from),
    ...(text !== undefined ? { text } : {}),
    ...(opts.replyTo ? { reply_to_message: opts.replyTo } : {}),
    ...(opts.extra ?? {}),
  };
  return msg;
}

export const privateText = (text: string, opts: Parameters<typeof message>[1] = {}): TgUpdate => ({ update_id: opts.id ?? uid(), message: message(text, opts) });

/** A message the bot sent (what `reply_to_message` holds when the user answers a prompt). */
export const botMessage = (messageId: number, text: string, chatId = TG): TgMessage => ({ message_id: messageId, date: DATE - 60, chat: { id: chatId, type: 'private' }, from: bot, text });

export function press(data: string, opts: { from?: number; messageId?: number; chatId?: number; chatType?: 'private' | 'group' | 'supergroup'; inaccessible?: boolean } = {}): TgUpdate {
  const from = opts.from ?? TG;
  const chatId = opts.chatId ?? from;
  return {
    update_id: uid(),
    callback_query: {
      id: `cq${uid()}`,
      from: user(from),
      chat_instance: 'ci',
      data,
      message: { message_id: opts.messageId ?? 777, date: opts.inaccessible ? 0 : DATE - 30, chat: { id: chatId, type: opts.chatType ?? 'private' }, from: bot },
    },
  };
}

export function member(chat: { id: number; type: 'private' | 'group' | 'supergroup' }, oldStatus: string, newStatus: string, from = TG): TgUpdate {
  const upd: TgChatMemberUpdated = {
    chat: { id: chat.id, type: chat.type, ...(chat.type !== 'private' ? { title: '3-ПО' } : {}) },
    from: user(from),
    date: DATE,
    old_chat_member: { status: oldStatus as never, user: bot },
    new_chat_member: { status: newStatus as never, user: bot },
  };
  return { update_id: uid(), my_chat_member: upd };
}

export const groupCommand = (text: string, from = TG): TgUpdate => ({ update_id: uid(), message: message(text, { from, chatId: GROUP, type: 'supergroup' }) });
export const migrate = (): TgUpdate => ({ update_id: uid(), message: message(undefined, { chatId: -4001, type: 'group', extra: { migrate_to_chat_id: GROUP } }) });
export const document = (): TgUpdate => ({ update_id: uid(), message: message(undefined, { extra: { document: { file_id: 'F1', file_name: 'Банк_БД_2026.docx', file_size: 1_200_000 } } }) });
export const voice = (): TgUpdate => ({ update_id: uid(), message: message(undefined, { extra: { voice: { file_id: 'V1', duration: 12 } } }) });
export const edited = (): TgUpdate => ({ update_id: uid(), edited_message: message('Исправлено') });
export const channelPost = (): TgUpdate => ({ update_id: uid(), channel_post: message('Пост', { chatId: -100777, type: 'channel' }) });
