import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { data?: unknown; error: unknown };

/**
 * supabase-js в памяти: RPC ai_quota_status (сервер) и запасной путь через таблицы profiles и
 * ai_usage. Любая запись в ai_usage — ошибка теста: с 2026-10-04 браузер её не пишет.
 */
const db = vi.hoisted(() => ({
  rpc: { data: null, error: null } as Result,
  rpcThrows: false,
  rpcCalls: [] as Array<[string, unknown]>,
  profile: { data: null, error: null } as Result,
  usage: { data: null, error: null } as Result,
  usageFilters: [] as Array<Array<[string, unknown]>>,
  writes: [] as string[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: async (fn: string, args?: unknown) => {
      db.rpcCalls.push([fn, args]);
      if (db.rpcThrows) throw new Error('offline');
      return db.rpc;
    },
    from: (table: string) => ({
      select: () => {
        const filters: Array<[string, unknown]> = [];
        const chain = {
          eq(column: string, value: unknown) {
            filters.push([column, value]);
            return chain;
          },
          maybeSingle: async () => {
            if (table === 'profiles') return db.profile;
            db.usageFilters.push(filters);
            return db.usage;
          },
        };
        return chain;
      },
      insert: async () => {
        db.writes.push(`insert ${table}`);
        return { error: null };
      },
      update: () => {
        db.writes.push(`update ${table}`);
        return { eq: () => ({ select: async () => ({ data: [], error: null }) }) };
      },
    }),
  },
}));

import {
  AI_LIMIT_EVENT,
  AI_LIMIT_MESSAGE,
  AI_USAGE_EVENT,
  FREE_DAILY_LIMIT,
  PRO_DAILY_LIMIT,
  aiLimitFromBody,
  checkAILimit,
  formatLimitReset,
  incrementAIUsage,
  nextLimitReset,
  notifyAIUsageChanged,
  remainingUnits,
  reportAILimit,
  resetAILimitReportsForTests,
  type AILimitInfo,
} from './limits';
import { FREE_DAILY_UNITS, PRO_DAILY_UNITS } from '../lib/plans';

const TODAY = '2026-10-02';
const RESET = new Date('2026-10-03T00:00:00Z');

let usageEvents = 0;
let limitEvents: AILimitInfo[] = [];
const onUsage = () => {
  usageEvents += 1;
};
const onLimit = (event: Event) => {
  limitEvents.push((event as CustomEvent<AILimitInfo>).detail);
};

function serverStatus(used: number, pro = false) {
  return { data: { pro, used, limit: pro ? 1000 : 100, day: TODAY, resets_at: `${'2026-10-03'}T00:00:00Z` }, error: null };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  db.rpc = serverStatus(0);
  db.rpcThrows = false;
  db.rpcCalls = [];
  db.profile = { data: { is_pro: false }, error: null };
  db.usage = { data: null, error: null };
  db.usageFilters = [];
  db.writes = [];
  usageEvents = 0;
  limitEvents = [];
  resetAILimitReportsForTests();
  window.addEventListener(AI_USAGE_EVENT, onUsage);
  window.addEventListener(AI_LIMIT_EVENT, onLimit);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  window.removeEventListener(AI_USAGE_EVENT, onUsage);
  window.removeEventListener(AI_LIMIT_EVENT, onLimit);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('constants', () => {
  it('takes the limits from lib/plans and keeps the event name', () => {
    expect(FREE_DAILY_LIMIT).toBe(FREE_DAILY_UNITS);
    expect(PRO_DAILY_LIMIT).toBe(PRO_DAILY_UNITS);
    expect([FREE_DAILY_LIMIT, PRO_DAILY_LIMIT]).toEqual([100, 1000]);
    expect(AI_USAGE_EVENT).toBe('ai_usage_updated');
  });
});

describe('checkAILimit', () => {
  it('reads the server status and allows when the cost fits', async () => {
    db.rpc = serverStatus(80);
    await expect(checkAILimit('user-1', 20)).resolves.toEqual({
      allowed: true, isPro: false, count: 80, ok: true, limit: 100, resetsAt: RESET,
    });
    expect(db.rpcCalls).toEqual([['ai_quota_status', undefined]]);
    expect(db.usageFilters).toEqual([]);
  });

  it('refuses when the cost does not fit', async () => {
    db.rpc = serverStatus(90);
    const status = await checkAILimit('user-1', 20);
    expect(status.allowed).toBe(false);
    expect(status.count).toBe(90);
  });

  it('limits PRO at 1000 units a day instead of letting everything through', async () => {
    db.rpc = serverStatus(990, true);
    await expect(checkAILimit('user-1', 10)).resolves.toMatchObject({ allowed: true, isPro: true, count: 990, limit: 1000 });
    await expect(checkAILimit('user-1', 11)).resolves.toMatchObject({ allowed: false, isPro: true });
  });

  it('falls back to today’s UTC row when the server function is not there yet', async () => {
    db.rpc = { data: null, error: { code: 'PGRST202', message: 'function not found' } };
    db.usage = { data: { requests_count: 70 }, error: null };
    await expect(checkAILimit('user-1', 20)).resolves.toEqual({
      allowed: true, isPro: false, count: 70, ok: true, limit: 100, resetsAt: RESET,
    });
    expect(db.usageFilters).toEqual([[['user_id', 'user-1'], ['date', TODAY]]]);
  });

  it('uses the PRO limit from the profile on the fallback path', async () => {
    db.rpcThrows = true;
    db.profile = { data: { is_pro: true }, error: null };
    db.usage = { data: { requests_count: 400 }, error: null };
    await expect(checkAILimit('user-1', 20)).resolves.toMatchObject({ allowed: true, isPro: true, count: 400, limit: 1000 });
  });

  it('treats a missing row as zero used', async () => {
    db.rpc = { data: null, error: { message: 'no function' } };
    await expect(checkAILimit('user-1', 20)).resolves.toMatchObject({ allowed: true, count: 0, ok: true });
  });

  it('reports ok: false (and does not block) when nothing can be read', async () => {
    db.rpc = { data: null, error: { message: 'no function' } };
    db.profile = { data: null, error: { message: 'down' } };
    await expect(checkAILimit('user-1', 20)).resolves.toMatchObject({ allowed: true, isPro: false, count: 0, ok: false, limit: 100 });
    db.profile = { data: { is_pro: false }, error: null };
    db.usage = { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
    await expect(checkAILimit('user-1', 20)).resolves.toMatchObject({ allowed: true, ok: false });
  });

  it('ignores a server answer it cannot read and falls back', async () => {
    db.rpc = { data: { used: 'many' }, error: null };
    db.usage = { data: { requests_count: 5 }, error: null };
    await expect(checkAILimit('user-1', 0)).resolves.toMatchObject({ ok: true, count: 5, limit: 100 });
  });
});

describe('after an AI action', () => {
  it('notifyAIUsageChanged only broadcasts: the server charged the units', () => {
    notifyAIUsageChanged();
    expect(usageEvents).toBe(1);
    expect(db.writes).toEqual([]);
  });

  it('the old incrementAIUsage writes nothing any more, it only broadcasts', async () => {
    await incrementAIUsage('user-1', 20);
    await incrementAIUsage('user-1', 0);
    expect(db.writes).toEqual([]);
    expect(usageEvents).toBe(1);
  });
});

describe('the server refused by the daily limit', () => {
  it('reads used, limit, units, the reset time and PRO from a 429 ai_limit body', () => {
    const info = aiLimitFromBody({
      detail: AI_LIMIT_MESSAGE, code: 'ai_limit', used: 95, limit: 100, units: 20, resets_at: '2026-10-03T00:00:00Z', pro: false,
    });
    expect(info).toEqual({ used: 95, limit: 100, units: 20, resetsAt: RESET, pro: false });
    expect(remainingUnits(info!)).toBe(5);
    expect(aiLimitFromBody({ detail: 'Сервис занят', code: 'ai_busy' })).toBeNull();
    expect(aiLimitFromBody('nope')).toBeNull();
    const bare = aiLimitFromBody({ code: 'ai_limit' })!;
    expect([bare.used, bare.limit, bare.units, bare.pro]).toEqual([null, null, null, false]);
    expect(bare.resetsAt).toEqual(nextLimitReset());
    expect(remainingUnits(bare)).toBe(0);
  });

  it('opens one dialog for refusals that come together and refreshes the meter', () => {
    const info: AILimitInfo = { used: 100, limit: 100, units: 4, resetsAt: RESET, pro: false };
    reportAILimit(info);
    reportAILimit(info);
    expect(limitEvents).toEqual([info]);
    expect(usageEvents).toBe(1);
    vi.setSystemTime(new Date(`${TODAY}T12:00:05Z`));
    reportAILimit(info);
    expect(limitEvents).toHaveLength(2);
  });
});

describe('limit reset time', () => {
  it('is the next 00:00 UTC', () => {
    expect(nextLimitReset(new Date('2026-10-02T21:30:00Z')).toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(nextLimitReset(new Date('2026-10-03T00:00:00Z')).toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(nextLimitReset(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('formats as H:mm in the viewer’s local time, the way the sheet and the ticket write it', () => {
    const reset = new Date('2026-10-03T00:00:00Z');
    const expected = `${reset.getHours()}:${String(reset.getMinutes()).padStart(2, '0')}`;
    expect(formatLimitReset(reset)).toBe(expected);
    // No leading zero on the hour (QA r3 #2): «3:00», never «03:00».
    expect(formatLimitReset(new Date(2026, 9, 3, 3, 0))).toBe('3:00');
    expect(formatLimitReset(new Date(2026, 9, 3, 7, 5))).toBe('7:05');
    expect(formatLimitReset(new Date(2026, 9, 3, 0, 0))).toBe('0:00');
    expect(formatLimitReset(new Date(2026, 9, 3, 13, 30))).toBe('13:30');
  });
});
