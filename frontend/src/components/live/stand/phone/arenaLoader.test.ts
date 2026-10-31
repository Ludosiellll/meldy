/**
 * The phone's 3D brought up for real (arenaLoader.ts): a failed download or draw is tried again after a pause, a
 * slow one is waited for, a canvas that held a scene is never used again, and only a GPU that fails every draw (or
 * a download failing for minutes) leaves the flat view for good, with the reason kept.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaLoader, DRAW_TRIES, LOAD_TRIES, RETRY_MS, type Arena3dTrace, type ArenaScene } from './arenaLoader';

class FakeScene implements ArenaScene {
  canvas: HTMLCanvasElement | null = null;
  disposed = false;
  mountError: string | null = null;
  warmed = false;
  constructor(
    private readonly draws = true,
    private readonly warm: () => Promise<void> = () => Promise.resolve(),
  ) {}
  mount(canvas: HTMLCanvasElement): boolean {
    if (!this.draws) {
      this.mountError = "TypeError: Cannot read properties of null (reading 'precision')";
      return false;
    }
    this.canvas = canvas;
    return true;
  }
  async warmUp(): Promise<void> {
    await this.warm();
    this.warmed = true;
  }
  dispose(): void {
    this.disposed = true;
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** A loader on a page with one canvas; `renewCanvas` puts a new element up a moment later, as React does. */
function page(loads: Array<() => Promise<FakeScene>>, first: HTMLCanvasElement | null = document.createElement('canvas')) {
  const state = { canvas: first, renews: 0, calls: 0 };
  const traces: Arena3dTrace[] = [];
  const ready: FakeScene[] = [];
  const log = { warn: vi.fn(), info: vi.fn() };
  const prepared: FakeScene[] = [];
  const loader: ArenaLoader<FakeScene> = new ArenaLoader<FakeScene>({
    load: () => loads[Math.min(state.calls++, loads.length - 1)](),
    canvas: () => state.canvas,
    renewCanvas: () => {
      state.renews += 1;
      setTimeout(() => {
        state.canvas = document.createElement('canvas');
        loader.canvasChanged();
      }, 0);
    },
    prepare: (s) => prepared.push(s),
    onReady: (s) => ready.push(s),
    onTrace: (t) => traces.push(t),
    log,
  });
  return { loader, state, traces, ready, log, prepared, last: () => traces[traces.length - 1] };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ArenaLoader', () => {
  it('tries a failed download again after a pause, and the 3D comes', async () => {
    const scene = new FakeScene();
    const p = page([() => Promise.reject(new TypeError('Failed to fetch')), () => Promise.resolve(scene)]);
    p.loader.start();
    await flush();
    expect(p.last()).toEqual({ state: 'retry', tries: 1, why: 'load: TypeError: Failed to fetch' });
    expect(p.log.warn).toHaveBeenCalledWith('live: phone 3D try 1 failed (load: TypeError: Failed to fetch): the flat view plays, the next try in 2 s');
    expect(p.ready).toEqual([]);

    await vi.advanceTimersByTimeAsync(RETRY_MS[0] - 1);
    expect(p.state.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(p.state.calls).toBe(2);
    expect(p.ready).toEqual([scene]);
    expect(scene.warmed).toBe(true);
    expect(p.prepared).toEqual([scene]);
    expect(p.last()).toEqual({ state: 'ready', tries: 2, why: null });
    expect(p.log.info).toHaveBeenCalledWith('live: phone 3D ready on try 2 (before: load: TypeError: Failed to fetch)');
  });

  it('waits for a slow download (no second try meanwhile) and the 3D comes when it arrives', async () => {
    const slow = deferred<FakeScene>();
    const scene = new FakeScene();
    const p = page([() => slow.promise]);
    p.loader.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(p.state.calls).toBe(1);
    expect(p.last()).toEqual({ state: 'loading', tries: 1, why: null });
    slow.resolve(scene);
    await flush();
    expect(p.ready).toEqual([scene]);
    expect(p.log.warn).not.toHaveBeenCalled();
  });

  it('gives a try after a failed draw a new canvas element (the old one keeps a lost context)', async () => {
    const broken = new FakeScene(false);
    const good = new FakeScene();
    const p = page([() => Promise.resolve(broken), () => Promise.resolve(good)]);
    const first = p.state.canvas;
    p.loader.start();
    await flush();
    expect(broken.disposed).toBe(true);
    expect(p.last()).toEqual({ state: 'retry', tries: 1, why: "mount: TypeError: Cannot read properties of null (reading 'precision')" });

    await vi.advanceTimersByTimeAsync(RETRY_MS[0] + 10);
    expect(p.state.renews).toBe(1);
    expect(good.canvas).not.toBeNull();
    expect(good.canvas).not.toBe(first);
    expect(p.ready).toEqual([good]);
  });

  it('counts a failed warm-up as a failed draw and tries again', async () => {
    const shaky = new FakeScene(true, () => Promise.reject(new Error('shader compile failed')));
    const good = new FakeScene();
    const p = page([() => Promise.resolve(shaky), () => Promise.resolve(good)]);
    p.loader.start();
    await flush();
    expect(shaky.disposed).toBe(true);
    expect(p.last().why).toBe('draw: shader compile failed');
    await vi.advanceTimersByTimeAsync(RETRY_MS[0] + 10);
    expect(p.ready).toEqual([good]);
    expect(good.canvas).not.toBe(shaky.canvas);
  });

  it('never puts a new scene on a canvas that held one, even from a new loader (the arena built anew)', async () => {
    const one = new FakeScene();
    const two = new FakeScene();
    const p = page([() => Promise.resolve(one), () => Promise.resolve(two)]);
    p.loader.start();
    await flush();
    expect(p.ready).toEqual([one]);
    const held = one.canvas;
    p.loader.stop();
    expect(one.disposed).toBe(true);

    // a second loader on the same page, the same canvas element still up
    const again = new ArenaLoader<FakeScene>({
      load: () => Promise.resolve(two),
      canvas: () => p.state.canvas,
      renewCanvas: () => {
        p.state.renews += 1;
        setTimeout(() => {
          p.state.canvas = document.createElement('canvas');
          again.canvasChanged();
        }, 0);
      },
      prepare: () => {},
      onReady: (s) => p.ready.push(s),
      onTrace: () => {},
      log: p.log,
    });
    again.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(p.state.renews).toBe(1);
    expect(two.canvas).not.toBe(held);
    expect(p.ready).toEqual([one, two]);
  });

  it('waits for a canvas while the screen has none, then draws on the one put up', async () => {
    const scene = new FakeScene();
    const p = page([() => Promise.resolve(scene)], null);
    p.loader.start();
    await flush();
    expect(p.ready).toEqual([]);
    p.state.canvas = document.createElement('canvas');
    p.loader.canvasChanged();
    await flush();
    expect(scene.canvas).toBe(p.state.canvas);
    expect(p.ready).toEqual([scene]);
  });

  it(`gives up after ${DRAW_TRIES} failed draws: off, the reason kept, the flat view for good`, async () => {
    const p = page([() => Promise.resolve(new FakeScene(false))]);
    p.loader.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(p.state.calls).toBe(DRAW_TRIES);
    expect(p.last()).toEqual({ state: 'off', tries: DRAW_TRIES, why: "mount: TypeError: Cannot read properties of null (reading 'precision')" });
    expect(p.log.warn).toHaveBeenLastCalledWith(
      `live: phone 3D off after ${DRAW_TRIES} tries (mount: TypeError: Cannot read properties of null (reading 'precision')): the flat view plays`,
    );
    expect(p.ready).toEqual([]);
  });

  it(`keeps trying a failing download for minutes (${LOAD_TRIES} tries) before it gives up`, async () => {
    const p = page([() => Promise.reject(new TypeError('Failed to fetch'))]);
    p.loader.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(p.state.calls).toBeGreaterThan(4);
    expect(p.last().state).toBe('retry');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(p.state.calls).toBe(LOAD_TRIES);
    expect(p.last().state).toBe('off');
  });

  it('stopped while a download runs: the late scene is disposed and never put on the canvas', async () => {
    const slow = deferred<FakeScene>();
    const scene = new FakeScene();
    const p = page([() => slow.promise]);
    p.loader.start();
    p.loader.stop();
    slow.resolve(scene);
    await flush();
    expect(scene.disposed).toBe(true);
    expect(scene.canvas).toBeNull();
    expect(p.ready).toEqual([]);
  });

  it('stopped while it waits before the next try: no more tries', async () => {
    const p = page([() => Promise.reject(new TypeError('Failed to fetch'))]);
    p.loader.start();
    await flush();
    p.loader.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(p.state.calls).toBe(1);
  });
});
