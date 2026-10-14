import { describe, expect, it } from 'vitest';
import type { DayPlan, PlanItem } from '../../types/container';
import { ALL_QUESTIONS_MIN, CLASS_ORDER_ALL, allQuestions, budgetSeconds, daysAhead, extraNew, feasibility, planDay } from './plan.ts';
import { inFigure, isSeen } from './rule.ts';
import { addDays } from './time.ts';
import { lineText, planTitle } from './words.ts';
import { at, makeInput, newSim, simInput, simSeen, sit, testItems } from './__fixtures__/scenarios.ts';

/**
 * «Все вопросы» (the choice after 90 minutes; the owner's case of 2026-10-14): three subjects of about 370 questions,
 * a test in three days. Every question is shown before the final day, a mistake comes back, a question answered right
 * is checked once more on another day, and nothing else is added (no final pass).
 */
const DAY1 = '2026-10-14';
const EXAM = '2026-10-17';
const SUBJECTS = [{ id: 'kp', date: EXAM }, { id: 'trpo', date: EXAM }, { id: 'tpo', date: EXAM }];
const ITEMS: PlanItem[] = [...testItems('kp', 374, 27, 8), ...testItems('trpo', 373, 27), ...testItems('tpo', 373, 27, 12)];
const keys = (plan: DayPlan) => plan.lines.map((line) => line.key);

describe('the choice', () => {
  it('is minutes_per_day 300, the database top; the day has no minutes cap', () => {
    expect(ALL_QUESTIONS_MIN).toBe(300);
    expect([30, 90, 299, 300, 301, Number.NaN, undefined, null].map(allQuestions)).toEqual([false, false, false, true, true, false, false, false]);
    expect(budgetSeconds(300)).toBe(Infinity);
    expect(budgetSeconds(60)).toBe(3600);
    expect(budgetSeconds(undefined)).toBe(0);
    expect(CLASS_ORDER_ALL.slice(0, 3)).toEqual(['relearn', 'new_floor', 'confirm']);
  });
});

describe('day 1 of 1120 questions three days before the test', () => {
  const input = (budgetMin: number) => makeInput({ now: at(DAY1, '09:00'), budgetMin, subjects: SUBJECTS, items: ITEMS });

  it('takes every new question of the day evenly: ⌈374/2⌉ + ⌈373/2⌉ × 2, the last day before the window', () => {
    const plan = planDay(input(ALL_QUESTIONS_MIN));
    expect(plan.counts.newItems).toBe(187 * 3);
    expect(plan.coverage.lastNewDay).toBe('2026-10-15');
    expect(plan.coverage.seenByDateEst).toBe(1120);
    expect(keys(plan)).not.toContain('short');
    expect(keys(plan)).not.toContain('short_max');
    // the card says hours, not «около 430 минут»
    expect(planTitle(plan).replace(/\u00a0/g, ' ')).toMatch(/^Сегодня 561 вопрос, около \d+(,5)? час/);
  });

  it('at 90 minutes the same exam sees far fewer and says the way out', () => {
    const plan = planDay(input(90));
    expect(plan.counts.newItems).toBeLessThan(150);
    const short = plan.lines.find((line) => line.key === 'short_max');
    expect(short && lineText(short)).toMatch(/Чтобы увидеть все, выберите «Все вопросы»\.$/);
  });

  it('feasibility: everything seen, no option, the hours a study day takes on average', () => {
    const f = feasibility(input(ALL_QUESTIONS_MIN));
    expect(f.seenByDateEst).toBe(1120);
    expect(f.option).toBeNull();
    // each new question once plus one more answer, over 3 study days: several hours, well under the minutes plan's 10
    expect(f.neededMin).toBeGreaterThan(300);
    expect(f.neededMin).toBeLessThan(feasibility(input(90)).neededMin);
  });

  it('«План по дням»: today at the card\'s minutes, the 15th at the average, the 16th without new, the 17th the test', () => {
    const inp = input(ALL_QUESTIONS_MIN);
    const rows = daysAhead(inp);
    expect(rows.map((row) => [row.from, row.kind])).toEqual([[DAY1, 'study'], ['2026-10-15', 'study'], ['2026-10-16', 'window'], [EXAM, 'exam']]);
    expect(rows[1].minutes).toBe(feasibility(inp).neededMin);
    expect(rows[2].minutes).toBeNull();
  });
});

describe('three days of study on «Все вопросы»', () => {
  it('sees all 1120 by the 15th; a day goes mistakes → new → the second check; the 16th is only what comes back', () => {
    const sim = newSim({ subjects: SUBJECTS, items: ITEMS, budgetMin: ALL_QUESTIONS_MIN, firstPlanDay: DAY1, seed: 'all-1120' });
    sit(sim, at(DAY1, '09:00'));
    expect(simSeen(sim)).toBeGreaterThanOrEqual(561);
    const wrongDay1 = new Set([...sim.states].filter(([, u]) => isSeen(u) && u.seriesAt === null).map(([id]) => id));
    const rightDay1 = new Set([...sim.states].filter(([, u]) => u.seriesAt !== null).map(([id]) => id));
    expect(wrongDay1.size).toBeGreaterThan(0);

    // Day 2, each subject in the order it is asked: the mistakes, then the new ones, then the second check of what
    // was right (sessions of 20 may hold the end of one and the start of the next).
    // (at 18:00, when every first answer of day 1 can count: 20 hours after it)
    const day2 = planDay(simInput(sim, at('2026-10-15', '18:00')));
    const rank = (id: string) => (wrongDay1.has(id) ? 0 : !sim.states.has(id) ? 1 : rightDay1.has(id) ? 2 : -1);
    for (const subject of SUBJECTS) {
      const order = day2.sessions.filter((s) => s.subjectId === subject.id).flatMap((s) => s.ids).map(rank);
      expect(order).not.toContain(-1);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(new Set(order)).toEqual(new Set([0, 1, 2]));
    }

    sit(sim, at('2026-10-15', '09:00'));
    expect(simSeen(sim)).toBe(1120);

    // Day 3 (the final day): no new questions, no extra final pass — exactly the questions not yet counted.
    const day3 = planDay(simInput(sim, at('2026-10-16', '09:00')));
    const open = [...sim.states.values()].filter((u) => isSeen(u) && !inFigure(u)).length;
    expect(day3.counts.newItems).toBe(0);
    expect(day3.counts.reviews).toBe(open);
    expect(day3.postponed.final).toBeUndefined();
    expect(extraNew(simInput(sim, at('2026-10-16', '09:00')))).toBeNull();
  });

  it('a missed day: no «те же N минут» line, the questions spread over the days left', () => {
    const later = '2026-10-24';
    const subjects = SUBJECTS.map((s) => ({ ...s, date: later }));
    const sim = newSim({ subjects, items: ITEMS, budgetMin: ALL_QUESTIONS_MIN, firstPlanDay: DAY1, seed: 'all-skip' });
    sit(sim, at(DAY1, '09:00'));
    const after = planDay(simInput(sim, at('2026-10-16', '09:00')));
    expect(keys(after)).not.toContain('skip');
    // 10 days, W = 3: new questions until the 20th; the 15th was missed, so the 16th takes more than the 14th did
    const first = planDay(makeInput({ now: at(DAY1, '09:00'), budgetMin: ALL_QUESTIONS_MIN, subjects, items: ITEMS }));
    expect(after.counts.newItems).toBeGreaterThan(first.counts.newItems);
    expect(after.coverage.lastNewDay).toBe(addDays(later, -4));
  });
});
