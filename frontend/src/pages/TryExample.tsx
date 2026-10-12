import { useEffect, useLayoutEffect, useState, type ComponentType } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import '../styles/paper.css';
import '../components/exams/exams.css';
import '../components/oral/oral.css';
import '../components/example/example.css';
import ExampleSheet from '../components/example/ExampleSheet';
import TryBar, { TRY_LECTURE_WHERE } from '../components/example/TryBar';
import { tryDrawPart, tryLecturePart, tryTicketPart } from '../components/example/tryParts';
import RouteLoading from '../components/RouteLoading';
import { useLazyPart, type LazyPart } from '../lib/lazyPart';
import { track } from '../lib/telemetry';

/**
 * «Попробовать на примере» (/try): a ready example exam that anyone can try in one click, with no
 * account — the lectures and the department's list already checked (/try), «Тянуть билет»
 * (/try/draw), the answer by voice or in writing with the examiner's follow-up and the protocol
 * (/try/ticket?q=…), and what Meldy made of the example's first lecture — the result screen of one real analysis,
 * kept as it was (/try/lecture, data/exampleLecture). Public: outside PrivateRoute, and a signed-in student can open
 * it too. It runs on the device (src/data/example, components/example) but for one call per answer: the AI check,
 * POST /api/try/evaluate (components/example/tryCheck.ts), with the key words when it is not there.
 * Nothing is saved but in this tab.
 *
 * The draw, the answer room and the lecture's result are files of their own (components/example/tryParts): the sheet
 * comes first.
 */
export default function TryExample() {
  const { pathname } = useLocation();

  useEffect(() => track('try_opened'), []);

  // Each step starts at its top, as a page of its own would: at once and before the step is seen. Smooth (the page's
  // html { scroll-behavior }) and after the first frame, the step showed where the last one was scrolled to and then
  // glided up — over the sheet's own show, which had played question 5 where it stood (jury QA, 2026-10-11). The
  // sheet's show, started before the first frame too, then brings its question into view (CheatSheet bringIntoView).
  useLayoutEffect(() => {
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);

  return (
    <div className="tx-shell">
      <Routes>
        <Route index element={<ExampleSheet />} />
        {/* Keyed: the draw and the answer are two steps, not one step whose file changes. */}
        <Route path="draw" element={<TryStep key="draw" part={tryDrawPart} />} />
        <Route path="ticket" element={<TryStep key="ticket" part={tryTicketPart} />} />
        <Route path="lecture" element={<TryStep key="lecture" part={tryLecturePart} where={TRY_LECTURE_WHERE} />} />
        <Route path="*" element={<Navigate to="/try" replace />} />
      </Routes>
    </div>
  );
}

/**
 * A step of the example that is a file of its own: at once when its file is in (fetched once the sheet was idle,
 * lib/prefetch.ts, or, for the lecture's result, once its link was pointed at), else the step's top line and the page
 * loader until it arrives. It never suspends (lib/lazyPart), so the sheet is not held back for it. A file that did not
 * load goes to the boundary, as a page's does.
 */
function TryStep({ part, where = 'Лист примера' }: { part: LazyPart<ComponentType>; where?: string }) {
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const Step = useLazyPart(part, true, { onError: (error) => setFailure({ error }) });
  if (failure) throw failure.error;
  if (Step) return <Step />;
  return (
    <>
      <TryBar where={where} back="/try" />
      <RouteLoading fullScreen={false} />
    </>
  );
}
