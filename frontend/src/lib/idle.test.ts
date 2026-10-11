import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screenFile, whenIdleAfterLoad } from './idle';

/** A file on its way, arriving (or failing) when the test says. */
function onTheWay<T>() {
  let arrive: (value: T) => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  const file = new Promise<T>((resolve, reject) => {
    arrive = resolve;
    fail = reject;
  });
  return { file, arrive, fail };
}

/** The browser's idle callbacks, run when the test says the browser is idle. */
let idleQueue: Array<() => void> = [];
const browserIdle = () => {
  const queue = idleQueue;
  idleQueue = [];
  for (const run of queue) run();
};

beforeEach(() => {
  vi.useFakeTimers();
  idleQueue = [];
  vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
    idleQueue.push(callback);
    return idleQueue.length;
  });
  vi.stubGlobal('cancelIdleCallback', () => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('idle work waits for the first screen (jury QA, 2026-10-11: Slow 4G)', () => {
  it('with no file of the first screen on its way: a moment after load, at the first idle time (as before)', () => {
    const run = vi.fn();
    whenIdleAfterLoad(run);
    vi.advanceTimersByTime(999);
    browserIdle();
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    browserIdle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a page file still on its way holds it until the file arrives, then the first idle time runs it', async () => {
    const page = onTheWay<{ default: string }>();
    expect(screenFile(page.file)).toBe(page.file);
    const run = vi.fn();
    whenIdleAfterLoad(run);
    vi.advanceTimersByTime(5000);
    browserIdle();
    expect(run).not.toHaveBeenCalled();
    page.arrive({ default: 'TryExample' });
    await page.file;
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
    browserIdle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a file that failed lets it go too; a cancel while it waits means it never runs', async () => {
    const page = onTheWay<unknown>();
    void screenFile(page.file).catch(() => undefined);
    const run = vi.fn();
    const cancelled = vi.fn();
    whenIdleAfterLoad(run);
    const cancel = whenIdleAfterLoad(cancelled);
    vi.advanceTimersByTime(1000);
    cancel();
    page.fail(new Error('Failed to fetch dynamically imported module'));
    await page.file.catch(() => undefined);
    await Promise.resolve();
    browserIdle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('two files of the first screen: it waits for both', async () => {
    const first = onTheWay<number>();
    const second = onTheWay<number>();
    void screenFile(first.file);
    void screenFile(second.file);
    const run = vi.fn();
    whenIdleAfterLoad(run);
    vi.advanceTimersByTime(1000);
    first.arrive(1);
    await first.file;
    await Promise.resolve();
    browserIdle();
    expect(run).not.toHaveBeenCalled();
    second.arrive(2);
    await second.file;
    await Promise.resolve();
    browserIdle();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
