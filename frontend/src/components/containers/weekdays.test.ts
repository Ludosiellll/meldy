import { describe, expect, it } from 'vitest';
import { cleanDays, dayCount, dayOn, EVERY_DAY, toggleDay } from './weekdays';

describe('the days of the week of an exam (study_weekdays)', () => {
  it('reads Monday as 1 … Sunday as 64, every day as 127', () => {
    expect(dayOn(EVERY_DAY, 0)).toBe(true);
    expect(dayOn(31, 5)).toBe(false);
    expect(dayOn(64, 6)).toBe(true);
    expect(dayCount(31)).toBe(5);
    expect(dayCount(EVERY_DAY)).toBe(7);
  });

  it('switches a day, but never the last one', () => {
    expect(toggleDay(EVERY_DAY, 6)).toBe(63);
    expect(toggleDay(63, 6)).toBe(EVERY_DAY);
    expect(toggleDay(4, 2)).toBeNull();
  });

  it('takes only what the database takes (1..127); anything else is every day', () => {
    expect(cleanDays(31)).toBe(31);
    for (const bad of [0, 128, -1, 1.5, null, undefined, '31']) expect(cleanDays(bad)).toBe(EVERY_DAY);
  });
});
