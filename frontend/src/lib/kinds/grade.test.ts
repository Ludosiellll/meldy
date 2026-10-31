import { describe, expect, it } from 'vitest';
import vectorsRaw from '../../../../contracts/kinds/grade_vectors.json?raw';
import { gradeItem, orderCredit, type GradeAnswer, type GradeItem } from './grade';

interface GradeCase {
  name: string;
  item: Partial<GradeItem> & { kind: GradeItem['kind'] };
  answer: GradeAnswer;
  valid: boolean;
  correct?: boolean;
  result?: string;
  credit?: number;
}
const V = JSON.parse(vectorsRaw) as { cases: GradeCase[] };
const itemOf = (c: GradeCase): GradeItem => ({ options: [], correct: [], answers: [], ...c.item });

describe('gradeItem — the twin of meldy_private.grade_item', () => {
  it(`agrees with every shared case (${V.cases.length})`, () => {
    const wrong = V.cases
      .filter((c) => {
        const g = gradeItem(itemOf(c), c.answer);
        if (g.valid !== c.valid) return true;
        if (!c.valid) return false;
        return g.correct !== c.correct || g.result !== c.result || g.credit !== c.credit;
      })
      .map((c) => `${c.name}: ${JSON.stringify(gradeItem(itemOf(c), c.answer))}`);
    expect(wrong).toEqual([]);
  });
  it('counts pairs in the right relative order', () => {
    expect(orderCredit([0, 1, 2])).toBe(1);
    expect(orderCredit([2, 1, 0])).toBe(0);
    expect(orderCredit([1, 0, 2, 3])).toBeCloseTo(5 / 6);
  });
  it('an essay is never right on the device', () => {
    expect(gradeItem({ kind: 'essay', options: [], correct: [], answers: [] }, { text: 'Ответ' })).toEqual({
      valid: true, correct: false, result: 'pending', credit: 0,
    });
  });
});
