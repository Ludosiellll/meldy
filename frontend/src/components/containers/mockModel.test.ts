import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/containers/session', async (original) => (await import('./testkit/engine')).sessionModule(original));

import { clock, drawMock, isAnswered, mockAnswers, scoreMock } from './mockModel';
import { SUBJECT_DB, dbItems, item, planInput, planItemsFor, unit } from './testkit/fixtures';

describe('«Как на экзамене» without React', () => {
  const bankItems = Array.from({ length: 12 }, (_, i) => item({ id: `m${i}`, position: i + 1, topic: (i % 3) + 1 }));
  const bank = new Map(bankItems.map((entry) => [entry.id, entry]));

  it('draws from the seen questions while anything is unseen, across topics, the same for the same seed', () => {
    const seen = { m0: unit({ seen: 1 }), m1: unit({ seen: 1 }), m2: unit({ seen: 2 }), m4: unit({ seen: 1 }), m5: unit({ seen: 1 }), m7: unit({ seen: 1 }) };
    const input = planInput({ items: planItemsFor(bankItems, seen) });
    const four = drawMock(input, bank, SUBJECT_DB, 4, 'seed-1');
    expect(four).toHaveLength(4);
    expect(four.every((id) => id in seen)).toBe(true);
    expect(new Set(four.map((id) => bank.get(id)!.topic)).size).toBe(3);
    expect(drawMock(input, bank, SUBJECT_DB, 4, 'seed-1')).toEqual(four);
    // More than the seen ones: the rest comes from the unseen.
    const ten = drawMock(input, bank, SUBJECT_DB, 10, 'seed-2');
    expect(ten).toHaveLength(10);
    expect(Object.keys(seen).every((id) => ten.includes(id))).toBe(true);
    expect(new Set(ten).size).toBe(10);
  });

  it('scores on the device: unanswered questions are errors', () => {
    const items = dbItems();
    const map = new Map(items.map((entry) => [entry.id, entry]));
    const result = scoreMock(['q-iso', 'q-multi', 'q-short', 'q-plain'], { 'q-iso': [3], 'q-multi': [0, 2], 'q-short': ' Rollback ' }, map);
    expect(result).toEqual({ correct: 2, unanswered: 1, wrongIds: ['q-multi', 'q-plain'] });
    expect(isAnswered('')).toBe(false);
    expect(isAnswered([])).toBe(false);
  });

  it('sends every question as a mock answer, unanswered as null, with its shown order', () => {
    const items = dbItems();
    const map = new Map(items.map((entry) => [entry.id, entry]));
    const answers = mockAnswers({ runId: 'run-1', itemIds: ['q-iso', 'q-short', 'q-multi'], answers: { 'q-iso': [3] }, orders: { 'q-iso': [3, 2, 1, 0] }, bank: map });
    expect(answers).toEqual([
      { client_event_id: 'run-1:01', item_id: 'q-iso', rev: 1, mode: 'mock', cls: 'free', chosen: 3, shown_order: [3, 2, 1, 0] },
      { client_event_id: 'run-1:02', item_id: 'q-short', rev: 1, mode: 'mock', cls: 'free', text: null },
      { client_event_id: 'run-1:03', item_id: 'q-multi', rev: 1, mode: 'mock', cls: 'free', chosen: null, shown_order: [0, 1, 2, 3, 4] },
    ]);
  });

  it('shows the clock as minutes and seconds', () => {
    expect(clock(31 * 60_000 + 20_000)).toBe('31:20');
    expect(clock(0)).toBe('0:00');
    expect(clock(-5)).toBe('0:00');
  });
});
