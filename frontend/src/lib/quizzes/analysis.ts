/**
 * The statistics of a quiz «как у психометриста, но по-человечески» (release 49, spec Test_Builder_Spec_2026-10-18
 * «Выпуск 49»), from quiz_analysis (20261105090000_quiz_stats): the finished attempts of others than the author, a cell
 * per question — credit 0..1 (null while an essay waits) and the seconds spent on it.
 *
 * - Difficulty: the share of credit (quiz_results gives it too; here it is the base of the rest).
 * - Discrimination: the correlation of a question's credit with the rest of the attempt (the corrected item-total
 *   correlation; for a right/wrong question it is the point-biserial one), and in plain words the share right among
 *   the strongest and the weakest 27 % of the attempts. A verdict only with MIN_FOR_VERDICT attempts or more and when
 *   people did not all score the same on it: with fewer, one lucky guess turns it over. Thresholds by the usual rule of
 *   thumb for classroom tests: 0.3 and up — tells them apart well; 0.15 — weakly; under that — hardly (rewrite it);
 *   below −0.05 — those who know do worse here (check the key).
 * - The trap: the wrong option chosen most, when at least 2 people and a quarter of those who answered chose it.
 * - Time: the median of the seconds of the answered cells, from MIN_FOR_TIME answers.
 * - Retakes: people with two finished attempts or more, their first and their last attempt's percent.
 * - Groups: another quiz of the same exam (a class gets its own link) on the questions both had.
 * - «Кому что повторить»: each person's latest finished attempt, its questions not fully right.
 * - The speed signal: FAST_ANSWERS or more answers at under FAST_SECONDS each — a signal for the author, not a proof.
 */
import type { QuizAnalysis, QuizAnalysisAttempt, QuizAnalysisOther, QuizAttemptRow, QuizItemStat } from '../../types/quiz';
import type { TestItem } from '../../types/container';

export const MIN_FOR_VERDICT = 15;
export const MIN_FOR_TIME = 3;
export const GOOD_R = 0.3;
export const WEAK_R = 0.15;
export const REVERSE_R = -0.05;
export const FAST_ANSWERS = 5;
export const FAST_SECONDS = 3;

export type Verdict = 'good' | 'weak' | 'poor' | 'reverse';

export interface ItemInsight {
  itemId: string;
  /** Graded answers (an essay waiting is left out). */
  n: number;
  /** The share of credit, 0..1. */
  mean: number | null;
  /** The corrected item-total correlation; null when it cannot be computed (all the same, fewer than 3). */
  r: number | null;
  /** The share of credit among the strongest and the weakest 27 % of the attempts (by the rest of the attempt). */
  upper: number | null;
  lower: number | null;
  /** null below MIN_FOR_VERDICT, or when everybody scored the same on it. */
  verdict: Verdict | null;
  /** The median seconds of an answer; null under MIN_FOR_TIME answers. */
  medianSec: number | null;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx < 1e-12 || syy < 1e-12) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export function verdictOf(r: number | null, n: number): Verdict | null {
  if (r === null || n < MIN_FOR_VERDICT) return null;
  if (r >= GOOD_R) return 'good';
  if (r >= WEAK_R) return 'weak';
  if (r < REVERSE_R) return 'reverse';
  return 'poor';
}

/** A question asks to be rewritten (or its key checked). */
export const needsRewrite = (verdict: Verdict | null) => verdict === 'poor' || verdict === 'reverse';

/** Per question id: difficulty, discrimination, the verdict and the usual time. */
export function itemInsights(analysis: QuizAnalysis): Map<string, ItemInsight> {
  const per = analysis.items.map(() => ({ xs: [] as number[], rest: [] as number[], secs: [] as number[] }));
  for (const attempt of analysis.attempts) {
    const graded = attempt.cells.filter((cell) => cell[1] !== null);
    const total = graded.reduce((s, cell) => s + (cell[1] as number), 0);
    for (const [index, credit, seconds] of attempt.cells) {
      const slot = per[index];
      if (!slot) continue;
      if (seconds !== null) slot.secs.push(seconds);
      if (credit === null) continue;
      slot.xs.push(credit);
      // the rest of the attempt as a share, so attempts with other draws of questions compare
      slot.rest.push(graded.length > 1 ? (total - credit) / (graded.length - 1) : Number.NaN);
    }
  }
  const out = new Map<string, ItemInsight>();
  analysis.items.forEach((itemId, index) => {
    const { xs, rest, secs } = per[index];
    const n = xs.length;
    const pairs = xs.map((x, i) => [x, rest[i]] as const).filter(([, y]) => Number.isFinite(y));
    const r = pearson(pairs.map(([x]) => x), pairs.map(([, y]) => y));
    let upper: number | null = null;
    let lower: number | null = null;
    if (pairs.length >= 4) {
      const byRest = [...pairs].sort((a, b) => a[1] - b[1]);
      const k = Math.max(1, Math.round(byRest.length * 0.27));
      const share = (part: ReadonlyArray<readonly [number, number]>) => part.reduce((s, [x]) => s + x, 0) / part.length;
      lower = share(byRest.slice(0, k));
      upper = share(byRest.slice(-k));
    }
    out.set(itemId, {
      itemId,
      n,
      mean: n > 0 ? xs.reduce((s, x) => s + x, 0) / n : null,
      r,
      upper,
      lower,
      verdict: verdictOf(r, n),
      medianSec: secs.length >= MIN_FOR_TIME ? median(secs) : null,
    });
  });
  return out;
}

/** The finished attempts of others the analysis counts (for «скажем, когда сдадут 15 человек (сейчас 6)»). */
export const countedAttempts = (analysis: QuizAnalysis | null) => analysis?.attempts.length ?? 0;

export interface Trap {
  index: number;
  n: number;
  answered: number;
}

/** The wrong option chosen most (single or multiple): at least 2 people and a fifth of those who answered. */
export function trapOf(stat: Pick<QuizItemStat, 'picks' | 'answered'>, item: Pick<TestItem, 'kind' | 'options' | 'correct'>): Trap | null {
  if (item.kind !== 'single' && item.kind !== 'multiple') return null;
  if (item.correct.length === 0 || stat.answered <= 0 || stat.picks.length !== item.options.length) return null;
  let best: Trap | null = null;
  stat.picks.forEach((n, index) => {
    if (item.correct.includes(index)) return;
    if (!best || n > best.n) best = { index, n, answered: stat.answered };
  });
  const found = best as Trap | null;
  if (!found || found.n < 2 || found.n < stat.answered / 4) return null;
  return found;
}

const percentOfAttempt = (a: Pick<QuizAttemptRow, 'score' | 'max_score' | 'correct' | 'total'>): number | null => {
  const max = typeof a.max_score === 'number' && a.max_score > 0 ? a.max_score : a.total;
  const got = typeof a.max_score === 'number' && a.max_score > 0 ? a.score ?? 0 : a.correct;
  return max > 0 ? (100 * got) / max : null;
};

export interface Retakes {
  people: number;
  /** The average percent of their first and of their last attempt. */
  first: number;
  last: number;
}

/** People with two finished attempts or more (the author's own tries left out). */
export function retakesOf(attempts: readonly QuizAttemptRow[]): Retakes | null {
  const byPerson = new Map<string, QuizAttemptRow[]>();
  for (const a of attempts) {
    if (a.own || !a.finished_at) continue;
    const list = byPerson.get(a.person) ?? [];
    list.push(a);
    byPerson.set(a.person, list);
  }
  let people = 0;
  let first = 0;
  let last = 0;
  for (const list of byPerson.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.n - b.n);
    const p1 = percentOfAttempt(sorted[0]);
    const p2 = percentOfAttempt(sorted[sorted.length - 1]);
    if (p1 === null || p2 === null) continue;
    people += 1;
    first += p1;
    last += p2;
  }
  return people > 0 ? { people, first: first / people, last: last / people } : null;
}

export interface GroupCompare {
  other: QuizAnalysisOther;
  /** Questions both quizzes had answers to. */
  common: number;
  /** The share of credit on those questions, here and there (0..1). */
  here: number | null;
  there: number | null;
  /** Per question id: the other quiz's share and its count. */
  perItem: Map<string, { share: number; shown: number }>;
}

/** This quiz next to another quiz of the same exam, on the questions both had. */
export function compareWith(analysis: QuizAnalysis, other: QuizAnalysisOther): GroupCompare {
  const here = analysis.items.map(() => ({ shown: 0, credit: 0 }));
  for (const a of analysis.attempts) {
    for (const [index, credit] of a.cells) {
      if (credit === null || !here[index]) continue;
      here[index].shown += 1;
      here[index].credit += credit;
    }
  }
  const perItem = new Map<string, { share: number; shown: number }>();
  let common = 0;
  let hereShown = 0;
  let hereCredit = 0;
  let thereShown = 0;
  let thereCredit = 0;
  for (const [index, shown, credit] of other.items) {
    const itemId = analysis.items[index];
    if (!itemId || shown <= 0) continue;
    perItem.set(itemId, { share: credit / shown, shown });
    if (here[index].shown > 0) {
      common += 1;
      hereShown += here[index].shown;
      hereCredit += here[index].credit;
      thereShown += shown;
      thereCredit += credit;
    }
  }
  return {
    other,
    common,
    here: hereShown > 0 ? hereCredit / hereShown : null,
    there: thereShown > 0 ? thereCredit / thereShown : null,
    perItem,
  };
}

export type RepeatWho = 'member' | 'outside' | 'guest';

export interface RepeatRow {
  attemptId: string;
  person: string;
  name: string;
  who: RepeatWho;
  sent: boolean;
  /** The questions of the latest attempt not fully right (no answer included), in the exam's order. */
  items: string[];
  /** Of those, how many had part of the credit. */
  partial: number;
}

/** «Кому что повторить»: each person's latest finished attempt (names from quiz_results), by name. */
export function repeatRows(analysis: QuizAnalysis, attempts: readonly QuizAttemptRow[]): RepeatRow[] {
  const names = new Map(attempts.map((a) => [a.id, a.name]));
  const latest = new Map<string, QuizAnalysisAttempt>();
  for (const a of analysis.attempts) {
    const seen = latest.get(a.person);
    if (!seen || a.n > seen.n) latest.set(a.person, a);
  }
  return [...latest.values()]
    .map((a) => {
      const wrong = a.cells.filter((cell) => cell[1] !== null && (cell[1] as number) < 1).sort((x, y) => x[0] - y[0]);
      return {
        attemptId: a.id,
        person: a.person,
        name: names.get(a.id) ?? '',
        who: (a.guest ? 'guest' : a.member ? 'member' : 'outside') as RepeatWho,
        sent: a.sent,
        items: wrong.map((cell) => analysis.items[cell[0]]),
        partial: wrong.filter((cell) => (cell[1] as number) > 0).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.person.localeCompare(b.person));
}

export interface FastSign {
  answers: number;
  seconds: number;
}

/** Many answers in very little time: FAST_ANSWERS or more at under FAST_SECONDS each (the seconds of its answers). */
export function fastSign(attempt: Pick<QuizAnalysisAttempt, 'cells'>): FastSign | null {
  const timed = attempt.cells.filter((cell) => cell[2] !== null);
  const seconds = timed.reduce((s, cell) => s + (cell[2] as number), 0);
  if (timed.length < FAST_ANSWERS || seconds >= FAST_SECONDS * timed.length) return null;
  return { answers: timed.length, seconds };
}

/** Per attempt id, the speed signal of every analysed attempt that has one. */
export function fastSigns(analysis: QuizAnalysis | null): Map<string, FastSign> {
  const out = new Map<string, FastSign>();
  for (const a of analysis?.attempts ?? []) {
    const sign = fastSign(a);
    if (sign) out.set(a.id, sign);
  }
  return out;
}

/** «25 с», «1 мин 40 с», «12 мин». */
export function secondsText(value: number): string {
  const s = Math.max(1, Math.round(value));
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return m >= 10 || rest === 0 ? `${m} мин` : `${m} мин ${rest} с`;
}
