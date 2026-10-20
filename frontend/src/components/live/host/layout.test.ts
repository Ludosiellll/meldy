import { describe, expect, it } from 'vitest';
import { ARENA_MAX, BOSS_SIZE, CHAR_BASE, STAGE_H, arenaSlots, bossBox, hpBox, lobbySlots, optionFont, podiumSlots, podiumTopSlots, questionFont, stageFit } from './layout';

const WIDTHS = [1440, 1600, 1878, 2100];

describe('host layout', () => {
  it('fits the stage to the screens the class will see', () => {
    const wide = stageFit(1532, 734);
    expect(wide.scale).toBeCloseTo(734 / STAGE_H, 5);
    expect(wide.width).toBeCloseTo(1532 / wide.scale, 3);
    expect(wide.top).toBe(0);
    const hd = stageFit(1920, 1080);
    expect(hd.scale).toBeCloseTo(1.2, 5);
    expect(hd.width).toBeCloseTo(1600, 3);
    const small = stageFit(1366, 768);
    expect(small.width).toBeGreaterThan(1590);
    // A tall window: letterboxed above and below, never wider than the window.
    const tall = stageFit(1024, 1366);
    expect(tall.width).toBe(1440);
    expect(tall.width * tall.scale).toBeLessThanOrEqual(1024 + 0.5);
    expect(tall.top).toBeGreaterThan(0);
  });

  it('places up to 40 characters around the monster without overlaps, inside the arena', () => {
    for (const width of WIDTHS) {
      const boss = bossBox(width);
      for (let n = 1; n <= ARENA_MAX + 5; n += 1) {
        const slots = arenaSlots(n, width);
        expect(slots).toHaveLength(Math.min(n, ARENA_MAX));
        for (const s of slots) {
          expect(s.x).toBeGreaterThanOrEqual(20);
          expect(s.x + s.size).toBeLessThanOrEqual(width - 20);
          expect(s.y).toBeGreaterThanOrEqual(180);
          // the names under the last row stay above the question panel (it starts at 540)
          expect(s.y + s.size + 20).toBeLessThanOrEqual(540);
          // never on the monster
          expect(s.x + s.size <= boss.x + 20 || s.x >= boss.x + BOSS_SIZE - 20).toBe(true);
        }
        for (let i = 0; i < slots.length; i += 1)
          for (let j = i + 1; j < slots.length; j += 1) {
            const a = slots[i];
            const b = slots[j];
            const apart = Math.abs(a.x - b.x) >= Math.min(a.size, b.size) + 8 || Math.abs(a.y - b.y) >= Math.min(a.size, b.size) + 16;
            expect(apart, `n=${n} w=${width} ${i}/${j}`).toBe(true);
          }
      }
    }
  });

  it('keeps a class of 24 big enough to read from the back', () => {
    const slots = arenaSlots(24, 1600);
    expect(Math.min(...slots.map((s) => s.size))).toBeGreaterThanOrEqual(64);
    expect(new Set(slots.map((s) => s.side))).toEqual(new Set([-1, 1]));
  });

  it('places the podium crowd at the sides, clear of the columns', () => {
    for (const width of WIDTHS) {
      const slots = podiumSlots(40, width);
      expect(slots.length).toBeGreaterThanOrEqual(24);
      for (const s of slots) {
        expect(s.x).toBeGreaterThanOrEqual(20);
        expect(s.x + s.size).toBeLessThanOrEqual(width - 20);
        const clear = s.x + s.size <= width / 2 - 340 || s.x >= width / 2 + 340;
        expect(clear).toBe(true);
      }
    }
  });

  it('the lobby grid fits its panel; past its room, «и ещё N» takes the last cell', () => {
    for (const width of WIDTHS) {
      const few = lobbySlots(5, width);
      expect(few.slots).toHaveLength(5);
      expect(few.more).toBe(0);
      const many = lobbySlots(60, width);
      expect(many.slots.length + many.more).toBe(60);
      expect(many.more).toBeGreaterThan(0);
      for (const s of many.slots) {
        expect(s.x).toBeGreaterThanOrEqual(580);
        expect(s.x + CHAR_BASE).toBeLessThanOrEqual(width - 40);
        expect(s.y + CHAR_BASE + 24).toBeLessThanOrEqual(900 - 116);
      }
      expect(many.morePoint.y + 80).toBeLessThanOrEqual(900 - 116);
    }
  });

  it('the podium’s three stand on their columns', () => {
    const [first, second, third] = podiumTopSlots(1600);
    expect(first.y).toBeLessThan(second.y);
    expect(second.y).toBeLessThan(third.y);
    expect(second.x).toBeLessThan(first.x);
    expect(third.x).toBeGreaterThan(first.x);
  });

  it('the HP bar sits above the monster, centred', () => {
    const bar = hpBox(1600);
    expect(bar.x + bar.width / 2).toBe(800);
    expect(bar.y + 60).toBeLessThan(bossBox(1600).y);
  });

  it('gives long questions and options smaller letters', () => {
    expect(questionFont('Какая команда отменяет транзакцию?')).toBeGreaterThan(questionFont('x'.repeat(170)));
    expect(optionFont('ROLLBACK')).toBeGreaterThan(optionFont('Параллельные транзакции не видят изменений друг друга'));
  });
});
