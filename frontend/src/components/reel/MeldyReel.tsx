import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePageVisible } from '../landing/usePageVisible';
import { usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import { REEL_EVENT, takePendingChapter, type ReelChapter } from '../home/reelJump';
import { ReelClock } from './clock';
import { put } from './engine';
import ReelStage from './ReelStage';
import { END_CTA } from './scenes/End';
import * as C from './content';
import { CHAPTERS, CUT, POSTER_AT, STAGE_H, STAGE_W, TOTAL, chapterAt, clamp } from './timeline';
import './reel.css';

declare global {
  interface Window {
    /** Set by the frame exporter before the page loads: no autoplay, and `__meldyReel` to step frames. */
    __MELDY_REEL_EXPORT__?: boolean;
    __meldyReel?: { total: number; seek: (t: number) => Promise<void> };
  }
}

/** The bar under the reel: the seven chapters, by their length. */
export const SEGMENTS: Array<{ label: string; from: number; to: number; id: ReelChapter; at: number }> = CHAPTERS.map((chapter, index) => ({
  label: chapter.label,
  from: chapter.from,
  to: CHAPTERS[index + 1]?.from ?? TOTAL,
  id: chapter.id,
  at: chapter.at,
}));

const segmentAt = (t: number) => Math.max(0, CHAPTERS.indexOf(chapterAt(t)));

/** When the button of the end card is on the stage (the card's own fade-in). */
const CTA_AT = CUT + 1700;

/** What the reel says, for screen readers (the stage itself is hidden from them). */
const TRANSCRIPT = [
  `Список кафедры: ${C.RECOGNIZED.toLowerCase()}.`,
  `Ответы из лекций: лекция «${C.SLIP.lecture}» ${C.FIT_HINT}. Цитата: «${C.SLIP.quote}». ${C.UNMATCHED_LINE}`,
  'Шпаргалка: пункты ответа записаны под вопросом, каждый строкой.',
  `Билет вслух: «${C.TICKET.turns[0].text}» Экзаменатор: «${C.TICKET.turns[1].text}» «${C.TICKET.turns[2].text}» ${C.TICKET.countLine}.`,
  'Разные дни: 7 окт. пункт назван, строка стёрлась наполовину. 8 окт. её назвали снова, строка стёрлась совсем. 10 окт. её не назвали, и она вернулась: «была стёрта · пункт не назван».',
  `Группе: ${C.GROUP.statement.toLowerCase()}. ${C.GROUP.questionOfDay}, ${C.GROUP.reminderTime.toLowerCase()}.`,
  'Meldy. ИИ не отвечает за вас — он вас спрашивает. Попробовать на примере.',
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
 * «Meldy за 48 секунд»: the reel on the page. It plays silently while it is on screen and the tab
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

  // The chapter bar fills with the clock; React state changes only when the chapter changes.
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
        const cta = t >= CTA_AT;
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

  const jump = useCallback(
    (index: number) => {
      clock.seek(SEGMENTS[index].at);
      setAsked(true);
      setUserPaused(false);
    },
    [clock],
  );

  // «Смотреть в ролике» elsewhere on the page plays a chapter here.
  useEffect(() => {
    const play = (chapter: ReelChapter | null | undefined) => {
      const index = SEGMENTS.findIndex((segment) => segment.id === chapter);
      if (index >= 0) jump(index);
    };
    play(takePendingChapter());
    const onRequest = (event: Event) => {
      takePendingChapter();
      play((event as CustomEvent<{ chapter?: ReelChapter }>).detail?.chapter);
    };
    window.addEventListener(REEL_EVENT, onRequest);
    return () => window.removeEventListener(REEL_EVENT, onRequest);
  }, [jump]);

  const ctaStyle = {
    left: `${(END_CTA.left / STAGE_W) * 100}%`,
    top: `${(END_CTA.top / STAGE_H) * 100}%`,
    width: `${(END_CTA.width / STAGE_W) * 100}%`,
    height: `${(END_CTA.height / STAGE_H) * 100}%`,
  };

  return (
    <figure className="mr-figure" aria-labelledby={captionId}>
      <figcaption id={captionId} className="mr-sr">
        Ролик о Meldy, 48 секунд, без звука.
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
                key={span.id}
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
