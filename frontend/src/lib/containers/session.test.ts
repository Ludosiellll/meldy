import { describe, expect, it } from 'vitest';
import type { DayPlan } from '../../types/container';
import { SESSION_SIZE, planDay } from './plan.ts';
import {
  MAX_RETRIES, RETRY_GAP_MAX, RETRY_GAP_MIN, afterAnswer, buildSession, counter, figureChange, freeSession, hashSeed, optionOrder,
  pinnedLast, prng, shuffled, type QueueEntry,
} from './session.ts';
import type { AnswerResult, UnitState } from '../../types/container';
import { at, makeInput, oralItems, stateAfter, testItems } from './__fixtures__/scenarios.ts';

function planWith(sessions: DayPlan['sessions']): DayPlan {
  const plan = planDay(makeInput({ now: at('2026-10-10', '09:00'), subjects: [{ id: 's', date: null }], items: [] }));
  return { ...plan, sessions };
}

describe('prng', () => {
  it('is seeded: the same seed, the same numbers; another seed, others', () => {
    const a = prng('session-1');
    const b = prng('session-1');
    const c = prng('session-2');
    const xs = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
    expect(Array.from({ length: 50 }, () => c())).not.toEqual(xs);
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    expect(hashSeed('')).toBe(0x811c9dc5);
  });

  it('spreads evenly enough for shuffles', () => {
    const next = prng('spread');
    const bins = [0, 0, 0, 0];
    for (let i = 0; i < 4000; i += 1) bins[Math.floor(next() * 4)] += 1;
    for (const n of bins) expect(n).toBeGreaterThan(850);
  });

  it('shuffles without losing anything', () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const s = shuffled(items, 'x');
    expect([...s].sort((a, b) => a - b)).toEqual(items);
    expect(s).not.toEqual(items);
    expect(shuffled(items, 'x')).toEqual(s);
  });
});

describe('buildSession', () => {
  const ids = Array.from({ length: 45 }, (_, i) => `q${i}`);
  const plan = planWith([
    { subjectId: 'a', kind: 'answer', ids: ids.slice(0, 20), estSec: 900 },
    { subjectId: 'b', kind: 'answer', ids: ['b1', 'b2'], estSec: 90 },
    { subjectId: 'a', kind: 'answer', ids: ids.slice(20, 40), estSec: 900 },
    { subjectId: 'a', kind: 'self_check', ids: ['o1', 'o2'], estSec: 120 },
    { subjectId: 'a', kind: 'ai_check', ids: ['x1', 'x2', 'x3'], estSec: 450 },
    { subjectId: 'a', kind: 'ai_check', ids: ['x4'], estSec: 150 },
  ]);

  it('takes the subject\'s next 20 questions not answered yet, in a seeded order', () => {
    const q = buildSession(plan, 'a', 'answer', ['q0', 'q1', 'q5'], 'seed-1');
    expect(q).toHaveLength(20);
    expect(q.every((e) => e.retry === 0)).toBe(true);
    const got = q.map((e) => e.id);
    expect(new Set(got)).toEqual(new Set(ids.slice(0, 23).filter((id) => !['q0', 'q1', 'q5'].includes(id))));
    expect(buildSession(plan, 'a', 'answer', ['q0', 'q1', 'q5'], 'seed-1')).toEqual(q);
    expect(buildSession(plan, 'a', 'answer', ['q0', 'q1', 'q5'], 'seed-2').map((e) => e.id)).not.toEqual(got);
  });

  it('never mixes subjects or formats; AI checks keep the plan order, at most 3 (one ticket)', () => {
    expect(buildSession(plan, 'b', 'answer', [], 's').map((e) => e.id).sort()).toEqual(['b1', 'b2']);
    expect(buildSession(plan, 'a', 'self_check', [], 's').map((e) => e.id).sort()).toEqual(['o1', 'o2']);
    expect(buildSession(plan, 'a', 'ai_check', [], 's').map((e) => e.id)).toEqual(['x1', 'x2', 'x3']);
    expect(buildSession(plan, 'a', 'ai_check', ['x1'], 's').map((e) => e.id)).toEqual(['x2', 'x3', 'x4']);
    expect(buildSession(plan, 'c', 'answer', [], 's')).toEqual([]);
  });

  it('sizes: 20 with options, 10 self-checks, 3 AI checks', () => {
    expect(SESSION_SIZE).toEqual({ answer: 20, self_check: 10, ai_check: 3 });
    const many = planWith([{ subjectId: 'a', kind: 'self_check', ids: Array.from({ length: 25 }, (_, i) => `o${i}`), estSec: 0 }]);
    expect(buildSession(many, 'a', 'self_check', [], 's')).toHaveLength(10);
  });
});

describe('afterAnswer: retries', () => {
  const base: QueueEntry[] = Array.from({ length: 20 }, (_, i) => ({ id: `q${i}`, retry: 0 }));

  it('brings a wrong answer back 3–5 questions later, as a retry', () => {
    const gaps = new Set<number>();
    for (let s = 0; s < 60; s += 1) {
      const q = afterAnswer(base, 4, { id: 'q4', correct: false }, `seed-${s}`);
      expect(q).toHaveLength(21);
      const at_ = q.findIndex((e, i) => i > 4 && e.id === 'q4');
      expect(q[at_]).toEqual({ id: 'q4', retry: 1 });
      gaps.add(at_ - 4);
    }
    expect([...gaps].sort()).toEqual([3, 4, 5]);
    expect(RETRY_GAP_MIN).toBe(3);
    expect(RETRY_GAP_MAX).toBe(5);
  });

  it('at most twice', () => {
    let q = afterAnswer(base, 0, { id: 'q0', correct: false }, 's');
    const r1 = q.findIndex((e) => e.id === 'q0' && e.retry === 1);
    q = afterAnswer(q, r1, { id: 'q0', correct: false }, 's');
    const r2 = q.findIndex((e) => e.id === 'q0' && e.retry === 2);
    expect(r2).toBeGreaterThan(r1);
    const after = afterAnswer(q, r2, { id: 'q0', correct: false }, 's');
    expect(after).toEqual(q);
    expect(q.filter((e) => e.id === 'q0')).toHaveLength(1 + MAX_RETRIES);
  });

  it('a right answer, a right retry and a misclick change nothing', () => {
    expect(afterAnswer(base, 3, { id: 'q3', correct: true }, 's')).toEqual(base);
    expect(afterAnswer(base, 3, { id: 'q3', correct: false, misclick: true }, 's')).toEqual(base);
    const q = afterAnswer(base, 3, { id: 'q3', correct: false }, 's');
    const r = q.findIndex((e) => e.retry === 1);
    expect(afterAnswer(q, r, { id: 'q3', correct: true }, 's')).toEqual(q);
  });

  it('near the end the retry goes last; a stale position changes nothing; the input stays untouched', () => {
    const q = afterAnswer(base, 19, { id: 'q19', correct: false }, 's');
    expect(q[20]).toEqual({ id: 'q19', retry: 1 });
    expect(afterAnswer(base, 2, { id: 'q9', correct: false }, 's')).toEqual(base);
    expect(base).toHaveLength(20);
  });

  it('is seeded: the same seed puts the retry at the same place', () => {
    expect(afterAnswer(base, 6, { id: 'q6', correct: false }, 'k')).toEqual(afterAnswer(base, 6, { id: 'q6', correct: false }, 'k'));
  });

  it('counts «7 из 20» over planned questions only', () => {
    let q = afterAnswer(base, 0, { id: 'q0', correct: false }, 's');
    expect(counter(q, 0)).toEqual({ n: 1, of: 20 });
    const r = q.findIndex((e) => e.retry === 1);
    expect(counter(q, r)).toEqual({ n: r, of: 20 });
    q = afterAnswer(q, r, { id: 'q0', correct: false }, 's');
    expect(counter(q, q.length - 1)).toEqual({ n: 20, of: 20 });
  });
});

describe('optionOrder', () => {
  it('reshuffles per show: the seed decides, every index stays', () => {
    const a = optionOrder(5, false, [], 'q7:0');
    expect([...a].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(optionOrder(5, false, [], 'q7:0')).toEqual(a);
    const seen = new Set<string>();
    for (let r = 0; r < 12; r += 1) seen.add(optionOrder(5, false, [], `q7:${r}`).join());
    expect(seen.size).toBeGreaterThan(6);
  });

  it('keep_order keeps the file order', () => {
    expect(optionOrder(4, true, [3], 'x')).toEqual([0, 1, 2, 3]);
    expect(optionOrder(1, false, [], 'x')).toEqual([0]);
    expect(optionOrder(0, false, [], 'x')).toEqual([]);
  });

  it('«Все перечисленные» and the like stay last, in file order', () => {
    for (let r = 0; r < 20; r += 1) {
      const order = optionOrder(6, false, [5, 2], `s${r}`);
      expect(order.slice(4)).toEqual([2, 5]);
      expect([...order.slice(0, 4)].sort()).toEqual([0, 1, 3, 4]);
    }
    expect(optionOrder(3, false, [7, -1], 's').length).toBe(3);
  });

  it('pinnedLast finds the options that must stay last', () => {
    expect(pinnedLast(['Стек', 'Очередь', 'Все перечисленные'])).toEqual([2]);
    expect(pinnedLast(['а) 1', 'б) 2', 'в) Всё вышеперечисленное.'])).toEqual([2]);
    expect(pinnedLast(['Ни один из перечисленных', 'Да', 'Нет'])).toEqual([0]);
    expect(pinnedLast(['Все ответы верны', 'Оба варианта верны', 'Нет правильного ответа', 'None of the above'])).toEqual([0, 1, 2, 3]);
    expect(pinnedLast(['Все переменные', 'Всегда', 'Все объекты класса'])).toEqual([]);
  });
});

describe('figureChange (the end-of-session headline, spec #49)', () => {
  it('counts questions that reached «верно в два разных дня», left it, or came too early — each once', () => {
    const inFig = stateAfter([{ at: at('2026-10-01', '10:00'), correct: true }, { at: at('2026-10-02', '10:00'), correct: true }]);
    const started = stateAfter([{ at: at('2026-10-09', '21:00'), correct: true }]);
    const before = new Map<string, UnitState | undefined>([['a', started], ['b', inFig], ['c', started], ['d', undefined], ['e', started]]);
    const r = (item_id: string, step: AnswerResult['step'], status: AnswerResult['status'] = 'saved'): AnswerResult => ({ client_event_id: `x-${item_id}-${step}`, item_id, status, step });
    expect(figureChange(before, [
      r('a', 'two_days'), r('b', 'miss'), r('b', 'miss'), r('c', 'too_early'), r('d', 'miss'), r('e', 'two_days', 'duplicate'), r('e', 'too_early', 'late'),
    ])).toEqual({ gained: 1, dropped: 1, tooEarly: 1 });
    expect(figureChange(before, [])).toEqual({ gained: 0, dropped: 0, tooEarly: 0 });
  });
});

describe('freeSession', () => {
  const now = at('2026-10-10', '12:00');
  const items = testItems('s', 30, 10);
  const wrong = stateAfter([{ at: at('2026-10-08', '20:00'), correct: false }]);
  const wrongLater = stateAfter([{ at: at('2026-10-09', '20:00'), correct: false }]);
  const started = stateAfter([{ at: at('2026-10-09', '20:00'), correct: true }]);
  items[3].u = wrongLater;
  items[12].u = wrong;
  items[25].u = started;
  const input = makeInput({ now, subjects: [{ id: 's', date: '2026-10-30' }, { id: 'z', date: null }], items: [...items, ...testItems('z', 5), ...oralItems('s', 3)] });

  it('«Только ошибки»: the subject\'s open errors, oldest first, nothing else', () => {
    const q = freeSession(input, { subjectId: 's', onlyErrors: true }, [], 'x');
    expect(q.map((e) => e.id).sort()).toEqual([items[3].id, items[12].id].sort());
  });

  it('a topic: its questions, errors first, capped at 20, seeded', () => {
    const q = freeSession(input, { subjectId: 's', topic: 2 }, [], 'x');
    expect(q.map((e) => e.id).sort()).toEqual(items.slice(10, 20).map((i) => i.id).sort());
    const small = freeSession(input, { subjectId: 's', size: 3 }, [], 'x').map((e) => e.id);
    expect(small).toHaveLength(3);
    expect(small).toContain(items[3].id);
    expect(small).toContain(items[12].id);
    expect(small).toContain(items[25].id);
    expect(freeSession(input, { subjectId: 's', topic: 2 }, [items[11].id], 'x').map((e) => e.id)).not.toContain(items[11].id);
    expect(freeSession(input, { subjectId: 's' }, [], 'x')).toEqual(freeSession(input, { subjectId: 's' }, [], 'x'));
    expect(freeSession(input, { subjectId: 's' }, [], 'x')).toHaveLength(20);
  });
});
