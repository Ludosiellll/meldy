import { describe, expect, it } from 'vitest';
import { F_GHOST, F_ICE, ZONE_SHIFT, type StandState } from '../../../lib/live/move';
import { changeOf, easeOutBack, fastestName, tally, timerFace } from './plan';

const base: StandState = {
  t: 'stand',
  k: 'state',
  phase: 'lobby',
  qi: -1,
  q_count: 4,
  players: 3,
  q: null,
  opens: null,
  closes: null,
  floor: 'up',
  res: null,
  top: null,
  acc: null,
};
const q = { text: 'Какая планета ближе всего к Солнцу?', options: ['Меркурий', 'Венера', 'Марс', 'Земля'] };
const countdown: StandState = { ...base, phase: 'countdown', qi: 0, q, opens: 10_000, closes: 25_000 };
const open: StandState = { ...countdown, phase: 'open' };
const res = { qi: 0, key: 0, counts: [2, 1, 0, 0], stood: 2, of: 3, fastest: { id: 7, pts: 980, ms: 600 }, fell: [9], back: [], at: 25_400, back_at: 29_400 };
const reveal: StandState = { ...open, phase: 'reveal', floor: 'down', res };
const floorUp: StandState = { ...reveal, floor: 'up' };

describe('the timer', () => {
  it('counts 3-2-1 before the open, then the seconds left from the room clock', () => {
    expect(timerFace(countdown, 7_100)).toMatchObject({ sec: 3, ready: true, hot: false });
    expect(timerFace(countdown, 9_050)).toMatchObject({ sec: 1, ready: true });
    expect(timerFace(open, 10_000)).toMatchObject({ sec: 15, ready: false, hot: false, left: 1 });
    expect(timerFace(open, 17_600)).toMatchObject({ sec: 8, hot: false });
    expect(timerFace(open, 17_600).left).toBeCloseTo(0.493, 2);
  });

  it('rings the last 3 s and stops at 0 (never below), even when the result is late', () => {
    expect(timerFace(open, 21_999).hot).toBe(false);
    expect(timerFace(open, 22_000)).toMatchObject({ sec: 3, hot: true });
    expect(timerFace(open, 26_000)).toMatchObject({ sec: 0, hot: true });
  });

  it('shows nothing without a question or before the room clock is known', () => {
    expect(timerFace(base, 1000).sec).toBeNull();
    expect(timerFace(open, null).sec).toBeNull();
    expect(timerFace(null, 1000).sec).toBeNull();
  });
});

describe('how a new state plays', () => {
  it('the stomp when the question closes as it happens', () => {
    expect(changeOf(open, reveal, 25_500)).toBe('stomp');
    expect(changeOf(countdown, reveal, 25_500)).toBe('stomp');
  });

  it('a reveal seen late (a reconnect or a reload) is drawn as it is: the floor already down', () => {
    expect(changeOf(open, reveal, 27_000)).toBe('down');
    expect(changeOf(null, reveal, 25_500)).toBe('down');
    expect(changeOf(reveal, reveal, 26_000)).toBe('still');
  });

  it('the floor comes back once; a new question lights the zones', () => {
    expect(changeOf(reveal, floorUp, 29_500)).toBe('up');
    expect(changeOf(floorUp, floorUp, 30_000)).toBe('still');
    expect(changeOf(base, countdown, 7_000)).toBe('question');
    expect(changeOf({ ...base, phase: 'leaderboard', qi: 0 }, { ...countdown, qi: 1 }, 40_000)).toBe('question');
    expect(changeOf(countdown, open, 10_000)).toBe('still');
  });
});

describe('the live counts from the snapshot flags', () => {
  const player = (zone: number | null, ghost = false) => ((zone === null ? 0 : zone + 1) << ZONE_SHIFT) | (ghost ? F_GHOST : 0);

  it('counts every player per zone (ghosts too), alive and ghosts apart; monsters left out', () => {
    const out = { counts: [] as number[], alive: 0, ghosts: 0 };
    tally([player(0), player(0), player(1, true), player(null), player(3), 1 /* a monster */], 4, out);
    expect(out).toEqual({ counts: [2, 1, 0, 1], alive: 4, ghosts: 1, iced: 0 });
  });

  it('a mixed game: the battle\'s ice counted apart (F_ICE), whatever the zone', () => {
    const out = { counts: [] as number[], alive: 0, ghosts: 0, iced: 0 };
    tally([player(0) | F_ICE, player(null) | F_ICE, player(1)], 4, out);
    expect(out).toEqual({ counts: [1, 1, 0, 0], alive: 3, ghosts: 0, iced: 2 });
  });

  it('a question with three options counts three zones (the fourth is closed)', () => {
    const out = { counts: [] as number[], alive: 0, ghosts: 0 };
    tally([player(3), player(2)], 3, out);
    expect(out.counts).toEqual([0, 0, 1]);
  });
});

it('names the fastest from the room roster, or nobody', () => {
  expect(fastestName(reveal, (id) => (id === 7 ? 'Дима' : null))).toEqual({ name: 'Дима', pts: 980 });
  expect(fastestName(reveal, () => null)).toBeNull();
  expect(fastestName({ ...reveal, res: { ...res, fastest: null } }, () => 'Дима')).toBeNull();
});

it('a ghost rises with a small bump at the end', () => {
  expect(easeOutBack(0)).toBeCloseTo(0);
  expect(easeOutBack(1)).toBeCloseTo(1);
  expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map(easeOutBack))).toBeGreaterThan(1);
});
