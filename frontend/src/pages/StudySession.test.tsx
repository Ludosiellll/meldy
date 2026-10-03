import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import StudySession from './StudySession';
import Missions from './Missions';

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

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

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

vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(), alert: vi.fn() }) }));
vi.mock('../hooks/useEnergyConfirm', () => ({ useEnergyConfirm: () => ({ verifyEnergy: vi.fn() }) }));
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

    expect(api.updateCardProgress).toHaveBeenCalledWith('card-1', 5, expect.objectContaining({ clientEventId: expect.any(String) }));
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

  it('retries a failed card save with the same event id', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.updateCardProgress.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(undefined);

    const user = await renderCardSession();
    expect(await screen.findByRole('alert')).toHaveTextContent('Ответ не сохранён');
    await user.click(screen.getByRole('button', { name: /Знал/ }));
    expect(await screen.findByText(/Шаг 2 из 3/)).toBeInTheDocument();

    const [failed, retried] = api.updateCardProgress.mock.calls;
    expect(retried[2].clientEventId).toBe(failed[2].clientEventId);
  });
});

describe('Study session activity counters', () => {
  beforeEach(() => {
    localStorage.clear();
    api.getMaterials.mockResolvedValue([material]);
    api.getDueCards.mockResolvedValue([]);
    api.updateCardProgress.mockResolvedValue(undefined);
    api.recordStudyActivity.mockResolvedValue(undefined);
    api.addXP.mockResolvedValue(undefined);
    api.incrementAIUsage.mockResolvedValue(undefined);
    api.updateMaterialMissions.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function cardsCounted() {
    return api.recordStudyActivity.mock.calls.reduce((sum, call) => sum + Number(call[1] ?? 0), 0);
  }

  it('counts one answered card once, also after the session is finished', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // No cached quiz and the quiz generator is unreachable, so the session finishes right away.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const user = await renderCardSession();

    await user.click(await screen.findByRole('button', { name: /к мини-тесту/ }));
    expect(await screen.findByText(/Дневная сессия завершена/)).toBeInTheDocument();

    expect(api.updateCardProgress).toHaveBeenCalledTimes(1);
    expect(cardsCounted()).toBe(1);
  });

  it('does not count practice cards that have no saved progress', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const user = userEvent.setup();
    api.getMaterials.mockResolvedValue([{ ...material, flashcards_json: { flashcards: [
      { question: 'Что такое кривая забывания?', answer: 'Падение удержания памяти.' },
      { question: 'Зачем увеличивать интервалы?', answer: 'Чтобы повторять перед забыванием.' },
    ] } }]);

    render(<MemoryRouter><StudySession /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: /Поехали/ }));
    for (let i = 0; i < 2; i += 1) {
      await user.click(await screen.findByRole('button', { name: 'Показать ответ' }));
      await user.click(screen.getByRole('button', { name: /Знал/ }));
    }
    await user.click(await screen.findByRole('button', { name: /к мини-тесту/ }));
    expect(await screen.findByText(/Дневная сессия завершена/)).toBeInTheDocument();

    expect(api.updateCardProgress).not.toHaveBeenCalled();
    expect(cardsCounted()).toBe(0);
  });
});

describe('Missions activity counters', () => {
  beforeEach(() => {
    sessionStorage.clear();
    api.getMaterials.mockResolvedValue([material]);
    api.updateQuestProgress.mockResolvedValue(false);
    api.recordStudyActivity.mockResolvedValue(undefined);
    api.checkAndAwardAchievements.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('records the day without inventing review cards', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem('studyforge_missions_state', JSON.stringify({
      selectedMaterialId: material.id,
      phase: 'game',
      missions: [{
        id: 1,
        title: 'Миссия',
        explanation: 'Пояснение',
        question: 'Что такое интервальное повторение?',
        options: ['A) Повторение с растущими интервалами', 'B) Зубрёжка'],
        correct: 'A',
        hint: 'Подсказка',
      }],
      activeStep: 0,
      selectedOption: 'A) Повторение с растущими интервалами',
      isCorrect: true,
      showHint: false,
    }));

    render(<MemoryRouter initialEntries={['/play']}><Missions /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: /Завершить обучение/ }));

    expect(api.recordStudyActivity).toHaveBeenCalledTimes(1);
    expect(api.recordStudyActivity).toHaveBeenCalledWith('user-1', 0, 0);
  });
});
