/**
 * «Осталось выучить» of an exam's subjects (lib/containers/topics.ts): the test part from the plan's own input (no read
 * of its own: `plan_inputs` is loaded already), the oral part from `learn_left` (one read for all of an exam's oral
 * parts, api/learnLeft.ts). The subject page shows the list, the exam page's rows and «Сегодня» the counts.
 */
import type { PlanInput, SummarySubject } from '../../types/container';
import { buildTopics, tally, type LearnLeftExam, type TopicList } from '../../lib/containers/topics';

export function subjectTopics(subject: Pick<SummarySubject, 'id' | 'topic_titles'>, input: PlanInput | null, oral: LearnLeftExam | null): TopicList {
  return buildTopics({ subjectId: subject.id, items: input?.items ?? [], titles: subject.topic_titles ?? [], oral });
}

/** The oral exams of these subjects whose topics `learn_left` gives (each subject's own oral exam, or a member's copy). */
export function oralExamIds(subjects: ReadonlyArray<Pick<SummarySubject, 'oral'>>): string[] {
  return [...new Set(subjects.map((subject) => subject.oral?.exam_id).filter((id): id is string => typeof id === 'string' && id !== ''))];
}

/** The exam's topics left and in all, every subject together: «Осталось выучить 9 тем из 12». Null with no topics. */
export function examTopicCounts(
  subjects: ReadonlyArray<Pick<SummarySubject, 'id' | 'topic_titles' | 'oral'>>,
  input: PlanInput | null,
  oral: ReadonlyMap<string, LearnLeftExam>,
): { left: number; total: number; closed: number } | null {
  let left = 0;
  let total = 0;
  for (const subject of subjects) {
    const examId = subject.oral?.exam_id ?? null;
    const t = tally(subjectTopics(subject, input, examId ? oral.get(examId) ?? null : null).topics);
    left += t.left;
    total += t.total;
  }
  return total > 0 ? { left, total, closed: total - left } : null;
}
