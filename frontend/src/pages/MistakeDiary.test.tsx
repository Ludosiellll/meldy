import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MistakeDiary, { mistakeOriginLabel, practiceNote } from './MistakeDiary';
import { PHONE_QUERY } from '../lib/usePhone';

const api = vi.hoisted(() => ({
  from: vi.fn(),
  incrementAIUsage: vi.fn(),
  verifyEnergy: vi.fn(),
  alert: vi.fn(),
  confirm: vi.fn(),
  playFlipSound: vi.fn(),
  playSuccessSound: vi.fn(),
  playErrorSound: vi.fn(),
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
  }),
}));
// The server charges the practice before the model; the page only refreshes the meter afterwards.
vi.mock('../api/limits', () => ({ notifyAIUsageChanged: api.incrementAIUsage, AI_LIMIT_MESSAGE: 'Дневной лимит ИИ на сегодня исчерпан.' }));

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
    expect(await screen.findByText('Исправлено ошибок: 2 из 3. Остальные остаются открытыми.')).toBeInTheDocument();
    expect(screen.queryByText(/XP/)).not.toBeInTheDocument();
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
    expect(api.incrementAIUsage).not.toHaveBeenCalled();
  });

  it('charges 2 units only after a usable set of tasks arrived', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    await beginPractice(user);

    expect(await screen.findByText('Проверочный вопрос 1')).toBeInTheDocument();
    expect(api.verifyEnergy).toHaveBeenCalledWith('user-1', 2, 'Работа над ошибками');
    expect(api.incrementAIUsage).toHaveBeenCalledTimes(1);
    expect(api.incrementAIUsage).toHaveBeenCalledWith();
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
    expect(api.incrementAIUsage).toHaveBeenCalledWith();
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

  it('says that the daily AI limit is spent on a 429 ai_limit (not «busy»)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, json: async () => ({ detail: 'Дневной лимит ИИ на сегодня исчерпан.', code: 'ai_limit', used: 100, limit: 100 }),
    }));
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    await beginPractice(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Дневной лимит ИИ на сегодня исчерпан.');
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

  it('does not claim progress when saving resolved mistakes fails', async () => {
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

  it('says plainly in the intro where mistakes come from and what a row opens', async () => {
    api.from.mockReturnValue(listQuery({ data: rows, error: null }));
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);

    expect(await screen.findByText('Ошибки из тестов и ответов на билеты. Нажмите на строку — откроется, что нужно было сказать.')).toBeInTheDocument();
    // The old oral exam is gone: the intro does not promise it (its old mistakes still say where they came from).
    expect(screen.queryByText(/устных экзаменов/)).toBeNull();
    expect(mistakeOriginLabel('oral_ticket')).toBe('Ответ на билет');
    expect(mistakeOriginLabel('quiz')).toBe('Тест');
    expect(mistakeOriginLabel('professor')).toBe('Устный экзамен');
    expect(mistakeOriginLabel(null)).toBe('Устный экзамен');
    expect(document.title).toBe('Дневник ошибок — Meldy');
  });

  it('says what the practice costs from the plan’s prices', async () => {
    api.from.mockReturnValue(listQuery({ data: rows, error: null }));
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    expect(await screen.findByText(/Расходует 2 единицы дневного лимита ИИ, если задания получились\./)).toBeInTheDocument();
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
    expect(screen.queryByText('Ошибок пока нет')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});

/**
 * The diary's table for the list's actions: the load, then each update or delete answers with
 * `writeError` (null: it worked). Records what was written.
 */
function diaryTable(data: unknown[], writes: { error: unknown; calls: string[] } = { error: null, calls: [] }) {
  return () => {
    let op = 'select';
    const query: any = {};
    query.select = vi.fn(() => query);
    query.order = vi.fn(() => Promise.resolve({ data, error: null }));
    query.update = vi.fn(() => {
      op = 'update';
      return query;
    });
    query.delete = vi.fn(() => {
      op = 'delete';
      return query;
    });
    query.in = vi.fn(() => Promise.resolve({ error: writes.error }));
    query.eq = vi.fn((column: string, value: unknown) => {
      if (op === 'select') return query;
      writes.calls.push(`${op}:${String(value)}`);
      return Promise.resolve({ error: writes.error });
    });
    return query;
  };
}

describe('the points of a ticket answer (LIB-11) and the row actions (LIB-29)', () => {
  const ticket = (id: string, point: string, extra: Record<string, unknown> = {}) => ({
    id,
    origin: 'oral_ticket',
    question: 'Реляционная модель данных: домен, атрибут, кортеж, отношение.',
    correct_answer: `${point}. «Реляционная модель данных: ключи и связи», фрагмент 4: «Схема отношения — конечный набор пар «имя атрибута : домен»`,
    student_answer: '(не названо)',
    topic: 'Базы данных',
    is_resolved: false,
    created_at: '2026-10-07T09:00:00Z',
    material_id: 'm1',
    ...extra,
  });
  const diary = [
    ticket('t-1', 'Схема отношения — конечный набор пар имя атрибута и домен'),
    { id: 'q-1', origin: 'quiz', question: 'Что такое кортеж?', correct_answer: 'Строка отношения', student_answer: 'Столбец', topic: 'Базы данных', is_resolved: false, created_at: '2026-10-06T09:00:00Z', material_id: 'm1' },
    ticket('t-2', 'Домен — множество допустимых значений атрибута', { student_answer: 'набор значений' }),
  ];

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the question once with its missed points as rows, dated as the other pages', async () => {
    api.from.mockImplementation(diaryTable(diary));
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);

    expect(await screen.findAllByText('Реляционная модель данных: домен, атрибут, кортеж, отношение.')).toHaveLength(1);
    const head = document.querySelector('.md-group-head .md-meta');
    expect(head?.textContent).toBe('Ответ на билет · Базы данных · 7 окт. · 2 пункта');
    const points = screen.getByRole('list', { name: /^Пункты ответа:/ });
    expect(within(points).getAllByRole('button').map((row) => row.textContent)).toEqual([
      'Схема отношения — конечный набор пар имя атрибута и домен',
      'Домен — множество допустимых значений атрибута',
    ]);
    // A test's mistake stays a row of its own, with its date as «6 окт.», never «06.10.2026».
    expect(screen.getByText('Тест · Базы данных · 6 окт.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d{2}\.\d{2}\.\d{4}/);
  });

  it('opens a point with the student’s words, or that it was not named, and the lecture’s words in nested quotes', async () => {
    api.from.mockImplementation(diaryTable(diary));
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: /^Схема отношения/ }));
    expect(screen.getByText('Вы не назвали этот пункт.')).toBeInTheDocument();
    expect(screen.queryByText('(не названо)')).toBeNull();
    expect(screen.getByText('Как сказано в лекции')).toBeInTheDocument();
    expect(screen.getByText('«Схема отношения — конечный набор пар „имя атрибута : домен“»')).toBeInTheDocument();
    expect(screen.getByText('Из лекции «Реляционная модель данных: ключи и связи», фрагмент 4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Домен/ }));
    expect(screen.getByText('набор значений')).toBeInTheDocument();
  });

  it('asks before deleting, deletes only after the database did, and says when it could not', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const writes = { error: null as unknown, calls: [] as string[] };
    api.from.mockImplementation(diaryTable(diary, writes));
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: /^Схема отношения/ }));

    // «Отмена»: nothing is deleted.
    api.confirm.mockResolvedValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(api.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Удалить ошибку?', message: expect.stringContaining('«Работе над ошибками»') }));
    expect(writes.calls).toEqual([]);

    // The database refused: the row stays and says so.
    writes.error = { message: 'offline' };
    api.confirm.mockResolvedValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось удалить ошибку.');
    expect(screen.getByRole('button', { name: /^Схема отношения/ })).toBeInTheDocument();

    // It worked: the row goes.
    writes.error = null;
    api.confirm.mockResolvedValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Схема отношения/ })).toBeNull());
    expect(writes.calls).toEqual(['delete:t-1', 'delete:t-1']);
  });

  it('keeps a mistake open when marking it fixed failed, and says so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const writes = { error: { message: 'offline' } as unknown, calls: [] as string[] };
    api.from.mockImplementation(diaryTable(diary, writes));
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: /^Схема отношения/ }));
    await user.click(screen.getByRole('button', { name: 'Отметить как исправленную' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось отметить ошибку.');
    expect(screen.getByText('Открыто').closest('p')).toHaveTextContent(/^Открыто\s*3$/);
    expect(writes.calls).toEqual(['update:t-1']);
  });

  it('tells a newcomer where mistakes come from, with one way to get there (LIB-14)', async () => {
    api.from.mockImplementation(diaryTable([]));
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Ошибок пока нет' })).toBeInTheDocument();
    expect(screen.getByText(/пункты, которые вы не назвали в ответе на билет/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ответить на билет' })).toHaveAttribute('href', '/exams');
    // Nothing to filter yet.
    expect(screen.queryByRole('list', { name: 'Какие ошибки показать' })).toBeNull();
  });

  it('says that nothing is fixed yet on «Исправленные»', async () => {
    api.from.mockImplementation(diaryTable(diary));
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Исправленные' }));
    expect(screen.getByRole('heading', { name: 'Исправленных пока нет' })).toBeInTheDocument();
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
  const open = [
    { id: 'a', origin: 'quiz', question: 'Что такое ВВП?', correct_answer: 'Стоимость конечных товаров', student_answer: 'Доход', topic: 'Экономика', is_resolved: false, created_at: '2026-10-02T08:00:00Z', material_id: null },
    { id: 'b', origin: 'quiz', question: 'Что такое инфляция?', correct_answer: 'Рост цен', student_answer: 'Рост зарплат', topic: 'Экономика', is_resolved: false, created_at: '2026-10-02T08:00:00Z', material_id: null },
  ];

  function rowsQuery(data: unknown[]) {
    const query: any = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.order = vi.fn().mockResolvedValue({ data, error: null });
    return query;
  }

  beforeEach(phoneScreen);
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  it('keeps the intro and the price to one short line each', async () => {
    api.from.mockReturnValue(rowsQuery(open));
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    expect(await screen.findByText('Нажмите на строку — откроется ответ.')).toBeInTheDocument();
    expect(screen.queryByText(/Ошибки из тестов и ответов на билеты/)).toBeNull();
    expect(await screen.findByText('Задания по 2 ошибкам · 2 единицы лимита ИИ')).toBeInTheDocument();
    // A phone does not draw «Обновить»: the diary reads itself when the app comes back to the screen.
    expect(screen.queryByRole('button', { name: 'Обновить' })).toBeNull();
  });

  it('words the price on a phone and on a computer', () => {
    expect(practiceNote(17, true)).toBe('Задания по 5 ошибкам · 2 единицы лимита ИИ');
    expect(practiceNote(1, true)).toBe('Задания по 1 ошибке · 2 единицы лимита ИИ');
    expect(practiceNote(17, false)).toBe('Задания по 5 открытым ошибкам. Расходует 2 единицы дневного лимита ИИ, если задания получились.');
    expect(practiceNote(1, false)).toBe('Задания по 1 открытой ошибке. Расходует 2 единицы дневного лимита ИИ, если задания получились.');
  });
});

describe('the diary reads itself again when the app comes back to the screen', () => {
  function rowsQuery(data: unknown[] | null, error: unknown = null) {
    const query: any = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.order = vi.fn().mockResolvedValue({ data, error });
    return query;
  }
  const first = { id: 'a', origin: 'quiz', question: 'Что такое ВВП?', correct_answer: 'Стоимость', student_answer: 'Доход', topic: 'Экономика', is_resolved: false, created_at: '2026-10-02T08:00:00Z', material_id: null };
  const added = { id: 'n', origin: 'quiz', question: 'Что такое дефляция?', correct_answer: 'Падение цен', student_answer: 'Рост цен', topic: 'Экономика', is_resolved: false, created_at: '2026-10-03T08:00:00Z', material_id: null };

  function comeBack() {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (document as unknown as { visibilityState?: unknown }).visibilityState;
  });

  it('shows a mistake made meanwhile, without «Загружаем…» and without a button', async () => {
    api.from.mockReturnValue(rowsQuery([first]));
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    expect(await screen.findByText('Что такое ВВП?')).toBeInTheDocument();
    api.from.mockReturnValue(rowsQuery([added, first]));
    comeBack();
    expect(screen.queryByText('Загружаем…')).toBeNull();
    expect(await screen.findByText('Что такое дефляция?')).toBeInTheDocument();
    expect(screen.getByText('Что такое ВВП?')).toBeInTheDocument();
  });

  it('keeps the rows when the read fails', async () => {
    api.from.mockReturnValue(rowsQuery([first]));
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    expect(await screen.findByText('Что такое ВВП?')).toBeInTheDocument();
    const failing = rowsQuery(null, { message: 'offline' });
    api.from.mockReturnValue(failing);
    comeBack();
    await waitFor(() => expect(failing.order).toHaveBeenCalled());
    expect(screen.getByText('Что такое ВВП?')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  /**
   * The table for a read overtaken by a write: the first read answers with `rows`, the next ones wait for
   * `answerRead`; every update or delete answers at once (it worked).
   */
  function overtakenTable(rows: unknown[]) {
    const pending: Array<(value: { data: unknown; error: null }) => void> = [];
    let reads = 0;
    const from = () => {
      let op = 'select';
      const query: any = {};
      query.select = vi.fn(() => query);
      query.order = vi.fn(() => {
        reads += 1;
        if (reads === 1) return Promise.resolve({ data: rows, error: null });
        return new Promise((resolve) => pending.push(resolve));
      });
      query.update = vi.fn(() => {
        op = 'update';
        return query;
      });
      query.delete = vi.fn(() => {
        op = 'delete';
        return query;
      });
      query.eq = vi.fn(() => (op === 'select' ? query : Promise.resolve({ error: null })));
      return query;
    };
    return { from, pending, answerRead: async (data: unknown[]) => act(async () => pending.shift()?.({ data, error: null })) };
  }

  it('drops a read that a fix overtook: a mistake marked fixed does not come back open', async () => {
    const table = overtakenTable([first]);
    api.from.mockImplementation(table.from);
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: /^Что такое ВВП\?/ }));
    // Back on the screen: the quiet read leaves, and the database answers it as it was before the fix.
    comeBack();
    await waitFor(() => expect(table.pending).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Отметить как исправленную' }));
    await waitFor(() => expect(screen.getByText('Открыто').closest('p')).toHaveTextContent(/^Открыто\s*0$/));
    await table.answerRead([first]);
    expect(screen.getByText('Открыто').closest('p')).toHaveTextContent(/^Открыто\s*0$/);
    expect(screen.getByText(/· исправлена$/)).toBeInTheDocument();

    // A read that leaves after the fix is taken as it comes.
    comeBack();
    await waitFor(() => expect(table.pending).toHaveLength(1));
    await table.answerRead([first, added]);
    expect(await screen.findByText('Что такое дефляция?')).toBeInTheDocument();
  });

  it('drops a read that a delete overtook: the deleted mistake does not come back', async () => {
    api.confirm.mockResolvedValue(true);
    const table = overtakenTable([first, added]);
    api.from.mockImplementation(table.from);
    const user = userEvent.setup();
    render(<MemoryRouter><MistakeDiary /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: /^Что такое ВВП\?/ }));
    comeBack();
    await waitFor(() => expect(table.pending).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(screen.queryByText('Что такое ВВП?')).toBeNull());
    await table.answerRead([first, added]);
    expect(screen.queryByText('Что такое ВВП?')).toBeNull();
    expect(screen.getByText('Что такое дефляция?')).toBeInTheDocument();
  });
});
