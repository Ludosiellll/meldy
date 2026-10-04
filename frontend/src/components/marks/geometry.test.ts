import { describe, expect, it } from 'vitest';
import { handPoints, lcg, smoothPath, taperedOutline } from '../landing/handStroke';
import {
  MARK_KINDS,
  MARK_PAD,
  arrow,
  foldSeed,
  sample,
  seedFrom,
  seededRandom,
  shape,
  tapered,
  type MarkKind,
} from './geometry';

const BOXES: Record<MarkKind, [number, number]> = {
  tick: [25, 21],
  dtick: [25, 21],
  cup: [24, 14],
  dash: [25, 10],
  dot: [12, 12],
  cross: [20, 21],
  ring: [30, 32],
  oval: [90, 40],
  under: [120, 6],
  wave: [24, 6],
  bracket: [14, 40],
  brace: [14, 40],
  vline: [8, 60],
  strike: [128, 48],
};

function numbersOf(d: string): number[] {
  return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

describe('seeds', () => {
  it('folds any number into the LCG range, so zero and negative seeds still draw', () => {
    expect(foldSeed(0)).toBe(1);
    expect(foldSeed(-5)).toBe(6);
    expect(foldSeed(5.9)).toBe(6);
    expect(foldSeed(2147483646)).toBe(1);
    expect(foldSeed(Number.NaN)).toBe(1);
  });

  it('uses the landing LCG sequence exactly', () => {
    const ours = seededRandom(411);
    const landing = lcg(412);
    for (let i = 0; i < 20; i += 1) expect(ours()).toBe(landing());
  });

  it('derives a stable seed from an exam id and a position', () => {
    const a = seedFrom('7d0c2f6e-exam', 17);
    expect(seedFrom('7d0c2f6e-exam', 17)).toBe(a);
    expect(seedFrom('7d0c2f6e-exam', 18)).not.toBe(a);
    expect(seedFrom('other-exam', 17)).not.toBe(a);
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(2147483646);
    expect(Number.isInteger(a)).toBe(true);
  });
});

describe('shape: one deterministic vocabulary', () => {
  it.each(MARK_KINDS.map((kind) => [kind]))('%s gives the same paths for the same seed and different ones for another seed', (kind) => {
    const [w, h] = BOXES[kind];
    const first = shape(kind, w, h, 1234);
    const again = shape(kind, w, h, 1234);
    const other = shape(kind, w, h, 98765);
    expect(first.length).toBeGreaterThan(0);
    expect(again).toEqual(first);
    expect(other.map((path) => path.d)).not.toEqual(first.map((path) => path.d));
  });

  it.each(MARK_KINDS.map((kind) => [kind]))('%s stays inside its box plus the padding and has no NaN', (kind) => {
    const [w, h] = BOXES[kind];
    for (const seed of [1, 77, 4242, 2_000_000_000]) {
      for (const path of shape(kind, w, h, seed)) {
        expect(path.d).toMatch(/^M/);
        expect(path.d).toMatch(/Z$/);
        expect(path.d).not.toMatch(/NaN|Infinity/);
        const numbers = numbersOf(path.d);
        for (let i = 0; i + 1 < numbers.length; i += 2) {
          expect(numbers[i]).toBeGreaterThanOrEqual(-MARK_PAD);
          expect(numbers[i]).toBeLessThanOrEqual(w + MARK_PAD);
          expect(numbers[i + 1]).toBeGreaterThanOrEqual(-MARK_PAD);
          expect(numbers[i + 1]).toBeLessThanOrEqual(h + MARK_PAD);
        }
      }
    }
  });

  it('draws the dashed tick in three pieces and the cross in two strokes', () => {
    expect(shape('dtick', 25, 21, 9)).toHaveLength(3);
    expect(shape('cross', 20, 21, 9)).toHaveLength(2);
  });

  it('gives every stroke a pencil path for the draw-on animation; the dot is a blot without one', () => {
    for (const kind of MARK_KINDS) {
      const [w, h] = BOXES[kind];
      for (const path of shape(kind, w, h, 5)) {
        if (kind === 'dot') expect(path.center).toBeNull();
        else expect(path.center).toMatch(/^M/);
      }
    }
  });

  it('builds the underline on the landing handPoints and the outline on taperedOutline', () => {
    const [path] = shape('under', 120, 6, 31);
    const points = handPoints(1, 119, 3.6, foldSeed(31), { rise: 1.2 });
    expect(path.center).toBe(smoothPath(points));
    expect(path.d).toBe(taperedOutline(points, 2.2, 0.6));
  });

  it('makes the dash the boldest mark', () => {
    const widthOf = (d: string) => {
      const ys = numbersOf(d).filter((_, index) => index % 2 === 1);
      return Math.max(...ys) - Math.min(...ys);
    };
    const dash = shape('dash', 25, 10, 3)[0];
    const lighter = shape('dash', 25, 10, 3, { weight: 1.2 })[0];
    expect(widthOf(dash.d)).toBeGreaterThan(widthOf(lighter.d));
  });
});

describe('the strike across a replaced figure («60 %» of peak 1)', () => {
  /** The pencil's own path (center line) as points. */
  function centerPoints(seed: number, w = 128, h = 48): Array<[number, number]> {
    const [path] = shape('strike', w, h, seed);
    const numbers = numbersOf(path.center ?? '');
    const points: Array<[number, number]> = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
    return points;
  }

  it('is one rising diagonal across the whole box: from low on the left to high on the right', () => {
    for (const seed of [1, 7, 311, 98765, 2_000_000_000]) {
      const paths = shape('strike', 128, 48, seed);
      expect(paths).toHaveLength(1);
      const points = centerPoints(seed);
      const first = points[0];
      const last = points[points.length - 1];
      // Across the whole width (the caller's box already holds the overshoot past the figure).
      expect(first[0]).toBeLessThan(4);
      expect(last[0]).toBeGreaterThan(124);
      // Rising: it starts in the lower part and ends in the upper part — never a horizontal
      // mid-height line (a 0 reads «θ») and never a short slash (a 0 reads «ø»).
      expect(first[1]).toBeGreaterThan(48 * 0.75);
      expect(last[1]).toBeLessThan(48 * 0.25);
      const rise = first[1] - last[1];
      expect(rise / (last[0] - first[0])).toBeGreaterThan(0.2);
    }
  });

  it('is the same stroke for the same seed and another one for another seed', () => {
    expect(shape('strike', 128, 48, 4242)).toEqual(shape('strike', 128, 48, 4242));
    expect(shape('strike', 128, 48, 4242)[0].d).not.toBe(shape('strike', 128, 48, 4243)[0].d);
  });
});

describe('strokes', () => {
  it('equals the landing outline when complete and cuts it while still being drawn', () => {
    const points = sample([[0, 0], [40, 6]], 12, { step: 4 });
    expect(tapered(points, 2.7, 0.7)).toBe(taperedOutline(points, 2.7, 0.7));
    const half = tapered(points, 2.7, 0.7, 0.5);
    expect(half.length).toBeLessThan(tapered(points, 2.7, 0.7).length);
  });

  it('keeps every anchor of a polyline (a tick keeps its corner)', () => {
    const points = sample([[0, 0], [10, 10], [30, 0]], 3, { step: 5, amp: 0 });
    expect(points[0]).toEqual([0, 0]);
    expect(points).toContainEqual([10, 10]);
    expect(points[points.length - 1]).toEqual([30, 0]);
  });

  it('draws an arrow with a head only when the shaft is complete', () => {
    expect(arrow([0, 0], [100, 20], 8)).toHaveLength(3);
    expect(arrow([0, 0], [100, 20], 8, { upto: 0.4 })).toHaveLength(1);
    expect(arrow([0, 0], [100, 20], 8)).toEqual(arrow([0, 0], [100, 20], 8));
  });
});
