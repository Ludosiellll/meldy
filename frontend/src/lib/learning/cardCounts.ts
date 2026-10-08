/**
 * Review cards counted in the words of decision 4 (w5, 2026-10-08), so «Лекции», «Прогресс»,
 * «Повторение» and the top bar never seem to disagree:
 * - a lecture's cards come from its analysis or from answers to exam tickets (an examiner's
 *   follow-up question, flashcard_progress.origin 'oral_followup'), and the two are named apart:
 *   «6 из лекции, 4 из ответов на билеты»;
 * - what is due says when: «24 ждут сейчас · ещё 2 — позже сегодня» (the top bar counts the cards
 *   due now; a day's bar of the forecast holds both);
 * - a review session says how many wait in all: «1 из 20 · всего на сегодня 24».
 * Pure module: no network, no storage, `now` is passed in.
 */
import { pluralRu } from '../../components/conversation/visuals';
import { localDateKey } from '../../utils/streak';

export const FOLLOW_UP_ORIGIN = 'oral_followup';

export interface OriginSplit {
  total: number;
  /** Cards from the analysis of a lecture. */
  lecture: number;
  /** Cards made from an examiner's follow-up question in an answer to a ticket. */
  answers: number;
}

export function originSplit(cards: ReadonlyArray<{ origin?: string | null }>): OriginSplit {
  let answers = 0;
  for (const card of cards) if (card.origin === FOLLOW_UP_ORIGIN) answers += 1;
  return { total: cards.length, lecture: cards.length - answers, answers };
}

/**
 * «6 из лекции, 4 из ответов на билеты» for one lecture, «18 из лекций, 8 из ответов на билеты» for
 * several; «4 из ответов на билеты» when every card came from answers; '' when none did (then there
 * is nothing to tell apart).
 */
export function originPhrase(split: OriginSplit, lectures: 'one' | 'many'): string {
  if (split.answers === 0) return '';
  const answers = `${split.answers} из ответов на билеты`;
  if (split.lecture === 0) return answers;
  return `${split.lecture} из ${lectures === 'one' ? 'лекции' : 'лекций'}, ${answers}`;
}

function dueMs(card: { next_review?: string | null }): number | null {
  if (!card.next_review) return null;
  const ms = Date.parse(card.next_review);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Cards due now (next_review ≤ now: the rule of the top bar and of the review queue) and cards that
 * come later today (after now, on today's local date).
 */
export function dueToday(cards: ReadonlyArray<{ next_review?: string | null }>, now: Date = new Date()): { now: number; later: number } {
  const nowMs = now.getTime();
  const today = localDateKey(now);
  let dueNow = 0;
  let later = 0;
  for (const card of cards) {
    const ms = dueMs(card);
    if (ms === null) continue;
    if (ms <= nowMs) dueNow += 1;
    else if (localDateKey(new Date(ms)) === today) later += 1;
  }
  return { now: dueNow, later };
}

/** «карточки ждут сейчас» after the number, or «сейчас повторять нечего» for none. */
export function waitingNowWords(due: number): string {
  return due > 0 ? `${pluralRu(due, ['карточка ждёт', 'карточки ждут', 'карточек ждут'])} сейчас` : 'сейчас повторять нечего';
}

/**
 * The part about the rest of the day: «ещё 2 — позже сегодня» after cards that wait now,
 * «2 карточки — позже сегодня» when none waits; '' when nothing comes later today.
 */
export function laterTodayWords(later: number, afterDue: boolean): string {
  if (later <= 0) return '';
  return afterDue ? `ещё ${later} — позже сегодня` : `${later} ${pluralRu(later, ['карточка', 'карточки', 'карточек'])} — позже сегодня`;
}

/** The whole line: «24 карточки ждут сейчас · ещё 2 — позже сегодня». */
export function dueLine(due: number, later: number): string {
  const head = due > 0 ? `${due} ${waitingNowWords(due)}` : waitingNowWords(0);
  const tail = laterTodayWords(later, due > 0);
  return tail ? `${head} · ${tail}` : head;
}

/**
 * The second part of a review session's header: «всего на сегодня 24» when more cards wait than the
 * session holds (the queue is a page of 20), '' otherwise or when the total is not known.
 */
export function sessionTotalWords(queue: number, dueTotal: number | null): string {
  return dueTotal !== null && Number.isFinite(dueTotal) && dueTotal > queue ? `всего на сегодня ${dueTotal}` : '';
}
