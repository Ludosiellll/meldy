import type * as THREE from 'three';

/** One reusable range per attribute: marking it each frame allocates nothing. */
const ranges = new WeakMap<THREE.BufferAttribute, { start: number; count: number }>();

/** Uploads only the first `items` elements of a per-instance attribute this frame (not the whole buffer). */
export function uploadFirst(attr: THREE.BufferAttribute, items: number): void {
  if (items <= 0) return;
  let range = ranges.get(attr);
  if (!range) {
    range = { start: 0, count: 0 };
    ranges.set(attr, range);
  }
  range.count = Math.min(attr.array.length, items * attr.itemSize);
  attr.updateRanges.length = 0;
  attr.updateRanges.push(range);
  attr.needsUpdate = true;
}
