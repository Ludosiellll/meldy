import { afterEach, describe, expect, it } from 'vitest';
import { lcg } from '../../components/landing/handStroke';
import type { Readiness } from '../learning/readiness';
import {
  drawTicket,
  readRecentTickets,
  recentTicketsKey,
  rememberTicket,
  ticketKey,
  WEAK_WEIGHTS,
  type DrawQuestion,
} from './draw';

function question(id: string, overrides: Partial<DrawQuestion> = {}): DrawQuestion {
  return { id, section: null, coverage: 'full', readiness: 'untested', attempts: 0, ...overrides };
}

function questions(count: number, overrides: (index: number) => Partial<DrawQuestion> = () => ({})): DrawQuestion[] {
  return Array.from({ length: count }, (_, index) => question(`q${index + 1}`, overrides(index)));
}

/** Expected count ± 3σ of a binomial(n, p). */
function within3Sigma(observed: number, n: number, p: number) {
  const mean = n * p;
  const sigma = Math.sqrt(n * p * (1 - p));
  expect(observed).toBeGreaterThanOrEqual(mean - 3 * sigma);
  expect(observed).toBeLessThanOrEqual(mean + 3 * sigma);
}

afterEach(() => {
  window.sessionStorage.clear();
});

describe('drawTicket «Как на экзамене»', () => {
  it('draws every question equally often (seeded, ±3σ)', () => {
    const rng = lcg(20261003);
    const list = questions(10);
    const counts = new Map<string, number>();
    const draws = 20_000;
    for (let i = 0; i < draws; i += 1) {
      const result = drawTicket({ mode: 'exam', layout: { mode: 'random', perTicket: 1 }, questions: list, rng });
      if (!result.ok) throw new Error(result.message);
      const id = result.ticket.questionIds[0];
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const item of list) within3Sigma(counts.get(item.id) ?? 0, draws, 0.1);
  });

  it('draws q distinct questions in list order for random tickets', () => {
    const rng = lcg(7);
    const list = questions(40);
    for (let i = 0; i < 200; i += 1) {
      const result = drawTicket({ mode: 'exam', layout: { mode: 'random', perTicket: 2 }, questions: list, rng });
      if (!result.ok) throw new Error(result.message);
      const [a, b] = result.ticket.questionIds;
      expect(a).not.toBe(b);
      expect(list.findIndex((q) => q.id === a)).toBeLessThan(list.findIndex((q) => q.id === b));
      expect(result.ticket.number).toBeNull();
    }
  });

  it('draws known tickets whole, by their question ids', () => {
    const rng = lcg(11);
    const list = questions(6);
    const tickets = [
      { number: 1, questionIds: ['q1', 'q4'] },
      { number: 2, questionIds: ['q2', 'q5'] },
      { number: 3, questionIds: ['q3', 'q6'] },
    ];
    const result = drawTicket({ mode: 'exam', layout: { mode: 'fixed', perTicket: 2, tickets }, questions: list, rng });
    if (!result.ok) throw new Error(result.message);
    const ticket = tickets.find((item) => item.number === result.ticket.number);
    expect(ticket).toBeDefined();
    expect(result.ticket.questionIds).toEqual(ticket!.questionIds);
    expect(result.ticket.key).toBe(`t:${ticket!.number}`);
  });

  it('takes one question from each section when the layout says so', () => {
    const rng = lcg(5);
    const list = questions(10, (index) => ({ section: index < 6 ? 1 : 2 }));
    for (let i = 0; i < 100; i += 1) {
      const result = drawTicket({ mode: 'exam', layout: { mode: 'sections', perTicket: 2 }, questions: list, rng });
      if (!result.ok) throw new Error(result.message);
      const sections = result.ticket.questionIds.map((id) => list.find((q) => q.id === id)!.section);
      expect(sections).toEqual([1, 2]);
    }
  });

  it('can draw a question that is not in the lectures, like a real exam', () => {
    const rng = lcg(3);
    const list = questions(2, (index) => ({ coverage: index === 0 ? 'none' : 'full' }));
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const result = drawTicket({ mode: 'exam', layout: { mode: 'random', perTicket: 1 }, questions: list, rng });
      if (result.ok) seen.add(result.ticket.questionIds[0]);
    }
    expect(seen.has('q1')).toBe(true);
  });
});

describe('drawTicket «Чаще слабые»', () => {
  it('never draws a question that is not in the lectures', () => {
    const rng = lcg(99);
    const list = questions(12, (index) => ({ coverage: index % 3 === 0 ? 'none' : 'partial' }));
    for (let i = 0; i < 2000; i += 1) {
      const result = drawTicket({ mode: 'weak', layout: { mode: 'random', perTicket: 2 }, questions: list, rng });
      if (!result.ok) throw new Error(result.message);
      for (const id of result.ticket.questionIds) expect(list.find((q) => q.id === id)!.coverage).not.toBe('none');
    }
  });

  it('draws by the readiness weights (seeded, ±3σ)', () => {
    const rng = lcg(424242);
    const readiness: Readiness[] = ['untested', 'not_passed', 'once', 'confirmed'];
    const list = readiness.map((value, index) => question(`w${index}`, { readiness: value }));
    const total = readiness.reduce((sum, value) => sum + WEAK_WEIGHTS[value], 0); // 3 + 3 + 2 + 1 = 9
    const counts = new Map<string, number>();
    const draws = 18_000;
    for (let i = 0; i < draws; i += 1) {
      const result = drawTicket({ mode: 'weak', layout: { mode: 'random', perTicket: 1 }, questions: list, rng });
      if (!result.ok) throw new Error(result.message);
      counts.set(result.ticket.questionIds[0], (counts.get(result.ticket.questionIds[0]) ?? 0) + 1);
    }
    list.forEach((item) => within3Sigma(counts.get(item.id) ?? 0, draws, WEAK_WEIGHTS[item.readiness] / total));
  });

  it('says so when every question is missing from the lectures', () => {
    const result = drawTicket({
      mode: 'weak',
      layout: { mode: 'random', perTicket: 2 },
      questions: questions(3, () => ({ coverage: 'none' })),
      rng: lcg(1),
    });
    expect(result).toMatchObject({ ok: false, code: 'no_weak' });
  });
});

describe('drawTicket «Из уже отвеченных»', () => {
  it('draws only questions that have answers aloud', () => {
    const rng = lcg(31337);
    const list = questions(20, (index) => ({ attempts: index % 4 === 0 ? 1 : 0 }));
    for (let i = 0; i < 1000; i += 1) {
      const result = drawTicket({ mode: 'answered', layout: { mode: 'random', perTicket: 2 }, questions: list, rng });
      if (!result.ok) throw new Error(result.message);
      for (const id of result.ticket.questionIds) expect(list.find((q) => q.id === id)!.attempts).toBeGreaterThan(0);
    }
  });

  it('explains when nothing was answered yet', () => {
    const result = drawTicket({ mode: 'answered', layout: { mode: 'random', perTicket: 2 }, questions: questions(5), rng: lcg(2) });
    expect(result).toMatchObject({ ok: false, code: 'no_answered' });
    if (!result.ok) expect(result.message).toMatch(/ещё не отвечали/);
  });

  it('draws fewer questions when fewer were answered', () => {
    const list = questions(5, (index) => ({ attempts: index === 2 ? 3 : 0 }));
    const result = drawTicket({ mode: 'answered', layout: { mode: 'random', perTicket: 2 }, questions: list, rng: lcg(2) });
    expect(result).toMatchObject({ ok: true, ticket: { questionIds: ['q3'] } });
  });
});

describe('the last three tickets are not repeated', () => {
  it('holds for single questions', () => {
    const rng = lcg(8);
    const list = questions(5);
    let recent: string[] = [];
    const history: string[] = [];
    for (let i = 0; i < 300; i += 1) {
      const result = drawTicket({ mode: 'exam', layout: { mode: 'random', perTicket: 1 }, questions: list, recent, rng });
      if (!result.ok) throw new Error(result.message);
      expect(recent).not.toContain(result.ticket.key);
      history.push(result.ticket.key);
      recent = [result.ticket.key, ...recent.filter((key) => key !== result.ticket.key)].slice(0, 3);
    }
    expect(new Set(history).size).toBe(5);
  });

  it('holds for known tickets and for pairs', () => {
    const rng = lcg(9);
    const list = questions(8);
    const tickets = [1, 2, 3, 4, 5].map((number) => ({ number, questionIds: [`q${number}`, `q${number + 3}`] }));
    let recent: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      const result = drawTicket({ mode: 'exam', layout: { mode: 'fixed', perTicket: 2, tickets }, questions: list, recent, rng });
      if (!result.ok) throw new Error(result.message);
      expect(recent).not.toContain(result.ticket.key);
      recent = [result.ticket.key, ...recent].slice(0, 3);
    }
    recent = [];
    const small = questions(4); // C(4, 2) = 6 pairs, three of them are always excluded
    for (let i = 0; i < 200; i += 1) {
      const result = drawTicket({ mode: 'exam', layout: { mode: 'random', perTicket: 2 }, questions: small, recent, rng });
      if (!result.ok) throw new Error(result.message);
      expect(recent).not.toContain(result.ticket.key);
      recent = [result.ticket.key, ...recent].slice(0, 3);
    }
  });

  it('still draws when there are fewer tickets than the rule needs', () => {
    const result = drawTicket({
      mode: 'exam',
      layout: { mode: 'random', perTicket: 1 },
      questions: questions(2),
      recent: ['q:q1', 'q:q2'],
      rng: lcg(4),
    });
    expect(result.ok).toBe(true);
  });

  it('keeps the last three keys per exam in sessionStorage', () => {
    rememberTicket('exam-1', ticketKey(['q2', 'q1']));
    rememberTicket('exam-1', 't:4');
    rememberTicket('exam-1', 't:5');
    rememberTicket('exam-1', 't:6');
    expect(readRecentTickets('exam-1')).toEqual(['t:6', 't:5', 't:4']);
    expect(readRecentTickets('exam-2')).toEqual([]);
    expect(ticketKey(['q2', 'q1'])).toBe('q:q1,q2');
    window.sessionStorage.setItem(recentTicketsKey('exam-3'), '{broken');
    expect(readRecentTickets('exam-3')).toEqual([]);
  });
});
