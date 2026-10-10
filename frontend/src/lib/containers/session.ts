/**
 * A «занятие» (package D2; Concept 2 §3.10): which questions, in which order, retries 3–5 questions later (≤ 2),
 * option order per show. Seeded by the session id: the same seed gives the same session on every device.
 *
 * One subject and one format per session: 20 questions with options, 10 oral self-checks, or up to 3 oral AI checks
 * (sent together as one ticket, `q=a,b,c`). A wrong answer or «Не знаю» brings the question back 3–5 questions
 * later, at most twice, with the options shuffled again; «Нажали не туда?» changes nothing in the queue.
 */
import type { DayPlan, PlanInput, PlanItem, UnitState } from '../../types/container.ts';
import { SESSION_SIZE, type SessionKind } from './plan.ts';
import { emptyState, inFigure, isOpenError, isSeen } from './rule.ts';

export interface QueueEntry { id: string; retry: 0 | 1 | 2 }

export const RETRY_GAP_MIN = 3;
export const RETRY_GAP_MAX = 5;
export const MAX_RETRIES = 2;

/** FNV-1a of a string (32 bits). */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A seeded generator in [0, 1): FNV-1a of the seed → mulberry32. The same seed gives the same sequence everywhere. */
export function prng(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded Fisher–Yates shuffle (a new array). */
export function shuffled<T>(items: readonly T[], seed: string): T[] {
  const out = items.slice();
  const next = prng(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * The next session of a subject and format from the day's plan: its next questions not answered yet, in a seeded
 * order (classes and topics mixed). AI checks keep the plan's order (confirmations first) — they go as one ticket.
 */
export function buildSession(plan: DayPlan, subjectId: string, kind: 'answer' | 'self_check' | 'ai_check', answeredToday: readonly string[], seed: string): QueueEntry[] {
  const done = new Set(answeredToday);
  const ids: string[] = [];
  const picked = new Set<string>();
  for (const session of plan.sessions) {
    if (session.subjectId !== subjectId || session.kind !== kind) continue;
    for (const id of session.ids) {
      if (done.has(id) || picked.has(id)) continue;
      picked.add(id);
      ids.push(id);
    }
  }
  const chosen = ids.slice(0, SESSION_SIZE[kind as SessionKind]);
  const order = kind === 'ai_check' ? chosen : shuffled(chosen, seed);
  return order.map((id) => ({ id, retry: 0 }));
}

/** The queue after an answer at `pos`: a wrong answer comes back 3–5 positions later, at most twice; a misclick changes nothing. */
export function afterAnswer(queue: QueueEntry[], pos: number, answer: { id: string; correct: boolean; misclick?: boolean }, seed: string): QueueEntry[] {
  const out = queue.slice();
  const entry = queue[pos];
  if (!entry || entry.id !== answer.id || answer.correct || answer.misclick) return out;
  if (entry.retry >= MAX_RETRIES) return out;
  const gap = RETRY_GAP_MIN + Math.floor(prng(`${seed}:retry:${pos}:${answer.id}:${entry.retry}`)() * (RETRY_GAP_MAX - RETRY_GAP_MIN + 1));
  out.splice(Math.min(pos + gap, out.length), 0, { id: answer.id, retry: (entry.retry + 1) as 1 | 2 });
  return out;
}

/** «7 из 20»: the planned question being shown (retries do not advance it) and how many the session plans. */
export function counter(queue: readonly QueueEntry[], pos: number): { n: number; of: number } {
  let of = 0;
  let n = 0;
  queue.forEach((entry, i) => {
    if (entry.retry !== 0) return;
    of += 1;
    if (i <= pos) n += 1;
  });
  return { n: Math.max(n, of > 0 ? 1 : 0), of };
}

/** Display order of file indices: seeded shuffle; `keepOrder` keeps the file's order; `lastIdx` («Все перечисленные») stay last. */
export function optionOrder(n: number, keepOrder: boolean, lastIdx: readonly number[], seed: string): number[] {
  const all = Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => i);
  if (keepOrder || all.length <= 1) return all;
  const pinned = [...new Set(lastIdx.filter((i) => Number.isInteger(i) && i >= 0 && i < all.length))].sort((a, b) => a - b);
  const rest = all.filter((i) => !pinned.includes(i));
  return [...shuffled(rest, seed), ...pinned];
}

const LAST_OPTION: readonly RegExp[] = [
  /^вс[её] (выше)?перечисленн/,
  /^вс[её] (выше)?указанн/,
  /^вс[её] вышесказанн/,
  /^вс[её] (ответы|варианты)( ответов)? (верн|правильн)/,
  /^вс[её] (верн|правильн)/,
  /^(ни один|ничего|никакой|ни одно|ни одна) из (выше)?(перечисленн|указанн|приведенн)/,
  /^(нет|не дано) (верного|правильного|подходящего) (ответа|варианта)/,
  /^верного (ответа|варианта) нет/,
  /^оба (варианта|ответа|утверждения)? ?(верн|правильн)/,
  /^(все|любой) из (выше)?(перечисленн|указанн)/,
  /^(другое|другой ответ|свой вариант)\b/,
  /^(all|none|both) of (the )?(above|these|listed)/,
  /^(any|neither) of (the )?(above|these)/,
];

/** File indices of options that must stay last when shuffling («Все перечисленные», «Ни один из перечисленных», …). */
export function pinnedLast(options: readonly string[]): number[] {
  const out: number[] = [];
  options.forEach((text, i) => {
    const norm = String(text).toLowerCase().replace(/ё/g, 'е').replace(/^[\s(]*[a-zа-я0-9][).]\s+/i, '')
      .replace(/[\s.!…:;]+$/u, '').replace(/\s+/g, ' ').trim();
    if (LAST_OPTION.some((re) => re.test(norm))) out.push(i);
  });
  return out;
}

const EMPTY: UnitState = emptyState();

/**
 * A session outside the day's plan (a topic, or «Только ошибки», or the exam day's «20 вопросов, где были ошибки»):
 * the subject's questions with options, errors first — then the ones on their way, then new ones in file order,
 * then those already in the figure, weakest first — capped at 20 and in a seeded order.
 */
export function freeSession(input: PlanInput, options: { subjectId: string; topic?: number | null; onlyErrors?: boolean; size?: number },
  answeredToday: readonly string[], seed: string): QueueEntry[] {
  const done = new Set(answeredToday);
  const size = Math.max(0, Math.floor(options.size ?? SESSION_SIZE.answer));
  const rank = (u: UnitState): number => (isOpenError(u) ? 0 : !isSeen(u) ? 2 : inFigure(u) ? 3 : 1);
  const pool = (input.items ?? []).filter((item: PlanItem) => item.f === 't' && item.s === options.subjectId && !done.has(item.id)
    && (options.topic === undefined || (item.tp ?? null) === options.topic)
    && (!options.onlyErrors || isOpenError(item.u ?? EMPTY)));
  pool.sort((a, b) => {
    const ua = a.u ?? EMPTY;
    const ub = b.u ?? EMPTY;
    return rank(ua) - rank(ub)
      || (rank(ua) === 0 ? (ua.lastDay ?? '').localeCompare(ub.lastDay ?? '') : 0)
      || (rank(ua) === 3 ? ua.checks - ub.checks || (ua.namedAt ?? 0) - (ub.namedAt ?? 0) : 0)
      || a.o - b.o || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  return shuffled(pool.slice(0, size).map((item) => item.id), seed).map((id) => ({ id, retry: 0 }));
}
