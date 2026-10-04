/**
 * Words about the plans, built from the shared numbers in lib/plans.ts (nothing on screen is typed
 * by hand): the free card of «Тарифы», the PRO window and its reel say the same thing.
 */
import { AI_COSTS, FREE_DAILY_UNITS, PRO_DAILY_UNITS, type AICostKind } from '../../lib/plans';

type Forms = readonly [one: string, few: string, many: string];

const UNITS: Forms = ['единица', 'единицы', 'единиц'];
const LECTURES: Forms = ['лекция', 'лекции', 'лекций'];
const CHECKS: Forms = ['проверка', 'проверки', 'проверок'];

/** The Russian plural after a number: forms for 1, 2–4 and 5+ («1 лекция», «3 лекции», «5 лекций»). */
export function plural(value: number, forms: Forms): string {
  const n = Math.abs(Math.trunc(value)) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

/** How many whole actions of a kind a day's units pay for. */
export function perDay(units: number, kind: AICostKind): number {
  return Math.floor(units / AI_COSTS[kind]);
}

const lectures = (units: number) => {
  const n = perDay(units, 'lecture');
  return `${n} ${plural(n, LECTURES)}`;
};
const checks = (units: number) => {
  const n = perDay(units, 'answer');
  return `${n} ${plural(n, CHECKS)} ответов`;
};

/** «100 единиц ИИ в день» */
export function unitsPerDay(units: number): string {
  return `${units} ${plural(units, UNITS)} ИИ в день`;
}

/** A day's units with examples: «100 единиц ИИ в день — например, 5 лекций или 25 проверок ответов». */
export function limitLine(units: number): string {
  return `${unitsPerDay(units)} — например, ${lectures(units)} или ${checks(units)}`;
}

/** The free card's limit. */
export const freeLimitLine = () => limitLine(FREE_DAILY_UNITS);
/** The PRO card's limit. */
export const proLimitLine = () => limitLine(PRO_DAILY_UNITS);

/** What PRO changes: «До 1000 единиц ИИ в день вместо 100 — это примерно 250 проверок ответов или 50 лекций.» */
export function proGainLine(): string {
  return `До ${unitsPerDay(PRO_DAILY_UNITS)} вместо ${FREE_DAILY_UNITS} — это примерно ${checks(PRO_DAILY_UNITS)} или ${lectures(PRO_DAILY_UNITS)}.`;
}

/** How many times the PRO day is the free one, when it is a whole number («в 10 раз»), else null. */
export function proTimes(): number | null {
  const times = PRO_DAILY_UNITS / FREE_DAILY_UNITS;
  return Number.isInteger(times) && times > 1 ? times : null;
}

/** What PRO is, in one line: «Тот же Meldy, только дневной лимит ИИ в 10 раз больше.» */
export function proLede(): string {
  const times = proTimes();
  return times
    ? `Тот же Meldy, только дневной лимит ИИ в ${times} ${plural(times, ['раз', 'раза', 'раз'])} больше.`
    : 'Тот же Meldy, только дневной лимит ИИ больше.';
}
