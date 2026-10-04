import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { ReelClock } from '../reel/clock';
import { ClockProvider, SceneProvider, opacity, put, useFrame } from '../reel/engine';
import { STAGE_H, STAGE_W } from '../reel/timeline';
import { Wordmark } from '../film/kit';
import { usePageVisible } from '../landing/usePageVisible';
import { usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import { LOGIN_SCENES } from './LoginScenes';
import { REGISTER_SCENES } from './RegisterScenes';
import { SCRIPTS, cornerOpacity, sceneVisible, scenesAt, type AuthReelVariant, type AuthScript } from './script';
import '../reel/reel.css';
import './authReel.css';

const VIEWS: Record<AuthReelVariant, Record<string, ComponentType>> = { login: LOGIN_SCENES, register: REGISTER_SCENES };

declare global {
  interface Window {
    /** Set by the frame exporter before the page loads: no autoplay, and `__meldyAuthReel` to step frames. */
    __MELDY_AUTH_REEL_EXPORT__?: boolean;
    __meldyAuthReel?: { total: number; seek: (t: number) => Promise<void> };
  }
}

const exportRequested = () => typeof window !== 'undefined' && window.__MELDY_AUTH_REEL_EXPORT__ === true;

/** The panel shows the reel from this width; narrower, the panel is a one-line banner without it. */
const DESKTOP = '(min-width: 1024px)';

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : true));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const change = () => setMatch(list.matches);
    change();
    list.addEventListener?.('change', change);
    return () => list.removeEventListener?.('change', change);
  }, [query]);
  return match;
}

/** The only label on the frame: a small «Meldy» in the corner (it steps aside for the big wordmark). */
function Corner({ script }: { script: AuthScript }) {
  const root = useRef<HTMLSpanElement>(null);
  useFrame((_, t) => opacity(root.current, cornerOpacity(script, t)));
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

function Stage({ clock, scale, variant }: { clock: ReelClock; scale: number; variant: AuthReelVariant }) {
  const script = SCRIPTS[variant];
  const views = VIEWS[variant];
  const [scenes, setScenes] = useState<string[]>(() => scenesAt(script, clock.time));
  const current = useRef(scenes);
  useLayoutEffect(
    () =>
      clock.addFrame((t) => {
        const next = scenesAt(script, t);
        if (same(current.current, next)) return;
        current.current = next;
        setScenes(next);
      }),
    [clock, script],
  );
  return (
    <ClockProvider value={clock}>
      <div className="mr-stage ar-stage" style={{ transform: `scale(${scale})` }} aria-hidden="true">
        {scenes.map((id) => {
          const scene = script.scenes.find((item) => item.id === id)!;
          const View = views[id];
          return (
            <SceneProvider key={id} value={scene}>
              <Gate from={scene.from} to={scene.to}>
                <View />
              </Gate>
            </SceneProvider>
          );
        })}
        <Corner script={script} />
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
 * The reel in the sign-in panel: a 16:9 frame as wide as the panel allows and as tall as the room
 * under the heading allows, centred. It plays silently in a loop while the tab is visible and can be
 * paused; with reduced motion it waits on a still frame until asked to play. Not rendered where the
 * panel is a banner (below 1024 px).
 */
export default function AuthReel({ variant }: { variant: AuthReelVariant }) {
  const script = SCRIPTS[variant];
  const captionId = useId();
  const box = useRef<HTMLDivElement>(null);
  const clock = useMemo(() => new ReelClock(script.total), [script.total]);
  const desktop = useMedia(DESKTOP);
  const reduce = usePrefersReducedMotion();
  const tabVisible = usePageVisible();
  const [width, setWidth] = useState(0);
  const [paused, setPaused] = useState(false);
  const [asked, setAsked] = useState(false);
  const exporting = useMemo(exportRequested, []);

  const allowed = !reduce || asked;
  const playing = desktop && allowed && tabVisible && !paused && width > 0 && !exporting;

  useEffect(() => () => clock.dispose(), [clock]);

  // The frame takes the room the panel has left under its heading (the box fills it and holds the
  // frame out of the flow, so the frame never makes the panel taller): as wide as the panel, as tall
  // as the room, in 16:9. What is left over is split above and below, so the heading and the frame
  // stay together in the middle of the panel.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !desktop) return undefined;
    const panel = el.closest<HTMLElement>('.au-panel');
    const measure = () => {
      const roomW = el.clientWidth;
      const roomH = el.clientHeight;
      const next = Math.max(0, Math.floor(Math.min(roomW, (roomH * STAGE_W) / STAGE_H)));
      setWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
      const frameH = Math.round((next * STAGE_H) / STAGE_W);
      panel?.style.setProperty('--ar-lift', `${Math.max(0, Math.floor((roomH - frameH) / 2))}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (observer) observer.observe(el);
    else window.addEventListener('resize', measure);
    return () => {
      if (observer) observer.disconnect();
      else window.removeEventListener('resize', measure);
      panel?.style.removeProperty('--ar-lift');
    };
  }, [desktop]);

  useEffect(() => {
    if (reduce && !asked) clock.seek(script.poster);
  }, [reduce, asked, clock, script.poster]);

  useEffect(() => {
    if (playing) clock.play();
    else clock.pause();
  }, [playing, clock]);

  // The frame exporter steps the clock itself.
  useEffect(() => {
    if (!exporting) return undefined;
    window.__meldyAuthReel = {
      total: script.total,
      seek: (t: number) =>
        new Promise<void>((resolve) => {
          clock.seek(t);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    };
    return () => {
      delete window.__meldyAuthReel;
    };
  }, [exporting, clock, script.total]);

  if (!desktop) return null;

  const toggle = () => {
    if (!allowed) {
      setAsked(true);
      setPaused(false);
      return;
    }
    setPaused((value) => !value);
  };

  return (
    <figure className="ar" aria-labelledby={captionId}>
      <figcaption id={captionId} className="sr-only">
        {script.caption}
      </figcaption>
      <ol className="sr-only">
        {script.transcript.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <div ref={box} className="ar-box">
        {width > 0 ? (
          <div className="ar-frame" style={{ width, height: Math.round((width * STAGE_H) / STAGE_W) }} data-playing={playing ? 'true' : 'false'}>
            <Stage clock={clock} scale={width / STAGE_W} variant={variant} />
            {allowed ? (
              <button type="button" className="ar-play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Смотреть'}>
                {playing ? <PauseIcon /> : <PlayIcon />}
              </button>
            ) : (
              <button type="button" className="ar-start" onClick={toggle}>
                Смотреть ролик
                <i>
                  <PlayIcon />
                </i>
              </button>
            )}
          </div>
        ) : null}
      </div>
    </figure>
  );
}
