import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Review from './Review';

const api = vi.hoisted(() => ({
  getDueCards: vi.fn(),
  updateCardProgress: vi.fn(),
  updateQuestProgress: vi.fn(),
  recordStudyActivity: vi.fn(),
  playFlipSound: vi.fn(),
  playSuccessSound: vi.fn(),
}));

vi.mock('../api/flashcards', () => ({
  getDueCards: api.getDueCards,
  updateCardProgress: api.updateCardProgress,
}));

vi.mock('../api/quests', () => ({
  updateQuestProgress: api.updateQuestProgress,
  recordStudyActivity: api.recordStudyActivity,
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../hooks/useSound', () => ({
  useSound: () => ({
    playFlipSound: api.playFlipSound,
    playSuccessSound: api.playSuccessSound,
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function revealAndChooseKnownCard() {
  const user = userEvent.setup();
  render(<MemoryRouter><Review /></MemoryRouter>);
  await user.click(await screen.findByRole('button', { name: 'Показать ответ' }));
  await user.click(screen.getByRole('button', { name: 'Знаю' }));
  return user;
}

describe('Review answer persistence', () => {
  beforeEach(() => {
    api.getDueCards.mockResolvedValue([{
      id: 'card-1',
      question: 'Что такое интервальное повторение?',
      answer: 'Повторение с увеличивающимися интервалами.',
    }]);
    api.updateCardProgress.mockResolvedValue(undefined);
    api.updateQuestProgress.mockResolvedValue(undefined);
    api.recordStudyActivity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('does not complete the session before the answer is saved', async () => {
    const save = deferred<void>();
    api.updateCardProgress.mockReturnValue(save.promise);

    await revealAndChooseKnownCard();

    expect(api.updateCardProgress).toHaveBeenCalledWith('card-1', 5);
    expect(screen.getByRole('button', { name: 'Знаю' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Сессия завершена' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Сохраняем ответ…');

    save.resolve();
    expect(await screen.findByRole('heading', { name: 'Сессия завершена' })).toBeInTheDocument();
  });

  it('keeps the current card available and reports a failed save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.updateCardProgress.mockRejectedValue(new Error('offline'));

    await revealAndChooseKnownCard();

    expect(await screen.findByRole('alert')).toHaveTextContent('Ответ не сохранён');
    expect(screen.getByText('Что такое интервальное повторение?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Знаю' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Сессия завершена' })).not.toBeInTheDocument();
    expect(api.updateQuestProgress).not.toHaveBeenCalled();
    expect(api.recordStudyActivity).not.toHaveBeenCalled();
  });

  it('does not show the empty state when loading the queue fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.getDueCards.mockRejectedValue(new Error('offline'));

    render(<MemoryRouter><Review /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить карточки');
    expect(screen.queryByText('На сегодня всё')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить загрузку' })).toBeInTheDocument();
  });
});
