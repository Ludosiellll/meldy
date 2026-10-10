/**
 * The exam's questions on the device (package D1): one IndexedDB record per container `{stamp, items}`, where
 * stamp = `${items}:${items_updated_at}` from containers_overview; a memory-only fallback in private mode.
 */
import type { TestItem, Uuid } from '../../types/container';

function notBuilt(name: string): never {
  throw new Error(`lib/containers/bankCache.${name}: not built yet (package D1)`);
}

export async function getBank(_containerId: Uuid): Promise<{ stamp: string; items: TestItem[] } | null> { return notBuilt('getBank'); }
/** The cached bank when its stamp matches, else fetches every subject's items, stores and returns them. */
export async function loadBank(_containerId: Uuid, _stamp: string, _subjectIds: Uuid[]): Promise<TestItem[]> { return notBuilt('loadBank'); }
export async function forgetBank(_containerId: Uuid): Promise<void> { return notBuilt('forgetBank'); }
