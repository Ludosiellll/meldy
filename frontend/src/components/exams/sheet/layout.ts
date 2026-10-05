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
}

/** A block's height in grid rows: a section title, the printed question, its lines and their notes, the block's note and one row of air. */
export function blockRows(block: SheetBlock, metrics: RowMetrics, options: BlockRowOptions = {}): number {
  let rows = (options.heading ? 1 : 0) + rowsFor(`${block.number}. ${block.text}`, metrics.print);
  const folded = options.hideErased && block.lines.length > 0 && block.lines.every((line) => line.status.state === 'erased');
  if (!folded) {
    for (const line of block.lines) {
      const state = line.status.state;
      if (options.hideErased && state === 'erased') continue;
      rows += rowsFor(line.text, metrics.hand);
      // The pencil note under it (copy.lineNote).
      if (state === 'missed' || state === 'returned' || state === 'due' || line.status.peekedToday) rows += 1;
    }
    if (options.note) rows += rowsFor(options.note, metrics.note);
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

/** The blocks of each column. */
export function splitColumns<T>(blocks: readonly T[], rows: readonly number[], columns: 1 | 2): T[][] {
  if (columns === 1 || blocks.length < 2) return [blocks.slice()];
  const index = splitIndex(rows);
  return [blocks.slice(0, index), blocks.slice(index)];
}
