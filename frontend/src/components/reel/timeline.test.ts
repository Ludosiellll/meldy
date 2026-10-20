import { describe, expect, it } from 'vitest';
import { ReelClock } from './clock';
import { ease, plural, rng, seg } from './timeline';

describe('the reel math', () => {
  it('eases like the CSS curves it stands for', () => {
    expect(ease.brand(0)).toBe(0);
    expect(ease.brand(1)).toBe(1);
    // cubic-bezier(.16, 1, .3, 1) is past 90 % of the way at 40 % of the time.
    expect(ease.brand(0.4)).toBeGreaterThan(0.9);
    expect(ease.inOut(0.5)).toBeCloseTo(0.5, 5);
    expect(ease.back(0.7)).toBeGreaterThan(1);
    expect(seg(50, 100, 200)).toBe(0);
    expect(seg(200, 100, 200)).toBe(0.5);
    expect(seg(400, 100, 200)).toBe(1);
  });

  it('draws the same particles for the same seed', () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(rng(43)()).not.toBe(rng(42)());
  });

  it('declines Russian nouns after numbers', () => {
    const forms = ['вопрос', 'вопроса', 'вопросов'] as const;
    expect([1, 2, 5, 11, 21, 24, 40].map((n) => plural(n, forms))).toEqual(['вопрос', 'вопроса', 'вопросов', 'вопросов', 'вопрос', 'вопроса', 'вопросов']);
  });
});

describe('ReelClock', () => {
  function manual() {
    let now = 0;
    const queue = new Map<number, (time: number) => void>();
    let next = 1;
    const scheduler = {
      request: (callback: (time: number) => void) => {
        queue.set(next, callback);
        return next++;
      },
      cancel: (id: number) => {
        queue.delete(id);
      },
      now: () => now,
    };
    const step = (ms: number) => {
      now += ms;
      const callbacks = Array.from(queue.values());
      queue.clear();
      for (const callback of callbacks) callback(now);
    };
    return { scheduler, step };
  }

  it('advances with frames while playing, loops at the end, and stops on pause', () => {
    const { scheduler, step } = manual();
    const clock = new ReelClock(1000, scheduler);
    const seen: number[] = [];
    clock.addFrame((t) => seen.push(t));
    expect(seen).toEqual([0]);
    clock.play();
    step(16);
    step(16);
    expect(clock.time).toBe(32);
    clock.seek(990);
    step(16);
    expect(clock.time).toBe(6);
    clock.pause();
    step(16);
    expect(clock.time).toBe(6);
    expect(clock.isPlaying).toBe(false);
  });

  it('moves one short step after a long pause between frames, never a jump', () => {
    const { scheduler, step } = manual();
    const clock = new ReelClock(10_000, scheduler);
    clock.play();
    step(5000);
    expect(clock.time).toBe(64);
  });

  it('tells watchers about play, pause and seek, and clamps seeks to the reel', () => {
    const { scheduler } = manual();
    const clock = new ReelClock(1000, scheduler);
    let calls = 0;
    clock.watch(() => {
      calls += 1;
    });
    clock.play();
    clock.seek(5000);
    clock.pause();
    expect(calls).toBe(3);
    expect(clock.time).toBe(1000);
  });
});
