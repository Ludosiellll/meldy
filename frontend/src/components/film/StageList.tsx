/**
 * The cheat sheet on a reel's stage in Meldy's own look (decision 2026-10-10): the questions in Onest, each line with
 * its marker — a dot for a main point, a dash for a detail, a yellow dot once it is named, no marker and a strike once
 * it is erased — and the map of the whole sheet, one rounded square per line. Moved by the reel's clock (listLine.ts),
 * never by CSS animations, so a paused, sought or exported frame shows exactly the moment it names.
 *
 * Ink and yellow never blend: a named line's ink marker shrinks away and the yellow dot springs up in its place, and a
 * map square swaps its fill the same way; an erased line's square keeps only its outline.
 */
import { useMemo, useRef } from 'react';
import { opacity, put, text as setText, useEls, useFrame } from '../reel/engine';
import { clamp, ease, mix, seg } from '../reel/timeline';
import { STRUCK_AT, lineAt, leftAt, keepsNote, type ListFrame, type ListLine, type ListLook } from './listLine';
import './stageList.css';

export interface ListQuestion {
  /** The department's number. */
  number: number;
  text: string;
  lines: readonly ListLine[];
}

type Rgb = readonly [number, number, number];

const INK: Rgb = [11, 18, 28];
const MUTED: Rgb = [75, 81, 91];
const FAINT: Rgb = [138, 143, 151];

const TEXT: Record<ListLook, Rgb> = { left: INK, once: MUTED, gone: FAINT };

const rgba = (c: Rgb, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Number(clamp(a).toFixed(3))})`;
const blend = (a: Rgb, b: Rgb, p: number): Rgb => [mix(a[0], b[0], p), mix(a[1], b[1], p), mix(a[2], b[2], p)];

/** How much of a look's mark shows (0 → 1) at a frame: the old one shrinks away first, the new one springs up after. */
function shown(f: ListFrame, look: ListLook): number {
  const was = f.fromLook === look ? 1 : 0;
  const is = f.look === look ? 1 : 0;
  if (f.look === f.fromLook || was === is) return is;
  if (was) return 1 - ease.in(clamp(f.p / 0.42));
  return clamp(ease.back(clamp((f.p - 0.42) / 0.58)), 0, 1.3);
}

/**
 * How far a moving line's words have come: their colour, and the strike over them. To «gone» the strike runs left to
 * right first and the words fade after it; back from «gone» the strike lifts and the words come back.
 */
export function progressOf(f: ListFrame): { colour: number; strike: number } {
  if (f.look === f.fromLook) return { colour: 1, strike: f.look === 'gone' ? 1 : 0 };
  if (f.look === 'gone') return { colour: ease.inOut(clamp((f.p - 0.3) / 0.7)), strike: ease.inOut(clamp(f.p / STRUCK_AT)) };
  if (f.fromLook === 'gone') return { colour: ease.out(f.p), strike: 1 - ease.inOut(clamp(f.p / 0.7)) };
  return { colour: ease.out(f.p), strike: 0 };
}

const scale = (value: number) => (value <= 0.001 ? 'scale(0)' : `scale(${value.toFixed(3)})`);

function paintLine(f: ListFrame, els: { mark?: HTMLElement; dot?: HTMLElement; words?: HTMLElement; note?: HTMLElement }) {
  const { colour, strike } = progressOf(f);
  put(els.words, 'color', rgba(blend(TEXT[f.fromLook], TEXT[f.look], colour)));
  put(els.words, '--sl-s', strike.toFixed(3));
  put(els.mark, 'transform', scale(shown(f, 'left')));
  put(els.dot, 'transform', scale(shown(f, 'once')));

  if (!els.note) return;
  const moving = f.p < 1;
  const leaving = moving && f.noteBefore && f.noteBefore !== f.note ? clamp(1 - f.p / 0.2) : 0;
  if (leaving > 0) {
    setText(els.note, f.noteBefore ?? '');
    opacity(els.note, leaving);
    return;
  }
  setText(els.note, f.note ?? '');
  opacity(els.note, f.note ? (moving && f.noteBefore !== f.note ? clamp((f.p - 0.55) / 0.45) : 1) : 0);
}

/** The questions and their lines. */
export function StageList({ questions, className }: { questions: readonly ListQuestion[]; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const { all } = useEls(root);
  const lines = useMemo(() => questions.flatMap((question) => question.lines), [questions]);
  useFrame((l) => {
    const marks = all('mark');
    const dots = all('dot');
    const words = all('words');
    const notes = all('note');
    lines.forEach((line, index) => paintLine(lineAt(line, l), { mark: marks[index], dot: dots[index], words: words[index], note: notes[index] }));
  });
  return (
    <div ref={root} className={`sl ${className ?? ''}`}>
      {questions.map((question) => (
        <div key={question.number} className="sl-q">
          <p className="sl-qh">
            <span className="sl-qn">{question.number}.</span>
            <span>{question.text}</span>
          </p>
          <ul className="sl-lines">
            {question.lines.map((line, index) => (
              <li key={index} className="sl-line">
                <span className="sl-mark-box">
                  <i data-a="mark" className={`sl-mark sl-mark--${line.essential ? 'main' : 'detail'}`} />
                  <i data-a="dot" className="sl-mark sl-mark--once" style={{ transform: 'scale(0)' }} />
                </span>
                <span className="sl-body">
                  <span data-a="words" className="sl-words">
                    {line.text}
                  </span>
                  {/* Every line has a note slot (the frame finds lines and notes by index); a line that never has a
                      note gives it no room. */}
                  <span data-a="note" className="sl-note" hidden={!keepsNote(line)} style={{ opacity: 0 }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * The map of the whole sheet: one rounded square per line in the sheet's order — ink while the line stands, yellow
 * once it is named, an empty outline once it is erased. A square swaps its fill with its line, with a small spring.
 */
export function StageMap({ groups, className }: { groups: ReadonlyArray<readonly ListLine[]>; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const { all } = useEls(root);
  const lines = useMemo(() => groups.flat(), [groups]);
  useFrame((l) => {
    const inks = all('sqk');
    const yellows = all('sqy');
    lines.forEach((line, index) => {
      const f = lineAt(line, l);
      put(inks[index], 'transform', scale(shown(f, 'left')));
      put(yellows[index], 'transform', scale(shown(f, 'once')));
    });
  });
  return (
    <div ref={root} className={`sl-map ${className ?? ''}`} aria-hidden="true">
      {lines.map((_, index) => (
        <i key={index}>
          <b data-a="sqk" className="sl-sq-ink" />
          <b data-a="sqy" className="sl-sq-once" style={{ transform: 'scale(0)' }} />
        </i>
      ))}
    </div>
  );
}

/** «строк осталось из 47» under the big number, as the exam page's counter says it (sheet copy counterLabel). */
export function leftLabel(left: number, total: number): string {
  const a = left % 100;
  const b = left % 10;
  const word = a >= 11 && a <= 14 ? 'строк' : b === 1 ? 'строка' : b >= 2 && b <= 4 ? 'строки' : 'строк';
  const verb = b === 1 && a !== 11 ? 'осталась' : 'осталось';
  return `${word} ${verb} из ${total}`;
}

/** The big number of the sheet's card: the lines left, counting down as the answer erases them. */
export function StageCount({ lines, className }: { lines: readonly ListLine[]; className?: string }) {
  const root = useRef<HTMLParagraphElement>(null);
  const { one } = useEls(root);
  useFrame((l) => {
    const left = leftAt(lines, l);
    setText(one('n'), String(left));
    setText(one('label'), leftLabel(left, lines.length));
  });
  const left = leftAt(lines, 0);
  return (
    <p ref={root} className={`sl-count ${className ?? ''}`}>
      <b data-a="n">{left}</b>
      <span data-a="label">{leftLabel(left, lines.length)}</span>
    </p>
  );
}

/**
 * What an answer did, in the exam page's words, under the sheet: each line shows from its moment until the next one (a
 * negative moment: there from the scene's start).
 */
export function ListCaption({ items, className }: { items: ReadonlyArray<{ at: number; text: string }>; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const { all } = useEls(root);
  useFrame((l) => {
    all('cap').forEach((cap, index) => {
      const item = items[index];
      const next = items[index + 1]?.at;
      const come = item.at < 0 ? 1 : seg(l, item.at, 320);
      const show = come * (next === undefined ? 1 : 1 - seg(l, next - 280, 240));
      put(cap, 'transform', `translate3d(0,${(12 * (1 - (item.at < 0 ? 1 : ease.out(seg(l, item.at, 420))))).toFixed(2)}px,0)`);
      opacity(cap, show);
    });
  });
  return (
    <div ref={root} className={`sl-cap ${className ?? ''}`}>
      {items.map((item) => (
        <p key={`${item.at}-${item.text}`} data-a="cap" className="sl-cap-t" style={{ opacity: 0 }}>
          {item.text}
        </p>
      ))}
    </div>
  );
}
