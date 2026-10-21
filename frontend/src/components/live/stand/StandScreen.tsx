/**
 * The projector in «Встань на ответ» (docs/live/MODE_STAND.md §8): the 3D arena on the whole screen, and over it the
 * board (the PIN and the QR code in the lobby, the question with its options, the right answer, the five best, the
 * podium), the timer and the teacher's buttons.
 *
 * Two sources: the database's HostState (useHostGame: PIN, roster, settings, the teacher's moves) and the room's
 * socket (StandRoom: positions, and the mode's `state` with the question, its times in the room's clock and the
 * result). The board follows the room's phase when the room is connected, else the database's. Per frame nothing
 * here renders: the scene writes the timer, the counts and alive/ghosts into their elements through StandHud.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Maximize, Minimize, Users, Volume2, VolumeX } from 'lucide-react';
import type { BossKind, HostState, LiveApi, RosterRow } from '../../../lib/live/types';
import { STAND_LETTERS, type StandState, type StandTopEntry } from '../../../lib/live/move';
import { ZONE_COLOURS } from '../../../lib/live/three';
import { qrCode, shortLink } from '../../../lib/quizzes/qr';
import { fastestName, type TimerFace } from './plan';
import { useStandRoom } from './room';
import { StandScene, type StandCue, type StandHud } from './scene';
import { STAND } from './copy';
import { Thumb } from './Thumb';
import { Stage, useStageFit } from '../host/Stage';
import { STAGE_H } from '../host/layout';
import { EndConfirm, KickConfirm, PlayersSheet, ReviewSheet } from '../host/Sheets';
import { TelegramPost, type Chat } from '../host/TelegramPost';
import { logState, readHostToken, readLog, type HostInfo } from '../host/hostSession';
import { hostSound } from '../host/sound';
import { NEXT, nb } from '../host/copy';
import type { HostGame } from '../host/useHostGame';
import '../host/host.css';
import './stand.css';

/** The board's bottom edge and the buttons' top edge, stage units (900 high): the 3D floor is framed between. */
const BOARD_BOTTOM = 196;
const FOOT_TOP = 812;

type Phase = StandState['phase'];

export interface StandScreenProps {
  gameId: string;
  api: LiveApi;
  game: HostGame;
  state: HostState;
  info: HostInfo | null;
  joinUrl: string;
  onAgain: (() => void) | null;
  /** The room's sync after each of the teacher's moves goes through this (set by the page). */
  syncRef?: { current: (() => void) | null };
}

function Qr({ text }: { text: string }) {
  const qr = useMemo(() => qrCode(text), [text]);
  return (
    <svg className="lvst-qr" viewBox={`-1 -1 ${qr.size + 2} ${qr.size + 2}`} role="img" aria-label={`QR-код: ${shortLink(text)}`} shapeRendering="crispEdges">
      <path d={qr.path} fill="#0B121C" />
    </svg>
  );
}

function Letter({ i, big = false }: { i: number; big?: boolean }) {
  return (
    <span className={`lvst-letter${big ? ' lvst-letter--big' : ''}`} style={{ background: ZONE_COLOURS[i % ZONE_COLOURS.length] }}>
      {STAND_LETTERS[i] ?? '?'}
    </span>
  );
}

function TopList({ rows, nameOf }: { rows: StandTopEntry[]; nameOf: (r: StandTopEntry) => string }) {
  return (
    <ol className="lvst-top">
      {rows.slice(0, 5).map((r, i) => (
        <li key={`${r.id ?? 'x'}-${r.name}-${i}`} className={i === 0 ? 'lvst-top-first' : undefined} style={{ ['--i' as string]: i }}>
          <span className="lvst-top-place">{i + 1}</span>
          <Thumb look={r.look} size={96} />
          <span className="lvst-top-name">{nameOf(r)}</span>
          <span className="lvst-top-pts">{nb(r.pts)}</span>
          {r.move > 0 ? <span className="lvst-up">{STAND.up(r.move)}</span> : r.move < 0 ? <span className="lvst-down">{STAND.down(-r.move)}</span> : <span />}
        </li>
      ))}
    </ol>
  );
}

function PodiumBlocks({ rows }: { rows: StandTopEntry[] }) {
  // 2 · 1 · 3 on the blocks, 4 and 5 beside
  const order = [1, 0, 2].filter((i) => rows[i]);
  return (
    <div className="lvst-podium">
      <div className="lvst-podium-blocks">
        {order.map((i) => (
          <div key={i} className={`lvst-pod lvst-pod--${i + 1}`} style={{ ['--i' as string]: i }}>
            <Thumb look={rows[i].look} size={i === 0 ? 190 : 150} />
            <div className="lvst-pod-name">{rows[i].name}</div>
            <div className="lvst-pod-pts">{nb(rows[i].pts)}</div>
            <div className="lvst-pod-block">{i + 1}</div>
          </div>
        ))}
      </div>
      {rows.length > 3 ? (
        <ol className="lvst-podium-rest" start={4}>
          {rows.slice(3, 5).map((r, k) => (
            <li key={`${r.name}-${k}`}>
              <span className="lvst-top-place">{k + 4}</span>
              <Thumb look={r.look} size={56} />
              <span className="lvst-top-name">{r.name}</span>
              <span className="lvst-top-pts">{nb(r.pts)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** The room's top five as the database's (a reload before the room said it), in the room's shape. */
function dbTop(s: HostState): StandTopEntry[] | null {
  if (!s.top) return null;
  return s.top.map((r) => ({ id: null, name: r.name, look: r.look, pts: r.dmg, move: r.move }));
}

export function StandScreen({ gameId, api, game, state: s, info, joinUrl, onAgain, syncRef }: StandScreenProps) {
  const fit = useStageFit();
  const width = fit.width;
  const token = useMemo(() => readHostToken(gameId), [gameId]);
  const { room, view } = useStandRoom(gameId, token);
  useEffect(() => {
    if (!syncRef) return undefined;
    syncRef.current = () => room?.sync();
    return () => {
      syncRef.current = null;
    };
  }, [room, syncRef]);
  const rs = view?.status === 'open' || view?.state ? (view?.state ?? null) : null;
  const phase: Phase = rs?.phase ?? s.state;
  const bossKind: BossKind = s.settings.boss ?? s.boss.kind ?? 'clock';

  // ── the 3D scene ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<StandScene | null>(null);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<HTMLDivElement>(null);
  const countRefs = useRef<Array<HTMLElement | null>>([]);
  const aliveRef = useRef<HTMLElement>(null);
  const ghostsRef = useRef<HTMLElement>(null);
  const ghostPillRef = useRef<HTMLElement>(null);
  const sound = useMemo(() => hostSound(), []);
  // the reveal shows the room's counts; the live ones from the flags only while the question runs
  const liveCounts = useRef(true);
  liveCounts.current = phase !== 'reveal';
  const hud = useMemo<StandHud>(
    () => ({
      timer(face: TimerFace) {
        const el = timerRef.current;
        if (!el) return;
        if (face.hot) el.dataset.hot = '';
        else delete el.dataset.hot;
        if (face.ready) el.dataset.ready = '';
        else delete el.dataset.ready;
        const b = el.querySelector('b');
        if (b) b.textContent = face.sec === null ? '' : String(face.sec);
        el.style.setProperty('--left', String(face.left));
      },
      tally(counts, alive, ghosts) {
        if (liveCounts.current) {
          counts.forEach((c, i) => {
            const el = countRefs.current[i];
            if (el) el.textContent = nb(c);
          });
        }
        if (aliveRef.current) aliveRef.current.textContent = nb(alive);
        if (ghostsRef.current) ghostsRef.current.textContent = nb(ghosts);
        if (ghostPillRef.current) ghostPillRef.current.hidden = ghosts === 0;
      },
      cue(c: StandCue) {
        if (c === 'tick' || c === 'tickLast') sound.tick(c === 'tickLast');
        else if (c === 'warn') sound.roll(true);
        else if (c === 'stomp') sound.roll(false);
        else if (c === 'impact') sound.hit();
        else if (c === 'back') sound.heal();
      },
    }),
    [sound],
  );
  const margins = useMemo(() => ({ top: BOARD_BOTTOM / STAGE_H + 0.01, bottom: Math.max(0.01, (STAGE_H - FOOT_TOP) / STAGE_H) }), []);
  // knobs for a slow machine (a recording on a CPU-only browser): ?q=0…5 pins the quality, ?aa=0, ?px=0.6
  const viewKnobs = useMemo(() => {
    const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const q = p.get('q');
    const px = Number(p.get('px'));
    return {
      quality: q !== null && /^[0-5]$/.test(q) ? Number(q) : ('auto' as const),
      antialias: p.get('aa') !== '0',
      maxPixelRatio: px > 0.2 && px <= 2 ? px : undefined,
    };
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!room || !canvas) return undefined;
    const scene = new StandScene(canvas, room, hud, bossKind, { margins, view: viewKnobs });
    sceneRef.current = scene;
    scene.start().catch(() => setFailed(true));
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('bench')) {
      const w = window as unknown as { __stand?: StandScene; __standBench?: (n: number) => unknown };
      w.__stand = scene;
      w.__standBench = (n: number) => scene.bench(n);
      const m = w as unknown as { __standStep: (dt: number) => void; __standManual: (on: boolean) => void };
      m.__standStep = (dt: number) => scene.step(dt);
      m.__standManual = (on: boolean) => scene.manual(on);
    }
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [room, hud, bossKind, margins, viewKnobs]);

  // ── sound and keys ──
  const muted = useSyncExternalStore(sound.subscribe, sound.isMuted, sound.isMuted);
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      sound.lobby(false);
      sound.roll(false);
    };
  }, [sound]);
  useEffect(() => sound.lobby(phase === 'lobby'), [phase, sound]);
  const joinedRef = useRef(s.roster.length);
  useEffect(() => {
    if (phase === 'lobby' && s.roster.length > joinedRef.current) sound.join();
    joinedRef.current = s.roster.length;
  }, [phase, s.roster.length, sound]);
  useEffect(() => {
    if (phase === 'podium') sound.fanfare();
  }, [phase, sound]);

  // The room saw the phase change before this screen's poll: read the database's state now (the «Дальше» needs it).
  const { refresh } = game;
  useEffect(() => {
    if (rs && rs.phase !== s.state && (rs.phase === 'reveal' || rs.phase === 'open')) refresh();
  }, [rs?.phase, s.state, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const [sheet, setSheet] = useState<'players' | 'review' | 'end' | null>(null);
  const [kickRow, setKickRow] = useState<RosterRow | null>(null);
  const [acting, setActing] = useState(false);
  const [full, setFull] = useState(false);
  const [log, setLog] = useState(() => readLog(gameId));
  const [tgChat, setTgChat] = useState<string | null>(null);
  const onPosted = useCallback((chat: Chat) => setTgChat(chat.title ?? ''), []);
  useEffect(() => setLog((l) => logState(gameId, l, s)), [gameId, s]);

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

  const rosterRef = useRef(s.roster);
  rosterRef.current = s.roster;
  const pickKick = useCallback((row: RosterRow) => {
    setSheet(null);
    setKickRow(row);
  }, []);
  const doKick = useCallback(async () => {
    if (!kickRow) return;
    setActing(true);
    room?.kick(kickRow.player_id);
    await game.kick(kickRow.player_id);
    setActing(false);
    setKickRow(null);
  }, [game, kickRow, room]);
  const doEnd = useCallback(async () => {
    setActing(true);
    await game.end();
    setActing(false);
    setSheet(null);
  }, [game]);

  // ── what the board shows ──
  const nameOf = useCallback(
    (id: number) => {
      const e = room?.client.roster.get(id);
      return e && e[3] ? e[3] : null;
    },
    [room],
  );
  const q = rs?.q ?? (s.question ? { text: s.question.text, options: s.question.options } : null);
  const qi = rs ? rs.qi : s.qi;
  const qCount = rs?.q_count ?? s.q_count;
  const res = rs?.res ?? null;
  const inQuestion = phase === 'countdown' || phase === 'open' || phase === 'reveal';
  const top = rs?.top ?? dbTop(s);
  const fastest = phase === 'reveal' ? fastestName(rs, nameOf) : null;
  const lastQuestion = qi >= qCount - 1;
  const canNext = (phase === 'reveal' && s.state === 'reveal') || (phase === 'leaderboard' && s.state === 'leaderboard');
  const nextLabel = phase === 'reveal' ? (lastQuestion ? STAND.nextLast : STAND.next) : STAND.nextQuestion;
  const players = s.players;
  const site = shortLink(joinUrl.replace(/\?.*$/, ''));
  const roomLost = !!view && view.status !== 'open' && view.status !== 'closed' && !!view.welcome;
  const accuracy = rs?.acc ?? s.final?.accuracy_pct ?? null;
  const counts = res?.counts;

  return (
    <div className="lvst" data-phase={phase}>
      <canvas ref={canvasRef} className="lvst-canvas" aria-hidden="true" />
      <Stage fit={fit} label={STAND.name}>
        <div className="lvst-brand">
          <span className="lvh-logo" aria-label="Meldy">
            Meldy<i />
          </span>
          <b>{STAND.name}</b>
          <span>
            {inQuestion || phase === 'leaderboard' ? `${STAND.question(qi + 1, qCount)} · ${STAND.pin(s.pin)}` : info?.title ? info.title : STAND.questions(qCount)}
          </span>
        </div>

        <div className="lvst-head" style={{ width: Math.min(1100, width - 660) }}>
        <section className="lvst-board" aria-live="polite">
          {phase === 'lobby' ? (
            <div className="lvst-join">
              <div className="lvst-join-qr">
                <Qr text={joinUrl} />
              </div>
              <div className="lvst-join-text">
                <span>
                  {STAND.go} <b>{site}</b>
                </span>
                <strong aria-label={`PIN ${s.pin.split('').join(' ')}`}>{STAND.pin(s.pin)}</strong>
                <span>{STAND.camera}</span>
              </div>
            </div>
          ) : inQuestion && q ? (
            phase === 'reveal' && res ? (
              <div className="lvst-q lvst-q--reveal" key={`r${qi}`}>
                <span className="lvst-hint">{STAND.right}</span>
                <div className="lvst-answer">
                  <Letter i={res.key} big />
                  <span>{q.options[res.key]}</span>
                </div>
              </div>
            ) : (
              <div className="lvst-q" key={`q${qi}`}>
                <span className="lvst-hint">{STAND.hint}</span>
                <h1 className="lvst-q-text" data-long={q.text.length > 70 ? '' : undefined}>
                  {q.text}
                </h1>
              </div>
            )
          ) : phase === 'leaderboard' ? (
            <div className="lvst-q">
              <span className="lvst-hint">{STAND.topAfter(qi + 1, qCount)}</span>
              <h1 className="lvst-q-text">{STAND.top}</h1>
            </div>
          ) : phase === 'podium' || phase === 'ended' ? (
            <div className="lvst-q">
              {accuracy !== null ? <span className="lvst-hint">{STAND.accuracy(accuracy)}</span> : null}
              <h1 className="lvst-q-text">{phase === 'ended' ? STAND.ended : STAND.final}</h1>
            </div>
          ) : null}
        </section>

        {inQuestion && q ? (
          <ol className="lvst-options" key={`o${qi}`} data-revealed={phase === 'reveal' && res ? '' : undefined}>
            {q.options.slice(0, 4).map((text, i) => (
              <li key={i} data-key={res && res.key === i ? '' : undefined} data-dim={res && res.key !== i ? '' : undefined}>
                <Letter i={i} />
                <span className="lvst-opt-text">{text}</span>
                <b
                  className="lvst-opt-count"
                  ref={(el) => {
                    countRefs.current[i] = el;
                  }}
                >
                  {counts ? nb(counts[i] ?? 0) : '0'}
                </b>
              </li>
            ))}
          </ol>
        ) : null}
        </div>

        {phase === 'reveal' && res ? (
          <div className="lvst-result" key={`res${qi}`}>
            <div className="lvst-stood">
              {res.stood > 0 ? (
                <>
                  {STAND.stood(res.stood, res.of).before}
                  <b>{STAND.stood(res.stood, res.of).n}</b>
                  {STAND.stood(res.stood, res.of).after}
                </>
              ) : (
                STAND.nobody
              )}
            </div>
            {fastest ? <div className="lvst-fastest">{STAND.fastest(fastest.name, fastest.pts)}</div> : null}
          </div>
        ) : null}

        <div className="lvst-side">
          {phase === 'countdown' || phase === 'open' ? (
            <div className="lvst-timer" ref={timerRef} role="timer">
              <b />
            </div>
          ) : null}
          <div className="lvst-pills">
            {phase === 'lobby' ? (
              <span className="lvst-pill">
                <i className="lvst-dot" />
                {STAND.playing} <b>{nb(players)}</b>
              </span>
            ) : (
              <>
                <span className="lvst-pill">
                  <i className="lvst-dot" />
                  {STAND.alive} <b ref={aliveRef}>{nb(players)}</b>
                </span>
                <span className="lvst-pill" ref={ghostPillRef} hidden>
                  <i className="lvst-dot lvst-dot--ghost" />
                  {STAND.ghosts} <b ref={ghostsRef}>0</b>
                </span>
              </>
            )}
          </div>
        </div>

        {phase === 'leaderboard' && top ? (
          <div className="lvst-veil">
            <TopList rows={top} nameOf={(r) => r.name} />
          </div>
        ) : null}
        {(phase === 'podium' || phase === 'ended') && top ? (
          <div className="lvst-veil">
            <PodiumBlocks rows={top} />
          </div>
        ) : null}

        <div className="lvst-foot">
          <div className="lvst-tools">
            <button
              type="button"
              className="lvst-tool"
              onClick={() => sound.setMuted(!sound.isMuted())}
              aria-label={STAND.sound}
              aria-pressed={!muted}
              title={muted ? STAND.soundOn : STAND.soundOff}
            >
              {muted ? <VolumeX size={20} strokeWidth={2.2} aria-hidden="true" /> : <Volume2 size={20} strokeWidth={2.2} aria-hidden="true" />}
            </button>
            {phase !== 'ended' ? (
              <button type="button" className="lvst-tool" onClick={() => setSheet('players')} aria-label={STAND.players} title={STAND.players}>
                <Users size={20} strokeWidth={2.2} aria-hidden="true" />
              </button>
            ) : null}
            <button type="button" className="lvst-tool" onClick={toggleFull} aria-label={full ? STAND.fullscreenOff : STAND.fullscreen} title={full ? STAND.fullscreenOff : STAND.fullscreen}>
              {full ? <Minimize size={20} strokeWidth={2.2} aria-hidden="true" /> : <Maximize size={20} strokeWidth={2.2} aria-hidden="true" />}
            </button>
            {phase !== 'ended' && phase !== 'podium' ? (
              <button type="button" className="lvst-tool lvst-tool--text" onClick={() => setSheet('end')}>
                {STAND.end}
              </button>
            ) : null}
            {game.offline ? <span className="lvst-warn">{STAND.offline}</span> : roomLost ? <span className="lvst-warn">{STAND.lost}</span> : null}
          </div>
          {phase === 'lobby' ? (
            <div className="lvst-actions">
              <span className="lvst-settings">{STAND.settings(s.time_s, s.speed, s.settings.who === 'members')}</span>
              {info?.containerId ? <TelegramPost api={api} gameId={gameId} containerId={info.containerId} fake={api.kind === 'fake'} onPosted={onPosted} /> : null}
              {tgChat !== null ? <span className="lvst-settings">{tgChat}</span> : null}
              <button type="button" className="lvh-btn lvst-go" onClick={next} disabled={game.busy || players === 0}>
                {STAND.start}
                <kbd className="lvh-kbd">{NEXT.key}</kbd>
              </button>
            </div>
          ) : canNext ? (
            <div className="lvst-actions">
              <button type="button" className="lvh-btn lvst-go" onClick={next} disabled={game.busy}>
                {nextLabel}
                <kbd className="lvh-kbd">{NEXT.key}</kbd>
              </button>
            </div>
          ) : phase === 'podium' || phase === 'ended' ? (
            <div className="lvst-actions">
              <button type="button" className="lvh-btn lvh-btn--white" onClick={() => setSheet('review')}>
                {STAND.review}
              </button>
              {onAgain ? (
                <button type="button" className="lvh-btn lvh-btn--white" onClick={onAgain}>
                  {STAND.again}
                </button>
              ) : null}
              {phase === 'podium' ? (
                <button type="button" className="lvh-btn lvst-go" onClick={next} disabled={game.busy}>
                  {STAND.finish}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {failed ? <div className="lvst-fail">{STAND.noWebgl}</div> : null}
        {sheet === 'players' ? <PlayersSheet roster={s.roster} onKick={pickKick} onClose={() => setSheet(null)} /> : null}
        {sheet === 'review' ? <ReviewSheet log={log} roster={s.roster} asked={s.qi + 1} onClose={() => setSheet(null)} /> : null}
        {sheet === 'end' ? <EndConfirm onYes={() => void doEnd()} onNo={() => setSheet(null)} busy={acting} /> : null}
        {kickRow ? <KickConfirm row={kickRow} onYes={() => void doKick()} onNo={() => setKickRow(null)} busy={acting} /> : null}
      </Stage>
    </div>
  );
}

export default StandScreen;
