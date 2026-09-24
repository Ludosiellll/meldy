import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getGroupMembers, getGroupWeeklyScores, joinGroup } from './groups';
import { getPublicProfiles, toggleLike } from './social';

const database = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: database }));

describe('database security boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('joins a class through the invite-code RPC instead of accepting a client-supplied user or group id', async () => {
    database.rpc.mockResolvedValue({ data: true, error: null });

    await expect(joinGroup(' abc-123 ', 'Denis')).resolves.toBe(true);

    expect(database.rpc).toHaveBeenCalledWith('join_group_by_invite_code', {
      p_invite_code: 'ABC-123',
      p_class_nickname: 'Denis',
    });
    expect(database.from).not.toHaveBeenCalled();
  });

  it('loads a class roster only through the membership-checked RPC', async () => {
    const roster = [{
      id: 'member-1',
      group_id: 'group-1',
      student_id: 'user-2',
      joined_at: '2026-09-24T00:00:00Z',
      class_nickname: 'Саша',
      full_name: 'Александр',
      avatar_url: null,
      total_reviews: 8,
      total_xp: 120,
    }];
    database.rpc.mockResolvedValue({ data: roster, error: null });

    await expect(getGroupMembers('group-1')).resolves.toEqual([{
      ...roster[0],
      student_name: 'Саша',
      student_avatar: undefined,
    }]);

    expect(database.rpc).toHaveBeenCalledWith('get_group_members', { p_group_id: 'group-1' });
    expect(database.from).not.toHaveBeenCalled();
  });

  it('loads weekly class scores through the membership-checked RPC', async () => {
    const scores = [{ student_id: 'user-2', weekly_xp: 150 }];
    database.rpc.mockResolvedValue({ data: scores, error: null });

    await expect(getGroupWeeklyScores('group-1')).resolves.toEqual(scores);

    expect(database.rpc).toHaveBeenCalledWith('get_group_weekly_scores', { p_group_id: 'group-1' });
    expect(database.from).not.toHaveBeenCalled();
  });

  it('loads only the safe public profile projection through a server-side function', async () => {
    const profiles = [{ id: 'user-2', full_name: 'Student', avatar_url: null }];
    database.rpc.mockResolvedValue({ data: profiles, error: null });

    await expect(getPublicProfiles(['user-2'])).resolves.toEqual(profiles);

    expect(database.rpc).toHaveBeenCalledWith('get_public_profiles', {
      p_user_ids: ['user-2'],
      p_query: null,
      p_exclude_user_id: null,
      p_limit: 50,
    });
    expect(database.from).not.toHaveBeenCalled();
  });

  it('changes a material like through one atomic database operation', async () => {
    database.rpc.mockResolvedValue({ data: true, error: null });

    await expect(toggleLike('material-1', false)).resolves.toBe(true);

    expect(database.rpc).toHaveBeenCalledWith('toggle_material_like', {
      p_material_id: 'material-1',
      p_like: true,
    });
    expect(database.from).not.toHaveBeenCalled();
  });
});
