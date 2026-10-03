import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data?: unknown; error: unknown };
type UsageRow = { id: string; user_id: string; date: string; requests_count: number | null };
type Filter = ['eq' | 'is', string, unknown];
type UpdateCall = { values: Record<string, unknown>; filters: Filter[]; matched: number };

/**
 * Таблица ai_usage в памяти, как её видит supabase-js: чтение снимает значения в момент
 * вызова, UPDATE применяется по фильтрам и возвращает изменённые строки через .select().
 * Так два параллельных списания действительно читают один и тот же счётчик.
 */
const db = vi.hoisted(() => ({
  profile: { data: null, error: null } as Result,
  rows: [] as UsageRow[],
  readOverrides: [] as Result[],
  updateErrors: [] as unknown[],
  insertErrors: [] as unknown[],
  denyUpdates: false,
  updates: [] as UpdateCall[],
  inserts: [] as unknown[],
  usageFilters: [] as Array<Array<[string, unknown]>>,
  profileFilters: [] as Array<Array<[string, unknown]>>,
  throwOnFrom: false,
  nextId: 1,
}));

vi.mock('../lib/supabase', () => {
  const field = (row: UsageRow, column: string) => (row as unknown as Record<string, unknown>)[column];
  const runUpdate = (values: Record<string, unknown>, filters: Filter[]) => {
    const forced = db.updateErrors.shift();
    if (forced) {
      db.updates.push({ values, filters, matched: 0 });
      return { data: null, error: forced };
    }
    const hit = db.denyUpdates ? [] : db.rows.filter(row => filters.every(([, column, value]) => field(row, column) === value));
    for (const row of hit) Object.assign(row, values);
    db.updates.push({ values, filters, matched: hit.length });
    return { data: hit.map(row => ({ id: row.id })), error: null };
  };
  return {
    supabase: {
      from: (table: string) => {
        if (db.throwOnFrom) throw new Error('offline');
        return {
          select: () => {
            const filters: Array<[string, unknown]> = [];
            const chain = {
              eq(column: string, value: unknown) {
                filters.push([column, value]);
                return chain;
              },
              maybeSingle: async () => {
                if (table === 'profiles') {
                  db.profileFilters.push(filters);
                  return db.profile;
                }
                db.usageFilters.push(filters);
                const forced = db.readOverrides.shift();
                if (forced) return forced;
                const found = db.rows.filter(row => filters.every(([column, value]) => field(row, column) === value));
                if (found.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
                return { data: found[0] ? { id: found[0].id, requests_count: found[0].requests_count } : null, error: null };
              },
            };
            return chain;
          },
          update: (values: Record<string, unknown>) => {
            const filters: Filter[] = [];
            const builder = {
              eq(column: string, value: unknown) {
                filters.push(['eq', column, value]);
                return builder;
              },
              is(column: string, value: unknown) {
                filters.push(['is', column, value]);
                return builder;
              },
              select: async () => runUpdate(values, filters),
              // Без .select() supabase-js тоже выполняет запрос, но строк не возвращает.
              then(resolve: (value: Result) => unknown) {
                const { error } = runUpdate(values, filters);
                return Promise.resolve(resolve({ data: null, error }));
              },
            };
            return builder;
          },
          insert: async (row: Omit<UsageRow, 'id'>) => {
            db.inserts.push(row);
            const forced = db.insertErrors.shift();
            if (forced) return { error: forced };
            if (db.rows.some(other => other.user_id === row.user_id && other.date === row.date)) {
              return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            }
            db.rows.push({ id: `row-${db.nextId++}`, ...row });
            return { error: null };
          },
        };
      },
    },
  };
});

import {
  AI_USAGE_EVENT,
  FREE_DAILY_LIMIT,
  checkAILimit,
  formatLimitReset,
  incrementAIUsage,
  nextLimitReset,
} from './limits';

let events = 0;
const onEvent = () => {
  events += 1;
};

const TODAY = '2026-10-02';

function usageRow(requestsCount: number | null, id = 'row-1'): UsageRow {
  return { id, user_id: 'user-1', date: TODAY, requests_count: requestsCount };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  db.profile = { data: { is_pro: false }, error: null };
  db.rows = [];
  db.readOverrides = [];
  db.updateErrors = [];
  db.insertErrors = [];
  db.denyUpdates = false;
  db.updates = [];
  db.inserts = [];
  db.usageFilters = [];
  db.profileFilters = [];
  db.throwOnFrom = false;
  db.nextId = 1;
  events = 0;
  window.addEventListener(AI_USAGE_EVENT, onEvent);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  window.removeEventListener(AI_USAGE_EVENT, onEvent);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('constants', () => {
  it('keeps the daily limit and the event name', () => {
    expect(FREE_DAILY_LIMIT).toBe(100);
    expect(AI_USAGE_EVENT).toBe('ai_usage_updated');
  });
});

describe('checkAILimit', () => {
  it('reads today’s UTC row and allows when the cost fits', async () => {
    vi.setSystemTime(new Date('2026-10-02T22:30:00Z'));
    db.rows = [usageRow(80)];
    await expect(checkAILimit('user-1', 20)).resolves.toEqual({ allowed: true, isPro: false, count: 80, ok: true });
    expect(db.profileFilters[0]).toEqual([['id', 'user-1']]);
    expect(db.usageFilters[0]).toEqual([
      ['user_id', 'user-1'],
      ['date', '2026-10-02'],
    ]);
  });

  it('refuses when the cost does not fit', async () => {
    db.rows = [usageRow(90)];
    await expect(checkAILimit('user-1', 20)).resolves.toEqual({ allowed: false, isPro: false, count: 90, ok: true });
  });

  it('treats a missing row as zero used', async () => {
    await expect(checkAILimit('user-1', 20)).resolves.toEqual({ allowed: true, isPro: false, count: 0, ok: true });
  });

  it('lets PRO through without reading the counter', async () => {
    db.profile = { data: { is_pro: true }, error: null };
    await expect(checkAILimit('user-1', 20)).resolves.toEqual({ allowed: true, isPro: true, count: 0, ok: true });
    expect(db.usageFilters).toHaveLength(0);
  });

  it('reports ok: false on a profile read error', async () => {
    db.profile = { data: null, error: { code: '500', message: 'boom' } };
    await expect(checkAILimit('user-1', 20)).resolves.toEqual({ allowed: true, isPro: false, count: 0, ok: false });
  });

  it('reports ok: false when the counter cannot be read (e.g. two rows for one day)', async () => {
    db.rows = [usageRow(10, 'row-1'), usageRow(30, 'row-2')];
    await expect(checkAILimit('user-1', 20)).resolves.toEqual({ allowed: true, isPro: false, count: 0, ok: false });
  });

  it('reports ok: false when Supabase throws', async () => {
    db.throwOnFrom = true;
    await expect(checkAILimit('user-1', 20)).resolves.toEqual({ allowed: true, isPro: false, count: 0, ok: false });
  });
});

describe('incrementAIUsage', () => {
  it('adds the cost to today’s row only if the counter is still the one it read, and broadcasts', async () => {
    db.rows = [usageRow(40)];
    await incrementAIUsage('user-1', 20);
    expect(db.rows[0].requests_count).toBe(60);
    expect(db.updates).toEqual([
      {
        values: { requests_count: 60 },
        filters: [
          ['eq', 'id', 'row-1'],
          ['eq', 'requests_count', 40],
        ],
        matched: 1,
      },
    ]);
    expect(db.inserts).toHaveLength(0);
    expect(events).toBe(1);
  });

  it('matches a row with an empty counter by IS NULL', async () => {
    db.rows = [usageRow(null)];
    await incrementAIUsage('user-1', 5);
    expect(db.rows[0].requests_count).toBe(5);
    expect(db.updates[0].filters).toEqual([
      ['eq', 'id', 'row-1'],
      ['is', 'requests_count', null],
    ]);
    expect(events).toBe(1);
  });

  it('creates today’s row and broadcasts the change', async () => {
    vi.setSystemTime(new Date('2026-10-02T23:59:00Z'));
    await incrementAIUsage('user-1', 20);
    expect(db.inserts).toEqual([{ user_id: 'user-1', date: '2026-10-02', requests_count: 20 }]);
    expect(db.rows).toEqual([{ id: 'row-1', user_id: 'user-1', date: '2026-10-02', requests_count: 20 }]);
    expect(events).toBe(1);
  });

  it('keeps both of two overlapping charges (background mapping 10 + oral answer 1)', async () => {
    db.rows = [usageRow(40)];
    await Promise.all([incrementAIUsage('user-1', 10), incrementAIUsage('user-1', 1)]);
    expect(db.rows[0].requests_count).toBe(51);
    // Второе списание прочитало 40, его UPDATE не нашёл строку с 40 — перечитали 50 и записали 51.
    expect(db.updates.map(update => [update.values.requests_count, update.matched])).toEqual([
      [50, 1],
      [41, 0],
      [51, 1],
    ]);
    expect(events).toBe(2);
  });

  it('keeps both charges when they race to create the day’s row', async () => {
    await Promise.all([incrementAIUsage('user-1', 10), incrementAIUsage('user-1', 1)]);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].requests_count).toBe(11);
    expect(db.inserts).toHaveLength(2); // второй INSERT получил 23505 и стал UPDATE
    expect(events).toBe(2);
  });

  it('retries as an update when a parallel charge created the row', async () => {
    db.rows = [usageRow(20, 'row-9')];
    db.readOverrides = [{ data: null, error: null }]; // строку создали сразу после нашего чтения
    await incrementAIUsage('user-1', 5);
    expect(db.inserts).toHaveLength(1);
    expect(db.rows[0].requests_count).toBe(25);
    expect(db.updates).toHaveLength(1);
    expect(events).toBe(1);
  });

  it('does not report an update that changed no row as written', async () => {
    db.rows = [usageRow(40)];
    db.denyUpdates = true; // например, политика RLS не пустила UPDATE: PostgREST вернул 0 строк
    await expect(incrementAIUsage('user-1', 20)).resolves.toBeUndefined();
    expect(db.updates).toHaveLength(3); // ограниченное число попыток, без бесконечного цикла
    expect(db.updates.every(update => update.matched === 0)).toBe(true);
    expect(db.rows[0].requests_count).toBe(40);
    expect(events).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });

  it('does not broadcast after a failed update or insert, and never throws', async () => {
    db.rows = [usageRow(40)];
    db.updateErrors = [{ code: '42501', message: 'denied' }];
    await expect(incrementAIUsage('user-1', 20)).resolves.toBeUndefined();
    expect(events).toBe(0);
    expect(db.rows[0].requests_count).toBe(40);

    db.rows = [];
    db.insertErrors = [{ code: '42501', message: 'denied' }];
    await expect(incrementAIUsage('user-1', 20)).resolves.toBeUndefined();
    expect(events).toBe(0);
    expect(db.rows).toHaveLength(0);
  });

  it('does not write or broadcast when the read fails', async () => {
    db.rows = [usageRow(10, 'row-1'), usageRow(30, 'row-2')];
    await incrementAIUsage('user-1', 20);
    expect(db.updates).toHaveLength(0);
    expect(db.inserts).toHaveLength(0);
    expect(events).toBe(0);
  });

  it('writes nothing for a free action', async () => {
    db.rows = [usageRow(40)];
    await incrementAIUsage('user-1', 0);
    expect(db.usageFilters).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
    expect(db.inserts).toHaveLength(0);
    expect(events).toBe(0);
  });

  it('swallows thrown errors', async () => {
    db.throwOnFrom = true;
    await expect(incrementAIUsage('user-1', 20)).resolves.toBeUndefined();
    expect(events).toBe(0);
  });
});

describe('limit reset time', () => {
  it('is the next 00:00 UTC', () => {
    expect(nextLimitReset(new Date('2026-10-02T21:30:00Z')).toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(nextLimitReset(new Date('2026-10-03T00:00:00Z')).toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(nextLimitReset(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('formats as HH:MM in the viewer’s local time', () => {
    const reset = new Date('2026-10-03T00:00:00Z');
    const expected = `${String(reset.getHours()).padStart(2, '0')}:${String(reset.getMinutes()).padStart(2, '0')}`;
    expect(formatLimitReset(reset)).toBe(expected);
    expect(formatLimitReset(new Date(2026, 9, 3, 7, 5))).toBe('07:05');
    expect(formatLimitReset(new Date(2026, 9, 3, 0, 0))).toBe('00:00');
  });
});
