/**
 * «Как на экзамене» in progress on the device (package D1; spec decision 36): the chosen answers, the order and the
 * clock survive a closed tab; the finished run is sent through the queue (`container_mock_finish`, idempotent).
 */
import type { MockRunInput, Uuid } from '../../types/container';

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

function notBuilt(name: string): never {
  throw new Error(`lib/containers/mockStore.${name}: not built yet (package D1)`);
}

export function saveMock(_userId: string, _progress: MockProgress): void { return notBuilt('saveMock'); }
export function loadMock(_userId: string, _containerId: Uuid): MockProgress | null { return notBuilt('loadMock'); }
export function clearMock(_userId: string, _containerId: Uuid): void { return notBuilt('clearMock'); }
/** Sends the finished run (queued while offline); resolves when the server took it, or null if it waits for network. */
export async function submitMock(_userId: string, _run: MockRunInput): Promise<import('../../types/container').MockRunResult | null> { return notBuilt('submitMock'); }
