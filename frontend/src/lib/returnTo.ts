/**
 * Возврат после входа (2026-10-07, «группа по ссылке»): человек входит ради страницы — ссылки группы
 * /join/<код> или страницы приложения, куда его не пустили без входа, — и после входа попадает на неё.
 *
 * Только безопасные внутренние пути: «/…», без «//» и схемы, без обратной косой черты и управляющих знаков,
 * не страницы самого входа (иначе круг). Всё остальное — как раньше: «Сегодня» (/dashboard).
 *
 * Возврат едет в адресе — параметр next у /login и /register, у /auth/callback (вход через Google: адрес
 * callback не меняется, добавляется только параметр) и сам путь в emailRedirectTo письма: письмо часто
 * открывают в другом браузере, где на устройстве ничего не сохранено. Код приглашения ещё и ждёт на этом
 * устройстве (meldy_join_pending, сутки) — на случай, если Supabase вернёт не на тот адрес.
 */

export const RETURN_PARAM = 'next';
export const SIGNED_IN_HOME = '/dashboard';
const BASE = 'https://return.meldy.invalid';
const MAX_LENGTH = 512;
const AUTH_PATHS = /^\/(?:login|register|forgot-password|update-password|auth\/callback)(?:\/|$)/;
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\\\u0000-\u001f\u007f]/;

/** The path itself when it is a safe page of this site, else null. */
export function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LENGTH) return null;
  if (!value.startsWith('/') || value.startsWith('//') || UNSAFE.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE || AUTH_PATHS.test(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The way back from the address's ?next=, checked. */
export function returnToFromSearch(search: string): string | null {
  try {
    return safeReturnTo(new URLSearchParams(search).get(RETURN_PARAM));
  } catch {
    return null;
  }
}

/** Where to go once signed in: the way back, else «Сегодня». */
export function afterSignIn(returnTo: string | null): string {
  return safeReturnTo(returnTo) ?? SIGNED_IN_HOME;
}

/** /login, /register … carrying the way back (or plain, without one). */
export function withReturn(path: string, returnTo: string | null): string {
  const safe = safeReturnTo(returnTo);
  return safe ? `${path}?${RETURN_PARAM}=${encodeURIComponent(safe)}` : path;
}

/** The sign-in page for a signed-out visitor of a private page: with that page as the way back. */
export function loginFor(pathname: string, search = ''): string {
  const target = `${pathname}${search}`;
  return target === '/' || target === SIGNED_IN_HOME ? '/login' : withReturn('/login', target);
}

/** Google: back through /auth/callback (its address stays), the way back in its parameter. */
export function oauthRedirectTo(origin: string, returnTo: string | null): string {
  return withReturn(`${origin}/auth/callback`, returnTo);
}

/** The confirmation letter: straight to the page (the session comes in the address), else «Сегодня» as before. */
export function emailRedirectTo(origin: string, returnTo: string | null): string {
  return `${origin}${afterSignIn(returnTo)}`;
}

// ── The example's way back ──────────────────────────────────────────────────────

/** The router state of a page opened from the example (/try): the sign-up offers the way back to the example. */
export const FROM_TRY = { from: '/try' } as const;

/** Opened from the example: its router state says so (a reload keeps it; an address typed or shared does not). */
export function cameFromTry(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { from?: unknown }).from === FROM_TRY.from;
}

// ── A group link waiting on this device ─────────────────────────────────────────

export const JOIN_PENDING_KEY = 'meldy_join_pending';
export const JOIN_CODE = /^[0-9a-hjkmnp-tv-z]{12}$/;
const JOIN_PENDING_MS = 24 * 60 * 60 * 1000;

/**
 * The code of a group link as typed or pasted: no spaces or dashes, lower case; null when it is not one. A link that
 * ends a sentence in a chat brings the sentence's mark along («…/join/abcd2fghjkmn.», audit 2026-10-08 PUB-25), and
 * a link in brackets or quotes its bracket: such marks around the code are dropped (none of them is in a code).
 */
export function normalizeJoinCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw
    .replace(/[\s-]+/g, '')
    .replace(/[.,;:!?…)\]}»"'’”`]+$/u, '')
    .replace(/^[(\[{«"'‘“`]+/u, '')
    .toLowerCase();
  return JOIN_CODE.test(value) ? value : null;
}

export function joinPath(code: string): string {
  return `/join/${code}`;
}

/** Remembers the link the visitor went to sign in for (a day, this device only). */
export function rememberPendingJoin(code: string, now: number = Date.now()): void {
  const clean = normalizeJoinCode(code);
  if (!clean) return;
  try {
    window.localStorage.setItem(JOIN_PENDING_KEY, JSON.stringify({ code: clean, at: now }));
  } catch {
    // Private mode: the address still carries the way back.
  }
}

/** The link waiting on this device, if it is less than a day old. */
export function pendingJoin(now: number = Date.now()): string | null {
  try {
    const raw = window.localStorage.getItem(JOIN_PENDING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { code?: unknown; at?: unknown };
    const code = normalizeJoinCode(value?.code);
    const at = typeof value?.at === 'number' ? value.at : NaN;
    if (!code || !Number.isFinite(at) || now - at > JOIN_PENDING_MS || at - now > JOIN_PENDING_MS) {
      window.localStorage.removeItem(JOIN_PENDING_KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

export function forgetPendingJoin(): void {
  try {
    window.localStorage.removeItem(JOIN_PENDING_KEY);
  } catch {
    // nothing to forget
  }
}
