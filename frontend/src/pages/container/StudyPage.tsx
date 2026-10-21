import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useContainerData, type ContainerData } from '../../lib/containers/hooks';
import { useAuth } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { guideDeferred } from '../../components/guide/guideLater';
import { guideSeenHere } from '../../components/guide/clipPart';
import { PageState, usePlan } from '../../components/containers/PageState';
import { RoomBar } from '../../components/containers/RoomParts';
import StudyRun from '../../components/containers/StudyRun';
import OralRun from '../../components/containers/OralRun';
import { useWide } from '../../components/containers/useWide';
import { setupSession } from '../../components/containers/studySetup';
import { loadSession, sessionEnded, sessionOf } from '../../components/containers/sessionStore';
import { examFigure, oralExamOf, subjectTitle } from '../../components/containers/model';
import * as copy from '../../components/containers/copy';
import type { DayPlan } from '../../types/container';
import '../../components/containers/room.css';

/**
 * /exams/c/:id/study?s=…&kind=…&topic=…&only=errors|new&resume=1 — a «занятие», a room without the menu and the tab
 * bar (Layout isRoomPath): one question at a time (StudyRun) or an oral self-check (OralRun). Each visit of the address
 * is a session of its own (the end screen's «Ещё 20 вопросов» opens the next one). A reload goes on with the session the
 * address names (?sid=); a reload of a session that is over says so and starts a new one only when asked.
 */
export default function StudyPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = useContainerData(id);
  const plan = usePlan(state.data?.planInput);
  useDocumentTitle('Занятие');

  if (!state.data) {
    return (
      <div className="ct-roomshell">
        <RoomBar long="" short="" exitLabel={copy.FINISH} onExit={() => navigate(`/exams/c/${id}`)} />
        <PageState state={state} loadingText={copy.SESSION_LOADING} />
      </div>
    );
  }
  return (
    <div className="ct-roomshell">
      <StudyRoom key={location.key} containerId={id} data={state.data} plan={plan} offline={state.offline} reload={state.reload} />
    </div>
  );
}

function StudyRoom({ containerId, data, plan, offline, reload }: { containerId: string; data: ContainerData; plan: DayPlan | null; offline: boolean; reload: () => void }) {
  const { summary, planInput, items } = data;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const wide = useWide();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const today = plan?.day ?? summary.day;
  const tz = planInput.tz;
  // Fixed when the session starts: its questions, and the figure its end compares with.
  const [setup] = useState(() =>
    setupSession({ params, saved: userId ? loadSession(userId, containerId) : null, plan, input: planInput, summary, today, now: Date.now() }),
  );
  const [base] = useState(() => examFigure(summary, plan));
  // The address names a session this tab finished (its end screen was reloaded): no new session by itself.
  const [over] = useState(() => {
    const sid = params.get('sid');
    return sessionEnded(sid) && !(userId && sid && sessionOf(loadSession(userId, containerId), sid, today));
  });

  const back = params.get('back') === 's' && setup.subjectId ? `/exams/c/${containerId}/s/${setup.subjectId}` : `/exams/c/${containerId}`;
  const onDone = (first: boolean) => {
    // Decision 33: a student who came to load a file meets the guide after «Готово» of the first session.
    if (first && guideDeferred() && !guideSeenHere()) navigate(`/exams/c/${containerId}`, { state: { guide: true } });
    else navigate(back);
  };

  if (over) {
    const title = subjectTitle(summary, setup.subjectId);
    const fresh = new URLSearchParams(params);
    fresh.delete('sid');
    fresh.delete('resume');
    return (
      <>
        <RoomBar long={title} short={title} exitLabel={copy.END_EXIT} onExit={() => navigate(back)} />
        <main className="sf-page ct-study ct-end">
          <h1 className="ct-end-h">{copy.SESSION_OVER}</h1>
          <div className="ct-end-links">
            <button type="button" className="sf-primary" onClick={() => navigate({ search: `?${fresh.toString()}` }, { replace: true })}>
              {copy.SESSION_NEW}
            </button>
            <Link className="sf-link" to={back}>
              {copy.BACK_TO_EXAM}
            </Link>
          </div>
        </main>
      </>
    );
  }

  if (setup.queue.length === 0) {
    const empty = setup.only === 'errors' ? copy.ERRORS_EMPTY : setup.topic ? copy.TOPIC_EMPTY : copy.SESSION_EMPTY;
    const title = subjectTitle(summary, setup.subjectId);
    return (
      <>
        <RoomBar long={title} short={title} exitLabel={copy.END_EXIT} onExit={() => navigate(back)} />
        <main className="sf-page ct-study ct-end">
          <h1 className="ct-end-h">{empty}</h1>
          <div className="ct-end-links">
            <Link className="sf-link" to={back}>
              {copy.BACK_TO_EXAM}
            </Link>
          </div>
        </main>
      </>
    );
  }

  const common = { containerId, userId, summary, plan, offline, setup, tz, today, base, wide, onEnded: reload, onDone };
  if (setup.kind === 'self_check') return <OralRun {...common} input={planInput} examId={oralExamOf(summary, setup.subjectId)} />;
  return <StudyRun {...common} items={items} input={planInput} />;
}
