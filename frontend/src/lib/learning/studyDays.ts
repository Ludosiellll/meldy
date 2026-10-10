/**
 * Days of study, for «Занятия по дням» in «Прогресс» and «Дней подряд» in the profile: a day counts
 * when the student answered anything that day — cards, a ticket of an exam (spoken or typed), a
 * test, or a question of an exam's file (a question with variants, in an exam container). Card
 * answers come from the daily counters (study_sessions.cards_reviewed, kept since before the
 * journal); answers to tickets (`exam_answer`) and to tests (`quiz_answer`) come from the learning
 * journal; answers to the questions of an exam's file come from the server's own answer log, as
 * answers per local day (`test_answer_days`, api/containers.fetchAnswerDays), read the same way by
 * «Прогресс» (its week, its days and their columns) and «Профиль». The journal's card answers
 * (`card_review`) are the same answers as the counters, so they are never added a second time; a
 * day with answers of several kinds is one day. Days are local 'yyyy-MM-dd' keys. Pure module.
 */
import { currentStreak, isDateKey, localDateKey, shiftDateKey } from '../../utils/streak';

export interface SessionDay {
  date: string;
  cards_reviewed: number | null;
}

export interface JournalDay {
  kind: string;
  local_date: string;
}

/** Answers to the questions of an exam's file on one local day (the server's `test_answer_days`). */
export interface ExamQuestionDay {
  local_date: string;
  answers: number;
}

export interface DayAnswers {
  key: string;
  cards: number;
  tickets: number;
  tests: number;
  /** Answers to the questions of an exam's file (exam containers: `test_answer_days`). */
  questions: number;
}

function dayOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.slice(0, 10);
  return isDateKey(key) ? key : null;
}

function cardsOf(row: SessionDay): number {
  const n = Number(row.cards_reviewed);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The answers of one row of `test_answer_days`; 0 for a broken row. */
function questionsOf(row: ExamQuestionDay | null | undefined): number {
  const n = Number(row?.answers);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

interface StudyInput {
  sessions: readonly SessionDay[];
  events: readonly JournalDay[];
  /** Days with answers to the questions of an exam's file; absent where the database has none (then as before). */
  examQuestionDays?: readonly ExamQuestionDay[];
}

/**
 * Answers per day from `from` to `to` (inclusive, oldest first): one entry for every day, so a day with answers of
 * several kinds is one day.
 */
export function answersByDay(input: StudyInput & { from: string; to: string }): DayAnswers[] {
  const days: DayAnswers[] = [];
  const byKey = new Map<string, DayAnswers>();
  for (let key = input.from; key <= input.to; key = shiftDateKey(key, 1)) {
    const day = { key, cards: 0, tickets: 0, tests: 0, questions: 0 };
    days.push(day);
    byKey.set(key, day);
  }
  for (const row of input.sessions) {
    const day = byKey.get(dayOf(row.date) ?? '');
    if (day) day.cards += cardsOf(row);
  }
  for (const event of input.events) {
    const day = byKey.get(dayOf(event.local_date) ?? '');
    if (!day) continue;
    if (event.kind === 'exam_answer') day.tickets += 1;
    else if (event.kind === 'quiz_answer') day.tests += 1;
  }
  for (const row of input.examQuestionDays ?? []) {
    const day = byKey.get(dayOf(row?.local_date) ?? '');
    if (day) day.questions += questionsOf(row);
  }
  return days;
}

/** The local days with at least one answer to a card, a ticket, a test or a question of an exam's file. */
export function studyDayKeys(input: StudyInput): Set<string> {
  const keys = new Set<string>();
  for (const row of input.sessions) {
    const key = dayOf(row.date);
    if (key && cardsOf(row) > 0) keys.add(key);
  }
  for (const event of input.events) {
    if (event.kind !== 'exam_answer' && event.kind !== 'quiz_answer') continue;
    const key = dayOf(event.local_date);
    if (key) keys.add(key);
  }
  for (const row of input.examQuestionDays ?? []) {
    const key = dayOf(row?.local_date);
    if (key && questionsOf(row) > 0) keys.add(key);
  }
  return keys;
}

/**
 * Days of study in a row, ending today or, before the first answer of today, yesterday (the rule of
 * utils/streak.currentStreak).
 */
export function studyStreak(input: StudyInput, today: Date = new Date()): number {
  return currentStreak(studyDayKeys(input), today);
}

/** The first day of a window of `days` days that ends today: «за 30 дней». */
export function windowStart(days: number, today: Date = new Date()): string {
  return shiftDateKey(localDateKey(today), -(Math.max(1, Math.trunc(days)) - 1));
}
