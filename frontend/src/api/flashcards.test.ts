import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FlashcardSaveError,
  countDueCards,
  getDueCards,
  nextSchedule,
  syncFlashcards,
  updateCardProgress,
} from './flashcards';

const database = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: database }));

type Result = { data?: unknown; error?: unknown; count?: number | null };

/** A chainable PostgREST query stub: every call is recorded, awaiting it gives `result`. */
function query(result: Result) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'lte', 'order', 'limit', 'insert', 'update', 'single', 'in']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null, ...result }).then(resolve, reject);
  return { builder, calls, args: (method: string) => calls.filter(([name]) => name === method).map(([, args]) => args) };
}

const card = { id: 'card-1', ease_factor: 2.5, interval_days: 6, repetitions: 2 };

describe('updateCardProgress', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('saves through the review_flashcard RPC with the given event id and the local date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 3, 12, 0, 0));
    database.rpc.mockResolvedValue({
      data: {
        card_id: 'card-1', ease_factor: 2.6, interval_days: 15, repetitions: 3,
        next_review: '2026-10-18T09:00:00Z', last_reviewed_at: '2026-10-03T09:00:00Z', duplicate: false,
      },
      error: null,
    });

    const result = await updateCardProgress('card-1', 5, {
      clientEventId: 'evt-12345678',
      sessionId: '11111111-2222-4333-8444-555555555555',
    });
    vi.useRealTimers();

    expect(database.rpc).toHaveBeenCalledTimes(1);
    expect(database.rpc).toHaveBeenCalledWith('review_flashcard', {
      p_card_id: 'card-1',
      p_quality: 5,
      p_client_event_id: 'evt-12345678',
      p_local_date: '2026-10-03',
      p_session_id: '11111111-2222-4333-8444-555555555555',
    });
    expect(database.from).not.toHaveBeenCalled();
    expect(result).toEqual({
      card_id: 'card-1', ease_factor: 2.6, interval_days: 15, repetitions: 3,
      next_review: '2026-10-18T09:00:00Z', last_reviewed_at: '2026-10-03T09:00:00Z', duplicate: false,
    });
  });

  it('creates an event id when none is given and never sends a session id that is not a uuid', async () => {
    database.rpc.mockResolvedValue({ data: { card_id: 'card-1', duplicate: true }, error: null });

    const result = await updateCardProgress('card-1', 3, { sessionId: 'not-a-uuid' });

    const args = database.rpc.mock.calls[0][1];
    expect(args.p_client_event_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(args.p_session_id).toBeNull();
    expect(result.duplicate).toBe(true);
  });

  it('rejects with a Russian message when the RPC fails and does not fall back to a direct write', async () => {
    database.rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'connection failure' } });

    const error = await updateCardProgress('card-1', 5).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FlashcardSaveError);
    expect((error as Error).message).toBe('Ответ не сохранён. Проверьте соединение и попробуйте ещё раз.');
    expect((error as Error).message).not.toContain('connection');
    expect(database.from).not.toHaveBeenCalled();
  });

  it('rejects a quality outside 0..5 before calling the server', async () => {
    await expect(updateCardProgress('card-1', 7)).rejects.toBeInstanceOf(FlashcardSaveError);
    expect(database.rpc).not.toHaveBeenCalled();
  });

  describe('without the RPC on the server (PGRST202)', () => {
    beforeEach(() => {
      database.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('reads the card and writes the SM-2 schedule with last_reviewed_at', async () => {
      const read = query({ data: card });
      const write = query({ data: null, error: null });
      database.from.mockReturnValueOnce(read.builder).mockReturnValueOnce(write.builder);

      const result = await updateCardProgress('card-1', 5);

      expect(read.args('eq')).toEqual([['id', 'card-1']]);
      const [values] = write.args('update')[0] as [Record<string, unknown>];
      expect(values).toMatchObject({ ease_factor: 2.6, interval_days: 15, repetitions: 3 });
      expect(typeof values.next_review).toBe('string');
      expect(typeof values.last_reviewed_at).toBe('string');
      expect(write.args('eq')).toEqual([['id', 'card-1']]);
      expect(result).toMatchObject({ card_id: 'card-1', repetitions: 3, interval_days: 15, duplicate: false });
    });

    it('writes without last_reviewed_at where that column does not exist yet', async () => {
      const read = query({ data: card });
      const first = query({ error: { code: 'PGRST204', message: "Could not find the 'last_reviewed_at' column" } });
      const second = query({ error: null });
      database.from
        .mockReturnValueOnce(read.builder)
        .mockReturnValueOnce(first.builder)
        .mockReturnValueOnce(second.builder);

      await updateCardProgress('card-1', 1);

      const [retried] = second.args('update')[0] as [Record<string, unknown>];
      expect(retried).not.toHaveProperty('last_reviewed_at');
      expect(retried).toMatchObject({ repetitions: 0, interval_days: 1 });
    });

    it('rejects when reading the saved schedule fails', async () => {
      database.from.mockReturnValueOnce(query({ data: null, error: { code: '08006', message: 'read failed' } }).builder);

      await expect(updateCardProgress('card-1', 5)).rejects.toThrow('Ответ не сохранён');
    });

    it('rejects when writing the next review schedule fails', async () => {
      database.from
        .mockReturnValueOnce(query({ data: card }).builder)
        .mockReturnValueOnce(query({ error: { code: '08006', message: 'write failed' } }).builder);

      await expect(updateCardProgress('card-1', 5)).rejects.toThrow('Ответ не сохранён');
    });
  });
});

describe('nextSchedule (SM-2, the same as review_flashcard)', () => {
  it('follows the 1 → 6 → round(interval × ease) intervals and resets on a miss', () => {
    let state = { ease_factor: 2.5, interval_days: 1, repetitions: 0 };
    state = nextSchedule(state, 5);
    expect(state).toEqual({ ease_factor: 2.6, interval_days: 1, repetitions: 1 });
    state = nextSchedule(state, 4);
    expect(state.interval_days).toBe(6);
    expect(state.repetitions).toBe(2);
    expect(state.ease_factor).toBeCloseTo(2.6);
    state = nextSchedule(state, 3);
    expect(state.interval_days).toBe(16);
    expect(state.ease_factor).toBeCloseTo(2.46);
    expect(nextSchedule(state, 1)).toEqual({ ease_factor: state.ease_factor, interval_days: 1, repetitions: 0 });
    expect(nextSchedule({ ease_factor: 1.3, interval_days: 1, repetitions: 0 }, 3).ease_factor).toBe(1.3);
  });
});

describe('getDueCards', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('asks for follow-up cards first, then by due date, at most 20 by default', async () => {
    const due = query({ data: [] });
    database.from.mockReturnValueOnce(due.builder);

    await getDueCards('user-1');

    expect(due.args('eq')).toEqual([['user_id', 'user-1']]);
    expect(due.args('order')).toEqual([
      ['origin', { ascending: false }],
      ['next_review', { ascending: true }],
    ]);
    expect(due.args('limit')).toEqual([[20]]);
  });

  it('filters by material and honours the limit', async () => {
    const due = query({ data: [] });
    database.from.mockReturnValueOnce(due.builder);

    await getDueCards('user-1', { materialId: 'm-1', limit: 5 });

    expect(due.args('eq')).toEqual([['user_id', 'user-1'], ['material_id', 'm-1']]);
    expect(due.args('limit')).toEqual([[5]]);
  });

  it('keeps follow-up cards first and falls back to due date order without the origin column', async () => {
    const failed = query({ error: { code: '42703', message: 'column flashcard_progress.origin does not exist' } });
    const plain = query({
      data: [
        { id: 'a', origin: 'analysis', question: 'Q1', answer: 'A1' },
        { id: 'f', origin: 'oral_followup', question: 'Q2', answer: 'A2' },
        { id: 'b', question: 'Q3', answer: 'A3' },
      ],
    });
    database.from.mockReturnValueOnce(failed.builder).mockReturnValueOnce(plain.builder);

    const cards = await getDueCards('user-1');

    expect(plain.args('order')).toEqual([['next_review', { ascending: true }]]);
    expect(cards.map((c) => c.id)).toEqual(['f', 'a', 'b']);
  });

  it('rejects when the queue cannot be read', async () => {
    database.from.mockReturnValueOnce(query({ error: { code: '08006', message: 'offline' } }).builder);
    await expect(getDueCards('user-1')).rejects.toMatchObject({ code: '08006' });
  });
});

describe('countDueCards', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('counts every due card exactly without fetching rows', async () => {
    const head = query({ data: null, count: 47 });
    database.from.mockReturnValueOnce(head.builder);

    await expect(countDueCards('user-1')).resolves.toBe(47);

    expect(head.args('select')).toEqual([['id', { count: 'exact', head: true }]]);
    expect(head.args('eq')).toEqual([['user_id', 'user-1']]);
    expect(head.args('lte')[0][0]).toBe('next_review');
    expect(head.args('limit')).toEqual([]);
  });

  it('filters by material and rejects on error', async () => {
    const head = query({ count: 3 });
    database.from.mockReturnValueOnce(head.builder);
    await expect(countDueCards('user-1', { materialId: 'm-1' })).resolves.toBe(3);
    expect(head.args('eq')).toEqual([['user_id', 'user-1'], ['material_id', 'm-1']]);

    database.from.mockReturnValueOnce(query({ error: { code: '08006' } }).builder);
    await expect(countDueCards('user-1')).rejects.toMatchObject({ code: '08006' });
  });
});

describe('syncFlashcards', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('skips blank cards, questions already scheduled and repeats inside the batch', async () => {
    const existing = query({ data: [{ question: 'Что такое энтропия?' }] });
    const insert = query({ error: null });
    database.from.mockReturnValueOnce(existing.builder).mockReturnValueOnce(insert.builder);

    const result = await syncFlashcards('user-1', 'm-1', [
      { question: 'Что такое энтропия?', answer: 'Мера беспорядка' },
      { question: '  ', answer: 'Пусто' },
      { question: 'Без ответа', answer: '' },
      { question: 'Второй закон', answer: 'Энтропия не убывает', source_ids: ['S02', 'x', 'S02'] },
      { question: 'второй  закон', answer: 'Повтор' },
      { front: 'Кто ввёл энтропию?', back: 'Клаузиус' } as never,
    ]);

    expect(existing.args('eq')).toEqual([['user_id', 'user-1'], ['material_id', 'm-1']]);
    const [rows] = insert.args('insert')[0] as [Array<Record<string, unknown>>];
    expect(rows).toEqual([
      { user_id: 'user-1', material_id: 'm-1', question: 'Второй закон', answer: 'Энтропия не убывает', source_ids: ['S02'] },
      { user_id: 'user-1', material_id: 'm-1', question: 'Кто ввёл энтропию?', answer: 'Клаузиус', source_ids: [] },
    ]);
    expect(result).toEqual({ inserted: 2, skipped: 4 });
  });

  it('rejects with a Russian message when the insert fails', async () => {
    database.from
      .mockReturnValueOnce(query({ data: [] }).builder)
      .mockReturnValueOnce(query({ error: { code: '23502', message: 'null value in column "question"' } }).builder);

    const error = await syncFlashcards('user-1', 'm-1', [{ question: 'Вопрос', answer: 'Ответ' }]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FlashcardSaveError);
    expect((error as Error).message).toBe('Карточки не добавлены в повторение. Повторите попытку.');
  });

  it('rejects when the existing cards cannot be read', async () => {
    database.from.mockReturnValueOnce(query({ error: { code: '08006', message: 'offline' } }).builder);

    await expect(syncFlashcards('user-1', 'm-1', [{ question: 'Вопрос', answer: 'Ответ' }])).rejects.toThrow(
      'Карточки не добавлены в повторение',
    );
  });

  it('inserts without source ids where that column does not exist yet', async () => {
    const insertWithIds = query({ error: { code: 'PGRST204', message: "Could not find the 'source_ids' column" } });
    const insertPlain = query({ error: null });
    database.from
      .mockReturnValueOnce(query({ data: [] }).builder)
      .mockReturnValueOnce(insertWithIds.builder)
      .mockReturnValueOnce(insertPlain.builder);

    await expect(syncFlashcards('user-1', 'm-1', [{ question: 'Вопрос', answer: 'Ответ', source_ids: ['S01'] }])).resolves.toEqual({
      inserted: 1,
      skipped: 0,
    });
    const [rows] = insertPlain.args('insert')[0] as [Array<Record<string, unknown>>];
    expect(rows[0]).not.toHaveProperty('source_ids');
  });

  it('writes nothing when every card is blank or known', async () => {
    database.from.mockReturnValueOnce(query({ data: [{ question: 'Вопрос' }] }).builder);

    await expect(syncFlashcards('user-1', 'm-1', [{ question: 'Вопрос', answer: 'Ответ' }])).resolves.toEqual({
      inserted: 0,
      skipped: 1,
    });
    expect(database.from).toHaveBeenCalledTimes(1);
  });
});
