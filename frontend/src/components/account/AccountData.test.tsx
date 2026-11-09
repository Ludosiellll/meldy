import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* «Профиль» → «Аккаунт и данные»: the privacy page, the bot's support chat, and the request to delete the account. */

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn(),
  confirm: vi.fn(),
  toastOk: vi.fn(),
  toastBad: vi.fn(),
}));
vi.mock('../../api/account', () => ({
  deletionStatus: () => mocks.status(),
  requestDeletion: () => mocks.request(),
  cancelDeletion: () => mocks.cancel(),
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm }) }));
vi.mock('react-hot-toast', () => ({ default: { success: (text: string) => mocks.toastOk(text), error: (text: string) => mocks.toastBad(text) } }));

import AccountData, { ACCOUNT, DELETION_DAYS } from './AccountData';

const open = () =>
  render(
    <MemoryRouter>
      <AccountData />
    </MemoryRouter>,
  );

beforeEach(() => {
  mocks.status.mockReset().mockResolvedValue({ requestedAt: null });
  mocks.request.mockReset().mockResolvedValue({ requestedAt: '2026-11-09T10:00:00Z' });
  mocks.cancel.mockReset().mockResolvedValue({ requestedAt: null });
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.toastOk.mockReset();
  mocks.toastBad.mockReset();
});
afterEach(() => cleanup());

describe('«Аккаунт и данные»', () => {
  it('links the privacy page and the bot\'s support chat', async () => {
    open();
    expect(screen.getByRole('heading', { name: ACCOUNT.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `${ACCOUNT.open}: ${ACCOUNT.privacy}` })).toHaveAttribute('href', '/privacy');
    const support = screen.getByRole('link', { name: ACCOUNT.supportGo });
    expect(support).toHaveAttribute('href', 'https://t.me/Meldyteach_bot?start=support');
    expect(support).toHaveAttribute('target', '_blank');
    await screen.findByRole('button', { name: ACCOUNT.removeGo });
  });

  it('asks before the request, then says when it was made and offers to take it back', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT.removeGo }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: ACCOUNT.confirmTitle, message: ACCOUNT.confirmText, type: 'danger' }));
    expect(ACCOUNT.confirmText).toContain(`${DELETION_DAYS} дней`);
    expect(ACCOUNT.confirmText).toContain('пропадёт и у участников');
    expect(await screen.findByRole('status')).toHaveTextContent(/Запрос на удаление отправлен \d{1,2} ноября\. Аккаунт удалим в течение 7 дней\./);
    expect(mocks.toastOk).toHaveBeenCalledWith(ACCOUNT.requestedToast);
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT.takeBack }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: ACCOUNT.removeGo })).toBeInTheDocument();
    expect(mocks.toastOk).toHaveBeenCalledWith(ACCOUNT.takenBackToast);
  });

  it('«Отмена» in the question sends nothing', async () => {
    mocks.confirm.mockResolvedValue(false);
    open();
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT.removeGo }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('an open request is shown at once; a failure says so and changes nothing', async () => {
    mocks.status.mockResolvedValue({ requestedAt: '2026-11-08T09:00:00Z' });
    mocks.cancel.mockRejectedValue(new Error('down'));
    open();
    expect(await screen.findByRole('status')).toHaveTextContent('Запрос на удаление отправлен 8 ноября');
    fireEvent.click(screen.getByRole('button', { name: ACCOUNT.takeBack }));
    await waitFor(() => expect(mocks.toastBad).toHaveBeenCalledWith(ACCOUNT.failedToast));
    expect(screen.getByRole('button', { name: ACCOUNT.takeBack })).toBeInTheDocument();
  });

  it('the day\'s sixth request is refused in its own words (MA001)', async () => {
    mocks.request.mockRejectedValue({ code: 'MA001', message: 'too many deletion requests' });
    open();
    fireEvent.click(await screen.findByRole('button', { name: ACCOUNT.removeGo }));
    await waitFor(() => expect(mocks.toastBad).toHaveBeenCalledWith(ACCOUNT.tooManyToast));
    expect(screen.getByRole('button', { name: ACCOUNT.removeGo })).toBeInTheDocument();
  });

  it('a database without the request: the two links only', async () => {
    mocks.status.mockRejectedValue(new Error('no function'));
    open();
    await waitFor(() => expect(mocks.status).toHaveBeenCalled());
    expect(screen.queryByText(ACCOUNT.remove)).toBeNull();
    expect(screen.getByRole('link', { name: ACCOUNT.supportGo })).toBeInTheDocument();
  });
});
