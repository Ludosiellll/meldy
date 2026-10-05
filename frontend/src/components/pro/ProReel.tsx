import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReelClock } from '../reel/clock';
import { ClockProvider, SceneProvider, opacity, put, useFrame } from '../reel/engine';
import { STAGE_W } from '../reel/timeline';
import { Wordmark } from '../film/kit';
import { usePageVisible } from '../landing/usePageVisible';
import { usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import { cornerOpacity, sceneVisible, scenesAt } from '../authReel/script';
import { PRO_REEL, sceneOf } from './reelScript';
import { PRO_SCENES } from './ReelScenes';
import '../reel/reel.css';
import './proReel.css';

declare global {
  interface Window {
    /** Set by the frame exporter before the page loads: no autoplay, and `__meldyProReel` to step frames. */
    __MELDY_PRO_REEL_EXPORT__?: boolean;
    __meldyProReel?: { total: number; seek: (t: number) => Promise<void> };
  }
}

const exportRequested = () => typeof window !== 'undefined' && window.__MELDY_PRO_REEL_EXPORT__ === true;

/** The only label on the frame: a small «Meldy» in the corner (it steps aside for the big wordmark). */
function Corner() {
  const root = useRef<HTMLSpanElement>(null);
  useFrame((_, t) => opacity(root.current, cornerOpacity(PRO_REEL, t)));
  return (
    <span ref={root} className="fm-corner" aria-hidden="true">
      <Wordmark />
    </span>
  );
}

/** A scene shows only inside its window: one premounted ahead (or for the loop) waits hidden. */
function Gate({ from, to, children }: { from: number; to: number; children: ReactNode }) {
  const gate = useRef<HTMLDivElement>(null);
  useFrame((_, t) => put(gate.current, 'visibility', sceneVisible({ id: '', from, to }, t) ? 'visible' : 'hidden'));
  return (
    <div ref={gate} className="mr-layer" style={{ visibility: 'hidden' }}>
      {children}
    </div>
  );
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

function Stage({ clock, scale }: { clock: ReelClock; scale: number }) {
  const [scenes, setScenes] = useState<string[]>(() => scenesAt(PRO_REEL, clock.time));
  const current = useRef(scenes);
  useLayoutEffect(
    () =>
      clock.addFrame((t) => {
        const next = scenesAt(PRO_REEL, t);
        if (same(current.current, next)) return;
        current.current = next;
        setScenes(next);
      }),
    [clock],
  );
  return (
    <ClockProvider value={clock}>
      <div className="mr-stage pr-stage" style={{ transform: `scale(${scale})` }} aria-hidden="true">
        {scenes.map((id) => {
          const scene = PRO_REEL.scenes.find((item) => item.id === id)!;
          const View = PRO_SCENES[id as keyof typeof PRO_SCENES];
          return (
            <SceneProvider key={id} value={scene}>
              <Gate from={scene.from} to={scene.to}>
                <View />
              </Gate>
            </SceneProvider>
          );
        })}
        <Corner />
      </div>
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

/**
 * «Что будет с PRO»: the reel at the top of the PRO window. A 16:9 stage scaled to the window's
 * width, looping silently while the window is open, the reel is on screen and the tab is visible; it
 * can be paused. With reduced motion it waits on a still frame (the PRO day) until asked to play.
 * The stage is hidden from screen readers; a caption and a transcript say what it shows. A new `jump`
 * (the window bumps it after «Купить PRO») takes it to the PRO beat: from its start while it plays,
 * to the still frame of the PRO day while it waits.
 */
export default function ProReel({ jump = 0 }: { jump?: number }) {
  const captionId = useId();
  const box = useRef<HTMLDivElement>(null);
  const clock = useMemo(() => new ReelClock(PRO_REEL.total), []);
  const reduce = usePrefersReducedMotion();
  const tabVisible = usePageVisible();
  const [width, setWidth] = useState(0);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined');
  const [paused, setPaused] = useState(false);
  const [asked, setAsked] = useState(false);
  const exporting = useMemo(exportRequested, []);

  const allowed = !reduce || asked;
  const playing = allowed && inView && tabVisible && !paused && width > 0 && !exporting;

  useEffect(() => () => clock.dispose(), [clock]);

  // The stage keeps its 1920 × 1080 composition and is scaled to the box's width.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => {
      const next = Math.floor(el.clientWidth);
      setWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (observer) observer.observe(el);
    else window.addEventListener('resize', measure);
    return () => {
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, []);

  // Scrolled out of the window's view (a short phone screen), the reel waits.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting && entry.intersectionRatio >= 0.35), {
      threshold: [0, 0.35, 0.6],
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reduce && !asked) clock.seek(PRO_REEL.poster);
  }, [reduce, asked, clock]);

  useEffect(() => {
    if (playing) clock.play();
    else clock.pause();
  }, [playing, clock]);

  const jumped = useRef(jump);
  useEffect(() => {
    if (jump === jumped.current) return;
    jumped.current = jump;
    clock.seek(playing ? sceneOf('pro').from : PRO_REEL.poster);
  }, [jump, playing, clock]);

  // The frame exporter steps the clock itself.
  useEffect(() => {
    if (!exporting) return undefined;
    window.__meldyProReel = {
      total: PRO_REEL.total,
      seek: (t: number) =>
        new Promise<void>((resolve) => {
          clock.seek(t);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    };
    return () => {
      delete window.__meldyProReel;
    };
  }, [exporting, clock]);

  const toggle = () => {
    if (!allowed) {
      setAsked(true);
      setPaused(false);
      return;
    }
    setPaused((value) => !value);
  };

  return (
    <figure className="pr" aria-labelledby={captionId}>
      <figcaption id={captionId} className="sr-only">
        {PRO_REEL.caption}
      </figcaption>
      <ol className="sr-only">
        {PRO_REEL.transcript.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <div ref={box} className="pr-box" data-playing={playing ? 'true' : 'false'}>
        {width > 0 ? <Stage clock={clock} scale={width / STAGE_W} /> : null}
        {allowed ? (
          <button type="button" className="pr-play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Смотреть'}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
        ) : (
          <button type="button" className="pr-start" onClick={toggle}>
            Смотреть ролик
            <i>
              <PlayIcon />
            </i>
          </button>
        )}
      </div>
    </figure>
  );
}
