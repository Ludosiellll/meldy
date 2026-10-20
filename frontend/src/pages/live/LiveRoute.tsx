/**
 * The live game's teacher pages under /live (docs/live/CONTRACT.md): /live/new — the setup («Провести игру»), /live/:id
 * — the screen of a running game. Full screen, outside the signed-in shell: the projector shows nothing else.
 */
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import RouteLoading from '../../components/RouteLoading';

const LiveSetupPage = lazy(() => import('./LiveSetupPage'));
const LiveHostPage = lazy(() => import('./LiveHostPage'));

export default function LiveRoute() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="new" element={<LiveSetupPage />} />
        <Route path=":id" element={<LiveHostPage />} />
      </Routes>
    </Suspense>
  );
}
