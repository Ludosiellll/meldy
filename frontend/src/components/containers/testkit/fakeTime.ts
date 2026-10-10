/** A stand-in for lib/containers/time.ts in tests: Europe/Minsk is UTC+3 all year, which is all the tests need. */
export type LocalDay = string;
const OFFSET = 3 * 3_600_000;

export function localDay(ms: number, _tz: string): LocalDay {
  return new Date(ms + OFFSET).toISOString().slice(0, 10);
}
export function addDays(day: LocalDay, n: number): LocalDay {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
export function daysBetween(from: LocalDay, to: LocalDay): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
export function startOfDay(day: LocalDay, _tz: string): number {
  return Date.parse(`${day}T00:00:00Z`) - OFFSET;
}
export function midnightAfter(day: LocalDay, tz: string): number {
  return startOfDay(addDays(day, 1), tz);
}
