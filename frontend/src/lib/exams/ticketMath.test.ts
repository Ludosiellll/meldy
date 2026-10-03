import { describe, expect, it } from 'vitest';
import {
  binom,
  layoutShares,
  percent,
  reduce,
  sectionsOf,
  ticketShare,
  ticketShareRange,
  type ShareQuestion,
} from './ticketMath';

function list(total: number, yes: number, maybe = 0, section: (index: number) => number | null = () => null): ShareQuestion[] {
  return Array.from({ length: total }, (_, index) => ({
    id: `q${index + 1}`,
    section: section(index),
    status: index < yes ? 'yes' : index < yes + maybe ? 'maybe' : 'no',
  }));
}

describe('binom', () => {
  it('computes exact binomial coefficients', () => {
    expect(binom(40, 2)).toBe(780);
    expect(binom(24, 2)).toBe(276);
    expect(binom(16, 2)).toBe(120);
    expect(binom(300, 4)).toBe(330_791_175);
    expect(binom(5, 0)).toBe(1);
    expect(binom(3, 4)).toBe(0);
    expect(binom(-1, 1)).toBe(0);
  });
});

describe('ticketShare: random tickets', () => {
  it('gives 276/780 for both questions and 1 − 120/780 for at least one (24 of 40, q = 2)', () => {
    const result = ticketShare({ mode: 'random', perTicket: 2, questions: list(40, 24) });
    expect(result.ok).toBe(true);
    if (!result.ok || result.mode !== 'random') throw new Error('expected a random share');
    expect(result.all).toEqual({ num: 276, den: 780 });
    expect(result.none).toEqual({ num: 120, den: 780 });
    expect(result.atLeastOne).toEqual({ num: 660, den: 780 });
    expect(percent(result.all)).toBe(35);
    expect(percent(result.atLeastOne)).toBe(85);
    expect(result).toMatchObject({ n: 40, k: 24, q: 2 });
  });

  it('works for q = 1…4', () => {
    const questions = list(40, 24);
    for (const q of [1, 2, 3, 4]) {
      const result = ticketShare({ mode: 'random', perTicket: q, questions });
      if (!result.ok) throw new Error(result.reason);
      expect(result.all).toEqual({ num: binom(24, q), den: binom(40, q) });
      expect(result.atLeastOne).toEqual({ num: binom(40, q) - binom(16, q), den: binom(40, q) });
    }
    const single = ticketShare({ mode: 'random', perTicket: 1, questions });
    if (!single.ok) throw new Error(single.reason);
    expect(reduce(single.all)).toEqual({ num: 3, den: 5 });
  });

  it('gives 0 when fewer questions qualify than a ticket holds (K < q)', () => {
    const result = ticketShare({ mode: 'random', perTicket: 3, questions: list(10, 2) });
    if (!result.ok) throw new Error(result.reason);
    expect(result.all.num).toBe(0);
    expect(percent(result.all)).toBe(0);
  });

  it('returns a failure with a reason when q > N', () => {
    const result = ticketShare({ mode: 'random', perTicket: 3, questions: list(2, 2) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('q_gt_n');
    expect(result.reason).toMatch(/всего 2/);
  });

  it('rejects q outside 1…4 and an empty list', () => {
    expect(ticketShare({ mode: 'random', perTicket: 5, questions: list(10, 5) })).toMatchObject({ ok: false, code: 'bad_q' });
    expect(ticketShare({ mode: 'random', perTicket: 2, questions: [] })).toMatchObject({ ok: false, code: 'no_questions' });
  });
});

describe('ticketShare: one question from each section', () => {
  it('multiplies the shares of the sections (14/20 × 10/20)', () => {
    const questions = list(40, 0).map((question, index) => ({
      ...question,
      section: index < 20 ? 1 : 2,
      status: (index < 14 || (index >= 20 && index < 30) ? 'yes' : 'no') as ShareQuestion['status'],
    }));
    const result = ticketShare({ mode: 'sections', perTicket: 2, questions });
    if (!result.ok || result.mode !== 'sections') throw new Error('expected a sections share');
    expect(result.sections).toEqual([
      { section: 1, n: 20, k: 14 },
      { section: 2, n: 20, k: 10 },
    ]);
    expect(result.all).toEqual({ num: 140, den: 400 });
    expect(percent(result.all)).toBe(35);
    // 1 − (6/20 × 10/20) = 1 − 60/400
    expect(result.atLeastOne).toEqual({ num: 340, den: 400 });
  });

  it('fails with a reason when the number of sections differs from q', () => {
    const questions = list(9, 5, 0, (index) => (index % 3) + 1);
    const result = ticketShare({ mode: 'sections', perTicket: 2, questions });
    expect(result).toMatchObject({ ok: false, code: 'sections_mismatch' });
    if (!result.ok) expect(result.reason).toMatch(/Разделов в списке 3, а вопросов в билете 2/);
  });

  it('lists sections in order and ignores questions without a section', () => {
    expect(sectionsOf([{ section: 2 }, { section: null }, { section: 1 }, { section: 2 }])).toEqual([1, 2]);
  });
});

describe('ticketShare: known tickets', () => {
  it('counts the tickets directly over their question ids', () => {
    const questions = list(6, 3); // q1..q3 yes, q4..q6 no
    const tickets = [
      { number: 1, questionIds: ['q1', 'q2'] }, // both
      { number: 2, questionIds: ['q3', 'q4'] }, // one
      { number: 3, questionIds: ['q5', 'q6'] }, // none
      { number: 4, questionIds: ['q1', 'q6'] }, // one
    ];
    const result = ticketShare({ mode: 'fixed', perTicket: 2, questions, tickets });
    if (!result.ok || result.mode !== 'fixed') throw new Error('expected a fixed share');
    expect(result).toMatchObject({ tickets: 4, allCount: 1, anyCount: 3 });
    expect(result.all).toEqual({ num: 1, den: 4 });
    expect(result.atLeastOne).toEqual({ num: 3, den: 4 });
  });

  it('skips deleted question ids and tickets left without questions', () => {
    const questions = list(2, 1); // q1 yes, q2 no
    const tickets = [
      { number: 1, questionIds: ['q1', 'gone'] }, // only q1 left → all
      { number: 2, questionIds: ['gone-2'] }, // nothing left → skipped
      { number: 3, questionIds: ['q2'] },
    ];
    const result = ticketShare({ mode: 'fixed', perTicket: 2, questions, tickets });
    if (!result.ok || result.mode !== 'fixed') throw new Error('expected a fixed share');
    expect(result.tickets).toBe(2);
    expect(result.all).toEqual({ num: 1, den: 2 });
  });

  it('fails without tickets', () => {
    expect(ticketShare({ mode: 'fixed', perTicket: 2, questions: list(4, 2), tickets: [] })).toMatchObject({
      ok: false,
      code: 'no_tickets',
    });
  });
});

describe('ranges with questions checked only by words', () => {
  it('counts them as not covered for the low bound and as covered for the high bound', () => {
    // 24 yes + 4 maybe of 40: low C(24,2)/C(40,2) = 35%, high C(28,2)/C(40,2) = 378/780 = 48%
    const range = ticketShareRange({ mode: 'random', perTicket: 2, questions: list(40, 24, 4) });
    if (!range.low.ok || !range.high.ok) throw new Error('expected shares');
    expect(range.isRange).toBe(true);
    expect(range.low.all).toEqual({ num: 276, den: 780 });
    expect(range.high.all).toEqual({ num: 378, den: 780 });
    expect(percent(range.low.all)).toBe(35);
    expect(percent(range.high.all)).toBe(48);
  });

  it('is not a range without unknown questions', () => {
    const range = ticketShareRange({ mode: 'random', perTicket: 2, questions: list(40, 24) });
    expect(range.isRange).toBe(false);
    expect(range.high).toBe(range.low);
  });
});

describe('layoutShares', () => {
  it('falls back to random tickets with the reason when sections do not match', () => {
    const questions = list(9, 5, 0, (index) => (index % 3) + 1);
    const shares = layoutShares({ mode: 'sections', perTicket: 2, questions });
    expect(shares.mode).toBe('random');
    expect(shares.fallbackReason).toMatch(/Разделов в списке 3/);
    expect(shares.low).toMatchObject({ ok: true, mode: 'random', n: 9, k: 5, q: 2 });
  });

  it('keeps the stored layout when it fits', () => {
    const shares = layoutShares({
      mode: 'fixed',
      perTicket: 2,
      questions: list(4, 2),
      tickets: [{ number: 1, questionIds: ['q1', 'q2'] }, { number: 2, questionIds: ['q3', 'q4'] }],
    });
    expect(shares.mode).toBe('fixed');
    expect(shares.fallbackReason).toBeNull();
    expect(shares.low).toMatchObject({ ok: true, allCount: 1, anyCount: 1 });
  });
});
