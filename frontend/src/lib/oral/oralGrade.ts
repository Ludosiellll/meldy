/**
 * The training grade of an answer, formula v1 (contracts §7.6). Client only: no endpoint ever
 * returns a score or a grade, so nothing can stand in for a missing evaluation.
 *
 * w = 2 for an essential point, 1 otherwise; c: covered 1, partial 0.5, missing 0, wrong 0;
 * unrated points are left out. The follow-up point gets c = max(c, 0.5) when the follow-up answer
 * is covered and max(c, 0.25) when it is partial. score = floor(100·Σw·c / Σw + 0.5), null when
 * Σw = 0 (then there is no grade and nothing is saved). Grade 5 from 85, 4 from 65, 3 from 45,
 * else 2; an essential point said wrong caps it at 4, two or more wrong points cap it at 3.
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

export interface GradeResult {
  score: number | null;
  grade: Grade | null;
  word: string | null;
  /** «Зачтено»: grade 4 or 5. */
  passed: boolean;
  /** One term per rated point, rubric order. */
  terms: GradeTerm[];
  /** Credit per point id (after the follow-up), null for unrated points. */
  credits: Record<string, number | null>;
  sumWeights: number;
  sumWeighted: number;
  counts: GradeCounts;
  /** Which cap lowered the grade, if any. */
  cap: 'essential_wrong' | 'two_wrong' | null;
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

/** Formula v1 over the points (rubric order) and the follow-up, if one was asked. */
export function gradeAnswer(
  points: readonly GradedPoint[],
  followup: { point_id: string; status: FollowupStatus | string } | null,
): GradeResult {
  const counts: GradeCounts = { covered: 0, partial: 0, missing: 0, wrong: 0, unrated: 0, total: points.length };
  const terms: GradeTerm[] = [];
  const credits: Record<string, number | null> = {};
  let sumWeights = 0;
  let sumWeighted = 0;
  let essentialWrong = false;
  let wrongs = 0;

  for (const point of points) {
    const status: PointStatus = isStatus(point.status) ? point.status : 'unrated';
    counts[status] += 1;
    if (status === 'wrong') {
      wrongs += 1;
      if (point.essential) essentialWrong = true;
    }
    if (status === 'unrated') {
      credits[point.id] = null;
      continue;
    }
    const weight: 1 | 2 = point.essential ? 2 : 1;
    let credit = CREDIT[status];
    if (followup && followup.point_id === point.id) {
      if (followup.status === 'covered') credit = Math.max(credit, 0.5);
      else if (followup.status === 'partial') credit = Math.max(credit, 0.25);
    }
    credits[point.id] = credit;
    terms.push({ id: point.id, weight, credit });
    sumWeights += weight;
    sumWeighted += weight * credit;
  }

  if (sumWeights === 0) {
    return { score: null, grade: null, word: null, passed: false, terms, credits, sumWeights, sumWeighted, counts, cap: null };
  }
  const score = Math.floor((100 * sumWeighted) / sumWeights + 0.5);
  let grade = gradeFromScore(score);
  let cap: GradeResult['cap'] = null;
  if (essentialWrong && grade > 4) {
    grade = 4;
    cap = 'essential_wrong';
  }
  if (wrongs >= 2 && grade > 3) {
    grade = 3;
    cap = 'two_wrong';
  }
  return { score, grade, word: GRADE_WORDS[grade], passed: grade >= 4, terms, credits, sumWeights, sumWeighted, counts, cap };
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

/** «(2 + 2 + 2 + 0 + 1) / 9 = 78 из 100 → 4» — the formula with this answer's numbers. */
export function formulaLine(result: GradeResult): string | null {
  if (result.score === null || result.grade === null) return null;
  const terms = result.terms.map((term) => ruNumber(term.weight * term.credit));
  return `(${terms.join(' + ')}) / ${ruNumber(result.sumWeights)} = ${result.score} из 100 → ${result.grade}`;
}
