import { useEffect, useRef, useState } from 'react';
import { quizAnalysis } from '../../api/quizzes';
import type { QuizAnalysis, QuizAttemptRow } from '../../types/quiz';

/**
 * quiz_analysis of the stats page (release 49): read when the finished attempts of others change — their count and
 * the latest finish, from the polled quiz_results — not on every poll; nothing is read while nobody has finished.
 * Once an analysis is shown, a change waits ANALYSIS_DEBOUNCE_MS of quiet before the next read (review 2026-11-05: a
 * class finishing together changed the stamp at every 5-second poll, and each read grades the whole quiz).
 */
export const ANALYSIS_DEBOUNCE_MS = 20_000;

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
  const shown = useRef(false);
  const lastRound = useRef(0);
  useEffect(() => {
    if (!quizId || !stamp) {
      setAnalysis(null);
      shown.current = false;
      return undefined;
    }
    let live = true;
    const read = () =>
      quizAnalysis(quizId).then(
        (next) => {
          if (!live) return;
          shown.current = true;
          setAnalysis(next);
          setFailed(false);
        },
        () => {
          if (live) setFailed(true);
        },
      );
    // The first read, and one asked for (reload), go at once; a new stamp with an analysis on the screen waits.
    const asked = round !== lastRound.current;
    lastRound.current = round;
    if (!shown.current || asked) {
      void read();
      return () => {
        live = false;
      };
    }
    const timer = setTimeout(() => void read(), ANALYSIS_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [quizId, stamp, round]);
  return { analysis, failed, reload: () => setRound((value) => value + 1) };
}
