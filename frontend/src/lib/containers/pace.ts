/** The student's own pace (package D2; Concept 2 §3.8): blends own medians with defaults, `(n·own + 20·default)/(n + 20)`. */
import type { Pace, PlanInputsWire } from '../../types/container';

export const DEFAULT_PACE: Pace = {
  tNew: 35, tRev: 20, tWrong: 10, tRetry: 12, tSC: 60, tAC: 150,
  pWrong: { new: 0.5, relearn: 0.35, confirm: 0.15, check: 0.15, final: 0.2 },
};

/** Pace per subject index from the wire's `pace` rows. */
export function paceFrom(_rows: PlanInputsWire['pace'], _subjectCount: number): Pace[] {
  throw new Error('lib/containers/pace.paceFrom: not built yet (package D2)');
}
