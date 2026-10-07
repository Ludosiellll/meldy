/**
 * What an answer named, as the protocol says it (Ф1, 2026-10-07): «Назвали сами 3 из 4 главных · после
 * вопроса 1 · ошибок: 1». No grade on screen: the teacher grades on the 10-point scale, Meldy only checks
 * which points of the student's lectures were named. The internal grade (oralGrade.ts) still goes to
 * record_oral_attempt and decides «подтверждено»; the screen does not show it.
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
    errors: counts.wrong,
    counts,
  };
}

/** «из 1 главного», «из 4 главных», «из 21 главного»; «из 1 пункта», «из 5 пунктов». */
function ofWord(total: number, basis: AnswerSummary['basis']): string {
  const one = total % 10 === 1 && total % 100 !== 11;
  if (basis === 'main') return one ? 'главного' : 'главных';
  return one ? 'пункта' : 'пунктов';
}

/**
 * «Назвали сами 3 из 4 главных · после вопроса 1 · ошибок: 1»; «после вопроса» and «ошибок» only when they
 * are not zero. Null when the check gave no point a verdict (then nothing can be counted).
 */
export function summaryLine(summary: AnswerSummary): string | null {
  if (summary.counts.total === 0 || summary.counts.unrated === summary.counts.total) return null;
  const parts = [`Назвали сами ${summary.own} из ${summary.total} ${ofWord(summary.total, summary.basis)}`];
  if (summary.afterQuestion > 0) parts.push(`после вопроса ${summary.afterQuestion}`);
  if (summary.errors > 0) parts.push(`ошибок: ${summary.errors}`);
  return parts.join(' · ');
}
