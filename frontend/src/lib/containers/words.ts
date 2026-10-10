/**
 * Every Russian line the plan makes the UI say (package D2; spec §3 words, §15 #39, §16 #45/#55, the design
 * critique's table). A test fails on banned words. Screens render `DayPlan.lines` through `lineText`.
 */
import type { DayPlan, LocalDay } from '../../types/container';

export const TWO_DAYS = 'верно в два разных дня';

function notBuilt(name: string): never {
  throw new Error(`lib/containers/words.${name}: not built yet (package D2)`);
}

export function plural(_n: number, _one: string, _few: string, _many: string): string { return notBuilt('plural'); }
/** '11 октября' */
export function dayText(_day: LocalDay): string { return notBuilt('dayText'); }
/** «Сегодня около 45 минут: 30 новых и 60 знакомых» (or the done / nothing / exam-day variants). */
export function planLine(_plan: DayPlan): string { return notBuilt('planLine'); }
/** One of `DayPlan.lines` as text. */
export function lineText(_line: DayPlan['lines'][number]): string { return notBuilt('lineText'); }
/** The main figure: «143», «из 960», «верно в два разных дня»; while it is 0, the dated first-count line. */
export function figureLines(_figure: DayPlan['figure'], _firstCountDay: LocalDay | null): { big: string; of: string; label: string; under: string | null } { return notBuilt('figureLines'); }
/** The main button: «Начать: 20 вопросов» (phone) / «Начать: 20 вопросов, около 9 минут» (laptop), «Продолжить: 12 из 20». */
export function startLabel(_count: number, _minutes: number | null, _resume: { done: number; of: number } | null): string { return notBuilt('startLabel'); }
