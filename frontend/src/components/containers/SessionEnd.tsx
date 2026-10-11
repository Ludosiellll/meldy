import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ContainerSummary, DayPlan, LocalDay, PlanInput } from '../../types/container';
import DailyReminder from '../reminders/DailyReminder';
import { TelegramRemindLink } from '../telegram/TelegramCard';
import { Mark } from './ui';
import { RoomBar } from './RoomParts';
import { firstCountText, planText, safeStart, text as lineWords } from './planLines';
import { sessionOpens } from './studySetup';
import * as copy from './copy';
import {
  comesBackWhen,
  firstCountWhen,
  laterToday,
  minutesOf,
  moreNew,
  planCount,
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
 * paragraph, then what is left today and the one pill: the next session, or «Готово» when the day is done. What is left
 * is the exam page's own count, from the plan read again once the session's answers have left the device (useReplan),
 * so the page after the screen says the same (usability check 2026-10-11, D2); so is the paragraph's «Первые войдут в
 * счёт …» while the figure is 0. They appear once — held in their place, invisible, for at most LEFT_WAIT.ms while that
 * plan comes — and never change under the finger. After the first session ever: the daily reminder (the calendar until
 * the Telegram bot), and «Готово» opens the guide (decision 33). No confetti: the figure's change is the reward.
 */
export interface OralTally {
  know: number;
  unsure: number;
  dontKnow: number;
  questions: number;
}

/** How long the end screen waits for the plan read after the session before it says what is left without it. */
export const LEFT_WAIT = { ms: 1500 };

interface LeftToday {
  /** «Сегодня осталось 20 вопросов, около 9 минут.», «Ещё 4 вопроса — после 14:35.», or the plan's line of the day. */
  line: string;
  next: { href: string; label: string } | null;
  more: { href: string; label: string } | null;
}

/** What the end screen says from the plan: what is left today, and while the figure is 0 the first count. */
interface Said extends LeftToday {
  /** «Первые войдут в счёт сегодня после 14:35 — если снова ответите верно.» (decision 40), the paragraph's last sentence. */
  first: string | null;
}

/** The frozen day is already cut by the real minutes (spent beyond the plan's estimates): fewer answered may leave as many. */
function cutByMinutes(plan: DayPlan, input: PlanInput | null): boolean {
  const budget = Math.max(0, Number(input?.budgetMin) || 0) * 60;
  return plan.counts.doneSec > 0 && plan.counts.leftSec >= budget - plan.counts.doneSec;
}

/**
 * The questions and minutes left today as the end screen says them (leftToday): `after`, the plan read after the
 * session — the exam page's own numbers; else the plan as the session ended, less the session's answers in it.
 */
export function leftNumbers(plan: DayPlan, input: PlanInput | null, answered: ReadonlySet<string>, after: boolean): { count: number; minutes: number } {
  const minutes = minutesOf(plan.counts.leftSec);
  if (after || cutByMinutes(plan, input)) return { count: planCount(plan), minutes };
  const planned = new Set(plan.sessions.flatMap((session) => session.ids));
  const taken = Array.from(answered).filter((id) => planned.has(id)).length;
  return { count: Math.max(0, planCount(plan) - taken), minutes };
}

/**
 * What is left today, in the exam page's numbers (lib/containers/words.ts planTitle: the questions of the whole frozen
 * day, those that count later today among them, and its minutes):
 * - `after`: the plan read after the session, as it is — the page right after shows the same;
 * - else the plan as the session ended, without the session's answers: the page shows as many or fewer, and as many
 *   minutes or fewer (the frozen day only goes down). A day the real minutes already cut keeps its count: there one
 *   answer fewer need not leave one question fewer.
 * The next session (the same subject first) and its pill name what its link opens (sessionOpens, D3). Nothing ready
 * now but questions later today: the plan's own «Ещё 4 вопроса — после 14:35», not the line it had before the session.
 * Nothing left: the plan's line of the day; one from before the session would name the questions done without these,
 * so then just «На сегодня всё.».
 */
function leftToday(p: {
  containerId: string;
  summary: ContainerSummary;
  subjectId: string;
  plan: DayPlan | null;
  input: PlanInput | null;
  answered: ReadonlySet<string>;
  after: boolean;
}): LeftToday {
  const { containerId, summary, subjectId, plan, input, answered, after } = p;
  if (!plan) return { line: '', next: null, more: null };
  const gone: ReadonlySet<string> = after ? new Set() : answered;
  const rest = plan.sessions
    .map((session) => ({ ...session, ids: session.ids.filter((id) => !gone.has(id)) }))
    .filter((session) => session.ids.length > 0);
  const { count, minutes } = leftNumbers(plan, input, answered, after);

  const next = rest.find((session) => session.subjectId === subjectId && session.kind !== 'ai_check') ?? rest[0] ?? null;
  const nextHref = next ? sessionHref(containerId, summary, next) : null;
  let nextTarget: LeftToday['next'] = null;
  if (next && nextHref) {
    const n = sessionOpens({ plan, input, summary, session: next, answered: gone });
    let label: string;
    if (next.kind === 'ai_check') label = safeStart(n, null, null, 'ai_check');
    else if (next.subjectId === subjectId) label = copy.moreQuestions(n);
    else label = copy.nextSubject(subjectTitle(summary, next.subjectId), n);
    nextTarget = { href: nextHref, label };
  }
  const extra = !nextTarget ? moreNew(input, plan, answered) : null;
  const more = extra ? { href: studyHref(containerId, { s: extra.subjectId, only: 'new' }), label: lineWords({ key: 'more_new', n: [extra.ids.length] }) } : null;

  let line: string;
  if (count === 0) line = after || (plan.state !== 'study' && plan.state !== 'done') ? planText(plan) : lineWords({ key: 'nothing' });
  else if (rest.length > 0) line = copy.leftToday(count, minutes);
  else {
    const later = plan.lines.find((entry) => entry.key === 'later');
    const words = later ? lineWords(later) : '';
    line = words ? `${words}.` : copy.leftToday(count, minutes);
  }
  return { line, next: nextTarget, more };
}

function offlineNow(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

/**
 * The plan read again after a session (StudyPage's reload, `onEnded`), asked once every answer of the session has left
 * the device — taken by the server, or kept in the answer queue (offline, an error), which the plan counts as answered
 * today (planInputs.ts) — so it counts each of them, as the exam page right after will. `ask` takes what is on its way
 * (the answer queue's promises); without network it asks at once. `fresh`: the plan and input passed now are that
 * reading. Answers slower than LEFT_WAIT.ms (the end screen has spoken by then) get a reload then too, so the next
 * session is not set up from the plan before this one, and another when they have left.
 */
export function useReplan(input: PlanInput | null, onEnded: () => void): { ask: (sending: ReadonlyArray<Promise<unknown>>) => void; fresh: boolean } {
  const latest = useRef(input);
  latest.current = input;
  const [asked, setAsked] = useState<{ input: PlanInput | null } | null>(null);
  const ask = useCallback(
    (sending: ReadonlyArray<Promise<unknown>>) => {
      const waiting = offlineNow() ? [] : sending;
      const early = waiting.length > 0 ? window.setTimeout(onEnded, LEFT_WAIT.ms) : null;
      void Promise.allSettled(waiting).then(() => {
        if (early !== null) window.clearTimeout(early);
        setAsked({ input: latest.current });
        onEnded();
      });
    },
    [onEnded],
  );
  return { ask, fresh: asked !== null && input !== asked.input };
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
  fresh,
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
  /** The plan as the session ended, then the plan read after it (`fresh`: useReplan). */
  plan: DayPlan | null;
  input: PlanInput | null;
  fresh: boolean;
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
  } else if (oral) {
    parts.push(copy.selfCheckLine(oral.know, oral.unsure, oral.dontKnow));
  }

  /**
   * While the figure is 0 and the session started series: when the first questions count (decision 40). From the plan
   * read after the session, the exam page's own figure line (planLines firstCountText) — a confirmation of the plan
   * can count before this session's answers («сегодня после 14:35», not «завтра»); from the session's answers only
   * when that plan did not come.
   */
  const firstLine = (after: boolean, from: DayPlan | null, fromInput: PlanInput | null): string | null => {
    if (!stats || base.twoDays !== 0 || moved || stats.started === 0) return null;
    if (after) {
      const words = from ? firstCountText(from) : null;
      return words ? `${copy.glue(words)}.` : null;
    }
    const first = firstCountWhen(stats.firstCountAt, today, tz, fromInput?.studyWeekdays);
    return copy.firstCountLine(first.time, first.when);
  };
  const say = (after: boolean, from: DayPlan | null, fromInput: PlanInput | null): Said => ({
    ...leftToday({ containerId, summary, subjectId, plan: from, input: fromInput, answered, after }),
    first: firstLine(after, from, fromInput),
  });

  // ── what the plan says (say): from the plan read after the session the moment it comes, else, after LEFT_WAIT.ms,
  // from the plan as the session ended and the session's answers; then it stays, whatever is read later. Until then
  // the latter holds the place, invisible — the first count at the end of the paragraph and all below it — so nothing
  // seen moves when it comes.
  const [start] = useState(() => ({ plan, input }));
  const [said, setSaid] = useState<Said | null>(() => (fresh ? say(true, plan, input) : null));
  useEffect(() => {
    if (fresh) setSaid((current) => current ?? say(true, plan, input));
    // Only the moment the reading comes matters: a plan read later never changes the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);
  // The late words with the session's latest results (they may come after the screen opens).
  const late = useRef(() => say(false, start.plan, start.input));
  late.current = () => say(false, start.plan, start.input);
  useEffect(() => {
    const timer = window.setTimeout(() => setSaid((current) => current ?? late.current()), LEFT_WAIT.ms);
    return () => window.clearTimeout(timer);
  }, []);
  const { line: nextLine, next, more, first } = said ?? late.current();
  // Held: in its place but out of sight, of the keyboard and of the screen reader.
  const holding = said === null;
  const hidden = holding ? ({ visibility: 'hidden' } as const) : undefined;

  return (
    <>
      <RoomBar long={title} short={title} exitLabel={copy.END_EXIT} onExit={onDone} />
      <main className="sf-page ct-study ct-end">
        <h1 className="ct-end-h" ref={headRef} tabIndex={-1}>
          {headline}
        </h1>
        {parts.length > 0 || first ? (
          <p className="ct-end-p">
            {parts.join(' ')}
            {first ? (
              <span aria-hidden={holding || undefined} style={hidden}>
                {parts.length > 0 ? ` ${first}` : first}
              </span>
            ) : null}
          </p>
        ) : null}
        {nextLine ? (
          <p className="ct-end-next" aria-hidden={holding || undefined} style={hidden}>
            {nextLine}
          </p>
        ) : null}
        <div className="ct-end-links" aria-hidden={holding || undefined} style={hidden}>
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
          <div className="ct-end-links" aria-hidden={holding || undefined} style={hidden}>
            <TelegramRemindLink fallback={<DailyReminder variant="today" examId={containerId} />} />
          </div>
        ) : null}
        <div className="ct-bar">
          <div className="ct-bar-row" aria-hidden={holding || undefined} style={{ ...(wide ? null : { width: '100%' }), ...hidden }}>
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
