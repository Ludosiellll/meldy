/**
 * The exam's questions on the device (package D1; Concept 3 §5.1, spec decisions 26 and 31): one IndexedDB record per
 * container `{ v, stamp, items }` (lib/containers/deviceDb.ts, memory-only in private mode), where
 * stamp = `${items}:${items_updated_at}` from containers_overview — or the same pair from container_summary's
 * `items_version` (bankStamp). Any insert, edit or delete of an item changes one of the two, so an unchanged bank is
 * never read again; a session starts from it without network.
 */
import { fetchAllItems, isOffline } from '../../api/containers';
import type { TestItem, Uuid } from '../../types/container';
import { deviceDelete, deviceGet, devicePut } from './deviceDb';

/** The record's layout; a record of another layout is not read (it is fetched again and replaced). */
export const BANK_CACHE_VERSION = 2; // 2: the kinds of release 48 are kept (a bank stored before read them as one answer)

interface BankRecord {
  v: number;
  stamp: string;
  items: TestItem[];
  savedAt: number;
}

/** The version stamp of an exam's bank: the number of its items and the latest change (`${items}:${items_updated_at}`). */
export function bankStamp(items: number, itemsUpdatedAt: string | null): string {
  return `${items}:${itemsUpdatedAt}`;
}

function isBank(value: unknown): value is BankRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<BankRecord>;
  return record.v === BANK_CACHE_VERSION && typeof record.stamp === 'string' && Array.isArray(record.items);
}

export async function getBank(containerId: Uuid): Promise<{ stamp: string; items: TestItem[] } | null> {
  const stored = await deviceGet<unknown>('banks', containerId);
  return isBank(stored) ? { stamp: stored.stamp, items: stored.items } : null;
}

function offlineNow(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

/**
 * The cached bank when its stamp matches, else fetches every subject's items, stores and returns them. Without network
 * (the browser says so, or the read fails for it) an older bank of this exam is returned rather than nothing: the
 * server checks every answer against the current key anyway («stale» when a key changed meanwhile).
 */
export async function loadBank(containerId: Uuid, stamp: string, subjectIds: Uuid[]): Promise<TestItem[]> {
  const cached = await getBank(containerId);
  if (cached && cached.stamp === stamp) return cached.items;
  if (cached && offlineNow()) return cached.items;
  let items: TestItem[];
  try {
    items = await fetchAllItems(subjectIds);
  } catch (error) {
    if (cached && isOffline(error)) return cached.items;
    throw error;
  }
  const record: BankRecord = { v: BANK_CACHE_VERSION, stamp, items, savedAt: Date.now() };
  await devicePut('banks', containerId, record);
  return items;
}

export async function forgetBank(containerId: Uuid): Promise<void> {
  await deviceDelete('banks', containerId);
}
