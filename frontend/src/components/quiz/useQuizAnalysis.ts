import { useEffect, useState } from 'react';
import { quizAnalysis } from '../../api/quizzes';
import type { QuizAnalysis, QuizAttemptRow } from '../../types/quiz';

/**
 * quiz_analysis of the stats page (release 49): read when the finished attempts of others change — their count and
 * the latest finish, from the polled quiz_results — not on every poll; nothing is read while nobody has finished.
 */
export function analysisStamp(attempts: readonly QuizAttemptRow[] | undefined): string {
  let n = 0;
  let last = '';
  for (const a of attempts ?? []) {
    if (a.own || !a.finished_at) continue;
    n += 1;
    if (a.finished_at > last) last = a.finished_at;
  }
  return n === 0 ? '' : `${n}:${last}`;
}

export interface AnalysisState {
  analysis: QuizAnalysis | null;
  failed: boolean;
  /** Read again now (after a retry, or after the mistakes went to training). */
  reload: () => void;
}

export function useQuizAnalysis(quizId: string, stamp: string): AnalysisState {
  const [analysis, setAnalysis] = useState<QuizAnalysis | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!quizId || !stamp) {
      setAnalysis(null);
      return undefined;
    }
    let live = true;
    quizAnalysis(quizId).then(
      (next) => {
        if (!live) return;
        setAnalysis(next);
        setFailed(false);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [quizId, stamp, round]);
  return { analysis, failed, reload: () => setRound((value) => value + 1) };
}
