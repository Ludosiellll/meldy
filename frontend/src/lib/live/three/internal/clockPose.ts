/**
 * The poses of the clock «Дедлайн» in a chase (boss.ts draws them on its bones): three ways of running and three
 * blows. Plain numbers, no three.js, so they are tested as numbers: a run has no jump in it, a blow starts from the
 * run and ends in it.
 */

export function smooth(k: number): number {
  const x = Math.max(0, Math.min(1, k));
  return x * x * (3 - 2 * x);
}

/** How many ways it runs in a chase (setGait) and how many blows it has (strike takes them in turn). */
export const GAITS = 3;
export const STRIKES = 3;
/** A blow of the clock: its length and the moment it comes down, seconds. */
export const STRIKE_S = 0.68;
export const STRIKE_BLOW = 0.22;
/**
 * The clock's pose in a chase. Angles in radians: a leg's or an arm's swing is forward when negative; `az` raises an
 * arm (out and up), `ay` sweeps it forward across the body; `lift` pulls a leg up (0…1); `ring` shakes the bells.
 */
export interface ClockPose {
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  sx: number;
  sy: number;
  legs: [number, number];
  lift: [number, number];
  ax: [number, number];
  ay: [number, number];
  az: [number, number];
  ring: number;
}

const TAU = Math.PI * 2;
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const pair = (a: [number, number], b: [number, number], k: number): [number, number] => [mix(a[0], b[0], k), mix(a[1], b[1], k)];

export function mixPose(a: ClockPose, b: ClockPose, k: number): ClockPose {
  return {
    y: mix(a.y, b.y, k),
    z: mix(a.z, b.z, k),
    rx: mix(a.rx, b.rx, k),
    ry: mix(a.ry, b.ry, k),
    rz: mix(a.rz, b.rz, k),
    sx: mix(a.sx, b.sx, k),
    sy: mix(a.sy, b.sy, k),
    legs: pair(a.legs, b.legs, k),
    lift: pair(a.lift, b.lift, k),
    ax: pair(a.ax, b.ax, k),
    ay: pair(a.ay, b.ay, k),
    az: pair(a.az, b.az, k),
    ring: mix(a.ring, b.ring, k),
  };
}

const STAND: ClockPose = { y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, legs: [0, 0], lift: [0, 0], ax: [0, 0], ay: [0, 0], az: [0.15, 0.15], ring: 0 };

/**
 * How the clock runs, `t` seconds into the chase. 0 — the sprint: it leans into the run, the legs reach far and the
 * foot that comes forward is pulled up, the fists pump against the legs, it lands heavy and stretches in the air.
 * 1 — the stomp: upright, fists over its head, it rocks from foot to foot and the bells ring. 2 — the leaps: it
 * crouches, flies with its fists thrown forward and lands on both feet.
 */
export function runPose(gait: number, t: number): ClockPose {
  if (gait === 1) {
    const p = t * TAU * 1.85;
    const s = Math.sin(p);
    const hit = Math.max(0, Math.cos(2 * p)); // 1 as a foot comes down
    return {
      y: 0.46 * Math.abs(s) ** 0.9,
      z: 0,
      rx: 0.1 + 0.05 * hit,
      ry: 0.1 * s,
      rz: 0.15 * s,
      sx: 1 + 0.09 * hit,
      sy: 1.04 - 0.16 * hit,
      legs: [-0.62 * s, 0.62 * s],
      lift: [0.8 * Math.max(0, Math.cos(p)), 0.8 * Math.max(0, -Math.cos(p))],
      ax: [-0.2, -0.2],
      ay: [0, 0],
      az: [1.45 + 0.22 * Math.sin(2 * p), 1.45 + 0.22 * Math.sin(2 * p + 1.2)],
      ring: 1,
    };
  }
  if (gait === 2) {
    const u = (t * 1.45) % 1;
    if (u < 0.2) {
      const c = smooth(u / 0.2); // the crouch
      return { y: 0, z: 0, rx: 0.18 * c, ry: 0, rz: 0, sx: 1 + 0.12 * c, sy: 1 - 0.2 * c, legs: [0.25 * c, 0.25 * c], lift: [0.45 * c, 0.45 * c], ax: [c, c], ay: [0, 0], az: [0.2, 0.2], ring: 0 };
    }
    if (u < 0.82) {
      const v = (u - 0.2) / 0.62; // in the air
      const off = smooth(v / 0.18);
      const swing = mix(mix(0.25, 0.6, off), -0.45, smooth((v - 0.3) / 0.7));
      const arms = mix(mix(1, -1.5, smooth(v / 0.5)), -0.4, smooth((v - 0.6) / 0.4));
      const spread = 0.2 + 0.5 * Math.sin(Math.PI * v);
      return {
        y: 1.5 * Math.sin(Math.PI * v),
        z: 0,
        rx: mix(mix(0.18, 0.42, off), -0.12, smooth((v - 0.2) / 0.8)),
        ry: 0,
        rz: 0,
        sx: mix(mix(1.12, 0.94, off), 1, smooth((v - 0.18) / 0.82)),
        sy: mix(mix(0.8, 1.14, off), 1, smooth((v - 0.18) / 0.82)),
        legs: [swing, swing + 0.12 * Math.sin(Math.PI * v)],
        lift: [mix(0.45, 0.2, off), mix(0.45, 0.2, off)],
        ax: [arms, arms],
        ay: [0, 0],
        az: [spread, spread],
        ring: 0,
      };
    }
    const w = (u - 0.82) / 0.18; // the landing
    const press = Math.sin(Math.PI * w);
    return {
      y: 0,
      z: 0,
      rx: mix(-0.12, 0, w),
      ry: 0,
      rz: 0,
      sx: 1 + 0.13 * press,
      sy: 1 - 0.22 * press,
      legs: [mix(-0.45, 0, w), mix(-0.45, 0, w)],
      lift: [mix(0.2, 0, w), mix(0.2, 0, w)],
      ax: [mix(-0.4, 0, w), mix(-0.4, 0, w)],
      ay: [0, 0],
      az: [0.2, 0.2],
      ring: w < 0.7 ? 1 : 0,
    };
  }
  const p = t * TAU * 2.5;
  const s = Math.sin(p);
  const hit = Math.max(0, Math.cos(2 * p)); // 1 as a foot comes down
  return {
    y: 0.3 * Math.abs(s),
    z: 0,
    rx: 0.3 + 0.05 * Math.sin(2 * p),
    ry: 0.14 * s,
    rz: -0.06 * s,
    sx: 1 + 0.05 * hit - 0.02 * (1 - hit),
    sy: 1 - 0.07 * hit + 0.05 * (1 - hit),
    legs: [-0.98 * s, 0.98 * s],
    lift: [Math.max(0, Math.cos(p)), Math.max(0, -Math.cos(p))],
    ax: [1.1 * s, -1.1 * s],
    ay: [0, 0],
    az: [-0.45, -0.45], // the fists low at its sides: they pump like a runner's
    ring: 0.3 * hit,
  };
}

/**
 * A blow, `k` seconds in: it winds up (0…0.2 s), comes down at STRIKE_BLOW and gets back into the run. Its arms are
 * short, so every blow is a move of the whole body, read from the far side of a classroom: 0 — the pounce (it jumps
 * and crashes down on its face side); 1 — the whirl (it coils and spins round once, fists flung out; the turn itself
 * is whirl()); 2 — the ram (it pulls back and drives forward). The bells ring from the blow on.
 */
export function strikePose(kind: number, k: number): ClockPose {
  let wind: ClockPose;
  let blow: ClockPose;
  if (kind === 1) {
    wind = { y: 0, z: 0, rx: 0.06, ry: 0, rz: 0, sx: 1.07, sy: 0.9, legs: [0.15, -0.15], lift: [0.2, 0.2], ax: [0.3, 0.3], ay: [0, 0], az: [-0.3, -0.3], ring: 0 };
    blow = { y: 0.3, z: 0.25, rx: 0.1, ry: 0, rz: 0, sx: 0.97, sy: 1.05, legs: [-0.25, 0.25], lift: [0.1, 0.1], ax: [0, 0], ay: [0, 0], az: [1.0, 1.0], ring: 1 };
  } else if (kind === 2) {
    wind = { y: 0.1, z: -0.7, rx: -0.3, ry: 0, rz: 0, sx: 0.95, sy: 1.1, legs: [0.35, 0.35], lift: [0, 0], ax: [0.9, 0.9], ay: [0, 0], az: [0.4, 0.4], ring: 0 };
    blow = { y: 0.3, z: 1.3, rx: 0.5, ry: 0, rz: 0, sx: 1.08, sy: 0.93, legs: [-0.7, 0.75], lift: [0.25, 0], ax: [1.3, 1.3], ay: [0, 0], az: [0.7, 0.7], ring: 1 };
  } else {
    wind = { y: 1.05, z: -0.1, rx: -0.26, ry: 0, rz: 0, sx: 0.94, sy: 1.12, legs: [0.3, 0.3], lift: [0.5, 0.5], ax: [0.4, 0.4], ay: [0, 0], az: [1.5, 1.5], ring: 0 };
    blow = { y: 0, z: 0.7, rx: 0.45, ry: 0, rz: 0, sx: 1.16, sy: 0.8, legs: [-0.45, 0.4], lift: [0, 0], ax: [-1.4, -1.4], ay: [0, 0], az: [0.3, 0.3], ring: 1 };
  }
  if (k < STRIKE_BLOW - 0.02) return mixPose(STAND, wind, smooth(k / 0.18));
  if (k < STRIKE_BLOW + 0.14) return mixPose(wind, blow, smooth((k - (STRIKE_BLOW - 0.02)) / 0.07));
  return mixPose(blow, { ...STAND, ring: 1 }, smooth((k - (STRIKE_BLOW + 0.14)) / 0.3));
}

/**
 * The whirl's turn, radians, added to the pose's own: it coils back a little, then goes round once. It ends a whole
 * turn away, which is where it began, so the run takes over without unwinding it.
 */
export function whirl(kind: number, k: number, left: boolean): number {
  if (kind !== 1) return 0;
  const side = left ? -1 : 1;
  const coil = 0.5 * smooth(k / 0.18) * (1 - smooth((k - 0.18) / 0.1));
  return side * (coil - TAU * smooth((k - (STRIKE_BLOW - 0.04)) / 0.36));
}
