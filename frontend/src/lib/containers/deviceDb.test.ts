import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEVICE_DB_NAME, DEVICE_DB_VERSION, deviceDelete, deviceGet, devicePut, resetDeviceDbForTests } from './deviceDb';

/**
 * A minimal IndexedDB: open (with upgradeneeded the first time), readonly / readwrite transactions with get, put and
 * delete, structured copies; it can refuse to open, refuse writes, or never answer. jsdom has no IndexedDB at all,
 * which is the memory path.
 */
function fakeIndexedDB(mode: { failOpen?: boolean; failWrites?: boolean; silent?: boolean } = {}) {
  const stores = new Map<string, Map<string, unknown>>();
  const opened: Array<[string, number]> = [];
  const db = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => stores.set(name, new Map()),
    close: vi.fn(),
    onversionchange: null as null | (() => void),
    transaction(name: string, access: 'readonly' | 'readwrite') {
      const transaction = {
        error: null as DOMException | null,
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        onabort: null as null | (() => void),
        objectStore() {
          const store = stores.get(name);
          if (!store) throw new DOMException('no such store', 'NotFoundError');
          const request = (work: () => unknown) => {
            const req = { result: undefined as unknown, onsuccess: null as null | (() => void) };
            queueMicrotask(() => {
              if (mode.failWrites && access === 'readwrite') {
                transaction.error = new DOMException('full', 'QuotaExceededError');
                transaction.onabort?.();
                return;
              }
              req.result = work();
              req.onsuccess?.();
              transaction.oncomplete?.();
            });
            return req;
          };
          return {
            get: (key: string) => request(() => structuredClone(store.get(key))),
            put: (value: unknown, key: string) => request(() => store.set(key, structuredClone(value)) && key),
            delete: (key: string) => request(() => store.delete(key) && undefined),
          };
        },
      };
      return transaction;
    },
  };
  const factory = {
    open(name: string, version: number) {
      opened.push([name, version]);
      const request = {
        result: db,
        onsuccess: null as null | (() => void),
        onerror: null as null | (() => void),
        onupgradeneeded: null as null | (() => void),
        onblocked: null as null | (() => void),
      };
      queueMicrotask(() => {
        if (mode.silent) return;
        if (mode.failOpen) {
          request.onerror?.();
          return;
        }
        if (stores.size === 0) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  return { stores, opened, factory, db };
}

beforeEach(() => {
  resetDeviceDbForTests();
});

afterEach(() => {
  resetDeviceDbForTests();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('without IndexedDB (private mode, jsdom)', () => {
  it('keeps values in memory for the page, as copies', async () => {
    expect(typeof indexedDB).toBe('undefined');
    expect(await deviceGet('banks', 'c1')).toBeNull();
    const value = { v: 1, items: [{ id: 'a' }] };
    await devicePut('banks', 'c1', value);
    value.items.push({ id: 'b' });
    const read = await deviceGet<typeof value>('banks', 'c1');
    expect(read).toEqual({ v: 1, items: [{ id: 'a' }] });
    read!.items.length = 0;
    expect((await deviceGet<typeof value>('banks', 'c1'))!.items).toHaveLength(1);
    await deviceDelete('banks', 'c1');
    expect(await deviceGet('banks', 'c1')).toBeNull();
  });

  it('keeps each store apart', async () => {
    await devicePut('overviews', 'k', 1);
    await devicePut('containers', 'k', 2);
    expect(await deviceGet('overviews', 'k')).toBe(1);
    expect(await deviceGet('containers', 'k')).toBe(2);
    expect(await deviceGet('banks', 'k')).toBeNull();
  });
});

describe('with IndexedDB', () => {
  it('opens one database with three stores and keeps values in it', async () => {
    const fake = fakeIndexedDB();
    vi.stubGlobal('indexedDB', fake.factory);
    await devicePut('banks', 'c1', { v: 1, stamp: '18:x', items: [] });
    expect(fake.opened).toEqual([[DEVICE_DB_NAME, DEVICE_DB_VERSION]]);
    expect([...fake.stores.keys()].sort()).toEqual(['banks', 'containers', 'overviews']);
    expect(fake.stores.get('banks')!.get('c1')).toEqual({ v: 1, stamp: '18:x', items: [] });
    expect(await deviceGet('banks', 'c1')).toEqual({ v: 1, stamp: '18:x', items: [] });
    await deviceDelete('banks', 'c1');
    expect(fake.stores.get('banks')!.has('c1')).toBe(false);
    expect(await deviceGet('banks', 'c1')).toBeNull();
    await deviceGet('overviews', 'u');
    expect(fake.opened).toHaveLength(1);
  });

  it('a write IndexedDB refuses (full) is kept in memory for the page', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB({ failWrites: true }).factory);
    await devicePut('banks', 'c1', { v: 1 });
    expect(await deviceGet('banks', 'c1')).toEqual({ v: 1 });
  });

  it('a database that refuses to open, or never answers, leaves the memory store', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB({ failOpen: true }).factory);
    await devicePut('banks', 'c1', 'kept');
    expect(await deviceGet('banks', 'c1')).toBe('kept');

    resetDeviceDbForTests();
    vi.useFakeTimers();
    vi.stubGlobal('indexedDB', fakeIndexedDB({ silent: true }).factory);
    const put = devicePut('banks', 'c2', 'kept too');
    await vi.advanceTimersByTimeAsync(4_000);
    await put;
    expect(await deviceGet('banks', 'c2')).toBe('kept too');
  });

  it('another tab opening a newer version closes this connection, and the next call opens again', async () => {
    const fake = fakeIndexedDB();
    vi.stubGlobal('indexedDB', fake.factory);
    await devicePut('banks', 'c1', 1);
    fake.db.onversionchange?.();
    expect(fake.db.close).toHaveBeenCalled();
    await deviceGet('banks', 'c1');
    expect(fake.opened).toHaveLength(2);
  });
});
