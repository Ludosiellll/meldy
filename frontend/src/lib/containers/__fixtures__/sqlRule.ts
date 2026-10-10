/**
 * TEST ONLY: a mirror of meldy_private.rule_step and the envelope record_test_answers_for puts around it, so the
 * plan's multi-day tests can answer questions the way the database would. rule.test.ts checks it event by event and
 * field by field against contracts/container/rule_vectors.json. The app never runs it: state transitions live only
 * in SQL (spec decision 10).
 */
import type { LocalDay, UnitState } from '../../../types/container.ts';
import { dueAt, meetsRule } from '../rule.ts';

export type SqlStep = 'miss' | 'misclick' | 'training' | 'start' | 'too_early' | 'two_days' | 'check' | 'early' | 'late';

export interface SqlAnswer {
  at: number; // server ms
  day: LocalDay; // the device's local day
  correct: boolean; // false = wrong or «Не знаю»
  retry?: boolean;
  misclick?: boolean;
}

export function sqlStep(prev: UnitState, a: SqlAnswer, examDay: LocalDay | null): { state: UnitState; step: SqlStep } {
  const s: UnitState = { ...prev };
  if (s.lastDay !== null && a.day < s.lastDay) return { state: s, step: 'late' };
  const later = () => { if (s.lastDay === null || a.day > s.lastDay) s.lastDay = a.day; };
  if (a.misclick && !a.correct) {
    s.peekDay = a.day;
    if (s.firstDay === null) s.firstDay = a.day;
    later();
    return { state: s, step: 'misclick' };
  }
  const retry = Boolean(a.retry) && s.firstDay !== null;
  if (!retry) {
    s.seen += 1;
    if (s.firstDay === null) s.firstDay = a.day;
    later();
  }
  if (!a.correct) {
    s.wrong += 1;
    if (s.twoDaysAt !== null) s.wasTwoDays = true;
    s.seriesAt = null;
    s.seriesDay = null;
    s.twoDaysAt = null;
    s.namedAt = null;
    s.checks = 0;
    s.peekDay = a.day;
    return { state: s, step: 'miss' };
  }
  if (retry || s.peekDay === a.day) return { state: s, step: 'training' };
  const named = s.namedAt;
  s.cleanOkAt = a.at;
  s.namedAt = a.at;
  if (s.twoDaysAt !== null) {
    if (a.at >= dueAt(named ?? s.twoDaysAt, s.checks, a.day, examDay)) {
      s.checks += 1;
      return { state: s, step: 'check' };
    }
    return { state: s, step: 'early' };
  }
  if (s.seriesAt === null || s.seriesDay === null) {
    s.seriesAt = a.at;
    s.seriesDay = a.day;
    return { state: s, step: 'start' };
  }
  if (meetsRule(s.seriesAt, s.seriesDay, a.at, a.day)) {
    s.twoDaysAt = a.at;
    s.checks = 0;
    return { state: s, step: 'two_days' };
  }
  return { state: s, step: 'too_early' };
}
