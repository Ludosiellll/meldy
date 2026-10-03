import { describe, expect, it } from 'vitest';
import { shape } from '../marks';
import {
  COVERAGE_MARK,
  COVERAGE_MARK_SIZE,
  COVERAGE_WORDS,
  READINESS_MARK,
  coverageMark,
  markSeed,
  readinessMark,
  readinessSeed,
  selectionSeed,
  type SheetCoverage,
} from './marks';

describe('exam sheet marks', () => {
  it('seeds a mark by exam id and position, the same on every render', () => {
    expect(markSeed('exam-7f3', 17)).toBe(markSeed('exam-7f3', 17));
    expect(markSeed('exam-7f3', 17)).not.toBe(markSeed('exam-7f3', 18));
    expect(markSeed('exam-7f3', 17)).not.toBe(markSeed('exam-other', 17));
    expect(readinessSeed('exam-7f3', 17)).not.toBe(markSeed('exam-7f3', 17));
    expect(selectionSeed('exam-7f3', 17)).not.toBe(readinessSeed('exam-7f3', 17));
  });

  it('draws the same coverage paths for the same question and different ones for its neighbour', () => {
    const kind = coverageMark('full')!;
    const size = COVERAGE_MARK_SIZE[kind];
    const first = shape(kind, size.width, size.height, markSeed('exam-1', 3));
    const again = shape(kind, size.width, size.height, markSeed('exam-1', 3));
    const neighbour = shape(kind, size.width, size.height, markSeed('exam-1', 4));
    expect(again).toEqual(first);
    expect(neighbour[0].d).not.toBe(first[0].d);
  });

  it('maps every coverage state to its mark and every readiness state to its number mark', () => {
    expect(COVERAGE_MARK).toEqual({
      full: 'tick',
      partial: 'cup',
      none: 'dash',
      unverified: 'dtick',
      checking: 'dot',
      unmapped: null,
    });
    expect(READINESS_MARK).toEqual({ confirmed: 'ring', once: 'under', not_passed: 'wave', untested: null });
    expect(readinessMark('confirmed')).toBe('ring');
    expect(readinessMark('untested')).toBeNull();
  });

  it('draws the dash, the honest gap, with the bold weight', () => {
    expect(COVERAGE_MARK_SIZE.dash.weight).toBe(3.4);
  });

  it('says every mark in words', () => {
    for (const coverage of Object.keys(COVERAGE_MARK) as SheetCoverage[]) {
      expect(COVERAGE_WORDS[coverage]).toMatch(/[а-я]/);
    }
  });
});
