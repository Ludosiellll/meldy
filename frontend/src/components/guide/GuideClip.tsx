import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReelClock } from '../reel/clock';
import { ClockProvider, SceneProvider } from '../reel/engine';
import { usePageVisible } from '../landing/usePageVisible';
import { usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import { GUIDE_CLIPS, GUIDE_FOOTAGE, GUIDE_W, type OwnClipChapter } from './clips';
import type { GuideChapterId } from './chapters';
import StepClip from '../clips/StepClip';
import { STEP_CLIPS } from '../clips';
import type { StepClipId } from '../clips/types';
import Footage from '../film/Footage';
import type { Footage as FootageDef } from '../../lib/footage';
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

/** The round button in the corner (play / pause), or «Смотреть» while motion is reduced and the clip has not been asked for. */
function ClipButton({ allowed, playing, onToggle }: { allowed: boolean; playing: boolean; onToggle: () => void }) {
  if (allowed) {
    return (
      <button type="button" className="gd-play" onClick={onToggle} aria-label={playing ? 'Пауза' : 'Смотреть'}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
    );
  }
  return (
    <button type="button" className="gd-start" onClick={onToggle}>
      Смотреть
      <i>
        <PlayIcon />
      </i>
    </button>
  );
}

/**
 * One chapter's clip: its own (OwnClip), real footage of the app (FootageClip: «Игра в классе»), or one of its step
 * clips (`reel`, components/clips: the picture with the line of each step under it). «Тесты» has step clips only:
 * without a reel it plays the studio's.
 */
export default function GuideClip({ chapter, reel = null, active }: { chapter: GuideChapterId; reel?: StepClipId | null; active: boolean }) {
  if (reel || chapter === 'tests') return <StepClip clip={STEP_CLIPS[reel ?? 'studio']} active={active} />;
  if (chapter === 'game') return <FootageClip footage={GUIDE_FOOTAGE[chapter]} active={active} />;
  return <OwnClip chapter={chapter} active={active} />;
}

/**
 * A chapter shown in real footage of the app (lib/footage.ts, film/Footage): the whole frame in the 4:3 box, centred,
 * the bars above and below it in the footage's own backdrop. It loops silently while the guide is open, the tab is
 * visible and the box is on screen, and can be paused; with reduced motion it waits on the poster until asked to play.
 * The parts are fetched when the chapter is shown, not before. Decoration (aria-hidden): the chapter's words say it.
 */
function FootageClip({ footage, active }: { footage: FootageDef; active: boolean }) {
  const reduce = usePrefersReducedMotion();
  const tabVisible = usePageVisible();
  const [paused, setPaused] = useState(false);
  const [asked, setAsked] = useState(false);

  const allowed = !reduce || asked;
  const playing = active && allowed && tabVisible && !paused;
  const toggle = () => {
    if (!allowed) {
      setAsked(true);
      setPaused(false);
      return;
    }
    setPaused((value) => !value);
  };

  return (
    <div className="gd-box" data-footage="" data-playing={playing ? 'true' : 'false'} style={{ background: footage.backdrop }}>
      <Footage footage={footage} play={active && !paused} still={!allowed} />
      <ClipButton allowed={allowed} playing={playing} onToggle={toggle} />
    </div>
  );
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
      <ClipButton allowed={allowed} playing={playing} onToggle={toggle} />
    </div>
  );
}
