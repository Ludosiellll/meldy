/**
 * «Дуэль»: the numbers of lib/duel/rules.ts — the battle's phase 0 for each seat, the winner, the polls. The rehearsal
 * checks the same function against the SQL on a grid of 576 answers (supabase/tests/local/live_duel_mirror.*); these are
 * the worked cases of docs/live/DUEL.md §3 and §7.
 */
import { describe, expect, it } from 'vitest';
import { damage } from '../live/rules';
import {
  AWAY_MS,
  BACKOFF_MAX_MS,
  POLL_PROXY_MS,
  SLOWEST_CALL_MS,
  backoffMs,
  duelPoints,
  freshSeat,
  pollMs,
  scoreSeat,
  winnerOf,
} from './rules';

const SPEED = { timeS: 20, speed: true, calm: false };
const CALM = { timeS: 20, speed: false, calm: true };

describe('the points of one answer: the battle in phase 0', () => {
  it('right: the damage by time and streak; the streak grows', () => {
    expect(duelPoints(0, false, 1, 1000, SPEED)).toEqual({ dmg: 98, correct: true, thawed: false, frozen: false, streak: 1 });
    expect(duelPoints(2, false, 1, 1000, SPEED).dmg).toBe(damage(1000, 20, 3, true));
  });
  it('a frozen seat thaws on a right answer: no points, streak 1', () => {
    expect(duelPoints(4, true, 1, 0, SPEED)).toEqual({ dmg: 0, correct: true, thawed: true, frozen: false, streak: 1 });
  });
  it('wrong freezes (not «Без спешки»); no answer freezes nobody', () => {
    expect(duelPoints(3, false, 0, 500, SPEED)).toEqual({ dmg: 0, correct: false, thawed: false, frozen: true, streak: 0 });
    expect(duelPoints(3, false, 0, 500, CALM).frozen).toBe(false);
    expect(duelPoints(3, false, null, null, SPEED)).toEqual({ dmg: 0, correct: false, thawed: false, frozen: false, streak: 0 });
    expect(duelPoints(3, true, null, null, SPEED).frozen).toBe(true);
  });
  it('partly right: a share of the points, rounded as the SQL; nothing while frozen', () => {
    expect(duelPoints(0, false, 0.5, 19999, CALM).dmg).toBe(50);
    expect(duelPoints(1, false, 0.5, 3000, SPEED).dmg).toBe(Math.floor(damage(3000, 20, 2, true) * 0.5 + 0.5));
    expect(duelPoints(1, true, 0.5, 3000, SPEED)).toMatchObject({ dmg: 0, frozen: true, streak: 0 });
  });
  it('a seat adds the time; no answer adds the whole time', () => {
    const a = scoreSeat(freshSeat(), { share: 1, elapsedMs: 1000 }, SPEED).seat;
    const b = scoreSeat(a, null, SPEED).seat;
    expect(a).toMatchObject({ dmg: 98, right: 1, streak: 1, best: 1, timeMs: 1000 });
    expect(b).toMatchObject({ dmg: 98, right: 1, streak: 0, best: 1, timeMs: 21000 });
  });
});

describe('the winner', () => {
  it('more points, then more right answers; else a draw', () => {
    expect(winnerOf({ dmg: 300, right: 2 }, { dmg: 200, right: 3 })).toBe(1);
    expect(winnerOf({ dmg: 200, right: 2 }, { dmg: 200, right: 3 })).toBe(2);
    expect(winnerOf({ dmg: 200, right: 2 }, { dmg: 200, right: 2 })).toBeNull();
  });
});

describe('the polls', () => {
  it('1 s while timed, 1.5 s in the lobby, 3 s after the end; about 3 s on the /sb route', () => {
    expect(pollMs('play', 'direct')).toBe(1000);
    expect(pollMs('wait', null)).toBe(1000);
    expect(pollMs('lobby', 'direct')).toBe(1500);
    expect(pollMs('final', 'direct')).toBe(3000);
    expect(pollMs('play', 'proxy')).toBe(POLL_PROXY_MS);
    expect(pollMs('lobby', 'proxy')).toBe(3000);
    expect(pollMs('final', 'proxy')).toBe(5000);
  });
  it('a 429 backs off 3 s more each time, at most 9 s, Retry-After when shorter', () => {
    expect([1, 2, 3, 4].map((n) => backoffMs(n, null))).toEqual([3000, 6000, 9000, 9000]);
    expect(backoffMs(3, 2)).toBe(2000);
  });
  it('the server away threshold stays well above the slowest poll and its back-off', () => {
    expect(SLOWEST_CALL_MS).toBe(5000 + BACKOFF_MAX_MS);
    expect(AWAY_MS).toBeGreaterThanOrEqual(SLOWEST_CALL_MS + 5000);
  });
});
