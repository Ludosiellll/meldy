/**
 * The arena of the movement games laid out on the server's map, and the timing of the floor's collapse. Pure: no
 * three.js. Everything is in map units (docs/live/MOVE.md §3: the reference map is 1600 × 900, +y is down).
 */

/** The server's map (docs/live/MOVE.md §4 «Map»). */
export interface MoveMap {
  w: number;
  h: number;
  solids?: ReadonlyArray<{ rect?: readonly number[]; circle?: readonly number[] }>;
  zones?: ReadonlyArray<{ id: string; rect: readonly number[] }>;
  spawns?: ReadonlyArray<readonly number[]>;
  npc_spawns?: ReadonlyArray<readonly number[]>;
}

export interface Point {
  x: number;
  y: number;
}

export interface Tile {
  col: number;
  row: number;
  /** Centre, map units. */
  x: number;
  y: number;
  /** Index into map.zones of the zone holding the centre, or -1. */
  zone: number;
}

export interface TileLayout {
  cols: number;
  rows: number;
  /** Tile size along x and y, map units. */
  sx: number;
  sy: number;
  tiles: Tile[];
}

/** Map units per tile the layout aims at: 1600 × 900 gives 16 × 9 tiles. */
export const TILE_TARGET = 100;

/** Where the boss stands: centred above the map's top edge (y < 0 is beyond the far edge, behind the floor). */
export function stageOf(map: MoveMap): Point {
  return { x: map.w / 2, y: -160 };
}

/** Where the boss's stomp lands and the collapse starts: just above the top edge, under the boss. */
export function impactOf(map: MoveMap): Point {
  return { x: map.w / 2, y: -25 };
}

/** Index of the first zone holding the point (the server's rule), or -1. */
export function zoneAt(map: MoveMap, x: number, y: number): number {
  const zones = map.zones ?? [];
  for (let i = 0; i < zones.length; i++) {
    const [zx, zy, zw, zh] = zones[i].rect;
    if (x >= zx && x <= zx + zw && y >= zy && y <= zy + zh) return i;
  }
  return -1;
}

export function layoutTiles(map: MoveMap, target = TILE_TARGET): TileLayout {
  const cols = Math.max(1, Math.round(map.w / target));
  const rows = Math.max(1, Math.round(map.h / target));
  const sx = map.w / cols;
  const sy = map.h / rows;
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = (col + 0.5) * sx;
      const y = (row + 0.5) * sy;
      tiles.push({ col, row, x, y, zone: zoneAt(map, x, y) });
    }
  }
  return { cols, rows, sx, sy, tiles };
}

/** Index of the tile under a map point, or -1 off the floor. */
export function tileIndexAt(layout: TileLayout, x: number, y: number): number {
  const col = Math.floor(x / layout.sx);
  const row = Math.floor(y / layout.sy);
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return -1;
  return row * layout.cols + col;
}

/** The collapse's timing. Seconds, map units. */
export const COLLAPSE = {
  /** From the stomp's impact to the first tile's drop. */
  lead: 0.12,
  /** Added per map unit of distance from the impact: the ripple runs at ~1100 units/s. */
  perUnit: 0.0009,
  /** Up to this much at random per tile, so the ripple's front is not a perfect circle. */
  jitter: 0.1,
  /** A tile shakes this long before it drops. */
  shake: 0.3,
  /** Fall acceleration (1300 units/s² ≈ 26 m/s² at 50 units a metre: a cartoon drop). */
  gravity: 1300,
  /** Below this a fallen tile is out of sight and stops moving. */
  gone: -650,
  /** restore(): tiles rise back over this long, in the same ripple. */
  rise: 0.45,
} as const;

/** A small fast seeded generator (mulberry32): the same game gives the same ripple on every screen. */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** When the tile at (x, y) starts to drop, for a collapse whose impact is at `tStart`. */
export function dropStart(x: number, y: number, impact: Point, tStart: number, jitter01: number): number {
  const d = Math.hypot(x - impact.x, y - impact.y);
  return tStart + COLLAPSE.lead + d * COLLAPSE.perUnit + jitter01 * COLLAPSE.jitter;
}

/**
 * For every tile, the second it starts to drop; Infinity for the tiles of the right zone, which stay.
 * `correctZoneId` that is no zone of the map drops the whole floor.
 */
export function planCollapse(
  map: MoveMap,
  layout: TileLayout,
  correctZoneId: string,
  tStart: number,
  seed = 1,
  out: Float64Array = new Float64Array(layout.tiles.length),
): Float64Array {
  const correct = (map.zones ?? []).findIndex((z) => z.id === correctZoneId);
  const impact = impactOf(map);
  const random = rng(seed);
  for (let i = 0; i < layout.tiles.length; i++) {
    const tile = layout.tiles[i];
    const j = random();
    out[i] = correct >= 0 && tile.zone === correct ? Infinity : dropStart(tile.x, tile.y, impact, tStart, j);
  }
  return out;
}

/**
 * Height of a tile's top at `now` (map units, 0 = the floor, negative = below it), given when it starts to drop.
 * Before the drop it shakes in place (the shake is drawn, not counted here).
 */
export function dropHeight(now: number, start: number): number {
  if (!(now > start)) return 0;
  const u = now - start;
  const h = -0.5 * COLLAPSE.gravity * u * u;
  return h < COLLAPSE.gone ? COLLAPSE.gone : h;
}

/** How hard a tile shakes (0…1) at `now`: ramps up over the COLLAPSE.shake seconds before its drop. */
export function shakeAmount(now: number, start: number): number {
  const before = start - now;
  if (!(before > 0) || before > COLLAPSE.shake) return 0;
  return 1 - before / COLLAPSE.shake;
}

/** restore(): the height of a fallen tile rising back, `start` = when this tile starts to rise. */
export function riseHeight(now: number, start: number, from: number): number {
  if (now <= start) return from;
  const k = Math.min(1, (now - start) / COLLAPSE.rise);
  // ease out with a small overshoot, so the tile settles with a bump
  const c1 = 1.70158;
  const e = 1 + (c1 + 1) * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  return from * (1 - e);
}
