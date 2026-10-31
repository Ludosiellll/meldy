import { describe, expect, it } from 'vitest';
import { damage, liveShare, partialDamage } from './rules';
import { questionKind, rightKeys, teamsOf } from './types';

// The same cases as backend/tests/test_live_kinds.py and supabase/tests/live_kinds_teams.sql (the SQL's live_share).
describe('liveShare (CONTRACT §3, several right answers)', () => {
  it.each([
    [[0, 2], [0, 2], 1],
    [[2], [0, 2], 0.5],
    [[0, 1], [0, 2], 0],
    [[1, 3, 4], [0, 2], 0],
    [[1, 3, 0], [1, 3, 5], 1 / 3],
    [[0, 1, 2, 3, 4, 5], [1, 3, 5], 0],
    [[3, 1], [1, 3, 5], 2 / 3],
    [[1, 1], [1, 3], 0.5],
  ])('%j of %j → %s', (picks, keys, want) => {
    expect(liveShare(picks, keys)).toBe(want);
  });

  it('a partial hit is the damage times the share, rounded', () => {
    expect(partialDamage(1000, 20, 1, true, 0.5)).toBe(49);
    expect(partialDamage(0, 20, 3, true, 1 / 3)).toBe(50);
    expect(partialDamage(20000, 20, 1, true, 0.5)).toBe(25);
    expect(partialDamage(0, 10, 1, false, 2 / 3)).toBe(67);
    expect(partialDamage(1234, 20, 2, true, 1)).toBe(damage(1234, 20, 2, true));
  });
});

describe('the kinds on the wire', () => {
  it('a question without kind is one right option', () => {
    expect(questionKind({})).toBe('single');
    expect(questionKind({ kind: 'multiple' })).toBe('multiple');
    expect(questionKind({ kind: 'short' })).toBe('short');
    expect(questionKind({ kind: 'number' })).toBe('single');
    expect(questionKind(null)).toBe('single');
  });

  it('the right options of a result', () => {
    expect(rightKeys({ key: 2 })).toEqual([2]);
    expect(rightKeys({ key: 0, keys: [0, 3] })).toEqual([0, 3]);
    expect(rightKeys({ key: -1, forms: ['Москва'] } as { key: number })).toEqual([]);
    expect(rightKeys({ key: 1, keys: ['x'] })).toEqual([1]);
    expect(rightKeys(null)).toEqual([]);
  });

  it('the teams of a state', () => {
    expect(teamsOf({})).toBeNull();
    expect(teamsOf({ teams: [] })).toBeNull();
    expect(teamsOf({ teams: [{ team: 2, players: 3, dmg: 300, avg: 100, place: 1 }, null] })).toEqual([{ team: 2, players: 3, dmg: 300, avg: 100, place: 1 }]);
  });
});
