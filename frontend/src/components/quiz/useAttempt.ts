import { useEffect, useRef, useState } from 'react';
import type { QuizAnswerInput, QuizAttempt, QuizAttemptItem, QuizResult } from '../../types/quiz';
import { finishQuiz, quizResult, sendAnswers } from '../../api/quizzes';
import { clockOffset, clockText, secondsLeft, timeStage } from '../../lib/quizzes/quizModel';
import { track } from '../../lib/telemetry';
import { isAnswered, type MockAnswer } from '../containers/mockModel';
import { RUN } from './copyTake';

/**
 * The machinery of an attempt of «Контрольная», whatever draws it (QuizRun: one question at a time; QuizDocRun: the
 * studio's page, release 47.2). Each change goes to quiz_answer after half a second of quiet (the changes of that half
 * second in one call), a copy waits on the device under `quiz:<attempt_id>` until the server says it is saved, and a
 * failed send is tried again (sooner and sooner apart, at once when the network comes back). The clock counts to the
 * server's deadline_at, corrected by the difference of the clocks; at 0:00 the waiting answers go and the attempt is
 * finished. MC012 (the server closed the attempt) shows its result. A reload starts again from quiz_start, which gives
 * the same attempt with the server's answers; the unsent ones of this device are put back over them and sent.
 *
 * A taker without an account passes the device's token, and every call of the attempt goes with it (quiz_guest_answer
 * / _finish / _result). With five minutes left and again with one the attempt says so once each (`lowNote`), only when
 * it crosses that mark, and only for an attempt longer than the mark (timeStage).
 */

export type QuizAnswer = MockAnswer;

/** Quiet time before a change is sent. */
export const SEND_DELAY_MS = 500;
/** Waits between tries after a failed send (the last one repeats). */
export const RETRY_MS = [1000, 2000, 5000, 10000, 30000] as const;

/** Where the unsent answers of an attempt wait on this device. */
export const storeKey = (attemptId: string) => `quiz:${attemptId}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAnswerValue(value: unknown): value is QuizAnswer {
  return value === null || typeof value === 'string' || (Array.isArray(value) && value.every((n) => Number.isInteger(n) && n >= 0));
}

/** The unsent answers kept on this device (nothing when storage is closed or the copy is unreadable). */
export function readPending(attemptId: string): Record<string, QuizAnswer> {
  try {
    const raw = window.localStorage.getItem(storeKey(attemptId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const out: Record<string, QuizAnswer> = {};
    for (const [itemId, value] of Object.entries(parsed)) if (isAnswerValue(value)) out[itemId] = value;
    return out;
  } catch {
    return {};
  }
}

function writePending(attemptId: string, pending: Record<string, QuizAnswer>): void {
  try {
    if (Object.keys(pending).length === 0) window.localStorage.removeItem(storeKey(attemptId));
    else window.localStorage.setItem(storeKey(attemptId), JSON.stringify(pending));
  } catch {
    // Without storage the answers still go to the server; they just cannot outlive a closed tab unsent.
  }
}

function fromServer(answer: { chosen: number[] | null; text: string | null }): QuizAnswer {
  if (Array.isArray(answer.chosen) && answer.chosen.length > 0) return [...answer.chosen];
  if (typeof answer.text === 'string' && answer.text !== '') return answer.text;
  return null;
}

/** One answer as quiz_answer takes it; an empty choice or text takes the answer back. */
function toInput(itemId: string, answer: QuizAnswer, kind: QuizAttemptItem['kind']): QuizAnswerInput {
  if (kind === 'short') return { item_id: itemId, text: typeof answer === 'string' ? answer.trim() : '' };
  return { item_id: itemId, chosen: Array.isArray(answer) ? [...answer].sort((a, b) => a - b) : [] };
}

function codeOf(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : '';
}

type SendOutcome = 'ok' | 'over' | 'lost' | 'invalid' | 'offline' | 'failing';

/** The result of an attempt the server closed; one it has not closed yet (22023 unfinished) is finished (idempotent). */
async function resultOf(attemptId: string, token: string | null): Promise<QuizResult> {
  try {
    return await quizResult(attemptId, token);
  } catch (error) {
    if (codeOf(error) === '22023') return finishQuiz(attemptId, token);
    throw error;
  }
}

function failureOf(error: unknown): 'offline' | 'failing' {
  const code = codeOf(error);
  const offline = code === 'network' || (typeof navigator !== 'undefined' && navigator.onLine === false);
  return offline ? 'offline' : 'failing';
}

const retryDelay = (failures: number) => RETRY_MS[Math.min(Math.max(failures, 1), RETRY_MS.length) - 1];

/**
 * Where an attempt goes on from, by the questions in the order they are met: with going back allowed, the first
 * without an answer (all answered — the last); only forward, the one after the last answered. An index of `ids`.
 */
export function resumeIndex(ids: readonly string[], answers: Readonly<Record<string, unknown>>, allowBack: boolean): number {
  if (ids.length === 0) return 0;
  const has = (id: string) => isAnswered(answers[id] as QuizAnswer | undefined);
  if (allowBack) {
    const first = ids.findIndex((id) => !has(id));
    return first >= 0 ? first : ids.length - 1;
  }
  let lastAnswered = -1;
  ids.forEach((id, index) => {
    if (has(id)) lastAnswered = index;
  });
  return Math.min(ids.length - 1, lastAnswered + 1);
}

export type SaveStatus = 'idle' | 'saved' | 'offline' | 'failing';
export type Ending = { reason: 'sent' | 'time'; state: 'sending' | 'offline' | 'failed' };

export interface AttemptRun {
  id: string;
  /** The answers of the attempt now (the server's, this device's unsent ones over them, then each change). */
  answers: Record<string, QuizAnswer>;
  /** The answers the attempt started with on this screen: where to go on from. */
  startAnswers: Record<string, QuizAnswer>;
  /** A change: kept on the device, sent after half a second of quiet. */
  update: (itemId: string, value: QuizAnswer) => void;
  status: SaveStatus;
  /** «Сохранено», «Нет связи — …», «Ответы пока не сохранились — …», or ''. */
  statusText: string;
  /** The end on its way (or waiting for the network); null while the attempt goes on. */
  ending: Ending | null;
  /** «Завершить» (sent) or the clock at 0:00 (time). */
  end: (reason: Ending['reason']) => void;
  /** «Сдать ещё раз». */
  retryEnd: () => void;
  /** «Вернуться к вопросам» from a failed end (only one the person asked for, with time left). */
  backToQuestions: () => void;
  canGoBack: boolean;
  /** Seconds left (null without a timer), the clock's words, how near the end (0 / 1 / 2), the strip's share. */
  left: number | null;
  timeText: string | null;
  stage: 0 | 1 | 2;
  share: number | null;
  /** «Осталось 5 минут» / «Осталась 1 минута», said once each (role status). */
  lowNote: string;
  /** The attempt was opened again after a while: a line says it goes on (until the first change). */
  resumed: boolean;
}

export interface AttemptHandlers {
  onResult: (result: QuizResult) => void;
  onLost: (message: string) => void;
}

export function useAttempt(attempt: QuizAttempt, token: string | null, { onResult, onLost }: AttemptHandlers): AttemptRun {
  const id = attempt.attempt_id;
  const items = attempt.items;

  // The start: the server's answers, the unsent ones of this device over them.
  const [start] = useState(() => {
    const ids = new Set(items.map((item) => item.id));
    const answers: Record<string, QuizAnswer> = {};
    for (const answer of attempt.answers ?? []) if (ids.has(answer.item_id)) answers[answer.item_id] = fromServer(answer);
    const pending: Record<string, QuizAnswer> = {};
    for (const [itemId, value] of Object.entries(readPending(id))) {
      if (!ids.has(itemId)) continue;
      pending[itemId] = value;
      answers[itemId] = value;
    }
    const resumed = Date.parse(attempt.server_now) - Date.parse(attempt.started_at) > 15_000;
    return { answers, pending, offset: clockOffset(attempt.server_now, Date.now()), resumed };
  });
  const kinds = useRef(new Map(items.map((item) => [item.id, item.kind])));

  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>(start.answers);
  const [deadline, setDeadline] = useState<string | null>(attempt.deadline_at);
  const [offset, setOffset] = useState(start.offset);
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [ending, setEnding] = useState<Ending | null>(null);
  const [resumed, setResumed] = useState(start.resumed);

  // The sending machine: refs only, so the listeners registered once always see the current state.
  const pending = useRef<Record<string, QuizAnswer>>({ ...start.pending });
  const versions = useRef<Record<string, number>>({});
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const sendTimer = useRef<number | null>(null);
  const retryTimer = useRef<number | null>(null);
  const failures = useRef(0);
  const endingRef = useRef<Ending | null>(null);
  const done = useRef(false);
  const live = useRef(true);
  const handlers = useRef({ onResult, onLost });
  handlers.current = { onResult, onLost };

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current !== null) window.clearTimeout(ref.current);
    ref.current = null;
  };

  /** Server calls one after another: a send never overtakes the one before it, the finish waits for both. */
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const next = chain.current.then(task, task);
    chain.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const sendPending = async (): Promise<SendOutcome> => {
    const entries = Object.entries(pending.current);
    if (entries.length === 0) return 'ok';
    const sent = entries.map(([itemId]) => [itemId, versions.current[itemId] ?? 0] as const);
    try {
      const saved = await sendAnswers(
        id,
        entries.map(([itemId, value]) => toInput(itemId, value, kinds.current.get(itemId) ?? 'single')),
        token,
      );
      // What changed while the call was on its way stays to be sent.
      for (const [itemId, version] of sent) if ((versions.current[itemId] ?? 0) === version) delete pending.current[itemId];
      writePending(id, pending.current);
      failures.current = 0;
      // Each answer brings the server's deadline now (the author may have moved the closing) and its clock.
      if (live.current) {
        if (saved.deadline_at === null || (typeof saved.deadline_at === 'string' && saved.deadline_at)) setDeadline(saved.deadline_at);
        if (typeof saved.server_now === 'string' && saved.server_now) {
          const at = Date.now();
          setOffset(clockOffset(saved.server_now, at));
          setNow(at);
        }
      }
      return 'ok';
    } catch (error) {
      const code = codeOf(error);
      if (code === 'MC012') return 'over';
      if (code === 'P0002') return 'lost';
      failures.current += 1;
      if (code === '22023') return 'invalid';
      return failureOf(error);
    }
  };

  const finishWith = (result: QuizResult) => {
    if (done.current) return;
    done.current = true;
    clearTimer(sendTimer);
    clearTimer(retryTimer);
    pending.current = {};
    writePending(id, {});
    track('quiz.finished', { reason: result.finish_reason, correct: result.correct, total: result.total });
    handlers.current.onResult(result);
  };

  const lose = () => {
    if (done.current) return;
    done.current = true;
    clearTimer(sendTimer);
    clearTimer(retryTimer);
    pending.current = {};
    writePending(id, {});
    handlers.current.onLost(RUN.lost);
  };

  /** The end: the waiting answers, then quiz_finish (MC012 — the server already closed it: its result). */
  const tryEnd = async () => {
    clearTimer(retryTimer);
    const current = endingRef.current;
    if (!current || done.current) return;
    if (live.current) setEnding({ ...current, state: 'sending' });
    type Outcome = { kind: 'result'; result: QuizResult } | { kind: 'lost' } | { kind: 'offline' | 'failing' } | { kind: 'skip' };
    const outcome = await enqueue(async (): Promise<Outcome> => {
      // A try that waited behind another one: the attempt may be over already, or the person went back to it.
      if (done.current || endingRef.current !== current) return { kind: 'skip' };
      const sent = await sendPending();
      if (sent === 'lost') return { kind: 'lost' };
      if (sent === 'offline' || sent === 'failing') return { kind: sent };
      try {
        return { kind: 'result', result: sent === 'over' ? await resultOf(id, token) : await finishQuiz(id, token) };
      } catch (error) {
        const code = codeOf(error);
        if (code === 'P0002') return { kind: 'lost' };
        if (code === 'MC012') {
          try {
            return { kind: 'result', result: await resultOf(id, token) };
          } catch (again) {
            failures.current += 1;
            return { kind: failureOf(again) };
          }
        }
        failures.current += 1;
        return { kind: failureOf(error) };
      }
    });
    if (outcome.kind === 'skip' || done.current || endingRef.current !== current) return;
    if (outcome.kind === 'result') finishWith(outcome.result);
    else if (outcome.kind === 'lost') lose();
    else {
      if (live.current) setEnding({ ...current, state: outcome.kind === 'offline' ? 'offline' : 'failed' });
      clearTimer(retryTimer);
      retryTimer.current = window.setTimeout(() => void tryEnd(), retryDelay(failures.current));
    }
  };

  const end = (reason: Ending['reason']) => {
    if (done.current || endingRef.current) return;
    clearTimer(sendTimer);
    const next: Ending = { reason, state: 'sending' };
    endingRef.current = next;
    failures.current = 0;
    setEnding(next);
    void tryEnd();
  };

  const schedule = (ms: number) => {
    clearTimer(sendTimer);
    sendTimer.current = window.setTimeout(() => flush(), ms);
  };

  /** Sends what waits; on failure tries again later, MC012 ends the attempt. */
  const flush = () => {
    clearTimer(sendTimer);
    if (done.current || endingRef.current || Object.keys(pending.current).length === 0) return;
    void enqueue(async () => {
      if (done.current || endingRef.current || Object.keys(pending.current).length === 0) return;
      const outcome = await sendPending();
      if (done.current || endingRef.current || !live.current) return;
      if (outcome === 'ok') {
        if (Object.keys(pending.current).length > 0) schedule(SEND_DELAY_MS);
        else setStatus('saved');
      } else if (outcome === 'over') end('time');
      else if (outcome === 'lost') lose();
      else {
        setStatus(outcome === 'offline' ? 'offline' : 'failing');
        schedule(retryDelay(failures.current));
      }
    });
  };

  const backToQuestions = () => {
    clearTimer(retryTimer);
    endingRef.current = null;
    setEnding(null);
    if (Object.keys(pending.current).length > 0) schedule(0);
  };

  // Unsent answers of this device go at once; the network coming back or the tab being hidden sends what waits.
  useEffect(() => {
    live.current = true;
    if (Object.keys(pending.current).length > 0) flush();
    const onOnline = () => {
      failures.current = 0;
      if (endingRef.current) void tryEnd();
      else flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live.current = false;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimer(sendTimer);
      clearTimer(retryTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The clock (the server's deadline, the device's time corrected by the difference); at 0:00 the attempt ends.
  useEffect(() => {
    if (!deadline) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  const left = secondsLeft(deadline, offset, now);
  useEffect(() => {
    if (left === 0) end('time');
  }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  // The attempt's whole time (from its start to the deadline as the server has it now): the strip's length, and the
  // marks it is longer than.
  const span = deadline ? (Date.parse(deadline) - Date.parse(attempt.started_at)) / 1000 : Number.NaN;
  // Five minutes left, then one: said once each when the attempt crosses the mark (not for one already past it). An
  // attempt of five minutes or less has only the last minute: it does not start red (release 47.1).
  const stage = timeStage(left, Number.isFinite(span) ? Math.round(span) : null);
  const told = useRef(stage);
  const [lowNote, setLowNote] = useState('');
  useEffect(() => {
    if (stage <= told.current) return;
    told.current = stage;
    setLowNote(stage === 2 ? RUN.lowOne : RUN.lowFive);
  }, [stage]);

  const update = (itemId: string, value: QuizAnswer) => {
    if (done.current || endingRef.current) return;
    setAnswers((previous) => ({ ...previous, [itemId]: value }));
    pending.current = { ...pending.current, [itemId]: value };
    versions.current[itemId] = (versions.current[itemId] ?? 0) + 1;
    writePending(id, pending.current);
    if (resumed) setResumed(false);
    schedule(SEND_DELAY_MS);
  };

  const timeText = left !== null ? clockText(left) : null;
  // The strip: the share of the attempt's time still left.
  const share = left !== null && Number.isFinite(span) && span > 0 ? Math.min(1, Math.max(0, left / span)) : null;
  const statusText = status === 'saved' ? RUN.saved : status === 'offline' ? RUN.offline : status === 'failing' ? RUN.failing : '';

  return {
    id,
    answers,
    startAnswers: start.answers,
    update,
    status,
    statusText,
    ending,
    end,
    retryEnd: () => {
      failures.current = 0;
      void tryEnd();
    },
    backToQuestions,
    canGoBack: Boolean(ending) && ending?.state !== 'sending' && ending?.reason === 'sent' && (left === null || left > 0),
    left,
    timeText,
    stage,
    share,
    lowNote,
    resumed,
  };
}
