/**
 * The offline answer queue (package D1): per account, first in first out, in localStorage
 * `meldy_test_answers_pending:<userId>`; sent in batches of ≤ 50 in order; guarded by navigator.locks when present.
 * Statuses: QUEUE_DONE → remove; QUEUE_DROP_AND_REPORT → remove + telemetry `container.queue_dropped`;
 * network / 5xx / 401 → keep. Never drops silently.
 */
import type { AnswerInput, AnswerResult } from '../../types/container';

export interface QueueSnapshot { pending: AnswerInput[]; sending: boolean; lastError: string | null }

function notBuilt(name: string): never {
  throw new Error(`lib/containers/answerQueue.${name}: not built yet (package D1)`);
}

/** Adds answers and starts a flush; resolves with the server's results for those that went through now (or [] offline). */
export async function enqueueAnswers(_userId: string, _answers: AnswerInput[]): Promise<AnswerResult[]> { return notBuilt('enqueueAnswers'); }
/** Sends what is pending (on start, `online`, `visibilitychange`). */
export async function flushAnswers(_userId: string): Promise<void> { return notBuilt('flushAnswers'); }
export function pendingAnswers(_userId: string): AnswerInput[] { return notBuilt('pendingAnswers'); }
export function onQueueChange(_userId: string, _listener: (snapshot: QueueSnapshot) => void): () => void { return notBuilt('onQueueChange'); }
