import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOLD, JUMP, SNAP, catchUpRate, follow, gap, steer, type Followed } from './footageSync';

/* Two footages of one moment kept in step (lib/footageSync.ts): the landing's phone follows its projector, the reel steers
   both to its clock. A video here is a plain object that keeps what is written to it. */

class FakeVideo extends EventTarget implements Followed {
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  readyState = 4;
  seeking = false;
  seeks: number[] = [];
  play = vi.fn(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  constructor(at = 0) {
    super();
    this.currentTime = at;
    // Every write of currentTime is a seek: record it.
    let time = at;
    Object.defineProperty(this, 'currentTime', {
      get: () => time,
      set: (value: number) => {
        time = value;
        this.seeks.push(value);
      },
    });
  }
  /** Time passes while it plays (no seek). */
  advance(s: number) {
    if (this.paused) return;
    const at = this.currentTime;
    const seeks = this.seeks.length;
    this.currentTime = at + s * this.playbackRate;
    this.seeks.length = seeks;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gap', () => {
  it('is how far behind (positive) or ahead the video is', () => {
    expect(gap(5, 4.9)).toBeCloseTo(0.1, 9);
    expect(gap(5, 5.2)).toBeCloseTo(-0.2, 9);
  });

  it('goes the shorter way round a loop: just before the end is just behind the start', () => {
    expect(gap(0.02, 10.78, 10.8)).toBeCloseTo(0.04, 9);
    expect(gap(10.78, 0.02, 10.8)).toBeCloseTo(-0.04, 9);
    expect(gap(5.4, 0, 10.8)).toBeCloseTo(-5.4, 9);
    expect(gap(3, 3, 10.8)).toBeCloseTo(0, 9);
  });
});

describe('catchUpRate', () => {
  it('plays a little faster behind and slower ahead, more for a larger gap, never past ±0.3', () => {
    expect(catchUpRate(0.07)).toBeCloseTo(1.08, 9);
    expect(catchUpRate(-0.07)).toBeCloseTo(0.92, 9);
    expect(catchUpRate(0.2)).toBeCloseTo(1.15, 9);
    expect(catchUpRate(0.45)).toBeCloseTo(1.3, 9);
    expect(catchUpRate(-0.45)).toBeCloseTo(0.7, 9);
  });
});

describe('steer', () => {
  it('leaves a video without a frame alone', () => {
    const video = new FakeVideo(1);
    video.readyState = 1;
    steer(video, 5, true);
    expect(video.seeks).toEqual([]);
    expect(video.play).not.toHaveBeenCalled();
  });

  it('holds a waiting video on its frame: paused, at 1×, sought only when off by more than HOLD', () => {
    const video = new FakeVideo(2);
    video.paused = false;
    video.playbackRate = 1.15;
    steer(video, 2 + HOLD / 2, false);
    expect(video.pause).toHaveBeenCalledTimes(1);
    expect(video.playbackRate).toBe(1);
    expect(video.seeks).toEqual([]);
    steer(video, 7.4, false);
    expect(video.seeks).toEqual([7.4]);
    steer(video, 7.4, false);
    expect(video.seeks).toEqual([7.4]);
  });

  it('starts a playing one and leaves it at 1× while it is within SNAP (under a frame)', () => {
    const video = new FakeVideo(3);
    steer(video, 3 + SNAP * 0.9, true);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(video.playbackRate).toBe(1);
    expect(video.seeks).toEqual([]);
  });

  it('closes a small gap by the rate, without a seek, and goes back to 1× once in step', () => {
    const video = new FakeVideo(3);
    video.paused = false;
    let want = 3.2;
    steer(video, want, true);
    expect(video.seeks).toEqual([]);
    expect(video.playbackRate).toBeGreaterThan(1);
    // A tenth of a second at a time: the clock moves at 1×, the video a little faster, until they meet.
    for (let i = 0; i < 40 && video.playbackRate !== 1; i++) {
      want += 0.1;
      video.advance(0.1);
      steer(video, want, true);
    }
    expect(video.playbackRate).toBe(1);
    expect(Math.abs(want - video.currentTime)).toBeLessThan(SNAP);
    expect(video.seeks).toEqual([]);
    // Ahead: slower.
    steer(video, video.currentTime - 0.1, true);
    expect(video.playbackRate).toBeLessThan(1);
  });

  it('seeks a playing video that is more than JUMP away', () => {
    const video = new FakeVideo(1);
    video.paused = false;
    video.playbackRate = 1.3;
    steer(video, 1 + JUMP + 0.3, true);
    expect(video.seeks).toEqual([1 + JUMP + 0.3]);
    expect(video.playbackRate).toBe(1);
  });

  it('catches up with a lead that is itself catching up: its rate is the lead’s, a step faster', () => {
    const video = new FakeVideo(5);
    video.paused = false;
    // The lead plays at 1.08× (it is closing its own gap to the reel's clock), the follower is 40 ms behind it.
    let lead = 5.04;
    steer(video, lead, true, 0, 1.08);
    expect(video.playbackRate).toBeCloseTo(1.08 * 1.08, 9);
    for (let i = 0; i < 40 && video.playbackRate !== 1.08; i++) {
      lead += 0.05 * 1.08;
      video.advance(0.05);
      steer(video, lead, true, 0, 1.08);
    }
    // In step: the lead's own rate, and the gap closed (at 1.08× alone it would stay 40 ms).
    expect(video.playbackRate).toBe(1.08);
    expect(Math.abs(lead - video.currentTime)).toBeLessThan(SNAP);
    expect(video.seeks).toEqual([]);
  });

  it('on a loop, does not seek across the seam: just before the end is just behind the start', () => {
    const video = new FakeVideo(10.795);
    video.paused = false;
    steer(video, 0.005, true, 10.8);
    expect(video.seeks).toEqual([]);
    expect(video.playbackRate).toBe(1);
    // A frame behind across the seam: caught up by the rate, still no seek.
    steer(video, 0.035, true, 10.8);
    expect(video.seeks).toEqual([]);
    expect(video.playbackRate).toBeGreaterThan(1);
  });
});

describe('follow', () => {
  function frames() {
    const queue = new Map<number, FrameRequestCallback>();
    let next = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queue.set(next, cb);
      return next++;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id));
    return {
      pending: () => queue.size,
      run() {
        const cbs = [...queue.values()];
        queue.clear();
        for (const cb of cbs) cb(0);
      },
    };
  }

  it('starts, waits and jumps with the lead, and checks every frame only while the lead plays', () => {
    const raf = frames();
    const lead = new FakeVideo(0);
    const phone = new FakeVideo(0);
    const stop = follow(lead, phone, 10.8);
    // The lead waits: so does the phone, on its frame.
    expect(phone.paused).toBe(true);
    expect(raf.pending()).toBe(0);

    lead.paused = false;
    lead.currentTime = 2;
    lead.dispatchEvent(new Event('play'));
    expect(phone.play).toHaveBeenCalled();
    expect(phone.seeks).toEqual([2]);
    expect(raf.pending()).toBe(1);

    // Playing: a frame off is closed by the rate on the next frame.
    lead.advance(0.5);
    phone.advance(0.4);
    raf.run();
    expect(phone.playbackRate).toBeGreaterThan(1);

    // The lead loops back to the start (a seek): the phone, at the end of its own loop, is not sought.
    const seeks = phone.seeks.length;
    lead.currentTime = 0.02;
    phone.currentTime = 10.79;
    phone.seeks.length = seeks;
    lead.dispatchEvent(new Event('seeked'));
    expect(phone.seeks).toHaveLength(seeks);

    // The lead stops (off screen, the tab hidden): the phone stops on the lead's frame.
    lead.paused = true;
    lead.currentTime = 4.2;
    lead.dispatchEvent(new Event('pause'));
    expect(phone.paused).toBe(true);
    expect(phone.currentTime).toBe(4.2);
    raf.run();
    expect(raf.pending()).toBe(0);

    stop();
    lead.paused = false;
    lead.currentTime = 6;
    lead.dispatchEvent(new Event('play'));
    expect(phone.currentTime).toBe(4.2);
    expect(raf.pending()).toBe(0);
  });

  it('puts a phone that arrives late on the lead’s time when it has its first frame', () => {
    frames();
    const lead = new FakeVideo(3.5);
    lead.paused = false;
    const phone = new FakeVideo(0);
    phone.readyState = 0;
    const stop = follow(lead, phone, 10.8);
    expect(phone.play).not.toHaveBeenCalled();
    phone.readyState = 2;
    phone.dispatchEvent(new Event('loadeddata'));
    expect(phone.seeks).toEqual([3.5]);
    expect(phone.play).toHaveBeenCalled();
    stop();
  });
});
