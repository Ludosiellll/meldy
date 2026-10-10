import { Link } from 'react-router-dom';
import type { PlanInput, SummarySubject } from '../../types/container';
import { daysAhead, type DayRow } from '../../lib/containers/plan';
import { SKIP_NOTE, dayRowText } from '../../lib/containers/words';
import { Sheet } from './ui';
import { noDateText } from './planLines';
import * as copy from './copy';

// ─────────────────────────────────────────────── «План по дням» (Concept 1 §3.3 with the critique's rows)

/**
 * The rows of «План по дням» from the study engine (lib/containers/plan.ts daysAhead, words.ts dayRowText): study days
 * at about the minutes a day, the final days without a promised number of minutes, each exam day — with whose exam it
 * is when the subjects have different dates.
 */
export function dayRows(input: PlanInput | null, subjects: readonly SummarySubject[]): Array<{ key: string; text: string }> {
  if (!input) return [];
  let rows: DayRow[];
  try {
    rows = daysAhead(input);
  } catch {
    return [];
  }
  const dates = new Set(subjects.map((subject) => subject.exam_date).filter(Boolean));
  const names = new Map(subjects.map((subject) => [subject.id, subject.title]));
  return rows.map((row) => {
    let text = '';
    try {
      text = dayRowText(row);
    } catch {
      text = '';
    }
    if (row.kind === 'exam' && dates.size > 1) {
      const whose = row.subjectIds.map((id) => names.get(id)).filter(Boolean).join(', ');
      if (whose) text = `${text}: ${whose}`;
    }
    return { key: `${row.kind}-${row.from}`, text };
  }).filter((row) => row.text);
}

export function PlanByDaysSheet({
  input,
  subjects,
  minutes,
  noDate,
  settingsHref,
  minutesHref,
  onClose,
}: {
  input: PlanInput | null;
  subjects: readonly SummarySubject[];
  minutes: number;
  noDate: boolean;
  settingsHref: string;
  minutesHref: string;
  onClose: () => void;
}) {
  const rows = dayRows(input, subjects);
  return (
    <Sheet title={copy.PLAN_BY_DAYS} onClose={onClose}>
      <ul className="ct-days">
        <li>
          {copy.daysMinutesRow(minutes)}
          {copy.SEP}
          <Link className="sf-link" to={minutesHref}>
            {copy.CHANGE}
          </Link>
        </li>
        {noDate ? (
          <li>
            {noDateText()}{' '}
            <Link className="sf-link" to={settingsHref}>
              {copy.SET_DATE}
            </Link>
          </li>
        ) : null}
        {rows.map((row) => (
          <li key={row.key}>{row.text}</li>
        ))}
      </ul>
      <p data-muted="">{SKIP_NOTE}</p>
    </Sheet>
  );
}

// ─────────────────────────────────────────────── a topic (Concept 1 §3.4)

export function TopicSheet({
  title,
  keyed,
  twoDays,
  errors,
  count,
  href,
  onClose,
}: {
  title: string;
  keyed: number;
  twoDays: number;
  errors: number;
  /** The questions a block of this topic takes now (≤ 20). */
  count: number;
  href: string;
  onClose: () => void;
}) {
  return (
    <Sheet
      title={title}
      onClose={onClose}
      actions={
        count > 0 ? (
          <Link className="sf-primary" to={href} data-autofocus="">
            {copy.topicStart(count)}
          </Link>
        ) : undefined
      }
    >
      <p data-muted="">{copy.topicSheetMeta({ keyed, twoDays, errors })}</p>
      {count === 0 ? <p>{copy.TOPIC_EMPTY}</p> : null}
    </Sheet>
  );
}
