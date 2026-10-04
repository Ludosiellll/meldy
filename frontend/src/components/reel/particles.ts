/**
 * Particles of the reel, drawn on a canvas. Each one is a pure function of time (no simulation
 * state), made from a seed, so a frame looks the same however the reel got there.
 */
import { clamp, ease, mix, rng } from './timeline';

export type Shape = 'dot' | 'dash';

export interface Particle {
  angle: number;
  distance: number;
  size: number;
  shape: Shape;
  color: string;
  delay: number;
  spin: number;
  /** 0..1, used for per-particle variation of speed and fade. */
  jitter: number;
}

export interface BurstOptions {
  count: number;
  colors: readonly string[];
  /** Distance range in stage pixels. */
  near: number;
  far: number;
  /** Share of dashes (the rest are dots). */
  dashes?: number;
  size?: [number, number];
  /** Spread of the start in milliseconds. */
  delay?: number;
}

export function makeBurst(seed: number, options: BurstOptions): Particle[] {
  const random = rng(seed);
  const [minSize, maxSize] = options.size ?? [2, 5];
  return Array.from({ length: options.count }, () => ({
    angle: random() * Math.PI * 2,
    distance: mix(options.near, options.far, Math.pow(random(), 0.7)),
    size: mix(minSize, maxSize, random()),
    shape: random() < (options.dashes ?? 0.5) ? 'dash' : 'dot',
    color: options.colors[Math.floor(random() * options.colors.length)],
    delay: random() * (options.delay ?? 120),
    spin: (random() - 0.5) * 0.6,
    jitter: random(),
  }));
}

function drawOne(ctx: CanvasRenderingContext2D, particle: Particle, x: number, y: number, alpha: number, length: number, angle: number) {
  if (alpha <= 0.01) return;
  ctx.globalAlpha = clamp(alpha);
  ctx.fillStyle = particle.color;
  ctx.strokeStyle = particle.color;
  if (particle.shape === 'dot') {
    ctx.beginPath();
    ctx.arc(x, y, particle.size, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const dx = Math.cos(angle) * length * 0.5;
  const dy = Math.sin(angle) * length * 0.5;
  ctx.lineWidth = Math.max(1.5, particle.size * 0.75);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - dx, y - dy);
  ctx.lineTo(x + dx, y + dy);
  ctx.stroke();
}

/**
 * Particles flying out of (x, y): `elapsed` ms since the burst, `duration` its length. Dashes point
 * along their way and get longer while they are fast, like a motion streak.
 */
export function drawBurst(
  ctx: CanvasRenderingContext2D,
  particles: readonly Particle[],
  x: number,
  y: number,
  elapsed: number,
  duration: number,
) {
  if (elapsed < 0 || elapsed > duration + 200) return;
  for (const particle of particles) {
    const local = (elapsed - particle.delay) / (duration * mix(0.75, 1, particle.jitter));
    if (local <= 0 || local >= 1) continue;
    const travel = ease.out(local);
    const speed = 1 - local;
    const px = x + Math.cos(particle.angle) * particle.distance * travel;
    const py = y + Math.sin(particle.angle) * particle.distance * travel + 40 * local * local * particle.jitter;
    const alpha = local < 0.1 ? local / 0.1 : 1 - ease.in((local - 0.1) / 0.9);
    const length = particle.size * 3 + 26 * speed * speed;
    drawOne(ctx, particle, px, py, alpha, length, particle.angle + particle.spin * local);
  }
}

/**
 * Particles gathering into a point: they start scattered on a ring around (x, y) at their own
 * distance, swirl in and fade out as they arrive (`progress` 0..1).
 */
export function drawGather(
  ctx: CanvasRenderingContext2D,
  particles: readonly Particle[],
  x: number,
  y: number,
  progress: number,
  spreadX = 1,
) {
  if (progress <= 0 || progress >= 1) return;
  for (const particle of particles) {
    const local = clamp((progress - particle.jitter * 0.25) / 0.75);
    if (local <= 0 || local >= 1) continue;
    const pull = ease.inOut(local);
    const radius = particle.distance * (1 - pull);
    const angle = particle.angle + (1 - pull) * 0.9 * (particle.spin > 0 ? 1 : -1);
    const px = x + Math.cos(angle) * radius * spreadX;
    const py = y + Math.sin(angle) * radius;
    const alpha = Math.min(local / 0.15, 1) * (1 - ease.in(clamp((local - 0.7) / 0.3)));
    drawOne(ctx, particle, px, py, alpha, particle.size * 2 + 18 * Math.sin(Math.PI * local), angle + Math.PI / 2);
  }
}

export interface Mote {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  phase: number;
  speed: number;
}

/** Slow dust over the whole stage. */
export function makeDust(seed: number, count: number, width: number, height: number): Mote[] {
  const random = rng(seed);
  return Array.from({ length: count }, () => ({
    x: random() * width,
    y: random() * height,
    r: mix(0.6, 2.2, random() ** 2),
    vx: (random() - 0.5) * 0.012,
    vy: -mix(0.004, 0.02, random()),
    phase: random() * Math.PI * 2,
    speed: mix(0.0008, 0.0025, random()),
  }));
}

export function drawDust(
  ctx: CanvasRenderingContext2D,
  motes: readonly Mote[],
  t: number,
  width: number,
  height: number,
  color: string,
  strength = 1,
) {
  ctx.fillStyle = color;
  for (const mote of motes) {
    const x = (((mote.x + mote.vx * t) % width) + width) % width;
    const y = (((mote.y + mote.vy * t) % height) + height) % height;
    const twinkle = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * mote.speed + mote.phase));
    ctx.globalAlpha = clamp(twinkle * strength * 0.55);
    ctx.beginPath();
    ctx.arc(x, y, mote.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A thin ring growing from (x, y): radius from r0 to r1 and fading over `progress` 0..1. */
export function drawRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r0: number,
  r1: number,
  progress: number,
  color: string,
  width = 2,
  strength = 1,
) {
  if (progress <= 0 || progress >= 1) return;
  const radius = mix(r0, r1, ease.out(progress));
  ctx.globalAlpha = clamp((1 - progress) * strength);
  ctx.strokeStyle = color;
  ctx.lineWidth = width * (1 - progress * 0.6);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

/** Prepares a full-stage canvas for one frame: clears it and resets the drawing state. */
export function beginFrame(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, width, height);
}
