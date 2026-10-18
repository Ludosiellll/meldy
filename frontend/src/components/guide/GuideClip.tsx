import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReelClock } from '../reel/clock';
import { ClockProvider, SceneProvider } from '../reel/engine';
import { usePageVisible } from '../landing/usePageVisible';
import { usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import { GUIDE_CLIPS, GUIDE_W, type OwnClipChapter } from './clips';
import type { GuideChapterId } from './chapters';
import StepClip from '../clips/StepClip';
import { STEP_CLIPS } from '../clips';
import type { StepClipId } from '../clips/types';
import '../reel/reel.css';
import './guide.css';

declare global {
  interface Window {
    /** Set by the frame exporter before the page loads: no autoplay, and `__meldyGuideClip` to step frames. */
    __MELDY_GUIDE_EXPORT__?: boolean;
    __meldyGuideClip?: { total: number; seek: (t: number) => Promise<void> };
  }
}

const exportRequested = () => typeof window !== 'undefined' && window.__MELDY_GUIDE_EXPORT__ === true;

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
 * One chapter's clip: its own (OwnClip), or one of its step clips (`reel`, components/clips: the picture with the line
 * of each step under it). «Тесты» has step clips only: without a reel it plays the studio's.
 */
export default function GuideClip({ chapter, reel = null, active }: { chapter: GuideChapterId; reel?: StepClipId | null; active: boolean }) {
  if (reel || chapter === 'tests') return <StepClip clip={STEP_CLIPS[reel ?? 'studio']} active={active} />;
  return <OwnClip chapter={chapter} active={active} />;
}

/**
 * A chapter's own clip: a 4:3 stage scaled to the width it is given, looping silently while the
 * guide is open and the tab is visible. It can be paused; with reduced motion it waits on a still
 * frame until asked to play. The stage is decoration (aria-hidden): the chapter's title and text
 * next to it say the same in words.
 */
function OwnClip({ chapter, active }: { chapter: OwnClipChapter; active: boolean }) {
  const clip = GUIDE_CLIPS[chapter];
  const box = useRef<HTMLDivElement>(null);
  const clock = useMemo(() => new ReelClock(clip.total), [clip]);
  const reduce = usePrefersReducedMotion();
  const tabVisible = usePageVisible();
  const [width, setWidth] = useState(0);
  const [paused, setPaused] = useState(false);
  const [asked, setAsked] = useState(false);
  const exporting = useMemo(exportRequested, []);

  const allowed = !reduce || asked;
  const playing = active && allowed && tabVisible && !paused && width > 0 && !exporting;

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
    window.__meldyGuideClip = {
      total: clip.total,
      seek: (t: number) =>
        new Promise<void>((resolve) => {
          clock.seek(t);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    };
    return () => {
      delete window.__meldyGuideClip;
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
    <div ref={box} className="gd-box" data-playing={playing ? 'true' : 'false'}>
      {width > 0 ? (
        <ClockProvider value={clock}>
          <div className="mr-stage gd-stage" style={{ transform: `scale(${width / GUIDE_W})` }} aria-hidden="true">
            <SceneProvider value={{ from: 0, to: clip.total }}>
              <Scene />
            </SceneProvider>
          </div>
        </ClockProvider>
      ) : null}
      {allowed ? (
        <button type="button" className="gd-play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Смотреть'}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      ) : (
        <button type="button" className="gd-start" onClick={toggle}>
          Смотреть
          <i>
            <PlayIcon />
          </i>
        </button>
      )}
    </div>
  );
}
