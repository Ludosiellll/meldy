import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import '../styles/paper.css';
import '../components/exams/exams.css';
import '../components/oral/oral.css';
import '../components/example/example.css';
import ExampleSheet from '../components/example/ExampleSheet';
import ExampleDraw from '../components/example/ExampleDraw';
import ExampleTicket from '../components/example/ExampleTicket';
import { track } from '../lib/telemetry';

/**
 * «Попробовать на примере» (/try): a ready example exam that anyone can try in one click, with no
 * account — the lectures and the department's list already checked (/try), «Тянуть билет»
 * (/try/draw), the answer by voice or in writing with the examiner's follow-up and the protocol
 * (/try/ticket?q=…). Public: outside PrivateRoute, and a signed-in student can open it too. It runs on
 * the device (src/data/example, components/example) but for one call per answer: the AI check,
 * POST /api/try/evaluate (components/example/tryCheck.ts), with the key words when it is not there.
 * Nothing is saved but in this tab.
 */
export default function TryExample() {
  const { pathname } = useLocation();

  useEffect(() => track('try_opened'), []);

  // Each step starts at its top, as a page of its own would.
  useEffect(() => {
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="tx-shell">
      <Routes>
        <Route index element={<ExampleSheet />} />
        <Route path="draw" element={<ExampleDraw />} />
        <Route path="ticket" element={<ExampleTicket />} />
        <Route path="*" element={<Navigate to="/try" replace />} />
      </Routes>
    </div>
  );
}
