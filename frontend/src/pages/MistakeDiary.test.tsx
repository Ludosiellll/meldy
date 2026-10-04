import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MistakeDiary, { mistakeOriginLabel } from './MistakeDiary';

const api = vi.hoisted(() => ({
  from: vi.fn(),
  addXP: vi.fn(),
  incrementAIUsage: vi.fn(),
  verifyEnergy: vi.fn(),
  alert: vi.fn(),
  confirm: vi.fn(),
  playFlipSound: vi.fn(),
  playSuccessSound: vi.fn(),
  playErrorSound: vi.fn(),
  playXpSound: vi.fn(),
  updateError: null as null | { message: string },
}));

vi.mock('../lib/supabase', () => ({ supabase: { from: api.from } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: api.confirm, alert: api.alert }),
}));
vi.mock('../hooks/useEnergyConfirm', () => ({
  useEnergyConfirm: () => ({ verifyEnergy: api.verifyEnergy }),
}));
vi.mock('../hooks/useSound', () => ({
  useSound: () => ({
    playFlipSound: api.playFlipSound,
    playSuccessSound: api.playSuccessSound,
    playErrorSound: api.playErrorSound,
    playXpSound: api.playXpSound,
  }),
}));
vi.mock('../api/quests', () => ({ addXP: api.addXP }));
vi.mock('../api/limits', () => ({ incrementAIUsage: api.incrementAIUsage }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const mistakes = [
  { id: 'mistake-1', question: 'Вопрос 1', correct_answer: 'Ответ 1', student_answer: 'Ошибка 1', topic: 'Тема 1', is_resolved: false, created_at: '2026-09-24T08:00:00Z', material_id: null },
  { id: 'mistake-2', question: 'Вопрос 2', correct_answer: 'Ответ 2', student_answer: 'Ошибка 2', topic: 'Тема 2', is_resolved: false, created_at: '2026-09-24T08:00:00Z', material_id: null },
  { id: 'mistake-3', question: 'Вопрос 3', correct_answer: 'Ответ 3', student_answer: 'Ошибка 3', topic: 'Тема 3', is_resolved: false, created_at: '2026-09-24T08:00:00Z', material_id: null },
];

const practice = mistakes.map((mistake, index) => ({
  id: index + 1,
  mistake_id: mistake.id,
  question: `Проверочный вопрос ${index + 1}`,
  options: ['A) Верный ответ', 'B) Неверный ответ', 'C) Другой ответ', 'D) Ещё ответ'],
  correct: 'A',
  explanation: 'Краткое объяснение ответа.',
}));

function createQuery() {
  const query: any = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn().mockResolvedValue({ data: mistakes, error: null });
  query.update = vi.fn(() => query);
  query.in = vi.fn().mockImplementation(async () => ({ error: api.updateError }));
  return query;
}

async function beginPractice(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('heading', { name: 'Дневник ошибок' });
  await user.click(screen.getByRole('button', { name: 'Начать работу над ошибками' }));
}

describe('Mistake diary practice', () => {
  beforeEach(() => {
    api.updateError = null;
    const query = createQuery();
    api.from.mockReturnValue(query);
    api.verifyEnergy.mockResolvedValue(true);
    api.incrementAIUsage.mockResolvedValue(undefined);
    api.addXP.mockResolvedValue(undefined);
    api.confirm.mockResolvedValue(true);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ practice }),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('resolves only the mistakes whose linked questions were answered correctly', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    await beginPractice(user);

    await user.click(await screen.findByRole('button', { name: 'A) Верный ответ' }));
    await user.click(screen.getByRole('button', { name: 'Следующий вопрос' }));
    await user.click(await screen.findByRole('button', { name: 'B) Неверный ответ' }));
    await user.click(screen.getByRole('button', { name: 'Следующий вопрос' }));
    await user.click(await screen.findByRole('button', { name: 'A) Верный ответ' }));
    await user.click(screen.getByRole('button', { name: 'Завершить практику' }));

    await waitFor(() => {
      const updateQuery = api.from.mock.results[api.from.mock.results.length - 1]?.value;
      expect(updateQuery.in).toHaveBeenCalledWith('id', ['mistake-1', 'mistake-3']);
    });
    expect(api.addXP).toHaveBeenCalledWith('user-1', 50);
  });

  it('does not treat an unlinked fallback question as a valid practice test', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        practice: [{
          id: 1,
          mistake_id: '',
          question: 'Какое ключевое правило нужно соблюдать?',
          options: ['A) Внимательно разбирать ошибки', 'B) Заучивать ответы', 'C) Не смотреть дневник', 'D) Избегать сложных тем'],
          correct: 'A',
          explanation: 'Общее пояснение.',
        }],
      }),
    }));
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);

    await beginPractice(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось подготовить задания. Попробуйте ещё раз.');
    expect(api.alert).not.toHaveBeenCalled();
    expect(screen.queryByText('Какое ключевое правило нужно соблюдать?')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Дневник ошибок' })).toBeInTheDocument();
    expect(api.addXP).not.toHaveBeenCalled();
    expect(api.incrementAIUsage).not.toHaveBeenCalled();
  });

  it('charges 2 units only after a usable set of tasks arrived', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    await beginPractice(user);

    expect(await screen.findByText('Проверочный вопрос 1')).toBeInTheDocument();
    expect(api.verifyEnergy).toHaveBeenCalledWith('user-1', 2, 'Работа над ошибками');
    expect(api.incrementAIUsage).toHaveBeenCalledTimes(1);
    expect(api.incrementAIUsage).toHaveBeenCalledWith('user-1', 2);
  });

  it('starts one practice and charges once when the button is pressed again during the limit check', async () => {
    const releases: Array<(ok: boolean) => void> = [];
    api.verifyEnergy.mockImplementation(() => new Promise<boolean>((resolve) => releases.push(resolve)));
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    const button = await screen.findByRole('button', { name: 'Начать работу над ошибками' });

    // Two presses before React renders the busy state, then one more on the busy button.
    act(() => {
      button.click();
      button.click();
    });
    expect(screen.getByRole('button', { name: /Готовим задания/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Готовим задания/ }));

    await act(async () => {
      releases.forEach((release) => release(true));
    });
    expect(await screen.findByText('Проверочный вопрос 1')).toBeInTheDocument();
    expect(api.verifyEnergy).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(api.incrementAIUsage).toHaveBeenCalledTimes(1);
    expect(api.incrementAIUsage).toHaveBeenCalledWith('user-1', 2);
  });

  it('lets the practice start again after the limit check said no', async () => {
    api.verifyEnergy.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);

    await beginPractice(user);
    expect(await screen.findByRole('button', { name: 'Начать работу над ошибками' })).toBeEnabled();
    expect(fetch).not.toHaveBeenCalled();
    expect(api.incrementAIUsage).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Начать работу над ошибками' }));
    expect(await screen.findByText('Проверочный вопрос 1')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(api.incrementAIUsage).toHaveBeenCalledTimes(1);
  });

  it('says plainly that the AI service is busy on 429 and charges nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ detail: 'busy' }) }));
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    await beginPractice(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Сервис ИИ сейчас занят. Подождите минуту и попробуйте ещё раз.');
    expect(api.alert).not.toHaveBeenCalled();
    expect(api.incrementAIUsage).not.toHaveBeenCalled();
  });

  it('charges nothing when the server fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}) }));
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    await beginPractice(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось подготовить задания. Попробуйте ещё раз.');
    expect(api.incrementAIUsage).not.toHaveBeenCalled();
  });

  it('does not claim progress or award XP when saving resolved mistakes fails', async () => {
    api.updateError = { message: 'offline' };
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    await beginPractice(user);

    await user.click(await screen.findByRole('button', { name: 'A) Верный ответ' }));
    await user.click(screen.getByRole('button', { name: 'Следующий вопрос' }));
    await user.click(await screen.findByRole('button', { name: 'B) Неверный ответ' }));
    await user.click(screen.getByRole('button', { name: 'Следующий вопрос' }));
    await user.click(await screen.findByRole('button', { name: 'A) Верный ответ' }));
    await user.click(screen.getByRole('button', { name: 'Завершить практику' }));

    expect(await screen.findByRole('heading', { name: 'Не удалось сохранить прогресс' })).toBeInTheDocument();
    expect(api.addXP).not.toHaveBeenCalled();
    expect(screen.queryByText(/Ошибки исправлены/)).not.toBeInTheDocument();
  });
});

describe('Mistake diary list', () => {
  const rows = [
    { id: 'q-1', origin: 'quiz', question: 'Что измеряет энтропия?', correct_answer: 'Беспорядок системы — мера беспорядка', student_answer: 'Массу тела', topic: 'Физика', is_resolved: false, created_at: '2026-10-02T08:00:00Z', material_id: 'm1' },
    { id: 'o-1', origin: 'oral_ticket', question: 'Денежно-кредитная политика ЦБ', correct_answer: 'Канал кредита. «Денежный рынок», фрагмент 12: «ставка влияет на кредиты»', student_answer: '(не названо)', topic: 'Макроэкономика', is_resolved: false, created_at: '2026-10-02T09:00:00Z', material_id: 'm2' },
    { id: 'p-1', origin: 'professor', question: 'Функции денег', correct_answer: 'Не названа функция меры стоимости', student_answer: 'Деньги — средство обмена', topic: '', is_resolved: true, created_at: '2026-09-20T09:00:00Z', material_id: null },
    { id: 'legacy', question: 'Старый вопрос', correct_answer: 'Старый правильный ответ', student_answer: '', topic: '', is_resolved: false, created_at: '2026-09-01T09:00:00Z', material_id: null },
  ];

  function listQuery(result: { data: unknown; error: unknown }) {
    const query: any = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.order = vi.fn().mockResolvedValue(result);
    query.update = vi.fn(() => query);
    query.in = vi.fn().mockResolvedValue({ error: null });
    return query;
  }

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('names where every mistake came from', async () => {
    api.from.mockReturnValue(listQuery({ data: rows, error: null }));
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);

    expect(await screen.findByText(/^Тест · Физика/)).toBeInTheDocument();
    // A ticket answered by voice or in writing is the same answer (Jury_Check 11): no «вслух».
    expect(screen.getByText(/^Ответ на билет · Макроэкономика/)).toBeInTheDocument();
    expect(screen.queryByText(/вслух/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Устный экзамен · /)).toHaveLength(2);
    // The two figures of the summary card: «Открыто 3», «Исправлено 1».
    expect(screen.getByText('Открыто').closest('p')).toHaveTextContent(/^Открыто\s*3$/);
    expect(screen.getByText('Исправлено').closest('p')).toHaveTextContent(/^Исправлено\s*1$/);
  });

  it('lives in «Повторение»: the crumb over the title leads back there', async () => {
    api.from.mockReturnValue(listQuery({ data: rows, error: null }));
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);

    const title = await screen.findByRole('heading', { level: 1, name: 'Дневник ошибок' });
    const crumb = screen.getByRole('link', { name: 'Повторение' });
    expect(crumb).toHaveAttribute('href', '/review');
    expect(crumb.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says in the intro that mistakes come from tests, ticket answers and oral exams', async () => {
    api.from.mockReturnValue(listQuery({ data: rows, error: null }));
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);

    expect(
      await screen.findByText('Ошибки из тестов, ответов на билеты и устных экзаменов. Правильный ответ открывается по нажатию.'),
    ).toBeInTheDocument();
    expect(mistakeOriginLabel('oral_ticket')).toBe('Ответ на билет');
    expect(mistakeOriginLabel('quiz')).toBe('Тест');
    expect(mistakeOriginLabel('professor')).toBe('Устный экзамен');
    expect(mistakeOriginLabel(null)).toBe('Устный экзамен');
  });

  it('keeps the right answer hidden until the row is opened', async () => {
    api.from.mockReturnValue(listQuery({ data: rows, error: null }));
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);

    const row = await screen.findByRole('button', { name: /Что измеряет энтропия\?/ });
    expect(screen.queryByText('Беспорядок системы — мера беспорядка')).not.toBeInTheDocument();
    expect(row).toHaveAttribute('aria-expanded', 'false');

    await user.click(row);

    expect(screen.getByText('Беспорядок системы — мера беспорядка')).toBeInTheDocument();
    expect(screen.getByText('Правильный ответ')).toBeInTheDocument();
    expect(screen.getByText('Массу тела')).toBeInTheDocument();
  });

  it('shows a load failure instead of an empty diary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.from.mockReturnValue(listQuery({ data: null, error: { message: 'offline' } }));
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить дневник ошибок.');
    expect(screen.queryByText('Пока пусто')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});
