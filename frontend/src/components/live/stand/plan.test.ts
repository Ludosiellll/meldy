import { describe, expect, it } from 'vitest';
import { F_GHOST, F_ICE, ZONE_SHIFT, type StandState } from '../../../lib/live/move';
import { FALL_S, FloorShow, RISE_S, changeOf, easeOutBack, fallFrame, fastestName, tally, timerFace, type FallPlan, type FloorStep } from './plan';
import { COLLAPSE, dropHeight } from '../../../lib/live/three/arenaPlan';

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

describe('the floor between the stomp and its return, on any frame rate', () => {
  // the stand arena's numbers: the clock boss's blow 0.85 s after its jump, the whole gap down ~1.3 s after the blow,
  // the room's `floor: up` 4 s after its result (which comes ~0.4 s after the jump)
  const JUMP = 10;
  const IMPACT = JUMP + 0.85;
  const DOWN_BY = IMPACT + 1.3;
  const UP = JUMP + 0.4 + 4;

  /**
   * The projector frame by frame on the kit's clock (real time, as the kit runs now): a frame every `gap` seconds from
   * `phase`; the room's messages land between frames (the reveal at JUMP + 0.4, the `up` at `up`). Per frame: when it
   * is drawn, whether the floor is down in it, and what FloorShow said.
   */
  function play(gap: number, phase = 0, up = UP, reveal = JUMP + 0.4, downBy = DOWN_BY) {
    const floor = new FloorShow();
    let dropped = false;
    let upSent = false;
    let back = Infinity;
    let early = 0;
    const frames: { at: number; down: boolean; act: FloorStep['act'] }[] = [];
    for (let at = phase; at < up + 3 * gap + 6; at += gap) {
      if (!dropped && reveal <= at) {
        dropped = true;
        floor.drop(downBy);
      }
      if (!upSent && up <= at) {
        upSent = true;
        if (floor.up()) back = up;
      }
      const step = floor.frame(at);
      if (step.act === 'hurry') early += step.by;
      if (step.act === 'restore') back = at;
      frames.push({ at, down: dropped && at < back && at >= downBy - early, act: step.act });
    }
    return frames;
  }

  it('on time (60 fps) every frame from the gap to the room’s `up` shows the floor down, and it comes back at once', () => {
    const frames = play(1 / 60);
    const between = frames.filter((f) => f.at >= DOWN_BY && f.at < UP);
    expect(between.length).toBeGreaterThan(100);
    expect(between.every((f) => f.down)).toBe(true);
    expect(frames.filter((f) => f.at >= UP).some((f) => f.down)).toBe(false);
    expect(frames.some((f) => f.act !== 'none')).toBe(false);
  });

  it('at 1–2 fps (the projector of the live check) the floor is down in the frames of its down time, nothing waits', () => {
    for (const gap of [0.5, 0.7, 1]) {
      for (const phase of [0, 0.13, 0.37]) {
        const frames = play(gap, phase);
        const down = frames.filter((f) => f.down);
        expect(down.length, `${gap} ${phase}`).toBeGreaterThanOrEqual(2);
        expect(frames.filter((f) => f.at >= DOWN_BY && f.at < UP).every((f) => f.down)).toBe(true);
        expect(frames.some((f) => f.act === 'hurry' || f.act === 'restore')).toBe(false);
      }
    }
  });

  it('frames slower than the down time: the `up` waits, one frame shows the floor down, the next brings it back', () => {
    for (const gap of [2.5, 3, 5, 8, 20]) {
      for (const phase of [0, 0.4, 1.9]) {
        const frames = play(gap, phase);
        const down = frames.filter((f) => f.down);
        expect(down.length, `${gap} ${phase}`).toBeGreaterThanOrEqual(1);
        const last = frames.indexOf(down[down.length - 1]);
        expect(frames.slice(last + 1).some((f) => f.down)).toBe(false);
        // a frame that came before the gap while `up` waited moved the drop to itself
        const hurry = frames.find((f) => f.act === 'hurry');
        if (hurry) expect(hurry.down).toBe(true);
        // when the `up` had to wait, the frame right after the down one restores
        if (frames.some((f) => f.act === 'restore')) expect(frames[last + 1].act).toBe('restore');
      }
    }
  });

  it('a hurry moves the drop exactly to the frame: by = downBy − the frame’s time', () => {
    const floor = new FloorShow();
    floor.drop(12);
    expect(floor.frame(10)).toEqual({ act: 'none' });
    expect(floor.up()).toBe(false);
    expect(floor.waits).toBe(true);
    expect(floor.frame(10.5)).toEqual({ act: 'hurry', by: 1.5 });
    expect(floor.frame(11)).toEqual({ act: 'restore' });
    expect(floor.waits).toBe(false);
    expect(floor.frame(11.5)).toEqual({ act: 'none' });
  });

  it('a floor already drawn down comes back with the `up` at once; with no drop planned the `up` never waits', () => {
    const floor = new FloorShow();
    expect(floor.up()).toBe(true);
    floor.drop(12);
    expect(floor.frame(12.2)).toEqual({ act: 'none' });
    expect(floor.up()).toBe(true);
    expect(floor.frame(12.4)).toEqual({ act: 'none' });
  });

  it('a reveal seen late (down long ago) and its `up` before any frame: one frame down, then back', () => {
    const floor = new FloorShow();
    floor.drop(100 - 10 + 1.3);
    expect(floor.up()).toBe(false);
    expect(floor.frame(100)).toEqual({ act: 'none' });
    expect(floor.frame(101)).toEqual({ act: 'restore' });
  });

  it('a new question clears a waiting `up`', () => {
    const floor = new FloorShow();
    floor.drop(12);
    expect(floor.up()).toBe(false);
    floor.reset();
    expect(floor.waits).toBe(false);
    expect(floor.frame(11)).toEqual({ act: 'none' });
  });

  it('the old slow-motion clock (at most 0.1 s a frame) never reached the gap before the `up` at 2 fps', () => {
    // what the live check saw: the room's `up` is real time, the kit's clock crawled 0.1 s a frame
    let kit = 0;
    let kitAtJump: number | null = null;
    let reachedGap = false;
    for (let wall = 0; wall < UP; wall += 0.5) {
      kit += 0.1;
      if (wall >= JUMP && kitAtJump === null) kitAtJump = kit;
      if (kitAtJump !== null && kit - kitAtJump >= DOWN_BY - JUMP) reachedGap = true;
    }
    expect(kitAtJump).not.toBeNull();
    expect(reachedGap).toBe(false);
    // the real-time clock reaches it with time to spare
    expect(play(0.5).some((f) => f.down)).toBe(true);
  });
});

describe('a fallen character, frame by frame', () => {
  const plan = (start = 10, tile = true): FallPlan => ({ start, rise: start + FALL_S, tile, drawn: false });

  it('waits on its shaking tile, drops with it, then climbs out as a ghost (60 fps)', () => {
    const f = plan();
    expect(fallFrame(f, 9.9)).toEqual({ pit: true, z: 0, falling: false });
    const mid = fallFrame(f, 10.4);
    expect(mid).toEqual({ pit: true, z: dropHeight(10.4, 10), falling: true });
    expect(fallFrame(f, 10.74)).toMatchObject({ pit: true, falling: true });
    expect(fallFrame(f, 10.75 + RISE_S / 2)).toEqual({ pit: false, climb: 0.5 });
    expect(f.rise).toBe(10 + FALL_S);
  });

  it('falls by itself when its tile stays (a phone that went away), never below the pit', () => {
    const f = plan(10, false);
    const x = fallFrame(f, 10.3);
    expect(x).toMatchObject({ pit: true, falling: true });
    expect(x.pit && x.z).toBeCloseTo(-650 * 0.3 * 0.3, 6);
    expect(fallFrame({ ...plan(10, false), rise: 99 }, 12)).toEqual({ pit: true, z: COLLAPSE.gone, falling: true });
  });

  it('at any frame rate every fallen character is drawn falling at least once, deep enough to see, then climbs', () => {
    for (const gap of [1 / 60, 0.5, 0.8, 1, 2, 5]) {
      for (const phase of [0, 0.21, 0.66]) {
        const f = plan();
        const frames = [];
        for (let at = 9 + phase; at < 16; at += gap) frames.push({ at, ...fallFrame(f, at) });
        const falling = frames.filter((x) => x.pit && x.falling);
        expect(falling.length, `${gap} ${phase}`).toBeGreaterThanOrEqual(1);
        expect(falling.every((x) => x.pit && x.z <= 0)).toBe(true);
        expect(falling.some((x) => x.pit && x.z < -40)).toBe(true);
        // a frame that would have skipped the whole fall shows it ~70 units down (the tile, by then, maybe gone)
        if (!frames.some((x) => x.at >= 10 && x.at < 10 + FALL_S)) expect(falling.some((x) => x.pit && x.z <= -60 && x.z >= -80)).toBe(true);
        // after the fall: climbing, never back in the pit
        const last = frames.lastIndexOf(falling[falling.length - 1]);
        expect(frames.slice(last + 1).every((x) => !x.pit)).toBe(true);
        expect(frames.slice(last + 1).every((x) => !x.pit && x.climb > 0)).toBe(true);
      }
    }
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
