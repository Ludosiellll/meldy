/**
 * Where things stand on the teacher's screen. The screen is one stage 900 units high, scaled to the window: its width in
 * units follows the window's shape (1440 at 16:10, 1600 at 16:9, ~1880 on a wide laptop). Every position is computed
 * here, from the stage size and the number of players, never read back from the page: the effects fly between these
 * points without a single layout read while they run.
 */

export const STAGE_H = 900;
export const STAGE_MIN_W = 1440;
export const STAGE_MAX_W = 2100;

/** The arena shows this many characters; the rest are counted («+12»). */
export const ARENA_MAX = 40;
export const LOBBY_MAX = 40;

export interface StageFit {
  /** Pixels per unit. */
  scale: number;
  /** The stage's width in units. */
  width: number;
  /** Offset of the stage in the window (px), when the window is narrower or taller than the stage. */
  left: number;
  top: number;
}

export function stageFit(vw: number, vh: number): StageFit {
  const w = Math.max(1, vw);
  const h = Math.max(1, vh);
  const scale = Math.min(h / STAGE_H, w / STAGE_MIN_W);
  const width = Math.min(STAGE_MAX_W, Math.max(STAGE_MIN_W, w / scale));
  return { scale, width, left: Math.round((w - width * scale) / 2), top: Math.round((h - STAGE_H * scale) / 2) };
}

export interface Point {
  x: number;
  y: number;
}

export interface Slot {
  /** Top-left corner of the character's box. */
  x: number;
  y: number;
  size: number;
  /** Where its star starts and its shard lands: the middle of the body. */
  cx: number;
  cy: number;
  /** -1 on the left of the monster, 1 on the right. */
  side: -1 | 1;
}

export const BOSS_SIZE = 300;
export const BOSS_TOP = 196;
const ARENA_TOP = 188;
const ARENA_BOTTOM = 516;
const SIDE_PAD = 44;
const BOSS_GAP = 176;

export function bossBox(width: number) {
  const x = width / 2 - BOSS_SIZE / 2;
  return { x, y: BOSS_TOP, size: BOSS_SIZE, center: { x: width / 2, y: BOSS_TOP + BOSS_SIZE * 0.55 } };
}

/** The HP bar over the monster. */
export function hpBox(width: number) {
  const w = 560;
  return { x: width / 2 - w / 2, y: 84, width: w };
}

/** Where the hits of players who are not drawn come from (under the crowd's count). */
export function crowdPoint(width: number): Point {
  return { x: width / 2, y: ARENA_BOTTOM + 10 };
}

interface Grid {
  cols: number;
  rows: number;
  size: number;
  stepX: number;
  stepY: number;
  stagger: number;
}

function grid(perSide: number, blockW: number): Grid {
  let cols: number;
  if (perSide <= 12) cols = Math.max(1, Math.min(4, perSide));
  else cols = 5;
  const rows = Math.max(1, Math.ceil(perSide / cols));
  // As big as the rows allow: a class of 24 reads from the back of the room.
  const size = rows <= 2 ? 80 : rows === 3 ? 72 : 56;
  const stepY = rows <= 2 ? 124 : rows === 3 ? 112 : 84;
  const stagger = rows > 1 ? 30 : 0;
  const stepX = cols > 1 ? Math.min(size + 42, (blockW - size - stagger) / (cols - 1)) : 0;
  return { cols, rows, size, stepX, stepY, stagger };
}

/**
 * The arena's places: the first `ARENA_MAX` players by joining order, taking turns left and right of the monster, the
 * nearest columns first, rows centred in the arena. The same count and width always give the same places.
 */
export function arenaSlots(count: number, width: number): Slot[] {
  const n = Math.max(0, Math.min(ARENA_MAX, count));
  if (n === 0) return [];
  const blockW = width / 2 - BOSS_GAP - SIDE_PAD;
  const perSide = Math.ceil(n / 2);
  const g = grid(perSide, blockW);
  const height = (g.rows - 1) * g.stepY + g.size + 18;
  const top = ARENA_TOP + Math.max(0, (ARENA_BOTTOM - ARENA_TOP - height) / 2);
  const slots: Slot[] = [];
  for (let i = 0; i < n; i += 1) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const row = Math.floor(k / g.cols);
    const col = k % g.cols;
    const out = col * g.stepX + (row % 2) * g.stagger;
    const x = side < 0 ? width / 2 - BOSS_GAP - g.size - out : width / 2 + BOSS_GAP + out;
    const y = top + row * g.stepY;
    slots.push({ x, y, size: g.size, cx: x + g.size / 2, cy: y + g.size * 0.45, side });
  }
  return slots;
}

/** The podium's crowd: everyone but the three on the podium, in two groups at the sides (up to `max`). */
export function podiumSlots(count: number, width: number, max = 32): Slot[] {
  const size = 62;
  const stepY = 112;
  const rows = 4;
  const inner = width / 2 - 360;
  const room = inner - 40 - SIDE_PAD - size - 30;
  const cols = Math.max(2, Math.min(4, Math.floor(room / 84) + 1));
  const stepX = Math.min(88, room / (cols - 1));
  const n = Math.max(0, Math.min(max, count, cols * rows * 2));
  const slots: Slot[] = [];
  for (let i = 0; i < n; i += 1) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const row = k % rows;
    const col = Math.floor(k / rows);
    const out = col * stepX + (row % 2) * 30;
    const x = side < 0 ? inner - size - 40 - out : width - inner + 40 + out;
    const y = 300 + row * stepY;
    slots.push({ x, y, size, cx: x + size / 2, cy: y + size * 0.45, side });
  }
  return slots;
}

/** Font size of an option by its length (no measuring): long options get smaller letters, never a third line. */
export function optionFont(text: string): number {
  const n = [...text].length;
  if (n > 70) return 18;
  if (n > 44) return 20;
  if (n > 28) return 22;
  return 25;
}

export function questionFont(text: string): number {
  const n = [...text].length;
  if (n > 160) return 23;
  if (n > 110) return 26;
  if (n > 64) return 29;
  return 33;
}
