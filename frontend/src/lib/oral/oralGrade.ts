/**
 * The training grade of an answer, formula v2 (contracts §7.6 with Jury_Check 2026-10-03, item 3).
 * Client only: no endpoint ever returns a score or a grade, so nothing can stand in for a missing
 * evaluation.
 *
 * w = 2 for an essential point, 1 otherwise; c: covered 1, partial 0.5, missing 0, wrong 0;
 * unrated points are left out. The follow-up point gets c = max(c, 0.5) when the follow-up answer
 * is covered and max(c, 0.25) when it is partial. score = floor(100·Σw·c / Σw + 0.5), null when
 * Σw = 0 (then there is no grade and nothing is saved). Grade 5 from 85, 4 from 65, 3 from 45,
 * else 2. Caps:
 * - essential_unrecovered (v2, the memo's rule): the examiner asked about an essential point that
 *   was not named or was said wrong, and the answer to the question is missing or wrong → at most 3.
 *   Only on a trustworthy verdict: the model's check, the «Не знаю» button or nothing heard after
 *   «Не расслышал ответ». A verdict of the browser's key-word rule (the check did not answer in
 *   time) cannot tell a paraphrase from a miss, so the cap is not applied and capSkipped says so;
 * - essential_wrong: an essential point said wrong → at most 4 (also when put right on the follow-up);
 * - two_wrong: two or more points said wrong → at most 3.
 * A partial answer to the follow-up lifts essential_unrecovered (the point gets 0.25). The grade is
 * the lowest of the caps that apply; `cap` names the one that set it.
 */

export type PointStatus = 'covered' | 'partial' | 'missing' | 'wrong' | 'unrated';
export type FollowupStatus = 'covered' | 'partial' | 'missing' | 'wrong';
export type Grade = 2 | 3 | 4 | 5;

export const GRADE_WORDS: Record<Grade, string> = {
  5: 'отлично',
  4: 'хорошо',
  3: 'удовлетворительно',
  2: 'неудовлетворительно',
};

/** Status words of the protocol (point lines) and of the counts. */
export const STATUS_WORDS: Record<PointStatus, string> = {
  covered: 'раскрыт',
  partial: 'упомянут',
  missing: 'не назван',
  wrong: 'ошибка',
  unrated: 'не оценён',
};

const CREDIT: Record<Exclude<PointStatus, 'unrated'>, number> = { covered: 1, partial: 0.5, missing: 0, wrong: 0 };

export interface GradedPoint {
  id: string;
  essential: boolean;
  status: PointStatus;
}

export interface GradeTerm {
  id: string;
  weight: 1 | 2;
  credit: number;
}

export interface GradeCounts {
  covered: number;
  partial: number;
  missing: number;
  wrong: number;
  unrated: number;
  total: number;
}

export interface GradeFollowup {
  point_id: string;
  status: FollowupStatus | string;
  /**
   * How the answer to the follow-up was judged: the model's check, the browser's key words (the
   * check did not answer in time), or null / absent — nothing to judge: the «Не знаю» button, or
   * nothing heard after «Не расслышал ответ».
   */
  judgedBy?: 'check' | 'keywords' | null;
}

export type GradeCap = 'essential_unrecovered' | 'essential_wrong' | 'two_wrong';

export interface GradeResult {
  score: number | null;
  grade: Grade | null;
  word: string | null;
  /** «Засчитано» (counts towards readiness): grade 4 or 5. */
  passed: boolean;
  /** One term per rated point, rubric order. */
  terms: GradeTerm[];
  /** Credit per point id (after the follow-up), null for unrated points. */
  credits: Record<string, number | null>;
  sumWeights: number;
  sumWeighted: number;
  counts: GradeCounts;
  /** Which cap lowered the grade, if any. */
  cap: GradeCap | null;
  /**
   * keywords: essential_unrecovered would have applied, but the follow-up was judged only by key
   * words, so it was not (and it would have lowered the grade).
   */
  capSkipped: 'keywords' | null;
  /** The follow-up point of essential_unrecovered (applied or skipped) and its number in the rubric. */
  capPoint: { id: string; number: number } | null;
}

function isStatus(value: unknown): value is PointStatus {
  return value === 'covered' || value === 'partial' || value === 'missing' || value === 'wrong' || value === 'unrated';
}

export function gradeWord(grade: number | null | undefined): string | null {
  return grade === 2 || grade === 3 || grade === 4 || grade === 5 ? GRADE_WORDS[grade] : null;
}

export function gradeFromScore(score: number): Grade {
  if (score >= 85) return 5;
  if (score >= 65) return 4;
  if (score >= 45) return 3;
  return 2;
}

const GRADE_CAPS: Record<GradeCap, Grade> = { essential_unrecovered: 3, essential_wrong: 4, two_wrong: 3 };
/** The order caps are reported in when two of them set the same grade. */
const CAP_ORDER: readonly GradeCap[] = ['essential_unrecovered', 'two_wrong', 'essential_wrong'];

const UNRECOVERED = new Set<string>(['missing', 'wrong']);

/** Formula v2 over the points (rubric order) and the follow-up, if one was asked. */
export function gradeAnswer(points: readonly GradedPoint[], followup: GradeFollowup | null): GradeResult {
  const counts: GradeCounts = { covered: 0, partial: 0, missing: 0, wrong: 0, unrated: 0, total: points.length };
  const terms: GradeTerm[] = [];
  const credits: Record<string, number | null> = {};
  let sumWeights = 0;
  let sumWeighted = 0;
  let essentialWrong = false;
  let wrongs = 0;
  let unrecovered: { id: string; number: number } | null = null;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const status: PointStatus = isStatus(point.status) ? point.status : 'unrated';
    counts[status] += 1;
    if (status === 'wrong') {
      wrongs += 1;
      if (point.essential) essentialWrong = true;
    }
    const asked = followup !== null && followup.point_id === point.id ? followup : null;
    // The examiner asked about a main point that was not named or was said wrong, and the answer
    // to the question did not put it right («не знаю», silence, missing or wrong again).
    if (asked && point.essential && UNRECOVERED.has(status) && UNRECOVERED.has(String(asked.status))) {
      unrecovered = { id: point.id, number: index + 1 };
    }
    if (status === 'unrated') {
      credits[point.id] = null;
      continue;
    }
    const weight: 1 | 2 = point.essential ? 2 : 1;
    let credit = CREDIT[status];
    if (asked) {
      if (asked.status === 'covered') credit = Math.max(credit, 0.5);
      else if (asked.status === 'partial') credit = Math.max(credit, 0.25);
    }
    credits[point.id] = credit;
    terms.push({ id: point.id, weight, credit });
    sumWeights += weight;
    sumWeighted += weight * credit;
  }

  const empty = { terms, credits, sumWeights, sumWeighted, counts, capSkipped: null, capPoint: null };
  if (sumWeights === 0) return { score: null, grade: null, word: null, passed: false, cap: null, ...empty };

  const score = Math.floor((100 * sumWeighted) / sumWeights + 0.5);
  const base = gradeFromScore(score);
  const trusted = followup !== null && followup.judgedBy !== 'keywords';
  const applies: Record<GradeCap, boolean> = {
    essential_unrecovered: unrecovered !== null && trusted,
    essential_wrong: essentialWrong,
    two_wrong: wrongs >= 2,
  };
  let grade: Grade = base;
  for (const cap of CAP_ORDER) if (applies[cap] && GRADE_CAPS[cap] < grade) grade = GRADE_CAPS[cap];
  // The cap that set the grade (on a tie, the first in CAP_ORDER); none when no cap lowered it.
  const cap = grade < base ? (CAP_ORDER.find((name) => applies[name] && GRADE_CAPS[name] === grade) ?? null) : null;
  // A key-word verdict: say that the cap was left out, when it would have lowered the grade.
  const capSkipped = unrecovered !== null && !trusted && GRADE_CAPS.essential_unrecovered < grade ? 'keywords' : null;
  const capPoint = unrecovered !== null && (cap === 'essential_unrecovered' || capSkipped !== null) ? unrecovered : null;
  return {
    score,
    grade,
    word: GRADE_WORDS[grade],
    passed: grade >= 4,
    terms,
    credits,
    sumWeights,
    sumWeighted,
    counts,
    cap,
    capSkipped,
    capPoint,
  };
}

/** «0,5» — a Russian decimal comma, no trailing zeros. */
export function ruNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded).replace('.', ',');
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const NUMBER_WORDS = ['ни одного', 'один', 'два', 'три', 'четыре', 'пять', 'шесть'];
const IN_NUMBER_WORDS = ['', 'в одном', 'в двух', 'в трёх', 'в четырёх', 'в пяти', 'в шести'];

function amount(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** «один упомянут», «два упомянуты»: a count word with the participle agreeing with it. */
function counted(n: number, singular: string, pluralForm: string): string {
  return `${amount(n)} ${n === 1 ? singular : pluralForm}`;
}

/**
 * The plain sentence under the grade (redesign spec 5.12):
 * «Раскрыто 3 пункта из 5, один упомянут, один не назван.»; with an error
 * «Раскрыто 2 пункта из 5, в одном ошибка, один упомянут, один не назван.»
 */
export function countsSentence(counts: GradeCounts): string {
  const covered = counts.covered;
  const head = `${covered === 1 || (covered % 10 === 1 && covered % 100 !== 11) ? 'Раскрыт' : 'Раскрыто'} ${covered} ${plural(covered, 'пункт', 'пункта', 'пунктов')} из ${counts.total}`;
  const parts = [head];
  if (counts.wrong > 0) parts.push(`${IN_NUMBER_WORDS[counts.wrong] ?? `в ${counts.wrong}`} ${counts.wrong === 1 ? 'ошибка' : 'ошибки'}`);
  if (counts.partial > 0) parts.push(counted(counts.partial, 'упомянут', 'упомянуты'));
  if (counts.missing > 0) parts.push(counted(counts.missing, 'не назван', 'не названы'));
  if (counts.unrated > 0) parts.push(counted(counts.unrated, 'не оценён', 'не оценены'));
  return `${parts.join(', ')}.`;
}

/** The compact line of the plan and the attempt rows: «4 · хорошо». */
export function gradeLine(grade: number | null | undefined): string | null {
  const word = gradeWord(grade);
  return word ? `${grade} · ${word}` : null;
}

/**
 * «(2 + 2 + 2 + 0 + 1) / 9 = 78 из 100 → 4» — the formula with this answer's numbers; null without
 * a grade or without terms (a saved grade the formula no longer gives has none: never «() / 9»).
 */
export function formulaLine(result: GradeResult): string | null {
  if (result.score === null || result.grade === null || result.terms.length === 0) return null;
  const terms = result.terms.map((term) => ruNumber(term.weight * term.credit));
  return `(${terms.join(' + ')}) / ${ruNumber(result.sumWeights)} = ${result.score} из 100 → ${result.grade}`;
}
