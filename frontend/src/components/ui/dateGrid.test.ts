import { describe, expect, it } from 'vitest';
import { addDays, addMonths, allowed, dayName, daysBetween, distance, firstDay, isDay, lastDay, monthOf, monthTitle, monthWeeks, nearest, shiftMonth, todayHere } from './dateGrid';

describe('the date field’s calendar: days and months', () => {
  it('a day is «ГГГГ-ММ-ДД» of a real date', () => {
    expect([isDay('2026-11-27'), isDay('2026-02-29'), isDay('2028-02-29'), isDay('27.11.2026'), isDay(''), isDay(null)]).toEqual([true, false, true, false, false, false]);
    expect(todayHere(new Date(2026, 10, 5, 23, 59))).toBe('2026-11-05');
  });

  it('days and months are counted without the clock: over a month’s end, a year’s end and a short month', () => {
    expect([addDays('2026-11-30', 1), addDays('2026-01-01', -1), addDays('2026-03-28', 7)]).toEqual(['2026-12-01', '2025-12-31', '2026-04-04']);
    expect([addMonths('2026-01-31', 1), addMonths('2026-11-18', 1), addMonths('2026-12-15', 2), addMonths('2026-03-31', -1)]).toEqual(['2026-02-28', '2026-12-18', '2027-02-15', '2026-02-28']);
    expect([daysBetween('2026-11-18', '2026-11-27'), daysBetween('2026-11-18', '2026-11-18'), daysBetween('2026-11-18', '2026-11-11')]).toEqual([9, 0, -7]);
    expect([shiftMonth({ y: 2026, m: 12 }, 1), shiftMonth({ y: 2026, m: 1 }, -1), shiftMonth({ y: 2026, m: 11 }, 14)]).toEqual([{ y: 2027, m: 1 }, { y: 2025, m: 12 }, { y: 2028, m: 1 }]);
    expect([firstDay({ y: 2026, m: 2 }), lastDay({ y: 2026, m: 2 }), lastDay({ y: 2028, m: 2 }), monthOf('2026-11-27')]).toEqual(['2026-02-01', '2026-02-28', '2028-02-29', { y: 2026, m: 11 }]);
  });

  it('a month is six weeks from Monday; the days of neighbouring months are gaps', () => {
    const november = monthWeeks({ y: 2026, m: 11 });
    expect(november).toHaveLength(6);
    expect(november.every((week) => week.length === 7)).toBe(true);
    // 1 ноября 2026 — воскресенье, 30 ноября — понедельник
    expect(november[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(november[1][0]).toBe('2026-11-02');
    expect(november[5]).toEqual(['2026-11-30', null, null, null, null, null, null]);
    expect(november.flat().filter(Boolean)).toHaveLength(30);
    // a February that begins on Monday fills four weeks, the last two are gaps
    const february = monthWeeks({ y: 2027, m: 2 });
    expect(february[0][0]).toBe('2027-02-01');
    expect(february[4].every((day) => day === null) && february[5].every((day) => day === null)).toBe(true);
  });

  it('the field’s min and max: a day is taken or not, and the nearest taken one', () => {
    expect([allowed('2026-11-18', '2026-11-18', '2027-11-18'), allowed('2026-11-17', '2026-11-18'), allowed('2027-11-19', undefined, '2027-11-18'), allowed('2020-01-01')]).toEqual([true, false, false, true]);
    expect([nearest('2026-11-01', '2026-11-18', '2026-12-31'), nearest('2027-01-05', '2026-11-18', '2026-12-31'), nearest('2026-12-01', '2026-11-18', '2026-12-31')]).toEqual(['2026-11-18', '2026-12-31', '2026-12-01']);
    // a min or max that is not a day does not limit
    expect(allowed('2026-11-17', '', 'x')).toBe(true);
  });

  it('the words: the month, a day, and how far it is from today', () => {
    expect(monthTitle({ y: 2026, m: 11 })).toBe('Ноябрь 2026');
    expect([dayName('2026-11-27'), dayName('2026-11-01'), dayName('2027-01-04')]).toEqual(['27 ноября, пятница', '1 ноября, воскресенье', '4 января, понедельник']);
    const far = (day: string) => distance(day, '2026-11-18');
    expect([far('2026-11-18'), far('2026-11-19'), far('2026-11-17'), far('2026-11-27'), far('2026-11-20'), far('2026-12-09'), far('2026-11-13')]).toEqual([
      'сегодня', 'завтра', 'вчера', 'через 9 дней', 'через 2 дня', 'через 21 день', '5 дней назад',
    ]);
  });
});
