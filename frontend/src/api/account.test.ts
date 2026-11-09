import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (name: string) => rpc(name) } }));

import { cancelDeletion, deletionStatus, requestDeletion } from './account';

beforeEach(() => rpc.mockReset());

describe('the account deletion request', () => {
  it('calls its three functions and reads requested_at', async () => {
    rpc.mockResolvedValue({ data: { requested_at: '2026-11-09T10:00:00+00:00' }, error: null });
    expect(await requestDeletion()).toEqual({ requestedAt: '2026-11-09T10:00:00+00:00' });
    expect(rpc).toHaveBeenLastCalledWith('account_deletion_request');
    rpc.mockResolvedValue({ data: { requested_at: null }, error: null });
    expect(await cancelDeletion()).toEqual({ requestedAt: null });
    expect(rpc).toHaveBeenLastCalledWith('account_deletion_cancel');
    expect(await deletionStatus()).toEqual({ requestedAt: null });
    expect(rpc).toHaveBeenLastCalledWith('account_deletion_status');
  });

  it('an answer of another shape is no request; an error is thrown', async () => {
    rpc.mockResolvedValue({ data: { requested_at: 'soon' }, error: null });
    expect(await deletionStatus()).toEqual({ requestedAt: null });
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await deletionStatus()).toEqual({ requestedAt: null });
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'no function' } });
    await expect(deletionStatus()).rejects.toMatchObject({ code: 'PGRST202' });
  });
});
