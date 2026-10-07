import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { SheetText } from '../exams/sheet/SheetText';
import { isSheetFontSettled, loadSheetFont } from '../exams/sheet/sheetFont';
import { Mark, PencilUnder, seedFrom } from '../marks';
import { readReducedMotion, usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import { ty } from '../landing/typo';

/**
 * «Шпаргалка, которая исчезает» on the landing's first screen: the exam page's sheet in small
 * (components/exams/sheet: squared paper, the department's questions printed, the answer points by
 * hand, the eraser's two passes), on questions 6 and 7 of the example exam (/try, «Микроэкономика»),
 * their short lines word for word (data/example/questions.ts).
 *
 * When the sheet comes into view, one answer plays: the line named the day before is erased, two
 * lines named for the first time rub half away, the line that came back stays, and the sheet says
 * what the answer did in the words of the exam page (copy.ts changeSentence). With reduced motion it
 * stands as after that answer. The paper is a picture for the eye; the words under it and a short
 * description say the same for a screen reader.
 */

export type HeroLineState = 'fresh' | 'rubbed' | 'erased' | 'returned';

export interface HeroLine {
  text: string;
  essential: boolean;
  /** The line before the answer the sheet replays, and after it. */
  before: HeroLineState;
  after: HeroLineState;
  /** The pencil note of a line that came back (no days: the example has no dates of its own). */
  note?: string;
}

export interface HeroQuestion {
  number: number;
  text: string;
  /** Every main line erased: a pencil tick in the margin by the number. */
  learned?: boolean;
  lines: HeroLine[];
}

export const HERO_SHEET: readonly HeroQuestion[] = [
  {
    number: 6,
    text: 'Факторы ценовой эластичности спроса.',
    learned: true,
    lines: [
      { text: 'заменителей ↑ → спрос эластичнее', essential: true, before: 'erased', after: 'erased' },
      { text: 'доля в бюджете ↑ → эластичность ↑', essential: true, before: 'erased', after: 'erased' },
      { text: 'необходимость — неэластичный, роскошь — эластичный', essential: true, before: 'erased', after: 'erased' },
      { text: 'со временем спрос эластичнее', essential: false, before: 'fresh', after: 'fresh' },
    ],
  },
  {
    number: 7,
    text: 'Эластичность спроса и выручка продавца.',
    lines: [
      { text: 'выручка = цена × количество', essential: true, before: 'rubbed', after: 'erased' },
      { text: 'эластичный: снижение цены → выручка ↑', essential: true, before: 'fresh', after: 'rubbed' },
      {
        text: 'неэластичный: выручка ↑ при повышении цены',
        essential: true,
        before: 'returned',
        after: 'returned',
        note: 'была стёрта · пункт не назван',
      },
      { text: 'единичная эластичность: выручка не меняется', essential: false, before: 'fresh', after: 'rubbed' },
    ],
  },
];

/** What the replayed answer did, as the exam page says it after an answer (its no-break spaces too). */
export const SHEET_CHANGE = 'После ответа: 1\u00a0строка стёрлась, 2\u00a0—\u00a0наполовину.';
/** The sheet's rule, as the exam page keeps it under the counter (copy.ts SHEET_RULE). */
export const SHEET_RULE = 'Строки стирают только ответы: назвали пункт — наполовину, назвали снова в другой день — совсем.';
export const SHEET_BACK = 'Не назвали потом — строка вернётся.';
export const SHEET_TITLE = 'Шпаргалка, которая исчезает';
export const REPLAY_LABEL = 'Показать ещё раз';
/** Elsewhere on the page («Показать на шпаргалке»): plays the answer on this sheet again. */
export const SHEET_REPLAY_EVENT = 'meldy-sheet-replay';

const DESCRIPTION =
  'Пример: шпаргалка экзамена «Микроэкономика». У вопроса 6 стёрты все главные строки. У вопроса 7 после ответа одна строка стёрта, две — наполовину, а одна вернулась: в ответе её пункт не назван.';

/** One pass of the eraser over a line, and the next line's pass after it. */
export const SWEEP_MS = 900;
const STAGGER_MS = 320;
/** The sheet is seen as it was before the answer for this long. */
const LOOK_MS = 1600;
const REPLAY_LOOK_MS = 700;

type Phase = 'before' | 'playing' | 'after';

const CHANGING = HERO_SHEET.flatMap((question) => question.lines.filter((line) => line.before !== line.after));
const PLAY_MS = (CHANGING.length - 1) * STAGGER_MS + SWEEP_MS;

function Line({ line, phase, delay, seed }: { line: HeroLine; phase: Phase; delay: number; seed: string }) {
  const state = phase === 'before' ? line.before : line.after;
  const moves = line.before !== line.after;
  const anim = phase === 'playing' && moves ? (line.after === 'erased' ? 'erase' : 'rub') : undefined;
  // Rubbed paper under every line an answer has touched; the wave under a line that came back.
  const patched = state !== 'fresh' || anim !== undefined;
  const words = <SheetText text={line.text} seedBase={seed} />;
  return (
    <li
      className="hs-line"
      data-state={state}
      data-anim={anim}
      style={anim ? ({ '--hs-delay': `${delay}ms`, '--hs-ms': `${SWEEP_MS}ms` } as CSSProperties) : undefined}
    >
      <span className="hs-bullet">{line.essential ? '•' : '–'}</span>
      <span className="hs-body">
        {patched && <span className="hs-patch" />}
        <span className="hs-ink">
          {state === 'returned' ? (
            <PencilUnder seed={seedFrom(seed, 'wave')} hand="graphite" kind="wave" weight={1.8} dy={-1} watch={line.text}>
              {words}
            </PencilUnder>
          ) : (
            words
          )}
        </span>
      </span>
      {line.note && state === 'returned' && <span className="hs-note">{line.note}</span>}
    </li>
  );
}

export default function HeroSheet() {
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  const reduce = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>(() => (readReducedMotion() ? 'after' : 'before'));
  const [fontReady, setFontReady] = useState(isSheetFontSettled);
  const [seen, setSeen] = useState(false);
  const [round, setRound] = useState(0);
  // How long the sheet is seen as it was before the answer plays (a replay asked from below waits for the scroll).
  const [look, setLook] = useState(LOOK_MS);

  useEffect(() => {
    let alive = true;
    void loadSheetFont().then(() => {
      if (alive) setFontReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The answer plays once the sheet is in view (on a phone it is below the first screen).
  useEffect(() => {
    const el = root.current;
    if (!el || seen) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);

  useEffect(() => {
    if (reduce) setPhase('after');
  }, [reduce]);

  // The sheet is seen as it was for a moment, then the answer plays, then the sheet says what it did.
  useEffect(() => {
    if (reduce || !fontReady || !seen || phase !== 'before') return undefined;
    const timer = window.setTimeout(() => setPhase('playing'), look);
    return () => window.clearTimeout(timer);
  }, [reduce, fontReady, seen, phase, round, look]);

  useEffect(() => {
    if (phase !== 'playing') return undefined;
    const timer = window.setTimeout(() => setPhase('after'), PLAY_MS + 80);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const replay = (wait: number) => {
    setLook(wait);
    setRound((value) => value + 1);
    setPhase('before');
  };

  useEffect(() => {
    const onReplay = () => {
      if (!readReducedMotion()) replay(LOOK_MS);
    };
    window.addEventListener(SHEET_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(SHEET_REPLAY_EVENT, onReplay);
  }, []);

  let order = 0;
  return (
    <figure ref={root} className="hs" aria-labelledby={titleId}>
      <div className="hs-top">
        <span id={titleId} className="hs-flag">
          {SHEET_TITLE}
        </span>
        <span className="hs-meta">Микроэкономика · пример</span>
      </div>
      <p className="sr-only">{DESCRIPTION}</p>
      <div className="hs-paper" data-font={fontReady ? 'ready' : 'waiting'} aria-hidden="true">
        {HERO_SHEET.map((question) => (
          <div key={question.number} className="hs-q" data-learned={question.learned ? '' : undefined}>
            {question.learned && (
              <span className="hs-tick">
                <Mark kind="tick" seed={seedFrom('landing', question.number, 'tick')} width={20} height={16} hand="graphite" />
              </span>
            )}
            <p className="hs-qh">
              <span className="hs-qn">{question.number}.</span>
              <span>{question.text}</span>
            </p>
            <ul className="hs-lines">
              {question.lines.map((line, index) => {
                const delay = line.before !== line.after ? order++ * STAGGER_MS : 0;
                return <Line key={`${round}-${index}`} line={line} phase={phase} delay={delay} seed={`landing:${question.number}:${index}`} />;
              })}
            </ul>
          </div>
        ))}
      </div>
      <figcaption className="hs-cap">
        <span className="hs-cap-row">
          {/* In the page from the start (a screen reader reads it any time); the eye sees it once the answer has played. */}
          <span className="hs-change" data-shown={phase === 'after' ? '' : undefined}>
            {SHEET_CHANGE}
          </span>
          {!reduce && (
            <button type="button" className="hs-replay" onClick={() => replay(REPLAY_LOOK_MS)} disabled={phase !== 'after'} data-shown={phase === 'after' ? '' : undefined}>
              {REPLAY_LABEL}
            </button>
          )}
        </span>
        <span className="hs-rule">{ty(`${SHEET_RULE} ${SHEET_BACK}`)}</span>
      </figcaption>
    </figure>
  );
}
