import { describe, expect, it } from 'vitest';
import vectorsRaw from '../../../../contracts/container/rule_vectors.json?raw';
import type { LearningEvent } from '../../api/learning';
import { CONFIRM_MIN_HOURS as ORAL_CONFIRM_MIN_HOURS, meetsRule as oralMeetsRule } from '../learning/readiness';
import {
  DUE_DAYS as ORAL_DUE_DAYS, EXAM_EVE_DAYS as ORAL_EXAM_EVE_DAYS, EXAM_EVE_STALE_DAYS as ORAL_EXAM_EVE_STALE_DAYS, lineStatus, localDayOf,
} from '../exams/cheatSheet';
import type { UnitState } from '../../types/container';
import {
  CONFIRM_MIN_HOURS, DUE_DAYS, EXAM_EVE_DAYS, EXAM_EVE_STALE_DAYS, countableFrom, derive, dueAt, emptyState, inFigure, isOpenError,
  isSeen, meetsRule,
} from './rule.ts';
import { sqlStep } from './__fixtures__/sqlRule.ts';
import { localDay, midnightAfter } from './time.ts';

interface VectorState extends UnitState { right: number; itemRev: number; lastResult: 'right' | 'wrong' | 'dont_know' | null; twoDaysDay: string | null }
interface VectorEvent { at: number; day: string; rev: number; step: string; retry: boolean; misclick: boolean; result: 'right' | 'wrong' | 'dont_know'; due_before: number | null; state: VectorState }
interface VectorCase { id: string; name: string; exam_day: string | null; events: VectorEvent[] }
interface Vectors { tz: string; constants: { confirm_min_hours: number; due_days: number[]; exam_eve_days: number; exam_eve_stale_days: number }; derive: string; cases: VectorCase[] }

const V = JSON.parse(vectorsRaw) as Vectors;
const H = 3_600_000;
const DAY = 86_400_000;

function unit(st: VectorState): UnitState {
  return { seen: st.seen, wrong: st.wrong, firstDay: st.firstDay, lastDay: st.lastDay, seriesAt: st.seriesAt, seriesDay: st.seriesDay,
    twoDaysAt: st.twoDaysAt, namedAt: st.namedAt, checks: st.checks, peekDay: st.peekDay, wasTwoDays: st.wasTwoDays, cleanOkAt: st.cleanOkAt };
}

describe('constants: the same rule as the oral code', () => {
  it('equals readiness.ts and cheatSheet.ts', () => {
    expect(CONFIRM_MIN_HOURS).toBe(ORAL_CONFIRM_MIN_HOURS);
    expect([...DUE_DAYS]).toEqual([...ORAL_DUE_DAYS]);
    expect(EXAM_EVE_DAYS).toBe(ORAL_EXAM_EVE_DAYS);
    expect(EXAM_EVE_STALE_DAYS).toBe(ORAL_EXAM_EVE_STALE_DAYS);
  });

  it('equals the database (rule_vectors.json)', () => {
    expect(V.constants).toEqual({ confirm_min_hours: CONFIRM_MIN_HOURS, due_days: [...DUE_DAYS], exam_eve_days: EXAM_EVE_DAYS, exam_eve_stale_days: EXAM_EVE_STALE_DAYS });
  });

  it('meetsRule agrees with the oral meetsRule', () => {
    const ev = (at: number, day: string) => ({ created_at: new Date(at).toISOString(), local_date: day } as LearningEvent);
    const a = Date.UTC(2026, 9, 9, 20, 0);
    const cases: Array<[number, string, number, string]> = [
      [a, '2026-10-09', a + 16 * H, '2026-10-10'],
      [a, '2026-10-09', a + 20 * H, '2026-10-10'],
      [a, '2026-10-09', a + 20 * H - 1000, '2026-10-10'],
      [a, '2026-10-09', a + 23 * H, '2026-10-09'],
      [a, '2026-10-09', a + 40 * H, '2026-10-11'],
    ];
    for (const [t1, d1, t2, d2] of cases) expect(meetsRule(t1, d1, t2, d2)).toBe(oralMeetsRule(ev(t1, d1), ev(t2, d2)));
  });

  it('dueAt agrees with the cheat sheet, the eve rule included', () => {
    const named = (at: number) => ({ id: String(at), created_at: new Date(at).toISOString(), local_date: localDayOf(at), material_id: null,
      kind: 'oral_point', item_key: 'q1:p1', correct: true, score: null, confidence: null, source_ids: [], session_id: null, payload: {} } as LearningEvent);
    const t1 = Date.UTC(2026, 9, 1, 12, 0);
    const t2 = t1 + DAY; // erased: another day, 24 hours later
    for (const [examDate, nowAt] of [['2026-11-30', t2 + 6 * DAY], ['2026-10-08', t2 + 4 * DAY + H], ['2026-10-07', t2 + 4 * DAY + H], ['2026-10-12', t2 + 3 * DAY]] as const) {
      const status = lineStatus([named(t1), named(t2)], nowAt, { examDate });
      expect(status.dueAt, examDate).not.toBeNull();
      expect(dueAt(t2, 0, localDayOf(nowAt), examDate)).toBe(Date.parse(status.dueAt as string));
    }
  });
});

describe('dueAt and countableFrom', () => {
  const named = Date.UTC(2026, 9, 10, 18, 0);
  it('waits 5, 12, 25, then 50 days, and 50 again after the third check', () => {
    expect([0, 1, 2, 3, 4, 7].map((c) => (dueAt(named, c, '2026-10-10', null) - named) / DAY)).toEqual([5, 12, 25, 50, 50, 50]);
  });
  it('0–2 days before the date: 4 days after the last naming at the latest', () => {
    expect((dueAt(named, 1, '2026-10-26', '2026-10-28') - named) / DAY).toBe(4);
    expect((dueAt(named, 1, '2026-10-28', '2026-10-28') - named) / DAY).toBe(4);
    expect((dueAt(named, 1, '2026-10-25', '2026-10-28') - named) / DAY).toBe(12);
    expect((dueAt(named, 0, '2026-10-29', '2026-10-28') - named) / DAY).toBe(5);
    expect((dueAt(named, 0, '2026-10-12', '2026-10-13') - named) / DAY).toBe(4);
  });
  it('a started series counts from max(20 h, the next local day), and after a peek today from tomorrow', () => {
    const tz = 'Europe/Minsk';
    const at23 = Date.UTC(2026, 9, 9, 20, 0); // 23:00
    expect(countableFrom(at23, '2026-10-09', null, '2026-10-10', tz)).toBe(at23 + 20 * H);
    const at3 = Date.UTC(2026, 9, 9, 0, 0); // 03:00: +20 h is 23:00 the same day
    expect(countableFrom(at3, '2026-10-09', null, '2026-10-09', tz)).toBe(midnightAfter('2026-10-09', tz));
    expect(countableFrom(at23, '2026-10-09', '2026-10-10', '2026-10-10', tz)).toBe(midnightAfter('2026-10-10', tz));
  });
});

describe('derive', () => {
  const tz = 'Europe/Minsk';
  it('names each status', () => {
    expect(derive(emptyState(), 0, '2026-10-10', null, tz)).toEqual({ status: 'new', from: null });
    const t = Date.UTC(2026, 9, 9, 18, 0);
    const started = sqlStep(emptyState(), { at: t, day: '2026-10-09', correct: true }, null).state;
    expect(derive(started, t + H, '2026-10-09', null, tz)).toEqual({ status: 'started', from: t + 20 * H });
    const missed = sqlStep(started, { at: t + 30 * H, day: '2026-10-11', correct: false }, null).state;
    expect(derive(missed, t + 31 * H, '2026-10-11', null, tz).status).toBe('learning');
    const two = sqlStep(started, { at: t + 24 * H, day: '2026-10-10', correct: true }, null).state;
    expect(derive(two, t + 25 * H, '2026-10-10', null, tz)).toEqual({ status: 'two_days', from: t + 24 * H + 5 * DAY });
    expect(derive(two, t + 24 * H + 5 * DAY, '2026-10-15', null, tz).status).toBe('due');
    const misclickOnly = sqlStep(emptyState(), { at: t, day: '2026-10-09', correct: false, misclick: true }, null).state;
    expect(derive(misclickOnly, t, '2026-10-09', null, tz).status).toBe('learning');
  });

  it(`agrees with the database on every clean right answer of rule_vectors.json (${V.cases.length} cases)`, () => {
    // The procedure under the file's "derive" key (the same as pkg-a's replay_rule.ts).
    expect(V.derive).toMatch(/^How to test derive with these vectors/);
    let checked = 0;
    const bad: string[] = [];
    for (const c of V.cases) {
      let prev: UnitState | null = null;
      let rev: number | null = null;
      for (const e of c.events) {
        if (rev !== e.rev) { prev = null; rev = e.rev; }
        const clean = e.result === 'right' && !e.retry;
        if (prev && clean && prev.peekDay !== e.day && !(prev.lastDay !== null && e.day < prev.lastDay)) {
          const d = derive(prev, e.at, e.day, c.exam_day, V.tz);
          const expect_ = d.status === 'started' ? ((d.from as number) <= e.at ? 'two_days' : 'too_early')
            : d.status === 'due' ? 'check' : d.status === 'two_days' ? 'early' : 'start';
          checked += 1;
          if (expect_ !== e.step) bad.push(`${c.id}@${e.at}: derive ${d.status} → ${expect_}, database ${e.step}`);
        }
        prev = unit(e.state);
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });

  it('reads «ошибок сейчас» and «видели» exactly as the database counts them', () => {
    let n = 0;
    for (const c of V.cases) for (const e of c.events) {
      const u = unit(e.state);
      expect(isOpenError(u), `${c.id}@${e.at}`).toBe(e.state.lastResult === 'wrong' || e.state.lastResult === 'dont_know');
      expect(isSeen(u)).toBe(e.state.firstDay !== null);
      expect(inFigure(u)).toBe(e.state.twoDaysAt !== null);
      n += 1;
    }
    expect(n).toBeGreaterThan(2000);
  });
});

describe('the test-only mirror of the database rule (__fixtures__/sqlRule.ts)', () => {
  it('replays every vector: the same step and the same state, field by field', () => {
    const bad: string[] = [];
    let events = 0;
    for (const c of V.cases) {
      let s = emptyState();
      let rev: number | null = null;
      for (const e of c.events) {
        events += 1;
        if (rev !== e.rev) { s = emptyState(); rev = e.rev; }
        const r = sqlStep(s, { at: e.at, day: e.day, correct: e.result === 'right', retry: e.retry, misclick: e.misclick }, c.exam_day);
        s = r.state;
        const want = unit(e.state);
        if (r.step !== e.step) bad.push(`${c.id}@${e.at}: step ${r.step} vs ${e.step}`);
        for (const key of Object.keys(want) as Array<keyof UnitState>) {
          if (s[key] !== want[key]) bad.push(`${c.id}@${e.at}: ${key} ${String(s[key])} vs ${String(want[key])}`);
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
    expect(events).toBe(V.cases.reduce((sum, c) => sum + c.events.length, 0));
  });

  it('uses the vectors\' zone for the local days it was given', () => {
    expect(V.tz).toBe('Europe/Minsk');
    const first = V.cases[0].events[0];
    expect(localDay(first.at, V.tz)).toBe(first.day);
  });
});
