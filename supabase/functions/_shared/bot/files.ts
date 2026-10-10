/**
 * A file forwarded to the bot opens in Meldy's import (spec §4.7 F1, decision 27; package T9), and the route
 * `GET /telegram/file?t=<token>` (§6.1) that hands its bytes to the site.
 *
 * In a private chat (the router calls `document()`):
 * - a document of a linked student → `bot_file_offer` → F1, a reply to the document: its name and size, the line about
 *   the import, the blue URL button «Открыть в Meldy» → `/exams/import?tg=<ticket>` (30 minutes);
 * - the refusals of §4.7: not linked (a document; other media of an unlinked chat stay with the router, M1 once an
 *   hour), over 20 MB (the most getFile downloads), not a document (a photo, video, audio, GIF or round video). The bot
 *   does not check the file type: .doc, PDF and empty files are the import's to word. A refusal is said once per album.
 *
 * `GET /telegram/file?t=<token>` (the site's import, after `telegram_file_take`):
 * - CORS for the site's origin only. Another Origin gets 403 before the token is touched; a request without an Origin
 *   (a server-side proxy, a direct open) is served without CORS headers;
 * - the token → `bot_file_redeem` (once, 60 s) → `getFile` → the bytes streamed from Telegram's file server, with the
 *   file's name (Content-Disposition) and a type from a short list of document types (else octet-stream);
 *   `Cache-Control: no-store` and no validator: no cache keeps the file;
 * - the bot token is used only in the request to Telegram's file server: never in a response, a log line or an error.
 *   A fetch error's message holds the URL, so only its name is logged; a body that breaks mid-way reaches the client
 *   as a FileStreamError, never as the upstream error. Failures answer `{error}` with a status: 400 bad_token;
 *   403 origin; 405; 410 invalid | expired | used (the site says «Ссылка из Telegram устарела…»); 413 too_big;
 *   502 telegram; 503 unavailable | not_configured; 504 timeout.
 * One log line per request (route `file`): the outcome, the time, an error's name, Telegram's code; for a file sent,
 * when its stream ends (ok, failed, timeout, cancelled).
 *
 * The token for the download comes from `deps.token` (`files` below reads TELEGRAM_BOT_TOKEN through env.ts at the first
 * request); getFile goes through the router's Telegram client.
 */
import type { Who } from './db.ts';
import { readEnv } from './env.ts';
import { esc, lines, NBSP, t } from './html.ts';
import { errorName, log } from './log.ts';
import type { Ctx, FilesPort } from './router.ts';
import { API_BASE, send, TelegramError, type FetchLike, type Out, type TgMessage } from './tg.ts';
import * as W from './words.ts';

/** getFile downloads files up to 20 MB (Bot API; tech report §1). */
export const MAX_BYTES = 20 * 1024 * 1024;
export const TICKET_RE = /^F[0-9a-f]{32}$/;
export const TOKEN_RE = /^[0-9a-f]{64}$/;
/** A Telegram file id: printable ASCII, no spaces (what bot_file_offer accepts). */
export const FILE_ID_RE = /^[!-~]{1,512}$/;
export const NAME_MAX = 255;
/** Longer names are shortened in F1 (the extension kept); the site gets the whole name. */
export const SHOWN_NAME_MAX = 64;
export const HEADERS_TIMEOUT_MS = 15_000;
export const TOTAL_TIMEOUT_MS = 120_000;
/** An album's refusal is said once; its parts arrive within seconds. */
const ALBUM_TTL_MS = 10 * 60_000;

// ─────────────────────────────────────────── words (§4.7) ───────────────────────────────────────────

export const F1_BODY = 'Откройте его в загрузке Meldy: там видно, как отмечены ответы, и можно проверить вопросы.';
export const NOT_LINKED = 'Чтобы открыть файл в Meldy, сначала подключите Telegram в профиле. Потом перешлите файл ещё раз.';
export const TOO_BIG = 'Файл больше 20 МБ — бот не может его скачать. Загрузите его на сайте.';
export const UPLOAD_ON_SITE = 'Загрузить на сайте';
export const NOT_A_DOCUMENT = 'Сюда можно переслать файл с вопросами — Word, Excel или TXT. План на сегодня — /today.';
/** The name of a document Telegram gave no name (with an extension when the type tells one). */
export const NO_NAME = 'Файл';

// ─────────────────────────────────────────── the file's name, size and type ───────────────────────────────────────────

/** Control, format and direction marks: U+202E could show «…xcod.exe» as «…exe.docx». */
const MARKS = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;

/** The name as the site will show and read it (its extension picks the reader): one line, no marks, ≤ 255 characters. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').replace(MARKS, '').trim();
  const cut = [...name].slice(0, NAME_MAX).join('').trim();
  return cut === '' ? null : cut;
}

/** A MIME type as Telegram reported it, lower-cased; null when it is not one. */
export function cleanMime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const mime = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9.+-]{0,62}\/[a-z0-9][a-z0-9.+-]{0,126}$/.test(mime) ? mime : null;
}

/** The document types the file route names in Content-Type; anything else goes out as application/octet-stream. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/rtf': 'rtf',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
};

export const contentType = (mime: string | null): string => (mime && EXTENSIONS[mime] ? mime : 'application/octet-stream');

/** «Файл.docx» for a document without a name (the import reads by the extension), else «Файл». */
export function fallbackName(mime: string | null): string {
  const ext = mime ? EXTENSIONS[mime] : undefined;
  return ext ? `${NO_NAME}.${ext}` : NO_NAME;
}

/** F1's first line: the name, shortened in the middle when it is long, the extension kept. */
export function shownName(name: string): string {
  const chars = [...name];
  if (chars.length <= SHOWN_NAME_MAX) return name;
  const ext = /\.[^.\s]{1,10}$/.exec(name)?.[0] ?? '';
  const head = chars.slice(0, SHOWN_NAME_MAX - 1 - [...ext].length).join('').trimEnd();
  return `${head}…${ext}`;
}

/** «1,2 МБ», «340 КБ» (spec F1: decimal comma, a no-break space before the unit). */
export function sizeText(bytes: number): string {
  if (bytes >= 1000 * 1024) {
    const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
    return `${String(mb).replace('.', ',')}${NBSP}МБ`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))}${NBSP}КБ`;
}

/** RFC 6266: an ASCII fallback and the UTF-8 name (filename*). Header values stay ASCII. */
export function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\%;]/g, '_').trim() || 'file';
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// ─────────────────────────────────────────── the messages (§4.7) ───────────────────────────────────────────

/** F1: the name in bold (verbatim: the user's own), its size, the line about the import, «Открыть в Meldy». */
export function f1(site: string, file: { name: string; size: number | null; ticket: string }): Out {
  const head = `<b>${esc(shownName(file.name))}</b>${file.size ? t(` · ${sizeText(file.size)}`) : ''}`;
  return {
    text: lines(head, t(F1_BODY)),
    keyboard: [[{ text: W.OPEN_IN_MELDY, url: `${site}${W.PATH.upload}?tg=${file.ticket}`, style: 'primary' }]],
  };
}

export const notLinked = (site: string): Out => ({ text: t(NOT_LINKED), keyboard: [[{ text: W.OPEN_PROFILE, url: `${site}${W.PATH.profile}` }]] });
export const tooBig = (site: string): Out => ({ text: t(TOO_BIG), keyboard: [[{ text: UPLOAD_ON_SITE, url: `${site}${W.PATH.upload}` }]] });
export const notADocument = (): Out => ({ text: t(NOT_A_DOCUMENT), keyboard: null });

// ─────────────────────────────────────────── what came ───────────────────────────────────────────

/** The parts of a message the bot's TgMessage leaves out. */
type MediaMessage = TgMessage & {
  photo?: unknown;
  video?: unknown;
  animation?: unknown;
  audio?: unknown;
  video_note?: unknown;
  media_group_id?: string;
};

export type Arrival = 'document' | 'other' | null;

/**
 * A document (F1), another file (the «not a document» refusal: a photo, video, audio, GIF or round video), or nothing
 * for this package (text, voice, a sticker, a contact: the router's). A GIF comes with `document` too (Bot API).
 */
export function arrivalOf(msg: TgMessage): Arrival {
  const m = msg as MediaMessage;
  if (m.animation) return 'other';
  if (m.document) return 'document';
  if (m.photo || m.video || m.audio || m.video_note) return 'other';
  return null;
}

// ─────────────────────────────────────────── database answers ───────────────────────────────────────────

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

export type Offer = { status: 'ok'; ticket: string } | { status: 'unlinked' | 'too_big' };

/** bot_file_offer → Offer; an unknown shape throws (the update then fails and is logged). */
export function toOffer(raw: unknown): Offer {
  const r = obj(raw);
  if (r.status === 'ok' && typeof r.ticket === 'string' && TICKET_RE.test(r.ticket)) return { status: 'ok', ticket: r.ticket };
  if (r.status === 'unlinked' || r.status === 'too_big') return { status: r.status };
  throw new TypeError('bot_file_offer: unknown answer');
}

export type Redeemed =
  | { status: 'ok'; fileId: string; name: string | null; size: number | null; mime: string | null }
  | { status: 'invalid' | 'expired' | 'used' };

/** bot_file_redeem → Redeemed; anything unknown reads as invalid (nothing is fetched). */
export function toRedeemed(raw: unknown): Redeemed {
  const r = obj(raw);
  if (r.status === 'ok' && typeof r.file_id === 'string' && FILE_ID_RE.test(r.file_id)) {
    return { status: 'ok', fileId: r.file_id, name: cleanName(r.name), size: num(r.size), mime: cleanMime(str(r.mime)) };
  }
  return { status: r.status === 'expired' || r.status === 'used' ? r.status : 'invalid' };
}

// ─────────────────────────────────────────── the port ───────────────────────────────────────────

export interface FilesDeps {
  /** The bot token, for the file server's URL only. '' → the route answers 503 not_configured. */
  token?: () => string;
  /** The fetch for Telegram's file server (tests pass a fake). */
  fetch?: FetchLike;
  headersTimeoutMs?: number;
  totalTimeoutMs?: number;
}

type FileOutcome = 'ok' | 'preflight' | 'forbidden_origin' | 'bad_method' | 'bad_token' | 'not_configured' | 'invalid' | 'expired'
  | 'used' | 'too_big' | 'failed' | 'timeout' | 'cancelled';

/** Telegram's file path, kept to its own segments (no «..», no backslash, no control characters), each one escaped. */
export function filePathUrl(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 1024 || path.startsWith('/')) return null;
  if (/[\u0000-\u001f\u007f\\?#]/.test(path)) return null;
  const parts = path.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null;
  return parts.map((part) => encodeURIComponent(part)).join('/');
}

const isTimeout = (error: unknown) => {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
  return name === 'TimeoutError' || name === 'AbortError';
};

/** AbortSignal.any where the runtime has it (Deno ≥ 1.39, Node ≥ 20.3), else the same by hand. */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  const native = (AbortSignal as unknown as { any?: (list: AbortSignal[]) => AbortSignal }).any;
  if (typeof native === 'function') return native.call(AbortSignal, signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/** What a broken file stream shows the runtime: the upstream error can name the file server's URL, and so the token. */
export class FileStreamError extends Error {
  constructor() {
    super('the file stream from Telegram broke');
    this.name = 'FileStreamError';
  }
}

/**
 * The upstream body passed on chunk by chunk; its end, a failure or the client leaving is reported once (the request's
 * log line). A failure reaches the client as a FileStreamError, never as the upstream error.
 */
export function relay(body: ReadableStream<Uint8Array>, end: (outcome: 'ok' | 'failed' | 'timeout' | 'cancelled', errorName?: string) => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let ended = false;
  const finish = (outcome: 'ok' | 'failed' | 'timeout' | 'cancelled', name?: string) => {
    if (ended) return;
    ended = true;
    end(outcome, name);
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        finish(isTimeout(error) ? 'timeout' : 'failed', isTimeout(error) ? 'TimeoutError' : errorName(error));
        controller.error(new FileStreamError());
        return;
      }
      if (chunk.done) {
        finish('ok');
        controller.close();
      } else {
        controller.enqueue(chunk.value);
      }
    },
    async cancel() {
      finish('cancelled');
      await reader.cancel().catch(() => undefined);
    },
  });
}

export function createFiles(deps: FilesDeps = {}): FilesPort {
  const fetchFn: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init));
  const headersTimeoutMs = deps.headersTimeoutMs ?? HEADERS_TIMEOUT_MS;
  const totalTimeoutMs = deps.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;
  const albums = new Map<string, number>();

  /** true the first time this album (chat + media_group_id) gets this refusal; a single message: always true. */
  function firstOfAlbum(msg: TgMessage, what: string, now: number): boolean {
    const group = (msg as MediaMessage).media_group_id;
    if (typeof group !== 'string' || group === '') return true;
    const key = `${msg.chat.id}|${group}|${what}`;
    const at = albums.get(key);
    if (at !== undefined && now - at < ALBUM_TTL_MS) return false;
    if (albums.size > 1000) {
      for (const [k, v] of albums) if (now - v >= ALBUM_TTL_MS) albums.delete(k);
      if (albums.size > 1000) albums.clear();
    }
    albums.set(key, now);
    return true;
  }

  async function reply(ctx: Ctx, msg: TgMessage, out: Out): Promise<void> {
    await send(ctx.tg, { chatId: msg.chat.id, text: out.text, keyboard: out.keyboard, replyTo: msg.message_id });
  }

  async function refuse(ctx: Ctx, msg: TgMessage, what: 'unlinked' | 'too_big' | 'other'): Promise<true> {
    if (firstOfAlbum(msg, what, ctx.now())) {
      await reply(ctx, msg, what === 'unlinked' ? notLinked(ctx.site) : what === 'too_big' ? tooBig(ctx.site) : notADocument());
    }
    return true;
  }

  async function document(ctx: Ctx, msg: TgMessage, who: Who): Promise<boolean> {
    const arrival = arrivalOf(msg);
    const tgUserId = msg.from?.id;
    if (arrival === null || msg.chat?.type !== 'private' || typeof tgUserId !== 'number') return false;
    if (!who.linked) return arrival === 'document' ? refuse(ctx, msg, 'unlinked') : false;
    if (arrival === 'other') return refuse(ctx, msg, 'other');
    const doc = msg.document as NonNullable<TgMessage['document']>;
    const size = typeof doc.file_size === 'number' && Number.isFinite(doc.file_size) && doc.file_size >= 0 ? Math.floor(doc.file_size) : null;
    if (size !== null && size > MAX_BYTES) return refuse(ctx, msg, 'too_big');
    if (typeof doc.file_id !== 'string' || !FILE_ID_RE.test(doc.file_id)) throw new TypeError('document without a file id');
    const mime = cleanMime(doc.mime_type);
    const name = cleanName(doc.file_name) ?? fallbackName(mime);
    const offer = toOffer(await ctx.db.rpc('bot_file_offer', {
      p_tg_user_id: tgUserId, p_file_id: doc.file_id, p_name: name, p_size: size, p_mime: mime,
    }));
    if (offer.status !== 'ok') return refuse(ctx, msg, offer.status);
    await reply(ctx, msg, f1(ctx.site, { name, size, ticket: offer.ticket }));
    return true;
  }

  async function http(req: Request, ctx: Ctx): Promise<Response> {
    const started = ctx.now();
    let site = W.SITE;
    try {
      site = new URL(ctx.site).origin;
    } catch {
      site = W.SITE;
    }
    const origin = req.headers.get('origin');
    const ours = origin !== null && origin === site;
    const base: Record<string, string> = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      Vary: 'Origin',
    };
    if (ours) {
      base['Access-Control-Allow-Origin'] = site;
      base['Access-Control-Expose-Headers'] = 'Content-Disposition, Content-Length';
    }
    const note = (outcome: FileOutcome, extra: { error_name?: string; tg_code?: number } = {}) =>
      log({ route: 'file', outcome, ms: ctx.now() - started, ...extra });
    const fail = (status: number, error: string, outcome: FileOutcome, extra: { error_name?: string; tg_code?: number } = {}) => {
      note(outcome, extra);
      return Response.json({ error }, { status, headers: { ...base, ...(status === 405 ? { Allow: 'GET, OPTIONS' } : {}) } });
    };

    try {
      if (req.method === 'OPTIONS') {
        if (!ours) return fail(403, 'origin', 'forbidden_origin');
        note('preflight');
        return new Response(null, {
          status: 204,
          headers: {
            ...base,
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
            'Access-Control-Max-Age': '600',
          },
        });
      }
      if (req.method !== 'GET') return fail(405, 'method', 'bad_method');
      // A page of another site may not spend a student's token (its fetch would carry its own Origin).
      if (origin !== null && !ours) return fail(403, 'origin', 'forbidden_origin');
      let token = '';
      try {
        token = new URL(req.url).searchParams.get('t') ?? '';
      } catch {
        token = '';
      }
      if (!TOKEN_RE.test(token)) return fail(400, 'bad_token', 'bad_token');
      const botToken = deps.token ? deps.token() : '';
      if (!botToken) return fail(503, 'not_configured', 'not_configured');

      let redeemed: Redeemed;
      try {
        redeemed = toRedeemed(await ctx.db.rpc('bot_file_redeem', { p_token: token }));
      } catch (error) {
        return fail(503, 'unavailable', 'failed', { error_name: errorName(error) });
      }
      if (redeemed.status !== 'ok') return fail(410, redeemed.status, redeemed.status);

      let path: string | null;
      try {
        const file = await ctx.tg.call<{ file_path?: unknown }>('getFile', { file_id: redeemed.fileId });
        path = filePathUrl(file?.file_path);
      } catch (error) {
        const code = error instanceof TelegramError ? error.code : undefined;
        if (error instanceof TelegramError && error.code === 400 && /too big/i.test(error.description)) {
          return fail(413, 'too_big', 'too_big', { error_name: errorName(error), tg_code: code });
        }
        if (error instanceof TelegramError && error.failure === 'timeout') return fail(504, 'timeout', 'timeout', { error_name: errorName(error), tg_code: code });
        return fail(502, 'telegram', 'failed', { error_name: errorName(error), tg_code: code });
      }
      if (path === null) return fail(502, 'telegram', 'failed', { error_name: 'NoFilePath' });

      // The one place the token is used: the file server's URL. Headers within 15 s, the whole file within 120 s.
      const headersLimit = new AbortController();
      const timer = setTimeout(() => headersLimit.abort(), headersTimeoutMs);
      let upstream: Response;
      try {
        upstream = await fetchFn(`${API_BASE}/file/bot${botToken}/${path}`, {
          method: 'GET',
          signal: anySignal([headersLimit.signal, AbortSignal.timeout(totalTimeoutMs)]),
        });
      } catch (error) {
        if (isTimeout(error)) return fail(504, 'timeout', 'timeout', { error_name: 'TimeoutError' });
        return fail(502, 'telegram', 'failed', { error_name: errorName(error) });
      } finally {
        clearTimeout(timer);
      }
      if (!upstream.ok || !upstream.body) {
        await upstream.body?.cancel().catch(() => undefined);
        return fail(502, 'telegram', 'failed', { error_name: 'FileServer', tg_code: upstream.status });
      }

      const name = redeemed.name ?? fallbackName(redeemed.mime);
      const headers: Record<string, string> = {
        ...base,
        'Content-Type': contentType(redeemed.mime),
        'Content-Disposition': disposition(name),
        'Content-Security-Policy': "default-src 'none'; sandbox",
      };
      const length = upstream.headers.get('content-length');
      if (length && /^\d{1,10}$/.test(length)) headers['Content-Length'] = length;
      // The log line is written when the stream ends: ok, failed or timeout (the client got a FileStreamError), cancelled.
      const body = relay(upstream.body, (outcome, name) => note(outcome, name ? { error_name: name } : {}));
      return new Response(body, { status: 200, headers });
    } catch (error) {
      return fail(500, 'failed', 'failed', { error_name: errorName(error) });
    }
  }

  return { document, http };
}

/** TELEGRAM_BOT_TOKEN through env.ts (Deno), read once at the first file request; '' anywhere else. */
let envToken: string | null = null;
function botTokenFromEnv(): string {
  if (envToken) return envToken;
  try {
    envToken = readEnv().token || null;
  } catch {
    envToken = null;
  }
  return envToken ?? '';
}

/** The port for supabase/functions/telegram/index.ts: `import { files } from '../_shared/bot/files.ts';` and `files,`. */
export const files: FilesPort = createFiles({ token: botTokenFromEnv });
