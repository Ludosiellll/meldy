import { TOTAL, clamp } from './timeline';

export type FrameListener = (t: number) => void;

interface Scheduler {
  request: (callback: (now: number) => void) => number;
  cancel: (id: number) => void;
  now: () => number;
}

const browserScheduler: Scheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (id) => window.cancelAnimationFrame(id),
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

/**
 * The reel's clock: one time value for the whole stage. While it plays it advances with the
 * display's frames and loops; `seek` jumps anywhere. Every listener gets the same time on every
 * frame and writes its own elements, so React renders a scene once and never per frame.
 */
export class ReelClock {
  private t = 0;
  private playing = false;
  private frameId = 0;
  private last = 0;
  private readonly frames = new Set<FrameListener>();
  private readonly watchers = new Set<() => void>();

  constructor(
    readonly total: number = TOTAL,
    private readonly scheduler: Scheduler = browserScheduler,
  ) {}

  get time(): number {
    return this.t;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Listens to every frame; the listener runs at once with the current time. */
  addFrame(listener: FrameListener): () => void {
    this.frames.add(listener);
    listener(this.t);
    return () => {
      this.frames.delete(listener);
    };
  }

  /** Listens to play, pause and seek (for controls), not to every frame. */
  watch(watcher: () => void): () => void {
    this.watchers.add(watcher);
    return () => {
      this.watchers.delete(watcher);
    };
  }

  seek(t: number): void {
    this.t = clamp(t, 0, this.total);
    this.last = this.scheduler.now();
    this.emit();
    this.notify();
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.last = this.scheduler.now();
    this.frameId = this.scheduler.request(this.tick);
    this.notify();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.scheduler.cancel(this.frameId);
    this.notify();
  }

  dispose(): void {
    this.pause();
    this.frames.clear();
    this.watchers.clear();
  }

  private readonly tick = (now: number) => {
    if (!this.playing) return;
    // A long gap (a background tab, a slow frame) moves the reel one short step, never a jump.
    const step = Math.min(Math.max(now - this.last, 0), 64);
    this.last = now;
    let next = this.t + step;
    if (next >= this.total) next %= this.total;
    this.t = next;
    this.emit();
    if (this.playing) this.frameId = this.scheduler.request(this.tick);
  };

  private emit(): void {
    for (const listener of Array.from(this.frames)) listener(this.t);
  }

  private notify(): void {
    for (const watcher of Array.from(this.watchers)) watcher();
  }
}
