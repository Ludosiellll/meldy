import { describe, expect, it } from 'vitest';
import type { DayPlan, PlanItem } from '../../types/container';
import { ALL_QUESTIONS_MIN, daysAhead, fastForecast, planDay } from './plan.ts';
import { addDays } from './time.ts';
import { at, makeInput, newSim, simInput, simSeen, sit, testItems } from './__fixtures__/scenarios.ts';

/**
 * «Как можно быстрее» (owner, 2026-10-14: «добавить вариант "выучить побыстрее", а не по дате»): six variants of 160
 * questions as six subjects. The minutes a day are the only bound on new questions: no even spread to the date, no 15 a
 * day without one; a mistake and the second check on another day still come first.
 */
const DAY1 = '2026-10-14';
const SIX = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'];
const ITEMS: PlanItem[] = SIX.flatMap((id) => testItems(id, 160));
const keys = (plan: DayPlan) => plan.lines.map((line) => line.key);

function input(o: { budgetMin: number; tempo?: 'date' | 'fast'; date?: string | null; items?: PlanItem[]; ids?: string[] }) {
  const ids = o.ids ?? SIX;
  return makeInput({
    now: at(DAY1, '09:00'), budgetMin: o.budgetMin, subjects: ids.map((id) => ({ id, date: o.date ?? null })), items: o.items ?? ITEMS,
    ...(o.tempo ? { tempo: o.tempo } : {}),
  });
}

describe('one day', () => {
  it('without a date: as many new questions as the minutes hold, not 15 a subject; no «по 15 в день» line', () => {
    const one = testItems('v1', 160);
    const even = planDay(input({ budgetMin: 90, items: one, ids: ['v1'] }));
    const fast = planDay(input({ budgetMin: 90, items: one, ids: ['v1'], tempo: 'fast' }));
    expect(even.counts.newItems).toBe(15);
    expect(keys(even)).toContain('no_date');
    expect(fast.counts.newItems).toBeGreaterThan(60);
    expect(keys(fast)).not.toContain('no_date');
    // the minutes are still a hard cap
    expect(fast.counts.estSec).toBeLessThanOrEqual(90 * 60);
  });

  it('with a date a month away: more new today than the even spread', () => {
    const date = addDays(DAY1, 30);
    const even = planDay(input({ budgetMin: 90, date }));
    const fast = planDay(input({ budgetMin: 90, date, tempo: 'fast' }));
    expect(fast.counts.newItems).toBeGreaterThan(even.counts.newItems);
    expect(fast.counts.estSec).toBeLessThanOrEqual(90 * 60);
  });

  it('on «Все вопросы»: every one of the 960 today, each variant whole', () => {
    const plan = planDay(input({ budgetMin: ALL_QUESTIONS_MIN, tempo: 'fast' }));
    expect(plan.counts.newItems).toBe(960);
    for (const id of SIX) expect(plan.sessions.filter((s) => s.subjectId === id).flatMap((s) => s.ids)).toHaveLength(160);
  });
});

describe('the forecast under the minutes', () => {
  it('at 60 minutes: the study days to see all 960, then the day; every day a study day', () => {
    const f = fastForecast(input({ budgetMin: 60 }));
    expect(f).not.toBeNull();
    expect(f!.total).toBe(960);
    expect(f!.unseen).toBe(960);
    expect(f!.minutes).toBe(60);
    expect(f!.days).toBeGreaterThan(5);
    expect(f!.lastDay).toBe(addDays(DAY1, f!.days - 1));
    // more minutes, fewer days
    expect(fastForecast(input({ budgetMin: 90 }))!.days).toBeLessThan(f!.days);
  });

  it('on «Все вопросы»: today, and the minutes of the first pass', () => {
    const f = fastForecast(input({ budgetMin: ALL_QUESTIONS_MIN }))!;
    expect(f.lastDay).toBe(DAY1);
    expect(f.days).toBe(1);
    expect(f.minutes).toBeGreaterThan(300);
  });

  it('skips days off: Monday to Friday only', () => {
    // 2026-10-14 is a Wednesday
    const f = fastForecast({ ...input({ budgetMin: 60 }), studyWeekdays: 31 })!;
    const every = fastForecast(input({ budgetMin: 60 }))!;
    expect(f.days).toBe(every.days);
    expect(f.lastDay > every.lastDay).toBe(true);
  });

  it('nothing new: no forecast', () => {
    expect(fastForecast(input({ budgetMin: 60, items: [] }))).toBeNull();
  });

  it('«План по дням» with a date: the minutes a day until the forecast day, then familiar questions only', () => {
    const date = addDays(DAY1, 60);
    const inp = input({ budgetMin: 60, date, tempo: 'fast' });
    const f = fastForecast(inp)!;
    const rows = daysAhead(inp);
    const study = rows.filter((row) => row.kind === 'study');
    const tail = study.filter((row) => row.from > f.lastDay);
    expect(study.filter((row) => row.to <= f.lastDay && row.from > DAY1).every((row) => row.minutes === 60)).toBe(true);
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((row) => row.minutes === null)).toBe(true);
  });
});

describe('days of study, no date', () => {
  const run = (o: { ids: string[]; items: PlanItem[]; budgetMin: number; tempo: 'date' | 'fast'; days: number }) => {
    const sim = newSim({ subjects: o.ids.map((id) => ({ id, date: null })), items: o.items, budgetMin: o.budgetMin, firstPlanDay: DAY1, seed: `fast-${o.tempo}`, tempo: o.tempo });
    const seenBy: number[] = [];
    for (let k = 0; k < o.days; k += 1) {
      sit(sim, at(addDays(DAY1, k), '18:00'));
      seenBy.push(simSeen(sim));
    }
    return seenBy;
  };

  it('one variant of 160 at 60 minutes: all seen about when the forecast says, well before 15 a day would', () => {
    const one = testItems('v1', 160);
    const forecast = fastForecast(input({ budgetMin: 60, items: one, ids: ['v1'] }))!;
    const fast = run({ ids: ['v1'], items: one, budgetMin: 60, tempo: 'fast', days: forecast.days + 3 });
    const even = run({ ids: ['v1'], items: one, budgetMin: 60, tempo: 'date', days: forecast.days + 3 });
    const doneOn = fast.findIndex((n) => n === 160) + 1;
    expect(doneOn).toBeGreaterThan(0);
    expect(Math.abs(doneOn - forecast.days)).toBeLessThanOrEqual(2);
    // «Равномерно» without a date: 15 a day, 11 days for 160
    expect(even[doneOn - 1]).toBeLessThan(160);
  });

  it('six variants at 60 minutes: the forecast holds within two days (the minutes are the bound either way)', () => {
    const forecast = fastForecast(input({ budgetMin: 60 }))!;
    const fast = run({ ids: SIX, items: ITEMS, budgetMin: 60, tempo: 'fast', days: forecast.days + 3 });
    const doneOn = fast.findIndex((n) => n === 960) + 1;
    expect(doneOn).toBeGreaterThan(0);
    expect(Math.abs(doneOn - forecast.days)).toBeLessThanOrEqual(2);
  });
});
