/**
 * «Какие ваши лекции подходят» on the exam page (the owner, 2026-10-07: an exam mapped against one wrong
 * lecture read as 18 × «нет ни в одной» and said nothing about what to do). When the mapping found (almost)
 * nothing in the exam's lectures, the status asks the editor's lecture-fit check (POST /api/exams/lecture-fit,
 * components/exams/lectureFit.ts: shared words, no AI, no units, nothing saved) over the student's other
 * lectures — the exam's own were just checked by the mapping and gave nothing.
 *
 * - Other lectures that fit two questions or more (one, for a one-question exam), most questions first, give
 *   { state: 'some', titles }: «Подходят ваши лекции «…»: выберите их и сверьте заново».
 * - No other lecture at all, or none that fits a single question with every lecture checked, give
 *   { state: 'none' }: «Среди ваших лекций подходящих нет».
 * - While it loads, on a failure, when old lectures went unchecked (the server's text limit) or the others fit
 *   one question each by a stray word, 'unknown': one sentence then covers both causes.
 */
import { useEffect, useState } from 'react';
import { fetchLectureFit, listLectureTitles, type LectureFit as FitAnswer } from '../../api/exams';
import type { LectureFit } from './examStatus';

export type { LectureFit };

/** Nothing is known about the student's other lectures. */
export const LECTURE_FIT_UNKNOWN: LectureFit = { state: 'unknown' };

/** A lecture is named when it fits at least this many of the exam's questions (all of them, when fewer). */
export const FIT_MIN_QUESTIONS = 2;

/** The status from the server's answer: `library` names the lectures, `own` are the exam's lectures. */
export function examFit(
  answer: FitAnswer,
  library: ReadonlyArray<{ id: string; title: string }>,
  own: ReadonlySet<string>,
  total: number,
): LectureFit {
  const titles = new Map(library.map((item) => [item.id, item.title]));
  const need = Math.max(1, Math.min(FIT_MIN_QUESTIONS, total));
  const others = Array.from(answer.lectures.entries()).filter(([id, indexes]) => !own.has(id) && indexes.length > 0);
  const named = others
    .filter(([id, indexes]) => titles.has(id) && indexes.length >= need)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([id]) => titles.get(id) as string);
  if (named.length > 0) return { state: 'some', titles: named };
  const unchecked = answer.skipped.some((item) => item.reason === 'limit' && !own.has(item.id));
  return others.length === 0 && !unchecked ? { state: 'none' } : LECTURE_FIT_UNKNOWN;
}

/**
 * Asks once per exam state while `wanted` (the status is «nothing found»): the student's lecture titles (no texts),
 * then the fit of the exam's questions over the lectures that are not the exam's. Off, it says 'unknown'.
 */
export function useExamLectureFit(input: {
  userId: string | null;
  wanted: boolean;
  questions: readonly string[];
  own: readonly string[];
}): LectureFit {
  const { userId, wanted } = input;
  const questionsKey = input.questions.map((text) => text.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  const ownKey = [...input.own].sort().join(',');
  const key = `${userId ?? ''}|${ownKey}|${questionsKey}`;
  const [fit, setFit] = useState<{ key: string; value: LectureFit } | null>(null);

  useEffect(() => {
    if (!wanted || !userId || !questionsKey) return;
    const questions = questionsKey.split('\n');
    const own = new Set(ownKey ? ownKey.split(',') : []);
    const controller = new AbortController();
    let alive = true;
    void (async () => {
      let value: LectureFit = LECTURE_FIT_UNKNOWN;
      try {
        const library = await listLectureTitles(userId);
        const others = library.filter((item) => !own.has(item.id));
        if (others.length === 0) value = { state: 'none' };
        else {
          const answer = await fetchLectureFit({ questions, materialIds: others.map((item) => item.id) }, controller.signal);
          value = examFit(answer, library, own, questions.length);
        }
      } catch {
        value = LECTURE_FIT_UNKNOWN;
      }
      if (alive) setFit({ key, value });
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [wanted, userId, questionsKey, ownKey, key]);

  return wanted && fit?.key === key ? fit.value : LECTURE_FIT_UNKNOWN;
}
