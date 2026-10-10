/**
 * «Вопрос дня в Telegram» on the site (package T8; Telegram bot spec §4.6 G0, §6.3 «Сайт», decision 24): the three
 * RPCs of the exam's author with their own session (`auth.uid()` in SQL; T7's CONTRACT_T7.md «Site»):
 * - `telegram_groups(p_container_id)` → `{telegram_linked, link_active, bot_username, hours: [9, 12, 15, 18],
 *   default_hour: 12, groups: [GROUP]}` — the chats the bot is in for this exam, oldest binding first;
 * - `telegram_group_code(p_container_id, p_post_hour)` → `{code: "G<32 hex>", expires_at, post_hour, bot_username}`:
 *   one hour, once; a new code ends the earlier unused one, so it is asked only when «Подключить беседу» is pressed.
 *   The deep link is `https://t.me/<bot>?startgroup=<code>`;
 * - `telegram_group_set(p_chat_id, p_post_hour, p_on)` → GROUP (null keeps a value; `p_on: true` also after G4).
 * GROUP = `{chat_id, title, post_hour, tz, on, off_reason: null | author | empty | link, bound_at, link_active}`.
 *
 * Errors (TelegramGroupError, Russian `message`): 28000 signed out; 42501 not the exam's author; 22023 an hour that is
 * not 9/12/15/18; P0002 Telegram not linked (the code) or no such chat (set); MT001 more than 5 codes an hour; MT002
 * the exam has no active group link. A database without these functions (PGRST202 / 42883 / PGRST205 / 42P01):
 * `fetchTelegramGroups` resolves null and the section says so.
 */
import { supabase } from '../lib/supabase';

/** G0's hours; 12:00 unless the author picks another. */
export const GROUP_HOURS: readonly number[] = [9, 12, 15, 18];
export const DEFAULT_GROUP_HOUR = 12;
/** The bot's username until the server names it (it is null before the bot's /setup). */
export const DEFAULT_BOT = 'Meldyteach_bot';

export type GroupErrorCode =
  | 'missing' | 'not_linked' | 'no_link' | 'too_many' | 'not_author' | 'not_found' | 'invalid' | 'signed_out' | 'network' | 'unknown';

/** Russian text of each error (spec §3 words; the bot's own lines where it has them). */
export const GROUP_ERROR_TEXT: Record<GroupErrorCode, string> = {
  missing: 'Вопрос дня в Telegram пока недоступен.',
  not_linked: 'Сначала подключите Telegram в профиле.',
  no_link: 'Сначала создайте ссылку для группы.',
  too_many: 'Слишком много попыток. Попробуйте через час.',
  not_author: 'Подключить беседу может только автор экзамена.',
  not_found: 'Бота уже нет в этой беседе.',
  invalid: 'Не получилось. Обновите страницу и попробуйте ещё раз.',
  signed_out: 'Сессия истекла. Войдите снова.',
  network: 'Нет сети — попробуйте ещё раз, когда она появится.',
  unknown: 'Не получилось. Попробуйте ещё раз.',
};

export class TelegramGroupError extends Error {
  readonly code: GroupErrorCode;
  /** The HTTP status; 0 when no answer came. */
  readonly status: number;
  constructor(code: GroupErrorCode, status = 0) {
    super(GROUP_ERROR_TEXT[code]);
    this.name = 'TelegramGroupError';
    this.code = code;
    this.status = status;
  }
}

/** The Russian line for any error of this module (anything else: the general line). */
export function groupErrorText(error: unknown): string {
  return error instanceof TelegramGroupError ? error.message : GROUP_ERROR_TEXT.unknown;
}

export type GroupOffReason = 'author' | 'empty' | 'link';

export interface TelegramGroup {
  chatId: number;
  /** The chat's title as Telegram gave it; null when it has none. */
  title: string | null;
  /** 9, 12, 15 or 18 (local time of the author's zone at the binding). */
  hour: number;
  zone: string | null;
  on: boolean;
  /** author: turned off on the site; empty: five posts in a row without an answer (G4 went out); link: the group link ended. */
  offReason: GroupOffReason | null;
  boundAt: string | null;
  /** The group link this chat was connected with is still open (else: connect the chat again). */
  linkActive: boolean;
}

export interface TelegramGroups {
  telegramLinked: boolean;
  /** The exam has an open group link (a code can be made). */
  linkActive: boolean;
  bot: string;
  hours: number[];
  defaultHour: number;
  groups: TelegramGroup[];
}

export interface GroupCode {
  /** `G` + 32 hex, as the server issued it. */
  code: string;
  /** https://t.me/<bot>?startgroup=G… */
  url: string;
  bot: string;
  hour: number;
  /** When the code stops working (ISO), if the server said. */
  expiresAt: string | null;
}

// ── Errors ─────────────────────────────────────────────────────────────────────────────────────────────────

const MISSING_CODES: ReadonlySet<string> = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function codeOf(error: unknown): string {
  const value = isRecord(error) ? error.code : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

/** A PostgREST error object (with the response's status: 0 when the request never got an answer). */
export function telegramGroupError(error: unknown, status = 0, call: 'read' | 'code' | 'set' = 'read'): TelegramGroupError {
  if (error instanceof TelegramGroupError) return error;
  const code = codeOf(error);
  if (MISSING_CODES.has(code)) return new TelegramGroupError('missing', status);
  if (status === 401 || code === '28000' || /^PGRST30\d$/.test(code)) return new TelegramGroupError('signed_out', status);
  if (code === '42501') return new TelegramGroupError('not_author', status);
  if (code === 'MT001' || status === 429) return new TelegramGroupError('too_many', status);
  if (code === 'MT002') return new TelegramGroupError('no_link', status);
  if (code === 'P0002') return new TelegramGroupError(call === 'set' ? 'not_found' : 'not_linked', status);
  if (/^22/.test(code)) return new TelegramGroupError('invalid', status);
  if (!code && status === 0) return new TelegramGroupError('network', 0);
  return new TelegramGroupError('unknown', status);
}

/** Something threw instead of answering: a failed fetch (TypeError) or an abort is the network; anything else is not. */
function thrown(error: unknown): TelegramGroupError {
  if (error instanceof TelegramGroupError) return error;
  const name = error instanceof Error ? error.name : isRecord(error) ? String(error.name ?? '') : '';
  return new TelegramGroupError(name === 'TypeError' || name === 'AbortError' ? 'network' : 'unknown', 0);
}

type DbResult = { data: unknown; error: unknown; status?: number };

async function call(name: string, args: Record<string, unknown>, kind: 'read' | 'code' | 'set', signal?: AbortSignal): Promise<unknown> {
  let result: DbResult;
  try {
    const query = supabase.rpc(name, args);
    result = await (signal ? query.abortSignal(signal) : query);
  } catch (error) {
    throw thrown(error);
  }
  if (result.error) throw telegramGroupError(result.error, typeof result.status === 'number' ? result.status : 0, kind);
  return result.data;
}

// ── Shapes (the SQL is ours; a proxy, an old build or an empty body is not) ──────────────────────────────────

const BOT_NAME = /^[A-Za-z0-9_]{5,32}$/;
const CODE = /^G[0-9a-f]{32}$/;

function chatIdOf(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d{1,16}$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n < 0 ? n : null;
}

const hourOf = (value: unknown, fallback = DEFAULT_GROUP_HOUR) => (typeof value === 'number' && GROUP_HOURS.includes(value) ? value : fallback);
const textOf = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value : null);
const botOf = (value: unknown) => (typeof value === 'string' && BOT_NAME.test(value) ? value : DEFAULT_BOT);

/** One GROUP; null when it is not one. */
export function normalizeGroup(raw: unknown): TelegramGroup | null {
  if (!isRecord(raw)) return null;
  const chatId = chatIdOf(raw.chat_id);
  if (chatId === null) return null;
  const reason = raw.off_reason === 'author' || raw.off_reason === 'empty' || raw.off_reason === 'link' ? raw.off_reason : null;
  return {
    chatId,
    title: textOf(raw.title),
    hour: hourOf(raw.post_hour),
    zone: textOf(raw.tz),
    on: raw.on === true,
    offReason: raw.on === true ? null : reason ?? 'author',
    boundAt: textOf(raw.bound_at),
    linkActive: raw.link_active !== false,
  };
}

function normalizeGroups(raw: unknown): TelegramGroups {
  if (!isRecord(raw) || !Array.isArray(raw.groups)) throw new TelegramGroupError('unknown', 200);
  const hours = Array.isArray(raw.hours) ? raw.hours.filter((h): h is number => typeof h === 'number' && GROUP_HOURS.includes(h)) : [];
  return {
    telegramLinked: raw.telegram_linked === true,
    linkActive: raw.link_active === true,
    bot: botOf(raw.bot_username),
    hours: hours.length > 0 ? hours : [...GROUP_HOURS],
    defaultHour: hourOf(raw.default_hour),
    groups: raw.groups.map(normalizeGroup).filter((g): g is TelegramGroup => g !== null),
  };
}

/** The deep link that asks Telegram for a group to add the bot to. */
export function groupLinkUrl(bot: string, code: string): string {
  return `https://t.me/${botOf(bot)}?startgroup=${code}`;
}

// ── Calls ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The exam's group chats and what «Подключить беседу» needs; null when the database has no such functions. */
export async function fetchTelegramGroups(containerId: string, signal?: AbortSignal): Promise<TelegramGroups | null> {
  try {
    return normalizeGroups(await call('telegram_groups', { p_container_id: containerId }, 'read', signal));
  } catch (error) {
    if (error instanceof TelegramGroupError && error.code === 'missing') return null;
    throw error;
  }
}

/** «Подключить беседу»: a fresh G code for this hour and its deep link. */
export async function requestGroupCode(containerId: string, hour: number): Promise<GroupCode> {
  if (!GROUP_HOURS.includes(hour)) throw new TelegramGroupError('invalid');
  const raw = await call('telegram_group_code', { p_container_id: containerId, p_post_hour: hour }, 'code');
  const code = isRecord(raw) && typeof raw.code === 'string' ? raw.code : '';
  if (!CODE.test(code)) throw new TelegramGroupError('unknown', 200);
  const bot = botOf(isRecord(raw) ? raw.bot_username : null);
  return {
    code,
    url: groupLinkUrl(bot, code),
    bot,
    hour: hourOf(isRecord(raw) ? raw.post_hour : null, hour),
    expiresAt: isRecord(raw) ? textOf(raw.expires_at) : null,
  };
}

/** The hour and/or on–off of one chat; what is not given stays. */
export async function setTelegramGroup(chatId: number, change: { hour?: number; on?: boolean }): Promise<TelegramGroup> {
  if (change.hour !== undefined && !GROUP_HOURS.includes(change.hour)) throw new TelegramGroupError('invalid');
  const raw = await call('telegram_group_set', { p_chat_id: chatId, p_post_hour: change.hour ?? null, p_on: change.on ?? null }, 'set');
  const group = normalizeGroup(raw);
  if (!group) throw new TelegramGroupError('unknown', 200);
  return group;
}
