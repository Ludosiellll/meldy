/**
 * Ticket shares for an exam sheet (tickets spec 4.4, contracts §8).
 *
 * A «доля билетов» is the share of possible tickets whose questions all satisfy a criterion
 * (present in the lectures, or confirmed by answers), and the share with at least one such
 * question. It is never a chance to pass. Exact integer arithmetic: N ≤ 300 and q ≤ 4, so
 * C(300, 4) = 330 791 175 and every product below stays far under 2^53.
 *
 * - random: a ticket is q questions drawn at random from N; K of them qualify.
 *   all = C(K, q) / C(N, q); at least one = 1 − C(N − K, q) / C(N, q).
 * - sections: one question from each of q sections; Kᵢ of Nᵢ qualify in section i.
 *   all = ∏ Kᵢ / Nᵢ; at least one = 1 − ∏ (Nᵢ − Kᵢ) / Nᵢ.
 * - fixed: the tickets are known (question ids); a direct count over them.
 *
 * Questions whose status is unknown (checked only by words) give a range: the low bound counts
 * them as not qualifying, the high bound as qualifying.
 */

export type LayoutMode = 'random' | 'sections' | 'fixed';

export interface Fraction {
  num: number;
  den: number;
}

/** One question of the sheet: whether it satisfies the criterion ('maybe' = only a range is known). */
export interface ShareQuestion {
  id: string;
  section: number | null;
  status: 'yes' | 'no' | 'maybe';
}

export interface ShareTicket {
  number: number;
  questionIds: string[];
}

export interface ShareInput {
  mode: LayoutMode;
  perTicket: number;
  questions: ShareQuestion[];
  tickets?: ShareTicket[];
}

export type ShareFailureCode = 'bad_q' | 'no_questions' | 'q_gt_n' | 'sections_mismatch' | 'no_tickets';

export interface ShareFailure {
  ok: false;
  code: ShareFailureCode;
  /** Plain Russian sentence for the screen. */
  reason: string;
}

export interface RandomShare {
  ok: true;
  mode: 'random';
  q: number;
  n: number;
  k: number;
  all: Fraction;
  /** C(N − K, q) / C(N, q): tickets where no question qualifies. */
  none: Fraction;
  atLeastOne: Fraction;
}

export interface SectionShare {
  section: number;
  n: number;
  k: number;
}

export interface SectionsShare {
  ok: true;
  mode: 'sections';
  q: number;
  sections: SectionShare[];
  all: Fraction;
  none: Fraction;
  atLeastOne: Fraction;
}

export interface FixedShare {
  ok: true;
  mode: 'fixed';
  /** Tickets that still hold at least one question. */
  tickets: number;
  allCount: number;
  anyCount: number;
  all: Fraction;
  none: Fraction;
  atLeastOne: Fraction;
}

export type ShareResult = RandomShare | SectionsShare | FixedShare | ShareFailure;

export const MAX_PER_TICKET = 4;

/** Binomial coefficient C(n, k), exact for the sizes used here; 0 when k < 0 or k > n. */
export function binom(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < 0 || k > n) return 0;
  const r = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= r; i += 1) {
    // result * (n − r + i) is divisible by i: the running product is always C(n − r + i, i).
    result = (result * (n - r + i)) / i;
  }
  return result;
}

/** Whole percent of a fraction (0 for an empty denominator). */
export function percent(fraction: Fraction): number {
  if (!(fraction.den > 0)) return 0;
  return Math.round((fraction.num / fraction.den) * 100);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

/** The same fraction in lowest terms (the screen shows the unreduced one, tests use this). */
export function reduce(fraction: Fraction): Fraction {
  const g = gcd(fraction.num, fraction.den);
  return { num: fraction.num / g, den: fraction.den / g };
}

function complement(fraction: Fraction): Fraction {
  return { num: fraction.den - fraction.num, den: fraction.den };
}

function failure(code: ShareFailureCode, reason: string): ShareFailure {
  return { ok: false, code, reason };
}

type Resolved = { id: string; section: number | null; ok: boolean };

function resolve(questions: ShareQuestion[], maybeCounts: boolean): Resolved[] {
  return questions.map((question) => ({
    id: question.id,
    section: question.section,
    ok: question.status === 'yes' || (maybeCounts && question.status === 'maybe'),
  }));
}

function randomShare(q: number, questions: Resolved[]): RandomShare | ShareFailure {
  const n = questions.length;
  if (n === 0) return failure('no_questions', 'В списке нет вопросов.');
  if (q > n) return failure('q_gt_n', `В билете ${q} вопроса, а в списке всего ${n}: долю билетов не посчитать.`);
  const k = questions.filter((question) => question.ok).length;
  const den = binom(n, q);
  const all = { num: binom(k, q), den };
  const none = { num: binom(n - k, q), den };
  return { ok: true, mode: 'random', q, n, k, all, none, atLeastOne: complement(none) };
}

/** Distinct sections of the list in ascending order (questions without a section are left out). */
export function sectionsOf(questions: Array<{ section: number | null }>): number[] {
  const set = new Set<number>();
  for (const question of questions) {
    if (typeof question.section === 'number' && Number.isInteger(question.section)) set.add(question.section);
  }
  return Array.from(set).sort((a, b) => a - b);
}

function sectionsShare(q: number, questions: Resolved[]): SectionsShare | ShareFailure {
  const sections = sectionsOf(questions);
  if (sections.length !== q) {
    return failure(
      'sections_mismatch',
      `Разделов в списке ${sections.length}, а вопросов в билете ${q}: по одному из каждого раздела не получается.`,
    );
  }
  const parts: SectionShare[] = sections.map((section) => {
    const inSection = questions.filter((question) => question.section === section);
    return { section, n: inSection.length, k: inSection.filter((question) => question.ok).length };
  });
  let allNum = 1;
  let noneNum = 1;
  let den = 1;
  for (const part of parts) {
    allNum *= part.k;
    noneNum *= part.n - part.k;
    den *= part.n;
  }
  const all = { num: allNum, den };
  const none = { num: noneNum, den };
  return { ok: true, mode: 'sections', q, sections: parts, all, none, atLeastOne: complement(none) };
}

function fixedShare(questions: Resolved[], tickets: ShareTicket[] | undefined): FixedShare | ShareFailure {
  const byId = new Map(questions.map((question) => [question.id, question]));
  let count = 0;
  let allCount = 0;
  let anyCount = 0;
  for (const ticket of tickets ?? []) {
    const members = ticket.questionIds.map((id) => byId.get(id)).filter((item): item is Resolved => Boolean(item));
    if (members.length === 0) continue; // every question of this ticket was deleted
    count += 1;
    if (members.every((member) => member.ok)) allCount += 1;
    if (members.some((member) => member.ok)) anyCount += 1;
  }
  if (count === 0) return failure('no_tickets', 'Билеты не заданы: считаем как для случайных билетов.');
  return {
    ok: true,
    mode: 'fixed',
    tickets: count,
    allCount,
    anyCount,
    all: { num: allCount, den: count },
    none: { num: count - anyCount, den: count },
    atLeastOne: { num: anyCount, den: count },
  };
}

function shareWith(input: ShareInput, maybeCounts: boolean): ShareResult {
  const q = input.perTicket;
  const questions = resolve(input.questions, maybeCounts);
  if (input.mode === 'fixed') return fixedShare(questions, input.tickets);
  if (!Number.isInteger(q) || q < 1 || q > MAX_PER_TICKET) {
    return failure('bad_q', `Вопросов в билете может быть от 1 до ${MAX_PER_TICKET}.`);
  }
  if (input.mode === 'sections') return sectionsShare(q, questions);
  return randomShare(q, questions);
}

/**
 * The share for the given layout. 'maybe' questions count as not qualifying (the low bound).
 * null-like failures carry a reason: q > N, sections that do not match q, no tickets left.
 */
export function ticketShare(input: ShareInput): ShareResult {
  return shareWith(input, false);
}

export interface ShareRange {
  low: ShareResult;
  high: ShareResult;
  /** True when some questions are 'maybe' and the two bounds differ. */
  isRange: boolean;
}

/** Low bound ('maybe' → no) and high bound ('maybe' → yes). */
export function ticketShareRange(input: ShareInput): ShareRange {
  const low = shareWith(input, false);
  const hasMaybe = input.questions.some((question) => question.status === 'maybe');
  const high = hasMaybe ? shareWith(input, true) : low;
  const isRange =
    hasMaybe && low.ok && high.ok && (percent(low.all) !== percent(high.all) || percent(low.atLeastOne) !== percent(high.atLeastOne));
  return { low, high, isRange };
}

export interface LayoutShares extends ShareRange {
  /** The layout the numbers are for: the stored one, or random when the stored one does not fit. */
  mode: LayoutMode;
  /** Why the stored layout was replaced by random (sections that do not match q, no tickets). */
  fallbackReason: string | null;
}

/**
 * Shares for the stored layout. When sections do not match q or no fixed ticket is left, the
 * numbers fall back to random tickets of the same size and `fallbackReason` says why.
 */
export function layoutShares(input: ShareInput): LayoutShares {
  const first = ticketShare(input);
  if (!first.ok && input.mode !== 'random' && (first.code === 'sections_mismatch' || first.code === 'no_tickets')) {
    const q = Math.min(Math.max(Math.trunc(input.perTicket) || 2, 1), MAX_PER_TICKET);
    const randomInput: ShareInput = { ...input, mode: 'random', perTicket: q };
    return { ...ticketShareRange(randomInput), mode: 'random', fallbackReason: first.reason };
  }
  return { ...ticketShareRange(input), mode: input.mode, fallbackReason: null };
}

/**
 * The same shares if the `promoted` questions qualified too: «7 вопросов «частично»: добавьте к ним материал —
 * тогда оба вопроса будут в лекциях в 60 % билетов» (C(31, 2) / C(40, 2) = 465 / 780). Questions whose
 * status is still unknown keep widening the range, exactly as in layoutShares.
 */
export function layoutSharesIf(input: ShareInput, promoted: Iterable<string>): LayoutShares {
  const ids = new Set(promoted);
  return layoutShares({
    ...input,
    questions: input.questions.map((question) => (ids.has(question.id) ? { ...question, status: 'yes' as const } : question)),
  });
}
