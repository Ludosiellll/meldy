/**
 * What a player's body is doing, frame by frame. Pure: no three.js, no allocation per frame.
 *
 * The clips are baked into a texture at load (one row per 1/30 s), so a pose is just two frame numbers and a blend
 * weight per player per frame: the current clip's frame and, for 0.15 s after a switch, the previous clip's frame
 * fading out.
 */

export type Pose = 'idle' | 'run' | 'jump' | 'fall' | 'cheer' | 'hit' | 'lie' | 'wave';

export const POSES: readonly Pose[] = ['idle', 'run', 'jump', 'fall', 'cheer', 'hit', 'lie', 'wave'];

/**
 * - `loop`: plays round and round;
 * - `once`: plays once, then goes back to the last looping pose asked for (a run or idle asked during a hit waits);
 * - `hold`: plays once and stays on its last frame until another pose is asked for.
 */
export type PoseEnd = 'loop' | 'once' | 'hold';

export interface PoseClip {
  /** The KayKit clip's name. */
  clip: string;
  end: PoseEnd;
}

export const POSE_CLIPS: Readonly<Record<Pose, PoseClip>> = {
  idle: { clip: 'Idle', end: 'loop' },
  run: { clip: 'Running_A', end: 'loop' },
  jump: { clip: 'Jump_Full_Short', end: 'once' },
  fall: { clip: 'Jump_Idle', end: 'loop' },
  cheer: { clip: 'Cheer', end: 'loop' },
  hit: { clip: 'Hit_B', end: 'once' },
  lie: { clip: 'Death_A', end: 'hold' },
  wave: { clip: 'Interact', end: 'loop' },
};

/** Frames baked per second of a clip. */
export const BAKE_FPS = 30;
/** How long a switch blends the old clip into the new one, in seconds. */
export const FADE_S = 0.15;

/** Where a clip's frames are in the baked texture. */
export interface BakedClip {
  /** Row of the clip's first frame. */
  row: number;
  /** Rows the clip has: ceil(duration × BAKE_FPS) + 1 (the last one is the clip's end, the first again for a loop). */
  rows: number;
  duration: number;
}

/** Rows a clip of this length needs in the texture. */
export function bakedRows(duration: number): number {
  return Math.max(1, Math.ceil(duration * BAKE_FPS - 1e-6)) + 1;
}

/** The baked frame (row + fraction) to show `t` seconds into a clip. Loops wrap; the rest stop on the last frame. */
export function clipFrame(clip: BakedClip, t: number, loop: boolean): number {
  const d = clip.duration;
  let local: number;
  if (loop) {
    local = d > 0 ? t - Math.floor(t / d) * d : 0;
  } else {
    local = t < 0 ? 0 : t > d ? d : t;
  }
  let f = local * BAKE_FPS;
  const last = clip.rows - 1 - 1e-3;
  if (f > last) f = last;
  return clip.row + f;
}

/** One player's pose over time. */
export class PoseMachine {
  /** The pose being shown. */
  pose: Pose = 'idle';
  /** Seconds into the shown pose's clip. */
  t = 0;
  /** The looping pose to go back to after a `once` pose. */
  base: Pose = 'idle';
  private prev: Pose = 'idle';
  private prevT = 0;
  /** Seconds of fade left (0: no previous clip shown). */
  private fade = 0;

  constructor(
    private readonly clips: Readonly<Record<Pose, BakedClip>>,
    /** Where idle starts, 0…1 of its clip: crowds do not breathe in step. */
    phase = 0,
  ) {
    this.t = phase * clips.idle.duration;
  }

  /** True while a `once` pose has not reached its end. */
  get busy(): boolean {
    return POSE_CLIPS[this.pose].end === 'once' && this.t < this.clips[this.pose].duration;
  }

  set(next: Pose): void {
    const end = POSE_CLIPS[next].end;
    if (end === 'loop') {
      this.base = next;
      // A fall cannot wait for a hit to end: the floor is gone.
      if (this.pose === next || (this.busy && next !== 'fall')) return;
    } else if (next === this.pose && (end === 'hold' || this.busy)) {
      return;
    }
    this.switchTo(next);
  }

  step(dt: number): void {
    if (!(dt > 0)) return;
    this.t += dt;
    if (this.fade > 0) {
      this.prevT += dt;
      this.fade = Math.max(0, this.fade - dt);
    }
    const end = POSE_CLIPS[this.pose].end;
    if (end === 'once' && this.t >= this.clips[this.pose].duration) this.switchTo(this.base);
  }

  /** Writes [frame now, previous frame, previous weight] at `out[at…at+2]`. */
  sample(out: Float32Array, at: number): void {
    out[at] = clipFrame(this.clips[this.pose], this.t, POSE_CLIPS[this.pose].end === 'loop');
    if (this.fade > 0) {
      out[at + 1] = clipFrame(this.clips[this.prev], this.prevT, POSE_CLIPS[this.prev].end === 'loop');
      out[at + 2] = this.fade / FADE_S;
    } else {
      out[at + 1] = out[at];
      out[at + 2] = 0;
    }
  }

  private switchTo(next: Pose): void {
    this.prev = this.pose;
    this.prevT = this.t;
    this.fade = FADE_S;
    this.pose = next;
    this.t = 0;
  }
}
