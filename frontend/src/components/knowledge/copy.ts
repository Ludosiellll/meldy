/**
 * The words of the knowledge map, in one place (plain Russian; user titles are never declined).
 */
import type { CoverageValue } from '../../api/exams';
import { READINESS_LABELS, type Readiness } from '../../lib/learning/readiness';
import { daysUntil, formatDay, KIND_LABELS, KIND_WORDS, relativeDays } from '../../lib/exams/format';
import { pluralRu } from '../conversation/visuals';
import { fragmentsPhrase, readinessWords } from '../exams/sheetModel';
import type { ExamEntry, MapLecture, QuestionView } from './model';

export const NBSP = ' ';

/** «3 лекции», with a no-break space so the number stays with its word. */
export function count(value: number, forms: readonly [string, string, string]): string {
  return `${value}${NBSP}${pluralRu(value, forms)}`;
}

export const LECTURES: readonly [string, string, string] = ['лекция', 'лекции', 'лекций'];
export const CONCEPTS: readonly [string, string, string] = ['понятие', 'понятия', 'понятий'];
export const SHARED: readonly [string, string, string] = ['общее понятие', 'общих понятия', 'общих понятий'];
export const QUESTIONS: readonly [string, string, string] = ['вопрос', 'вопроса', 'вопросов'];
export const MISTAKES: readonly [string, string, string] = ['открытая ошибка', 'открытые ошибки', 'открытых ошибок'];
export const CARDS_DUE: readonly [string, string, string] = ['карточка к повторению', 'карточки к повторению', 'карточек к повторению'];

/** «в 3 лекциях» (prepositional). */
export function inLectures(value: number): string {
  return `в${NBSP}${value}${NBSP}${value % 10 === 1 && value % 100 !== 11 ? 'лекции' : 'лекциях'}`;
}

/** The short line under a card's title: «2 ошибки · 4 карточки», or why it has no concepts. */
export function cardNote(lecture: Pick<MapLecture, 'openMistakes' | 'dueCards' | 'textOnly' | 'termCount'>): { text: string; quiet: boolean } | null {
  const parts: string[] = [];
  if (lecture.openMistakes.length > 0) parts.push(count(lecture.openMistakes.length, ['ошибка', 'ошибки', 'ошибок']));
  if (lecture.dueCards > 0) parts.push(count(lecture.dueCards, ['карточка', 'карточки', 'карточек']));
  if (parts.length) return { text: parts.join(' · '), quiet: false };
  if (lecture.textOnly && lecture.termCount === 0) return { text: 'конспекта нет', quiet: true };
  return null;
}

/** The same in full words, for screen readers and the list. */
export function cardNoteWords(lecture: Pick<MapLecture, 'openMistakes' | 'dueCards' | 'textOnly' | 'termCount'>): string {
  const parts: string[] = [];
  if (lecture.openMistakes.length > 0) parts.push(count(lecture.openMistakes.length, MISTAKES));
  if (lecture.dueCards > 0) parts.push(count(lecture.dueCards, CARDS_DUE));
  if (!parts.length && lecture.textOnly && lecture.termCount === 0) parts.push('только текст, конспекта нет');
  return parts.join(', ');
}

/** «подтверждено вчера», «названо недостаточно», «не проверялось». */
export function readinessPhrase(question: Pick<QuestionView, 'readiness' | 'state'>, now: Date = new Date()): string {
  if (question.state) return readinessWords(question.state, now) || READINESS_LABELS[question.readiness];
  return READINESS_LABELS[question.readiness];
}

/** «вопрос 12, подтверждено» — what a screen reader hears for a number on a card. */
export function questionWords(question: Pick<QuestionView, 'number' | 'readiness'>): string {
  return `${question.number}${question.readiness === 'untested' ? '' : ` — ${READINESS_LABELS[question.readiness]}`}`;
}

/** Where a question is in this lecture: «есть в лекции, фрагменты 2, 4» / «частично, фрагмент 5». */
export function coverageHere(coverage: CoverageValue | null, sourceIds: string[]): string {
  const head = coverage === 'partial' ? 'частично' : 'есть в лекции';
  const fragments = fragmentsPhrase(sourceIds);
  return fragments ? `${head}, ${fragments}` : head;
}

/** «Микроэкономика — экзамен 15 октября, через 12 дней»; without a date «Микроэкономика — экзамен». */
export function examLine(exam: ExamEntry, now: Date = new Date()): string {
  const day = formatDay(exam.examDate, now);
  if (!day) return `${exam.title} — ${KIND_WORDS[exam.kind]}`;
  const days = daysUntil(exam.examDate, now);
  return `${exam.title} — ${KIND_WORDS[exam.kind]} ${day}${days === null ? '' : `, ${relativeDays(days)}`}`;
}

/**
 * «Экзамен через 12 дней», «Зачёт завтра»; «Экзамен» without a date: the phone's one-line meta of the map, where the
 * exam's name is in the choice of exams beside it and its date on the exam sheet.
 */
export function examShort(exam: Pick<ExamEntry, 'kind' | 'examDate'>, now: Date = new Date()): string {
  const days = daysUntil(exam.examDate, now);
  return days === null ? KIND_LABELS[exam.kind] : `${KIND_LABELS[exam.kind]} ${relativeDays(days)}`;
}

export const READINESS_ORDER: Readiness[] = ['confirmed', 'once', 'not_passed', 'untested'];
