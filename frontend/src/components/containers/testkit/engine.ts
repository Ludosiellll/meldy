/**
 * The study engine (package D2) in the screens' tests: the real modules, with the day's plan taken from the fixture
 * (planDay returns the plan a fixture attached to its input) and the session made predictable — the plan's order, the
 * file's order of options, a retry exactly three questions later (at most twice), a topic or error block in the
 * file's order — so a test knows which question and which letter come next. Everything else (words, figureChange,
 * counter, pinnedLast, extraNew, subjectInfo, daysAhead, freeSession's choice) is D2's own.
 *
 *   vi.mock('…/lib/containers/plan', async (original) => (await import('…/testkit/engine')).planModule(original));
 *   vi.mock('…/lib/containers/session', async (original) => (await import('…/testkit/engine')).sessionModule(original));
 */
import type { DayPlan, PlanInput } from '../../../types/container';

type PlanModule = typeof import('../../../lib/containers/plan');
type SessionModule = typeof import('../../../lib/containers/session');
type QueueEntry = { id: string; retry: 0 | 1 | 2 };

export async function planModule(original: () => Promise<unknown>): Promise<PlanModule> {
  const real = (await original()) as PlanModule;
  return {
    ...real,
    planDay: (input: PlanInput) => (input as PlanInput & { __plan?: DayPlan }).__plan ?? real.planDay(input),
  };
}

export async function sessionModule(original: () => Promise<unknown>): Promise<SessionModule> {
  const real = (await original()) as SessionModule;
  return {
    ...real,
    buildSession: (plan: DayPlan, subjectId: string, kind: 'answer' | 'self_check' | 'ai_check', answeredToday: readonly string[]) => {
      const done = new Set(answeredToday);
      const ids: string[] = [];
      for (const session of plan.sessions) {
        if (session.subjectId !== subjectId || session.kind !== kind) continue;
        for (const id of session.ids) if (!done.has(id) && !ids.includes(id)) ids.push(id);
      }
      return ids.slice(0, kind === 'self_check' ? 10 : kind === 'ai_check' ? 3 : 20).map((id) => ({ id, retry: 0 as const }));
    },
    afterAnswer: (queue: QueueEntry[], pos: number, answer: { id: string; correct: boolean; misclick?: boolean }) => {
      const out = queue.slice();
      const entry = queue[pos];
      if (!entry || entry.id !== answer.id || answer.correct || answer.misclick || entry.retry >= 2) return out;
      out.splice(Math.min(pos + 4, out.length), 0, { id: answer.id, retry: (entry.retry + 1) as 1 | 2 });
      return out;
    },
    optionOrder: (n: number) => Array.from({ length: Math.max(0, n) }, (_, i) => i),
    shuffled: <T,>(items: readonly T[]) => items.slice(),
    freeSession: (input, options, answeredToday, seed) => {
      const order = new Map((input.items ?? []).map((item) => [item.id, item.o]));
      return real.freeSession(input, options, answeredToday, seed).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },
  };
}
