/**
 * «Вопрос дня» (plan 2026-10-07, week 2: «„вопрос дня“ вручную в беседе группы»): the author of an exam with a
 * group link copies a short message for the group's chat — the exam, one question of its list for today, and
 * the link («Ответить в Meldy: …»). Pasted every day, it brings the group back on another day, which is what
 * erases the lines of the cheat sheet.
 *
 * The question. Only the questions whose answer points are written (the cheat sheet has their lines), never a
 * «нет в лекциях» one. The day picks it: the questions are put in one fixed order per exam (by a hash, not by
 * the list, so the group does not get 1, 2, 3 …), and day N of the calendar takes place N of that order. The
 * same day gives the same question; the next days go through all of them before one comes again.
 *
 * The link («Ответить в Meldy: …») comes from lib/groups/groupLinks.ts: only an open link whose code this device
 * keeps; otherwise the message is copied without one, and the page says why.
 */
import { blockKind, blockNumber, type SheetQuestion } from '../exams/cheatSheet';
import { subjectOf } from '../exams/format';
import { sha256Hex } from '../sha256';

const QUESTION_MAX = 500;

// ------------------------------------------------------------------ the question

/**
 * A question with written answer points (the sheet's 'lines'). A «нет в лекциях» question is a 'gap' there:
 * the mapping's «none», the points' «none», or no points at all.
 */
export function hasAnswerPoints(question: SheetQuestion): boolean {
  return blockKind(question) === 'lines';
}

/** Days since 1970-01-01 of a «yyyy-MM-dd» day (null for anything else). */
export function dayNumber(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? Math.floor(time / 86_400_000) : null;
}

/** The exam's questions with points, in the exam's own fixed order (a hash of the exam and the question). */
export function dailyOrder(questions: readonly SheetQuestion[], examId: string): SheetQuestion[] {
  const keyed = questions
    .filter(hasAnswerPoints)
    .map((question) => ({ question, key: sha256Hex(`meldy:question-of-day:${examId}:${question.question_hash || question.question_id}`) }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.question.position - b.question.position));
  return keyed.map((item) => item.question);
}

/** Today's question (`day`: the author's local «yyyy-MM-dd»); null when no question has answer points. */
export function questionOfDay(questions: readonly SheetQuestion[], examId: string, day: string): SheetQuestion | null {
  const order = dailyOrder(questions, examId);
  const n = dayNumber(day);
  if (order.length === 0 || n === null) return null;
  return order[((n % order.length) + order.length) % order.length];
}

/** «12. Эластичность спроса по цене.» — the department's number (else the place in the list) and wording. */
export function questionLine(question: SheetQuestion): string {
  const text = question.text.replace(/\s+/g, ' ').trim();
  const short = text.length > QUESTION_MAX ? `${text.slice(0, QUESTION_MAX - 1).trimEnd()}…` : text;
  return `${blockNumber(question)}. ${short}`;
}

/**
 * The message for the group's chat. With the link: «Ответить в Meldy: <ссылка>» last (messengers preview the
 * last link). Without it: where to answer, in words.
 */
export function questionOfDayMessage(options: { title: string; question: SheetQuestion; url: string | null }): string {
  return [
    `Вопрос дня — «${subjectOf(options.title)}»`,
    questionLine(options.question),
    options.url ? `Ответить в Meldy: ${options.url}` : 'Ответить можно в Meldy — в своей копии экзамена.',
  ].join('\n');
}
