/**
 * The pictures of a quiz attempt for a taker without an account (release 47, a «guest»: lib/quizzes/guestToken.ts;
 * plan docs/superpowers/plans/2026-10-18-test-builder-r47.md). Question pictures live in the PRIVATE bucket
 * `test-item-images` («<container uuid>/<sha256>.<ext>»). A signed-in taker reads them through a storage policy; a guest
 * has no session and gets no anon policy (one would let anyone list every picture). The `quiz-media` Edge Function
 * reads a picture for the guest with the service key, after the database said it belongs to the guest's attempt:
 *
 * - `POST /functions/v1/quiz-media` `{attempt_id, token, path}`, at most 2 KB (verify_jwt on: the site sends its public
 *   anon key, as with its other calls);
 * - `quiz_guest_media_paths(p_attempt_id, p_token, p_paths => [path])` as service_role: the subset of the paths that are
 *   pictures of that attempt's items when sha256(token) is the attempt's guest hash, else an empty array;
 * - or, for a live game (release 47.31, «Битва с монстром» with pictures), `{game_id, token, path}` with the host's or a
 *   player's token: `quiz_live_media_paths(p_game, p_token, p_paths)`, the pictures of the questions shown so far (migration
 *   20261030090000_live_pictures.sql);
 * - listed → the bytes from storage with the type of the extension, `Cache-Control: private, max-age=3600`;
 *   not listed (a wrong token, another attempt, not a picture of this attempt) or gone from storage → 404
 *   `{"error":"not_found"}`, nothing more; a database or storage failure → 503 `{"error":"unavailable"}`.
 *
 * CORS as the telegram function's webapp route (bot/webapp.ts): the site's origin only; a request without an Origin
 * (the site's /sb/ way, backend/supabase_proxy.py) is served. Never logged or returned: the service key, the token, the
 * attempt id, the path. Plain TS without Deno APIs: supabase/functions/quiz-media/index.ts passes the environment, fetch
 * and the log; tested with `node --experimental-strip-types --test supabase/functions/_shared/quizMedia.test.ts`.
 */

/** The site (bot/words.ts SITE): the one origin given CORS. */
export const SITE = 'https://ludosiel-studyforge.hf.space';
export const BUCKET = 'test-item-images';
export const RPC_NAME = 'quiz_guest_media_paths';
/** A live game's pictures: the host's or a player's token (supabase/migrations/20261030090000_live_pictures.sql). */
export const LIVE_RPC_NAME = 'quiz_live_media_paths';
/** The request body: three short fields. */
export const BODY_MAX = 2048;
export const PICTURE_CACHE = 'private, max-age=3600';
/** The database call and the storage read (headers and the whole picture, at most the bucket's 3 MB), each. */
export const TIMEOUT_MS = 15_000;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The device's token (frontend/src/lib/quizzes/guestToken.ts TOKEN_RE): 32 bytes as base64url. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** A picture's storage path (frontend/src/api/itemPictures.ts picturePath). */
export const PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f]{64}\.(png|jpg|gif|webp|bmp)$/;

/** The type each extension is answered with (the bucket's types; never what storage says). */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// ─────────────────────────────────────────── the environment ───────────────────────────────────────────

export interface MediaEnv {
  supabaseUrl: string;
  serviceKey: string;
}

/**
 * As bot/env.ts: SUPABASE_URL, and the service key from SUPABASE_SECRET_KEYS (JSON, key `default`), else the legacy
 * SUPABASE_SERVICE_ROLE_KEY. `get` is Deno.env.get in the function, a map in the tests.
 */
export function readMediaEnv(get: (name: string) => string | undefined): MediaEnv {
  const read = (name: string) => (get(name) ?? '').trim();
  let serviceKey = '';
  const keys = read('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, unknown> | null;
      if (parsed && typeof parsed.default === 'string') serviceKey = parsed.default.trim();
    } catch {
      serviceKey = '';
    }
  }
  if (!serviceKey) serviceKey = read('SUPABASE_SERVICE_ROLE_KEY');
  return { supabaseUrl: read('SUPABASE_URL').replace(/\/+$/, ''), serviceKey };
}

// ─────────────────────────────────────────── the request and the answer ───────────────────────────────────────────

/** A guest's quiz attempt (`attempt_id`) or a live game (`game_id`); the ids in lower case. */
export type MediaAsk =
  | { kind: 'attempt'; attemptId: string; token: string; path: string }
  | { kind: 'live'; gameId: string; token: string; path: string };

/**
 * The body → the ask, or null: not a JSON object, a field missing or out of shape, or both an attempt and a game (other
 * keys are ignored).
 */
export function parseAsk(text: string): MediaAsk | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const { attempt_id: attemptId, game_id: gameId, token, path } = parsed as Record<string, unknown>;
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  if (typeof path !== 'string' || !PATH_RE.test(path)) return null;
  if (attemptId !== undefined && gameId !== undefined) return null;
  if (typeof gameId === 'string' && UUID_RE.test(gameId)) return { kind: 'live', gameId: gameId.toLowerCase(), token, path };
  if (typeof attemptId === 'string' && UUID_RE.test(attemptId)) return { kind: 'attempt', attemptId: attemptId.toLowerCase(), token, path };
  return null;
}

/** The database function that decides, and its arguments. */
export function rpcOf(ask: MediaAsk): { name: string; args: Record<string, unknown> } {
  return ask.kind === 'live'
    ? { name: LIVE_RPC_NAME, args: { p_game: ask.gameId, p_token: ask.token, p_paths: [ask.path] } }
    : { name: RPC_NAME, args: { p_attempt_id: ask.attemptId, p_token: ask.token, p_paths: [ask.path] } };
}

/** The picture's type by its extension. */
export function contentTypeOf(path: string): string {
  return CONTENT_TYPES[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
}

/** quiz_guest_media_paths' answer lets this path through: a JSON array that holds it exactly. */
export function isAllowed(answer: unknown, path: string): boolean {
  return Array.isArray(answer) && answer.some((entry) => entry === path);
}

/** The headers of every answer: CORS for the site only (a request without an Origin is served without it). */
export function baseHeaders(origin: string | null, site: string = SITE): { ours: boolean; headers: Record<string, string> } {
  const ours = origin !== null && origin === site;
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin',
  };
  if (ours) headers['Access-Control-Allow-Origin'] = site;
  return { ours, headers };
}

// ─────────────────────────────────────────── the log ───────────────────────────────────────────

export type MediaOutcome =
  | 'ok' | 'preflight' | 'forbidden_origin' | 'bad_method' | 'too_big' | 'bad_request' | 'not_found' | 'not_configured'
  | 'unavailable' | 'failed';

/** One line per request: what happened, never what was asked (no token, attempt, path or key). */
export interface MediaLogLine {
  fn: 'quiz-media';
  outcome: MediaOutcome;
  /** The status answered. */
  status: number;
  ms: number;
  /** The database's or storage's status when it failed. */
  upstream?: number;
  /** An error's name only (a fetch error's message can carry the URL). */
  error_name?: string;
}

const WORD = /^[A-Za-z0-9_.:-]{1,48}$/;

function errorName(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
  return WORD.test(name) ? name : 'Error';
}

// ─────────────────────────────────────────── the handler ───────────────────────────────────────────

export interface QuizMediaDeps {
  /** SUPABASE_URL; '' → 503 not_configured. */
  url: string;
  /** The service key; '' → 503 not_configured. */
  key: string;
  fetch: FetchLike;
  /** The site's origin (tests). */
  site?: string;
  timeoutMs?: number;
  now?: () => number;
  log?: (line: MediaLogLine) => void;
}

class TooBig extends Error {
  constructor() {
    super('too big');
    this.name = 'TooBig';
  }
}

/** The body as text, read no further than `max` bytes. */
async function readCapped(req: Request, max: number): Promise<string> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new TooBig();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function createQuizMedia(deps: QuizMediaDeps): (req: Request) => Promise<Response> {
  const base = deps.url.trim().replace(/\/+$/, '');
  const configured = /^https?:\/\/[^/]+$/.test(base) && deps.key !== '';
  // The new secret key (sb_secret_…) goes on `apikey` only; a legacy service_role JWT also as the bearer (bot/db.ts).
  const service: Record<string, string> = { apikey: deps.key };
  if (!deps.key.startsWith('sb_')) service.Authorization = `Bearer ${deps.key}`;
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;
  const clock = deps.now ?? (() => Date.now());
  let site = SITE;
  try {
    site = new URL(deps.site ?? SITE).origin;
  } catch {
    site = SITE;
  }

  return async function quizMedia(req: Request): Promise<Response> {
    const started = clock();
    const origin = req.headers.get('origin');
    const { ours, headers: common } = baseHeaders(origin, site);
    const note = (outcome: MediaOutcome, status: number, extra: { upstream?: number; error_name?: string } = {}) =>
      deps.log?.({ fn: 'quiz-media', outcome, status, ms: clock() - started, ...extra });
    const fail = (status: number, error: string, outcome: MediaOutcome, extra: { upstream?: number; error_name?: string } = {}) => {
      note(outcome, status, extra);
      return Response.json({ error }, { status, headers: { ...common, ...(status === 405 ? { Allow: 'POST, OPTIONS' } : {}) } });
    };

    try {
      if (req.method === 'OPTIONS') {
        if (!ours) return fail(403, 'origin', 'forbidden_origin');
        note('preflight', 204);
        return new Response(null, {
          status: 204,
          headers: {
            ...common,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
            'Access-Control-Max-Age': '600',
          },
        });
      }
      if (req.method !== 'POST') return fail(405, 'method', 'bad_method');
      // A page of another site may not read a guest's pictures with a token it got hold of (its fetch carries its Origin).
      if (origin !== null && !ours) return fail(403, 'origin', 'forbidden_origin');
      if (!configured) return fail(503, 'not_configured', 'not_configured');
      const length = Number(req.headers.get('content-length') ?? '0');
      if (Number.isFinite(length) && length > BODY_MAX) return fail(413, 'too_big', 'too_big');
      let text: string;
      try {
        text = await readCapped(req, BODY_MAX);
      } catch (error) {
        if (error instanceof TooBig) return fail(413, 'too_big', 'too_big');
        return fail(400, 'bad_request', 'bad_request', { error_name: errorName(error) });
      }
      const ask = parseAsk(text);
      if (!ask) return fail(400, 'bad_request', 'bad_request');

      // The database decides: the path is a picture of this attempt (or of a question this game has shown), and the
      // token is the attempt's (or the game's host's or player's).
      let answer: unknown;
      try {
        const { name, args } = rpcOf(ask);
        const rpc = await deps.fetch(`${base}/rest/v1/rpc/${name}`, {
          method: 'POST',
          headers: { ...service, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!rpc.ok) {
          await rpc.body?.cancel().catch(() => undefined);
          return fail(503, 'unavailable', 'unavailable', { upstream: rpc.status, error_name: 'Rpc' });
        }
        answer = await rpc.json();
      } catch (error) {
        return fail(503, 'unavailable', 'unavailable', { error_name: errorName(error) });
      }
      if (!isAllowed(answer, ask.path)) return fail(404, 'not_found', 'not_found');

      let bytes: ArrayBuffer;
      try {
        const object = await deps.fetch(`${base}/storage/v1/object/${BUCKET}/${ask.path}`, {
          method: 'GET',
          headers: service,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!object.ok) {
          await object.body?.cancel().catch(() => undefined);
          // Storage answers a missing object 400 (older) or 404.
          if (object.status === 400 || object.status === 404) return fail(404, 'not_found', 'not_found', { upstream: object.status });
          return fail(503, 'unavailable', 'unavailable', { upstream: object.status, error_name: 'Storage' });
        }
        bytes = await object.arrayBuffer();
      } catch (error) {
        return fail(503, 'unavailable', 'unavailable', { error_name: errorName(error) });
      }
      note('ok', 200);
      return new Response(bytes, {
        status: 200,
        headers: {
          ...common,
          'Content-Type': contentTypeOf(ask.path),
          'Cache-Control': PICTURE_CACHE,
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    } catch (error) {
      return fail(500, 'failed', 'failed', { error_name: errorName(error) });
    }
  };
}
