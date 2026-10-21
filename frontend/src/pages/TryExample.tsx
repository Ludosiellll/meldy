import { useEffect, useLayoutEffect, useState, type ComponentType } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import '../styles/paper.css';
import '../components/example/example.css';
import ExamplePick from '../components/example/ExamplePick';
import TryBar, { TRY_LECTURE_WHERE } from '../components/example/TryBar';
import { tryLecturePart, tryTicketPart } from '../components/example/tryParts';
import RouteLoading from '../components/RouteLoading';
import { useLazyPart, type LazyPart } from '../lib/lazyPart';
import { track } from '../lib/telemetry';

/**
 * «Попробовать на примере» (/try): a ready example exam that anyone can try in one click, with no account, told as
 * three steps — 1 «Вопрос»: the department's list, pick a question (/try); 2 «Ответ»: answer it by voice or in writing,
 * or put in the ready answer, and answer the examiner's question; 3 «Проверка»: what the check found (both on
 * /try/ticket?q=…). Beside the story, what Meldy made of the example's first lecture — the result screen of one real
 * analysis, kept as it was (/try/lecture, data/exampleLecture). Public: outside PrivateRoute, and a signed-in student
 * can open it too. It runs on the device (src/data/example, components/example) but for one call per answer: the AI
 * check, POST /api/try/evaluate (components/example/tryCheck.ts), with the key words when it is not there. Nothing is
 * saved anywhere.
 *
 * The answer room and the lecture's result are files of their own (components/example/tryParts): the list comes first.
 * The old addresses — the random draw (/try/draw) and the views of the example's sheet (/try?view=…) — lead to the list.
 */
export default function TryExample() {
  const { pathname } = useLocation();

  useEffect(() => track('try_opened'), []);

  // Each step starts at its top, as a page of its own would: at once and before the step is seen.
  useLayoutEffect(() => {
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname]);

  return (
    <div className="tx-shell">
      <Routes>
        <Route index element={<ExamplePick />} />
        <Route path="ticket" element={<TryStep key="ticket" part={tryTicketPart} />} />
        <Route path="lecture" element={<TryStep key="lecture" part={tryLecturePart} where={TRY_LECTURE_WHERE} back="/try" />} />
        <Route path="*" element={<Navigate to="/try" replace />} />
      </Routes>
    </div>
  );
}

/**
 * A step of the example that is a file of its own: at once when its file is in (fetched once the list was idle,
 * lib/prefetch.ts, or once its link was pointed at), else the top line and the page loader until it arrives. It never
 * suspends (lib/lazyPart), so the list is not held back for it. A file that did not load goes to the boundary, as a
 * page's does.
 */
function TryStep({ part, where, back }: { part: LazyPart<ComponentType>; where?: string; back?: string }) {
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const Step = useLazyPart(part, true, { onError: (error) => setFailure({ error }) });
  if (failure) throw failure.error;
  if (Step) return <Step />;
  return (
    <>
      <TryBar where={where} back={back} />
      <RouteLoading fullScreen={false} />
    </>
  );
}
