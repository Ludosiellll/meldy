import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_LIMIT_MESSAGE,
  AI_UNAVAILABLE_MESSAGE,
  CHECK_AFTER_FAILED_CHECK_MS,
  CHECK_CONFIRM_TIMEOUT_MS,
  CHECK_FOLLOWUP_TIMEOUT_MS,
  DONT_KNOW_VERDICT,
  NETWORK_MESSAGE,
  OralApiError,
  RATE_LIMITED_MESSAGE,
  checkAnswer,
  evaluateAnswer,
  fetchRubric,
  followupCheckTimeout,
  parseRubricResponse,
} from './oralApi';

function json(status: number, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

const rubricBody = {
  rubric_id: '11111111-1111-4111-8111-111111111111',
  cached: true,
  saved: true,
  question_hash: 'a'.repeat(32),
  question: 'Как обучается нейронная сеть?',
  rubric: {
    v: 1,
    question: 'Как обучается нейронная сеть?',
    coverage: 'full',
    coverage_note: '',
    fragments_considered: 12,
    fragments_total: 30,
    materials: [{ key: 'M1', material_id: 'mat-1', title: 'Нейронные сети' }],
    points: [
      {
        id: 'p1',
        title: 'Обучение — подбор весов',
        essential: true,
        source_quote: 'Обучение сети заключается в подборе весов',
        source_ids: ['M1:S12'],
        anchors: [['потер', 'ошибк'], ['вес']],
        followup: { question: 'А что сеть минимизирует?', expected: 'Функцию потерь.' },
      },
      { id: 'x9', title: 'мусор' },
    ],
    nearest: [],
  },
};

describe('oral API', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('asks for the rubric of an exam question and keeps only valid points', async () => {
    fetchMock.mockResolvedValue(json(200, rubricBody));
    const result = await fetchRubric({ examId: 'exam-1', questionId: 'q-1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/oral/rubric');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ exam_id: 'exam-1', question_id: 'q-1', force: false });
    expect(result.cached).toBe(true);
    expect(result.rubric.points.map((point) => point.id)).toEqual(['p1']);
    expect(result.rubric.points[0].followup.question).toBe('А что сеть минимизирует?');
  });

  it('shows the server’s detail for 409 and 422 and keeps status and code', async () => {
    fetchMock.mockResolvedValueOnce(
      json(409, { detail: 'Этого вопроса нет в ваших лекциях — оценить ответ не по чему.', code: 'not_in_lectures' }),
    );
    const notInLectures = await fetchRubric({ examId: 'e', questionId: 'q' }).catch((error) => error);
    expect(notInLectures).toBeInstanceOf(OralApiError);
    expect(notInLectures).toMatchObject({ status: 409, code: 'not_in_lectures', outage: false });
    expect(notInLectures.message).toBe('Этого вопроса нет в ваших лекциях — оценить ответ не по чему.');

    fetchMock.mockResolvedValueOnce(json(422, { detail: 'Не получилось составить эталон.', code: 'rubric_unverifiable' }));
    const unverifiable = await fetchRubric({ examId: 'e', questionId: 'q' }).catch((error) => error);
    expect(unverifiable).toMatchObject({ status: 422, code: 'rubric_unverifiable', message: 'Не получилось составить эталон.' });
  });

  it('never blames the lectures for an outage', async () => {
    for (const [status, body] of [
      [502, { detail: 'ИИ-сервис сейчас не ответил. Попробуйте ещё раз.', code: 'ai_failed' }],
      [504, { detail: 'ИИ-сервис не ответил вовремя. Попробуйте ещё раз.', code: 'ai_timeout' }],
      [429, { detail: 'Сервис ИИ сейчас занят.', code: 'ai_busy' }],
      [503, { detail: 'ИИ-сервис временно недоступен.', code: 'ai_unconfigured' }],
    ] as const) {
      fetchMock.mockResolvedValueOnce(json(status, body));
      const error = await fetchRubric({ examId: 'e', questionId: 'q' }).catch((caught) => caught);
      expect(error).toMatchObject({ status, message: AI_UNAVAILABLE_MESSAGE, outage: true });
    }
  });

  it('tells the limiter apart from a busy model', async () => {
    fetchMock.mockResolvedValueOnce(json(429, { detail: 'Слишком много запросов. Подождите минуту и повторите.' }));
    const error = await fetchRubric({ examId: 'e', questionId: 'q' }).catch((caught) => caught);
    expect(error).toMatchObject({ status: 429, message: RATE_LIMITED_MESSAGE });
  });

  it('the daily AI limit is not an outage: its own words, no «Повторить» today', async () => {
    fetchMock.mockResolvedValueOnce(json(429, { detail: 'Дневной лимит ИИ на сегодня исчерпан.', code: 'ai_limit', used: 100, limit: 100 }));
    const error = await evaluateAnswer({ question: 'В?', points: [], transcript: 'ответ' }).catch((caught) => caught);
    expect(error).toBeInstanceOf(OralApiError);
    expect(error).toMatchObject({ status: 429, code: 'ai_limit', message: AI_LIMIT_MESSAGE, outage: false, limitReached: true });
    fetchMock.mockResolvedValueOnce(json(429, { detail: 'Сервис ИИ сейчас занят.', code: 'ai_busy' }));
    const busy = await fetchRubric({ examId: 'e', questionId: 'q' }).catch((caught) => caught);
    expect(busy).toMatchObject({ outage: true, limitReached: false });
  });

  it('reports a dropped connection as network', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const error = await fetchRubric({ examId: 'e', questionId: 'q' }).catch((caught) => caught);
    expect(error).toMatchObject({ kind: 'network', message: NETWORK_MESSAGE, outage: true });
  });

  const hang = (_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });

  it('gives the quick checks 5.5 s — past the server’s 4.5 s — and only one long wait per answer', async () => {
    // Live run of 07.10: the client gave up at 1.5 s, the server at 2.5 s, and the model needed about 2.5 s.
    expect([CHECK_CONFIRM_TIMEOUT_MS, CHECK_FOLLOWUP_TIMEOUT_MS, CHECK_AFTER_FAILED_CHECK_MS]).toEqual([5_500, 5_500, 2_500]);
    vi.useFakeTimers();
    fetchMock.mockImplementation(hang);
    const points = [{ id: 'p1', title: 'Пункт', essential: true }];
    const quick = checkAnswer({ question: 'Вопрос', points, transcript: 'ответ' }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(CHECK_CONFIRM_TIMEOUT_MS - 10);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(await quick).toMatchObject({ kind: 'timeout', message: AI_UNAVAILABLE_MESSAGE });

    // The check at «Готово» answered (chosen_by check): the follow-up's check waits in full.
    const askedOnTime = { question: 'Вопрос', points, transcript: 'ответ', only: 'p1', followupQuestion: 'А почему?' };
    const full = checkAnswer(askedOnTime, { timeoutMs: followupCheckTimeout('check') }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(CHECK_FOLLOWUP_TIMEOUT_MS - 10);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(await full).toMatchObject({ kind: 'timeout' });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toMatchObject({ only: 'p1', followup_question: 'А почему?' });

    // It did not (chosen_by client): no second long wait in the same answer.
    const short = checkAnswer(askedOnTime, { timeoutMs: followupCheckTimeout('client') }).catch((error) => error);
    await vi.advanceTimersByTimeAsync(CHECK_AFTER_FAILED_CHECK_MS - 10);
    expect(fetchMock.mock.calls[2][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(await short).toMatchObject({ kind: 'timeout' });
  });

  it('takes «не знаю» as the button: every point missing, no request, no model, no units', async () => {
    const points = [
      { id: 'p1', title: 'А', essential: false },
      { id: 'p2', title: 'Б', essential: true },
      { id: 'p3', title: 'В', essential: true },
    ];
    expect(await checkAnswer({ question: 'Вопрос', points, transcript: 'Ну, не знаю…' })).toEqual({
      statuses: { p1: 'missing', p2: 'missing', p3: 'missing' },
      ask: 'p2', // the rule: the first essential point not named
    });
    expect(await checkAnswer({ question: 'Вопрос', points, transcript: 'не помню', only: 'p3' })).toEqual({ statuses: { p3: 'missing' }, ask: null });
    const evaluation = await evaluateAnswer({
      question: 'Вопрос',
      points: points.map((point) => ({ ...point, source_quote: 'цитата' })),
      transcript: 'Я не знаю.',
    });
    expect(evaluation).toEqual({
      points: ['p1', 'p2', 'p3'].map((id) => ({ id, status: 'missing', student_quote: '', comment: '' })),
      errors: [],
      verdict: DONT_KNOW_VERDICT,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // An answer that only starts with «не знаю» is an answer: it goes to the check.
    fetchMock.mockResolvedValueOnce(json(200, { statuses: { p1: 'partial' }, ask: null }));
    await checkAnswer({ question: 'Вопрос', points, transcript: 'Не знаю точно, но это про ключи' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads statuses and ask of the quick check', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { statuses: { p1: 'covered', p2: 'missing', p7: 'wrong', p3: 'great' }, ask: 'p2' }));
    const result = await checkAnswer({
      question: 'Вопрос',
      points: [
        { id: 'p1', title: 'А', essential: true },
        { id: 'p2', title: 'Б', essential: true },
        { id: 'p3', title: 'В', essential: false },
      ],
      transcript: 'ответ',
    });
    expect(result).toEqual({ statuses: { p1: 'covered', p2: 'missing' }, ask: 'p2' });
  });

  it('reads the evaluation: every point once, unknown errors dropped', async () => {
    fetchMock.mockResolvedValueOnce(
      json(200, {
        points: [
          { id: 'p1', status: 'covered', student_quote: 'подбор весов', comment: 'Сказано.' },
          { id: 'p1', status: 'missing' },
          { id: 'p5', status: 'covered' },
        ],
        errors: [
          { point_id: 'p1', student_quote: 'x', correction: 'Как в лекции.' },
          { point_id: 'p9', student_quote: 'y', correction: 'z' },
        ],
        verdict: 'Хороший ответ.',
      }),
    );
    const result = await evaluateAnswer({
      question: 'Вопрос',
      points: [
        { id: 'p1', title: 'А', essential: true, source_quote: 'цитата' },
        { id: 'p2', title: 'Б', essential: false, source_quote: 'цитата' },
      ],
      transcript: 'подбор весов',
    });
    expect(result.points).toEqual([
      { id: 'p1', status: 'covered', student_quote: 'подбор весов', comment: 'Сказано.' },
      { id: 'p2', status: 'unrated', student_quote: '', comment: '' },
    ]);
    expect(result.errors).toEqual([{ point_id: 'p1', student_quote: 'x', correction: 'Как в лекции.' }]);
  });

  it('treats an evaluation with no known point as unusable', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { points: [], errors: [], verdict: '' }));
    const error = await evaluateAnswer({ question: 'В', points: [{ id: 'p1', title: 'А', essential: true, source_quote: '' }], transcript: 'а' }).catch(
      (caught) => caught,
    );
    expect(error).toMatchObject({ kind: 'invalid', message: AI_UNAVAILABLE_MESSAGE });
  });

  it('empties the points of a rubric that says the lectures do not cover the question', () => {
    const parsed = parseRubricResponse({
      ...rubricBody,
      rubric: { ...rubricBody.rubric, coverage: 'none', nearest: [{ source_id: 'M1:S07', material_id: 'mat-1', text: 'Похожее место' }] },
    });
    expect(parsed.rubric.points).toEqual([]);
    expect(parsed.rubric.nearest).toHaveLength(1);
  });
});
