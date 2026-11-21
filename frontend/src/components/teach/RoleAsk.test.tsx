import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getProfile: vi.fn(), updateProfile: vi.fn() }));
vi.mock('../../api/social', () => ({ getProfile: api.getProfile, updateProfile: api.updateProfile }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));

import RoleAsk from './RoleAsk';
import { resetRoleMemory, storedRole, syncRole } from '../../lib/role';

let where = '';
function Where() {
  where = useLocation().pathname;
  return null;
}
const renderCard = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Where />
      <RoleAsk />
    </MemoryRouter>,
  );

beforeEach(() => {
  window.localStorage.clear();
  resetRoleMemory();
  api.getProfile.mockReset().mockResolvedValue({ id: 'user-1', onboarding_status: {} });
  api.updateProfile.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe('«Вы преподаёте?»', () => {
  it('waits for the profile, asks once, and «Да» opens the teacher’s first screen', async () => {
    renderCard();
    expect(screen.queryByRole('heading', { name: 'Вы преподаёте?' })).toBeNull();
    act(() => syncRole('user-1', {}));
    expect(screen.getByRole('heading', { name: 'Вы преподаёте?' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Да, преподаю' }));
    });
    expect(storedRole('user-1')).toBe('teacher');
    expect(where).toBe('/teach');
    expect(screen.queryByRole('heading', { name: 'Вы преподаёте?' })).toBeNull();
  });

  it('«Нет» takes the card away and leaves the student where they are', async () => {
    renderCard();
    act(() => syncRole('user-1', {}));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Нет, учусь' }));
    });
    expect(storedRole('user-1')).toBe('student');
    expect(where).toBe('/dashboard');
    expect(screen.queryByRole('heading', { name: 'Вы преподаёте?' })).toBeNull();
  });

  it('is not shown to an account that has answered', () => {
    renderCard();
    act(() => syncRole('user-1', { role_asked: true }));
    expect(screen.queryByRole('heading', { name: 'Вы преподаёте?' })).toBeNull();
  });
});
