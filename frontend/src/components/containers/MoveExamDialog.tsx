import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ContainerRole, ContainerSummary, DayKey, ExamMoveFor, ExamMoved, Uuid } from '../../types/container';
import { containerErrorText, fetchSummary, moveExamDate } from '../../api/containers';
import { dayText } from '../../lib/containers/words';
import { Sheet } from './ui';
import { addDay, dayDiff, examDates } from './model';
import * as copy from './copy';
import './moveExam.css';

/**
 * «Перенести экзамен» (release 47; owner, 2026-10-18: «при окончании экзамена нельзя продлить кнопкой и выбрать до
 * какого»): «Через неделю», «Через 2 недели», «Через месяц» from today, or «Своя дата» (today to two years ahead). The
 * author of an exam with members in it chooses «Для всех участников» or «Только для меня»; a member moves only their own
 * date («Это ваша дата. У автора остаётся 17 октября.»). A subject's page moves its subject (`subjectId`). Saved, the
 * dialog closes and the page reads its data again (`onMoved`), saying «Экзамен перенесён на 25 октября.».
 */

/** What the dialog needs to know of the exam. */
export interface MoveFacts {
  /** Active members of the author's exam (0 for a member: they never choose). */
  members: number;
  /** The author's date of the exam (or of the subject), for the member's note; null — none. */
  authorDate: DayKey | null;
}

/** The facts from the exam's summary; on a subject's page, that subject's date. */
export function moveFacts(summary: ContainerSummary, subjectId?: Uuid | null): MoveFacts {
  const own = summary.own_exam_date ?? null;
  let authorDate: DayKey | null;
  if (own) {
    // The caller's own date stands in for every date of the summary: the author's comes apart.
    authorDate = summary.author_exam_date ?? null;
  } else {
    const subject = subjectId ? summary.subjects.find((entry) => entry.id === subjectId) : null;
    const dates = examDates(summary);
    authorDate = subject?.exam_date ?? dates[dates.length - 1] ?? summary.author_exam_date ?? null;
  }
  return { members: summary.role === 'owner' ? summary.owner?.members ?? 0 : 0, authorDate };
}

/** `day` moved by whole months, the day of the month kept where the month has it (31 January → 28/29 February). */
export function addMonths(day: DayKey, months: number): DayKey {
  const [y, m, d] = day.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export type MoveChoice = 'week' | 'two_weeks' | 'month' | 'own';
const QUICK: Array<{ choice: Exclude<MoveChoice, 'own'>; label: string }> = [
  { choice: 'week', label: copy.MOVE_WEEK },
  { choice: 'two_weeks', label: copy.MOVE_TWO_WEEKS },
  { choice: 'month', label: copy.MOVE_MONTH },
];

/** The date of a quick choice, counted from today (the exam has passed or is today: its old date says nothing). */
export function quickDate(choice: Exclude<MoveChoice, 'own'>, today: DayKey): DayKey {
  if (choice === 'week') return addDay(today, 7);
  if (choice === 'two_weeks') return addDay(today, 14);
  return addMonths(today, 1);
}

/** The latest date a move takes (exam_date_move: up to 730 days ahead). */
export const MOVE_MAX_DAYS = 730;

function safeDayText(day: DayKey | null): string | null {
  if (!day) return null;
  try {
    return dayText(day);
  } catch {
    return null;
  }
}

export interface MoveExamDialogProps {
  containerId: Uuid;
  role: ContainerRole;
  /** The page's today (the plan's day). */
  today: DayKey;
  /** What the page knows of the exam; without it the dialog reads the exam's summary («Сегодня»). */
  facts?: MoveFacts | null;
  /** A subject's page moves that subject's date. */
  subjectId?: Uuid | null;
  onClose: () => void;
  /** Saved: the new date and the server's answer. The page reads its data again and says so. */
  onMoved: (day: DayKey, result: ExamMoved) => void;
}

export default function MoveExamDialog({ containerId, role, today, facts = null, subjectId = null, onClose, onMoved }: MoveExamDialogProps) {
  const ids = useId();
  const [read, setRead] = useState<MoveFacts | null>(facts);
  const [choice, setChoice] = useState<MoveChoice>('week');
  const [own, setOwn] = useState('');
  const [who, setWho] = useState<ExamMoveFor>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // «Сегодня» knows the exam from the overview only: the members and the author's date come with its summary.
  const known = facts ?? read;
  useEffect(() => {
    if (facts) return undefined;
    let alive = true;
    fetchSummary(containerId, today).then(
      (summary) => {
        if (alive) setRead(moveFacts(summary, subjectId));
      },
      () => {
        // Unread: the author moves the exam as the page's own date field would, a member their own date.
        if (alive) setRead({ members: 0, authorDate: null });
      },
    );
    return () => {
      alive = false;
    };
  }, [facts, containerId, today, subjectId]);

  const member = role !== 'owner';
  const chooses = !member && (known?.members ?? 0) > 0;
  const forWhom: ExamMoveFor = member ? 'me' : chooses ? who : 'all';
  const max = addDay(today, MOVE_MAX_DAYS);
  const date = choice === 'own' ? own : quickDate(choice, today);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || !known) return;
    if (!date) {
      setError(copy.MOVE_PICK);
      return;
    }
    const ahead = dayDiff(today, date);
    if (ahead === null) {
      setError(copy.MOVE_PICK);
      return;
    }
    if (ahead < 0) {
      setError(copy.MOVE_PAST);
      return;
    }
    if (ahead > MOVE_MAX_DAYS) {
      setError(copy.MOVE_FAR);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await moveExamDate(containerId, date, forWhom, subjectId);
      onMoved(date, result);
    } catch (failure) {
      setError(containerErrorText(failure));
      setBusy(false);
    }
  };

  const formId = `${ids}-form`;
  const errorId = `${ids}-error`;
  return (
    <Sheet
      title={copy.MOVE_TITLE}
      onClose={onClose}
      className="mv-sheet"
      actions={
        <button
          type="submit"
          form={formId}
          className="sf-primary"
          aria-disabled={busy || !known || undefined}
          aria-busy={busy || undefined}
        >
          {busy ? copy.MOVE_SAVING : copy.MOVE_SAVE}
        </button>
      }
    >
      <form id={formId} className="mv-form" noValidate onSubmit={(event) => void submit(event)}>
        <fieldset className="mv-set">
          <legend className="mv-legend">{copy.MOVE_WHEN}</legend>
          {QUICK.map((entry, index) => (
            <label key={entry.choice} className="mv-choice">
              <input
                type="radio"
                name={`${ids}-when`}
                value={entry.choice}
                checked={choice === entry.choice}
                data-autofocus={index === 0 ? '' : undefined}
                onChange={() => {
                  setChoice(entry.choice);
                  setError(null);
                }}
              />
              <span className="mv-choice-t">{entry.label}</span>
              <span className="mv-choice-d">{safeDayText(quickDate(entry.choice, today))}</span>
            </label>
          ))}
          <label className="mv-choice">
            <input
              type="radio"
              name={`${ids}-when`}
              value="own"
              checked={choice === 'own'}
              onChange={() => {
                setChoice('own');
                setError(null);
              }}
            />
            <span className="mv-choice-t">{copy.MOVE_OWN}</span>
          </label>
        </fieldset>
        {choice === 'own' ? (
          <label className="mv-field">
            <span>{copy.MOVE_DATE}</span>
            <input
              type="date"
              value={own}
              min={today}
              max={max}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setOwn(event.target.value);
                setError(null);
              }}
            />
          </label>
        ) : null}
        {chooses ? (
          <fieldset className="mv-set">
            <legend className="mv-legend">{copy.MOVE_WHO}</legend>
            {(['all', 'me'] as const).map((value) => (
              <label key={value} className="mv-choice">
                <input type="radio" name={`${ids}-who`} value={value} checked={who === value} onChange={() => setWho(value)} />
                <span className="mv-choice-t">{value === 'all' ? copy.MOVE_ALL : copy.MOVE_ME}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {member && known ? <p className="mv-note">{copy.moveMemberNote(safeDayText(known.authorDate))}</p> : null}
        {!known ? (
          <p className="mv-note" aria-busy="true">
            {copy.MOVE_LOADING}
          </p>
        ) : null}
        {error ? (
          <p className="ct-sheet-error" id={errorId} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}

export interface ExamMove {
  /** Opens the dialog. */
  open: () => void;
  /** The dialog while it is open. */
  dialog: ReactNode;
  /** «Экзамен перенесён на 25 октября.» once a move is saved: it takes the focus (the button that opened it may be gone). */
  line: ReactNode;
}

/**
 * The dialog of a page and what follows a move: the page reads its data again (`reload`) and says the new date in a
 * line that takes the focus, since the button that opened the dialog may leave with the passed exam.
 */
export function useExamMove(props: Omit<MoveExamDialogProps, 'onClose' | 'onMoved'> & { reload: () => void; className?: string }): ExamMove {
  const { reload, className = 'ct-note', ...dialog } = props;
  const [opened, setOpened] = useState(false);
  const [said, setSaid] = useState<{ text: string; at: number } | null>(null);
  const lineRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (said) lineRef.current?.focus();
  }, [said]);
  const open = useCallback(() => setOpened(true), []);
  return {
    open,
    dialog: opened ? (
      <MoveExamDialog
        {...dialog}
        onClose={() => setOpened(false)}
        onMoved={(day) => {
          setOpened(false);
          setSaid((current) => ({ text: copy.moved(safeDayText(day) ?? day), at: (current?.at ?? 0) + 1 }));
          reload();
        }}
      />
    ) : null,
    line: said ? (
      <p key={`moved-${said.at}`} ref={lineRef} className={`${className} mv-moved`} role="status" tabIndex={-1}>
        {said.text}
      </p>
    ) : null,
  };
}
