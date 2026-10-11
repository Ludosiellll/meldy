/**
 * What an answer named, as the protocol says it (Ф1, 2026-10-07; the sentence of the orchestrator's
 * decision 2, 2026-10-08): «Сами назвали 3 из 4 главных пунктов, ещё 1 — после вопроса экзаменатора». No
 * grade on screen: the teacher grades on the 10-point scale, Meldy only checks which points of the
 * student's lectures were named. The internal grade (oralGrade.ts) still goes to record_oral_attempt and
 * decides «подтверждено»; the screen does not show it.
 *
 * The words follow the cheat sheet's rule (lib/exams/cheatSheet.ts, outcomeOf): a point is named «сами»
 * when the check found it covered in the answer itself; a point missed, mentioned or said wrong in the
 * answer and covered in the answer to the examiner's question is named «после вопроса» — such a naming
 * does not rub its line on the sheet.
 */
import type { GradeCounts, PointStatus } from './oralGrade';

export interface SummaryPoint {
  id: string;
  essential: boolean;
  status: PointStatus | string;
}

export interface SummaryFollowup {
  point_id: string;
  status: string;
}

export interface AnswerSummary {
  /** 'main': the count is over the main points; 'all': the rubric has none, so over every point. */
  basis: 'main' | 'all';
  /** M: the points of the count (unrated ones too: they were not found named). */
  total: number;
  /** N: named in the answer itself (covered). */
  own: number;
  /** K: not named in the answer, named after the examiner's question (any point). */
  afterQuestion: number;
  /** That point's own status in the answer (missing, partial or wrong), or null: what the plain sentence moves. */
  afterQuestionFrom: PointStatus | null;
  /** E: points said wrong (any point). */
  errors: number;
  /** Every point by its status, for the plain sentence under the line (oralGrade.countsSentence). */
  counts: GradeCounts;
}

const STATUSES = new Set<string>(['covered', 'partial', 'missing', 'wrong', 'unrated']);

function statusOf(point: SummaryPoint): PointStatus {
  return STATUSES.has(point.status) ? (point.status as PointStatus) : 'unrated';
}

export function answerSummary(points: readonly SummaryPoint[], followup: SummaryFollowup | null): AnswerSummary {
  const counts: GradeCounts = { covered: 0, partial: 0, missing: 0, wrong: 0, unrated: 0, total: points.length };
  for (const point of points) counts[statusOf(point)] += 1;
  const main = points.filter((point) => point.essential);
  const counted = main.length > 0 ? main : points;
  // Named only once the examiner asked: missed, mentioned or wrong in the answer, covered in the reply.
  const asked = followup && followup.status === 'covered' ? points.find((point) => point.id === followup.point_id) : undefined;
  const recovered = asked && ['partial', 'missing', 'wrong'].includes(statusOf(asked)) ? 1 : 0;
  return {
    basis: main.length > 0 ? 'main' : 'all',
    total: counted.length,
    own: counted.filter((point) => statusOf(point) === 'covered').length,
    afterQuestion: recovered,
    afterQuestionFrom: asked && recovered ? statusOf(asked) : null,
    errors: counts.wrong,
    counts,
  };
}

function one(n: number): boolean {
  return n % 10 === 1 && n % 100 !== 11;
}

/** «из 1 главного пункта», «из 4 главных пунктов», «из 21 главного пункта»; «из 1 пункта», «из 5 пунктов». */
function ofWord(total: number, basis: AnswerSummary['basis']): string {
  if (basis === 'main') return one(total) ? 'главного пункта' : 'главных пунктов';
  return one(total) ? 'пункта' : 'пунктов';
}

/** «Ошибка в 1 пункте», «Ошибки в 2 пунктах». */
function errorsWord(errors: number): string {
  return one(errors) ? `Ошибка в ${errors} пункте` : `Ошибки в ${errors} пунктах`;
}

/**
 * «Сами назвали 3 из 4 главных пунктов» (decision 2); with the point the examiner's question brought,
 * «Сами назвали 3 из 4 главных пунктов, ещё 1 — после вопроса экзаменатора»; errors, when there are
 * any, as a second sentence: «… Ошибка в 1 пункте». Null when the check gave no point a verdict (then
 * nothing can be counted).
 */
export function summaryLine(summary: AnswerSummary): string | null {
  if (summary.counts.total === 0 || summary.counts.unrated === summary.counts.total) return null;
  let line = `Сами назвали ${summary.own} из ${summary.total} ${ofWord(summary.total, summary.basis)}`;
  if (summary.afterQuestion > 0) line += `, ещё ${summary.afterQuestion} — после вопроса экзаменатора`;
  if (summary.errors > 0) line += `. ${errorsWord(summary.errors)}`;
  return line;
}
