import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePageVisible } from '../landing/usePageVisible';
import { usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import { ReelClock } from './clock';
import { put } from './engine';
import ReelStage from './ReelStage';
import { OUTRO_CTA, OUTRO_CTA_AT } from './scenes/Outro';
import { POSTER_AT, STAGE_H, STAGE_W, TOTAL, clamp, sceneWindow } from './timeline';
import './reel.css';

declare global {
  interface Window {
    /** Set by the frame exporter before the page loads: no autoplay, and `__meldyReel` to step frames. */
    __MELDY_REEL_EXPORT__?: boolean;
    __meldyReel?: { total: number; seek: (t: number) => Promise<void> };
  }
}

/** The bar under the reel: the opening, the four chapters and the ending, by their length. */
export const SEGMENTS = [
  { label: 'Начало', from: 0, to: sceneWindow('tickets').from },
  { label: 'Билеты', from: sceneWindow('tickets').from, to: sceneWindow('oral').from },
  { label: 'Ответ вслух', from: sceneWindow('oral').from, to: sceneWindow('review').from },
  { label: 'Повторение', from: sceneWindow('review').from, to: sceneWindow('ready').from },
  { label: 'Готовность', from: sceneWindow('ready').from, to: sceneWindow('outro').from },
  { label: 'Итог', from: sceneWindow('outro').from, to: TOTAL },
];

const segmentAt = (t: number) => Math.max(0, SEGMENTS.findIndex((segment) => t >= segment.from && t < segment.to));

/** What the reel says, for screen readers (the stage itself is hidden from them). */
const TRANSCRIPT = [
  'Сессия: 40 вопросов, 12 дней. С чего начать?',
  'Meldy. Сессия начинается со списка вопросов.',
  'Билеты: 24 из 40 вопросов уже есть в твоих лекциях. Тянуть билет.',
  'Ответ вслух, как на экзамене: пункты ответа отмечаются, экзаменатор спрашивает о пропущенном, ответ засчитан.',
  'Повторение: пропущенный пункт возвращается карточкой на завтра.',
  'Готовность: не перечитывай — вспоминай.',
  'Meldy. Вспоминать полезнее, чем перечитывать. Билеты по твоим лекциям, ответ вслух с вопросом экзаменатора, повторение в нужный день.',
];

const exportRequested = () => typeof window !== 'undefined' && window.__MELDY_REEL_EXPORT__ === true;

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
 * «Meldy за 35 секунд»: the reel on the page. It plays silently while it is on screen and the tab
 * is visible, loops, can be paused and jumped by chapter. With reduced motion it shows one still
 * frame and plays only when asked.
 */
export default function MeldyReel({ onCta }: { onCta?: () => void }) {
  const captionId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const clock = useMemo(() => new ReelClock(TOTAL), []);
  const reduce = usePrefersReducedMotion();
  const tabVisible = usePageVisible();
  const exporting = useMemo(exportRequested, []);
  const [scale, setScale] = useState(0.5);
  const [inView, setInView] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [asked, setAsked] = useState(false);
  const [segment, setSegment] = useState(0);
  const [ctaOn, setCtaOn] = useState(false);
  const shown = useRef({ segment: 0, cta: false });

  const allowed = !reduce || asked;
  const playing = allowed && inView && tabVisible && !userPaused && !exporting;

  useEffect(() => () => clock.dispose(), [clock]);

  // The stage keeps its 1920 × 1080 composition and is scaled to the frame's width.
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return undefined;
    const measure = () => setScale(el.clientWidth > 0 ? el.clientWidth / STAGE_W : 0.5);
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
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting && entry.intersectionRatio >= 0.35), {
      threshold: [0, 0.35, 0.6],
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Under reduced motion the reel waits on its poster frame.
  useEffect(() => {
    if (reduce && !asked) clock.seek(POSTER_AT);
  }, [reduce, asked, clock]);

  useEffect(() => {
    if (playing) clock.play();
    else clock.pause();
  }, [playing, clock]);

  // The chapter bar fills with the clock; React state changes only when the segment changes.
  useEffect(
    () =>
      clock.addFrame((t) => {
        const fills = bar.current?.querySelectorAll<HTMLElement>('[data-fill]') ?? [];
        fills.forEach((fill, index) => {
          const span = SEGMENTS[index];
          put(fill, 'transform', `scaleX(${clamp((t - span.from) / (span.to - span.from)).toFixed(4)})`);
        });
        const next = segmentAt(t);
        if (next !== shown.current.segment) {
          shown.current.segment = next;
          setSegment(next);
        }
        const cta = t >= sceneWindow('outro').from + OUTRO_CTA_AT;
        if (cta !== shown.current.cta) {
          shown.current.cta = cta;
          setCtaOn(cta);
        }
      }),
    [clock],
  );

  // The frame exporter steps the clock itself.
  useEffect(() => {
    if (!exporting) return undefined;
    window.__meldyReel = {
      total: TOTAL,
      seek: (t: number) =>
        new Promise<void>((resolve) => {
          clock.seek(t);
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
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

  const jump = (index: number) => {
    clock.seek(SEGMENTS[index].from + (index === 0 ? 0 : 60));
    setAsked(true);
    setUserPaused(false);
  };

  const ctaStyle = {
    left: `${((OUTRO_CTA.x - OUTRO_CTA.w / 2) / STAGE_W) * 100}%`,
    top: `${((OUTRO_CTA.y - OUTRO_CTA.h / 2) / STAGE_H) * 100}%`,
    width: `${(OUTRO_CTA.w / STAGE_W) * 100}%`,
    height: `${(OUTRO_CTA.h / STAGE_H) * 100}%`,
  };

  return (
    <figure className="mr-figure" aria-labelledby={captionId}>
      <figcaption id={captionId} className="mr-sr">
        Ролик о Meldy, 35 секунд, без звука.
      </figcaption>
      <ol className="mr-sr">
        {TRANSCRIPT.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <div ref={frame} className="mr-frame" data-playing={playing ? 'true' : 'false'}>
        <ReelStage clock={clock} scale={scale} />
        {onCta && ctaOn ? (
          <button type="button" className="mr-cta-hit" style={ctaStyle} onClick={onCta} tabIndex={-1} aria-hidden="true" />
        ) : null}
        {!allowed ? (
          <button type="button" className="mr-start" onClick={toggle}>
            Смотреть ролик
            <i>
              <PlayIcon />
            </i>
          </button>
        ) : null}
      </div>
      {exporting ? null : (
        <div className="mr-controls">
          <button type="button" className="mr-play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Смотреть'}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <span className="mr-now" aria-hidden="true">
            {SEGMENTS[segment].label}
          </span>
          <div ref={bar} className="mr-chapters">
            {SEGMENTS.map((span, index) => (
              <button
                key={span.label}
                type="button"
                className="mr-chapter"
                style={{ flexGrow: span.to - span.from }}
                onClick={() => jump(index)}
                aria-label={`Перейти: ${span.label}`}
                aria-current={index === segment ? 'step' : undefined}
              >
                <span className="mr-chapter-t">{span.label}</span>
                <span className="mr-chapter-line">
                  <span data-fill className="mr-chapter-fill" style={{ transform: 'scaleX(0)' }} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </figure>
  );
}
