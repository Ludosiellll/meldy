/**
 * Which name tags to leave out so that none covers another (the kit's tags, internal/tags.ts; reusable by any screen
 * that draws labels over a crowd). Pure and allocation-free: the caller owns the arrays and reuses them each frame.
 *
 * Boxes are screen rectangles [x0, x1) × [y0, y1). Tags are placed in the order of `rank` (smaller first); a tag that
 * would overlap one already placed is left out (`hidden[i] = 1`). Tags with `hidden[i] = 1` on entry (behind the
 * camera) stay out and block nothing.
 */
export interface DeclutterBuffers {
  x0: Float32Array;
  x1: Float32Array;
  y0: Float32Array;
  y1: Float32Array;
  rank: Float32Array;
  /** Scratch: the placing order and the placed tags. */
  order: Int32Array;
  placed: Int32Array;
  /** In: 1 for tags that cannot be shown at all. Out: 1 for every tag left out. */
  hidden: Uint8Array;
}

/** Leaves out the tags that would overlap earlier ones; returns how many are shown. */
export function declutter(n: number, b: DeclutterBuffers): number {
  const { x0, x1, y0, y1, rank, order, placed, hidden } = b;
  // insertion sort by rank: n is a classroom (≤ 64), nearly sorted from frame to frame
  for (let i = 0; i < n; i++) {
    let j = i;
    while (j > 0 && rank[order[j - 1]] > rank[i]) {
      order[j] = order[j - 1];
      j--;
    }
    order[j] = i;
  }
  let m = 0;
  for (let o = 0; o < n; o++) {
    const i = order[o];
    if (hidden[i]) continue;
    let clear = true;
    for (let q = 0; q < m; q++) {
      const p = placed[q];
      if (x0[i] < x1[p] && x1[i] > x0[p] && y0[i] < y1[p] && y1[i] > y0[p]) {
        clear = false;
        break;
      }
    }
    if (clear) placed[m++] = i;
    else hidden[i] = 1;
  }
  return m;
}
