import { describe, expect, it } from 'vitest';
import { handPoints, lcg, pointBounds, smoothPath, taperedOutline } from './handStroke';

describe('handStroke', () => {
  it('draws the same line for the same seed', () => {
    expect(handPoints(10, 400, 263, 100, { rise: 1.1 })).toEqual(handPoints(10, 400, 263, 100, { rise: 1.1 }));
    expect(taperedOutline(handPoints(0, 200, 20, 131))).toBe(taperedOutline(handPoints(0, 200, 20, 131)));
    expect(handPoints(10, 400, 263, 100)).not.toEqual(handPoints(10, 400, 263, 131));
  });

  it('uses the Park–Miller sequence', () => {
    const next = lcg(42);
    expect(next()).toBeCloseTo((42 * 16807) / 2147483647, 12);
  });

  it('keeps the jitter within a pencil width of the line and ends with a flick', () => {
    const pts = handPoints(0, 320, 50, 7, { rise: 1.3, flick: true });
    const n = Math.max(6, Math.round(320 / 16));
    expect(pts).toHaveLength(n + 1 + 2);
    for (const [, y] of pts.slice(0, n + 1)) expect(Math.abs(y - 50)).toBeLessThan(2.5);
    const [lx, ly] = pts[n];
    expect(pts[n + 1]).toEqual([lx + 5, ly + 1]);
    expect(pts[n + 2]).toEqual([lx + 3, ly + 3.2]);
  });

  it('builds a closed, tapered outline from Catmull-Rom curves', () => {
    const pts = handPoints(0, 120, 10, 3);
    const outline = taperedOutline(pts);
    expect(outline.startsWith('M')).toBe(true);
    expect(outline.endsWith('Z')).toBe(true);
    expect(outline).toContain('L');
    expect((smoothPath(pts).match(/C/g) ?? []).length).toBe(pts.length - 1);
  });

  it('measures padded bounds snapped to whole pixels', () => {
    expect(pointBounds([[[10.2, 5], [20.6, 7.5]]], 3)).toEqual({ x: 7, y: 2, w: 17, h: 9 });
    expect(pointBounds([], 3)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
