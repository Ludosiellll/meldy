import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));

import { FIT_MAX_LECTURES, FIT_MAX_QUESTIONS, FIT_QUESTION_CHARS, fetchLectureFit, normalizeLectureFit } from './exams';

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchLectureFit (POST /api/exams/lecture-fit)', () => {
  it('posts the questions and the lectures as JSON within the server caps and reads the answer', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      answer({
        questions: [{ lectures: ['m1'] }, { lectures: [] }, { lectures: ['m1', 'm2'] }],
        lectures: [
          { id: 'm1', questions: [0, 2] },
          { id: 'm2', questions: [2] },
          { id: 'm3', questions: [] },
        ],
        unmatched: [1],
        skipped: [{ id: 'm4', reason: 'no_text' }, { id: 'm5', reason: 'limit' }, { id: 'm6', reason: 'weird' }],
        checked_chars: 1200,
        limit_chars: 3_000_000,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const long = 'Инфляция '.repeat(200);
    const result = await fetchLectureFit({ questions: [long, 'Кривая Филлипса.', 'Инфляция и безработица.'], materialIds: ['m1', 'm2', 'm3'] });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/exams/lecture-fit');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    const sent = JSON.parse(String(init?.body));
    expect(sent.questions[0]).toHaveLength(FIT_QUESTION_CHARS);
    expect(sent.questions.slice(1)).toEqual(['Кривая Филлипса.', 'Инфляция и безработица.']);
    expect(sent.material_ids).toEqual(['m1', 'm2', 'm3']);

    expect(result.questions).toEqual([['m1'], [], ['m1', 'm2']]);
    expect(Array.from(result.lectures.entries())).toEqual([
      ['m1', [0, 2]],
      ['m2', [2]],
      ['m3', []],
    ]);
    expect(result.unmatched).toEqual([1]);
    expect(result.skipped).toEqual([
      { id: 'm4', reason: 'no_text' },
      { id: 'm5', reason: 'limit' },
    ]);
  });

  it('sends at most 300 questions and 500 lectures', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => answer({ questions: [], lectures: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchLectureFit({
      questions: Array.from({ length: 320 }, (_, index) => `Вопрос ${index}`),
      materialIds: Array.from({ length: 520 }, (_, index) => `m${index}`),
    });
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.questions).toHaveLength(FIT_MAX_QUESTIONS);
    expect(sent.material_ids).toHaveLength(FIT_MAX_LECTURES);
    // A short answer leaves the rest of the questions without a lecture, never undefined.
    expect(result.questions).toHaveLength(FIT_MAX_QUESTIONS);
    expect(result.unmatched).toHaveLength(FIT_MAX_QUESTIONS);
  });

  it('keeps the server detail of a refusal and says plainly when there is no connection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer({ detail: 'Сессия истекла. Войдите снова.' }, 401)));
    await expect(fetchLectureFit({ questions: ['Инфляция'], materialIds: ['m1'] })).rejects.toThrow('Сессия истекла. Войдите снова.');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    await expect(fetchLectureFit({ questions: ['Инфляция'], materialIds: ['m1'] })).rejects.toThrow('Нет связи с сервером. Проверьте интернет и повторите.');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    await expect(fetchLectureFit({ questions: ['Инфляция'], materialIds: ['m1'] })).rejects.toThrow('Сервер ответил непонятно. Повторите попытку.');
  });

  it('reads a partial or odd answer without crashing', () => {
    expect(() => normalizeLectureFit({ questions: 'x' }, 1)).toThrow('Сервер ответил непонятно');
    const odd = normalizeLectureFit(
      { questions: [null, { lectures: ['m1', 5, ''] }], lectures: [{ id: 'm1', questions: [1, 7, -1, '0'] }, { questions: [0] }, 'm2'] },
      2,
    );
    expect(odd.questions).toEqual([[], ['m1']]);
    expect(Array.from(odd.lectures.entries())).toEqual([['m1', [1, 0]]]);
    expect(odd.unmatched).toEqual([0]);
    expect(odd.skipped).toEqual([]);
  });
});
