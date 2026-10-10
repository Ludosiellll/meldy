/**
 * A stand-in for lib/containers/session.ts in tests: deterministic on purpose — a session keeps the plan's order, the
 * options keep the file's order (so a test knows which letter is which), a wrong answer comes back exactly three
 * questions later, at most twice; a misclick changes nothing.
 */
import type { DayPlan } from '../../../types/container';

export interface QueueEntry { id: string; retry: 0 | 1 | 2 }

export function prng(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  let a = h;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSession(plan: DayPlan, subjectId: string, kind: 'answer' | 'self_check' | 'ai_check', answeredToday: readonly string[], _seed: string): QueueEntry[] {
  const done = new Set(answeredToday);
  const ids: string[] = [];
  for (const session of plan.sessions) {
    if (session.subjectId !== subjectId || session.kind !== kind) continue;
    for (const id of session.ids) if (!done.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids.slice(0, kind === 'self_check' ? 10 : kind === 'ai_check' ? 3 : 20).map((id) => ({ id, retry: 0 as const }));
}

export function afterAnswer(queue: QueueEntry[], pos: number, answer: { id: string; correct: boolean; misclick?: boolean }, _seed: string): QueueEntry[] {
  const out = queue.slice();
  const entry = queue[pos];
  if (!entry || entry.id !== answer.id || answer.correct || answer.misclick || entry.retry >= 2) return out;
  out.splice(Math.min(pos + 4, out.length), 0, { id: answer.id, retry: (entry.retry + 1) as 1 | 2 });
  return out;
}

export function optionOrder(n: number, _keepOrder: boolean, _lastIdx: readonly number[], _seed: string): number[] {
  return Array.from({ length: n }, (_, i) => i);
}
