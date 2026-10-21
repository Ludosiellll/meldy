import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Review, { emptyQueueCopy, nextReviewWords, openMistakesLine, openMistakesShort } from './Review';
import { supabase } from '../lib/supabase';
import { PHONE_QUERY } from '../lib/usePhone';

const api = vi.hoisted(() => ({
  getDueCards: vi.fn(),
  countDueCards: vi.fn(),
  updateCardProgress: vi.fn(),
  recordStudyActivity: vi.fn(),
  playFlipSound: vi.fn(),
  playSuccessSound: vi.fn(),
}));

vi.mock('../api/flashcards', () => ({
  getDueCards: api.getDueCards,
  countDueCards: api.countDueCards,
  updateCardProgress: api.updateCardProgress,
}));

vi.mock('../api/studyActivity', () => ({
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

/** The whole text, whatever spaces ty() put between its words (no-break after short words). */
function typeset(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s')}$`);
}

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

    expect(await screen.findByRole('alert')).toHaveTextContent('Ответ не сохранился');
    expect(screen.getByText('Что такое интервальное повторение?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Помню' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: /^Повторили/ })).not.toBeInTheDocument();
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Ответ не сохранился');
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

  it('ends early with «Закончить» and offers the exams, named as what it opens', async () => {
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
    // It opens the list of exams, so it is called «Экзамены» (it used to say «Лист экзамена»).
    expect(screen.getByRole('link', { name: 'Экзамены' })).toHaveAttribute('href', '/exams');
    expect(screen.queryByRole('link', { name: 'Лист экзамена' })).toBeNull();
    // The second card is still due: the queue can go on.
    expect(screen.getByRole('button', { name: 'Продолжить' })).toBeInTheDocument();
  });

  it('says how many cards wait today when the session holds only the first 20 (decision 4)', async () => {
    api.getDueCards.mockResolvedValue(Array.from({ length: 20 }, (_, i) => ({ id: `card-${i}`, question: `Вопрос ${i + 1}`, answer: `Ответ ${i + 1}` })));
    api.countDueCards.mockResolvedValue(24);
    renderReview();
    await screen.findByRole('button', { name: 'Перевернуть' });
    const where = document.querySelector('.rv-where') as HTMLElement;
    await waitFor(() => expect(where.textContent?.replace(/\s+/g, ' ')).toBe('1 из 20 · всего на сегодня 24'));
    expect(api.countDueCards).toHaveBeenCalledWith('user-1', {});
  });

  it('names no day’s total when the session holds every due card', async () => {
    api.getDueCards.mockResolvedValue([
      { id: 'card-1', question: 'Первый вопрос', answer: 'Первый ответ' },
      { id: 'card-2', question: 'Второй вопрос', answer: 'Второй ответ' },
    ]);
    renderReview();
    await screen.findByRole('button', { name: 'Перевернуть' });
    expect(document.querySelector('.rv-where')?.textContent).toBe('1 из 2');
    expect(api.countDueCards).not.toHaveBeenCalled();
  });

  it('brings the three words into view when the card is turned over', async () => {
    // The setup gives jsdom a no-op scrollIntoView on HTMLElement.
    const scrolled = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const user = userEvent.setup();
    renderReview();
    await user.click(await screen.findByRole('button', { name: 'Перевернуть' }));
    expect(scrolled).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }));
    expect(scrolled.mock.contexts[0]).toBe(screen.getByRole('group', { name: 'Как вспомнилось' }));
    // The first word takes the focus for 1, 2, 3 and Tab.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Не помню' }));
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
    expect(await screen.findByText('Не помню — повторим завтра.')).toBeInTheDocument();
    expect(api.playFlipSound).not.toHaveBeenCalled();
    expect(api.playSuccessSound).not.toHaveBeenCalled();
  });

  it('types in the card\'s corner when it comes back — «завтра», «через 9 дней» — never in pencil handwriting', async () => {
    api.updateCardProgress.mockResolvedValueOnce({ card_id: 'card-1', interval_days: 1, duplicate: false });
    const user = userEvent.setup();
    const { container, unmount } = renderReview();
    await revealAndChoose(user, 'Не помню');
    await screen.findByText('Не помню — повторим завтра.');
    expect(container.querySelector('.rv-when')?.textContent).toBe('завтра');
    expect(container.querySelector('.rv-face svg')).toBeNull();
    unmount();

    api.updateCardProgress.mockResolvedValueOnce({ card_id: 'card-1', interval_days: 9, duplicate: false });
    const second = renderReview();
    await revealAndChoose(user, 'Помню');
    await screen.findByText('Помню — повторим через 9 дней.');
    expect(second.container.querySelector('.rv-when')?.textContent).toBe('через 9 дней');
    expect(second.container.querySelector('.rv-face svg')).toBeNull();
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
    expect(await screen.findByText('Помню — повторим через 6 дней.')).toBeInTheDocument();
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
    expect(screen.getByText('Помню — 1, с трудом — 0, не помню — 1. Завтра повторим 1 карточку.')).toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: typeset('Сейчас эту лекцию повторять не нужно') })).toBeInTheDocument();
    expect(screen.queryByText('На сегодня всё')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Все карточки к повторению' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'К лекции' })).toBeInTheDocument();
  });

  it('does not query with a material id that is not a uuid', async () => {
    renderReview('/review?material=abc');

    expect(await screen.findByRole('heading', { name: typeset('Сейчас эту лекцию повторять не нужно') })).toBeInTheDocument();
    expect(api.getDueCards).not.toHaveBeenCalled();
  });
});

/**
 * A Supabase query for the empty queue's counts: a HEAD count of the cards (with gt/lt: the ones
 * later today) and the next review date.
 */
function cardsQuery(outlook: { total: number; later: number; next: string | null }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gt', 'lt', 'order', 'limit', 'in']) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
    const head = calls.some(([method, args]) => method === 'select' && (args[1] as { head?: boolean } | undefined)?.head);
    const later = calls.some(([method]) => method === 'lt');
    const result = head ? { count: later ? outlook.later : outlook.total, error: null } : { data: outlook.next ? [{ next_review: outlook.next }] : [], error: null };
    return Promise.resolve(result).then(resolve, reject);
  };
  return chain;
}

describe('an empty queue says what it means (LIB-14)', () => {
  beforeEach(() => {
    api.getDueCards.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.mocked(supabase.from).mockReset();
  });

  function withOutlook(outlook: { total: number; later: number; next: string | null }) {
    vi.mocked(supabase.from).mockImplementation(((table: string) =>
      table === 'flashcard_progress' ? cardsQuery(outlook) : query({ count: 0, error: null })) as unknown as typeof supabase.from);
  }

  it('tells a student without cards where cards come from, with one way to get them', async () => {
    withOutlook({ total: 0, later: 0, next: null });
    renderReview();
    expect(await screen.findByRole('heading', { name: 'Карточек пока нет' })).toBeInTheDocument();
    expect(screen.getByText(/появятся после разбора лекции/)).toHaveTextContent(/вопросы экзаменатора, на которые вы не ответили в билете/);
    expect(screen.getByRole('link', { name: 'Разобрать лекцию' })).toHaveAttribute('href', '/analyze');
    // No «done» for someone who has not started, and no tick on the picture.
    expect(screen.queryByText('На сегодня всё')).toBeNull();
    expect(document.querySelector('.rv-empty .rv-art svg')).toBeNull();
  });

  it('says that more cards come later today, and when', async () => {
    const at = new Date();
    at.setHours(23, 40, 0, 0);
    withOutlook({ total: 26, later: 2, next: at.toISOString() });
    renderReview();
    expect(await screen.findByRole('heading', { name: 'Сейчас повторять нечего' })).toBeInTheDocument();
    expect(screen.getByText('Ещё 2 карточки придут сегодня, первая в 23:40.')).toBeInTheDocument();
  });

  it('says «На сегодня всё» only when nothing else comes today, with the next review', async () => {
    const at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(9, 0, 0, 0);
    withOutlook({ total: 26, later: 0, next: at.toISOString() });
    renderReview();
    expect(await screen.findByRole('heading', { name: typeset('На сегодня всё') })).toBeInTheDocument();
    expect(screen.getByText('Следующее повторение завтра.')).toBeInTheDocument();
  });

  it('words each case', () => {
    const now = new Date(2026, 9, 8, 15, 0);
    const today = new Date(2026, 9, 8, 18, 40).toISOString();
    expect(emptyQueueCopy({ total: 5, laterToday: 1, nextAt: today }, false, now).text).toBe('Ещё одна карточка придёт сегодня в 18:40.');
    expect(emptyQueueCopy({ total: 5, laterToday: 0, nextAt: new Date(2026, 9, 12, 9).toISOString() }, false, now).text).toBe('Следующее повторение 12 октября.');
    expect(emptyQueueCopy({ total: 0, laterToday: 0, nextAt: null }, true, now).title).toBe('У этой лекции нет карточек в повторении');
    expect(emptyQueueCopy(null, false, now)).toEqual({ kind: 'unknown', title: 'Сейчас повторять нечего', text: 'Сейчас нет карточек, которые пора повторить.' });
    expect(nextReviewWords(today, now)).toBe('сегодня в 18:40');
    expect(nextReviewWords(new Date(2026, 9, 9, 7).toISOString(), now)).toBe('завтра');
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

  it('is one card under the empty queue, with the open mistakes counted by a HEAD request', async () => {
    renderReview();
    // The card counts cannot be read here, so the page says only what is certain.
    expect(await screen.findByRole('heading', { name: 'Сейчас повторять нечего' })).toBeInTheDocument();
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

/** A phone for usePhone (max-width 639px): jsdom has no matchMedia of its own. */
function phoneScreen() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (media: string) => ({ matches: media === PHONE_QUERY, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
}

describe('on a phone (10_Project/Phone_Declutter_2026-10-08)', () => {
  const twoCards = [
    { id: 'card-1', question: 'Первый вопрос', answer: 'Первый ответ' },
    { id: 'card-2', question: 'Второй вопрос', answer: 'Второй ответ' },
  ];

  beforeEach(() => {
    phoneScreen();
    api.getDueCards.mockResolvedValue(twoCards);
    api.updateCardProgress.mockResolvedValue({ card_id: 'card-1', duplicate: false, interval_days: 1 });
    api.recordStudyActivity.mockResolvedValue(undefined);
    vi.mocked(supabase.from).mockImplementation(((table: string) =>
      table === 'mistake_diary' ? query({ count: 17, error: null }) : query({ data: [], error: null })) as unknown as typeof supabase.from);
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    vi.mocked(supabase.from).mockReset();
  });

  it('shows the diary as one row link under the card during a session: «Дневник ошибок: 17 открытых →»', async () => {
    renderReview();
    const flip = await screen.findByRole('button', { name: 'Перевернуть' });
    expect(screen.queryByRole('region', { name: 'Дневник ошибок' })).toBeNull();
    const line = await screen.findByRole('link', { name: /^Дневник ошибок: 17\s+открытых$/ });
    expect(line).toHaveAttribute('href', '/mistakes');
    // An ink link (not the muted one of explanations); the number keeps its word.
    expect(line).toHaveClass('sf-link');
    expect(line).not.toHaveAttribute('data-muted');
    expect(line.textContent).toBe('Дневник ошибок: 17\u00a0открытых→');
    expect(flip.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says the hint under «Перевернуть» in one short line, until the first card is turned over', async () => {
    const user = userEvent.setup();
    renderReview();
    await screen.findByRole('button', { name: 'Перевернуть' });
    const row = () => document.querySelector('.rv-flip-row') as HTMLElement;
    expect(row()).toHaveTextContent('Вспомните ответ, потом переверните.');
    expect(row()).not.toHaveAttribute('data-seen');
    await revealAndChoose(user);
    // The second card: the hint is marked seen, and a phone does not draw it (Review.css).
    await waitFor(() => expect(screen.getByText('Второй вопрос')).toBeInTheDocument(), { timeout: 2000 });
    expect(row()).toHaveAttribute('data-seen');
    // The grades and the session are as on a computer.
    expect(api.updateCardProgress).toHaveBeenCalledTimes(1);
  });

  it('keeps one pill beside «Продолжить» on the done screen, and the diary card under it', async () => {
    const user = userEvent.setup();
    renderReview();
    await revealAndChoose(user);
    await screen.findByText('Второй вопрос', undefined, { timeout: 2000 });
    await user.click(screen.getByRole('button', { name: 'Закончить' }));
    expect(await screen.findByRole('heading', { name: 'Повторили 1 карточку' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Продолжить' })).toHaveClass('sf-primary');
    expect(screen.getByRole('link', { name: 'Экзамены' })).toHaveClass('sf-link');
    expect(screen.getByRole('region', { name: 'Дневник ошибок' })).toBeInTheDocument();
  });

  it('keeps the diary card under an empty queue', async () => {
    api.getDueCards.mockResolvedValue([]);
    renderReview();
    const diary = await screen.findByRole('region', { name: 'Дневник ошибок' });
    expect(await within(diary).findByText('17 открытых ошибок.')).toBeInTheDocument();
  });

  it('words the tail of the line', () => {
    expect(openMistakesShort(1)).toBe('1 открытая');
    expect(openMistakesShort(3)).toBe('3 открытые');
    expect(openMistakesShort(17)).toBe('17 открытых');
    expect(openMistakesShort(0)).toBe('открытых нет');
    expect(openMistakesShort(null)).toBe('');
  });
});

describe('a computer keeps the session as it was', () => {
  beforeEach(() => {
    api.getDueCards.mockResolvedValue([
      { id: 'card-1', question: 'Первый вопрос', answer: 'Первый ответ' },
      { id: 'card-2', question: 'Второй вопрос', answer: 'Второй ответ' },
    ]);
    api.updateCardProgress.mockResolvedValue({ card_id: 'card-1', duplicate: false, interval_days: 1 });
    api.recordStudyActivity.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it('says the whole hint, and «Экзамены» stays a pill beside «Продолжить»', async () => {
    const user = userEvent.setup();
    renderReview();
    await screen.findByRole('button', { name: 'Перевернуть' });
    expect(document.querySelector('.rv-flip-row')).toHaveTextContent('Сначала вспомните ответ, потом переверните карточку.');
    await revealAndChoose(user);
    await screen.findByText('Второй вопрос', undefined, { timeout: 2000 });
    await user.click(screen.getByRole('button', { name: 'Закончить' }));
    await screen.findByRole('heading', { name: 'Повторили 1 карточку' });
    expect(screen.getByRole('link', { name: 'Экзамены' })).toHaveClass('sf-secondary');
  });
});
