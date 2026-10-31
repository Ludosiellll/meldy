/**
 * The kit's download (KitImpl.load): a failed model rejects the load, and the skeleton fetched alongside never leaves
 * an unhandled rejection behind (the phone's arena tries the load again, arenaLoader.ts; each try would report one).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({ asked: [] as string[], fail: new Set<string>() }));
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    loadAsync(url: string) {
      files.asked.push(url);
      const name = url.split('/').pop()!;
      if ([...files.fail].some((f) => name.startsWith(f))) return Promise.reject(new TypeError('Failed to fetch'));
      // never settles: the load waits on it (enough here: only the failures matter)
      return new Promise(() => {});
    }
  },
}));

/** Node's process in the test runner (the app's types know no Node). */
type Listener = (reason: unknown) => void;
const node = (globalThis as unknown as { process: { on(e: 'unhandledRejection', f: Listener): void; off(e: 'unhandledRejection', f: Listener): void } }).process;

afterEach(() => {
  files.asked = [];
  files.fail.clear();
});

describe('KitImpl.load', () => {
  it('rejects when a model fails, and the skeleton failing too leaves no unhandled rejection', async () => {
    const { loadKitImpl } = await import('./game3d');
    files.fail.add('kaykit-knight');
    files.fail.add('kaykit-skeleton');
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    node.on('unhandledRejection', onUnhandled);
    try {
      await expect(loadKitImpl({ boss: 'skeleton' })).rejects.toThrow('Failed to fetch');
      expect(files.asked.some((u) => u.includes('kaykit-skeleton'))).toBe(true);
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      node.off('unhandledRejection', onUnhandled);
    }
  });
});
