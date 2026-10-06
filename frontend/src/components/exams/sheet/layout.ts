/**
 * Where the questions go on the paper (spec 5.1): two columns from 760 px of paper width, one
 * below. The split is decided here, in code, from an estimate of each block's height in grid rows,
 * so blocks never jump between columns when a note appears or a line is hidden (CSS columns
 * rebalance on every change). The department's order runs down the first column, then the second.
 */
import type { SheetBlock } from '../../../lib/exams/cheatSheet';

/** One grid row of the paper, px (24 on a computer, 22 on a phone). */
export const ROW_PX = 24;
export const ROW_PX_NARROW = 22;
/** Paper width from which the sheet has two columns. */
export const TWO_COLUMNS_FROM = 760;
/** Paper narrower than this is a phone's: the 22 px grid and smaller type. */
export const NARROW_BELOW = 560;
/** The paper's padding (the right one holds the margin line) and the gap between the columns, px. */
export const PAPER_PAD = { left: 24, right: 72 } as const;
export const PAPER_PAD_NARROW = { left: 16, right: 36 } as const;
export const COLUMN_GAP = 48;

export interface PaperGeometry {
  columns: 1 | 2;
  narrow: boolean;
  /** Grid row, px. */
  row: number;
  /** Width of one column of text, px (two columns: a whole number of grid cells, so both sit on the grid). */
  column: number;
}

/** How a paper of this width (its clientWidth) is laid out. */
export function paperGeometry(width: number): PaperGeometry {
  const narrow = width > 0 && width < NARROW_BELOW;
  const row = narrow ? ROW_PX_NARROW : ROW_PX;
  const pad = narrow ? PAPER_PAD_NARROW : PAPER_PAD;
  const inner = Math.max(0, width - pad.left - pad.right);
  if (width >= TWO_COLUMNS_FROM) {
    return { columns: 2, narrow, row, column: Math.floor((inner - COLUMN_GAP) / 2 / row) * row };
  }
  return { columns: 1, narrow, row, column: inner };
}

export interface RowMetrics {
  /** Printed characters per row (Onest 15 px). */
  print: number;
  /** Handwritten characters per row (Caveat 22 px). */
  hand: number;
  /** Characters of a pencil note per row (Onest 14 px). */
  note: number;
}

/** Characters per row in a column of this width (px): Onest 15 ≈ 7.9 px, Caveat 22 ≈ 8.6 px, Onest 14 ≈ 7.4 px a character. */
export function rowMetrics(columnWidth: number): RowMetrics {
  const width = Math.max(160, columnWidth - 28); // the bullet's gutter
  return {
    print: Math.max(12, Math.floor(width / 7.9)),
    hand: Math.max(10, Math.floor(width / 8.6)),
    note: Math.max(12, Math.floor(width / 7.4)),
  };
}

function rowsFor(text: string, perRow: number): number {
  return Math.max(1, Math.ceil(text.trim().length / perRow));
}

export interface BlockRowOptions {
  /** «Только то, что осталось»: erased lines are hidden; a question with every line erased is only its printed line. */
  hideErased?: boolean;
  /** The pencil note under the block, if any. */
  note?: string | null;
  /** A section title printed above the block. */
  heading?: boolean;
  /** Erased lines that stay in view all the same (the ones an answer has just erased). */
  keep?: ReadonlySet<string>;
  /**
   * Rows a question still to be written is expected to take once written (estimateRows): counted
   * already, so the questions do not move between the columns while the sheet is being written.
   */
  estimate?: number;
}

/** Questions whose lines are still to be written (or written again). */
function toBeWritten(block: SheetBlock): boolean {
  return block.kind === 'unwritten' || block.kind === 'rebuilt';
}

/** The rows of a block's handwritten lines and their notes. */
function lineRows(block: SheetBlock, metrics: RowMetrics): number {
  return block.lines.reduce((sum, line) => sum + rowsFor(line.text, metrics.hand), 0);
}

/** Rows a question to be written is expected to take: the mean of the written ones, else four lines. */
export function estimateRows(blocks: readonly SheetBlock[], metrics: RowMetrics): number {
  const written = blocks.filter((block) => block.kind === 'lines' && block.lines.length > 0);
  if (written.length === 0) return 4;
  return Math.max(1, Math.round(written.reduce((sum, block) => sum + lineRows(block, metrics), 0) / written.length));
}

/** A block's height in grid rows: a section title, the printed question, its lines and their notes, the block's note and one row of air. */
export function blockRows(block: SheetBlock, metrics: RowMetrics, options: BlockRowOptions = {}): number {
  let rows = (options.heading ? 1 : 0) + rowsFor(`${block.number}. ${block.text}`, metrics.print);
  const hidden = (line: SheetBlock['lines'][number]) => Boolean(options.hideErased) && line.status.state === 'erased' && !options.keep?.has(line.key);
  const folded = block.lines.length > 0 && block.lines.every(hidden);
  if (!folded) {
    for (const line of block.lines) {
      const state = line.status.state;
      if (hidden(line)) continue;
      rows += rowsFor(line.text, metrics.hand);
      // The pencil note under it (copy.lineNote).
      if (state === 'missed' || state === 'returned' || state === 'due' || line.status.peekedToday) rows += 1;
    }
    if (options.note) rows += rowsFor(options.note, metrics.note);
    if (options.estimate && toBeWritten(block)) rows += options.estimate;
  }
  return rows + 1;
}

/**
 * The index where the second column starts: the first block whose start is at or past half of the
 * total height (so the first column is never shorter than the second by more than one block).
 */
export function splitIndex(rows: readonly number[]): number {
  if (rows.length < 2) return rows.length;
  const total = rows.reduce((sum, value) => sum + value, 0);
  let before = 0;
  let best = 1;
  let bestGap = Infinity;
  for (let index = 1; index < rows.length; index += 1) {
    before += rows[index - 1];
    const gap = Math.abs(before - (total - before));
    if (gap < bestGap) {
      bestGap = gap;
      best = index;
    }
  }
  return best;
}

/**
 * The blocks of each column. `held`: the index where the second column started before, kept while
 * the sheet is being written (the estimate is close, not exact: no block moves under the pen).
 */
export function splitColumns<T>(blocks: readonly T[], rows: readonly number[], columns: 1 | 2, held: number | null = null): T[][] {
  if (columns === 1 || blocks.length < 2) return [blocks.slice()];
  const index = held !== null && held > 0 && held < blocks.length ? held : splitIndex(rows);
  return [blocks.slice(0, index), blocks.slice(index)];
}

/**
 * The blocks in `count` columns, the department's order down each one: the cut that makes the tallest
 * column as short as it can be (the smallest height that a greedy fill fits in `count` columns).
 */
export function splitMany<T>(blocks: readonly T[], rows: readonly number[], count: number): T[][] {
  const columns = Math.max(1, Math.min(count, blocks.length));
  if (columns <= 1) return [blocks.slice()];
  const fits = (limit: number) => {
    let used = 1;
    let height = 0;
    for (const value of rows) {
      if (value > limit) return false;
      if (height + value > limit) {
        used += 1;
        height = 0;
      }
      height += value;
    }
    return used <= columns;
  };
  let low = Math.max(0, ...rows);
  let high = rows.reduce((sum, value) => sum + value, 0);
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
    if (out[out.length - 1].length > 0 && (height + rows[index] > low || left <= empty)) {
      out.push([]);
      height = 0;
    }
    out[out.length - 1].push(block);
    height += rows[index];
  });
  return out;
}

export interface ZoomPlan {
  columns: number;
  scale: number;
  /** The paper's own width at this many columns, px (before it is scaled). */
  width: number;
}

/**
 * «Весь лист» (spec 7.4): how many columns and what scale show the whole paper in the window — more
 * columns of the same width instead of an ever smaller scale, while that makes the paper larger.
 */
export function zoomPlan(input: { wrapWidth: number; available: number; rows: readonly number[]; geometry: PaperGeometry; maxColumns?: number }): ZoomPlan {
  const { wrapWidth, available, rows, geometry } = input;
  const pad = geometry.narrow ? PAPER_PAD_NARROW : PAPER_PAD;
  const most = Math.max(geometry.columns, Math.min(input.maxColumns ?? 8, rows.length));
  let best: ZoomPlan = { columns: geometry.columns, scale: 1, width: wrapWidth };
  let bestScale = -1;
  for (let count = geometry.columns; count <= most; count += 1) {
    const width = count === geometry.columns ? wrapWidth : pad.left + pad.right + count * geometry.column + (count - 1) * COLUMN_GAP;
    const parts = splitMany(rows, rows, count);
    const tallest = Math.max(0, ...parts.map((part) => part.reduce((sum, value) => sum + value, 0)));
    const height = (tallest + 2) * geometry.row;
    const scale = Math.min(1, wrapWidth / width, available / Math.max(1, height));
    if (scale > bestScale + 0.005) {
      bestScale = scale;
      best = { columns: count, scale, width };
    }
  }
  return best;
}
