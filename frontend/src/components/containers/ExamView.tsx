import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DayPlan } from '../../types/container';
import type { ContainerData } from '../../lib/containers/hooks';
import { withdrawDoubt } from '../../api/containers';
import { dayText } from '../../lib/containers/words';
import { usePhone } from '../../lib/usePhone';
import { useAuth } from '../../hooks/useAuth';
import PageHead from './PageHead';
import PlanCard, { PlanTitle } from './PlanCard';
import FigureBlock from './FigureBlock';
import Rows, { type RowView } from './Rows';
import { PlanByDaysSheet, type DateGroup } from './Sheets';
import { NoteLine } from './ui';
import { startTarget, useExamActions } from './actions';
import { useWide } from './useWide';
import { firstCountText, planLineViews, planText, type LineView } from './planLines';
import * as copy from './copy';
import {
  examDates,
  examFigure,
  examPlanNumbers,
  examQuestions,
  errorIds,
  isAuthor,
  metaDay,
  newIds,
  oralCount,
  setAsideIds,
  studyHref,
  subjectFigure,
  subjectKind,
  subjectWithNew,
  dayDiff,
} from './model';
import { loadSession, resumable } from './sessionStore';

/**
 * The exam page, two subjects or more (Concept 1 §3.3 with spec decisions 8, 16–18, 35, 44, 46 and the design
 * critique's lines): the header with the exam's «⋯»; today's step in the plan card; the figure; the subjects as rows
 * of one card; the quiet lines (keys, doubts, lectures); the one blue pill — in the card on a computer, in the bar at
 * the bottom on a phone and a tablet.
 */
export interface ViewProps {
  containerId: string;
  data: ContainerData;
  plan: DayPlan | null;
  offline: boolean;
  reload: () => void;
}

export interface LinkTargets {
  onMinutes: () => void;
  settingsHref: string;
  lecturesHref: string | null;
  moreNewHref: string | null;
  errorsHref: string | null;
}

/** The link a plan line carries («Изменить время», «Указать дату», «Добавить лекции»). */
export function linkFor(action: LineView['action'], p: LinkTargets): ReactNode {
  switch (action) {
    case 'minutes':
      return (
        <button type="button" className="sf-link" onClick={p.onMinutes}>
          {copy.CHANGE_MINUTES}
        </button>
      );
    case 'date':
      return (
        <Link className="sf-link" to={p.settingsHref}>
          {copy.SET_DATE}
        </Link>
      );
    case 'lectures':
      return p.lecturesHref ? (
        <Link className="sf-link" to={p.lecturesHref}>
          {copy.ADD_LECTURES}
        </Link>
      ) : null;
    default:
      return null;
  }
}

/** A line that is a link on its own («Ещё 20 новых», «20 вопросов, где были ошибки»). */
export function lineLink(line: LineView, p: LinkTargets): ReactNode {
  const href = line.action === 'more_new' ? p.moreNewHref : line.action === 'errors' ? p.errorsHref : null;
  return href ? (
    <Link key={line.key} className="sf-link" to={href}>
      {line.text}
    </Link>
  ) : null;
}

/** The plan's notes in the card: each line with its link; the link-only lines are left to the card's links. */
export function noteLines(lines: LineView[], p: LinkTargets): ReactNode[] {
  return lines.filter((line) => !line.linkOnly).map((line) => <NoteLine key={line.key} text={line.text} action={linkFor(line.action, p)} />);
}

export default function ExamView({ containerId, data, plan, offline, reload }: ViewProps) {
  const { summary, planInput, items, oralWithoutPoints } = data;
  const phone = usePhone();
  const wide = useWide();
  const { user } = useAuth();
  const [daysOpen, setDaysOpen] = useState(false);
  const [returning, setReturning] = useState(false);
  const today = plan?.day ?? summary.day;
  const author = isAuthor(summary.role);
  const dates = examDates(summary);
  const day = metaDay(dates, today);
  const figure = examFigure(summary, plan);
  const nextDateText = day.next ? dayText(day.next) : null;
  const settingsHref = `/exams/c/${containerId}/settings`;
  const { actions, openMinutes, remove, dialogs } = useExamActions({ containerId, summary, input: planInput, figure, nextDateText, reload });
  const saved = useMemo(() => (user?.id ? resumable(loadSession(user.id, containerId), today) : null), [user?.id, containerId, today]);
  const planned = useMemo(() => new Set(plan?.sessions.flatMap((session) => session.ids) ?? []), [plan]);

  // The oral part that waits for lectures (decision 35): its editor's lectures, back to this exam by ?from=c:.
  const lecturesSubject = summary.subjects.find((subject) => oralCount(subject) > 0 && subject.oral?.exam_id && !(planInput?.items ?? []).some((item) => item.f === 'o' && item.s === subject.id));
  const lecturesHref = lecturesSubject?.oral?.exam_id ? `/exams/${lecturesSubject.oral.exam_id}/edit?from=c:${containerId}#lectures` : null;
  const moreNewSubject = subjectWithNew(summary, planInput, planned);
  const moreNewHref = moreNewSubject && newIds(planInput, moreNewSubject, planned, 1).length > 0 ? studyHref(containerId, { s: moreNewSubject, only: 'new' }) : null;

  // ── the plan card
  const errorsSubject = (() => {
    const todays = summary.subjects.filter((subject) => subject.exam_date === today);
    return (todays.length > 0 ? todays : summary.subjects).find((subject) => errorIds(planInput, subject.id, 1).length > 0) ?? null;
  })();
  const errorsHref = errorsSubject ? studyHref(containerId, { s: errorsSubject.id, only: 'errors' }) : null;
  const targets: LinkTargets = { onMinutes: openMinutes, settingsHref, lecturesHref, moreNewHref, errorsHref };
  const lines = planLineViews(plan);
  const hasLine = (action: LineView['action']) => lines.some((line) => line.action === action);
  const cardNotes: ReactNode[] = [];
  if (offline) cardNotes.push(<NoteLine key="offline" text={copy.OFFLINE_PAGE} />);
  cardNotes.push(...noteLines(lines, targets));
  if (day.noDate && !hasLine('date')) cardNotes.push(<NoteLine key="nodate" text={copy.NO_DATE_LINE} action={linkFor('date', targets)} />);

  const start = startTarget({ containerId, summary, plan, saved, wide });
  const state = plan?.state ?? 'study';
  const lineLinks = lines.filter((line) => line.linkOnly).map((line) => lineLink(line, targets)).filter(Boolean);
  let title: ReactNode;
  let sub: ReactNode = null;
  let links: ReactNode = null;
  let pill: { href: string; label: string } | null = null;
  if (day.passed || state === 'after') {
    title = copy.AFTER_EXAM;
    links = (
      <>
        <Link className="sf-link" to={settingsHref}>
          {copy.SET_NEW_DATE}
        </Link>
        {author ? (
          <button type="button" className="sf-link" data-muted="" onClick={remove}>
            {copy.DELETE_EXAM_LINK}
          </button>
        ) : null}
      </>
    );
  } else if (state === 'exam_today') {
    title = copy.EXAM_TODAY;
    if (lineLinks.length > 0) links = lineLinks;
    else if (errorsHref && errorsSubject) {
      links = (
        <Link className="sf-link" to={errorsHref}>
          {copy.errorsBeforeExam(Math.min(20, errorIds(planInput, errorsSubject.id).length))}
        </Link>
      );
    }
  } else if (plan && state === 'study') {
    const numbers = examPlanNumbers(plan);
    title = <PlanTitle questions={numbers.questions} minutes={numbers.minutes} left={numbers.left} />;
    const parts = copy.planParts(numbers);
    sub = (
      <>
        {parts ? `${parts} ` : null}
        <button type="button" className="sf-link" aria-haspopup="dialog" onClick={() => setDaysOpen(true)}>
          {copy.PLAN_BY_DAYS}
        </button>
      </>
    );
    pill = start;
  } else if (plan) {
    title = planText(plan) || copy.SUBJECT_DONE;
    if (lineLinks.length > 0) links = lineLinks;
    else if (moreNewHref) links = <Link className="sf-link" to={moreNewHref}>{copy.MORE_NEW}</Link>;
  } else {
    // No plan (the engine could not run): the page still shows the exam and its subjects.
    title = copy.SUBJECT_DONE;
  }
  if (saved && !pill && !day.passed) pill = start;

  // ── the rows
  const rows: RowView[] = summary.subjects.map((subject) => {
    const kind = subjectKind(subject);
    const share = plan?.perSubject.find((row) => row.subjectId === subject.id);
    const ownDate = dates.length > 1 && subject.exam_date ? dayText(subject.exam_date) : null;
    const passed = subject.exam_date ? (dayDiff(today, subject.exam_date) ?? 0) < 0 : false;
    const f = subjectFigure(subject, plan);
    if (kind === 'oral') {
      const examId = subject.oral?.exam_id ?? null;
      const inPlan = (planInput?.items ?? []).filter((item) => item.f === 'o' && item.s === subject.id).length;
      return {
        key: subject.id,
        title: subject.title,
        meta: copy.subjectRowOral({ twoDays: f.twoDays, inPlan, questions: oralCount(subject), today: share?.items ?? 0, dateText: ownDate }),
        to: examId ? `/exams/${examId}?from=c:${containerId}` : `/exams/c/${containerId}/s/${subject.id}`,
      };
    }
    return {
      key: subject.id,
      title: subject.title,
      meta: kind === 'empty' ? copy.subjectRowEmpty : copy.subjectRowTest({ twoDays: f.twoDays, keyed: subject.keyed, seen: f.seen, today: share?.items ?? 0, dateText: ownDate, passed }),
      to: `/exams/c/${containerId}/s/${subject.id}`,
    };
  });

  // ── the quiet lines under the rows
  const noKey = summary.subjects.reduce((sum, subject) => sum + subject.no_key, 0);
  const doubted = summary.subjects.reduce((sum, subject) => sum + subject.doubted, 0);
  const notes: ReactNode[] = [];
  if (noKey > 0) {
    notes.push(
      <NoteLine
        key="nokey"
        text={copy.noKeyLine(noKey)}
        action={
          author ? (
            <Link className="sf-link" to={`/exams/c/${containerId}/keys`}>
              {copy.MARK_ANSWERS}
            </Link>
          ) : undefined
        }
      />,
    );
  }
  if (author && (summary.owner?.doubts_open ?? 0) > 0) {
    notes.push(
      <NoteLine
        key="doubts"
        text={copy.doubtsLine(summary.owner!.doubts_open)}
        action={
          <Link className="sf-link" to={`/exams/c/${containerId}/keys`}>
            {copy.LOOK}
          </Link>
        }
      />,
    );
  }
  if (doubted > 0) {
    const returnAll = async () => {
      if (returning) return;
      setReturning(true);
      try {
        await Promise.all(setAsideIds(items, planInput).map((id) => withdrawDoubt(id)));
        reload();
      } finally {
        setReturning(false);
      }
    };
    notes.push(
      <NoteLine
        key="aside"
        text={copy.setAsideLine(doubted)}
        action={
          <button type="button" className="sf-link" aria-busy={returning || undefined} onClick={() => void returnAll()}>
            {copy.RETURN_TO_PLAN}
          </button>
        }
      />,
    );
  }
  if (!author && summary.key_changes_unseen > 0) notes.push(<NoteLine key="fixed" text={copy.keyFixedLine(summary.key_changes_unseen)} />);
  if (oralWithoutPoints > 0 && !hasLine('lectures')) {
    notes.push(<NoteLine key="lectures" text={copy.oralNoLecturesLine(oralWithoutPoints)} action={linkFor('lectures', targets)} />);
  }

  const groups: DateGroup[] = dates.map((date) => ({
    date,
    subjects: summary.subjects.filter((subject) => (subject.exam_date ?? summary.exam_date) === date).map((subject) => subject.title),
  }));
  const pillNode = pill ? (
    <Link className="sf-primary" to={pill.href}>
      {pill.label}
    </Link>
  ) : null;
  const meta = copy.metaLine(day.text, examQuestions(summary), phone ? null : summary.subjects.length);

  return (
    <div className="sf-page ct-page" data-view="exam">
      <PageHead title={summary.title} meta={meta} crumb={{ to: '/exams', label: copy.TO_EXAMS }} actions={actions} menuLabel={copy.MENU_LABEL_EXAM} phone={phone} />
      <PlanCard id={`ct-plan-${containerId}`} title={title} sub={sub} links={links} notes={cardNotes} action={wide ? pillNode : null} />
      <div className="ct-body">
        <FigureBlock figure={figure} firstLine={firstCountText(plan)} />
        <div className="ct-main">
          <Rows rows={rows} label={copy.SUBJECTS_LABEL} />
          {notes.length > 0 ? <div className="ct-notes">{notes}</div> : null}
        </div>
      </div>
      {!wide && pillNode ? <div className="ct-cta">{pillNode}</div> : null}
      {daysOpen ? (
        <PlanByDaysSheet
          today={today}
          minutes={summary.settings.minutes_per_day}
          firstPlanDay={summary.first_plan_day}
          groups={groups}
          noDate={day.noDate}
          settingsHref={settingsHref}
          onClose={() => setDaysOpen(false)}
          onMinutes={() => {
            setDaysOpen(false);
            openMinutes();
          }}
        />
      ) : null}
      {dialogs}
    </div>
  );
}
