import { describe, expect, it } from 'vitest';
import { clockTime, draftTime, elapsedLabel, longDateTime, shortDate, shortDateTime } from './format';

const NBSP = ' ';

describe('oral dates and times', () => {
  it('writes the hour without a leading zero, as the rest of the app does (redesign critique 4)', () => {
    const night = new Date(2026, 9, 4, 1, 2);
    expect(clockTime(night)).toBe('1:02');
    expect(longDateTime(night)).toBe(`4${NBSP}октября, 1:02`);
    expect(shortDateTime(night)).toBe(`4${NBSP}окт., 1:02`);
    expect(clockTime(new Date(2026, 9, 4, 0, 0))).toBe('0:00');
    expect(clockTime(new Date(2026, 9, 3, 14, 12))).toBe('14:12');
  });

  it('keeps two digits for the minutes and the answer timer', () => {
    expect(clockTime(new Date(2026, 9, 3, 9, 5))).toBe('9:05');
    expect(elapsedLabel(18_000)).toBe('0:18');
    expect(elapsedLabel(125_000)).toBe('2:05');
  });

  it('says only the time for a draft of today, the date and time otherwise', () => {
    const now = new Date(2026, 9, 3, 15, 0);
    expect(draftTime(new Date(2026, 9, 3, 9, 7), now)).toBe('9:07');
    expect(draftTime(new Date(2026, 9, 2, 9, 7), now)).toBe(`2${NBSP}окт., 9:07`);
    expect(shortDate('2026-10-07')).toBe(`7${NBSP}окт.`);
  });
});
