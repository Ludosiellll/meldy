import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notifyAIUsageChanged: vi.fn(),
  fetchExamMappingState: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../api/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/limits')>()),
  notifyAIUsageChanged: () => mocks.notifyAIUsageChanged(),
}));
vi.mock('../../api/exams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/exams')>();
  return { ...actual, fetchExamMappingState: (...args: unknown[]) => mocks.fetchExamMappingState(...args) };
});

import { getMapJob, MAPPING_COST, mappingLimitMessage, resetMapJobsForTests, startMapping, subscribeMapJobs } from './mapJobs';
import { AI_COSTS } from '../../lib/plans';

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

function item(id: string, coverage: string, extra: Record<string, unknown> = {}) {
  return { question_id: id, coverage, method: 'llm', reason: '', missing: '', evidence: [], nearest: [], mapped_at: '2026-10-03T10:00:00Z', reused: false, ...extra };
}

const allow = vi.fn(async () => true);

beforeEach(() => {
  resetMapJobsForTests({ pollIntervalMs: 5, pollLimitMs: 2000 });
  mocks.notifyAIUsageChanged.mockReset();
  mocks.fetchExamMappingState.mockReset();
  allow.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startMapping', () => {
  it('collects marks per batch, keeps reused marks still, refreshes the meter once after done with used_ai', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        ev({ type: 'start', questions: 4, to_check: 4, fingerprint: 'fp', materials: [{ id: 'm1', title: 'Денежный рынок', fragments: 112 }], skipped: [] }),
        ev({ type: 'reused', items: [item('q1', 'full', { reused: true }), item('q2', 'none', { method: 'lexical', reused: true })] }),
        ev({ type: 'batch', index: 1, total: 1, items: [item('q3', 'partial'), item('q4', 'full')] }),
        ev({ type: 'done', state: 'done', counts: { full: 2, partial: 1, none: 1, unverified: 0 }, reused: 2, oldest_mapped_at: '2026-10-01T09:40:00Z', mapped_at: '2026-10-01T09:40:00Z', used_ai: true }),
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(startMapping({ examId: 'exam-1', userId: 'user-1', verifyEnergy: allow })).resolves.toBe('started');

    expect(allow).toHaveBeenCalledWith('user-1', 10, 'Сверка с лекциями');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/exams/exam-1/map');
    expect(JSON.parse(String(init.body))).toEqual({ question_ids: null, force: false });

    const job = getMapJob('exam-1');
    expect(job.phase).toBe('done');
    expect(job.items.size).toBe(4);
    expect(job.marks.get('q1')).toEqual({ animate: false, delayMs: 0 });
    expect(job.marks.get('q2')).toEqual({ animate: false, delayMs: 0 });
    expect(job.marks.get('q3')).toEqual({ animate: true, delayMs: 0 });
    expect(job.marks.get('q4')).toEqual({ animate: true, delayMs: 60 });
    expect(job.reusedCount).toBe(2);
    expect(job.done).toMatchObject({ reused: 2, usedAi: true, oldestMappedAt: '2026-10-01T09:40:00Z' });
    expect(job.finishedSeq).toBe(1);
    // The server charged the units before the judge; the browser writes nothing, it only refreshes.
    expect(mocks.notifyAIUsageChanged).toHaveBeenCalledTimes(1);
    expect(MAPPING_COST).toBe(AI_COSTS.examMapping);
  });

  it('charges nothing when the run did not use the model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      sseResponse([
        ev({ type: 'start', questions: 1, to_check: 1, materials: [], skipped: [] }),
        ev({ type: 'reused', items: [item('q1', 'full', { reused: true })] }),
        ev({ type: 'done', state: 'done', counts: { full: 1 }, reused: 1, used_ai: false }),
      ]),
    ));
    await startMapping({ examId: 'exam-1', userId: 'user-1', verifyEnergy: allow });
    expect(getMapJob('exam-1').phase).toBe('done');
    expect(mocks.notifyAIUsageChanged).not.toHaveBeenCalled();
  });

  it('does not start when the daily limit is not enough', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const decline = vi.fn(async () => false);
    await expect(startMapping({ examId: 'exam-1', userId: 'user-1', verifyEnergy: decline })).resolves.toBe('declined');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getMapJob('exam-1')).toMatchObject({ phase: 'idle', starting: false });
  });

  it('reports an interrupted stream with the number of checked questions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      sseResponse([
        ev({ type: 'start', questions: 40, to_check: 36, materials: [], skipped: [] }),
        ev({ type: 'batch', index: 1, total: 4, items: Array.from({ length: 24 }, (_, i) => item(`q${i}`, 'full')) }),
      ]),
    ));
    await startMapping({ examId: 'exam-1', userId: 'user-1', verifyEnergy: allow });
    const job = getMapJob('exam-1');
    expect(job.phase).toBe('interrupted');
    expect(job.message).toBe('Сверка прервалась: проверено 28 из 40.');
    expect(job.finishedSeq).toBe(1);
    expect(mocks.notifyAIUsageChanged).not.toHaveBeenCalled();
  });

  it('waits for another run on 409, polling the exam row until it stops running', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ detail: 'Сверка с лекциями уже идёт' }), { status: 409, headers: { 'content-type': 'application/json' } }),
    ));
    const running = { mapping_state: 'running', mapping_started_at: new Date().toISOString(), mapped_at: null };
    mocks.fetchExamMappingState
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(running)
      .mockResolvedValue({ mapping_state: 'done', mapping_started_at: running.mapping_started_at, mapped_at: new Date().toISOString() });

    const seen: string[] = [];
    const unsubscribe = subscribeMapJobs(() => {
      const job = getMapJob('exam-1');
      seen.push(`${job.phase}:${job.message ?? ''}`);
    });
    await startMapping({ examId: 'exam-1', userId: 'user-1', verifyEnergy: allow });
    unsubscribe();
    expect(seen).toContain('waiting:Сверка ещё идёт');
    expect(mocks.fetchExamMappingState).toHaveBeenCalledWith('exam-1');
    expect(mocks.fetchExamMappingState.mock.calls.length).toBe(3);
    expect(getMapJob('exam-1')).toMatchObject({ phase: 'idle', finishedSeq: 1 });
  });

  it('gives up waiting after the time limit and still asks the sheet to reload', async () => {
    resetMapJobsForTests({ pollIntervalMs: 5, pollLimitMs: 30 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Сверка с лекциями уже идёт' }), { status: 409 })));
    mocks.fetchExamMappingState.mockResolvedValue({ mapping_state: 'running', mapping_started_at: new Date().toISOString(), mapped_at: null });
    await startMapping({ examId: 'exam-1', userId: 'user-1', verifyEnergy: allow });
    expect(getMapJob('exam-1')).toMatchObject({ phase: 'idle', finishedSeq: 1 });
  });

  it('runs once per exam at a time', async () => {
    let release: (() => void) | null = null;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(sseResponse([ev({ type: 'done', state: 'done', counts: {}, reused: 0, used_ai: false })]));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const first = startMapping({ examId: 'exam-1', userId: 'user-1', verifyEnergy: allow });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await expect(startMapping({ examId: 'exam-1', userId: 'user-1', verifyEnergy: allow })).resolves.toBe('busy');
    release!();
    await first;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the server message of an error event and of a refused request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([ev({ type: 'error', message: 'Не удалось записать разметку. Повторите.' })])));
    await startMapping({ examId: 'exam-1', userId: 'user-1', verifyEnergy: allow });
    expect(getMapJob('exam-1')).toMatchObject({ phase: 'failed', message: 'Не удалось записать разметку. Повторите.' });

    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ detail: 'Ни у одной лекции нет текста' }), { status: 422, headers: { 'content-type': 'application/json' } }),
    ));
    await startMapping({ examId: 'exam-2', userId: 'user-1', verifyEnergy: allow });
    expect(getMapJob('exam-2')).toMatchObject({ phase: 'failed', message: 'Ни у одной лекции нет текста' });
  });

  it('a run the daily limit does not cover says what is left and when it renews — in the note, no dialog', async () => {
    const limitEvents: Event[] = [];
    const onLimit = (event: Event) => limitEvents.push(event);
    window.addEventListener('meldy:ai-limit', onLimit);
    vi.stubGlobal('fetch', vi.fn(async () =>
      sseResponse([
        ev({ type: 'start', questions: 80, to_check: 80, materials: [], skipped: [] }),
        ev({ type: 'error', code: 'ai_limit', message: 'Дневной лимит ИИ на сегодня исчерпан.', used: 85, limit: 100, units: 20,
             resets_at: '2026-10-05T00:00:00Z', pro: false }),
      ]),
    ));
    await startMapping({ examId: 'exam-1', userId: 'user-1', verifyEnergy: allow });
    window.removeEventListener('meldy:ai-limit', onLimit);
    const job = getMapJob('exam-1');
    expect(job.phase).toBe('failed');
    expect(job.message).toMatch(/^Не хватает дневного лимита ИИ: сверка этих вопросов расходует 20, а сегодня осталось 15\. Лимит обновится в \d{1,2}:\d{2}\.$/);
    expect(limitEvents).toEqual([]);
    expect(mocks.notifyAIUsageChanged).toHaveBeenCalledTimes(1);
    const resetsAt = new Date('2026-10-05T00:00:00Z');
    expect(mappingLimitMessage({ used: 100, limit: 100, units: 10, resetsAt, pro: false })).toMatch(
      /^Дневной лимит ИИ исчерпан: сверка с лекциями не запущена\. Лимит обновится в \d{1,2}:\d{2}\.$/,
    );
  });

  it('keeps the questions of a failed batch as checked only by words, without animation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      sseResponse([
        ev({ type: 'start', questions: 2, to_check: 2, materials: [], skipped: [] }),
        ev({ type: 'batch_failed', index: 1, total: 1, question_ids: ['q1', 'q2'], items: [item('q1', 'unverified', { method: 'lexical' }), item('q2', 'unverified', { method: 'lexical' })], message: 'Сервис занят — эти вопросы проверены только по словам' }),
        ev({ type: 'done', state: 'partial', counts: { unverified: 2 }, reused: 0, used_ai: true }),
      ]),
    ));
    await startMapping({ examId: 'exam-1', userId: 'user-1', questionIds: ['q1', 'q2'], force: true, verifyEnergy: allow });
    const job = getMapJob('exam-1');
    expect(job.failedIds).toEqual(['q1', 'q2']);
    expect(job.failedMessage).toBe('Сервис занят — эти вопросы проверены только по словам');
    expect(job.marks.get('q1')).toEqual({ animate: false, delayMs: 0 });
    expect(job.items.get('q2')?.coverage).toBe('unverified');
    expect(job.done?.state).toBe('partial');
    expect(job.requested).toEqual(['q1', 'q2']);
  });
});
