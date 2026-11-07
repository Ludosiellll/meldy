import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { fetchOverview } from '../../api/containers';
import { useAuth } from '../../hooks/useAuth';
import { isMemberOnly, readOwnWork } from '../../lib/accountShape';
import { useContainerData } from '../../lib/containers/hooks';
import { MEMBER_STOPS } from '../../components/guide/firstRun';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useGuide } from '../../components/guide/GuideContext';
import ExamView from '../../components/containers/ExamView';
import SubjectView from '../../components/containers/SubjectView';
import TestHome from '../../components/containers/TestHome';
import { PageState, usePlan } from '../../components/containers/PageState';
import { isOwnTest, soloSubject } from '../../components/containers/model';
import { useExamTelegramTip } from '../../components/telegram/ExamTelegramTip';

/** How long the guide waits to learn whether the account is only a member before it opens the whole guide. */
export const MEMBER_CHECK_WAIT = { ms: 3000 };

/**
 * Whether the account is only a member of someone else's exams (lib/accountShape: no exam, test or lecture of its own),
 * read for the guide after the first «занятие»; false whenever that is not certain (a failed or slow read).
 */
export async function memberOnlyNow(userId: string): Promise<boolean> {
  const check = async () => {
    const overview = await fetchOverview();
    if (!overview || overview.containers.some((container) => container.role !== 'member')) return false;
    const own = await readOwnWork(userId, overview.attached_exam_ids);
    return isMemberOnly({ containers: overview.containers, lectures: own.lectures, ownExams: own.ownExams });
  };
  const wait = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), MEMBER_CHECK_WAIT.ms);
  });
  try {
    return await Promise.race([check(), wait]);
  } catch {
    return false;
  }
}

/**
 * /exams/c/:id — the exam page (Concept 1 §3.3); an exam of one subject with variants is that subject's page, with the
 * exam's «⋯» (spec §7, decision 44). Coming back from the first «занятие» with `state.guide`, the page opens the
 * first-run guide (decision 33): a student who came to load a file meets it after «Готово», not before the first
 * question. A group student — every exam someone else's, nothing of its own — gets the exam's own way (firstRun.ts
 * MEMBER_STOPS: today's plan, «План по дням», Telegram, and that lectures can be made too); «?» opens the whole guide. Once the student has answered here and the guide is behind, the Telegram bot's tip points at today's plan
 * (components/telegram/ExamTelegramTip), once. The author of a test (release 47.3, containers.kind 'test') gets the
 * test's own page instead (TestHome: the studio, the link, its контрольные; no plan); a member of it studies here.
 */
export default function ContainerPage() {
  const { id = '' } = useParams();
  const state = useContainerData(id);
  const plan = usePlan(state.data?.planInput);
  // The test's own page has no plan card: the tip about today's plan in Telegram is not for it.
  const ownTest = isOwnTest(state.data?.summary);
  const telegram = useExamTelegramTip({ summary: ownTest ? null : state.data?.summary, plan });
  const guide = useGuide();
  const location = useLocation();
  const navigate = useNavigate();
  const guided = useRef(false);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  useDocumentTitle(state.data?.summary.title ?? 'Экзамен');

  const wantsGuide = Boolean((location.state as { guide?: boolean } | null)?.guide);
  // This exam's role decides first: its author gets the whole guide at once; a member's account is read once more.
  const role = state.data?.summary.role ?? null;
  const roleKnown = role !== null || !state.loading;
  useEffect(() => {
    if (!wantsGuide || guided.current || !guide || !roleKnown) return;
    guided.current = true;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    if (role !== 'member' || !userId) {
      guide.start('today');
      return;
    }
    void memberOnlyNow(userId).then((member) => (member ? guide.start('today', MEMBER_STOPS) : guide.start('today')));
  }, [wantsGuide, guide, roleKnown, role, userId, navigate, location.pathname, location.search]);

  if (!state.data) return <PageState state={state} />;
  if (ownTest) return <TestHome containerId={id} data={state.data} reload={state.reload} />;
  const solo = soloSubject(state.data.summary);
  const props = { containerId: id, data: state.data, plan, offline: state.offline, reload: state.reload, planTip: telegram.tip };
  return (
    <>
      {solo ? <SubjectView {...props} subject={solo} solo /> : <ExamView {...props} />}
      {telegram.window}
    </>
  );
}
