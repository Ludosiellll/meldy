import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TestItem } from '../../types/container';
import type { QuizAccent, QuizAnswerInput, QuizAttempt, QuizAttemptItem, QuizResult } from '../../types/quiz';
import { finishQuiz, quizResult, sendAnswers } from '../../api/quizzes';
import { clockOffset, clockText, quizOrder, secondsLeft, timeStage } from '../../lib/quizzes/quizModel';
import { track } from '../../lib/telemetry';
import { AttemptPictures } from '../containers/ItemPictures';
import QuestionCard from '../containers/QuestionCard';
import { Sheet } from '../containers/ui';
import { isAnswered, type MockAnswer } from '../containers/mockModel';
import { useWide } from '../containers/useWide';
import { RUN } from './copyTake';
import '../containers/room.css';
import './quizTake.css';

/**
 * The attempt of «Контрольная» (spec 2026-10-16 §2.2; plan Task 4), built as «Как на экзамене» (MockRun): one question
 * at a time, a tap chooses and reveals nothing, «Завершить» asks first. Unlike the mock, the attempt lives on the
 * server: each change goes to quiz_answer after half a second of quiet (the changes of that half second in one call),
 * a copy waits on the device under `quiz:<attempt_id>` until the server says it is saved, and a failed send is tried
 * again (sooner and sooner apart, at once when the network comes back). The clock counts to the server's deadline_at,
 * corrected by the difference of the clocks; at 0:00 the waiting answers go and the attempt is finished. MC012 (the
 * server closed the attempt) shows its result. A reload starts again from quiz_start, which gives the same attempt with
 * the server's answers; the unsent ones of this device are put back over them and sent.
 *
 * Release 47 (spec 2026-10-18 §47.1, §47.4): a taker without an account passes the device's token, and every call of
 * the attempt goes with it (quiz_guest_answer / _finish / _result), and its question pictures come through the
 * quiz-media function with that token (AttemptPictures); with a timer a thin strip along the top line's lower edge
 * shrinks to the deadline in the quiz's colour (a progressbar «Осталось времени»; the clock in the top line says the
 * same in words).
 *
 * The top line reads «1 из 3 · осталось 19:58». With five minutes left and again with one the clock (and the strip)
 * turns red and bold, and a status line says «Осталось 5 минут» / «Осталась 1 минута» — once each, only when the
 * attempt crosses that mark (a resumed attempt already past it is not told again). A mark is only for an attempt longer
 * than it (release 47.1): a five-minute test does not start red, it has the last minute only (timeStage).
 */

export type QuizAnswer = MockAnswer;

/** Quiet time before a change is sent. */
export const SEND_DELAY_MS = 500;
/** Waits between tries after a failed send (the last one repeats). */
export const RETRY_MS = [1000, 2000, 5000, 10000, 30000] as const;
const TEXT_MAX = 200;

/** The top line of the attempt (RoomBar's look, with the clock as its own span: it turns red near the end). */
function RunBar({ where, onExit, children }: { where: ReactNode; onExit?: () => void; children?: ReactNode }) {
  return (
    <header className="sf-room-bar ct-roombar qt-roombar">
      {children}
      <div className="ct-rb-left">
        <span className="ct-rb-mark" aria-hidden="true">
          Meldy
        </span>
        <span className="ct-rb-where">
          <span className="ct-rb-long">{where}</span>
          <span className="ct-rb-short">{where}</span>
        </span>
      </div>
      {onExit ? (
        <button type="button" className="sf-link ct-rb-exit" data-muted="" onClick={onExit}>
          {RUN.finish}
        </button>
      ) : null}
    </header>
  );
}

/** «1 из 3 · осталось 19:58»; without a timer «1 из 3». */
function where(pos: number, total: number, clock: string | null, stage: 0 | 1 | 2): ReactNode {
  return (
    <>
      {RUN.place(pos, total)}
      {clock ? (
        <>
          {RUN.sep}
          <span className="qt-clock" data-low={stage > 0 ? '' : undefined}>
            {RUN.clock(clock)}
          </span>
        </>
      ) : null}
    </>
  );
}

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

/** QuestionCard reads a TestItem: the attempt's question with no key and no file number. */
export function asTestItem(item: QuizAttemptItem, index: number): TestItem {
  return {
    id: item.id,
    container_id: '',
    subject_id: '',
    position: index + 1,
    file_no: '',
    topic: null,
    kind: item.kind,
    stem: item.stem,
    options: Array.isArray(item.options) ? item.options : [],
    correct: [],
    answers: [],
    key_source: 'none',
    code: Boolean(item.code),
    keep_order: Boolean(item.keep_order),
    flags: [],
    rev: 0,
    updated_at: '',
    images: item.images ?? null,
  };
}

/** The option order lives in the model now (the review uses it too); kept here for the page's imports. */
export { quizOrder };

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

type Status = 'idle' | 'saved' | 'offline' | 'failing';
type Ending = { reason: 'sent' | 'time'; state: 'sending' | 'offline' | 'failed' };

export interface QuizRunProps {
  attempt: QuizAttempt;
  /** The device's token of a taker without an account (lib/quizzes/guestToken.ts); null — signed in. */
  token: string | null;
  /** The quiz's colour: the sheets open outside the page's root, so they take it by class. */
  accent?: QuizAccent;
  /** The attempt is over (sent, out of time, or closed by the server): its result. */
  onResult: (result: QuizResult) => void;
  /** The attempt is gone on the server (the author reset it): the page goes back to its start with these words. */
  onLost: (message: string) => void;
}

export default function QuizRun({ attempt, token, accent = 'blue', onResult, onLost }: QuizRunProps) {
  const id = attempt.attempt_id;
  const items = attempt.items;
  const total = items.length;
  const wide = useWide();
  const cards = useMemo(() => new Map(items.map((item, index) => [item.id, asTestItem(item, index)])), [items]);
  const kinds = useMemo(() => new Map(items.map((item) => [item.id, item.kind])), [items]);
  const orders = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const item of items) out[item.id] = quizOrder(item, id, attempt.shuffle_options);
    return out;
  }, [items, id, attempt.shuffle_options]);

  // The start: the server's answers, the unsent ones of this device over them, and the place to go on from.
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
    let pos = 0;
    if (attempt.allow_back) {
      const first = items.findIndex((item) => !isAnswered(answers[item.id]));
      pos = first >= 0 ? first : total - 1;
    } else {
      // Only forward: on from the last answered question, never back before it.
      let lastAnswered = -1;
      items.forEach((item, index) => {
        if (isAnswered(answers[item.id])) lastAnswered = index;
      });
      pos = Math.min(total - 1, lastAnswered + 1);
    }
    const resumed = Date.parse(attempt.server_now) - Date.parse(attempt.started_at) > 15_000;
    return { answers, pending, pos: Math.max(0, pos), offset: clockOffset(attempt.server_now, Date.now()), resumed };
  });

  const [answers, setAnswers] = useState<Record<string, QuizAnswer>>(start.answers);
  const [pos, setPos] = useState(start.pos);
  const [deadline, setDeadline] = useState<string | null>(attempt.deadline_at);
  const [offset, setOffset] = useState(start.offset);
  const [now, setNow] = useState(() => Date.now());
  const [status, setStatus] = useState<Status>('idle');
  const [allOpen, setAllOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [resumedNote, setResumedNote] = useState(start.resumed);
  const stemRef = useRef<HTMLHeadingElement | null>(null);

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
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
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
        entries.map(([itemId, value]) => toInput(itemId, value, kinds.get(itemId) ?? 'single')),
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
    setFinishOpen(false);
    setAllOpen(false);
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

  useEffect(() => {
    stemRef.current?.focus({ preventScroll: true });
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, 0);
    }
  }, [pos]);

  const update = (itemId: string, value: QuizAnswer) => {
    if (done.current || endingRef.current) return;
    setAnswers((previous) => ({ ...previous, [itemId]: value }));
    pending.current = { ...pending.current, [itemId]: value };
    versions.current[itemId] = (versions.current[itemId] ?? 0) + 1;
    writePending(id, pending.current);
    if (resumedNote) setResumedNote(false);
    schedule(SEND_DELAY_MS);
  };

  const timeText = left !== null ? clockText(left) : null;
  const shown = Math.min(pos + 1, total);
  // The strip: the share of the attempt's time still left.
  const share = left !== null && Number.isFinite(span) && span > 0 ? Math.min(1, Math.max(0, left / span)) : null;
  const sheetClass = `qt-accent qt-accent-${accent}`;

  // ── the end on its way (or waiting for the network)
  if (ending) {
    const line = ending.state === 'sending' ? (ending.reason === 'time' ? RUN.timeUp : RUN.sending) : ending.state === 'offline' ? RUN.endOffline : RUN.endFailed;
    const canGoBack = ending.state !== 'sending' && ending.reason === 'sent' && (left === null || left > 0);
    return (
      <>
        <RunBar where={where(shown, total, null, 0)} />
        <main className="sf-page ct-study ct-end">
          <p className="ct-recall" role="status">
            {line}
          </p>
          {ending.state !== 'sending' ? (
            <div className="ct-end-links qt-end-acts">
              <button
                type="button"
                className="sf-primary"
                onClick={() => {
                  failures.current = 0;
                  void tryEnd();
                }}
              >
                {RUN.retryEnd}
              </button>
              {canGoBack ? (
                <button type="button" className="sf-link" onClick={backToQuestions}>
                  {RUN.backToQuestions}
                </button>
              ) : null}
            </div>
          ) : null}
        </main>
      </>
    );
  }

  // ── the attempt
  const item = items[pos] ?? null;
  const card = item ? cards.get(item.id) ?? null : null;
  const answer = item ? answers[item.id] : undefined;
  const picked = Array.isArray(answer) ? answer : null;
  const answeredCount = items.filter((entry) => isAnswered(answers[entry.id])).length;
  const missing = items.map((entry, index) => (isAnswered(answers[entry.id]) ? -1 : index + 1)).filter((n) => n > 0);
  const last = pos >= total - 1;
  const statusText = status === 'saved' ? RUN.saved : status === 'offline' ? RUN.offline : status === 'failing' ? RUN.failing : '';

  return (
    <AttemptPictures attemptId={id} token={token}>
      <RunBar where={where(shown, total, timeText, stage)} onExit={() => setFinishOpen(true)}>
        {share !== null && timeText !== null ? (
          <div
            className="qt-time"
            role="progressbar"
            aria-label={RUN.timeLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share * 100)}
            aria-valuetext={RUN.clock(timeText)}
            data-low={stage > 0 ? '' : undefined}
          >
            <span className="qt-time-left" style={{ transform: `scaleX(${share})` }} />
          </div>
        ) : null}
      </RunBar>
      <main className="sf-page ct-study qt-run">
        <p className="qt-low" role="status">
          {lowNote}
        </p>
        {resumedNote ? <p className="ct-offline">{RUN.resumed(shown, total, timeText)}</p> : null}
        {item && card ? (
          <QuestionCard
            item={card}
            order={orders[item.id] ?? []}
            context={attempt.quiz_title}
            mode="mock"
            answered={null}
            ticked={[]}
            picked={picked}
            text={typeof answer === 'string' ? answer : ''}
            onPick={(place) => {
              const fileIndex = (orders[item.id] ?? [])[place];
              if (fileIndex === undefined) return;
              if (item.kind === 'multiple') {
                const list = picked ?? [];
                const next = list.includes(fileIndex) ? list.filter((value) => value !== fileIndex) : [...list, fileIndex];
                update(item.id, next.length > 0 ? next : null);
              } else {
                update(item.id, picked?.[0] === fileIndex ? null : [fileIndex]);
              }
            }}
            onText={(value) => {
              const text = value.slice(0, TEXT_MAX);
              update(item.id, text === '' ? null : text);
            }}
            onSubmitText={() => (last ? setFinishOpen(true) : setPos(pos + 1))}
            stemRef={stemRef}
          />
        ) : null}
        <div className="ct-under ct-mock-all qt-under">
          {attempt.allow_back ? (
            <button type="button" className="sf-link" data-muted="" aria-haspopup="dialog" onClick={() => setAllOpen(true)}>
              {RUN.all}
            </button>
          ) : (
            <p className="qt-forward">{RUN.forwardOnly}</p>
          )}
          <p className="qt-saved" role="status" data-tone={status}>
            {statusText}
          </p>
        </div>
        <div className="ct-bar">
          <div className="ct-bar-row" style={wide ? undefined : { width: '100%' }}>
            {attempt.allow_back ? (
              <button type="button" className="ct-back" disabled={pos === 0} onClick={() => setPos(Math.max(0, pos - 1))}>
                {RUN.back}
              </button>
            ) : null}
            {last ? (
              <button type="button" className="sf-primary" onClick={() => setFinishOpen(true)}>
                {RUN.finish}
              </button>
            ) : (
              <button type="button" className="sf-primary" onClick={() => setPos(pos + 1)}>
                {RUN.next}
              </button>
            )}
          </div>
        </div>
      </main>
      {allOpen && attempt.allow_back ? (
        <Sheet title={RUN.all} onClose={() => setAllOpen(false)} className={sheetClass}>
          <ul className="ct-cells">
            {items.map((entry, index) => (
              <li key={entry.id}>
                <button
                  type="button"
                  data-answered={isAnswered(answers[entry.id]) ? '' : undefined}
                  aria-current={index === pos ? 'true' : undefined}
                  aria-label={RUN.cell(index + 1, isAnswered(answers[entry.id]))}
                  onClick={() => {
                    setPos(index);
                    setAllOpen(false);
                  }}
                >
                  {index + 1}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}
      {finishOpen ? (
        <Sheet
          title={RUN.finishTitle}
          onClose={() => setFinishOpen(false)}
          bare
          className={sheetClass}
          actions={
            <>
              <button type="button" className="sf-primary" onClick={() => end('sent')}>
                {RUN.finish}
              </button>
              <button type="button" className="sf-link" onClick={() => setFinishOpen(false)}>
                {RUN.backToQuestions}
              </button>
            </>
          }
        >
          <p className="ct-finish-line">{RUN.finishLine(answeredCount, total, missing)}</p>
        </Sheet>
      ) : null}
    </AttemptPictures>
  );
}
