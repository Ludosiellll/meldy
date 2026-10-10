import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ContainerSummary, DayPlan, LocalDay, PlanInput } from '../../types/container';
import DailyReminder from '../reminders/DailyReminder';
import { TelegramRemindLink } from '../telegram/TelegramCard';
import { Mark } from './ui';
import { RoomBar } from './RoomParts';
import { planText, safeStart, text as lineWords } from './planLines';
import * as copy from './copy';
import {
  comesBackWhen,
  firstCountWhen,
  laterToday,
  minutesOf,
  moreNew,
  sessionHref,
  studyHref,
  subjectTitle,
  type Figure,
  type SessionSummary,
} from './model';
import './room.css';

/**
 * The end of a «занятие» (decision 49; Concept 1 §3.9 with the critique's lines): one headline — the figure's change
 * («Теперь 147 из 960 — верно в два разных дня»), or, when it did not move, «20 вопросов за 11 минут» — then one muted
 * paragraph, then what is left today and the one pill: the next session, or «Готово» when the day is done — taken once
 * when the screen opens, so the plan read again after the session never changes it under the finger. After the first
 * session ever: the daily reminder (the calendar until the Telegram bot), and «Готово» opens the guide (decision 33).
 * No confetti: the figure's change is the reward.
 */
export interface OralTally {
  know: number;
  unsure: number;
  dontKnow: number;
  questions: number;
}

interface LeftToday {
  /** «Сегодня осталось 20 вопросов, около 9 минут.», or the plan's own line when nothing is left. */
  line: string;
  next: { href: string; label: string } | null;
  more: { href: string; label: string } | null;
}

/**
 * What is left today as the plan stood when the session ended: the plan without what was just answered, the next
 * session and its blue label (the same subject first), or «Ещё 20 новых» when the day is done. Taken once, when the
 * end screen opens: the plan read again after the session (StudyPage's reload) never changes the screen being read.
 */
function leftToday(p: { containerId: string; summary: ContainerSummary; subjectId: string; plan: DayPlan | null; input: PlanInput | null; answered: ReadonlySet<string> }): LeftToday {
  const { containerId, summary, subjectId, plan, input, answered } = p;
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
  let nextTarget: LeftToday['next'] = null;
  if (next && nextHref) {
    let label: string;
    if (next.kind === 'ai_check') label = safeStart(Math.min(3, next.ids.length), null, null, 'ai_check');
    else if (next.subjectId === subjectId) label = copy.moreQuestions(next.ids.length);
    else label = copy.nextSubject(subjectTitle(summary, next.subjectId), next.ids.length);
    nextTarget = { href: nextHref, label };
  }
  const extra = !nextTarget ? moreNew(input, plan, answered) : null;
  const more = extra ? { href: studyHref(containerId, { s: extra.subjectId, only: 'new' }), label: lineWords({ key: 'more_new', n: [extra.ids.length] }) } : null;
  const line = nextTarget ? copy.leftToday(leftQuestions, leftMinutes) : plan ? planText(plan) : '';
  return { line, next: nextTarget, more };
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
    // What comes back after today comes back on a study day (input.studyWeekdays): «завтра», or the next one
    // («в понедельник»), the word of the verdicts in the session.
    const back = comesBackWhen(today, input?.studyWeekdays);
    if (stats.errors > 0) parts.push(copy.errorsBack(stats.errors, back));
    if (stats.dropped > 0) parts.push(copy.droppedLine(stats.dropped));
    if (stats.tooEarly > 0) parts.push(copy.tooEarlyLine(stats.tooEarly, laterToday(stats.tooEarlyAt, today, tz), back));
    if (base.twoDays === 0 && !moved && stats.started > 0) {
      const first = firstCountWhen(stats.firstCountAt, today, tz, input?.studyWeekdays);
      parts.push(copy.firstCountLine(first.time, first.when));
    }
  } else if (oral) {
    parts.push(copy.selfCheckLine(oral.know, oral.unsure, oral.dontKnow));
  }

  // ── what is left today: taken once, when the screen opens (leftToday)
  const [left] = useState(() => leftToday({ containerId, summary, subjectId, plan, input, answered }));
  const { line: nextLine, next, more } = left;

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
          {next ? (
            <button type="button" className="sf-link" onClick={onDone}>
              {copy.DONE}
            </button>
          ) : null}
          {!next && more ? (
            <Link className="sf-link" data-muted="" to={more.href}>
              {more.label}
            </Link>
          ) : null}
        </div>
        {firstEver ? (
          <div className="ct-end-links">
            <TelegramRemindLink fallback={<DailyReminder variant="today" examId={containerId} />} />
          </div>
        ) : null}
        <div className="ct-bar">
          <div className="ct-bar-row" style={wide ? undefined : { width: '100%' }}>
            {next ? (
              <Link className="sf-primary" to={next.href}>
                {next.label}
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
