import { describe, expect, it } from 'vitest';
import vectors from '../../test/fixtures/oral_match_vectors.json';
import { countsSentence, formulaLine, gradeAnswer, gradeLine, ruNumber, type GradedPoint, type PointStatus } from './oralGrade';

function pointsOf(statuses: Record<string, string>, essential: string[]): GradedPoint[] {
  return Object.keys(statuses)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((id) => ({ id, essential: essential.includes(id), status: statuses[id] as PointStatus }));
}

const gradeVectors = vectors.grade as Array<{
  name: string;
  essential: string[];
  statuses: Record<string, string>;
  followup: { point_id: string; status: string } | null;
  score: number | null;
  grade: number | null;
}>;

describe('grade v1 (contracts §7.6, shared vectors)', () => {
  it.each(gradeVectors)('$name → $score / $grade', ({ essential, statuses, followup, score, grade }) => {
    const result = gradeAnswer(pointsOf(statuses, essential), followup);
    expect(result.score).toBe(score);
    expect(result.grade).toBe(grade);
  });

  it('passes only with 4 or 5', () => {
    const four = gradeAnswer(pointsOf({ p1: 'covered', p2: 'covered', p3: 'covered', p4: 'missing', p5: 'covered' }, ['p1', 'p2', 'p3', 'p4']), {
      point_id: 'p4',
      status: 'missing',
    });
    expect(four).toMatchObject({ grade: 4, word: 'хорошо', passed: true });
    const three = gradeAnswer(pointsOf({ p1: 'covered', p2: 'missing', p3: 'missing' }, ['p1', 'p2', 'p3']), null);
    expect(three).toMatchObject({ grade: 2, word: 'неудовлетворительно', passed: false });
  });

  it('records the credit of every point after the follow-up, null for unrated', () => {
    const result = gradeAnswer(pointsOf({ p1: 'missing', p2: 'partial', p3: 'unrated' }, ['p1']), { point_id: 'p1', status: 'partial' });
    expect(result.credits).toEqual({ p1: 0.25, p2: 0.5, p3: null });
  });

  it('names the cap that lowered the grade', () => {
    // An essential point said wrong but put right in the follow-up: 92 would be a 5, the cap keeps a 4.
    const all = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const capped = gradeAnswer(
      pointsOf({ p1: 'wrong', p2: 'covered', p3: 'covered', p4: 'covered', p5: 'covered', p6: 'covered' }, all),
      { point_id: 'p1', status: 'covered' },
    );
    expect(capped).toMatchObject({ score: 92, grade: 4, cap: 'essential_wrong' });
    const plain = gradeAnswer(pointsOf({ p1: 'wrong', p2: 'covered', p3: 'covered', p4: 'covered', p5: 'covered' }, ['p1', 'p2', 'p3', 'p4']), null);
    expect(plain).toMatchObject({ score: 78, grade: 4, cap: null });
  });
});

describe('protocol words', () => {
  it('says the counts in a plain sentence', () => {
    expect(countsSentence({ covered: 3, partial: 1, missing: 1, wrong: 0, unrated: 0, total: 5 })).toBe(
      'Раскрыто 3 пункта из 5, один упомянут, один не назван.',
    );
    expect(countsSentence({ covered: 2, partial: 1, missing: 1, wrong: 1, unrated: 0, total: 5 })).toBe(
      'Раскрыто 2 пункта из 5, в одном ошибка, один упомянут, один не назван.',
    );
    expect(countsSentence({ covered: 1, partial: 0, missing: 2, wrong: 0, unrated: 1, total: 4 })).toBe(
      'Раскрыт 1 пункт из 4, два не названы, один не оценён.',
    );
    expect(countsSentence({ covered: 5, partial: 0, missing: 0, wrong: 0, unrated: 0, total: 5 })).toBe('Раскрыто 5 пунктов из 5.');
  });

  it('writes the formula with this answer’s numbers', () => {
    const result = gradeAnswer(
      pointsOf({ p1: 'covered', p2: 'covered', p3: 'covered', p4: 'missing', p5: 'covered' }, ['p1', 'p2', 'p3', 'p4']),
      { point_id: 'p4', status: 'missing' },
    );
    expect(formulaLine(result)).toBe('(2 + 2 + 2 + 0 + 1) / 9 = 78 из 100 → 4');
    expect(gradeLine(result.grade)).toBe('4 · хорошо');
    expect(ruNumber(0.25)).toBe('0,25');
  });

  it('has no formula without a grade', () => {
    expect(formulaLine(gradeAnswer(pointsOf({ p1: 'unrated' }, ['p1']), null))).toBeNull();
    expect(gradeLine(null)).toBeNull();
  });
});
