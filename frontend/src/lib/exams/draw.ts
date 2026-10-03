/**
 * «Тянуть билет» (contracts §8, tickets spec 3.6): which questions come out of the stack.
 *
 * Three modes:
 * - «Как на экзамене» (exam): uniform. Known tickets are drawn whole by their question ids; one
 *   question per section when the layout says so; otherwise q distinct questions at random.
 * - «Чаще слабые» (weak): weights by readiness — not checked 3, not passed 3, passed on one day 2,
 *   confirmed 1. Questions that are not in the lectures (coverage none) never come out.
 * - «Из уже отвеченных» (answered): only questions with at least one answer aloud, uniform.
 *
 * The last three tickets are not repeated (sessionStorage meldy_exam_last_tickets_<examId>).
 * Randomness comes from crypto.getRandomValues; tests inject a seeded generator.
 * Nothing here is voiced (correction 7).
 */
import type { Readiness } from '../learning/readiness';
import { sectionsOf, type LayoutMode } from './ticketMath';

export type DrawMode = 'exam' | 'weak' | 'answered';

export const DRAW_MODES: DrawMode[] = ['exam', 'weak', 'answered'];

export const DRAW_MODE_LABELS: Record<DrawMode, string> = {
  exam: 'Как на экзамене',
  weak: 'Чаще слабые',
  answered: 'Из уже отвеченных',
};

/** Weights of «Чаще слабые». */
export const WEAK_WEIGHTS: Record<Readiness, number> = {
  untested: 3,
  not_passed: 3,
  once: 2,
  confirmed: 1,
};

export const RECENT_LIMIT = 3;
const MAX_REDRAWS = 60;

export interface DrawQuestion {
  id: string;
  section: number | null;
  coverage: string | null;
  readiness: Readiness;
  /** Answers aloud given to this question (exam_answer events). */
  attempts: number;
}

export interface DrawLayout {
  mode: LayoutMode;
  perTicket: number;
  tickets?: Array<{ number: number; questionIds: string[] }>;
}

export interface DrawnTicket {
  /** Identity of the ticket for the «not the last three» rule. */
  key: string;
  /** Number of a known ticket; null for a random combination. */
  number: number | null;
  /** In list order (known tickets keep their own order). */
  questionIds: string[];
}

export type DrawFailureCode = 'no_questions' | 'no_weak' | 'no_answered';

export type DrawResult = { ok: true; ticket: DrawnTicket } | { ok: false; code: DrawFailureCode; message: string };

export const DRAW_FAILURE_MESSAGES: Record<DrawFailureCode, string> = {
  no_questions: 'В списке нет вопросов, которые можно вытянуть.',
  no_weak: 'Тянуть не из чего: всех вопросов этого экзамена нет в ваших лекциях.',
  no_answered: 'Вы ещё не отвечали вслух ни на один вопрос этого экзамена. Выберите «Как на экзамене».',
};

/** A uniform number in [0, 1) from crypto.getRandomValues (Math.random only without crypto). */
export function cryptoRandom(): number {
  try {
    const api = (globalThis as { crypto?: Crypto }).crypto;
    if (api && typeof api.getRandomValues === 'function') {
      return api.getRandomValues(new Uint32Array(1))[0] / 4294967296;
    }
  } catch {
    // fall through
  }
  return Math.random();
}

export function ticketKey(questionIds: string[], number: number | null = null): string {
  if (number !== null) return `t:${number}`;
  return `q:${[...questionIds].sort().join(',')}`;
}

function pickIndex(length: number, rng: () => number): number {
  const index = Math.floor(rng() * length);
  return Math.min(Math.max(index, 0), length - 1);
}

/** q distinct items, uniform (partial Fisher–Yates). */
function sampleUniform<T>(items: T[], q: number, rng: () => number): T[] {
  const pool = [...items];
  const take = Math.min(q, pool.length);
  for (let i = 0; i < take; i += 1) {
    const j = i + pickIndex(pool.length - i, rng);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, take);
}

/** q distinct items, each step proportional to its weight. */
function sampleWeighted<T>(items: T[], weight: (item: T) => number, q: number, rng: () => number): T[] {
  const pool = items.filter((item) => weight(item) > 0);
  const chosen: T[] = [];
  while (chosen.length < q && pool.length > 0) {
    const total = pool.reduce((sum, item) => sum + weight(item), 0);
    let r = rng() * total;
    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i += 1) {
      r -= weight(pool[i]);
      if (r < 0) {
        index = i;
        break;
      }
    }
    chosen.push(pool[index]);
    pool.splice(index, 1);
  }
  return chosen;
}

interface DrawPlan {
  pool: DrawQuestion[];
  q: number;
  weight: ((question: DrawQuestion) => number) | null;
  /** One question per section, in section order. */
  sections: number[] | null;
}

function orderOf(questions: DrawQuestion[]): Map<string, number> {
  return new Map(questions.map((question, index) => [question.id, index]));
}

function drawOnce(plan: DrawPlan, rng: () => number, order: Map<string, number>): string[] {
  const { pool, q, weight, sections } = plan;
  if (sections) {
    const ids: string[] = [];
    for (const section of sections) {
      const inSection = pool.filter((question) => question.section === section);
      const picked = weight ? sampleWeighted(inSection, weight, 1, rng) : sampleUniform(inSection, 1, rng);
      if (picked[0]) ids.push(picked[0].id);
    }
    return ids;
  }
  const picked = weight ? sampleWeighted(pool, weight, q, rng) : sampleUniform(pool, q, rng);
  return picked.map((question) => question.id).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

function drawKnownTicket(
  tickets: Array<{ number: number; questionIds: string[] }>,
  questions: DrawQuestion[],
  recent: string[],
  rng: () => number,
): DrawResult | null {
  const known = new Set(questions.map((question) => question.id));
  const valid = tickets
    .map((ticket) => ({ number: ticket.number, questionIds: ticket.questionIds.filter((id) => known.has(id)) }))
    .filter((ticket) => ticket.questionIds.length > 0);
  if (valid.length === 0) return null;
  let candidates = valid.filter((ticket) => !recent.includes(ticketKey(ticket.questionIds, ticket.number)));
  if (candidates.length === 0) {
    // Fewer tickets than the rule needs: at least do not repeat the very last one.
    const last = recent[0];
    candidates = valid.filter((ticket) => ticketKey(ticket.questionIds, ticket.number) !== last);
    if (candidates.length === 0) candidates = valid;
  }
  const ticket = candidates[pickIndex(candidates.length, rng)];
  return { ok: true, ticket: { key: ticketKey(ticket.questionIds, ticket.number), number: ticket.number, questionIds: ticket.questionIds } };
}

/**
 * Draws one ticket. `recent` holds the keys of the last tickets (newest first); none of them is
 * drawn again while another ticket is possible.
 */
export function drawTicket(input: {
  mode: DrawMode;
  layout: DrawLayout;
  questions: DrawQuestion[];
  recent?: string[];
  rng?: () => number;
}): DrawResult {
  const rng = input.rng ?? cryptoRandom;
  const recent = (input.recent ?? []).slice(0, RECENT_LIMIT);
  const questions = input.questions;
  const perTicket = Math.min(Math.max(Math.trunc(input.layout.perTicket) || 1, 1), 4);
  const order = orderOf(questions);

  if (questions.length === 0) return { ok: false, code: 'no_questions', message: DRAW_FAILURE_MESSAGES.no_questions };

  let plan: DrawPlan;
  if (input.mode === 'answered') {
    const pool = questions.filter((question) => question.attempts > 0);
    if (pool.length === 0) return { ok: false, code: 'no_answered', message: DRAW_FAILURE_MESSAGES.no_answered };
    plan = { pool, q: perTicket, weight: null, sections: null };
  } else if (input.mode === 'weak') {
    const pool = questions.filter((question) => question.coverage !== 'none');
    if (pool.length === 0) return { ok: false, code: 'no_weak', message: DRAW_FAILURE_MESSAGES.no_weak };
    const weight = (question: DrawQuestion) => WEAK_WEIGHTS[question.readiness] ?? 1;
    const sections = input.layout.mode === 'sections' ? sectionsOf(questions) : [];
    const usable =
      sections.length === perTicket && sections.every((section) => pool.some((question) => question.section === section));
    plan = { pool, q: perTicket, weight, sections: usable ? sections : null };
  } else {
    if (input.layout.mode === 'fixed' && input.layout.tickets && input.layout.tickets.length > 0) {
      const drawn = drawKnownTicket(input.layout.tickets, questions, recent, rng);
      if (drawn) return drawn;
    }
    const sections = input.layout.mode === 'sections' ? sectionsOf(questions) : [];
    plan = { pool: questions, q: perTicket, weight: null, sections: sections.length === perTicket ? sections : null };
  }

  // A single question at a time: leave the last three out of the pool when something else remains.
  if (!plan.sections && Math.min(plan.q, plan.pool.length) === 1) {
    const fresh = plan.pool.filter((question) => !recent.includes(ticketKey([question.id])));
    if (fresh.length > 0) plan = { ...plan, pool: fresh };
  }

  let ids = drawOnce(plan, rng, order);
  for (let attempt = 0; attempt < MAX_REDRAWS && recent.includes(ticketKey(ids)); attempt += 1) {
    ids = drawOnce(plan, rng, order);
  }
  if (ids.length === 0) return { ok: false, code: 'no_questions', message: DRAW_FAILURE_MESSAGES.no_questions };
  return { ok: true, ticket: { key: ticketKey(ids), number: null, questionIds: ids } };
}

export function recentTicketsKey(examId: string): string {
  return `meldy_exam_last_tickets_${examId}`;
}

/** The last tickets of this exam in this tab, newest first. Storage failures read as empty. */
export function readRecentTickets(examId: string): string[] {
  try {
    const raw = window.sessionStorage.getItem(recentTicketsKey(examId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

/** Puts the ticket first and keeps the last three; returns the new list (also when storage fails). */
export function rememberTicket(examId: string, key: string): string[] {
  const next = [key, ...readRecentTickets(examId).filter((item) => item !== key)].slice(0, RECENT_LIMIT);
  try {
    window.sessionStorage.setItem(recentTicketsKey(examId), JSON.stringify(next));
  } catch {
    // Private mode or blocked storage: the rule then lasts only for this page.
  }
  return next;
}
