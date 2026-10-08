import { describe, expect, it } from 'vitest';
import { AI_COSTS, FREE_DAILY_UNITS } from '../../lib/plans';
import { freePlanLine } from './freePlan';

const plain = (text: string) => text.replace(/\u00a0/g, ' ');

describe('freePlanLine', () => {
  it('says what the free account gives, in the numbers of lib/plans.ts', () => {
    expect(plain(freePlanLine())).toBe(
      `Аккаунт бесплатный: каждый день ${FREE_DAILY_UNITS} единиц ИИ — это ${Math.floor(FREE_DAILY_UNITS / AI_COSTS.lecture)} лекций или ${Math.floor(FREE_DAILY_UNITS / AI_COSTS.answer)} проверенных ответов.`,
    );
    expect(plain(freePlanLine())).toBe('Аккаунт бесплатный: каждый день 100 единиц ИИ — это 5 лекций или 25 проверенных ответов.');
    // Nothing about payment.
    expect(freePlanLine()).not.toMatch(/₽|руб|оплат|PRO|цена/i);
  });
});
