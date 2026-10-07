import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetchSheet: vi.fn(),
  fetchSheetEvents: vi.fn(),
  recordSheetPeek: vi.fn(),
  flushSheetPeeks: vi.fn(),
  track: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../../lib/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/telemetry')>()),
  track: (...args: unknown[]) => mocks.track(...args),
}));
vi.mock('../../../api/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/limits')>()),
  notifyAIUsageChanged: () => undefined,
}));
vi.mock('../../../api/learning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/learning')>()),
  fetchSheetEvents: (...args: unknown[]) => mocks.fetchSheetEvents(...args),
  recordSheetPeek: (...args: unknown[]) => mocks.recordSheetPeek(...args),
  flushSheetPeeks: () => mocks.flushSheetPeeks(),
}));
vi.mock('../../../api/cheatSheet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/cheatSheet')>()),
  fetchSheet: (...args: unknown[]) => mocks.fetchSheet(...args),
}));

import { getSheetWrite, resetSheetWritesForTests, startSheetWrite, type SheetResponse } from '../../../api/cheatSheet';
import type { SheetQuestion, SheetRubric } from '../../../lib/exams/cheatSheet';
import { useCheatSheet } from './useCheatSheet';

const EXAM = 'exam-1';
const enc = new TextEncoder();
const ev = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

/** An SSE body whose chunks are let through one by one. */
function gatedSse() {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (queue.length === 0 && !closed) await new Promise<void>((resolve) => (wake = resolve));
      if (queue.length > 0) controller.enqueue(enc.encode(queue.shift() as string));
      else controller.close();
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    send(data: unknown) {
      queue.push(ev(data));
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
  };
}

function rubric(id: string, titles: string[]): SheetRubric {
  return {
    rubric_id: id,
    built_at: '2026-10-05T10:00:00Z',
    coverage: 'full',
    coverage_note: '',
    materials: [],
    points: titles.map((title, index) => ({ id: `p${index + 1}`, title, short: '', essential: index === 0, source_quote: '', source_ids: [] })),
  };
}

function question(id: string, position: number, extra: Partial<SheetQuestion> = {}): SheetQuestion {
  return {
    question_id: id,
    position,
    label: '',
    section: null,
    text: `Вопрос ${position}`,
    question_hash: String(position).repeat(32).slice(0, 32),
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    rubric: null,
    rebuilt: false,
    ...extra,
  };
}

function response(questions: SheetQuestion[], extra: Partial<SheetResponse> = {}): SheetResponse {
  const toWrite = questions.filter((item) => !item.rubric).length;
  return { examId: EXAM, mappingState: 'done', questions, toWrite, units: toWrite, job: null, ...extra };
}

beforeEach(() => {
  resetSheetWritesForTests();
  mocks.fetchSheet.mockReset();
  mocks.fetchSheetEvents.mockReset().mockResolvedValue([]);
  mocks.recordSheetPeek.mockReset().mockResolvedValue(undefined);
  mocks.flushSheetPeeks.mockReset().mockResolvedValue(0);
  mocks.track.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useCheatSheet', () => {
  it('reads the sheet and the journal of its written questions', async () => {
    const written = question('q1', 1, { rubric: rubric('r1', ['Первый пункт', 'Второй пункт']) });
    mocks.fetchSheet.mockResolvedValue(response([written, question('q2', 2)]));
    const { result } = renderHook(() => useCheatSheet(EXAM));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() => expect(result.current.eventsState).toBe('ready'));
    expect(mocks.fetchSheetEvents).toHaveBeenLastCalledWith([written.question_hash]);
    expect(result.current.written).toBe(1);
    expect(result.current.toWrite).toBe(1);
    expect(result.current.sheet.counts.total).toBe(2);
    expect(result.current.freshIds.size).toBe(0);
  });

  it('writes in a question that arrives from the writer, once; a question written before is not', async () => {
    mocks.fetchSheet.mockResolvedValue(response([question('q1', 1), question('q2', 2, { rubric: rubric('r2', ['Старый пункт']) })]));
    const stream = gatedSse();
    vi.stubGlobal('fetch', vi.fn(async () => stream.response));
    const { result } = renderHook(() => useCheatSheet(EXAM));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.startWrite());
    await waitFor(() => expect(result.current.write.phase).toBe('running'));
    expect(mocks.track).toHaveBeenCalledWith('sheet_write_started', { questions: '1-2', units: '1-2' });

    await act(async () => {
      stream.send({ type: 'question', question_id: '11111111-1111-4111-8111-111111111111', status: 'written', rubric: null, done: 1, total: 2 });
      stream.send({ type: 'question', question_id: 'q1', status: 'written', rubric: { ...rubric('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ['Новый пункт']) }, done: 1, total: 2 });
    });
    await waitFor(() => expect(result.current.questions[0].rubric?.points).toHaveLength(1));
    expect([...result.current.freshIds]).toEqual(['q1']);

    // The same rubric again with its short lines: merged, but not written in a second time.
    act(() => result.current.settleFresh(['q1']));
    expect(result.current.freshIds.size).toBe(0);
    await act(async () => {
      const again = rubric('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ['Новый пункт']);
      again.points[0].short = 'новый пункт';
      stream.send({ type: 'question', question_id: 'q1', status: 'cached', rubric: again, done: 2, total: 2 });
    });
    await waitFor(() => expect(result.current.questions[0].rubric?.points[0].short).toBe('новый пункт'));
    expect(result.current.freshIds.size).toBe(0);

    // The run ends: the sheet is read again.
    const reads = mocks.fetchSheet.mock.calls.length;
    await act(async () => {
      stream.send({ type: 'done', written: 1, failed: 0, busy: 0, limit: false, units: 1, total: 1, auth: 0, stopped: 0 });
      stream.close();
    });
    await waitFor(() => expect(result.current.write.phase).toBe('done'));
    await waitFor(() => expect(mocks.fetchSheet.mock.calls.length).toBe(reads + 1));
    expect(mocks.track).toHaveBeenCalledWith('sheet_write_done', expect.objectContaining({ written: '1-2', phase: 'done' }));
  });

  it('follows a job the server reports, without starting one', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(ev({ type: 'done', written: 0, failed: 0, busy: 0, limit: false, units: 0, total: 0, auth: 0, stopped: 0, joined: false }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    mocks.fetchSheet
      .mockResolvedValueOnce(response([question('q1', 1)], { job: { state: 'stopping', done: 1, total: 3, startedAt: null } }))
      .mockResolvedValue(response([question('q1', 1)]));
    const { result } = renderHook(() => useCheatSheet(EXAM));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ exam_id: EXAM, follow: true });
    // The job had ended: back to idle, the sheet read again, and no «done» reported for a run nobody made.
    await waitFor(() => expect(mocks.fetchSheet).toHaveBeenCalledTimes(2));
    expect(result.current.write.phase).toBe('idle');
    expect(mocks.track).not.toHaveBeenCalledWith('sheet_write_done', expect.anything());
  });

  it('follows a job once: a follow refused at once is not repeated by the read after it; a new job is followed', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: 'Слишком часто.' }), { status: 429, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const job = { state: 'running' as const, done: 1, total: 3, startedAt: '2026-10-06T09:00:00Z' };
    mocks.fetchSheet.mockResolvedValue(response([question('q1', 1)], { job }));
    const { result } = renderHook(() => useCheatSheet(EXAM));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // The refused follow ends the run; its end reads the sheet again, and the server still reports the job.
    await waitFor(() => expect(mocks.fetchSheet).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.write.phase).toBe('failed');
    // Another start of a job (another tab pressed «Написать»): that one is followed.
    mocks.fetchSheet.mockResolvedValue(response([question('q1', 1)], { job: { ...job, startedAt: '2026-10-06T09:05:00Z' } }));
    act(() => result.current.reload());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('waits for the journal: a failed read says so, and «Повторить» reads the journal again though the questions stay', async () => {
    mocks.fetchSheet.mockResolvedValue(response([question('q1', 1, { rubric: rubric('ffffffff-ffff-4fff-8fff-ffffffffffff', ['Пункт']) })]));
    mocks.fetchSheetEvents.mockRejectedValueOnce(new Error('Не удалось загрузить ответы.')).mockResolvedValue([]);
    const { result } = renderHook(() => useCheatSheet(EXAM));
    await waitFor(() => expect(result.current.eventsState).toBe('error'));
    // Until the journal is read the lines' states are unknown: the page must not draw them in full ink.
    expect(result.current.journalRead).toBe(false);
    expect(result.current.eventsError).toBe('Не удалось загрузить ответы.');
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.eventsState).toBe('ready'));
    expect(result.current.journalRead).toBe(true);
    expect(mocks.fetchSheetEvents).toHaveBeenCalledTimes(2);
  });

  it('merges a question that arrived while the sheet was being read', async () => {
    let resolveRead: (value: SheetResponse) => void = () => undefined;
    mocks.fetchSheet.mockReturnValueOnce(new Promise<SheetResponse>((resolve) => (resolveRead = resolve)));
    const stream = gatedSse();
    vi.stubGlobal('fetch', vi.fn(async () => stream.response));
    void startSheetWrite(EXAM);
    const { result } = renderHook(() => useCheatSheet(EXAM));
    await act(async () => {
      stream.send({ type: 'question', question_id: 'q1', status: 'written', rubric: rubric('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ['Пункт']), done: 1, total: 1 });
    });
    await waitFor(() => expect(getSheetWrite(EXAM).seq).toBe(1));
    await act(async () => resolveRead(response([question('q1', 1)])));
    await waitFor(() => expect(result.current.questions[0]?.rubric?.rubric_id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
    expect([...result.current.freshIds]).toEqual(['q1']);
    stream.close();
  });

  it('shows a peek at once and writes it to the journal; one not saved is sent once more, and the page says so if it still is not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.fetchSheet.mockResolvedValue(response([question('q1', 1, { rubric: rubric('cccccccc-cccc-4ccc-8ccc-cccccccccccc', ['Пункт']) })]));
    mocks.recordSheetPeek.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useCheatSheet(EXAM));
    await waitFor(() => expect(result.current.eventsState).toBe('ready'));
    // Peeks left from an earlier visit are sent when the sheet opens.
    expect(mocks.flushSheetPeeks).toHaveBeenCalledTimes(1);
    const line = result.current.sheet.blocks[0].lines[0];

    mocks.flushSheetPeeks.mockResolvedValueOnce(1);
    act(() => result.current.peek(line));
    const local = result.current.events.filter((event) => event.kind === 'sheet_peek');
    expect(local).toHaveLength(1);
    expect(local[0].item_key).toBe(`peek:${line.rubricId}:${line.pointId}`);
    expect(mocks.track).toHaveBeenCalledWith('sheet_peek', { state: line.status.state });
    expect(mocks.recordSheetPeek).toHaveBeenCalledTimes(1);
    expect(result.current.peekSaveFailed).toBe(false);
    // Not saved: it waits on the device and is sent once more in a moment; still not saved, the page says so.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(mocks.flushSheetPeeks).toHaveBeenCalledTimes(2);
    expect(result.current.peekSaveFailed).toBe(true);
    // «Повторить»: saved now.
    act(() => result.current.retryPeeks());
    await waitFor(() => expect(result.current.peekSaveFailed).toBe(false));
    expect(mocks.flushSheetPeeks).toHaveBeenCalledTimes(3);
  });

  it('keeps a peek that the next read of the journal does not have yet', async () => {
    mocks.fetchSheet.mockResolvedValue(response([question('q1', 1, { rubric: rubric('dddddddd-dddd-4ddd-8ddd-dddddddddddd', ['Пункт']) }), question('q2', 2)]));
    const { result } = renderHook(() => useCheatSheet(EXAM));
    await waitFor(() => expect(result.current.eventsState).toBe('ready'));
    act(() => result.current.peek(result.current.sheet.blocks[0].lines[0]));
    // A new question gets its lines: the journal is read again, without the peek in it yet.
    const stream = gatedSse();
    vi.stubGlobal('fetch', vi.fn(async () => stream.response));
    act(() => result.current.startWrite());
    await act(async () => {
      stream.send({ type: 'question', question_id: 'q2', status: 'written', rubric: rubric('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', ['Другой пункт']), done: 1, total: 1 });
    });
    await waitFor(() => expect(mocks.fetchSheetEvents.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(result.current.eventsState).toBe('ready'));
    expect(result.current.events.filter((event) => event.kind === 'sheet_peek')).toHaveLength(1);
    stream.close();
  });
});
