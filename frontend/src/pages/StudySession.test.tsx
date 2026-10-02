import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import StudySession from './StudySession';

const api = vi.hoisted(() => ({
  getDueCards: vi.fn(),
  updateCardProgress: vi.fn(),
  getMaterials: vi.fn(),
  updateMaterialMissions: vi.fn(),
  updateQuestProgress: vi.fn(),
  recordStudyActivity: vi.fn(),
  addXP: vi.fn(),
  checkAndAwardAchievements: vi.fn(),
  incrementAIUsage: vi.fn(),
}));

vi.mock('../api/flashcards', () => ({
  getDueCards: api.getDueCards,
  updateCardProgress: api.updateCardProgress,
}));

vi.mock('../api/materials', () => ({
  getMaterials: api.getMaterials,
  updateMaterialMissions: api.updateMaterialMissions,
}));

vi.mock('../api/quests', () => ({
  updateQuestProgress: api.updateQuestProgress,
  recordStudyActivity: api.recordStudyActivity,
  addXP: api.addXP,
  checkAndAwardAchievements: api.checkAndAwardAchievements,
}));

vi.mock('../api/limits', () => ({
  incrementAIUsage: api.incrementAIUsage,
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', user_metadata: { full_name: 'Ученик' } } }),
}));

vi.mock('../hooks/useSound', () => ({
  useSound: () => ({
    playFlipSound: vi.fn(),
    playSuccessSound: vi.fn(),
    playErrorSound: vi.fn(),
    playXpSound: vi.fn(),
  }),
}));

vi.mock('../components/ConfettiCelebration', () => ({ default: () => null }));
vi.mock('../components/AchievementToast', () => ({ default: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const material = {
  id: 'material-1',
  title: 'Интервальное повторение',
  flashcards_json: [],
  missions_json: { missions: [] },
};

async function renderCardSession() {
  const user = userEvent.setup();
  localStorage.setItem(`study_session_user-1`, JSON.stringify({
    phase: 'cards',
    cardIdx: 0,
    cardStats: { correct: 0, wrong: 0 },
    chatMessages: [],
    quizIdx: 0,
    quizScore: 0,
    activeMaterial: material,
    sessionCards: [{
      id: 'card-1',
      question: 'Что такое интервальное повторение?',
      answer: 'Повторение с увеличивающимися интервалами.',
    }],
    testQuestions: [],
    xpGained: 0,
    selectedOption: null,
    isCorrect: null,
    showHint: false,
  }));

  render(<MemoryRouter><StudySession /></MemoryRouter>);
  await screen.findByText('Шаг 1 из 3 · Повторение карточек');
  await user.click(await screen.findByRole('button', { name: 'Показать ответ' }));
  await user.click(screen.getByRole('button', { name: /Знал/ }));
  return user;
}

describe('Study session card persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    api.getMaterials.mockResolvedValue([material]);
    api.getDueCards.mockResolvedValue([{
      id: 'card-1',
      material_id: material.id,
      question: 'Что такое интервальное повторение?',
      answer: 'Повторение с увеличивающимися интервалами.',
    }]);
    api.updateCardProgress.mockResolvedValue(undefined);
    api.updateQuestProgress.mockResolvedValue(undefined);
    api.recordStudyActivity.mockResolvedValue(undefined);
    api.addXP.mockResolvedValue(undefined);
    api.checkAndAwardAchievements.mockResolvedValue([]);
    api.incrementAIUsage.mockResolvedValue(undefined);
    api.updateMaterialMissions.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('waits for the saved answer before moving to the next study step', async () => {
    const save = deferred<void>();
    api.updateCardProgress.mockReturnValue(save.promise);

    await renderCardSession();

    expect(api.updateCardProgress).toHaveBeenCalledWith('card-1', 5);
    expect(screen.getByRole('button', { name: /Знал/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Сохраняем ответ…');
    expect(screen.getByText('Шаг 1 из 3 · Повторение карточек')).toBeInTheDocument();

    save.resolve();
    expect(await screen.findByText(/Шаг 2 из 3/)).toBeInTheDocument();
  });

  it.each([
    ['current { flashcards: [...] } format', { flashcards: [
      { id: 1, question: 'Что такое кривая забывания?', answer: 'Падение удержания памяти со временем.', source_ids: ['S01'] },
      { id: 2, question: 'Зачем увеличивать интервалы?', answer: 'Чтобы повторять перед моментом забывания.' },
    ] }],
    ['legacy array format', [
      { question: 'Что такое кривая забывания?', answer: 'Падение удержания памяти со временем.' },
      { question: 'Зачем увеличивать интервалы?', answer: 'Чтобы повторять перед моментом забывания.' },
    ]],
  ])('offers practice cards from the material when nothing is due (%s)', async (_format, flashcardsJson) => {
    const user = userEvent.setup();
    api.getDueCards.mockResolvedValue([]);
    api.getMaterials.mockResolvedValue([{ ...material, flashcards_json: flashcardsJson }]);

    render(<MemoryRouter><StudySession /></MemoryRouter>);

    expect(await screen.findByText('Разминка с карточками (2 шт)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Поехали/ }));

    expect(await screen.findByText('Шаг 1 из 3 · Повторение карточек')).toBeInTheDocument();
    expect(screen.getByText('Что такое кривая забывания?')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('keeps the same card visible when progress cannot be saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.updateCardProgress.mockRejectedValue(new Error('offline'));

    await renderCardSession();

    expect(await screen.findByRole('alert')).toHaveTextContent('Ответ не сохранён');
    expect(screen.getByText('Что такое интервальное повторение?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Знал/ })).toBeEnabled();
    expect(screen.getByText('Шаг 1 из 3 · Повторение карточек')).toBeInTheDocument();
    expect(api.updateQuestProgress).not.toHaveBeenCalled();
    expect(api.recordStudyActivity).not.toHaveBeenCalled();
  });
});
