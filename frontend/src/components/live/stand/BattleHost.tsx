/**
 * The projector of a battle «Битва с монстром», all of it in 3D (owner, 30.10: the game on the projector is 3D only;
 * the phones keep their buttons). One arena from the lobby to the podium:
 *
 * - The class stands round «Дедлайн» (formation.ts): the lobby's joiners hop in, an answer makes its character hop,
 *   every hit of a button question leaps at the boss as its damage lands, a wrong answer freezes in ice at the blow, a
 *   right one breaks it. The database's roster is the class: a phone not in the room is drawn all the same.
 * - A movement round (a mixed game, docs/live/MODE_MIXED.md) plays on the same arena with the room's positions: the
 *   zones light up with the options, the class runs, the floor drops (MixedBoard, useMixedReveal).
 * - Over the arena: the bar of the battle (TopBar), the boss's HP, the board (the PIN and the QR code in the lobby, the
 *   question with its options, the right answer, the hits), the timer, the five best and the podium over a darkened
 *   arena.
 *
 * The room's socket (the same as a mixed game's) is opened in the lobby for every battle: it carries the movement
 * rounds and the phones' characters. Without WebGL the battle's flat screen (HostScreen) takes over.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { useLivePictures, type ShownPictures } from '../../../lib/live/pictures';
import { isStandRound, mixedOf, untilStandRound, type BossKind, type HostState, type Question, type RosterRow } from '../../../lib/live/types';
import { shortLink } from '../../../lib/quizzes/qr';
import { BANNER, BATTLE, BOARD, CLOSED, LETTERS, LOBBY, MIXED, MODE, NEXT, PODIUM, nb } from '../host/copy';
import { HostScreen, answerable, type HostScreenProps } from '../host/HostScreen';
import { TileShape } from '../host/Panel';
import { classAccuracy, gameOutcome, podiumTop, questionsClosed } from '../host/Podium';
import { EndConfirm, KickConfirm, PlayersSheet, ReviewSheet } from '../host/Sheets';
import { TelegramPost, type Chat } from '../host/TelegramPost';
import { TopBar } from '../host/TopBar';
import { logState, readHostToken, readLog } from '../host/hostSession';
import { STAGE_H } from '../host/layout';
import { hostSound, type HostSound } from '../host/sound';
import { Stage, useStageFit, useStageWidth } from '../host/Stage';
import { BATTLE_3D, STAND } from './copy';
import { FpsReadout, fpsWanted } from './FpsReadout';
import { LEAP_OUT_S } from './formation';
import { ArenaHp, MixedBoard, NO_REVEAL, useMixedReveal, type RevealView } from './MixedHost';
import { BigPicture, OptionPic, StemFigure } from './figure';
import { arenaOn, revealPlan, strongest } from './mixed';
import type { TimerFace } from './plan';
import { battleRows, fastestHit, frozenPids, tapRevealOf, tapTimerFace } from './battle';
import { useStandRoom } from './room';
import { StandScene, type StandCue, type StandHud } from './scene';
import { PodiumBlocks, Qr, TopList, dbTop } from './StandScreen';
import { STAND_WORLD } from './world';
import '../host/host.css';
import './stand.css';

/** Stage units: the board starts under the HP bar; the 3D floor is framed from ARENA_TOP to the bottom. */
const BOARD_TOP = 132;
const ARENA_TOP = 300;
/** Everyone answered before the time: «Все ответили» for a beat, then the key (as the flat screen). */
const ALL_IN_BEAT_MS = 700;
/** A button question's first hit lands this long after the key is shown. */
const TAP_HITS_AFTER_MS = 950;
/** The podium's blocks land (3rd, 2nd, 1st), ms from the podium: stand.css rises each over 0.6 s, 0.25 s apart. */
const PODIUM_HITS_MS = [300, 550, 800] as const;

export interface BattleHostProps extends Omit<HostScreenProps, 'mixed'> {
  /** The room's sync after each of the teacher's moves goes through this (set by the page). */
  syncRef?: { current: (() => void) | null };
}

/** The beat between the answers and the key: the time ran out, or everyone answered. */
type Beat = 'time' | 'all' | null;

function TapLetter({ k, big = false }: { k: number; big?: boolean }) {
  return (
    <span className={`lvbt-letter lvbt-letter--a${k}${big ? ' lvbt-letter--big' : ''}`}>
      <TileShape k={k} />
      <b>{LETTERS[k] ?? '?'}</b>
    </span>
  );
}

/** The timer of a button question from the database's times (this device's ms), redrawn a few times a second. */
const TapTimer = memo(function TapTimer({ opensAt, closesAt, stoppedAt }: { opensAt: number; closesAt: number; stoppedAt: number | null }) {
  const [face, setFace] = useState<TimerFace>(() => tapTimerFace(opensAt, closesAt, Date.now(), stoppedAt));
  useEffect(() => {
    const tick = () => setFace((f) => {
      const n = tapTimerFace(opensAt, closesAt, Date.now(), stoppedAt);
      return n.sec === f.sec && n.ready === f.ready && n.hot === f.hot && Math.abs(n.left - f.left) < 0.004 ? f : n;
    });
    tick();
    if (stoppedAt !== null) return undefined;
    const id = setInterval(tick, 125);
    return () => clearInterval(id);
  }, [opensAt, closesAt, stoppedAt]);
  return (
    <div className="lvst-timer" role="timer" data-ready={face.ready ? '' : undefined} data-hot={face.hot ? '' : undefined} style={{ ['--left' as string]: String(face.left) }}>
      <b>{face.sec ?? ''}</b>
    </div>
  );
});

// ─────────────────────────────────────────── a button question's reveal ───────────────────────────────────────────

/**
 * A button question's reveal on the projector: after the key, the hits land one by one (each character leaps at the
 * boss as its damage shows), one thud, the ice of the wrong answers and the thaws, then the heal, the phase or the
 * fall. Plays once per question, and only for a question this screen saw open (a reload draws it as it is).
 */
function useTapReveal(s: HostState, scene: RefObject<StandScene | null>, sound: HostSound, closesAt: number, onBeat: (b: Beat) => void): RevealView {
  const [view, setView] = useState<RevealView>(NO_REVEAL);
  const played = useRef(-1);
  const sawOpen = useRef(-1);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const banners = useRef(0);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const tap = !isStandRound(s);
  if (tap && (s.state === 'countdown' || s.state === 'open')) sawOpen.current = s.qi;
  const result = tap && s.state === 'reveal' && s.result && s.result.qi === s.qi ? s.result : null;
  const latest = useRef(s);
  latest.current = s;
  useEffect(() => {
    if (!result || played.current === result.qi) return;
    played.current = result.qi;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    const st = latest.current;
    const tr = tapRevealOf(st);
    if (!tr) return;
    const { res, pids } = tr;
    const nameOf = (pid: string) => st.roster.find((r) => r.player_id === pid)?.name ?? '';
    const top = () => strongest(res).map((h) => ({ key: `top-${h.id}`, name: nameOf(pids[h.id]), dmg: h.dmg }));
    const banner = (b: { title: string; sub: string }, stay = false) => ({ id: ++banners.current, ...b, stay });
    const news = (): RevealView['banner'] => {
      if (res.defeated) return banner(BANNER.defeated, true);
      if (res.phase_changed === 1) return banner(BANNER.phase1);
      if (res.phase_changed === 2) return banner(BANNER.phase2);
      if ((res.healed ?? 0) > 0) return banner(BANNER.heal(res.healed ?? 0));
      return null;
    };
    const ice = frozenPids(st.roster);
    if (sawOpen.current !== result.qi) {
      // seen late (a reload): drawn as it is
      scene.current?.setIced(ice, true);
      setView({ qi: result.qi, hp: res.hp ?? null, max: res.hp_max ?? null, chips: top(), strike: true, banner: res.defeated ? banner(BANNER.defeated, true) : null });
      if (res.defeated) scene.current?.bossPhase('stunned');
      return;
    }
    const play = () => {
      onBeat(null);
      sound.reveal();
      const plan = revealPlan(res, TAP_HITS_AFTER_MS);
      const max = res.hp_max ?? null;
      setView({ qi: result.qi, hp: plan.from, max, chips: [], strike: false, banner: null });
      const leapMs = LEAP_OUT_S * 1000;
      plan.hits.forEach((h, i) => {
        at(Math.max(0, h.at - leapMs), () => scene.current?.strike(pids[h.id]));
        at(h.at, () => {
          setView((v) => ({ ...v, hp: h.hp, chips: [...v.chips, { key: `${h.id}-${i}`, name: nameOf(pids[h.id]), dmg: h.dmg }].slice(-5) }));
          sound.land(i);
          scene.current?.shake(0.12);
        });
      });
      // the blow (or, without hits, the moment it would come): the boss reels, the ice forms and breaks
      const blow = plan.blow ?? TAP_HITS_AFTER_MS;
      at(blow, () => {
        if (plan.blow !== null) {
          sound.hit();
          scene.current?.shake(0.55);
          scene.current?.bossPhase(res.defeated ? 'stunned' : 'roar');
        }
        scene.current?.setIced(ice);
        if (result.frozen_now.length) sound.freeze(result.frozen_now.length);
        if (result.thawed.length) sound.shatter(0);
      });
      if (plan.blow !== null && !res.defeated) at(plan.blow + 1100, () => scene.current?.bossPhase('idle'));
      if (plan.news !== null) {
        at(plan.news, () => {
          setView((v) => ({ ...v, hp: res.hp ?? v.hp, banner: news() }));
          if (res.defeated) {
            sound.boom();
            sound.fanfare();
            scene.current?.cheer('all', Infinity);
          } else if (res.phase_changed === 1 || res.phase_changed === 2) sound.growl();
          else if ((res.healed ?? 0) > 0) sound.heal();
        });
      }
      at(Math.max(plan.end, blow + 400), () => setView((v) => ({ ...v, hp: res.hp ?? v.hp, chips: top(), strike: true })));
    };
    // Everyone answered before the time ran out: «Все ответили», the boss braces itself, then the key.
    const answers = result.counts.reduce((a, b) => a + b, 0);
    const early = Date.now() < closesAt - 400 && answers >= answerable(st.roster, st.question?.opens_at);
    if (early) {
      onBeat('all');
      sound.slam();
      at(ALL_IN_BEAT_MS, play);
    } else play();
  }, [result, scene, sound, closesAt, onBeat]);
  return view;
}

// ─────────────────────────────────────────── the board of a button question ───────────────────────────────────────────

interface TapBoardProps {
  s: HostState;
  q: Question;
  pics: ShownPictures;
  reveal: RevealView;
  beat: Beat;
  opensAt: number;
  closesAt: number;
  stoppedAt: number | null;
}

function TapBoard({ s, q, pics, reveal, beat, opensAt, closesAt, stoppedAt }: TapBoardProps) {
  const width = useStageWidth();
  const [big, setBig] = useState(false);
  useEffect(() => setBig(false), [q.qi, s.state]);
  const phase = s.state;
  const result = phase === 'reveal' && s.result && s.result.qi === q.qi && beat !== 'all' ? s.result : null;
  const shown = reveal.qi === q.qi && reveal.hp !== null;
  const hp = shown ? reveal.hp! : s.boss.hp;
  const max = shown && reveal.max ? reveal.max : s.boss.hp_max;
  const hits = !!result && reveal.qi === q.qi && (reveal.chips.length > 0 || reveal.strike);
  const banner = reveal.qi === q.qi ? reveal.banner : null;
  const players = answerable(s.roster, q.opens_at);
  const fastest = result ? fastestHit(s) : null;
  const stem = pics.stem;
  const frozen = s.roster.filter((r) => r.frozen).length;
  const wide = q.options.length > 4;
  return (
    <div className="lvmx lvbt" data-phase={phase}>
      {max > 0 ? <ArenaHp hp={hp} max={max} width={width} /> : null}
      <div className="lvst-head lvmx-head" style={{ width: Math.min(1120, width - 660), top: BOARD_TOP }}>
        <section className="lvst-board lvbt-board" aria-live="polite" data-pic={stem !== undefined ? '' : undefined}>
          {stem !== undefined ? <StemFigure stem={stem} big={big} onToggle={() => setBig((v) => !v)} /> : null}
          {result ? (
            <div className="lvst-q lvst-q--reveal lvbt-q" key={`r${q.qi}`}>
              <span className="lvst-hint">{BATTLE_3D.right}</span>
              <div className="lvst-answer">
                <TapLetter k={result.key} big />
                <span>{q.options[result.key]}</span>
              </div>
            </div>
          ) : (
            <div className="lvst-q lvbt-q" key={`q${q.qi}`}>
              <span className="lvst-hint" data-beat={beat ? '' : undefined}>
                {beat === 'all' ? BATTLE.allIn : beat === 'time' ? BATTLE.timeUp : phase === 'countdown' ? BATTLE_3D.ready : BATTLE_3D.hint}
              </span>
              <h1 className="lvst-q-text" data-long={q.text.length > 70 ? '' : undefined}>
                {q.text}
              </h1>
            </div>
          )}
        </section>
        {hits ? (
          <ol className="lvmx-hits" key={`h${q.qi}-${reveal.strike ? 'top' : 'run'}`} aria-label={reveal.strike ? BATTLE.strikeLabel : undefined}>
            {reveal.chips.map((c) => (
              <li key={c.key}>
                <span className="lvmx-hit-name">{c.name}</span>
                <b>−{nb(c.dmg)}</b>
              </li>
            ))}
          </ol>
        ) : (
          <ol className="lvst-options lvbt-options" key={`o${q.qi}`} data-revealed={result ? '' : undefined} data-wide={wide ? '' : undefined}>
            {q.options.map((text, i) => {
              const pic = pics.options[i];
              return (
                <li key={i} data-key={result && result.key === i ? '' : undefined} data-dim={result && result.key !== i ? '' : undefined}>
                  <TapLetter k={i} />
                  <OptionPic pic={pic} />
                  <span className="lvst-opt-text">{text}</span>
                  {result ? <b className="lvst-opt-count">{nb(result.counts[i] ?? 0)}</b> : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {result ? (
        <div className="lvst-result lvmx-result" key={`res${q.qi}`}>
          <div className="lvst-stood">
            {result.right > 0 ? (
              <>
                {BATTLE_3D.rightOf(result.right, Math.max(players, result.right)).before}
                <b>{BATTLE_3D.rightOf(result.right, Math.max(players, result.right)).n}</b>
                {BATTLE_3D.rightOf(result.right, Math.max(players, result.right)).after}
              </>
            ) : (
              BATTLE_3D.nobody
            )}
          </div>
          {fastest ? <div className="lvst-fastest">{BATTLE_3D.fastest(fastest.name, fastest.dmg)}</div> : null}
        </div>
      ) : null}

      <div className="lvst-side lvmx-side">
        {phase === 'countdown' || phase === 'open' ? <TapTimer opensAt={opensAt} closesAt={closesAt} stoppedAt={stoppedAt} /> : null}
        <div className="lvst-pills">
          {phase === 'open' ? (
            <span className="lvst-pill lvbt-answered">
              <i className="lvst-dot" />
              {BATTLE_3D.answered(Math.min(s.answered, players), players).before}
              <b>{nb(Math.min(s.answered, players))}</b>
              {BATTLE_3D.answered(Math.min(s.answered, players), players).after}
            </span>
          ) : (
            <span className="lvst-pill">
              <i className="lvst-dot" />
              {MIXED.playing} <b>{nb(s.players)}</b>
            </span>
          )}
          {frozen > 0 ? (
            <span className="lvst-pill">
              <i className="lvst-dot lvst-dot--ice" />
              {MIXED.frozen} <b>{nb(frozen)}</b>
            </span>
          ) : null}
        </div>
      </div>

      {(big || phase === 'countdown') && typeof stem === 'string' ? (
        <BigPicture src={stem} onClose={() => setBig(false)} />
      ) : null}
      {banner ? (
        <div key={banner.id} className={`lvh-banner${banner.stay ? ' lvh-banner--stay' : ''}`} role="status">
          {banner.title}
          {banner.sub ? <small>{banner.sub}</small> : null}
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────── the screen ───────────────────────────────────────────

export default function BattleHost({ syncRef, ...props }: BattleHostProps) {
  const { gameId, api, game, state: s, info, joinUrl, onAgain } = props;
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
  const rs = view?.state ?? null;
  const on = arenaOn(s, rs);
  const bossKind: BossKind = s.settings.boss ?? s.boss.kind ?? 'clock';
  const plan = mixedOf(s);

  // The room saw a movement round's phase change before this screen's poll: read the database's state now.
  const { refresh } = game;
  useEffect(() => {
    if (rs && rs.round === 'stand' && rs.qi === s.qi && rs.phase !== s.state && (rs.phase === 'reveal' || rs.phase === 'open')) refresh();
  }, [rs?.phase, rs?.qi, s.state, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── sound ──
  const sound = useMemo(() => hostSound(), []);
  const muted = useSyncExternalStore(sound.subscribe, sound.isMuted, sound.isMuted);
  const soundSwitch = useMemo(() => ({ muted, onToggle: () => sound.setMuted(!sound.isMuted()) }), [muted, sound]);
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    return () => {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      sound.music(null);
      sound.roll(false);
    };
  }, [sound]);

  // ── what the scene writes into a movement round's board, only on change ──
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
        else if (c === 'warn') {
          sound.hurry(true);
          sound.roll(true);
        } else if (c === 'stomp') {
          sound.roll(false);
          sound.stomp();
        } else if (c === 'impact') {
          sound.collapse();
          sound.hit();
        } else if (c === 'rise') sound.rise();
        else if (c === 'cheer') sound.cheer();
        else if (c === 'back') sound.restore();
        else if (c === 'freeze') sound.freeze();
        else if (c === 'thaw') sound.shatter();
      },
    }),
    [sound],
  );

  // ── the 3D arena: the whole game ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<StandScene | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const margins = useMemo(() => ({ top: ARENA_TOP / STAGE_H, bottom: 0.012 }), []);
  // knobs for a slow machine (a recording on a CPU-only browser): ?q=0…5 pins the quality, ?aa=0, ?px=0.6
  const viewKnobs = useMemo(() => {
    const p = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const q = p.get('q');
    const px = Number(p.get('px'));
    return { quality: q !== null && /^[0-5]$/.test(q) ? Number(q) : ('auto' as const), antialias: p.get('aa') !== '0', maxPixelRatio: px > 0.2 && px <= 2 ? px : undefined, preserveDrawingBuffer: p.get('pdb') === '1' };
  }, []);
  const onRef = useRef(on);
  onRef.current = on;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!room || !canvas) return undefined;
    const scene = new StandScene(canvas, room, hud, bossKind, { margins, view: viewKnobs, mixed: true, world: STAND_WORLD });
    sceneRef.current = scene;
    scene.setFormation(!onRef.current);
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
    sceneRef.current?.setFormation(!on);
  }, [on, ready]);
  const rows = useMemo(() => battleRows(s.roster), [s.roster]);
  useEffect(() => {
    sceneRef.current?.setRoster(rows);
  }, [rows, ready, room]);
  // a hero changed in the lobby reaches the projector through the database's roster (the room keeps the first look)
  const looks = useMemo(() => new Map<string, unknown>(s.roster.map((r) => [r.player_id, r.look])), [s.roster]);
  useEffect(() => {
    sceneRef.current?.setLooks(looks);
  }, [looks, room, ready]);

  // ── a movement round's reveal (the room's) ──
  const nameOfEntity = useCallback((id: number) => room?.client.roster.get(id)?.[3] ?? '', [room]);
  const serverNow = useCallback(() => room?.client.serverNow() ?? null, [room]);
  const mixedReveal = useMixedReveal(rs, sceneRef, sound, nameOfEntity, serverNow);

  // ── a button question ──
  const q = s.question;
  const tapRound = !!q && !isStandRound(s) && (s.state === 'countdown' || s.state === 'open' || s.state === 'reveal');
  // the question's pictures, a button question's and a movement round's
  const shownQuestion = !!q && (s.state === 'countdown' || s.state === 'open' || s.state === 'reveal');
  const pics = useLivePictures(shownQuestion ? q?.pictures : undefined, game.picture);
  const { offset } = game;
  // this device's time of the question's open and close, fixed per question (a later clock estimate does not jolt it)
  const [opensAt, closesAt] = useMemo(() => {
    if (!q) return [0, 0];
    const o = offset();
    return [Date.parse(q.opens_at) - o, Date.parse(q.closes_at) - o];
  }, [q?.opens_at, q?.closes_at, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  const [beat, setBeat] = useState<Beat>(null);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  useEffect(() => {
    setBeat(null);
    setStoppedAt(null);
  }, [s.qi]);
  const onBeat = useCallback((b: Beat) => {
    setBeat(b);
    if (b === 'all') setStoppedAt(Date.now());
  }, []);
  const tapReveal = useTapReveal(s, sceneRef, sound, closesAt, onBeat);
  const open = s.state === 'open' && tapRound;
  // the timer's 0: «Время вышло» until the reveal comes; the last five seconds tick, the music hurries, the boss rings
  useEffect(() => {
    if (!open || !closesAt) return undefined;
    const t = setTimeout(() => {
      setBeat((b) => {
        if (b === null) sound.slam();
        return b ?? 'time';
      });
      sceneRef.current?.bossPhase('idle');
    }, Math.max(0, closesAt - Date.now()));
    const ticks = [5, 4, 3, 2, 1]
      .map((k) => ({ k, ms: closesAt - k * 1000 - Date.now() }))
      .filter((x) => x.ms >= 0)
      .map((x) =>
        setTimeout(() => {
          sound.tick(x.k === 1);
          if (x.k === 5) sound.hurry(true);
          if (x.k === 3) sceneRef.current?.bossPhase('warn');
        }, x.ms),
      );
    return () => {
      clearTimeout(t);
      ticks.forEach(clearTimeout);
    };
  }, [open, closesAt, sound]);
  // the 3-2-1 before the answers: a beat on each number, a hit when they open
  const countdown = s.state === 'countdown' && tapRound;
  useEffect(() => {
    if (!countdown || !opensAt) return undefined;
    const beats = [3, 2, 1, 0]
      .map((k) => ({ k, ms: opensAt - k * 1000 - Date.now() }))
      .filter((x) => x.ms >= -150)
      .map((x) => setTimeout(() => sound.count(x.k), Math.max(0, x.ms)));
    return () => beats.forEach(clearTimeout);
  }, [countdown, opensAt, sound]);
  // an answer came in: its character hops
  const answeredRef = useRef<{ qi: number; ids: Set<string> }>({ qi: -1, ids: new Set() });
  useEffect(() => {
    const seen = answeredRef.current;
    if (seen.qi !== s.qi) answeredRef.current = { qi: s.qi, ids: new Set(s.answered_ids) };
    else if (open) {
      for (const id of s.answered_ids) {
        if (seen.ids.has(id)) continue;
        seen.ids.add(id);
        sceneRef.current?.hop(id);
      }
    }
  }, [s.answered_ids, s.qi, open]);
  // the ice at rest (not while a button question's reveal plays it): the database's
  const resting = !(s.state === 'reveal' && tapRound && tapReveal.qi === s.qi && !tapReveal.strike);
  const iced = useMemo(() => frozenPids(s.roster), [s.roster]);
  useEffect(() => {
    if (resting && !(s.state === 'reveal' && tapRound && tapReveal.qi !== s.qi)) sceneRef.current?.setIced(iced, true);
  }, [iced, resting, ready, s.state, s.qi, tapRound, tapReveal.qi]);

  // ── the music and the ends ──
  const inLobby = s.state === 'lobby';
  const track = inLobby ? 'lobby' : s.state === 'open' && beat === null ? 'question' : s.state === 'leaderboard' ? 'board' : null;
  const atPodium = s.state === 'podium';
  useEffect(() => {
    if (!atPodium) sound.music(track, s.state === 'ended' ? 1.5 : 0.6);
    if (s.state === 'leaderboard') sound.whoosh(0);
  }, [track, atPodium, s.state, sound]);
  useEffect(() => sound.roll(beat !== null && tapRound && s.state === 'open'), [beat, tapRound, s.state, sound]);
  const joinedRef = useRef(s.roster.length);
  useEffect(() => {
    if (inLobby && s.roster.length > joinedRef.current) sound.join();
    joinedRef.current = s.roster.length;
  }, [inLobby, s.roster.length, sound]);
  const closed = s.state === 'ended' && gameOutcome(s) === 'closed';
  const atEnd = (s.state === 'podium' || s.state === 'ended') && !closed;
  const outcome = atEnd ? gameOutcome(s) : null;
  const podium = useMemo(() => (atEnd ? podiumTop(s) : []), [atEnd, s]);
  const podiumKey = podium.map((r) => r.player_id).join(',');
  // the podium: the blocks land, the fanfare when the boss fell (the reveal already had one), a sting when it won
  const fanfared = useRef(false);
  if (s.state === 'reveal' && s.boss.defeated) fanfared.current = true;
  useEffect(() => {
    if (s.state !== 'podium') return undefined;
    sound.music(null, 0.3);
    const won = gameOutcome(s) === 'won';
    const places = Math.min(3, podiumTop(s).length);
    const timers = [3, 2, 1].filter((p) => p <= places).map((p, i) => setTimeout(() => sound.podium(p), PODIUM_HITS_MS[3 - places + i]));
    if (won && !fanfared.current) timers.push(setTimeout(() => sound.fanfare(), PODIUM_HITS_MS[2] + 250));
    if (!won) timers.push(setTimeout(() => sound.sting(), PODIUM_HITS_MS[2] + 250));
    if (won) timers.push(setTimeout(() => sound.music('podium'), PODIUM_HITS_MS[2] + 3300));
    fanfared.current = true;
    return () => timers.forEach(clearTimeout);
  }, [s.state, sound]); // eslint-disable-line react-hooks/exhaustive-deps
  // the end in 3D: the three best cheer for good; the class too when the boss fell, else the boss roars
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!atEnd) {
      if (s.state === 'lobby' || s.state === 'countdown') {
        scene.calm();
        scene.bossPhase('idle');
      }
      return;
    }
    scene.calm();
    if (outcome === 'won') {
      scene.cheer('all', Infinity);
      scene.bossPhase('stunned');
    } else {
      scene.cheer(podium.map((r) => r.player_id), Infinity);
      scene.bossPhase('roar');
    }
  }, [atEnd, outcome, podiumKey, ready, s.state]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the teacher's tools ──
  const [sheet, setSheet] = useState<'players' | 'review' | 'end' | null>(null);
  const [kickRow, setKickRow] = useState<RosterRow | null>(null);
  const [acting, setActing] = useState(false);
  const [full, setFull] = useState(false);
  const [log, setLog] = useState(() => readLog(gameId));
  const [tgChat, setTgChat] = useState<string | null>(null);
  const onPosted = useCallback((chat: Chat) => setTgChat(chat.title ?? ''), []);
  useLayoutEffect(() => setLog((l) => logState(gameId, l, s)), [gameId, s]);
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);
  useEffect(() => {
    const onFull = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFull);
    return () => document.removeEventListener('fullscreenchange', onFull);
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

  const lost = !!view && view.status !== 'open' && view.status !== 'closed' && !!view.welcome;
  const showFps = useMemo(() => fpsWanted(), []);
  const backdrop = (
    <div className="lvmx-backdrop" data-on="" aria-hidden="true">
      <canvas ref={canvasRef} className="lvst-canvas" />
      {showFps ? <FpsReadout quality={() => sceneRef.current?.stats()?.quality ?? null} /> : null}
    </div>
  );

  // Without WebGL: the battle's flat screen (a movement round shows its board over it, as a mixed game's always did).
  if (failed) {
    const board = on ? (
      <MixedBoard s={s} rs={rs} reveal={mixedReveal} nameOf={nameOfEntity} timerRef={timerRef} countRefs={countRefs} frozenRef={frozenRef} frozenPillRef={frozenPillRef} loading={false} failed lost={false} />
    ) : null;
    return <HostScreen {...props} mixed={plan ? { backdrop, board, onKick: (pid) => room?.kick(pid) } : null} />;
  }

  const inBattle = s.state === 'countdown' || s.state === 'open' || s.state === 'reveal' || s.state === 'leaderboard';
  const lastQuestion = s.boss.defeated || s.qi >= s.q_count - 1;
  const nextSpec =
    s.state === 'lobby'
      ? { label: NEXT.lobby, disabled: game.busy || s.players === 0, onClick: next }
      : s.state === 'reveal'
        ? { label: lastQuestion ? NEXT.revealLast : NEXT.reveal, disabled: game.busy, onClick: next }
        : s.state === 'leaderboard'
          ? { label: NEXT.leaderboard, disabled: game.busy, onClick: next }
          : null;
  const soon = plan && !on && (s.state === 'reveal' || s.state === 'leaderboard') && !s.boss.defeated && s.qi < s.q_count - 1 ? untilStandRound(plan, s.qi + 1) : null;
  const site = shortLink(joinUrl.replace(/\?.*$/, ''));
  const top = dbTop(s);
  const asked = questionsClosed(s);
  const accuracy = outcome ? classAccuracy(s, outcome) : null;

  return (
    <Stage fit={fit} label={MODE.name} backdrop={backdrop} arena>
      <TopBar
        note={soon === null ? null : MIXED.soon(soon)}
        title={info?.title ?? null}
        question={inBattle && s.qi >= 0 ? { i: s.qi + 1, n: s.q_count } : null}
        final={atEnd}
        pin={inBattle ? s.pin : null}
        players={inBattle || inLobby ? s.players : null}
        offline={game.offline}
        full={full}
        next={nextSpec}
        onPlayers={s.state === 'ended' ? null : () => setSheet('players')}
        onFull={toggleFull}
        onEnd={s.state === 'ended' ? null : () => setSheet('end')}
        sound={closed ? null : soundSwitch}
      />

      {inLobby ? (
        <div className="lvmx lvbt" data-phase="lobby">
          <div className="lvst-head lvmx-head" style={{ width: Math.min(1100, width - 660), top: 96 }}>
            <section className="lvst-board" aria-live="polite">
              <div className="lvst-join">
                <div className="lvst-join-qr">
                  <Qr text={joinUrl} />
                </div>
                <div className="lvst-join-text">
                  <span>
                    {LOBBY.go} <b>{site}</b>
                  </span>
                  <strong aria-label={`PIN ${s.pin.split('').join(' ')}`}>{STAND.pin(s.pin)}</strong>
                  <span>{LOBBY.camera}</span>
                </div>
              </div>
            </section>
          </div>
          <div className="lvbt-lobby-foot">
            <span className="lvst-settings">{LOBBY.settings(s.time_s, s.speed, s.settings.who === 'members', plan?.rounds)}</span>
            {info?.containerId ? <TelegramPost api={api} gameId={gameId} containerId={info.containerId} fake={api.kind === 'fake'} onPosted={onPosted} /> : null}
            {tgChat !== null ? <span className="lvst-settings">{LOBBY.tg(tgChat)}</span> : null}
          </div>
        </div>
      ) : null}

      {on ? (
        <MixedBoard
          s={s}
          rs={rs}
          pics={pics}
          reveal={mixedReveal}
          nameOf={nameOfEntity}
          timerRef={timerRef}
          countRefs={countRefs}
          frozenRef={frozenRef}
          frozenPillRef={frozenPillRef}
          loading={!ready && !failed}
          failed={failed}
          lost={lost || (!view?.welcome && ready)}
        />
      ) : tapRound && q ? (
        <TapBoard s={s} q={q} pics={pics} reveal={tapReveal} beat={beat} opensAt={opensAt} closesAt={closesAt} stoppedAt={stoppedAt} />
      ) : null}

      {s.state === 'leaderboard' && top ? (
        <div className="lvst-veil lvbt-veil">
          <div className="lvbt-veil-head">
            <span className="lvst-hint">{STAND.topAfter(s.qi + 1, s.q_count)}</span>
            <h1>{BOARD.title}</h1>
          </div>
          <TopList rows={top} nameOf={(r) => r.name} />
        </div>
      ) : null}

      {atEnd ? (
        <div className="lvst-veil lvbt-veil">
          <div className="lvbt-veil-head">
            {accuracy !== null ? (
              <span className="lvst-hint">
                {outcome === 'stopped' ? PODIUM.statsStopped(asked, s.q_count, s.roster.length, accuracy) : PODIUM.stats(asked, s.roster.length, accuracy)}
              </span>
            ) : null}
            <h1>{outcome === 'won' ? PODIUM.won : outcome === 'lost' ? PODIUM.lost : PODIUM.ended}</h1>
          </div>
          {podium.length ? <PodiumBlocks rows={podium.map((r) => ({ id: null, name: r.name, look: r.look, pts: r.dmg, move: 0 }))} /> : null}
          {s.state === 'ended' ? <p className="lvbt-finished">{PODIUM.finished}</p> : null}
        </div>
      ) : null}
      {atEnd ? (
        <div className="lvst-foot lvbt-foot">
          <span />
          <div className="lvst-actions">
            <button type="button" className="lvh-btn lvh-btn--white" onClick={() => setSheet('review')}>
              {PODIUM.review}
            </button>
            {onAgain ? (
              <button type="button" className="lvh-btn lvh-btn--white" onClick={onAgain}>
                {PODIUM.again}
              </button>
            ) : null}
            {s.state === 'podium' ? (
              <button type="button" className="lvh-btn lvst-go" onClick={next} disabled={game.busy}>
                {PODIUM.finish}
                <kbd className="lvh-kbd">{NEXT.key}</kbd>
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {closed ? (
        <div className="lvst-veil lvbt-veil">
          <div className="lvh-msg lvh-closed" role="status">
            <h1>{CLOSED.title}</h1>
            <p>{CLOSED.why}</p>
            <div className="lvh-msg-actions">
              <Link className="lvh-btn" to={info?.containerId ? `/exams/c/${info.containerId}` : '/exams'}>
                {CLOSED.back}
              </Link>
              {onAgain ? (
                <button type="button" className="lvh-btn lvh-btn--white" onClick={onAgain}>
                  {CLOSED.again}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {!ready && !failed && !on ? <div className="lvmx-note">{MIXED.loading}</div> : lost && !on ? <div className="lvmx-note lvmx-note--warn">{MIXED.lost}</div> : null}
      {sheet === 'players' ? <PlayersSheet roster={s.roster} onKick={pickKick} onClose={() => setSheet(null)} /> : null}
      {sheet === 'review' ? <ReviewSheet log={log} roster={s.roster} asked={s.qi + 1} onClose={() => setSheet(null)} /> : null}
      {sheet === 'end' ? <EndConfirm onYes={() => void doEnd()} onNo={() => setSheet(null)} busy={acting} /> : null}
      {kickRow ? <KickConfirm row={kickRow} onYes={() => void doKick()} onNo={() => setKickRow(null)} busy={acting} /> : null}
    </Stage>
  );
}
