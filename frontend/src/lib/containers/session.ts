/**
 * A «занятие» (package D2; Concept 2 §3.10): which questions, in which order, retries 3–5 questions later (≤ 2),
 * option order per show. Seeded by the session id; no Math.random.
 */
import type { DayPlan } from '../../types/container';

export interface QueueEntry { id: string; retry: 0 | 1 | 2 }

function notBuilt(name: string): never {
  throw new Error(`lib/containers/session.${name}: not built yet (package D2)`);
}

export function prng(_seed: string): () => number { return notBuilt('prng'); }
export function buildSession(_plan: DayPlan, _subjectId: string, _kind: 'answer' | 'self_check' | 'ai_check', _answeredToday: readonly string[], _seed: string): QueueEntry[] { return notBuilt('buildSession'); }
/** The queue after an answer at `pos`: a wrong answer comes back 3–5 positions later, at most twice; a misclick changes nothing. */
export function afterAnswer(_queue: QueueEntry[], _pos: number, _answer: { id: string; correct: boolean; misclick?: boolean }, _seed: string): QueueEntry[] { return notBuilt('afterAnswer'); }
/** Display order of file indices: seeded shuffle; `keepOrder` keeps the file's order; `lastIdx` («Все перечисленные») stay last. */
export function optionOrder(_n: number, _keepOrder: boolean, _lastIdx: readonly number[], _seed: string): number[] { return notBuilt('optionOrder'); }
