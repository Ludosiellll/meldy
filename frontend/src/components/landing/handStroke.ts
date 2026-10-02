/**
 * Pencil marks drawn by hand: a seeded jittery centre line and a filled, tapered outline
 * around it (0.7 → 2.7 → 0.7 px). Pure and deterministic, so the same seed draws the same
 * line on the page, on the flying strip and on the card.
 */
export type Pt = [number, number];

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** Park–Miller LCG; the hero and its tests rely on this exact sequence. */
export function lcg(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function handPoints(x0: number, x1: number, y: number, seed: number, o: { rise?: number; flick?: boolean } = {}): Pt[] {
  const rnd = lcg(seed);
  const n = Math.max(6, Math.round((x1 - x0) / 16));
  const ph1 = rnd() * 6;
  const ph2 = rnd() * 6;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    pts.push([x0 + (x1 - x0) * s, y - (o.rise ?? 1.3) * s + 0.55 * Math.sin(ph1 + s * 5.2) + 0.25 * Math.sin(ph2 + s * 13) + (rnd() - 0.5) * 0.3]);
  }
  if (o.flick) {
    const [lx, ly] = pts[pts.length - 1];
    pts.push([lx + 5, ly + 1], [lx + 3, ly + 3.2]);
  }
  return pts;
}

/** Catmull-Rom through the points, as cubic Bézier segments. */
export function smoothPath(p: Pt[]): string {
  let d = `M${p[0][0].toFixed(2)} ${p[0][1].toFixed(2)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] ?? p[i];
    const b = p[i];
    const c = p[i + 1];
    const e = p[i + 2] ?? c;
    d += `C${(b[0] + (c[0] - a[0]) / 6).toFixed(2)} ${(b[1] + (c[1] - a[1]) / 6).toFixed(2)} ${(c[0] - (e[0] - b[0]) / 6).toFixed(2)} ${(c[1] - (e[1] - b[1]) / 6).toFixed(2)} ${c[0].toFixed(2)} ${c[1].toFixed(2)}`;
  }
  return d;
}

/** Filled pencil stroke: width follows sin^0.55 from wMin to wMax and back. */
export function taperedOutline(p: Pt[], wMax = 2.7, wMin = 0.7): string {
  const L: Pt[] = [];
  const R: Pt[] = [];
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[Math.max(0, i - 1)];
    const b = p[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const w = wMin + (wMax - wMin) * Math.pow(Math.sin(Math.PI * clamp((i / (n - 1)) * 0.92 + 0.04)), 0.55);
    L.push([p[i][0] - (ty * w) / 2, p[i][1] + (tx * w) / 2]);
    R.push([p[i][0] + (ty * w) / 2, p[i][1] - (tx * w) / 2]);
  }
  return smoothPath(L) + 'L' + smoothPath(R.reverse()).slice(1) + 'Z';
}

/** Axis-aligned bounds of several point lists, grown by `pad` and snapped outwards to whole px. */
export function pointBounds(lists: Pt[][], pad: number) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const list of lists) {
    for (const [x, y] of list) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.floor(x0 - pad);
  const y = Math.floor(y0 - pad);
  return { x, y, w: Math.ceil(x1 + pad) - x, h: Math.ceil(y1 + pad) - y };
}
