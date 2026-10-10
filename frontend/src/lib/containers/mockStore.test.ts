import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockRunInput } from '../../types/container';

const mocks = vi.hoisted(() => ({ finishMock: vi.fn(), recordAnswers: vi.fn(), getSession: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { auth: { getSession: mocks.getSession } } }));
vi.mock('../telemetry', () => ({ track: vi.fn() }));
vi.mock('../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/containers')>()),
  finishMock: mocks.finishMock,
  recordAnswers: mocks.recordAnswers,
}));

import { CONTAINER_ERROR_TEXT, ContainerApiError } from '../../api/containers';
import { MOCK_QUEUE_KEY_PREFIX, pendingAnswers, resetAnswerQueueForTests } from './answerQueue';
import { MOCK_KEY_PREFIX, clearMock, loadMock, resetMockStoreForTests, saveMock, submitMock, type MockProgress } from './mockStore';

const A = 'user-a';
const B = 'user-b';
const C1 = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';
const C2 = '0b6f3c2e-9a1d-4e7b-8c5a-2d4e6f8a0b1c';

function progress(containerId = C1, runId = 'run-0001'): MockProgress {
  return {
    runId,
    containerId,
    subjectIds: ['69ead689-38d6-4350-bc5d-13d273f8b9b2'],
    itemIds: ['item-1', 'item-2', 'item-3'],
    answers: { 'item-1': [0], 'item-2': 'Париж', 'item-3': null },
    marked: ['item-2'],
    startedAt: Date.parse('2026-12-21T10:00:00Z'),
    timeLimitS: 2400,
  };
}

function run(runId = 'run-0001', containerId = C1): MockRunInput {
  return {
    client_run_id: runId,
    container_id: containerId,
    local_date: '2026-12-21',
    time_limit_s: 2400,
    duration_s: 1880,
    answers: [
      { client_event_id: `${runId}:01`, item_id: 'item-1', chosen: [0] },
      { client_event_id: `${runId}:02`, item_id: 'item-2', text: 'Париж' },
      { client_event_id: `${runId}:03`, item_id: 'item-3', chosen: null },
    ],
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetMockStoreForTests();
  resetAnswerQueueForTests();
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: A } } } });
  mocks.finishMock.mockReset().mockResolvedValue({ run_id: 'srv-run', items: 3, correct: 2, unanswered: 1, duplicate: false });
});

describe('a run in progress', () => {
  it('survives a closed tab: kept per account and exam', () => {
    expect(loadMock(A, C1)).toBeNull();
    saveMock(A, progress());
    saveMock(A, progress(C2, 'run-0002'));
    expect(loadMock(A, C1)).toEqual(progress());
    expect(loadMock(A, C2)?.runId).toBe('run-0002');
    expect(loadMock(B, C1)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(MOCK_KEY_PREFIX + A)!).runs[C1].answers).toEqual(progress().answers);
    clearMock(A, C1);
    expect(loadMock(A, C1)).toBeNull();
    expect(loadMock(A, C2)).not.toBeNull();
  });

  it('a later save replaces the run of the same exam', () => {
    saveMock(A, progress());
    saveMock(A, { ...progress(), answers: { 'item-1': [1] } });
    expect(loadMock(A, C1)?.answers).toEqual({ 'item-1': [1] });
  });

  it('ignores what is not a run, and what storage holds broken', () => {
    saveMock(A, { ...progress(), itemIds: 'nope' } as unknown as MockProgress);
    expect(loadMock(A, C1)).toBeNull();
    saveMock('', progress());
    expect(loadMock('', C1)).toBeNull();
    window.localStorage.setItem(MOCK_KEY_PREFIX + A, '{broken');
    expect(loadMock(A, C1)).toBeNull();
    window.localStorage.setItem(MOCK_KEY_PREFIX + A, JSON.stringify({ v: 1, runs: { [C1]: { ...progress(), containerId: C2 } } }));
    expect(loadMock(A, C1)).toBeNull();
  });

  it('with storage blocked, a run lives as long as the page', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    saveMock(A, progress());
    expect(loadMock(A, C1)).toEqual(progress());
    spy.mockRestore();
    get.mockRestore();
  });
});

describe('submitMock', () => {
  it('sends the finished run, gives the server’s result and clears the run from the device', async () => {
    saveMock(A, progress());
    const result = await submitMock(A, run());
    expect(result).toEqual({ run_id: 'srv-run', items: 3, correct: 2, unanswered: 1, duplicate: false });
    expect(mocks.finishMock).toHaveBeenCalledWith(run(), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(loadMock(A, C1)).toBeNull();
    expect(pendingAnswers(A)).toEqual([]);
  });

  it('without network the run waits in the queue (nothing lost), and its progress is cleared all the same', async () => {
    saveMock(A, progress());
    saveMock(A, progress(C2, 'run-0002'));
    mocks.finishMock.mockRejectedValue(new ContainerApiError('network', CONTAINER_ERROR_TEXT.network, { status: 0 }));
    expect(await submitMock(A, run())).toBeNull();
    expect(loadMock(A, C1)).toBeNull();
    expect(loadMock(A, C2)?.runId).toBe('run-0002');
    expect(window.localStorage.getItem(MOCK_QUEUE_KEY_PREFIX + A)).toContain('run-0001');
    expect(pendingAnswers(A).map((answer) => answer.client_event_id)).toEqual(['run-0001:01', 'run-0001:02', 'run-0001:03']);
    // Sent again later: the same client_run_id, a no-op on the server if it had arrived.
    mocks.finishMock.mockResolvedValue({ run_id: 'srv-run', items: 3, correct: 2, unanswered: 1, duplicate: true });
    expect(await submitMock(A, run())).toMatchObject({ duplicate: true });
    expect(pendingAnswers(A)).toEqual([]);
  });

  it('keeps the progress of another run of the same exam', async () => {
    saveMock(A, progress(C1, 'run-0009'));
    await submitMock(A, run('run-0001'));
    expect(loadMock(A, C1)?.runId).toBe('run-0009');
  });
});
