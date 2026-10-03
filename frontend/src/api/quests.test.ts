import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkAndAwardAchievements, recordStudyActivity } from './quests';

const database = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: database }));

type Result = { data?: unknown; error?: unknown };

function query(result: Result) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'insert', 'update', 'upsert', 'maybeSingle']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null, ...result }).then(resolve, reject);
  return { builder, args: (method: string) => calls.filter(([name]) => name === method).map(([, args]) => args) };
}

const nativeProto = Date.prototype;

/**
 * Emulates a browser whose clock runs `hours` ahead of UTC (Moscow is +3). The test worker runs
 * in UTC and a worker thread cannot change its time zone, so the local-calendar getters that
 * date-fns `format` reads are shifted instead.
 */
function emulateUtcOffset(hours: number) {
  const shifted = (date: Date) => new Date(date.getTime() + hours * 3_600_000);
  vi.spyOn(nativeProto, 'getFullYear').mockImplementation(function (this: Date) {
    return shifted(this).getUTCFullYear();
  });
  vi.spyOn(nativeProto, 'getMonth').mockImplementation(function (this: Date) {
    return shifted(this).getUTCMonth();
  });
  vi.spyOn(nativeProto, 'getDate').mockImplementation(function (this: Date) {
    return shifted(this).getUTCDate();
  });
}

describe('recordStudyActivity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('files activity under the local day (Moscow, 22:30 UTC is already the next day)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-02T22:30:00Z'));
    emulateUtcOffset(3);
    const read = query({ data: null });
    const insert = query({ error: null });
    database.from.mockReturnValueOnce(read.builder).mockReturnValueOnce(insert.builder);

    await recordStudyActivity('user-1', 1, 0);

    expect(read.args('eq')).toEqual([['user_id', 'user-1'], ['date', '2026-10-03']]);
    expect(insert.args('insert')).toEqual([[{ user_id: 'user-1', date: '2026-10-03', cards_reviewed: 1, materials_added: 0 }]]);
  });

  it('adds to the row of the day when it exists', async () => {
    const read = query({ data: { id: 'row-1', cards_reviewed: 4, materials_added: 1 } });
    const update = query({ error: null });
    database.from.mockReturnValueOnce(read.builder).mockReturnValueOnce(update.builder);

    await recordStudyActivity('user-1', 2, 1);

    expect(update.args('update')).toEqual([[{ cards_reviewed: 6, materials_added: 2 }]]);
    expect(update.args('eq')).toEqual([['id', 'row-1']]);
  });

  it('retries as an update when another tab inserted the day first', async () => {
    database.from
      .mockReturnValueOnce(query({ data: null }).builder)
      .mockReturnValueOnce(query({ error: { code: '23505' } }).builder)
      .mockReturnValueOnce(query({ data: { id: 'row-2', cards_reviewed: 3, materials_added: 0 } }).builder);
    const update = query({ error: null });
    database.from.mockReturnValueOnce(update.builder);

    await recordStudyActivity('user-1', 1, 0);

    expect(update.args('update')).toEqual([[{ cards_reviewed: 4, materials_added: 0 }]]);
  });

  it('keeps both answers when two writes overlap (read-then-write runs one at a time)', async () => {
    const row = { id: 'row-1', cards_reviewed: 3, materials_added: 0 };
    let reads = 0;
    database.from.mockImplementation(() => {
      let pendingUpdate: Partial<typeof row> | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        update: (values: Partial<typeof row>) => {
          pendingUpdate = values;
          return builder;
        },
        // A slow read: without ordering, the second call reads before the first one writes.
        maybeSingle: () => {
          reads += 1;
          const snapshot = { ...row };
          return new Promise((resolve) => setTimeout(() => resolve({ data: snapshot, error: null }), 5));
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          if (pendingUpdate) Object.assign(row, pendingUpdate);
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return builder;
    });

    await Promise.all([recordStudyActivity('user-1', 1, 0), recordStudyActivity('user-1', 1, 0)]);

    expect(reads).toBe(2);
    expect(row.cards_reviewed).toBe(5);
  });

  it('keeps writing after a failed write', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    database.from.mockImplementationOnce(() => {
      throw new Error('offline');
    });
    const read = query({ data: { id: 'row-1', cards_reviewed: 2, materials_added: 0 } });
    const update = query({ error: null });
    database.from.mockReturnValueOnce(read.builder).mockReturnValueOnce(update.builder);

    await Promise.all([recordStudyActivity('user-1', 1, 0), recordStudyActivity('user-1', 1, 0)]);

    expect(update.args('update')).toEqual([[{ cards_reviewed: 3, materials_added: 0 }]]);
  });

  it('never throws when the database is unreachable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    database.from.mockImplementation(() => {
      throw new Error('offline');
    });

    await expect(recordStudyActivity('user-1', 1, 0)).resolves.toBeUndefined();
  });
});

describe('checkAndAwardAchievements', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('counts only exams of the old format, not answers to exam tickets', async () => {
    const earned = query({ data: [{ achievement_id: 'first_exam' }] });
    const exams = query({ data: [] });
    const sessions = query({ data: [] });
    const materials = query({ data: [] });
    const mistakes = query({ data: [] });
    const xp = query({ data: { total_xp: 0 } });
    database.from
      .mockReturnValueOnce(earned.builder)
      .mockReturnValueOnce(exams.builder)
      .mockReturnValueOnce(sessions.builder)
      .mockReturnValueOnce(materials.builder)
      .mockReturnValueOnce(mistakes.builder)
      .mockReturnValueOnce(xp.builder);

    await expect(checkAndAwardAchievements('user-1')).resolves.toEqual([]);
    expect(exams.args('eq')).toContainEqual(['kind', 'professor']);
  });
});
