import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpErrorFromResponse, readSseStream, StreamError, STREAM_MESSAGES } from './sseStream';

const enc = new TextEncoder();
const ev = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

type End = 'close' | 'error' | 'hang';

/** Поток, который отдаёт куски по одному с паузой (pull, чтобы ошибка не съела очередь). */
function sseResponse(chunks: string[], end: End = 'close', delayMs = 2) {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      if (index < chunks.length) {
        controller.enqueue(enc.encode(chunks[index++]));
        return;
      }
      if (end === 'close') controller.close();
      else if (end === 'error') controller.error(new TypeError('network error'));
      else await new Promise(() => undefined);
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

let lastInit: RequestInit | undefined;

function mockFetch(make: () => Response | Promise<Response>) {
  const fn = vi.fn(async (_url: unknown, init?: RequestInit) => {
    lastInit = init;
    return make();
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  lastInit = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readSseStream', () => {
  it('delivers events in order, skips comment lines and stops at the terminal event', async () => {
    mockFetch(() =>
      sseResponse([
        ': keepalive\n\n',
        ev({ type: 'status', message: 'Читаем' }),
        `${ev({ type: 'agent_start', agent: 'quiz' })}: keepalive\n\n${ev({ type: 'agent_done', agent: 'quiz' })}`,
        ev({ type: 'done' }),
        ev({ type: 'after_done' }),
      ]),
    );
    const events: Record<string, unknown>[] = [];
    const { terminal } = await readSseStream({ url: '/api/x', init: { method: 'POST' }, onEvent: e => events.push(e) });
    expect(events.map(e => e.type)).toEqual(['status', 'agent_start', 'agent_done', 'done']);
    expect(terminal).toEqual({ type: 'done' });
  });

  it('joins an event split across chunks and accepts CRLF line endings', async () => {
    const payload = JSON.stringify({ type: 'text_extracted', text: 'Энтропия — мера беспорядка', length: 26 });
    mockFetch(() => sseResponse([`data: ${payload.slice(0, 10)}`, `${payload.slice(10)}\r\n\r\n`, 'data: {"type":"done"}\r\n\r\n']));
    const events: Record<string, unknown>[] = [];
    await readSseStream({ url: '/api/x', init: {}, onEvent: e => events.push(e) });
    expect(events[0]).toEqual({ type: 'text_extracted', text: 'Энтропия — мера беспорядка', length: 26 });
    expect(events[1]).toEqual({ type: 'done' });
  });

  it('an error event is terminal: a later done never reaches onEvent', async () => {
    mockFetch(() => sseResponse([ev({ type: 'error', code: 'busy', message: 'Занято' }), ev({ type: 'done' })]));
    const events: Record<string, unknown>[] = [];
    const { terminal } = await readSseStream({ url: '/api/x', init: {}, onEvent: e => events.push(e) });
    expect(terminal).toMatchObject({ type: 'error', code: 'busy' });
    expect(events.map(e => e.type)).toEqual(['error']);
  });

  it('returns terminal null when the stream ends cleanly without a terminal event', async () => {
    mockFetch(() => sseResponse([ev({ type: 'agent_start', agent: 'summarizer' })], 'close'));
    const events: Record<string, unknown>[] = [];
    const result = await readSseStream({ url: '/api/x', init: {}, onEvent: e => events.push(e) });
    expect(result).toEqual({ terminal: null });
    expect(events).toHaveLength(1);
  });

  it('delivers a last event that has no trailing blank line at EOF', async () => {
    mockFetch(() => sseResponse(['data: {"type":"done"}'], 'close'));
    const { terminal } = await readSseStream({ url: '/api/x', init: {}, onEvent: () => undefined });
    expect(terminal).toEqual({ type: 'done' });
  });

  it('skips a broken JSON payload and keeps reading', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFetch(() => sseResponse(['data: {not json\n\n', ev({ type: 'done' })]));
    const events: Record<string, unknown>[] = [];
    await readSseStream({ url: '/api/x', init: {}, onEvent: e => events.push(e) });
    expect(events).toEqual([{ type: 'done' }]);
    expect(warn).toHaveBeenCalled();
  });

  it('a reader TypeError becomes a retryable network error', async () => {
    mockFetch(() => sseResponse([ev({ type: 'agent_start', agent: 'quiz' })], 'error'));
    const error = await readSseStream({ url: '/api/x', init: {}, onEvent: () => undefined }).catch(e => e);
    expect(error).toBeInstanceOf(StreamError);
    expect(error).toMatchObject({ kind: 'network', retryable: true, message: STREAM_MESSAGES.network });
  });

  it('a failed fetch (TypeError) becomes a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const error = await readSseStream({ url: '/api/x', init: {}, onEvent: () => undefined }).catch(e => e);
    expect(error).toMatchObject({ kind: 'network' });
    expect(error.message).not.toMatch(/fetch/i);
  });

  it('silence longer than idleMs aborts the request with a timeout error', async () => {
    mockFetch(() => sseResponse([ev({ type: 'text_extracted', text: 'x', length: 1 })], 'hang'));
    const started = Date.now();
    const error = await readSseStream({ url: '/api/x', init: {}, onEvent: () => undefined, idleMs: 50 }).catch(e => e);
    expect(error).toMatchObject({ kind: 'timeout', retryable: true, message: STREAM_MESSAGES.timeout });
    expect(Date.now() - started).toBeLessThan(1500);
    expect(lastInit?.signal?.aborted).toBe(true);
  });

  it('keepalive comments every 20 ms keep a 50 ms idle timer from firing', async () => {
    const keepalives = Array.from({ length: 8 }, () => ': keepalive\n\n');
    mockFetch(() => sseResponse([ev({ type: 'agent_start', agent: 'quiz' }), ...keepalives, ev({ type: 'done' })], 'close', 20));
    const events: Record<string, unknown>[] = [];
    const { terminal } = await readSseStream({ url: '/api/x', init: {}, onEvent: e => events.push(e), idleMs: 50 });
    expect(terminal).toEqual({ type: 'done' });
    expect(events.map(e => e.type)).toEqual(['agent_start', 'done']);
  });

  it('the total limit stops a stream that keeps talking', async () => {
    const keepalives = Array.from({ length: 50 }, () => ': keepalive\n\n');
    mockFetch(() => sseResponse(keepalives, 'hang', 10));
    const error = await readSseStream({ url: '/api/x', init: {}, onEvent: () => undefined, idleMs: 1000, totalMs: 80 }).catch(e => e);
    expect(error).toMatchObject({ kind: 'timeout' });
    expect(lastInit?.signal?.aborted).toBe(true);
  });

  it('the total limit also covers a request whose headers never arrive', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    const error = await readSseStream({ url: '/api/x', init: {}, onEvent: () => undefined, totalMs: 40 }).catch(e => e);
    expect(error).toMatchObject({ kind: 'timeout' });
  });

  it('an external abort ends with an aborted error and aborts the fetch signal', async () => {
    mockFetch(() => sseResponse([ev({ type: 'agent_start', agent: 'quiz' })], 'hang'));
    const controller = new AbortController();
    const pending = readSseStream({ url: '/api/x', init: {}, onEvent: () => undefined, signal: controller.signal }).catch(e => e);
    await new Promise(resolve => setTimeout(resolve, 20));
    controller.abort();
    const error = await pending;
    expect(error).toMatchObject({ kind: 'aborted', retryable: false });
    expect(lastInit?.signal?.aborted).toBe(true);
  });

  it('also honours a signal passed in init', async () => {
    mockFetch(() => sseResponse([ev({ type: 'agent_start', agent: 'quiz' })], 'hang'));
    const controller = new AbortController();
    const pending = readSseStream({ url: '/api/x', init: { signal: controller.signal }, onEvent: () => undefined }).catch(e => e);
    await new Promise(resolve => setTimeout(resolve, 20));
    controller.abort();
    expect(await pending).toMatchObject({ kind: 'aborted' });
    expect(lastInit?.signal).not.toBe(controller.signal);
    expect(lastInit?.signal?.aborted).toBe(true);
  });

  it('an already aborted signal never starts the request', async () => {
    const fetchMock = mockFetch(() => sseResponse([]));
    const controller = new AbortController();
    controller.abort();
    const error = await readSseStream({ url: '/api/x', init: {}, onEvent: () => undefined, signal: controller.signal }).catch(e => e);
    expect(error).toMatchObject({ kind: 'aborted' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an exception from onEvent stops reading and is rethrown unchanged', async () => {
    mockFetch(() => sseResponse([ev({ type: 'text_extracted' }), ev({ type: 'agent_start' })], 'hang'));
    const own = new Error('stop here');
    const seen: unknown[] = [];
    const error = await readSseStream({
      url: '/api/x',
      init: {},
      onEvent: event => {
        seen.push(event.type);
        throw own;
      },
    }).catch(e => e);
    expect(error).toBe(own);
    expect(seen).toEqual(['text_extracted']);
    expect(lastInit?.signal?.aborted).toBe(true);
  });

  it('closes the request after the terminal event but not after a clean end of stream', async () => {
    mockFetch(() => sseResponse([ev({ type: 'done' })], 'hang'));
    await readSseStream({ url: '/api/x', init: {}, onEvent: () => undefined });
    expect(lastInit?.signal?.aborted).toBe(true);

    mockFetch(() => sseResponse([ev({ type: 'status' })], 'close'));
    await readSseStream({ url: '/api/x', init: {}, onEvent: () => undefined });
    expect(lastInit?.signal?.aborted).toBe(false);
  });

  it('a non-OK response becomes an http StreamError without reading a stream', async () => {
    mockFetch(() => new Response('{"detail":"Неподдерживаемый формат файла"}', { status: 400, headers: { 'content-type': 'application/json' } }));
    const error = await readSseStream({ url: '/api/x', init: {}, onEvent: () => undefined }).catch(e => e);
    expect(error).toMatchObject({ kind: 'http', status: 400, message: 'Неподдерживаемый формат файла', retryable: false });
  });
});

const NGINX_502 =
  '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';
const NGINX_413 =
  '<html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n<body>\r\n<center><h1>413 Request Entity Too Large</h1></center>\r\n</body>\r\n</html>\r\n';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('httpErrorFromResponse', () => {
  it.each([
    ['nginx HTML 502', () => new Response(NGINX_502, { status: 502, headers: { 'content-type': 'text/html' } }), STREAM_MESSAGES.unavailable, true],
    ['nginx HTML 413', () => new Response(NGINX_413, { status: 413, headers: { 'content-type': 'text/html' } }), STREAM_MESSAGES.tooLarge, false],
    ['empty 504', () => new Response('', { status: 504 }), STREAM_MESSAGES.unavailable, true],
    ['slowapi 429', () => json(429, { error: 'Rate limit exceeded: 5 per 1 minute' }), STREAM_MESSAGES.rateLimited, true],
    ['FastAPI 429 with detail', () => json(429, { detail: 'Слишком много запросов. Подождите минуту и повторите.' }), STREAM_MESSAGES.rateLimited, true],
    ['500 with an env name', () => json(500, { detail: 'GROQ_API_KEY не настроен на сервере' }), STREAM_MESSAGES.unavailable, true],
    ['503 detail', () => json(503, { detail: 'Анализ временно недоступен. Попробуйте позже.' }), STREAM_MESSAGES.unavailable, true],
    ['401 without detail', () => new Response('', { status: 401 }), STREAM_MESSAGES.auth, false],
    ['400 English detail', () => json(400, { detail: 'Unsupported file' }), STREAM_MESSAGES.generic, true],
    ['422 FastAPI validation list', () => json(422, { detail: [{ loc: ['body'], msg: 'field required' }] }), STREAM_MESSAGES.generic, true],
    ['404 HTML page', () => new Response('<!doctype html><p>Not found</p>', { status: 404 }), STREAM_MESSAGES.unavailable, true],
  ])('%s → readable Russian text', async (_name, make, message, retryable) => {
    const error = await httpErrorFromResponse(make());
    expect(error).toBeInstanceOf(StreamError);
    expect(error.kind).toBe('http');
    expect(error.message).toBe(message);
    expect(error.retryable).toBe(retryable);
    expect(error.message).not.toMatch(/Unexpected|JSON|token|GROQ/);
  });

  it.each([400, 401, 403, 404, 409, 413, 415, 422])('passes a Cyrillic detail through for %i', async status => {
    const error = await httpErrorFromResponse(json(status, { detail: 'В файле не найден текст: похоже на скан.' }));
    expect(error.message).toBe('В файле не найден текст: похоже на скан.');
    expect(error.status).toBe(status);
    expect(error.retryable).toBe(status === 409);
  });

  it('does not pass a detail longer than 200 characters', async () => {
    const error = await httpErrorFromResponse(json(400, { detail: 'Очень длинный текст. '.repeat(20) }));
    expect(error.message).toBe(STREAM_MESSAGES.generic);
  });

  it('copies code from a {detail, code} body', async () => {
    const error = await httpErrorFromResponse(
      json(409, { detail: 'Этого вопроса нет в ваших лекциях — оценить ответ не по чему.', code: 'not_in_lectures' }),
    );
    expect(error.code).toBe('not_in_lectures');
    expect(error.message).toBe('Этого вопроса нет в ваших лекциях — оценить ответ не по чему.');
    const busy = await httpErrorFromResponse(json(429, { detail: 'Сервис ИИ сейчас занят.', code: 'ai_busy' }));
    expect(busy.code).toBe('ai_busy');
    expect(busy.message).toBe(STREAM_MESSAGES.rateLimited);
  });

  it('the daily AI limit (429 ai_limit) keeps the server words and is not retryable today', async () => {
    const limit = await httpErrorFromResponse(
      json(429, { detail: 'Дневной лимит ИИ на сегодня исчерпан.', code: 'ai_limit', used: 100, limit: 100 }),
    );
    expect(limit).toMatchObject({ kind: 'http', status: 429, code: 'ai_limit', message: 'Дневной лимит ИИ на сегодня исчерпан.', retryable: false });
    const bare = await httpErrorFromResponse(json(429, { code: 'ai_limit' }));
    expect(bare.message).toBe(STREAM_MESSAGES.aiLimit);
  });

  it('reads the body only once', async () => {
    const response = json(422, { detail: 'Ни у одной лекции нет текста' });
    const text = vi.spyOn(response, 'text');
    const json422 = vi.spyOn(response, 'json');
    await httpErrorFromResponse(response);
    expect(text).toHaveBeenCalledTimes(1);
    expect(json422).not.toHaveBeenCalled();
  });
});
