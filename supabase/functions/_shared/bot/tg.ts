/**
 * The Telegram client (spec §6.7) and the only place the bot sends, edits and deletes messages.
 *
 * - Plain `fetch` with a 10 s timeout. A method that can run twice without harm (`IDEMPOTENT`) gets one retry after a
 *   jittered pause when the call timed out, failed on the network or got a 5xx; `sendMessage` never retries blindly
 *   (the reminder path guards it with the deliveries table instead).
 * - A 429 means Telegram did not do the call, so any method may wait its `retry_after` once — up to `wait429Sec`
 *   (3 s in an interactive update; 0 in the tick, where a 429 stops the step).
 * - `TelegramError` carries the method, Telegram's code and description: never the URL (it holds the token).
 * - `send()` is the one way to post a message: `protect_content`, no link preview, silent unless it is the day card.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const API_BASE = 'https://api.telegram.org';
export const TIMEOUT_MS = 10_000;
/** The longest `retry_after` an interactive update waits for, once (spec §6.7). */
export const INTERACTIVE_WAIT_429_SEC = 3;

/** Methods safe to run twice: they set state or read it (spec §6.7 lists getMe, setWebhook, getFile, answerCallbackQuery, editMessage*, deleteMessage). */
export const IDEMPOTENT: ReadonlySet<string> = new Set([
  'getMe', 'getWebhookInfo', 'setWebhook', 'getFile', 'getUserProfilePhotos', 'getChat',
  'answerCallbackQuery', 'editMessageText', 'editMessageReplyMarkup', 'deleteMessage', 'deleteMessages',
  'setMyName', 'setMyDescription', 'setMyShortDescription', 'setMyCommands', 'deleteMyCommands', 'setChatMenuButton',
  'leaveChat',
]);

export type TgFailure = 'api' | 'timeout' | 'network' | 'response';

/** A failed Telegram call. `code` is Telegram's error_code (0: timeout or network). The message never holds the URL. */
export class TelegramError extends Error {
  readonly method: string;
  readonly code: number;
  readonly description: string;
  readonly failure: TgFailure;
  readonly retryAfter: number | null;
  readonly migrateTo: number | null;

  constructor(method: string, code: number, description: string, failure: TgFailure, retryAfter?: unknown, migrateTo?: unknown) {
    super(`telegram ${method} ${code}`);
    this.name = 'TelegramError';
    this.method = method;
    this.code = code;
    this.description = description;
    this.failure = failure;
    this.retryAfter = typeof retryAfter === 'number' && Number.isFinite(retryAfter) ? retryAfter : null;
    this.migrateTo = typeof migrateTo === 'number' && Number.isFinite(migrateTo) ? migrateTo : null;
  }
}

const is = (error: unknown, code: number, re: RegExp): boolean =>
  error instanceof TelegramError && error.code === code && re.test(error.description);

/** 400 «message is not modified»: an edit to the same content counts as done (spec §6.5). */
export const isNotModified = (error: unknown) => is(error, 400, /message is not modified/i);
/** 400 «message to edit not found» and its kin: the message is gone or too old; post a new one instead. */
export const isMessageGone = (error: unknown) =>
  is(error, 400, /message to (edit|delete) not found|message can't be (edited|deleted)|message_id_invalid|message not found/i);
/** 400 «query is too old»: a button press answered too late; nothing to do. */
export const isQueryTooOld = (error: unknown) => is(error, 400, /query is too old|query id is invalid/i);
/** 403: blocked by the user, deactivated, or removed from the chat. */
export const isBlocked = (error: unknown) => error instanceof TelegramError && error.code === 403;
/** 400 «chat not found». */
export const isChatGone = (error: unknown) => is(error, 400, /chat not found/i);
export const isRateLimited = (error: unknown) => error instanceof TelegramError && error.code === 429;

export interface UploadFile { name: string; type: string; bytes: Uint8Array }

export interface Telegram {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** multipart/form-data (setMyProfilePhoto); object fields are sent as JSON. Never retried blindly. */
  upload<T = unknown>(method: string, fields: Record<string, unknown>, files: Record<string, UploadFile>): Promise<T>;
  /** The same client with another 429 policy (the tick: 0). */
  with(options: { wait429Sec: number }): Telegram;
}

export interface TelegramOptions {
  token: string;
  fetch: FetchLike;
  timeoutMs?: number;
  wait429Sec?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createTelegram(options: TelegramOptions): Telegram {
  const token = options.token;
  const fetchFn = options.fetch;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const wait429Sec = options.wait429Sec ?? INTERACTIVE_WAIT_429_SEC;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  async function attempt<T>(method: string, body: BodyInit, headers?: Record<string, string>): Promise<T> {
    let res: Response;
    try {
      res = await fetchFn(`${API_BASE}/bot${token}/${method}`, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      // Only the kind of failure: the error's message can hold the URL, and the URL holds the token.
      const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
      const timeout = name === 'TimeoutError' || name === 'AbortError';
      throw new TelegramError(method, 0, timeout ? 'timeout' : 'network', timeout ? 'timeout' : 'network');
    }
    let data: { ok?: boolean; result?: unknown; error_code?: unknown; description?: unknown; parameters?: Record<string, unknown> } | null = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (data && data.ok === true) return data.result as T;
    if (!data || typeof data !== 'object') throw new TelegramError(method, res.status, 'bad response', 'response');
    const code = typeof data.error_code === 'number' ? data.error_code : res.status;
    const params = data.parameters && typeof data.parameters === 'object' ? data.parameters : {};
    throw new TelegramError(method, code, String(data.description ?? ''), 'api', params.retry_after, params.migrate_to_chat_id);
  }

  async function withRetry<T>(method: string, run: () => Promise<T>, mayRepeat: boolean): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof TelegramError)) throw error;
      if (error.code === 429) {
        const wait = error.retryAfter ?? Number.POSITIVE_INFINITY;
        if (wait <= wait429Sec) {
          await sleep(Math.max(0, wait) * 1000);
          return run();
        }
        throw error;
      }
      const transient = error.failure === 'timeout' || error.failure === 'network' || error.code >= 500;
      if (mayRepeat && transient && IDEMPOTENT.has(method)) {
        await sleep(150 + Math.floor(random() * 500));
        return run();
      }
      throw error;
    }
  }

  const client: Telegram = {
    call<T>(method: string, params: Record<string, unknown> = {}) {
      return withRetry<T>(method, () => attempt<T>(method, JSON.stringify(params), { 'Content-Type': 'application/json' }), true);
    },
    upload<T>(method: string, fields: Record<string, unknown>, files: Record<string, UploadFile>) {
      const run = () => {
        const form = new FormData();
        for (const [key, value] of Object.entries(fields)) form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
        for (const [key, file] of Object.entries(files)) form.append(key, new Blob([file.bytes], { type: file.type }), file.name);
        return attempt<T>(method, form);
      };
      return withRetry<T>(method, run, false);
    },
    with(next: { wait429Sec: number }) {
      return createTelegram({ ...options, wait429Sec: next.wait429Sec });
    },
  };
  return client;
}

// ─────────────────────────────────────────── messages ───────────────────────────────────────────

/** One button: `data` (callback, ≤ 64 bytes) or `url`; `primary` is the one blue, `danger` the red «Отключить». */
export interface Button {
  text: string;
  data?: string;
  url?: string;
  style?: 'primary' | 'danger';
}
export type Keyboard = Button[][];

/** A message as the builders make it: HTML for parse_mode=HTML and its keyboard. */
export interface Out {
  text: string;
  keyboard?: Keyboard | null;
}

export interface InlineKeyboardMarkup { inline_keyboard: Array<Array<Record<string, unknown>>> }

export function inlineMarkup(keyboard: Keyboard): InlineKeyboardMarkup {
  return {
    inline_keyboard: keyboard.map((row) => row.map((button) => {
      const out: Record<string, unknown> = { text: button.text };
      if (button.url) out.url = button.url;
      else out.callback_data = button.data ?? '';
      if (button.style) out.style = button.style;
      return out;
    })),
  };
}

export interface TgUser { id: number; is_bot?: boolean; language_code?: string; username?: string; first_name?: string }
export interface TgChat { id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; title?: string }
export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  reply_to_message?: TgMessage;
  document?: { file_id: string; file_name?: string; file_size?: number; mime_type?: string };
  voice?: { file_id: string; duration?: number; file_size?: number };
  migrate_to_chat_id?: number;
  migrate_from_chat_id?: number;
  new_chat_members?: TgUser[];
  left_chat_member?: TgUser;
}

export interface SendArgs {
  chatId: number;
  text: string;
  keyboard?: Keyboard | null;
  /** Only the day card rings (spec §3); everything else is sent silently. */
  sound?: boolean;
  /** A ForceReply prompt (M4, S3 «Другая дата») instead of a keyboard. */
  forceReply?: { placeholder: string };
  replyTo?: number;
}

/** The one way the bot posts a message (spec §3, decision 19): protect_content from the first send, no preview. */
export function send(tg: Telegram, args: SendArgs): Promise<TgMessage> {
  const params: Record<string, unknown> = {
    chat_id: args.chatId,
    text: args.text,
    parse_mode: 'HTML',
    protect_content: true,
    link_preview_options: { is_disabled: true },
    disable_notification: args.sound !== true,
  };
  if (args.forceReply) params.reply_markup = { force_reply: true, input_field_placeholder: args.forceReply.placeholder };
  else if (args.keyboard && args.keyboard.length > 0) params.reply_markup = inlineMarkup(args.keyboard);
  if (args.replyTo) params.reply_parameters = { message_id: args.replyTo, allow_sending_without_reply: true };
  return tg.call<TgMessage>('sendMessage', params);
}

/** ok: edited; same: «message is not modified» (done); gone: the message cannot be edited — post a new one. */
export type EditResult = 'ok' | 'same' | 'gone';

/** Edits text and keyboard together; without a keyboard the old one is removed. */
export async function edit(tg: Telegram, args: { chatId: number; messageId: number; text: string; keyboard?: Keyboard | null }): Promise<EditResult> {
  const params: Record<string, unknown> = {
    chat_id: args.chatId,
    message_id: args.messageId,
    text: args.text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  };
  if (args.keyboard && args.keyboard.length > 0) params.reply_markup = inlineMarkup(args.keyboard);
  try {
    await tg.call('editMessageText', params);
    return 'ok';
  } catch (error) {
    if (isNotModified(error)) return 'same';
    if (isMessageGone(error)) return 'gone';
    throw error;
  }
}

/** Edits the keyboard only (an empty one removes it). */
export async function editKeyboard(tg: Telegram, args: { chatId: number; messageId: number; keyboard: Keyboard | null }): Promise<EditResult> {
  const params: Record<string, unknown> = { chat_id: args.chatId, message_id: args.messageId };
  params.reply_markup = inlineMarkup(args.keyboard ?? []);
  try {
    await tg.call('editMessageReplyMarkup', params);
    return 'ok';
  } catch (error) {
    if (isNotModified(error)) return 'same';
    if (isMessageGone(error)) return 'gone';
    throw error;
  }
}

/** Edits in place, or posts the same message anew when the old one is gone (spec §4.8). Returns the message id. */
export async function editOrSend(tg: Telegram, args: { chatId: number; messageId: number | null; text: string; keyboard?: Keyboard | null }): Promise<number> {
  if (args.messageId) {
    const result = await edit(tg, { chatId: args.chatId, messageId: args.messageId, text: args.text, keyboard: args.keyboard });
    if (result !== 'gone') return args.messageId;
  }
  const sent = await send(tg, { chatId: args.chatId, text: args.text, keyboard: args.keyboard });
  return sent.message_id;
}

/** Deletes a message; false when it is gone, too old (48 h) or anything else failed. Never throws. */
export async function remove(tg: Telegram, chatId: number, messageId: number | null | undefined): Promise<boolean> {
  if (!messageId) return false;
  try {
    await tg.call('deleteMessage', { chat_id: chatId, message_id: messageId });
    return true;
  } catch {
    return false;
  }
}

/** Answers a button press (the spinner stops): a line, or a window with `alert`. Never throws; «query is too old» is skipped. */
export async function answer(tg: Telegram, args: { id: string; text?: string; alert?: boolean }): Promise<boolean> {
  const params: Record<string, unknown> = { callback_query_id: args.id };
  if (args.text) params.text = args.text;
  if (args.alert) params.show_alert = true;
  try {
    await tg.call('answerCallbackQuery', params);
    return true;
  } catch {
    return false;
  }
}
