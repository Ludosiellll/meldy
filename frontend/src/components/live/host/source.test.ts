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

  it('the fake source matches the fake server: 6 that play, 2 that do not', () => {
    const s = fakeSource();
    expect(s.questions.filter((q) => !q.skip)).toHaveLength(6);
    expect(s.questions.filter((q) => q.skip)).toHaveLength(2);
  });
});
