/**
 * TEST ONLY: the plan vectors — small synthetic inputs with the plan `planDay` must return for each. The file
 * plan_vectors.json next to this one holds the same inputs with the expected plans, so another runtime (the Telegram
 * bot's Deno copy of the engine) can check itself against the same answers. planVectors.test.ts keeps the two equal.
 *
 * Regenerate after an intended change of the plan (from frontend/):
 *   node --experimental-strip-types --input-type=module -e "import { writeFileSync } from 'node:fs'; import { planVectorFile } from './src/lib/containers/__fixtures__/planVectors.ts'; writeFileSync('src/lib/containers/__fixtures__/plan_vectors.json', JSON.stringify(planVectorFile(), null, 1) + '\n');"
 */
import type { DayPlan, PlanInput, PlanItem } from '../../../types/container.ts';
import { planDay } from '../plan.ts';
import { addDays } from '../time.ts';
import { at, makeInput, oralItems, stateAfter, testItems } from './scenarios.ts';

export interface PlanVector { name: string; about: string; input: PlanInput }
export interface PlanVectorFile { v: 1; about: string; cases: Array<PlanVector & { expect: DayPlan }> }

const D = '2026-10-07';

function states(items: PlanItem[], pick: (item: PlanItem, i: number) => PlanItem['u']): PlanItem[] {
  return items.map((item, i) => {
    const u = pick(item, i);
    return u ? { ...item, u } : item;
  });
}

export function planVectorCases(): PlanVector[] {
  const day2 = addDays(D, 1);
  const busItems = states(testItems('a', 60, 10), (_, i) => {
    if (i < 20) return stateAfter([{ at: at(D, '21:00') + i * 40_000, correct: true }]);
    if (i < 30) return stateAfter([{ at: at(D, '21:20') + i * 40_000, correct: false }]);
    return undefined;
  });
  const twoDays = (i: number) => stateAfter([{ at: at('2026-10-17', '09:00'), correct: true }, { at: at('2026-10-18', '09:00') + i * 1000, correct: true }]);
  const ai = { left: 14, resetsAt: Date.UTC(2026, 9, 11, 0, 0) };

  return [
    {
      name: 'first_day_preview',
      about: 'two subjects, one date 21 days ahead, nothing answered: the preview at 08:00 (floor, then up to 100 new within 45 min)',
      input: makeInput({ now: at(D, '08:00'), subjects: [{ id: 'a', date: addDays(D, 21) }, { id: 'b', date: addDays(D, 21) }],
        items: [...testItems('a', 40, 10, 4), ...testItems('b', 40, 10)], budgetMin: 45, firstPlanDay: D }),
    },
    {
      name: 'bus_morning',
      about: 'first evening at 21:00 (20 right, 10 wrong); 08:10 the next day, frozen: mistakes and new now, the 20 confirmations «после 17:00» (decision 32)',
      input: makeInput({ now: at(day2, '08:10'), firstAt: at(day2, '08:10'), subjects: [{ id: 'a', date: addDays(D, 21) }], items: busItems, budgetMin: 30, firstPlanDay: D }),
    },
    {
      name: 'bus_evening',
      about: 'the same day at 23:00, frozen at 08:10 with 300 s done: the confirmations are ready now',
      input: makeInput({ now: at(day2, '23:00'), firstAt: at(day2, '08:10'), doneSec: 300, subjects: [{ id: 'a', date: addDays(D, 21) }],
        items: states(busItems, (item, i) => (i >= 20 && i < 30 ? stateAfter([{ at: at(D, '21:20'), correct: false }, { at: at(day2, '08:10') + i * 30_000, correct: true }]) : item.u)),
        budgetMin: 30, firstPlanDay: D, newDone: { a: 0 } }),
    },
    {
      name: 'skip_day',
      about: 'the last answers two days ago: «Вчера без занятий. Сегодня те же 60 минут — больше знакомых вопросов.»',
      input: makeInput({ now: at(D, '09:00'), subjects: [{ id: 'a', date: addDays(D, 20) }],
        items: states(testItems('a', 30), (_, i) => (i < 12 ? stateAfter([{ at: at(addDays(D, -2), '20:00'), correct: i % 3 !== 0 }]) : undefined)), budgetMin: 60, firstPlanDay: addDays(D, -5) }),
    },
    {
      name: 'no_date',
      about: 'no date: 15 new a day per subject, no window, the no-date line',
      input: makeInput({ now: at(D, '18:00'), subjects: [{ id: 'a', date: null }, { id: 'b', date: null }], items: [...testItems('a', 40), ...testItems('b', 40)], budgetMin: 60 }),
    },
    {
      name: 'exam_today',
      about: 'D = 0: no plan; «Сегодня экзамен.» and quietly the questions with mistakes',
      input: makeInput({ now: at('2026-10-20', '08:00'), subjects: [{ id: 'a', date: '2026-10-20' }],
        items: states(testItems('a', 30), (_, i) => (i < 7 ? stateAfter([{ at: at('2026-10-18', '20:00'), correct: false }]) : undefined)), firstPlanDay: '2026-10-01' }),
    },
    {
      name: 'after_date',
      about: 'D < 0: the subject left the plan; the figure stays',
      input: makeInput({ now: at('2026-10-30', '08:00'), subjects: [{ id: 'a', date: '2026-10-28' }],
        items: states(testItems('a', 10), (_, i) => (i < 4 ? twoDays(i) : undefined)), firstPlanDay: '2026-10-01' }),
    },
    {
      name: 'window_final',
      about: 'inside the window (date 2026-10-24, W = 4): the final pass takes ⌈40 / 4⌉ = 10, weakest first; of the 10 never seen, only the leftover share ⌈10 / 4⌉ = 3',
      input: makeInput({ now: at('2026-10-20', '10:00'), subjects: [{ id: 'a', date: '2026-10-24' }],
        items: states(testItems('a', 50), (_, i) => (i < 40 ? twoDays(i) : undefined)), budgetMin: 60, firstPlanDay: '2026-10-01' }),
    },
    {
      name: 'mixed_dates',
      about: 'three subjects: near (window soon), far, and one whose date passed; mistakes of the nearest first',
      input: makeInput({ now: at('2026-10-20', '10:00'), subjects: [{ id: 'far', date: '2026-11-25' }, { id: 'near', date: '2026-10-26' }, { id: 'gone', date: '2026-10-15' }],
        items: ['far', 'near', 'gone'].flatMap((id) => states(testItems(id, 15), (_, i) => (i < 3 ? stateAfter([{ at: at('2026-10-15', '10:00'), correct: false }]) : undefined))),
        budgetMin: 30, firstPlanDay: '2026-10-01' }),
    },
    {
      name: 'oral_units',
      about: 'tests with an oral subject: new self-checks, AI checks only after «Знаю» (confirmations first), never after «Плаваю»; 14 AI units left stop the third AI check',
      input: makeInput({ now: at('2026-10-10', '10:00'), subjects: [{ id: 't', date: '2026-11-10' }, { id: 'o', date: '2026-11-10' }], ai,
        items: [
          ...testItems('t', 20),
          ...oralItems('o', 12),
          ...oralItems('o', 3, { sc: '2026-10-09', rating: 3 }).map((q, i) => ({ ...q, id: `o-ready-${i}`, o: 100 + i })),
          ...oralItems('o', 1, { sc: '2026-10-08', rating: 3, ac: '2026-10-08' }).map((q) => ({ ...q, id: 'o-conf', o: 200, l: [stateAfter([{ at: at('2026-10-08', '10:00'), correct: true }])] })),
          ...oralItems('o', 2, { sc: '2026-10-09', rating: 2 }).map((q, i) => ({ ...q, id: `o-shaky-${i}`, o: 300 + i })),
        ],
        budgetMin: 60, firstPlanDay: '2026-10-01' }),
    },
    {
      name: 'short_budget',
      about: '240 questions in 6 days at 30 min: the honest line about what will be seen and the minutes needed',
      input: makeInput({ now: at(D, '19:00'), subjects: [{ id: 'a', date: addDays(D, 6) }], items: testItems('a', 240, 20, 5), budgetMin: 30, firstPlanDay: D }),
    },
    {
      name: 'done_today',
      about: 'today\'s minutes spent (frozen at 18:00, 1790 s of 30 min done): «На сегодня всё» with «Ещё 20 новых»',
      input: makeInput({ now: at(D, '21:00'), firstAt: at(D, '18:00'), doneSec: 1790, newDone: { a: 30 }, subjects: [{ id: 'a', date: addDays(D, 25) }],
        items: states(testItems('a', 120), (_, i) => (i < 30 ? stateAfter([{ at: at(D, '18:00') + i * 50_000, correct: i % 4 !== 0 }]) : undefined)), budgetMin: 30, firstPlanDay: D }),
    },
    {
      name: 'nothing_due',
      about: 'every question at «два разных дня», none due: «На сегодня всё. Следующие вопросы — …» with the moment',
      input: makeInput({ now: at('2026-10-20', '10:00'), subjects: [{ id: 'a', date: '2026-12-01' }], items: states(testItems('a', 12), (_, i) => twoDays(i)), firstPlanDay: '2026-10-01' }),
    },
    {
      name: 'frozen_day_start',
      about: 'frozen at 09:00 with the day as it began (dayStart, paceDay): eight mistakes of yesterday answered right today and two new ones, slowly (1450 s of 30 min): the morning\'s target without them, as many as the cheapest fit the real minutes left, planned with the pace of the day\'s start (today\'s faster pace ignored)',
      input: {
        ...makeInput({ now: at(day2, '09:40'), firstAt: at(day2, '09:00'), doneSec: 1450, newDone: { a: 2 }, subjects: [{ id: 'a', date: addDays(D, 21) }],
          items: states(testItems('a', 80, 10), (_, i) => {
            if (i < 15) return stateAfter([{ at: at(D, '08:00') + i * 30_000, correct: true }]);
            if (i < 25) return stateAfter([{ at: at(D, '08:10') + i * 30_000, correct: false }, ...(i < 23 ? [{ at: at(day2, '09:00') + i * 20_000, correct: true }] : [])]);
            if (i < 27) return stateAfter([{ at: at(day2, '09:05') + i * 20_000, correct: i === 25 }]);
            return undefined;
          }), budgetMin: 30, firstPlanDay: D }),
        pace: { a: { tNew: 9, tRev: 6, tWrong: 10, tRetry: 12, tSC: 60, tAC: 150, pWrong: { new: 0.1, relearn: 0.1, confirm: 0.05, check: 0.05, final: 0.05 } } },
        paceDay: null,
        dayStart: Object.fromEntries(testItems('a', 80, 10).slice(15, 23).map((item, k) => [item.id, stateAfter([{ at: at(D, '08:10') + (15 + k) * 30_000, correct: false }])])),
      },
    },
    {
      name: 'weekdays_five_days',
      about: 'Пн–Пт (study_weekdays 31), Monday 5 October, 300 new, the exam on Monday 2 November: the floor spreads over the 16 study days to the window (19 a day, every day 13), the window is the last 4 study days (27–30 October)',
      input: makeInput({ now: at('2026-10-05', '19:00'), subjects: [{ id: 'a', date: '2026-11-02' }], items: testItems('a', 300, 20), budgetMin: 45,
        firstPlanDay: '2026-10-05', studyWeekdays: 31 }),
    },
    {
      name: 'weekdays_day_off',
      about: 'Пн–Пт, Saturday 10 October: no plan — Thursday\'s mistakes and second days wait for Monday; «Сегодня выходной. Следующие вопросы — в понедельник.», the first count on Monday, «Ещё 20 новых»',
      input: makeInput({ now: at('2026-10-10', '10:00'), subjects: [{ id: 'a', date: '2026-11-09' }], budgetMin: 45, firstPlanDay: '2026-10-05', studyWeekdays: 31,
        items: states(testItems('a', 120, 20), (_, i) => {
          if (i < 10) return stateAfter([{ at: at('2026-10-08', '19:00') + i * 30_000, correct: false }]);
          if (i < 20) return stateAfter([{ at: at('2026-10-08', '19:10') + i * 30_000, correct: true }]);
          return undefined;
        }) }),
    },
    {
      name: 'weekdays_last_study_day',
      about: 'Пн–Пт, Friday 30 October, the exam on Monday 2 November: the last study day takes all of the final pass that is left (30; every day would take ⌈30 / 3⌉ = 10)',
      input: makeInput({ now: at('2026-10-30', '10:00'), subjects: [{ id: 'a', date: '2026-11-02' }], budgetMin: 60, firstPlanDay: '2026-10-01', studyWeekdays: 31,
        items: states(testItems('a', 30), (_, i) => stateAfter([{ at: at('2026-10-25', '09:00'), correct: true }, { at: at('2026-10-26', '09:00') + i * 1000, correct: true }])) }),
    },
    {
      name: 'dst_berlin',
      about: 'Europe/Berlin on its 25-hour day: confirmations from the evening before are «после» a local time',
      input: makeInput({ tz: 'Europe/Berlin', now: at('2026-10-25', '08:10', 'Europe/Berlin'), firstAt: at('2026-10-25', '08:10', 'Europe/Berlin'),
        subjects: [{ id: 'a', date: '2026-11-20' }],
        items: states(testItems('a', 20), (_, i) => (i < 8 ? stateAfter([{ at: at('2026-10-24', '21:00', 'Europe/Berlin') + i * 60_000, correct: true }], null, 'Europe/Berlin') : undefined)),
        budgetMin: 30, firstPlanDay: '2026-10-20' }),
    },
  ];
}

export function planVectorFile(): PlanVectorFile {
  return {
    v: 1,
    about: 'planDay vectors (package D2): for each synthetic input, the exact DayPlan. Inputs and plans are plain JSON (epoch ms, local days). Generated from __fixtures__/planVectors.ts; planVectors.test.ts keeps them equal to the engine.',
    cases: planVectorCases().map((c) => ({ ...c, expect: planDay(c.input) })),
  };
}
