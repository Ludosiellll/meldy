import { describe, expect, it } from 'vitest';
import { buildSheet, type SheetQuestion } from '../../../lib/exams/cheatSheet';
import { blockRows, paperGeometry, rowMetrics, splitColumns, splitIndex } from './layout';

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
  it('counts characters per row from the column width', () => {
    expect(rowMetrics(360)).toEqual({ print: 42, hand: 38, note: 44 });
    expect(rowMetrics(100).hand).toBeGreaterThanOrEqual(10);
  });

  it('lays the paper out by its width: two columns on whole grid cells from 760 px, the phone grid below 560 px', () => {
    expect(paperGeometry(1000)).toEqual({ columns: 2, narrow: false, row: 24, column: 408 });
    expect(paperGeometry(759)).toEqual({ columns: 1, narrow: false, row: 24, column: 663 });
    expect(paperGeometry(390)).toEqual({ columns: 1, narrow: true, row: 22, column: 342 });
    expect(paperGeometry(0).columns).toBe(1);
  });

  it('measures a block in grid rows: section title, question, lines, notes and a row of air', () => {
    const sheet = buildSheet([question(1, 3), question(2, 0, { coverage: 'none' })], [], Date.now());
    const metrics = rowMetrics(360);
    expect(blockRows(sheet.blocks[0], metrics)).toBe(1 + 3 + 1);
    expect(blockRows(sheet.blocks[1], metrics, { note: 'Ни в одной из 9 лекций нет фрагмента об этом' })).toBe(1 + 1 + 1);
    expect(blockRows(sheet.blocks[1], metrics, { note: 'x'.repeat(100), heading: true })).toBe(1 + 1 + 3 + 1);
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
});
