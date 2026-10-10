/**
 * Oral questions for the plan (package D1): for each oral part (an existing exam), its questions as plan items with
 * their deciding lines' states, built with the cheat sheet's own pure rules (lib/exams/cheatSheet.ts) over the
 * existing reads (api/cheatSheet.ts, api/learning.ts) — read only, no oral file changes. Questions without points
 * (no lectures) are left out (spec decision 35) and counted.
 */
import type { PlanItem, Uuid } from '../../types/container';

export interface OralPlanPart {
  examId: Uuid;
  subjectId: Uuid;
  items: PlanItem[];
  withoutPoints: number; // oral questions waiting for lectures
}

export async function loadOralPlanItems(_parts: Array<{ examId: Uuid; subjectId: Uuid }>, _now: number, _tz: string): Promise<OralPlanPart[]> {
  throw new Error('lib/containers/oralPlan.loadOralPlanItems: not built yet (package D1)');
}
