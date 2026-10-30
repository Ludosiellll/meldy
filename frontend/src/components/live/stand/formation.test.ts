import { describe, expect, it } from 'vitest';
import { LEAP_BACK_S, LEAP_HOLD_S, LEAP_OUT_S, LEAP_S, facing, leapAt, leapPoint, ringSpots } from './formation';

// the arena of «Встань на ответ» (world.ts): the floor 1560 × 720 from (20, 160), the stage at (800, 520)
const STAGE = { x: 800, y: 520 };
const FLOOR = { x0: 20, y0: 160, x1: 1580, y1: 880 };

describe('the class round the boss (formation.ts)', () => {
  it('gives every player a place on the floor, none hidden behind the boss, no two on one spot', () => {
    for (const n of [1, 5, 12, 30, 60]) {
      const spots = ringSpots(n, STAGE, FLOOR);
      expect(spots).toHaveLength(n);
      for (const s of spots) {
        expect(s.x).toBeGreaterThanOrEqual(FLOOR.x0 + 44);
        expect(s.x).toBeLessThanOrEqual(FLOOR.x1 - 44);
        expect(s.y).toBeGreaterThanOrEqual(FLOOR.y0 + 44);
        expect(s.y).toBeLessThanOrEqual(FLOOR.y1 - 44);
        expect(s.y < STAGE.y && Math.abs(s.x - STAGE.x) < 130).toBe(false);
        // clear of the boss on its stage
        expect(Math.hypot(s.x - STAGE.x, s.y - STAGE.y)).toBeGreaterThan(150);
      }
      expect(new Set(spots.map((s) => `${s.x},${s.y}`)).size).toBe(n);
    }
  });

  it('fills the front first: the first player stands straight in front of the boss, the next ones beside', () => {
    const spots = ringSpots(12, STAGE, FLOOR);
    expect(spots[0].x).toBe(STAGE.x);
    expect(spots[0].y).toBeGreaterThan(STAGE.y);
    // a small class stands in front of the boss, where the camera sees it
    expect(spots.slice(0, 7).every((s) => s.y >= STAGE.y)).toBe(true);
  });

  it('keeps the places of the first players when more join', () => {
    expect(ringSpots(20, STAGE, FLOOR).slice(0, 8)).toEqual(ringSpots(8, STAGE, FLOOR));
  });

  it('a hit leaps out to the boss, holds, and comes back to its place', () => {
    expect(leapAt(-0.1)).toEqual({ k: 0, z: 0, done: false });
    expect(leapAt(LEAP_OUT_S / 2).k).toBeGreaterThan(0.5);
    expect(leapAt(LEAP_OUT_S / 2).z).toBeGreaterThan(40);
    expect(leapAt(LEAP_OUT_S + LEAP_HOLD_S / 2)).toEqual({ k: 1, z: 0, done: false });
    const back = leapAt(LEAP_OUT_S + LEAP_HOLD_S + LEAP_BACK_S / 2);
    expect(back.k).toBeGreaterThan(0);
    expect(back.k).toBeLessThan(1);
    expect(leapAt(LEAP_S + 0.01)).toEqual({ k: 0, z: 0, done: true });
  });

  it('a leap stops short of the boss and faces it', () => {
    const spot = { x: 800, y: 700 };
    expect(leapPoint(spot, STAGE, 0)).toEqual(spot);
    const at = leapPoint(spot, STAGE, 1);
    expect(at.x).toBe(800);
    expect(at.y).toBe(640);
    expect(leapPoint(STAGE, STAGE, 1)).toEqual(STAGE);
    // facing: 0 is +y (towards the viewer); a player in front of the boss looks back up the map
    expect(facing(spot, STAGE)).toBeCloseTo(Math.PI);
    expect(facing({ x: 600, y: 520 }, STAGE)).toBeCloseTo(Math.PI / 2);
  });
});
