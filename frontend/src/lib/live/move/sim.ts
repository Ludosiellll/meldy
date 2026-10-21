/**
 * Movement on a game map — the same function the server runs (backend/live_move.py `move_circle`, `apply_command`),
 * so the phone predicts its own character where the server will put it. Every operation is in the order of the
 * Python code; contracts/live/move_cases.json is checked by both sides (sim.test.ts, test_live_move.py).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export type Shape = { rect: [number, number, number, number] } | { circle: [number, number, number] };

/** The map as the server sends it (welcome, `map` event). */
export interface MapJson {
  w: number;
  h: number;
  solids: Shape[];
  zones: Array<{ id: string } & Shape>;
  spawns: Array<[number, number]>;
  npc_spawns: Array<[number, number]>;
}

export interface Zone {
  id: string;
  rect?: Rect;
  circle?: Circle;
}

export interface GameMap {
  w: number;
  h: number;
  rects: Rect[];
  circles: Circle[];
  zones: Zone[];
  spawns: Array<[number, number]>;
}

export interface MoveRules {
  tickHz: number;
  speed: number;
  r: number;
}

export const DEFAULT_RULES: MoveRules = { tickHz: 20, speed: 260, r: 18 };
export const AXIS_MAX = 127;

function toRect(v: [number, number, number, number]): Rect {
  return { x: v[0], y: v[1], w: v[2], h: v[3] };
}

function toCircle(v: [number, number, number]): Circle {
  return { x: v[0], y: v[1], r: v[2] };
}

/** The server's map JSON → solids split as the server splits them (rectangles, then circles, each in map order). */
export function mapFromJson(json: MapJson): GameMap {
  const rects: Rect[] = [];
  const circles: Circle[] = [];
  for (const s of json.solids) {
    if ('rect' in s) rects.push(toRect(s.rect));
    else circles.push(toCircle(s.circle));
  }
  const zones = json.zones.map((z) => ('rect' in z ? { id: z.id, rect: toRect(z.rect) } : { id: z.id, circle: toCircle(z.circle) }));
  return { w: json.w, h: json.h, rects, circles, zones, spawns: json.spawns };
}

function pushRect(x: number, y: number, r: number, rc: Rect): [number, number] {
  const cx = Math.min(Math.max(x, rc.x), rc.x + rc.w);
  const cy = Math.min(Math.max(y, rc.y), rc.y + rc.h);
  const dx = x - cx;
  const dy = y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= r * r) return [x, y];
  if (d2 > 0) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    return [x + dx * k, y + dy * k];
  }
  const left = x - rc.x;
  const right = rc.x + rc.w - x;
  const top = y - rc.y;
  const bottom = rc.y + rc.h - y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return [rc.x - r, y];
  if (m === right) return [rc.x + rc.w + r, y];
  if (m === top) return [x, rc.y - r];
  return [x, rc.y + rc.h + r];
}

function pushCircle(x: number, y: number, r: number, c: Circle): [number, number] {
  const dx = x - c.x;
  const dy = y - c.y;
  const rr = r + c.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return [x, y];
  if (d2 > 0) {
    const d = Math.sqrt(d2);
    const k = (rr - d) / d;
    return [x + dx * k, y + dy * k];
  }
  return [x, c.y - rr];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** A circle of radius r moved by (dx, dy), pushed out of the solids (two passes) and kept inside the map. */
export function moveCircle(m: GameMap, x0: number, y0: number, dx: number, dy: number, r: number): [number, number] {
  let x = x0 + dx;
  let y = y0 + dy;
  for (let pass = 0; pass < 2; pass++) {
    for (const rc of m.rects) [x, y] = pushRect(x, y, r, rc);
    for (const c of m.circles) [x, y] = pushCircle(x, y, r, c);
  }
  return [clamp(x, r, m.w - r), clamp(y, r, m.h - r)];
}

/** Signed-byte joystick axes as a vector no longer than 1 (-128 counts as -127). */
export function axisVector(jx: number, jy: number): [number, number] {
  let vx = Math.max(-AXIS_MAX, Math.min(AXIS_MAX, jx)) / AXIS_MAX;
  let vy = Math.max(-AXIS_MAX, Math.min(AXIS_MAX, jy)) / AXIS_MAX;
  const m2 = vx * vx + vy * vy;
  if (m2 > 1) {
    const mag = Math.sqrt(m2);
    vx = vx / mag;
    vy = vy / mag;
  }
  return [vx, vy];
}

/** One command = one tick of movement; a still joystick does not move (nor push) the player. */
export function applyCommand(m: GameMap, x: number, y: number, jx: number, jy: number, rules: MoveRules = DEFAULT_RULES): [number, number] {
  if (!jx && !jy) return [x, y];
  const [vx, vy] = axisVector(jx, jy);
  const step = rules.speed / rules.tickHz;
  return moveCircle(m, x, y, vx * step, vy * step, rules.r);
}

/** A joystick in [-1, 1] as signed-byte axes, with a small dead zone so a resting thumb sends nothing. */
export function toAxes(x: number, y: number, deadZone = 0.08): [number, number] {
  const cx = Math.max(-1, Math.min(1, Number.isFinite(x) ? x : 0));
  const cy = Math.max(-1, Math.min(1, Number.isFinite(y) ? y : 0));
  if (Math.hypot(cx, cy) < deadZone) return [0, 0];
  return [Math.round(cx * AXIS_MAX), Math.round(cy * AXIS_MAX)];
}

/** The id of the zone a point is in (the first one listed), or null. */
/** 1 + the index of the first zone containing the point, or 0 (live_move.GameMap.zone_index; the snapshot's zone bits).
 *  Mode A matches answers by this index: zone i is option i. */
export function zoneIndexAt(m: GameMap, x: number, y: number): number {
  for (let i = 0; i < m.zones.length; i++) {
    const z = m.zones[i];
    if (z.rect && x >= z.rect.x && x <= z.rect.x + z.rect.w && y >= z.rect.y && y <= z.rect.y + z.rect.h) return i + 1;
    if (z.circle) {
      const dx = x - z.circle.x;
      const dy = y - z.circle.y;
      if (dx * dx + dy * dy <= z.circle.r * z.circle.r) return i + 1;
    }
  }
  return 0;
}

export function zoneAt(m: GameMap, x: number, y: number): string | null {
  const i = zoneIndexAt(m, x, y);
  return i === 0 ? null : m.zones[i - 1].id;
}
