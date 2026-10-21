/**
 * The projector of a battle with movement rounds (docs/live/MODE_MIXED.md §8): the battle's own screen (HostScreen) for
 * the lobby, the button questions, the five best and the podium; during each movement round the 3D arena of «Встань на
 * ответ» on the same stage, with the battle's HP bar over it.
 *
 * - The room's socket is opened in the lobby and kept for the whole game; after every live_next, live_kick and live_end
 *   the screen sends `sync` (useHostGame's onMoved through `syncRef`), a kick goes to the room too.
 * - The 3D kit is loaded once, in the lobby, and warmed up; between movement rounds its loop is stopped (no frames, no
 *   GPU work) and its canvas waits under the stage's light veil. A movement round fades the veil out over a picture
 *   already drawn: no empty canvas, no models loaded again.
 * - The arena is on while `arenaOn` says so: the room's state when it knows the question (it hears the teacher's
 *   click first), else the database's `question.stand`.
 * - The board: the question and its options with live counts from the snapshot flags (`answered` stays 0 in a
 *   movement round), the timer from the room's times, how many play and how many are frozen. Its reveal: the stomp and
 *   the falls (the scene), then the hits on the boss one by one with the HP after each, one thud, the heal, the phase or
 *   the fall, «Попали N из M» and the fastest; ice breaks on the right zone at the blow and forms on the fallen when the
 *   floor brings them back. A round the room never wrote says «Мини-игра не засчитана», with no stomp.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { STAND_LETTERS, type StandResult, type StandState } from '../../../lib/live/move';
import { ZONE_COLOURS } from '../../../lib/live/three';
import type { BossKind, HostState } from '../../../lib/live/types';
import { BANNER, BATTLE, MIXED, nb } from '../host/copy';
import { HostScreen, type HostScreenProps } from '../host/HostScreen';
import { readHostToken } from '../host/hostSession';
import { STAGE_H } from '../host/layout';
import { hostSound, type HostSound } from '../host/sound';
import { useStageWidth } from '../host/Stage';
import { FpsReadout, fpsWanted } from './FpsReadout';
import { arenaOn, revealPlan, strongest } from './mixed';
import type { TimerFace } from './plan';
import { useStandRoom } from './room';
import { StandScene, type StandCue, type StandHud } from './scene';
import { STAND } from './copy';
import '../host/host.css';
import './stand.css';

/** Stage units: the board starts under the HP bar; the 3D floor is framed from ARENA_TOP to the bottom. */
const BOARD_TOP = 132;
const ARENA_TOP = 300;

export interface MixedHostProps extends Omit<HostScreenProps, 'mixed'> {
  /** The room's sync after each of the teacher's moves goes through this (set by the page). */
  syncRef?: { current: (() => void) | null };
}

interface Chip {
  key: string;
  name: string;
  dmg: number;
}

interface RevealView {
  qi: number;
  /** The boss's HP as the reveal shows it now (null: the database's). */
  hp: number | null;
  max: number | null;
  /** The hits so far (the last five), then the three who hit hardest. */
  chips: Chip[];
  strike: boolean;
  banner: { id: number; title: string; sub: string; stay: boolean } | null;
}

const NO_REVEAL: RevealView = { qi: -1, hp: null, max: null, chips: [], strike: false, banner: null };

/**
 * A movement round's reveal on the projector: plays once per round, fresh (the room's result just came) or as it is
 * (seen late: a reload, a reconnect).
 */
function useMixedReveal(rs: StandState | null, scene: RefObject<StandScene | null>, sound: HostSound, nameOf: (id: number) => string, serverNow: () => number | null): RevealView {
  const [view, setView] = useState<RevealView>(NO_REVEAL);
  const played = useRef(-1);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const banners = useRef(0);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const res = rs && rs.round === 'stand' && rs.phase === 'reveal' ? rs.res : null;
  useEffect(() => {
    if (!res || played.current === res.qi) return;
    played.current = res.qi;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    const plan = revealPlan(res);
    const max = res.hp_max ?? null;
    const top = (r: StandResult) => strongest(r).map((h) => ({ key: `top-${h.id}`, name: nameOf(h.id), dmg: h.dmg }));
    const banner = (b: { title: string; sub: string }, stay = false) => ({ id: ++banners.current, ...b, stay });
    const news = (): RevealView['banner'] => {
      if (res.defeated) return banner(BANNER.defeated, true);
      if (res.phase_changed === 1) return banner(BANNER.phase1);
      if (res.phase_changed === 2) return banner(BANNER.phase2);
      if ((res.healed ?? 0) > 0) return banner(BANNER.heal(res.healed ?? 0));
      return null;
    };
    const now = serverNow();
    if (res.void || (now !== null && now - res.at > 1500)) {
      // nothing to play (a round that did not count), or seen late: drawn as it is
      setView({ qi: res.qi, hp: res.hp ?? null, max, chips: res.void ? [] : top(res), strike: !res.void, banner: res.void ? banner(MIXED.void, true) : null });
      return;
    }
    setView({ qi: res.qi, hp: plan.from, max, chips: [], strike: false, banner: null });
    plan.hits.forEach((h, i) =>
      at(h.at, () => {
        setView((v) => ({ ...v, hp: h.hp, chips: [...v.chips, { key: `${h.id}-${i}`, name: nameOf(h.id), dmg: h.dmg }].slice(-5) }));
        sound.land(i);
        scene.current?.shake(0.12);
      }),
    );
    if (plan.blow !== null) {
      at(plan.blow, () => {
        sound.hit();
        scene.current?.shake(0.55);
        scene.current?.bossPhase(res.defeated ? 'stunned' : 'roar');
      });
      if (!res.defeated) at(plan.blow + 1100, () => scene.current?.bossPhase('idle'));
    }
    if (plan.news !== null) {
      at(plan.news, () => {
        setView((v) => ({ ...v, hp: res.hp ?? v.hp, banner: news() }));
        if (res.defeated) sound.fanfare();
        else if (res.phase_changed === 1 || res.phase_changed === 2) sound.growl();
        else if ((res.healed ?? 0) > 0) sound.heal();
      });
    }
    at(plan.end, () => setView((v) => ({ ...v, hp: res.hp ?? v.hp, chips: top(res), strike: true })));
  }, [res, nameOf, serverNow, scene, sound]);
  return view;
}

function Letter({ i, big = false }: { i: number; big?: boolean }) {
  return (
    <span className={`lvst-letter${big ? ' lvst-letter--big' : ''}`} style={{ background: ZONE_COLOURS[i % ZONE_COLOURS.length] }}>
      {STAND_LETTERS[i] ?? '?'}
    </span>
  );
}

/** The battle's HP bar (the same look as HostScreen's), its numbers from the reveal or the database. */
const ArenaHp = memo(function ArenaHp({ hp, max, width }: { hp: number; max: number; width: number }) {
  const k = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 1;
  const w = 560;
  return (
    <div className="lvh-hp lvmx-hp" style={{ left: width / 2 - w / 2, top: 90, width: w, height: 30 }}>
      <b className="lvh-hp-name">{BATTLE.boss}</b>
      <span className="lvh-hp-num">{BATTLE.hp(hp, max)}</span>
      <div className="lvh-hp-bar" role="meter" aria-label={BATTLE.boss} aria-valuemin={0} aria-valuemax={max} aria-valuenow={hp} aria-valuetext={BATTLE.hp(hp, max)}>
        <i className="lvh-hp-lag" style={{ transform: `scaleX(${k})` }} />
        <i className="lvh-hp-cur" style={{ transform: `scaleX(${k})` }} />
      </div>
    </div>
  );
});

interface BoardProps {
  s: HostState;
  rs: StandState | null;
  reveal: RevealView;
  nameOf: (id: number) => string;
  timerRef: RefObject<HTMLDivElement>;
  countRefs: RefObject<Array<HTMLElement | null>>;
  frozenRef: RefObject<HTMLElement>;
  frozenPillRef: RefObject<HTMLElement>;
  loading: boolean;
  failed: boolean;
  lost: boolean;
}

/** The movement round over the arena, in the stage's units (HostScreen's stage, its bar above). */
function MixedBoard({ s, rs, reveal, nameOf, timerRef, countRefs, frozenRef, frozenPillRef, loading, failed, lost }: BoardProps) {
  const width = useStageWidth();
  // the room's picture of this question when it has one, else the database's
  const own = rs && rs.round === 'stand' && rs.qi >= s.qi ? rs : null;
  const phase = own?.phase ?? s.state;
  const qi = own ? own.qi : s.qi;
  const q = own?.q ?? (s.question ? { text: s.question.text, options: s.question.options } : null);
  const res = phase === 'reveal' ? (own?.res ?? null) : null;
  const key = res?.key ?? (phase === 'reveal' && s.result && s.result.qi === qi ? s.result.key : null);
  const shown = reveal.qi === qi && reveal.hp !== null;
  const hp = shown ? reveal.hp! : s.boss.hp;
  const max = shown && reveal.max ? reveal.max : s.boss.hp_max;
  const hits = phase === 'reveal' && reveal.qi === qi && (reveal.chips.length > 0 || reveal.strike);
  const counts = res?.counts ?? (phase === 'reveal' && s.result && s.result.qi === qi ? s.result.counts : null);
  const fastest = res?.fastest && res.fastest.id !== null ? { name: nameOf(res.fastest.id), dmg: res.fastest.pts } : null;
  const stood = res ? { n: res.stood, of: res.of } : phase === 'reveal' && s.result && s.result.qi === qi ? { n: s.result.right, of: s.players } : null;
  const banner = reveal.qi === qi ? reveal.banner : null;
  return (
    <div className="lvmx" data-phase={phase}>
      {max > 0 ? <ArenaHp hp={hp} max={max} width={width} /> : null}
      <div className="lvst-head lvmx-head" style={{ width: Math.min(1100, width - 700), top: BOARD_TOP }}>
        <section className="lvst-board" aria-live="polite">
          {q && phase === 'reveal' && key !== null ? (
            <div className="lvst-q lvst-q--reveal" key={`r${qi}`}>
              <span className="lvst-hint">{STAND.right}</span>
              <div className="lvst-answer">
                <Letter i={key} big />
                <span>{q.options[key]}</span>
              </div>
            </div>
          ) : q ? (
            <div className="lvst-q" key={`q${qi}`}>
              <span className="lvst-hint">{MIXED.hint}</span>
              <h1 className="lvst-q-text" data-long={q.text.length > 70 ? '' : undefined}>
                {q.text}
              </h1>
            </div>
          ) : null}
        </section>
        {hits ? (
          <ol className="lvmx-hits" key={`h${qi}-${reveal.strike ? 'top' : 'run'}`} aria-label={reveal.strike ? MIXED.strikeLabel : undefined}>
            {reveal.chips.map((c) => (
              <li key={c.key}>
                <span className="lvmx-hit-name">{c.name}</span>
                <b>−{nb(c.dmg)}</b>
              </li>
            ))}
          </ol>
        ) : q ? (
          <ol className="lvst-options" key={`o${qi}`} data-revealed={key !== null ? '' : undefined}>
            {q.options.slice(0, 4).map((text, i) => (
              <li key={i} data-key={key === i ? '' : undefined} data-dim={key !== null && key !== i ? '' : undefined}>
                <Letter i={i} />
                <span className="lvst-opt-text">{text}</span>
                <b
                  className="lvst-opt-count"
                  ref={(el) => {
                    if (countRefs.current) countRefs.current[i] = el;
                  }}
                >
                  {counts ? nb(counts[i] ?? 0) : '0'}
                </b>
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      {phase === 'reveal' && stood ? (
        <div className="lvst-result lvmx-result" key={`res${qi}`}>
          <div className="lvst-stood">
            {stood.n > 0 ? (
              <>
                {MIXED.stood(stood.n, stood.of).before}
                <b>{MIXED.stood(stood.n, stood.of).n}</b>
                {MIXED.stood(stood.n, stood.of).after}
              </>
            ) : (
              MIXED.nobody
            )}
          </div>
          {fastest && fastest.name ? <div className="lvst-fastest">{MIXED.fastest(fastest.name, fastest.dmg)}</div> : null}
        </div>
      ) : null}

      <div className="lvst-side lvmx-side">
        {phase === 'countdown' || phase === 'open' ? (
          <div className="lvst-timer" ref={timerRef} role="timer">
            <b />
          </div>
        ) : null}
        <div className="lvst-pills">
          <span className="lvst-pill">
            <i className="lvst-dot" />
            {MIXED.playing} <b>{nb(s.players)}</b>
          </span>
          <span className="lvst-pill" ref={frozenPillRef} hidden>
            <i className="lvst-dot lvst-dot--ice" />
            {MIXED.frozen} <b ref={frozenRef}>0</b>
          </span>
        </div>
      </div>

      {banner ? (
        <div key={banner.id} className={`lvh-banner${banner.stay ? ' lvh-banner--stay' : ''}`} role="status">
          {banner.title}
          {banner.sub ? <small>{banner.sub}</small> : null}
        </div>
      ) : null}
      {failed ? <div className="lvst-fail">{STAND.noWebgl}</div> : loading ? <div className="lvmx-note">{MIXED.loading}</div> : lost ? <div className="lvmx-note lvmx-note--warn">{MIXED.lost}</div> : null}
    </div>
  );
}

export default function MixedHost({ syncRef, ...props }: MixedHostProps) {
  const { gameId, game, state: s } = props;
  const token = useMemo(() => readHostToken(gameId), [gameId]);
  const { room, view } = useStandRoom(gameId, token);
  useEffect(() => {
    if (!syncRef) return undefined;
    syncRef.current = () => room?.sync();
    return () => {
      syncRef.current = null;
    };
  }, [room, syncRef]);
  const rs = view?.state ?? null;
  const on = arenaOn(s, rs);
  const bossKind: BossKind = s.settings.boss ?? s.boss.kind ?? 'clock';

  // The room saw the phase change before this screen's poll: read the database's state now (the «Дальше» needs it).
  const { refresh } = game;
  useEffect(() => {
    if (rs && rs.round === 'stand' && rs.qi === s.qi && rs.phase !== s.state && (rs.phase === 'reveal' || rs.phase === 'open')) refresh();
  }, [rs?.phase, rs?.qi, s.state, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── what the scene writes into the board, only on change ──
  const sound = useMemo(() => hostSound(), []);
  const timerRef = useRef<HTMLDivElement>(null);
  const countRefs = useRef<Array<HTMLElement | null>>([]);
  const frozenRef = useRef<HTMLElement>(null);
  const frozenPillRef = useRef<HTMLElement>(null);
  const liveCounts = useRef(true);
  liveCounts.current = rs?.phase !== 'reveal';
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
      tally(counts, _alive, _ghosts, iced) {
        if (liveCounts.current) {
          counts.forEach((c, i) => {
            const el = countRefs.current[i];
            if (el) el.textContent = nb(c);
          });
        }
        if (frozenRef.current) frozenRef.current.textContent = nb(iced);
        if (frozenPillRef.current) frozenPillRef.current.hidden = iced === 0;
      },
      cue(c: StandCue) {
        if (c === 'tick' || c === 'tickLast') sound.tick(c === 'tickLast');
        else if (c === 'warn') sound.roll(true);
        else if (c === 'stomp') sound.roll(false);
        else if (c === 'impact') sound.hit();
        else if (c === 'freeze') sound.freeze();
      },
    }),
    [sound],
  );

  // ── the 3D arena: loaded in the lobby, drawn only during movement rounds ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<StandScene | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const onRef = useRef(on);
  onRef.current = on;
  const margins = useMemo(() => ({ top: ARENA_TOP / STAGE_H, bottom: 0.012 }), []);
  // knobs for a slow machine (a recording on a CPU-only browser): ?q=0…5 pins the quality, ?aa=0, ?px=0.6
  const viewKnobs = useMemo(() => {
    const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const q = p.get('q');
    const px = Number(p.get('px'));
    return { quality: q !== null && /^[0-5]$/.test(q) ? Number(q) : ('auto' as const), antialias: p.get('aa') !== '0', maxPixelRatio: px > 0.2 && px <= 2 ? px : undefined, preserveDrawingBuffer: p.get('pdb') === '1' };
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!room || !canvas) return undefined;
    const scene = new StandScene(canvas, room, hud, bossKind, { margins, view: viewKnobs, mixed: true, paused: !onRef.current });
    sceneRef.current = scene;
    scene.start().then(
      () => setReady(true),
      () => setFailed(true),
    );
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('bench')) {
      const w = window as unknown as { __stand?: StandScene; __standStep: (dt: number) => void; __standManual: (on: boolean) => void };
      w.__stand = scene;
      w.__standStep = (dt: number) => scene.step(dt);
      w.__standManual = (manual: boolean) => scene.manual(manual);
    }
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [room, hud, bossKind, margins, viewKnobs]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (on) scene.resume();
    else scene.pause();
  }, [on, ready]);
  // a hero changed in the lobby reaches the projector through the database's roster (the room keeps the first look)
  const looks = useMemo(() => new Map<string, unknown>(s.roster.map((r) => [r.player_id, r.look])), [s.roster]);
  useEffect(() => {
    sceneRef.current?.setLooks(looks);
  }, [looks, room, ready]);

  const nameOf = useCallback((id: number) => room?.client.roster.get(id)?.[3] ?? '', [room]);
  const serverNow = useCallback(() => room?.client.serverNow() ?? null, [room]);
  const reveal = useMixedReveal(rs, sceneRef, sound, nameOf, serverNow);
  const lost = !!view && view.status !== 'open' && view.status !== 'closed' && !!view.welcome;
  const showFps = useMemo(() => fpsWanted(), []);

  const backdrop = (
    <div className="lvmx-backdrop" data-on={on ? '' : undefined} aria-hidden="true">
      <canvas ref={canvasRef} className="lvst-canvas" />
      {showFps && on ? <FpsReadout quality={() => sceneRef.current?.stats()?.quality ?? null} /> : null}
    </div>
  );
  const board = on ? (
    <MixedBoard
      s={s}
      rs={rs}
      reveal={reveal}
      nameOf={nameOf}
      timerRef={timerRef}
      countRefs={countRefs}
      frozenRef={frozenRef}
      frozenPillRef={frozenPillRef}
      loading={!ready && !failed}
      failed={failed}
      lost={lost || (!view?.welcome && ready)}
    />
  ) : null;
  const onKick = useCallback((pid: string) => room?.kick(pid), [room]);
  return <HostScreen {...props} mixed={{ backdrop, board, onKick }} />;
}
