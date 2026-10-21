import { useEffect, useState } from 'react';
import { fetchLearnLeft, forgetLearnLeft } from '../../api/learnLeft';
import { buildTopics, isClosed, topicClosedLine, topicLeftLine } from '../../lib/containers/topics';

/**
 * What a saved oral answer did to its topic, for the answer's protocol (design learn-left §3): «Тема «Язык SQL…»
 * выучена.» or «В теме «Язык SQL…» осталось 2 вопроса из 6.» One learn_left read once the answer is saved (the reads
 * kept for the exam page are dropped, so it shows the answer too). Null while it is read, for a question in no topic,
 * and when the read fails (the protocol then simply has no such line).
 */
export function useAnswerTopic(examId: string, questionId: string | null, savedKey: string | null): string | null {
  const [line, setLine] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    if (!savedKey || !questionId) return undefined;
    let alive = true;
    forgetLearnLeft();
    fetchLearnLeft([examId], { fresh: true })
      .then((exams) => {
        const exam = exams.find((item) => item.examId === examId);
        if (!alive || !exam) return;
        const topic = buildTopics({ oral: exam }).topics.find((entry) => entry.questions.some((q) => q.id === questionId));
        if (topic) setLine({ key: savedKey, text: isClosed(topic) ? topicClosedLine(topic) : topicLeftLine(topic) });
      })
      .catch(() => {
        // No line: the protocol stands without it.
      });
    return () => {
      alive = false;
    };
  }, [examId, questionId, savedKey]);
  return line && line.key === savedKey ? line.text : null;
}
