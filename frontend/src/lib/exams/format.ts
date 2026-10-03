/**
 * Words and dates of the exam screens. Plain Russian, every saved result carries its date.
 */
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { ExamKind } from '../../api/exams';
import { pluralRu } from '../../components/conversation/visuals';

export const KIND_WORDS: Record<ExamKind, string> = {
  exam: 'экзамен',
  credit: 'зачёт',
  colloquium: 'коллоквиум',
};

export const KIND_LABELS: Record<ExamKind, string> = {
  exam: 'Экзамен',
  credit: 'Зачёт',
  colloquium: 'Коллоквиум',
};

const KIND_PREFIX = /^\s*(экзамен|зач[её]т|коллоквиум)\s*(?::|\.|\s[—–-])\s*/i;
const KIND_WORD = /(^|[\s«(])(экзамен|зач[её]т|коллоквиум)/i;

function capitalize(text: string): string {
  return text ? text[0].toLocaleUpperCase('ru-RU') + text.slice(1) : text;
}

/**
 * The subject of an exam title: «Экзамен: цифровая экономика» → «Цифровая экономика». A leading
 * «Экзамен», «Зачёт» or «Коллоквиум» followed by «:», «.» or « — » is dropped and the rest gets a
 * capital letter, so the screens do not say «экзамен» three times in a row (the kind is shown next
 * to it anyway). Anything else is returned as it was typed.
 */
export function subjectOf(title: string): string {
  const clean = title.trim().replace(/\s+/g, ' ');
  const rest = clean.replace(KIND_PREFIX, '').trim();
  if (!rest || rest === clean) return clean;
  return capitalize(rest);
}

/**
 * «Цифровая экономика: вопросы к экзамену». When the kind is still part of the name
 * («Экзамен по микроэкономике»), the name alone is the header: nothing is said twice.
 */
export function sheetHeader(title: string, kind: ExamKind): string {
  const subject = subjectOf(title);
  if (KIND_WORD.test(subject)) return subject;
  return `${subject}: ${SHEET_WORDS[kind]}`;
}

const SHEET_WORDS: Record<ExamKind, string> = {
  exam: 'вопросы к экзамену',
  credit: 'вопросы к зачёту',
  colloquium: 'вопросы к коллоквиуму',
};

export const GRADE_WORDS: Record<number, string> = {
  5: 'отлично',
  4: 'хорошо',
  3: 'удовлетворительно',
  2: 'неудовлетворительно',
};

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'yyyy-MM-dd' → local midnight of that day, or null. */
export function parseDateKey(key: string | null | undefined): Date | null {
  const match = typeof key === 'string' ? DATE_KEY.exec(key) : null;
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Calendar days from today to the day (negative for the past). */
export function daysUntil(key: string | null | undefined, now: Date = new Date()): number | null {
  const date = parseDateKey(key);
  if (!date) return null;
  return Math.round((date.getTime() - startOfDay(now).getTime()) / 86_400_000);
}

/** «сегодня», «завтра», «через 12 дней», «вчера», «3 дня назад». */
export function relativeDays(days: number): string {
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days === -1) return 'вчера';
  if (days > 1) return `через ${days} ${pluralRu(days, ['день', 'дня', 'дней'])}`;
  const ago = Math.abs(days);
  return `${ago} ${pluralRu(ago, ['день', 'дня', 'дней'])} назад`;
}

/** «24 января» (with the year when it is not this year). */
export function formatDay(key: string | null | undefined, now: Date = new Date()): string {
  const date = parseDateKey(key);
  if (!date) return '';
  return format(date, date.getFullYear() === now.getFullYear() ? 'd MMMM' : 'd MMMM yyyy', { locale: ru });
}

/** «7 окт.» for a local day key. */
export function formatShortDay(key: string | null | undefined, now: Date = new Date()): string {
  const date = parseDateKey(key);
  if (!date) return '';
  return format(date, date.getFullYear() === now.getFullYear() ? 'd MMM' : 'd MMM yyyy', { locale: ru });
}

/** «экзамен · 24 января, через 12 дней»; without a date just the kind. */
export function examWhenLine(kind: ExamKind, examDate: string | null, now: Date = new Date()): string {
  const day = formatDay(examDate, now);
  if (!day) return KIND_WORDS[kind];
  const days = daysUntil(examDate, now);
  return `${KIND_WORDS[kind]} · ${day}${days === null ? '' : `, ${relativeDays(days)}`}`;
}

function parseInstant(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** «21 января, 9:40» in local time (with the year when it is not this year). */
export function formatMappedAt(iso: string | null | undefined, now: Date = new Date()): string {
  const date = parseInstant(iso);
  if (!date) return '';
  return format(date, date.getFullYear() === now.getFullYear() ? 'd MMMM, H:mm' : 'd MMMM yyyy, H:mm', { locale: ru });
}

/** «9:40» in local time. */
export function formatClock(iso: string | null | undefined): string {
  const date = parseInstant(iso);
  return date ? format(date, 'H:mm') : '';
}

/** The department's number when there is one, otherwise the position. */
export function questionNumber(label: string, position: number): string {
  const trimmed = label.trim();
  return trimmed || String(position);
}

/** 'S14' → 14, 'M2:S07' → 7. */
export function fragmentNumber(sourceId: string): number | null {
  const match = /S(\d{1,4})$/.exec(sourceId.trim());
  return match ? Number(match[1]) : null;
}

/** A title cut to `max` characters at a word when possible, with «…». */
export function shortTitle(title: string, max = 28): string {
  const clean = title.trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, '')}…`;
}

/** «Денежный рынок · фрагмент 14». */
export function fragmentRef(materialTitle: string, sourceId: string, max = 28): string {
  const number = fragmentNumber(sourceId);
  const title = shortTitle(materialTitle || 'Лекция', max);
  return number === null ? title : `${title} · фрагмент ${number}`;
}

export function lecturesWord(count: number): string {
  return pluralRu(count, ['лекция', 'лекции', 'лекций']);
}

export function questionsWord(count: number): string {
  return pluralRu(count, ['вопрос', 'вопроса', 'вопросов']);
}

/** «Из N лекций» in the genitive: «ни в одной из 9 лекций», «из 1 лекции». */
export function lecturesGenitive(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? 'лекции' : 'лекций';
}

/** «вопрос», «оба вопроса», «все три вопроса», «все четыре вопроса». */
export function allQuestionsWord(perTicket: number): string {
  if (perTicket <= 1) return 'вопрос';
  if (perTicket === 2) return 'оба вопроса';
  if (perTicket === 3) return 'все три вопроса';
  return 'все четыре вопроса';
}
