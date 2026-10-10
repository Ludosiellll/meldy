/**
 * Wire → plan input (package D1): decodes `plan_inputs` (tuples, day offsets, epoch seconds) into the plan's
 * `PlanInput` for one container (epoch ms, local days), merges answers still in the offline queue as answered today,
 * and adds the oral questions (from `oralPlan.ts`).
 */
import type { AnswerInput, PlanInput, PlanInputsWire, PlanItem, Uuid } from '../../types/container';

export interface DecodeOptions {
  containerId: Uuid;
  tz: string;
  now: number; // epoch ms on the device
  pending: AnswerInput[]; // the offline queue's answers for this account
  oral: PlanItem[]; // oral questions of the container's oral parts
}

export function decodePlanInputs(_wire: PlanInputsWire, _options: DecodeOptions): PlanInput {
  throw new Error('lib/containers/planInputs.decodePlanInputs: not built yet (package D1)');
}
