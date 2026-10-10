/**
 * The site's side of the Telegram bot (package T3; Telegram bot spec §6.3 «Сайт», decisions 9, 31, 32): four RPCs with
 * the student's own session (`auth.uid()` in SQL, executable by authenticated only).
 * - `telegram_link_start(p_tz)` → `{code, expires_at, bot_username}`: a one-time code for 15 minutes (`L` + 32 hex),
 *   at most 5 an hour; a newer code ends the older ones. `p_tz` is the browser's zone (decision 32).
 * - `telegram_link_state()` → the link: linked or not, the reminder time and zone, the pause, a block.
 * - `telegram_settings(p_remind_on, p_remind_at, p_tz)` and `telegram_unlink()` → the link as the state returns it.
 *
 * A database without these functions (PGRST202 / 42883: an old migration; PGRST205 / 42P01 too, as the containers'
 * old-client rule in api/containers.ts): `fetchTelegramState` resolves null and the card hides itself; the other
 * calls throw `TelegramApiError` with code 'missing'.
 */
import { supabase } from '../lib/supabase';
import { browserZone, botName, DEFAULT_ZONE, linkUrl } from '../lib/telegram/links';

export type TelegramErrorCode = 'missing' | 'too_many' | 'not_linked' | 'invalid' | 'signed_out' | 'network' | 'unknown';

/** Russian text of each error (spec §3 words). */
export const TELEGRAM_ERROR_TEXT: Record<TelegramErrorCode, string> = {
  missing: 'Telegram пока не подключить: бот ещё не запущен.',
  // The bot's own words for too many tries (spec §4.1 M5).
  too_many: 'Слишком много попыток. Попробуйте через час.',
  not_linked: 'Telegram уже отключён от Meldy.',
  invalid: 'Не получилось. Обновите страницу и попробуйте ещё раз.',
  signed_out: 'Сессия истекла. Войдите снова.',
  network: 'Нет сети — попробуйте ещё раз, когда она появится.',
  unknown: 'Не получилось. Попробуйте ещё раз.',
};

export class TelegramApiError extends Error {
  readonly code: TelegramErrorCode;
  /** The HTTP status; 0 when no answer came. */
  readonly status: number;
  constructor(code: TelegramErrorCode, status = 0) {
    super(TELEGRAM_ERROR_TEXT[code]);
    this.name = 'TelegramApiError';
    this.code = code;
    this.status = status;
  }
}

export function isTelegramMissing(error: unknown): boolean {
  return error instanceof TelegramApiError && error.code === 'missing';
}

/** The Russian line for any error of this module (anything else: the general line). */
export function telegramErrorText(error: unknown): string {
  return error instanceof TelegramApiError ? error.message : TELEGRAM_ERROR_TEXT.unknown;
}

/** The exam the bot plans for, when the server names it (`null`: the student has no exam with a plan). */
export interface TelegramExam {
  title: string;
  /** 'YYYY-MM-DD', or null without a date. */
  date: string | null;
}

export interface TelegramState {
  linked: boolean;
  /** The bot's username (@Meldyteach_bot unless the server names another bot). */
  bot: string;
  /** The daily plan is sent (off after «Не присылать» in the bot). */
  remindOn: boolean;
  /** 'HH:MM' in `zone`; 20:00 by default. */
  remindAt: string;
  /** The link's IANA zone; null when not linked. */
  zone: string | null;
  /** The first day the plan comes again ('YYYY-MM-DD'); null without a pause. */
  pausedUntil: string | null;
  /** The student blocked the bot in Telegram: nothing can be sent. */
  blocked: boolean;
  /** Undefined when the server does not say (the card then reads the exams itself). */
  exam?: TelegramExam | null;
}

export interface TelegramLinkCode {
  /** `L` + 32 hex, as the server issued it. */
  code: string;
  /** https://t.me/<bot>?start=L… */
  url: string;
  bot: string;
  /** When the code stops working (ISO), if the server said. */
  expiresAt: string | null;
}

// ── Errors ─────────────────────────────────────────────────────────────────────────────────────────────────

const MISSING_CODES: ReadonlySet<string> = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(error: unknown, name: 'code' | 'message'): string {
  const value = isRecord(error) ? error[name] : undefined;
  return typeof value === 'string' ? value.trim() : '';
}

/** A PostgREST error object (with the response's status: 0 when the request never got an answer). */
export function telegramError(error: unknown, status = 0): TelegramApiError {
  if (error instanceof TelegramApiError) return error;
  const code = text(error, 'code');
  const message = text(error, 'message');
  if (MISSING_CODES.has(code)) return new TelegramApiError('missing', status);
  if (status === 401 || code === '28000' || /^PGRST30\d$/.test(code)) return new TelegramApiError('signed_out', status);
  if (code === 'MB429' || status === 429 || /too many/i.test(message)) return new TelegramApiError('too_many', status);
  if (code === 'MB404' || /not linked/i.test(message)) return new TelegramApiError('not_linked', status);
  if (code === '22023' || /^22/.test(code)) return new TelegramApiError('invalid', status);
  if (!code && status === 0) return new TelegramApiError('network', 0);
  return new TelegramApiError('unknown', status);
}

/** Something threw instead of answering: a failed fetch (TypeError) or an abort is the network; anything else is not. */
function thrown(error: unknown): TelegramApiError {
  if (error instanceof TelegramApiError) return error;
  const name = error instanceof Error ? error.name : isRecord(error) ? String(error.name ?? '') : '';
  if (name === 'TypeError' || name === 'AbortError') return new TelegramApiError('network', 0);
  return new TelegramApiError('unknown', 0);
}

type DbResult = { data: unknown; error: unknown; status?: number };

async function call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  let result: DbResult;
  try {
    const query = supabase.rpc(name, args);
    result = await (signal ? query.abortSignal(signal) : query);
  } catch (error) {
    throw thrown(error);
  }
  if (result.error) throw telegramError(result.error, typeof result.status === 'number' ? result.status : 0);
  return result.data;
}

// ── Shapes (the SQL is ours; a proxy, an old build or an empty body is not) ──────────────────────────────────

const DAY = /^(\d{4}-\d{2}-\d{2})/;
const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;

function day(value: unknown): string | null {
  const match = typeof value === 'string' ? DAY.exec(value) : null;
  return match ? match[1] : null;
}

/** 'HH:MM' from 'H:MM', 'HH:MM' or 'HH:MM:SS'; null otherwise. */
export function clockValue(value: unknown): string | null {
  const match = typeof value === 'string' ? CLOCK.exec(value.trim()) : null;
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null;
}

function exam(raw: Record<string, unknown>): TelegramExam | null | undefined {
  if (!('exam' in raw)) return undefined;
  const value = raw.exam;
  if (value === null) return null;
  if (!isRecord(value) || typeof value.title !== 'string' || !value.title.trim()) return undefined;
  return { title: value.title.trim(), date: day(value.date ?? value.exam_date) };
}

function badShape(): TelegramApiError {
  return new TelegramApiError('unknown', 200);
}

/** The state as `telegram_link_state` returns it (also the answer of settings and unlink). */
export function normalizeState(raw: unknown): TelegramState {
  if (!isRecord(raw) || typeof raw.linked !== 'boolean') throw badShape();
  const state: TelegramState = {
    linked: raw.linked,
    bot: botName(typeof raw.bot_username === 'string' ? raw.bot_username : null),
    remindOn: raw.remind_on !== false,
    remindAt: clockValue(raw.remind_at) ?? '20:00',
    zone: typeof raw.tz === 'string' && raw.tz.trim() ? raw.tz.trim() : null,
    pausedUntil: day(raw.paused_until),
    blocked: raw.blocked === true || (typeof raw.blocked_at === 'string' && raw.blocked_at !== ''),
  };
  const named = exam(raw);
  if (named !== undefined) state.exam = named;
  return state;
}

// ── Calls ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The student's link, or null when the database has no Telegram functions (the card hides itself). */
export async function fetchTelegramState(signal?: AbortSignal): Promise<TelegramState | null> {
  try {
    return normalizeState(await call('telegram_link_state', {}, signal));
  } catch (error) {
    if (isTelegramMissing(error)) return null;
    throw error;
  }
}

/**
 * A new one-time code and its link. The zone is the browser's; when the server does not know that name, the code is
 * asked once more with the bot's default zone rather than leaving the student without a link.
 */
export async function startTelegramLink(zone: string = browserZone(), signal?: AbortSignal): Promise<TelegramLinkCode> {
  let raw: unknown;
  try {
    raw = await call('telegram_link_start', { p_tz: zone }, signal);
  } catch (error) {
    if (!(error instanceof TelegramApiError && error.code === 'invalid' && zone !== DEFAULT_ZONE)) throw error;
    raw = await call('telegram_link_start', { p_tz: DEFAULT_ZONE }, signal);
  }
  if (!isRecord(raw)) throw badShape();
  const bot = botName(typeof raw.bot_username === 'string' ? raw.bot_username : null);
  const url = linkUrl(raw.code, bot);
  if (!url || typeof raw.code !== 'string') throw badShape();
  return { code: raw.code.trim(), url, bot, expiresAt: typeof raw.expires_at === 'string' ? raw.expires_at : null };
}

/** Changes what the bot sends: on/off, the time ('HH:MM') and the zone; null leaves a value as it is. */
export async function updateTelegramSettings(
  patch: { remindOn?: boolean | null; remindAt?: string | null; zone?: string | null },
  signal?: AbortSignal,
): Promise<TelegramState> {
  const remindAt = patch.remindAt == null ? null : clockValue(patch.remindAt);
  if (patch.remindAt != null && remindAt === null) throw new TelegramApiError('invalid');
  return normalizeState(
    await call('telegram_settings', { p_remind_on: patch.remindOn ?? null, p_remind_at: remindAt, p_tz: patch.zone ?? null }, signal),
  );
}

/** Unlinks Telegram: the plan stops coming; the exam and its count stay in Meldy. */
export async function unlinkTelegram(signal?: AbortSignal): Promise<TelegramState> {
  const raw = await call('telegram_unlink', {}, signal);
  // A function that returns nothing still unlinked.
  if (raw === null || raw === undefined || raw === '') {
    return { linked: false, bot: botName(null), remindOn: true, remindAt: '20:00', zone: null, pausedUntil: null, blocked: false };
  }
  return normalizeState(raw);
}
