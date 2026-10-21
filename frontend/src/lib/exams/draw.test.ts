import { afterEach, describe, expect, it } from 'vitest';
import { lcg } from '../../components/landing/handStroke';
import type { Readiness } from '../learning/readiness';
import {
  DRAW_FAILURE_MESSAGES,
  canDrawAnother,
  drawTicket,
  poolLine,
  readRecentTickets,
  recentTicketsKey,
  rememberTicket,
  STALE_WEIGHT,
  ticketKey,
  weakWeight,
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

  it('brings back a confirmation that is «пора проверить» as often as a question passed once (seeded, ±3σ)', () => {
    expect(weakWeight({ readiness: 'confirmed', stale: true })).toBe(STALE_WEIGHT);
    expect(STALE_WEIGHT).toBe(2);
    expect(weakWeight({ readiness: 'confirmed', stale: false })).toBe(1);
    expect(weakWeight({ readiness: 'confirmed' })).toBe(1);
    expect(weakWeight({ readiness: 'once' })).toBe(2);
    expect(weakWeight({ readiness: 'not_passed' })).toBe(3);
    expect(weakWeight({ readiness: 'untested', stale: true })).toBe(3);

    const rng = lcg(777);
    const list: DrawQuestion[] = [
      question('untested', { readiness: 'untested' }),
      question('not_passed', { readiness: 'not_passed' }),
      question('once', { readiness: 'once' }),
      question('confirmed', { readiness: 'confirmed' }),
      question('stale', { readiness: 'confirmed', stale: true }),
    ];
    const total = list.reduce((sum, item) => sum + weakWeight(item), 0); // 3 + 3 + 2 + 1 + 2 = 11
    expect(total).toBe(11);
    const counts = new Map<string, number>();
    const draws = 22_000;
    for (let i = 0; i < draws; i += 1) {
      const result = drawTicket({ mode: 'weak', layout: { mode: 'random', perTicket: 1 }, questions: list, rng });
      if (!result.ok) throw new Error(result.message);
      counts.set(result.ticket.questionIds[0], (counts.get(result.ticket.questionIds[0]) ?? 0) + 1);
    }
    list.forEach((item) => within3Sigma(counts.get(item.id) ?? 0, draws, weakWeight(item) / total));
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

  it('explains when nothing was answered yet, without «вслух»: a typed answer counts too', () => {
    const result = drawTicket({ mode: 'answered', layout: { mode: 'random', perTicket: 2 }, questions: questions(5), rng: lcg(2) });
    expect(result).toMatchObject({ ok: false, code: 'no_answered' });
    if (!result.ok) expect(result.message).toBe('Вы ещё не отвечали ни на один вопрос этого экзамена. Выберите «Как на экзамене».');
  });

  it('draws fewer questions when fewer were answered', () => {
    const list = questions(5, (index) => ({ attempts: index === 2 ? 3 : 0 }));
    const result = drawTicket({ mode: 'answered', layout: { mode: 'random', perTicket: 2 }, questions: list, rng: lcg(2) });
    expect(result).toMatchObject({ ok: true, ticket: { questionIds: ['q3'] } });
  });
});

describe('drawTicket «Ждут подтверждения»', () => {
  it('draws only questions a good answer would confirm now', () => {
    const rng = lcg(4242);
    const list = questions(12, (index) => ({ readiness: index % 3 === 0 ? 'once' : 'untested', awaiting: index % 3 === 0 && index !== 0 }));
    for (let i = 0; i < 500; i += 1) {
      const result = drawTicket({ mode: 'awaiting', layout: { mode: 'random', perTicket: 2 }, questions: list, rng });
      if (!result.ok) throw new Error(result.message);
      for (const id of result.ticket.questionIds) expect(list.find((q) => q.id === id)!.awaiting).toBe(true);
    }
  });

  it('says so when no question is waiting for its confirmation', () => {
    const result = drawTicket({ mode: 'awaiting', layout: { mode: 'random', perTicket: 2 }, questions: questions(4, () => ({ readiness: 'once' })), rng: lcg(1) });
    expect(result).toMatchObject({ ok: false, code: 'no_awaiting', message: DRAW_FAILURE_MESSAGES.no_awaiting });
    expect(DRAW_FAILURE_MESSAGES.no_awaiting).toBe('Сегодня нет вопросов, которые можно выучить. Выберите «Как на экзамене».');
  });
});

describe('poolLine: what a draw takes its questions from', () => {
  const forty = (overrides: (index: number) => Partial<DrawQuestion> = () => ({})) => questions(40, overrides);

  it('names the pool of «Как на экзамене» for random pairs, sections and the department’s tickets', () => {
    expect(poolLine({ mode: 'exam', layout: { mode: 'random', perTicket: 2 }, questions: forty() })).toBe('Случайно из 40 вопросов.');
    expect(poolLine({ mode: 'exam', layout: { mode: 'random', perTicket: 1 }, questions: questions(21) })).toBe('Случайно из 21 вопроса.');
    expect(poolLine({ mode: 'exam', layout: { mode: 'sections', perTicket: 2 }, questions: forty((index) => ({ section: index < 20 ? 1 : 2 })) })).toBe(
      'По одному случайному вопросу из каждого из 2 разделов.',
    );
    // Sections that do not match the ticket: the draw is random, and so is the line.
    expect(poolLine({ mode: 'exam', layout: { mode: 'sections', perTicket: 2 }, questions: forty((index) => ({ section: (index % 3) + 1 })) })).toBe(
      'Случайно из 40 вопросов.',
    );
    const tickets = Array.from({ length: 20 }, (_, index) => ({ number: index + 1, questionIds: [`q${index + 1}`, `q${index + 21}`] }));
    expect(poolLine({ mode: 'exam', layout: { mode: 'fixed', perTicket: 2, tickets }, questions: forty() })).toBe(
      'Как на экзамене: случайный билет из 20 билетов кафедры.',
    );
    expect(poolLine({ mode: 'exam', layout: { mode: 'fixed', perTicket: 2, tickets: tickets.slice(0, 21 - 20) }, questions: forty() })).toBe(
      'Как на экзамене: случайный билет из 1 билета кафедры.',
    );
  });

  it('counts the pool of «Чаще слабые» without the questions that are not in the lectures', () => {
    const list = forty((index) => ({ coverage: index < 9 ? 'none' : 'full', section: index < 20 ? 1 : 2 }));
    expect(poolLine({ mode: 'weak', layout: { mode: 'random', perTicket: 2 }, questions: list })).toBe(
      'Чаще слабые: из 31 вопроса, кроме тех, которых нет в лекциях.',
    );
    expect(poolLine({ mode: 'weak', layout: { mode: 'random', perTicket: 2 }, questions: forty() })).toBe('Чаще слабые: из 40 вопросов.');
    expect(poolLine({ mode: 'weak', layout: { mode: 'sections', perTicket: 2 }, questions: list })).toBe(
      'Чаще слабые, по одному из каждого раздела: из 31 вопроса, кроме тех, которых нет в лекциях.',
    );
  });

  it('counts the answered questions and the ones waiting for a confirmation', () => {
    const list = forty((index) => ({ attempts: index < 6 ? 1 : 0, awaiting: index < 4 }));
    expect(poolLine({ mode: 'answered', layout: { mode: 'random', perTicket: 2 }, questions: list })).toBe(
      'Случайно из 6 вопросов, на которые вы уже отвечали.',
    );
    expect(poolLine({ mode: 'awaiting', layout: { mode: 'random', perTicket: 2 }, questions: list })).toBe(
      'Случайно из 4 вопросов, которые можно выучить сегодня.',
    );
    const one = forty((index) => ({ attempts: index === 3 ? 2 : 0, awaiting: index === 3 }));
    expect(poolLine({ mode: 'answered', layout: { mode: 'random', perTicket: 2 }, questions: one })).toBe('Единственный вопрос, на который вы уже отвечали.');
    expect(poolLine({ mode: 'awaiting', layout: { mode: 'random', perTicket: 2 }, questions: one })).toBe('Единственный вопрос, который ждёт подтверждения.');
    // Nothing to draw from: the failure message speaks instead.
    expect(poolLine({ mode: 'answered', layout: { mode: 'random', perTicket: 2 }, questions: forty() })).toBeNull();
    expect(poolLine({ mode: 'exam', layout: { mode: 'random', perTicket: 2 }, questions: [] })).toBeNull();
  });
});

describe('canDrawAnother: «Тянуть ещё» only when another ticket is possible', () => {
  it('needs more questions in the pool than a ticket holds, or more than one department ticket', () => {
    const list = questions(6, (index) => ({ attempts: index < 2 ? 1 : 0, awaiting: index === 0 }));
    expect(canDrawAnother({ mode: 'exam', layout: { mode: 'random', perTicket: 2 }, questions: list })).toBe(true);
    // Two answered questions, two per ticket: always the same pair.
    expect(canDrawAnother({ mode: 'answered', layout: { mode: 'random', perTicket: 2 }, questions: list })).toBe(false);
    expect(canDrawAnother({ mode: 'answered', layout: { mode: 'random', perTicket: 1 }, questions: list })).toBe(true);
    // One question waiting for its confirmation.
    expect(canDrawAnother({ mode: 'awaiting', layout: { mode: 'random', perTicket: 1 }, questions: list })).toBe(false);
    const tickets = [{ number: 1, questionIds: ['q1', 'q2'] }];
    expect(canDrawAnother({ mode: 'exam', layout: { mode: 'fixed', perTicket: 2, tickets }, questions: list })).toBe(false);
    expect(canDrawAnother({ mode: 'exam', layout: { mode: 'fixed', perTicket: 2, tickets: [...tickets, { number: 2, questionIds: ['q3'] }] }, questions: list })).toBe(true);
    // One question per section, one question in each: the same pair every time.
    const pair = [question('a', { section: 1 }), question('b', { section: 2 })];
    expect(canDrawAnother({ mode: 'weak', layout: { mode: 'sections', perTicket: 2 }, questions: pair })).toBe(false);
    expect(canDrawAnother({ mode: 'weak', layout: { mode: 'sections', perTicket: 2 }, questions: [...pair, question('c', { section: 2 })] })).toBe(true);
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
