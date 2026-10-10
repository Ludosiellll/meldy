/**
 * The exam's data on this device (package D1; Concept 3 §5.1, spec decisions 26 and 31): a small key–value wrapper
 * over IndexedDB, no npm package. One database, three stores:
 * - `banks`: an exam's questions, `{ v, stamp, items }` per container (lib/containers/bankCache.ts);
 * - `overviews`: the last containers_overview and plan_inputs of an account (lib/containers/overviewCache.ts);
 * - `containers`: the last summary, plan_inputs and oral plan items of one exam for one account (overviewCache.ts).
 *
 * Not localStorage: a 2000-question bank is about 1.8 MB of JSON, localStorage holds about 5 MB per site, is
 * synchronous, and the app keeps other keys there. When IndexedDB is missing, blocked or broken (private mode, a
 * storage error, a browser that never answers), everything lives in memory for this page: the screens work the same,
 * only nothing survives a reload. Nothing here throws.
 */

export const DEVICE_DB_NAME = 'meldy-containers';
export const DEVICE_DB_VERSION = 1;
export type DeviceStore = 'banks' | 'overviews' | 'containers';
const STORES: readonly DeviceStore[] = ['banks', 'overviews', 'containers'];
/** A browser that neither opens nor refuses the database in this time gets the memory store. */
const OPEN_TIMEOUT_MS = 4_000;

const memory = new Map<DeviceStore, Map<string, unknown>>();
let opening: Promise<IDBDatabase | null> | null = null;

function memoryStore(store: DeviceStore): Map<string, unknown> {
  let map = memory.get(store);
  if (!map) {
    map = new Map();
    memory.set(store, map);
  }
  return map;
}

/** A copy, so a caller changing what it read never changes what is stored (IndexedDB copies on its own). */
function copy<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
    try {
      const factory = typeof indexedDB === 'undefined' ? null : indexedDB;
      if (!factory) {
        finish(null);
        return;
      }
      const request = factory.open(DEVICE_DB_NAME, DEVICE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab opens a newer version: let it, and open again on the next call.
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        finish(db);
      };
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
  return opening;
}

function settle<T>(request: IDBRequest<T>, transaction: IDBTransaction): Promise<T> {
  return new Promise((resolve, reject) => {
    let value: T;
    request.onsuccess = () => {
      value = request.result;
    };
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error('IndexedDB error'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/** The stored value, or null (nothing stored, or the store cannot be read). */
export async function deviceGet<T>(store: DeviceStore, key: string): Promise<T | null> {
  const db = await open();
  if (db) {
    try {
      const transaction = db.transaction(store, 'readonly');
      const value = await settle(transaction.objectStore(store).get(key), transaction);
      if (value !== undefined) return value as T;
    } catch {
      // Fall through to what this page kept in memory.
    }
  }
  const kept = memoryStore(store).get(key);
  return kept === undefined ? null : copy(kept as T);
}

/** Stores the value; when IndexedDB refuses (full, blocked), it is kept in memory for this page. */
export async function devicePut(store: DeviceStore, key: string, value: unknown): Promise<void> {
  const db = await open();
  if (db) {
    try {
      const transaction = db.transaction(store, 'readwrite');
      await settle(transaction.objectStore(store).put(value, key), transaction);
      memoryStore(store).delete(key);
      return;
    } catch {
      // Kept in memory below.
    }
  }
  memoryStore(store).set(key, copy(value));
}

export async function deviceDelete(store: DeviceStore, key: string): Promise<void> {
  memoryStore(store).delete(key);
  const db = await open();
  if (!db) return;
  try {
    const transaction = db.transaction(store, 'readwrite');
    await settle(transaction.objectStore(store).delete(key), transaction);
  } catch {
    // Nothing to do: the next read finds nothing or an old value, which the stamp check refuses anyway.
  }
}

/** For tests: forget the open database and everything kept in memory. */
export function resetDeviceDbForTests(): void {
  memory.clear();
  const pending = opening;
  opening = null;
  void pending?.then((db) => db?.close(), () => undefined);
}
