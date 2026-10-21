/**
 * Two footages of one moment kept in step (lib/footage.ts: STAND_RUN on the projector and STAND_RUN_PHONE on a phone,
 * frame k of one is the moment of frame k of the other). A video is steered to the time it should show: while it plays,
 * a small gap is closed by playing a little faster or slower for a moment (no seek, so no stall and no jump), a large one
 * by a seek; while it waits, it is sought to its frame.
 *
 * The landing's section «Игра в классе» lets the phone follow the projector (`follow`); the reel's scene «Игра в классе»
 * steers both to its own clock (`steer`).
 */

/** What steering needs of a video (an HTMLVideoElement; a plain object in tests). */
export interface Steered {
  currentTime: number;
  playbackRate: number;
  readonly paused: boolean;
  readonly readyState: number;
  play(): Promise<void> | void;
  pause(): void;
}

/**
 * A playing video further than this from its time is brought back (s): half a frame at 25 fps, so the two screens show
 * the same frame. Two videos playing at 1× keep their gap, so this is mostly the gap a video starts with (some 25 ms
 * behind its lead in Chrome), closed in a quarter of a second.
 */
export const SNAP = 0.02;
/** A video brought back plays at 1× again once this near (s). */
export const SETTLE = 0.005;
/** Further than this, a playing video is sought at once (s); nearer, its rate closes the gap within about a second. */
export const JUMP = 0.5;
/** A waiting video further than this from its frame is sought to it (s). */
export const HOLD = 0.02;

/**
 * `want − at` (s): how far the video is behind (positive) or ahead. On a loop of `loop` s (the landing's footage loops)
 * the shorter way round: a video at 10.78 s of a 10.8 s loop is 0.04 s behind one at 0.02 s, not 10.76 s ahead.
 */
export function gap(want: number, at: number, loop = 0): number {
  const d = want - at;
  if (!(loop > 0)) return d;
  return ((((d + loop / 2) % loop) + loop) % loop) - loop / 2;
}

/** The rate that closes a gap of `d` s: a step faster (behind) or slower (ahead), larger for a larger gap. */
export function catchUpRate(d: number): number {
  const size = Math.abs(d);
  const step = size > 0.25 ? 0.3 : size > 0.12 ? 0.15 : 0.08;
  return 1 + Math.sign(d) * step;
}

/**
 * Puts `video` on time `want`: playing (`playing`) at `base`× — 1×, or the rate of the video it follows, which may itself
 * be catching up — or waiting on that frame. Nothing before the video has a frame. Each call writes only what has to
 * change, so it can run on every animation frame.
 */
export function steer(video: Steered, want: number, playing: boolean, loop = 0, base = 1): void {
  if (video.readyState < 2) return;
  const d = gap(want, video.currentTime, loop);
  if (!playing) {
    if (!video.paused) video.pause();
    if (video.playbackRate !== 1) video.playbackRate = 1;
    if (Math.abs(d) > HOLD) video.currentTime = want;
    return;
  }
  let rate = video.playbackRate;
  if (Math.abs(d) > JUMP) {
    video.currentTime = want;
    rate = base;
  } else if (Math.abs(d) > SNAP || (rate !== base && Math.abs(d) > SETTLE)) {
    rate = base * catchUpRate(d);
  } else {
    rate = base;
  }
  if (video.playbackRate !== rate) video.playbackRate = rate;
  if (video.paused) {
    const started = video.play();
    // Refused (a power saver): it stays on its frame, and the next call asks again.
    if (started && typeof started.catch === 'function') started.catch(() => undefined);
  }
}

/** What following needs of the two videos: steering, and the events that say the lead started, stopped or jumped. */
export interface Followed extends Steered {
  readonly seeking: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

const LEAD_EVENTS = ['play', 'playing', 'pause', 'seeked', 'loadeddata'] as const;
const FOLLOWER_EVENTS = ['loadeddata', 'canplay'] as const;

/**
 * Keeps `follower` on `lead`'s time and rate: it starts, waits and loops with it, and a gap over SNAP is closed while
 * they play (checked on every animation frame while the lead plays, and at once when the lead starts, stops or jumps).
 * Both are the same length and loop (`loop` s). Returns the stop.
 */
export function follow(lead: Followed, follower: Followed, loop: number): () => void {
  let frame = 0;
  const tick = () => {
    frame = 0;
    steer(follower, lead.currentTime, !lead.paused && !lead.seeking, loop, lead.playbackRate);
    if (!lead.paused) frame = requestAnimationFrame(tick);
  };
  const now = () => {
    if (frame) cancelAnimationFrame(frame);
    tick();
  };
  for (const type of LEAD_EVENTS) lead.addEventListener(type, now);
  for (const type of FOLLOWER_EVENTS) follower.addEventListener(type, now);
  now();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    for (const type of LEAD_EVENTS) lead.removeEventListener(type, now);
    for (const type of FOLLOWER_EVENTS) follower.removeEventListener(type, now);
  };
}
