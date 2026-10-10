import { describe, expect, it } from 'vitest';
import type { DayPlan, LocalDay, PlanInput, PlanItem } from '../../types/container';
import { DEFAULT_PACE } from './pace.ts';
import {
  CLASS_ORDER, LATE_UNTIL_MINUTES, MIN_SHARE, NEW_PER_DAY_MAX, NO_DATE_NEW_PER_DAY, SESSION_SIZE, daysAhead, estSeconds, extraNew,
  feasibility, mockOffered, oralToPrepare, planDay, subjectInfo, windowDays,
} from './plan.ts';
import { prng } from './session.ts';
import { addDays, clockText, localDay } from './time.ts';
import { LINE_KEYS, lineText } from './words.ts';
import { TZ, at, makeInput, newSim, oralItems, simFigure, simInput, simSeen, sit, stateAfter, testItems } from './__fixtures__/scenarios.ts';

const DAY1 = '2026-10-07';
const NEW_COST = estSeconds({ id: 'x', s: 's', f: 't', tp: 1, o: 1 }, 'new_floor', DEFAULT_PACE);
const ids = (plan: DayPlan) => plan.sessions.flatMap((s) => s.ids);
const ofSubject = (plan: DayPlan, subjectId: string) => plan.sessions.filter((s) => s.subjectId === subjectId).flatMap((s) => s.ids);
const four = (date: LocalDay) => ['a', 'b', 'c', 'd'].map((id) => ({ id, date }));
const fourItems = (n = 240) => ['a', 'b', 'c', 'd'].flatMap((id) => testItems(id, n));

function withStates(items: PlanItem[], pick: (item: PlanItem, i: number) => PlanItem['u']): PlanItem[] {
  return items.map((item, i) => {
    const u = pick(item, i);
    return u ? { ...item, u } : item;
  });
}

function keysOf(plan: DayPlan): string[] { return plan.lines.map((l) => l.key); }

describe('constants and the window', () => {
  it('order of classes (decision 16) and the limits', () => {
    expect(CLASS_ORDER).toEqual(['relearn', 'confirm', 'new_floor', 'confirm_ai', 'start_ai', 'check', 'final', 'new_fill']);
    expect(NEW_PER_DAY_MAX).toBe(100);
    expect(NO_DATE_NEW_PER_DAY).toBe(15);
    expect(MIN_SHARE).toBe(0.1);
    expect(LATE_UNTIL_MINUTES).toBe(22 * 60);
  });

  it('W = min(4, ⌊D0/3⌋)', () => {
    const w = (d0: number) => windowDays('2026-10-01', addDays('2026-10-01', d0));
    expect([30, 21, 12, 11, 9, 6, 5, 3, 2, 1, 0, -3].map(w)).toEqual([4, 4, 4, 3, 3, 2, 1, 1, 0, 0, 0, 0]);
  });

  it('estimates a question: base + miss × (wrong + 1.07 × retry); code takes longer', () => {
    expect(NEW_COST).toBeCloseTo(35 + 0.5 * (10 + 1.07 * 12));
    expect(estSeconds({ id: 'x', s: 's', f: 't', tp: 1, o: 1, slow: 1 }, 'new_fill', DEFAULT_PACE)).toBeCloseTo(45 + 0.5 * (10 + 1.07 * 12));
    expect(estSeconds({ id: 'x', s: 's', f: 't', tp: 1, o: 1 }, 'confirm', DEFAULT_PACE)).toBeCloseTo(20 + 0.15 * (10 + 1.07 * 12));
    expect(estSeconds({ id: 'x', s: 's', f: 'o', tp: null, o: 1 }, 'relearn', DEFAULT_PACE)).toBe(60);
    expect(estSeconds({ id: 'x', s: 's', f: 'o', tp: null, o: 1 }, 'confirm_ai', DEFAULT_PACE)).toBe(150);
  });
});

describe('Concept 2 §5: 960 questions (4 × 240), one date (ranges, not exact)', () => {
  it('day 1 at default pace fills the budget and never exceeds it (concept: 29 / 45 / 60 / 77 min)', () => {
    const now = at(DAY1, '20:00');
    const expected: Record<number, [number, number]> = { 30: [25, 30], 45: [40, 45], 60: [55, 60], 90: [70, 80] };
    for (const budget of [30, 45, 60, 90]) {
      const plan = planDay(makeInput({ now, subjects: four(addDays(DAY1, 21)), items: fourItems(), budgetMin: budget, firstPlanDay: DAY1 }));
      const min = plan.counts.estSec / 60;
      expect(min, `budget ${budget}`).toBeGreaterThanOrEqual(expected[budget][0]);
      expect(min, `budget ${budget}`).toBeLessThanOrEqual(expected[budget][1]);
      expect(plan.counts.newItems).toBeLessThanOrEqual(NEW_PER_DAY_MAX);
      expect(new Set(plan.sessions.map((s) => s.subjectId))).toEqual(new Set(['a', 'b', 'c', 'd'])); // every subject every day
    }
  });

  it('feasibility: about 75 min a day over 21 days (default 90), about 55 over 28 (default 60)', () => {
    const f21 = feasibility(makeInput({ now: at(DAY1, '20:00'), subjects: four(addDays(DAY1, 21)), items: fourItems(), budgetMin: 60 }));
    expect(f21.neededMin).toBeGreaterThanOrEqual(70);
    expect(f21.neededMin).toBeLessThanOrEqual(80);
    expect(f21.option).toBe(90);
    expect(f21.seenByDateEst).toBeGreaterThan(600);
    expect(f21.seenByDateEst).toBeLessThan(960);
    const f28 = feasibility(makeInput({ now: at(DAY1, '20:00'), subjects: four(addDays(DAY1, 28)), items: fourItems(), budgetMin: 60 }));
    expect(f28.neededMin).toBeGreaterThanOrEqual(50);
    expect(f28.neededMin).toBeLessThanOrEqual(60);
    expect(f28.option).toBe(60);
    expect(f28.seenByDateEst).toBe(960);
    const f7 = feasibility(makeInput({ now: at(DAY1, '20:00'), subjects: four(addDays(DAY1, 7)), items: fourItems(), budgetMin: 90 }));
    expect(f7.option).toBeNull();
  });

  it('a steady learner, 60 min, 21 days: the figure moves from day 2, the load stays at the budget', () => {
    const sim = newSim({ subjects: four(addDays(DAY1, 21)), items: fourItems(), budgetMin: 60, firstPlanDay: DAY1, seed: 'run-a' });
    const figs: number[] = [];
    for (let d = 0; d < 21; d += 1) {
      const day = addDays(DAY1, d);
      sit(sim, at(day, '20:00'));
      figs.push(simFigure(sim));
      const spent = (sim.days.get(day)?.doneSec ?? 0) / 60;
      expect(spent, day).toBeLessThanOrEqual(62);
      if (d > 0 && d < 17) expect(spent, day).toBeGreaterThanOrEqual(50);
    }
    expect(figs[0]).toBe(0);
    expect(figs[1]).toBeGreaterThan(0);
    for (let d = 2; d < 21; d += 1) expect(figs[d]).toBeGreaterThan(figs[1]);
    expect(simSeen(sim)).toBeGreaterThanOrEqual(700);
    expect(figs[20]).toBeGreaterThanOrEqual(600);
  });
});

describe('the student critic\'s bus pattern (decision 32)', () => {
  it('first evening 21:00, then 8:10 on the bus and 23:00: the figure is not 0 by the end of day 2', () => {
    const subjects = four(addDays(DAY1, 21));
    for (const seed of ['bus-1', 'bus-2', 'bus-3']) {
      const sim = newSim({ subjects, items: fourItems(), budgetMin: 60, firstPlanDay: DAY1, seed });
      sit(sim, at(DAY1, '21:00'));
      expect(simFigure(sim)).toBe(0);
      const evening = planDay(simInput(sim, at(DAY1, '23:30')));
      expect(evening.state).toBe('done');
      const first = evening.lines.find((l) => l.key === 'first_count');
      expect(first?.n).toEqual([1]);
      expect(first?.time).toMatch(/^17:/);

      const day2 = addDays(DAY1, 1);
      const morning = planDay(simInput(sim, at(day2, '08:10')));
      const later = morning.lines.find((l) => l.key === 'later');
      expect(later, seed).toBeDefined();
      expect((later?.n ?? [0])[0]).toBeGreaterThan(10);
      expect(later?.time).toMatch(/^17:/);
      expect(lineText(later as DayPlan['lines'][number])).toMatch(/^Ещё \d+\s(вопрос|вопроса|вопросов) — после 17:\d\d$/);
      expect(morning.lines.find((l) => l.key === 'first_count')?.n).toEqual([0]);
      expect(morning.next).not.toBeNull();
      expect(localDay(morning.next as number, TZ)).toBe(day2);
      expect(morning.firstCountDay).toBe(day2);

      sit(sim, at(day2, '08:10'), 0.45 * morning.counts.estSec);
      expect(simFigure(sim)).toBe(0);
      const noon = planDay(simInput(sim, at(day2, '12:00')));
      expect(noon.state).toBe('study');
      expect(noon.lines.find((l) => l.key === 'later')?.n).toEqual(later?.n); // still waiting for 17:00, still in the day
      sit(sim, at(day2, '23:00'));
      expect(simFigure(sim), seed).toBeGreaterThan(0);
      const night = planDay(simInput(sim, at(day2, '23:55')));
      expect(night.sessions).toEqual([]);
      expect(night.state).toBe('done');
    }
  });

  it('confirmations later today are in the frozen target from the start, offered only from their moment; a series started today waits for tomorrow', () => {
    const day2 = addDays(DAY1, 1);
    const items = withStates(testItems('a', 6), (_, i) => {
      if (i === 0) return stateAfter([{ at: at(DAY1, '21:00'), correct: true }]); // countable from 17:00
      if (i === 1) return stateAfter([{ at: at(DAY1, '23:50'), correct: true }]); // from 19:50
      if (i === 2) return stateAfter([{ at: at(day2, '02:30'), correct: true }]); // same day: tomorrow
      if (i === 3) return stateAfter([{ at: at(DAY1, '01:40'), correct: true }]); // from 21:40 the day before: ripe now
      return undefined;
    });
    const subjects = [{ id: 'a', date: addDays(DAY1, 30) }];
    const morning = planDay(makeInput({ now: at(day2, '08:10'), firstAt: at(day2, '08:10'), subjects, items, firstPlanDay: DAY1 }));
    expect(ids(morning)).toContain(items[3].id);
    expect(ids(morning)).not.toContain(items[0].id);
    expect(ids(morning)).not.toContain(items[1].id);
    expect(morning.lines.find((l) => l.key === 'later')).toEqual({ key: 'later', n: [2], time: '17:00' });
    expect(morning.next).toBe(at(day2, '17:00'));
    const evening = planDay(makeInput({ now: at(day2, '20:00'), firstAt: at(day2, '08:10'), subjects, items, firstPlanDay: DAY1 }));
    expect(ids(evening)).toEqual(expect.arrayContaining([items[0].id, items[1].id]));
    expect(ids(evening)).not.toContain(items[2].id);
    // 20 hours after any answer of yesterday is before 22:00 today: yesterday's late series is today's
    const lateItem = withStates(testItems('a', 1), () => stateAfter([{ at: at(DAY1, '23:59'), correct: true }]));
    const p = planDay(makeInput({ now: at(day2, '08:10'), firstAt: at(day2, '08:10'), subjects, items: lateItem, firstPlanDay: DAY1 }));
    expect(p.state).toBe('study');
    expect(p.lines.find((l) => l.key === 'later')).toEqual({ key: 'later', n: [1], time: '20:00' });
    // a series started today, or a peek today: tomorrow at the earliest
    const today = withStates(testItems('a', 1), () => stateAfter([{ at: at(day2, '00:30'), correct: true }]));
    const q = planDay(makeInput({ now: at(day2, '08:10'), firstAt: at(day2, '00:30'), subjects, items: today, firstPlanDay: DAY1 }));
    expect(q.state).toBe('done');
    expect(q.next).toBe(at(addDays(day2, 1), '00:00'));
    expect(q.lines.find((l) => l.key === 'first_count')).toEqual({ key: 'first_count', n: [1], day: addDays(day2, 1) });
  });
});

describe('the frozen day', () => {
  const subjects = [{ id: 'a', date: addDays(DAY1, 20) }];
  const day2 = addDays(DAY1, 1);

  it('items that become countable or due after the first answer wait for tomorrow; «На сегодня всё» stays', () => {
    const items = withStates(testItems('a', 10), (_, i) => {
      if (i < 4) return stateAfter([{ at: at(DAY1, '07:00'), correct: true }]); // from 03:00 today: ripe at the first answer
      if (i < 6) return stateAfter([{ at: at(DAY1, '12:00'), correct: true }]); // from 08:00 today: before the cutoff
      return stateAfter([{ at: at(addDays(DAY1, -5), '13:00'), correct: true }, { at: at(addDays(DAY1, -4), '13:00'), correct: true }]); // due 4 days later at 13:00 = day2 13:00
    });
    const firstAt = at(day2, '07:30');
    const p730 = planDay(makeInput({ now: firstAt, firstAt, subjects, items, firstPlanDay: DAY1 }));
    expect(p730.counts.reviews).toBe(6);
    expect(p730.lines.find((l) => l.key === 'later')?.n).toEqual([2]);
    const p20 = planDay(makeInput({ now: at(day2, '20:00'), firstAt, subjects, items, firstPlanDay: DAY1 }));
    expect(ids(p20).sort()).toEqual(items.slice(0, 6).map((i) => i.id).sort()); // the due checks of 13:00 are not added
    expect(p20.counts.reviews).toBe(6);
  });

  it('after the target is done, later recomputes say «На сегодня всё»', () => {
    const sim = newSim({ subjects, items: testItems('a', 120), budgetMin: 30, firstPlanDay: DAY1, seed: 'frozen' });
    sit(sim, at(DAY1, '19:00'));
    sit(sim, at(day2, '08:00'));
    // what yesterday evening started can count only from about 15:00: it waits in today's target, nothing is ready now
    const noon = planDay(simInput(sim, at(day2, '12:00')));
    expect(noon.state).toBe('study');
    expect(noon.sessions).toEqual([]);
    expect(noon.lines.find((l) => l.key === 'later')?.time).toMatch(/^15:/);
    sit(sim, at(day2, '16:30'));
    for (const t of ['17:00', '21:59', '23:59']) {
      const p = planDay(simInput(sim, at(day2, t)));
      expect(p.state, t).toBe('done');
      expect(p.sessions, t).toEqual([]);
      expect(p.lines.find((l) => l.key === 'done')?.n?.[0]).toBeGreaterThan(0);
      expect(p.lines.find((l) => l.key === 'more_new')?.n).toEqual([20]);
    }
  });

  it('the new-question floor is fixed for the day: answering new ones lowers the rest by as many', () => {
    const date = addDays(DAY1, 15);
    const items = testItems('a', 300);
    const morning = planDay(makeInput({ now: at(DAY1, '08:00'), subjects: [{ id: 'a', date }], items, budgetMin: 90 }));
    const floor = morning.coverage.floor;
    expect(floor).toBe(Math.ceil(300 / (15 - windowDays(DAY1, date))));
    const done = withStates(items, (_, i) => (i < 10 ? stateAfter([{ at: at(DAY1, '08:05'), correct: true }]) : undefined));
    const noon = planDay(makeInput({ now: at(DAY1, '12:00'), firstAt: at(DAY1, '08:05'), subjects: [{ id: 'a', date }], items: done, budgetMin: 90, newDone: { a: 10 }, doneSec: 350 }));
    expect(noon.coverage.floor).toBe(floor - 10);
  });

  it('«Ещё 20 новых» after the target: tomorrow asks for fewer new questions', () => {
    const date = addDays(DAY1, 15);
    const items = testItems('a', 300);
    const base = makeInput({ now: at(DAY1, '20:00'), subjects: [{ id: 'a', date }], items, budgetMin: 30 });
    const extra = extraNew(base, 20, planDay(base));
    expect(extra?.subjectId).toBe('a');
    expect(extra?.ids).toHaveLength(20);
    expect(new Set(extra?.ids).size).toBe(20);
    const target = new Set(ids(planDay(base)));
    expect(extra?.ids.some((id) => target.has(id))).toBe(false);
    const tomorrow = at(addDays(DAY1, 1), '20:00');
    const without = planDay(makeInput({ now: tomorrow, subjects: [{ id: 'a', date }], items, budgetMin: 30 }));
    const taken = new Set(extra?.ids);
    const after = withStates(items, (item) => (taken.has(item.id) ? stateAfter([{ at: at(DAY1, '21:00'), correct: false }]) : undefined));
    const withExtra = planDay(makeInput({ now: tomorrow, subjects: [{ id: 'a', date }], items: after, budgetMin: 30 }));
    expect(withExtra.coverage.floor).toBeLessThan(without.coverage.floor);
    expect(withExtra.coverage.unseen).toBe(without.coverage.unseen - 20);
  });
});

describe('the engineer\'s edge cases', () => {
  const now = at('2026-10-20', '10:00');

  it('D < 0: the subject left the plan; «Экзамен прошёл 28 октября»', () => {
    const items = withStates(testItems('a', 5), (_, i) => (i === 0 ? stateAfter([{ at: at('2026-10-10', '10:00'), correct: false }]) : undefined));
    const p = planDay(makeInput({ now, subjects: [{ id: 'a', date: '2026-10-18' }], items, firstPlanDay: '2026-10-01' }));
    expect(p.state).toBe('after');
    expect(p.sessions).toEqual([]);
    expect(p.lines).toEqual([{ key: 'after', day: '2026-10-18' }]);
    expect(p.figure).toEqual({ inPlan: 5, twoDays: 0, seen: 1, errors: 1, selfKnow: 0 });
  });

  it('D = 0: no plan, «Сегодня экзамен.» and quietly «20 вопросов, где были ошибки»', () => {
    const items = withStates(testItems('a', 40), (_, i) => (i < 25 ? stateAfter([{ at: at('2026-10-18', '10:00'), correct: false }]) : undefined));
    const p = planDay(makeInput({ now, subjects: [{ id: 'a', date: '2026-10-20' }], items, firstPlanDay: '2026-10-01' }));
    expect(p.state).toBe('exam_today');
    expect(p.sessions).toEqual([]);
    expect(p.lines).toEqual([{ key: 'exam_today', n: [25] }, { key: 'exam_errors', n: [20] }]);
    const clean = planDay(makeInput({ now, subjects: [{ id: 'a', date: '2026-10-20' }], items: testItems('a', 5), firstPlanDay: '2026-10-01' }));
    expect(clean.lines).toEqual([{ key: 'exam_today', n: [0] }]);
  });

  it('D ≤ W: inside the window the leftovers spread over the days left, no extra new ones', () => {
    // first plan day 2026-10-01, date 2026-10-22: W = 4, window from 2026-10-18; today 2026-10-20: 2 days left
    const p = planDay(makeInput({ now, subjects: [{ id: 'a', date: '2026-10-22' }], items: testItems('a', 30), firstPlanDay: '2026-10-01', budgetMin: 90 }));
    expect(p.window).toEqual({ from: '2026-10-18', days: 4, inWindow: true });
    expect(p.coverage.floor).toBe(15);
    expect(p.counts.newItems).toBe(15);
    expect(keysOf(p)).toContain('window_in');
    expect(p.lines.find((l) => l.key === 'window_in')?.n).toEqual([2]);
    expect(extraNew(makeInput({ now, subjects: [{ id: 'a', date: '2026-10-22' }], items: testItems('a', 30), firstPlanDay: '2026-10-01' }))).toBeNull();
  });

  it('D ≤ 2 from the first day: no window at all', () => {
    const p = planDay(makeInput({ now, subjects: [{ id: 'a', date: '2026-10-22' }], items: testItems('a', 30), firstPlanDay: '2026-10-20', budgetMin: 90 }));
    expect(p.window).toEqual({ from: null, days: 0, inWindow: false });
    expect(p.coverage.floor).toBe(15);
  });

  it('no date: 15 new a day per subject, no window, «Без даты — по 15 новых в день на предмет»', () => {
    const subjects = [{ id: 'a', date: null }, { id: 'b', date: null }];
    const items = [...testItems('a', 100), ...testItems('b', 100)];
    const p = planDay(makeInput({ now, subjects, items, budgetMin: 90 }));
    expect(p.counts.newItems).toBe(30);
    expect(ofSubject(p, 'a')).toHaveLength(15);
    expect(p.window.from).toBeNull();
    expect(p.lines.find((l) => l.key === 'no_date')).toEqual({ key: 'no_date', n: [15] });
    const later = planDay(makeInput({ now, subjects, items, budgetMin: 90, newDone: { a: 10 }, firstAt: now - 60_000, doneSec: 300 }));
    expect(ofSubject(later, 'a')).toHaveLength(5);
    expect(feasibility(makeInput({ now, subjects, items, budgetMin: 90 })).seenByDateEst).toBe(200);
  });

  it('all seen: no new questions, only familiar ones', () => {
    const items = withStates(testItems('a', 50), (_, i) => stateAfter([{ at: at('2026-10-18', '10:00'), correct: i % 3 !== 0 }]));
    const p = planDay(makeInput({ now, subjects: [{ id: 'a', date: '2026-11-20' }], items, firstPlanDay: '2026-10-01', budgetMin: 90 }));
    expect(p.counts.newItems).toBe(0);
    expect(p.coverage.unseen).toBe(0);
    expect(p.counts.reviews).toBe(50);
    expect(keysOf(p)).not.toContain('more_new');
  });

  it('all at «два разных дня», nothing due: «На сегодня всё. Следующие вопросы — …» with the moment', () => {
    const items = withStates(testItems('a', 20), (_, i) => stateAfter([
      { at: at('2026-10-17', '09:00') + i * 60_000, correct: true }, { at: at('2026-10-18', '09:00') + i * 60_000, correct: true },
    ]));
    const p = planDay(makeInput({ now, subjects: [{ id: 'a', date: '2026-12-01' }], items, firstPlanDay: '2026-10-01' }));
    expect(p.state).toBe('nothing');
    expect(p.sessions).toEqual([]);
    expect(p.next).toBe(at('2026-10-23', '09:00'));
    expect(p.lines.find((l) => l.key === 'nothing')).toEqual({ key: 'nothing', n: [3], day: '2026-10-23' });
    expect(p.figure.twoDays).toBe(20);
  });

  it('stale questions (the author changed the key) come back as new; doubted ones are simply not in the input', () => {
    const items = testItems('a', 10); // the database sends no state for an older rev
    const p = planDay(makeInput({ now, subjects: [{ id: 'a', date: '2026-11-20' }], items, budgetMin: 90 }));
    expect(p.coverage.unseen).toBe(10);
    expect(p.figure.inPlan).toBe(10);
  });

  it('mixed subject dates: each subject keeps its own date, window and place in the order', () => {
    const subjects = [{ id: 'far', date: '2026-11-25' }, { id: 'near', date: '2026-10-26' }, { id: 'gone', date: '2026-10-15' }];
    const old = (correct: boolean) => stateAfter([{ at: at('2026-10-15', '10:00'), correct }]);
    const items = [
      ...withStates(testItems('far', 30), (_, i) => (i < 5 ? old(false) : undefined)),
      ...withStates(testItems('near', 30), (_, i) => (i < 5 ? old(false) : undefined)),
      ...withStates(testItems('gone', 30), (_, i) => (i < 5 ? old(false) : undefined)),
    ];
    const p = planDay(makeInput({ now, subjects, items, firstPlanDay: '2026-10-01', budgetMin: 90 }));
    expect(p.sessions[0].subjectId).toBe('near'); // its mistakes come first: the nearest date
    expect(ofSubject(p, 'gone')).toEqual([]);
    expect(p.perSubject.map((s) => s.subjectId)).toEqual(['far', 'near', 'gone']);
    expect(p.perSubject[2].items).toBe(0);
    expect(p.perSubject[2].figure.inPlan).toBe(30);
    expect(keysOf(p)).not.toContain('window_ahead'); // several dates: each subject says its own
    expect(subjectInfo(makeInput({ now, subjects, items, firstPlanDay: '2026-10-01' }), 'near')?.lines).toEqual([{ key: 'window_ahead', n: [4], day: '2026-10-22' }]);
    expect(subjectInfo(makeInput({ now, subjects, items, firstPlanDay: '2026-10-01' }), 'gone')?.phase).toBe('after');
    expect(p.window).toEqual({ from: '2026-10-22', days: 4, inWindow: false });
  });

  it('window spread: the final pass takes ceil(left / days left) a day, weakest first, frozen for the day', () => {
    // date 2026-10-24, first plan day 2026-10-01 → W = 4, window from 2026-10-20 (today, 4 days left).
    // Every question is at «два разных дня» since 17–18 October and not due yet: the final pass covers them.
    const subjects = [{ id: 'a', date: '2026-10-24' }];
    const before = (i: number) => [{ at: at('2026-10-17', '09:00'), correct: true }, { at: at('2026-10-18', '09:00') + i * 1000, correct: true }];
    const items = withStates(testItems('a', 100), (_, i) => stateAfter(before(i)));
    const p = planDay(makeInput({ now, subjects, items, firstPlanDay: '2026-10-01', budgetMin: 90 }));
    expect(p.window).toEqual({ from: '2026-10-20', days: 4, inWindow: true });
    expect(ids(p)).toHaveLength(25);
    expect(ids(p).sort()).toEqual(items.slice(0, 25).map((i) => i.id).sort()); // oldest naming first
    const passed = (i: number) => stateAfter([...before(i), { at: at('2026-10-20', '11:00') + i * 1000, correct: true }]);
    const day2 = withStates(items, (item, i) => (i < 25 ? passed(i) : item.u));
    const next = planDay(makeInput({ now: at('2026-10-21', '10:00'), subjects, items: day2, firstPlanDay: '2026-10-01', budgetMin: 90 }));
    expect(ids(next)).toHaveLength(25); // 75 left, 3 days left
    expect(ids(next).some((id) => items.slice(0, 25).some((i) => i.id === id))).toBe(false);
    // the same day after 10 of them: the rest of today's 25, not a new quota
    const sameDay = withStates(items, (item, i) => (i < 10 ? passed(i) : item.u));
    const noon = planDay(makeInput({ now: at('2026-10-20', '12:00'), firstAt: at('2026-10-20', '11:00'), subjects, items: sameDay, firstPlanDay: '2026-10-01', budgetMin: 90, doneSec: 300 }));
    expect(ids(noon)).toHaveLength(15);
    expect(noon.postponed.final).toBeUndefined();
  });
});

describe('the budget is a hard cap', () => {
  it('never plans more than the minutes left, whatever the input', () => {
    const next = prng('cap');
    for (let run = 0; run < 40; run += 1) {
      const budget = [30, 45, 60, 90][run % 4];
      const n = 20 + Math.floor(next() * 400);
      const day = addDays('2026-10-01', Math.floor(next() * 20));
      const items = withStates(testItems('a', n, 15, 3), () => {
        const r = next();
        if (r < 0.3) return undefined;
        const t0 = at(addDays(day, -1 - Math.floor(next() * 6)), '10:00');
        if (r < 0.5) return stateAfter([{ at: t0, correct: false }]);
        if (r < 0.75) return stateAfter([{ at: t0, correct: true }]);
        return stateAfter([{ at: t0 - 2 * 86_400_000, correct: true }, { at: t0, correct: true }]);
      });
      const doneSec = Math.floor(next() * budget * 60 * 0.8);
      const p = planDay(makeInput({ now: at(day, '18:00'), subjects: [{ id: 'a', date: addDays(day, 3 + Math.floor(next() * 20)) }], items,
        budgetMin: budget, firstPlanDay: '2026-10-01', firstAt: doneSec > 0 ? at(day, '08:00') : null, doneSec }));
      const planned = p.sessions.reduce((sum, s) => sum + s.estSec, 0);
      expect(planned).toBeLessThanOrEqual(budget * 60 - doneSec + 1);
      expect(p.counts.leftSec).toBeLessThanOrEqual(budget * 60 - doneSec + 1);
      expect(p.counts.estSec).toBeLessThanOrEqual(Math.max(budget * 60, doneSec) + 1);
    }
  });

  it('uses the student\'s own pace; a broken pace falls back to the defaults', () => {
    const input = makeInput({ now: at(DAY1, '20:00'), subjects: [{ id: 'a', date: addDays(DAY1, 21) }], items: testItems('a', 300), budgetMin: 30, firstPlanDay: DAY1 });
    const base = planDay(input);
    expect(base.counts.newItems).toBe(Math.floor(1800 / NEW_COST));
    const fast = planDay({ ...input, pace: { a: { ...DEFAULT_PACE, tNew: 20 } } });
    expect(fast.counts.newItems).toBeGreaterThan(base.counts.newItems);
    expect(fast.counts.estSec).toBeLessThanOrEqual(1800);
    const broken = planDay({ ...input, pace: { a: { ...DEFAULT_PACE, tNew: Number.NaN, tRev: 0, pWrong: { ...DEFAULT_PACE.pWrong, new: 7 } } } });
    expect(broken).toEqual(base);
  });

  it('fair share: each subject at least 10 % of the minutes, even when its work is tiny', () => {
    const now = at('2026-10-10', '10:00');
    const big = withStates(testItems('big', 1500), () => stateAfter([{ at: at('2026-10-08', '10:00'), correct: false }]));
    const p = planDay(makeInput({ now, subjects: [{ id: 'big', date: '2026-11-30' }, { id: 'small', date: '2026-11-30' }], items: [...big, ...testItems('small', 10)], budgetMin: 30, firstPlanDay: '2026-10-01' }));
    const small = p.perSubject.find((s) => s.subjectId === 'small');
    expect(small?.items).toBeGreaterThanOrEqual(3);
    expect(small?.estSec).toBeGreaterThanOrEqual(0.1 * 1800 - NEW_COST);
    expect(ofSubject(p, 'big').length).toBeGreaterThan(50);
  });

  it('fair share: 120 oral questions do not take the minutes of 720 with options', () => {
    const now = at(DAY1, '20:00');
    const subjects = [{ id: 'a', date: addDays(DAY1, 21) }, { id: 'b', date: addDays(DAY1, 21) }, { id: 'c', date: addDays(DAY1, 21) }, { id: 'o', date: addDays(DAY1, 21) }];
    const items = [...testItems('a', 240), ...testItems('b', 240), ...testItems('c', 240), ...oralItems('o', 120)];
    const p = planDay(makeInput({ now, subjects, items, budgetMin: 60, firstPlanDay: DAY1, ai: { left: 100, resetsAt: at(DAY1, '03:00') + 86_400_000 } }));
    const test = p.perSubject.filter((s) => s.subjectId !== 'o').reduce((sum, s) => sum + s.estSec, 0);
    const oral = p.perSubject.find((s) => s.subjectId === 'o')?.estSec ?? 0;
    expect(oral).toBeGreaterThan(0);
    expect(test).toBeGreaterThan(oral);
    expect(p.counts.estSec).toBeLessThanOrEqual(3600);
  });
});

describe('oral questions', () => {
  const now = at('2026-10-10', '10:00');
  const subjects = [{ id: 'o', date: '2026-11-10' }];
  const ai = { left: 100, resetsAt: Date.UTC(2026, 9, 11, 0, 0) };
  const named = (day: string, hhmm = '10:00') => stateAfter([{ at: at(day, hhmm), correct: true }]);

  it('new ones are self-checks (sessions of 10); AI checks only after «Знаю», confirmations first, in sessions of 3', () => {
    const fresh = oralItems('o', 25);
    const ready = oralItems('o', 4, { sc: '2026-10-09', rating: 3 }).map((q, i) => ({ ...q, id: `ready-${i}`, o: 100 + i }));
    const confirmable = oralItems('o', 2, { sc: '2026-10-08', rating: 3, ac: '2026-10-08' }).map((q, i) => ({ ...q, id: `conf-${i}`, o: 200 + i, l: [named('2026-10-08'), named('2026-10-08')] }));
    const shaky = oralItems('o', 3, { sc: '2026-10-09', rating: 2 }).map((q, i) => ({ ...q, id: `shaky-${i}`, o: 300 + i }));
    const unsure = oralItems('o', 1, { sc: '2026-10-09', rating: 1 }).map((q) => ({ ...q, id: 'unsure', o: 400 }));
    const p = planDay(makeInput({ now, subjects, items: [...fresh, ...ready, ...confirmable, ...shaky, ...unsure], budgetMin: 90, ai, firstPlanDay: '2026-10-01' }));
    const ai_ = p.sessions.filter((s) => s.kind === 'ai_check');
    const self = p.sessions.filter((s) => s.kind === 'self_check');
    expect(ai_.flatMap((s) => s.ids)).toEqual(['conf-0', 'conf-1', 'ready-0', 'ready-1', 'ready-2', 'ready-3']);
    for (const s of ai_) expect(s.ids.length).toBeLessThanOrEqual(SESSION_SIZE.ai_check);
    for (const s of self) expect(s.ids.length).toBeLessThanOrEqual(SESSION_SIZE.self_check);
    const selfIds = self.flatMap((s) => s.ids);
    for (const id of ['shaky-0', 'shaky-1', 'shaky-2', 'unsure']) {
      expect(selfIds).toContain(id); // «Плаваю» / «Не знаю»: a self-check again, never the AI
      expect(ai_.flatMap((s) => s.ids)).not.toContain(id);
    }
    expect(p.sessions.findIndex((s) => s.kind === 'self_check')).toBeLessThan(p.sessions.findIndex((s) => s.kind === 'ai_check'));
    expect(p.counts.aiChecks).toBe(6);
    expect(p.units).toEqual({ points: 0, checks: 24 });
    expect(p.lines.find((l) => l.key === 'oral')?.n).toEqual([p.counts.oral - 6, 6, 24]);
  });

  it('the order: the floor of new self-checks, then AI checks, then more new ones', () => {
    const fresh = oralItems('o', 60);
    const ready = oralItems('o', 6, { sc: '2026-10-09', rating: 3 }).map((q, i) => ({ ...q, id: `ready-${i}`, o: 100 + i }));
    // floor = ⌈60 / 27⌉ = 3 self-checks (180 s), then 2 AI checks fit (300 s), then 2 more new self-checks (120 s)
    const p = planDay(makeInput({ now, subjects, items: [...fresh, ...ready], budgetMin: 10, ai, firstPlanDay: '2026-10-01' }));
    expect(p.coverage.floor).toBe(3);
    expect(p.counts.aiChecks).toBe(2);
    expect(p.postponed.start_ai).toBe(4);
    expect(p.counts.oral).toBe(7);
    // a close date: the floor alone fills the minutes, no AI check today
    const close = planDay(makeInput({ now, subjects: [{ id: 'o', date: '2026-10-14' }], items: [...fresh, ...ready], budgetMin: 10, ai, firstPlanDay: '2026-10-01' }));
    expect(close.coverage.floor).toBe(15);
    expect(close.counts.aiChecks).toBe(0);
    expect(close.counts.oral).toBe(10);
    expect(close.postponed.new_floor).toBe(5);
  });

  it('units: an AI check costs 4, a question without points 1 + 10 per new batch of 40; the limit stops AI checks with a line', () => {
    const ready = oralItems('o', 6, { sc: '2026-10-09', rating: 3 }).map((q, i) => ({ ...q, id: `ready-${i}`, o: 100 + i }));
    const limited = planDay(makeInput({ now, subjects, items: ready, budgetMin: 90, ai: { left: 9, resetsAt: Date.UTC(2026, 9, 11, 0, 0) }, firstPlanDay: '2026-10-01' }));
    expect(limited.counts.aiChecks).toBe(2);
    expect(limited.units).toEqual({ points: 0, checks: 8 });
    expect(limited.lines.find((l) => l.key === 'ai_limit')).toEqual({ key: 'ai_limit', time: '3:00' });
    const unprepared = oralItems('o', 45, { prepared: false });
    const p = planDay(makeInput({ now, subjects, items: unprepared, budgetMin: 90, ai: { left: 100, resetsAt: ai.resetsAt }, firstPlanDay: '2026-10-01' }));
    const planned = p.counts.oral;
    expect(p.units?.points).toBe(planned + 10 * Math.ceil(planned / 40));
    expect(oralToPrepare(makeInput({ now, subjects, items: unprepared, budgetMin: 90, ai, firstPlanDay: '2026-10-01' }), p).length).toBe(Math.min(45, 2 * planned));
    const noUnits = planDay(makeInput({ now, subjects, items: unprepared, budgetMin: 90, ai: { left: 0, resetsAt: ai.resetsAt }, firstPlanDay: '2026-10-01' }));
    expect(noUnits.counts.oral).toBe(0);
  });

  it('a question self-checked today is not AI-checked today (a same-day peek voids the naming)', () => {
    const q = oralItems('o', 1, { sc: '2026-10-10', rating: 3, ac: '2026-10-08' }).map((x) => ({ ...x, l: [named('2026-10-08'), named('2026-10-08')] }));
    const p = planDay(makeInput({ now, subjects, items: q, budgetMin: 90, ai, firstPlanDay: '2026-10-01' }));
    expect(p.counts.aiChecks).toBe(0);
  });

  it('an oral question counts in the figure when all its deciding lines are at «два разных дня»', () => {
    const cleared = oralItems('o', 1, { sc: '2026-10-05', rating: 3, ac: '2026-10-06' }).map((x) => ({
      ...x, id: 'cleared', o: 50, l: [stateAfter([{ at: at('2026-10-05', '10:00'), correct: true }, { at: at('2026-10-06', '10:00'), correct: true }])],
    }));
    const p = planDay(makeInput({ now, subjects, items: [...cleared, ...oralItems('o', 2)], budgetMin: 30, ai, firstPlanDay: '2026-10-01' }));
    expect(p.figure).toMatchObject({ inPlan: 3, twoDays: 1, seen: 1, selfKnow: 1 });
  });
});

describe('first count, next, lines', () => {
  const subjects = [{ id: 'a', date: addDays(DAY1, 20) }];

  it('after the first evening: «Первые войдут в счёт завтра после 17:00»; the next morning «сегодня после 17:00»; at 18:00 «сегодня»', () => {
    const items = withStates(testItems('a', 30), (_, i) => (i < 20 ? stateAfter([{ at: at(DAY1, '21:00') + i * 30_000, correct: true }]) : undefined));
    const evening = planDay(makeInput({ now: at(DAY1, '21:30'), firstAt: at(DAY1, '21:00'), doneSec: 700, subjects, items, firstPlanDay: DAY1 }));
    expect(evening.firstCountDay).toBe(addDays(DAY1, 1));
    expect(evening.lines.find((l) => l.key === 'first_count')).toEqual({ key: 'first_count', n: [1], day: addDays(DAY1, 1), time: '17:00' });
    const day2 = addDays(DAY1, 1);
    const morning = planDay(makeInput({ now: at(day2, '08:10'), firstAt: at(day2, '08:10'), subjects, items, firstPlanDay: DAY1 }));
    expect(morning.lines.find((l) => l.key === 'first_count')).toEqual({ key: 'first_count', n: [0], day: day2, time: '17:00' });
    expect(morning.next).toBe(at(day2, '17:00'));
    const six = planDay(makeInput({ now: at(day2, '18:00'), firstAt: at(day2, '08:10'), subjects, items, firstPlanDay: DAY1 }));
    expect(six.lines.find((l) => l.key === 'first_count')).toEqual({ key: 'first_count', n: [0], day: day2 });
    expect(six.next).toBeNull();
  });

  it('no first-count line once the figure moved, and none before any answer', () => {
    const fresh = planDay(makeInput({ now: at(DAY1, '09:00'), subjects, items: testItems('a', 30) }));
    expect(fresh.firstCountDay).toBeNull();
    expect(keysOf(fresh)).not.toContain('first_count');
    expect(keysOf(fresh)).toContain('first_day');
    const moved = withStates(testItems('a', 3), () => stateAfter([{ at: at(addDays(DAY1, -3), '09:00'), correct: true }, { at: at(addDays(DAY1, -2), '09:00'), correct: true }]));
    expect(planDay(makeInput({ now: at(DAY1, '09:00'), subjects, items: moved })).firstCountDay).toBeNull();
  });

  it('a skipped day: «Вчера без занятий. Сегодня те же 60 минут — больше знакомых вопросов.»', () => {
    const items = withStates(testItems('a', 30), (_, i) => (i < 10 ? stateAfter([{ at: at(addDays(DAY1, -2), '20:00'), correct: i % 2 === 0 }]) : undefined));
    const p = planDay(makeInput({ now: at(DAY1, '09:00'), subjects, items, budgetMin: 60 }));
    expect(p.lines.find((l) => l.key === 'skip')).toEqual({ key: 'skip', n: [1, 60] });
    const three = withStates(testItems('a', 30), (_, i) => (i < 10 ? stateAfter([{ at: at(addDays(DAY1, -4), '20:00'), correct: true }]) : undefined));
    expect(planDay(makeInput({ now: at(DAY1, '09:00'), subjects, items: three })).lines.find((l) => l.key === 'skip')?.n).toEqual([3, 60]);
    const yesterday = withStates(testItems('a', 30), (_, i) => (i < 10 ? stateAfter([{ at: at(addDays(DAY1, -1), '20:00'), correct: true }]) : undefined));
    expect(keysOf(planDay(makeInput({ now: at(DAY1, '09:00'), subjects, items: yesterday })))).not.toContain('skip');
  });

  it('a short budget says what the student will see and how many minutes would cover everything', () => {
    const p = planDay(makeInput({ now: at(DAY1, '20:00'), subjects: four(addDays(DAY1, 21)), items: fourItems(), budgetMin: 30, firstPlanDay: DAY1 }));
    const short = p.lines.find((l) => l.key === 'short');
    expect(short?.day).toBe(addDays(DAY1, 21));
    expect(short?.n?.[0]).toBe(30);
    expect(short?.n?.[1]).toBeLessThan(960);
    expect(short?.n?.[2]).toBe(960);
    expect(short?.n?.[3]).toBe(p.coverage.neededMin);
    const enough = planDay(makeInput({ now: at(DAY1, '20:00'), subjects: four(addDays(DAY1, 28)), items: fourItems(), budgetMin: 60, firstPlanDay: DAY1 }));
    expect(keysOf(enough)).not.toContain('short');
    expect(keysOf(enough)).toContain('window_ahead');
    const max = planDay(makeInput({ now: at(DAY1, '20:00'), subjects: four(addDays(DAY1, 8)), items: fourItems(), budgetMin: 90, firstPlanDay: DAY1 }));
    expect(keysOf(max)).toContain('short_max');
  });

  it('every line the plan emits has a key words.ts knows and renders', () => {
    const plans: DayPlan[] = [];
    const sim = newSim({ subjects: four(addDays(DAY1, 10)), items: fourItems(30), budgetMin: 30, firstPlanDay: DAY1, seed: 'lines' });
    for (let d = 0; d < 12; d += 1) {
      const day = addDays(DAY1, d);
      if (d === 3) continue; // a skipped day
      plans.push(...sit(sim, at(day, '19:00')).plans, planDay(simInput(sim, at(day, '23:00'))));
    }
    const seen = new Set<string>();
    for (const p of plans) for (const line of p.lines) {
      expect(LINE_KEYS as readonly string[]).toContain(line.key);
      expect(lineText(line).length).toBeGreaterThan(5);
      seen.add(line.key);
    }
    expect([...seen]).toEqual(expect.arrayContaining(['skip', 'window_ahead', 'window_in', 'done', 'first_count', 'exam_today']));
  });
});

describe('determinism', () => {
  const now = at('2026-10-12', '19:00');
  const subjects = [{ id: 'a', date: '2026-10-30' }, { id: 'b', date: '2026-11-04' }, { id: 'o', date: '2026-11-04' }];
  const rnd = prng('det');
  const items = [
    ...withStates(testItems('a', 120, 12, 4), () => (rnd() < 0.5 ? stateAfter([{ at: at('2026-10-10', '20:00'), correct: rnd() < 0.6 }]) : undefined)),
    ...withStates(testItems('b', 80), () => (rnd() < 0.3 ? stateAfter([{ at: at('2026-10-11', '21:00'), correct: true }]) : undefined)),
    ...oralItems('o', 20, { sc: '2026-10-11', rating: 3 }),
  ];
  const input = makeInput({ now, subjects, items, budgetMin: 45, firstPlanDay: '2026-10-05', ai: { left: 60, resetsAt: Date.UTC(2026, 9, 13) } });

  it('the same input gives the identical plan, and the input is not touched', () => {
    const copy = JSON.parse(JSON.stringify(input)) as PlanInput;
    const a = planDay(input);
    const b = planDay(JSON.parse(JSON.stringify(input)) as PlanInput);
    expect(b).toEqual(a);
    expect(input).toEqual(copy);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it('the order of the input items does not matter', () => {
    const shuffledItems = [...items].reverse();
    expect(planDay({ ...input, items: shuffledItems })).toEqual(planDay(input));
  });

  it('new questions go in file order, topics in turn', () => {
    const p = planDay(makeInput({ now, subjects: [{ id: 'a', date: '2026-12-30' }], items: testItems('a', 60, 20), budgetMin: 10 }));
    expect(ofSubject(p, 'a').slice(0, 6)).toEqual(['a-t0001', 'a-t0021', 'a-t0041', 'a-t0002', 'a-t0022', 'a-t0042']);
  });

  it('times in the lines are in the plan\'s zone', () => {
    const items2 = withStates(testItems('a', 2), () => stateAfter([{ at: at('2026-10-11', '21:00', 'Asia/Tokyo'), correct: true }], null, 'Asia/Tokyo'));
    const p = planDay(makeInput({ tz: 'Asia/Tokyo', now: at('2026-10-12', '08:00', 'Asia/Tokyo'), firstAt: at('2026-10-12', '08:00', 'Asia/Tokyo'),
      subjects: [{ id: 'a', date: '2026-11-01' }], items: items2 }));
    expect(p.day).toBe('2026-10-12');
    expect(p.lines.find((l) => l.key === 'later')?.time).toBe('17:00');
    expect(clockText(p.next as number, 'Asia/Tokyo')).toBe('17:00');
  });
});

describe('helpers for the screens', () => {
  it('«План по дням»: study days, the window without minutes, the exam day', () => {
    const rows = daysAhead(makeInput({ now: at('2026-10-10', '09:00'), subjects: [{ id: 'a', date: '2026-10-28' }], items: testItems('a', 200), budgetMin: 45, firstPlanDay: '2026-10-08' }));
    expect(rows.map((r) => [r.from, r.to, r.kind])).toEqual([
      ['2026-10-10', '2026-10-23', 'study'], ['2026-10-24', '2026-10-27', 'window'], ['2026-10-28', '2026-10-28', 'exam'],
    ]);
    expect(rows[0].minutes).toBeLessThanOrEqual(45);
    expect(rows[1].minutes).toBeNull();
    expect(daysAhead(makeInput({ now: at('2026-10-10', '09:00'), subjects: [{ id: 'a', date: null }], items: testItems('a', 5) }))).toEqual([]);
  });

  it('«Как на экзамене» is offered from half seen, every 4th day, on the first window day, once a day', () => {
    expect(mockOffered({ day: '2026-10-10', seen: 100, inPlan: 240, lastRunDay: null, windowFrom: null })).toBe(false);
    expect(mockOffered({ day: '2026-10-10', seen: 120, inPlan: 240, lastRunDay: null, windowFrom: null })).toBe(true);
    expect(mockOffered({ day: '2026-10-10', seen: 200, inPlan: 240, lastRunDay: '2026-10-08', windowFrom: null })).toBe(false);
    expect(mockOffered({ day: '2026-10-12', seen: 200, inPlan: 240, lastRunDay: '2026-10-08', windowFrom: null })).toBe(true);
    expect(mockOffered({ day: '2026-10-24', seen: 50, inPlan: 240, lastRunDay: '2026-10-22', windowFrom: '2026-10-24' })).toBe(true);
    expect(mockOffered({ day: '2026-10-24', seen: 200, inPlan: 240, lastRunDay: '2026-10-24', windowFrom: '2026-10-24' })).toBe(false);
  });

  it('empty input: «empty»', () => {
    const p = planDay(makeInput({ now: at('2026-10-10', '09:00'), subjects: [{ id: 'a', date: '2026-10-28' }], items: [] }));
    expect(p.state).toBe('empty');
    expect(p.sessions).toEqual([]);
    expect(p.units).toBeNull();
  });
});
