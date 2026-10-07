import { describe, expect, it } from 'vitest';
import { MOVE_MS, inkAt, moveOf, statesAt, type InkLine } from './ink';

const line: InkLine = {
  text: 'выручка = цена × количество',
  essential: true,
  from: 'fresh',
  steps: [
    { at: 1000, to: 'rubbed' },
    { at: 3000, to: 'erased' },
    { at: 5000, to: 'returned', note: 'была стёрта · пункт не назван' },
  ],
};

describe('the ink of a line on the stage', () => {
  it('moves only by the exam page\'s passes: → half-way, ← gone, → written again, a wave under a missed point', () => {
    expect(moveOf('fresh', 'rubbed')).toBe('rub');
    expect(moveOf('rubbed', 'erased')).toBe('erase');
    expect(moveOf('erased', 'returned')).toBe('return');
    expect(moveOf('rubbed', 'missed')).toBe('return');
    expect(moveOf('fresh', 'missed')).toBe('miss');
    expect(moveOf('erased', 'erased')).toBeNull();
  });

  it('is a pure function of scene time: still before a step, moving through it, still after it', () => {
    expect(inkAt(line, 0)).toMatchObject({ state: 'fresh', move: null, p: 1, note: null });
    const half = inkAt(line, 1000 + MOVE_MS.rub / 2);
    expect(half).toMatchObject({ state: 'rubbed', from: 'fresh', move: 'rub' });
    expect(half.p).toBeCloseTo(0.5);
    expect(inkAt(line, 2000)).toMatchObject({ state: 'rubbed', from: 'rubbed', move: null, p: 1 });
    expect(inkAt(line, 3100)).toMatchObject({ state: 'erased', from: 'rubbed', move: 'erase' });
    // The same moment always gives the same frame.
    expect(inkAt(line, 3333)).toEqual(inkAt(line, 3333));
  });

  it('brings the note with its step and keeps the old one while the line moves away from it', () => {
    const moving = inkAt(line, 5050);
    expect(moving).toMatchObject({ state: 'returned', move: 'return', note: 'была стёрта · пункт не назван', noteBefore: null });
    expect(inkAt(line, 9000)).toMatchObject({ state: 'returned', move: null, note: 'была стёрта · пункт не назван' });
    const missed: InkLine = { text: 'x', essential: true, from: 'missed', note: 'назван только после вопроса экзаменатора', steps: [{ at: 100, to: 'rubbed' }] };
    expect(inkAt(missed, 150)).toMatchObject({ note: null, noteBefore: 'назван только после вопроса экзаменатора' });
  });

  it('gives the states of a sheet at a moment', () => {
    expect(statesAt([line, { text: 'y', essential: false, from: 'erased' }], 9000)).toEqual(['returned', 'erased']);
  });
});
