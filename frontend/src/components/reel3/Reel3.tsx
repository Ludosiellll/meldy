import { startTransition, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { ReelClock } from '../reel/clock';
import { ClockProvider, SceneProvider, StageScaleProvider, opacity, put, useFrame } from '../reel/engine';
import { ease, plural, seg } from '../reel/timeline';
import { usePageVisible } from '../landing/usePageVisible';
import { usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import { SAY } from '../home3/copy3';
import { CHAPTERS3, OVERLAP, POSTER3, SCENES3, STAGE, TALL_BELOW, TOTAL3, activeScenes3, chapterAt3, scene3, type Layout, type SceneId3 } from './timeline3';
import type { CursorKey } from './pointer3';
import { BUILD_KEYS, BuildScene, LOOK_KEYS, LookScene, MEDIA_KEYS, MediaScene } from './scenes/Studio';
import { EndScene, END_CTA } from './scenes/End';
import { FILE_KEYS, FileScene, PLAN_KEYS, PlanScene, SESSION_KEYS, SessionScene } from './scenes/Exam';
import { GROUP_KEYS, GroupScene } from './scenes/Group';
import { GAME_KEYS, GameScene } from './scenes/Game';
import { preloadGameFrames } from '../home3/gameFrames';
import { STAND_RUN, canPlayFootage, loadFootage } from '../../lib/footage';
import { LectureScene } from './scenes/Lecture';
import { SEND_KEYS, SendScene, StatsScene, TAKE_KEYS, TakeScene } from './scenes/Share';
import { TicketScene } from './scenes/Oral';
import { LEARN_KEYS, LearnScene } from './scenes/Learn';
import './reel3.css';

declare global {
  interface Window {
    /** Set by the frame exporter before the page loads: no autoplay, and `__meldyReel` to step frames. */
    __MELDY_REEL_EXPORT__?: boolean;
    __meldyReel?: {
      total: number;
      seek: (t: number) => Promise<void>;
      /** The clock moved at once, without waiting for a paint (a scene already on the stage stays). */
      seekNow: (t: number) => void;
      scenes: typeof SCENES3;
      pointers: typeof POINTER_KEYS3;
    };
  }
}

const VIEWS: Record<SceneId3, ComponentType> = {
  lecture: LectureScene,
  file: FileScene,
  plan: PlanScene,
  session: SessionScene,
  ticket: TicketScene,
  learn: LearnScene,
  group: GroupScene,
  game: GameScene,
  build: BuildScene,
  media: MediaScene,
  look: LookScene,
  send: SendScene,
  take: TakeScene,
  stats: StatsScene,
  end: EndScene,
};

/** The pointer's keys of every scene that has one (scene ms): what it presses, drags and where it rests. */
export const POINTER_KEYS3: Partial<Record<SceneId3, readonly CursorKey[]>> = {
  file: FILE_KEYS,
  plan: PLAN_KEYS,
  session: SESSION_KEYS,
  learn: LEARN_KEYS,
  group: GROUP_KEYS,
  game: GAME_KEYS,
  build: BUILD_KEYS,
  media: MEDIA_KEYS,
  look: LOOK_KEYS,
  send: SEND_KEYS,
  take: TAKE_KEYS,
};

const SECONDS = Math.round(TOTAL3 / 1000);
/** The figure's caption: what it is, how long, that it has no sound. */
export const CAPTION = `Ролик о Meldy, ${SECONDS} ${plural(SECONDS, ['секунда', 'секунды', 'секунд'])}, без звука.`;

/** Every sentence of the reel, in order: read to screen readers (the stage itself is hidden from them). */
export const TRANSCRIPT3: readonly string[] = Object.values(SAY).flatMap((lines) => lines.map((line) => `${line}.`));

/** A scene on the stage: hidden before its first moment; it slides in and out over OVERLAP (transform and opacity). */
/** How long a scene takes to leave, from the start of the overlap with the next (ms). */
const LEAVE = 220;
/** The next scene shows this long after its window opens, once the one before has left. */
const ENTER_AFTER = 200;

function Gate({ id, children }: { id: SceneId3; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const win = scene3(id);
  useFrame((_, t) => {
    if (t < win.from) {
      opacity(root.current, 0);
      return;
    }
    // A hand-off, not a dissolve: the scene before is gone (LEAVE ms into the overlap) before this one shows, so two
    // layouts never stand in each other at half opacity.
    const shown = win.from === 0 ? 0 : win.from + ENTER_AFTER;
    const enter = ease.brand(seg(t, shown, 640));
    const leave = ease.in(seg(t, win.to - OVERLAP, LEAVE));
    opacity(root.current, Math.min(seg(t, shown, 300), 1 - leave));
    put(root.current, 'transform', `translate3d(${Math.round(64 * (1 - enter) - 40 * leave)}px,0,0)`);
  });
  return (
    <div ref={root} className="r3-gate" data-scene={id} style={{ opacity: 0 }}>
      {children}
    </div>
  );
}

const same = (a: SceneId3[], b: SceneId3[]) => a.length === b.length && a.every((id, index) => id === b[index]);

function Stage({ clock, layout, scale }: { clock: ReelClock; layout: Layout; scale: number }) {
  const [scenes, setScenes] = useState<SceneId3[]>(() => activeScenes3(clock.time));
  const current = useRef(scenes);
  useLayoutEffect(
    () =>
      clock.addFrame((t) => {
        const next = activeScenes3(t);
        if (same(current.current, next)) return;
        current.current = next;
        // A scene is put on the stage ahead of time (PREMOUNT3), hidden: its render is a transition React splits into
        // short pieces, so building it never takes a frame of the scene on show (phone ×4: 35 ms in one task). Frames
        // for the video are exported one by one and wait for the scene.
        if (window.__MELDY_REEL_EXPORT__ === true) setScenes(next);
        else startTransition(() => setScenes(next));
      }),
    [clock],
  );
  // The game's frames and its footage are fetched a chapter ahead (the group), so its projector is ready when it comes.
  const soon = scenes.includes('group') || scenes.includes('game');
  useEffect(() => {
    if (!soon) return;
    preloadGameFrames();
    if (canPlayFootage(STAND_RUN)) loadFootage(STAND_RUN).catch(() => undefined);
  }, [soon]);
  const size = STAGE[layout];
  return (
    <ClockProvider value={clock}>
      <StageScaleProvider value={scale}>
      <div className="r3-stage" data-layout={layout} style={{ width: size.w, height: size.h, transform: `scale(${scale})` }} aria-hidden="true">
        {scenes.map((id) => {
          const View = VIEWS[id];
          return (
            <SceneProvider key={id} value={scene3(id)}>
              <Gate id={id}>
                <View />
              </Gate>
            </SceneProvider>
          );
        })}
      </div>
      </StageScaleProvider>
    </ClockProvider>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 4.2v11.6c0 .6.7 1 1.2.7l9.2-5.8a.8.8 0 0 0 0-1.4L7.2 3.5c-.5-.3-1.2.1-1.2.7Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="5" y="4" width="3.6" height="12" rx="1.2" fill="currentColor" />
      <rect x="11.4" y="4" width="3.6" height="12" rx="1.2" fill="currentColor" />
    </svg>
  );
}

const exportRequested = () => typeof window !== 'undefined' && window.__MELDY_REEL_EXPORT__ === true;

/** A phone-wide window (the page's own breakpoint): the tall stage. */
function useNarrow(): boolean {
  const query = `(max-width: ${TALL_BELOW - 1}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const change = () => setNarrow(list.matches);
    change();
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, [query]);
  return narrow;
}

/** The page is loaded (its largest paint is behind it): only then the reel starts to move. */
function usePageLoaded(): boolean {
  const [loaded, setLoaded] = useState(() => typeof document === 'undefined' || document.readyState === 'complete');
  useEffect(() => {
    if (loaded) return undefined;
    const done = () => window.setTimeout(() => setLoaded(true), 250);
    window.addEventListener('load', done, { once: true });
    return () => window.removeEventListener('load', done);
  }, [loaded]);
  return loaded;
}

/**
 * The reel on the page: plays silently while at least half of it is on screen, the tab is visible and the page has
 * loaded; loops; pause and chapters under it. Under reduced motion it waits on its poster until asked.
 */
export default function Reel3({ onCta, layoutOverride }: { onCta?: () => void; layoutOverride?: Layout }) {
  const captionId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const clock = useMemo(() => new ReelClock(TOTAL3), []);
  const reduce = usePrefersReducedMotion();
  const tabVisible = usePageVisible();
  const loaded = usePageLoaded();
  const exporting = useMemo(exportRequested, []);
  const [width, setWidth] = useState(0);
  const [inView, setInView] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [asked, setAsked] = useState(false);
  const [chapter, setChapter] = useState(0);
  const [ctaOn, setCtaOn] = useState(false);
  const started = useRef(false);
  const shown = useRef({ chapter: 0, cta: false });

  const narrow = useNarrow();
  const layout: Layout = layoutOverride ?? (narrow ? 'tall' : 'wide');
  const scale = width > 0 ? width / STAGE[layout].w : 0;
  const allowed = !reduce || asked;
  const playing = allowed && inView && tabVisible && loaded && !userPaused && !exporting;

  useEffect(() => () => clock.dispose(), [clock]);

  // The frame's width, measured when it changes (never in the frame loop).
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = frame.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        setInView(entry.isIntersecting && entry.intersectionRatio >= 0.5);
      },
      { threshold: [0, 0.5, 0.75] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Before the first play the poster: the studio with its blocks.
  useEffect(() => {
    if (!started.current && !exporting) clock.seek(POSTER3);
  }, [clock, exporting]);

  useEffect(() => {
    if (!playing) {
      clock.pause();
      return;
    }
    if (!started.current) {
      started.current = true;
      clock.seek(0);
    }
    clock.play();
  }, [playing, clock]);

  useEffect(
    () =>
      clock.addFrame((t) => {
        const fills = bar.current?.querySelectorAll<HTMLElement>('[data-fill]') ?? [];
        fills.forEach((fill, index) => {
          const span = CHAPTERS3[index];
          const p = Math.min(1, Math.max(0, (t - span.from) / (span.to - span.from)));
          put(fill, 'transform', `scaleX(${p.toFixed(4)})`);
        });
        const next = chapterAt3(t);
        if (next !== shown.current.chapter) {
          shown.current.chapter = next;
          setChapter(next);
        }
        const cta = t >= scene3('end').from + END_CTA.at;
        if (cta !== shown.current.cta) {
          shown.current.cta = cta;
          setCtaOn(cta);
        }
      }),
    [clock],
  );

  useEffect(() => {
    if (!exporting) return undefined;
    window.__meldyReel = {
      total: TOTAL3,
      seek: (t: number) =>
        new Promise<void>((resolve) => {
          clock.seek(t);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
      seekNow: (t: number) => clock.seek(t),
      scenes: SCENES3,
      pointers: POINTER_KEYS3,
    };
    return () => {
      delete window.__meldyReel;
    };
  }, [exporting, clock]);

  const toggle = useCallback(() => {
    if (!allowed) {
      setAsked(true);
      setUserPaused(false);
      return;
    }
    setUserPaused((paused) => !paused);
  }, [allowed]);

  const jump = useCallback(
    (index: number) => {
      started.current = true;
      clock.seek(CHAPTERS3[index].from + (index === 0 ? 0 : 450));
      setAsked(true);
      setUserPaused(false);
    },
    [clock],
  );

  const cta = END_CTA[layout];
  const size = STAGE[layout];
  const ctaStyle: CSSProperties = {
    left: `${(cta.x / size.w) * 100}%`,
    top: `${(cta.y / size.h) * 100}%`,
    width: `${(cta.w / size.w) * 100}%`,
    height: `${(cta.h / size.h) * 100}%`,
  };

  return (
    <figure className="r3" aria-labelledby={captionId}>
      <figcaption id={captionId} className="r3-sr">
        {CAPTION}
      </figcaption>
      <ol className="r3-sr">
        {TRANSCRIPT3.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <div ref={frame} className="r3-frame" data-layout={layout}>
        {scale > 0 ? <Stage clock={clock} layout={layout} scale={scale} /> : null}
        {onCta && ctaOn ? <button type="button" className="r3-cta-hit" style={ctaStyle} onClick={onCta} tabIndex={-1} aria-hidden="true" /> : null}
        {!allowed ? (
          <button type="button" className="r3-start" onClick={toggle}>
            Смотреть ролик
            <i>
              <PlayIcon />
            </i>
          </button>
        ) : null}
      </div>
      {exporting ? null : (
        <div className="r3-controls">
          <button type="button" className="r3-play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Смотреть'}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div ref={bar} className="r3-chapters">
            {CHAPTERS3.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className="r3-chapter"
                style={{ '--grow': item.to - item.from } as CSSProperties}
                onClick={() => jump(index)}
                aria-label={`Перейти: ${item.label}`}
                aria-current={index === chapter ? 'step' : undefined}
              >
                <span className="r3-chapter-t">{item.label}</span>
                <span className="r3-chapter-line">
                  <span data-fill className="r3-chapter-fill" style={{ transform: 'scaleX(0)' }} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {exporting ? null : (
        <p className="r3-now" aria-hidden="true">
          {CHAPTERS3[chapter].label}
        </p>
      )}
    </figure>
  );
}
