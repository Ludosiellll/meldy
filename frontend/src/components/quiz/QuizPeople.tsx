import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { attemptAnswers, resetAttempt } from '../../api/quizzes';
import { clockText, dateTimeText, peopleRows, percentOf, secondsLeft, type PersonRow } from '../../lib/quizzes/quizModel';
import PaperSelect from '../ui/PaperSelect';
import { Sheet } from '../containers/ui';
import { errorText, letter, lettersText, nb } from '../containers/copyImport';
import { useFocusAfter } from '../containers/useFocusAfter';
import { QA_ERRORS, QA_PEOPLE } from './copyAuthor';

/** P0002 of quiz_attempt_answers / quiz_attempt_reset names the attempt (detail 'attempt'), not the quiz. */
const ATTEMPT_ERRORS: Record<string, string> = { ...QA_ERRORS, P0002: QA_PEOPLE.attemptGone };
import type { TestItem } from '../../types/container';
import type { AttemptAnswer, QuizAttemptRow, QuizRow } from '../../types/quiz';
import './quizAuthor.css';

/**
 * «Участники» of a quiz's stats (spec 2026-10-16 §2.3): one row a person — the attempt that counts (best or last, or
 * the one being written), their name («(вы)» for the author's own tries), what they do now («пишет — 12 из 20,
 * осталось 08:41» against the server's deadline, or «время вышло, ответы сдаются» at 00:00 while the server still
 * takes the last answers, «сдал(а) 17:32», «время вышло», «закрыта»), the result, the minutes
 * and «попытка 2 из 3». A press opens their answers in a sheet: a switch between their attempts, each answered question
 * with their answer and the key in letters, and «Сбросить попытку» after asking (the person gets the attempt back).
 * Somebody who wrote without an account (release 47) has a quiet «без входа» after the name, and a line under the table
 * says such attempts are counted per browser.
 */

export type PeopleSort = 'name' | 'result' | 'time';

export interface QuizPeopleProps {
  quiz: Pick<QuizRow, 'grading' | 'attempts'>;
  attempts: readonly QuizAttemptRow[];
  /** The exam's questions (useContainerData), for the question's text and key. */
  items: ReadonlyMap<string, TestItem>;
  /** The exam's subjects in their order. */
  subjects: ReadonlyArray<{ id: string; title: string }>;
  /** How far the server's clock is ahead of the device's (quizModel.clockOffset of quiz_results.server_now). */
  offsetMs: number;
  /** A computer's width: the rows line up as a table under a head. */
  wide: boolean;
  /** An attempt was reset: the page reads the results again. */
  onChanged: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** «17:32» today, «15 окт., 17:32» another day. */
function finishedText(iso: string, nowMs: number): string {
  const date = new Date(iso);
  const now = new Date(nowMs);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : dateTimeText(iso);
}

export function statusText(attempt: QuizAttemptRow, offsetMs: number, nowMs: number): string {
  if (!attempt.finished_at) {
    const left = secondsLeft(attempt.deadline_at, offsetMs, nowMs);
    // The clock ran out, the server has not closed the attempt yet (it takes the last answers for 20 s more).
    if (left === 0) return QA_PEOPLE.timeOver;
    return QA_PEOPLE.writing(attempt.answered, attempt.total, left === null ? null : clockText(left));
  }
  if (attempt.finish_reason === 'time') return QA_PEOPLE.time;
  if (attempt.finish_reason === 'closed') return QA_PEOPLE.closed;
  return QA_PEOPLE.done(finishedText(attempt.finished_at, nowMs));
}

function resultText(attempt: QuizAttemptRow): string {
  return attempt.finished_at ? QA_PEOPLE.result(attempt.correct, attempt.total, percentOf(attempt.correct, attempt.total)) : '';
}

function minutesOf(attempt: QuizAttemptRow): number | null {
  return attempt.finished_at ? Math.round((Date.parse(attempt.finished_at) - Date.parse(attempt.started_at)) / 60000) : null;
}

function sortRows(rows: PersonRow[], by: PeopleSort): PersonRow[] {
  const byName = (a: PersonRow, b: PersonRow) => a.name.localeCompare(b.name, 'ru');
  if (by === 'name') return [...rows].sort(byName);
  if (by === 'result') return [...rows].sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1) || byName(a, b));
  return [...rows].sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity) || byName(a, b));
}

export default function QuizPeople({ quiz, attempts, items, subjects, offsetMs, wide, onChanged }: QuizPeopleProps) {
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [sort, setSort] = useState<PeopleSort>('name');
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const rows = useMemo(
    () => sortRows(peopleRows(attempts.filter((attempt) => !removed.has(attempt.id)), quiz.grading), sort),
    [attempts, removed, quiz.grading, sort],
  );

  // The clocks of those writing tick every second (the deadline is the server's: the offset makes up the device's).
  const [now, setNow] = useState(() => Date.now());
  const ticking = rows.some((row) => row.status === 'writing' && row.counted.deadline_at);
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);

  const opened = openPerson ? rows.find((row) => row.person === openPerson) ?? null : null;
  useEffect(() => {
    // Every attempt of the person was reset: nothing is left to show.
    if (openPerson && !opened) setOpenPerson(null);
  }, [openPerson, opened]);

  if (rows.length === 0) return <p className="qa-empty">{QA_PEOPLE.empty}</p>;

  const allowed = quiz.attempts;
  const attemptsCell = (row: PersonRow) => (allowed === 1 && row.attempts === 1 ? '' : QA_PEOPLE.attempts(row.attempts, allowed));

  return (
    <div className="qa-people-wrap">
      {rows.length > 1 ? (
        <div className="qa-sort">
          <span className="qa-sort-label" aria-hidden="true">
            {QA_PEOPLE.sort}
          </span>
          <PaperSelect
            ariaLabel={QA_PEOPLE.sort}
            value={sort}
            options={(['name', 'result', 'time'] as const).map((value) => ({ value, label: QA_PEOPLE.sortOption(value) }))}
            onChange={setSort}
          />
        </div>
      ) : null}
      <div className="qa-people" data-wide={wide ? '' : undefined}>
        {wide ? (
          <div className="qa-person qa-people-head" aria-hidden="true">
            <span>{QA_PEOPLE.head.name}</span>
            <span>{QA_PEOPLE.head.status}</span>
            <span>{QA_PEOPLE.head.result}</span>
            <span>{QA_PEOPLE.head.minutes}</span>
            <span>{QA_PEOPLE.head.attempts}</span>
            <span />
          </div>
        ) : null}
        <ul className="qa-people-list" aria-label={QA_PEOPLE.title}>
          {rows.map((row) => {
            const minutes = row.minutes === null ? '' : QA_PEOPLE.minutes(row.minutes);
            return (
              <li key={row.person}>
                <button type="button" className="qa-person" data-status={row.status} onClick={() => setOpenPerson(row.person)}>
                  <span className="qa-person-name">
                    {row.name}
                    {row.own ? <span className="qa-own"> {QA_PEOPLE.own}</span> : null}
                    {row.counted.guest ? (
                      <>
                        {' '}
                        <span className="qa-guest">{QA_PEOPLE.guest}</span>
                      </>
                    ) : null}
                  </span>
                  <span className="qa-person-status">{nb(statusText(row.counted, offsetMs, now))}</span>
                  <span className="qa-person-result">{nb(resultText(row.counted))}</span>
                  {wide ? (
                    <>
                      <span className="qa-person-minutes">{nb(minutes)}</span>
                      <span className="qa-person-attempts">{nb(attemptsCell(row))}</span>
                    </>
                  ) : (
                    <span className="qa-person-more">{nb([minutes, attemptsCell(row)].filter(Boolean).join(' · '))}</span>
                  )}
                  <svg className="qa-person-go" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M8 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {rows.some((row) => row.own) ? <p className="qa-hint">{QA_PEOPLE.ownHint}</p> : null}
      {rows.some((row) => row.counted.guest) ? <p className="qa-hint">{QA_PEOPLE.guestHint}</p> : null}
      {opened ? (
        <PersonAnswers
          row={opened}
          items={items}
          subjects={subjects}
          offsetMs={offsetMs}
          now={now}
          onClose={() => setOpenPerson(null)}
          onReset={(attemptId) => {
            setRemoved((current) => new Set(current).add(attemptId));
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

interface PersonAnswersProps {
  row: PersonRow;
  items: ReadonlyMap<string, TestItem>;
  subjects: ReadonlyArray<{ id: string; title: string }>;
  offsetMs: number;
  now: number;
  onClose: () => void;
  onReset: (attemptId: string) => void;
}

/** One answer's words: «Б. Стрелка» for one option, «А и В» for several, ««текст»» for a short answer. */
function chosenText(item: TestItem | null, answer: AttemptAnswer): string {
  if (answer.text !== null && answer.text !== undefined && answer.text !== '') return `«${answer.text}»`;
  const chosen = answer.chosen ?? [];
  if (chosen.length === 0) return '—';
  if (chosen.length === 1 && item?.options[chosen[0]] !== undefined) return `${letter(chosen[0])}. ${item.options[chosen[0]]}`;
  return lettersText(chosen);
}

function keyText(item: TestItem): string | null {
  if (item.kind === 'short') return item.answers.length > 0 ? QA_PEOPLE.forms(item.answers.join('; ')) : null;
  if (item.correct.length === 0) return null;
  if (item.correct.length === 1 && item.options[item.correct[0]] !== undefined) return QA_PEOPLE.key(`${letter(item.correct[0])}. ${item.options[item.correct[0]]}`);
  return QA_PEOPLE.key(lettersText(item.correct));
}

/** The answers of one person, attempt by attempt (quiz_attempt_answers), with «Сбросить попытку». */
function PersonAnswers({ row, items, subjects, offsetMs, now, onClose, onReset }: PersonAnswersProps) {
  const switchId = useId();
  const [shownId, setShownId] = useState(row.counted.id);
  const shown = row.all.find((attempt) => attempt.id === shownId) ?? row.counted;
  useEffect(() => {
    if (!row.all.some((attempt) => attempt.id === shownId)) setShownId(row.counted.id);
  }, [row, shownId]);

  // Answers by attempt, read again when the attempt's count or end changed (a person still writing); the last list
  // stays on screen while the next one is read.
  const stamp = `${shown.answered}:${shown.finished_at ?? ''}`;
  const [answers, setAnswers] = useState<Record<string, { stamp: string; list: AttemptAnswer[] }>>({});
  const [failed, setFailed] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const have = answers[shown.id];
  useEffect(() => {
    if (have && have.stamp === stamp) return undefined;
    let alive = true;
    const attemptId = shown.id;
    setFailed(null);
    attemptAnswers(attemptId).then(
      (list) => {
        if (alive) setAnswers((current) => ({ ...current, [attemptId]: { stamp, list } }));
      },
      (failure: unknown) => {
        if (alive) setFailed(errorText(failure, ATTEMPT_ERRORS, QA_PEOPLE.loadFailed));
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.id, stamp, round]);

  const order = useMemo(() => new Map(subjects.map((subject, index) => [subject.id, index])), [subjects]);
  const titles = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject.title])), [subjects]);
  const list = have?.list ?? null;
  const sorted = useMemo(() => {
    if (!list) return null;
    return [...list].sort((a, b) => {
      const x = items.get(a.item_id);
      const y = items.get(b.item_id);
      if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1);
      return (order.get(x.subject_id) ?? 0) - (order.get(y.subject_id) ?? 0) || x.position - y.position;
    });
  }, [list, items, order]);

  // «Сбросить попытку»: asked inline; «Отмена» takes the focus, and gives it back to the button.
  const focusAfter = useFocusAfter();
  const askRef = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const reset = async () => {
    if (busy) return;
    setBusy(true);
    setResetError(null);
    try {
      await resetAttempt(shown.id);
      setAsking(false);
      onReset(shown.id);
    } catch (failure) {
      setResetError(errorText(failure, ATTEMPT_ERRORS));
    } finally {
      setBusy(false);
    }
  };

  const minutes = minutesOf(shown);
  const head = shown.finished_at
    ? [statusText(shown, offsetMs, now), QA_PEOPLE.result(shown.correct, shown.total, percentOf(shown.correct, shown.total)), minutes === null ? null : QA_PEOPLE.minutes(minutes)]
        .filter(Boolean)
        .join(' · ')
    : statusText(shown, offsetMs, now);
  const unanswered = Math.max(0, shown.total - (list ? list.length : shown.answered));

  return (
    <Sheet title={QA_PEOPLE.open(row.name)} onClose={onClose} className="qa-sheet">
      {row.all.length > 1 ? (
        <div className="qa-switch" role="group" aria-labelledby={`${switchId}-l`}>
          <span id={`${switchId}-l`} className="qa-sr">
            {QA_PEOPLE.attemptSwitch}
          </span>
          {row.all.map((attempt) => (
            <button
              key={attempt.id}
              type="button"
              className="qa-switch-b"
              aria-pressed={attempt.id === shown.id}
              onClick={() => {
                setShownId(attempt.id);
                setAsking(false);
              }}
            >
              {QA_PEOPLE.attemptTab(attempt.n)}
            </button>
          ))}
        </div>
      ) : null}
      <p className="qa-ans-head">{nb(head)}</p>
      {failed ? (
        <p className="qa-ans-line" role="alert">
          {failed}{' '}
          <button type="button" className="sf-link" onClick={() => setRound((value) => value + 1)}>
            {QA_PEOPLE.retry}
          </button>
        </p>
      ) : !sorted ? (
        <p className="qa-ans-line" role="status">
          {QA_PEOPLE.loading}
        </p>
      ) : sorted.length === 0 ? (
        <p className="qa-ans-line">{QA_PEOPLE.noAnswers}</p>
      ) : (
        <ol className="qa-ans">
          {sorted.map((answer) => {
            const item = items.get(answer.item_id) ?? null;
            const key = item ? keyText(item) : null;
            return (
              <li key={answer.item_id} className="qa-ans-row" data-right={answer.correct === true ? '' : undefined} data-wrong={answer.correct === false ? '' : undefined}>
                <p className="qa-ans-ctx">
                  <span>{item ? nb(QA_PEOPLE.context(titles.get(item.subject_id) ?? '', item.file_no)) : QA_PEOPLE.gone}</span>
                  {answer.correct === null ? null : <span className="qa-ans-mark">{answer.correct ? QA_PEOPLE.right : QA_PEOPLE.wrong}</span>}
                </p>
                {item ? <p className="qa-ans-stem">{item.stem}</p> : null}
                <p className="qa-ans-line">{QA_PEOPLE.answer(chosenText(item, answer))}</p>
                {item ? <p className="qa-ans-line" data-muted="">{key ?? QA_PEOPLE.noKey}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
      {sorted && unanswered > 0 ? <p className="qa-ans-line" data-muted="">{nb(QA_PEOPLE.unanswered(unanswered))}</p> : null}
      <div className="qa-ans-reset">
        {asking ? (
          <p className="qa-ask" role="group" aria-labelledby={`${switchId}-ask`}>
            <span id={`${switchId}-ask`}>{QA_PEOPLE.resetAsk(shown.n)}</span>
            <button type="button" className="sf-link" disabled={busy} onClick={() => void reset()}>
              {QA_PEOPLE.resetYes}
            </button>
            <button
              ref={noRef}
              type="button"
              className="sf-link"
              data-muted=""
              disabled={busy}
              onClick={() => {
                setAsking(false);
                focusAfter(() => askRef.current);
              }}
            >
              {QA_PEOPLE.resetNo}
            </button>
          </p>
        ) : (
          <button
            ref={askRef}
            type="button"
            className="sf-link"
            data-muted=""
            onClick={() => {
              setAsking(true);
              focusAfter(() => noRef.current);
            }}
          >
            {QA_PEOPLE.reset}
          </button>
        )}
        {resetError ? (
          <p className="qa-ans-line" role="alert">
            {resetError}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
