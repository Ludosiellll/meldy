/**
 * The phone's camera on the arena (owner, 21.10: the phone must show the projector's game, not a close top-down view).
 *
 * The projector's 3/4 view from the front: the same tilt, a lens about as far away (the same perspective), but close
 * enough that the heroes read on a phone: about 40 % of the arena's width across the screen. It follows the own hero
 * left and right, a little ahead of where the hero runs. It never moves up and down: the arena's whole depth, from the
 * signs on the back wall to the front edge, sits in the band between the question card and the stick (a lens shift
 * puts it there). Only when that band is too short for the whole depth does the picture slide, to keep the hero in it.
 * On an answer zone it leans a little towards the zone's middle (its sign stays whole); in the last seconds and at the
 * stomp it leans towards the boss, when the hero stays in the picture.
 *
 * Pure (no three.js): the scene hands the shot to the kit's view each frame. Tested in camera.test.ts.
 */

/** How steeply the camera looks down, degrees: the projector's (stand/scene.ts TILT). */
export const TILT = 52;
/** Map units from the lens to the point it aims at: the projector's perspective (back tiles ~0.75 of the front's). */
export const DISTANCE = 1650;
/** CSS pixels per map unit where the camera aims: a hero about 60 px tall on a 390 px wide phone. */
export const PX_PER_UNIT = 0.64;
/** Map units across the screen, whatever the phone's width. */
export const SPAN = { min: 520, max: 820 } as const;
/** How far beyond the floor's side edges the camera may look, map units (the frame and a little dark). */
const OVERSCAN = 50;
/** Seconds ahead of the hero the camera aims while it runs. */
const LEAD = 0.3;
/** How fast the camera catches up (1/s); how fast it smooths the hero's position, then its speed (1/s). */
const RATE = 4.5;
const POS_RATE = 12;
const SPEED_RATE = 6;
/** Speeds under this (map units/s) give no lead: a hero standing still with a jittery position stays centred. */
const IDLE_SPEED = 40;
/** Leaning to the boss: the hero stays at least this far inside the picture's edges, map units. */
const EDGE = 95;
/** On an answer zone: this share of the way from the hero to the zone's middle, reached this deep inside it (units). */
const ZONE_LEAN = 0.4;
const ZONE_RAMP = 80;
/** A jump this long in one frame (a respawn, a reconnect) is followed at once, map units. */
const SNAP = 400;
/** Pixels kept free inside the band above the hero's head (the «Вы» tag) and below its feet. */
const HEAD_PX = 92;
const FEET_PX = 26;
/** Pixels kept between the arena and the cards above and below it. */
const PAD = 10;

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The canvas (CSS px) and the band of it the arena may use: free from the top card and the bottom controls. */
export interface Screen {
  width: number;
  height: number;
  top: number;
  bottom: number;
}

export interface Shot {
  eye: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;
  shift: { x: number; y: number };
}

/** Heights the picture must hold over the floor, map units: the signs' tops on the back wall and the boss's head. */
export interface Tops {
  sign: number;
  boss: number;
}

export const DEFAULT_TOPS: Tops = { sign: 190, boss: 250 };

const RAD = Math.PI / 180;

/** Map units across the screen at the aim point. */
export function spanFor(width: number): number {
  return Math.min(SPAN.max, Math.max(SPAN.min, width / PX_PER_UNIT));
}

/** Vertical field of view (degrees) that shows `span` map units across a screen of this aspect at DISTANCE. */
export function fovFor(span: number, aspect: number): number {
  return (2 * Math.atan(span / (2 * DISTANCE * Math.max(0.2, aspect)))) / RAD;
}

/**
 * Where a map point (x, y, height z) lands on the screen, CSS px from the screen's centre (down positive), for a camera
 * aiming at (cx, cy) on the floor. Ignores the lens shift (it moves everything alike).
 */
export function screenY(y: number, z: number, cy: number, fovDeg: number, height: number): number {
  const s = Math.sin(TILT * RAD);
  const c = Math.cos(TILT * RAD);
  const depth = DISTANCE - (y - cy) * c - z * s;
  const up = -(y - cy) * s + z * c;
  return (-(up / Math.max(1, depth)) / Math.tan((fovDeg * RAD) / 2)) * (height / 2);
}

/** The same for across: CSS px from the screen's centre (right positive). */
export function screenX(x: number, y: number, z: number, cx: number, cy: number, fovDeg: number, height: number): number {
  const s = Math.sin(TILT * RAD);
  const c = Math.cos(TILT * RAD);
  const depth = DISTANCE - (y - cy) * c - z * s;
  return ((x - cx) / Math.max(1, depth) / Math.tan((fovDeg * RAD) / 2)) * (height / 2);
}

export class FollowCam {
  /** Where the camera aims on the floor (x follows the hero; y stays on the arena's middle row). */
  x = 0;
  private vx = 0;
  private lastX = 0;
  private sx = 0;
  private slide = 0;
  private lean = 0;
  private ready = false;
  private readonly shot: Shot = { eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, fov: 45, shift: { x: 0, y: 0 } };

  constructor(
    private readonly bounds: Bounds,
    private readonly tops: Tops = DEFAULT_TOPS,
    private readonly boss: { x: number; y: number } | null = null,
    private readonly zones: readonly Bounds[] = [],
  ) {
    this.x = (bounds.x0 + bounds.x1) / 2;
  }

  /** The middle row of the floor, where the camera always aims. */
  get aimY(): number {
    return (this.bounds.y0 + this.bounds.y1) / 2;
  }

  /**
   * One frame: the hero's position (null: none yet), the screen, and whether to lean towards the boss (the alarm, the
   * stomp). Returns the shot for View.setCamera (the same object each frame: no allocation).
   */
  update(dt: number, hero: { x: number; y: number } | null, screen: Screen, toBoss = false): Shot {
    const b = this.bounds;
    const span = spanFor(screen.width);
    const aspect = screen.width / Math.max(1, screen.height);
    const fov = fovFor(span, aspect);
    const cy = this.aimY;
    const hx = hero ? hero.x : (b.x0 + b.x1) / 2;
    const hy = hero ? hero.y : cy;
    const snap = !this.ready || Math.abs(hx - this.lastX) > SNAP || dt <= 0;
    this.lastX = hx;
    // the hero's speed across, from its smoothed position (a corrected prediction shakes the raw one): the camera
    // aims a little ahead of a running hero
    if (snap) {
      this.vx = 0;
      this.sx = hx;
    } else {
      const sx = this.sx + (hx - this.sx) * (1 - Math.exp(-dt * POS_RATE));
      this.vx += ((sx - this.sx) / dt - this.vx) * (1 - Math.exp(-dt * SPEED_RATE));
      this.sx = sx;
    }
    const run = Math.sign(this.vx) * Math.max(0, Math.abs(this.vx) - IDLE_SPEED);
    // the half-width of the picture at the hero's depth (perspective: nearer rows show fewer units)
    const half = (span / 2) * ((DISTANCE - (hy - cy) * Math.cos(TILT * RAD)) / DISTANCE);
    let goal = hx + run * LEAD;
    for (const z of this.zones) {
      // grows from nothing at the zone's edge: stepping in does not throw the camera
      const inside = Math.min(hx - z.x0, z.x1 - hx, hy - z.y0, z.y1 - hy);
      if (inside > 0) {
        goal += ((z.x0 + z.x1) / 2 - hx) * ZONE_LEAN * Math.min(1, inside / ZONE_RAMP);
        break;
      }
    }
    // the alarm and the stomp: half way to the boss, as long as the hero stays well inside the picture
    this.lean += ((toBoss && this.boss ? 1 : 0) - this.lean) * (snap ? 1 : 1 - Math.exp(-dt * 2.5));
    if (this.boss && this.lean > 0.001) {
      const room = Math.max(0, half - EDGE);
      const want = Math.min(hx + room, Math.max(hx - room, (hx + this.boss.x) / 2));
      goal += (want - goal) * this.lean;
    }
    const lo = b.x0 + span / 2 - OVERSCAN;
    const hi = b.x1 - span / 2 + OVERSCAN;
    goal = lo > hi ? (b.x0 + b.x1) / 2 : Math.min(hi, Math.max(lo, goal));
    this.x = snap ? goal : this.x + (goal - this.x) * (1 - Math.exp(-dt * RATE));

    // up and down: the arena's depth centred in the band; slid when the band is too short for it
    const H = screen.height;
    const bandTop = Math.min(screen.top, H * 0.6) + PAD;
    const bandBottom = Math.max(bandTop + 1, H - screen.bottom - PAD);
    const top = Math.min(screenY(b.y0 + 10, this.tops.sign, cy, fov, H), this.boss ? screenY(this.boss.y, this.tops.boss, cy, fov, H) : 0);
    const bottom = screenY(b.y1 + 25, 0, cy, fov, H);
    let move = (bandTop + bandBottom) / 2 - H / 2 - (top + bottom) / 2;
    const over = bottom - top - (bandBottom - bandTop);
    let want = 0;
    if (over > 0) {
      // the hero's feet and head inside the band, the slide no further than the arena's ends
      const feet = H / 2 + screenY(hy, 0, cy, fov, H) + move;
      if (feet + FEET_PX > bandBottom) want = bandBottom - FEET_PX - feet;
      else if (feet - HEAD_PX < bandTop) want = bandTop + HEAD_PX - feet;
      want = Math.min(over / 2, Math.max(-over / 2, want));
    }
    this.slide = snap ? want : this.slide + (want - this.slide) * (1 - Math.exp(-dt * RATE));
    move += this.slide;
    this.ready = true;

    const s = Math.sin(TILT * RAD);
    const c = Math.cos(TILT * RAD);
    const shot = this.shot;
    shot.target.x = this.x;
    shot.target.y = cy;
    shot.target.z = 0;
    shot.eye.x = this.x;
    shot.eye.y = cy + DISTANCE * c;
    shot.eye.z = DISTANCE * s;
    shot.fov = fov;
    shot.shift.x = 0;
    shot.shift.y = move / H;
    return shot;
  }

  /** Follow from scratch next frame (a new hero, the screen came back). */
  reset(): void {
    this.ready = false;
  }
}
