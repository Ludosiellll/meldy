/**
 * A battle's class round the boss in 3D (the button questions, the lobby, the five best and the podium): where each
 * character stands and how a hit leaps at the boss. Pure, tested in formation.test.ts; the scene (scene.ts) draws it.
 *
 * Map units, as the room's: +y runs towards the viewer, the boss stands on the stage. The places go round the stage in
 * rings, the front of each ring first, then its sides, then its back; a place right behind the boss (hidden by it) or
 * off the floor is skipped.
 */

export interface Spot {
  x: number;
  y: number;
}

/** The first ring's half widths; each next ring is this much wider. */
const RING_X = 285;
const RING_Y = 168;
const STEP_X = 120;
const STEP_Y = 74;
/** Map units between two characters on a ring. */
const SPACING = 72;
/** Behind the boss: |x − stage x| under this and further back than the stage is hidden. */
const HIDDEN_X = 130;
/** How far inside the floor's edge a character keeps. */
const EDGE = 44;

function ellipsePerimeter(a: number, b: number): number {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

/** The floor a class stands on, map units: x0…x1 across, y0…y1 from the back to the front. */
export interface Floor {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Places for `n` characters round the stage on `floor`, in the order they fill (the first joined stands in front of the
 * boss). Always `n` places: past the last ring they repeat from the first, a little in front.
 */
export function ringSpots(n: number, stage: Spot, floor: Floor): Spot[] {
  const out: Spot[] = [];
  for (let ring = 0; out.length < n && ring < 8; ring++) {
    const rx = RING_X + STEP_X * ring;
    const ry = RING_Y + STEP_Y * ring;
    const count = Math.max(6, Math.floor(ellipsePerimeter(rx, ry) / SPACING));
    const spots: Array<Spot & { order: number }> = [];
    for (let i = 0; i < count; i++) {
      // angle 0 is straight in front of the boss (+y); every other ring is turned half a step, so rings interleave
      const a = ((i + (ring % 2) * 0.5) / count) * Math.PI * 2;
      const x = stage.x + Math.sin(a) * rx;
      const y = stage.y + Math.cos(a) * ry;
      if (x < floor.x0 + EDGE || x > floor.x1 - EDGE || y < floor.y0 + EDGE || y > floor.y1 - EDGE) continue;
      if (y < stage.y && Math.abs(x - stage.x) < HIDDEN_X) continue;
      // front first: by the angle away from straight ahead, the right before the left at the same angle
      const off = a <= Math.PI ? a : Math.PI * 2 - a;
      spots.push({ x: Math.round(x), y: Math.round(y), order: off * 1000 + (a <= Math.PI ? 0 : 1) });
    }
    spots.sort((p, q) => p.order - q.order);
    for (const s of spots) {
      if (out.length >= n) break;
      out.push({ x: s.x, y: s.y });
    }
  }
  // more players than places (never in a real class): the rest stand where the first stand, half a step back
  const base = out.length;
  for (let i = base; i < n && base > 0; i++) {
    const s = out[i % base];
    out.push({ x: s.x, y: Math.min(floor.y1 - EDGE, s.y + 20) });
  }
  return out;
}

/** Map angle a character at `from` turns to face `to` (0 faces +y, π/2 faces +x: Player.setFacing). */
export function facing(from: Spot, to: Spot): number {
  return Math.atan2(to.x - from.x, to.y - from.y);
}

/** A hit's leap at the boss, seconds: out, at the boss, back. */
export const LEAP_OUT_S = 0.28;
export const LEAP_HOLD_S = 0.3;
export const LEAP_BACK_S = 0.42;
export const LEAP_S = LEAP_OUT_S + LEAP_HOLD_S + LEAP_BACK_S;
/** How high the leap goes, map units (a character is about 100 tall). */
const LEAP_HIGH = 75;
/** How close to the boss's middle a leap lands, and how far it reaches at most. */
const LEAP_STOP = 120;
const LEAP_REACH = 320;

export interface Leap {
  /** 0 at the place, 1 at the boss. */
  k: number;
  /** Height over the floor. */
  z: number;
  /** The leap is over. */
  done: boolean;
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Where a leap is `t` seconds after it started. */
export function leapAt(t: number): Leap {
  if (t < 0) return { k: 0, z: 0, done: false };
  if (t < LEAP_OUT_S) {
    const u = t / LEAP_OUT_S;
    return { k: easeOut(u), z: Math.sin(Math.PI * u) * LEAP_HIGH, done: false };
  }
  if (t < LEAP_OUT_S + LEAP_HOLD_S) return { k: 1, z: 0, done: false };
  const u = (t - LEAP_OUT_S - LEAP_HOLD_S) / LEAP_BACK_S;
  if (u >= 1) return { k: 0, z: 0, done: true };
  return { k: 1 - easeInOut(u), z: Math.sin(Math.PI * u) * LEAP_HIGH * 0.45, done: false };
}

/** The point a leap from `spot` reaches at `k` (it stops short of the boss's middle). */
export function leapPoint(spot: Spot, boss: Spot, k: number): Spot {
  const dx = boss.x - spot.x;
  const dy = boss.y - spot.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return { x: spot.x, y: spot.y };
  const reach = Math.max(0, Math.min(LEAP_REACH, d - LEAP_STOP)) * k;
  return { x: spot.x + (dx / d) * reach, y: spot.y + (dy / d) * reach };
}
