/**
 * «Верно в два разных дня» (package D2; spec §4): the constants (equal to the oral ones in lib/learning/readiness.ts
 * and lib/exams/cheatSheet.ts — a test checks it) and the read side of the rule. State transitions live only in SQL
 * (meldy_private.rule_step); `derive` is tested against contracts/container/rule_vectors.json.
 */
import type { LocalDay, UnitState } from '../../types/container';

export const CONFIRM_MIN_HOURS = 20;
export const DUE_DAYS: readonly number[] = [5, 12, 25, 50];
export const EXAM_EVE_DAYS = 2;
export const EXAM_EVE_STALE_DAYS = 4;

export type UnitStatus = 'new' | 'learning' | 'started' | 'two_days' | 'due';

function notBuilt(name: string): never {
  throw new Error(`lib/containers/rule.${name}: not built yet (package D2)`);
}

export function emptyState(): UnitState {
  return { seen: 0, wrong: 0, firstDay: null, lastDay: null, seriesAt: null, seriesDay: null, twoDaysAt: null,
    namedAt: null, checks: 0, peekDay: null, wasTwoDays: false, cleanOkAt: null };
}
export function meetsRule(_seriesAt: number, _seriesDay: LocalDay, _at: number, _day: LocalDay): boolean { return notBuilt('meetsRule'); }
export function dueAt(_namedAt: number, _checks: number, _day: LocalDay, _examDay: LocalDay | null): number { return notBuilt('dueAt'); }
/** Status now and, for `started`, the moment it can count; for `two_days`, its due moment. */
export function derive(_state: UnitState, _now: number, _today: LocalDay, _examDay: LocalDay | null, _tz: string): { status: UnitStatus; from: number | null } { return notBuilt('derive'); }
export function inFigure(state: UnitState): boolean { return state.twoDaysAt !== null; }
