import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ notifyAIUsageChanged: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('./limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./limits')>()),
  notifyAIUsageChanged: () => mocks.notifyAIUsageChanged(),
}));

import {
  fetchSheet,
  getSheetWrite,
  parseSheetResponse,
  resetSheetWritesForTests,
  SHEET_LOAD_MESSAGE,
  startSheetWrite,
  stopSheetWrite,
  subscribeSheetWrites,
} from './cheatSheet';

const EXAM = '11111111-1111-4111-8111-111111111111';
const Q1 = '22222222-2222-4222-8222-222222222222';
const Q2 = '33333333-3333-4333-8333-333333333333';
const RUBRIC = '44444444-4444-4444-8444-444444444444';
const HASH = 'a'.repeat(32);

const enc = new TextEncoder();
const ev = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

function sseResponse(chunks: string[]) {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (index < chunks.length) controller.enqueue(enc.encode(chunks[index++]));
      else controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function rubric(extra: Record<string, unknown> = {}) {
  return {
    rubric_id: RUBRIC,
    built_at: '2026-10-05T10:00:00Z',
    coverage: 'full',
    coverage_note: '',
    materials: [{ key: 'M1', material_id: 'm-1', title: 'Денежный рынок' }],
    points: [
      { id: 'p1', title: 'Мультипликатор — отношение массы к базе', short: 'мультипликатор = масса / база', essential: true, source_quote: '…', source_ids: ['M1:S12'] },
      { id: 'p2', title: 'Зависит от нормы резервов', short: '', essential: false, source_quote: '', source_ids: ['M1:S13', 'junk'] },
    ],
    ...extra,
  };
}

function question(id: string, extra: Record<string, unknown> = {}) {
  return {
    question_id: id,
    position: 1,
    label: '1.',
    section: null,
    text: 'Денежный мультипликатор.',
    question_hash: HASH,
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    rubric: null,
    rebuilt: false,
    ...extra,
  };
}

beforeEach(() => {
  resetSheetWritesForTests();
  mocks.notifyAIUsageChanged.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseSheetResponse', () => {
  it('keeps valid questions and points, drops broken ones, and reads the job', () => {
    const response = parseSheetResponse({
      exam_id: EXAM,
      mapping_state: 'done',
      questions: [
        question(Q1, { rubric: rubric({ points: [...rubric().points, { id: 'p1', title: 'Дубль' }, { id: 'p9', title: 'Не тот id' }, { id: 'p3', title: '  ' }] }) }),
        question('not-a-uuid'),
        question(Q2, { text: '   ' }),
        null,
      ],
      to_write: 3,
      units: '2',
      job: { state: 'stopping', done: 1, total: 4, started_at: '2026-10-06T10:00:00Z' },
    });
    expect(response.questions).toHaveLength(1);
    const [first] = response.questions;
    expect(first.rubric?.points.map((point) => point.id)).toEqual(['p1', 'p2']);
    expect(first.rubric?.points[1].source_ids).toEqual(['M1:S13']);
    expect(first.question_hash).toBe(HASH);
    expect(response.toWrite).toBe(3);
    expect(response.units).toBe(2);
    expect(response.job).toEqual({ state: 'stopping', done: 1, total: 4, startedAt: '2026-10-06T10:00:00Z' });
  });

  it('gives a rubric with coverage none no points, and an unknown job state no job', () => {
    const response = parseSheetResponse({ questions: [question(Q1, { rubric: rubric({ coverage: 'none' }) })], job: { state: 'done' } });
    expect(response.questions[0].rubric?.points).toEqual([]);
    expect(response.job).toBeNull();
  });

  it('reads the questions that cannot be written (their points failed the quote check twice) apart from to_write', () => {
    const response = parseSheetResponse({
      questions: [question(Q1, { unwritable: true }), question(Q2)],
      to_write: 1,
      units: 1,
      unwritable: 1,
    });
    expect(response).toMatchObject({ toWrite: 1, units: 1, unwritable: 1 });
    expect(response.questions.map((item) => item.unwritable)).toEqual([true, false]);
    // An older server says nothing: nothing is unwritable.
    expect(parseSheetResponse({ questions: [question(Q1)] }).unwritable).toBe(0);
  });

  it('refuses a body without questions with the plain message', () => {
    expect(() => parseSheetResponse({ detail: 'oops' })).toThrow(SHEET_LOAD_MESSAGE);
  });
});

describe('fetchSheet', () => {
  it('asks for the exam and parses the answer', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ exam_id: EXAM, questions: [question(Q1)], to_write: 1, units: 1, job: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await fetchSheet(EXAM);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(`/api/oral/sheet?exam_id=${EXAM}`);
    expect(response.questions).toHaveLength(1);
  });

  it('says the plain message on a server error and the server words on a client error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Internal' }), { status: 500 })));
    await expect(fetchSheet(EXAM)).rejects.toThrow(SHEET_LOAD_MESSAGE);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Экзамен не найден.' }), { status: 404, headers: { 'content-type': 'application/json' } })));
    await expect(fetchSheet(EXAM)).rejects.toThrow('Экзамен не найден.');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(fetchSheet(EXAM)).rejects.toThrow(SHEET_LOAD_MESSAGE);
  });
});

describe('startSheetWrite', () => {
  it('follows the stream: progress, questions with their rubrics, done; the meter is refreshed', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        ev({ type: 'progress', done: 0, total: 2 }),
        ev({ type: 'question', question_id: Q1, status: 'written', rubric: rubric(), done: 1, total: 2 }),
        ev({ type: 'question', question_id: Q2, status: 'busy', rubric: null, done: 2, total: 2 }),
        ev({ type: 'done', written: 1, failed: 0, busy: 1, limit: false, units: 1, total: 2, auth: 0, stopped: 0 }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const seen: string[] = [];
    const unsubscribe = subscribeSheetWrites(() => seen.push(getSheetWrite(EXAM).phase));

    const run = startSheetWrite(EXAM, [Q1, Q2]);
    expect(getSheetWrite(EXAM).phase).toBe('running');
    // A second press while it runs sends nothing.
    await startSheetWrite(EXAM);
    await run;
    unsubscribe();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/oral/sheet/write');
    expect(JSON.parse(String(init.body))).toEqual({ exam_id: EXAM, question_ids: [Q1, Q2] });
    const state = getSheetWrite(EXAM);
    expect(state).toMatchObject({ phase: 'done', done: 2, total: 2, written: 1, busy: 1, limit: false, seq: 2, message: null });
    expect(state.results[Q1].status).toBe('written');
    expect(state.results[Q1].rubric?.points).toHaveLength(2);
    expect(state.results[Q2]).toEqual({ status: 'busy', rubric: null });
    expect(seen[0]).toBe('running');
    expect(seen[seen.length - 1]).toBe('done');
    expect(mocks.notifyAIUsageChanged).toHaveBeenCalledTimes(1);
  });

  it('counts the questions the server’s own daily cap left unwritten apart from a busy AI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          ev({ type: 'question', question_id: Q1, status: 'written', rubric: rubric(), done: 1, total: 2 }),
          ev({ type: 'question', question_id: Q2, status: 'capped', rubric: null, done: 2, total: 2 }),
          ev({ type: 'done', written: 1, failed: 0, busy: 0, capped: 1, limit: false, units: 1, total: 2, auth: 0, stopped: 0 }),
        ]),
      ),
    );
    await startSheetWrite(EXAM);
    expect(getSheetWrite(EXAM)).toMatchObject({ phase: 'done', written: 1, busy: 0, capped: 1 });
    expect(getSheetWrite(EXAM).results[Q2].status).toBe('capped');
  });

  it('tells the questions whose points failed the quote check (unverifiable) apart within the failed count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          ev({ type: 'question', question_id: Q1, status: 'unverifiable', rubric: null, done: 1, total: 2 }),
          ev({ type: 'question', question_id: Q2, status: 'failed', rubric: null, done: 2, total: 2 }),
          ev({ type: 'done', written: 0, failed: 2, busy: 0, capped: 0, limit: false, units: 0, total: 2, auth: 0, stopped: 0 }),
        ]),
      ),
    );
    await startSheetWrite(EXAM);
    expect(getSheetWrite(EXAM)).toMatchObject({ phase: 'done', failed: 2, unverifiable: 1 });
  });

  it('is the same object until something changes (an external store for React)', async () => {
    expect(getSheetWrite(EXAM)).toBe(getSheetWrite(EXAM));
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([ev({ type: 'done', written: 0, failed: 0, busy: 0, limit: false, units: 0, total: 0, auth: 0, stopped: 0 })])));
    const before = getSheetWrite(EXAM);
    await startSheetWrite(EXAM);
    expect(getSheetWrite(EXAM)).not.toBe(before);
    expect(getSheetWrite(EXAM)).toBe(getSheetWrite(EXAM));
  });

  it('only follows when asked to: a job that has ended meanwhile goes back to idle, nothing written', async () => {
    const fetchMock = vi.fn(async () => sseResponse([ev({ type: 'done', written: 0, failed: 0, busy: 0, limit: false, units: 0, total: 0, auth: 0, stopped: 0, joined: false })]));
    vi.stubGlobal('fetch', fetchMock);
    await startSheetWrite(EXAM, undefined, { follow: true });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ exam_id: EXAM, follow: true });
    expect(getSheetWrite(EXAM)).toMatchObject({ phase: 'idle', written: 0, message: null, stopping: false });
  });

  it('keeps «stopping» of a joined job that was already told to stop', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await gate;
        return sseResponse([ev({ type: 'done', written: 1, failed: 0, busy: 0, limit: false, units: 1, total: 1, auth: 0, stopped: 2 })]);
      }),
    );
    const run = startSheetWrite(EXAM, undefined, { follow: true, stopping: true });
    expect(getSheetWrite(EXAM)).toMatchObject({ phase: 'running', stopping: true });
    release();
    await run;
    expect(getSheetWrite(EXAM).phase).toBe('done');
  });

  it('ends with the limit when the AI limit runs out mid-run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          ev({ type: 'question', question_id: Q1, status: 'written', rubric: rubric(), done: 1, total: 2 }),
          ev({ type: 'question', question_id: Q2, status: 'limit', rubric: null, done: 2, total: 2 }),
          ev({ type: 'error', code: 'ai_limit', message: 'Лимит ИИ на сегодня кончился.' }),
        ]),
      ),
    );
    await startSheetWrite(EXAM);
    // An older server sends no counts with the limit: they are counted from the questions that arrived.
    expect(getSheetWrite(EXAM)).toMatchObject({ phase: 'done', limit: true, message: null, written: 1, failed: 0, busy: 0, total: 2 });
  });

  it('the limit keeps the counts it carries: the whole run, not only this page’s part of it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          ev({ type: 'question', question_id: Q1, status: 'written', rubric: rubric(), done: 8, total: 12 }),
          ev({ type: 'error', code: 'ai_limit', message: 'Лимит ИИ на сегодня кончился.', written: 7, failed: 1, busy: 0, total: 12, units: 7 }),
        ]),
      ),
    );
    await startSheetWrite(EXAM, undefined, { follow: true });
    expect(getSheetWrite(EXAM)).toMatchObject({ phase: 'done', limit: true, written: 7, failed: 1, busy: 0, total: 12 });
  });

  it('a question written before that only got its short lines («refresh») merges without moving the progress', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          ev({ type: 'progress', done: 0, total: 1 }),
          ev({ type: 'question', question_id: Q2, status: 'written', rubric: rubric(), refresh: true }),
          ev({ type: 'question', question_id: Q1, status: 'written', rubric: rubric(), done: 1, total: 1 }),
          ev({ type: 'done', written: 1, failed: 0, busy: 0, limit: false, units: 1, total: 1, auth: 0, stopped: 0 }),
        ]),
      ),
    );
    const seen: Array<[number, number]> = [];
    const unsubscribe = subscribeSheetWrites(() => {
      const state = getSheetWrite(EXAM);
      seen.push([state.done, state.total]);
    });
    await startSheetWrite(EXAM);
    unsubscribe();
    // Start, progress, the refreshed question (still 0 of 1), the written one, the end.
    expect(seen).toEqual([
      [0, 0],
      [0, 1],
      [0, 1],
      [1, 1],
      [1, 1],
    ]);
    const state = getSheetWrite(EXAM);
    expect(state).toMatchObject({ phase: 'done', written: 1, seq: 2 });
    expect(Object.keys(state.results).sort()).toEqual([Q1, Q2].sort());
  });

  it('says why when the mapping holds the exam, and when the connection drops', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Идёт сверка.' }), { status: 409, headers: { 'content-type': 'application/json' } })));
    await startSheetWrite(EXAM);
    expect(getSheetWrite(EXAM).phase).toBe('failed');
    expect(getSheetWrite(EXAM).message).toBe('Сейчас идёт сверка списка с лекциями. Шпаргалку можно будет написать, когда сверка закончится.');

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await startSheetWrite(EXAM);
    expect(getSheetWrite(EXAM).phase).toBe('interrupted');
    expect(getSheetWrite(EXAM).message).toMatch(/дописывается на сервере/);

    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([ev({ type: 'progress', done: 0, total: 3 })])));
    await startSheetWrite(EXAM);
    expect(getSheetWrite(EXAM).phase).toBe('interrupted');
  });
});

describe('stopSheetWrite', () => {
  it('asks the server and says how many questions are still running', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ stopped: true, running: 2 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(stopSheetWrite(EXAM)).resolves.toBe(2);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ exam_id: EXAM });
    expect(getSheetWrite(EXAM).stopping).toBe(true);
  });

  it('takes «stopping» back when the request failed, so the button comes back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    await expect(stopSheetWrite(EXAM)).resolves.toBe(0);
    expect(getSheetWrite(EXAM).stopping).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(stopSheetWrite(EXAM)).resolves.toBe(0);
    expect(getSheetWrite(EXAM).stopping).toBe(false);
  });
});
