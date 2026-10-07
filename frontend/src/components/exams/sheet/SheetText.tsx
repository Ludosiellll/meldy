import { Fragment, useMemo } from 'react';
import { sample, seedFrom, tapered, type Pt } from '../../marks';

/**
 * A handwritten line with its arrows (spec 5.2). Caveat has no ↑ ↓ → ← ⇒, and a system font that
 * would stand in looks typed, so each arrow is drawn in ink with the strokes of the marks kit
 * (sample + tapered: the same hand as every pencil mark), on the text's baseline and at the size of
 * the handwriting; it is aria-hidden, and the real character stays in the text, visually hidden,
 * for copying and for screen readers. The head follows the arrow's straight direction, not the
 * wobble of its shaft, so a short → never tips into ↘.
 */
const ARROWS = /([↑↓→←⇒])/;

type Direction = '↑' | '↓' | '→' | '←' | '⇒';

/** The box of each arrow in px of a 22 px hand; the SVG is sized in em, so it follows the font. */
const BOX: Record<Direction, { w: number; h: number }> = {
  '→': { w: 20, h: 14 },
  '←': { w: 20, h: 14 },
  '⇒': { w: 22, h: 14 },
  '↑': { w: 12, h: 18 },
  '↓': { w: 12, h: 18 },
};
const HAND_PX = 22;

function stroke(points: Pt[], seed: number, weight: number, amp: number): string {
  return tapered(sample(points, seed, { step: 4, amp }), weight, weight * 0.5);
}

/** A shaft from `from` to `to` and a head of two strokes at the tip. */
function single(from: Pt, to: Pt, seed: number, head = 5.2): string[] {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const wings = [-0.52, 0.5].map((delta, k) => {
    const a = angle + Math.PI + delta;
    const tail: Pt = [to[0] + Math.cos(a) * head, to[1] + Math.sin(a) * head];
    return stroke([tail, to], seed + 11 + k, 1.75, 0.15);
  });
  return [stroke([from, to], seed, 1.9, 0.3), ...wings];
}

export function arrowPaths(direction: Direction, seed: number): string[] {
  switch (direction) {
    case '→':
      return single([2, 7.6], [18, 7.2], seed);
    case '←':
      return single([18, 7.2], [2, 7.6], seed);
    case '↑':
      return single([6, 17], [6.3, 2.2], seed, 4.8);
    case '↓':
      return single([6.3, 2], [6, 16.8], seed, 4.8);
    case '⇒':
    default: {
      // Two shafts and one open head.
      const tip: Pt = [20, 7.3];
      const wings = [
        stroke([[14.2, 2.4], tip], seed + 11, 1.75, 0.15),
        stroke([[14.2, 12.2], tip], seed + 12, 1.75, 0.15),
      ];
      return [stroke([[2, 5.1], [16.8, 5.0]], seed, 1.7, 0.25), stroke([[2, 9.6], [16.8, 9.5]], seed + 5, 1.7, 0.25), ...wings];
    }
  }
}

export function SheetArrow({ direction, seed }: { direction: Direction; seed: number }) {
  const paths = useMemo(() => arrowPaths(direction, seed), [direction, seed]);
  const box = BOX[direction];
  return (
    <span className="cs-arrow" data-dir={direction}>
      <svg
        className="cs-arrow-ink"
        viewBox={`0 0 ${box.w} ${box.h}`}
        style={{ width: `${(box.w / HAND_PX).toFixed(3)}em` }}
        aria-hidden="true"
        focusable="false"
      >
        {paths.map((d, index) => (
          <path key={index} d={d} />
        ))}
      </svg>
      <span className="sr-only">{direction}</span>
    </span>
  );
}

/**
 * The line's words with no arrow alone at the start of a row: ↑ and ↓ hold on to the word before
 * them, → ⇒ ← to the word after them (a no-break space instead of the space).
 */
export function gluedArrows(text: string): string {
  return text.replace(/[ \t]+([↑↓])/g, '\u00a0$1').replace(/([→⇒←])[ \t]+/g, '$1\u00a0');
}

/**
 * The line's text with its arrows drawn; `seedBase` keeps every arrow's wobble stable. A word and the
 * arrow glued to it are one unbreakable piece (`.cs-glue`): a no-break space next to an inline SVG
 * still lets the browser break there, and «↓» stood alone at the start of a row.
 */
export function SheetText({ text, seedBase }: { text: string; seedBase: string }) {
  const pieces = useMemo(() => {
    // Each part keeps its index in the whole line (the arrows' seeds), grouped by the spaces that may break.
    const parts = gluedArrows(text).split(ARROWS).filter((part) => part !== '');
    const groups: Array<{ glued: boolean; parts: Array<{ text: string; index: number }> }> = [];
    let current: { glued: boolean; parts: Array<{ text: string; index: number }> } = { glued: false, parts: [] };
    parts.forEach((part, index) => {
      if (part.length === 1 && ARROWS.test(part)) {
        current.glued = true;
        current.parts.push({ text: part, index });
        return;
      }
      // A space that may break ends a piece; the text around it starts the next.
      const spaced = part.split(/( +)/);
      spaced.forEach((chunk, at) => {
        if (/^ +$/.test(chunk)) {
          if (current.parts.length > 0) groups.push(current);
          groups.push({ glued: false, parts: [{ text: chunk, index }] });
          current = { glued: false, parts: [] };
        } else if (chunk !== '' || at === 0) {
          if (chunk !== '') current.parts.push({ text: chunk, index });
        }
      });
    });
    if (current.parts.length > 0) groups.push(current);
    return groups;
  }, [text]);
  const render = (part: { text: string; index: number }, key: number) =>
    part.text.length === 1 && ARROWS.test(part.text) ? (
      <SheetArrow key={key} direction={part.text as Direction} seed={seedFrom(`${seedBase}:${part.index}`, 0)} />
    ) : (
      <Fragment key={key}>{part.text}</Fragment>
    );
  return (
    <>
      {pieces.map((piece, index) =>
        piece.glued ? (
          <span key={index} className="cs-glue">
            {piece.parts.map(render)}
          </span>
        ) : (
          <Fragment key={index}>{piece.parts.map(render)}</Fragment>
        ),
      )}
    </>
  );
}
