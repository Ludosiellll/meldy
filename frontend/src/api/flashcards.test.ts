import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateCardProgress } from './flashcards';

const database = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: database }));

const card = {
  id: 'card-1',
  ease_factor: 2.5,
  interval_days: 1,
  repetitions: 2,
};

function configureQueries(readError: Error | null, writeError: Error | null) {
  const readQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: readError ? null : card, error: readError }),
  };
  const writeQuery = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: null, error: writeError }),
  };
  database.from.mockReturnValueOnce(readQuery).mockReturnValueOnce(writeQuery);
}

describe('updateCardProgress', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('rejects when reading the saved schedule fails', async () => {
    const error = new Error('read failed');
    configureQueries(error, null);

    await expect(updateCardProgress('card-1', 5)).rejects.toThrow('read failed');
  });

  it('rejects when writing the next review schedule fails', async () => {
    const error = new Error('write failed');
    configureQueries(null, error);

    await expect(updateCardProgress('card-1', 5)).rejects.toThrow('write failed');
  });
});
