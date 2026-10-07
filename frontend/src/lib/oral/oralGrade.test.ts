import { describe, expect, it } from 'vitest';
import vectors from '../../test/fixtures/oral_match_vectors.json';
import { countsSentence, gradeAnswer, type GradedPoint, type PointStatus } from './oralGrade';

function pointsOf(statuses: Record<string, string>, essential: string[]): GradedPoint[] {
  return Object.keys(statuses)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
    .map((id) => ({ id, essential: essential.includes(id), status: statuses[id] as PointStatus }));
}

const gradeVectors = vectors.grade as Array<{
  name: string;
  essential: string[];
  statuses: Record<string, string>;
  followup: { point_id: string; status: string; judged_by?: 'check' | 'keywords' | null } | null;
  score: number | null;
  grade: number | null;
}>;

/** The vector's follow-up as gradeAnswer takes it: judged_by goes in as judgedBy when the case has it. */
function followupOf(followup: (typeof gradeVectors)[number]['followup']) {
  if (!followup) return null;
  const { judged_by: judgedBy, ...rest } = followup;
  return judgedBy === undefined ? rest : { ...rest, judgedBy };
}

/** The stage example of the memo: 4 main points of 5, p3 mentioned, p4 not named. */
const STAGE = { p1: 'covered', p2: 'covered', p3: 'partial', p4: 'missing', p5: 'covered' };
const MAIN = ['p1', 'p2', 'p3', 'p4'];

describe('grade v2 (contracts §7.6 + Jury_Check item 3, shared vectors)', () => {
  it.each(gradeVectors)('$name → $score / $grade', ({ essential, statuses, followup, score, grade }) => {
    const result = gradeAnswer(pointsOf(statuses, essential), followupOf(followup));
    expect(result.score).toBe(score);
    expect(result.grade).toBe(grade);
  });

  it('keeps the seed cases and adds the memo’s cases (demo «не знаю» is a deliberate 4 → 3)', () => {
    const names = gradeVectors.map((vector) => vector.name);
    expect(names.slice(0, 9)).toEqual([
      'demo-dont-know',
      'demo-followup-right',
      'two-wrong-cap-3',
      'essential-wrong',
      'unrated-excluded',
      'all-missing',
      'partial-followup-partial',
      'missing-followup-partial',
      'all-unrated',
    ]);
    expect(gradeVectors[0]).toMatchObject({ score: 78, grade: 3 });
    expect(names).toEqual(
      expect.arrayContaining([
        'stage-dont-know',
        'stage-followup-partial',
        'essential-wrong-followup-wrong',
        'essential-wrong-followup-covered',
        'nonessential-missing-dont-know',
        'essential-missing-keywords-missing',
      ]),
    );
  });

  it('passes only with 4 or 5, and carries no word for the screen (Ф1: the grade stays internal)', () => {
    const four = gradeAnswer(pointsOf({ p1: 'covered', p2: 'covered', p3: 'covered', p4: 'missing', p5: 'covered' }, ['p1', 'p2', 'p3', 'p4']), null);
    expect(four).toMatchObject({ grade: 4, passed: true });
    const three = gradeAnswer(pointsOf({ p1: 'covered', p2: 'missing', p3: 'missing' }, ['p1', 'p2', 'p3']), null);
    expect(three).toMatchObject({ grade: 2, passed: false });
    expect(four).not.toHaveProperty('word');
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

describe('the cap for a main point not recovered on the follow-up (v2)', () => {
  const stage = pointsOf(STAGE, MAIN);

  it('caps «Не знаю» on the follow-up about a missing main point at 3: the memo’s stage example', () => {
    // «Не знаю» (the button) and silence after «Не расслышал ответ» come without a judge.
    for (const judgedBy of [undefined, null] as const) {
      const result = gradeAnswer(stage, { point_id: 'p4', status: 'missing', judgedBy });
      expect(result).toMatchObject({ score: 67, grade: 3, passed: false, cap: 'essential_unrecovered', capSkipped: null });
      expect(result.capPoint).toEqual({ id: 'p4', number: 4 });
      // (2 + 2 + 1 + 0 + 1) / 9 = 67 of 100.
      expect(result).toMatchObject({ sumWeighted: 6, sumWeights: 9 });
    }
  });

  it('caps a model-judged wrong or missing answer to it at 3', () => {
    expect(gradeAnswer(stage, { point_id: 'p4', status: 'wrong', judgedBy: 'check' })).toMatchObject({ grade: 3, cap: 'essential_unrecovered' });
    expect(gradeAnswer(stage, { point_id: 'p4', status: 'missing', judgedBy: 'check' })).toMatchObject({ grade: 3, cap: 'essential_unrecovered' });
  });

  it('lifts the cap with a partial or covered answer to the follow-up', () => {
    const partial = gradeAnswer(stage, { point_id: 'p4', status: 'partial', judgedBy: 'check' });
    expect(partial).toMatchObject({ score: 72, grade: 4, passed: true, cap: null, capSkipped: null, capPoint: null });
    // (2 + 2 + 1 + 0,5 + 1) / 9 = 72 of 100.
    expect(partial).toMatchObject({ sumWeighted: 6.5, sumWeights: 9 });
    expect(gradeAnswer(stage, { point_id: 'p4', status: 'covered', judgedBy: 'check' })).toMatchObject({ score: 78, grade: 4, cap: null });
  });

  it('never caps on a key-word guess, and says the cap was skipped', () => {
    const guessed = gradeAnswer(stage, { point_id: 'p4', status: 'missing', judgedBy: 'keywords' });
    expect(guessed).toMatchObject({ score: 67, grade: 4, passed: true, cap: null, capSkipped: 'keywords' });
    expect(guessed.capPoint).toEqual({ id: 'p4', number: 4 });
    // Nothing to skip when the grade is 3 or lower anyway.
    const low = gradeAnswer(pointsOf({ p1: 'covered', p2: 'missing', p3: 'partial', p4: 'missing' }, MAIN), { point_id: 'p4', status: 'missing', judgedBy: 'keywords' });
    expect(low).toMatchObject({ grade: 2, cap: null, capSkipped: null, capPoint: null });
  });

  it('adds no cap for a point that is not a main point, or a main point that was only mentioned', () => {
    const minor = gradeAnswer(pointsOf({ p1: 'covered', p2: 'covered', p3: 'covered', p4: 'covered', p5: 'missing' }, MAIN), { point_id: 'p5', status: 'missing' });
    expect(minor).toMatchObject({ score: 89, grade: 5, cap: null, capSkipped: null });
    const mentioned = gradeAnswer(pointsOf({ p1: 'partial', p2: 'covered', p3: 'covered', p4: 'covered' }, ['p1', 'p2', 'p3']), { point_id: 'p1', status: 'missing' });
    expect(mentioned).toMatchObject({ score: 86, grade: 5, cap: null });
  });

  it('keeps a main point put right on the follow-up at 4 and caps one said wrong twice at 3', () => {
    const wrong = { p1: 'wrong', p2: 'covered', p3: 'covered', p4: 'covered', p5: 'covered' };
    expect(gradeAnswer(pointsOf(wrong, MAIN), { point_id: 'p1', status: 'covered' })).toMatchObject({ score: 89, grade: 4, cap: 'essential_wrong' });
    expect(gradeAnswer(pointsOf(wrong, MAIN), { point_id: 'p1', status: 'wrong', judgedBy: 'check' })).toMatchObject({ score: 78, grade: 3, cap: 'essential_unrecovered' });
    // Said wrong, judged only by key words: the essential-wrong cap still holds, the stricter one is skipped.
    expect(gradeAnswer(pointsOf(wrong, MAIN), { point_id: 'p1', status: 'missing', judgedBy: 'keywords' })).toMatchObject({
      score: 78,
      grade: 4,
      cap: null,
      capSkipped: 'keywords',
    });
  });

  it('reports the cap that set the grade, essential_unrecovered first on a tie', () => {
    const all = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    // Two wrong points (one of them main) and «не знаю» on it: both caps say 3.
    const tie = gradeAnswer(
      pointsOf({ p1: 'wrong', p2: 'covered', p3: 'covered', p4: 'covered', p5: 'covered', p6: 'wrong' }, ['p1', 'p2', 'p3', 'p4']),
      { point_id: 'p1', status: 'missing' },
    );
    expect(tie).toMatchObject({ grade: 3, cap: 'essential_unrecovered' });
    // Two wrong points without a follow-up: two_wrong sets 3, essential_wrong only 4.
    const twoWrong = gradeAnswer(pointsOf({ p1: 'wrong', p2: 'wrong', p3: 'covered', p4: 'covered', p5: 'covered', p6: 'covered' }, all), null);
    expect(twoWrong).toMatchObject({ score: 67, grade: 3, cap: 'two_wrong' });
    // No cap lowered a grade that the score already put at 3.
    const already = gradeAnswer(pointsOf({ p1: 'missing', p2: 'covered', p3: 'covered' }, ['p1', 'p2']), { point_id: 'p1', status: 'missing' });
    expect(already).toMatchObject({ score: 60, grade: 3, cap: null, capPoint: null });
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

  it('keeps the score and the grade for the save: record_oral_attempt requires them', () => {
    const result = gradeAnswer(
      pointsOf({ p1: 'covered', p2: 'covered', p3: 'covered', p4: 'missing', p5: 'covered' }, ['p1', 'p2', 'p3', 'p4']),
      { point_id: 'p4', status: 'missing' },
    );
    // (2 + 2 + 2 + 0 + 1) / 9 = 78 of 100, capped at 3 by the unrecovered main point.
    expect(result).toMatchObject({ score: 78, grade: 3, passed: false, sumWeighted: 7, sumWeights: 9 });
    expect(result.terms.map((term) => term.weight * term.credit)).toEqual([2, 2, 2, 0, 1]);
  });

  it('has no score and no grade when no point was rated', () => {
    expect(gradeAnswer(pointsOf({ p1: 'unrated' }, ['p1']), null)).toMatchObject({ score: null, grade: null, passed: false, terms: [] });
  });
});
