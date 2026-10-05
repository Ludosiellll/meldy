import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const limits = vi.hoisted(() => ({ notified: 0 }));
vi.mock('./limits', () => ({ notifyAIUsageChanged: () => (limits.notified += 1) }));

import {
  TUTOR_BUSY_MESSAGE,
  TUTOR_LIMIT_MESSAGE,
  TUTOR_LOAD_FAILED_MESSAGE,
  TUTOR_NO_CARDS_MESSAGE,
  TUTOR_OFFLINE_MESSAGE,
  TutorApiError,
  parseTutorTurn,
  startTutor,
  tutorTurn,
  type TutorTurnBody,
} from './tutor';

const MATERIAL = '0f8c3c1e-5d2a-4a3b-9c1d-2e3f4a5b6c7d';
const originalFetch = window.fetch;
let calls: Array<{ url: string; body: unknown }> = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function answerWith(response: Response | (() => Promise<Response>)) {
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    return typeof response === 'function' ? response() : response;
  }) as typeof window.fetch;
}

async function failure(promise: Promise<unknown>): Promise<TutorApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(TutorApiError);
    return error as TutorApiError;
  }
  throw new Error('expected a failure');
}

const TURN: TutorTurnBody = {
  material_id: MATERIAL,
  kind: 'answer',
  target_id: 'c2',
  rung: 1,
  utterance: 'кредиты дорожают',
  history: [{ role: 'tutor', text: 'Зачем ЦБ повышает ключевую ставку?' }],
};

beforeEach(() => {
  calls = [];
  limits.notified = 0;
});

afterEach(() => {
  window.fetch = originalFetch;
  vi.useRealTimers();
});

describe('startTutor', () => {
  it('posts the lecture and returns its cards with their fragments', async () => {
    answerWith(
      json(200, {
        title: 'Макроэкономика',
        targets: [
          { id: 'c3', question: 'Что такое инфляция?', fragments: [{ source_id: 'S02', text: 'Инфляция — это устойчивый рост цен.' }] },
          { id: 'c2', question: 'Зачем ЦБ повышает ставку?', fragments: [] },
          { id: 'bad id', question: 'пропадёт' },
          { id: 'c3', question: 'повтор пропадёт' },
          { id: 'c9', question: '   ' },
        ],
      }),
    );
    const session = await startTutor(MATERIAL);
    expect(calls).toEqual([{ url: '/api/tutor/session', body: { material_id: MATERIAL } }]);
    expect(session).toEqual({
      title: 'Макроэкономика',
      targets: [
        { id: 'c3', question: 'Что такое инфляция?', fragments: [{ source_id: 'S02', text: 'Инфляция — это устойчивый рост цен.' }] },
        { id: 'c2', question: 'Зачем ЦБ повышает ставку?', fragments: [] },
      ],
    });
    expect(limits.notified).toBe(0);
  });

  it.each([
    [409, 'Сначала разберите лекцию: репетитор спрашивает по её карточкам.'],
    [422, 'У этой лекции нет текста — разговаривать не по чему. Добавьте её текстом: PDF, DOCX, TXT или MD.'],
    [404, 'Лекция не найдена.'],
  ])('%i shows the server’s own words', async (status, detail) => {
    answerWith(json(status, { detail }));
    const error = await failure(startTutor(MATERIAL));
    expect(error).toMatchObject({ kind: 'http', status, message: detail });
  });

  it('a busy server reads «не удалось начать», a 200 without cards like the server’s 409', async () => {
    answerWith(json(503, { detail: 'Не удалось прочитать лекцию. Повторите через минуту.' }));
    expect(await failure(startTutor(MATERIAL))).toMatchObject({ kind: 'busy', message: TUTOR_LOAD_FAILED_MESSAGE });
    answerWith(json(200, { title: 'Пусто', targets: [] }));
    expect(await failure(startTutor(MATERIAL))).toMatchObject({ kind: 'http', message: TUTOR_NO_CARDS_MESSAGE });
  });
});

describe('tutorTurn', () => {
  it('posts the turn and returns the move; the meter is refreshed', async () => {
    answerWith(
      json(200, {
        move: 'quote',
        say: 'Вот как сказано в лекции. Скажите своими словами.',
        quote: { source_id: 'S03', text: 'кредиты дорожают, спрос снижается' },
        nearest: null,
        status: 'partial',
        intent: 'answer',
        done: false,
        rung: 2,
        assisted: true,
      }),
    );
    const response = await tutorTurn(TURN);
    expect(calls).toEqual([{ url: '/api/tutor/turn', body: TURN }]);
    expect(response).toEqual({
      move: 'quote',
      say: 'Вот как сказано в лекции. Скажите своими словами.',
      quote: { source_id: 'S03', text: 'кредиты дорожают, спрос снижается' },
      nearest: null,
      status: 'partial',
      intent: 'answer',
      done: false,
      rung: 2,
      assisted: true,
    });
    expect(limits.notified).toBe(1);
  });

  it('the daily limit (429 ai_limit) says so and that the words are kept', async () => {
    answerWith(json(429, { detail: 'Дневной лимит ИИ на сегодня исчерпан.', code: 'ai_limit', used: 100, limit: 100 }));
    const error = await failure(tutorTurn(TURN));
    expect(error).toMatchObject({ kind: 'limit', status: 429, code: 'ai_limit', message: TUTOR_LIMIT_MESSAGE });
    expect(TUTOR_LIMIT_MESSAGE).toBe('Дневной лимит ИИ на сегодня исчерпан. Сказанное сохранено.');
    expect(limits.notified).toBe(0);
  });

  it.each([
    [429, { detail: 'Сервис ИИ сейчас занят.', code: 'ai_busy' }],
    [429, { detail: 'Слишком много запросов: подождите минуту.' }],
    [502, { detail: 'ИИ-сервис сейчас не ответил.', code: 'ai_failed' }],
    [503, { detail: 'Репетитор сейчас выключен.' }],
    [504, { detail: 'ИИ-сервис не ответил вовремя.', code: 'ai_timeout' }],
  ])('%i reads «Сервис ИИ занят»', async (status, body) => {
    answerWith(json(status, body));
    const error = await failure(tutorTurn(TURN));
    expect(error).toMatchObject({ kind: 'busy', status, message: TUTOR_BUSY_MESSAGE });
    expect(TUTOR_BUSY_MESSAGE).toBe('Сервис ИИ занят. Подождите минуту — ответ сохранён.');
  });

  it.each([
    [409, 'Этой карточки в лекции больше нет. Начните разговор заново.'],
    [413, 'Реплика слишком длинная: можно до 1500 знаков.'],
    [400, 'Скажите или напишите хоть что-нибудь.'],
  ])('%i keeps the server’s words', async (status, detail) => {
    answerWith(json(status, { detail }));
    expect(await failure(tutorTurn(TURN))).toMatchObject({ kind: 'http', status, message: detail });
  });

  it('no connection at all reads «Нет интернета»', async () => {
    answerWith(() => Promise.reject(new TypeError('Failed to fetch')));
    const error = await failure(tutorTurn(TURN));
    expect(error).toMatchObject({ kind: 'offline', message: TUTOR_OFFLINE_MESSAGE });
    expect(TUTOR_OFFLINE_MESSAGE).toBe('Нет интернета. Разговор на паузе, сказанное сохранено.');
  });

  it('no answer within the deadline is a busy service', async () => {
    vi.useFakeTimers();
    window.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    ) as typeof window.fetch;
    const pending = failure(tutorTurn(TURN, { timeoutMs: 20_000 }));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await pending).toMatchObject({ kind: 'busy', message: TUTOR_BUSY_MESSAGE });
  });

  it('the room moving on aborts the request quietly', async () => {
    window.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    ) as typeof window.fetch;
    const controller = new AbortController();
    const pending = failure(tutorTurn(TURN, { signal: controller.signal }));
    controller.abort();
    expect(await pending).toMatchObject({ kind: 'aborted' });
  });

  it('a body that is not the tutor’s answer is a busy service', async () => {
    answerWith(json(200, { move: 'praise', say: 'Отлично!' }));
    expect(await failure(tutorTurn(TURN))).toMatchObject({ kind: 'busy' });
    answerWith(new Response('<html>proxy</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await failure(tutorTurn(TURN))).toMatchObject({ kind: 'busy' });
  });
});

describe('parseTutorTurn', () => {
  it('keeps only what the screen can use', () => {
    expect(
      parseTutorTurn({
        move: 'not_in_lecture',
        say: '  В лекции   об этом не сказано. ',
        quote: { source_id: 'nope', text: 'x' },
        nearest: { source_id: 'S04', text: 'Безработица бывает фрикционной.' },
        status: null,
        intent: 'question',
        done: 'yes',
        rung: 7,
        assisted: 1,
      }),
    ).toEqual({
      move: 'not_in_lecture',
      say: 'В лекции об этом не сказано.',
      quote: null,
      nearest: { source_id: 'S04', text: 'Безработица бывает фрикционной.' },
      status: null,
      intent: 'question',
      done: false,
      rung: 0,
      assisted: false,
    });
  });
});
