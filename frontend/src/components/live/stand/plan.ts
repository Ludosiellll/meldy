/**
 * The projector's rules of mode A that need no 3D and no React (docs/live/MODE_STAND.md §5, §8, §9): what the timer
 * shows, how a state change plays (a stomp, a return of the floor, or drawn as it is after a reconnect), the live
 * counts from the snapshot flags. Pure, tested in plan.test.ts.
 */
import { F_GHOST, KIND_PLAYER, ZONE_SHIFT, type StandState } from '../../../lib/live/move';

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

/**
 * Players per zone from the flags of a frame's poses (MOVE.md §4: bits 8–15 the zone + 1), ghosts too (as the
 * server's `counts`), and how many are alive and ghosts. `out` is reused: no allocation per frame.
 */
export function tally(flags: Iterable<number>, zones: number, out: { counts: number[]; alive: number; ghosts: number }): void {
  out.counts.length = zones;
  out.counts.fill(0);
  out.alive = 0;
  out.ghosts = 0;
  for (const f of flags) {
    if ((f & 3) !== KIND_PLAYER) continue;
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
