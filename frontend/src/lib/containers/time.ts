/**
 * Local days and moments in a time zone (package D2): pure, `Intl` only, no clock. Handles 23/25-hour DST days.
 *
 * A local day is 'YYYY-MM-DD'. Civil-date arithmetic uses day numbers (days since 1970-01-01, proleptic Gregorian),
 * so nothing here reads the device clock or the device zone: every moment and zone is passed in. The Telegram bot
 * copies this file verbatim (supabase/functions/_shared/plan/).
 */
export type LocalDay = string; // 'YYYY-MM-DD'

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

interface WallClock { y: number; m: number; d: number; h: number; mi: number; s: number }

/** The wall clock of `ms` in `tz`. */
function wallClock(ms: number, tz: string): WallClock {
  const out: WallClock = { y: 0, m: 0, d: 0, h: 0, mi: 0, s: 0 };
  for (const part of formatter(tz).formatToParts(ms)) {
    const value = Number(part.value);
    if (part.type === 'year') out.y = value;
    else if (part.type === 'month') out.m = value;
    else if (part.type === 'day') out.d = value;
    else if (part.type === 'hour') out.h = value === 24 ? 0 : value; // some engines print midnight as 24
    else if (part.type === 'minute') out.mi = value;
    else if (part.type === 'second') out.s = value;
  }
  return out;
}

/** Days since 1970-01-01 of a civil date. */
function dayNumber(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** The civil date of a day number. */
function dayOfNumber(num: number): LocalDay {
  const z = num + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a well-formed 'YYYY-MM-DD' that names a real date. */
export function isLocalDay(value: unknown): value is LocalDay {
  if (typeof value !== 'string') return false;
  const match = DAY_RE.exec(value);
  if (!match) return false;
  return dayOfNumber(dayNumber(Number(match[1]), Number(match[2]), Number(match[3]))) === value;
}

/** Days since 1970-01-01 of a local day (throws on a malformed day). */
export function dayIndex(day: LocalDay): number {
  const match = DAY_RE.exec(day);
  if (!match) throw new Error(`lib/containers/time: not a local day: ${String(day)}`);
  return dayNumber(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** The local day of `ms` in `tz`. */
export function localDay(ms: number, tz: string): LocalDay {
  const w = wallClock(ms, tz);
  return dayOfNumber(dayNumber(w.y, w.m, w.d));
}

export function addDays(day: LocalDay, n: number): LocalDay {
  return dayOfNumber(dayIndex(day) + n);
}

/** `to − from` in calendar days (negative when `to` is earlier). */
export function daysBetween(from: LocalDay, to: LocalDay): number {
  return dayIndex(to) - dayIndex(from);
}

/** Monday = 0 … Sunday = 6. */
export function weekday(day: LocalDay): number {
  return (((dayIndex(day) + 3) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

// ── The student's days of the week (settings.study_weekdays): a bit mask, Monday = 1 … Sunday = 64.

/** Every day of the week. */
export const EVERY_DAY = 127;

/** A mask as the database keeps it (an integer 1..127); anything else is every day. */
export function studyMask(mask: unknown): number {
  return typeof mask === 'number' && Number.isInteger(mask) && mask >= 1 && mask <= EVERY_DAY ? mask : EVERY_DAY;
}

/** `day` is one of the study days of `mask`. */
export function isStudyDay(day: LocalDay, mask: number): boolean {
  return (studyMask(mask) & (1 << weekday(day))) !== 0;
}

/** The study days d with from ≤ d < to (0 when `to` is not later); every day: `to − from`. */
export function studyDaysBetween(from: LocalDay, to: LocalDay, mask: number): number {
  const n = daysBetween(from, to);
  const m = studyMask(mask);
  if (n <= 0) return 0;
  if (m === EVERY_DAY) return n;
  let perWeek = 0;
  for (let d = 0; d < 7; d += 1) if (m & (1 << d)) perWeek += 1;
  let count = Math.floor(n / 7) * perWeek;
  const first = weekday(from);
  for (let i = 0; i < n % 7; i += 1) if (m & (1 << ((first + i) % 7))) count += 1;
  return count;
}

/** The first study day on or after `day` (within a week: a mask has at least one day). */
export function studyDayFrom(day: LocalDay, mask: number): LocalDay {
  let d = day;
  for (let i = 0; i < 7 && !isStudyDay(d, mask); i += 1) d = addDays(d, 1);
  return d;
}

/** The last study day before `day`. */
export function studyDayBefore(day: LocalDay, mask: number): LocalDay {
  let d = addDays(day, -1);
  for (let i = 0; i < 7 && !isStudyDay(d, mask); i += 1) d = addDays(d, -1);
  return d;
}

/** The zone's offset at `ms` (local wall clock minus UTC), in ms. */
function offsetAt(ms: number, tz: string): number {
  const w = wallClock(ms, tz);
  const wall = dayNumber(w.y, w.m, w.d) * DAY_MS + ((w.h * 60 + w.mi) * 60 + w.s) * 1000;
  const wholeSecond = ms - (((ms % 1000) + 1000) % 1000);
  return wall - wholeSecond;
}

/** The moment a local wall time would have with the offsets around it (two passes cover a DST change). */
function fromWall(wall: number, tz: string): number {
  let guess = wall - offsetAt(wall, tz);
  guess = wall - offsetAt(guess, tz);
  return guess;
}

const starts = new Map<string, number>();

/** The first moment of `day` in `tz` (local midnight, or the first instant after a DST jump over midnight). */
export function startOfDay(day: LocalDay, tz: string): number {
  const key = `${tz}|${day}`;
  const cached = starts.get(key);
  if (cached !== undefined) return cached;
  const wall = dayIndex(day) * DAY_MS;
  let start = fromWall(wall, tz);
  if (localDay(start, tz) !== day || localDay(start - 1, tz) === day) {
    // A zone whose day does not begin at 00:00 that day: find the first moment of the day.
    let lo = wall - 16 * HOUR_MS; // before the day in every zone (offsets are within −12 h … +14 h)
    let hi = wall + 16 * HOUR_MS; // inside or after it
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (localDay(mid, tz) >= day) hi = mid;
      else lo = mid;
    }
    start = hi;
  }
  if (starts.size > 4096) starts.clear();
  starts.set(key, start);
  return start;
}

/** The first moment of the day after `day`. */
export function midnightAfter(day: LocalDay, tz: string): number {
  return startOfDay(addDays(day, 1), tz);
}

/** The moment of the wall time `minutes` after local midnight of `day` (e.g. 22 × 60 for 22:00). */
export function atLocalTime(day: LocalDay, minutes: number, tz: string): number {
  if (minutes <= 0) return startOfDay(day, tz);
  const moment = fromWall(dayIndex(day) * DAY_MS + minutes * MINUTE_MS, tz);
  const end = midnightAfter(day, tz);
  return moment < end ? moment : end - 1;
}

/** Hours and minutes of `ms` on the local clock. */
export function clockOf(ms: number, tz: string): { h: number; m: number } {
  const w = wallClock(ms, tz);
  return { h: w.h, m: w.mi };
}

/**
 * '17:00', '8:10' — the local time of `ms`, rounded UP to `stepMin` minutes (a promise «после 17:05» stays true).
 * A moment that rounds to the next midnight reads '0:00'.
 */
export function clockText(ms: number, tz: string, stepMin = 1): string {
  const step = Math.max(1, Math.floor(stepMin)) * MINUTE_MS;
  const w = wallClock(ms, tz);
  const intoDay = ((w.h * 60 + w.mi) * 60 + w.s) * 1000 + (((ms % 1000) + 1000) % 1000);
  const rounded = Math.ceil(intoDay / step) * step;
  const total = Math.floor(rounded / MINUTE_MS) % (24 * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
