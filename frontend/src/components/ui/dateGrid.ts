/**
 * The calendar of DateField: days as the date field's own values («2026-11-27»), months as weeks from Monday, and the
 * words for a day («пятница, 27 ноября · через 9 дней»). No Date in local time past the two helpers at the top: a day
 * is counted in UTC, so a clock change never moves it.
 */
import { plural } from '../../lib/containers/words';

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'] as const;
const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'] as const;
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;
const WEEKDAYS_LONG = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'] as const;

export interface Month {
  y: number;
  /** 1..12 */
  m: number;
}

const two = (n: number) => String(n).padStart(2, '0');
const utc = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const fromUtc = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
};
const DAY = 86400000;

/** A real day in the field's form, «ГГГГ-ММ-ДД» (no 31 февраля). */
export function isDay(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return fromUtc(utc(value)) === value;
}

/** Today on this device's own clock. */
export function todayHere(now: Date = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

export function addDays(day: string, n: number): string {
  return fromUtc(utc(day) + n * DAY);
}

/** The same day of another month; a day the month does not have becomes its last («31 января» + 1 → «28 февраля»). */
export function addMonths(day: string, n: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(y, m, Math.min(Number(day.slice(8, 10)), last)));
}

/** Days from `from` to `to` (negative — `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY);
}

export function monthOf(day: string): Month {
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) };
}

export function shiftMonth(month: Month, n: number): Month {
  const index = month.y * 12 + (month.m - 1) + n;
  return { y: Math.floor(index / 12), m: (index % 12 + 12) % 12 + 1 };
}

export const firstDay = (month: Month) => `${String(month.y).padStart(4, '0')}-${two(month.m)}-01`;
export const lastDay = (month: Month) => addDays(firstDay(shiftMonth(month, 1)), -1);

/** The month as six weeks from Monday (the same height for every month); null — a day of a neighbouring month. */
export function monthWeeks(month: Month): Array<Array<string | null>> {
  const first = firstDay(month);
  const lead = (new Date(utc(first)).getUTCDay() + 6) % 7; // Monday → 0
  const days = Number(lastDay(month).slice(8, 10));
  const weeks: Array<Array<string | null>> = [];
  for (let w = 0; w < 6; w += 1) {
    const row: Array<string | null> = [];
    for (let d = 0; d < 7; d += 1) {
      const n = w * 7 + d - lead + 1;
      row.push(n >= 1 && n <= days ? addDays(first, n - 1) : null);
    }
    weeks.push(row);
  }
  return weeks;
}

/** Whether the field takes the day: within its min and max (each may be absent). */
export function allowed(day: string, min?: string | null, max?: string | null): boolean {
  return (!isDay(min) || day >= min) && (!isDay(max) || day <= max);
}

/** The day itself when the field takes it, else the nearest one it does. */
export function nearest(day: string, min?: string | null, max?: string | null): string {
  if (isDay(min) && day < min) return min;
  if (isDay(max) && day > max) return max;
  return day;
}

/** «Ноябрь 2026» */
export const monthTitle = (month: Month) => `${MONTHS[month.m - 1]} ${month.y}`;

/** «27 ноября, пятница» — a day's name for a screen reader and for the line under the grid. */
export function dayName(day: string): string {
  const weekday = WEEKDAYS_LONG[(new Date(utc(day)).getUTCDay() + 6) % 7];
  return `${Number(day.slice(8, 10))} ${MONTHS_OF[Number(day.slice(5, 7)) - 1]}, ${weekday}`;
}

/** How far the day is from today, in words: «сегодня», «завтра», «через 9 дней», «3 дня назад». */
export function distance(day: string, today: string): string {
  const n = daysBetween(today, day);
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n === -1) return 'вчера';
  const words = `${Math.abs(n)} ${plural(Math.abs(n), 'день', 'дня', 'дней')}`;
  return n > 0 ? `через ${words}` : `${words} назад`;
}
