import { useMemo } from 'react';
import { useLearnLeft } from '../../api/learnLeft';
import { buildTopics, nextReady, ORAL_IN_PLAN, readyNow, tally, type LearnLeftExam } from '../../lib/containers/topics';

export interface OralToday {
  exam: LearnLeftExam | null;
  /** «Осталось выучить 9 тем из 12»: the oral exam's topics left and in all (null until read, or with none). */
  topics: { left: number; total: number } | null;
  /** Questions an answer now makes learned, and the next moment one more is ready. */
  ready: number;
  next: number | null;
  /** Oral questions learned, and those counted (in the plan). */
  learned: number;
  inPlan: number;
}

/**
 * «Сегодня»'s oral exam card: one learn_left read for every oral exam of the user (the same read serves each card and
 * row of the page: api/learnLeft.ts keeps it for a moment), no sheet and no journal reads.
 */
export function useOralToday(examId: string | null): OralToday {
  const learn = useLearnLeft(examId ? null : [], Boolean(examId));
  const exam = examId ? learn.exams.find((item) => item.examId === examId) ?? null : null;
  return useMemo(() => {
    if (!exam) return { exam: null, topics: null, ready: 0, next: null, learned: 0, inPlan: 0 };
    const t = tally(buildTopics({ oral: exam }).topics);
    const now = Date.now();
    const inPlan = exam.questions.filter((q) => ORAL_IN_PLAN.has(q.kind));
    return {
      exam,
      topics: t.total > 0 ? { left: t.left, total: t.total } : null,
      ready: readyNow(exam, now).length,
      next: nextReady(exam, now),
      learned: inPlan.filter((q) => q.state === 3).length,
      inPlan: inPlan.length,
    };
  }, [exam]);
}
