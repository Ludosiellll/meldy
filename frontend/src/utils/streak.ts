/**
 * Calendar-day helpers of the learning journal and the study streak.
 *
 * Days are 'yyyy-MM-dd' keys of the viewer's local calendar (the browser time zone), the same
 * keys that `learning_events.local_date` and `study_sessions.date` hold. Day arithmetic works on
 * the keys themselves (UTC calendar maths), so daylight-saving switches never skip or repeat a day.
 * Pure module: no network, no storage.
 */

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

const DAY_PARTS: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };
/** How long one formatter serves before it is made again (a zone the device moved to is taken within a minute). */
const FORMAT_FOR_MS = 60_000;
let dayFormat: { make: typeof Intl.DateTimeFormat; format: Intl.DateTimeFormat; until: number } | null = null;

/**
 * The formatter of day keys, made once (a minute at most) instead of on every call: making one costs about seven times
 * formatting with it, and «Сегодня» and the sheets ask for thousands of day keys (smoothness audit 20.10). Only the
 * platform's own formatter is kept: a formatter put in its place (a test pinning a zone) is made on every call, as before.
 */
function dayFormatter(): Intl.DateTimeFormat {
  const make = Intl.DateTimeFormat;
  const now = Date.now();
  if (dayFormat && dayFormat.make === make && now < dayFormat.until) return dayFormat.format;
  const format = new make('en-US', DAY_PARTS);
  if (/\[native code\]/.test(Function.prototype.toString.call(make))) dayFormat = { make, format, until: now + FORMAT_FOR_MS };
  else dayFormat = null;
  return format;
}

/** 'yyyy-MM-dd' of the moment `d` (default: now) in the browser time zone. */
export function localDateKey(d: Date = new Date()): string {
  const moment = Number.isNaN(d.getTime()) ? new Date() : d;
  // Intl reads the same time zone as Date#getDate, and it is the one place a test can pin a zone.
  const parts = dayFormatter().formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month').padStart(2, '0')}-${part('day').padStart(2, '0')}`;
}

/** True for a 'yyyy-MM-dd' key of a real calendar day. */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return day.getUTCMonth() === Number(match[2]) - 1 && day.getUTCDate() === Number(match[3]);
}

/** The day key `days` calendar days after `key` (negative goes back). */
export function shiftDateKey(key: string, days: number): string {
  const match = DATE_KEY.exec(key);
  if (!match) throw new RangeError(`Expected a yyyy-MM-dd day, got "${key}"`);
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Math.trunc(days)));
  return `${pad(day.getUTCFullYear(), 4)}-${pad(day.getUTCMonth() + 1, 2)}-${pad(day.getUTCDate(), 2)}`;
}

/**
 * Consecutive active days ending today, or ending yesterday when today has no activity yet
 * (a streak is not lost before the first answer of the day).
 *
 * `dates` are local day keys; longer ISO strings are cut to their first ten characters and
 * anything that is not a day is ignored. Duplicates count once.
 */
export function currentStreak(dates: Iterable<string>, today: Date = new Date()): number {
  const active = new Set<string>();
  for (const value of dates) {
    if (typeof value !== 'string') continue;
    const key = value.slice(0, 10);
    if (isDateKey(key)) active.add(key);
  }
  let cursor = localDateKey(today);
  if (!active.has(cursor)) cursor = shiftDateKey(cursor, -1);
  let streak = 0;
  while (active.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}
