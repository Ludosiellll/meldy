import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanInput } from '../../../types/container';

const plan = vi.hoisted(() => ({ feasibility: vi.fn(), windowDays: vi.fn() }));
vi.mock('../../../lib/containers/plan', () => ({ feasibility: plan.feasibility, windowDays: plan.windowDays }));

import { minutesLines } from './minutesLines';

const NOW = Date.UTC(2026, 9, 10, 9); // 10 October 2026, Minsk

function input(subjects: PlanInput['subjects'], perSubject: Record<string, number>): PlanInput {
  return {
    v: 1,
    now: NOW,
    tz: 'Europe/Minsk',
    containerId: 'c',
    budgetMin: 60,
    firstPlanDay: '2026-10-08',
    subjects,
    items: Object.entries(perSubject).flatMap(([subject, n]) =>
      Array.from({ length: n }, (_, index) => ({ id: `${subject}-${index}`, s: subject, f: 't' as const, tp: 1, o: index + 1 })),
    ),
    today: { firstAt: null, doneSec: 0, newDone: {} },
    pace: null,
    ai: null,
  };
}

const ONE_DATE = input([{ id: 'a', title: 'Сети', date: '2026-10-28' }], { a: 476 });

beforeEach(() => {
  plan.feasibility.mockReset();
  plan.windowDays.mockReset().mockReturnValue(4);
});

describe('minutesLines: the plan’s line under «Время в день»', () => {
  it('the minutes are enough: what they need to see every question by the date', () => {
    plan.feasibility.mockReturnValue({ neededMin: 35, option: 45, seenByDateEst: 476 });
    const lines = minutesLines(ONE_DATE, 45);
    expect(lines?.line).toBe('Чтобы увидеть все 476 вопросов к 28 октября, нужно около 35 минут в день.');
    expect(lines?.short).toBe(false);
    expect(lines?.option).toBe(45);
    expect(plan.feasibility).toHaveBeenCalledWith(expect.objectContaining({ budgetMin: 45 }));
  });

  it('an estimate equal to the count is not rounded down into «около 470 из 476»', () => {
    plan.feasibility.mockReturnValue({ neededMin: 50, option: 60, seenByDateEst: 476 });
    expect(minutesLines(ONE_DATE, 45)?.short).toBe(false);
  });

  it('they fall short: what they reach, and what all would need (the design table’s line)', () => {
    plan.feasibility.mockReturnValue({ neededMin: 72, option: 90, seenByDateEst: 404 });
    expect(minutesLines(ONE_DATE, 30)?.line).toBe(
      'При 30 минутах к 28 октября вы увидите около 400 из 476. Чтобы увидеть все, нужно около 75 минут.',
    );
  });

  it('«Даже при 90 минутах» only at 90; at fewer minutes the line names the minutes chosen', () => {
    plan.feasibility.mockReturnValue({ neededMin: 120, option: null, seenByDateEst: 300 });
    expect(minutesLines(ONE_DATE, 45)?.line).toMatch(/^При 45 минутах к 28 октября вы увидите около 300 из 476\. Чтобы увидеть все, нужно около 120 минут\.$/);
    expect(minutesLines(ONE_DATE, 90)?.line).toBe('Даже при 90 минутах в день к 28 октября вы увидите около 300 из 476.');
  });

  it('one date for the exam: the final days without new questions; several dates: none', () => {
    plan.feasibility.mockReturnValue({ neededMin: 35, option: 45, seenByDateEst: 476 });
    expect(minutesLines(ONE_DATE, 45)?.window).toBe('С 24 октября новых вопросов не будет: последние 4 дня — только знакомые, сначала ошибки.');
    expect(plan.windowDays).toHaveBeenCalledWith('2026-10-08', '2026-10-28', 127);
    // Пн–Пт: the 4 final days are study days, 22–27 October (the weekend between them is not one of them)
    expect(minutesLines({ ...ONE_DATE, studyWeekdays: 31 }, 45)?.window).toBe('С 22 октября новых вопросов не будет: последние 4 дня — только знакомые, сначала ошибки.');
    expect(plan.windowDays).toHaveBeenLastCalledWith('2026-10-08', '2026-10-28', 31);
    const two = input(
      [
        { id: 'a', title: 'Сети', date: '2026-10-28' },
        { id: 'b', title: 'ОС', date: '2026-11-03' },
      ],
      { a: 240, b: 240 },
    );
    const lines = minutesLines(two, 45);
    expect(lines?.window).toBeNull();
    expect(lines?.line).toBe('Чтобы увидеть все 480 вопросов к 3 ноября, нужно около 35 минут в день.');
  });

  it('counts only the subjects still ahead, and only those with questions name the date', () => {
    plan.feasibility.mockReturnValue({ neededMin: 35, option: 45, seenByDateEst: 240 });
    const mixed = input(
      [
        { id: 'a', title: 'Сети', date: '2026-10-28' },
        { id: 'past', title: 'Прошёл', date: '2026-10-05' },
        { id: 'oral', title: 'Устный без вопросов в плане', date: '2026-12-20' },
      ],
      { a: 240, past: 100 },
    );
    expect(minutesLines(mixed, 45)?.line).toBe('Чтобы увидеть все 240 вопросов к 28 октября, нужно около 35 минут в день.');
  });

  it('no date, no questions or a failing estimate: no line', () => {
    plan.feasibility.mockReturnValue({ neededMin: 35, option: 45, seenByDateEst: 10 });
    expect(minutesLines(input([{ id: 'a', title: 'Сети', date: null }], { a: 10 }), 45)).toBeNull();
    expect(minutesLines(input([{ id: 'a', title: 'Сети', date: '2026-10-28' }], {}), 45)).toBeNull();
    expect(minutesLines(null, 45)).toBeNull();
    plan.feasibility.mockImplementation(() => {
      throw new Error('bad input');
    });
    expect(minutesLines(ONE_DATE, 45)).toBeNull();
  });
});
