import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MemberRow } from '../../../types/container';

const api = vi.hoisted(() => ({ fetchMembers: vi.fn(), removeMember: vi.fn() }));
vi.mock('../../../api/containers', () => ({ fetchMembers: api.fetchMembers, removeMember: api.removeMember }));

import MembersList from './MembersList';
import { MEMBERS } from '../copyImport';

const EXAM = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';
const ANYA: MemberRow = { user_id: 'u-1', name: 'Аня Ковалёва', joined_at: '2026-10-08T12:00:00Z', left_at: null, removed_at: null };
const DENIS: MemberRow = { user_id: 'u-2', name: 'Денис', joined_at: '2026-10-09T08:00:00Z', left_at: null, removed_at: null };
const VIKA: MemberRow = { user_id: 'u-3', name: 'Вика', joined_at: '2026-10-08T15:00:00Z', left_at: null, removed_at: '2026-10-09T09:00:00Z' };
const removed = (row: MemberRow): MemberRow => ({ ...row, removed_at: '2026-10-10T09:00:00Z' });
const row = (name: string) => screen.getByText(name).closest('li')!;

beforeEach(() => {
  api.fetchMembers.mockReset().mockResolvedValue([ANYA, DENIS, VIKA]);
  api.removeMember.mockReset().mockResolvedValue(1);
});
afterEach(() => cleanup());

describe('MembersList: «Кто вошёл» (spec decision 52; usability checks M1, m3, m9)', () => {
  it('the members with the day they came in, the removed under «Убраны» with «Вернуть»', async () => {
    render(<MembersList containerId={EXAM} />);
    expect(await screen.findByText('Аня Ковалёва')).toBeInTheDocument();
    expect(within(row('Аня Ковалёва')).getByText(/^с 8\sоктября$/)).toBeInTheDocument();
    expect(screen.getByText('Убраны')).toBeInTheDocument();
    expect(within(row('Вика')).getByRole('button', { name: 'Вернуть' })).toBeInTheDocument();
    expect(screen.queryByText(MEMBERS.empty)).not.toBeInTheDocument();
  });

  it('nobody in but someone removed: «Вернуть» is there, and no «Пока никто не вошёл» (M1, m3)', async () => {
    api.fetchMembers.mockResolvedValue([removed(ANYA)]);
    const onChanged = vi.fn();
    render(<MembersList containerId={EXAM} onChanged={onChanged} />);
    fireEvent.click(within((await screen.findByText('Аня Ковалёва')).closest('li')!).getByRole('button', { name: 'Вернуть' }));
    await waitFor(() => expect(api.removeMember).toHaveBeenCalledWith(EXAM, 'u-1', true));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Пока никто не вошёл/)).not.toBeInTheDocument();
  });

  it('says why the list is empty: nobody ever came in, or everyone left on their own', async () => {
    api.fetchMembers.mockResolvedValue([]);
    render(<MembersList containerId={EXAM} />);
    expect(await screen.findByText(MEMBERS.empty)).toBeInTheDocument();
    cleanup();
    api.fetchMembers.mockResolvedValue([{ ...ANYA, left_at: '2026-10-09T10:00:00Z' }]);
    render(<MembersList containerId={EXAM} />);
    expect(await screen.findByText(MEMBERS.allLeft)).toBeInTheDocument();
    expect(screen.queryByText(MEMBERS.empty)).not.toBeInTheDocument();
  });

  it('a confirm takes the focus on «Отмена» and gives it back to «Убрать»; the question names the group (m9)', async () => {
    render(<MembersList containerId={EXAM} />);
    await screen.findByText('Аня Ковалёва');
    fireEvent.click(within(row('Аня Ковалёва')).getByRole('button', { name: 'Убрать' }));
    expect(screen.getByRole('group', { name: MEMBERS.removeAsk('Аня Ковалёва') })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(within(row('Аня Ковалёва')).getByRole('button', { name: 'Отмена' })));
    fireEvent.click(within(row('Аня Ковалёва')).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(document.activeElement).toBe(within(row('Аня Ковалёва')).getByRole('button', { name: 'Убрать' })));
    expect(api.removeMember).not.toHaveBeenCalled();
  });

  it('after «Убрать» the focus follows the member to «Вернуть», and back to «Убрать» after «Вернуть»', async () => {
    const onChanged = vi.fn();
    render(<MembersList containerId={EXAM} onChanged={onChanged} />);
    await screen.findByText('Аня Ковалёва');
    fireEvent.click(within(row('Аня Ковалёва')).getByRole('button', { name: 'Убрать' }));
    api.fetchMembers.mockResolvedValue([removed(ANYA), DENIS, VIKA]);
    fireEvent.click(within(row('Аня Ковалёва')).getByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(api.removeMember).toHaveBeenCalledWith(EXAM, 'u-1', false));
    await waitFor(() => expect(document.activeElement).toBe(within(row('Аня Ковалёва')).getByRole('button', { name: 'Вернуть' })));
    expect(onChanged).toHaveBeenCalledTimes(1);

    api.fetchMembers.mockResolvedValue([ANYA, DENIS, VIKA]);
    fireEvent.click(within(row('Аня Ковалёва')).getByRole('button', { name: 'Вернуть' }));
    await waitFor(() => expect(api.removeMember).toHaveBeenCalledWith(EXAM, 'u-1', true));
    await waitFor(() => expect(document.activeElement).toBe(within(row('Аня Ковалёва')).getByRole('button', { name: 'Убрать' })));
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('a refused «Убрать» says why in an alert and keeps the confirm, with the focus on its «Убрать»', async () => {
    api.removeMember.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { code: 'network' }));
    const onChanged = vi.fn();
    render(<MembersList containerId={EXAM} onChanged={onChanged} />);
    await screen.findByText('Аня Ковалёва');
    fireEvent.click(within(row('Аня Ковалёва')).getByRole('button', { name: 'Убрать' }));
    fireEvent.click(within(row('Аня Ковалёва')).getByRole('button', { name: 'Убрать' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
    const yes = within(row('Аня Ковалёва')).getAllByRole('button', { name: 'Убрать' })[0];
    expect(within(row('Аня Ковалёва')).getByRole('button', { name: 'Отмена' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(yes));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('«Убрать всех»: its own confirm, everyone moves under «Убраны»', async () => {
    render(<MembersList containerId={EXAM} />);
    await screen.findByText('Аня Ковалёва');
    fireEvent.click(screen.getByRole('button', { name: MEMBERS.removeAll }));
    expect(screen.getByRole('group', { name: MEMBERS.removeAllAsk(2) })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(within(screen.getByRole('group', { name: MEMBERS.removeAllAsk(2) })).getByRole('button', { name: 'Отмена' })));
    api.fetchMembers.mockResolvedValue([removed(ANYA), removed(DENIS), VIKA]);
    fireEvent.click(within(screen.getByRole('group', { name: MEMBERS.removeAllAsk(2) })).getByRole('button', { name: 'Убрать' }));
    await waitFor(() => expect(api.removeMember).toHaveBeenCalledWith(EXAM, null, false));
    await waitFor(() => expect(document.activeElement).toBe(within(row('Аня Ковалёва')).getByRole('button', { name: 'Вернуть' })));
    expect(screen.queryByRole('button', { name: MEMBERS.removeAll })).not.toBeInTheDocument();
  });

  it('done, but the list could not be read again: says so with «Повторить», not the old list', async () => {
    render(<MembersList containerId={EXAM} />);
    await screen.findByText('Аня Ковалёва');
    fireEvent.click(within(row('Аня Ковалёва')).getByRole('button', { name: 'Убрать' }));
    api.fetchMembers.mockRejectedValueOnce(new Error('Failed to fetch'));
    fireEvent.click(within(row('Аня Ковалёва')).getByRole('button', { name: 'Убрать' }));
    expect((await screen.findByRole('alert')).textContent).toContain(MEMBERS.loadFailed);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: MEMBERS.retry })));
    fireEvent.click(screen.getByRole('button', { name: MEMBERS.retry }));
    expect(await screen.findByText('Аня Ковалёва')).toBeInTheDocument();
  });
});
