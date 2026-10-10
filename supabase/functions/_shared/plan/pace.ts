/**
 * The student's own pace (package D2; Concept 2 §3.8): blends own medians with defaults, `(n·own + 20·default)/(n + 20)`.
 *
 * The database sends, per subject index and plan class, the median time of the last ≤ 200 answers (each capped at
 * 180 s; retries and misclicks excluded) and the share wrong (plan_inputs.pace). Times blend with the defaults;
 * a class's own miss rate replaces the default once it rests on 20 answers. Oral times are not measured here (oral
 * answers are not test answers), so they stay at the defaults.
 */
import type { Pace, PlanCls, PlanInputsWire } from './container.ts';

export const DEFAULT_PACE: Pace = {
  tNew: 35, tRev: 20, tWrong: 10, tRetry: 12, tSC: 60, tAC: 150,
  pWrong: { new: 0.5, relearn: 0.35, confirm: 0.15, check: 0.15, final: 0.2 },
};

/** Answers after which the student's own numbers weigh as much as the defaults (and own miss rates apply). */
export const PACE_PRIOR_ANSWERS = 20;
/** Code or several correct options: 45 s new and 25 s familiar instead of 35 s and 20 s. */
export const SLOW_NEW_FACTOR = 45 / 35;
export const SLOW_REV_FACTOR = 25 / 20;

const NEW_CLASSES: readonly PlanCls[] = ['new_floor', 'new_fill'];
const REVIEW_CLASSES: readonly PlanCls[] = ['relearn', 'confirm', 'check', 'final'];
type MissKey = keyof Pace['pWrong'];
const MISS_OF: Partial<Record<PlanCls, MissKey>> = {
  new_floor: 'new', new_fill: 'new', relearn: 'relearn', confirm: 'confirm', check: 'check', final: 'final',
};

export function copyPace(p: Pace): Pace {
  return { ...p, pWrong: { ...p.pWrong } };
}

/** `(n·own + prior·default) / (n + prior)` — the default while there is no own data. */
export function blend(own: number, n: number, fallback: number, prior = PACE_PRIOR_ANSWERS): number {
  if (!(n > 0) || !Number.isFinite(own) || own <= 0) return fallback;
  return (n * own + prior * fallback) / (n + prior);
}

type Row = PlanInputsWire['pace'][number];

/** n-weighted mean of a field over rows (null when they hold no answers). */
function pooled(rows: readonly Row[], value: (row: Row) => number): { n: number; mean: number } | null {
  let n = 0;
  let sum = 0;
  for (const row of rows) {
    if (!(row.n > 0) || !Number.isFinite(value(row))) continue;
    n += row.n;
    sum += row.n * value(row);
  }
  return n > 0 ? { n, mean: sum / n } : null;
}

/** Pace per subject index from the wire's `pace` rows. */
export function paceFrom(rows: PlanInputsWire['pace'], subjectCount: number): Pace[] {
  const out: Pace[] = [];
  for (let s = 0; s < subjectCount; s += 1) {
    const mine = (rows ?? []).filter((row) => row.subject === s);
    const pace = copyPace(DEFAULT_PACE);
    const ownNew = pooled(mine.filter((row) => NEW_CLASSES.includes(row.cls)), (row) => row.median_ms / 1000);
    const ownRev = pooled(mine.filter((row) => REVIEW_CLASSES.includes(row.cls)), (row) => row.median_ms / 1000);
    if (ownNew) pace.tNew = blend(ownNew.mean, ownNew.n, DEFAULT_PACE.tNew);
    if (ownRev) pace.tRev = blend(ownRev.mean, ownRev.n, DEFAULT_PACE.tRev);
    const miss = new Map<MissKey, Row[]>();
    for (const row of mine) {
      const key = MISS_OF[row.cls];
      if (key) miss.set(key, [...(miss.get(key) ?? []), row]);
    }
    for (const [key, group] of miss) {
      const own = pooled(group, (row) => row.p_wrong);
      if (own && own.n >= PACE_PRIOR_ANSWERS) pace.pWrong[key] = Math.min(1, Math.max(0, own.mean));
    }
    out.push(pace);
  }
  return out;
}
