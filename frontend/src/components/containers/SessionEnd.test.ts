import { describe, expect, it } from 'vitest';
import type { DayPlan, PlanInput } from '../../types/container';
import { leftNumbers } from './SessionEnd';
import { planCount } from './model';
import { planDay } from '../../lib/containers/plan';
import { emptyState } from '../../lib/containers/rule';
import { buildSession, freeSession, prng } from '../../lib/containers/session';
import { shownMinutes } from '../../lib/containers/words';
import { at, testItems } from '../../lib/containers/__fixtures__/scenarios';
import { classOf, inputAt, newServer, record } from '../../lib/containers/__fixtures__/server';
import { sqlStep } from '../../lib/containers/__fixtures__/sqlRule';

/**
 * What the end of a session says is left today, against what the exam page says right after it (usability check
 * 2026-10-11, D2 and N1): once the plan is read again after the session, the page's own numbers; read late, the plan as
 * the session ended less the session's answers — then as many questions or more, as many minutes or more, never fewer
 * (going from the end screen to the page nothing goes up). Students of every pace, sessions of every length and the
 * odd free session, the plan read as plan_inputs gives it (lib/containers/__fixtures__/server.ts).
 */

const TODAY = '2026-10-11';
const YESTERDAY = '2026-10-10';

/** A student's seconds per answer in a session (by its number in the day) and share of right answers. */
interface Pace { name: string; ms: (round: number) => [number, number]; right: number }
const PACES: Pace[] = [
  { name: 'fast', ms: () => [2_000, 6_000], right: 0.9 },
  { name: 'steady', ms: () => [8_000, 25_000], right: 0.75 },
  { name: 'slow', ms: () => [40_000, 150_000], right: 0.6 },
  // Slow and quick by turns: a quick session on a day the real minutes have already cut.
  { name: 'uneven', ms: (round) => (round % 2 ? [1_000, 4_000] : [60_000, 170_000]), right: 0.7 },
];

function day(seed: string, pace: Pace, budgetMin: number) {
  const rand = prng(seed);
  const subjects = [{ id: 'sa', date: '2026-10-30' }, { id: 'sb', date: '2026-11-06' }];
  const items = [...testItems('sa', 160, 20, 9), ...testItems('sb', 140, 20, 0)];
  const server = newServer({ subjects, items, budgetMin, firstPlanDay: '2026-10-05' });
  // Yesterday: mistakes, and series begun at five-minute marks in the evening, which count today from the afternoon.
  for (const entry of items) {
    const r = rand();
    if (r < 0.08) server.states.set(entry.id, sqlStep(emptyState(), { at: at(YESTERDAY, '11:00'), day: YESTERDAY, correct: false }, null).state);
    else if (r < 0.16) {
      const minute = 17 * 60 + 5 * Math.floor(rand() * 48);
      const hhmm = `${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, '0')}`;
      server.states.set(entry.id, sqlStep(emptyState(), { at: at(YESTERDAY, hhmm), day: YESTERDAY, correct: true }, null).state);
    }
  }
  // The first session well before the first of them can count (13:00): the plan as it ended is the day's start.
  let clock = at(TODAY, '09:00') + Math.floor(rand() * 90 * 60_000);
  const ms = (round: number) => {
    const [low, high] = pace.ms(round);
    return low + Math.floor(rand() * (high - low));
  };
  return { rand, server, now: () => clock, tick: (by: number) => (clock += by), ms };
}

interface Check { plan: DayPlan; input: PlanInput; answered: Set<string>; after: DayPlan; afterInput: PlanInput }

/** A student's day: sessions until the plan offers nothing now; each with the plans before and after it. */
function study(seed: string, pace: Pace, budgetMin: number): Check[] {
  const d = day(seed, pace, budgetMin);
  const checks: Check[] = [];
  for (let round = 0; round < 40; round += 1) {
    const input = inputAt(d.server, d.now());
    const plan = planDay(input);
    const done = input.items.filter((entry) => entry.u?.lastDay === TODAY).map((entry) => entry.id);
    let queue: string[];
    if (round % 5 === 4) {
      // Now and then a topic of its own («Начать 20 вопросов по теме»): answers outside the plan.
      queue = freeSession(input, { subjectId: round % 2 ? 'sa' : 'sb', topic: 1 + (round % 3) }, done, `${seed}:${round}`).map((entry) => entry.id);
    } else {
      const next = plan.sessions[0];
      if (!next) break;
      queue = buildSession(plan, next.subjectId, next.kind, done, `${seed}:${round}`).map((entry) => entry.id);
    }
    if (queue.length === 0) break;
    // «Закончить» anywhere: 1 to all of the session.
    const take = 1 + Math.floor(d.rand() * queue.length);
    const answered = new Set<string>();
    for (const id of queue.slice(0, take)) {
      const took = d.ms(round);
      record(d.server, id, { at: d.tick(took), correct: d.rand() < pace.right, ms: took, cls: classOf(d.server.states.get(id), plan.window.inWindow) });
      answered.add(id);
    }
    d.tick(15_000 + Math.floor(d.rand() * 40 * 60_000));
    const afterInput = inputAt(d.server, d.now());
    checks.push({ plan, input, answered, after: planDay(afterInput), afterInput });
  }
  return checks;
}

const page = (plan: DayPlan) => ({ count: planCount(plan), minutes: shownMinutes(plan.counts.leftSec) });

describe('what the end screen says is left today, against the exam page right after (D2, N1)', () => {
  const days = PACES.flatMap((pace) => [30, 45, 60, 90].flatMap((budget) => ['α', 'β'].map((s) => ({ pace, budget, seed: `${pace.name}:${budget}:${s}` }))));

  it('the plan read after the session: exactly the page’s count and minutes', () => {
    let sessions = 0;
    for (const { pace, budget, seed } of days) {
      for (const c of study(seed, pace, budget)) {
        expect(leftNumbers(c.after, c.afterInput, c.answered, true), seed).toEqual(page(c.after));
        sessions += 1;
      }
    }
    expect(sessions).toBeGreaterThan(200);
  });

  it('read late, the plan as the session ended less its answers: never fewer questions, never fewer minutes than the page', () => {
    /** The day as the real minutes cut it: spent beyond the plan's estimates, fewer questions fit than were planned. */
    const cut = (plan: DayPlan, budget: number) => plan.counts.doneSec > 0 && plan.counts.leftSec >= budget * 60 - plan.counts.doneSec;
    const seen = { sessions: 0, exact: 0, cut: 0, free: 0 };
    for (const { pace, budget, seed } of days) {
      for (const c of study(seed, pace, budget)) {
        const end = leftNumbers(c.plan, c.input, c.answered, false);
        const then = page(c.after);
        expect(end.count, `${seed}: questions`).toBeGreaterThanOrEqual(then.count);
        expect(end.minutes, `${seed}: minutes`).toBeGreaterThanOrEqual(then.minutes);
        seen.sessions += 1;
        const planned = new Set(c.plan.sessions.flatMap((session) => session.ids));
        const fromPlan = [...c.answered].every((id) => planned.has(id));
        if (!fromPlan) seen.free += 1;
        if (cut(c.plan, budget) || cut(c.after, budget)) seen.cut += 1;
        else if (fromPlan) {
          // A session of the plan on a day its minutes hold: the count is the page's to the question (B: 86 − 7 = 79).
          expect(end.count, `${seed}: exact`).toBe(then.count);
          seen.exact += 1;
        }
      }
    }
    // Real tests of the rule: every kind of session, many of each (an answer outside the plan, or a day cut by the real
    // minutes, leaves the page lower than the end screen said — the way nothing goes up).
    expect(seen.sessions).toBeGreaterThan(200);
    expect(seen.exact).toBeGreaterThan(100);
    expect(seen.cut).toBeGreaterThan(10);
    expect(seen.free).toBeGreaterThan(10);
  });
});
