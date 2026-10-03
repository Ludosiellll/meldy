import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyzeError, analyzeErrorFromEvent, ANALYZE_MESSAGES, runAnalyzeStream } from './analyzeStream';
import { STREAM_MESSAGES } from './sseStream';
import { RUN_FAILURE_MESSAGES } from '../utils/analysisSections';
import type { SectionName } from '../types';

const enc = new TextEncoder();
const ev = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
const CORE: SectionName[] = ['summarizer', 'flashcards', 'quiz'];

function sseResponse(chunks: string[], end: 'close' | 'error' | 'hang' = 'close') {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise(resolve => setTimeout(resolve, 2));
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

let lastUrl = '';
let lastInit: RequestInit | undefined;
function mockFetch(make: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      lastUrl = url;
      lastInit = init;
      return make();
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const summary = { title: 'Энтропия', subject: 'Физика', content: 'Мера беспорядка', terms: [], source_ids: ['S01'] };
const quiz = { quiz: [{ id: 1, question: 'Растёт ли энтропия?', options: ['A) Да', 'B) Нет'], correct: 'A', explanation: '', source_ids: [] }] };
const TEXT = { type: 'text_extracted', length: 15, text: 'Мера беспорядка' };
const GROUNDING = { type: 'grounding', source_count: 1, sources: [{ id: 'S01', text: 'Мера беспорядка' }] };
const START = { type: 'agent_start', agent: 'summarizer', label: 'Конспект' };
const DONE_SUMMARY = { type: 'agent_done', agent: 'summarizer', label: 'Конспект', progress: 1, total: 3, status: 'ok', result: summary };
const RESULTS = {
  type: 'results',
  summarizer: summary,
  flashcards: { error: 'Сервис ИИ был перегружен' },
  quiz,
  cheatsheet: { content: '' },
  podcast: { podcast: [] },
  missions: { missions: [] },
  warnings: [{ agent: 'flashcards', message: 'Сервис ИИ был перегружен' }],
  sections: { summarizer: { status: 'ok' }, flashcards: { status: 'busy', message: 'Сервис ИИ был перегружен' }, quiz: { status: 'ok' } },
  grounding: { source_count: 1, citable_items: 1, sources: [{ id: 'S01', text: 'Мера беспорядка' }] },
};

const run = (overrides: Partial<Parameters<typeof runAnalyzeStream>[0]> = {}) =>
  runAnalyzeStream({ endpoint: '/api/analyze', body: new FormData(), token: 'tok', requested: CORE, ...overrides });

describe('runAnalyzeStream outcomes', () => {
  it('results: the run ends at results, failed sections become empty lists with statuses', async () => {
    mockFetch(() => sseResponse([ev(TEXT), ev(GROUNDING), ev(START), ev(DONE_SUMMARY), ev(RESULTS), ev({ type: 'done' })]));
    const events: unknown[] = [];
    const outcome = await run({ onEvent: e => events.push(e.type) });
    expect(outcome.kind).toBe('results');
    if (outcome.kind !== 'results') return;
    expect(outcome.results.flashcards).toEqual({ flashcards: [] });
    expect(outcome.results.quiz).toEqual(quiz);
    expect(outcome.results.sections?.flashcards).toEqual({ status: 'busy', message: 'Сервис ИИ был перегружен' });
    expect(outcome.extractedText).toBe('Мера беспорядка');
    expect(outcome.textLength).toBe(15);
    expect(events).toEqual(['text_extracted', 'grounding', 'agent_start', 'agent_done', 'results']);
    expect(lastUrl).toBe('/api/analyze');
    expect(new Headers(lastInit?.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('results then a cut connection still resolves with the results', async () => {
    mockFetch(() => sseResponse([ev(TEXT), ev(RESULTS)], 'error'));
    const outcome = await run();
    expect(outcome.kind).toBe('results');
  });

  it('a clean EOF after agent_start without any ok section is «incomplete»', async () => {
    mockFetch(() => sseResponse([ev(TEXT), ev(START)], 'close'));
    const error = await run().catch(e => e);
    expect(error).toBeInstanceOf(AnalyzeError);
    expect(error).toMatchObject({ kind: 'incomplete', retryable: true, message: ANALYZE_MESSAGES.incomplete });
  });

  it('agent_done(summarizer ok) then a TypeError gives partial results', async () => {
    mockFetch(() => sseResponse([ev(TEXT), ev(GROUNDING), ev(START), ev(DONE_SUMMARY)], 'error'));
    const outcome = await run();
    expect(outcome.kind).toBe('partial');
    if (outcome.kind !== 'partial') return;
    expect(outcome.results.summarizer.content).toBe('Мера беспорядка');
    expect(outcome.results.sections).toEqual({
      summarizer: { status: 'ok' },
      flashcards: { status: 'missing', message: 'Связь прервалась до этого раздела' },
      quiz: { status: 'missing', message: 'Связь прервалась до этого раздела' },
    });
    expect(outcome.results.grounding?.sources).toHaveLength(1);
  });

  it('a network cut before any ok section is a retryable network error without parser text', async () => {
    mockFetch(() => sseResponse([ev(TEXT), ev(START)], 'error'));
    const error = await run().catch(e => e);
    expect(error).toMatchObject({ kind: 'network', retryable: true, message: ANALYZE_MESSAGES.network });
  });

  it('silence after headers ends with a timeout error (or partial when a section arrived)', async () => {
    mockFetch(() => sseResponse([ev(TEXT)], 'hang'));
    const error = await run({ idleMs: 50 }).catch(e => e);
    expect(error).toMatchObject({ kind: 'timeout', message: ANALYZE_MESSAGES.timeout });

    mockFetch(() => sseResponse([ev(TEXT), ev(DONE_SUMMARY)], 'hang'));
    const outcome = await run({ idleMs: 50 });
    expect(outcome.kind).toBe('partial');
  });

  it('results where every core section failed is an error, never a result', async () => {
    mockFetch(() =>
      sseResponse([
        ev({
          ...RESULTS,
          summarizer: { error: 'x' },
          quiz: { error: 'x' },
          sections: { summarizer: { status: 'busy' }, flashcards: { status: 'busy' }, quiz: { status: 'busy' } },
        }),
      ]),
    );
    const error = await run().catch(e => e);
    expect(error).toMatchObject({ kind: 'busy', message: RUN_FAILURE_MESSAGES.busy });
  });

  it('an old backend results event with only empty sections is an error', async () => {
    mockFetch(() =>
      sseResponse([ev({ type: 'results', summarizer: { source_ids: [] }, flashcards: { flashcards: [] }, quiz: { quiz: [] }, warnings: [] }), ev({ type: 'done' })]),
    );
    const error = await run().catch(e => e);
    expect(error).toMatchObject({ kind: 'empty', message: RUN_FAILURE_MESSAGES.empty });
  });

  it('error events map to kinds by code; a later done is ignored', async () => {
    mockFetch(() => sseResponse([ev(TEXT), ev({ type: 'error', code: 'busy', message: 'Сервис ИИ сейчас занят. Материал не сохранён, энергия не списана. Попробуйте через минуту.' }), ev({ type: 'done' })]));
    const error = await run().catch(e => e);
    expect(error).toMatchObject({ kind: 'busy', retryable: true });
    expect(error.message).toContain('энергия не списана');
  });

  it.each([
    ['empty', 'empty', true],
    ['failed', 'server', true],
    ['timeout', 'timeout', true],
    ['no_text', 'bad_request', false],
    ['too_large', 'too_large', false],
    ['internal', 'server', true],
    [undefined, 'server', true],
  ])('error code %s → kind %s', (code, kind, retryable) => {
    const error = analyzeErrorFromEvent({ type: 'error', code, message: 'Не удалось завершить анализ. Код ошибки: abc123' });
    expect(error.kind).toBe(kind);
    expect(error.retryable).toBe(retryable);
    expect(error.message).toBe('Не удалось завершить анализ. Код ошибки: abc123');
  });

  it('an English or missing error message is replaced by Russian text', () => {
    expect(analyzeErrorFromEvent({ type: 'error', message: 'Traceback (most recent call last)' }).message).toBe(ANALYZE_MESSAGES.server);
  });

  it('HTTP errors before the stream map to kinds', async () => {
    const cases: Array<[Response, string, boolean]> = [
      [new Response('<html><h1>502 Bad Gateway</h1></html>', { status: 502, headers: { 'content-type': 'text/html' } }), 'unavailable', true],
      [new Response('<html>413 Request Entity Too Large</html>', { status: 413, headers: { 'content-type': 'text/html' } }), 'too_large', false],
      [new Response('{"error":"Rate limit exceeded: 5 per 1 minute"}', { status: 429 }), 'rate_limited', true],
      [new Response('{"detail":"Требуется войти в аккаунт"}', { status: 401 }), 'auth', false],
      [new Response('{"detail":"Неподдерживаемый формат файла"}', { status: 400 }), 'bad_request', false],
      [new Response('', { status: 504 }), 'unavailable', true],
    ];
    for (const [response, kind, retryable] of cases) {
      mockFetch(() => response);
      const error = await run().catch(e => e);
      expect(error).toBeInstanceOf(AnalyzeError);
      expect(error.kind).toBe(kind);
      expect(error.retryable).toBe(retryable);
      expect(error.message).not.toMatch(/Unexpected|JSON|token/);
    }
    mockFetch(() => new Response('{"error":"Rate limit exceeded"}', { status: 429 }));
    expect((await run().catch(e => e)).message).toBe(STREAM_MESSAGES.rateLimited);
  });

  it('a user abort resolves as aborted, never as an error', async () => {
    mockFetch(() => sseResponse([ev(TEXT), ev(DONE_SUMMARY)], 'hang'));
    const controller = new AbortController();
    const pending = run({ signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 20));
    controller.abort();
    await expect(pending).resolves.toEqual({ kind: 'aborted' });
  });

  it('an exception from onEvent (moderation) stops the run and is rethrown', async () => {
    mockFetch(() => sseResponse([ev(TEXT), ev(START)], 'hang'));
    const own = new AnalyzeError('bad_request', 'Текст содержит недопустимые материалы.', false);
    const error = await run({
      onEvent: event => {
        if (event.type === 'text_extracted') throw own;
      },
    }).catch(e => e);
    expect(error).toBe(own);
  });

  it('uses the media total limit for /api/analyze/media', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
      const pending = runAnalyzeStream({ endpoint: '/api/analyze/media', body: new FormData(), token: 't', requested: CORE }).catch(e => e);
      await vi.advanceTimersByTimeAsync(6 * 60_000 + 1000);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(4 * 60_000);
      const error = await pending;
      expect(error).toMatchObject({ kind: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });
});
