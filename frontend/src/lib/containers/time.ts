/** Local days and moments in a time zone (package D2): pure, `Intl` only, no clock. Handles 23/25-hour DST days. */
export type LocalDay = string; // 'YYYY-MM-DD'

function notBuilt(name: string): never {
  throw new Error(`lib/containers/time.${name}: not built yet (package D2)`);
}

export function localDay(_ms: number, _tz: string): LocalDay { return notBuilt('localDay'); }
export function addDays(_day: LocalDay, _n: number): LocalDay { return notBuilt('addDays'); }
export function daysBetween(_from: LocalDay, _to: LocalDay): number { return notBuilt('daysBetween'); }
export function startOfDay(_day: LocalDay, _tz: string): number { return notBuilt('startOfDay'); }
export function midnightAfter(_day: LocalDay, _tz: string): number { return notBuilt('midnightAfter'); }
