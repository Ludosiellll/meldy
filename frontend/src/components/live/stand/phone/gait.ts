/**
 * Whether a character on the phone is running, told from its speed frame by frame.
 *
 * A run starts with the first step and ends only after a short stillness. Told from one frame alone, the pose went
 * to «стоит» on every frame without a step — a command or a snapshot a little late — and back to «бежит» on the
 * next: each switch starts the clip again and blends it with the other, so the legs never ran and the character slid
 * (owner's video, 11.11). Pure: no three.js. Tested in gait.test.ts.
 */

/** Seconds without a step after which a run is over: longer than two server ticks, short enough to stop at once. */
export const RUN_REST_S = 0.12;

export interface Gait {
  running: boolean;
  /** Seconds since the last frame with a step. */
  still: number;
}

export function newGait(): Gait {
  return { running: false, still: 0 };
}

/** One frame: `moving` — the character made a step on it; `dt` — the frame's seconds. Returns whether it runs. */
export function gaitStep(g: Gait, moving: boolean, dt: number): boolean {
  if (moving) {
    g.running = true;
    g.still = 0;
  } else if (g.running) {
    g.still += dt > 0 ? dt : 0;
    if (g.still >= RUN_REST_S) g.running = false;
  }
  return g.running;
}
