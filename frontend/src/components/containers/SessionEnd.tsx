import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { ContainerSummary, DayPlan, LocalDay, PlanInput } from '../../types/container';
import DailyReminder from '../reminders/DailyReminder';
import { Mark } from './ui';
import { RoomBar } from './RoomParts';
import { planText } from './planLines';
import * as copy from './copy';
import {
  laterToday,
  minutesOf,
  newIds,
  sessionHref,
  studyHref,
  subjectTitle,
  subjectWithNew,
  tomorrowTime,
  type Figure,
  type SessionSummary,
} from './model';
import './room.css';

/**
 * The end of a «занятие» (decision 49; Concept 1 §3.9 with the critique's lines): one headline — the figure's change
 * («Теперь 147 из 960 — верно в два разных дня»), or, when it did not move, «20 вопросов за 11 минут» — then one muted
 * paragraph, then what is left today and the one pill: the next session, or «Готово» when the day is done. After the
 * first session ever: the daily reminder (the calendar until the Telegram bot), and «Готово» opens the guide
 * (decision 33). No confetti: the figure's change is the reward.
 */
export interface OralTally {
  know: number;
  unsure: number;
  dontKnow: number;
  questions: number;
}

export default function SessionEnd({
  containerId,
  summary,
  subjectId,
  stats,
  oral,
  minutes,
  base,
  plan,
  input,
  answered,
  tz,
  today,
  firstEver,
  wide,
  onDone,
}: {
  containerId: string;
  summary: ContainerSummary;
  subjectId: string;
  stats: SessionSummary | null;
  oral: OralTally | null;
  minutes: number;
  base: Figure;
  plan: DayPlan | null;
  input: PlanInput | null;
  answered: ReadonlySet<string>;
  tz: string;
  today: LocalDay;
  firstEver: boolean;
  wide: boolean;
  onDone: () => void;
}) {
  const headRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    headRef.current?.focus({ preventScroll: true });
  }, []);
  const title = subjectTitle(summary, subjectId);

  // ── the headline and the paragraph
  const moved = Boolean(stats && stats.known && (stats.gained > 0 || stats.dropped > 0));
  const questions = stats?.questions ?? oral?.questions ?? 0;
  const time = copy.sessionTime(questions, stats?.retries ?? 0, minutes);
  let headline;
  if (moved && stats) {
    const [lead, marked, tail] = copy.nowFigureParts(Math.max(0, base.twoDays + stats.gained - stats.dropped), base.total);
    headline = (
      <>
        {lead}
        <Mark>{marked}</Mark>
        {tail}
      </>
    );
  } else {
    headline = time;
  }
  const parts: string[] = [];
  if (stats) {
    if (moved) parts.push(`${time}.`);
    if (stats.questions > 0) parts.push(copy.firstRight(stats.firstRight, stats.questions));
    if (stats.errors > 0) parts.push(copy.errorsBack(stats.errors));
    if (stats.dropped > 0) parts.push(copy.droppedLine(stats.dropped));
    if (stats.tooEarly > 0) parts.push(copy.tooEarlyLine(stats.tooEarly, laterToday(stats.tooEarlyAt, today, tz)));
    if (base.twoDays === 0 && !moved && stats.started > 0) parts.push(copy.firstCountLine(tomorrowTime(stats.firstCountAt, today, tz)));
  } else if (oral) {
    parts.push(copy.selfCheckLine(oral.know, oral.unsure, oral.dontKnow));
  }

  // ── what is left today: the plan without what was just answered (the plan read again replaces it when it arrives)
  const rest = (plan?.sessions ?? [])
    .map((session) => {
      const ids = session.ids.filter((id) => !answered.has(id));
      return { ...session, ids, estSec: session.ids.length > 0 ? Math.round((session.estSec * ids.length) / session.ids.length) : 0 };
    })
    .filter((session) => session.ids.length > 0);
  const next = rest.find((session) => session.subjectId === subjectId && session.kind !== 'ai_check') ?? rest[0] ?? null;
  const leftQuestions = rest.reduce((sum, session) => sum + session.ids.length, 0);
  const leftMinutes = minutesOf(rest.reduce((sum, session) => sum + session.estSec, 0));
  const nextHref = next ? sessionHref(containerId, summary, next) : null;
  let nextLabel: string | null = null;
  if (next && nextHref) {
    if (next.kind === 'ai_check') nextLabel = copy.ANSWER_ALOUD(Math.min(3, next.ids.length));
    else if (next.subjectId === subjectId) nextLabel = copy.moreQuestions(next.ids.length);
    else nextLabel = copy.nextSubject(subjectTitle(summary, next.subjectId), next.ids.length);
  }
  const planned = new Set(plan?.sessions.flatMap((session) => session.ids) ?? []);
  const newSubject = !next ? subjectWithNew(summary, input, new Set([...planned, ...answered]), subjectId) : null;
  const moreNewHref = newSubject && newIds(input, newSubject, new Set([...planned, ...answered]), 1).length > 0 ? studyHref(containerId, { s: newSubject, only: 'new' }) : null;
  const nextLine = next ? copy.leftToday(leftQuestions, leftMinutes) : plan ? planText(plan) : '';

  return (
    <>
      <RoomBar long={title} short={title} exitLabel={copy.END_EXIT} onExit={onDone} />
      <main className="sf-page ct-study ct-end">
        <h1 className="ct-end-h" ref={headRef} tabIndex={-1}>
          {headline}
        </h1>
        {parts.length > 0 ? <p className="ct-end-p">{parts.join(' ')}</p> : null}
        {nextLine ? <p className="ct-end-next">{nextLine}</p> : null}
        <div className="ct-end-links">
          {next && nextHref ? (
            <button type="button" className="sf-link" onClick={onDone}>
              {copy.DONE}
            </button>
          ) : null}
          {!next && moreNewHref ? (
            <Link className="sf-link" data-muted="" to={moreNewHref}>
              {copy.MORE_NEW}
            </Link>
          ) : null}
        </div>
        {firstEver ? (
          <div className="ct-end-links">
            <DailyReminder variant="today" examId={containerId} />
          </div>
        ) : null}
        <div className="ct-bar">
          <div className="ct-bar-row" style={wide ? undefined : { width: '100%' }}>
            {next && nextHref && nextLabel ? (
              <Link className="sf-primary" to={nextHref}>
                {nextLabel}
              </Link>
            ) : (
              <button type="button" className="sf-primary" onClick={onDone}>
                {copy.DONE}
              </button>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
