import { describe, expect, it } from 'vitest';
import { ARENA_MAX, BOSS_SIZE, NAME_ROOM, STAGE_H, arenaSlots, bossBox, hpBox, lobbyBoxes, lobbySlots, optionFont, podiumSlots, podiumTopSlots, questionFont, seats, stageFit, type Slot } from './layout';

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
          expect(s.y + s.size + NAME_ROOM).toBeLessThanOrEqual(540);
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

  it('gives every name its own room: no two names (or a name and a character) overlap, nor a name the monster', () => {
    const nameBox = (s: Slot) => ({ l: s.cx - s.nameW / 2, r: s.cx + s.nameW / 2, t: s.y + s.size, b: s.y + s.size + NAME_ROOM });
    const bodyBox = (s: Slot) => ({ l: s.x, r: s.x + s.size, t: s.y, b: s.y + s.size });
    const hit = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    for (const width of WIDTHS) {
      const boss = bossBox(width);
      for (const n of [6, 12, 16, 23, 24, 30, 31, 36, 40]) {
        const slots = arenaSlots(n, width);
        for (const s of slots) {
          expect(s.nameW, `n=${n} w=${width}`).toBeGreaterThanOrEqual(84);
          const nb = nameBox(s);
          expect(nb.r <= boss.x + 4 || nb.l >= boss.x + BOSS_SIZE - 4, `name on the monster n=${n} w=${width}`).toBe(true);
        }
        for (let i = 0; i < slots.length; i += 1)
          for (let j = 0; j < slots.length; j += 1) {
            if (i === j) continue;
            expect(hit(nameBox(slots[i]), nameBox(slots[j])), `names n=${n} w=${width} ${i}/${j}`).toBe(false);
            expect(hit(nameBox(slots[i]), bodyBox(slots[j])), `name/body n=${n} w=${width} ${i}/${j}`).toBe(false);
          }
      }
      const pod = podiumSlots(40, width);
      for (let i = 0; i < pod.length; i += 1)
        for (let j = i + 1; j < pod.length; j += 1) expect(hit(nameBox(pod[i]), nameBox(pod[j])), `podium w=${width} ${i}/${j}`).toBe(false);
    }
  });

  it('seats: by joining order in the lobby; in the game a leaver leaves an empty seat, a newcomer takes it', () => {
    const lobby = seats(['a', 'b', 'c', 'd'], null);
    expect([...lobby.of]).toEqual([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
    expect(lobby.count).toBe(4);
    // b is kicked during the game: nobody moves, the arena keeps its four seats
    const kicked = seats(['a', 'c', 'd'], lobby);
    expect([...kicked.of]).toEqual([['a', 0], ['c', 2], ['d', 3]]);
    expect(kicked.count).toBe(4);
    expect(arenaSlots(kicked.count, 1600)[2]).toEqual(arenaSlots(lobby.count, 1600)[2]);
    // nothing changed: the same object (no re-render)
    expect(seats(['a', 'c', 'd'], kicked)).toBe(kicked);
    // a late joiner takes the empty seat; the next one a new seat
    const late = seats(['a', 'c', 'd', 'e'], kicked);
    expect(late.of.get('e')).toBe(1);
    expect(late.count).toBe(4);
    const later = seats(['a', 'c', 'd', 'e', 'f'], late);
    expect(later.of.get('f')).toBe(4);
    expect(later.count).toBe(5);
    // past the arena's 40 seats nobody is seated; a leaver's seat goes to the first one waiting
    const many = Array.from({ length: 45 }, (_, i) => `p${i}`);
    const full = seats(many, null);
    expect(full.of.size).toBe(ARENA_MAX);
    const left = seats(many.filter((id) => id !== 'p7'), full);
    expect(left.of.get('p40')).toBe(7);
    expect(left.of.has('p41')).toBe(false);
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
      const { card, panel, grid } = lobbyBoxes(width);
      expect(card.x + card.w).toBeLessThan(panel.x);
      expect(panel.x + panel.w).toBe(width - 40);
      const few = lobbySlots(5, width);
      expect(few.slots).toHaveLength(5);
      expect(few.more).toBe(0);
      const many = lobbySlots(60, width);
      expect(many.slots.length + many.more).toBe(60);
      expect(many.more).toBeGreaterThan(0);
      for (const s of [...many.slots, ...lobbySlots(23, width).slots]) {
        // the character and its name inside the grid
        expect(s.cx - s.nameW / 2).toBeGreaterThanOrEqual(grid.x - 0.01);
        expect(s.cx + s.nameW / 2).toBeLessThanOrEqual(grid.x + grid.w + 0.01);
        expect(s.y).toBeGreaterThanOrEqual(grid.y);
        expect(s.y + s.size + NAME_ROOM).toBeLessThanOrEqual(grid.y + grid.h + 0.01);
      }
      expect(many.morePoint.y + 80).toBeLessThanOrEqual(panel.y + panel.h);
    }
  });

  it('a class of 23 is drawn big in the lobby, names readable', () => {
    for (const width of WIDTHS) {
      const l = lobbySlots(23, width);
      expect(l.more, `w=${width}`).toBe(0);
      expect(Math.min(...l.slots.map((s) => s.size)), `w=${width}`).toBeGreaterThanOrEqual(80);
      expect(Math.min(...l.slots.map((s) => s.nameW)), `w=${width}`).toBeGreaterThanOrEqual(104);
    }
    // few players: bigger still, the row centred in the panel
    const three = lobbySlots(3, 1600);
    expect(three.slots[0].size).toBe(96);
    const { grid } = lobbyBoxes(1600);
    const mid = (three.slots[0].cx + three.slots[2].cx) / 2;
    expect(Math.abs(mid - (grid.x + grid.w / 2))).toBeLessThan(1);
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
