// quizMedia.ts (the `quiz-media` Edge Function, release 47): the environment, the shape of the request, CORS as the
// telegram function's webapp route, the database call (quiz_guest_media_paths with the service key), the storage read,
// the answers (the bytes with the extension's type, 404 without detail, 503), the 2 KB limit, and the rule that the
// token, the attempt, the path and the key never reach a log line or an answer. Fake fetch; run under Node:
// `node --experimental-strip-types --test supabase/functions/_shared/quizMedia.test.ts`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BODY_MAX, BUCKET, contentTypeOf, createQuizMedia, isAllowed, parseAsk, PICTURE_CACHE, readMediaEnv, RPC_NAME,
  type MediaLogLine,
} from './quizMedia.ts';

const SITE = 'https://ludosiel-studyforge.hf.space';
const URL_ = 'https://abcdefghijklmnopqrst.supabase.co';
const LEGACY_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.TEST_NOT_REAL';
const SECRET_KEY = 'sb_secret_TEST_NOT_REAL_xxxxxxxx';
const ATTEMPT = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE';
const CONTAINER = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';
const PATH = `${CONTAINER}/${'a'.repeat(64)}.png`;
const OTHER_PATH = `${CONTAINER}/${'b'.repeat(64)}.jpg`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

assert.equal(TOKEN.length, 43);

type Call = { url: string; init?: RequestInit };

interface FakeOptions {
  /** The paths quiz_guest_media_paths lets through (for this attempt and token). */
  allowed?: string[];
  rpcStatus?: number;
  rpcBody?: string;
  rpcThrows?: Error;
  storageStatus?: number;
  storageThrows?: Error;
  key?: string;
}

function fake(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const lines: MediaLogLine[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    if (url.includes('/rest/v1/rpc/')) {
      if (options.rpcThrows) throw options.rpcThrows;
      const status = options.rpcStatus ?? 200;
      if (status !== 200) return new Response(JSON.stringify({ code: 'PGRST202', message: 'secret details' }), { status });
      if (options.rpcBody !== undefined) return new Response(options.rpcBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
      const args = JSON.parse(String(init?.body)) as { p_paths: string[] };
      const allowed = new Set(options.allowed ?? [PATH]);
      return Response.json(args.p_paths.filter((path) => allowed.has(path)));
    }
    if (url.includes('/storage/v1/object/')) {
      if (options.storageThrows) throw options.storageThrows;
      const status = options.storageStatus ?? 200;
      if (status !== 200) return Response.json({ statusCode: String(status), error: 'not_found', message: 'Object not found' }, { status });
      // Storage's own type is not what the function answers with.
      return new Response(PNG, { status: 200, headers: { 'Content-Type': 'text/html', 'Content-Length': String(PNG.byteLength) } });
    }
    throw new Error(`unexpected ${url}`);
  };
  const handle = createQuizMedia({ url: `${URL_}/`, key: options.key ?? LEGACY_KEY, fetch, log: (line) => lines.push(line), now: () => 1000 });
  return { calls, lines, handle };
}

function ask(body: unknown, headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request(`${URL_}/functions/v1/quiz-media`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer anon', apikey: 'anon', Origin: SITE, ...headers },
    body: method === 'GET' || method === 'OPTIONS' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const good = { attempt_id: ATTEMPT, token: TOKEN, path: PATH };

/** Nothing secret in what leaves: the log lines, an answer's body. */
function assertClean(text: string) {
  for (const secret of [TOKEN, ATTEMPT, PATH, CONTAINER, LEGACY_KEY, SECRET_KEY, 'secret details']) {
    assert.ok(!text.includes(secret), `leaked ${secret.slice(0, 12)}…`);
  }
}

// ─────────────────────────────────────────── pure parts ───────────────────────────────────────────

test('the environment: the secret key of SUPABASE_SECRET_KEYS, else the legacy service_role key', () => {
  const env = (values: Record<string, string>) => readMediaEnv((name) => values[name]);
  assert.deepEqual(env({ SUPABASE_URL: `${URL_}/`, SUPABASE_SECRET_KEYS: `{"default":"${SECRET_KEY}"}`, SUPABASE_SERVICE_ROLE_KEY: 'legacy' }), {
    supabaseUrl: URL_, serviceKey: SECRET_KEY,
  });
  assert.equal(env({ SUPABASE_SECRET_KEYS: 'not json', SUPABASE_SERVICE_ROLE_KEY: ` ${LEGACY_KEY} ` }).serviceKey, LEGACY_KEY);
  assert.equal(env({ SUPABASE_SECRET_KEYS: '{"other":"sb_secret_x"}', SUPABASE_SERVICE_ROLE_KEY: 'legacy' }).serviceKey, 'legacy');
  assert.equal(env({ SUPABASE_SECRET_KEYS: 'null', SUPABASE_SERVICE_ROLE_KEY: 'legacy' }).serviceKey, 'legacy');
  assert.deepEqual(env({}), { supabaseUrl: '', serviceKey: '' });
});

test('the request: a uuid, the device token and a picture path, nothing else matters', () => {
  assert.deepEqual(parseAsk(JSON.stringify(good)), { attemptId: ATTEMPT, token: TOKEN, path: PATH });
  assert.deepEqual(parseAsk(JSON.stringify({ ...good, attempt_id: ATTEMPT.toUpperCase(), extra: 1 })), { attemptId: ATTEMPT, token: TOKEN, path: PATH });
  for (const ext of ['png', 'jpg', 'gif', 'webp', 'bmp']) assert.ok(parseAsk(JSON.stringify({ ...good, path: `${CONTAINER}/${'c'.repeat(64)}.${ext}` })));
  const bad: unknown[] = [
    'not json', '[]', 'null', '"text"', '{}',
    { ...good, attempt_id: 'not-a-uuid' }, { ...good, attempt_id: 42 }, { ...good, attempt_id: undefined },
    { ...good, token: TOKEN.slice(1) }, { ...good, token: `${TOKEN}x` }, { ...good, token: `${TOKEN.slice(1)}=` }, { ...good, token: `${TOKEN.slice(1)}+` },
    { ...good, path: `${CONTAINER}/${'a'.repeat(64)}.svg` }, { ...good, path: `${CONTAINER}/${'a'.repeat(63)}.png` },
    { ...good, path: `${CONTAINER}/${'A'.repeat(64)}.png` }, { ...good, path: `../${CONTAINER}/${'a'.repeat(64)}.png` },
    { ...good, path: `${CONTAINER}/x/${'a'.repeat(64)}.png` }, { ...good, path: `${CONTAINER}/${'a'.repeat(64)}.png\n` },
    { ...good, path: [PATH] },
  ];
  for (const body of bad) assert.equal(parseAsk(typeof body === 'string' ? body : JSON.stringify(body)), null, JSON.stringify(body));
});

test('the type comes from the extension; the database answer lets through only the exact path', () => {
  assert.equal(contentTypeOf(PATH), 'image/png');
  assert.equal(contentTypeOf(OTHER_PATH), 'image/jpeg');
  assert.equal(contentTypeOf('x.gif'), 'image/gif');
  assert.equal(contentTypeOf('x.webp'), 'image/webp');
  assert.equal(contentTypeOf('x.bmp'), 'image/bmp');
  assert.equal(contentTypeOf('x.svg'), 'application/octet-stream');
  assert.equal(isAllowed([PATH], PATH), true);
  assert.equal(isAllowed([OTHER_PATH, PATH], PATH), true);
  for (const answer of [[], null, {}, PATH, [OTHER_PATH], [PATH.toUpperCase()], [[PATH]], { 0: PATH }]) assert.equal(isAllowed(answer, PATH), false);
});

// ─────────────────────────────────────────── the handler ───────────────────────────────────────────

test('a picture of the attempt: the database asked with the service key, then the bytes from storage', async () => {
  const { calls, lines, handle } = fake();
  const res = await handle(ask(good));
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PNG);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(res.headers.get('cache-control'), PICTURE_CACHE);
  assert.equal(res.headers.get('access-control-allow-origin'), SITE);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('vary'), 'Origin');

  assert.equal(calls.length, 2);
  const [rpc, object] = calls;
  assert.equal(rpc.url, `${URL_}/rest/v1/rpc/${RPC_NAME}`);
  assert.equal(rpc.init?.method, 'POST');
  const rpcHeaders = rpc.init?.headers as Record<string, string>;
  assert.equal(rpcHeaders.apikey, LEGACY_KEY);
  assert.equal(rpcHeaders.Authorization, `Bearer ${LEGACY_KEY}`);
  assert.equal(rpcHeaders['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(String(rpc.init?.body)), { p_attempt_id: ATTEMPT, p_token: TOKEN, p_paths: [PATH] });
  assert.ok(rpc.init?.signal, 'the database call has a time limit');

  assert.equal(object.url, `${URL_}/storage/v1/object/${BUCKET}/${PATH}`);
  assert.equal(object.init?.method, 'GET');
  assert.deepEqual(object.init?.headers, { apikey: LEGACY_KEY, Authorization: `Bearer ${LEGACY_KEY}` });
  assert.ok(object.init?.signal, 'the storage read has a time limit');

  assert.deepEqual(lines, [{ fn: 'quiz-media', outcome: 'ok', status: 200, ms: 0 }]);
});

test('the new secret key goes on apikey only (bot/db.ts)', async () => {
  const { calls, handle } = fake({ key: SECRET_KEY });
  assert.equal((await handle(ask(good))).status, 200);
  for (const call of calls) {
    const headers = call.init?.headers as Record<string, string>;
    assert.equal(headers.apikey, SECRET_KEY);
    assert.equal(headers.Authorization, undefined);
  }
});

test('not a picture of this attempt (or a wrong token, or another attempt): 404 with no detail, storage untouched', async () => {
  const { calls, lines, handle } = fake({ allowed: [OTHER_PATH] });
  const res = await handle(ask(good));
  assert.equal(res.status, 404);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { error: 'not_found' });
  assert.ok(text.length < 40);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('access-control-allow-origin'), SITE);
  assert.equal(calls.length, 1, 'no storage read');
  assert.equal(lines[0].outcome, 'not_found');

  for (const rpcBody of ['[]', 'null', '{}', `"${PATH}"`]) {
    const other = fake({ rpcBody });
    assert.equal((await other.handle(ask(good))).status, 404, rpcBody);
    assert.equal(other.calls.length, 1);
  }
});

test('listed but gone from storage: 404; storage failing: 503', async () => {
  for (const status of [400, 404]) {
    const { lines, handle } = fake({ storageStatus: status });
    const res = await handle(ask(good));
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not_found' });
    assert.equal(lines[0].upstream, status);
  }
  for (const options of [{ storageStatus: 500 }, { storageThrows: Object.assign(new Error(`fetch ${URL_}/storage/v1/object/${BUCKET}/${PATH}`), { name: 'TimeoutError' }) }]) {
    const { lines, handle } = fake(options);
    const res = await handle(ask(good));
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: 'unavailable' });
    assertClean(text);
    assertClean(JSON.stringify(lines));
  }
});

test('the database failing or missing the function: 503, its details kept out', async () => {
  for (const options of [{ rpcStatus: 404 }, { rpcStatus: 500 }, { rpcThrows: new TypeError(`network ${URL_} ${TOKEN}`) }, { rpcBody: 'not json' }]) {
    const { calls, lines, handle } = fake(options);
    const res = await handle(ask(good));
    assert.equal(res.status, 503, JSON.stringify(options));
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { error: 'unavailable' });
    assert.equal(calls.length, 1, 'no storage read');
    assertClean(text);
    assertClean(JSON.stringify(lines));
    assert.equal(lines[0].outcome, 'unavailable');
  }
});

test('a body out of shape: 400 before any call', async () => {
  for (const body of ['not json', { ...good, token: 'short' }, { ...good, path: 'x.png' }, { attempt_id: ATTEMPT, token: TOKEN }]) {
    const { calls, handle } = fake();
    const res = await handle(ask(body));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'bad_request' });
    assert.equal(calls.length, 0);
  }
});

test('the body is at most 2 KB: by its Content-Length, and by what it really carries', async () => {
  const { calls, handle } = fake();
  const big = JSON.stringify({ ...good, pad: 'x'.repeat(BODY_MAX) });
  const res = await handle(ask(big));
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: 'too_big' });
  // A stream without a length (chunked) is cut at the limit.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let n = 0; n < 4; n += 1) controller.enqueue(new TextEncoder().encode('x'.repeat(1000)));
      controller.close();
    },
  });
  const chunked = new Request(`${URL_}/functions/v1/quiz-media`, { method: 'POST', body: stream, duplex: 'half', headers: { Origin: SITE } } as RequestInit);
  assert.equal((await handle(chunked)).status, 413);
  assert.equal(calls.length, 0);
  // Just under the limit is read.
  const padded = JSON.stringify({ ...good, pad: '' });
  const near = JSON.stringify({ ...good, pad: 'x'.repeat(BODY_MAX - padded.length) });
  assert.equal(new TextEncoder().encode(near).byteLength, BODY_MAX);
  assert.equal((await handle(ask(near))).status, 200);
});

test('CORS: the site only; a request without an Origin (the /sb/ way) is served', async () => {
  const { handle, calls } = fake();
  const preflight = await handle(ask(null, { 'Access-Control-Request-Method': 'POST' }, 'OPTIONS'));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), SITE);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /authorization/);
  assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /apikey/);
  assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /content-type/);

  const foreign = await handle(ask(null, { Origin: 'https://evil.example' }, 'OPTIONS'));
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('access-control-allow-origin'), null);
  const foreignPost = await handle(ask(good, { Origin: 'https://evil.example' }));
  assert.equal(foreignPost.status, 403);
  assert.equal(foreignPost.headers.get('access-control-allow-origin'), null);
  const lookalike = await handle(ask(good, { Origin: `${SITE}.evil.example` }));
  assert.equal(lookalike.status, 403);
  assert.equal(calls.length, 0);

  const plain = new Request(`${URL_}/functions/v1/quiz-media`, { method: 'POST', body: JSON.stringify(good), headers: { 'Content-Type': 'application/json' } });
  const viaSite = await handle(plain);
  assert.equal(viaSite.status, 200);
  assert.equal(viaSite.headers.get('access-control-allow-origin'), null);
  assert.equal(viaSite.headers.get('content-type'), 'image/png');
});

test('POST only', async () => {
  const { handle, calls } = fake();
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const res = await handle(ask(good, {}, method));
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'POST, OPTIONS');
  }
  assert.equal(calls.length, 0);
});

test('not configured: 503, the preflight still answers', async () => {
  const lines: MediaLogLine[] = [];
  const fetch = async () => {
    throw new Error('no call');
  };
  for (const deps of [{ url: '', key: LEGACY_KEY }, { url: URL_, key: '' }, { url: 'not a url', key: LEGACY_KEY }]) {
    const handle = createQuizMedia({ ...deps, fetch, log: (line) => lines.push(line) });
    const res = await handle(ask(good));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'not_configured' });
    assert.equal((await handle(ask(null, {}, 'OPTIONS'))).status, 204);
  }
  assert.ok(lines.some((line) => line.outcome === 'not_configured'));
});

test('no token, attempt, path or key in any log line, whatever happens', async () => {
  const all: MediaLogLine[] = [];
  const cases: FakeOptions[] = [{}, { allowed: [] }, { rpcStatus: 500 }, { storageStatus: 404 }, { storageStatus: 502 }, { rpcThrows: new Error(TOKEN) }];
  for (const options of cases) {
    const { lines, handle } = fake(options);
    await handle(ask(good));
    await handle(ask({ ...good, token: 'x' }));
    await handle(ask(good, { Origin: 'https://evil.example' }));
    all.push(...lines);
  }
  assert.ok(all.length >= cases.length * 3);
  assertClean(JSON.stringify(all));
  for (const line of all) assert.deepEqual(Object.keys(line).filter((key) => !['fn', 'outcome', 'status', 'ms', 'upstream', 'error_name'].includes(key)), []);
});
