/**
 * /live/:id — the teacher's screen of a game (CONTRACT §6–§8). The host token is this tab's (sessionStorage, from
 * «Открыть комнату»); a reload reads it again and the screen picks the game up as it is. `?fake=1` (or VITE_LIVE_FAKE)
 * plays against the in-memory server; the switch to the real one is that flag only. A game whose settings say
 * `mode: "stand"` gets the 3D projector of «Встань на ответ» (components/live/stand, its own chunk); a battle with
 * movement rounds (`mixed` in its state, docs/live/MODE_MIXED.md) the battle's screen with the arena for those rounds.
 */
import { lazy, Suspense, useCallback, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { liveApi, liveFakeWanted } from '../../lib/live/api';
import { miniGameOf, mixedOf, type LiveApi } from '../../lib/live/types';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { MODE, SCREEN } from '../../components/live/host/copy';
import { HostScreen } from '../../components/live/host/HostScreen';
import { fakeKnobs, readHostInfo } from '../../components/live/host/hostSession';
import { useHostGame } from '../../components/live/host/useHostGame';
import '../../components/live/host/host.css';

const StandScreen = lazy(() => import('../../components/live/stand/StandScreen'));
const MixedHost = lazy(() => import('../../components/live/stand/MixedHost'));

/** The join link with `mode` set (kept once, whatever else it carries). */
export function withMode(url: string, mode: string): string {
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'https://meldy.invalid');
    u.searchParams.set('mode', mode);
    return /^https?:/i.test(url) ? u.toString() : `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return url.includes('?') ? `${url}&mode=${mode}` : `${url}?mode=${mode}`;
  }
}

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
  // A movement game's room hears each of the teacher's moves at once (MODE_STAND.md §2): the stand screen (or a mixed
  // game's) sets this.
  const syncRef = useRef<(() => void) | null>(null);
  const onMoved = useCallback(() => syncRef.current?.(), []);
  const game = useHostGame(gameId, api, { onMoved });
  const info = useMemo(() => readHostInfo(gameId), [gameId]);
  const navigate = useNavigate();
  const { search } = useLocation();
  const again = useCallback(() => {
    const p = new URLSearchParams(search);
    if (info?.containerId) p.set('c', info.containerId);
    if (info?.quizId) p.set('quiz', info.quizId);
    // the same game again: «Встань на ответ» opens its own setup, a battle its own mini-games (or none)
    const settings = game.state?.settings;
    if (game.state?.mode === 'stand' || settings?.mode === 'stand') p.set('mode', 'stand');
    else if (settings) p.set('mini', String(miniGameOf(settings)));
    navigate(`/live/new?${p.toString()}`);
  }, [info, navigate, search, game.state]);
  const s = game.state;
  if (game.status === 'notoken') return <Message title={SCREEN.notoken} why={SCREEN.notokenWhy} />;
  if (game.status === 'notfound') return <Message title={SCREEN.notfound} why={SCREEN.notfoundWhy} />;
  if (game.status === 'denied') return <Message title={SCREEN.denied} why={SCREEN.deniedWhy} />;
  if (game.status === 'error') return <Message title={SCREEN.error} onRetry={game.retry} />;
  if (!s) return <Message title={SCREEN.loading} />;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = info?.joinUrl ?? `${origin}/play?pin=${s.pin}`;
  const stand = s.mode === 'stand' || s.settings?.mode === 'stand';
  // a stand game's link says so: the phone shows the 3D hero picker before joining
  const joinUrl = stand ? withMode(base, 'stand') : base;
  if (stand) {
    return (
      <Suspense fallback={<Message title={SCREEN.loading} />}>
        <StandScreen gameId={gameId} api={api} game={game} state={s} info={info} joinUrl={joinUrl} onAgain={info?.containerId || liveFakeWanted() ? again : null} syncRef={syncRef} />
      </Suspense>
    );
  }
  if (mixedOf(s) || (s.settings?.stand_every ?? 0) > 0) {
    return (
      <Suspense fallback={<Message title={SCREEN.loading} />}>
        <MixedHost gameId={gameId} api={api} game={game} state={s} info={info} joinUrl={joinUrl} onAgain={info?.containerId || liveFakeWanted() ? again : null} syncRef={syncRef} />
      </Suspense>
    );
  }
  return <HostScreen gameId={gameId} api={api} game={game} state={s} info={info} joinUrl={joinUrl} onAgain={info?.containerId || liveFakeWanted() ? again : null} />;
}

export default function LiveHostPage() {
  const { id = '' } = useParams();
  const { search } = useLocation();
  useDocumentTitle(MODE.name);
  // One server per tab: the fake keeps its games in memory (a reload of a fake game finds nothing — by design).
  const api = useMemo(() => liveApi(liveFakeWanted() ? fakeKnobs(search) : undefined), []); // eslint-disable-line react-hooks/exhaustive-deps
  return <LiveHostView key={id} gameId={id} api={api} />;
}
