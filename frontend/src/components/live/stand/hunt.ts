/**
 * How «Дедлайн» and its copies look in a chase (mode B, docs/live/MODE_RUN.md), for the projector's scene and the
 * phone's alike. The room only says where each hunter is; what the hunter does with its body is decided here:
 *
 * - it runs while it moves, each hunter of a chase its own way (Boss.setGait);
 * - when a character it may catch is within a lunge, it deals a blow (Boss.strike), not more often than LUNGE_EVERY;
 *   the blow that follows a catch comes down at once;
 * - the room holds a hunter still for a second after its catch: once the blow is dealt it stands and rings over the
 *   caught one, and runs on when the room moves it again.
 *
 * (Before 18.11 the lead was put into «roar» at its first catch and stayed in it: it slid over the floor with its
 * arms up for the rest of the chase.)
 */
import type { Boss } from '../../../lib/live/three';
import { F_AWAY, F_CAUGHT, F_GHOST, KIND_PLAYER } from '../../../lib/live/move/protocol';

/** A character this near (map units; the room's catch reach is about 44) is lunged at. */
export const LUNGE_RANGE = 96;
/** Seconds between two blows of one hunter. */
export const LUNGE_EVERY = 1.5;
/** Still for this long, with its blow dealt: it rings over its catch. */
const STILL_S = 0.22;

/** Whether a hunter may be after this entity: a player on the floor, not caught and not a ghost. */
export function isPrey(flags: number): boolean {
  return (flags & 3) === KIND_PLAYER && (flags & (F_AWAY | F_CAUGHT | F_GHOST)) === 0;
}

export class Hunter {
  private still = 0;
  private clock = 0;
  private struck = -Infinity;

  constructor(
    readonly model: Boss,
    gait: number,
    public x: number,
    public y: number,
  ) {
    model.setGait(gait);
  }

  /** A frame: the hunter is at x, y (map units); `prey` — how far the nearest character it may catch is, null — none. */
  frame(x: number, y: number, dt: number, prey: number | null): void {
    const model = this.model;
    const dx = x - this.x;
    const dy = y - this.y;
    const moved = dx * dx + dy * dy > 0.25;
    if (moved) model.setFacing(Math.atan2(dx, dy));
    this.x = x;
    this.y = y;
    model.setPosition(x, y);
    const step = Math.max(dt, 0);
    this.clock += step;
    if (moved) {
      this.still = 0;
      if (model.phase !== 'chase') model.setPhase('chase');
    } else {
      this.still += step;
      if (this.still > STILL_S && model.phase === 'chase' && !model.striking) model.setPhase('roar');
    }
    if (model.phase === 'chase' && !model.striking && prey !== null && prey <= LUNGE_RANGE && this.clock - this.struck >= LUNGE_EVERY) {
      this.struck = this.clock;
      model.strike(false);
    }
  }

  /** It caught a character: the blow comes down at once, unless a lunge is already in the air. */
  caught(): void {
    this.struck = this.clock;
    if (!this.model.striking) this.model.strike(true);
  }
}

/** The distance from x, y to the nearest entity a hunter may catch; null — there is none. */
export function nearestPrey(x: number, y: number, entities: Iterable<{ x: number; y: number; flags: number }>): number | null {
  let best = Infinity;
  for (const e of entities) {
    if (!isPrey(e.flags)) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d < best) best = d;
  }
  return best === Infinity ? null : Math.sqrt(best);
}

/** The hunter nearest to x, y (the one that made a catch there); null — no hunter. */
export function nearestHunter(x: number, y: number, hunters: Iterable<Hunter>): Hunter | null {
  let best: Hunter | null = null;
  let d2 = Infinity;
  for (const h of hunters) {
    const d = (h.x - x) ** 2 + (h.y - y) ** 2;
    if (d < d2) {
      d2 = d;
      best = h;
    }
  }
  return best;
}
