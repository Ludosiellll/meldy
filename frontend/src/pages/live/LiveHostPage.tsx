/**
 * /live/:id — the teacher's screen of a game (CONTRACT §6–§8). The host token is this tab's (sessionStorage, from
 * «Открыть комнату»); a reload reads it again and the screen picks the game up as it is. `?fake=1` (or VITE_LIVE_FAKE)
 * plays against the in-memory server; the switch to the real one is that flag only.
 */
import { useCallback, useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { liveApi, liveFakeWanted } from '../../lib/live/api';
import type { LiveApi } from '../../lib/live/types';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { MODE, SCREEN } from '../../components/live/host/copy';
import { HostScreen } from '../../components/live/host/HostScreen';
import { fakeKnobs, readHostInfo } from '../../components/live/host/hostSession';
import { useHostGame } from '../../components/live/host/useHostGame';
import '../../components/live/host/host.css';

function Message({ title, why, onRetry }: { title: string; why?: string; onRetry?: () => void }) {
  return (
    <div className="lvh lvh-viewport">
      <div className="lvh-msg" role={onRetry ? 'alert' : 'status'}>
        <h1>{title}</h1>
        {why ? <p>{why}</p> : null}
        <div className="lvh-msg-actions">
          {onRetry ? (
            <button type="button" className="lvh-btn" onClick={onRetry}>
              {SCREEN.retry}
            </button>
          ) : null}
          {why ? (
            <Link className="lvh-btn lvh-btn--white" to="/exams">
              {SCREEN.home}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function LiveHostView({ gameId, api }: { gameId: string; api: LiveApi }) {
  const game = useHostGame(gameId, api);
  const info = useMemo(() => readHostInfo(gameId), [gameId]);
  const navigate = useNavigate();
  const { search } = useLocation();
  const again = useCallback(() => {
    const p = new URLSearchParams(search);
    if (info?.containerId) p.set('c', info.containerId);
    if (info?.quizId) p.set('quiz', info.quizId);
    navigate(`/live/new?${p.toString()}`);
  }, [info, navigate, search]);
  const s = game.state;
  if (game.status === 'notoken') return <Message title={SCREEN.notoken} why={SCREEN.notokenWhy} />;
  if (game.status === 'notfound') return <Message title={SCREEN.notfound} why={SCREEN.notfoundWhy} />;
  if (game.status === 'denied') return <Message title={SCREEN.denied} why={SCREEN.deniedWhy} />;
  if (game.status === 'error') return <Message title={SCREEN.error} onRetry={game.retry} />;
  if (!s) return <Message title={SCREEN.loading} />;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const joinUrl = info?.joinUrl ?? `${origin}/play?pin=${s.pin}`;
  return <HostScreen gameId={gameId} game={game} state={s} info={info} joinUrl={joinUrl} onAgain={info?.containerId || liveFakeWanted() ? again : null} />;
}

export default function LiveHostPage() {
  const { id = '' } = useParams();
  const { search } = useLocation();
  useDocumentTitle(MODE.name);
  // One server per tab: the fake keeps its games in memory (a reload of a fake game finds nothing — by design).
  const api = useMemo(() => liveApi(liveFakeWanted() ? fakeKnobs(search) : undefined), []); // eslint-disable-line react-hooks/exhaustive-deps
  return <LiveHostView key={id} gameId={id} api={api} />;
}
