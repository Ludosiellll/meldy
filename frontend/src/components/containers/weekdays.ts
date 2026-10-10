/**
 * The days of the week a student studies an exam (`ContainerSettings.study_weekdays`, the user's own `container_plans`
 * row): a bit mask, Monday = 1 … Sunday = 64, 127 = every day; at least one day (the database checks 1..127).
 * Pure functions for «Настройки» (spec §3: «минуты и дни недели» are the student's own).
 */

export const EVERY_DAY = 127;

/** Monday = 0 … Sunday = 6, as lib/containers/time.ts weekday() counts them. */
export function dayOn(mask: number, day: number): boolean {
  return (mask & (1 << day)) !== 0;
}

/** The days in the mask. */
export function dayCount(mask: number): number {
  let n = 0;
  for (let day = 0; day < 7; day += 1) if (dayOn(mask, day)) n += 1;
  return n;
}

/** A mask the database takes: 1..127; anything else is every day. */
export function cleanDays(mask: unknown): number {
  return typeof mask === 'number' && Number.isInteger(mask) && mask >= 1 && mask <= EVERY_DAY ? mask : EVERY_DAY;
}

/** The mask with `day` switched; the last day stays on (null: refused). */
export function toggleDay(mask: number, day: number): number | null {
  const next = mask ^ (1 << day);
  return next & EVERY_DAY ? next : null;
}
