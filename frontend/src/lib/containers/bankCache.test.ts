import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestItem } from '../../types/container';
import itemsPage from '../../../../contracts/container/items_page.json';

const api = vi.hoisted(() => ({ fetchAllItems: vi.fn() }));
vi.mock('../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/containers')>()),
  fetchAllItems: api.fetchAllItems,
}));
vi.mock('../supabase', () => ({ supabase: {} }));

import { CONTAINER_ERROR_TEXT, ContainerApiError } from '../../api/containers';
import { BANK_CACHE_VERSION, bankStamp, forgetBank, getBank, loadBank } from './bankCache';
import { devicePut, resetDeviceDbForTests } from './deviceDb';

const C1 = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';
const ITEMS = itemsPage as unknown as TestItem[];
const SUBJECTS = ['69ead689-38d6-4350-bc5d-13d273f8b9b2', '590a774c-7a67-4b13-a944-cf9a2f0e9d9b'];
const STAMP = bankStamp(18, '2026-12-14T16:03:05.069454+00:00');
const networkDown = () => new ContainerApiError('network', CONTAINER_ERROR_TEXT.network, { status: 0 });

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
}

beforeEach(() => {
  resetDeviceDbForTests();
  api.fetchAllItems.mockReset().mockResolvedValue(ITEMS);
  setOnline(true);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'onLine');
});

describe('the stamp', () => {
  it('is the number of items and the latest change, as containers_overview gives them', () => {
    expect(STAMP).toBe('18:2026-12-14T16:03:05.069454+00:00');
    expect(bankStamp(0, null)).toBe('0:null');
  });
});

describe('loadBank', () => {
  it('fetches every subject’s items once, then serves them while the stamp is the same', async () => {
    expect(await getBank(C1)).toBeNull();
    expect(await loadBank(C1, STAMP, SUBJECTS)).toEqual(ITEMS);
    expect(api.fetchAllItems).toHaveBeenCalledWith(SUBJECTS);
    expect(await getBank(C1)).toEqual({ stamp: STAMP, items: ITEMS });
    expect(await loadBank(C1, STAMP, SUBJECTS)).toEqual(ITEMS);
    expect(api.fetchAllItems).toHaveBeenCalledTimes(1);
  });

  it('a new stamp (an item added, edited or deleted) reads the bank again and replaces it', async () => {
    await loadBank(C1, STAMP, SUBJECTS);
    const edited = ITEMS.map((item, index) => (index === 0 ? { ...item, stem: 'Исправлено', updated_at: '2026-12-21T10:00:00+00:00' } : item));
    api.fetchAllItems.mockResolvedValue(edited);
    const next = bankStamp(18, '2026-12-21T10:00:00+00:00');
    expect((await loadBank(C1, next, SUBJECTS))[0].stem).toBe('Исправлено');
    expect(api.fetchAllItems).toHaveBeenCalledTimes(2);
    expect((await getBank(C1))?.stamp).toBe(next);
    api.fetchAllItems.mockResolvedValue(ITEMS.slice(1));
    expect(await loadBank(C1, bankStamp(17, '2026-12-21T10:00:00+00:00'), SUBJECTS)).toHaveLength(ITEMS.length - 1);
  });

  it('a record of another layout version is not read', async () => {
    await devicePut('banks', C1, { v: BANK_CACHE_VERSION + 1, stamp: STAMP, items: [] });
    expect(await getBank(C1)).toBeNull();
    await devicePut('banks', C1, { stamp: STAMP, items: [] });
    expect(await getBank(C1)).toBeNull();
    expect(await loadBank(C1, STAMP, SUBJECTS)).toEqual(ITEMS);
    expect(api.fetchAllItems).toHaveBeenCalledTimes(1);
  });

  it('without network an older bank of the exam is served rather than nothing', async () => {
    await loadBank(C1, STAMP, SUBJECTS);
    const newer = bankStamp(19, '2026-12-22T10:00:00+00:00');
    setOnline(false);
    expect(await loadBank(C1, newer, SUBJECTS)).toEqual(ITEMS);
    expect(api.fetchAllItems).toHaveBeenCalledTimes(1);
    setOnline(true);
    api.fetchAllItems.mockRejectedValue(networkDown());
    expect(await loadBank(C1, newer, SUBJECTS)).toEqual(ITEMS);
    expect((await getBank(C1))?.stamp).toBe(STAMP);
  });

  it('without network and without a bank it says so; other failures are not hidden', async () => {
    api.fetchAllItems.mockRejectedValue(networkDown());
    await expect(loadBank(C1, STAMP, SUBJECTS)).rejects.toMatchObject({ code: 'network' });
    await loadBank(C1, STAMP, SUBJECTS).catch(() => undefined);
    api.fetchAllItems.mockResolvedValue(ITEMS);
    await loadBank(C1, STAMP, SUBJECTS);
    api.fetchAllItems.mockRejectedValue(new ContainerApiError('42501', CONTAINER_ERROR_TEXT['42501'], { status: 403 }));
    await expect(loadBank(C1, bankStamp(1, null), SUBJECTS)).rejects.toMatchObject({ code: '42501' });
  });

  it('forgetBank removes it', async () => {
    await loadBank(C1, STAMP, SUBJECTS);
    await forgetBank(C1);
    expect(await getBank(C1)).toBeNull();
  });
});
