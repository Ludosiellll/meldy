/**
 * Meldy as a Telegram Mini App: the sign-in behind the site's /tg page (meldy-notes
 * 10_Project/Telegram_Mini_App_Spec_2026-10-10.md §2–§4, «Проверка безопасности 2026-10-11»). One route of the
 * `telegram` function, called by the site:
 *
 * - `POST /telegram/webapp/session` `{init_data, have?}`: a valid initData → `bot_webapp_session` (one use per initData,
 *   the brake, the link of this Telegram user) → linked: a one-time sign-in from the Auth admin API (`generate_link`,
 *   type magiclink). Only its `hashed_token` leaves, for the site's `verifyOtp({type: 'magiclink', token_hash})`. With
 *   `have` = the account already signed in in this WebView and linked to this Telegram, nothing is minted (`same`);
 *   with another account there, the answer also names the linked account's e-mail, so the site asks before it switches.
 *
 * There is no linking here. A valid initData proves only that its Telegram user opened the Mini App: anyone can put
 * their own fresh initData into someone else's browser (a link to /tg with it in the address). Linking the account
 * signed in there to that Telegram would hand the Telegram a way into the account. A Telegram is linked only by the
 * bot's /start L<code> from the profile (bot_link_claim): the code comes from the account, the /start from the user's
 * own Telegram client.
 *
 * initData (Telegram.WebApp.initData, a query string) is checked as Telegram's Mini Apps docs say («Validating data
 * received via the Mini App»): the data-check-string is every received field but `hash` — `signature` stays in, only
 * the third-party Ed25519 check leaves it out — as `key=value`, sorted, joined by «\n»; secret_key =
 * HMAC-SHA256(key "WebAppData", message the bot token); hash = hex(HMAC-SHA256(key secret_key, message the string)),
 * compared in constant time; then `auth_date` at most an hour old and at most a minute ahead. The replay key is
 * sha256(hash): the hash does not depend on the order of the fields, and only lower-case hex is taken.
 *
 * Expected outcomes answer 200 with `{status}`; protocol problems answer 400 / 403 / 405 / 413 / 429 / 503 with
 * `{error}`. CORS for the site's origin only; a request without an Origin (the site's /sb/ way) is served. Never
 * logged or stored: the bot token, initData, its hash, the e-mail, the sign-in token, any id. Returned: the sign-in
 * token's hash, and next to it the linked account's e-mail when another account is signed in in the WebView.
 */
import { DbError } from './db.ts';
import { errorName, log } from './log.ts';
import type { Ctx, WebAppAction, WebAppPort } from './router.ts';
import { sameSecret } from './secrets.ts';
import type { FetchLike } from './tg.ts';
import * as W from './words.ts';

/** Telegram's initData is a few hundred bytes; more is not Telegram's. */
export const INIT_DATA_MAX = 4096;
/** The request body (initData and a short field). */
export const BODY_MAX = 8192;
/** initData older than this is refused (the task: «about 1 hour»). */
export const MAX_AGE_SEC = 3600;
/** A device clock a little ahead of the server's. */
export const FUTURE_SKEW_SEC = 60;
/**
 * Requests a minute per client address and function instance; one without an address shares a larger bucket. The
 * site's /sb/ way arrives from the Space's one address for everyone behind it, hence the room.
 */
export const PER_ADDRESS_PER_MINUTE = 120;
export const UNKNOWN_ADDRESS_PER_MINUTE = 600;
/** Calls a minute per Telegram user with a valid signature (in memory, before the database's brake of an hour). */
export const PER_TELEGRAM_PER_MINUTE = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
/** GoTrue's hashed token: hex today; any URL-safe word up to 256 characters is taken. */
const HASHED_TOKEN = /^[A-Za-z0-9_-]{16,256}$/;
const LANG = /^[A-Za-z0-9-]{2,16}$/;
const START_PARAM = /^[A-Za-z0-9_-]{1,512}$/;

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// ─────────────────────────────────────────── initData ───────────────────────────────────────────

export interface WebAppUser {
  id: number;
  languageCode: string | null;
  /** Telegram lets the bot write to this user first (`allows_write_to_pm`). */
  allowsWriteToPm: boolean;
}

export interface InitData {
  user: WebAppUser;
  /** Unix seconds. */
  authDate: number;
  /** The checked hash, 64 lower-case hex. */
  hash: string;
  /** `start_param` of a direct link (`?startapp=`), when it is a plain word. */
  startParam: string | null;
}

export type InitDataProblem = 'empty' | 'too_long' | 'malformed' | 'no_hash' | 'bad_hash' | 'stale' | 'future' | 'no_user';
export type InitDataCheck = { ok: true; data: InitData } | { ok: false; reason: InitDataProblem };

let keyCache: { token: string; key: CryptoKey } | null = null;

/** HMAC-SHA256(key "WebAppData", message the bot token), imported as the HMAC key of the check. */
async function webAppKey(token: string): Promise<CryptoKey> {
  if (keyCache && keyCache.token === token) return keyCache.key;
  const base = await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = new Uint8Array(await crypto.subtle.sign('HMAC', base, encoder.encode(token)));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  keyCache = { token, key };
  return key;
}

/** Every field but `hash`, as `key=value`, sorted, joined by «\n» (Telegram's data-check-string). */
export function dataCheckString(pairs: ReadonlyArray<readonly [string, string]>): string {
  return pairs.filter(([key]) => key !== 'hash').map(([key, value]) => `${key}=${value}`).sort().join('\n');
}

const no = (reason: InitDataProblem): InitDataCheck => ({ ok: false, reason });

/**
 * Checks Telegram.WebApp.initData with the bot token at `nowMs`. The signature is checked before anything else is
 * read, so a field of data that is not Telegram's never reaches a decision.
 */
export async function checkInitData(raw: unknown, token: string, nowMs: number): Promise<InitDataCheck> {
  if (!token) throw new Error('no bot token');
  if (typeof raw !== 'string' || raw === '') return no('empty');
  if (raw.length > INIT_DATA_MAX) return no('too_long');
  const pairs: Array<[string, string]> = [];
  const keys = new Set<string>();
  try {
    for (const [key, value] of new URLSearchParams(raw)) {
      if (keys.has(key)) return no('malformed');
      keys.add(key);
      pairs.push([key, value]);
    }
  } catch {
    return no('malformed');
  }
  const hash = pairs.find(([key]) => key === 'hash')?.[1];
  if (hash === undefined) return no('no_hash');
  if (!HASH.test(hash)) return no('bad_hash');
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await webAppKey(token), encoder.encode(dataCheckString(pairs))));
  if (!sameSecret(hash, hex(mac))) return no('bad_hash');

  const field = (name: string) => pairs.find(([key]) => key === name)?.[1];
  const authRaw = field('auth_date');
  if (authRaw === undefined || !/^\d{1,12}$/.test(authRaw)) return no('malformed');
  const authDate = Number(authRaw);
  const nowSec = Math.floor(nowMs / 1000);
  if (nowSec - authDate > MAX_AGE_SEC) return no('stale');
  if (authDate - nowSec > FUTURE_SKEW_SEC) return no('future');

  let user: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(field('user') ?? '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return no('no_user');
    user = parsed as Record<string, unknown>;
  } catch {
    return no('no_user');
  }
  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot === true) return no('no_user');
  const lang = typeof user.language_code === 'string' && LANG.test(user.language_code) ? user.language_code : null;
  const start = field('start_param');
  return {
    ok: true,
    data: {
      user: { id: user.id, languageCode: lang, allowsWriteToPm: user.allows_write_to_pm === true },
      authDate,
      hash,
      startParam: start !== undefined && START_PARAM.test(start) ? start : null,
    },
  };
}

/** The replay key stored by the database: sha256 of the checked hash (64 hex). */
export async function replayKey(hash: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(hash))));
}

// ─────────────────────────────────────────── the Auth admin API ───────────────────────────────────────────

/** A failed call to Supabase Auth: the HTTP status (0: no answer) and a short code; never the URL, a key or a body. */
export class AuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code = '') {
    super(`auth ${status}${code ? ` ${code}` : ''}`);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}

export interface AuthAdmin {
  /** `POST /auth/v1/admin/generate_link` `{type: 'magiclink', email}` → its `hashed_token` only. */
  magicLinkHash(email: string): Promise<string>;
}

const isTimeout = (error: unknown) => {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
  return name === 'TimeoutError' || name === 'AbortError';
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Supabase Auth with the function's service key. The new secret key (`sb_secret_…`) goes on `apikey` only; the legacy
 * service_role JWT also on `Authorization: Bearer` for the admin call (Supabase docs, «Understanding API keys»).
 */
export function createAuthAdmin(options: { url: string; key: string; fetch: FetchLike; timeoutMs?: number }): AuthAdmin {
  const base = `${options.url.replace(/\/+$/, '')}/auth/v1`;
  const legacy = !options.key.startsWith('sb_');
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function call(path: 'admin/generate_link', init: RequestInit): Promise<{ status: number; body: unknown }> {
    let res: Response;
    try {
      res = await options.fetch(`${base}/${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new AuthError(0, isTimeout(error) ? 'timeout' : 'network');
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  return {
    async magicLinkHash(email) {
      const headers: Record<string, string> = { apikey: options.key, 'Content-Type': 'application/json', Accept: 'application/json' };
      if (legacy) headers.Authorization = `Bearer ${options.key}`;
      const r = await call('admin/generate_link', { method: 'POST', headers, body: JSON.stringify({ type: 'magiclink', email }) });
      if (r.status !== 200) throw new AuthError(r.status);
      const token = obj(r.body).hashed_token;
      if (typeof token !== 'string' || !HASHED_TOKEN.test(token)) throw new AuthError(r.status, 'bad_response');
      return token;
    },
  };
}

// ─────────────────────────────────────────── database answers ───────────────────────────────────────────

export type SessionAnswer =
  | { status: 'linked'; userId: string; email: string }
  | { status: 'unlinked' | 'replayed' | 'slow_down' | 'no_email' };

/** bot_webapp_session → SessionAnswer; an unknown shape throws (the request then answers 503). */
export function toSessionAnswer(raw: unknown): SessionAnswer {
  const r = obj(raw);
  if (r.status === 'linked') {
    if (typeof r.user_id !== 'string' || !UUID.test(r.user_id)) throw new TypeError('bot_webapp_session: no user');
    const email = typeof r.email === 'string' ? r.email.trim() : '';
    return /^[^\s@]+@[^\s@]+$/.test(email) ? { status: 'linked', userId: r.user_id.toLowerCase(), email } : { status: 'no_email' };
  }
  if (r.status === 'unlinked' || r.status === 'replayed' || r.status === 'slow_down' || r.status === 'no_email') return { status: r.status };
  throw new TypeError('bot_webapp_session: unknown answer');
}

// ─────────────────────────────────────────── the routes ───────────────────────────────────────────

/** What the site reads (200). */
export type SessionStatus = 'linked' | 'unlinked' | 'stale' | 'invalid' | 'replayed' | 'slow_down' | 'unavailable';

/** At most `limit` calls per key within `windowMs` (in memory, per function instance: best effort). */
export function windowLimiter(limit: (key: string) => number, windowMs: number, now: () => number): (key: string) => boolean {
  const hits = new Map<string, number[]>();
  return (key) => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
    if (recent.length >= limit(key)) {
      hits.set(key, recent);
      return false;
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [k, list] of hits) if (list.every((at) => t - at >= windowMs)) hits.delete(k);
      if (hits.size > 5000) hits.clear();
    }
    return true;
  };
}

/** The client's address as the platform forwards it (first hop of X-Forwarded-For); '' when there is none. */
export function clientAddress(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? '';
  const first = forwarded.split(',')[0]?.trim() ?? '';
  return /^[0-9A-Fa-f.:]{2,64}$/.test(first) ? first : '';
}

export interface WebAppDeps {
  /** The bot token, for the initData check only. '' → the routes answer 503 not_configured. */
  token: () => string;
  /** null → 503 not_configured. */
  auth: AuthAdmin | null;
  /** The function's clock for the rate limit (the router's ctx.now is used for initData). */
  now?: () => number;
}

type Outcome = SessionStatus | 'same' | 'other' | 'preflight' | 'forbidden_origin' | 'bad_method' | 'bad_request' | 'too_big'
  | 'rate_limited' | 'not_configured' | 'failed';

export function createWebApp(deps: WebAppDeps): WebAppPort {
  const clock = deps.now ?? (() => Date.now());
  const allowed = windowLimiter((key) => (key === '' ? UNKNOWN_ADDRESS_PER_MINUTE : PER_ADDRESS_PER_MINUTE), 60_000, clock);
  const allowedUser = windowLimiter(() => PER_TELEGRAM_PER_MINUTE, 60_000, clock);

  async function session(ctx: Ctx, body: Record<string, unknown>, token: string, auth: AuthAdmin): Promise<{ outcome: Outcome; json: Record<string, unknown> }> {
    const check = await checkInitData(body.init_data, token, ctx.now());
    if (!check.ok) {
      const status: SessionStatus = check.reason === 'stale' || check.reason === 'future' ? 'stale' : 'invalid';
      return { outcome: status, json: { status } };
    }
    const data = check.data;
    if (!allowedUser(String(data.user.id))) return { outcome: 'slow_down', json: { status: 'slow_down' } };
    const answer = toSessionAnswer(await ctx.db.rpc('bot_webapp_session', {
      p_tg_user_id: data.user.id, p_init_hash: await replayKey(data.hash), p_auth_date: new Date(data.authDate * 1000).toISOString(),
    }));
    if (answer.status === 'no_email') return { outcome: 'unavailable', json: { status: 'unavailable' } };
    if (answer.status !== 'linked') return { outcome: answer.status, json: { status: answer.status } };
    const have = typeof body.have === 'string' && UUID.test(body.have) ? body.have.toLowerCase() : null;
    if (have === answer.userId) return { outcome: 'same', json: { status: 'linked', same: true } };
    let tokenHash: string;
    try {
      tokenHash = await auth.magicLinkHash(answer.email);
    } catch (error) {
      log({ route: 'webapp', kind: 'magic_link', outcome: 'failed', error_name: errorName(error), tg_code: error instanceof AuthError ? error.status : undefined });
      return { outcome: 'unavailable', json: { status: 'unavailable' } };
    }
    // Another account is signed in in this WebView: the site names the linked one and switches only when asked. The
    // e-mail goes only to the holder of this Telegram's fresh initData, who could sign in to that account anyway.
    if (have !== null) return { outcome: 'other', json: { status: 'linked', token_hash: tokenHash, email: answer.email } };
    return { outcome: 'linked', json: { status: 'linked', token_hash: tokenHash } };
  }

  async function http(req: Request, ctx: Ctx, action: WebAppAction): Promise<Response> {
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
    if (ours) base['Access-Control-Allow-Origin'] = site;
    const note = (outcome: Outcome, extra: { error_name?: string } = {}) =>
      log({ route: 'webapp', kind: action, outcome, ms: ctx.now() - started, ...extra });
    const fail = (status: number, error: string, outcome: Outcome, extra: { error_name?: string } = {}) => {
      note(outcome, extra);
      return Response.json({ error }, { status, headers: { ...base, ...(status === 405 ? { Allow: 'POST, OPTIONS' } : {}) } });
    };

    try {
      if (req.method === 'OPTIONS') {
        if (!ours) return fail(403, 'origin', 'forbidden_origin');
        note('preflight');
        return new Response(null, {
          status: 204,
          headers: {
            ...base,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
            'Access-Control-Max-Age': '600',
          },
        });
      }
      if (req.method !== 'POST') return fail(405, 'method', 'bad_method');
      // A page of another site may not use a student's Telegram (its fetch carries its own Origin).
      if (origin !== null && !ours) return fail(403, 'origin', 'forbidden_origin');
      if (!allowed(clientAddress(req))) return fail(429, 'slow_down', 'rate_limited');
      const token = deps.token();
      if (!token || !deps.auth) return fail(503, 'not_configured', 'not_configured');
      const length = Number(req.headers.get('content-length') ?? '0');
      if (Number.isFinite(length) && length > BODY_MAX) return fail(413, 'too_big', 'too_big');
      const text = await req.text();
      if (text.length > BODY_MAX) return fail(413, 'too_big', 'too_big');
      let body: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail(400, 'bad_request', 'bad_request');
        body = parsed as Record<string, unknown>;
      } catch {
        return fail(400, 'bad_request', 'bad_request');
      }
      const result = await session(ctx, body, token, deps.auth);
      note(result.outcome);
      return Response.json(result.json, { status: 200, headers: base });
    } catch (error) {
      return fail(503, 'unavailable', 'failed', { error_name: error instanceof DbError ? `DbError:${error.code || error.status}` : errorName(error) });
    }
  }

  return { http };
}
