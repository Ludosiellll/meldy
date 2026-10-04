/**
 * «Прогресс», reworked (owner, 2026-10-04: the page «как-будто бессмысленна»): what the student
 * knows, how their memory works, and what to do next — from data the app already stores. Pure
 * module: no network, no storage, `now` is passed in.
 *
 * Sources: flashcard_progress (each card's repetitions and next review), the learning journal
 * (card_review answers since the journal started, quiz answers), open mistakes, the materials.
 *
 * Words (the page's «Как считается» says the same):
 * - закреплена — repetitions ≥ 2: two «Помню»/«С трудом» in a row, on different days (SM-2 then
 *   shows it a week later and more; «Не помню» resets it);
 * - учится — reviewed at least once (progressMetrics.isReviewed) but not закреплена;
 * - новая — never reviewed;
 * - вспомнили — card answers «Помню» or «С трудом» among the card answers of a period, from the
 *   journal; a share is shown only from RECALL_MIN_ANSWERS answers (a lecture: LECTURE_RECALL_MIN).
 *   The journal starts on JOURNAL_START: until the window fits after it, the period is «с 3 октября».
 */
import type { LearningEvent } from '../api/learning';
import { pluralRu } from '../components/conversation/visuals';
import { analysisCards } from './lectureCards';
import { isReviewed, materialMetrics, repetitionsOf, type MaterialMetrics, type ProgressCard } from './progressMetrics';
import { localDateKey, shiftDateKey } from './streak';

export const RECALL_WINDOW_DAYS = 30;
/**
 * The first day of the learning journal (migration 20261003083154; no answers were carried over).
 * Card answers before it exist only as the daily counters of study_sessions.
 */
export const JOURNAL_START = '2026-10-03';
export const RECALL_MIN_ANSWERS = 10;
export const LECTURE_RECALL_MIN = 5;
/** A lecture whose cards were recalled less often than this goes to «Что подтянуть». */
export const WEAK_RECALL = 0.7;
export const FORECAST_DAYS = 7;
export const TODO_LIMIT = 6;

export interface CardStates {
  total: number;
  fresh: number;
  learning: number;
  solid: number;
}

export function cardStates(cards: ProgressCard[], now: Date = new Date()): CardStates {
  const nowMs = now.getTime();
  let fresh = 0;
  let learning = 0;
  let solid = 0;
  for (const card of cards) {
    if (repetitionsOf(card) >= 2) solid += 1;
    else if (isReviewed(card, nowMs)) learning += 1;
    else fresh += 1;
  }
  return { total: cards.length, fresh, learning, solid };
}

function nextReviewMs(card: ProgressCard): number | null {
  if (!card.next_review) return null;
  const ms = Date.parse(card.next_review);
  return Number.isFinite(ms) ? ms : null;
}

/** Cards whose next review has come: the rule of countDueCards and of the top bar (next_review ≤ now). */
export function dueCount(cards: ProgressCard[], now: Date = new Date()): number {
  const nowMs = now.getTime();
  let n = 0;
  for (const card of cards) {
    const ms = nextReviewMs(card);
    if (ms !== null && ms <= nowMs) n += 1;
  }
  return n;
}

export interface ForecastDay {
  key: string;
  count: number;
}

/**
 * Cards per day for the coming days, by each card's next review: day 0 is today together with
 * everything already overdue, then one bar per day. Cards scheduled later are left out.
 */
export function forecast(cards: ProgressCard[], now: Date = new Date(), days: number = FORECAST_DAYS): ForecastDay[] {
  const today = localDateKey(now);
  const keys = Array.from({ length: days }, (_, i) => shiftDateKey(today, i));
  const counts = new Map(keys.map((key) => [key, 0]));
  for (const card of cards) {
    const ms = nextReviewMs(card);
    if (ms === null) continue;
    let key = localDateKey(new Date(ms));
    if (key < today) key = today;
    const value = counts.get(key);
    if (value !== undefined) counts.set(key, value + 1);
  }
  return keys.map((key) => ({ key, count: counts.get(key) ?? 0 }));
}

export interface Tally {
  answers: number;
  recalled: number;
}

/** Card answers of the journal between two local days (inclusive), optionally of one material. */
export function recallTally(events: LearningEvent[], fromKey: string, toKey: string, materialId?: string): Tally {
  let answers = 0;
  let recalled = 0;
  for (const event of events) {
    if (event.kind !== 'card_review' || (event.correct !== true && event.correct !== false)) continue;
    if (materialId !== undefined && event.material_id !== materialId) continue;
    const day = typeof event.local_date === 'string' ? event.local_date.slice(0, 10) : '';
    if (day < fromKey || day > toKey) continue;
    answers += 1;
    if (event.correct) recalled += 1;
  }
  return { answers, recalled };
}

export interface RecallWindow {
  from: string;
  to: string;
  /** The window would start before the journal did, so it starts at JOURNAL_START instead. */
  sinceJournal: boolean;
}

/** The last RECALL_WINDOW_DAYS days up to today, never earlier than the first day of the journal. */
export function recallWindow(todayKey: string): RecallWindow {
  const from = shiftDateKey(todayKey, -(RECALL_WINDOW_DAYS - 1));
  return from < JOURNAL_START ? { from: JOURNAL_START, to: todayKey, sinceJournal: true } : { from, to: todayKey, sinceJournal: false };
}

/** The share of recalled answers, or null below `min` answers: a share of 3 answers says nothing. */
export function recallShare(tally: Tally, min: number): number | null {
  return tally.answers >= Math.max(1, min) ? tally.recalled / tally.answers : null;
}

/** A materials row as the page reads it: `text_only` from summary_json, `quiz` = quiz_json->quiz. */
export interface MaterialInput {
  id: string;
  title: string;
  created_at: string;
  text_only?: unknown;
  flashcards_json?: unknown;
  quiz?: unknown;
}

export type LectureAction = { kind: 'review'; count: number } | { kind: 'add'; count: number } | { kind: 'quiz' };

export interface LectureRow {
  id: string;
  title: string;
  createdAt: string;
  /** Imported as text for exam mapping only: no summary, cards or test by design. */
  textOnly: boolean;
  states: CardStates;
  due: number;
  /** Cards the analysis made that never reached review (none of the lecture's cards did). */
  notInReview: number;
  hasQuiz: boolean;
  metrics: MaterialMetrics;
  /** This lecture's card answers in the recall window. */
  recall: Tally;
  mistakes: number;
  /** Local day of the latest card answer or test of the lecture. */
  lastActivity: string | null;
  /** The earliest next review still to come (ISO), for a lecture with nothing due. */
  nextReview: string | null;
  /** The lecture has a test and its first attempt was never made. */
  quizUntaken: boolean;
  action: LectureAction | null;
}

function group<T>(items: T[], keyOf: (item: T) => string | null | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function laterDay(a: string | null, b: string | null | undefined): string | null {
  const day = typeof b === 'string' ? b.slice(0, 10) : '';
  if (!day) return a;
  return a === null || day > a ? day : a;
}

function rank(row: LectureRow): number {
  if (row.action?.kind === 'review') return 0;
  if (row.action?.kind === 'add') return 1;
  if (row.action?.kind === 'quiz') return 2;
  return row.textOnly ? 4 : 3;
}

/**
 * One row per lecture with its card states, due cards, test and recall, and the one thing to do
 * next: repeat the due cards, add cards that never reached review, or take the test once. Rows
 * with something to do come first (the most due cards first), text-only lectures last.
 */
export function lectureRows(input: {
  materials: MaterialInput[];
  cards: Array<ProgressCard & { material_id: string | null }>;
  quizEvents: LearningEvent[];
  reviewEvents: LearningEvent[];
  mistakes: Array<{ material_id?: string | null }>;
  now: Date;
  windowFrom: string;
  windowTo: string;
}): LectureRow[] {
  const cardsBy = group(input.cards, (card) => card.material_id);
  const quizBy = group(input.quizEvents, (event) => event.material_id);
  const mistakesBy = group(input.mistakes, (row) => row.material_id ?? null);
  const nowMs = input.now.getTime();

  const rows = input.materials.map((material): LectureRow => {
    const cards = cardsBy.get(material.id) ?? [];
    const quizEvents = quizBy.get(material.id) ?? [];
    const textOnly = material.text_only === true;
    const generated = textOnly ? 0 : analysisCards(material.flashcards_json).length;
    const notInReview = cards.length === 0 ? generated : 0;
    const hasQuiz = !textOnly && Array.isArray(material.quiz) && material.quiz.length > 0;
    const metrics = materialMetrics(cards, quizEvents, input.now);
    const due = dueCount(cards, input.now);
    let lastActivity: string | null = null;
    for (const card of cards) {
      if (card.last_reviewed_at && Date.parse(card.last_reviewed_at) <= nowMs) {
        lastActivity = laterDay(lastActivity, localDateKey(new Date(card.last_reviewed_at)));
      }
    }
    for (const event of quizEvents) lastActivity = laterDay(lastActivity, event.local_date);
    let nextReview: string | null = null;
    let nextReviewMsMin = Number.POSITIVE_INFINITY;
    for (const card of cards) {
      const ms = nextReviewMs(card);
      if (ms !== null && ms > nowMs && ms < nextReviewMsMin) {
        nextReviewMsMin = ms;
        nextReview = card.next_review ?? null;
      }
    }
    const quizUntaken = hasQuiz && !metrics.quiz && !metrics.quizRepeat;

    let action: LectureAction | null = null;
    if (due > 0) action = { kind: 'review', count: due };
    else if (notInReview > 0) action = { kind: 'add', count: notInReview };
    else if (quizUntaken) action = { kind: 'quiz' };

    return {
      id: material.id,
      title: material.title,
      createdAt: material.created_at,
      textOnly,
      states: cardStates(cards, input.now),
      due,
      notInReview,
      hasQuiz,
      metrics,
      recall: recallTally(input.reviewEvents, input.windowFrom, input.windowTo, material.id),
      mistakes: (mistakesBy.get(material.id) ?? []).length,
      lastActivity,
      nextReview,
      quizUntaken,
      action,
    };
  });

  return rows.sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (a.action?.kind === 'review' && b.action?.kind === 'review' && a.due !== b.due) return b.due - a.due;
    const aDay = a.lastActivity ?? '';
    const bDay = b.lastActivity ?? '';
    if (aDay !== bDay) return aDay < bDay ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
}

export type TodoItem =
  | { kind: 'weak'; lecture: LectureRow; share: number }
  | { kind: 'mistakes'; count: number; topics: string[] }
  | { kind: 'add'; lecture: LectureRow }
  | { kind: 'exam'; examId: string; title: string; none: number }
  /** Lectures whose test was never taken, the newest first: one line, the button opens the first. */
  | { kind: 'quiz'; lectures: LectureRow[] };

/**
 * «Что подтянуть»: the gaps the data shows, most telling first — lectures whose cards are often
 * forgotten, open mistakes, cards that never reached review, exam questions with no lecture,
 * tests never taken (one line for all of them, whatever else the lecture waits for). At most
 * `limit`; `more` says how many were left out.
 */
export function todoItems(input: {
  rows: LectureRow[];
  mistakes: Array<{ topic?: string | null }> | null;
  exams: Array<{ id: string; title: string; none: number }> | null;
  limit?: number;
}): { items: TodoItem[]; more: number } {
  const candidates: TodoItem[] = [];
  const weak = input.rows
    .map((lecture) => ({ lecture, share: recallShare(lecture.recall, LECTURE_RECALL_MIN) }))
    .filter((entry): entry is { lecture: LectureRow; share: number } => entry.share !== null && entry.share < WEAK_RECALL)
    .sort((a, b) => a.share - b.share);
  for (const entry of weak) candidates.push({ kind: 'weak', lecture: entry.lecture, share: entry.share });

  if (input.mistakes && input.mistakes.length > 0) {
    const byTopic = new Map<string, number>();
    for (const row of input.mistakes) {
      const topic = typeof row.topic === 'string' ? row.topic.trim() : '';
      if (topic) byTopic.set(topic, (byTopic.get(topic) ?? 0) + 1);
    }
    const topics = Array.from(byTopic.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
      .map(([topic]) => topic);
    candidates.push({ kind: 'mistakes', count: input.mistakes.length, topics });
  }

  for (const lecture of input.rows) if (lecture.notInReview > 0) candidates.push({ kind: 'add', lecture });
  for (const exam of input.exams ?? []) if (exam.none > 0) candidates.push({ kind: 'exam', examId: exam.id, title: exam.title, none: exam.none });
  const untaken = input.rows
    .filter((lecture) => lecture.quizUntaken)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  if (untaken.length > 0) candidates.push({ kind: 'quiz', lectures: untaken });

  const limit = input.limit ?? TODO_LIMIT;
  return { items: candidates.slice(0, limit), more: Math.max(0, candidates.length - limit) };
}

function count(n: number, forms: readonly [string, string, string]): string {
  return `${n} ${pluralRu(n, forms)}`;
}

function listRu(parts: string[]): string {
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}` : (parts[0] ?? '');
}

/**
 * The line under «Прогресс»: what happened in the last 7 days, or when it last happened.
 * `lastDay` is a ready phrase such as «30 сентября».
 */
export function weekLede(input: { cardAnswers: number; tests: number; tickets: number; lastDay: string | null }): string {
  const parts: string[] = [];
  if (input.cardAnswers > 0) parts.push(`${count(input.cardAnswers, ['ответ', 'ответа', 'ответов'])} на карточки`);
  if (input.tests > 0) parts.push(count(input.tests, ['тест', 'теста', 'тестов']));
  if (input.tickets > 0) parts.push(`${count(input.tickets, ['ответ', 'ответа', 'ответов'])} на билеты`);
  if (parts.length > 0) return `За 7 дней: ${listRu(parts)}.`;
  if (input.lastDay) return `За 7 дней занятий не было. Последние — ${input.lastDay}.`;
  return 'Здесь будет видно, как вы запоминаете лекции. Начните с повторения карточек.';
}
