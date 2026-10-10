import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerInput, AnswerStatus, MockRunInput } from '../../types/container';

const mocks = vi.hoisted(() => ({
  recordAnswers: vi.fn(),
  finishMock: vi.fn(),
  getSession: vi.fn(),
  track: vi.fn(),
}));

vi.mock('../supabase', () => ({ supabase: { auth: { getSession: mocks.getSession } } }));
vi.mock('../telemetry', () => ({ track: mocks.track }));
vi.mock('../../api/containers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/containers')>();
  return { ...actual, recordAnswers: mocks.recordAnswers, finishMock: mocks.finishMock };
});

import { CONTAINER_ERROR_TEXT, ContainerApiError } from '../../api/containers';
import {
  DROP_EVENT,
  MOCK_QUEUE_KEY_PREFIX,
  QUEUE_KEY_PREFIX,
  QUEUE_LOCK,
  SEND_TIMEOUT_MS,
  enqueueAnswers,
  enqueueMockRun,
  flushAnswers,
  onQueueChange,
  pendingAnswers,
  resetAnswerQueueForTests,
} from './answerQueue';

const A = 'user-a';
const B = 'user-b';
const C1 = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';

function answer(n: number, item = `item-${n}`): AnswerInput {
  return { client_event_id: `sess-0001:${n}`, item_id: item, chosen: 0, local_date: '2026-12-21', ms: 9000, cls: 'new_floor' };
}

function signedIn(userId: string | null) {
  mocks.getSession.mockResolvedValue({ data: { session: userId ? { user: { id: userId } } : null } });
}

/** The server answers every element with the status `statusFor` gives it. */
function serverSays(statusFor: (answer: AnswerInput, index: number) => AnswerStatus) {
  mocks.recordAnswers.mockImplementation(async (answers: AnswerInput[]) => ({
    v: 1,
    server_day: '2026-12-21',
    results: answers.map((item, index) => ({ client_event_id: item.client_event_id, item_id: item.item_id, status: statusFor(item, index) })),
  }));
}

const networkDown = () => new ContainerApiError('network', CONTAINER_ERROR_TEXT.network, { status: 0 });

/** What a call sent: the client_event_ids of its answers. */
const sentIds = () => mocks.recordAnswers.mock.calls.map(([answers]) => (answers as AnswerInput[]).map((item) => item.client_event_id));

/** The stored list exactly as the queue keeps it (the key is part of the contract: Concept 3 §5.2). */
function seed(userId: string, answers: AnswerInput[], from = 1) {
  window.localStorage.setItem(QUEUE_KEY_PREFIX + userId, JSON.stringify({ v: 1, items: answers.map((a, index) => ({ a, at: from + index })) }));
}

const stored = (userId: string) => JSON.parse(window.localStorage.getItem(QUEUE_KEY_PREFIX + userId) ?? '{"items":[]}').items as Array<{ a: AnswerInput }>;

beforeEach(() => {
  resetAnswerQueueForTests();
  window.localStorage.clear();
  signedIn(A);
  serverSays(() => 'saved');
  mocks.finishMock.mockResolvedValue({ run_id: 'run-id', items: 2, correct: 1, unanswered: 0, duplicate: false });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'locks');
});

describe('statuses', () => {
  it('removes saved, late and duplicate answers without a report, and gives their results back', async () => {
    const statuses: AnswerStatus[] = ['saved', 'late', 'duplicate'];
    serverSays((_item, index) => statuses[index]);
    const results = await enqueueAnswers(A, [answer(1), answer(2), answer(3)]);
    expect(results.map((result) => result.status)).toEqual(statuses);
    expect(pendingAnswers(A)).toEqual([]);
    expect(window.localStorage.getItem(QUEUE_KEY_PREFIX + A)).toBeNull();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('removes gone, no_key, invalid, conflict and stale, and reports each status with its count', async () => {
    const statuses: AnswerStatus[] = ['gone', 'gone', 'no_key', 'invalid', 'conflict', 'stale', 'saved'];
    serverSays((_item, index) => statuses[index]);
    const results = await enqueueAnswers(A, statuses.map((_status, index) => answer(index + 1)));
    expect(results).toHaveLength(7);
    expect(pendingAnswers(A)).toEqual([]);
    expect(mocks.track.mock.calls).toEqual([
      [DROP_EVENT, { status: 'gone', count: 2 }],
      [DROP_EVENT, { status: 'no_key', count: 1 }],
      [DROP_EVENT, { status: 'invalid', count: 1 }],
      [DROP_EVENT, { status: 'conflict', count: 1 }],
      [DROP_EVENT, { status: 'stale', count: 1 }],
    ]);
  });

  it.each([
    ['no network', networkDown()],
    ['a server failure (5xx)', new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown, { status: 503 })],
    ['a signed-out session (401)', new ContainerApiError('28000', CONTAINER_ERROR_TEXT['28000'], { status: 401 })],
    ['a database without the function', new ContainerApiError('unavailable', CONTAINER_ERROR_TEXT.unavailable, { status: 404 })],
    ['too many requests (429)', new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown, { status: 429 })],
    ['something thrown that is not ours', new Error('boom')],
    ['an unexplained 4xx (a proxy, a gateway)', new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown, { status: 404 })],
    ['a body too large for a gateway (413)', new ContainerApiError('unknown', CONTAINER_ERROR_TEXT.unknown, { status: 413 })],
  ])('keeps every answer on %s, reports nothing and says why', async (_name, error) => {
    mocks.recordAnswers.mockRejectedValue(error);
    const listener = vi.fn();
    onQueueChange(A, listener);
    const results = await enqueueAnswers(A, [answer(1), answer(2)]);
    expect(results).toEqual([]);
    expect(pendingAnswers(A).map((item) => item.client_event_id)).toEqual(['sess-0001:1', 'sess-0001:2']);
    expect(stored(A)).toHaveLength(2);
    expect(mocks.track).not.toHaveBeenCalled();
    const last = listener.mock.calls[listener.mock.calls.length - 1][0];
    expect(last).toMatchObject({ sending: false });
    expect(last.lastError).toMatch(/[А-Яа-я]/);
    expect(last.pending).toHaveLength(2);
  });

  it('never drops silently: an answer that got no result stays, and the flush stops instead of looping', async () => {
    mocks.recordAnswers.mockResolvedValue({ v: 1, server_day: '2026-12-21', results: [] });
    await enqueueAnswers(A, [answer(1)]);
    expect(mocks.recordAnswers).toHaveBeenCalledTimes(1);
    expect(pendingAnswers(A)).toHaveLength(1);
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('a call refused as malformed is tried answer by answer: only the refused answer goes, and it is reported', async () => {
    mocks.recordAnswers.mockImplementation(async (answers: AnswerInput[]) => {
      if (answers.some((item) => item.item_id === 'bad')) {
        throw new ContainerApiError('22023', CONTAINER_ERROR_TEXT['22023'], { status: 400 });
      }
      return { v: 1, server_day: '2026-12-21', results: answers.map((item) => ({ client_event_id: item.client_event_id, status: 'saved' })) };
    });
    await enqueueAnswers(A, [answer(1), answer(2, 'bad'), answer(3)]);
    expect(sentIds()).toEqual([['sess-0001:1', 'sess-0001:2', 'sess-0001:3'], ['sess-0001:1'], ['sess-0001:2'], ['sess-0001:3']]);
    expect(pendingAnswers(A)).toEqual([]);
    expect(mocks.track.mock.calls).toEqual([[DROP_EVENT, { status: 'invalid', count: 1, code: '22023' }]]);
  });

  it('a request that hangs is given up after the timeout and kept', async () => {
    vi.useFakeTimers();
    mocks.recordAnswers.mockImplementation(
      (_answers: AnswerInput[], options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(networkDown()))),
    );
    const sent = enqueueAnswers(A, [answer(1)]);
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(await sent).toEqual([]);
    expect(pendingAnswers(A)).toHaveLength(1);
  });
});

describe('order and batches', () => {
  it('sends first in, first out, in calls of at most 50', async () => {
    const answers = Array.from({ length: 120 }, (_unused, index) => answer(index + 1));
    seed(A, answers);
    await flushAnswers(A);
    expect(sentIds().map((ids) => ids.length)).toEqual([50, 50, 20]);
    expect(sentIds().flat()).toEqual(answers.map((item) => item.client_event_id));
    expect(pendingAnswers(A)).toEqual([]);
  });

  it('an answer queued while a flush runs goes in the same flush, after the ones before it', async () => {
    seed(A, [answer(1)]);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    mocks.recordAnswers.mockImplementation(async (answers: AnswerInput[]) => {
      if (first) {
        first = false;
        await held;
      }
      return { v: 1, server_day: '2026-12-21', results: answers.map((item) => ({ client_event_id: item.client_event_id, status: 'saved' })) };
    });
    const flushing = flushAnswers(A);
    await vi.waitFor(() => expect(mocks.recordAnswers).toHaveBeenCalledTimes(1));
    const later = enqueueAnswers(A, [answer(2)]);
    release();
    await flushing;
    expect(await later).toEqual([expect.objectContaining({ client_event_id: 'sess-0001:2', status: 'saved' })]);
    expect(sentIds()).toEqual([['sess-0001:1'], ['sess-0001:2']]);
  });
});

describe('per account', () => {
  it('keeps each account’s answers under its own key and sends only the signed-in account’s', async () => {
    seed(A, [answer(1)]);
    seed(B, [answer(2), answer(3)]);
    expect(pendingAnswers(A).map((item) => item.client_event_id)).toEqual(['sess-0001:1']);
    expect(pendingAnswers(B).map((item) => item.client_event_id)).toEqual(['sess-0001:2', 'sess-0001:3']);
    await flushAnswers(B);
    expect(mocks.recordAnswers).not.toHaveBeenCalled();
    expect(stored(B)).toHaveLength(2);
    await flushAnswers(A);
    expect(sentIds()).toEqual([['sess-0001:1']]);
    expect(pendingAnswers(A)).toEqual([]);
    expect(pendingAnswers(B)).toHaveLength(2);
  });

  it('signed out, nothing is sent and nothing is lost', async () => {
    signedIn(null);
    expect(await enqueueAnswers(A, [answer(1)])).toEqual([]);
    expect(mocks.recordAnswers).not.toHaveBeenCalled();
    expect(pendingAnswers(A)).toHaveLength(1);
    expect(pendingAnswers('')).toEqual([]);
  });
});

describe('locks and other tabs', () => {
  it('sends under navigator.locks «meldy-test-queue» when the browser has it', async () => {
    const names: string[] = [];
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request: vi.fn(async (name: string, work: () => Promise<unknown>) => { names.push(name); return work(); }) },
    });
    await enqueueAnswers(A, [answer(1)]);
    expect(QUEUE_LOCK).toBe('meldy-test-queue');
    expect(names).toContain('meldy-test-queue');
    // Keeping the answer takes its own short lock: a tab never waits behind another tab's request to store it.
    expect(names[0]).not.toBe('meldy-test-queue');
    expect(pendingAnswers(A)).toEqual([]);
  });

  it('an answer survives another tab rewriting the list from an older copy, and is sent from this tab', async () => {
    mocks.recordAnswers.mockRejectedValue(networkDown());
    await enqueueAnswers(A, [answer(1)]);
    window.localStorage.setItem(QUEUE_KEY_PREFIX + A, JSON.stringify({ v: 1, items: [] }));
    expect(pendingAnswers(A).map((item) => item.client_event_id)).toEqual(['sess-0001:1']);
    serverSays(() => 'saved');
    await flushAnswers(A);
    expect(sentIds()[1]).toEqual(['sess-0001:1']);
    expect(pendingAnswers(A)).toEqual([]);
  });

  it('blocked storage still queues for the life of the page', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    mocks.recordAnswers.mockRejectedValue(networkDown());
    await enqueueAnswers(A, [answer(1)]);
    expect(pendingAnswers(A)).toHaveLength(1);
    setItem.mockRestore();
    serverSays(() => 'saved');
    await flushAnswers(A);
    expect(pendingAnswers(A)).toEqual([]);
  });
});

describe('flushing on its own', () => {
  it('sends when the network comes back and when the tab comes back into sight', async () => {
    mocks.recordAnswers.mockRejectedValue(networkDown());
    await enqueueAnswers(A, [answer(1)]);
    serverSays(() => 'saved');
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(pendingAnswers(A)).toEqual([]));

    mocks.recordAnswers.mockRejectedValue(networkDown());
    await enqueueAnswers(A, [answer(2)]);
    serverSays(() => 'saved');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(pendingAnswers(A)).toEqual([]));
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('tells its listeners what is pending and whether it is sending', async () => {
    const snapshots: Array<{ pending: number; sending: boolean }> = [];
    const stop = onQueueChange(A, (snapshot) => snapshots.push({ pending: snapshot.pending.length, sending: snapshot.sending }));
    await enqueueAnswers(A, [answer(1)]);
    expect(snapshots[0]).toEqual({ pending: 1, sending: false });
    expect(snapshots).toContainEqual({ pending: 1, sending: true });
    expect(snapshots[snapshots.length - 1]).toEqual({ pending: 0, sending: false });
    stop();
    const count = snapshots.length;
    await enqueueAnswers(A, [answer(2)]);
    expect(snapshots).toHaveLength(count);
  });
});

describe('«Как на экзамене» runs', () => {
  const run = (n: number): MockRunInput => ({
    client_run_id: `run-000${n}`,
    container_id: C1,
    local_date: '2026-12-20',
    duration_s: 1200,
    answers: [
      { client_event_id: `run-000${n}:01`, item_id: 'item-m1', chosen: 1 },
      { client_event_id: `run-000${n}:02`, item_id: 'item-m2', chosen: null },
    ],
  });

  it('go in the order they were finished among the answers', async () => {
    mocks.recordAnswers.mockRejectedValue(networkDown());
    mocks.finishMock.mockRejectedValue(networkDown());
    await enqueueAnswers(A, [answer(1)]);
    expect(await enqueueMockRun(A, run(1))).toBeNull();
    await enqueueAnswers(A, [answer(2)]);
    const order: string[] = [];
    mocks.recordAnswers.mockImplementation(async (answers: AnswerInput[]) => {
      order.push(`answers ${answers.map((item) => item.client_event_id).join(',')}`);
      return { v: 1, server_day: '2026-12-21', results: answers.map((item) => ({ client_event_id: item.client_event_id, status: 'saved' })) };
    });
    mocks.finishMock.mockImplementation(async (sent: MockRunInput) => {
      order.push(`run ${sent.client_run_id}`);
      return { run_id: 'r', items: 2, correct: 1, unanswered: 1, duplicate: false };
    });
    await flushAnswers(A);
    expect(order).toEqual(['answers sess-0001:1', 'run run-0001', 'answers sess-0001:2']);
    expect(pendingAnswers(A)).toEqual([]);
  });

  it('count among the pending answers while they wait, as mock answers of their day', async () => {
    mocks.finishMock.mockRejectedValue(networkDown());
    await enqueueMockRun(A, run(1));
    expect(pendingAnswers(A)).toEqual([
      expect.objectContaining({ client_event_id: 'run-0001:01', item_id: 'item-m1', mode: 'mock', local_date: '2026-12-20' }),
      expect.objectContaining({ client_event_id: 'run-0001:02', mode: 'mock', local_date: '2026-12-20' }),
    ]);
    expect(window.localStorage.getItem(MOCK_QUEUE_KEY_PREFIX + A)).toContain('run-0001');
  });

  it('a run the server took comes back; one it refuses for good goes and is reported', async () => {
    expect(await enqueueMockRun(A, run(1))).toMatchObject({ run_id: 'run-id' });
    mocks.finishMock.mockRejectedValue(new ContainerApiError('P0002', CONTAINER_ERROR_TEXT.P0002, { status: 500 }));
    expect(await enqueueMockRun(A, run(2))).toBeNull();
    expect(pendingAnswers(A)).toEqual([]);
    expect(mocks.track.mock.calls).toEqual([[DROP_EVENT, { status: 'P0002', count: 1, kind: 'mock' }]]);
  });

  it('a run that could never be taken is refused before it is queued', async () => {
    await expect(enqueueMockRun(A, { ...run(1), answers: [] })).rejects.toMatchObject({ code: '22023' });
    expect(pendingAnswers(A)).toEqual([]);
  });
});
