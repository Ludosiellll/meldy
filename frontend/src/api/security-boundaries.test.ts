import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProfile } from './social';

const database = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), auth: { getUser: vi.fn() } }));

vi.mock('../lib/supabase', () => ({ supabase: database }));

function profileQuery(row: unknown) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    update: vi.fn(() => query),
    single: vi.fn(async () => ({ data: row, error: null })),
  };
  return query;
}

describe('database security boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    database.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('reads only the signed-in user’s own profile row and writes nothing while reading it', async () => {
    const row = { id: 'user-1', full_name: 'Алина', streak_days: 2, total_reviews: 5, total_materials: 1 };
    const query = profileQuery(row);
    database.from.mockReturnValue(query);

    await expect(getProfile('user-1')).resolves.toEqual(row);

    expect(database.from).toHaveBeenCalledTimes(1);
    expect(database.from).toHaveBeenCalledWith('profiles');
    expect(query.eq).toHaveBeenCalledWith('id', 'user-1');
    expect(query.update).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it('never asks for another user’s profile', async () => {
    await expect(getProfile('user-2')).resolves.toBeNull();

    expect(database.from).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
  });
});
