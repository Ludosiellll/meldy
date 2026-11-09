import { beforeEach, describe, expect, it, vi } from 'vitest';
import groupSummaryJson from '../../../contracts/container/group_summary.json';

/**
 * The author's summary of the group (20261109090000, docs/answers-privacy.md): container_group_summary through the
 * app's Supabase client, and what the page may draw from its answer. A group under the threshold has no numbers, and
 * the normaliser keeps it so whatever the body holds.
 */
type Answer = { data: unknown; error: unknown; status?: number };

const db = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  answer: (_name: string, _args: Record<string, unknown>): Answer => ({ data: null, error: null, status: 200 }),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc(name: string, args: Record<string, unknown>) {
      db.calls.push({ name, args });
      const builder = {
        abortSignal: () => builder,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve().then(() => db.answer(name, args)).then(resolve, reject),
      };
      return builder;
    },
  },
}));

import { ContainerApiError, GROUP_MIN_MEMBERS, fetchGroupSummary, isGone, normalizeGroupSummary } from './containers';

const C1 = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';

async function caught(promise: Promise<unknown>): Promise<ContainerApiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ContainerApiError);
    return error as ContainerApiError;
  }
  throw new Error('expected a ContainerApiError');
}

beforeEach(() => {
  db.calls.length = 0;
  db.answer = () => ({ data: null, error: null, status: 200 });
});

describe('container_group_summary', () => {
  it('asks for the exam and reads the numbers as the database gives them', async () => {
    db.answer = () => ({ data: groupSummaryJson, error: null, status: 200 });
    const read = await fetchGroupSummary(C1);
    expect(db.calls).toEqual([{ name: 'container_group_summary', args: { p_container_id: C1 } }]);
    expect(read).toEqual({
      members: 6,
      min_members: 5,
      numbers: {
        studied_7d: 2,
        studied_prev_7d: 5,
        studied_ever: 6,
        learned_pct: 28,
        hard_topics: [
          { subject: 'Основы программирования', topic: 'Тема 2. Делегаты и события', answers: 48, wrong_pct: 44 },
          { subject: 'История Беларуси', topic: null, answers: 31, wrong_pct: 39 },
        ],
      },
    });
  });

  it('a group under five: how many are in it and nothing else', async () => {
    db.answer = () => ({ data: { members: 4, min_members: 5 }, error: null, status: 200 });
    expect(await fetchGroupSummary(C1)).toEqual({ members: 4, min_members: 5, numbers: null });
  });

  it('not the caller’s exam (a member, a stranger): P0002, as the other author’s reads', async () => {
    db.answer = () => ({ data: null, error: { code: 'P0002', message: 'container not found' }, status: 500 });
    const error = await caught(fetchGroupSummary(C1));
    expect(error.code).toBe('P0002');
    expect(isGone(error)).toBe(true);
  });

  it('a database without the function yet: unavailable, never numbers', async () => {
    db.answer = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 });
    expect((await caught(fetchGroupSummary(C1))).code).toBe('unavailable');
  });

  it('an empty or broken body is an error, not a group of nobody', async () => {
    for (const data of [null, [], 'ok', {}, { members: '6' }]) {
      db.answer = () => ({ data, error: null, status: 200 });
      expect((await caught(fetchGroupSummary(C1))).detail).toBe('bad shape: container_group_summary');
    }
  });
});

describe('normalizeGroupSummary: what the page may draw', () => {
  const full = { members: 19, min_members: 5, studied_7d: 6, studied_prev_7d: 16, studied_ever: 17, learned_pct: 40, hard_topics: [] };

  it('never gives numbers about fewer than five people, whatever the body says', () => {
    expect(GROUP_MIN_MEMBERS).toBe(5);
    // Numbers that should not have come for 4 members are dropped.
    expect(normalizeGroupSummary({ ...full, members: 4 })).toEqual({ members: 4, min_members: 5, numbers: null });
    // A threshold lower than ours is not taken: 3 members stay without numbers.
    expect(normalizeGroupSummary({ ...full, members: 3, min_members: 2 })).toEqual({ members: 3, min_members: 5, numbers: null });
    // A higher one is the server's to set.
    expect(normalizeGroupSummary({ ...full, members: 7, min_members: 8 })).toEqual({ members: 7, min_members: 8, numbers: null });
    // Five members without the numbers (an older body): none are made up.
    expect(normalizeGroupSummary({ members: 5, min_members: 5 })).toEqual({ members: 5, min_members: 5, numbers: null });
  });

  it('keeps each count within the group and the percents within 0–100', () => {
    const read = normalizeGroupSummary({ ...full, studied_7d: 25, studied_prev_7d: -3, studied_ever: '17', learned_pct: 140 });
    expect(read.numbers).toMatchObject({ studied_7d: 19, studied_prev_7d: 0, studied_ever: 17, learned_pct: 100 });
    expect(normalizeGroupSummary({ ...full, learned_pct: null }).numbers?.learned_pct).toBeNull();
    expect(normalizeGroupSummary({ ...full, learned_pct: 'много' }).numbers?.learned_pct).toBeNull();
  });

  it('takes at most three topics, each with a subject and its numbers; a topic without a title is the subject', () => {
    const topics = [
      { subject: 'Базы данных', topic: 'Транзакции', answers: 40, wrong_pct: 45 },
      { subject: 'Сети', topic: null, answers: 30, wrong_pct: 67 },
      { subject: 'Сети', topic: '  ', answers: 35, wrong_pct: 20 },
      { subject: 'Базы данных', topic: 'Индексы', answers: 41, wrong_pct: 73 },
      { subject: '', topic: 'Без предмета', answers: 50, wrong_pct: 10 },
      'мусор',
      { subject: 'Сети', topic: 'Без чисел' },
    ];
    expect(normalizeGroupSummary({ ...full, hard_topics: topics }).numbers?.hard_topics).toEqual([
      { subject: 'Базы данных', topic: 'Транзакции', answers: 40, wrong_pct: 45 },
      { subject: 'Сети', topic: null, answers: 30, wrong_pct: 67 },
      { subject: 'Сети', topic: null, answers: 35, wrong_pct: 20 },
    ]);
    expect(normalizeGroupSummary({ ...full, hard_topics: 'нет' }).numbers?.hard_topics).toEqual([]);
  });

  it('carries nothing but numbers and titles: a field that could say who is not passed on', () => {
    const read = normalizeGroupSummary({
      ...full,
      user_ids: ['9a000000-0000-4000-8000-000000000001'],
      names: ['Первая Выдуманная'],
      hard_topics: [{ subject: 'Сети', topic: null, answers: 30, wrong_pct: 67, user_id: '9a000000-0000-4000-8000-000000000001', name: 'Первая Выдуманная' }],
    });
    expect(Object.keys(read).sort()).toEqual(['members', 'min_members', 'numbers']);
    expect(Object.keys(read.numbers ?? {}).sort()).toEqual(['hard_topics', 'learned_pct', 'studied_7d', 'studied_ever', 'studied_prev_7d']);
    expect(Object.keys(read.numbers?.hard_topics[0] ?? {}).sort()).toEqual(['answers', 'subject', 'topic', 'wrong_pct']);
    expect(JSON.stringify(read)).not.toMatch(/9a000000|Выдуманная/);
  });
});
