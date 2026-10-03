/**
 * Russian dates and times of the answer screen, built by hand so the words do not depend on the
 * browser's ICU build: «7 окт.», «7 окт., 14:02», «3 октября, 14:12», «0:18».
 */
import { ty } from '../../components/landing/typo';

const MONTHS_LONG = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июня', 'июля', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
/** Non-breaking space: «7 окт.» never breaks between the number and the month. */
const NBSP = '\u00a0';

/** A Date from an ISO timestamp, or from a journal day 'yyyy-MM-dd' read as a local day. */
export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function clockTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** «7 окт.» */
export function shortDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? `${date.getDate()}${NBSP}${MONTHS_SHORT[date.getMonth()]}` : '';
}

/** «7 окт., 14:02» */
export function shortDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? `${shortDate(date)}, ${clockTime(date)}` : '';
}

/** «3 октября, 14:12» */
export function longDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? `${date.getDate()}${NBSP}${MONTHS_LONG[date.getMonth()]}, ${clockTime(date)}` : '';
}

/** «14:02» for today, «2 окт., 14:02» for another day (the restored draft line). */
export function draftTime(value: string | Date | null | undefined, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '';
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay ? clockTime(date) : shortDateTime(date);
}

/** Answer time «0:18», «2:05». */
export function elapsedLabel(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** «0 минут 21 секунда» for screen readers. */
export function elapsedSpoken(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes} ${plural(minutes, 'минута', 'минуты', 'минут')} ${seconds} ${plural(seconds, 'секунда', 'секунды', 'секунд')}`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const ORDINALS = ['Первый', 'Второй', 'Третий', 'Четвёртый'];

/** «Второй вопрос» — the primary action after a question of a ticket with more to answer. */
export function nextQuestionLabel(nextIndex: number): string {
  return `${ORDINALS[nextIndex] ?? `${nextIndex + 1}-й`} вопрос`;
}

/**
 * Russian typesetting of a dynamic line (redesign spec 3.10): short words and numbers stay with the
 * next word («9 лекций», «3 октября»), « · » never starts a line, a dash never starts one either.
 */
export function glue(text: string): string {
  return ty(text)
    .replace(/(\d) (?=[а-яёА-ЯЁa-zA-Z%])/g, `$1${NBSP}`)
    .replace(/ ·/g, `${NBSP}·`);
}
