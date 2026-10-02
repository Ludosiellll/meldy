import { describe, expect, it } from 'vitest';
import { chartSourceIds, numberReadings, timelineSourceIds } from './grounding';
import type { ChartVisual, TimelineVisual } from './types';

const chart = (values: number[]): ChartVisual => ({
  type: 'chart',
  title: 'Числа',
  kind: 'bar',
  data: values.map((value, index) => ({ label: `P${index}`, value })),
});

describe('client-side check of chart numbers and timeline dates', () => {
  it('reads numbers the way the server does', () => {
    expect(numberReadings('12,5')).toEqual([12.5]);
    expect(numberReadings('3,14')).toEqual([3.14]);
    expect(numberReadings('12 500')).toEqual([12500]);
    expect(numberReadings('−40')).toEqual([-40]);
    expect(numberReadings('2019 150').sort((a, b) => a - b)).toEqual([150, 2019]);
  });

  it('names only the fragment that really holds the numbers', () => {
    const sources = [
      { id: 'S01', text: 'Инфляция в 2022 году составила 11,9 процента, в 2023 году — 7,4 процента.' },
      { id: 'S02', text: 'Центральный банк повышает ключевую ставку, чтобы замедлить рост цен.' },
    ];
    expect(chartSourceIds(chart([11.9, 7.4]), ['S02'], sources)).toEqual(['S01']);
    expect(chartSourceIds(chart([119, 74]), ['S01'], sources)).toEqual([]);
    expect(chartSourceIds(chart([11.9, 7.4]), ['S01'], [])).toEqual([]);
    // Числа из двух фрагментов — оба.
    const split = [
      { id: 'S01', text: 'Через 20 минут помнили 58%.' },
      { id: 'S02', text: 'Через месяц помнили 21%.' },
    ];
    expect(chartSourceIds(chart([58, 21]), [], split)).toEqual(['S01', 'S02']);
  });

  it('keeps the sign and does not read a range as a negative number', () => {
    const sources = [{ id: 'S01', text: 'Война 1941-1945 годов. Ночью было −12 градусов.' }];
    expect(chartSourceIds(chart([1941, 1945]), [], sources)).toEqual(['S01']);
    expect(chartSourceIds(chart([-1945]), [], sources)).toEqual([]);
    expect(chartSourceIds(chart([-12]), [], sources)).toEqual(['S01']);
    expect(chartSourceIds(chart([12]), [], sources)).toEqual([]);
  });

  it('matches dates as whole words', () => {
    const timeline = (dates: string[]): TimelineVisual => ({
      type: 'timeline',
      title: 'История',
      events: dates.map(date => ({ date, label: 'Событие' })),
    });
    const sources = [{ id: 'S03', text: 'В 1885 году Эббингауз выучил списки слогов. В XIX веке память изучали на себе.' }];
    expect(timelineSourceIds(timeline(['1885', 'XIX век']), ['S01'], sources)).toEqual(['S03']);
    expect(timelineSourceIds(timeline(['85', '1885']), [], sources)).toEqual([]);
    expect(timelineSourceIds(timeline(['1885', '1968']), ['S03'], sources)).toEqual([]);
  });
});
