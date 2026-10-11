import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  calls: [] as string[],
  result: { data: null as unknown, error: null as unknown },
}));

vi.mock('../lib/supabase', () => {
  const chain = {
    select: (columns: string) => {
      db.calls.push(`select ${columns}`);
      return chain;
    },
    eq: (column: string, value: unknown) => {
      db.calls.push(`eq ${column} ${String(value)}`);
      return chain;
    },
    single: async () => {
      db.calls.push('single');
      return db.result;
    },
    maybeSingle: async () => {
      db.calls.push('maybeSingle');
      return db.result;
    },
  };
  return {
    supabase: {
      from: (table: string) => {
        db.calls.push(`from ${table}`);
        return chain;
      },
    },
  };
});

import { getMaterialById } from './materials';

beforeEach(() => {
  db.calls = [];
  db.result = { data: null, error: null };
});

describe('getMaterialById', () => {
  it('reads a missing lecture as no row, not as an error (QA 2026-10-11: 406 and PGRST116 in the console)', async () => {
    await expect(getMaterialById('gone')).resolves.toBeNull();
    // single() asks PostgREST for exactly one object and gets a 406 for none; maybeSingle() takes none as an answer.
    expect(db.calls).toEqual(['from materials', 'select *', 'eq id gone', 'maybeSingle']);
  });

  it('gives the row when there is one, and a real failure as an error', async () => {
    db.result = { data: { id: 'm1', title: 'Клетка' }, error: null };
    await expect(getMaterialById('m1')).resolves.toEqual({ id: 'm1', title: 'Клетка' });
    const failure = { code: '500', message: 'network' };
    db.result = { data: null, error: failure };
    await expect(getMaterialById('m1')).rejects.toBe(failure);
  });
});
