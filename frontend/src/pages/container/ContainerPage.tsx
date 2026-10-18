import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useContainerData } from '../../lib/containers/hooks';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { useGuide } from '../../components/guide/GuideContext';
import ExamView from '../../components/containers/ExamView';
import SubjectView from '../../components/containers/SubjectView';
import TestHome from '../../components/containers/TestHome';
import { PageState, usePlan } from '../../components/containers/PageState';
import { isOwnTest, soloSubject } from '../../components/containers/model';
import { useExamTelegramTip } from '../../components/telegram/ExamTelegramTip';

/**
 * /exams/c/:id — the exam page (Concept 1 §3.3); an exam of one subject with variants is that subject's page, with the
 * exam's «⋯» (spec §7, decision 44). Coming back from the first «занятие» with `state.guide`, the page opens the
 * first-run guide (decision 33): a student who came to load a file meets it after «Готово», not before the first
 * question. Once the student has answered here and the guide is behind, the Telegram bot's tip points at today's plan
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
  useDocumentTitle(state.data?.summary.title ?? 'Экзамен');

  const wantsGuide = Boolean((location.state as { guide?: boolean } | null)?.guide);
  useEffect(() => {
    if (!wantsGuide || guided.current || !guide) return;
    guided.current = true;
    guide.start('today');
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [wantsGuide, guide, navigate, location.pathname, location.search]);

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
