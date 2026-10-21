/**
 * Adaptive quality for the projector. Pure: fed with frame times, it says which level to draw at.
 *
 * A level first drops the outlines, then the extra effects (glows, the shock ring), and only then lowers the render
 * scale step by step. It goes back up after a long calm stretch; a level that failed waits twice as long each time,
 * so a laptop that just manages does not flicker between two levels. The phone runs the same governor over a ladder
 * of its own (components/live/stand/phone/quality.ts: `levels`, `maxStep`, `trim`).
 */

export interface QualityLevel {
  outlines: boolean;
  effects: boolean;
  /** Multiplies the pixel ratio (itself at most 1.5). */
  scale: number;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = [
  { outlines: true, effects: true, scale: 1 },
  { outlines: false, effects: true, scale: 1 },
  { outlines: false, effects: false, scale: 1 },
  { outlines: false, effects: false, scale: 0.85 },
  { outlines: false, effects: false, scale: 0.72 },
  { outlines: false, effects: false, scale: 0.6 },
];

export interface GovernorOptions {
  /** Frame time the screen must keep, ms (60 fps: 16.7). */
  budgetMs?: number;
  /** Frames in the rolling window. */
  window?: number;
  /** Seconds between two steps down. */
  settleS?: number;
  /** Seconds of calm before a first step up. */
  calmS?: number;
  /** How many levels the ladder has (default QUALITY_LEVELS.length; a phone keeps its own ladder). */
  levels?: number;
  /**
   * Levels one step may drop when the mean is far over the budget (default 1): with 2, a mean over twice the budget
   * drops two levels at once, so a weak phone reaches a level it can draw in seconds, not a dozen.
   */
  maxStep?: number;
  /**
   * Share of the window's slowest frames left out of the mean (default 0): with 0.2, a garbage collection or a
   * texture upload now and then does not count, a phone that is slow most of the time still steps down.
   */
  trim?: number;
}

export class QualityGovernor {
  level = 0;
  private readonly budget: number;
  private readonly times: Float32Array;
  private filled = 0;
  private at = 0;
  private sum = 0;
  private sinceChange = 0;
  private calm = 0;
  private readonly settle: number;
  private readonly calmNeed: number;
  private readonly levels: number;
  private readonly maxStep: number;
  private readonly trim: number;
  private readonly sorted: Float32Array;
  /** How many times each level was given up for being too slow. */
  private readonly failures: Uint8Array;

  constructor(options: GovernorOptions = {}) {
    this.budget = options.budgetMs ?? 1000 / 60;
    this.times = new Float32Array(options.window ?? 45);
    this.settle = options.settleS ?? 1;
    this.calmNeed = options.calmS ?? 6;
    this.levels = Math.max(1, options.levels ?? QUALITY_LEVELS.length);
    this.maxStep = Math.max(1, options.maxStep ?? 1);
    this.trim = Math.min(0.5, Math.max(0, options.trim ?? 0));
    this.sorted = new Float32Array(this.times.length);
    this.failures = new Uint8Array(this.levels);
  }

  /** Rolling mean frame time, ms (0 before the first frame). */
  get mean(): number {
    return this.filled ? this.sum / this.filled : 0;
  }

  /**
   * Feeds one frame's time (ms between two frames). Returns true when the level changed. `elapsedMs` is the real time
   * the frame took when it differs from what is judged (a renderer capped at 30 fps judges 33 ms as 16.7): the settle
   * and calm waits run on it.
   */
  push(frameMs: number, elapsedMs = frameMs): boolean {
    const ms = frameMs > 250 ? 250 : frameMs < 0 ? 0 : frameMs;
    const real = elapsedMs > 250 ? 250 : elapsedMs < 0 ? 0 : elapsedMs;
    if (this.filled === this.times.length) this.sum -= this.times[this.at];
    else this.filled++;
    this.times[this.at] = ms;
    this.sum += ms;
    this.at = (this.at + 1) % this.times.length;
    this.sinceChange += real / 1000;
    if (this.filled < this.times.length) return false;
    const mean = this.trim > 0 ? this.trimmedMean() : this.sum / this.filled;
    // Missing a vsync now and then (17–18 ms) is not slow; a mean 10 % over the budget is.
    if (mean > this.budget * 1.1) {
      this.calm = 0;
      if (this.sinceChange >= this.settle && this.level < this.levels - 1) {
        if (this.failures[this.level] < 255) this.failures[this.level]++;
        const step = Math.min(this.maxStep, Math.max(1, Math.floor(mean / (this.budget * 1.1))));
        return this.change(Math.min(this.levels - 1, this.level + step));
      }
      return false;
    }
    if (mean < this.budget * 1.04 && this.level > 0) {
      this.calm += real / 1000;
      const fails = this.failures[this.level - 1];
      const wait = this.calmNeed * Math.pow(2, Math.max(0, fails - 1));
      if (this.calm >= wait && fails < 4) return this.change(this.level - 1);
    } else {
      this.calm = 0;
    }
    return false;
  }

  /** The mean of the window without its slowest `trim` share (no allocation: a scratch array sorted in place). */
  private trimmedMean(): number {
    const s = this.sorted;
    s.set(this.times);
    s.sort();
    const keep = Math.max(1, Math.ceil(s.length * (1 - this.trim)));
    let sum = 0;
    for (let i = 0; i < keep; i++) sum += s[i];
    return sum / keep;
  }

  /** Pins a level (0 = best); `auto` false stops the governor from moving it. */
  force(level: number): void {
    this.level = Math.max(0, Math.min(this.levels - 1, Math.round(level)));
    this.reset();
  }

  /** Forgets the window, e.g. after the tab was hidden. */
  reset(): void {
    this.filled = 0;
    this.at = 0;
    this.sum = 0;
    this.calm = 0;
    this.sinceChange = 0;
  }

  private change(level: number): boolean {
    this.level = level;
    this.reset();
    return true;
  }
}
