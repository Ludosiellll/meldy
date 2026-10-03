/**
 * Honest per-material progress for «Прогресс» (contracts §6.5, finding QP-3).
 *
 * Plain counters instead of an «освоение» percentage:
 * - cards: reviewed (answered at least once), recalled (the last answer was «Знаю» or «С трудом»:
 *   SM-2 resets repetitions to 0 on every «Не помню»), consolidated (two successful answers on
 *   different days), and the next check of the cards waiting for their second success;
 * - the test: the material's FIRST attempt that was not a retake (a test seen before never counts
 *   as first), plus the latest later attempt shown only as «Повторно <дата>: x из y»;
 * - accuracy of the cards at their latest review plus the FIRST test (not «at the last check»: a
 *   later test attempt never enters it) = (recalled + first test correct) / (reviewed + first test
 *   total), given only from MIN_MEASURED answers on; below that the material has «мало данных»,
 *   and with nothing measured it is «Не проверялось».
 * Pure module: no network, no storage.
 */
import type { LearningEvent } from '../api/learning';
import { compareEventTime } from '../lib/learning/readiness';

export const MIN_MEASURED = 3;

/** The flashcard_progress columns this module reads. */
export interface ProgressCard {
  repetitions?: number | null;
  next_review?: string | null;
  last_reviewed_at?: string | null;
  /** 'analysis' | 'oral_followup'; a follow-up card is created already scheduled for tomorrow. */
  origin?: string | null;
}

export interface QuizResult {
  /** Local day of the attempt ('yyyy-MM-dd'). */
  date: string;
  correct: number;
  total: number;
}

export interface MaterialMetrics {
  cards: { total: number; reviewed: number; recalled: number; consolidated: number; nextCheck: string | null };
  quiz: QuizResult | null;
  quizRepeat: QuizResult | null;
  /** Cards at their latest review plus the first test; a later test attempt is not part of it. */
  accuracy: { value: number; numerator: number; denominator: number } | null;
  status: 'untested' | 'few_data' | 'measured';
}

function repetitionsOf(card: ProgressCard): number {
  const n = Number(card.repetitions);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * A card counts as reviewed when it has a review date, a successful answer, or a schedule moved
 * into the future by a «Не помню» answer (older clients wrote no review date). A follow-up card
 * from an oral answer starts scheduled for tomorrow, so its schedule alone proves nothing.
 */
function isReviewed(card: ProgressCard, nowMs: number): boolean {
  if (card.last_reviewed_at) return true;
  if (repetitionsOf(card) >= 1) return true;
  if (card.origin === 'oral_followup') return false;
  const next = card.next_review ? Date.parse(card.next_review) : Number.NaN;
  return Number.isFinite(next) && next > nowMs;
}

interface QuizSession {
  first: LearningEvent;
  retake: boolean;
  correct: number;
  total: number;
}

function quizSessions(events: LearningEvent[]): QuizSession[] {
  const bySession = new Map<string, LearningEvent[]>();
  for (const event of events) {
    if (!event || event.kind !== 'quiz_answer' || !event.session_id) continue;
    const list = bySession.get(event.session_id);
    if (list) list.push(event);
    else bySession.set(event.session_id, [event]);
  }
  const sessions: QuizSession[] = [];
  for (const list of bySession.values()) {
    list.sort(compareEventTime);
    const scored = list.filter((event) => event.correct === true || event.correct === false);
    if (scored.length === 0) continue;
    sessions.push({
      first: list[0],
      retake: list.some((event) => (event.payload as Record<string, unknown> | null)?.retake === true),
      correct: scored.filter((event) => event.correct === true).length,
      total: scored.length,
    });
  }
  return sessions.sort((a, b) => compareEventTime(a.first, b.first));
}

function result(session: QuizSession): QuizResult {
  return { date: session.first.local_date, correct: session.correct, total: session.total };
}

/**
 * Metrics of one material from its flashcard_progress rows and its quiz_answer events.
 * Unscored answers (correct null) are left out of the test counts.
 */
export function materialMetrics(cards: ProgressCard[], quizEvents: LearningEvent[], now: Date = new Date()): MaterialMetrics {
  const nowMs = now.getTime();
  let reviewed = 0;
  let recalled = 0;
  let consolidated = 0;
  let nextCheck: string | null = null;
  let nextCheckMs = Number.POSITIVE_INFINITY;
  for (const card of cards) {
    const repetitions = repetitionsOf(card);
    if (isReviewed(card, nowMs)) reviewed += 1;
    if (repetitions >= 1) recalled += 1;
    if (repetitions >= 2) consolidated += 1;
    if (repetitions === 1 && card.next_review) {
      const next = Date.parse(card.next_review);
      if (Number.isFinite(next) && next < nextCheckMs) {
        nextCheckMs = next;
        nextCheck = card.next_review;
      }
    }
  }

  const sessions = quizSessions(quizEvents);
  const firstIndex = sessions.findIndex((session) => !session.retake);
  const quiz = firstIndex >= 0 ? result(sessions[firstIndex]) : null;
  const later = firstIndex >= 0 ? sessions.slice(firstIndex + 1) : sessions;
  const quizRepeat = later.length > 0 ? result(later[later.length - 1]) : null;

  const numerator = recalled + (quiz?.correct ?? 0);
  const denominator = reviewed + (quiz?.total ?? 0);
  let status: MaterialMetrics['status'];
  if (denominator === 0 && !quizRepeat) status = 'untested';
  else if (denominator < MIN_MEASURED) status = 'few_data';
  else status = 'measured';

  return {
    cards: { total: cards.length, reviewed, recalled, consolidated, nextCheck },
    quiz,
    quizRepeat,
    accuracy: status === 'measured' ? { value: numerator / denominator, numerator, denominator } : null,
    status,
  };
}
