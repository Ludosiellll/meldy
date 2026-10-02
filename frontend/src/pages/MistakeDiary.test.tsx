import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MistakeDiary from './MistakeDiary';

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
  await user.click(screen.getByRole('button', { name: /Запустить AI-работу над ошибками/ }));
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

    expect(api.alert).toHaveBeenCalled();
    expect(screen.queryByText('Какое ключевое правило нужно соблюдать?')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Дневник ошибок' })).toBeInTheDocument();
    expect(api.addXP).not.toHaveBeenCalled();
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
