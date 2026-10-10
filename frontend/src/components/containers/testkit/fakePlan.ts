/** A stand-in for lib/containers/plan.ts in tests: the day's plan is the one a fixture attached to its input. */
import type { DayPlan, LocalDay, PlanInput } from '../../../types/container';

export function planDay(input: PlanInput): DayPlan {
  const plan = (input as PlanInput & { __plan?: DayPlan }).__plan;
  if (!plan) throw new Error('fakePlan.planDay: no plan attached to the input');
  return plan;
}

export function feasibility(input: PlanInput): { neededMin: number; option: 30 | 45 | 60 | 90 | null; seenByDateEst: number } {
  const needed = 75;
  return { neededMin: needed, option: 90, seenByDateEst: Math.min(960, Math.round((input.budgetMin / needed) * 960)) };
}

export function windowDays(firstPlanDay: LocalDay, date: LocalDay): number {
  const d0 = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${firstPlanDay}T00:00:00Z`)) / 86_400_000);
  return Math.max(0, Math.min(4, Math.floor(d0 / 3)));
}
