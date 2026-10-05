import { Fragment, useMemo } from 'react';
import { PencilSvg, arrow, seedFrom, type Pt } from '../../marks';

/**
 * A handwritten line with its arrows (spec 5.2). Caveat has no ↑ ↓ → ← ⇒, and the system font that
 * would stand in looks typed, so each arrow is drawn in ink from the marks kit (`arrow()`), 0.9em
 * wide, aria-hidden; the real character stays in the text, visually hidden, for copying and for
 * screen readers.
 */
const ARROWS = /([↑↓→←⇒])/;

type Direction = '↑' | '↓' | '→' | '←' | '⇒';

const W = 17;
const H = 18;

function ends(direction: Direction): [Pt, Pt] {
  switch (direction) {
    case '↑':
      return [[W / 2, H - 2], [W / 2, 3]];
    case '↓':
      return [[W / 2, 3], [W / 2, H - 2]];
    case '←':
      return [[W - 1, H * 0.58], [2, H * 0.58]];
    default:
      return [[1, H * 0.58], [W - 2, H * 0.58]];
  }
}

export function SheetArrow({ direction, seed }: { direction: Direction; seed: number }) {
  const paths = useMemo(() => {
    const [from, to] = ends(direction);
    const main = arrow(from, to, seed, { bow: 0.04, head: 5.5, weight: direction === '⇒' ? 2.6 : 1.9 });
    if (direction !== '⇒') return main;
    // A double arrow: a second shaft just above, without its own head.
    const shift: [Pt, Pt] = [[from[0], from[1] - 3.4], [to[0] - 4, to[1] - 3.4]];
    return [...main, ...arrow(shift[0], shift[1], seed + 7, { bow: 0.03, upto: 0.999, weight: 1.6 })];
  }, [direction, seed]);
  return (
    <span className="cs-arrow">
      <PencilSvg width={W} height={H} paths={paths} pad={2} className="cs-arrow-ink" />
      <span className="sr-only">{direction}</span>
    </span>
  );
}

/** The line's text with its arrows drawn; `seedBase` keeps every arrow's wobble stable. */
export function SheetText({ text, seedBase }: { text: string; seedBase: string }) {
  const parts = useMemo(() => text.split(ARROWS).filter((part) => part !== ''), [text]);
  return (
    <>
      {parts.map((part, index) =>
        ARROWS.test(part) && part.length === 1 ? (
          <SheetArrow key={index} direction={part as Direction} seed={seedFrom(`${seedBase}:${index}`, 0)} />
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
