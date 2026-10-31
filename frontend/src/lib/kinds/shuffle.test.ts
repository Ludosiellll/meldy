import { describe, expect, it } from 'vitest';
import { neverInOrder, rightOrderOf } from './shuffle';

describe('the order a session shows', () => {
  it('never puts an order question in the right order', () => {
    for (let i = 0; i < 300; i += 1) {
      const order = neverInOrder(2 + (i % 4), `seed-${i}`);
      expect(order.every((value, index) => value === index)).toBe(false);
      expect([...order].sort()).toEqual(order.map((_, k) => k));
    }
  });
  it('is the same for the same seed', () => {
    expect(neverInOrder(5, 'a')).toEqual(neverInOrder(5, 'a'));
    expect(rightOrderOf(4, 'a')).toEqual(rightOrderOf(4, 'a'));
    expect([...rightOrderOf(4, 'b')].sort()).toEqual([0, 1, 2, 3]);
  });
});
