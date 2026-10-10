/**
 * The day's plan (package D2; spec §5, §15 #32, Concept 2 §3): pure and deterministic — no clock, no randomness.
 * The same module runs on «Сегодня», offline, and in the Telegram bot (copied to supabase/functions/_shared/plan/).
 */
import type { DayPlan, LocalDay, PlanInput } from '../../types/container';

function notBuilt(name: string): never {
  throw new Error(`lib/containers/plan.${name}: not built yet (package D2)`);
}

export function planDay(_input: PlanInput): DayPlan { return notBuilt('planDay'); }
/** Minutes a day needed to see everything by the date at the student's pace, the smallest fitting option, and how many they would see at the current budget. */
export function feasibility(_input: PlanInput): { neededMin: number; option: 30 | 45 | 60 | 90 | null; seenByDateEst: number } { return notBuilt('feasibility'); }
/** The final window's length W = min(4, ⌊D0/3⌋). */
export function windowDays(_firstPlanDay: LocalDay, _date: LocalDay): number { return notBuilt('windowDays'); }
