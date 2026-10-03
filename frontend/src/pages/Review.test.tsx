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

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('../hooks/useSound', () => ({
  useSound: () => ({
    playFlipSound: api.playFlipSound,
    playSuccessSound: api.playSuccessSound,
  }),
}));

const MATERIAL_ID = '11111111-2222-4333-8444-555555555555';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderReview(url = '/review') {
  return render(<MemoryRouter initialEntries={[url]}><Review /></MemoryRouter>);
}

async function revealAndChoose(user: ReturnType<typeof userEvent.setup>, answer: 'Знаю' | 'С трудом' | 'Не помню' = 'Знаю') {
  await user.click(await screen.findByRole('button', { name: 'Показать ответ' }));
  await user.click(screen.getByRole('button', { name: answer }));
}

async function revealAndChooseKnownCard() {
  const user = userEvent.setup();
  renderReview();
  await revealAndChoose(user);
  return user;
}

const oneCard = [{
  id: 'card-1',
  question: 'Что такое интервальное повторение?',
  answer: 'Повторение с увеличивающимися интервалами.',
}];

describe('Review answer persistence', () => {
  beforeEach(() => {
    api.getDueCards.mockResolvedValue(oneCard);
    api.updateCardProgress.mockResolvedValue({ card_id: 'card-1', duplicate: false });
    api.updateQuestProgress.mockResolvedValue(undefined);
    api.recordStudyActivity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('does not complete the session before the answer is saved', async () => {
    const save = deferred<unknown>();
    api.updateCardProgress.mockReturnValue(save.promise);

    await revealAndChooseKnownCard();

    expect(api.updateCardProgress).toHaveBeenCalledWith('card-1', 5, expect.objectContaining({ clientEventId: expect.any(String) }));
    expect(screen.getByRole('button', { name: 'Знаю' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Сессия завершена' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Сохраняем ответ…');

    save.resolve({ card_id: 'card-1', duplicate: false });
    expect(await screen.findByRole('heading', { name: 'Сессия завершена' })).toBeInTheDocument();
    expect(screen.getByText('Вспомнили 1 из 1.')).toBeInTheDocument();
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

    renderReview();

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить карточки');
    expect(screen.queryByText('На сегодня всё')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить загрузку' })).toBeInTheDocument();
  });

  it('sends one review per answer, each with its own event id and the same session', async () => {
    api.getDueCards.mockResolvedValue([
      { id: 'card-1', question: 'Первый вопрос', answer: 'Первый ответ' },
      { id: 'card-2', question: 'Второй вопрос', answer: 'Второй ответ' },
    ]);
    const user = userEvent.setup();
    renderReview();

    await revealAndChoose(user, 'Знаю');
    await screen.findByText('Второй вопрос');
    await revealAndChoose(user, 'Не помню');
    await screen.findByRole('heading', { name: 'Сессия завершена' });

    expect(api.updateCardProgress).toHaveBeenCalledTimes(2);
    const [first, second] = api.updateCardProgress.mock.calls;
    expect(first.slice(0, 2)).toEqual(['card-1', 5]);
    expect(second.slice(0, 2)).toEqual(['card-2', 1]);
    expect(first[2].clientEventId).toBeTruthy();
    expect(second[2].clientEventId).toBeTruthy();
    expect(first[2].clientEventId).not.toBe(second[2].clientEventId);
    expect(first[2].sessionId).toBeTruthy();
    expect(second[2].sessionId).toBe(first[2].sessionId);
    expect(screen.getByText('Вспомнили 1 из 2.')).toBeInTheDocument();
  });

  it('retries a failed save with the same event id', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.updateCardProgress
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ card_id: 'card-1', duplicate: true });
    const user = userEvent.setup();
    renderReview();

    await revealAndChoose(user, 'Знаю');
    expect(await screen.findByRole('alert')).toHaveTextContent('Ответ не сохранён');
    await user.click(screen.getByRole('button', { name: 'Знаю' }));
    await screen.findByRole('heading', { name: 'Сессия завершена' });

    expect(api.updateCardProgress).toHaveBeenCalledTimes(2);
    const [failed, retried] = api.updateCardProgress.mock.calls;
    expect(retried[2].clientEventId).toBe(failed[2].clientEventId);
    expect(api.recordStudyActivity).toHaveBeenCalledTimes(1);
  });

  it('shows the done screen only after the last activity write is stored', async () => {
    const activity = deferred<void>();
    api.recordStudyActivity.mockReturnValue(activity.promise);

    await revealAndChooseKnownCard();

    expect(await screen.findByRole('status')).toHaveTextContent('Сохраняем ответ…');
    expect(api.recordStudyActivity).toHaveBeenCalledWith('user-1', 1, 0);
    expect(screen.queryByRole('heading', { name: 'Сессия завершена' })).not.toBeInTheDocument();

    activity.resolve();
    expect(await screen.findByRole('heading', { name: 'Сессия завершена' })).toBeInTheDocument();
  });

  it('labels a card made from an examiner follow-up question', async () => {
    api.getDueCards.mockResolvedValue([
      { id: 'card-f', origin: 'oral_followup', question: 'А что будет при росте ставки?', answer: 'Кредиты дорожают.' },
      { id: 'card-1', origin: 'analysis', question: 'Обычный вопрос', answer: 'Ответ' },
    ]);
    renderReview();

    expect(await screen.findByText('Вопрос экзаменатора')).toBeInTheDocument();
    expect(screen.getByText('А что будет при росте ставки?')).toBeInTheDocument();
  });

  it('offers the exams sheet from the review header', async () => {
    renderReview();
    await screen.findByRole('button', { name: 'Показать ответ' });
    expect(screen.getByRole('link', { name: 'Экзамены' })).toHaveAttribute('href', '/exams');
  });
});

describe('Review of one material', () => {
  beforeEach(() => {
    api.recordStudyActivity.mockResolvedValue(undefined);
    api.updateCardProgress.mockResolvedValue({ card_id: 'card-1', duplicate: false });
  });

  afterEach(cleanup);

  it('loads only the cards of the material from ?material', async () => {
    api.getDueCards.mockResolvedValue(oneCard);
    renderReview(`/review?material=${MATERIAL_ID}`);

    await screen.findByRole('button', { name: 'Показать ответ' });
    expect(api.getDueCards).toHaveBeenCalledWith('user-1', { materialId: MATERIAL_ID });
  });

  it('has its own empty state', async () => {
    api.getDueCards.mockResolvedValue([]);
    renderReview(`/review?material=${MATERIAL_ID}`);

    expect(await screen.findByRole('heading', { name: 'Карточек этого материала к повторению сейчас нет' })).toBeInTheDocument();
    expect(screen.queryByText('На сегодня всё')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Все карточки к повторению' })).toBeInTheDocument();
  });

  it('does not query with a material id that is not a uuid', async () => {
    renderReview('/review?material=abc');

    expect(await screen.findByRole('heading', { name: 'Карточек этого материала к повторению сейчас нет' })).toBeInTheDocument();
    expect(api.getDueCards).not.toHaveBeenCalled();
  });
});
