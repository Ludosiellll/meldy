import { describe, expect, it } from 'vitest';
import sample from '../../../../contracts/container/plan_inputs.json';
import type { AnswerInput, PlanInputsWire, PlanItemRow } from '../../types/container';
import { decodePlanInputs } from './planInputs';
import { planDay } from './plan';
import { buildSession } from './session';

/**
 * The data layer (D1) and the study engine (D2) together: the wire that plan_inputs returns, decoded on the device,
 * planned for the day and turned into a session. Each package tests its half with the other mocked; this checks the
 * halves agree on the shape (seconds → ms, subject indexes → ids, the queue, the pace).
 */

const TZ = 'Europe/Minsk';

function invariants(input: ReturnType<typeof decodePlanInputs>, plan: ReturnType<typeof planDay>) {
  const known = new Set(input.items.map((item) => item.id));
  const subjects = new Set(input.subjects.map((subject) => subject.id));
  for (const session of plan.sessions) {
    expect(subjects.has(session.subjectId)).toBe(true);
    expect(new Set(session.ids).size).toBe(session.ids.length);
    for (const id of session.ids) expect(known.has(id)).toBe(true);
    if (session.kind === 'answer') expect(session.ids.length).toBeLessThanOrEqual(20);
    if (session.kind === 'self_check') expect(session.ids.length).toBeLessThanOrEqual(10);
    if (session.kind === 'ai_check') expect(session.ids.length).toBeLessThanOrEqual(3);
  }
  expect(plan.counts.leftSec).toBeLessThanOrEqual(input.budgetMin * 60);
  expect(plan.figure.twoDays).toBeLessThanOrEqual(plan.figure.inPlan);
  expect(plan.figure.seen).toBeLessThanOrEqual(plan.figure.inPlan);
}

describe('plan_inputs wire → decodePlanInputs → planDay → buildSession', () => {
  it('plans the contract sample (3 subjects, 18 items, answered earlier today) without breaking a rule', () => {
    const wire = sample as unknown as PlanInputsWire;
    const now = wire.now * 1000;
    const input = decodePlanInputs(wire, { containerId: wire.containers[0].id, tz: TZ, now, pending: [], oral: [] });
    expect(input.today.firstAt).toBe(wire.containers[0].today.first_at! * 1000);
    expect(input.budgetMin).toBe(wire.containers[0].settings.minutes_per_day);
    const plan = planDay(input);
    expect(plan.day).toBe(wire.day);
    invariants(input, plan);
    for (const session of plan.sessions) {
      const queue = buildSession(plan, session.subjectId, session.kind, [], 'seed-1');
      expect(queue.length).toBeGreaterThan(0);
    }
  });

  it('plans 960 new questions in 4 subjects 20 days ahead: sessions of one subject, the hard budget, every id known', () => {
    const wire = bigWire(4, 240, '2026-10-30');
    const input = decodePlanInputs(wire, { containerId: 'c-1', tz: TZ, now: Date.parse('2026-10-10T09:00:00+03:00'), pending: [], oral: [] });
    expect(input.items).toHaveLength(960);
    const plan = planDay(input);
    expect(plan.state).toBe('study');
    expect(plan.sessions.length).toBeGreaterThan(0);
    expect(plan.coverage.unseen).toBe(960);
    invariants(input, plan);
    expect(plan.counts.estSec).toBeLessThanOrEqual(60 * 60);
  });

  it('counts the offline queue as answered today (first seen today, new done) before the server has it', () => {
    const wire = bigWire(2, 30, '2026-10-30');
    const now = Date.parse('2026-10-10T09:00:00+03:00');
    const pending: AnswerInput[] = wire.items.slice(0, 5).map((row, index) => ({
      client_event_id: `queued-${index}`,
      item_id: row[0],
      chosen: 0,
      local_date: '2026-10-10',
      mode: 'learn',
      ms: 4000,
    }));
    const input = decodePlanInputs(wire, { containerId: 'c-1', tz: TZ, now, pending, oral: [] });
    const touched = input.items.filter((item) => item.u?.lastDay === '2026-10-10');
    expect(touched).toHaveLength(5);
    expect(Object.values(input.today.newDone).reduce((a, b) => a + b, 0)).toBe(5);
    expect(input.today.doneSec).toBe(20);
    invariants(input, planDay(input));
  });
});

/** A wire as plan_inputs returns it for an exam with no answers yet: `subjects` × `per` items, one container. */
function bigWire(subjects: number, per: number, examDate: string): PlanInputsWire {
  const items: PlanItemRow[] = [];
  for (let s = 0; s < subjects; s += 1) {
    for (let p = 1; p <= per; p += 1) items.push([`i-${s}-${p}`, s, 1 + (p % 12), p, 0, 1, 0]);
  }
  return {
    v: 1,
    day: '2026-10-10',
    now: Math.floor(Date.parse('2026-10-10T09:00:00+03:00') / 1000),
    containers: [{
      id: 'c-1', title: 'Осенняя сессия', exam_date: examDate, role: 'owner', first_plan_day: '2026-10-10',
      answers_today: 0, settings: { minutes_per_day: 60 } as PlanInputsWire['containers'][number]['settings'],
      today: { first_at: null, done_s: 0 },
    }],
    subjects: Array.from({ length: subjects }, (_, s) => ({
      id: `s-${s}`, container: 0, title: `Предмет ${s + 1}`, test_date: null, oral_exam_id: null, topics: 12, new_today: 0,
    })),
    items,
    states: [],
    doubted: [],
    pace: [],
    ai: null,
  };
}
