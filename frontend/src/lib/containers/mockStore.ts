/**
 * «Как на экзамене» in progress on the device (package D1; spec decision 36): the chosen answers, the order and the
 * clock survive a closed tab; the finished run is sent through the queue (`container_mock_finish`, idempotent).
 *
 * localStorage `meldy_mock_progress:<userId>` holds one run in progress per exam of that account. Storage can be
 * missing or full: then a run lives as long as the page (nothing here throws). The finished run goes into the answer
 * queue (lib/containers/answerQueue.ts), which keeps it until the server took it, and its progress is cleared.
 */
import type { MockRunInput, MockRunResult, Uuid } from '../../types/container';
import { enqueueMockRun } from './answerQueue';

export interface MockProgress {
  runId: string;
  containerId: Uuid;
  subjectIds: Uuid[];
  itemIds: Uuid[];
  answers: Record<string, number[] | string | null>; // item id → chosen (file indices) or text; null = unanswered
  marked: string[]; // «вернусь» marks
  startedAt: number;
  timeLimitS: number | null;
}

export const MOCK_KEY_PREFIX = 'meldy_mock_progress:';
const STORAGE_VERSION = 1;

type Runs = Record<string, MockProgress>;

/** What this page keeps when storage refuses (per account). */
const memory = new Map<string, Runs>();

function key(userId: string): string {
  return MOCK_KEY_PREFIX + userId;
}

function isProgress(value: unknown): value is MockProgress {
  const progress = value as Partial<MockProgress> | null;
  return Boolean(
    progress &&
      typeof progress === 'object' &&
      typeof progress.runId === 'string' &&
      typeof progress.containerId === 'string' &&
      Array.isArray(progress.itemIds) &&
      Array.isArray(progress.subjectIds) &&
      progress.answers &&
      typeof progress.answers === 'object' &&
      !Array.isArray(progress.answers) &&
      Array.isArray(progress.marked) &&
      typeof progress.startedAt === 'number' &&
      (progress.timeLimitS === null || typeof progress.timeLimitS === 'number'),
  );
}

function read(userId: string): Runs {
  try {
    const raw = window.localStorage.getItem(key(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as { v?: unknown; runs?: unknown };
      if (parsed && parsed.v === STORAGE_VERSION && parsed.runs && typeof parsed.runs === 'object') {
        const runs: Runs = {};
        for (const [containerId, progress] of Object.entries(parsed.runs as Record<string, unknown>)) {
          if (isProgress(progress) && progress.containerId === containerId) runs[containerId] = progress;
        }
        return runs;
      }
    }
  } catch {
    // Unreadable: what this page kept.
  }
  return { ...(memory.get(userId) ?? {}) };
}

function write(userId: string, runs: Runs): void {
  memory.set(userId, runs);
  try {
    if (Object.keys(runs).length === 0) window.localStorage.removeItem(key(userId));
    else window.localStorage.setItem(key(userId), JSON.stringify({ v: STORAGE_VERSION, runs }));
  } catch {
    // Full or blocked: kept in memory for this page.
  }
}

export function saveMock(userId: string, progress: MockProgress): void {
  if (!userId || !isProgress(progress)) return;
  write(userId, { ...read(userId), [progress.containerId]: progress });
}

export function loadMock(userId: string, containerId: Uuid): MockProgress | null {
  if (!userId || !containerId) return null;
  return read(userId)[containerId] ?? null;
}

export function clearMock(userId: string, containerId: Uuid): void {
  if (!userId || !containerId) return;
  const runs = read(userId);
  if (!(containerId in runs)) return;
  delete runs[containerId];
  write(userId, runs);
}

/**
 * Sends the finished run (queued while offline); resolves when the server took it, or null if it waits for network.
 * Once the run is in the queue its progress is cleared (when it is the same run), so a reload never offers to go on
 * with a run that is already finished.
 */
export async function submitMock(userId: string, run: MockRunInput): Promise<MockRunResult | null> {
  return enqueueMockRun(userId, run, () => {
    const progress = loadMock(userId, run.container_id);
    if (progress && progress.runId === run.client_run_id) clearMock(userId, run.container_id);
  });
}

/** For tests: forget what this page kept in memory. */
export function resetMockStoreForTests(): void {
  memory.clear();
}
