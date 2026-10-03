/**
 * Who gets the examiner's follow-up question (contracts §7.2 and §7.5, orchestrator correction 7).
 *
 * The rule (the same function runs on the server as `ask`): the first essential point said wrong,
 * in rubric order; otherwise the first essential missing; otherwise the first essential partial;
 * then the same three for the other points; all covered → no follow-up. One follow-up per question.
 *
 * At «Готово» the browser picks a candidate at once — the first essential point with an explicit
 * miss in the snapshot — and the quick model check (/api/oral/check, 1.5 s) confirms or changes it.
 */
import { explicitMiss, words, type Anchors } from './rubricMatch';

export type CheckStatus = 'covered' | 'partial' | 'missing' | 'wrong';

/** Statuses that make a point worth a follow-up, in the order the rule looks for them. */
export const ASK_ORDER: readonly CheckStatus[] = ['wrong', 'missing', 'partial'];

export interface FollowupPoint {
  id: string;
  essential: boolean;
}

/** §7.5: wrong → missing → partial among essential points (rubric order), then among the others. */
export function chooseFollowup(points: readonly FollowupPoint[], statuses: Readonly<Record<string, string>>): string | null {
  const essential = points.filter((point) => point.essential === true);
  const others = points.filter((point) => point.essential !== true);
  for (const group of [essential, others]) {
    for (const status of ASK_ORDER) {
      const found = group.find((point) => statuses[point.id] === status);
      if (found) return found.id;
    }
  }
  return null;
}

/** The browser's candidate: the first essential point (rubric order) with an explicit miss in the snapshot. */
export function browserCandidate(points: ReadonlyArray<FollowupPoint & { anchors: Anchors }>, snapshot: string): string | null {
  const textWords = words(snapshot);
  const found = points.find((point) => point.essential === true && explicitMiss(point.anchors, textWords));
  return found ? found.id : null;
}

export interface CheckResult {
  statuses: Record<string, string>;
  ask: string | null;
}

export interface FollowupChoice {
  pointId: string;
  /** check — decided with the model's statuses in time; client — the browser rule on a timeout or failure. */
  chosenBy: 'check' | 'client';
}

const ASKABLE = new Set<string>(ASK_ORDER);

/**
 * The «Готово» decision (§7.2). With /check in time: the candidate when the model says it is
 * missing, partial or wrong; otherwise the model's ask (a response naming another point switches
 * to it); otherwise no follow-up — all with chosen_by check. On a timeout or an error: the
 * candidate (chosen_by client), otherwise no follow-up.
 */
export function decideFollowup(candidate: string | null, check: CheckResult | null): FollowupChoice | null {
  if (check) {
    if (candidate && ASKABLE.has(check.statuses[candidate] ?? '')) return { pointId: candidate, chosenBy: 'check' };
    if (check.ask) return { pointId: check.ask, chosenBy: 'check' };
    return null;
  }
  return candidate ? { pointId: candidate, chosenBy: 'client' } : null;
}
