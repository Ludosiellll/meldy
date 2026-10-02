import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { UNDERLINE_DROP, type PaperLine } from './paperTimeline';
import { handPoints, pointBounds, smoothPath, taperedOutline, type Pt } from './handStroke';
import { measureAscent, measureWordLines } from './usePaperGeometry';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { DEMO_SHEET, QUIZ, THESES } from './lecture';
import './PaperHero.css';
import './InteractiveDemo.css';

/** The old pencil marks fade this long; the new ones start drawing this much after the click. */
const MARK_FADE_MS = 120;
const MARK_DRAW_DELAY_MS = 60;
const MARK_DRAW_S = 0.35;

/* ------------------------------------------------------------------ */
/* Pencil helpers                                                       */
/* ------------------------------------------------------------------ */

function words(text: string) {
  const list = text.split(' ');
  return list.map((word, i) => (
    <Fragment key={i}>
      <span data-kw="">{word}</span>
      {i < list.length - 1 ? ' ' : ''}
    </Fragment>
  ));
}

interface Stroke { pts: Pt[]; centre: string; outline: string; len: number }

function underlineStrokes(lines: PaperLine[], fs: number, seed: number): Stroke[] {
  return lines.map((line, i) => {
    const last = i === lines.length - 1;
    const pts = handPoints(line.x0 - 2, line.x1 + 2, line.baseline + UNDERLINE_DROP * fs, seed + 31 * i, { rise: 0.9 + 0.2 * (i % 2), flick: last });
    return { pts, centre: smoothPath(pts), outline: taperedOutline(pts, 2.4, 0.6), len: line.x1 - line.x0 + 4 };
  });
}

type MarkState = 'draw' | 'still' | 'fade';

/**
 * Filled pencil underlines revealed through masks. 'draw' replays the stroke (0.35 s split by
 * line length, after `delay`), 'fade' lets the pencil leave this sentence, 'still' just shows it.
 */
function PencilMarks({ strokes, state, idPrefix, delay = 0 }: { strokes: Stroke[]; state: MarkState; idPrefix: string; delay?: number }) {
  if (!strokes.length) return null;
  const bounds = pointBounds(strokes.map(s => s.pts), 7.5);
  const total = strokes.reduce((sum, s) => sum + s.len, 0) || 1;
  let at = delay / 1000;
  return (
    <svg
      className={`lp-sheet-marks is-${state}`}
      width={bounds.w}
      height={bounds.h}
      style={{ left: `${bounds.x}px`, top: `${bounds.y}px` }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {strokes.map((stroke, i) => {
          const duration = (MARK_DRAW_S * stroke.len) / total;
          const style = { animationDelay: `${at.toFixed(3)}s`, animationDuration: `${duration.toFixed(3)}s` } as CSSProperties;
          at += duration;
          return (
            <mask key={i} id={`${idPrefix}-${i}`} maskUnits="userSpaceOnUse" x={bounds.x} y={bounds.y} width={bounds.w} height={bounds.h}>
              <path
                className={state === 'draw' ? 'lp-reveal is-drawing' : 'lp-reveal'}
                style={state === 'draw' ? style : undefined}
                d={stroke.centre}
                fill="none"
                stroke="#fff"
                strokeWidth={9}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                strokeDasharray="1 1"
              />
            </mask>
          );
        })}
      </defs>
      <g transform={`translate(${-bounds.x} ${-bounds.y})`}>
        {strokes.map((stroke, i) => <path key={i} className="ph-ink" d={stroke.outline} mask={`url(#${idPrefix}-${i})`} />)}
      </g>
    </svg>
  );
}

/** Re-runs `measure` on mount, on width changes of `target` and when web fonts finish loading. */
function useRemeasure(target: RefObject<HTMLElement>, measure: () => void) {
  const measureRef = useRef(measure);
  measureRef.current = measure;
  useEffect(() => {
    const el = target.current;
    let alive = true;
    document.fonts?.ready?.then(() => { if (alive) measureRef.current(); }).catch(() => {});
    if (!el || typeof ResizeObserver === 'undefined') return () => { alive = false; };
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      measureRef.current();
    });
    observer.observe(el);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [target]);
}

/* ------------------------------------------------------------------ */
/* «Конспект»: theses that point at their sentences                     */
/* ------------------------------------------------------------------ */

interface MarkLayer { id: number; source: number; strokes: Stroke[]; state: MarkState }

function SummaryRow({ reduced }: { reduced: boolean }) {
  const [active, setActive] = useState(1);
  const [layers, setLayers] = useState<MarkLayer[]>([]);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sourceRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const nextId = useRef(1);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(id => window.clearTimeout(id)), []);

  const strokesFor = useCallback((index: number) => {
    const sheet = sheetRef.current;
    const source = sourceRefs.current[index];
    if (!sheet || !source) return null;
    const origin = sheet.getBoundingClientRect();
    const paragraph = source.parentElement ?? source;
    const ascent = measureAscent(paragraph);
    const { lines } = measureWordLines(Array.from(source.querySelectorAll<HTMLElement>('[data-kw]')), origin, ascent);
    const fs = parseFloat(getComputedStyle(paragraph).fontSize) || 16;
    return underlineStrokes(lines, fs, 200 + index * 17);
  }, []);

  /* The current marks, measured again on resize and when the fonts arrive (no animation). */
  const remeasure = useCallback(() => {
    const strokes = strokesFor(active);
    if (!strokes) return;
    setLayers(prev => {
      const current = prev.find(l => l.state !== 'fade' && l.source === active);
      const same = current && JSON.stringify(current.strokes.map(s => s.outline)) === JSON.stringify(strokes.map(s => s.outline));
      if (same) return prev;
      return [{ id: nextId.current++, source: active, strokes, state: 'still' }];
    });
  }, [active, strokesFor]);
  useLayoutEffect(remeasure, [remeasure]);
  useRemeasure(sheetRef, remeasure);

  const choose = (index: number) => {
    if (index === active) return;
    const strokes = strokesFor(index);
    setActive(index);
    if (!strokes) return;
    if (reduced) {
      setLayers([{ id: nextId.current++, source: index, strokes, state: 'still' }]);
      return;
    }
    // The pencil leaves the old sentence and moves to the new one.
    setLayers(prev => [
      ...prev.filter(l => l.state !== 'fade').map(l => ({ ...l, state: 'fade' as const })),
      { id: nextId.current++, source: index, strokes, state: 'draw' },
    ]);
    const id = window.setTimeout(() => {
      setLayers(prev => prev.filter(l => l.state !== 'fade'));
    }, MARK_FADE_MS + 20);
    timers.current.push(id);
  };

  const source = (index: number) => (
    <span
      ref={el => { sourceRefs.current[index] = el; }}
      className={active === index ? 'lp-source is-source' : 'lp-source'}
      data-source={active === index ? 'active' : undefined}
    >
      {words(DEMO_SHEET.sources[index])}
    </span>
  );

  return (
    <div className="lp-row lp-row-summary">
      <div className="lp-sheet" ref={sheetRef}>
        <p className="lp-sheet-title">{DEMO_SHEET.title}</p>
        <p className="lp-sheet-p">{source(0)} {DEMO_SHEET.aside}</p>
        <p className="lp-sheet-p">{source(1)}</p>
        <p className="lp-sheet-p">{source(2)}</p>
        {layers.map(layer => (
          <PencilMarks
            key={layer.id}
            strokes={layer.strokes}
            state={layer.state}
            idPrefix={`lp-src-${layer.id}`}
            delay={layer.state === 'draw' ? MARK_DRAW_DELAY_MS : 0}
          />
        ))}
      </div>
      <div className="lp-side">
        <h3 className="lp-h3" id="lp-summary-h">Конспект</h3>
        <ul className="lp-theses" aria-labelledby="lp-summary-h">
          {THESES.map((thesis, index) => (
            <li key={thesis}>
              <button type="button" className={active === index ? 'lp-thesis is-active' : 'lp-thesis'} aria-pressed={active === index} onClick={() => choose(index)}>
                {thesis}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* «Тест»                                                               */
/* ------------------------------------------------------------------ */

/** A pencil tick, drawn once the ring has filled. */
function Tick() {
  return (
    <svg className="lp-tick" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M2.4 6.3 L5 8.8 L9.8 3.2" pathLength={1} />
    </svg>
  );
}

function QuizRow() {
  const [answer, setAnswer] = useState<number | null>(null);
  return (
    <div className="lp-row lp-row-quiz">
      <div className="lp-quiz">
        <h3 className="lp-h3" id="lp-quiz-h">Вопрос теста</h3>
        <p className="lp-quiz-q" id="lp-quiz-q">{QUIZ.question}</p>
      </div>
      <div className="lp-side">
        <div className="lp-options" role="group" aria-labelledby="lp-quiz-q">
          {QUIZ.options.map((text, index) => {
            const state = answer === index ? (index === QUIZ.correct ? ' is-correct' : ' is-wrong') : '';
            return (
              <button key={text} type="button" className={`lp-option${state}`} aria-pressed={answer === index} onClick={() => setAnswer(index)}>
                <span className="lp-ring" aria-hidden="true">{answer === index && index === QUIZ.correct && <Tick />}</span>
                <span className="lp-option-text">{text}</span>
              </button>
            );
          })}
        </div>
        {/* Space for the explanation is kept, so answering never moves the page below. */}
        <div className="lp-feedback-slot" aria-live="polite">
          {answer !== null && (
            <p key={answer === QUIZ.correct ? 'right' : `wrong-${answer}`} className="lp-feedback">
              {answer === QUIZ.correct ? QUIZ.right : QUIZ.wrong}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Hands-on example under the hero, from the next part of the same lecture: a summary whose
 * points underline their sentences in the source, and one quiz question. Both are always
 * open; nothing plays by itself, every change comes from the visitor.
 */
export default function InteractiveDemo() {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="lp-demo" id="learning-demo" data-reduced={reduced ? 'true' : undefined}>
      <SummaryRow reduced={reduced} />
      <QuizRow />
    </div>
  );
}
