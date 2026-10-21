/** The battle's ice in the arena (internal/ice.ts): how a block grows round a character and how it breaks. */
import { describe, expect, it } from 'vitest';
import { breakScale, formScale } from './internal/ice';

describe('the ice', () => {
  it('a block grows from small past its size and settles at it', () => {
    expect(formScale(0)).toBeCloseTo(0.25);
    expect(formScale(1)).toBeCloseTo(1);
    const peak = Math.max(...Array.from({ length: 21 }, (_, i) => formScale(i / 20)));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.25);
  });

  it('a breaking block swells for a moment, then shrinks to nothing', () => {
    expect(breakScale(0)).toBe(1);
    expect(breakScale(0.25)).toBeCloseTo(1.15);
    expect(breakScale(1)).toBeCloseTo(0);
    expect(breakScale(2)).toBeCloseTo(0);
  });
});
