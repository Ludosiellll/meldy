import { describe, expect, it } from 'vitest';
import type { HostState, RosterRow } from '../../../lib/live/types';
import { battleRows, fastestHit, frozenPids, tapRevealOf, tapTimerFace } from './battle';
import { revealPlan } from './mixed';

const row = (player_id: string, name: string, joined_at: string, frozen = false): RosterRow => ({
  player_id,
  name,
  look: { body: 'round', colour: 'blue', eyes: 'round', hat: 'none' },
  dmg: 0,
  right: 0,
  streak: 0,
  frozen,
  joined_at,
  answered: false,
});

const ROSTER = [row('p-b', 'Боря', '2026-10-30T10:00:02Z', true), row('p-a', 'Аня', '2026-10-30T10:00:01Z'), row('p-c', 'Вика', '2026-10-30T10:00:02Z')];

const result = {
  qi: 2,
  key: 1,
  counts: [1, 2, 0],
  right: 2,
  healed: 0,
  phase_changed: null,
  hits: [
    { player_id: 'p-c', dmg: 141, hp_after: 1859 },
    { player_id: 'p-a', dmg: 120, hp_after: 1739 },
  ],
  frozen_now: ['p-b'],
  thawed: [],
};

describe('the battle on the 3D projector (battle.ts)', () => {
  it('stands the class in joining order, equal times by player', () => {
    expect(battleRows(ROSTER).map((r) => r.name)).toEqual(['Аня', 'Боря', 'Вика']);
    expect(battleRows(ROSTER)[0]).toEqual({ pid: 'p-a', name: 'Аня', look: ROSTER[1].look });
  });

  it('knows who is frozen', () => {
    expect([...frozenPids(ROSTER)]).toEqual(['p-b']);
  });

  it('plays a button question as a movement round is played: the hits in the stored order, HP before them', () => {
    const s = { result, boss: { hp: 1739, hp_max: 2000, phase: 0 as const, defeated: false } } as unknown as HostState;
    const tr = tapRevealOf(s)!;
    expect(tr.pids).toEqual(['p-c', 'p-a']);
    expect(tr.res.hits).toEqual([
      [0, 141, 1859],
      [1, 120, 1739],
    ]);
    const plan = revealPlan(tr.res, 950);
    expect(plan.from).toBe(2000);
    expect(plan.hits.map((h) => [h.id, h.hp])).toEqual([
      [0, 1859],
      [1, 1739],
    ]);
    expect(plan.hits[0].at).toBe(950);
    expect(plan.news).toBeNull();
    expect(tapRevealOf({ result: null, boss: s.boss })).toBeNull();
  });

  it('names the fastest hit (the first one stored)', () => {
    expect(fastestHit({ result: result as unknown as HostState['result'], roster: ROSTER })).toEqual({ name: 'Вика', dmg: 141 });
    expect(fastestHit({ result: { ...result, hits: [] } as unknown as HostState['result'], roster: ROSTER })).toBeNull();
  });

  it('times a button question: 3-2-1, the seconds, the hot last three, stopped when everyone answered', () => {
    const opens = 10_000;
    const closes = 30_000;
    expect(tapTimerFace(opens, closes, 7_500)).toEqual({ sec: 3, ready: true, hot: false, left: 1 });
    expect(tapTimerFace(opens, closes, 10_000)).toEqual({ sec: 20, ready: false, hot: false, left: 1 });
    expect(tapTimerFace(opens, closes, 20_000)).toMatchObject({ sec: 10, hot: false, left: 0.5 });
    expect(tapTimerFace(opens, closes, 28_000)).toMatchObject({ sec: 2, hot: true });
    expect(tapTimerFace(opens, closes, 31_000)).toMatchObject({ sec: 0, hot: false, left: 0 });
    // everyone answered at 14 s: the seconds stay, not hot
    expect(tapTimerFace(opens, closes, 29_000, 24_000)).toMatchObject({ sec: 6, hot: false });
  });
});
