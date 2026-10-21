import { describe, expect, it } from 'vitest';
import { QUALITY_LEVELS } from '../../../../lib/live/three/quality';
import { GRACE_S, LIGHT_LEVEL, PHONE_LEVELS, PhoneGovernor } from './quality';

function feed(g: PhoneGovernor, ms: number, seconds: number): void {
  for (let t = 0; t < seconds * 1000; t += ms) g.push(ms);
}

describe('the phone keeps its frames smooth in 3D', () => {
  it('has no outlines at its best and ends at a light 3D level, never a flat one', () => {
    expect(QUALITY_LEVELS[PHONE_LEVELS[0].kit].outlines).toBe(false);
    for (let i = 1; i < PHONE_LEVELS.length; i++) {
      const a = PHONE_LEVELS[i - 1];
      const b = PHONE_LEVELS[i];
      // each step is cheaper: a lower kit level or a frame cap
      expect(b.kit > a.kit || (b.kit === a.kit && b.fps > 0 && (a.fps === 0 || b.fps < a.fps))).toBe(true);
    }
    const light = PHONE_LEVELS[LIGHT_LEVEL];
    expect(QUALITY_LEVELS[light.kit].scale).toBeLessThanOrEqual(0.6);
    expect(light.fps).toBe(30);
  });

  it('stays at its best on a phone that keeps up (60 or 120 frames a second)', () => {
    const g = new PhoneGovernor();
    feed(g, 16.7, 30);
    expect(g.level).toBe(0);
    const fast = new PhoneGovernor();
    feed(fast, 8.3, 30);
    expect(fast.level).toBe(0);
  });

  it('does not judge a slow start: the first seconds of the arena do not count', () => {
    const g = new PhoneGovernor();
    // the models and the first frames: 200 ms frames for the grace period
    feed(g, 200, GRACE_S - 0.1);
    feed(g, 16.7, 20);
    expect(g.level).toBe(0);
    // each question begins a new grace
    g.begin();
    feed(g, 120, GRACE_S - 0.2);
    feed(g, 16.7, 10);
    expect(g.level).toBe(0);
  });

  it('a hitch now and then (a garbage collection) does not lower it', () => {
    const g = new PhoneGovernor();
    for (let i = 0; i < 3000; i++) g.push(i % 20 === 0 ? 180 : 16.7);
    expect(g.level).toBe(0);
  });

  it('a weak phone reaches the light level in seconds and stays in 3D there', () => {
    const g = new PhoneGovernor();
    let t = 0;
    while (g.level < LIGHT_LEVEL && t < 20) {
      g.push(55);
      t += 0.055;
    }
    expect(g.level).toBe(LIGHT_LEVEL);
    expect(t).toBeLessThan(GRACE_S + 6);
    // at the light level a phone drawing its 30 frames on time is calm: it tries one level up after a while
    let s = 0;
    while (g.level === LIGHT_LEVEL && s < 12) {
      g.push(33.4);
      s += 0.0334;
    }
    expect(g.level).toBe(LIGHT_LEVEL - 1);
    expect(s).toBeGreaterThan(6);
    // still too slow there: back down, and the next try waits longer than the first
    feed(g, 40, 3);
    expect(g.level).toBe(LIGHT_LEVEL);
    s = 0;
    while (g.level === LIGHT_LEVEL && s < 40) {
      g.push(33.4);
      s += 0.0334;
    }
    expect(s).toBeGreaterThan(12);
  });

  it('a pinned phone never moves (a recording at the best level, QA of the light level)', () => {
    const best = new PhoneGovernor(0, true);
    feed(best, 80, 20);
    expect(best.level).toBe(0);
    const light = new PhoneGovernor(LIGHT_LEVEL, true);
    feed(light, 8, 30);
    expect(light.level).toBe(LIGHT_LEVEL);
  });
});
