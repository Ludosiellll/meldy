/**
 * Brings the phone's 3D arena up (arena.ts): loads the kit and the models, puts the scene on the canvas, lays the map
 * and warms the shaders up. When a step fails it tries again after a pause; the flat view plays meanwhile and the
 * 3D comes in once it is ready. Only a phone without WebGL 2 (arena.ts) or one whose GPU fails every try stays flat.
 *
 * A canvas that has held a scene keeps a lost WebGL context: the view's dispose forces the loss to free the GPU at
 * once, and a new renderer on that element finds the lost context and throws. So a try never reuses such a canvas:
 * it asks for a new element (`renewCanvas`, the canvas's React key) and waits for it (`canvasChanged`).
 *
 * A plain class: the hook wires it to React, the tests drive it with fake timers.
 */

export interface ArenaScene {
  /** Puts the scene on the canvas; false when it cannot be drawn there (`mountError` says why). */
  mount(canvas: HTMLCanvasElement): boolean;
  readonly mountError?: string | null;
  warmUp(): Promise<void>;
  dispose(): void;
}

/** Loading (also the first try), waiting before the next try, warmed up and ready to come in, or off for good. */
export type Arena3dState = 'loading' | 'retry' | 'ready' | 'off';

export interface Arena3dTrace {
  state: Arena3dState;
  /** The try in progress or the last one (1, 2, …). */
  tries: number;
  /** Why the 3D is not drawing yet: the last failure. Null while nothing has failed. */
  why: string | null;
}

/** The pause before try 2, 3, …; the last one repeats. */
export const RETRY_MS = [2000, 5000, 10000, 20000, 30000];
/** Failed downloads tried again (a classroom's network comes back), and failed draws (this GPU cannot). */
export const LOAD_TRIES = 12;
export const DRAW_TRIES = 3;

/** Canvases that have held a WebGL context (kept by any loader: a new loader must not reuse them either). */
const spent = new WeakSet<HTMLCanvasElement>();

export function describeError(e: unknown): string {
  if (e instanceof Error) return e.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : e.message;
  return String(e);
}

export interface ArenaLoaderOptions<S extends ArenaScene> {
  load(): Promise<S>;
  /** The 3D canvas on the page now (null while the screen has none). */
  canvas(): HTMLCanvasElement | null;
  /** Asks for a new canvas element in place of a spent one; `canvasChanged` follows. */
  renewCanvas(): void;
  /** Lays the map on the mounted scene (may throw: counted as a failed draw). */
  prepare(scene: S): void;
  onReady(scene: S): void;
  onTrace(trace: Arena3dTrace): void;
  log?: Pick<Console, 'warn' | 'info'>;
}

class DrawError extends Error {}

export class ArenaLoader<S extends ArenaScene> {
  private run = 0;
  private tries = 0;
  private loadFails = 0;
  private drawFails = 0;
  private why: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scene: S | null = null;
  private waiting: ((canvas: HTMLCanvasElement | null) => void) | null = null;
  private readonly log: Pick<Console, 'warn' | 'info'>;

  constructor(private readonly o: ArenaLoaderOptions<S>) {
    this.log = o.log ?? console;
  }

  start(): void {
    void this.attempt();
  }

  /** Stops trying; the scene (ready or still coming) is disposed. */
  stop(): void {
    this.run += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const w = this.waiting;
    this.waiting = null;
    w?.(null);
    this.scene?.dispose();
    this.scene = null;
  }

  /** The hook's word that the canvas element changed (a renewed one, or the screen put one up). */
  canvasChanged(): void {
    const c = this.o.canvas();
    if (!this.waiting || !c || spent.has(c)) return;
    const w = this.waiting;
    this.waiting = null;
    w(c);
  }

  private trace(state: Arena3dState): void {
    this.o.onTrace({ state, tries: this.tries, why: this.why });
  }

  private freshCanvas(): Promise<HTMLCanvasElement | null> {
    const c = this.o.canvas();
    if (c && !spent.has(c)) return Promise.resolve(c);
    if (c) this.o.renewCanvas();
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  private async attempt(): Promise<void> {
    const run = ++this.run;
    this.tries += 1;
    this.trace('loading');
    let scene: S | null = null;
    let stage: 'load' | 'draw' = 'load';
    try {
      scene = await this.o.load();
      if (run !== this.run) {
        scene.dispose();
        return;
      }
      stage = 'draw';
      const canvas = await this.freshCanvas();
      if (run !== this.run || !canvas) {
        scene.dispose();
        return;
      }
      spent.add(canvas);
      if (!scene.mount(canvas)) throw new DrawError(`mount: ${scene.mountError ?? 'no WebGL 2 context on the canvas'}`);
      this.o.prepare(scene);
      await scene.warmUp();
      if (run !== this.run) {
        scene.dispose();
        return;
      }
    } catch (e) {
      scene?.dispose();
      if (run !== this.run) return;
      this.failed(stage, e instanceof DrawError ? e.message : `${stage === 'load' ? 'load' : 'draw'}: ${describeError(e)}`);
      return;
    }
    this.scene = scene;
    if (this.tries > 1) this.log.info(`live: phone 3D ready on try ${this.tries} (before: ${this.why})`);
    this.why = null;
    this.trace('ready');
    this.o.onReady(scene);
  }

  private failed(stage: 'load' | 'draw', why: string): void {
    this.why = why;
    const fails = stage === 'load' ? ++this.loadFails : ++this.drawFails;
    if (fails >= (stage === 'load' ? LOAD_TRIES : DRAW_TRIES)) {
      this.log.warn(`live: phone 3D off after ${this.tries} tries (${why}): the flat view plays`);
      this.trace('off');
      return;
    }
    const wait = RETRY_MS[Math.min(this.tries - 1, RETRY_MS.length - 1)];
    this.log.warn(`live: phone 3D try ${this.tries} failed (${why}): the flat view plays, the next try in ${wait / 1000} s`);
    this.trace('retry');
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.attempt();
    }, wait);
  }
}
