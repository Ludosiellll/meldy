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
  /** The widest the name under it may be (it is cut with «…» beyond). */
  nameW: number;
}

/** Names under the characters: 24 units (≈ 2.7 % of the screen's height), one line. */
export const NAME_FONT = 24;
/** The room a name takes under a character: the gap and its line. */
export const NAME_ROOM = 34;

export const BOSS_SIZE = 300;
export const BOSS_TOP = 196;
const ARENA_TOP = 188;
const ARENA_BOTTOM = 540;
const SIDE_PAD = 44;
const BOSS_GAP = 176;

export function bossBox(width: number) {
  const x = width / 2 - BOSS_SIZE / 2;
  return { x, y: BOSS_TOP, size: BOSS_SIZE, center: { x: width / 2, y: BOSS_TOP + BOSS_SIZE * 0.55 } };
}

/**
 * The HP bar over the monster: the bar itself (30 units high), «Дедлайн» to its left and the HP to its right on the same
 * line, so the room under it is free for the question's three who hit hardest.
 */
export const HP_BAR_H = 30;
export function hpBox(width: number) {
  const w = 560;
  return { x: width / 2 - w / 2, y: 90, width: w, h: HP_BAR_H, cy: 90 + HP_BAR_H / 2 };
}

/** Under the bar: the question's three who hit hardest, or the phase's rule. */
export const UNDER_BAR_Y = 90 + HP_BAR_H + 12;

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
  // As big as the rows allow: a class of 24 reads from the back of the room. Each row keeps room for its names.
  const size = rows <= 2 ? 84 : rows === 3 ? 72 : 54;
  const stepY = size + NAME_ROOM + (rows <= 2 ? 14 : rows === 3 ? 6 : 0);
  const stagger = rows > 1 ? 30 : 0;
  const stepX = cols > 1 ? Math.min(Math.max(size + 44, 118), (blockW - size - stagger) / (cols - 1)) : 0;
  return { cols, rows, size, stepX, stepY, stagger };
}

/**
 * The arena's places: `count` seats (players keep theirs, see seats()), taking turns left and right of the monster, the
 * nearest columns first, rows centred in the arena. The same count and width always give the same places.
 */
export function arenaSlots(count: number, width: number): Slot[] {
  const n = Math.max(0, Math.min(ARENA_MAX, count));
  if (n === 0) return [];
  const blockW = width / 2 - BOSS_GAP - SIDE_PAD;
  const perSide = Math.ceil(n / 2);
  const g = grid(perSide, blockW);
  const height = (g.rows - 1) * g.stepY + g.size + NAME_ROOM;
  const top = ARENA_TOP + Math.max(0, (ARENA_BOTTOM - ARENA_TOP - height) / 2);
  const nameW = g.cols > 1 ? Math.floor(g.stepX - 8) : 150;
  const slots: Slot[] = [];
  for (let i = 0; i < n; i += 1) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const row = Math.floor(k / g.cols);
    const col = k % g.cols;
    const out = col * g.stepX + (row % 2) * g.stagger;
    const x = side < 0 ? width / 2 - BOSS_GAP - g.size - out : width / 2 + BOSS_GAP + out;
    const y = top + row * g.stepY;
    slots.push({ x, y, size: g.size, cx: x + g.size / 2, cy: y + g.size * 0.45, side, nameW });
  }
  return slots;
}

/** Seats in the arena: who sits where, and how many seats the arena is laid out for. */
export interface Seats {
  of: ReadonlyMap<string, number>;
  count: number;
}

export const NO_SEATS: Seats = { of: new Map(), count: 0 };

/**
 * The arena's seats, given the players in joining order. In the lobby (`keep` null) everyone sits by joining order.
 * During the game a player keeps their seat: one who leaves leaves an empty seat (nobody else moves), a newcomer takes
 * the first empty seat or a new one; the count never shrinks, so the arena is never laid out again for fewer.
 */
export function seats(ids: readonly string[], keep: Seats | null, max = ARENA_MAX): Seats {
  if (!keep) {
    const of = new Map<string, number>();
    ids.slice(0, max).forEach((id, i) => of.set(id, i));
    return { of, count: of.size };
  }
  const of = new Map<string, number>();
  const taken = new Set<number>();
  for (const id of ids) {
    const seat = keep.of.get(id);
    if (seat !== undefined) {
      of.set(id, seat);
      taken.add(seat);
    }
  }
  let free = 0;
  let count = keep.count;
  for (const id of ids) {
    if (of.has(id)) continue;
    while (free < max && taken.has(free)) free += 1;
    if (free >= max) break;
    of.set(id, free);
    taken.add(free);
    count = Math.max(count, free + 1);
  }
  if (of.size === keep.of.size && [...of].every(([id, seat]) => keep.of.get(id) === seat) && count === keep.count) return keep;
  return { of, count };
}

/** The podium's crowd: everyone but the three on the podium, in two groups at the sides (up to `max`). */
export function podiumSlots(count: number, width: number, max = 32): Slot[] {
  const size = 62;
  const stepY = 124;
  const rows = 4;
  const inner = width / 2 - 360;
  const room = inner - 40 - SIDE_PAD - size - 30;
  const cols = Math.max(2, Math.min(4, Math.floor(room / 90) + 1));
  const stepX = Math.min(118, room / (cols - 1));
  const nameW = Math.floor(stepX - 8);
  const n = Math.max(0, Math.min(max, count, cols * rows * 2));
  const slots: Slot[] = [];
  for (let i = 0; i < n; i += 1) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    const row = k % rows;
    const col = Math.floor(k / rows);
    const out = col * stepX + (row % 2) * 30;
    const x = side < 0 ? inner - size - 40 - out : width - inner + 40 + out;
    const y = 272 + row * stepY;
    slots.push({ x, y, size, cx: x + size / 2, cy: y + size * 0.45, side, nameW });
  }
  return slots;
}

/**
 * The class is drawn once, at this size, and only moved and scaled (transform) between the lobby, the arena and the
 * podium: no character is unmounted at a change of state.
 */
export const CHAR_BASE = 72;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The lobby is for the room: on the left a card with the address, the PIN and the QR code; on the right the panel the
 * class gathers on; under both, one line of the teacher's (settings, the post into the chat, «Начать»).
 */
export function lobbyBoxes(width: number): { card: Box; panel: Box; grid: Box } {
  const cardW = width < 1560 ? 560 : 600;
  const card = { x: 40, y: 92, w: cardW, h: 696 };
  const panel = { x: card.x + cardW + 36, y: 92, w: width - 40 - (card.x + cardW + 36), h: 696 };
  // the grid under the panel's count
  const grid = { x: panel.x + 36, y: panel.y + 136, w: panel.w - 72, h: panel.h - 136 - 24 };
  return { card, panel, grid };
}

export interface LobbyLayout {
  slots: Slot[];
  /** Players not drawn («и ещё N»), and where that note goes. */
  more: number;
  morePoint: Point;
  /** The note's cell. */
  moreW: number;
}

/** The lobby's sizes, biggest first: the class is drawn as big as its number allows. */
const LOBBY_SIZES = [96, 88, 80, 72, 64, 56] as const;

export function lobbySlots(count: number, width: number): LobbyLayout {
  const { grid } = lobbyBoxes(width);
  const n = Math.min(count, LOBBY_MAX);
  let pick = { size: 56, cellW: 112, cellH: 56 + NAME_ROOM + 12, cols: 1, rows: 1 };
  for (const size of LOBBY_SIZES) {
    const cellW = Math.max(size + 26, 112);
    const cellH = size + NAME_ROOM + 12;
    const cols = Math.max(1, Math.floor(grid.w / cellW));
    const rows = Math.max(1, Math.floor(grid.h / cellH));
    pick = { size, cellW, cellH, cols, rows };
    if (cols * rows >= n) break;
  }
  const capacity = Math.min(LOBBY_MAX, pick.cols * pick.rows);
  const shown = count > capacity ? capacity - 1 : count;
  const used = Math.max(1, Math.min(pick.cols, shown + (count > shown ? 1 : 0)));
  const left = grid.x + (grid.w - used * pick.cellW) / 2;
  const cell = (i: number): Point => ({ x: left + (i % pick.cols) * pick.cellW, y: grid.y + Math.floor(i / pick.cols) * pick.cellH });
  const slots: Slot[] = [];
  for (let i = 0; i < shown; i += 1) {
    const c = cell(i);
    const x = c.x + (pick.cellW - pick.size) / 2;
    const y = c.y;
    slots.push({ x, y, size: pick.size, cx: x + pick.size / 2, cy: y + pick.size * 0.45, side: -1, nameW: pick.cellW - 8 });
  }
  return { slots, more: count - shown, morePoint: cell(shown), moreW: pick.cellW };
}

/** The podium's three places: the character's box on top of each column (1st, 2nd, 3rd). */
export const PODIUM_COLUMNS = [
  { dx: -110, h: 300 },
  { dx: -340, h: 230 },
  { dx: 120, h: 190 },
] as const;
export const PODIUM_FLOOR = 780;
export const PODIUM_CHAR = 130;

export function podiumTopSlots(width: number): Slot[] {
  return PODIUM_COLUMNS.map((c) => {
    const x = width / 2 + c.dx + (220 - PODIUM_CHAR) / 2;
    const y = PODIUM_FLOOR - c.h - PODIUM_CHAR + 2;
    return { x, y, size: PODIUM_CHAR, cx: x + PODIUM_CHAR / 2, cy: y + PODIUM_CHAR * 0.45, side: -1 as const, nameW: 200 };
  });
}

/** Font size of an option by its length (no measuring): long options get smaller letters, never a third line. */
export function optionFont(text: string): number {
  const n = [...text].length;
  if (n > 70) return 21;
  if (n > 44) return 23;
  if (n > 28) return 25;
  return 28;
}

export function questionFont(text: string): number {
  const n = [...text].length;
  if (n > 160) return 25;
  if (n > 110) return 28;
  if (n > 64) return 31;
  return 36;
}
