/**
 * The small math every reel scene animates with (the landing's, the guide's, the sign-in reels'). Everything on a
 * stage is a pure function of one number, the reel time in milliseconds, so the same moment always looks the same:
 * on the page, in tests and when frames are exported.
 */

export const STAGE_W = 1920;
export const STAGE_H = 1080;

// ---------------------------------------------------------------------------------------------
// Math

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** 0 before `start`, 1 after `start + dur`, linear in between. */
export function seg(t: number, start: number, dur: number): number {
  if (dur <= 0) return t >= start ? 1 : 0;
  return clamp((t - start) / dur);
}

export const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/** A CSS cubic-bezier as a function of progress (the same curve the browser draws). */
export function bezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  const slopeX = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  return (p: number) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let u = p;
    for (let i = 0; i < 8; i += 1) {
      const error = sampleX(u) - p;
      if (Math.abs(error) < 1e-6) break;
      const slope = slopeX(u);
      if (Math.abs(slope) < 1e-6) break;
      u -= error / slope;
    }
    if (u < 0 || u > 1 || Math.abs(sampleX(u) - p) > 1e-4) {
      let lo = 0;
      let hi = 1;
      u = p;
      for (let i = 0; i < 30; i += 1) {
        if (sampleX(u) < p) lo = u;
        else hi = u;
        u = (lo + hi) / 2;
      }
    }
    return sampleY(u);
  };
}

export const ease = {
  linear: (p: number) => clamp(p),
  /** The brand curve: cubic-bezier(.16, 1, .3, 1), quick start and a long soft landing. */
  brand: bezier(0.16, 1, 0.3, 1),
  out: (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(p))),
  in: (p: number) => clamp(p) ** 3,
  inOut: (p: number) => {
    const x = clamp(p);
    return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  },
  sine: (p: number) => -(Math.cos(Math.PI * clamp(p)) - 1) / 2,
  /** Overshoots a little and settles: for things that pop in. */
  back: (p: number) => {
    const x = clamp(p);
    const c1 = 1.7;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  },
  /** A damped spring from 0 to 1 (overshoot about 12 %). */
  spring: (p: number) => {
    const x = clamp(p);
    if (x >= 1) return 1;
    return 1 - Math.exp(-6 * x) * Math.cos(10 * x);
  },
};

/** A smooth 0 → 1 → 0 hump over [start, start + dur]. */
export function pulse(t: number, start: number, dur: number): number {
  const p = seg(t, start, dur);
  return Math.sin(Math.PI * p);
}

/** Deterministic pseudo-random numbers (mulberry32): the same seed gives the same particles. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plural of a Russian noun after a number: forms for 1, 2–4 and 5+. */
export function plural(value: number, forms: readonly [string, string, string]): string {
  const n = Math.abs(value) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}
