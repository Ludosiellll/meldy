import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  calls: [] as string[],
  result: { data: null as unknown, error: null as unknown },
}));

vi.mock('../lib/supabase', () => {
  const chain = {
    update: (values: Record<string, unknown>) => {
      db.calls.push(`update ${JSON.stringify(values)}`);
      return chain;
    },
    select: (columns: string) => {
      db.calls.push(`select ${columns}`);
      return chain;
    },
    eq: (column: string, value: unknown) => {
      db.calls.push(`eq ${column} ${String(value)}`);
      return chain;
    },
    // `await …select('id')` after an update: the chain is a thenable of the current result.
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(db.result).then(resolve, reject),
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

import { getMaterialById, setMaterialVisibility, updateMaterialSubject, updateMaterialTitle } from './materials';

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

describe('renaming a lecture and changing its subject', () => {
  it('writes the one column of the caller’s row and asks which rows changed', async () => {
    db.result = { data: [{ id: 'm1' }], error: null };
    await expect(updateMaterialTitle('m1', 'Энтропия')).resolves.toBeUndefined();
    expect(db.calls).toEqual(['from materials', 'update {"title":"Энтропия"}', 'eq id m1', 'select id']);
    db.calls = [];
    await expect(updateMaterialSubject('m1', 'Физика')).resolves.toBeUndefined();
    expect(db.calls).toEqual(['from materials', 'update {"subject":"Физика"}', 'eq id m1', 'select id']);
  });

  it('a failed request is an error, not a line in the console: the page keeps the old title (debt of 19.10)', async () => {
    const failure = { code: '500', message: 'network' };
    db.result = { data: null, error: failure };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(updateMaterialTitle('m1', 'Новое')).rejects.toBe(failure);
    await expect(updateMaterialSubject('m1', 'Новый')).rejects.toBe(failure);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it('a write that changed no row (someone else’s lecture, a deleted one) is an error too', async () => {
    db.result = { data: [], error: null };
    await expect(updateMaterialTitle('m1', 'Новое')).rejects.toThrow('Материал не изменён');
    await expect(updateMaterialSubject('m1', 'Новый')).rejects.toThrow('Материал не изменён');
    await expect(setMaterialVisibility('m1', true)).rejects.toThrow('Материал не изменён');
  });
});
