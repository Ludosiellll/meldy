import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentStreak, isDateKey, localDateKey, shiftDateKey } from './streak';

const RealDateTimeFormat = Intl.DateTimeFormat;

/** Simulates a browser in `timeZone`: Intl formatters default to it, as the browser zone would. */
function browserTimeZone(timeZone: string) {
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (
    this: unknown,
    locales?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ) {
    return new RealDateTimeFormat(locales, { timeZone, ...options });
  } as unknown as typeof Intl.DateTimeFormat);
}

/** Local noon of a calendar day: the same day key in every time zone the test may run in. */
function localNoon(year: number, month: number, day: number) {
  return new Date(year, month - 1, day, 12, 0, 0);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('localDateKey', () => {
  it('uses the browser time zone, not UTC', () => {
    browserTimeZone('Europe/Moscow');
    expect(localDateKey(new Date('2026-10-02T22:30:00Z'))).toBe('2026-10-03');
  });

  it('stays on the previous day west of UTC', () => {
    browserTimeZone('America/New_York');
    expect(localDateKey(new Date('2026-10-03T02:30:00Z'))).toBe('2026-10-02');
  });

  it('formats a local calendar day as yyyy-MM-dd', () => {
    expect(localDateKey(localNoon(2026, 3, 7))).toBe('2026-03-07');
  });
});

describe('shiftDateKey', () => {
  it('moves across month, year and leap-day boundaries', () => {
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDateKey('2028-03-01', -1)).toBe('2028-02-29');
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDateKey('2026-10-31', 1)).toBe('2026-11-01');
  });

  it('rejects something that is not a day key', () => {
    expect(() => shiftDateKey('03.10.2026', -1)).toThrow(RangeError);
  });

  it('recognises only real calendar days', () => {
    expect(isDateKey('2026-02-28')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('2026-2-3')).toBe(false);
    expect(isDateKey(null)).toBe(false);
  });
});

describe('currentStreak', () => {
  const today = localNoon(2026, 10, 3);

  it('counts consecutive days ending today', () => {
    expect(currentStreak(['2026-10-03', '2026-10-02', '2026-10-01', '2026-09-29'], today)).toBe(3);
  });

  it('counts back from yesterday when today has no activity yet', () => {
    expect(currentStreak(['2026-10-02', '2026-10-01'], today)).toBe(2);
  });

  it('is zero when neither today nor yesterday was active', () => {
    expect(currentStreak(['2026-10-01', '2026-09-30'], today)).toBe(0);
    expect(currentStreak([], today)).toBe(0);
  });

  it('ignores duplicates, order, junk and keeps the day of ISO timestamps', () => {
    const dates = ['2026-10-01', 'вчера', '2026-10-02T23:10:00', '2026-10-02', '', '2026-13-01'];
    expect(currentStreak(dates, today)).toBe(2);
  });

  it('crosses a month boundary', () => {
    expect(currentStreak(['2026-03-01', '2026-02-28', '2026-02-27'], localNoon(2026, 3, 1))).toBe(3);
  });

  it('decides "today" in the browser time zone', () => {
    browserTimeZone('Europe/Moscow');
    // 22:30 UTC on 2 October is already 3 October in Moscow, so 2 October is "yesterday".
    expect(currentStreak(['2026-10-02', '2026-10-01'], new Date('2026-10-02T22:30:00Z'))).toBe(2);
    expect(currentStreak(['2026-10-03'], new Date('2026-10-02T22:30:00Z'))).toBe(1);
  });

  it('accepts any iterable, such as a Set of days', () => {
    expect(currentStreak(new Set(['2026-10-03', '2026-10-02']), today)).toBe(2);
  });
});
