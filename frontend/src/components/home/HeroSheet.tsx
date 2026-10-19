import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { readReducedMotion, usePrefersReducedMotion } from '../landing/usePrefersReducedMotion';
import { CAME_BACK, Q6, Q7, SHEET_BEFORE, SHEET_SUBJECT } from '../../data/sheetExample';
import { withArrows } from './SheetArrow';

/**
 * The cheat sheet of /try's example exam («Микроэкономика») on the landing, in Meldy's own look (decision 2026-10-10,
 * «Шпаргалка без бумаги»): the number of lines left, the map of the whole sheet — one rounded square per line: ink while
 * it stands, yellow once it is named, an empty outline once it is erased — and questions 6 and 7 as the exam page lists
 * them: a dot for a main point, a dash for a detail, a yellow dot and muted words once named, faint struck-through words
 * once erased.
 *
 * When the card comes into view, one answer plays: the line named the day before is struck off left to right, two
 * lines named for the first time turn yellow, the map loses one square and the number goes down by one; then the card
 * says what the answer did in the exam page's words (copy.ts changeSentence). With reduced motion it stands as after
 * that answer. The card is a picture: a short description says the same for a screen reader.
 */

export type HeroLineState = 'fresh' | 'rubbed' | 'erased' | 'returned';

export interface HeroLine {
  text: string;
  essential: boolean;
  /** The line before the answer the card replays, and after it. */
  before: HeroLineState;
  after: HeroLineState;
  /** The note of a line that came back (no days: the example has no dates of its own). */
  note?: string;
}

export interface HeroQuestion {
  number: number;
  text: string;
  /** Every main line erased. */
  learned?: boolean;
  lines: HeroLine[];
}

const statesOf = (number: number) => SHEET_BEFORE.find((question) => question.number === number)?.states ?? [];

export const HERO_SHEET: readonly HeroQuestion[] = [
  {
    number: Q6.number,
    text: Q6.text,
    learned: true,
    lines: Q6.lines.map((line, index) => {
      const state = statesOf(6)[index] as HeroLineState;
      return { ...line, before: state, after: state };
    }),
  },
  {
    number: Q7.number,
    text: Q7.text,
    lines: [
      { ...Q7.lines[0], before: 'rubbed', after: 'erased' },
      { ...Q7.lines[1], before: 'fresh', after: 'rubbed' },
      { ...Q7.lines[2], before: 'returned', after: 'returned', note: CAME_BACK },
      { ...Q7.lines[3], before: 'fresh', after: 'rubbed' },
    ],
  },
];

/** What the replayed answer did, as the exam page says it after an answer (its no-break spaces too). */
export const SHEET_CHANGE = 'После ответа: 1 строка стёрлась, 2 — наполовину.';
/** The sheet's rule, as the exam page keeps it under the counter (copy.ts SHEET_RULE). */
export const SHEET_RULE = 'Строки стирают только ответы: назвали пункт — наполовину, назвали снова в другой день — совсем.';
export const SHEET_BACK = 'Не назвали потом — строка вернётся.';
export const SHEET_TITLE = 'Шпаргалка';
/** Which example it is. */
export const SHEET_EXAMPLE = `${SHEET_SUBJECT} · пример`;
export const REPLAY_LABEL = 'Показать ещё раз';
/** Elsewhere on the page («Показать на шпаргалке»): plays the answer on this sheet again. */
export const SHEET_REPLAY_EVENT = 'meldy-sheet-replay';

/** The map's three kinds of square, in the words of the sheet's card (decision 2026-10-10). */
export const MAP_LEGEND: ReadonlyArray<{ look: Look; text: string }> = [
  { look: 'left', text: 'осталось' },
  { look: 'once', text: 'названо один раз' },
  { look: 'gone', text: 'стёрто' },
];

type Look = 'left' | 'once' | 'gone';
const LOOK: Record<HeroLineState, Look> = { fresh: 'left', returned: 'left', rubbed: 'once', erased: 'gone' };

/** The map: every line of questions 1–11 (question 12 has none), questions 6 and 7 as the card's own lines. */
const MAP: ReadonlyArray<{ number: number; lines: ReadonlyArray<{ before: HeroLineState; after: HeroLineState }> }> = SHEET_BEFORE.map((question) => {
  const own = HERO_SHEET.find((item) => item.number === question.number);
  return {
    number: question.number,
    lines: own ? own.lines : question.states.map((state) => ({ before: state as HeroLineState, after: state as HeroLineState })),
  };
});
const ALL_LINES = MAP.flatMap((question) => question.lines);
export const SHEET_TOTAL = ALL_LINES.length;
export const LEFT_BEFORE = ALL_LINES.filter((line) => LOOK[line.before] !== 'gone').length;
export const LEFT_AFTER = ALL_LINES.filter((line) => LOOK[line.after] !== 'gone').length;

/** «строк осталось из 47» (sheet copy counterLabel). */
export function leftWords(left: number, total: number): string {
  const a = left % 100;
  const b = left % 10;
  const word = a >= 11 && a <= 14 ? 'строк' : b === 1 ? 'строка' : b >= 2 && b <= 4 ? 'строки' : 'строк';
  return `${word} ${b === 1 && a !== 11 ? 'осталась' : 'осталось'} из ${total}`;
}

const DESCRIPTION = `Пример: шпаргалка экзамена «${SHEET_SUBJECT}», ${SHEET_TOTAL} строк, осталось ${LEFT_AFTER}. У вопроса 6 все главные строки стёрты. У вопроса 7 после ответа одна строка стёрлась, две названы впервые, а одна вернулась: в ответе её пункт не назван.`;

/** The strike over a line named again; a line named for the first time turns yellow after it, one after the other. */
export const STRIKE_MS = 700;
/** A naming: the ink marker shrinks away (220 ms), then the yellow dot springs up (420 ms) — home.css. */
const NAME_MS = 640;
const STAGGER_MS = 300;
/** The sheet is seen as it was before the answer for this long. */
const LOOK_MS = 1600;
const REPLAY_LOOK_MS = 700;

type Phase = 'before' | 'playing' | 'after';

/** Each changing line's moment in the play: the strike first, then the namings. */
const DELAYS = new Map<HeroLine | { before: HeroLineState; after: HeroLineState }, number>();
{
  let order = 0;
  for (const line of HERO_SHEET.flatMap((question) => question.lines)) {
    if (line.before === line.after) continue;
    DELAYS.set(line, order === 0 ? 0 : STRIKE_MS / 2 + (order - 1) * STAGGER_MS);
    order += 1;
  }
}
const PLAY_MS = Math.max(...Array.from(DELAYS.entries()).map(([line, delay]) => delay + (LOOK[line.after] === 'gone' ? STRIKE_MS : NAME_MS)));

function stateFor(line: { before: HeroLineState; after: HeroLineState }, phase: Phase): HeroLineState {
  return phase === 'before' ? line.before : line.after;
}

function timing(line: { before: HeroLineState; after: HeroLineState }, phase: Phase): CSSProperties | undefined {
  const delay = DELAYS.get(line as HeroLine);
  return phase !== 'before' && delay !== undefined ? ({ '--hs-delay': `${delay}ms` } as CSSProperties) : undefined;
}

/** A map square's two fills over its outline: ink and the yellow of a named line (they never blend: one shrinks away
    as the other springs up). */
function Fills() {
  return (
    <>
      <b className="hs-sq-ink" />
      <b className="hs-sq-once" />
    </>
  );
}

/**
 * `labelledBy`: the id of a heading on the page that names the sheet; the flag then says only which example it is.
 */
export default function HeroSheet({ labelledBy }: { labelledBy?: string } = {}) {
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  const reduce = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>(() => (readReducedMotion() ? 'after' : 'before'));
  const [seen, setSeen] = useState(false);
  const [round, setRound] = useState(0);
  // How long the sheet is seen as it was before the answer plays (a replay asked from below waits for the scroll).
  const [look, setLook] = useState(LOOK_MS);

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

  // The sheet is seen as it was for a moment, then the answer plays, then the card says what it did.
  useEffect(() => {
    if (reduce || !seen || phase !== 'before') return undefined;
    const timer = window.setTimeout(() => setPhase('playing'), look);
    return () => window.clearTimeout(timer);
  }, [reduce, seen, phase, round, look]);

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

  return (
    <figure ref={root} className="hs" data-phase={phase} aria-labelledby={labelledBy ? `${labelledBy} ${titleId}` : titleId}>
      <div className="hs-top">
        <span id={titleId} className="hs-flag">
          {labelledBy ? SHEET_EXAMPLE : SHEET_TITLE}
        </span>
        {labelledBy ? null : <span className="hs-meta">{SHEET_EXAMPLE}</span>}
      </div>
      <p className="sr-only">{DESCRIPTION}</p>
      {/* Remounted on every replay: the sheet stands as it was at once, and only the answer moves. */}
      <div key={round} className="hs-pic" aria-hidden="true">
        <p className="hs-count">
          <b>
            <span className="hs-n" data-when="before">
              {LEFT_BEFORE}
            </span>
            <span className="hs-n" data-when="after">
              {LEFT_AFTER}
            </span>
          </b>
          <span className="hs-count-t" data-when="before">
            {leftWords(LEFT_BEFORE, SHEET_TOTAL)}
          </span>
          <span className="hs-count-t" data-when="after">
            {leftWords(LEFT_AFTER, SHEET_TOTAL)}
          </span>
        </p>
        <div className="hs-map">
          {MAP.map((question) =>
            question.lines.map((line, index) => (
              <i
                key={`${question.number}-${index}`}
                data-look={LOOK[stateFor(line, phase)]}
                data-moving={phase !== 'before' && line.before !== line.after ? '' : undefined}
                style={timing(line, phase)}
              >
                <Fills />
              </i>
            )),
          )}
        </div>
        <ul className="hs-legend">
          {MAP_LEGEND.map((item) => (
            <li key={item.look}>
              <i data-look={item.look}>
                <Fills />
              </i>
              {item.text}
            </li>
          ))}
        </ul>
        <div className="hs-list">
          {HERO_SHEET.map((question) => (
            <div key={question.number} className="hs-q" data-learned={question.learned ? '' : undefined}>
              <p className="hs-qh">
                <span className="hs-qn">{question.number}.</span>
                <span>{question.text}</span>
              </p>
              <ul className="hs-lines">
                {question.lines.map((line, index) => {
                  const state = stateFor(line, phase);
                  return (
                    <li
                      key={index}
                      className="hs-line"
                      data-look={LOOK[state]}
                      data-kind={line.essential ? 'main' : 'detail'}
                      data-moving={phase !== 'before' && line.before !== line.after ? '' : undefined}
                      style={timing(line, phase)}
                    >
                      <span className="hs-mark">
                        <i className="hs-mark-ink" />
                        <i className="hs-mark-once" />
                      </span>
                      {/* The words are inline: the strike runs under each row of them, never past their end. */}
                      <span className="hs-body">
                        <span className="hs-words">{withArrows(line.text)}</span>
                        {line.note && state === 'returned' ? <span className="hs-note">{line.note}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="hs-cap">
        {/* In the page from the start (a screen reader reads it any time); the eye sees it once the answer has played. */}
        <span className="hs-change" data-shown={phase === 'after' ? '' : undefined}>
          {SHEET_CHANGE}
        </span>
        {!reduce && (
          <button type="button" className="hs-replay" onClick={() => replay(REPLAY_LOOK_MS)} disabled={phase !== 'after'} data-shown={phase === 'after' ? '' : undefined}>
            {REPLAY_LABEL}
          </button>
        )}
      </figcaption>
    </figure>
  );
}
