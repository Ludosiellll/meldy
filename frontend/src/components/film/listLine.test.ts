import { describe, expect, it } from 'vitest';
import { CHANGE_MS, LOOK, STRUCK_AT, keepsNote, leftAt, lineAt, statesAt, type ListLine } from './listLine';

const LINES: ListLine[] = [
  { text: 'выручка = цена × количество', essential: true, from: 'rubbed', steps: [{ at: 1000, to: 'erased' }] },
  { text: 'эластичный: снижение цены → выручка ↑', essential: true, from: 'fresh', steps: [{ at: 1200, to: 'rubbed' }] },
  { text: 'неэластичный: выручка ↑ при повышении цены', essential: true, from: 'fresh', steps: [{ at: 1500, to: 'missed', note: 'назван только после вопроса экзаменатора' }] },
  { text: 'единичная эластичность: выручка не меняется', essential: false, from: 'fresh' },
];

describe('a line of the cheat sheet on a reel', () => {
  it('shows the sheet\'s five states as three looks, as the exam page does', () => {
    expect(LOOK).toEqual({ fresh: 'left', missed: 'left', returned: 'left', rubbed: 'once', erased: 'gone' });
  });

  it('stands still until the answer reaches it, then moves over its change\'s own time', () => {
    const [first] = LINES;
    expect(lineAt(first, 999)).toMatchObject({ state: 'rubbed', from: 'rubbed', look: 'once', fromLook: 'once', p: 1 });
    const half = lineAt(first, 1000 + CHANGE_MS.gone / 2);
    expect(half).toMatchObject({ state: 'erased', from: 'rubbed', look: 'gone', fromLook: 'once' });
    expect(half.p).toBeCloseTo(0.5);
    // Done: still again, in its new state.
    expect(lineAt(first, 1000 + CHANGE_MS.gone)).toMatchObject({ state: 'erased', from: 'erased', look: 'gone', fromLook: 'gone', p: 1 });
  });

  it('is the same at the same moment, whatever was asked before', () => {
    const a = statesAt(LINES, 5000);
    statesAt(LINES, 0);
    expect(statesAt(LINES, 5000)).toEqual(a);
    expect(a).toEqual(['erased', 'rubbed', 'missed', 'fresh']);
    expect(statesAt(LINES, 0)).toEqual(['rubbed', 'fresh', 'fresh', 'fresh']);
  });

  it('brings its note with the step that gives it, and keeps a row for it', () => {
    expect(lineAt(LINES[2], 1499).note).toBeNull();
    expect(lineAt(LINES[2], 1500)).toMatchObject({ note: 'назван только после вопроса экзаменатора', noteBefore: null });
    expect(lineAt(LINES[2], 1500 + CHANGE_MS.left).noteBefore).toBe('назван только после вопроса экзаменатора');
    expect(LINES.map(keepsNote)).toEqual([false, false, true, false]);
  });

  it('counts a line as left until its strike has run over it', () => {
    expect(leftAt(LINES, 999)).toBe(4);
    expect(leftAt(LINES, 1000 + CHANGE_MS.gone * STRUCK_AT - 1)).toBe(4);
    expect(leftAt(LINES, 1000 + CHANGE_MS.gone * STRUCK_AT + 1)).toBe(3);
    expect(leftAt(LINES, 10_000)).toBe(3);
  });
});
