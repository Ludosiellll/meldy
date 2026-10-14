import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SummarySubject } from '../../types/container';
import { withdrawDoubt } from '../../api/containers';
import { subjectInfo } from '../../lib/containers/plan';
import { freeSession } from '../../lib/containers/session';
import { usePhone } from '../../lib/usePhone';
import { useAuth } from '../../hooks/useAuth';
import PageHead from './PageHead';
import PlanCard, { PlanTitle } from './PlanCard';
import FigureBlock from './FigureBlock';
import Rows, { type RowView } from './Rows';
import { PlanByDaysSheet, TopicSheet } from './Sheets';
import MockSetup from './MockSetup';
import { NoteLine } from './ui';
import { examActions, examLinks, startTarget, useSubjectActions } from './actions';
import { lineLink, linkFor, noteLines, type LinkTargets, type ViewProps } from './ExamView';
import { useWide } from './useWide';
import { lineViews, noDateText, planLineViews, planText, text as lineWords, titleText } from './planLines';
import * as copy from './copy';
import {
  answeredToday,
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
  subjectPlan,
  subjectQuestions,
} from './model';
import { loadSession, resumable } from './sessionStore';

/**
 * A subject with variants (Concept 1 §3.4, decisions 44, 46): the plan card with «Только ошибки: N» and «Как на
 * экзамене», the figure, the topics as rows (a tap opens the topic's sheet with «Начать 20 вопросов по теме»), the
 * oral part's row first for a mixed subject. A one-subject exam is this page with the exam's name and the exam's «⋯»
 * (`solo`).
 */
export default function SubjectView({ containerId, data, plan, offline, reload, subject, solo, planTip }: ViewProps & { subject: SummarySubject; solo: boolean }) {
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
  const hrefs = examLinks(containerId);
  const own = useSubjectActions({ containerId, summary, subjectId: subject.id, title: subject.title });
  const actions = solo ? examActions(summary) : own;
  const saved = useMemo(() => (user?.id ? resumable(loadSession(user.id, containerId), today) : null), [user?.id, containerId, today]);
  const errors = errorCount(planInput, subject.id);
  const back = solo ? null : ('s' as const);
  const more = useMemo(() => moreNew(planInput, plan), [planInput, plan]);
  const moreNewHref = more && more.subjectId === subject.id ? studyHref(containerId, { s: subject.id, only: 'new', back }) : null;
  const errorsHref = errors > 0 ? studyHref(containerId, { s: subject.id, only: 'errors', back }) : null;
  const targets: LinkTargets = { minutesHref: hrefs.minutes, settingsHref: hrefs.settings, lecturesHref: null, moreNewHref, errorsHref };

  // ── the plan card: a one-subject exam has the exam's plan; a subject of several says its own phase and lines
  // (lib/containers/plan.ts subjectInfo: its final days, its exam day, after its date, no date).
  const info = useMemo(() => {
    if (solo || !planInput) return null;
    try {
      return subjectInfo(planInput, subject.id);
    } catch {
      return null;
    }
  }, [solo, planInput, subject.id]);
  const lines = solo ? planLineViews(plan, examQuestions(summary)) : lineViews(info?.lines ?? []);
  const cardNotes: ReactNode[] = [];
  if (offline) cardNotes.push(<NoteLine key="offline" text={copy.OFFLINE_PAGE} />);
  cardNotes.push(...noteLines(lines, targets));
  if (day.noDate && summary.settings.tempo !== 'fast' && !lines.some((line) => line.action === 'date')) cardNotes.push(<NoteLine key="nodate" text={noDateText()} action={linkFor('date', targets)} />);

  const start = startTarget({ containerId, summary, plan, saved, subjectId: subject.id, wide, back });
  const share = plan ? (solo ? plan : subjectPlan(plan, subject.id, planInput)) : null;
  const shareCount = share ? share.counts.newItems + share.counts.reviews + share.counts.oral : 0;
  const keyed = subject.keyed > 0;
  const phase = solo ? plan?.state ?? 'study' : info?.phase === 'exam_today' || info?.phase === 'after' ? info.phase : plan?.state === 'after' ? 'after' : 'study';
  const afterLine = (solo ? plan?.lines : info?.lines)?.find((line) => line.key === 'after');
  const passed = day.passed || phase === 'after';
  let title: ReactNode;
  let pill = start;
  if (passed) {
    title = (afterLine ? lineWords(afterLine).replace(/\.$/, '') : '') || copy.AFTER_EXAM;
    pill = null;
  } else if (phase === 'exam_today') {
    title = (solo && plan ? titleText(plan) : lineWords({ key: 'exam_today' }).replace(/\.$/, '')) || copy.EXAM_TODAY;
    pill = null;
  } else if (share && shareCount > 0) {
    title = <PlanTitle text={titleText(share)} />;
  } else {
    // A subject of several on a day off says the exam's day off («Сегодня выходной. Следующие вопросы — …»).
    const dayOff = plan?.lines.find((line) => line.key === 'day_off');
    title = (solo && plan ? planText(plan) : dayOff ? lineWords(dayOff) : '') || copy.SUBJECT_DONE;
  }
  const linkItems: ReactNode[] = [];
  const examErrors = lines.find((line) => line.kind === 'exam_errors');
  if (errorsHref) {
    linkItems.push(
      phase === 'exam_today' && examErrors ? (
        lineLink(examErrors, targets)
      ) : (
        <Link key="errors" className="sf-link" to={errorsHref}>
          {copy.ONLY_ERRORS(errors)}
        </Link>
      ),
    );
  }
  if (keyed && !passed) {
    linkItems.push(
      <button key="mock" type="button" className="sf-link" aria-haspopup="dialog" onClick={() => setMockOpen(true)}>
        {copy.MOCK_LINK}
      </button>,
    );
  }
  if (solo && plan && !passed && phase !== 'exam_today') {
    linkItems.push(
      <button key="days" type="button" className="sf-link" aria-haspopup="dialog" onClick={() => setDaysOpen(true)}>
        {copy.PLAN_BY_DAYS}
      </button>,
    );
  }
  if (passed) {
    linkItems.push(
      <Link key="date" className="sf-link" to={hrefs.settings}>
        {copy.SET_NEW_DATE}
      </Link>,
    );
  }
  const planNew = lines.find((line) => line.action === 'more_new');
  if (!shareCount && moreNewHref && more && !passed && phase !== 'exam_today') {
    linkItems.push(planNew ? lineLink(planNew, targets) : (
      <Link key="new" className="sf-link" to={moreNewHref}>
        {lineWords({ key: 'more_new', n: [more.ids.length] })}
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
  // «Начать N вопросов по теме»: the block the study engine takes now (lib/containers/session.ts freeSession, ≤ 20).
  const topicSize = (() => {
    if (!topic || !planInput) return 0;
    try {
      return freeSession(planInput, { subjectId: subject.id, topic: topic.topic }, Array.from(answeredToday(planInput, today)), 'count').length;
    } catch {
      return 0;
    }
  })();
  const lastRun = summary.mock_runs.filter((run) => run.subject_ids.includes(subject.id)).sort((a, b) => (a.local_date < b.local_date ? 1 : -1))[0] ?? null;
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
        tip={solo ? planTip : null}
      />
      <div className="ct-body">
        <FigureBlock figure={figure} plan={plan} today={today} />
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
          count={topicSize}
          href={studyHref(containerId, { s: subject.id, topic: topic.topic, back })}
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
    </div>
  );
}
