import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOAD_FAILED_MESSAGE,
  LOAD_UNAVAILABLE_MESSAGE,
  LearningLoadError,
  LearningSaveError,
  SAVE_FAILED_MESSAGE,
  SAVE_INVALID_MESSAGE,
  SAVE_TOO_LARGE_MESSAGE,
  SAVE_UNAVAILABLE_MESSAGE,
  type QuizAttemptAnswer,
  fetchMaterialEvents,
  fetchQuestionEvents,
  fetchSessionPoints,
  localDate,
  newEventId,
  recordQuizAttempt,
  recordSelfRating,
} from './learning';

const database = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: database }));

const SESSION = 'd0000000-0000-4000-8000-000000000001';
const MATERIAL = '11111111-1111-1111-1111-111111111111';
const HASH = 'eee8c9ac62e0050c8e2065db1ebed8cc';
const EVENT_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const RealDateTimeFormat = Intl.DateTimeFormat;

/** Simulates a browser in `timeZone`: Intl formatters default to it, as the browser zone would. */
function browserTimeZone(timeZone: string) {
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
    this: unknown,
    locales?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ) {
    return new RealDateTimeFormat(locales, { timeZone, ...options });
  } as unknown as typeof Intl.DateTimeFormat);
}

interface Call {
  method: string;
  args: unknown[];
}

type Response = { data: unknown; error: unknown };

/** A chainable PostgREST query double: every call is recorded, range()/upsert() resolve via `respond`. */
function mockQueries(respond: (calls: Call[]) => Response) {
  const queries: Call[][] = [];
  database.from.mockImplementation((table: string) => {
    const calls: Call[] = [{ method: 'from', args: [table] }];
    queries.push(calls);
    const builder: Record<string, (...args: unknown[]) => unknown> = {};
    for (const method of ['select', 'in', 'gte', 'eq', 'order']) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return builder;
      };
    }
    for (const method of ['range', 'upsert']) {
      builder[method] = (...args: unknown[]) => {
        calls.push({ method, args });
        return Promise.resolve(respond(calls));
      };
    }
    return builder;
  });
  return queries;
}

function argsOf(calls: Call[], method: string): unknown[][] {
  return calls.filter((call) => call.method === method).map((call) => call.args);
}

function row(id: string, createdAt: string, itemKey: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    created_at: createdAt,
    local_date: createdAt.slice(0, 10),
    material_id: null,
    kind: 'exam_answer',
    item_key: itemKey,
    correct: true,
    score: 0.89,
    confidence: null,
    source_ids: [],
    session_id: 'e0000000-0000-4000-8000-000000000001',
    payload: { v: 1, grade: 5 },
    ...extra,
  };
}

function quizAnswers(): QuizAttemptAnswer[] {
  return [
    {
      index: 0,
      question: 'Что такое ВВП?',
      chosen: 'A',
      chosenText: 'A) Сумма',
      expected: 'A',
      expectedText: 'A) Сумма',
      correct: true,
      explanation: 'Сумма всех конечных благ',
      sourceIds: ['S01', 'M1:S02', 'bad', 'S01'],
      options: 4,
    },
    {
      index: 1,
      question: 'Что такое инфляция?',
      chosen: null,
      chosenText: '',
      expected: 'C',
      expectedText: 'C) Рост цен',
      correct: null,
      options: 4,
    },
  ];
}

beforeEach(() => {
  database.rpc.mockReset();
  database.from.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('localDate', () => {
  it('is the local day in the browser time zone (Moscow, 22:30 UTC)', () => {
    browserTimeZone('Europe/Moscow');
    expect(localDate(new Date('2026-10-02T22:30:00Z'))).toBe('2026-10-03');
  });

  it('defaults to now', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T22:30:00Z'));
    browserTimeZone('Europe/Moscow');
    expect(localDate()).toBe('2026-10-03');
    browserTimeZone('UTC');
    expect(localDate()).toBe('2026-10-02');
  });
});

describe('newEventId', () => {
  it('uses crypto.randomUUID when the browser has it', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '12345678-1234-4123-8123-123456789abc' });
    expect(newEventId()).toBe('12345678-1234-4123-8123-123456789abc');
  });

  it('builds a version-4 UUID from getRandomValues without crypto.randomUUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 37 + 11) % 256;
        return bytes;
      },
    });
    const id = newEventId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id).toMatch(EVENT_ID);
  });

  it('falls back to time and random base36 without any crypto', () => {
    vi.stubGlobal('crypto', undefined);
    const ids = new Set(Array.from({ length: 50 }, () => newEventId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(EVENT_ID);
  });
});

describe('recordQuizAttempt', () => {
  it('makes one RPC call with snake_case answers and returns the retake flag', async () => {
    database.rpc.mockResolvedValue({
      data: { events: 2, duplicate: false, retake: true, mistakes_added: 0, mistakes_existing: 0 },
      error: null,
    });

    const result = await recordQuizAttempt({
      sessionId: SESSION,
      materialId: MATERIAL,
      retake: false,
      surface: 'material',
      topic: 'Макроэкономика',
      answers: quizAnswers(),
    });

    expect(database.rpc).toHaveBeenCalledTimes(1);
    expect(database.rpc).toHaveBeenCalledWith('record_quiz_attempt', {
      p_attempt: {
        session_id: SESSION,
        material_id: MATERIAL,
        local_date: expect.stringMatching(DAY),
        retake: false,
        surface: 'material',
        topic: 'Макроэкономика',
        answers: [
          {
            index: 0,
            question: 'Что такое ВВП?',
            chosen: 'A',
            chosen_text: 'A) Сумма',
            expected: 'A',
            expected_text: 'A) Сумма',
            correct: true,
            explanation: 'Сумма всех конечных благ',
            source_ids: ['S01'],
            options: 4,
          },
          {
            index: 1,
            question: 'Что такое инфляция?',
            chosen: null,
            chosen_text: '',
            expected: 'C',
            expected_text: 'C) Рост цен',
            correct: null,
            explanation: '',
            source_ids: [],
            options: 4,
          },
        ],
      },
    });
    expect(result).toEqual({ events: 2, duplicate: false, retake: true, mistakesAdded: 0, mistakesExisting: 0 });
  });

  it('sends the local day of the browser and whole-number indexes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T22:30:00Z'));
    browserTimeZone('Europe/Moscow');
    database.rpc.mockResolvedValue({
      data: { events: 1, duplicate: false, retake: false, mistakes_added: 1, mistakes_existing: 0 },
      error: null,
    });

    const [first] = quizAnswers();
    const result = await recordQuizAttempt({
      sessionId: SESSION,
      materialId: 'not-a-uuid',
      retake: false,
      surface: 'analysis',
      topic: 'x'.repeat(300),
      answers: [{ ...first, index: 2.5, correct: false }],
    });

    const attempt = database.rpc.mock.calls[0][1].p_attempt;
    expect(attempt.local_date).toBe('2026-10-03');
    expect(attempt.material_id).toBeNull();
    expect(attempt.topic).toHaveLength(200);
    expect(attempt.answers[0].index).toBe(0);
    expect(Number.isInteger(attempt.answers[0].index)).toBe(true);
    expect(result).toMatchObject({ mistakesAdded: 1, duplicate: false, retake: false });
  });

  it('reports a duplicate resend as such', async () => {
    database.rpc.mockResolvedValue({
      data: { events: 0, duplicate: true, retake: false, mistakes_added: 0, mistakes_existing: 0 },
      error: null,
    });
    const result = await recordQuizAttempt({
      sessionId: SESSION,
      materialId: null,
      retake: false,
      surface: 'analysis',
      topic: '',
      answers: quizAnswers(),
    });
    expect(result).toEqual({ events: 0, duplicate: true, retake: false, mistakesAdded: 0, mistakesExisting: 0 });
  });

  it('rejects a session id that is not a UUID without a request', async () => {
    await expect(
      recordQuizAttempt({ sessionId: 'abc', materialId: null, retake: false, surface: 'analysis', topic: '', answers: quizAnswers() }),
    ).rejects.toBeInstanceOf(LearningSaveError);
    await expect(
      recordQuizAttempt({ sessionId: SESSION, materialId: null, retake: false, surface: 'analysis', topic: '', answers: [] }),
    ).rejects.toThrow(SAVE_INVALID_MESSAGE);
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it('turns database errors into Russian messages without raw text', async () => {
    database.rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'invalid quiz attempt' } });
    const invalid = recordQuizAttempt({ sessionId: SESSION, materialId: null, retake: false, surface: 'analysis', topic: '', answers: quizAnswers() });
    await expect(invalid).rejects.toBeInstanceOf(LearningSaveError);
    await expect(invalid).rejects.toThrow(SAVE_INVALID_MESSAGE);

    database.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.record_quiz_attempt' },
    });
    await expect(
      recordQuizAttempt({ sessionId: SESSION, materialId: null, retake: false, surface: 'analysis', topic: '', answers: quizAnswers() }),
    ).rejects.toThrow(SAVE_UNAVAILABLE_MESSAGE);

    database.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const offline = recordQuizAttempt({ sessionId: SESSION, materialId: null, retake: false, surface: 'analysis', topic: '', answers: quizAnswers() });
    await expect(offline).rejects.toThrow(SAVE_FAILED_MESSAGE);
    await expect(offline).rejects.not.toThrow(/fetch/i);
  });

  it('shortens long explanations to stay under the RPC size limit, never the questions', async () => {
    database.rpc.mockResolvedValue({
      data: { events: 50, duplicate: false, retake: false, mistakes_added: 0, mistakes_existing: 0 },
      error: null,
    });
    const answers = Array.from({ length: 50 }, (_, index) => ({
      ...quizAnswers()[0],
      index,
      question: `Вопрос номер ${index}: ${'длинная формулировка '.repeat(10)}`,
      explanation: 'объяснение '.repeat(100),
    }));
    await recordQuizAttempt({ sessionId: SESSION, materialId: null, retake: false, surface: 'analysis', topic: '', answers });

    const attempt = database.rpc.mock.calls[0][1].p_attempt;
    expect(new TextEncoder().encode(JSON.stringify(attempt)).length).toBeLessThan(60_000);
    expect(attempt.answers[7].question).toBe(answers[7].question);
    expect(attempt.answers[7].explanation.length).toBeLessThanOrEqual(200);
  });

  it('refuses an attempt that cannot fit even without explanations', async () => {
    const answers = Array.from({ length: 50 }, (_, index) => ({
      ...quizAnswers()[0],
      index,
      question: `Вопрос ${index} ${'ж'.repeat(1500)}`,
    }));
    await expect(
      recordQuizAttempt({ sessionId: SESSION, materialId: null, retake: false, surface: 'analysis', topic: '', answers }),
    ).rejects.toThrow(SAVE_TOO_LARGE_MESSAGE);
    expect(database.rpc).not.toHaveBeenCalled();
  });
});

describe('recordSelfRating', () => {
  it.each([
    ['know', 3],
    ['unsure', 2],
    ['dont_know', 1],
  ] as const)('stores «%s» as a self_rating event with confidence %i', async (rating, confidence) => {
    const queries = mockQueries(() => ({ data: null, error: null }));

    await recordSelfRating({ questionHash: HASH.toUpperCase(), rating, examId: 'exam-1', examQuestionId: 'question-1' });

    expect(queries).toHaveLength(1);
    expect(queries[0][0]).toEqual({ method: 'from', args: ['learning_events'] });
    const [[values, options]] = argsOf(queries[0], 'upsert') as [[Record<string, unknown>, Record<string, unknown>]];
    expect(values).toEqual({
      kind: 'self_rating',
      item_key: `q:${HASH}`,
      confidence,
      client_event_id: expect.stringMatching(EVENT_ID),
      local_date: expect.stringMatching(DAY),
      material_id: null,
      payload: { v: 1, exam_id: 'exam-1', exam_question_id: 'question-1' },
    });
    expect(options).toEqual({ onConflict: 'user_id,client_event_id', ignoreDuplicates: true });
  });

  it('gives each tap its own event id', async () => {
    const queries = mockQueries(() => ({ data: null, error: null }));
    await recordSelfRating({ questionHash: HASH, rating: 'know', examId: 'e', examQuestionId: 'q' });
    await recordSelfRating({ questionHash: HASH, rating: 'know', examId: 'e', examQuestionId: 'q' });
    const ids = queries.map((calls) => (argsOf(calls, 'upsert')[0][0] as { client_event_id: string }).client_event_id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('drops a material link the journal refuses and saves the rating anyway', async () => {
    const queries = mockQueries((calls) => {
      const [values] = argsOf(calls, 'upsert')[0] as [{ material_id: string | null }];
      return values.material_id
        ? { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }
        : { data: null, error: null };
    });

    await recordSelfRating({ questionHash: HASH, rating: 'unsure', examId: 'e', examQuestionId: 'q', materialId: MATERIAL });

    expect(queries).toHaveLength(2);
    expect((argsOf(queries[1], 'upsert')[0][0] as { material_id: string | null }).material_id).toBeNull();
  });

  it('rejects a bad hash without a request and maps write errors', async () => {
    await expect(
      recordSelfRating({ questionHash: 'not-a-hash', rating: 'know', examId: 'e', examQuestionId: 'q' }),
    ).rejects.toThrow(SAVE_INVALID_MESSAGE);
    await expect(
      recordSelfRating({ questionHash: HASH, rating: 'toString' as never, examId: 'e', examQuestionId: 'q' }),
    ).rejects.toThrow(SAVE_INVALID_MESSAGE);
    expect(database.from).not.toHaveBeenCalled();

    mockQueries(() => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }));
    const failed = recordSelfRating({ questionHash: HASH, rating: 'know', examId: 'e', examQuestionId: 'q' });
    await expect(failed).rejects.toBeInstanceOf(LearningSaveError);
    await expect(failed).rejects.toThrow(SAVE_FAILED_MESSAGE);
  });
});

describe('fetchQuestionEvents', () => {
  it('reads q:<hash> keys in chunks of 100 and returns events oldest first', async () => {
    const hashes = Array.from({ length: 250 }, (_, i) => i.toString(16).padStart(32, '0'));
    const queries = mockQueries((calls) => {
      const keys = argsOf(calls, 'in').find(([column]) => column === 'item_key')?.[1] as string[];
      // Each chunk answers with one event for its first key; later chunks hold older events.
      const chunk = parseInt(keys[0].slice(2), 16) / 100;
      return { data: [row(`id-${chunk}`, `2026-10-07T10:${30 - chunk * 10}:00+00:00`, keys[0])], error: null };
    });

    const events = await fetchQuestionEvents([...hashes, hashes[0].toUpperCase(), 'junk']);

    expect(queries).toHaveLength(3);
    const keyChunks = queries.map((calls) => argsOf(calls, 'in').find(([column]) => column === 'item_key')?.[1] as string[]);
    expect(keyChunks.map((keys) => keys.length)).toEqual([100, 100, 50]);
    expect(keyChunks[0][0]).toBe(`q:${hashes[0]}`);
    expect(new Set(keyChunks.flat()).size).toBe(250);
    expect(keyChunks.flat().every((key) => /^q:[0-9a-f]{32}$/.test(key))).toBe(true);
    for (const calls of queries) {
      expect(calls[0]).toEqual({ method: 'from', args: ['learning_events'] });
      expect(argsOf(calls, 'in')).toContainEqual(['kind', ['exam_answer', 'self_rating']]);
      expect(argsOf(calls, 'order')[0]).toEqual(['created_at', { ascending: true }]);
      expect(argsOf(calls, 'range')[0]).toEqual([0, 999]);
    }
    expect(events.map((event) => event.id)).toEqual(['id-2', 'id-1', 'id-0']);
    expect(events[0].item_key).toBe(`q:${hashes[200]}`);
  });

  it('asks only for the requested kinds and pages past 1000 rows', async () => {
    const queries = mockQueries((calls) => {
      const [from] = argsOf(calls, 'range')[0] as [number, number];
      const size = from === 0 ? 1000 : 3;
      const data = Array.from({ length: size }, (_, i) =>
        row(`row-${from + i}`, new Date(Date.UTC(2026, 9, 1) + (from + i) * 60_000).toISOString(), `q:${HASH}`),
      );
      return { data, error: null };
    });

    const events = await fetchQuestionEvents([HASH], ['exam_answer']);

    expect(queries).toHaveLength(2);
    expect(argsOf(queries[0], 'in')).toContainEqual(['kind', ['exam_answer']]);
    expect(argsOf(queries[1], 'range')[0]).toEqual([1000, 1999]);
    expect(events).toHaveLength(1003);
  });

  it('normalises rows and returns nothing without valid hashes', async () => {
    mockQueries(() => ({
      data: [row('only', '2026-10-07T10:00:00+00:00', `q:${HASH}`, { payload: null, source_ids: null, confidence: 7, kind: 'self_rating' })],
      error: null,
    }));
    const [event] = await fetchQuestionEvents([HASH]);
    expect(event).toMatchObject({ payload: {}, source_ids: [], confidence: null, kind: 'self_rating' });

    database.from.mockClear();
    expect(await fetchQuestionEvents(['', 'nope'])).toEqual([]);
    expect(await fetchQuestionEvents([HASH], [])).toEqual([]);
    expect(database.from).not.toHaveBeenCalled();
  });

  it('raises LearningLoadError with a Russian message', async () => {
    mockQueries(() => ({ data: null, error: { code: 'PGRST205', message: 'Could not find the table public.learning_events' } }));
    const missing = fetchQuestionEvents([HASH]);
    await expect(missing).rejects.toBeInstanceOf(LearningLoadError);
    await expect(missing).rejects.toThrow(LOAD_UNAVAILABLE_MESSAGE);

    mockQueries(() => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }));
    await expect(fetchQuestionEvents([HASH])).rejects.toThrow(LOAD_FAILED_MESSAGE);
  });
});

describe('fetchMaterialEvents', () => {
  it('filters by kinds, materials and recent days', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
    const queries = mockQueries(() => ({
      data: [
        row('b', '2026-10-20T10:00:00+00:00', `quiz:${MATERIAL}:${HASH}`, { kind: 'quiz_answer', material_id: MATERIAL }),
        row('a', '2026-10-05T10:00:00+00:00', `quiz:${MATERIAL}:${HASH}`, { kind: 'quiz_answer', material_id: MATERIAL }),
      ],
      error: null,
    }));

    const events = await fetchMaterialEvents({ materialIds: [MATERIAL, MATERIAL, 'bad'], kinds: ['quiz_answer'], sinceDays: 30 });

    expect(queries).toHaveLength(1);
    const calls = queries[0];
    expect(argsOf(calls, 'in')).toEqual([
      ['kind', ['quiz_answer']],
      ['material_id', [MATERIAL]],
    ]);
    expect(argsOf(calls, 'gte')).toEqual([['created_at', '2026-10-01T12:00:00.000Z']]);
    expect(events.map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('reads all materials without a list and nothing for an empty list', async () => {
    const queries = mockQueries(() => ({ data: [], error: null }));
    await fetchMaterialEvents({ kinds: ['quiz_answer', 'card_review'] });
    expect(queries).toHaveLength(1);
    expect(argsOf(queries[0], 'in')).toEqual([['kind', ['quiz_answer', 'card_review']]]);
    expect(argsOf(queries[0], 'gte')).toEqual([]);

    database.from.mockClear();
    expect(await fetchMaterialEvents({ materialIds: [], kinds: ['quiz_answer'] })).toEqual([]);
    expect(await fetchMaterialEvents({ kinds: [] })).toEqual([]);
    expect(database.from).not.toHaveBeenCalled();
  });
});

describe('fetchSessionPoints', () => {
  const sessionId = (n: number) => `e0000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

  it('reads the oral_point rows of the given sessions in chunks of 100, oldest first', async () => {
    const ids = Array.from({ length: 230 }, (_, n) => sessionId(n + 1));
    const queries = mockQueries((calls) => {
      const sessions = argsOf(calls, 'in').find(([column]) => column === 'session_id')?.[1] as string[];
      const chunk = ids.indexOf(sessions[0]) / 100;
      // Later chunks hold older rows: the result is sorted across chunks.
      return {
        data: [row(`p-${chunk}`, `2026-10-07T10:${50 - chunk * 10}:00+00:00`, 'oral:r1:p1', { kind: 'oral_point', session_id: sessions[0], payload: { status: 'covered' } })],
        error: null,
      };
    });

    const points = await fetchSessionPoints([...ids, ids[0].toUpperCase(), 'not-a-session', '']);

    expect(queries).toHaveLength(3);
    const chunks = queries.map((calls) => argsOf(calls, 'in').find(([column]) => column === 'session_id')?.[1] as string[]);
    expect(chunks.map((part) => part.length)).toEqual([100, 100, 30]);
    expect(new Set(chunks.flat()).size).toBe(230);
    for (const calls of queries) {
      expect(calls[0]).toEqual({ method: 'from', args: ['learning_events'] });
      expect(argsOf(calls, 'eq')).toEqual([['kind', 'oral_point']]);
      expect(argsOf(calls, 'order')[0]).toEqual(['created_at', { ascending: true }]);
      expect(argsOf(calls, 'range')[0]).toEqual([0, 999]);
    }
    expect(points.map((event) => event.id)).toEqual(['p-2', 'p-1', 'p-0']);
    expect(points[0]).toMatchObject({ kind: 'oral_point', payload: { status: 'covered' } });
  });

  it('asks nothing without a valid session id', async () => {
    expect(await fetchSessionPoints([])).toEqual([]);
    expect(await fetchSessionPoints(['session-1', ''])).toEqual([]);
    expect(database.from).not.toHaveBeenCalled();
  });

  it('raises LearningLoadError with a Russian message', async () => {
    mockQueries(() => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }));
    const failed = fetchSessionPoints([sessionId(1)]);
    await expect(failed).rejects.toBeInstanceOf(LearningLoadError);
    await expect(failed).rejects.toThrow(LOAD_FAILED_MESSAGE);
  });
});
