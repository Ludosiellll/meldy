import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountShape, isMemberOnly, readOwnWork } from './accountShape';

const reads = vi.hoisted(() => ({ tables: {} as Record<string, (calls: Array<[string, unknown[]]>) => unknown> }));
vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      const calls: Array<[string, unknown[]]> = [];
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq']) {
        chain[method] = (...args: unknown[]) => {
          calls.push([method, args]);
          return chain;
        };
      }
      chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        try {
          return Promise.resolve(reads.tables[table]?.(calls) ?? { data: [], error: null }).then(resolve, reject);
        } catch (error) {
          return Promise.reject(error).then(resolve, reject);
        }
      };
      return chain;
    },
  },
}));

const member = { role: 'member' as const };
const owner = { role: 'owner' as const };

describe('accountShape', () => {
  it('a group student: every exam is someone else’s, and nothing of its own', () => {
    expect(accountShape({ containers: [member], lectures: 0, ownExams: 0 })).toBe('member');
    expect(accountShape({ containers: [member, member] })).toBe('member');
    expect(isMemberOnly({ containers: [member], lectures: 0 })).toBe(true);
  });

  it('an author: an exam or a test of its own, a lecture, or an old exam outside the containers', () => {
    expect(accountShape({ containers: [owner] })).toBe('author');
    expect(accountShape({ containers: [member, owner], lectures: 0, ownExams: 0 })).toBe('author');
    expect(accountShape({ containers: [member], lectures: 2, ownExams: 0 })).toBe('author');
    expect(accountShape({ containers: [member], lectures: 0, ownExams: 1 })).toBe('author');
    expect(accountShape({ containers: [], lectures: 1 })).toBe('author');
    // What is known to be the author's wins over what is not known yet.
    expect(accountShape({ containers: [member], lectures: 3, ownExams: null })).toBe('author');
    expect(isMemberOnly({ containers: [owner] })).toBe(false);
  });

  it('a new account: nothing at all', () => {
    expect(accountShape({ containers: [], lectures: 0, ownExams: 0 })).toBe('new');
    expect(accountShape({ containers: [] })).toBe('new');
    expect(isMemberOnly({ containers: [], lectures: 0 })).toBe(false);
  });

  it('is not sure while a part is not known: the screens stay as they are', () => {
    expect(accountShape({ containers: null, lectures: 0, ownExams: 0 })).toBe('unknown');
    expect(accountShape({ containers: [member], lectures: null })).toBe('unknown');
    expect(accountShape({ containers: [member], lectures: 0, ownExams: null })).toBe('unknown');
    expect(isMemberOnly({ containers: [member], lectures: null })).toBe(false);
  });
});

describe('readOwnWork', () => {
  afterEach(() => {
    reads.tables = {};
  });

  it('counts the lectures by a HEAD request and the own exams outside the containers', async () => {
    const asked: Record<string, Array<[string, unknown[]]>> = {};
    reads.tables = {
      materials: (calls) => {
        asked.materials = calls;
        return { count: 0, error: null };
      },
      exams: (calls) => {
        asked.exams = calls;
        return { data: [{ id: 'copy-1' }, { id: 'own-1' }], error: null };
      },
    };
    expect(await readOwnWork('user-1', ['copy-1'])).toEqual({ lectures: 0, ownExams: 1 });
    expect(asked.materials).toEqual([
      ['select', ['id', { count: 'exact', head: true }]],
      ['eq', ['user_id', 'user-1']],
    ]);
    expect(asked.exams).toEqual([
      ['select', ['id']],
      ['eq', ['user_id', 'user-1']],
    ]);
  });

  it('says null for a count it could not read', async () => {
    reads.tables = {
      materials: () => ({ count: null, error: { message: 'offline' } }),
      exams: () => {
        throw new Error('offline');
      },
    };
    expect(await readOwnWork('user-1', [])).toEqual({ lectures: null, ownExams: null });
  });
});
