import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getProfile: vi.fn(), updateProfile: vi.fn() }));
vi.mock('../api/social', () => ({ getProfile: api.getProfile, updateProfile: api.updateProfile }));

import { resetRoleMemory, roleOfFlags, saveRole, storedRole, syncRole, useRole, useRoleUnasked } from './role';

beforeEach(() => {
  window.localStorage.clear();
  resetRoleMemory();
  api.getProfile.mockReset();
  api.updateProfile.mockReset().mockResolvedValue(undefined);
});

describe('the account’s role', () => {
  it('reads the profile’s flags: never asked, a student, a teacher', () => {
    expect(roleOfFlags(null)).toBeNull();
    expect(roleOfFlags({ guide: true })).toBeNull();
    expect(roleOfFlags({ role_asked: true })).toBe('student');
    expect(roleOfFlags({ role_asked: true, teacher: true })).toBe('teacher');
    // a stray flag without the answer is not an answer
    expect(roleOfFlags({ teacher: true })).toBeNull();
  });

  it('is asked only once the profile has answered and holds no role', () => {
    const { result } = renderHook(() => ({ role: useRole('u1'), unasked: useRoleUnasked('u1') }));
    // before the profile is read nobody is asked: «no role» may only mean «not read yet»
    expect(result.current).toEqual({ role: null, unasked: false });
    act(() => syncRole('u1', { guide: true }));
    expect(result.current).toEqual({ role: null, unasked: true });
  });

  it('the profile’s answer wins over what the device remembers; no answer there leaves the device’s', () => {
    window.localStorage.setItem('meldy:role:u1', 'student');
    const { result } = renderHook(() => ({ role: useRole('u1'), unasked: useRoleUnasked('u1') }));
    act(() => syncRole('u1', { role_asked: true, teacher: true }));
    expect(result.current).toEqual({ role: 'teacher', unasked: false });
    act(() => syncRole('u1', { guide: true })); // a profile that lost the write: the device still knows
    expect(result.current.role).toBe('teacher');
    expect(storedRole('u2')).toBeNull();
  });

  it('a choice is kept on the device at once and written into the profile beside its other flags', async () => {
    api.getProfile.mockResolvedValue({ id: 'u1', onboarding_status: { guide: true } });
    const { result } = renderHook(() => useRole('u1'));
    await act(() => saveRole('u1', 'teacher'));
    expect(result.current).toBe('teacher');
    expect(api.updateProfile).toHaveBeenCalledWith('u1', { onboarding_status: { guide: true, role_asked: true, teacher: true } });
    await act(() => saveRole('u1', 'student'));
    expect(result.current).toBe('student');
    expect(api.updateProfile).toHaveBeenLastCalledWith('u1', { onboarding_status: { guide: true, role_asked: true, teacher: false } });
  });

  it('a profile that cannot be written leaves the choice on the device', async () => {
    api.getProfile.mockRejectedValue(new Error('offline'));
    await saveRole('u1', 'teacher');
    expect(storedRole('u1')).toBe('teacher');
    expect(api.updateProfile).not.toHaveBeenCalled();
  });
});
