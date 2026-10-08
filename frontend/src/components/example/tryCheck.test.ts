import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DONT_KNOW_VERDICT, type Evaluation } from '../../lib/oral/oralApi';
import {
  CHECKED_BY_AI,
  CHECKED_BY_KEYWORDS,
  TRY_CHECK_TIMEOUT_MS,
  TRY_EVALUATE_PATH,
  TRY_FOLLOWUP_AFTER_FAILURE_MS,
  TRY_FOLLOWUP_TIMEOUT_MS,
  checkLine,
  checkSummary,
  checkTryAnswer,
  checkTryFollowup,
  followupPlan,
  keptEvaluation,
  parseCheckSummary,
  parseTryResponse,
  tryEvaluation,
} from './tryCheck';

const IDS = ['p1', 'p2', 'p3'];
const PROTOCOL = {
  points: [
    { id: 'p1', status: 'covered', student_quote: 'своими словами', comment: '' },
    { id: 'p2', status: 'wrong', student_quote: 'наоборот', comment: '' },
    { id: 'p3', status: 'missing', student_quote: '', comment: 'Не названо.' },
  ],
  errors: [{ point_id: 'p2', student_quote: 'наоборот', correction: 'Как в лекции.' }],
  verdict: 'Повторите второй пункт.',
};
const KEYWORDS: Evaluation = {
  points: IDS.map((id) => ({ id, status: 'missing', student_quote: '', comment: '' })),
  errors: [],
  verdict: '',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => json(200, { mode: 'ai', evaluation: PROTOCOL }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('checkTryAnswer', () => {
  it('sends the question’s id and the answer, nothing else, and returns the AI’s protocol', async () => {
    const result = await checkTryAnswer('q5', 'Эластичность — это реакция спроса на цену.', IDS);
    expect(result.by).toBe('ai');
    expect(result.by === 'ai' && result.evaluation.points.map((point) => point.status)).toEqual(['covered', 'wrong', 'missing']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TRY_EVALUATE_PATH);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ question_id: 'q5', transcript: 'Эластичность — это реакция спроса на цену.' });
  });

  it.each([
    [json(200, { mode: 'keywords', reason: 'day_cap' }), 'day_cap'],
    [json(200, { mode: 'keywords', reason: 'no_key' }), 'no_key'],
    [json(200, { mode: 'keywords', reason: 'busy' }), 'busy'],
    [json(200, { mode: 'keywords', reason: 'timeout' }), 'timeout'],
    [json(200, { mode: 'keywords', reason: 'something new' }), 'failed'],
    [json(429, { detail: 'Слишком много запросов.' }), 'client_limit'],
    [json(404, { detail: 'Такого вопроса в примере нет.' }), 'failed'],
    [json(502, { detail: 'Bad gateway' }), 'failed'],
    [json(200, { mode: 'ai', evaluation: { points: [] } }), 'failed'],
    [new Response('<html>proxy</html>', { status: 200 }), 'failed'],
  ])('falls back to the key words with the reason (%#)', async (response, reason) => {
    fetchMock.mockResolvedValueOnce(response);
    expect(await checkTryAnswer('q1', 'Ответ своими словами', IDS)).toEqual({ by: 'keywords', reason });
  });

  it('a broken connection is «offline»; no answer within the time limit is «timeout»', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await checkTryAnswer('q1', 'Ответ', IDS)).toEqual({ by: 'keywords', reason: 'offline' });

    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const pending = checkTryAnswer('q1', 'Ответ', IDS);
    await vi.advanceTimersByTimeAsync(TRY_CHECK_TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toEqual({ by: 'keywords', reason: 'timeout' });
  });

  it('«не знаю», an answer over 4000 characters and an offline browser send nothing', async () => {
    expect(await checkTryAnswer('q1', 'Ну, не знаю.', IDS)).toEqual({ by: 'dont_know' });
    expect(await checkTryAnswer('q1', 'а'.repeat(4001), IDS)).toEqual({ by: 'keywords', reason: 'too_long' });
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await checkTryAnswer('q1', 'Ответ', IDS)).toEqual({ by: 'keywords', reason: 'offline' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an answer of exactly 4000 characters is sent', async () => {
    await checkTryAnswer('q1', 'а'.repeat(4000), IDS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops when the page moves on', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    const pending = checkTryAnswer('q1', 'Ответ', IDS, { signal: controller.signal });
    controller.abort();
    expect((await pending).by).toBe('keywords');
  });
});

describe('checkTryFollowup: the reply to the examiner (PUB-2)', () => {
  const REPLY = 'Если модуль эластичности больше единицы, спрос эластичный, если меньше единицы — неэластичный.';

  it('sends the question’s id, the point’s id and the reply, nothing else, and returns the AI’s status', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { mode: 'ai', status: 'covered' }));
    expect(await checkTryFollowup('q5', 'p3', REPLY)).toEqual({ by: 'ai', status: 'covered' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TRY_EVALUATE_PATH);
    expect(JSON.parse(String(init.body))).toEqual({ question_id: 'q5', point_id: 'p3', transcript: REPLY });
  });

  it.each([
    [json(200, { mode: 'ai', status: 'partial' }), { by: 'ai', status: 'partial' }],
    [json(200, { mode: 'ai', status: 'отлично' }), { by: 'keywords', reason: 'failed' }],
    [json(200, { mode: 'keywords', reason: 'day_cap' }), { by: 'keywords', reason: 'day_cap' }],
    [json(200, { mode: 'keywords', reason: 'made up' }), { by: 'keywords', reason: 'failed' }],
    [json(429, { detail: 'Слишком много запросов.' }), { by: 'keywords', reason: 'client_limit' }],
    [json(400, { detail: 'Неверный формат запроса.' }), { by: 'keywords', reason: 'failed' }],
  ])('reads the server’s answer about the reply, or the key words with the reason (%#)', async (response, expected) => {
    fetchMock.mockResolvedValueOnce(response);
    expect(await checkTryFollowup('q5', 'p3', REPLY)).toEqual(expected);
  });

  it('waits 5.5 s by default and as long as it is told; a reply over 4000 characters is not sent', async () => {
    expect(TRY_FOLLOWUP_TIMEOUT_MS).toBe(5_500);
    vi.useFakeTimers();
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    fetchMock.mockImplementationOnce(hang);
    const short = checkTryFollowup('q5', 'p3', REPLY, { timeoutMs: TRY_FOLLOWUP_AFTER_FAILURE_MS });
    await vi.advanceTimersByTimeAsync(TRY_FOLLOWUP_AFTER_FAILURE_MS + 1);
    expect(await short).toEqual({ by: 'keywords', reason: 'timeout' });
    vi.useRealTimers();
    expect(await checkTryFollowup('q5', 'p3', 'а'.repeat(4001))).toEqual({ by: 'keywords', reason: 'too_long' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks the AI about the reply by what the answer’s own check said: in full, briefly, or not at all', () => {
    const ai = { by: 'ai' as const, evaluation: KEYWORDS };
    expect(followupPlan(ai)).toEqual({ ask: true, timeoutMs: TRY_FOLLOWUP_TIMEOUT_MS });
    expect(followupPlan({ by: 'dont_know' })).toEqual({ ask: true, timeoutMs: TRY_FOLLOWUP_TIMEOUT_MS });
    expect(followupPlan({ by: 'keywords', reason: 'too_long' })).toEqual({ ask: true, timeoutMs: TRY_FOLLOWUP_TIMEOUT_MS });
    // The AI was slow or failed, or has not answered yet: one short wait, as a real ticket after a failed check.
    for (const reason of ['timeout', 'failed'] as const) expect(followupPlan({ by: 'keywords', reason })).toEqual({ ask: true, timeoutMs: TRY_FOLLOWUP_AFTER_FAILURE_MS });
    expect(followupPlan(null)).toEqual({ ask: true, timeoutMs: TRY_FOLLOWUP_AFTER_FAILURE_MS });
    // No AI check can be had now: the key words at once, for the same reason, with no request.
    for (const reason of ['no_key', 'day_cap', 'busy', 'client_limit', 'offline'] as const) expect(followupPlan({ by: 'keywords', reason })).toEqual({ ask: false, reason });
  });
});

describe('the protocol of a checked answer', () => {
  it('is the AI’s, «не знаю» with nothing named, or the key words’ own', () => {
    const byAI = parseTryResponse({ mode: 'ai', evaluation: PROTOCOL }, IDS);
    expect(tryEvaluation(byAI, IDS, KEYWORDS).errors).toEqual(PROTOCOL.errors);
    expect(tryEvaluation({ by: 'dont_know' }, IDS, KEYWORDS)).toEqual({
      points: IDS.map((id) => ({ id, status: 'missing', student_quote: '', comment: '' })),
      errors: [],
      verdict: DONT_KNOW_VERDICT,
    });
    expect(tryEvaluation({ by: 'keywords', reason: 'busy' }, IDS, KEYWORDS)).toBe(KEYWORDS);
  });

  it('keeps only known points and statuses of the server’s protocol', () => {
    const result = parseTryResponse(
      { mode: 'ai', evaluation: { points: [{ id: 'p1', status: 'covered' }, { id: 'p9', status: 'covered' }, { id: 'p2', status: 'отлично' }] } },
      IDS,
    );
    expect(result.by === 'ai' && result.evaluation.points.map((point) => [point.id, point.status])).toEqual([
      ['p1', 'covered'],
      ['p2', 'unrated'],
      ['p3', 'unrated'],
    ]);
  });

  it('reads a protocol kept in the tab, and nothing else', () => {
    expect(keptEvaluation(PROTOCOL, IDS)?.points[1].status).toBe('wrong');
    expect(keptEvaluation('<script>', IDS)).toBeNull();
    expect(keptEvaluation({ points: [] }, IDS)).toBeNull();
  });
});

describe('the line that says how the answer was checked', () => {
  it('names the AI, or the key words and why, in plain words', () => {
    expect(checkLine({ by: 'ai' })).toBe(CHECKED_BY_AI);
    expect(CHECKED_BY_AI).toBe('Ответ проверил ИИ по пунктам из лекций примера.');
    expect(checkLine({ by: 'dont_know' })).toBe(DONT_KNOW_VERDICT);
    expect(checkLine({ by: 'keywords' })).toBe(CHECKED_BY_KEYWORDS);
    expect(checkLine({ by: 'keywords', reason: 'no_key' })).toBe('Проверено по ключевым словам: проверка ИИ в примере сейчас недоступна.');
    expect(checkLine({ by: 'keywords', reason: 'busy' })).toBe('Проверено по ключевым словам: проверка ИИ в примере сейчас недоступна.');
    expect(checkLine({ by: 'keywords', reason: 'failed' })).toBe('Проверено по ключевым словам: проверка ИИ в примере сейчас недоступна.');
    expect(checkLine({ by: 'keywords', reason: 'timeout' })).toBe('Проверено по ключевым словам: ИИ не успел проверить ответ.');
    expect(checkLine({ by: 'keywords', reason: 'day_cap' })).toBe('Проверено по ключевым словам: проверки ИИ в примере на сегодня закончились.');
    expect(checkLine({ by: 'keywords', reason: 'client_limit' })).toBe('Проверено по ключевым словам: из вашей сети было слишком много проверок подряд.');
    expect(checkLine({ by: 'keywords', reason: 'offline' })).toBe('Проверено по ключевым словам: нет связи с сервером.');
    expect(checkLine({ by: 'keywords', reason: 'too_long' })).toBe('Проверено по ключевым словам: ИИ в примере проверяет ответы до 4000 знаков.');
  });

  it('is kept with the answer and read back only as written', () => {
    expect(checkSummary({ by: 'keywords', reason: 'day_cap' })).toEqual({ by: 'keywords', reason: 'day_cap' });
    expect(checkSummary({ by: 'ai', evaluation: KEYWORDS })).toEqual({ by: 'ai' });
    expect(parseCheckSummary({ by: 'ai' })).toEqual({ by: 'ai' });
    expect(parseCheckSummary({ by: 'keywords', reason: 'offline' })).toEqual({ by: 'keywords', reason: 'offline' });
    expect(parseCheckSummary({ by: 'keywords', reason: 'made up' })).toEqual({ by: 'keywords' });
    expect(parseCheckSummary({ by: 'teacher' })).toBeNull();
    expect(parseCheckSummary(undefined)).toBeNull();
  });
});
