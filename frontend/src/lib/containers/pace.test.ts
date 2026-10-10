import { describe, expect, it } from 'vitest';
import type { PlanInputsWire } from '../../types/container';
import { DEFAULT_PACE, PACE_PRIOR_ANSWERS, SLOW_NEW_FACTOR, SLOW_REV_FACTOR, blend, paceFrom } from './pace.ts';

type Rows = PlanInputsWire['pace'];

describe('pace (Concept 2 §3.8)', () => {
  it('defaults: 35 s new, 20 s familiar, +10 s wrong, 12 s retry, oral 60 / 150 s, miss rates 0.5 / 0.35 / 0.15 / 0.15 / 0.2', () => {
    expect(DEFAULT_PACE).toEqual({
      tNew: 35, tRev: 20, tWrong: 10, tRetry: 12, tSC: 60, tAC: 150,
      pWrong: { new: 0.5, relearn: 0.35, confirm: 0.15, check: 0.15, final: 0.2 },
    });
    expect(35 * SLOW_NEW_FACTOR).toBeCloseTo(45);
    expect(20 * SLOW_REV_FACTOR).toBeCloseTo(25);
  });

  it('a subject without answers gets the defaults (a copy, not the shared object)', () => {
    const [p] = paceFrom([], 1);
    expect(p).toEqual(DEFAULT_PACE);
    p.pWrong.new = 0.9;
    expect(DEFAULT_PACE.pWrong.new).toBe(0.5);
    expect(paceFrom([], 3)).toHaveLength(3);
  });

  it('blends own medians with the defaults: (n·own + 20·default) / (n + 20)', () => {
    expect(PACE_PRIOR_ANSWERS).toBe(20);
    expect(blend(20, 20, 35)).toBeCloseTo(27.5);
    expect(blend(20, 180, 35)).toBeCloseTo((180 * 20 + 20 * 35) / 200);
    expect(blend(20, 0, 35)).toBe(35);
    expect(blend(Number.NaN, 5, 35)).toBe(35);
    const rows: Rows = [
      { subject: 0, cls: 'new_floor', n: 30, median_ms: 25_000, p_wrong: 0.4 },
      { subject: 0, cls: 'new_fill', n: 10, median_ms: 45_000, p_wrong: 0.6 },
      { subject: 0, cls: 'confirm', n: 20, median_ms: 12_000, p_wrong: 0.1 },
      { subject: 0, cls: 'check', n: 20, median_ms: 16_000, p_wrong: 0.05 },
    ];
    const [p] = paceFrom(rows, 1);
    const ownNew = (30 * 25 + 10 * 45) / 40; // 30 s
    expect(p.tNew).toBeCloseTo((40 * ownNew + 20 * 35) / 60);
    const ownRev = (20 * 12 + 20 * 16) / 40; // 14 s
    expect(p.tRev).toBeCloseTo((40 * ownRev + 20 * 20) / 60);
    expect(p.tSC).toBe(60);
    expect(p.tAC).toBe(150);
    expect(p.tWrong).toBe(10);
    expect(p.tRetry).toBe(12);
  });

  it('own miss rates apply once a class rests on 20 answers', () => {
    const rows: Rows = [
      { subject: 1, cls: 'new_floor', n: 12, median_ms: 30_000, p_wrong: 0.3 },
      { subject: 1, cls: 'new_fill', n: 8, median_ms: 30_000, p_wrong: 0.4 },
      { subject: 1, cls: 'relearn', n: 19, median_ms: 20_000, p_wrong: 0.9 },
      { subject: 1, cls: 'final', n: 40, median_ms: 20_000, p_wrong: 0.05 },
    ];
    const [a, b] = paceFrom(rows, 2);
    expect(a).toEqual(DEFAULT_PACE);
    expect(b.pWrong.new).toBeCloseTo((12 * 0.3 + 8 * 0.4) / 20);
    expect(b.pWrong.relearn).toBe(0.35);
    expect(b.pWrong.final).toBe(0.05);
    expect(b.pWrong.confirm).toBe(0.15);
  });

  it('ignores free sessions and rows of other subjects', () => {
    const rows: Rows = [
      { subject: 0, cls: 'free', n: 200, median_ms: 5_000, p_wrong: 0.9 },
      { subject: 3, cls: 'new_floor', n: 200, median_ms: 5_000, p_wrong: 0.9 },
    ];
    expect(paceFrom(rows, 1)).toEqual([DEFAULT_PACE]);
  });
});
