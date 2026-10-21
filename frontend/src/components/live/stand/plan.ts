/**
 * The projector's rules of mode A that need no 3D and no React (docs/live/MODE_STAND.md §5, §8, §9): what the timer
 * shows, how a state change plays (a stomp, a return of the floor, or drawn as it is after a reconnect), the floor and
 * the fallen frame by frame on any frame rate, the live counts from the snapshot flags. Pure, tested in plan.test.ts.
 */
import { F_GHOST, F_ICE, KIND_PLAYER, ZONE_SHIFT, type StandState } from '../../../lib/live/move';
import { COLLAPSE, dropHeight } from '../../../lib/live/three/arenaPlan';

/** How long after the stomp a state is still played as news (older: drawn as it is, MODE_STAND §4.2). */
export const STALE_MS = 1000;

/** What the round timer shows: whole seconds left (3-2-1 before the open), and whether the alarm rings. */
export interface TimerFace {
  /** Seconds on the dial, or null (no question). */
  sec: number | null;
  /** The three seconds of the countdown before the question opens. */
  ready: boolean;
  /** The last `alarm_ms` of the question. */
  hot: boolean;
  /** Share of the question's time left, 0…1 (the ring). */
  left: number;
}

export function timerFace(st: StandState | null, now: number | null, alarmMs = 3000): TimerFace {
  if (!st || now === null || st.opens === null || st.closes === null) return { sec: null, ready: false, hot: false, left: 0 };
  if (st.phase === 'countdown' || (st.phase === 'open' && now < st.opens)) {
    const s = Math.max(1, Math.ceil((st.opens - now) / 1000));
    return { sec: Math.min(3, s), ready: true, hot: false, left: 1 };
  }
  if (st.phase === 'open') {
    const ms = st.closes - now;
    const total = Math.max(1, st.closes - st.opens);
    return { sec: Math.max(0, Math.ceil(ms / 1000)), ready: false, hot: ms <= alarmMs, left: Math.min(1, Math.max(0, ms / total)) };
  }
  if (st.phase === 'reveal') return { sec: 0, ready: false, hot: false, left: 0 };
  return { sec: null, ready: false, hot: false, left: 0 };
}

/** How a new `state` plays on screen, given the one before it and the room's clock now. */
export type Change =
  /** open → reveal (or a reveal right after a countdown): the stomp, the floor drops, `res.fell` fall. */
  | 'stomp'
  /** A reveal seen late (a reconnect, a reload): the floor is already down, the fallen are ghosts. */
  | 'down'
  /** The floor comes back: `res.back` live again. */
  | 'up'
  /** A new question: the floor is whole, the zones lit. */
  | 'question'
  /** Anything else: draw as it is. */
  | 'still';

export function changeOf(prev: StandState | null, next: StandState, now: number | null): Change {
  const sameQ = !!prev && prev.qi === next.qi;
  if (next.phase === 'reveal' && next.res) {
    if (next.floor === 'down') {
      const fresh = now === null || now - next.res.at <= STALE_MS;
      const wasOpen = sameQ && (prev!.phase === 'open' || prev!.phase === 'countdown');
      if (wasOpen && fresh) return 'stomp';
      if (!(sameQ && prev!.phase === 'reveal' && prev!.floor === 'down')) return 'down';
      return 'still';
    }
    if (sameQ && prev!.phase === 'reveal' && prev!.floor === 'down') return 'up';
    return 'still';
  }
  if ((next.phase === 'countdown' || next.phase === 'open') && !(sameQ && (prev!.phase === 'countdown' || prev!.phase === 'open'))) return 'question';
  if (prev && prev.floor === 'down' && next.floor === 'up') return 'up';
  return 'still';
}

/** What a frame does about the floor (FloorShow.frame). */
export type FloorStep =
  | { act: 'none' }
  /** The room's `floor: up` waits and this frame would still come before the floor is down: drop it `by` seconds earlier. */
  | { act: 'hurry'; by: number }
  /** The `up` that waited: a frame has shown the floor down, bring it back now. */
  | { act: 'restore' };

const NONE: FloorStep = { act: 'none' };
const RESTORE: FloorStep = { act: 'restore' };

/**
 * The floor between the stomp and its return as the projector draws it, on any frame rate (MODE_STAND §9). The room
 * says `floor: up` 4 s (room time) after the result; the scene draws the drop on the kit's clock, one frame at a time.
 * A frame drawn at or after `downBy` (kit seconds) shows the floor down. The room's `up` waits for such a frame; a
 * frame that would still come before `downBy` while it waits (the loop was stopped: a hidden tab) moves the drop to
 * itself, so that it shows the floor down with the fallen in their fall, and the frame after it brings the floor back.
 * So the floor is drawn down at least once, however slow or late the frames, and for its whole down time when the kit's
 * clock keeps real time.
 */
export class FloorShow {
  private downBy = Infinity;
  private drawn = false;
  private waiting = false;

  /** A collapse is planned: from kit second `downBy` a frame shows the floor down. */
  drop(downBy: number): void {
    this.downBy = downBy;
    this.drawn = false;
    this.waiting = false;
  }

  /** Nothing dropped (a new question; the arena's screens off; the floor back). */
  reset(): void {
    this.downBy = Infinity;
    this.drawn = false;
    this.waiting = false;
  }

  /** The room's `floor: up`: true when the floor may come back now; false when it waits for a frame showing it down. */
  up(): boolean {
    if (this.downBy === Infinity || this.drawn) {
      this.reset();
      return true;
    }
    this.waiting = true;
    return false;
  }

  /** The room's `up` is waiting for a frame. */
  get waits(): boolean {
    return this.waiting;
  }

  /** Before a frame that will be drawn at kit second `at`. */
  frame(at: number): FloorStep {
    if (this.downBy === Infinity) return NONE;
    if (this.waiting && this.drawn) {
      this.reset();
      return RESTORE;
    }
    if (at >= this.downBy) {
      this.drawn = true;
      return NONE;
    }
    if (!this.waiting) return NONE;
    const by = this.downBy - at;
    this.downBy = at;
    this.drawn = true;
    return { act: 'hurry', by };
  }
}

/** A fallen character drops this long before it rises as a ghost, seconds. */
export const FALL_S = 0.75;
/** How long a ghost takes to climb out of the pit, seconds. */
export const RISE_S = 1.0;
/** A fall is seen once a frame shows it this far in (~70 map units down); a frame that would skip that shows it so. */
const FALL_SEEN_S = 0.33;

/** A character of `res.fell`, kit seconds: its tile starts to drop; it rises as a ghost; whether its tile drops at all. */
export interface FallPlan {
  start: number;
  rise: number;
  tile: boolean;
  /** A frame has drawn it at least FALL_SEEN_S into its fall. */
  drawn: boolean;
}

/** How a fallen character is drawn in one frame: in the pit (held where it stood) at height `z`, or climbing out. */
export type FallFrame = { pit: true; z: number; falling: boolean } | { pit: false; climb: number };

/**
 * A fallen character in the frame drawn at kit second `at`: still on its shaking tile, dropping with it (or by itself
 * when its tile stays: a phone gone away), then climbing out as a ghost (`climb` 0…1). Every fallen character is
 * drawn falling in at least one frame: a frame that comes after its whole fall without one (a slow projector) shows
 * it in the fall, and its climb starts from that frame.
 */
export function fallFrame(f: FallPlan, at: number): FallFrame {
  if (at < f.start) return { pit: true, z: 0, falling: false };
  let u = at - f.start;
  if (at >= f.rise) {
    if (f.drawn) return { pit: false, climb: (at - f.rise) / RISE_S };
    // no frame showed its fall deep enough (it fell between two frames): this one does, the climb starts after it
    f.rise = at;
    u = FALL_SEEN_S;
  }
  if (u >= FALL_SEEN_S) f.drawn = true;
  const z = f.tile ? dropHeight(f.start + u, f.start) : -650 * u * u;
  return { pit: true, z: Math.max(COLLAPSE.gone, z), falling: true };
}

/**
 * Players per zone from the flags of a frame's poses (MOVE.md §4: bits 8–15 the zone + 1), ghosts too (as the
 * server's `counts`), how many are alive and ghosts, and (a mixed game) how many carry the battle's ice. `out` is
 * reused: no allocation per frame.
 */
export function tally(flags: Iterable<number>, zones: number, out: { counts: number[]; alive: number; ghosts: number; iced?: number }): void {
  out.counts.length = zones;
  out.counts.fill(0);
  out.alive = 0;
  out.ghosts = 0;
  out.iced = 0;
  for (const f of flags) {
    if ((f & 3) !== KIND_PLAYER) continue;
    if (f & F_ICE) out.iced++;
    if (f & F_GHOST) out.ghosts++;
    else out.alive++;
    const z = (f >> ZONE_SHIFT) - 1;
    if (z >= 0 && z < zones) out.counts[z]++;
  }
}

/** Name of the fastest from the room's roster (the host's roster has names), or null. */
export function fastestName(st: StandState | null, nameOf: (id: number) => string | null): { name: string; pts: number } | null {
  const f = st?.res?.fastest;
  if (!f || f.id === null) return null;
  const name = nameOf(f.id);
  return name ? { name, pts: f.pts } : null;
}

/** Ease out with a small overshoot (a ghost rising out of the pit). */
export function easeOutBack(k: number): number {
  const u = Math.min(1, Math.max(0, k));
  const c1 = 1.70158;
  return 1 + (c1 + 1) * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
}
