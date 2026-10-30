import { describe, expect, it } from 'vitest';
import { amountChoices, fakeSource, questionLine, skipReason } from './source';

describe('the questions a game takes (CONTRACT §4)', () => {
  it('plays exactly one correct option of 2–4, names why the rest are left out', () => {
    expect(skipReason({ kind: 'single', options: ['a', 'b', 'c', 'd'], correct: [2] })).toBeNull();
    expect(skipReason({ kind: 'single', options: ['a', 'b'], correct: [0] })).toBeNull();
    expect(skipReason({ kind: 'multiple', options: ['a', 'b', 'c'], correct: [0, 2] })).toBe('multiple');
    expect(skipReason({ kind: 'short', options: [], correct: [] })).toBe('short');
    expect(skipReason({ kind: 'single', options: ['a', 'b', 'c', 'd', 'e'], correct: [1] })).toBe('options');
    expect(skipReason({ kind: 'single', options: ['a'], correct: [0] })).toBe('options');
    expect(skipReason({ kind: 'single', options: ['a', 'b', 'c'], correct: [] })).toBe('nokey');
    // the arena leaves pictures out, the stem's or an option's
    expect(skipReason({ kind: 'single', options: ['a', 'b'], correct: [0], images: { stem: ['c/abc.png'] } })).toBe('picture');
    expect(skipReason({ kind: 'single', options: ['a', 'b'], correct: [0], images: { options: [[], ['c/d.png']] } })).toBe('picture');
    expect(skipReason({ kind: 'single', options: ['a', 'b'], correct: [0], images: {} })).toBeNull();
  });

  it('a battle without mini-games takes 2–6 options and pictures (20261030090000_live_pictures.sql)', () => {
    const five = { kind: 'single' as const, options: ['a', 'b', 'c', 'd', 'e'], correct: [1] };
    expect(skipReason(five, true)).toBeNull();
    expect(skipReason({ ...five, options: [...five.options, 'f'] }, true)).toBeNull();
    expect(skipReason({ ...five, options: [...five.options, 'f', 'g'] }, true)).toBe('options');
    expect(skipReason({ kind: 'single', options: ['a', 'b'], correct: [0], images: { stem: ['c/abc.png'] } }, true)).toBeNull();
    expect(skipReason({ kind: 'multiple', options: ['a', 'b', 'c'], correct: [0, 2] }, true)).toBe('multiple');
    expect(skipReason({ kind: 'short', options: [], correct: [] }, true)).toBe('short');
  });

  it('offers amounts only when the test has more than 10 that fit', () => {
    expect(amountChoices(6)).toEqual([6]);
    expect(amountChoices(10)).toEqual([10]);
    expect(amountChoices(14)).toEqual([10, 14]);
    expect(amountChoices(80)).toEqual([10, 15, 20, 30]);
    expect(amountChoices(2)).toEqual([]);
  });

  it('cuts a long question at a word', () => {
    const line = questionLine(`${'слово '.repeat(40)}конец`, 60);
    expect([...line].length).toBeLessThanOrEqual(61);
    expect(line.endsWith('…')).toBe(true);
    expect(questionLine('Короткий\n  вопрос?')).toBe('Короткий вопрос?');
  });

  it('the fake source matches the fake server: 6 that play, 3 that do not', () => {
    const s = fakeSource();
    expect(s.questions.filter((q) => !q.skip)).toHaveLength(6);
    expect(s.questions.filter((q) => q.skip).map((q) => q.skip)).toEqual(['multiple', 'short', 'picture']);
    // without mini-games the picture question plays too
    expect(s.questions.filter((q) => q.wideSkip).map((q) => q.wideSkip)).toEqual(['multiple', 'short']);
  });
});
