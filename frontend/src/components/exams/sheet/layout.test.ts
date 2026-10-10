import { describe, expect, it } from 'vitest';
import { buildSheet, type SheetQuestion } from '../../../lib/exams/cheatSheet';
import {
  BLOCK_GAP,
  blockHeight,
  CAPTION_PX,
  estimateHeight,
  LINE_PAD,
  LINES_GAP,
  mapGap,
  mapGeometry,
  NOTE_GAP,
  NOTE_PX,
  numberGutter,
  paperGeometry,
  ROW_PX,
  rowMetrics,
  SECTION_PX,
  splitColumns,
  splitIndex,
  splitMany,
  zoomPlan,
} from './layout';

/** A line of one row of words with its air, px. */
const LINE = ROW_PX + 2 * LINE_PAD;

function question(position: number, points: number, extra: Partial<SheetQuestion> = {}): SheetQuestion {
  return {
    question_id: `q${position}`,
    position,
    label: String(position),
    section: null,
    text: 'Спрос. Закон спроса и кривая спроса.',
    question_hash: String(position).padStart(32, '0'),
    coverage: 'full',
    coverage_method: 'llm',
    coverage_reason: '',
    missing_note: '',
    rubric:
      points > 0
        ? {
            rubric_id: `00000000-0000-4000-8000-${String(position).padStart(12, '0')}`,
            built_at: null,
            coverage: 'full',
            coverage_note: '',
            materials: [],
            points: Array.from({ length: points }, (_, i) => ({
              id: `p${i + 1}`,
              title: 'Закон спроса: чем выше цена, тем меньше величина спроса',
              short: 'закон: цена ↑ → спрос ↓',
              essential: i < 2,
              source_quote: '',
              source_ids: [],
            })),
          }
        : null,
    ...extra,
  };
}

describe('the paper layout', () => {
  it('counts characters per row from the column width, after the numbers’ column', () => {
    // 360 px of column, 28 px of numbers: Onest 17/600 titles, 16 px lines, 13 px captions, 14 px notes.
    expect(rowMetrics(360)).toEqual({ title: 36, line: 41, caption: 51, note: 48 });
    expect(rowMetrics(360, 40).line).toBeLessThan(41);
    expect(rowMetrics(100).line).toBeGreaterThanOrEqual(10);
  });

  it('lays the card out by its width: two columns from 760 px, a phone’s padding below 560 px', () => {
    expect(paperGeometry(1000)).toEqual({ columns: 2, narrow: false, column: 446 });
    expect(paperGeometry(759)).toEqual({ columns: 1, narrow: false, column: 691 });
    expect(paperGeometry(390)).toEqual({ columns: 1, narrow: true, column: 354 });
    expect(paperGeometry(0).columns).toBe(1);
  });

  it('gives the numbers one column, as wide as the widest number: the titles and the lines start at one edge', () => {
    expect(numberGutter([{ number: '1' }, { number: '9' }])).toBe(28);
    expect(numberGutter([{ number: '1' }, { number: '12' }])).toBe(34);
    expect(numberGutter([{ number: '300' }])).toBe(42);
    expect(numberGutter([])).toBe(28);
  });

  it('measures a block in px: section title, question, lines, notes and the air after it', () => {
    const sheet = buildSheet([question(1, 3), question(2, 0, { coverage: 'none' })], [], Date.now());
    const metrics = rowMetrics(360);
    expect(blockHeight(sheet.blocks[0], metrics)).toBe(ROW_PX + LINES_GAP + 3 * LINE + BLOCK_GAP);
    expect(blockHeight(sheet.blocks[1], metrics, { note: 'Ни в одной из 9 лекций нет фрагмента об этом' })).toBe(ROW_PX + NOTE_GAP + NOTE_PX + BLOCK_GAP);
    expect(blockHeight(sheet.blocks[1], metrics, { note: 'x'.repeat(100), heading: true })).toBe(SECTION_PX + ROW_PX + NOTE_GAP + 3 * NOTE_PX + BLOCK_GAP);
  });

  it('counts the caption of a line that says what its look means', () => {
    const block = buildSheet([question(1, 3)], [], Date.now()).blocks[0];
    const metrics = rowMetrics(360);
    expect(blockHeight(block, metrics, { explained: new Map([[block.lines[1].key, 'стёрта наполовину: пункт назван 4 окт.']]) })).toBe(
      ROW_PX + LINES_GAP + 3 * LINE + CAPTION_PX + BLOCK_GAP,
    );
  });

  it('under «Скрыть строки, стёртые совсем» counts no erased line, except the ones kept in view', () => {
    const sheet = buildSheet([question(1, 3)], [], Date.now());
    const block = sheet.blocks[0];
    const erased = { ...block, lines: block.lines.map((line, index) => (index < 2 ? { ...line, status: { ...line.status, state: 'erased' as const } } : line)) };
    const metrics = rowMetrics(360);
    expect(blockHeight(erased, metrics)).toBe(ROW_PX + LINES_GAP + 3 * LINE + BLOCK_GAP);
    expect(blockHeight(erased, metrics, { hideErased: true })).toBe(ROW_PX + LINES_GAP + LINE + BLOCK_GAP);
    expect(blockHeight(erased, metrics, { hideErased: true, keep: new Set([erased.lines[0].key]) })).toBe(ROW_PX + LINES_GAP + 2 * LINE + BLOCK_GAP);
    // Every line erased: only the question's title, unless one is kept.
    const gone = { ...erased, lines: erased.lines.map((line) => ({ ...line, status: { ...line.status, state: 'erased' as const } })) };
    expect(blockHeight(gone, metrics, { hideErased: true, note: 'заметка' })).toBe(ROW_PX + BLOCK_GAP);
    expect(blockHeight(gone, metrics, { hideErased: true, keep: new Set([gone.lines[2].key]) })).toBe(ROW_PX + LINES_GAP + LINE + BLOCK_GAP);
  });

  it('counts a question still to be written as tall as the written ones', () => {
    const metrics = rowMetrics(360);
    const unwritten = buildSheet([question(1, 0)], [], Date.now()).blocks[0];
    expect(unwritten.kind).toBe('unwritten');
    // Nothing written yet: four lines.
    expect(estimateHeight([unwritten], metrics)).toBe(LINES_GAP + 4 * LINE);
    // The mean of the written ones: 3 and 5 lines.
    const written = buildSheet([question(2, 3), question(3, 5), question(1, 0)], [], Date.now()).blocks;
    const estimate = estimateHeight(written, metrics);
    expect(estimate).toBe(LINES_GAP + 4 * LINE);
    expect(blockHeight(unwritten, metrics, { estimate })).toBe(ROW_PX + estimate + BLOCK_GAP);
    // A written question or a gap is measured as it is.
    const three = written.find((block) => block.questionId === 'q2')!;
    expect(blockHeight(three, metrics, { estimate })).toBe(ROW_PX + LINES_GAP + 3 * LINE + BLOCK_GAP);
  });

  it('keeps a held split while it fits, else splits anew', () => {
    const rows = [5, 5, 5, 5, 5, 5];
    expect(splitColumns(['a', 'b', 'c', 'd', 'e', 'f'], rows, 2, 2)).toEqual([['a', 'b'], ['c', 'd', 'e', 'f']]);
    expect(splitColumns(['a', 'b', 'c', 'd', 'e', 'f'], rows, 2, 0)).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']]);
    expect(splitColumns(['a', 'b', 'c', 'd', 'e', 'f'], rows, 2, 9)).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']]);
    expect(splitColumns(['a', 'b'], [5, 5], 1, 1)).toEqual([['a', 'b']]);
  });

  it('starts the second column where the halves are closest', () => {
    expect(splitIndex([5, 5, 5, 5])).toBe(2);
    expect(splitIndex([10, 2, 2, 2, 2, 2])).toBe(1);
    expect(splitIndex([2, 2, 2, 10])).toBe(3);
    expect(splitIndex([4])).toBe(1);
    expect(splitIndex([])).toBe(0);
  });

  it('keeps the department order down the first column, then the second', () => {
    expect(splitColumns(['a', 'b', 'c', 'd'], [3, 3, 3, 3], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(splitColumns(['a', 'b', 'c'], [3, 3, 3], 1)).toEqual([['a', 'b', 'c']]);
    expect(splitColumns(['a'], [3], 2)).toEqual([['a']]);
  });

  it('«Весь лист» splits into many columns in order, never more than asked, the tallest as low as it can be', () => {
    expect(splitMany(['a', 'b', 'c', 'd'], [3, 3, 3, 3], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    // The tallest column is the 5-row block alone; every column gets something.
    expect(splitMany(['a', 'b', 'c', 'd', 'e', 'f'], [5, 1, 1, 1, 1, 1], 3)).toEqual([['a'], ['b', 'c', 'd', 'e'], ['f']]);
    expect(splitMany(['a', 'b', 'c', 'd', 'e', 'f'], [2, 2, 2, 2, 2, 2], 4).map((part) => part.length)).toEqual([2, 2, 1, 1]);
    expect(splitMany(['a', 'b'], [3, 3], 5)).toEqual([['a'], ['b']]);
    expect(splitMany(['a', 'b', 'c'], [3, 3, 3], 1)).toEqual([['a', 'b', 'c']]);
    expect(splitMany([], [], 3)).toEqual([[]]);
  });

  it('«Весь лист» takes more columns of the same width rather than an ever smaller scale', () => {
    const geometry = paperGeometry(1000);
    // A short sheet is shown as it is.
    expect(zoomPlan({ wrapWidth: 1000, available: 800, heights: [100, 100, 100, 100], geometry })).toEqual({ columns: 2, scale: 1, width: 1000 });
    // 30 questions of 150 px: in two columns 2306 px high (scale 0.30); four columns of 446 px are larger (0.51).
    const heights = Array.from({ length: 30 }, () => 150);
    const plan = zoomPlan({ wrapWidth: 1000, available: 700, heights, geometry });
    expect(plan.columns).toBe(4);
    expect(plan.width).toBe(34 + 34 + 4 * 446 + 3 * 40);
    expect(plan.scale).toBeCloseTo(1000 / plan.width, 5);
    // Never more columns than allowed.
    expect(zoomPlan({ wrapWidth: 1000, available: 300, heights, geometry, maxColumns: 3 }).columns).toBeLessThanOrEqual(3);
  });
});

describe('the map of the lines', () => {
  it('keeps the gap between squares half their side, at least a pixel', () => {
    expect(mapGap(12)).toBe(6);
    expect(mapGap(8)).toBe(4);
    expect(mapGap(5)).toBe(2);
    expect(mapGap(3)).toBe(1);
  });

  it('draws a few dozen lines as 12 px squares in one even grid', () => {
    expect(mapGeometry(36, 290, { maxHeight: 150 })).toEqual({ size: 12, gap: 6, columns: 16, rows: 3, height: 48 });
    // A phone's compact map: smaller squares, a lower map.
    expect(mapGeometry(36, 290, { maxHeight: 56, maxSize: 8 })).toEqual({ size: 8, gap: 4, columns: 24, rows: 2, height: 20 });
  });

  it('takes smaller squares and more columns for hundreds of lines, under its height', () => {
    for (const count of [180, 600, 1373]) {
      const map = mapGeometry(count, 290, { maxHeight: 150 });
      expect(map.height).toBeLessThanOrEqual(150);
      expect(map.columns * map.rows).toBeGreaterThanOrEqual(count);
      expect(map.columns * (map.size + map.gap) - map.gap).toBeLessThanOrEqual(290);
    }
    expect(mapGeometry(1373, 290, { maxHeight: 150 }).size).toBeLessThan(mapGeometry(180, 290, { maxHeight: 150 }).size);
    // Past the smallest square the map simply grows taller.
    const huge = mapGeometry(20000, 290, { maxHeight: 150 });
    expect(huge.size).toBe(3);
    expect(huge.height).toBeGreaterThan(150);
    expect(mapGeometry(0, 290, { maxHeight: 150 }).rows).toBe(1);
  });
});
