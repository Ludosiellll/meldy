/**
 * Pencil marks of the interior: one deterministic vocabulary for the whole app (redesign spec 3.8).
 *
 * A port of the prototype's marks.js on top of the landing's hand-drawn stroke
 * (components/landing/handStroke.ts, imported and never edited): the same Park–Miller LCG, the
 * same wobble and the same tapered outline 0.7 → wMax → 0.7 px. Every mark is seeded, so the same
 * question gets the same mark on every render and in tests.
 *
 * Kinds and where they are used:
 * - tick: «есть в лекциях», a named rubric point; dtick: found only by words;
 * - cup (an open lower half of an ellipse): «частично», a point only mentioned;
 * - dash (the boldest mark, 3.4): «нет ни в одной лекции», a point not named;
 * - cross: said wrong; dot: being checked now;
 * - ring / under / wave around a question number: confirmed / засчитано, не подтверждено / не засчитано;
 * - under (per line of words): the words that matched; oval: «Засчитано»;
 * - strike: a figure crossed out by hand — one rising diagonal across the whole figure, past both
 *   ends («60 %» of peak 1). Never a horizontal mid-height line (it turns 0 into «θ») and never a
 *   short slash (it turns 0 into «ø»);
 * - brace / bracket: «об этом спросил экзаменатор»; vline: the selected line, down the margin;
 * - arrow: a diagram edge (reserve).
 * Blue pencil is Meldy; graphite is the student's own hand (only the chosen self-rating word).
 */
import { handPoints, lcg, smoothPath, taperedOutline, type Pt } from '../landing/handStroke';

export type { Pt };

export type MarkKind =
  | 'tick'
  | 'dtick'
  | 'cup'
  | 'dash'
  | 'dot'
  | 'cross'
  | 'ring'
  | 'oval'
  | 'under'
  | 'wave'
  | 'bracket'
  | 'brace'
  | 'vline'
  | 'strike';

export const MARK_KINDS: readonly MarkKind[] = [
  'tick',
  'dtick',
  'cup',
  'dash',
  'dot',
  'cross',
  'ring',
  'oval',
  'under',
  'wave',
  'bracket',
  'brace',
  'vline',
  'strike',
];

/** One filled piece of a mark. `center` is the pencil's path (it drives the draw-on mask); a shaded blob has none. */
export interface MarkPath {
  d: string;
  center: string | null;
}

/** Stroke weights of the spec's table (px at the mark's own size). */
export const MARK_WEIGHT = { base: 2.7, bold: 3.4 } as const;

/** Sizes of the marks on a sheet (spec 3.8); the number marks follow the text they sit on. */
export const MARK_SIZE: Record<'tick' | 'dtick' | 'cup' | 'dash' | 'dot' | 'cross' | 'brace' | 'bracket', { width: number; height: number }> = {
  tick: { width: 25, height: 21 },
  dtick: { width: 25, height: 21 },
  cup: { width: 24, height: 14 },
  dash: { width: 25, height: 10 },
  dot: { width: 12, height: 12 },
  cross: { width: 20, height: 21 },
  brace: { width: 14, height: 40 },
  bracket: { width: 14, height: 40 },
};

/** Padding of the SVG box around a mark: strokes may wobble past the nominal box. */
export const MARK_PAD = 6;

const SEED_SPAN = 2147483646;

/** A seed folded into 1 … 2^31 − 2: zero, negative or fractional seeds would stall the LCG. */
export function foldSeed(seed: number): number {
  const value = Number.isFinite(seed) ? Math.abs(Math.floor(seed)) : 0;
  return (value % SEED_SPAN) + 1;
}

/** The landing's LCG on a folded seed (the prototype's sequence exactly). */
export function seededRandom(seed: number): () => number {
  return lcg(foldSeed(seed));
}

/**
 * A stable seed from parts such as an exam id and a question position (FNV-1a over the joined
 * text). The same parts give the same mark on every render.
 */
export function seedFrom(...parts: Array<string | number | null | undefined>): number {
  const text = parts.map((part) => (part === null || part === undefined ? '' : String(part))).join(':');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return foldSeed(hash);
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Evenly spaced points along a polyline, every anchor kept (a tick keeps its corner), with the
 * landing's hand wobble across the direction of travel.
 */
export function sample(anchors: Pt[], seed: number, options: { step?: number; amp?: number } = {}): Pt[] {
  const step = options.step || 7;
  const amp = options.amp === undefined ? 1 : options.amp;
  const rnd = seededRandom(seed);
  const ph1 = rnd() * 6;
  const ph2 = rnd() * 6;
  let total = 0;
  const segments: Array<{ a: Pt; b: Pt; len: number; start: number }> = [];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i];
    const b = anchors[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segments.push({ a, b, len, start: total });
    total += len;
  }
  const points: Pt[] = [];
  segments.forEach((segment, k) => {
    const n = Math.max(2, Math.round(segment.len / step));
    for (let j = k === 0 ? 0 : 1; j <= n; j += 1) {
      const t = j / n;
      const x = segment.a[0] + (segment.b[0] - segment.a[0]) * t;
      const y = segment.a[1] + (segment.b[1] - segment.a[1]) * t;
      const s = (segment.start + segment.len * t) / (total || 1);
      const nx = -(segment.b[1] - segment.a[1]) / (segment.len || 1);
      const ny = (segment.b[0] - segment.a[0]) / (segment.len || 1);
      const w = amp * (0.55 * Math.sin(ph1 + s * 5.2) + 0.25 * Math.sin(ph2 + s * 13) + (rnd() - 0.5) * 0.3);
      points.push([x + nx * w, y + ny * w]);
    }
  });
  return points;
}

/**
 * Filled pencil stroke. With `upto` < 1 the stroke is cut where the pencil is now (a line still
 * being drawn); the full stroke is exactly the landing's taperedOutline.
 */
export function tapered(points: Pt[], wMax = 2.7, wMin = 0.7, upto = 1): string {
  const max = wMax || 2.7;
  const min = wMin || 0.7;
  if (upto >= 1) return taperedOutline(points, max, min);
  const left: Pt[] = [];
  const right: Pt[] = [];
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const w = min + (max - min) * Math.pow(Math.sin(Math.PI * clamp((i / (n - 1)) * 0.92 + 0.04, 0, 1)), 0.55);
    left.push([points[i][0] - (ty * w) / 2, points[i][1] + (tx * w) / 2]);
    right.push([points[i][0] + (ty * w) / 2, points[i][1] - (tx * w) / 2]);
  }
  const k = Math.max(2, Math.round(n * Math.max(0, upto)));
  const l = left.slice(0, k);
  const r = right.slice(0, k);
  return smoothPath(l) + 'L' + smoothPath(r.reverse()).slice(1) + 'Z';
}

/** An ellipse drawn by hand: starts at `a0`, goes round once plus an overshoot, the radius drifts. */
export function loop(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  seed: number,
  options: { a0?: number; turns?: number; drift?: number } = {},
): Pt[] {
  const rnd = seededRandom(seed);
  const a0 = (options.a0 === undefined ? -2.2 : options.a0) + (rnd() - 0.5) * 0.4;
  const sweep = Math.PI * 2 * (options.turns || 1.12);
  const n = Math.max(28, Math.round((rx + ry) * 1.6));
  const drift = options.drift === undefined ? 0.07 : options.drift;
  const ph = rnd() * 6;
  const points: Pt[] = [];
  for (let i = 0; i <= n; i += 1) {
    const s = i / n;
    const a = a0 + sweep * s;
    const k = 1 + drift * (s - 0.5) + 0.025 * Math.sin(ph + s * 9) + (rnd() - 0.5) * 0.012;
    points.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return points;
}

/** A hand-drawn circular arc from angle a0 to a1 (radians). */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, seed: number): Pt[] {
  const rnd = seededRandom(seed);
  const n = 26;
  const ph = rnd() * 6;
  const points: Pt[] = [];
  for (let i = 0; i <= n; i += 1) {
    const s = i / n;
    const a = a0 + (a1 - a0) * s;
    const k = 1 + 0.04 * Math.sin(ph + s * 7) + (rnd() - 0.5) * 0.02;
    points.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
  }
  return points;
}

/** Points of a quadratic Bézier curve. */
export function quad(p0: Pt, c: Pt, p1: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
  }
  return out;
}

function stroke(points: Pt[], wMax: number, wMin: number): MarkPath {
  return { d: tapered(points, wMax, wMin), center: smoothPath(points) };
}

export interface ShapeOptions {
  /** Maximum stroke width; each kind has its own default. */
  weight?: number;
  /** Wave period in px (the wavy line under a number). */
  period?: number;
}

/** The paths of a mark drawn in a `w` × `h` box (plus MARK_PAD of room for the wobble). */
export function shape(kind: MarkKind, w: number, h: number, seed: number, options: ShapeOptions = {}): MarkPath[] {
  const wm = options.weight || MARK_WEIGHT.base;
  const out: MarkPath[] = [];
  switch (kind) {
    case 'tick': {
      const p = sample([[w * 0.06, h * 0.56], [w * 0.36, h * 0.92], [w * 0.96, h * 0.08]], seed, { step: 5, amp: 0.7 });
      out.push(stroke(p, wm, 0.8));
      break;
    }
    case 'dtick': {
      // Found only by words: the same tick, broken into three dashes.
      const q = sample([[w * 0.06, h * 0.56], [w * 0.36, h * 0.92], [w * 0.96, h * 0.08]], seed, { step: 3, amp: 0.6 });
      const cuts: Array<[number, number]> = [
        [0, 0.24],
        [0.36, 0.6],
        [0.72, 1],
      ];
      for (const [from, to] of cuts) {
        const part = q.slice(Math.floor(from * (q.length - 1)), Math.ceil(to * (q.length - 1)) + 1);
        if (part.length > 2) out.push(stroke(part, wm * 0.85, 0.7));
      }
      break;
    }
    case 'cup': {
      // Partly: an open cup, the lower half of an ellipse drawn left to right, the right end
      // lifting a little higher, as a hand does. Never ◐, never a letter.
      const rc = seededRandom(seed);
      const jitter = (a: number) => (rc() - 0.5) * a;
      const cx = w / 2 + jitter(1);
      const rx = w / 2 - 2.4 + jitter(0.8);
      const ry = h - 4.6 + jitter(0.6);
      const top = 2.4 + jitter(0.8);
      const points: Pt[] = [];
      const phase = foldSeed(seed) % 1000;
      for (let i = 0; i <= 18; i += 1) {
        const t = i / 18;
        const theta = Math.PI * t;
        const lift = t > 0.72 ? (t - 0.72) * 4.2 : 0;
        points.push([cx - Math.cos(theta) * rx * (1 + 0.035 * Math.sin(t * 7 + phase)), top + Math.sin(theta) * ry - lift]);
      }
      out.push(stroke(points, options.weight || 3.2, 0.9));
      break;
    }
    case 'dash': {
      const d = sample([[w * 0.04, h * 0.6], [w * 0.97, h * 0.4]], seed, { step: 5, amp: 0.7 });
      out.push(stroke(d, options.weight || MARK_WEIGHT.bold, 1.0));
      break;
    }
    case 'dot': {
      // A pressed pencil point: a small filled, slightly uneven blot.
      const r = Math.min(w, h) * 0.3;
      const rnd = seededRandom(seed);
      const points: Pt[] = [];
      for (let j = 0; j < 14; j += 1) {
        const a = (j / 14) * Math.PI * 2;
        const k = 1 + (rnd() - 0.5) * 0.22;
        points.push([w / 2 + Math.cos(a) * r * k, h / 2 + Math.sin(a) * r * 0.88 * k]);
      }
      points.push(points[0]);
      out.push({ d: smoothPath(points) + 'Z', center: null });
      break;
    }
    case 'cross': {
      // Said wrong: two quick strokes, the second one shorter. Blue pencil, never red.
      const weight = options.weight || 2.6;
      const c1 = sample([[w * 0.1, h * 0.12], [w * 0.5, h * 0.55], [w * 0.92, h * 0.9]], seed, { step: 4, amp: 0.85 });
      const c2 = sample([[w * 0.86, h * 0.06], [w * 0.46, h * 0.5], [w * 0.14, h * 0.94]], seed + 5, { step: 4, amp: 0.85 });
      out.push(stroke(c1, weight, 0.8), stroke(c2, weight * 0.9, 0.7));
      break;
    }
    case 'ring': {
      out.push(stroke(loop(w / 2, h / 2, w / 2 - 2, h / 2 - 2, seed, { a0: -2.0 }), options.weight || 2.2, 0.6));
      break;
    }
    case 'oval': {
      // Wide ovals drift less, so the line never cuts into the words it circles.
      const drift = Math.min(0.05, 7 / Math.max(w, 1));
      out.push(stroke(loop(w / 2, h / 2, w / 2 - 2, h / 2 - 2, seed, { a0: -2.6, turns: 1.08, drift }), options.weight || 2.4, 0.6));
      break;
    }
    case 'under': {
      // The landing's own underline: a seeded jittery line that rises slightly to the right.
      const points = handPoints(1, Math.max(2, w - 1), h * 0.5 + 0.6, foldSeed(seed), { rise: 1.2 });
      out.push(stroke(points, options.weight || 2.2, 0.6));
      break;
    }
    case 'wave': {
      const points: Pt[] = [];
      const n = Math.max(24, Math.round(w / 2.2));
      const rnd = seededRandom(seed);
      const period = options.period || 9;
      for (let i = 0; i <= n; i += 1) {
        const x = 1 + (w - 2) * (i / n);
        points.push([x, h / 2 + Math.sin((x / period) * Math.PI * 2 + rnd() * 0.15) * (h * 0.3) + (rnd() - 0.5) * 0.4]);
      }
      out.push(stroke(points, options.weight || 2.4, 0.6));
      break;
    }
    case 'bracket': {
      const points = sample([[w * 0.92, 2], [w * 0.28, 3], [w * 0.22, h - 3], [w * 0.92, h - 2]], seed, { step: 6, amp: 0.6 });
      out.push(stroke(points, wm, 0.8));
      break;
    }
    case 'brace': {
      // A curly bracket on the right of a line: «об этом спросил экзаменатор».
      const bx = w * 0.25;
      const mid = h / 2;
      const anchors: Pt[] = [
        [bx, 2],
        [w * 0.62, 3.5],
        [w * 0.62, mid - 5],
        [w * 0.95, mid],
        [w * 0.62, mid + 5],
        [w * 0.62, h - 3.5],
        [bx, h - 2],
      ];
      out.push(stroke(sample(anchors, seed, { step: 3.5, amp: 0.45 }), options.weight || 2.6, 0.7));
      break;
    }
    case 'vline': {
      // The margin stroke beside a selected line, as a teacher marks a passage.
      const points = sample([[w * 0.55, 1], [w * 0.45, h - 1]], seed, { step: 9, amp: 0.9 });
      out.push(stroke(points, options.weight || 2.4, 0.7));
      break;
    }
    case 'strike': {
      // A figure crossed out by hand: one stroke from below the left end to above the right end,
      // bowed a little, the whole box wide (the caller's box already holds the overshoot).
      const rs = seededRandom(seed);
      const y0 = h * (0.86 + (rs() - 0.5) * 0.06);
      const y1 = h * (0.14 + (rs() - 0.5) * 0.06);
      const bow = h * (0.05 + rs() * 0.04);
      const points = sample(quad([0.5, y0], [w * 0.52, (y0 + y1) / 2 + bow], [w - 0.5, y1], 14), seed, { step: 6, amp: 0.7 });
      out.push(stroke(points, options.weight || 2.6, 0.8));
      break;
    }
    default:
      break;
  }
  return out;
}

/** An arrow from p0 to p1 with a bow (a fraction of its length); `upto` < 1 for a stroke still being drawn. */
export function arrow(p0: Pt, p1: Pt, seed: number, options: { bow?: number; upto?: number; head?: number; weight?: number } = {}): MarkPath[] {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = (options.bow === undefined ? 0.06 : options.bow) * len;
  const c: Pt = [(p0[0] + p1[0]) / 2 + nx * bow, (p0[1] + p1[1]) / 2 + ny * bow];
  const shaft = sample(quad(p0, c, p1, 10), seed, { step: 8, amp: 0.8 });
  const upto = options.upto === undefined ? 1 : options.upto;
  const paths: MarkPath[] = [{ d: tapered(shaft, options.weight || 2.4, 0.7, upto), center: smoothPath(shaft) }];
  if (upto >= 1) {
    const tip = shaft[shaft.length - 1];
    const prev = shaft[Math.max(0, shaft.length - 3)];
    const angle = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
    const headLength = options.head || 10;
    [-0.5, 0.5].forEach((delta, k) => {
      const a = angle + Math.PI + delta;
      const tail: Pt = [tip[0] + Math.cos(a) * headLength, tip[1] + Math.sin(a) * headLength];
      const points = sample([tail, tip], seed + 7 + k, { step: 3, amp: 0.35 });
      paths.push({ d: tapered(points, 2.1, 0.7), center: smoothPath(points) });
    });
  }
  return paths;
}
