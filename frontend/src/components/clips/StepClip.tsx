import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ReelClock } from '../reel/clock';
import { ClockProvider, SceneProvider } from '../reel/engine';
import { usePageVisible } from '../landing/usePageVisible';
import { usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import { STEP_W, type ClipStep, type StepClipDef } from './types';
import '../reel/reel.css';
import './stepClip.css';

declare global {
  interface Window {
    /** Set by a frame exporter before the page loads: no autoplay, and `__meldyStepClip` to step frames. */
    __MELDY_STEP_EXPORT__?: boolean;
    __meldyStepClip?: { id: string; total: number; steps: readonly ClipStep[]; seek: (t: number) => Promise<void> };
  }
}

const exportRequested = () => typeof window !== 'undefined' && window.__MELDY_STEP_EXPORT__ === true;

/** The step playing at scene time `t`: the last one begun (the first before any). */
export function stepAt(steps: readonly ClipStep[], t: number): number {
  let found = 0;
  steps.forEach((step, index) => {
    if (t >= step.at) found = index;
  });
  return found;
}

/** How far into step `index` the clip is at `t`, 0 → 1 (the last step runs to the end of the loop). */
export function stepProgress(steps: readonly ClipStep[], total: number, index: number, t: number): number {
  const from = steps[index].at;
  const to = index + 1 < steps.length ? steps[index + 1].at : total;
  if (to <= from) return 1;
  return Math.min(1, Math.max(0, (t - from) / (to - from)));
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

function NextIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
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

export interface StepClipProps {
  clip: StepClipDef;
  /** Plays while true (the card is shown); paused otherwise. */
  active: boolean;
  /** A smaller line under the picture (the move dialog's tip). */
  compact?: boolean;
}

/**
 * A how-to clip: the stage (16:10) scaled to the width it is given, and under it the line of the step playing, a thin
 * strip of the steps, «Следующий шаг» and «Пауза». It loops silently while it is shown, the tab is visible and the clip
 * is in the window. With reduced motion it does not move: it shows each step as a still frame with its line, «Следующий
 * шаг» goes through them, and «Смотреть» plays it. The picture is decoration (aria-hidden); the steps are read out as a
 * list. The line takes the colours of the card it is in (the guide's, the tour's dark card, the dialog's).
 */
export default function StepClip({ clip, active, compact = false }: StepClipProps) {
  const { steps, total, Scene } = clip;
  const frame = useRef<HTMLDivElement>(null);
  const fills = useRef<Array<HTMLElement | null>>([]);
  const clock = useMemo(() => new ReelClock(total), [total]);
  const reduce = usePrefersReducedMotion();
  const tabVisible = usePageVisible();
  const inView = useInView(frame);
  const exporting = useMemo(exportRequested, []);
  const [width, setWidth] = useState(0);
  const [paused, setPaused] = useState(false);
  const [asked, setAsked] = useState(false);
  const [index, setIndex] = useState(0);
  /** The still shown while motion is reduced (or the clip is paused on a step by «Следующий шаг»). */
  const [still, setStill] = useState(0);

  const allowed = !reduce || asked;
  const playing = active && allowed && tabVisible && inView && !paused && width > 0 && !exporting;

  useEffect(() => () => clock.dispose(), [clock]);

  useLayoutEffect(() => {
    const el = frame.current;
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

  // The line and the strip follow the clock: React renders when the step changes, the strip's fill is written per frame.
  useEffect(
    () =>
      clock.addFrame((t) => {
        const at = stepAt(steps, t);
        setIndex((prev) => (prev === at ? prev : at));
        steps.forEach((_, i) => {
          const fill = fills.current[i];
          if (!fill) return;
          const p = i < at ? 1 : i > at ? 0 : stepProgress(steps, total, i, t);
          fill.style.transform = `scaleX(${p.toFixed(4)})`;
        });
      }),
    [clock, steps, total],
  );

  // Not moving: the step's still frame, with everything of the step on screen.
  useEffect(() => {
    if (!allowed && !exporting) clock.seek(steps[still]?.still ?? 0);
  }, [allowed, exporting, still, clock, steps]);

  useEffect(() => {
    if (playing) clock.play();
    else clock.pause();
  }, [playing, clock]);

  useEffect(() => {
    if (!exporting) return undefined;
    window.__meldyStepClip = {
      id: clip.id,
      total,
      steps,
      seek: (t: number) =>
        new Promise<void>((resolve) => {
          clock.seek(t);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    };
    return () => {
      delete window.__meldyStepClip;
    };
  }, [exporting, clock, clip.id, total, steps]);

  const toggle = useCallback(() => {
    if (!allowed) {
      // «Смотреть» plays from the step on screen.
      clock.seek(steps[still]?.at ?? 0);
      setAsked(true);
      setPaused(false);
      return;
    }
    setPaused((value) => !value);
  }, [allowed, clock, steps, still]);

  const next = useCallback(() => {
    const following = (stepAt(steps, clock.time) + 1) % steps.length;
    if (!allowed) {
      setStill(following);
      return;
    }
    // Playing, the clip goes on from the next step; paused, it shows that step whole.
    if (paused) clock.seek(steps[following].still);
    else clock.seek(steps[following].at);
  }, [allowed, paused, clock, steps]);

  const caption = steps[index]?.caption ?? '';
  const moving = allowed && !paused;

  return (
    <div className="sc" data-playing={playing ? 'true' : 'false'} data-compact={compact ? '' : undefined} data-step={index}>
      <div ref={frame} className="sc-frame">
        {width > 0 ? (
          <ClockProvider value={clock}>
            <div className="mr-stage sc-stage" style={{ transform: `scale(${width / STEP_W})` }} aria-hidden="true">
              <SceneProvider value={{ from: 0, to: total }}>
                <Scene />
              </SceneProvider>
            </div>
          </ClockProvider>
        ) : null}
        <div className="sc-strip" aria-hidden="true">
          {steps.map((step, i) => (
            <i key={step.at}>
              <b
                ref={(el) => {
                  fills.current[i] = el;
                }}
              />
            </i>
          ))}
        </div>
      </div>
      <div className="sc-bar">
        <p className="sc-cap" aria-hidden="true">
          <span className="sc-count">
            {index + 1}/{steps.length}
          </span>
          <span key={`${index}-${caption}`} className="sc-cap-t">
            {caption}
          </span>
        </p>
        <button type="button" className="sc-btn" onClick={next} aria-label="Следующий шаг" title="Следующий шаг">
          <NextIcon />
        </button>
        {allowed ? (
          <button type="button" className="sc-btn" onClick={toggle} aria-label={moving ? 'Пауза' : 'Смотреть'} title={moving ? 'Пауза' : 'Смотреть'}>
            {moving ? <PauseIcon /> : <PlayIcon />}
          </button>
        ) : (
          <button type="button" className="sc-btn sc-watch" onClick={toggle}>
            Смотреть
            <i>
              <PlayIcon />
            </i>
          </button>
        )}
      </div>
      <ol className="sr-only" aria-label="Шаги ролика">
        {steps.map((step) => (
          <li key={step.at}>{step.caption}</li>
        ))}
      </ol>
    </div>
  );
}
