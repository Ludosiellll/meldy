import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { usePageVisible } from '../landing/usePageVisible';
import { usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import { ty } from '../landing/typo';
import { REEL_EVENT, takePendingChapter, type ReelChapter } from '../home/reelJump';
import { ReelClock } from './clock';
import { put } from './engine';
import ReelStage from './ReelStage';
import {
  BOT,
  CHAOS_LINES,
  FIGURE_AFTER_FIRST,
  GROUP_MEMBERS,
  GROUP_WORDS,
  IMPORT_WORDS,
  ORAL,
  PLAN_WORDS,
  QUESTIONS_TOTAL,
  SESSION_WORDS,
  SUBJECTS,
  subjectMeta,
} from './content';
import { OUTRO_CTA, OUTRO_CTA_AT, OUTRO_CTA_LABEL } from './scenes/Outro';
import { CHAPTERS, POSTER_AT, STAGE_H, STAGE_W, TOTAL, clamp, plural, sceneWindow } from './timeline';
import './reel.css';

declare global {
  interface Window {
    /** Set by the frame exporter before the page loads: no autoplay, and `__meldyReel` to step frames. */
    __MELDY_REEL_EXPORT__?: boolean;
    __meldyReel?: { total: number; seek: (t: number) => Promise<void> };
  }
}

/** The bar under the reel: the opening, the five chapters and the ending, by their length. */
export const SEGMENTS: Array<{ label: string; from: number; to: number; id?: ReelChapter }> = [
  { label: 'Начало', from: 0, to: CHAPTERS[0].at },
  ...CHAPTERS.map((chapter, index) => ({
    label: chapter.label,
    from: chapter.at,
    to: index + 1 < CHAPTERS.length ? CHAPTERS[index + 1].at : sceneWindow('outro').from,
    id: chapter.id as ReelChapter,
  })),
  { label: 'Итог', from: sceneWindow('outro').from, to: TOTAL },
];

const segmentAt = (t: number) => Math.max(0, SEGMENTS.findIndex((segment) => t >= segment.from && t < segment.to));

/**
 * The page's line under the bar on a phone, one per segment, in the reel's own words (its transcript below): on a
 * 390 px screen the stage's text is 3–9 px. Page text outside the stage: the film itself is not changed.
 */
export const CAPTIONS: readonly string[] = [
  'Сессия начинается со списка вопросов.',
  'Файлы кафедры как есть: ключ — из файла, без ИИ.',
  'План по дням до экзамена, только в ваши дни занятий.',
  'Ключ виден после ответа, а ошибка вернётся в день занятий.',
  'Строки уходят, когда вы называете пункт в разные дни.',
  'Одна ссылка на всю группу, а план на день — в Telegram.',
  'Вспоминать полезнее, чем перечитывать.',
];

/** The reel's length in whole seconds, as the landing's heading «Meldy за … секунд» says it. */
export const REEL_SECONDS = Math.round(TOTAL / 1000);

/** What the reel says, for screen readers (the stage itself is hidden from them). */
const TRANSCRIPT = [
  `Сессия: ${CHAOS_LINES[0]} ${CHAOS_LINES[1]}`,
  'Meldy. Сессия начинается со списка вопросов.',
  `Вопросы: файлы кафедры, по одному на предмет. ${IMPORT_WORDS.found}: ${SUBJECTS.map((subject) => `«${subject.title}» — ${subjectMeta(subject)}`).join('; ')}. ${IMPORT_WORDS.noAi}`,
  `План: ${PLAN_WORDS.head} ${PLAN_WORDS.studyDays}, в воскресенье выходной, в последние дни — только знакомые вопросы. ${PLAN_WORDS.title}.`,
  `Занятие: ответ — нажатием, ключ из файла виден сразу. Верно — и ${FIGURE_AFTER_FIRST} из ${QUESTIONS_TOTAL} верно в два разных дня. ${SESSION_WORDS.wrong} В конце: ${SESSION_WORDS.endHead.join('')}. ${SESSION_WORDS.endText} ${SESSION_WORDS.endLeft}`,
  `Шпаргалка: строки стирают только ответы. Ответ вслух на вопрос «${ORAL.question}»: названные пункты загораются, их строки бледнеют, а в другой день, названные снова, исчезают. К экзамену на шпаргалке остаётся немного строк.`,
  `Группа: одна ссылка на всю группу — ${GROUP_WORDS.inExam(GROUP_MEMBERS)}, прогресс у каждого свой. ${GROUP_WORDS.botHead.join(' ')} В ${BOT.time} бот присылает план: «${BOT.plan}» «${BOT.start}» — и вопросы с вариантами на кнопках.`,
  `Meldy. Вспоминать полезнее, чем перечитывать. Вопросы, план, шпаргалка и группа. ${OUTRO_CTA_LABEL}.`,
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
 * is visible, loops, can be paused and jumped by chapter. Until it first plays it shows its poster,
 * one still of the «занятие» (with reduced motion it waits on it until asked); it starts from its
 * first frame.
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
  /** The observer has said once whether the frame is on screen. */
  const [measured, setMeasured] = useState(false);
  /** The reel has played (or was jumped to a chapter): no poster any more. */
  const started = useRef(false);
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
    const observer = new IntersectionObserver(
      (entries) => {
        // Several changes can arrive at once (a page resized and back, a quick scroll past): the last one is now.
        const entry = entries[entries.length - 1];
        setInView(entry.isIntersecting && entry.intersectionRatio >= 0.35);
        setMeasured(true);
      },
      { threshold: [0, 0.35, 0.6] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The poster until the reel first plays: under reduced motion until asked, otherwise while the frame is off screen.
  // A frame on screen at load starts at its first moment without showing the poster for a frame before it.
  const poster = !exporting && !started.current && (reduce ? !asked : measured && !inView);
  useEffect(() => {
    if (poster) clock.seek(POSTER_AT);
  }, [poster, clock]);

  useEffect(() => {
    if (!playing) {
      clock.pause();
      return;
    }
    // The first play starts the reel from its beginning (a chapter asked for has set its own moment).
    if (!started.current) {
      started.current = true;
      clock.seek(0);
    }
    clock.play();
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

  const jump = useCallback(
    (index: number) => {
      started.current = true;
      clock.seek(SEGMENTS[index].from + (index === 0 ? 0 : 60));
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
    left: `${((OUTRO_CTA.x - OUTRO_CTA.w / 2) / STAGE_W) * 100}%`,
    top: `${((OUTRO_CTA.y - OUTRO_CTA.h / 2) / STAGE_H) * 100}%`,
    width: `${(OUTRO_CTA.w / STAGE_W) * 100}%`,
    height: `${(OUTRO_CTA.h / STAGE_H) * 100}%`,
  };

  return (
    <figure className="mr-figure" aria-labelledby={captionId}>
      <figcaption id={captionId} className="mr-sr">
        {`Ролик о Meldy, ${REEL_SECONDS} ${plural(REEL_SECONDS, ['секунда', 'секунды', 'секунд'])}, без звука.`}
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
          <div ref={bar} className="mr-chapters">
            {SEGMENTS.map((span, index) => (
              <button
                key={span.label}
                type="button"
                className="mr-chapter"
                style={{ '--mr-grow': span.to - span.from } as CSSProperties}
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
      {exporting ? null : (
        <p className="mr-caption" aria-hidden="true">
          <b>{SEGMENTS[segment].label}.</b> {ty(CAPTIONS[segment])}
        </p>
      )}
    </figure>
  );
}
