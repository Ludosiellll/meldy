/**
 * Where the questions go on the sheet's card (spec 5.1, in the app's own look since 2026-10-10: notes
 * 40_Decisions/2026-10-10_cheat-sheet-native-look): two columns from 760 px of card, one below. The split is
 * decided here, in code, from an estimate of each block's height in px, so blocks never jump between columns
 * when a caption appears or a line is hidden (CSS columns rebalance on every change). The department's order
 * runs down the first column, then the second. The sizes here are the ones of sheet.css.
 */
import type { SheetBlock } from '../../../lib/exams/cheatSheet';
import { lineNote } from './copy';

/** One row of a title or a line, px (Onest 17/24 and 16/24): every line is a 24 px target at least (WCAG 2.5.8). */
export const ROW_PX = 24;
/** The air above and under a line's words (its button), px. */
export const LINE_PAD = 3;
/** Between a question's title and its first line, px. */
export const LINES_GAP = 5;
/** One row of the caption under a line (Onest 13/18), px. */
export const CAPTION_PX = 18;
/** Meldy's note under a question (Onest 14/20): its rows and the air above it, px. */
export const NOTE_PX = 20;
export const NOTE_GAP = 6;
/** After a question, px. */
export const BLOCK_GAP = 20;
/** A section's title with its air, px. */
export const SECTION_PX = 36;
/** Card width from which the sheet has two columns. */
export const TWO_COLUMNS_FROM = 760;
/** A card narrower than this is a phone's: less padding. */
export const NARROW_BELOW = 560;
/** The card's padding and the gap between the columns, px. */
export const PAPER_PAD = { top: 30, right: 34, bottom: 26, left: 34 } as const;
export const PAPER_PAD_NARROW = { top: 20, right: 18, bottom: 16, left: 18 } as const;
export const COLUMN_GAP = 40;

/** Onest 17 px, weight 500: the widest digit and the period after a question's number, px. */
const DIGIT_PX = 8.5;
const DOT_PX = 4.25;
/** Average px of a character of the example's real titles, lines and notes (measured in Chromium). */
const TITLE_CHAR = 8.44;
const LINE_CHAR = 7.52;
const CAPTION_CHAR = 6.11;
const NOTE_CHAR = 6.5;
/** Words wrap whole: a row holds a little less than its width in average characters. */
const FILL = 0.94;

export interface PaperGeometry {
  columns: 1 | 2;
  narrow: boolean;
  /** Width of one column of the card, px. */
  column: number;
}

/** How a card of this width (its clientWidth) is laid out. */
export function paperGeometry(width: number): PaperGeometry {
  const narrow = width > 0 && width < NARROW_BELOW;
  const pad = narrow ? PAPER_PAD_NARROW : PAPER_PAD;
  const inner = Math.max(0, width - pad.left - pad.right);
  if (width >= TWO_COLUMNS_FROM) return { columns: 2, narrow, column: Math.floor((inner - COLUMN_GAP) / 2) };
  return { columns: 1, narrow, column: inner };
}

/**
 * The column of the questions' numbers, and of the lines' markers under them: the widest «12.» of the sheet and
 * its air, at least 28 px (the titles and the lines' words start at one edge on the whole sheet).
 */
export function numberGutter(blocks: readonly Pick<SheetBlock, 'number'>[]): number {
  const longest = blocks.reduce((most, block) => Math.max(most, String(block.number).length), 1);
  return Math.max(28, Math.ceil(longest * DIGIT_PX + DOT_PX + 12));
}

export interface RowMetrics {
  /** Characters per row of a question's title (Onest 17, 600). */
  title: number;
  /** Of a line (Onest 16). */
  line: number;
  /** Of a caption under a line (Onest 13). */
  caption: number;
  /** Of Meldy's note under a question (Onest 14). */
  note: number;
}

/** Characters per row in a column of this width (px), after the number's column. */
export function rowMetrics(columnWidth: number, gutter = 28): RowMetrics {
  const width = Math.max(160, columnWidth - gutter) * FILL;
  return {
    title: Math.max(12, Math.floor(width / TITLE_CHAR)),
    line: Math.max(10, Math.floor(width / LINE_CHAR)),
    caption: Math.max(12, Math.floor(width / CAPTION_CHAR)),
    note: Math.max(12, Math.floor(width / NOTE_CHAR)),
  };
}

function rowsFor(text: string, perRow: number): number {
  return Math.max(1, Math.ceil(text.trim().length / perRow));
}

export interface BlockHeightOptions {
  /** «Скрыть строки, стёртые совсем»: erased lines are hidden; a question with every line erased is only its title. */
  hideErased?: boolean;
  /** Meldy's note under the block, if any. */
  note?: string | null;
  /** A section title above the block. */
  heading?: boolean;
  /** Erased lines that stay in view all the same (the ones an answer has just erased). */
  keep?: ReadonlySet<string>;
  /**
   * Px a question still to be written is expected to take once written (estimateHeight): counted already, so the
   * questions do not move between the columns while the sheet is being written.
   */
  estimate?: number;
  /** Lines that say in a caption what their look means (CheatSheet.explainedLines). */
  explained?: ReadonlyMap<string, string>;
}

/** Questions whose lines are still to be written (or written again). */
function toBeWritten(block: SheetBlock): boolean {
  return block.kind === 'unwritten' || block.kind === 'rebuilt';
}

/** The lines of a block with their air, px (captions not counted). */
function linesHeight(block: SheetBlock, metrics: RowMetrics): number {
  return block.lines.reduce((sum, line) => sum + rowsFor(line.text, metrics.line) * ROW_PX + 2 * LINE_PAD, 0);
}

/** Px a question to be written is expected to take under its title: the mean of the written ones, else four lines. */
export function estimateHeight(blocks: readonly SheetBlock[], metrics: RowMetrics): number {
  const written = blocks.filter((block) => block.kind === 'lines' && block.lines.length > 0);
  if (written.length === 0) return LINES_GAP + 4 * (ROW_PX + 2 * LINE_PAD);
  return LINES_GAP + Math.round(written.reduce((sum, block) => sum + linesHeight(block, metrics), 0) / written.length);
}

/** A block's height, px: a section title, the question's title, its lines and their captions, the block's note and the air after it. */
export function blockHeight(block: SheetBlock, metrics: RowMetrics, options: BlockHeightOptions = {}): number {
  let height = (options.heading ? SECTION_PX : 0) + rowsFor(block.text, metrics.title) * ROW_PX;
  const hidden = (line: SheetBlock['lines'][number]) => Boolean(options.hideErased) && line.status.state === 'erased' && !options.keep?.has(line.key);
  const folded = block.lines.length > 0 && block.lines.every(hidden);
  if (!folded) {
    const shown = block.lines.filter((line) => !hidden(line));
    if (shown.length > 0) height += LINES_GAP;
    for (const line of shown) {
      height += rowsFor(line.text, metrics.line) * ROW_PX + 2 * LINE_PAD;
      // The caption under it: its own (copy.lineNote), or what its look means.
      const caption = lineNote(line.status) ?? options.explained?.get(line.key) ?? null;
      if (caption) height += rowsFor(caption, metrics.caption) * CAPTION_PX;
    }
    if (options.note) height += NOTE_GAP + rowsFor(options.note, metrics.note) * NOTE_PX;
    if (options.estimate && toBeWritten(block)) height += options.estimate;
  }
  return height + BLOCK_GAP;
}

/**
 * The index where the second column starts: the cut where the two columns are closest in height (so the first
 * column is never shorter than the second by more than one block).
 */
export function splitIndex(heights: readonly number[]): number {
  if (heights.length < 2) return heights.length;
  const total = heights.reduce((sum, value) => sum + value, 0);
  let before = 0;
  let best = 1;
  let bestGap = Infinity;
  for (let index = 1; index < heights.length; index += 1) {
    before += heights[index - 1];
    const gap = Math.abs(before - (total - before));
    if (gap < bestGap) {
      bestGap = gap;
      best = index;
    }
  }
  return best;
}

/**
 * The blocks of each column. `held`: the index where the second column started before, kept while the sheet is
 * being written (the estimate is close, not exact: no block moves under the pen).
 */
export function splitColumns<T>(blocks: readonly T[], heights: readonly number[], columns: 1 | 2, held: number | null = null): T[][] {
  if (columns === 1 || blocks.length < 2) return [blocks.slice()];
  const index = held !== null && held > 0 && held < blocks.length ? held : splitIndex(heights);
  return [blocks.slice(0, index), blocks.slice(index)];
}

/**
 * The blocks in `count` columns, the department's order down each one: the cut that makes the tallest column as
 * short as it can be (the smallest height that a greedy fill fits in `count` columns).
 */
export function splitMany<T>(blocks: readonly T[], heights: readonly number[], count: number): T[][] {
  const columns = Math.max(1, Math.min(count, blocks.length));
  if (columns <= 1) return [blocks.slice()];
  const fits = (limit: number) => {
    let used = 1;
    let height = 0;
    for (const value of heights) {
      if (value > limit) return false;
      if (height + value > limit) {
        used += 1;
        height = 0;
      }
      height += value;
    }
    return used <= columns;
  };
  let low = Math.max(0, ...heights);
  let high = heights.reduce((sum, value) => sum + value, 0);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle)) high = middle;
    else low = middle + 1;
  }
  const out: T[][] = [[]];
  let height = 0;
  blocks.forEach((block, index) => {
    // Cut where the limit says so, and keep enough blocks for the columns still to fill.
    const left = blocks.length - index;
    const empty = columns - out.length;
    if (out[out.length - 1].length > 0 && (height + heights[index] > low || left <= empty)) {
      out.push([]);
      height = 0;
    }
    out[out.length - 1].push(block);
    height += heights[index];
  });
  return out;
}

export interface ZoomPlan {
  columns: number;
  scale: number;
  /** The card's own width at this many columns, px (before it is scaled). */
  width: number;
}

/**
 * «Весь лист на экране» (spec 7.4): how many columns and what scale show the whole card in the window — more
 * columns of the same width instead of an ever smaller scale, while that makes the card larger.
 */
export function zoomPlan(input: { wrapWidth: number; available: number; heights: readonly number[]; geometry: PaperGeometry; maxColumns?: number }): ZoomPlan {
  const { wrapWidth, available, heights, geometry } = input;
  const pad = geometry.narrow ? PAPER_PAD_NARROW : PAPER_PAD;
  const most = Math.max(geometry.columns, Math.min(input.maxColumns ?? 8, heights.length));
  let best: ZoomPlan = { columns: geometry.columns, scale: 1, width: wrapWidth };
  let bestScale = -1;
  for (let count = geometry.columns; count <= most; count += 1) {
    const width = count === geometry.columns ? wrapWidth : pad.left + pad.right + count * geometry.column + (count - 1) * COLUMN_GAP;
    const parts = splitMany(heights, heights, count);
    const tallest = Math.max(0, ...parts.map((part) => part.reduce((sum, value) => sum + value, 0)));
    const height = tallest + pad.top + pad.bottom;
    const scale = Math.min(1, wrapWidth / width, available / Math.max(1, height));
    if (scale > bestScale + 0.005) {
      bestScale = scale;
      best = { columns: count, scale, width };
    }
  }
  return best;
}

// ── The map of the lines ────────────────────────────────────────────────────────────────────

export interface MapGeometry {
  /** A square's side and the gap between squares, px. */
  size: number;
  gap: number;
  columns: number;
  rows: number;
  /** The squares' height, px. */
  height: number;
}

/** Sides a square may take, largest first: the map takes the largest that keeps it under its height. */
const MAP_SIZES = [12, 10, 9, 8, 7, 6, 5, 4, 3] as const;

/** The gap between squares of this side, px: half the side, at least one pixel. */
export function mapGap(size: number): number {
  if (size >= 6) return Math.round(size / 2);
  return size >= 4 ? 2 : 1;
}

/**
 * The map of the lines (one square per line, in the sheet's order, in one even grid): the largest squares that
 * keep `count` of them in `width` px under `maxHeight` px — 12 px for a sheet of a few dozen lines, smaller ones
 * and more columns for hundreds; past the smallest size it simply grows taller. `maxSize`: a phone's compact map.
 */
export function mapGeometry(count: number, width: number, options: { maxHeight: number; maxSize?: number }): MapGeometry {
  const sizes = MAP_SIZES.filter((size) => size <= (options.maxSize ?? MAP_SIZES[0]));
  const fit = (size: number): MapGeometry => {
    const gap = mapGap(size);
    const columns = Math.max(1, Math.floor((Math.max(width, size) + gap) / (size + gap)));
    const rows = Math.max(1, Math.ceil(Math.max(0, count) / columns));
    return { size, gap, columns, rows, height: rows * (size + gap) - gap };
  };
  for (const size of sizes) {
    const geometry = fit(size);
    if (geometry.height <= options.maxHeight) return geometry;
  }
  return fit(sizes[sizes.length - 1] ?? 3);
}
