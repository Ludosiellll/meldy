/**
 * «Шпаргалка, которая исчезает» on a reel's stage: the exam page's sheet as the landing's first screen
 * draws it (components/home/HeroSheet), at its own sizes (the scene scales the paper as a whole), but
 * moved by the reel's clock instead of CSS animations — so a paused, sought or exported frame shows
 * exactly the moment it names. Squared paper, the department's questions printed, the answer points
 * by hand («Meldy Hand», components/exams/sheet/sheetFont), the eraser's two passes, the graphite
 * wave under a missed point, the date of the answer written in the corner as on «История шпаргалки».
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { flag, opacity, put, text as setText, useEls, useFrame } from '../reel/engine';
import { bezier, clamp, mix, seg } from '../reel/timeline';
import { SheetText } from '../exams/sheet/SheetText';
import { isSheetFontSettled, loadSheetFont } from '../exams/sheet/sheetFont';
import { Mark, PencilUnder, seedFrom } from '../marks';
import { BULLET, LEVEL, PATCH, WAVE, WHOLE, inkAt, keepsNoteRow, statesOf, type InkFrame, type InkLine, type InkState } from './ink';
import './stageSheet.css';

export interface StageQuestion {
  /** The department's number. */
  number: number;
  /** The department's words, printed. */
  text: string;
  /** Every main line erased: the graphite tick in the margin by the number. */
  learned?: boolean;
  lines: readonly InkLine[];
}

/** A date written in the paper's corner from scene time `at` (negative: there from the scene's start). */
export interface StageDate {
  at: number;
  text: string;
}

/** The eraser's pass: the exam page's cubic-bezier(.4, 0, .2, 1). */
const pass = bezier(0.4, 0, 0.2, 1);

/** Where a moving line's note fades in (share of the move), and its old note goes. */
const NOTE_FROM: Record<NonNullable<InkFrame['move']>, number> = { rub: 0.85, erase: 0.85, return: 0.82, miss: 0.6 };

function maskImage(left: InkState, right: InkState): string | null {
  if (LEVEL[left] === 1 && LEVEL[right] === 1 && WHOLE[left] && WHOLE[right]) return null;
  const level = (state: InkState) => `rgba(0,0,0,${LEVEL[state]})`;
  const whole = (state: InkState) => (WHOLE[state] ? '#000' : 'transparent');
  // The level ∩ (whole ink ∪ (pass A ∩ pass B)): the exam page's masks, with the front of the move
  // between 46 % and 54 % of a layer 225 % wide.
  return `linear-gradient(90deg,${level(left)} 46%,${level(right)} 54%),linear-gradient(90deg,${whole(left)} 46%,${whole(right)} 54%),var(--ss-pass-a),var(--ss-pass-b)`;
}

/** Writes one line of the sheet for its frame `f` (also used by the landing film's paper). */
export function paintLine(f: InkFrame, els: { line?: HTMLElement; ink?: HTMLElement; bullet?: HTMLElement; patch?: HTMLElement; note?: HTMLElement }) {
  const { line, ink, bullet, patch, note } = els;
  let left = f.state;
  let right = f.state;
  let position = 0;
  let sweep = 1;
  let wave = WAVE[f.state];
  if (f.move === 'rub' || f.move === 'erase') sweep = pass(f.p);
  if (f.move === 'return') sweep = pass(clamp(f.p / 0.5));
  if (f.move === 'rub' || f.move === 'return') {
    // → the new state from the left.
    left = f.state;
    right = f.from;
    position = (1 - sweep) * 100;
  } else if (f.move === 'erase') {
    // ← the second pass from the right.
    left = f.from;
    right = f.state;
    position = sweep * 100;
  }
  if (f.move === 'return') wave = clamp((f.p - 0.5) / 0.38);
  if (f.move === 'miss') wave = clamp(f.p / 0.7);
  if (f.move === 'rub' || f.move === 'erase') wave = mix(WAVE[f.from], WAVE[f.state], sweep);

  const mask = maskImage(left, right);
  flag(ink, 'is-masked', mask !== null);
  put(ink, '-webkit-mask-image', mask ?? 'none');
  put(ink, 'mask-image', mask ?? 'none');
  if (mask) {
    const at = `${position.toFixed(2)}% 0,${position.toFixed(2)}% 0,0 0,0 0`;
    put(ink, '-webkit-mask-position', at);
    put(ink, 'mask-position', at);
  }
  put(bullet, 'opacity', mix(BULLET[f.from], BULLET[f.state], sweep).toFixed(3));
  opacity(patch, mix(PATCH[f.from], PATCH[f.state], f.move === 'return' ? 1 : sweep));
  put(line, '--ss-wave', wave.toFixed(3));

  if (!note) return;
  if (f.move) {
    const from = NOTE_FROM[f.move];
    const leaving = f.noteBefore && f.noteBefore !== f.note ? clamp(1 - f.p / 0.18) : 0;
    if (leaving > 0) {
      setText(note, f.noteBefore ?? '');
      opacity(note, leaving);
      return;
    }
    setText(note, f.note ?? '');
    opacity(note, f.note ? (f.noteBefore === f.note ? 1 : clamp((f.p - from) / (1 - from))) : 0);
    return;
  }
  setText(note, f.note ?? '');
  opacity(note, f.note ? 1 : 0);
}

/** A rough height of the paper (px at its own size) where nothing is laid out (tests, the first render). */
function estimateHeight(questions: readonly StageQuestion[]): number {
  const rows = questions.reduce((sum, question) => sum + 1 + question.lines.length * 2, 0) + Math.max(0, questions.length - 1) + 2;
  return rows * 26;
}

/**
 * The paper at `zoom` times its own size, taking that room in the layout: it is measured once (and
 * again if the handwriting's font changes its lines), never on a frame.
 */
export function StageSheet({
  questions,
  width,
  zoom = 1,
  dates = [],
  seed,
  className,
  style,
}: {
  questions: readonly StageQuestion[];
  /** The paper's width at the sheet's own size (px); it is shown `zoom` times larger. */
  width: number;
  zoom?: number;
  dates?: readonly StageDate[];
  /** Keeps every pencil mark's wobble the same on every frame and every visit. */
  seed: string;
  className?: string;
  style?: CSSProperties;
}) {
  const root = useRef<HTMLDivElement>(null);
  const { all } = useEls(root);
  const lines = useMemo(() => questions.flatMap((question) => question.lines), [questions]);
  const [fontReady, setFontReady] = useState(isSheetFontSettled);
  const [height, setHeight] = useState(() => estimateHeight(questions));

  // The handwriting waits for its font (at most 1.5 s), so no line is laid out anew under the eye.
  useEffect(() => {
    let alive = true;
    void loadSheetFont().then(() => {
      if (alive) setFontReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    const paper = root.current;
    if (!paper) return undefined;
    const measure = () => {
      const next = paper.offsetHeight;
      if (next > 0) setHeight((previous) => (Math.abs(previous - next) > 0.5 ? next : previous));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(paper);
    return () => observer.disconnect();
  }, [fontReady]);

  useFrame((l) => {
    const rows = all('line');
    const inks = all('ink');
    const bullets = all('bullet');
    const patches = all('patch');
    const notes = all('note');
    lines.forEach((line, index) => {
      paintLine(inkAt(line, l), { line: rows[index], ink: inks[index], bullet: bullets[index], patch: patches[index], note: notes[index] });
    });
    all('date').forEach((date, index) => {
      const spec = dates[index];
      const next = dates[index + 1];
      // A date of a scene's start is there already; a later one is written in, left to right.
      const write = spec.at < 0 ? 1 : seg(l, spec.at, 450);
      const gone = next ? seg(l, next.at - 260, 220) : 0;
      put(date, 'clip-path', `inset(-30% ${((1 - write) * 100).toFixed(2)}% -30% 0)`);
      opacity(date, (l >= spec.at ? 1 : 0) * (1 - gone));
    });
  });

  let index = 0;
  return (
    <div className={`ss-box ${className ?? ''}`} style={{ width: Math.round(width * zoom), height: Math.round(height * zoom), ...style }}>
      <div ref={root} className="ss" style={{ width, transform: zoom === 1 ? undefined : `scale(${zoom})` }} data-font={fontReady ? 'ready' : 'waiting'}>
        {dates.length > 0 ? (
          <div className="ss-dates">
            {dates.map((date) => (
              <p key={`${date.at}-${date.text}`} data-a="date" className="ss-date" style={{ opacity: 0 }}>
                {date.text}
              </p>
            ))}
          </div>
        ) : null}
        {questions.map((question) => (
          <div key={question.number} className="ss-q">
            {question.learned ? (
              <span className="ss-tick">
                <Mark kind="tick" seed={seedFrom(seed, question.number, 'tick')} width={20} height={16} hand="graphite" />
              </span>
            ) : null}
            <p className="ss-qh">
              <span className="ss-qn">{question.number}.</span>
              <span>{question.text}</span>
            </p>
            <ul className="ss-lines">
              {question.lines.map((line) => {
                const at = index;
                index += 1;
                const states = statesOf(line);
                const waved = states.some((state) => WAVE[state] > 0);
                const noted = keepsNoteRow(line);
                const key = `${seed}:${question.number}:${at}`;
                const words = <SheetText text={line.text} seedBase={key} />;
                return (
                  <li key={key} data-a="line" className="ss-line">
                    <span data-a="bullet" className="ss-bullet">
                      {line.essential ? '•' : '–'}
                    </span>
                    <span className="ss-body">
                      <span data-a="patch" className="ss-patch" style={{ opacity: 0 }} />
                      <span data-a="ink" className="ss-ink">
                        {waved ? (
                          <PencilUnder seed={seedFrom(key, 'wave')} hand="graphite" kind="wave" weight={1.8} dy={-1} watch={line.text}>
                            {words}
                          </PencilUnder>
                        ) : (
                          words
                        )}
                      </span>
                    </span>
                    {/* Every line has a note slot; a line that never has a note gives it no room. */}
                    <span data-a="note" className="ss-note" hidden={!noted} style={{ opacity: 0 }} />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * What an answer did, in the exam page's words (copy.ts changeSentence), by the paper: each line shows
 * from its moment until `until` (or the next line), in the same place; a negative moment means it is
 * there from the scene's start.
 */
export function SheetCaption({ items, className }: { items: ReadonlyArray<{ at: number; until?: number; text: string }>; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const { all } = useEls(root);
  useFrame((l) => {
    all('cap').forEach((cap, index) => {
      const item = items[index];
      const end = item.until ?? items[index + 1]?.at;
      // A line of a scene's start (negative `at`) is there already: the scene before handed it over.
      const come = item.at < 0 ? 1 : seg(l, item.at, 320);
      const show = come * (end === undefined ? 1 : 1 - seg(l, end - 280, 240));
      put(cap, 'transform', `translate3d(0,${(10 * (1 - (item.at < 0 ? 1 : seg(l, item.at, 420)))).toFixed(2)}px,0)`);
      opacity(cap, show);
    });
  });
  return (
    <div ref={root} className={`ss-cap ${className ?? ''}`}>
      {items.map((item) => (
        <p key={`${item.at}-${item.text}`} data-a="cap" className="ss-cap-t" style={{ opacity: 0 }}>
          {item.text}
        </p>
      ))}
    </div>
  );
}
