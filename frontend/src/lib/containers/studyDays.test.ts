import { describe, expect, it } from 'vitest';
import type { DayPlan, PlanInput } from '../../types/container';
import { daysAhead, extraNew, feasibility, oralToPrepare, planDay, subjectInfo, windowDays, windowStart } from './plan.ts';
import { EVERY_DAY, addDays, daysBetween, isStudyDay, studyDayBefore, studyDayFrom, studyDaysBetween, studyMask, weekday } from './time.ts';
import { dayRowText, lineText, planLine, planTitle } from './words.ts';
import { planVectorCases } from './__fixtures__/planVectors.ts';
import { at, makeInput, newSim, simInput, simSeen, sit, stateAfter, testItems } from './__fixtures__/scenarios.ts';
import { inputAt, newServer, record } from './__fixtures__/server.ts';

/**
 * The student's days of the week (settings.study_weekdays, spec §3 «минуты и дни недели»): every count of days to a
 * date counts only study days, a day off has no plan (the line says when the next study day is, «Ещё 20 новых» stays),
 * and every day (127, or no setting at all) is the plan as it always was.
 */

const MON = '2026-10-05'; // a Monday
const THU = '2026-10-08';
const FRI = '2026-10-09';
const SAT = '2026-10-10';
const NEXT_MON = '2026-10-12';
const MON_FRI = 31; // Пн–Пт
const ru = (s: string) => s.replace(/\u00a0/g, ' ');
const keys = (plan: DayPlan) => plan.lines.map((l) => l.key);
const lineOf = (plan: DayPlan, key: string) => plan.lines.find((l) => l.key === key);
const count = (plan: DayPlan) => plan.counts.newItems + plan.counts.reviews + plan.counts.oral;

describe('the days of the week (time.ts)', () => {
  it('read the mask: Monday = 1 … Sunday = 64; anything but an integer 1..127 is every day', () => {
    expect(weekday(MON)).toBe(0);
    expect([31, 1, 64, 127].map(studyMask)).toEqual([31, 1, 64, 127]);
    for (const bad of [0, 128, -1, 1.5, Number.NaN, null, undefined, '31']) expect(studyMask(bad)).toBe(EVERY_DAY);
    expect(isStudyDay(MON, 1)).toBe(true);
    expect(isStudyDay(addDays(MON, 6), 64)).toBe(true); // Sunday
    expect(isStudyDay(SAT, MON_FRI)).toBe(false);
    expect(isStudyDay(SAT, 0)).toBe(true); // a broken mask is every day
  });

  it('count study days as a walk over the calendar would, for every mask', () => {
    for (let mask = 1; mask <= EVERY_DAY; mask += 1) {
      for (let start = 0; start < 7; start += 1) {
        const from = addDays(MON, start);
        let walked = 0;
        for (let n = 0; n <= 23; n += 1) {
          const to = addDays(from, n);
          expect(studyDaysBetween(from, to, mask), `${mask} ${from} +${n}`).toBe(walked);
          if (isStudyDay(to, mask)) walked += 1;
        }
        const on = studyDayFrom(from, mask);
        expect(isStudyDay(on, mask)).toBe(true);
        expect(studyDaysBetween(from, on, mask)).toBe(0);
        const before = studyDayBefore(from, mask);
        expect(isStudyDay(before, mask)).toBe(true);
        expect(before < from).toBe(true);
        expect(studyDaysBetween(addDays(before, 1), from, mask)).toBe(0);
      }
    }
    expect(studyDaysBetween(MON, addDays(MON, 400), EVERY_DAY)).toBe(400);
    expect(studyDaysBetween(MON, addDays(MON, -3), MON_FRI)).toBe(0);
  });
});

describe('every day is the plan as it always was', () => {
  it('the final window: W = min(4, ⌊D0/3⌋) over study days; every day, over calendar days, from date − W', () => {
    for (let d0 = -3; d0 <= 30; d0 += 1) {
      const date = addDays(MON, d0);
      expect(windowDays(MON, date, EVERY_DAY)).toBe(Math.max(0, Math.min(4, Math.floor(daysBetween(MON, date) / 3))));
      expect(windowDays(MON, date)).toBe(windowDays(MON, date, EVERY_DAY));
      const w = windowDays(MON, date);
      expect(windowStart(date, w)).toBe(w > 0 ? addDays(date, -w) : null);
    }
    // Пн–Пт: a week to a Monday holds 5 study days (W = 1); the window of 4 before Monday 2 November is Tue–Fri.
    expect(windowDays(MON, NEXT_MON, MON_FRI)).toBe(1);
    expect(windowDays(MON, NEXT_MON)).toBe(2);
    expect(windowStart('2026-11-02', 4, MON_FRI)).toBe('2026-10-27');
  });

  it('a plan input without the setting plans exactly as one with every day', () => {
    for (const c of planVectorCases()) {
      if (c.input.studyWeekdays !== undefined) continue;
      const every: PlanInput = { ...c.input, studyWeekdays: EVERY_DAY };
      expect(planDay(every), c.name).toEqual(planDay(c.input));
      expect(daysAhead(every), c.name).toEqual(daysAhead(c.input));
      expect(feasibility(every), c.name).toEqual(feasibility(c.input));
      expect(extraNew(every), c.name).toEqual(extraNew(c.input));
      expect(oralToPrepare(every, planDay(every)), c.name).toEqual(oralToPrepare(c.input, planDay(c.input)));
      for (const s of c.input.subjects) expect(subjectInfo(every, s.id), c.name).toEqual(subjectInfo(c.input, s.id));
    }
  });
});

describe('five study days a week (Пн–Пт) to a date', () => {
  const subjects = [{ id: 'a', date: addDays(MON, 28) }]; // Monday 2 November
  const input = (mask?: number) => makeInput({ now: at(MON, '19:00'), subjects, items: testItems('a', 300, 20), budgetMin: 45, firstPlanDay: MON, studyWeekdays: mask });

  it('spreads the new questions over the study days: more a day, the final days are the last 4 study days', () => {
    const every = planDay(input());
    const week = planDay(input(MON_FRI));
    // 300 new over 24 days (5–28 October) → 13 a day; over 16 study days (5–26 October) → 19.
    expect(every.coverage.floor).toBe(13);
    expect(week.coverage.floor).toBe(19);
    expect(every.window).toEqual({ from: '2026-10-29', days: 4, inWindow: false });
    expect(week.window).toEqual({ from: '2026-10-27', days: 4, inWindow: false });
    expect(every.coverage.lastNewDay).toBe('2026-10-28');
    expect(week.coverage.lastNewDay).toBe('2026-10-26');
    expect(lineOf(week, 'window_ahead')).toEqual({ key: 'window_ahead', n: [4], day: '2026-10-27' });
    // the minutes needed are per study day
    expect(feasibility(input(MON_FRI)).neededMin).toBeGreaterThan(feasibility(input()).neededMin);
  });

  it('«План по дням»: no row for a day off; study days on either side of a weekend stay one row', () => {
    const rows = (mask?: number) => daysAhead(input(mask)).map((row) => ru(dayRowText(row)));
    expect(rows()).toEqual(['5–28 октября — около 20 минут в день', '29 октября – 1 ноября — новых нет, только знакомые, сначала ошибки', '2 ноября — экзамен']);
    expect(rows(MON_FRI)).toEqual(['5–26 октября — около 25 минут в день', '27–30 октября — новых нет, только знакомые, сначала ошибки', '2 ноября — экзамен']);
    // the exam's day has its row even when it is not a study day
    const sunday = daysAhead(makeInput({ now: at(MON, '19:00'), subjects: [{ id: 'a', date: '2026-11-01' }], items: testItems('a', 50), firstPlanDay: MON, studyWeekdays: MON_FRI }));
    expect(sunday[sunday.length - 1]).toEqual({ from: '2026-11-01', to: '2026-11-01', kind: 'exam', minutes: null, subjectIds: ['a'] });
  });

  it('a steady student sees every question before the final days, never on a day off, never past the minutes', () => {
    const sim = newSim({ subjects, items: testItems('a', 300, 20), budgetMin: 45, firstPlanDay: MON, seed: 'week', studyWeekdays: MON_FRI });
    for (let d = 0; d < 28; d += 1) {
      const day = addDays(MON, d);
      const plan = planDay(simInput(sim, at(day, '19:00')));
      const { answered } = sit(sim, at(day, '19:00'));
      const spent = (sim.days.get(day)?.doneSec ?? 0) / 60;
      if (isStudyDay(day, MON_FRI)) {
        expect(plan.state, day).toBe('study');
        expect(spent, day).toBeLessThanOrEqual(46);
      } else {
        expect(plan.state, day).toBe('nothing');
        expect(plan.sessions, day).toEqual([]);
        expect(answered, day).toBe(0);
      }
      if (day === '2026-10-26') expect(simSeen(sim)).toBe(300); // the last day of new questions
    }
  });
});

describe('a day off', () => {
  // Thursday: 10 wrong answers and 10 right ones (their second day is due from Friday 15:00).
  const thursday = testItems('a', 120, 20).map((item, i) => {
    if (i < 10) return { ...item, u: stateAfter([{ at: at(THU, '19:00') + i * 30_000, correct: false }]) };
    if (i < 20) return { ...item, u: stateAfter([{ at: at(THU, '19:10') + i * 30_000, correct: true }]) };
    return item;
  });
  const subjects = [{ id: 'a', date: addDays(MON, 35) }];
  const on = (day: string, mask?: number, hhmm = '10:00') => makeInput({ now: at(day, hhmm), subjects, items: thursday, budgetMin: 45, firstPlanDay: MON, studyWeekdays: mask });

  it('has no plan: the mistakes and the second days wait for the next study day, and the line says when', () => {
    expect(planDay(on(SAT)).state).toBe('study'); // every day: Saturday is a study day
    const plan = planDay(on(SAT, MON_FRI));
    expect(plan.state).toBe('nothing');
    expect(plan.sessions).toEqual([]);
    expect(count(plan)).toBe(0);
    expect(plan.counts.leftSec).toBe(0);
    expect(keys(plan)).not.toContain('nothing');
    expect(keys(plan)).not.toContain('skip');
    expect(lineOf(plan, 'day_off')).toEqual({ key: 'day_off', n: [2], day: NEXT_MON });
    expect(ru(planTitle(plan))).toBe('Сегодня выходной');
    expect(ru(planLine(plan))).toBe('Сегодня выходной. Следующие вопросы — в понедельник.');
    // the first count waits for a study day too
    expect(lineOf(plan, 'first_count')).toEqual({ key: 'first_count', n: [2], day: NEXT_MON });
    // studying anyway: «Ещё 20 новых»
    expect(lineOf(plan, 'more_new')).toEqual({ key: 'more_new', n: [20] });
    expect(extraNew(on(SAT, MON_FRI), 20, plan)?.ids).toHaveLength(20);
    // Monday plans what waited: the mistakes and the second days first
    const monday = planDay(on(NEXT_MON, MON_FRI));
    expect(monday.state).toBe('study');
    expect(monday.counts.reviews).toBe(20);
    expect(keys(monday)).not.toContain('day_off');
  });

  it('names the next study day: tomorrow, its weekday within the week', () => {
    expect(lineOf(planDay(on(SAT, MON_FRI + 64)), 'day_off')).toEqual({ key: 'day_off', n: [1], day: '2026-10-11' }); // Sunday on
    expect(ru(lineText({ key: 'day_off', n: [1], day: '2026-10-11' }))).toBe('Сегодня выходной. Следующие вопросы — завтра.');
    const tuesday = makeInput({ now: at('2026-10-06', '10:00'), subjects, items: testItems('a', 50), firstPlanDay: MON, studyWeekdays: 1 }); // Mondays only
    expect(lineOf(planDay(tuesday), 'day_off')).toEqual({ key: 'day_off', n: [6], day: NEXT_MON });
  });

  it('the exam\'s own day stays the exam day', () => {
    const plan = planDay(makeInput({ now: at(SAT, '08:00'), subjects: [{ id: 'a', date: SAT }], items: thursday, firstPlanDay: MON, studyWeekdays: MON_FRI }));
    expect(plan.state).toBe('exam_today');
    expect(keys(plan)).toEqual(['exam_today', 'exam_errors']);
  });
});

describe('the last study day before the exam', () => {
  // At «два разных дня» since Monday 26 October, nothing due before the exam on Monday 2 November: the final pass.
  const items = testItems('a', 30).map((item, i) => ({
    ...item,
    u: stateAfter([{ at: at('2026-10-25', '09:00'), correct: true }, { at: at('2026-10-26', '09:00') + i * 1000, correct: true }]),
  }));
  const friday = (mask?: number) => planDay(makeInput({ now: at('2026-10-30', '10:00'), subjects: [{ id: 'a', date: '2026-11-02' }], items, budgetMin: 60,
    firstPlanDay: '2026-10-01', studyWeekdays: mask }));

  it('takes all that is left of the final pass (no study day after it); every day spreads it over the 3 days left', () => {
    expect(friday().counts.reviews).toBe(10); // ⌈30 / 3⌉
    expect(friday(MON_FRI).counts.reviews).toBe(30); // Friday, then the weekend off, then the exam
    // the line about the date counts calendar days
    expect(ru(lineText(lineOf(friday(MON_FRI), 'window_in')!))).toBe('До экзамена 3 дня: новых нет, только знакомые.');
  });
});

describe('days missed, the first count and «На сегодня всё» across days off', () => {
  const subjects = [{ id: 'a', date: addDays(MON, 35) }];

  it('a weekend off is not missed; a study day missed before it is «1 день без занятий»', () => {
    const last = (day: string) => testItems('a', 60).map((item, i) => (i < 10 ? { ...item, u: stateAfter([{ at: at(day, '19:00') + i * 30_000, correct: true }]) } : item));
    const monday = (day: string, mask?: number) => planDay(makeInput({ now: at(NEXT_MON, '10:00'), subjects, items: last(day), firstPlanDay: MON, studyWeekdays: mask }));
    expect(keys(monday(FRI, MON_FRI))).not.toContain('skip');
    expect(lineOf(monday(THU, MON_FRI), 'skip')).toEqual({ key: 'skip', n: [1, 60], day: FRI });
    expect(ru(lineText(lineOf(monday(THU, MON_FRI), 'skip')!))).toBe('1 день без занятий. Сегодня те же 60 минут — больше знакомых вопросов.');
    // every day: as before
    expect(lineOf(monday(FRI), 'skip')).toEqual({ key: 'skip', n: [2, 60] });
  });

  it('the first questions count on a study day: Friday evening → Monday, not «завтра»', () => {
    const items = testItems('a', 120, 20).map((item, i) => (i < 12 ? { ...item, u: stateAfter([{ at: at(FRI, '19:00') + i * 30_000, correct: true }]) } : item));
    const evening = (mask?: number) => planDay(makeInput({ now: at(FRI, '22:00'), firstAt: at(FRI, '19:00'), doneSec: 2700, newDone: { a: 12 }, subjects, items,
      budgetMin: 45, firstPlanDay: MON, studyWeekdays: mask }));
    expect(lineOf(evening(), 'first_count')).toEqual({ key: 'first_count', n: [1], day: SAT, time: '15:00' });
    expect(lineOf(evening(MON_FRI), 'first_count')).toEqual({ key: 'first_count', n: [3], day: NEXT_MON });
    expect(evening(MON_FRI).firstCountDay).toBe(NEXT_MON);
  });

  it('«На сегодня всё. Следующие вопросы —» the next study day', () => {
    const items = testItems('a', 12).map((item, i) => ({ ...item, u: stateAfter([{ at: at('2026-10-01', '09:00'), correct: true }, { at: at(MON, '09:00') + i * 1000, correct: true }]) }));
    const friday = (mask?: number) => planDay(makeInput({ now: at(FRI, '10:00'), subjects: [{ id: 'a', date: '2026-12-01' }], items, firstPlanDay: '2026-10-01', studyWeekdays: mask }));
    expect(lineOf(friday(), 'nothing')).toEqual({ key: 'nothing', n: [1], day: SAT });
    expect(lineOf(friday(MON_FRI), 'nothing')).toEqual({ key: 'nothing', n: [3], day: NEXT_MON });
    expect(friday(MON_FRI).next).toBe(at(NEXT_MON, '00:00'));
  });
});

describe('the frozen day with days of the week', () => {
  const server = () => newServer({ subjects: [{ id: 'a', date: '2026-11-20' }], items: testItems('a', 200, 20), budgetMin: 30, firstPlanDay: MON, studyWeekdays: MON_FRI });

  it('switching today off in «Настройки» re-plans to the day off; switching it back gives the frozen day again', () => {
    const s = server();
    let t = at('2026-10-06', '18:00'); // Tuesday
    const morning = planDay(inputAt(s, t));
    for (const id of morning.sessions[0].ids.slice(0, 10)) {
      record(s, id, { at: t, correct: true, ms: 30_000, cls: 'new_floor' });
      t += 30_000;
    }
    const studied = planDay(inputAt(s, t));
    expect(count(studied)).toBe(count(morning) - 10);
    s.studyWeekdays = MON_FRI - 2; // Tuesday off
    const off = planDay(inputAt(s, t));
    expect(off.state).toBe('done');
    expect(off.sessions).toEqual([]);
    expect(lineOf(off, 'day_off')).toEqual({ key: 'day_off', n: [1], day: '2026-10-07' });
    s.studyWeekdays = MON_FRI;
    expect(planDay(inputAt(s, t))).toEqual(studied);
  });

  it('studying on a day off: the day keeps no plan; switching the day on plans it as it began, without what was answered', () => {
    const s = server();
    let t = at(SAT, '11:00');
    const before = planDay(inputAt(s, t));
    expect(before.state).toBe('nothing');
    const extra = extraNew(inputAt(s, t), 20, before)!;
    for (const id of extra.ids) {
      record(s, id, { at: t, correct: true, ms: 20_000, cls: 'new_fill' });
      t += 20_000;
      const plan = planDay(inputAt(s, t));
      expect(plan.state).toBe('done');
      expect(plan.sessions).toEqual([]);
      expect(lineOf(plan, 'day_off')).toEqual({ key: 'day_off', n: [2], day: NEXT_MON });
    }
    s.studyWeekdays = MON_FRI + 32; // Saturday on
    const on = planDay(inputAt(s, t));
    expect(on.state).toBe('study');
    const ids = new Set(on.sessions.flatMap((session) => session.ids));
    for (const id of extra.ids) expect(ids.has(id)).toBe(false);
    expect(on.counts.leftSec).toBeLessThanOrEqual(30 * 60 - 400);
  });
});
