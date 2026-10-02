import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ScheduleCard, { stopFractions, strokeTimings } from './ScheduleCard';
import { HAND_DATES } from './handDates';
import { SCHEDULE } from './lecture';

describe('ScheduleCard', () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('follows the scheduler: 1, 6, 16 and 45 days with «Знаю» every time', () => {
    expect(SCHEDULE.map(s => s.days)).toEqual([1, 6, 16, 45]);
    expect(SCHEDULE.map(s => s.label)).toEqual(['завтра', 'через 6 дней', 'через 2 недели', 'через полтора месяца']);
    // SM-2 as in api/flashcards.ts: 1, 6, then round(interval × EF) with EF 2.5 + 0.1 per «Знаю»
    let interval = 0;
    let ef = 2.5;
    const got: number[] = [];
    for (let rep = 0; rep < 4; rep++) {
      interval = rep === 0 ? 1 : rep === 1 ? 6 : Math.round(interval * ef);
      ef += 0.1;
      got.push(interval);
    }
    expect(got).toEqual([1, 6, 16, 45]);
  });

  it('spaces the stops so the gaps grow', () => {
    const f = stopFractions();
    expect(f[0]).toBe(0);
    expect(f[f.length - 1]).toBe(1);
    const gaps = f.slice(1).map((v, i) => v - f[i]);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
  });

  it('writes every date in the same hand, stroke after stroke', () => {
    expect(HAND_DATES).toHaveLength(SCHEDULE.length);
    for (const phrase of HAND_DATES) {
      expect(phrase.paths.length).toBe(phrase.lens.length);
      for (const d of phrase.paths) expect(d).toMatch(/^M[\d.-]+ [\d.-]+C/);
      const timings = strokeTimings(phrase);
      for (let i = 1; i < timings.length; i++) expect(timings[i].delay).toBeGreaterThan(timings[i - 1].delay + timings[i - 1].duration);
    }
    const total = (i: number) => { const t = strokeTimings(HAND_DATES[i]); const last = t[t.length - 1]; return last.delay + last.duration; };
    expect(total(0)).toBeLessThan(0.8);
    expect(total(3)).toBeLessThan(2);
  });

  it('moves the card only when the visitor answers, and announces when it comes back', () => {
    vi.useFakeTimers();
    const { container } = render(<ScheduleCard />);
    const known = screen.getByRole('button', { name: 'Знаю' });
    const forgot = screen.getByRole('button', { name: 'Не помню' });
    const live = container.querySelector('[aria-live="polite"]')!;
    const date = () => container.querySelector('.lp-sched-card .sr-only')?.textContent;
    expect(date()).toBe('Вернётся завтра');
    act(() => { vi.advanceTimersByTime(5000); });
    expect(date()).toBe('Вернётся завтра');

    fireEvent.click(known);
    expect(date()).toBe('Вернётся через 6 дней');
    expect(live).toHaveTextContent('Карточка вернётся через 6 дней.');
    // the old date is erased while the new one is written
    expect(container.querySelectorAll('.lp-date.is-erase')).toHaveLength(1);
    expect(container.querySelectorAll('.lp-date.is-write')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(300); });
    expect(container.querySelectorAll('.lp-date')).toHaveLength(1);

    fireEvent.click(known);
    fireEvent.click(known);
    expect(date()).toBe('Вернётся через полтора месяца');
    expect(known).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(known);
    expect(date()).toBe('Вернётся через полтора месяца');

    fireEvent.click(forgot);
    expect(date()).toBe('Вернётся завтра');
    expect(known).not.toHaveAttribute('aria-disabled');
    const ticks = container.querySelectorAll('.lp-sched-tick');
    expect(ticks).toHaveLength(SCHEDULE.length);
    expect(container.querySelectorAll('.lp-sched-tick.is-past')).toHaveLength(1);
  });
});
