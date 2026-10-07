import type { LectureFit } from './examStatus';

export type { LectureFit };

/** Nothing is known about the student's other lectures. */
export const LECTURE_FIT_UNKNOWN: LectureFit = { state: 'unknown' };

/**
 * Which of the student's lectures fit an exam whose mapping found (almost) nothing: the place for the editor's
 * lecture-fit check (POST /api/exams/lecture-fit — `{questions}` in, `{lectures: [{id, questions}], unmatched}`
 * out). The exam page asks only while its status is «nothing found» (`wanted`). The lectures that fit, minus the
 * exam's own (the mapping has just found nothing in them), named by their titles, give { state: 'some', titles }:
 * the status says «Подходят ваши лекции «…»: выберите их и сверьте заново». None left give { state: 'none' }:
 * «Среди ваших лекций подходящих нет. Добавьте…». Until the check is wired in here it is 'unknown', and one
 * sentence covers both causes (the right lectures were not chosen, or there are none yet).
 */
export function useLectureFit(_examId: string, _wanted: boolean): LectureFit {
  return LECTURE_FIT_UNKNOWN;
}
