/**
 * Everyone else on screen: snapshots arrive ~10 times a second with jitter, so other characters are drawn a little in
 * the past (`delayMs`, about 100 ms) between the two snapshots around that moment. Past the newest snapshot they are
 * carried on along their last motion for at most `maxExtrapolateMs`, then held.
 */
import type { Entity, Snapshot } from './protocol';

export interface Pose {
  x: number;
  y: number;
  flags: number;
}

/**
 * The server's clock as seen here: server ms ≈ local ms + offset. Each snapshot gives offset + (its delay on the way);
 * the least delayed one of the last `window` is the best guess. The estimate moves by at most `slewMs` per snapshot so
 * the picture never jumps, unless it is off by more than `jumpMs` (a tab woken from sleep).
 */
export class ServerClock {
  private samples: number[] = [];
  private offset: number | null = null;

  constructor(
    private readonly window = 20,
    private readonly slewMs = 4,
    private readonly jumpMs = 500,
  ) {}

  sample(serverMs: number, localMs: number): void {
    this.samples.push(serverMs - localMs);
    if (this.samples.length > this.window) this.samples.shift();
    const target = Math.max(...this.samples);
    if (this.offset === null || Math.abs(target - this.offset) > this.jumpMs) this.offset = target;
    else this.offset += Math.max(-this.slewMs, Math.min(this.slewMs, target - this.offset));
  }

  /** Server ms now, or null before the first snapshot. */
  now(localMs: number): number | null {
    return this.offset === null ? null : localMs + this.offset;
  }

  reset(): void {
    this.samples = [];
    this.offset = null;
  }
}

export interface BufferOptions {
  size?: number;
  maxExtrapolateMs?: number;
  /** A move longer than this between two snapshots is a teleport (respawn, catch): no sliding across the map. */
  teleport?: number;
}

export class SnapshotBuffer {
  private snaps: Snapshot[] = [];
  private readonly size: number;
  private readonly maxExtrapolateMs: number;
  private readonly teleport: number;

  constructor(o: BufferOptions = {}) {
    this.size = o.size ?? 32;
    this.maxExtrapolateMs = o.maxExtrapolateMs ?? 100;
    this.teleport = o.teleport ?? 150;
  }

  /** Adds a snapshot; an old or repeated tick is ignored. */
  push(s: Snapshot): void {
    const last = this.snaps[this.snaps.length - 1];
    if (last && s.tick <= last.tick) return;
    this.snaps.push(s);
    if (this.snaps.length > this.size) this.snaps.shift();
  }

  latest(): Snapshot | null {
    return this.snaps[this.snaps.length - 1] ?? null;
  }

  clear(): void {
    this.snaps = [];
  }

  /** Every entity's pose at server time `t` (ms). */
  sample(t: number): Map<number, Pose> {
    const out = new Map<number, Pose>();
    const s = this.snaps;
    if (s.length === 0) return out;
    const last = s[s.length - 1];
    if (t >= last.t) {
      const prev = s.length > 1 ? s[s.length - 2] : null;
      const ahead = Math.min(t - last.t, this.maxExtrapolateMs);
      const before = prev ? index(prev.ents) : null;
      for (const e of last.ents) {
        const p = before?.get(e.id);
        if (!p || !prev || ahead <= 0 || this.jumped(p, e)) {
          out.set(e.id, { x: e.x, y: e.y, flags: e.flags });
          continue;
        }
        const k = ahead / (last.t - prev.t);
        out.set(e.id, { x: e.x + (e.x - p.x) * k, y: e.y + (e.y - p.y) * k, flags: e.flags });
      }
      return out;
    }
    if (t <= s[0].t) {
      for (const e of s[0].ents) out.set(e.id, { x: e.x, y: e.y, flags: e.flags });
      return out;
    }
    let i = s.length - 2;
    while (i > 0 && s[i].t > t) i--;
    const a = s[i];
    const b = s[i + 1];
    const alpha = (t - a.t) / (b.t - a.t);
    const from = index(a.ents);
    for (const e of b.ents) {
      const p = from.get(e.id);
      if (!p) {
        out.set(e.id, { x: e.x, y: e.y, flags: e.flags });
      } else if (this.jumped(p, e)) {
        const q = alpha < 0.5 ? p : e;
        out.set(e.id, { x: q.x, y: q.y, flags: q.flags });
      } else {
        out.set(e.id, { x: p.x + (e.x - p.x) * alpha, y: p.y + (e.y - p.y) * alpha, flags: alpha < 0.5 ? p.flags : e.flags });
      }
    }
    return out;
  }

  private jumped(a: Entity, b: Entity): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy > this.teleport * this.teleport;
  }
}

function index(ents: Entity[]): Map<number, Entity> {
  const m = new Map<number, Entity>();
  for (const e of ents) m.set(e.id, e);
  return m;
}
