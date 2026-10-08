import { beforeEach, describe, expect, it, vi } from 'vitest';

/** What flashcard_progress answers: rows for the list, a count for one lecture, or an error. */
const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  count: 0 as number | null,
  error: null as null | { message: string },
  throws: false,
  calls: [] as Array<[string, ...unknown[]]>,
}));

vi.mock('./supabase', () => {
  const query = () => {
    const chain: Record<string, unknown> = {};
    const step =
      (name: string) =>
      (...args: unknown[]) => {
        db.calls.push([name, ...args]);
        if (db.throws) throw new Error('column flashcard_progress.origin does not exist');
        return chain;
      };
    chain.select = step('select');
    chain.eq = step('eq');
    chain.limit = (...args: unknown[]) => {
      db.calls.push(['limit', ...args]);
      return Promise.resolve({ data: db.error ? null : db.rows, error: db.error });
    };
    // The head count ends at its last .eq(): the chain is awaited there.
    chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve({ count: db.error ? null : db.count, error: db.error }).then(resolve, reject);
    return chain;
  };
  return { supabase: { from: (table: string) => (db.calls.push(['from', table]), query()) } };
});

import { cardsLine, followupCardsByLecture, followupCardsOf, FOLLOWUP_ORIGIN } from './followupCards';

beforeEach(() => {
  db.rows = [];
  db.count = 0;
  db.error = null;
  db.throws = false;
  db.calls = [];
});

describe('the line about a lecture’s cards (finding LIB-6, decision 4)', () => {
  const plain = (text: string) => text.replace(/\u00a0/g, ' ');

  it('names the cards from ticket answers apart from the lecture’s own', () => {
    expect(plain(cardsLine(6, 4))).toBe('6 карточек · ещё 4 из ответов на билеты');
    expect(plain(cardsLine(1, 1))).toBe('1 карточка · ещё 1 из ответов на билеты');
    expect(plain(cardsLine(6, 0))).toBe('6 карточек');
    expect(plain(cardsLine(0, 3))).toBe('3 карточки из ответов на билеты');
    expect(cardsLine(0, 0)).toBe('');
    expect(cardsLine(Number.NaN, -2)).toBe('');
  });

  it('never ends a line on a number, a short word or before «·»', () => {
    expect(cardsLine(6, 4)).toBe('6\u00a0карточек\u00a0· ещё\u00a04 из\u00a0ответов на\u00a0билеты');
  });
});

describe('reading the cards from ticket answers', () => {
  it('counts them by lecture in one request for the whole list', async () => {
    db.rows = [{ material_id: 'm1' }, { material_id: 'm1' }, { material_id: 'm2' }, { material_id: null }];
    const counts = await followupCardsByLecture('user-1');
    expect([...counts]).toEqual([
      ['m1', 2],
      ['m2', 1],
    ]);
    expect(db.calls).toEqual([
      ['from', 'flashcard_progress'],
      ['select', 'material_id'],
      ['eq', 'user_id', 'user-1'],
      ['eq', 'origin', FOLLOWUP_ORIGIN],
      ['limit', 5000],
    ]);
  });

  it('counts one lecture’s without reading the rows', async () => {
    db.count = 4;
    expect(await followupCardsOf('user-1', 'm1')).toBe(4);
    expect(db.calls).toEqual([
      ['from', 'flashcard_progress'],
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'user_id', 'user-1'],
      ['eq', 'material_id', 'm1'],
      ['eq', 'origin', FOLLOWUP_ORIGIN],
    ]);
  });

  it('shows the lecture’s own cards only when they cannot be read', async () => {
    db.error = { message: 'permission denied' };
    expect([...(await followupCardsByLecture('user-1'))]).toEqual([]);
    expect(await followupCardsOf('user-1', 'm1')).toBe(0);

    db.error = null;
    db.throws = true;
    expect([...(await followupCardsByLecture('user-1'))]).toEqual([]);
    expect(await followupCardsOf('user-1', 'm1')).toBe(0);
  });

  it('asks nothing without a user or a lecture', async () => {
    expect([...(await followupCardsByLecture(''))]).toEqual([]);
    expect(await followupCardsOf('user-1', '')).toBe(0);
    expect(db.calls).toEqual([]);
  });
});
