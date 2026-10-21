/**
 * The teacher's screen of a running game (/live/:id): lobby → arena with the question → reveal → «Больше всех урона» →
 * … → podium. One stage scaled to the window; Space, → or a clicker's PageDown moves on, F toggles full screen.
 *
 * Rendering: the server's state comes every second in the lobby and during a question (useHostGame keeps unchanged
 * parts as the same objects), the screen renders what changed. The reveal is the director's: it moves the effects
 * directly and touches the stage store per hit; when it ends, the store takes the server's state as it is then.
 * A reload, or a state the screen did not see coming, is drawn still, as it is.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ColourId, HostState, LiveApi, RosterRow } from '../../../lib/live/types';
import { TelegramPost } from './TelegramPost';
import { BossView, CrowdCount, FxDefs, HpBar, PhaseNote, byJoin } from './Arena';
import { BANNER, MODE, NEXT } from './copy';
import { Crowd, type CrowdView, type Place } from './Crowd';
import { Director, type BannerSpec } from './director';
import { logState, readLog, type HostInfo } from './hostSession';
import { NO_SEATS, arenaSlots, lobbySlots, podiumSlots, podiumTopSlots, seats as seatsFor, type LobbyLayout, type Seats, type Slot } from './layout';
import { Lobby } from './Lobby';
import { QuestionPanel, TopFive } from './Panel';
import { ClosedScreen, Podium, gameOutcome, podiumTop, rankRoster, type PodiumRow } from './Podium';
import { EndConfirm, KickConfirm, PlayersSheet, ReviewSheet } from './Sheets';
import { Stage, useStageFit } from './Stage';
import { StageStore } from './stageStore';
import { TopBar } from './TopBar';
import type { HostGame } from './useHostGame';
import './host.css';

/** The store at rest: what the server's state says, without motion. */
export function syncRest(store: StageStore, s: HostState): void {
  const keep = new Set(s.roster.map((r) => r.player_id));
  store.retain(keep);
  // The monster fell, or the game is over: everyone celebrates, the ice is gone.
  const end = s.state === 'podium' || s.state === 'ended' || (s.state === 'reveal' && s.boss.defeated);
  for (const r of s.roster) {
    const frozen = !end && r.frozen;
    store.setChar(r.player_id, { frozen, face: end ? 'happy' : frozen ? 'frozen' : 'idle' });
  }
  if (s.boss.hp_max > 0) store.setHp(s.boss.hp, s.boss.hp_max);
  store.setBoss({ phase: s.boss.phase, hurt: false, fallen: s.boss.defeated });
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

const BATTLE_STATES = new Set(['countdown', 'open', 'reveal', 'leaderboard']);
const NO_ROWS: RosterRow[] = [];

const at = (s: Slot, i: number, hidden = false, name = true): Place => ({ x: s.x, y: s.y, size: s.size, hidden, name, nameW: s.nameW, i });

/**
 * Where each drawn character stands in this view. Characters the view has no room for keep their arena place, hidden,
 * so that they come in from where they will stand. `rows` are the seated players (joining order), `seats` their arena
 * seats.
 */
export function crowdPlaces(view: CrowdView, rows: RosterRow[], seats: Seats, arena: Slot[], lobby: LobbyLayout, top: PodiumRow[], width: number): { places: Map<string, Place>; more: number } {
  const places = new Map<string, Place>();
  const seatOf = (r: RosterRow) => seats.of.get(r.player_id) ?? 0;
  const arenaAt = (r: RosterRow) => arena[seatOf(r)] ?? arena[arena.length - 1];
  const hide = (r: RosterRow) => {
    const slot = arenaAt(r);
    if (slot) places.set(r.player_id, at(slot, seatOf(r), true));
  };
  if (view === 'lobby') {
    rows.forEach((r, i) => (lobby.slots[i] ? places.set(r.player_id, at(lobby.slots[i], i)) : hide(r)));
    return { places, more: lobby.more };
  }
  if (view === 'battle') {
    rows.forEach((r) => {
      const slot = arenaAt(r);
      if (slot) places.set(r.player_id, at(slot, seatOf(r)));
    });
    return { places, more: 0 };
  }
  const spots = podiumTopSlots(width);
  const seated = new Set(rows.map((r) => r.player_id));
  const onTop = new Set(top.map((r) => r.player_id));
  top.forEach((r, i) => {
    if (seated.has(r.player_id)) places.set(r.player_id, at(spots[i], i, false, false));
  });
  const rest = rankRoster(rows).filter((r) => !onTop.has(r.player_id));
  const sides = podiumSlots(rest.length, width);
  rest.forEach((r, i) => (sides[i] ? places.set(r.player_id, at(sides[i], i + 3)) : hide(r)));
  return { places, more: Math.max(0, rest.length - sides.length) };
}

interface BannerState extends BannerSpec {
  id: number;
  still: boolean;
}

function Banner({ banner }: { banner: BannerState }) {
  const kind = banner.still ? ' lvh-banner--still' : banner.stay ? ' lvh-banner--stay' : '';
  return (
    <div className={`lvh-banner${kind}`} style={{ ['--ms' as string]: `${banner.ms}ms` }} role="status">
      {banner.title}
      {banner.sub ? <small>{banner.sub}</small> : null}
    </div>
  );
}

export interface HostScreenProps {
  gameId: string;
  api: LiveApi;
  game: HostGame;
  state: HostState;
  info: HostInfo | null;
  joinUrl: string;
  onAgain: (() => void) | null;
}

export function HostScreen({ gameId, api, game, state: s, info, joinUrl, onAgain }: HostScreenProps) {
  const fit = useStageFit();
  const width = fit.width;
  const reduced = useReducedMotion();
  const store = useMemo(() => new StageStore(), []);
  const fxRef = useRef<HTMLDivElement>(null);
  const defsRef = useRef<HTMLDivElement>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [sheet, setSheet] = useState<'players' | 'review' | 'end' | null>(null);
  const [kickRow, setKickRow] = useState<RosterRow | null>(null);
  const [acting, setActing] = useState(false);
  const [full, setFull] = useState(false);
  const [log, setLog] = useState(() => readLog(gameId));
  // Opened in the lobby: the monster drops in at the first question. Opened later (a reload): it is simply there.
  const [firstState] = useState(s.state);

  const joined = useMemo(() => byJoin(s.roster), [s.roster]);
  // Seats in the arena: by joining order in the lobby; from the first question on, everyone keeps theirs — a player who
  // leaves leaves an empty seat, nobody else moves.
  const inLobby = s.state === 'lobby';
  const seatsRef = useRef<Seats>(NO_SEATS);
  const seats = useMemo(() => {
    const next = seatsFor(
      joined.map((r) => r.player_id),
      inLobby ? null : seatsRef.current,
    );
    seatsRef.current = next;
    return next;
  }, [joined, inLobby]);
  const visible = useMemo(() => joined.filter((r) => seats.of.has(r.player_id)), [joined, seats]);
  const slots = useMemo(() => arenaSlots(seats.count, width), [seats.count, width]);
  const slotMap = useMemo(() => new Map(visible.map((r) => [r.player_id, slots[seats.of.get(r.player_id) ?? 0]])), [visible, slots, seats]);
  const colours = useMemo(() => new Map<string, ColourId>(s.roster.map((r) => [r.player_id, r.look.colour])), [s.roster]);
  const view: CrowdView = s.state === 'lobby' ? 'lobby' : s.state === 'podium' || s.state === 'ended' ? 'podium' : 'battle';
  const lobby = useMemo(() => lobbySlots(joined.length, width), [joined.length, width]);
  const top = useMemo(() => (view === 'podium' ? podiumTop(s) : []), [view, s]);
  const topKey = top.map((r) => r.player_id).join(',');
  const crowd = useMemo(
    () => crowdPlaces(view, visible, seats, slots, lobby, top, width),
    [view, visible, seats, slots, lobby, topKey, width], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const env = useRef({ slotMap, colours, width });
  env.current = { slotMap, colours, width };
  const bannerId = useRef(0);
  const showBanner = useCallback((b: BannerSpec, still = false) => {
    bannerId.current += 1;
    setBanner({ ...b, id: bannerId.current, still });
  }, []);
  const director = useMemo(
    () =>
      new Director({
        store,
        fx: () => fxRef.current,
        defs: () => defsRef.current,
        slotOf: (id) => env.current.slotMap.get(id) ?? null,
        colourOf: (id) => env.current.colours.get(id) ?? 'blue',
        width: () => env.current.width,
        banner: (b) => showBanner(b),
      }),
    [store, showBanner],
  );
  useEffect(() => () => director.cancel(), [director]);

  useEffect(() => {
    if (!banner || banner.still || banner.stay) return undefined;
    const t = setTimeout(() => setBanner((b) => (b && b.id === banner.id ? null : b)), banner.ms + 60);
    return () => clearTimeout(t);
  }, [banner]);

  const latest = useRef(s);
  latest.current = s;
  const prevRef = useRef<HostState | null>(null);
  useLayoutEffect(() => {
    const prev = prevRef.current;
    prevRef.current = s;
    setLog((l) => logState(gameId, l, s));
    const moved = !prev || prev.state !== s.state || prev.qi !== s.qi;
    const closing = s.state === 'reveal' && !!s.result && !!prev && prev.qi === s.qi && (prev.state === 'open' || prev.state === 'countdown');
    if (closing) {
      setBanner(null);
      if (!reduced) {
        director.reveal(s, () => syncRest(store, latest.current));
        return;
      }
      director.cancel();
      syncRest(store, s);
      const r = s.result!;
      if (s.boss.defeated) showBanner({ ...BANNER.defeated, ms: 0 }, true);
      else if (r.phase_changed === 1 || r.phase_changed === 2) showBanner({ ...(r.phase_changed === 1 ? BANNER.phase1 : BANNER.phase2), ms: 0 }, true);
      else if (r.healed > 0) showBanner({ ...BANNER.heal(r.healed), ms: 0 }, true);
      return;
    }
    if (moved) {
      director.cancel();
      setBanner(null);
    } else if (director.running) return; // a poll during the reveal: the director ends on the latest state
    syncRest(store, s);
    // Opened on a reveal that killed the monster (a reload): its banner, still.
    if (moved && s.state === 'reveal' && s.boss.defeated) showBanner({ ...BANNER.defeated, ms: 0 }, true);
    if (!moved && prev && s.state === 'open' && prev.answered_ids !== s.answered_ids && !reduced) {
      const before = new Set(prev.answered_ids);
      director.hops(s.answered_ids.filter((id) => !before.has(id) && env.current.slotMap.has(id)));
    }
  }, [s, gameId, director, store, reduced, showBanner]);

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const { next } = game;
  const blocked = sheet !== null || kickRow !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (blocked || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        next();
      } else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
        e.preventDefault();
        toggleFull();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [blocked, next, toggleFull]);

  const closeSheet = useCallback(() => setSheet(null), []);
  const pickKick = useCallback((row: RosterRow) => {
    setSheet(null);
    setKickRow(row);
  }, []);
  const rosterRef = useRef(s.roster);
  rosterRef.current = s.roster;
  const pickId = useCallback(
    (id: string) => {
      const row = rosterRef.current.find((r) => r.player_id === id);
      if (row) pickKick(row);
    },
    [pickKick],
  );
  const drawn = useMemo(() => new Set(visible.map((r) => r.player_id)), [visible]);
  const doKick = useCallback(async () => {
    if (!kickRow) return;
    setActing(true);
    await game.kick(kickRow.player_id);
    setActing(false);
    setKickRow(null);
  }, [game, kickRow]);
  const doEnd = useCallback(async () => {
    setActing(true);
    await game.end();
    setActing(false);
    setSheet(null);
  }, [game]);

  const inBattle = BATTLE_STATES.has(s.state);
  // Ended before any question closed: «Игра закрыта», no podium, no crowd.
  const closed = s.state === 'ended' && gameOutcome(s) === 'closed';
  const atEnd = (s.state === 'podium' || s.state === 'ended') && !closed;
  const enter = firstState === 'lobby';
  const lastQuestion = s.boss.defeated || s.qi >= s.q_count - 1;
  const nextSpec =
    s.state === 'reveal'
      ? { label: lastQuestion ? NEXT.revealLast : NEXT.reveal, disabled: game.busy, onClick: next }
      : s.state === 'leaderboard'
        ? { label: NEXT.leaderboard, disabled: game.busy, onClick: next }
        : null;

  const q = s.question;
  const { offset } = game;
  // This device's time of the question's open and close, fixed per question (a later clock estimate does not jolt it).
  const [opensAt, closesAt] = useMemo(() => {
    if (!q) return [0, 0];
    const o = offset();
    return [Date.parse(q.opens_at) - o, Date.parse(q.closes_at) - o];
  }, [q?.opens_at, q?.closes_at, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Stage fit={fit} label={MODE.name}>
      <TopBar
        title={info?.title ?? null}
        question={inBattle && s.qi >= 0 ? { i: s.qi + 1, n: s.q_count } : null}
        final={atEnd}
        pin={inBattle ? s.pin : null}
        players={inBattle ? s.players : null}
        offline={game.offline}
        full={full}
        next={nextSpec}
        onPlayers={s.state === 'ended' ? null : () => setSheet('players')}
        onFull={toggleFull}
        onEnd={s.state === 'ended' ? null : () => setSheet('end')}
      />
      {s.state === 'lobby' ? (
        <Lobby
          state={s}
          players={joined.length}
          more={crowd.more}
          morePoint={lobby.morePoint}
          joinUrl={joinUrl}
          busy={game.busy}
          onStart={next}
          telegram={info?.containerId ? <TelegramPost api={api} gameId={gameId} containerId={info.containerId} fake={api.kind === 'fake'} /> : null}
        />
      ) : null}
      {inBattle ? (
        <div className="lvh-battle">
          <HpBar store={store} width={width} enter={enter} />
          <PhaseNote store={store} width={width} />
          <BossView store={store} width={width} enter={enter} />
          <CrowdCount hidden={joined.length - visible.length} width={width} />
          {s.state === 'leaderboard' ? (
            <TopFive rows={s.top ?? []} width={width} />
          ) : q ? (
            <QuestionPanel
              key={q.qi}
              question={q}
              result={s.state === 'reveal' ? s.result : null}
              players={s.players}
              answered={s.answered}
              opensAt={opensAt}
              closesAt={closesAt}
            />
          ) : null}
          <div className="lvh-fx" ref={fxRef} aria-hidden="true" />
        </div>
      ) : null}
      {atEnd ? (
        <Podium
          state={s}
          top={top}
          drawn={drawn}
          more={crowd.more + Math.max(0, joined.length - visible.length)}
          width={width}
          busy={game.busy}
          onReview={() => setSheet('review')}
          onAgain={onAgain}
          onFinish={next}
        />
      ) : null}
      {closed ? <ClosedScreen testHref={info?.containerId ? `/exams/c/${info.containerId}` : '/exams'} onAgain={onAgain} /> : null}
      <Crowd view={view} rows={closed ? NO_ROWS : visible} places={crowd.places} store={store} onPick={pickId} first={top[0]?.player_id ?? null} />
      <FxDefs defsRef={defsRef} />
      {banner ? <Banner key={banner.id} banner={banner} /> : null}
      {sheet === 'players' ? <PlayersSheet roster={s.roster} onKick={pickKick} onClose={closeSheet} /> : null}
      {sheet === 'review' ? <ReviewSheet log={log} roster={s.roster} asked={s.qi + 1} onClose={closeSheet} /> : null}
      {sheet === 'end' ? <EndConfirm onYes={() => void doEnd()} onNo={closeSheet} busy={acting} /> : null}
      {kickRow ? <KickConfirm row={kickRow} onYes={() => void doKick()} onNo={() => setKickRow(null)} busy={acting} /> : null}
    </Stage>
  );
}
