import { describe, expect, it } from 'vitest';
import type { DayPlan, PlanInput } from '../../types/container';
import { estSeconds, planDay } from './plan.ts';
import { DEFAULT_PACE } from './pace.ts';
import { afterAnswer, buildSession, freeSession, prng } from './session.ts';
import { isSeen } from './rule.ts';
import { addDays } from './time.ts';
import { at, makeInput, oralItems, stateAfter, testItems } from './__fixtures__/scenarios.ts';
import { classOf, inputAt, newServer, record, type Server } from './__fixtures__/server.ts';

/**
 * The frozen day (usability check 2026-10-10, M1): after the day's first answer, the count and the minutes left today
 * only go down while the student answers — whatever the student's pace becomes. The plan is read as the site and the
 * bot read it: what plan_inputs says after each answer (__fixtures__/server.ts), decoded by decodePlanInputs.
 */

const D1 = '2026-10-07';
const count = (plan: DayPlan) => plan.counts.newItems + plan.counts.reviews + plan.counts.oral;
const target = (plan: DayPlan) => new Set(plan.sessions.flatMap((s) => s.ids));

interface Step { k: number; plan: DayPlan; input: PlanInput }

interface Student {
  /** ms of the k-th answer (k from 0). */
  ms: (k: number) => number;
  /** Right or wrong (the k-th answer; `fresh` = never seen before). */
  right: (k: number, fresh: boolean) => boolean;
  /** Before the k-th answer, a free session (a topic, «Только ошибки») instead of the plan's. */
  free?: (k: number) => boolean;
}

/**
 * A student who takes the plan's next session again and again from `start` (or a free session when the student says
 * so), and the plan read after every answer. Stops after `answers` answers or when the plan offers nothing now.
 */
function study(server: Server, start: number, answers: number, student: Student, old = false): Step[] {
  let t = start;
  let k = 0;
  const steps: Step[] = [];
  const first = inputAt(server, t, old);
  steps.push({ k, plan: planDay(first), input: first });
  for (let guard = 0; guard < 400 && k < answers; guard += 1) {
    const input = inputAt(server, t, old);
    const plan = planDay(input);
    const seed = `${server.budgetMin}:${t}`;
    const done = input.items.filter((item) => item.u?.lastDay === plan.day).map((item) => item.id);
    let queue: Array<{ id: string; retry: 0 | 1 | 2 }>;
    if (student.free?.(k)) {
      const subjectId = server.subjects[k % server.subjects.length].id;
      queue = freeSession(input, { subjectId }, done, seed).slice(0, 5);
    } else {
      const next = plan.sessions[0];
      if (!next) break;
      queue = buildSession(plan, next.subjectId, next.kind, done, seed);
    }
    if (queue.length === 0) break;
    const cls = new Map(queue.map((e) => [e.id, classOf(server.states.get(e.id), plan.window.inWindow)]));
    for (let pos = 0; pos < queue.length && k < answers; pos += 1) {
      const e = queue[pos];
      const fresh = !isSeen(server.states.get(e.id) ?? { seen: 0, firstDay: null } as never);
      const correct = e.retry > 0 ? true : student.right(k, fresh);
      const ms = student.ms(k);
      record(server, e.id, { at: t, correct, ms, cls: cls.get(e.id) ?? 'free', retry: e.retry > 0 });
      t += ms;
      k += 1;
      queue = afterAnswer(queue, pos, { id: e.id, correct }, seed);
      const after = inputAt(server, t, old);
      steps.push({ k, plan: planDay(after), input: after });
    }
  }
  return steps;
}

/** The answers after which the count or the minutes left today went up (from the freeze on: the 2nd answer onward). */
function growth(steps: Step[]): string[] {
  const out: string[] = [];
  for (let i = 2; i < steps.length; i += 1) {
    const [a, b] = [steps[i - 1].plan, steps[i].plan];
    if (count(b) > count(a)) out.push(`answer ${steps[i].k}: ${count(a)} → ${count(b)} questions`);
    if (b.counts.leftSec > a.counts.leftSec) out.push(`answer ${steps[i].k}: ${a.counts.leftSec} → ${b.counts.leftSec} s`);
  }
  return out;
}

/** The answers after which a subject's own miss rate changed in today's (live) pace. */
function paceChanges(steps: Step[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < steps.length; i += 1) {
    const before = steps[i - 1].input.pace ?? {};
    const after = steps[i].input.pace ?? {};
    if (Object.keys(after).some((id) => (before[id]?.pWrong.new ?? DEFAULT_PACE.pWrong.new) !== after[id].pWrong.new)) out.push(steps[i].k);
  }
  return out;
}

/** A fast newcomer: 2 s an answer, every new question right (no retries, so the 20th answer is the 20th counted one). */
const FAST: Student = { ms: () => 2_000, right: () => true };

function newcomer(subjects: number, perSubject: number, budgetMin: number): Server {
  const ids = ['a', 'b', 'c', 'd'].slice(0, subjects);
  return newServer({
    subjects: ids.map((id) => ({ id, date: addDays(D1, 21) })),
    items: ids.flatMap((id) => testItems(id, perSubject, 20, 7)),
    budgetMin,
    firstPlanDay: D1,
  });
}

describe('the frozen day never grows (M1)', () => {
  it('one subject: the pace re-estimated at answer 20 does not grow the day; without the day’s start it did', () => {
    const steps = study(newcomer(1, 400, 45), at(D1, '19:00'), 50, FAST);
    expect(count(steps[0].plan)).toBe(56); // «Сегодня 56 вопросов» before the first answer
    expect(paceChanges(steps)).toContain(20); // the subject's own miss rate replaces the default at its 20th answer
    expect(steps.every((s) => s.input.paceDay === null)).toBe(true); // planned with the pace as of the day's start
    expect(growth(steps)).toEqual([]);
    // each answer takes exactly one question off: 56 → 55 → … → 6
    steps.forEach((step) => expect(count(step.plan), `answer ${step.k}`).toBe(56 - step.k));
    // The same student against a server before 20261010130000: the refitted day grows (57 → 47 after 20 answers live).
    const old = study(newcomer(1, 400, 45), at(D1, '19:00'), 50, FAST, true);
    expect(growth(old).length).toBeGreaterThan(0);
    expect(count(old[20].plan)).toBeGreaterThan(56 - 20);
  });

  it('several subjects: re-estimated at answer 20 (the first subject) and 40 (the second), the day only shrinks', () => {
    const steps = study(newcomer(2, 300, 60), at(D1, '19:00'), 70, FAST);
    expect(steps[0].plan.sessions.slice(0, 2).map((s) => [s.subjectId, s.ids.length])).toEqual([['a', 20], ['b', 20]]);
    expect(paceChanges(steps)).toEqual(expect.arrayContaining([20, 40]));
    expect(growth(steps)).toEqual([]);
    steps.forEach((step) => expect(count(step.plan), `answer ${step.k}`).toBe(count(steps[0].plan) - step.k));
    const old = study(newcomer(2, 300, 60), at(D1, '19:00'), 70, FAST, true);
    expect(growth(old).length).toBeGreaterThan(0);
  });

  it('is the morning’s target without what was answered: the same questions, nothing joins', () => {
    const server = newcomer(2, 300, 45);
    study(server, at(D1, '19:00'), 120, { ms: (k) => 9_000 + (k % 5) * 4_000, right: (k, fresh) => (fresh ? k % 3 !== 0 : true) });
    const day2 = addDays(D1, 1);
    const preview = planDay(inputAt(server, at(day2, '08:00')));
    const morning = target(preview);
    expect(morning.size).toBeGreaterThan(40);
    const steps = study(server, at(day2, '08:00'), 50, { ms: (k) => 3_000 + (k % 4) * 1_500, right: (k) => k % 4 !== 1 });
    for (const step of steps.slice(1)) {
      const answered = new Set(step.input.items.filter((item) => item.u?.lastDay === day2).map((item) => item.id));
      // the questions ready now are the morning's (the confirmations of the evening before wait for their moment and
      // are counted all along, decision 32); each answered one is gone, nothing took its place
      expect([...target(step.plan)].filter((id) => !morning.has(id)), `answer ${step.k}`).toEqual([]);
      expect([...answered].every((id) => morning.has(id))).toBe(true);
      expect(count(step.plan), `answer ${step.k}`).toBe(count(preview) - answered.size);
    }
    expect(growth(steps)).toEqual([]);
  });

  it('a later day with mistakes, free sessions in between, and the pace moving: never grows', () => {
    const server = newcomer(3, 200, 45);
    const rnd = prng('later-day');
    for (let d = 0; d < 4; d += 1) {
      const day = addDays(D1, d);
      const steps = study(server, at(day, d % 2 ? '07:40' : '18:30'), 90, {
        ms: () => (rnd() < 0.3 ? 1_500 : 6_000 + rnd() * 50_000),
        right: (_, fresh) => rnd() < (fresh ? 0.55 : 0.8),
        free: (k) => k > 0 && k % 23 === 0,
      });
      expect(growth(steps), day).toEqual([]);
      // from the second day the questions answered today include familiar ones, whose day's start the server keeps
      if (d > 0) expect(Object.keys(steps[steps.length - 1].input.dayStart ?? {}).length, day).toBeGreaterThan(5);
    }
  });

  it('slow answers, then fast ones: the real minutes trim the day, and fast answers do not bring questions back', () => {
    const server = newcomer(2, 300, 30);
    study(server, at(D1, '19:00'), 80, FAST);
    const day2 = addDays(D1, 1);
    // three minutes a question for a while (the cap of a counted answer), then two seconds
    const steps = study(server, at(day2, '09:00'), 70, { ms: (k) => (k < 8 ? 180_000 : 2_000), right: (k) => k % 5 !== 0 });
    expect(growth(steps)).toEqual([]);
    const seventh = steps[7].plan;
    expect(seventh.counts.leftSec).toBeLessThanOrEqual(30 * 60 - 7 * 180);
    // the slow answers took more than one question each off the day
    expect(count(seventh)).toBeLessThan(count(steps[0].plan) - 7);
    // the budget is a hard cap: what is left fits the real minutes left
    for (const step of steps.slice(1)) {
      expect(step.plan.counts.leftSec).toBeLessThanOrEqual(Math.max(0, 30 * 60 - step.input.today.doneSec));
    }
  });

  it('spare minutes go to «Ещё 20 новых»: a fast student finishes the target, then the day is done', () => {
    const server = newcomer(1, 400, 45);
    const steps = study(server, at(D1, '19:00'), 400, FAST);
    const last = steps[steps.length - 1].plan;
    expect(last.state).toBe('done');
    expect(last.lines.find((l) => l.key === 'more_new')?.n).toEqual([20]);
    expect(growth(steps)).toEqual([]);
  });
});

describe('the frozen day: inputs', () => {
  const subjects = [{ id: 'a', date: addDays(D1, 20) }];
  const day2 = addDays(D1, 1);
  const fast = { ...DEFAULT_PACE, tNew: 5, tRev: 4, pWrong: { new: 0.1, relearn: 0.1, confirm: 0.05, check: 0.05, final: 0.05 } };

  it('is planned with the pace as of the day’s start, not with today’s', () => {
    const items = testItems('a', 300).map((item, i) => (i < 3 ? { ...item, u: stateAfter([{ at: at(day2, '08:00') + i * 1000, correct: true }]) } : item));
    const base = makeInput({ now: at(day2, '09:00'), firstAt: at(day2, '08:00'), subjects, items, budgetMin: 30, newDone: { a: 3 }, doneSec: 60 });
    const withDay = { ...base, paceDay: null, dayStart: {} };
    const today = planDay({ ...withDay, pace: { a: fast } });
    // the day's questions and minutes; the lines about the weeks ahead follow today's pace
    expect([today.sessions, today.counts]).toEqual([planDay(withDay).sessions, planDay(withDay).counts]);
    // an older server (no pace_day): the day is planned with today's pace, as before
    expect(count(planDay({ ...base, pace: { a: fast } }))).toBeGreaterThan(count(planDay(withDay)));
  });

  it('without the day’s start of an answered question, the frozen day is filled as before, with the day’s pace', () => {
    const reviewed = stateAfter([{ at: at(D1, '10:00'), correct: false }, { at: at(day2, '08:00'), correct: true }]);
    const items = testItems('a', 120).map((item, i) => (i === 0 ? { ...item, u: reviewed } : item));
    const input = makeInput({ now: at(day2, '09:00'), firstAt: at(day2, '08:00'), subjects, items, budgetMin: 30, doneSec: 20 });
    const missing = planDay({ ...input, paceDay: null, dayStart: {} });
    const known = planDay({ ...input, paceDay: null, dayStart: { [items[0].id]: stateAfter([{ at: at(D1, '10:00'), correct: false }]) } });
    expect(missing.state).toBe('study');
    expect(target(missing).has(items[0].id)).toBe(false);
    expect(target(known).has(items[0].id)).toBe(false);
    // known: the morning's relearn of the first question is answered; its planned cost comes off with it
    expect(known.counts.leftSec).toBeLessThanOrEqual(30 * 60 - Math.round(estSeconds(items[0], 'relearn', DEFAULT_PACE)));
  });

  it('a plan with oral questions is filled as before, with the day’s pace', () => {
    const items = [...testItems('a', 60), ...oralItems('a', 12)];
    const input = makeInput({ now: at(day2, '09:00'), firstAt: at(day2, '08:00'), subjects, items, budgetMin: 30 });
    const plan = planDay({ ...input, paceDay: null, dayStart: {}, pace: { a: fast } });
    const dayPace = planDay({ ...input, paceDay: null, dayStart: {} });
    expect([plan.sessions, plan.counts]).toEqual([dayPace.sessions, dayPace.counts]);
    expect(plan.counts.oral).toBeGreaterThan(0);
  });
});
