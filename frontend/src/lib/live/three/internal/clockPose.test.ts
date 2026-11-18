import { describe, expect, it } from 'vitest';
import { GAITS, STRIKES, STRIKE_BLOW, STRIKE_S, mixPose, runPose, strikePose, whirl, type ClockPose } from './clockPose';

/** A pose as a flat list of its numbers. */
const flat = (p: ClockPose) => [p.y, p.z, p.rx, p.ry, p.rz, p.sx, p.sy, ...p.legs, ...p.lift, ...p.ax, ...p.ay, ...p.az];
/** The largest change of any number between two poses. */
const jump = (a: ClockPose, b: ClockPose) => Math.max(...flat(a).map((v, i) => Math.abs(v - flat(b)[i])));
const FRAME = 1 / 60;

describe('the clock «Дедлайн» in a chase: its poses', () => {
  it('each way of running is a smooth loop: no number jumps between two frames, over three seconds', () => {
    for (let gait = 0; gait < GAITS; gait += 1) {
      let worst = 0;
      for (let t = 0; t < 3; t += FRAME) worst = Math.max(worst, jump(runPose(gait, t), runPose(gait, t + FRAME)));
      // the fastest thing in a run is a leg at full swing or the fists thrown forward in a leap: a third of a radian a frame
      expect(worst, `gait ${gait}`).toBeLessThan(0.34);
    }
  });

  it('the three ways differ where the whole room sees it: how far it leans, how high it goes, where its fists are', () => {
    const over = (gait: number, pick: (p: ClockPose) => number) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let t = 0; t < 2; t += FRAME) {
        const v = pick(runPose(gait, t));
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return { lo, hi };
    };
    // the sprint leans into the run all the time; the stomp stays upright; the leaps go three times higher than a step
    expect(over(0, (p) => p.rx).lo).toBeGreaterThan(0.2);
    expect(over(1, (p) => p.rx).hi).toBeLessThan(0.2);
    expect(over(2, (p) => p.y).hi).toBeGreaterThan(3 * over(0, (p) => p.y).hi);
    // the stomp keeps its fists over its head, the sprint at its sides; only the stomp rings all the way
    expect(over(1, (p) => p.az[0]).lo).toBeGreaterThan(1);
    expect(over(0, (p) => p.az[0]).hi).toBeLessThan(0);
    expect([runPose(1, 0.4).ring, runPose(0, 0.11).ring < 0.5]).toEqual([1, true]);
    // a foot is pulled up only while it comes forward, never both at once in the sprint
    for (let t = 0; t < 1; t += FRAME) {
      const p = runPose(0, t);
      expect(Math.min(p.lift[0], p.lift[1])).toBe(0);
    }
  });

  it('a blow starts as standing and ends as standing, without a jump in it; it comes down at STRIKE_BLOW', () => {
    for (let kind = 0; kind < STRIKES; kind += 1) {
      const start = strikePose(kind, 0);
      const end = strikePose(kind, STRIKE_S);
      expect([start.y, start.z, start.rx, start.sy, start.ring], `kind ${kind}`).toEqual([0, 0, 0, 1, 0]);
      expect(Math.abs(end.z) + Math.abs(end.rx) + Math.abs(end.y) + Math.abs(end.sy - 1), `kind ${kind}`).toBeLessThan(0.02);
      let worst = 0;
      for (let k = 0; k < STRIKE_S; k += FRAME) worst = Math.max(worst, jump(strikePose(kind, k), strikePose(kind, k + FRAME)));
      // the blow itself is the fastest move of all: the body goes from its wind-up to the blow in four frames
      expect(worst, `kind ${kind}`).toBeLessThan(0.9);
      // before the blow it is wound up away from the prey (or in the air), after it it is over it and the bells ring
      const before = strikePose(kind, STRIKE_BLOW - 0.03);
      const after = strikePose(kind, STRIKE_BLOW + 0.1);
      expect(after.z, `kind ${kind}`).toBeGreaterThan(before.z);
      expect([before.ring, after.ring], `kind ${kind}`).toEqual([0, 1]);
    }
    // the pounce is in the air before it lands; the ram goes furthest forward
    expect(strikePose(0, STRIKE_BLOW - 0.03).y).toBeGreaterThan(0.9);
    expect(strikePose(2, STRIKE_BLOW + 0.1).z).toBeGreaterThan(strikePose(0, STRIKE_BLOW + 0.1).z);
  });

  it('the whirl goes round exactly once and only for the whirl; the other fist turns it the other way', () => {
    expect([whirl(0, 0.3, false), whirl(2, 0.3, false), whirl(1, 0, false)]).toEqual([0, 0, 0]);
    expect(whirl(1, STRIKE_S, false)).toBeCloseTo(-2 * Math.PI, 6);
    expect(whirl(1, STRIKE_S, true)).toBeCloseTo(2 * Math.PI, 6);
    // it coils back first, then turns one way only
    expect(whirl(1, 0.15, false)).toBeGreaterThan(0.2);
    let last = whirl(1, 0.3, false);
    for (let k = 0.3; k < STRIKE_S; k += FRAME) {
      const now = whirl(1, k + FRAME, false);
      expect(now).toBeLessThanOrEqual(last + 1e-9);
      last = now;
    }
  });

  it('mixing two poses is a straight blend of every number', () => {
    const a = runPose(0, 0.1);
    const b = strikePose(0, STRIKE_BLOW + 0.1);
    flat(mixPose(a, b, 0)).forEach((v, i) => expect(v).toBeCloseTo(flat(a)[i], 9));
    flat(mixPose(a, b, 1)).forEach((v, i) => expect(v).toBeCloseTo(flat(b)[i], 9));
    const half = flat(mixPose(a, b, 0.5));
    flat(a).forEach((v, i) => expect(half[i]).toBeCloseTo((v + flat(b)[i]) / 2, 9));
  });
});
