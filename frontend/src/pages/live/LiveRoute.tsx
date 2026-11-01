/**
 * The live game's teacher pages under /live (docs/live/CONTRACT.md): /live/new — the setup («Провести игру»), /live/:id
 * — the screen of a running game; /live/challenge?c=<test> and /live/challenge/<id> — «Соревнование по ссылке»; /live/duel —
 * the setup of «Дуэль» (docs/live/DUEL.md). Full screen, outside the signed-in shell: the projector shows nothing else.
 */
import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import RouteLoading from '../../components/RouteLoading';

const LiveSetupPage = lazy(() => import('./LiveSetupPage'));
const LiveHostPage = lazy(() => import('./LiveHostPage'));
// «Соревнование по ссылке» (docs/live/CHALLENGE.md): its setup and its page with the link and the results.
const ChallengeSetupPage = lazy(() => import('./ChallengeSetupPage'));
const ChallengeResultsPage = lazy(() => import('./ChallengeResultsPage'));
// «Дуэль» (docs/live/DUEL.md): its setup from a test, a finished challenge run or a finished game.
const DuelSetupPage = lazy(() => import('./DuelSetupPage'));

export default function LiveRoute() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="new" element={<LiveSetupPage />} />
        <Route path="challenge" element={<ChallengeSetupPage />} />
        <Route path="challenge/:id" element={<ChallengeResultsPage />} />
        <Route path="duel" element={<DuelSetupPage />} />
        <Route path=":id" element={<LiveHostPage />} />
      </Routes>
    </Suspense>
  );
}
