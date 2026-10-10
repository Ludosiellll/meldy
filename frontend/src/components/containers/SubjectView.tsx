import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SummarySubject } from '../../types/container';
import { withdrawDoubt } from '../../api/containers';
import { dayText } from '../../lib/containers/words';
import { usePhone } from '../../lib/usePhone';
import { useAuth } from '../../hooks/useAuth';
import PageHead from './PageHead';
import PlanCard, { PlanTitle } from './PlanCard';
import FigureBlock from './FigureBlock';
import Rows, { type RowView } from './Rows';
import { PlanByDaysSheet, TopicSheet, type DateGroup } from './Sheets';
import MockSetup from './MockSetup';
import { NoteLine } from './ui';
import { startTarget, useExamActions, useSubjectActions } from './actions';
import { lineLink, linkFor, noteLines, type LinkTargets, type ViewProps } from './ExamView';
import { useWide } from './useWide';
import { firstCountText, planLineViews, planText } from './planLines';
import * as copy from './copy';
import {
  errorCount,
  examDates,
  examFigure,
  examPlanNumbers,
  examQuestions,
  isAuthor,
  metaDay,
  newIds,
  oralCount,
  setAsideIds,
  studyHref,
  subjectFigure,
  subjectKind,
  subjectPlanNumbers,
  subjectQuestions,
  topicCount,
} from './model';
import { loadSession, resumable } from './sessionStore';

/**
 * A subject with variants (Concept 1 §3.4, decisions 44, 46): the plan card with «Только ошибки: N» and «Как на
 * экзамене», the figure, the topics as rows (a tap opens the topic's sheet with «Начать 20 вопросов по теме»), the
 * oral part's row first for a mixed subject. A one-subject exam is this page with the exam's name and the exam's «⋯»
 * (`solo`).
 */
export default function SubjectView({ containerId, data, plan, offline, reload, subject, solo }: ViewProps & { subject: SummarySubject; solo: boolean }) {
  const { summary, planInput, items } = data;
  const phone = usePhone();
  const wide = useWide();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [topicOpen, setTopicOpen] = useState<number | null>(null);
  const [mockOpen, setMockOpen] = useState(false);
  const [daysOpen, setDaysOpen] = useState(false);
  const [returning, setReturning] = useState(false);
  const today = plan?.day ?? summary.day;
  const author = isAuthor(summary.role);
  const dates = solo ? examDates(summary) : subject.exam_date ? [subject.exam_date] : examDates(summary);
  const day = metaDay(dates, today);
  const figure = solo ? examFigure(summary, plan) : subjectFigure(subject, plan);
  const nextDateText = day.next ? dayText(day.next) : null;
  const settingsHref = `/exams/c/${containerId}/settings`;
  const exam = useExamActions({ containerId, summary, input: planInput, figure, nextDateText, reload });
  const own = useSubjectActions({ containerId, summary, subjectId: subject.id, title: subject.title });
  const actions = solo ? exam.actions : own;
  const saved = useMemo(() => (user?.id ? resumable(loadSession(user.id, containerId), today) : null), [user?.id, containerId, today]);
  const planned = useMemo(() => new Set(plan?.sessions.flatMap((session) => session.ids) ?? []), [plan]);
  const errors = errorCount(planInput, subject.id);
  const moreNewHref = newIds(planInput, subject.id, planned, 1).length > 0 ? studyHref(containerId, { s: subject.id, only: 'new', back: solo ? null : 's' }) : null;
  const errorsHref = errors > 0 ? studyHref(containerId, { s: subject.id, only: 'errors', back: solo ? null : 's' }) : null;
  const targets: LinkTargets = { onMinutes: exam.openMinutes, settingsHref, lecturesHref: null, moreNewHref, errorsHref };

  // ── the plan card
  const lines = solo ? planLineViews(plan) : [];
  const cardNotes: ReactNode[] = [];
  if (offline) cardNotes.push(<NoteLine key="offline" text={copy.OFFLINE_PAGE} />);
  cardNotes.push(...noteLines(lines, targets));
  if (solo && day.noDate && !lines.some((line) => line.action === 'date')) cardNotes.push(<NoteLine key="nodate" text={copy.NO_DATE_LINE} action={linkFor('date', targets)} />);

  const start = startTarget({ containerId, summary, plan, saved, subjectId: subject.id, wide, back: solo ? null : 's' });
  const numbers = plan ? (solo ? examPlanNumbers(plan) : subjectPlanNumbers(plan, subject.id, planInput)) : null;
  const keyed = subject.keyed > 0;
  const state = plan?.state ?? 'study';
  let title: ReactNode;
  let pill = start;
  if (day.passed || state === 'after') {
    title = copy.AFTER_EXAM;
    pill = null;
  } else if (state === 'exam_today' && (solo || subject.exam_date === today)) {
    title = copy.EXAM_TODAY;
    pill = null;
  } else if (numbers && numbers.questions > 0) {
    title = <PlanTitle questions={numbers.questions} minutes={numbers.minutes} left={numbers.left} />;
  } else {
    title = (solo && plan ? planText(plan) : '') || copy.SUBJECT_DONE;
  }
  const linkItems: ReactNode[] = [];
  if (errorsHref) {
    linkItems.push(
      <Link key="errors" className="sf-link" to={errorsHref}>
        {state === 'exam_today' ? copy.errorsBeforeExam(Math.min(20, errors)) : copy.ONLY_ERRORS(errors)}
      </Link>,
    );
  }
  if (keyed && !day.passed) {
    linkItems.push(
      <button key="mock" type="button" className="sf-link" aria-haspopup="dialog" onClick={() => setMockOpen(true)}>
        {copy.MOCK_LINK}
      </button>,
    );
  }
  if (solo && plan && !day.passed && state !== 'exam_today') {
    linkItems.push(
      <button key="days" type="button" className="sf-link" aria-haspopup="dialog" onClick={() => setDaysOpen(true)}>
        {copy.PLAN_BY_DAYS}
      </button>,
    );
  }
  if (day.passed) {
    linkItems.push(
      <Link key="date" className="sf-link" to={settingsHref}>
        {copy.SET_NEW_DATE}
      </Link>,
    );
  }
  const planNew = lines.find((line) => line.action === 'more_new');
  if (!numbers?.questions && moreNewHref && !day.passed && state !== 'exam_today') {
    linkItems.push(planNew ? lineLink(planNew, targets) : (
      <Link key="new" className="sf-link" to={moreNewHref}>
        {copy.MORE_NEW}
      </Link>
    ));
  }

  // ── the rows: the oral part first (a mixed subject), then the topics
  const rows: RowView[] = [];
  if (subjectKind(subject) === 'mixed' && subject.oral?.exam_id) {
    rows.push({ key: 'oral', title: copy.oralSheetRow(oralCount(subject)), meta: copy.ORAL_TAG, to: `/exams/${subject.oral.exam_id}?from=c:${containerId}` });
  }
  for (const topic of subject.topics) {
    const name = subject.topic_titles[topic.topic - 1];
    if (!name || topic.keyed === 0) continue;
    rows.push({
      key: `topic-${topic.topic}`,
      title: name,
      meta: copy.topicRow({ twoDays: topic.two_days, keyed: topic.keyed, seen: topic.seen, errors: topic.open_errors }),
      onOpen: () => setTopicOpen(topic.topic),
    });
  }

  // ── quiet lines
  const notes: ReactNode[] = [];
  if (subject.no_key > 0) {
    notes.push(
      <NoteLine
        key="nokey"
        text={copy.noKeyLine(subject.no_key)}
        action={
          author ? (
            <Link className="sf-link" to={`/exams/c/${containerId}/keys?s=${subject.id}`}>
              {copy.MARK_ANSWERS}
            </Link>
          ) : undefined
        }
      />,
    );
  }
  if (solo && author && (summary.owner?.doubts_open ?? 0) > 0) {
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
  if (subject.doubted > 0) {
    const returnAll = async () => {
      if (returning) return;
      setReturning(true);
      try {
        await Promise.all(setAsideIds(items, planInput, subject.id).map((id) => withdrawDoubt(id)));
        reload();
      } finally {
        setReturning(false);
      }
    };
    notes.push(
      <NoteLine
        key="aside"
        text={copy.setAsideLine(subject.doubted)}
        action={
          <button type="button" className="sf-link" aria-busy={returning || undefined} onClick={() => void returnAll()}>
            {copy.RETURN_TO_PLAN}
          </button>
        }
      />,
    );
  }
  if (!author && summary.key_changes_unseen > 0) notes.push(<NoteLine key="fixed" text={copy.keyFixedLine(summary.key_changes_unseen)} />);

  const topic = topicOpen !== null ? subject.topics.find((entry) => entry.topic === topicOpen) ?? null : null;
  const lastRun = summary.mock_runs.filter((run) => run.subject_ids.includes(subject.id)).sort((a, b) => (a.local_date < b.local_date ? 1 : -1))[0] ?? null;
  const groups: DateGroup[] = dates.map((date) => ({ date, subjects: summary.subjects.filter((entry) => (entry.exam_date ?? summary.exam_date) === date).map((entry) => entry.title) }));
  const pillNode = pill ? (
    <Link className="sf-primary" to={pill.href}>
      {pill.label}
    </Link>
  ) : null;
  const meta = copy.metaLine(day.text, solo ? examQuestions(summary) : subjectQuestions(subject), null);

  return (
    <div className="sf-page ct-page" data-view="subject">
      <PageHead
        title={solo ? summary.title : subject.title}
        meta={meta}
        crumb={solo ? { to: '/exams', label: copy.TO_EXAMS } : { to: `/exams/c/${containerId}`, label: summary.title }}
        actions={actions}
        menuLabel={solo ? copy.MENU_LABEL_EXAM : copy.MENU_LABEL_SUBJECT}
        phone={phone}
      />
      <PlanCard
        id={`ct-plan-${subject.id}`}
        title={title}
        links={linkItems.length > 0 ? linkItems : null}
        notes={cardNotes}
        action={wide ? pillNode : null}
      />
      <div className="ct-body">
        <FigureBlock figure={figure} firstLine={firstCountText(plan)} />
        <div className="ct-main">
          <Rows rows={rows} label={copy.TOPICS_LABEL} />
          {notes.length > 0 ? <div className="ct-notes">{notes}</div> : null}
        </div>
      </div>
      {!wide && pillNode ? <div className="ct-cta">{pillNode}</div> : null}
      {topic ? (
        <TopicSheet
          title={subject.topic_titles[topic.topic - 1] ?? ''}
          keyed={topic.keyed}
          twoDays={topic.two_days}
          errors={topic.open_errors}
          count={Math.min(20, topicCount(planInput, subject.id, topic.topic))}
          href={studyHref(containerId, { s: subject.id, topic: topic.topic, back: solo ? null : 's' })}
          onClose={() => setTopicOpen(null)}
        />
      ) : null}
      {mockOpen ? (
        <MockSetup
          keyed={subject.keyed}
          last={lastRun}
          onClose={() => setMockOpen(false)}
          onStart={(count, minutes) => navigate(`/exams/c/${containerId}/mock?s=${subject.id}&n=${count}&t=${minutes}`)}
        />
      ) : null}
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
            exam.openMinutes();
          }}
        />
      ) : null}
      {solo ? exam.dialogs : null}
    </div>
  );
}
