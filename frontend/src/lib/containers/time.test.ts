import { describe, expect, it } from 'vitest';
import {
  addDays, atLocalTime, clockOf, clockText, dayIndex, daysBetween, isLocalDay, localDay, midnightAfter, startOfDay, weekday,
} from './time.ts';

const H = 3_600_000;

describe('local days', () => {
  it('reads the local day of a moment in the zone, not the device zone', () => {
    const t = Date.UTC(2026, 9, 9, 20, 30); // 23:30 in Minsk (UTC+3)
    expect(localDay(t, 'Europe/Minsk')).toBe('2026-10-09');
    expect(localDay(t + H, 'Europe/Minsk')).toBe('2026-10-10');
    expect(localDay(t, 'America/New_York')).toBe('2026-10-09');
    expect(localDay(t, 'Asia/Tokyo')).toBe('2026-10-10');
  });

  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-09', 0)).toBe('2026-10-09');
  });

  it('counts days between and knows the weekday', () => {
    expect(daysBetween('2026-10-09', '2026-10-28')).toBe(19);
    expect(daysBetween('2026-10-28', '2026-10-09')).toBe(-19);
    expect(daysBetween('2026-12-25', '2027-01-12')).toBe(18);
    expect(weekday('2026-10-10')).toBe(5); // Saturday (Monday = 0)
    expect(weekday('2026-10-12')).toBe(0);
    expect(dayIndex('1970-01-01')).toBe(0);
  });

  it('validates days', () => {
    expect(isLocalDay('2026-10-09')).toBe(true);
    expect(isLocalDay('2026-02-30')).toBe(false);
    expect(isLocalDay('2026-1-9')).toBe(false);
    expect(isLocalDay(null)).toBe(false);
    expect(() => addDays('9 октября', 1)).toThrow();
  });
});

describe('day boundaries and DST', () => {
  it('starts a Minsk day at local midnight', () => {
    expect(startOfDay('2026-10-10', 'Europe/Minsk')).toBe(Date.UTC(2026, 9, 9, 21, 0));
    expect(midnightAfter('2026-10-09', 'Europe/Minsk')).toBe(Date.UTC(2026, 9, 9, 21, 0));
  });

  it('has 25-hour and 23-hour days where DST changes (Berlin)', () => {
    expect(startOfDay('2026-10-25', 'Europe/Berlin')).toBe(Date.UTC(2026, 9, 24, 22, 0));
    expect(midnightAfter('2026-10-25', 'Europe/Berlin') - startOfDay('2026-10-25', 'Europe/Berlin')).toBe(25 * H);
    expect(midnightAfter('2026-03-29', 'Europe/Berlin') - startOfDay('2026-03-29', 'Europe/Berlin')).toBe(23 * H);
  });

  it('finds the first moment of days that begin at 01:00 (DST at midnight)', () => {
    for (const [tz, day] of [['America/Santiago', '2026-09-06'], ['America/Havana', '2026-03-08'], ['Asia/Beirut', '2026-03-29']]) {
      const start = startOfDay(day, tz);
      expect(localDay(start, tz)).toBe(day);
      expect(localDay(start - 1, tz)).toBe(addDays(day, -1));
      expect(clockOf(start, tz)).toEqual({ h: 1, m: 0 });
    }
  });

  it('is exact on every day of two years in zones with odd rules', () => {
    for (const tz of ['Europe/Minsk', 'Europe/Berlin', 'America/Santiago', 'Australia/Lord_Howe', 'Pacific/Chatham', 'Asia/Kolkata']) {
      for (let day = '2026-01-01'; day <= '2027-12-31'; day = addDays(day, 1)) {
        const start = startOfDay(day, tz);
        if (localDay(start, tz) !== day || localDay(start - 1, tz) !== addDays(day, -1)) throw new Error(`${tz} ${day}`);
      }
    }
  });

  it('gives a wall time of the day, also on a DST day', () => {
    expect(atLocalTime('2026-10-10', 22 * 60, 'Europe/Minsk')).toBe(Date.UTC(2026, 9, 10, 19, 0));
    const berlin = atLocalTime('2026-10-25', 22 * 60, 'Europe/Berlin'); // after the change: UTC+1
    expect(berlin).toBe(Date.UTC(2026, 9, 25, 21, 0));
    expect(clockText(berlin, 'Europe/Berlin')).toBe('22:00');
  });
});

describe('clock text', () => {
  it('prints the local time and rounds up to the step', () => {
    const t = Date.UTC(2026, 9, 10, 14, 0); // 17:00 Minsk
    expect(clockText(t, 'Europe/Minsk')).toBe('17:00');
    expect(clockText(t + 1000, 'Europe/Minsk')).toBe('17:01');
    expect(clockText(t + 1000, 'Europe/Minsk', 5)).toBe('17:05');
    expect(clockText(t + 5 * 60_000, 'Europe/Minsk', 5)).toBe('17:05');
    expect(clockText(Date.UTC(2026, 9, 10, 5, 10), 'Europe/Minsk')).toBe('8:10');
    expect(clockText(Date.UTC(2026, 9, 10, 20, 58), 'Europe/Minsk', 5)).toBe('0:00');
  });

  it('the student case: 23:00, then 15:00 the next day is 16 hours — countable from 19:00', () => {
    const a = Date.UTC(2026, 9, 9, 20, 0); // 23:00 Minsk
    const b = Date.UTC(2026, 9, 10, 12, 0); // 15:00 Minsk
    expect(localDay(a, 'Europe/Minsk')).not.toBe(localDay(b, 'Europe/Minsk'));
    expect((b - a) / H).toBe(16);
    const from = Math.max(a + 20 * H, midnightAfter(localDay(a, 'Europe/Minsk'), 'Europe/Minsk'));
    expect(localDay(from, 'Europe/Minsk')).toBe('2026-10-10');
    expect(clockText(from, 'Europe/Minsk')).toBe('19:00');
  });
});
