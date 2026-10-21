/**
 * Peak 3 (redesign spec 5.9, Jury_Check items 4 and 9): after an answer is saved, the answer screen
 * leaves a flag in sessionStorage `meldy_exam_peak_<examId>` (the question hash and its state
 * before the answer). Back on the sheet the journal is read again, the states are compared, and
 * only then the row scrolls into view and its new readiness mark is drawn — never on a timer,
 * never twice.
 *
 * The column carries the stage's finale: when something is confirmed now, the growth from history
 * («0 → 7 за 3 дня», also after a 3, so a bad answer still shows the way so far), the net change of
 * the day («+1 сегодня», only when it is positive), the statement about the answer just given, and
 * «Второй ответ после разбора»: how many rubric points were раскрыты the first time and the second.
 *
 * The flag is read tolerantly (one hash, an object or a list), and the «before» state is
 * recomputed from the journal when the flag does not carry it.
 */
import type { LearningEvent } from '../../api/learning';
import { localDate } from '../../api/learning';
import { compareEventTime, questionState, type QuestionState, type Readiness } from '../../lib/learning/readiness';
import { formatDay, formatShortMoment } from '../../lib/exams/format';
import { pluralRu } from '../conversation/visuals';
import { CONFIRMED_MEANING, daysAgo, pct } from './sheetModel';

export function peakKey(examId: string): string {
  return `meldy_exam_peak_${examId}`;
}

export interface PeakFlag {
  hash: string | null;
  questionId: string | null;
  before: Readiness | null;
}

const READINESS: Readiness[] = ['untested', 'once', 'confirmed', 'not_passed'];
const HASH = /^[0-9a-f]{32}$/;

function readinessOf(value: unknown): Readiness | null {
  return typeof value === 'string' && (READINESS as string[]).includes(value) ? (value as Readiness) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function flagOf(value: unknown): PeakFlag | null {
  if (typeof value === 'string') {
    const hash = value.trim().toLowerCase().replace(/^q:/, '');
    return HASH.test(hash) ? { hash, questionId: null, before: null } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawHash = str(record.hash) ?? str(record.question_hash) ?? str(record.questionHash) ?? str(record.item_key);
  const hash = rawHash ? rawHash.toLowerCase().replace(/^q:/, '') : null;
  const questionId = str(record.question_id) ?? str(record.questionId) ?? str(record.exam_question_id) ?? str(record.examQuestionId);
  const beforeValue = record.before ?? record.previous ?? record.prev ?? record.readiness_before ?? record.readiness;
  const before =
    readinessOf(beforeValue) ??
    (beforeValue && typeof beforeValue === 'object' ? readinessOf((beforeValue as Record<string, unknown>).readiness) : null);
  if (!(hash && HASH.test(hash)) && !questionId) return null;
  return { hash: hash && HASH.test(hash) ? hash : null, questionId, before };
}

/** Parses whatever the answer screen stored: a hash, an object, a list, or {items|questions: […]}. */
export function parsePeakFlags(raw: string | null): PeakFlag[] {
  if (!raw) return [];
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const nested = record.items ?? record.questions ?? record.answers;
    if (Array.isArray(nested)) value = nested;
  }
  const list = Array.isArray(value) ? value : [value];
  const flags: PeakFlag[] = [];
  for (const item of list) {
    const flag = flagOf(item);
    if (flag && !flags.some((known) => (flag.hash && known.hash === flag.hash) || (flag.questionId && known.questionId === flag.questionId))) {
      flags.push(flag);
    }
  }
  return flags.slice(0, 4);
}

/** Reads the flag once: it is removed right away, so the effect plays a single time. */
export function takePeakFlags(examId: string): PeakFlag[] {
  try {
    const key = peakKey(examId);
    const raw = window.sessionStorage.getItem(key);
    if (raw !== null) window.sessionStorage.removeItem(key);
    return parsePeakFlags(raw);
  } catch {
    return [];
  }
}

export interface PeakChange {
  before: QuestionState;
  after: QuestionState;
  /** The answer just given (the latest exam_answer of the question). */
  latest: LearningEvent;
}

/**
 * The state before and after the latest answer of a question. `beforeHint` (from the flag) wins over
 * the recomputed one. Null when the question has no answer in the journal.
 */
export function peakChange(
  answers: LearningEvent[],
  ratings: LearningEvent[],
  beforeHint: Readiness | null,
  now: Date = new Date(),
): PeakChange | null {
  const spoken = answers.filter((event) => event.kind === 'exam_answer').sort(compareEventTime);
  if (spoken.length === 0) return null;
  const latest = spoken[spoken.length - 1];
  const after = questionState(spoken, ratings, now);
  const recomputed = questionState(spoken.slice(0, -1), ratings, now);
  const before = beforeHint ? { ...recomputed, readiness: beforeHint } : recomputed;
  return { before, after, latest };
}

function dayWord(key: string, today: string, now: Date): string {
  return key === today ? 'сегодня' : formatDay(key, now);
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

export interface PeakCounts {
  total: number;
  confirmed: number;
  once: number;
  notPassed: number;
  since: string | null;
  /**
   * Confirmed by the same rule over this exam's events with a local day before today: «+1 сегодня»
   * is the net change against it. Null when unknown (then no «+N сегодня»).
   */
  confirmedBeforeToday?: number | null;
}

/** «0 → 7 за 3 дня · +1 сегодня»: shown only when something is confirmed now (never «0 → 0»). */
export interface PeakGrowth {
  /** Confirmed now. */
  to: number;
  /** Questions of the exam: «0 → 7 из 40». */
  total: number;
  /** Days from the first answer among these questions to today; 0 → no «за K дней». */
  days: number;
  /** Net change of the day: confirmed now minus confirmed before today; shown only when positive. */
  today: number;
}

export interface PeakText {
  /** Under the row, 15 muted. */
  because: string;
  /** Meldy's column. */
  title: string;
  before: number | null;
  after: number;
  total: number | null;
  /** About the answer just given, 18 px. */
  statement: string;
  fine: string[];
  /** A new mark is drawn (false when nothing visible changes). */
  draws: boolean;
  growth: PeakGrowth | null;
}

/** The growth from history for the column: null without confirmed questions. */
export function peakGrowth(counts: PeakCounts, now: Date = new Date()): PeakGrowth | null {
  if (counts.confirmed <= 0) return null;
  const days = Math.max(0, daysAgo(counts.since, now) ?? 0);
  const before = counts.confirmedBeforeToday;
  const today = typeof before === 'number' ? Math.max(0, counts.confirmed - before) : 0;
  return { to: counts.confirmed, total: counts.total, days, today };
}

/** «за 3 дня» ('' for 0 days). */
export function daysPhrase(days: number): string {
  return days > 0 ? `за ${days} ${pluralRu(days, ['день', 'дня', 'дней'])}` : '';
}

/**
 * The readiness block without a peak: «С 1 октября: 0 → 7 за 3 дня.» when something is confirmed and
 * the history spans more than one day; null otherwise.
 */
export function growthSentence(summary: { confirmed: number; since: string | null }, now: Date = new Date()): string | null {
  if (summary.confirmed <= 0 || !summary.since) return null;
  const days = daysAgo(summary.since, now);
  if (days === null || days <= 0) return null;
  return `С ${formatDay(summary.since, now)}: 0 → ${summary.confirmed} ${daysPhrase(days)}.`;
}

/** «2 вопроса выучены больше 14 дней назад. Пора их проверить.» or null. */
export function staleSentence(stale: number): string | null {
  if (stale <= 0) return null;
  const one = stale % 10 === 1 && stale % 100 !== 11;
  return `${stale} ${pluralRu(stale, ['вопрос', 'вопроса', 'вопросов'])} ${one ? 'выучен' : 'выучены'} больше 14 дней назад. Пора ${one ? 'его' : 'их'} проверить.`;
}

/**
 * Words of every transition (Jury_Check item 4): untested → once, once → once, once → confirmed,
 * confirmed → confirmed, any → not_passed, confirmed → not_passed, not_passed → once and
 * not_passed → not_passed. No grade and no «засчитано» (Ф1): a passed answer is one where «названо
 * достаточно», a failed one where «названо недостаточно» — the protocol's «Как считается» says how much.
 */
export function peakText(input: {
  change: PeakChange;
  answers: LearningEvent[];
  number: string;
  counts: PeakCounts;
  confirmedTicketsPct: number | null;
  now?: Date;
}): PeakText {
  const { change, number, counts } = input;
  const now = input.now ?? new Date();
  const today = localDate(now);
  const latestDay = change.latest.local_date || today;
  const when = dayWord(latestDay, today, now);
  const from = change.before.readiness;
  const to = change.after.readiness;
  const confirmedTickets = input.confirmedTicketsPct !== null ? ` В ${pct(input.confirmedTicketsPct)} билетов выучены оба вопроса.` : '';
  const meaning = `${CONFIRMED_MEANING}${confirmedTickets}`;
  const growth = peakGrowth(counts, now);
  const passed = `Вопрос ${number}: ответ полный.`;
  const failed = `Вопрос ${number}: ответ неполный.`;

  if (to === 'confirmed' && from !== 'confirmed') {
    const start = change.after.seriesStartDate;
    const head = start && start !== latestDay ? `${capitalize(formatDay(start, now))} ответ был полным. ` : '';
    return {
      because: `${head}${capitalize(when)} ответ снова полный. Два полных ответа в разные дни, и вопрос выучен.`,
      title: 'Выучено',
      before: Math.max(0, counts.confirmed - 1),
      after: counts.confirmed,
      total: counts.total,
      statement: `Вопрос ${number} выучен.`,
      fine: [meaning],
      draws: true,
      growth,
    };
  }
  if (to === 'not_passed' && from === 'confirmed') {
    const since = change.before.confirmedOn;
    return {
      because: `Вопрос был выучен${since ? ` с ${formatDay(since, now)}` : ''}, но ${when} ответ неполный. Его нужно выучить заново.`,
      title: 'Выучено',
      before: counts.confirmed + 1,
      after: counts.confirmed,
      total: counts.total,
      statement: `${failed} Его нужно выучить заново.`,
      fine: [meaning],
      draws: true,
      growth,
    };
  }
  if (to === 'not_passed') {
    return {
      because: `${capitalize(when)} ответ неполный. В режиме «Чаще слабые» вопрос будет выпадать чаще.`,
      title: 'Ответ неполный',
      before: from === 'not_passed' ? counts.notPassed : Math.max(0, counts.notPassed - 1),
      after: counts.notPassed,
      total: null,
      statement: failed,
      fine: growth ? [meaning] : [],
      draws: from !== 'not_passed',
      growth,
    };
  }
  if (to === 'once' && from === 'once') {
    const at = formatShortMoment(change.after.confirmableFrom, now);
    return {
      because: `Ответ снова полный, но с первого полного ответа прошло меньше 20 часов.${
        at ? ` Ответьте так же не раньше ${at}, и вопрос выучен.` : ''
      }`,
      title: 'Ответ полный',
      before: null,
      after: counts.once,
      total: null,
      statement: passed,
      fine: growth ? [meaning] : [],
      draws: false,
      growth,
    };
  }
  if (to === 'once') {
    return {
      because:
        from === 'not_passed'
          ? `${capitalize(when)} ответ полный. Прошлый был неполным, поэтому считаем заново. Ответьте так же в другой день, и вопрос выучен.`
          : `${capitalize(when)} ответ полный. Ответьте так же в другой день, через 20 часов или позже, и вопрос выучен.`,
      title: 'Ответ полный',
      before: Math.max(0, counts.once - 1),
      after: counts.once,
      total: null,
      statement: passed,
      fine: growth ? [meaning] : [],
      draws: true,
      growth,
    };
  }
  // Still confirmed: one more answer that names enough.
  return {
    because: `${capitalize(when)} ответ снова полный. Вопрос остаётся выученным.`,
    title: 'Выучено',
    before: null,
    after: counts.confirmed,
    total: counts.total,
    statement: `Вопрос ${number} остаётся выученным.`,
    fine: [meaning],
    draws: false,
    growth,
  };
}

// ---------------------------------------------------------------------------------------------
// «Второй ответ после разбора»

const RATED = new Set(['covered', 'partial', 'missing', 'wrong']);

function graded(event: LearningEvent): boolean {
  return event.kind === 'exam_answer' && (event.correct === true || event.correct === false);
}

/** The first and the second graded answer of every question answered at least twice, oldest first. */
function firstTwoAnswers(answers: LearningEvent[]): Array<[LearningEvent, LearningEvent]> {
  const byQuestion = new Map<string, LearningEvent[]>();
  for (const event of answers) {
    if (!event || !graded(event) || typeof event.item_key !== 'string') continue;
    byQuestion.set(event.item_key, [...(byQuestion.get(event.item_key) ?? []), event]);
  }
  const pairs: Array<[LearningEvent, LearningEvent]> = [];
  for (const list of byQuestion.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(compareEventTime);
    pairs.push([sorted[0], sorted[1]]);
  }
  return pairs;
}

/** The sessions whose rubric points «Второй ответ после разбора» needs (fetchSessionPoints). */
export function secondAnswerSessions(answers: LearningEvent[]): string[] {
  const ids = new Set<string>();
  for (const [first, second] of firstTwoAnswers(answers)) {
    if (first.session_id && second.session_id) {
      ids.add(first.session_id);
      ids.add(second.session_id);
    }
  }
  return Array.from(ids);
}

export interface SecondAnswer {
  /** Questions answered at least twice whose two first answers both have rated points. */
  questions: number;
  /** Σ раскрыто / Σ rated points over the first answers, in percent. */
  firstPct: number;
  /** The same over the second answers. */
  secondPct: number;
}

/**
 * «Второй ответ после разбора» (Jury_Check item 4): for every question with at least two graded
 * answers, the first and the second one in time order; the question counts only when both sessions
 * have at least one rated rubric point (oral_point with payload.status other than 'unrated'). The
 * shares are pooled: Σ раскрыто / Σ rated over the first answers, then over the second ones.
 * «Раскрыто» is the protocol's word for a point the model judged covered. Null without such data.
 * It is not retention: the second answer comes after the protocol with the lecture's quotes.
 */
export function secondAnswerAfterReview(answers: LearningEvent[], points: LearningEvent[]): SecondAnswer | null {
  const bySession = new Map<string, { rated: number; covered: number }>();
  for (const point of points) {
    if (!point || point.kind !== 'oral_point' || !point.session_id) continue;
    const status = point.payload?.status;
    if (typeof status !== 'string' || !RATED.has(status)) continue;
    const entry = bySession.get(point.session_id) ?? { rated: 0, covered: 0 };
    entry.rated += 1;
    if (status === 'covered') entry.covered += 1;
    bySession.set(point.session_id, entry);
  }
  let questions = 0;
  let firstRated = 0;
  let firstCovered = 0;
  let secondRated = 0;
  let secondCovered = 0;
  for (const [first, second] of firstTwoAnswers(answers)) {
    const a = first.session_id ? bySession.get(first.session_id) : undefined;
    const b = second.session_id ? bySession.get(second.session_id) : undefined;
    if (!a || !b || a.rated === 0 || b.rated === 0) continue;
    questions += 1;
    firstRated += a.rated;
    firstCovered += a.covered;
    secondRated += b.rated;
    secondCovered += b.covered;
  }
  if (questions === 0) return null;
  return {
    questions,
    firstPct: Math.round((firstCovered / firstRated) * 100),
    secondPct: Math.round((secondCovered / secondRated) * 100),
  };
}

/** «Второй ответ после разбора: по 5 вопросам в первый раз раскрыто 48 % пунктов, во второй — 81 %.» */
export function secondAnswerSentence(value: SecondAnswer): string {
  const questions = value.questions % 10 === 1 && value.questions % 100 !== 11 ? 'вопросу' : 'вопросам';
  return `Второй ответ после разбора: по ${value.questions} ${questions} в первый раз раскрыто ${pct(value.firstPct)} пунктов, во второй — ${pct(value.secondPct)}.`;
}
