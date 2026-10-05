import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type RefObject } from 'react';
import { ReelClock } from '../reel/clock';
import { ClockProvider, SceneProvider } from '../reel/engine';
import { usePageVisible } from '../landing/usePageVisible';
import { usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import '../reel/reel.css';
import './tips.css';

/** Every tip's clip is played on a 16:10 stage of this size, scaled to the card. */
export const TIP_STAGE_W = 1280;
export const TIP_STAGE_H = 800;

export interface TipClipDef {
  /** Length of the loop (ms). */
  total: number;
  /** The still frame shown when motion is reduced. */
  poster: number;
  Scene: ComponentType;
}

declare global {
  interface Window {
    /** Set by a frame exporter before the page loads: no autoplay, and `__meldyTipClip` to step frames. */
    __MELDY_TIP_EXPORT__?: boolean;
    __meldyTipClip?: { total: number; seek: (t: number) => Promise<void> };
  }
}

const exportRequested = () => typeof window !== 'undefined' && window.__MELDY_TIP_EXPORT__ === true;

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

/** True while the box is in the window (always true where IntersectionObserver is missing). */
function useInView(box: RefObject<HTMLElement>): boolean {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setInView(entry.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [box]);
  return inView;
}

/**
 * A tip's clip, as the guide plays its chapters (components/guide/GuideClip): the 16:10 stage scaled to
 * the width it is given, looping silently while the tip is shown, the tab is visible and the clip is in
 * the window. It can be paused; with reduced motion it waits on a still frame until asked to play.
 * The stage is decoration (aria-hidden): the tip's title and text say the same in words.
 */
export default function TipClip({ clip, active }: { clip: TipClipDef; active: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const clock = useMemo(() => new ReelClock(clip.total), [clip]);
  const reduce = usePrefersReducedMotion();
  const tabVisible = usePageVisible();
  const inView = useInView(box);
  const [width, setWidth] = useState(0);
  const [paused, setPaused] = useState(false);
  const [asked, setAsked] = useState(false);
  const exporting = useMemo(exportRequested, []);

  const allowed = !reduce || asked;
  const playing = active && allowed && tabVisible && inView && !paused && width > 0 && !exporting;

  useEffect(() => () => clock.dispose(), [clock]);

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

  useEffect(() => {
    if (reduce && !asked) clock.seek(clip.poster);
  }, [reduce, asked, clock, clip.poster]);

  useEffect(() => {
    if (playing) clock.play();
    else clock.pause();
  }, [playing, clock]);

  useEffect(() => {
    if (!exporting) return undefined;
    window.__meldyTipClip = {
      total: clip.total,
      seek: (t: number) =>
        new Promise<void>((resolve) => {
          clock.seek(t);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    };
    return () => {
      delete window.__meldyTipClip;
    };
  }, [exporting, clock, clip.total]);

  const Scene = clip.Scene;
  const toggle = () => {
    if (!allowed) {
      setAsked(true);
      setPaused(false);
      return;
    }
    setPaused((value) => !value);
  };

  return (
    <div ref={box} className="tp-box" data-playing={playing ? 'true' : 'false'}>
      {width > 0 ? (
        <ClockProvider value={clock}>
          <div className="mr-stage tp-stage" style={{ transform: `scale(${width / TIP_STAGE_W})` }} aria-hidden="true">
            <SceneProvider value={{ from: 0, to: clip.total }}>
              <Scene />
            </SceneProvider>
          </div>
        </ClockProvider>
      ) : null}
      {allowed ? (
        <button type="button" className="tp-play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Смотреть'}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      ) : (
        <button type="button" className="tp-start" onClick={toggle}>
          Смотреть
          <i>
            <PlayIcon />
          </i>
        </button>
      )}
    </div>
  );
}
