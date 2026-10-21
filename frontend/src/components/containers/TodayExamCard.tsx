/**
 * The «Сегодня» card of an exam container (package D3b builds it; spec §16 #47): the same anatomy as today's oral
 * exam card — flag, one meta line, the one blue button, then the blue number. Package E places it on «Сегодня».
 *
 * - The flag «Экзамен через 19 дней» (yellow at three days or less), the name, «28 октября · 960 вопросов» — the size
 *   the exam's page says, oral questions included (`questions`; model.ts overviewQuestions).
 * - One line of today's step: «Сегодня 90 вопросов, около 45 минут.», then the pill «Начать: 20 вопросов» (a session
 *   left today: «Продолжить…»); when the day is done the plan's line («На сегодня всё. Завтра около 40 минут.») and no
 *   pill, so «Начать повторение» can take the blue.
 * - Under a hairline the figure as the oral card shows its share: a blue «143» and «из 960 верно в два разных дня →»,
 *   the link to the exam's page. While nothing counts yet: the dated line of the plan; before any answer: the rule in
 *   one line. No «Видели N из M» (decision 47).
 * The card leads «Сегодня» (`lead`) or steps aside: then its pill is white on a computer, a quiet link on a phone.
 * On the exam's own day a quiet «Перенести» (`onMove`: «Сегодня» opens «Перенести экзамен», release 47).
 */
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DayPlan, LocalDay, OverviewContainer } from '../../types/container';
import { RULE_LINE, dayText } from '../../lib/containers/words';
import { learnLeftLine } from '../../lib/containers/topics';
import { usePhone } from '../../lib/usePhone';
import { useAuth } from '../../hooks/useAuth';
import { figureWords, planText, safeStart, titleText } from './planLines';
import * as copy from './copy';
import { dayDiff, dayIn, firstSession, minutesOf, overviewQuestions, studyHref } from './model';
import { loadSession, resumable, resumeCounts } from './sessionStore';
import { useWide } from './useWide';
import './containers.css';

export interface TodayExamCardProps {
  container: OverviewContainer;
  plan: DayPlan | null; // null while loading
  /** The exam's size as its page says it (model.ts examQuestions of its summary), once read: oral questions included. */
  questions?: number | null;
  offline?: boolean;
  /** This card leads «Сегодня» and holds the page's one blue button. */
  lead: boolean;
  /** On the exam's own day: «Перенести» opens «Перенести экзамен» («Сегодня» holds the dialog). */
  onMove?: () => void;
  /** «Осталось выучить 9 тем из 12» (topicsOf.ts examTopicCounts over the plan's input and learn_left), once known. */
  topics?: { left: number; total: number } | null;
}

function ArrowIcon() {
  return (
    <svg className="td-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function PillDot() {
  return (
    <span className="td-dot" aria-hidden="true">
      <ArrowIcon />
    </span>
  );
}

function localToday(): LocalDay {
  let tz = 'Europe/Minsk';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz;
  } catch {
    // The default zone of the plan.
  }
  return dayIn(Date.now(), tz);
}

/** The nearest test date still ahead (or today), else the last one, else null. */
export function nearestDate(container: OverviewContainer, today: LocalDay): LocalDay | null {
  const dates = Array.from(new Set([...container.subjects.map((subject) => subject.exam_date), container.exam_date].filter((day): day is string => Boolean(day)))).sort();
  return dates.find((date) => (dayDiff(today, date) ?? -1) >= 0) ?? dates[dates.length - 1] ?? null;
}

export default function TodayExamCard({ container, plan, questions = null, offline = false, lead, onMove, topics = null }: TodayExamCardProps) {
  const titleId = useId();
  const phone = usePhone();
  const wide = useWide();
  const { user } = useAuth();
  const today = plan?.day ?? localToday();
  const page = `/exams/c/${container.id}`;
  const date = nearestDate(container, today);
  const days = date ? dayDiff(today, date) : null;
  const flag = date && days !== null && days >= 0 ? copy.todayFlag(days) : null;
  // The exam's one size, as its page and «Экзамены» say it (usability check 2026-10-10, m6).
  const meta = copy.todayMeta(date ? dayText(date) : null, overviewQuestions(container, questions));

  // ── today's step and the pill
  const saved = user?.id ? resumable(loadSession(user.id, container.id), today) : null;
  let line: string;
  let target: { href: string; label: string } | null = null;
  if (!plan) {
    line = copy.TODAY_LOADING;
  } else if (saved) {
    const counts = resumeCounts(saved);
    const title = plan.state === 'study' ? titleText(plan) : '';
    line = title ? `${title}.` : planText(plan) || copy.SUBJECT_DONE;
    target = { href: studyHref(container.id, { resume: 1 }), label: safeStart(counts.of - counts.done, null, counts) };
  } else if (plan.state === 'study' && plan.sessions.length > 0) {
    const title = titleText(plan);
    line = title ? `${title}.` : planText(plan);
    const session = firstSession(plan);
    if (session) {
      // Two or more subjects with work today: the pill names the subject it starts (usability m3, as on the exam page).
      const working = new Set(plan.sessions.filter((entry) => entry.ids.length > 0).map((entry) => entry.subjectId));
      const subject = working.size > 1 ? container.subjects.find((entry) => entry.id === session.subjectId)?.title ?? '' : '';
      if (session.kind === 'ai_check') {
        const examId = container.subjects.find((entry) => entry.id === session.subjectId)?.oral_exam_id ?? null;
        const count = Math.min(3, session.ids.length);
        if (examId) {
          target = {
            href: `/exams/${examId}/ticket?q=${session.ids.slice(0, 3).join(',')}&from=c:${container.id}`,
            label: subject ? copy.aloudSubject(subject, count) : safeStart(count, null, null, 'ai_check'),
          };
        }
      } else {
        target = {
          href: studyHref(container.id, { s: session.subjectId, kind: session.kind === 'self_check' ? 'self_check' : null }),
          label: subject ? copy.startSubject(subject, session.ids.length) : safeStart(session.ids.length, wide ? minutesOf(session.estSec) : null, null),
        };
      }
    }
  } else {
    line = planText(plan) || copy.SUBJECT_DONE;
  }

  let pill: ReactNode = null;
  if (target) {
    pill =
      phone && !lead ? (
        <Link className="sf-link td-alt" to={target.href}>
          {target.label}
        </Link>
      ) : (
        <Link className={lead ? 'sf-primary' : 'sf-secondary td-pill'} to={target.href}>
          {target.label}
          {lead ? null : <PillDot />}
        </Link>
      );
  }

  const moveButton =
    onMove && plan?.state === 'exam_today' ? (
      <button type="button" className="sf-link td-alt" aria-haspopup="dialog" onClick={onMove}>
        {copy.MOVE_SHORT}
      </button>
    ) : null;

  // ── the figure
  const figure = plan
    ? { twoDays: plan.figure.twoDays, total: plan.figure.inPlan, seen: plan.figure.seen, errors: plan.figure.errors }
    : container.subjects.reduce(
        (sum, subject) => ({ twoDays: sum.twoDays + subject.two_days, total: sum.total + subject.keyed, seen: sum.seen + subject.seen, errors: sum.errors + subject.open_errors }),
        { twoDays: 0, total: 0, seen: 0, errors: 0 },
      );
  // The figure in the plan's words (words.ts figureLines): the number, or the dated first-count line, or the rule.
  const words = figureWords(figure, plan, today);
  let figureRow: ReactNode;
  if (figure.twoDays > 0 && words?.big) {
    figureRow = (
      <p className="td-share">
        <Link className="tc-fig-link" to={page}>
          <span className="td-share-fig">{words.big}</span>
          <span className="td-share-cap">
            {copy.glue(`${words.of} ${words.label}`)}
            <ArrowIcon />
          </span>
        </Link>
      </p>
    );
  } else {
    const text = (figure.seen > 0 ? words?.label : null) || RULE_LINE;
    figureRow = (
      <p className="td-sheet">
        <Link className="tc-rule-link" to={page}>
          {copy.glue(text.replace(/[.]$/, ''))}
          <ArrowIcon />
        </Link>
      </p>
    );
  }

  return (
    <article className="td-card td-main td-exam td-rise" data-d="2" data-phone={phone ? '' : undefined} data-container="" aria-labelledby={titleId}>
      {flag ? (
        <span className="td-flag" data-tone={days !== null && days <= 3 ? 'y' : 'g'} aria-hidden="true">
          {flag}
        </span>
      ) : null}
      <h2 className="td-h2" id={titleId}>
        {container.title}
        {flag ? <span className="sr-only">{` — ${flag.toLocaleLowerCase('ru-RU')}`}</span> : null}
      </h2>
      {meta ? <p className="td-meta">{meta}</p> : null}
      <div className="td-next">
        <p className="td-erase-t tc-today">{line}</p>
        {pill || moveButton ? (
          <div className="td-actions">
            {pill}
            {moveButton}
          </div>
        ) : null}
      </div>
      {offline ? <p className="tc-note">{copy.OFFLINE_PAGE}</p> : null}
      <div className="td-ready">
        {figureRow}
        {/* Once a topic is learned, as the exam page's rows say it: before, «48 из 48» would read as nothing done. */}
        {topics && topics.total > 0 && topics.left < topics.total ? (
          <p className="td-sheet tc-topics">
            <Link className="tc-rule-link" to={page}>
              {copy.glue(learnLeftLine(topics.left, topics.total))}
              <ArrowIcon />
            </Link>
          </p>
        ) : null}
      </div>
    </article>
  );
}
