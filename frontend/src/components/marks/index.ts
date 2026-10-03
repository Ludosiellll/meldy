/**
 * The pencil-mark vocabulary of the interior (redesign spec 3.8): one deterministic module for the
 * whole app, built on components/landing/handStroke.ts. Geometry is pure (geometry.ts); the React
 * components render aria-hidden SVGs, so always say a mark's meaning next to it in words.
 */
export {
  MARK_KINDS,
  MARK_PAD,
  MARK_SIZE,
  MARK_WEIGHT,
  arc,
  arrow,
  foldSeed,
  loop,
  quad,
  sample,
  seedFrom,
  seededRandom,
  shape,
  tapered,
  type MarkKind,
  type MarkPath,
  type Pt,
  type ShapeOptions,
} from './geometry';
export { MARK_DRAW_MS, MARK_STAGGER_MS, MarginStroke, Mark, PencilBrace, PencilSvg, type MarkProps, type PencilHand, type PencilSvgProps } from './PencilSvg';
export { PencilOval, PencilUnder, TextMark, type PencilUnderProps, type TextMarkKind, type TextMarkProps } from './TextMarks';
export { HandPhraseMark, handPhraseFor } from './HandPhrase';
