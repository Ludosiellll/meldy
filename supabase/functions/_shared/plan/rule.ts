/**
 * «Верно в два разных дня» (package D2; spec §4): the constants (equal to the oral ones in lib/learning/readiness.ts
 * and lib/exams/cheatSheet.ts — a test checks it) and the read side of the rule. State transitions live only in SQL
 * (meldy_private.rule_step); `derive` is tested against contracts/container/rule_vectors.json.
 *
 * Pure: the moment, the local day and the zone are passed in.
 */
import type { LocalDay, UnitState } from './container.ts';
import { daysBetween, midnightAfter } from './time.ts';

export const CONFIRM_MIN_HOURS = 20;
export const DUE_DAYS: readonly number[] = [5, 12, 25, 50];
export const EXAM_EVE_DAYS = 2;
export const EXAM_EVE_STALE_DAYS = 4;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type UnitStatus = 'new' | 'learning' | 'started' | 'two_days' | 'due';

export function emptyState(): UnitState {
  return { seen: 0, wrong: 0, firstDay: null, lastDay: null, seriesAt: null, seriesDay: null, twoDaysAt: null,
    namedAt: null, checks: 0, peekDay: null, wasTwoDays: false, cleanOkAt: null };
}

/** The second clean right answer completes the series: another local day AND at least 20 hours later (server clock). */
export function meetsRule(seriesAt: number, seriesDay: LocalDay, at: number, day: LocalDay): boolean {
  return day !== seriesDay && at - seriesAt >= CONFIRM_MIN_HOURS * HOUR_MS;
}

/**
 * The moment an item in the figure is due for its check: the stage's days after the last clean right answer
 * (`[5, 12, 25, 50][min(checks, 3)]`); on a local `day` 0–2 days before the exam, 4 days after it at the latest
 * (lib/exams/cheatSheet.ts dueMoment, the same formula).
 */
export function dueAt(namedAt: number, checks: number, day: LocalDay, examDay: LocalDay | null): number {
  const stage = DUE_DAYS[Math.min(Math.max(0, checks), DUE_DAYS.length - 1)];
  const due = namedAt + stage * DAY_MS;
  if (examDay !== null) {
    const left = daysBetween(day, examDay);
    if (left >= 0 && left <= EXAM_EVE_DAYS) return Math.min(due, namedAt + EXAM_EVE_STALE_DAYS * DAY_MS);
  }
  return due;
}

/**
 * From when the next clean right answer of a started series counts: 20 hours after its first answer and not before
 * the next local day; after a peek today, not before tomorrow (the oral sheet's `erasableFrom`).
 */
export function countableFrom(seriesAt: number, seriesDay: LocalDay, peekDay: LocalDay | null, today: LocalDay, tz: string): number {
  let from = Math.max(seriesAt + CONFIRM_MIN_HOURS * HOUR_MS, midnightAfter(seriesDay, tz));
  if (peekDay === today) from = Math.max(from, midnightAfter(today, tz));
  return from;
}

/**
 * Status now and, for `started`, the moment it can count; for `two_days` and `due`, its due moment.
 * - new: never answered (a misclick alone already makes it `learning`);
 * - learning: answered, no series (the last counted answer was a miss, or only training so far);
 * - started: one clean right answer, waiting for another day and 20 hours;
 * - two_days: in the figure, its check not due yet; due: in the figure and due for its check.
 */
export function derive(state: UnitState, now: number, today: LocalDay, examDay: LocalDay | null, tz: string): { status: UnitStatus; from: number | null } {
  if (state.firstDay === null && state.seen === 0) return { status: 'new', from: null };
  if (state.twoDaysAt !== null) {
    const due = dueAt(state.namedAt ?? state.twoDaysAt, state.checks, today, examDay);
    return { status: now >= due ? 'due' : 'two_days', from: due };
  }
  if (state.seriesAt !== null && state.seriesDay !== null) {
    return { status: 'started', from: countableFrom(state.seriesAt, state.seriesDay, state.peekDay, today, tz) };
  }
  return { status: 'learning', from: null };
}

export function inFigure(state: UnitState): boolean { return state.twoDaysAt !== null; }

/** «Ошибок сейчас»: the last counted answer was wrong or «Не знаю» (SQL: last_result in ('wrong', 'dont_know')). */
export function isOpenError(state: UnitState): boolean {
  return state.wrong > 0 && state.seriesAt === null && state.twoDaysAt === null;
}

/** «Видели»: answered at least once under the current key (SQL: first_seen_day is not null). */
export function isSeen(state: UnitState): boolean {
  return state.firstDay !== null || state.seen > 0;
}
