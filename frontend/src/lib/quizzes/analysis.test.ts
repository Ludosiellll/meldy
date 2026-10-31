import { describe, expect, it } from 'vitest';
import {
  compareWith,
  fastSign,
  fastSigns,
  itemInsights,
  MIN_FOR_VERDICT,
  needsRewrite,
  repeatRows,
  retakesOf,
  secondsText,
  trapOf,
  verdictOf,
} from './analysis';
import type { QuizAnalysis, QuizAnalysisAttempt, QuizAnalysisCell, QuizAttemptRow } from '../../types/quiz';

const attempt = (i: number, cells: QuizAnalysisCell[], extra: Partial<QuizAnalysisAttempt> = {}): QuizAnalysisAttempt => ({
  id: `a${i}`,
  person: `p${i}`,
  n: 1,
  guest: false,
  member: true,
  sent: false,
  started_at: '2026-11-05T09:00:00Z',
  finished_at: '2026-11-05T09:10:00Z',
  cells,
  ...extra,
});

/**
 * 20 people of rising strength s = 0..19: four «ability» questions they get right from a level up (the rest of the
 * attempt), «good» right from s ≥ 10, «flat» right on every other person whatever the strength, «reverse» right only
 * for the weak half.
 */
function classOf(n = 20): QuizAnalysis {
  const items = ['good', 'flat', 'reverse', 'k1', 'k2', 'k3', 'k4'];
  const attempts = Array.from({ length: n }, (_, s) => {
    const level = s / (n - 1);
    const cells: QuizAnalysisCell[] = [
      [0, s >= n / 2 ? 1 : 0, 20 + s],
      [1, s % 2, 30],
      [2, s < n / 2 ? 1 : 0, 10],
      [3, level > 0.2 ? 1 : 0, null],
      [4, level > 0.4 ? 1 : 0, 5],
      [5, level > 0.6 ? 1 : 0, 5],
      [6, level > 0.8 ? 1 : 0, 5],
    ];
    return attempt(s, cells);
  });
  return { quiz_id: 'q', server_now: '', items, attempts, others: [] };
}

describe('discrimination (item-rest correlation)', () => {
  it('tells a question that follows the strength from one that does not and one that goes against it', () => {
    const insight = itemInsights(classOf());
    expect(insight.get('good')?.verdict).toBe('good');
    expect(insight.get('good')?.upper).toBe(1);
    expect(insight.get('good')?.lower).toBe(0);
    expect(needsRewrite(insight.get('flat')?.verdict ?? null)).toBe(true);
    expect(insight.get('reverse')?.verdict).toBe('reverse');
    expect(insight.get('reverse')?.r).toBeLessThan(-0.5);
    expect(insight.get('good')?.mean).toBe(0.5);
    expect(insight.get('good')?.n).toBe(20);
  });

  it('says nothing below the threshold of attempts, or when everybody scored the same', () => {
    const few = itemInsights(classOf(MIN_FOR_VERDICT - 1));
    expect(few.get('good')?.r).toBeGreaterThan(0.3);
    expect(few.get('good')?.verdict).toBeNull();
    const same: QuizAnalysis = { ...classOf(), attempts: classOf().attempts.map((a) => ({ ...a, cells: a.cells.map((c) => (c[0] === 0 ? [0, 1, c[2]] : c)) as QuizAnalysisCell[] })) };
    expect(itemInsights(same).get('good')?.r).toBeNull();
    expect(itemInsights(same).get('good')?.verdict).toBeNull();
    expect(verdictOf(0.2, MIN_FOR_VERDICT)).toBe('weak');
    expect(verdictOf(0, MIN_FOR_VERDICT)).toBe('poor');
    expect(verdictOf(-0.2, MIN_FOR_VERDICT)).toBe('reverse');
  });

  it('leaves an essay waiting for its mark out, and counts no answer as no credit', () => {
    const analysis: QuizAnalysis = {
      quiz_id: 'q',
      server_now: '',
      items: ['e', 'x'],
      attempts: [attempt(1, [[0, null, 30], [1, 0, null]]), attempt(2, [[0, 1, 20], [1, 1, 5]])],
      others: [],
    };
    const insight = itemInsights(analysis);
    expect(insight.get('e')?.n).toBe(1);
    expect(insight.get('x')?.n).toBe(2);
    expect(insight.get('x')?.mean).toBe(0.5);
  });

  it('the usual time is the median of the answered cells, from three of them', () => {
    const insight = itemInsights(classOf());
    expect(insight.get('good')?.medianSec).toBe(29.5);
    expect(insight.get('k1')?.medianSec).toBeNull();
    const two: QuizAnalysis = { quiz_id: 'q', server_now: '', items: ['x'], attempts: [attempt(1, [[0, 1, 10]]), attempt(2, [[0, 1, 30]])], others: [] };
    expect(itemInsights(two).get('x')?.medianSec).toBeNull();
  });
});

describe('the trap option', () => {
  const item = { kind: 'single' as const, options: ['А', 'Б', 'В', 'Г'], correct: [0] };
  it('is the wrong option chosen most, from 2 people and a fifth of the answers', () => {
    expect(trapOf({ picks: [10, 6, 2, 2], answered: 20 }, item)).toEqual({ index: 1, n: 6, answered: 20 });
    expect(trapOf({ picks: [17, 1, 1, 1], answered: 20 }, item)).toBeNull();
    expect(trapOf({ picks: [1, 1, 0, 0], answered: 2 }, item)).toBeNull();
  });
  it('none for other kinds, no key, or picks that do not match the options', () => {
    expect(trapOf({ picks: [], answered: 5 }, { kind: 'order', options: ['А', 'Б'], correct: [] })).toBeNull();
    expect(trapOf({ picks: [1, 5], answered: 6 }, { ...item, options: ['А', 'Б'], correct: [] })).toBeNull();
    expect(trapOf({ picks: [1, 5], answered: 6 }, item)).toBeNull();
  });
});

const row = (id: string, person: string, n: number, correct: number, extra: Partial<QuizAttemptRow> = {}): QuizAttemptRow => ({
  id,
  person,
  name: person,
  own: false,
  guest: false,
  n,
  started_at: '2026-11-05T09:00:00Z',
  deadline_at: null,
  finished_at: '2026-11-05T09:10:00Z',
  finish_reason: 'sent',
  total: 10,
  answered: 10,
  correct,
  ...extra,
});

describe('retakes', () => {
  it('compares the first and the last attempt of people who wrote twice or more', () => {
    const r = retakesOf([row('1', 'a', 1, 4), row('2', 'a', 2, 6), row('3', 'a', 3, 8), row('4', 'b', 1, 5), row('5', 'b', 2, 9), row('6', 'c', 1, 10)]);
    expect(r).toEqual({ people: 2, first: 45, last: 85 });
  });
  it('leaves out the author, unfinished attempts and people with one attempt; points when the quiz weighs them', () => {
    expect(retakesOf([row('1', 'a', 1, 4, { own: true }), row('2', 'a', 2, 6, { own: true })])).toBeNull();
    expect(retakesOf([row('1', 'a', 1, 4), row('2', 'a', 2, 6, { finished_at: null })])).toBeNull();
    expect(retakesOf([row('1', 'a', 1, 0, { score: 2, max_score: 8 }), row('2', 'a', 2, 0, { score: 6, max_score: 8 })])).toEqual({ people: 1, first: 25, last: 75 });
  });
});

describe('another quiz of the same exam', () => {
  it('compares on the questions both had', () => {
    const analysis: QuizAnalysis = {
      quiz_id: 'q',
      server_now: '',
      items: ['x', 'y', 'z'],
      attempts: [attempt(1, [[0, 1, 5], [1, 0, 5]]), attempt(2, [[0, 1, 5], [1, 1, 5]])],
      others: [],
    };
    const other = { id: 'o', title: '9Б', created_at: '', closed: true, attempts: 4, items: [[0, 4, 1], [2, 4, 4]] as Array<[number, number, number]> };
    const c = compareWith(analysis, other);
    expect(c.common).toBe(1);
    expect(c.here).toBe(1);
    expect(c.there).toBe(0.25);
    expect(c.perItem.get('x')).toEqual({ share: 0.25, shown: 4 });
    expect(c.perItem.get('z')).toEqual({ share: 1, shown: 4 });
    expect(c.perItem.has('y')).toBe(false);
  });
});

describe('who repeats what', () => {
  it('each person once (the latest attempt), the questions not fully right in the exam order, by name', () => {
    const analysis: QuizAnalysis = {
      quiz_id: 'q',
      server_now: '',
      items: ['x', 'y', 'z'],
      attempts: [
        attempt(1, [[0, 0, 5], [1, 0, 5]], { person: 'pa', n: 1 }),
        attempt(2, [[2, 0.5, 5], [0, 0, null], [1, 1, 5]], { person: 'pa', n: 2, sent: true }),
        attempt(3, [[0, 1, 5]], { person: 'pg', guest: true, member: false }),
        attempt(4, [[1, null, 5], [2, 0, 5]], { person: 'po', member: false }),
      ],
      others: [],
    };
    const names = [row('a2', 'Яна', 2, 0), row('a3', 'Гость', 1, 0), row('a4', 'Борис', 1, 0)].map((r) => ({ ...r, name: r.person }));
    const rows = repeatRows(analysis, names);
    expect(rows.map((r) => [r.name, r.who, r.items, r.partial, r.sent])).toEqual([
      ['Борис', 'outside', ['z'], 0, false],
      ['Гость', 'guest', [], 0, false],
      ['Яна', 'member', ['x', 'z'], 1, true],
    ]);
  });
});

describe('the speed signal', () => {
  it('five answers or more at under 3 seconds each', () => {
    const quick = attempt(1, Array.from({ length: 20 }, (_, i) => [i, 1, 2] as QuizAnalysisCell));
    expect(fastSign(quick)).toEqual({ answers: 20, seconds: 40 });
    expect(fastSign(attempt(2, Array.from({ length: 20 }, (_, i) => [i, 1, 3] as QuizAnalysisCell)))).toBeNull();
    expect(fastSign(attempt(3, Array.from({ length: 4 }, (_, i) => [i, 1, 1] as QuizAnalysisCell)))).toBeNull();
    expect(fastSign(attempt(4, [...Array.from({ length: 5 }, (_, i) => [i, 1, 1] as QuizAnalysisCell), [5, 0, null]]))).toEqual({ answers: 5, seconds: 5 });
    expect([...fastSigns({ quiz_id: 'q', server_now: '', items: [], attempts: [quick], others: [] }).keys()]).toEqual(['a1']);
    expect(fastSigns(null).size).toBe(0);
  });
});

describe('seconds in words', () => {
  it('reads as people say it', () => {
    expect(secondsText(0.4)).toBe('1 с');
    expect(secondsText(25)).toBe('25 с');
    expect(secondsText(100)).toBe('1 мин 40 с');
    expect(secondsText(120)).toBe('2 мин');
    expect(secondsText(725)).toBe('12 мин');
  });
});
