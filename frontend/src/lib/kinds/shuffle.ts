/**
 * The order a session shows a new kind in (release 48): an order question's items never in the right order (that
 * would give the key away), a match question's right items shuffled. Seeded as the options of a session
 * (lib/containers/session optionOrder), so a reload shows the same.
 */
import { optionOrder } from '../containers/session';

/** A shuffled arrangement of n items that is never the identity (n ≥ 2): the first one moves to the end when it is. */
export function neverInOrder(n: number, seed: string): number[] {
  const order = optionOrder(n, false, [], seed);
  if (n >= 2 && order.every((value, index) => value === index)) return [...order.slice(1), order[0]];
  return order;
}

/** The order a match question lists its right items in. */
export function rightOrderOf(count: number, seed: string): number[] {
  return optionOrder(count, false, [], `${seed}:r`);
}
