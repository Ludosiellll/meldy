import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ContainerSettings, DayPlan } from '../../types/container';
import type { ContainerData } from '../../lib/containers/hooks';
import { containerErrorText, saveSettings, withdrawDoubt } from '../../api/containers';
import { dayText } from '../../lib/containers/words';
import { usePhone } from '../../lib/usePhone';
import { useAuth } from '../../hooks/useAuth';
import PageHead from './PageHead';
import PlanCard, { PlanTitle, type PlanTip } from './PlanCard';
import FigureBlock from './FigureBlock';
import Rows, { type RowView } from './Rows';
import { PlanByDaysSheet } from './Sheets';
import { NoteLine } from './ui';
import { examLinks, startTarget, useExamActions } from './actions';
import { moveFacts, useExamMove } from './MoveExamDialog';
import { useWide } from './useWide';
import { detailText, isDayOff, noDateText, paceNote, planLineViews, planText, text as lineWords, titleText, type LineView, type PaceNote } from './planLines';
import * as copy from './copy';
import {
  errorCount,
  examDates,
  examFigure,
  examQuestions,
  isAuthor,
  metaDay,
  moreNew,
  oralCount,
  setAsideIds,
  studyHref,
  subjectFigure,
  subjectKind,
  dayDiff,
} from './model';
import { loadSession, paceToldAt, markPaceTold, resumable } from './sessionStore';

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
  /** The exam page's first-use tip about today's plan (the Telegram tip), pointing at the plan card (pages/container/ContainerPage). */
  planTip?: PlanTip | null;
}

export interface LinkTargets {
  minutesHref: string;
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
        <Link className="sf-link" to={p.minutesHref}>
          {copy.CHANGE_MINUTES}
        </Link>
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

/** A note of the plan card and what it is about (a plan line's key, or offline / pace / no_date). */
export interface CardNote {
  kind: string;
  node: ReactNode;
}

/**
 * Which note goes first when the card shows only some: what explains today's numbers before what can wait — no
 * network, questions later today, a skipped day, the final days, the AI limit, the pace, the minutes that fall short,
 * no date, the final days announced ahead, then the rest.
 */
const NOTE_RANK: Record<string, number> = {
  offline: 0, later: 1, skip: 2, window_in: 3, ai_limit: 4, pace: 5, short: 6, short_max: 6, need: 6, no_date: 7,
  window_ahead: 8, first_day: 9, oral: 10,
};

/**
 * The card's notes, at most one on a phone and two on a computer (usability check, m9: a phone stacked the final days,
 * the pace and the network into ten lines; phone rule 5 — one line per explanation). The rest wait for a day without
 * the ones before them; their links stay in «⋯» and «План по дням».
 */
export function cardNotes(notes: CardNote[], phone: boolean): ReactNode[] {
  const rank = (note: CardNote) => NOTE_RANK[note.kind] ?? 20;
  return notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => rank(a.note) - rank(b.note) || a.index - b.index)
    .slice(0, phone ? 1 : 2)
    .map(({ note }) => note.node);
}

/**
 * «Вы отвечаете быстрее, чем мы считали: хватит 45 минут в день.» with «Поставить 45» / «Оставить 60» (Concept 2
 * §3.6): told once per stage; «Поставить» saves the minutes and reads the plan again.
 */
function PaceLine({ note, containerId, settings, onTold, reload }: { note: PaceNote; containerId: string; settings: ContainerSettings; onTold: () => void; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = lineWords(note.line);
  if (!words) return null;
  const set = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveSettings(containerId, { minutes_per_day: note.option, study_weekdays: settings.study_weekdays });
      onTold();
      reload();
    } catch (failure) {
      setError(containerErrorText(failure) || copy.SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <NoteLine
        text={words}
        action={
          <>
            <button type="button" className="sf-link" aria-busy={busy || undefined} onClick={() => void set()}>
              {copy.paceSet(note.option)}
            </button>
            {copy.SEP}
            <button type="button" className="sf-link" data-muted="" onClick={onTold}>
              {copy.paceKeep(note.budget)}
            </button>
          </>
        }
      />
      {error ? (
        <p className="ct-sheet-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

export default function ExamView({ containerId, data, plan, offline, reload, planTip }: ViewProps) {
  const { summary, planInput, items, oralWithoutPoints } = data;
  const phone = usePhone();
  const wide = useWide();
  const { user } = useAuth();
  const [daysOpen, setDaysOpen] = useState(false);
  const [returning, setReturning] = useState(false);
  const [paceTold, setPaceTold] = useState(() => paceToldAt(containerId));
  const today = plan?.day ?? summary.day;
  const author = isAuthor(summary.role);
  const dates = examDates(summary);
  const day = metaDay(dates, today);
  const figure = examFigure(summary, plan);
  const hrefs = examLinks(containerId);
  // «Удалить», «Время в день», «Пригласить группу» act here (release 47.3); their dialogs go on the page.
  const { actions, dialogs } = useExamActions({ summary, planInput, reload });
  const saved = useMemo(() => (user?.id ? resumable(loadSession(user.id, containerId), today) : null), [user?.id, containerId, today]);
  // «Перенести экзамен» (release 47): on the exam's day and after it; the page reads its data again once it is moved.
  const facts = useMemo(() => moveFacts(summary), [summary]);
  const move = useExamMove({ containerId, role: summary.role, today, facts, reload });

  // The oral part that waits for lectures (decision 35): its editor's lectures, back to this exam by ?from=c:.
  const lecturesSubject = summary.subjects.find((subject) => oralCount(subject) > 0 && subject.oral?.exam_id && !(planInput?.items ?? []).some((item) => item.f === 'o' && item.s === subject.id));
  const lecturesHref = lecturesSubject?.oral?.exam_id ? `/exams/${lecturesSubject.oral.exam_id}/edit?from=c:${containerId}#lectures` : null;
  const more = useMemo(() => moreNew(planInput, plan), [planInput, plan]);
  const moreNewHref = more ? studyHref(containerId, { s: more.subjectId, only: 'new' }) : null;

  // ── the plan card
  const errorsSubject = (() => {
    const todays = summary.subjects.filter((subject) => subject.exam_date === today);
    return (todays.length > 0 ? todays : summary.subjects).find((subject) => errorCount(planInput, subject.id) > 0) ?? null;
  })();
  const errorsHref = errorsSubject ? studyHref(containerId, { s: errorsSubject.id, only: 'errors' }) : null;
  const targets: LinkTargets = { minutesHref: hrefs.minutes, settingsHref: hrefs.settings, lecturesHref, moreNewHref, errorsHref };
  const pace = paceNote({ input: planInput, plan, budget: summary.settings.minutes_per_day, firstPlanDay: summary.first_plan_day });
  const paceShown = pace && paceTold < pace.stage ? pace : null;
  // While the pace line says it, the plan's «При 45 минутах…» waits.
  const lines = planLineViews(plan, examQuestions(summary)).filter((line) => !(paceShown?.line.key === 'pace_slower' && (line.kind === 'short' || line.kind === 'short_max')));
  const hasLine = (action: LineView['action']) => lines.some((line) => line.action === action);
  const planNotes: CardNote[] = [];
  if (offline) planNotes.push({ kind: 'offline', node: <NoteLine key="offline" text={copy.OFFLINE_PAGE} /> });
  for (const line of lines) {
    if (!line.linkOnly) planNotes.push({ kind: line.kind, node: <NoteLine key={line.key} text={line.text} action={linkFor(line.action, targets)} /> });
  }
  if (paceShown) {
    const told = () => {
      markPaceTold(containerId, paceShown.stage);
      setPaceTold(paceShown.stage);
    };
    planNotes.push({ kind: 'pace', node: <PaceLine key="pace" note={paceShown} containerId={containerId} settings={summary.settings} onTold={told} reload={reload} /> });
  }
  // «Как можно быстрее» needs no date: the «по 15 новых в день» note is not about this plan.
  if (day.noDate && summary.settings.tempo !== 'fast' && !hasLine('date')) planNotes.push({ kind: 'no_date', node: <NoteLine key="nodate" text={noDateText()} action={linkFor('date', targets)} /> });
  const shownNotes = cardNotes(planNotes, phone);

  const start = startTarget({ containerId, summary, plan, saved, wide });
  const state = plan?.state ?? 'study';
  const lineLinks = lines.filter((line) => line.linkOnly).map((line) => lineLink(line, targets)).filter(Boolean);
  let title: ReactNode;
  let sub: ReactNode = null;
  let links: ReactNode = null;
  let pill: { href: string; label: string } | null = null;
  // After the date the one blue pill moves the exam (owner, 2026-10-18: «нельзя продлить кнопкой»), for a member too.
  let moveLeads = false;
  const moveLink = (
    <button key="move" type="button" className="sf-link" aria-haspopup="dialog" onClick={move.open}>
      {copy.MOVE_TITLE}
    </button>
  );
  if (day.passed || state === 'after') {
    title = (plan && state === 'after' ? titleText(plan) : '') || copy.AFTER_EXAM;
    moveLeads = true;
    links = author ? (
      <Link className="sf-link" data-muted="" to={hrefs.remove}>
        {copy.DELETE_EXAM_LINK}
      </Link>
    ) : null;
  } else if (state === 'exam_today') {
    title = (plan ? titleText(plan) : '') || copy.EXAM_TODAY;
    // The errors are the pill «Пройтись по ошибкам: N» (N as the plan counts them, ≤ 20); moving is a quiet link.
    const errorsLine = plan?.lines.find((line) => line.key === 'exam_errors');
    const errorsToday = errorsLine?.n?.[0] ?? (errorsSubject ? Math.min(20, errorCount(planInput, errorsSubject.id)) : 0);
    if (errorsHref && errorsToday > 0) pill = { href: errorsHref, label: copy.walkErrors(errorsToday) };
    const others = lines.filter((line) => line.linkOnly && line.action !== 'errors').map((line) => lineLink(line, targets)).filter(Boolean);
    links = (
      <>
        {others}
        {moveLink}
      </>
    );
  } else if (plan && state === 'study') {
    title = <PlanTitle text={titleText(plan)} />;
    const detail = detailText(plan);
    sub = (
      <>
        {detail ? `${copy.glue(detail)}. ` : null}
        <button type="button" className="sf-link" aria-haspopup="dialog" onClick={() => setDaysOpen(true)}>
          {copy.PLAN_BY_DAYS}
        </button>
      </>
    );
    pill = start;
  } else if (plan) {
    title = planText(plan) || copy.SUBJECT_DONE;
    if (lineLinks.length > 0) links = lineLinks;
    else if (moreNewHref && more) links = <Link className="sf-link" to={moreNewHref}>{lineWords({ key: 'more_new', n: [more.ids.length] })}</Link>;
    // A day off: the week ahead is one tap away («План по дням» says the study days and what each holds).
    if (isDayOff(plan)) {
      sub = (
        <button type="button" className="sf-link" aria-haspopup="dialog" onClick={() => setDaysOpen(true)}>
          {copy.PLAN_BY_DAYS}
        </button>
      );
    }
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
        meta: copy.subjectRowOral({ twoDays: f.twoDays, seen: f.seen, inPlan, questions: oralCount(subject), today: share?.items ?? 0, dateText: ownDate }),
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
    // The plan does not make this line (package D2): the count is the oral questions without points (D1's oralPlan).
    const words = lineWords({ key: 'oral_no_lectures', n: [oralWithoutPoints] });
    if (words) notes.push(<NoteLine key="lectures" text={words} action={linkFor('lectures', targets)} />);
  }
  const pillNode = pill ? (
    <Link className="sf-primary" to={pill.href}>
      {pill.label}
    </Link>
  ) : moveLeads ? (
    <button type="button" className="sf-primary" aria-haspopup="dialog" onClick={move.open}>
      {copy.MOVE_TITLE}
    </button>
  ) : null;
  const meta = copy.metaLine(day.text, examQuestions(summary), phone ? null : summary.subjects.length);

  return (
    <div className="sf-page ct-page" data-view="exam">
      <PageHead title={summary.title} meta={meta} crumb={{ to: '/exams', label: copy.TO_EXAMS }} actions={actions} menuLabel={copy.MENU_LABEL_EXAM} phone={phone} />
      <PlanCard
        id={`ct-plan-${containerId}`}
        title={title}
        sub={sub}
        links={links}
        notes={move.line ? [move.line, ...shownNotes] : shownNotes}
        action={wide ? pillNode : null}
        tip={planTip}
      />
      <div className="ct-body">
        <FigureBlock figure={figure} plan={plan} today={today} />
        <div className="ct-main">
          <Rows rows={rows} label={copy.SUBJECTS_LABEL} />
          {notes.length > 0 ? <div className="ct-notes">{notes}</div> : null}
        </div>
      </div>
      {!wide && pillNode ? <div className="ct-cta">{pillNode}</div> : null}
      {daysOpen ? (
        <PlanByDaysSheet
          input={planInput}
          plan={plan}
          subjects={summary.subjects}
          minutes={summary.settings.minutes_per_day}
          noDate={day.noDate && summary.settings.tempo !== 'fast'}
          settingsHref={hrefs.settings}
          minutesHref={hrefs.minutes}
          onClose={() => setDaysOpen(false)}
        />
      ) : null}
      {move.dialog}
      {dialogs}
    </div>
  );
}
