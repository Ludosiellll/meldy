/**
 * How the phone keeps its frames smooth (owner, 21.10: no lag on an ordinary phone, and a weak phone still plays the
 * same 3D game, never a flat one). The phone draws the projector's kit with its own ladder of levels, cheapest last:
 *
 *   0  no outlines (the outlines double every hero's triangles), glows, full resolution (at most 1.25 pixels a point)
 *   1  no glows nor the stomp's shock ring
 *   2  resolution × 0.85
 *   3  resolution × 0.72
 *   4  resolution × 0.6
 *   5  resolution × 0.6 at 30 frames a second: the light view, still 3D
 *
 * The governor steps down when frames run late and back up after a calm stretch (the kit's QualityGovernor), with three
 * guards for a phone: the first 1.5 s after the arena appears (or the tab comes back) are not judged, so a slow start
 * never counts; the slowest fifth of the frames is left out (a garbage collection, a texture upload); a phone far
 * over the budget drops two levels at once. Only a phone without WebGL plays the flat view (sprites.ts).
 *
 * Pure (no three.js); tested in quality.test.ts.
 */
import { QualityGovernor } from '../../../../lib/live/three/quality';

export interface PhoneLevel {
  /** The kit's quality level (QUALITY_LEVELS: 1 no outlines … 5 resolution × 0.6). */
  kit: number;
  /** Frames a second at most (0: every frame the screen shows). */
  fps: number;
}

export const PHONE_LEVELS: readonly PhoneLevel[] = [
  { kit: 1, fps: 0 },
  { kit: 2, fps: 0 },
  { kit: 3, fps: 0 },
  { kit: 4, fps: 0 },
  { kit: 5, fps: 0 },
  { kit: 5, fps: 30 },
];

/** The cheapest level: what a phone pinned to «light» draws. */
export const LIGHT_LEVEL = PHONE_LEVELS.length - 1;
/** Pixels drawn per CSS pixel at most (× the level's resolution). */
export const PHONE_PIXEL_RATIO = 1.25;
/** Seconds after the arena appears that are not judged. */
export const GRACE_S = 1.5;

const BUDGET_MS = 1000 / 60;

export class PhoneGovernor {
  private readonly inner: QualityGovernor;
  private grace = GRACE_S;

  /** `pinned`: the level never moves (a device pinned to 3D or to the light view). */
  constructor(
    start = 0,
    private readonly pinned = false,
  ) {
    this.inner = new QualityGovernor({ budgetMs: BUDGET_MS, levels: PHONE_LEVELS.length, window: 30, maxStep: 2, trim: 0.2, settleS: 1, calmS: 8 });
    this.inner.force(start);
  }

  get level(): number {
    return this.inner.level;
  }

  /** The arena appears (a question starts, the tab comes back): a fresh grace and a fresh window. */
  begin(): void {
    this.grace = GRACE_S;
    this.inner.reset();
  }

  /** One frame's interval, ms. True when the level changed. */
  push(intervalMs: number): boolean {
    if (this.pinned) return false;
    if (this.grace > 0) {
      this.grace -= intervalMs / 1000;
      return false;
    }
    // at a capped level a frame on time is 1000/fps ms: judged against the same budget as the others
    const cap = PHONE_LEVELS[this.inner.level].fps;
    return this.inner.push(cap > 0 ? (intervalMs * cap) / 60 : intervalMs, intervalMs);
  }
}
