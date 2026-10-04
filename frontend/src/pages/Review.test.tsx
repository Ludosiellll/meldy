import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Review, { openMistakesLine } from './Review';
import { supabase } from '../lib/supabase';

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
// The page has no sounds any more (redesign spec 5.13); the hook is not called.

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

async function revealAndChoose(user: ReturnType<typeof userEvent.setup>, answer: 'Помню' | 'С трудом' | 'Не помню' = 'Помню') {
  await user.click(await screen.findByRole('button', { name: 'Перевернуть' }));
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

  it('gives the session page one level-1 heading for screen readers', async () => {
    renderReview();
    expect(await screen.findByRole('heading', { level: 1, name: 'Повторение' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('does not complete the session before the answer is saved', async () => {
    const save = deferred<unknown>();
    api.updateCardProgress.mockReturnValue(save.promise);

    await revealAndChooseKnownCard();

    expect(api.updateCardProgress).toHaveBeenCalledWith('card-1', 5, expect.objectContaining({ clientEventId: expect.any(String) }));
    expect(screen.getByRole('button', { name: 'Помню' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: /^Повторили/ })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Сохраняем ответ…');

    save.resolve({ card_id: 'card-1', duplicate: false });
    expect(await screen.findByRole('heading', { name: 'Повторили 1 карточку' })).toBeInTheDocument();
    expect(screen.getByText('Помню — 1, с трудом — 0, не помню — 0.')).toBeInTheDocument();
  });

  it('keeps the current card available and reports a failed save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.updateCardProgress.mockRejectedValue(new Error('offline'));

    await revealAndChooseKnownCard();

    expect(await screen.findByRole('alert')).toHaveTextContent('Ответ не сохранён');
    expect(screen.getByText('Что такое интервальное повторение?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Помню' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: /^Повторили/ })).not.toBeInTheDocument();
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

    await revealAndChoose(user, 'Помню');
    await screen.findByRole('button', { name: 'Перевернуть' });
    expect(screen.getByText('Второй вопрос')).toBeInTheDocument();
    await revealAndChoose(user, 'Не помню');
    await screen.findByRole('heading', { name: 'Повторили 2 карточки' });

    expect(api.updateCardProgress).toHaveBeenCalledTimes(2);
    const [first, second] = api.updateCardProgress.mock.calls;
    expect(first.slice(0, 2)).toEqual(['card-1', 5]);
    expect(second.slice(0, 2)).toEqual(['card-2', 1]);
    expect(first[2].clientEventId).toBeTruthy();
    expect(second[2].clientEventId).toBeTruthy();
    expect(first[2].clientEventId).not.toBe(second[2].clientEventId);
    expect(first[2].sessionId).toBeTruthy();
    expect(second[2].sessionId).toBe(first[2].sessionId);
    expect(screen.getByText('Помню — 1, с трудом — 0, не помню — 1.')).toBeInTheDocument();
  });

  it('retries a failed save with the same event id', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.updateCardProgress
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ card_id: 'card-1', duplicate: true });
    const user = userEvent.setup();
    renderReview();

    await revealAndChoose(user, 'Помню');
    expect(await screen.findByRole('alert')).toHaveTextContent('Ответ не сохранён');
    await user.click(screen.getByRole('button', { name: 'Помню' }));
    await screen.findByRole('heading', { name: 'Повторили 1 карточку' });

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
    expect(screen.queryByRole('heading', { name: /^Повторили/ })).not.toBeInTheDocument();

    activity.resolve();
    expect(await screen.findByRole('heading', { name: 'Повторили 1 карточку' })).toBeInTheDocument();
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

  it('ends early with «Закончить» and offers the exam sheet', async () => {
    api.getDueCards.mockResolvedValue([
      { id: 'card-1', question: 'Первый вопрос', answer: 'Первый ответ' },
      { id: 'card-2', question: 'Второй вопрос', answer: 'Второй ответ' },
    ]);
    const user = userEvent.setup();
    renderReview();
    await revealAndChoose(user, 'С трудом');
    await screen.findByRole('button', { name: 'Перевернуть' });
    await user.click(screen.getByRole('button', { name: 'Закончить' }));
    expect(await screen.findByRole('heading', { name: 'Повторили 1 карточку' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Лист экзамена' })).toHaveAttribute('href', '/exams');
    // The second card is still due: the queue can go on.
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeInTheDocument();
  });
});

describe('Review on paper (redesign spec 5.13, QA round 1)', () => {
  beforeEach(() => {
    api.getDueCards.mockResolvedValue(oneCard);
    api.recordStudyActivity.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('grades in three plain words: no traffic-light tints, no cyan buttons, no spinner, no sounds', async () => {
    api.updateCardProgress.mockResolvedValue({ card_id: 'card-1', interval_days: 1, duplicate: false });
    const user = userEvent.setup();
    const { container } = renderReview();
    await user.click(await screen.findByRole('button', { name: 'Перевернуть' }));
    for (const word of ['Не помню', 'С трудом', 'Помню']) expect(screen.getByRole('button', { name: word })).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/bg-(rose|amber|emerald|cyan)-|animate-spin|uppercase/);
    await user.click(screen.getByRole('button', { name: 'Не помню' }));
    expect(await screen.findByText('Не помню — вернётся завтра.')).toBeInTheDocument();
    expect(api.playFlipSound).not.toHaveBeenCalled();
    expect(api.playSuccessSound).not.toHaveBeenCalled();
  });

  it('writes «завтра» in pencil only when the card is due tomorrow, and types any other interval', async () => {
    api.updateCardProgress.mockResolvedValueOnce({ card_id: 'card-1', interval_days: 1, duplicate: false });
    const user = userEvent.setup();
    const { container, unmount } = renderReview();
    await revealAndChoose(user, 'Не помню');
    await screen.findByText('Не помню — вернётся завтра.');
    expect(container.querySelector('svg.sf-hand')).not.toBeNull();
    unmount();

    api.updateCardProgress.mockResolvedValueOnce({ card_id: 'card-1', interval_days: 9, duplicate: false });
    const second = renderReview();
    await revealAndChoose(user, 'Помню');
    await screen.findByText('Помню — вернётся через 9 дней.');
    expect(second.container.querySelector('svg.sf-hand')).toBeNull();
    expect(screen.getByText('через 9 дней')).toBeInTheDocument();
  });

  it('turns the card with Space and grades with 1, 2 and 3', async () => {
    api.updateCardProgress.mockResolvedValue({ card_id: 'card-1', interval_days: 6, duplicate: false });
    const user = userEvent.setup();
    renderReview();
    await screen.findByRole('button', { name: 'Перевернуть' });
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard(' ');
    expect(await screen.findByRole('button', { name: 'Помню' })).toBeInTheDocument();
    await user.keyboard('3');
    expect(api.updateCardProgress).toHaveBeenCalledWith('card-1', 5, expect.objectContaining({ clientEventId: expect.any(String) }));
    expect(await screen.findByText('Помню — вернётся через 6 дней.')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Повторили 1 карточку' })).toBeInTheDocument();
  });

  it('says how many cards come back tomorrow on the done screen', async () => {
    api.getDueCards.mockResolvedValue([
      { id: 'card-1', question: 'Первый вопрос', answer: 'Первый ответ' },
      { id: 'card-2', question: 'Второй вопрос', answer: 'Второй ответ' },
    ]);
    api.updateCardProgress
      .mockResolvedValueOnce({ card_id: 'card-1', interval_days: 1, duplicate: false })
      .mockResolvedValueOnce({ card_id: 'card-2', interval_days: 6, duplicate: false });
    const user = userEvent.setup();
    renderReview();
    await revealAndChoose(user, 'Не помню');
    await screen.findByRole('button', { name: 'Перевернуть' });
    await revealAndChoose(user, 'Помню');
    expect(await screen.findByRole('heading', { name: 'Повторили 2 карточки' })).toBeInTheDocument();
    expect(screen.getByText('Помню — 1, с трудом — 0, не помню — 1. Завтра вернётся 1.')).toBeInTheDocument();
  });

  it('lays the answered cards out by the day they come back, as the server set it', async () => {
    api.getDueCards.mockResolvedValue([
      { id: 'card-1', question: 'Первый вопрос', answer: 'Первый ответ' },
      { id: 'card-2', question: 'Второй **вопрос**', answer: 'Второй ответ' },
      { id: 'card-3', question: 'Третий вопрос', answer: 'Третий ответ' },
    ]);
    api.updateCardProgress
      .mockResolvedValueOnce({ card_id: 'card-1', interval_days: 6, duplicate: false })
      .mockResolvedValueOnce({ card_id: 'card-2', interval_days: 1, duplicate: false })
      .mockResolvedValueOnce({ card_id: 'card-3', duplicate: false });
    const user = userEvent.setup();
    renderReview();
    await revealAndChoose(user, 'Помню');
    await screen.findByRole('button', { name: 'Перевернуть' });
    await revealAndChoose(user, 'Не помню');
    await screen.findByRole('button', { name: 'Перевернуть' });
    await revealAndChoose(user, 'С трудом');
    await screen.findByRole('heading', { name: 'Повторили 3 карточки' });

    const days = screen.getByRole('region', { name: 'Когда вернутся' });
    const columns = within(days).getAllByRole('listitem').filter((item) => item.classList.contains('rv-day'));
    // Nearest day first; a card without a server interval is not placed on any day.
    expect(columns.map((column) => column.querySelector('.rv-day-h')?.textContent)).toEqual(['1Завтра: 1 карточка', '1Через 6 дней: 1 карточка']);
    expect(within(columns[0]).getByText('Второй вопрос')).toBeInTheDocument();
    expect(within(columns[1]).getByText('Первый вопрос')).toBeInTheDocument();
    expect(within(days).queryByText('Третий вопрос')).toBeNull();
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

    await screen.findByRole('button', { name: 'Перевернуть' });
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

/** A Supabase query that resolves to `result`, recording its calls. */
function query(result: unknown, calls: Array<[string, unknown[]]> = []) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in']) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('the mistakes diary in «Повторение»', () => {
  const diaryCalls: Array<[string, unknown[]]> = [];
  let openCount: { count: number | null; error: unknown } = { count: 5, error: null };

  beforeEach(() => {
    diaryCalls.length = 0;
    openCount = { count: 5, error: null };
    api.getDueCards.mockResolvedValue([]);
    vi.mocked(supabase.from).mockImplementation(((table: string) =>
      table === 'mistake_diary' ? query(openCount, diaryCalls) : query({ data: [], error: null })) as unknown as typeof supabase.from);
  });

  afterEach(cleanup);

  it('is one card under «На сегодня всё», with the open mistakes counted by a HEAD request', async () => {
    renderReview();
    expect(await screen.findByRole('heading', { name: 'На сегодня всё' })).toBeInTheDocument();
    const diary = screen.getByRole('region', { name: 'Дневник ошибок' });
    expect(await within(diary).findByText('5 открытых ошибок.')).toBeInTheDocument();
    expect(within(diary).getByRole('link', { name: 'Открыть дневник ошибок' })).toHaveAttribute('href', '/mistakes');
    expect(diaryCalls).toEqual([
      ['select', ['id', { count: 'exact', head: true }]],
      ['eq', ['user_id', 'user-1']],
      ['eq', ['is_resolved', false]],
    ]);
    // The section's word for lectures.
    expect(screen.getByRole('link', { name: 'Лекции' })).toHaveAttribute('href', '/library');
    expect(screen.queryByText('Библиотека')).not.toBeInTheDocument();
  });

  it('stays under the card during a session', async () => {
    api.getDueCards.mockResolvedValue(oneCard);
    renderReview();
    const flip = await screen.findByRole('button', { name: 'Перевернуть' });
    const diary = screen.getByRole('region', { name: 'Дневник ошибок' });
    expect(flip.compareDocumentPosition(diary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await within(diary).findByText('5 открытых ошибок.')).toBeInTheDocument();
  });

  it('says there are none, or shows no number when it cannot be counted', async () => {
    openCount = { count: 0, error: null };
    renderReview();
    expect(await screen.findByText('Открытых ошибок нет.')).toBeInTheDocument();
    cleanup();

    openCount = { count: null, error: { message: 'offline' } };
    renderReview();
    const diary = await screen.findByRole('region', { name: 'Дневник ошибок' });
    await act(async () => undefined);
    expect(within(diary).queryByText(/открыт/i, { selector: 'b' })).toBeNull();
    expect(diary.textContent).not.toMatch(/\d/);
    expect(within(diary).getByRole('link', { name: 'Открыть дневник ошибок' })).toBeInTheDocument();
  });

  it('words the number of open mistakes', () => {
    expect(openMistakesLine(1)).toBe('1 открытая ошибка.');
    expect(openMistakesLine(3)).toBe('3 открытые ошибки.');
    expect(openMistakesLine(5)).toBe('5 открытых ошибок.');
    expect(openMistakesLine(21)).toBe('21 открытая ошибка.');
    expect(openMistakesLine(0)).toBe('Открытых ошибок нет.');
    expect(openMistakesLine(null)).toBe('');
  });
});
