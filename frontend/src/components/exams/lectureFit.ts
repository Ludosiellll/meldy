/**
 * «Какие лекции подходят к вопросам» in the exam editor (the owner, 2026-10-07: «может есть вариант
 * подсказки делать, типа какие лекции подходят?»). Once the list has questions, the editor asks the
 * server (backend/lecture_fit.py: shared words, BM25 over the lectures' fragments, no AI, no units,
 * nothing saved) which of the student's lectures fit which questions, again whenever the questions or
 * the lectures change (debounced). The picker writes «подходит к N вопросам» on a lecture as Meldy's
 * pencil note, offers «Отметить подходящие (N)», and names the questions no lecture fits.
 *
 * Pure helpers and texts are exported for tests; useLectureFit keeps the last answer on screen while
 * a newer one loads or fails, and never blocks saving.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QUESTION_MIN_CHARS, fetchLectureFit, type LectureFit } from '../../api/exams';
import { pluralRu } from '../conversation/visuals';
import { draftQuestions, type PreviewState } from './previewModel';

/** The editor asks after the student stops changing the list for this long. */
export const FIT_DEBOUNCE_MS = 700;
/** «Без подходящей лекции: вопросы …» names at most this many questions, then «и ещё N». */
export const FIT_NUMBERS_SHOWN = 12;

/** One question as the request sends it and as the list shows its number. */
export interface FitQuestion {
  text: string;
  number: string;
}

/** The number the department gave a question, else its place in the list (as QuestionPreview shows it). */
export function questionNumber(label: string, ordinal: number): string {
  return label.trim().replace(/[.)]\s*$/, '') || String(ordinal);
}

/** The questions worth asking about: rows with text (an empty or one-letter row would only be «без лекции»). */
export function fitQuestions(state: PreviewState): FitQuestion[] {
  return draftQuestions(state)
    .map((question, index) => ({ text: question.text.replace(/\s+/g, ' ').trim(), number: questionNumber(question.label, index + 1) }))
    .filter((question) => question.text.length >= QUESTION_MIN_CHARS);
}

/** The server's answer with the numbers of the questions it was asked about (request order). */
export interface FitSnapshot {
  result: LectureFit;
  numbers: string[];
}

export interface FitView {
  /** Lecture → how many questions it fits (only lectures that fit some). */
  counts: Map<string, number>;
  /** Lectures that fit at least one question, in the order given. */
  fitting: string[];
  /** Numbers of the questions no lecture fits, as the list shows them, each once. */
  unmatched: string[];
  /** Questions the answer is about. */
  total: number;
  /** Some lecture fits two questions or more: enough to tick lectures by the questions. */
  strong: boolean;
  /** Lectures the server did not check because the library has more text than it reads. */
  notChecked: number;
}

/** What the picker shows, for the lectures it lists (in its order). */
export function fitView(snapshot: FitSnapshot, order: readonly string[]): FitView {
  const counts = new Map<string, number>();
  for (const id of order) {
    const count = snapshot.result.lectures.get(id)?.length ?? 0;
    if (count > 0) counts.set(id, count);
  }
  const unmatched = Array.from(new Set(snapshot.result.unmatched.map((index) => snapshot.numbers[index]).filter((number): number is string => Boolean(number))));
  const shown = new Set(order);
  return {
    counts,
    fitting: order.filter((id) => counts.has(id)),
    unmatched,
    total: snapshot.numbers.length,
    strong: Array.from(counts.values()).some((count) => count >= 2),
    notChecked: snapshot.result.skipped.filter((item) => item.reason === 'limit' && shown.has(item.id)).length,
  };
}

// ------------------------------------------------------------------ texts

/** On a lecture: «подходит к 3 вопросам». */
export function fitCountText(count: number): string {
  return `подходит к ${count} ${pluralRu(count, ['вопросу', 'вопросам', 'вопросам'])}`;
}

/** On a subject: «подходят 2 лекции», «подходит 1 лекция». */
export function groupFitText(count: number): string {
  return `${pluralRu(count, ['подходит', 'подходят', 'подходят'])} ${count} ${pluralRu(count, ['лекция', 'лекции', 'лекций'])}`;
}

/** Above the list: how many lectures fit, or that none does. */
export function fitSummary(fitting: number): string {
  if (fitting === 0) return 'Ни одна лекция не подходит к вопросам списка.';
  return `К вопросам списка ${pluralRu(fitting, ['подходит', 'подходят', 'подходят'])} ${fitting} ${pluralRu(fitting, ['лекция', 'лекции', 'лекций'])}.`;
}

/** How the hint is counted, once, next to it. */
export const FIT_METHOD = 'Meldy подбирает лекции по совпадению слов в вопросах и лекциях, без ИИ. Точнее покажет сверка.';

/** Why the lectures are ticked when the questions ticked them (a new exam, the selection untouched). */
export const FIT_TICK_HINT = 'Отмечены лекции, которые подходят к вопросам списка. Лишние снимите, нужные отметьте.';

/** «вопрос 9», «вопросы 9, 12 и 17», «вопросы 1, 2, … 12 и ещё 5». */
export function questionList(numbers: readonly string[], shown = FIT_NUMBERS_SHOWN): string {
  const word = numbers.length === 1 ? 'вопрос' : 'вопросы';
  if (numbers.length <= 1) return `${word} ${numbers[0] ?? ''}`.trim();
  if (numbers.length > shown) return `${word} ${numbers.slice(0, shown).join(', ')} и ещё ${numbers.length - shown}`;
  return `${word} ${numbers.slice(0, -1).join(', ')} и ${numbers[numbers.length - 1]}`;
}

/** Under the list: the questions no lecture fits, and what to do about them. */
export function unmatchedLines(numbers: readonly string[], total: number): { lead: string; advice: string } | null {
  if (numbers.length === 0) return null;
  if (numbers.length === total && total > 1) {
    return {
      lead: 'Ни к одному вопросу не нашлось подходящей лекции.',
      advice: 'Если лекции по этому предмету есть, добавьте их — иначе сверка отметит, что вопросов нет в лекциях.',
    };
  }
  const one = numbers.length === 1;
  return {
    lead: `Без подходящей лекции: ${questionList(numbers)}.`,
    advice: one
      ? 'Если лекция по нему есть, добавьте её — иначе сверка отметит, что его нет в лекциях.'
      : 'Если лекции по ним есть, добавьте их — иначе сверка отметит, что их нет в лекциях.',
  };
}

/** Lectures past the server's text limit: they were not checked. */
export function notCheckedText(count: number): string {
  return `${count} ${pluralRu(count, ['старая лекция не проверена', 'старые лекции не проверены', 'старых лекций не проверены'])}: в библиотеке слишком много текста.`;
}

// ------------------------------------------------------------------ the request

export type FitStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LectureFitState {
  status: FitStatus;
  /** The last answer (kept on screen while a newer one loads or fails); null before the first one. */
  snapshot: FitSnapshot | null;
  retry: () => void;
}

/**
 * Asks the server FIT_DEBOUNCE_MS after the questions or the lectures stop changing; a newer request
 * cancels the older one. Off (`enabled` false) it forgets the last answer.
 */
export function useLectureFit(questions: readonly FitQuestion[], materialIds: readonly string[], enabled: boolean): LectureFitState {
  const key = useMemo(
    () => (enabled && questions.length > 0 && materialIds.length > 0 ? JSON.stringify([questions, materialIds]) : ''),
    [enabled, questions, materialIds],
  );
  const [status, setStatus] = useState<FitStatus>('idle');
  const [snapshot, setSnapshot] = useState<FitSnapshot | null>(null);
  const [attempt, setAttempt] = useState(0);
  const answered = useRef('');
  const attempted = useRef(0);

  useEffect(() => {
    if (!key) {
      answered.current = '';
      setSnapshot(null);
      setStatus('idle');
      return;
    }
    const request = `${attempt}:${key}`;
    if (answered.current === request) {
      // Back to the list the last answer is about (an edit undone before the next request went out).
      setStatus('ready');
      return;
    }
    const [asked, ids] = JSON.parse(key) as [FitQuestion[], string[]];
    // «Повторить» asks at once; an edit of the list waits for the pause.
    const delay = attempt !== attempted.current ? 0 : FIT_DEBOUNCE_MS;
    attempted.current = attempt;
    const controller = new AbortController();
    setStatus('loading');
    const timer = window.setTimeout(() => {
      fetchLectureFit({ questions: asked.map((question) => question.text), materialIds: ids }, controller.signal).then(
        (result) => {
          if (controller.signal.aborted) return;
          answered.current = request;
          setSnapshot({ result, numbers: asked.map((question) => question.number) });
          setStatus('ready');
        },
        () => {
          if (!controller.signal.aborted) setStatus('error');
        },
      );
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { status, snapshot, retry };
}
