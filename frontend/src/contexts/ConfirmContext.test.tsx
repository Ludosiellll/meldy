import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfirmProvider, useConfirm } from './ConfirmContext';

type Api = ReturnType<typeof useConfirm>;

function renderHost() {
  const holder: { api?: Api } = {};
  function Host() {
    holder.api = useConfirm();
    return <button type="button">Лист экзамена</button>;
  }
  render(
    <ConfirmProvider>
      <Host />
    </ConfirmProvider>,
  );
  return holder as { api: Api };
}

afterEach(() => cleanup());

describe('confirm dialog semantics', () => {
  it('is a labelled modal dialog that takes focus and gives it back on close', async () => {
    const host = renderHost();
    const opener = screen.getByRole('button', { name: 'Лист экзамена' });
    opener.focus();
    let answer: boolean | undefined;
    act(() => {
      void host.api
        .confirm({ title: 'Выйти из билета?', message: 'Ответ ещё не сохранён.', confirmText: 'Выйти', cancelText: 'Остаться' })
        .then((value) => {
          answer = value;
        });
    });

    const dialog = await screen.findByRole('dialog', { name: 'Выйти из билета?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Ответ ещё не сохранён.');
    // The safe answer is focused first: Enter does not leave the ticket by accident.
    expect(screen.getByRole('button', { name: 'Остаться' })).toHaveFocus();
    // No warning triangle, icon tile or blur.
    expect(dialog.querySelector('svg')).toBeNull();
    expect(document.querySelector('[class*="backdrop-blur"]')).toBeNull();

    await act(async () => {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    });
    expect(answer).toBe(false);
    expect(opener).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps Tab inside the dialog', async () => {
    const host = renderHost();
    act(() => {
      void host.api.confirm({ title: 'Удалить материал?', message: 'Это нельзя отменить.', confirmText: 'Удалить' });
    });
    const dialog = await screen.findByRole('dialog', { name: 'Удалить материал?' });
    const cancel = screen.getByRole('button', { name: 'Отмена' });
    const remove = screen.getByRole('button', { name: 'Удалить' });
    expect(cancel).toHaveFocus();
    remove.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(remove).toHaveFocus();
  });

  it('a notice («Дневной лимит исчерпан») is a dialog with its one button focused', async () => {
    const host = renderHost();
    let closed = false;
    act(() => {
      void host.api
        .alert({ title: 'Дневной лимит исчерпан', message: 'Лимит обновится в 03:00.', confirmText: 'Понятно' })
        .then(() => {
          closed = true;
        });
    });
    const dialog = await screen.findByRole('dialog', { name: 'Дневной лимит исчерпан' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const ok = screen.getByRole('button', { name: 'Понятно' });
    expect(ok).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Отмена' })).toBeNull();
    await act(async () => {
      fireEvent.click(ok);
    });
    expect(closed).toBe(true);
  });
});
