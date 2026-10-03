import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ProfessorExam, { ticketPassed } from './ProfessorExam';

type Call = [string, unknown[]];
interface QueryLog {
  table: string;
  calls: Call[];
}

const db = vi.hoisted(() => {
  const state = {
    queries: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
    alert: vi.fn(),
    verifyEnergy: vi.fn(),
    incrementAIUsage: vi.fn(),
    recordStudyActivity: vi.fn(),
    updateQuestProgress: vi.fn(),
    getMaterials: vi.fn(),
  };
  const resultFor = (entry: { table: string; calls: Array<[string, unknown[]]> }) => {
    const has = (method: string) => entry.calls.some(([name]) => name === method);
    if (entry.table === 'exam_sessions' && has('insert')) return { data: { id: 'session-1' }, error: null };
    if (has('insert')) return { data: null, error: null };
    if (has('maybeSingle') || has('single')) return { data: null, error: null };
    return { data: [], error: null };
  };
  const from = (table: string) => {
    const entry = { table, calls: [] as Array<[string, unknown[]]> };
    state.queries.push(entry);
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit', 'insert', 'maybeSingle', 'single', 'update']) {
      builder[method] = (...args: unknown[]) => {
        entry.calls.push([method, args]);
        return builder;
      };
    }
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(resultFor(entry)).then(resolve, reject);
    return builder;
  };
  return { ...state, from };
});

vi.mock('../lib/supabase', () => ({ supabase: { from: (table: string) => db.from(table) } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../contexts/ConfirmContext', () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true), alert: (...args: unknown[]) => db.alert(...args) }),
}));
vi.mock('../api/materials', () => ({ getMaterials: (...args: unknown[]) => db.getMaterials(...args) }));
vi.mock('../api/quests', () => ({
  updateQuestProgress: (...args: unknown[]) => db.updateQuestProgress(...args),
  recordStudyActivity: (...args: unknown[]) => db.recordStudyActivity(...args),
}));
vi.mock('../api/limits', () => ({ incrementAIUsage: (...args: unknown[]) => db.incrementAIUsage(...args) }));
vi.mock('../hooks/useEnergyConfirm', () => ({
  useEnergyConfirm: () => ({ verifyEnergy: (...args: unknown[]) => db.verifyEnergy(...args) }),
}));
vi.mock('../utils/tts', () => ({ playTTS: vi.fn(), pauseTTS: vi.fn(), resumeTTS: vi.fn(), stopTTS: vi.fn() }));
vi.mock('../components/ConfettiCelebration', () => ({ default: () => null }));

const material = {
  id: 'm1',
  title: 'Денежный рынок',
  subject: 'Макроэкономика',
  original_text: 'Текст лекции о ставке.',
  created_at: '2026-10-01T10:00:00Z',
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function exam(table = 'exam_sessions'): QueryLog[] {
  return db.queries.filter((query) => query.table === table);
}

function args(query: QueryLog, method: string) {
  return query.calls.filter(([name]) => name === method).map(([, a]) => a);
}

function saveState(state: Record<string, unknown>) {
  localStorage.setItem('studyforge_professor_exam_state', JSON.stringify({
    selectedMaterialId: 'm1',
    selectedProfId: 'arkadiy',
    examLength: 3,
    currentStep: 0,
    examSteps: [],
    phase: 'select',
    currentQuestion: '',
    answerText: '',
    history: [],
    evaluation: null,
    socraticMode: false,
    ...state,
  }));
}

function renderExam() {
  return render(<MemoryRouter><ProfessorExam /></MemoryRouter>);
}

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  db.queries.length = 0;
  db.alert.mockReset().mockResolvedValue(undefined);
  db.verifyEnergy.mockReset().mockResolvedValue(true);
  db.incrementAIUsage.mockReset().mockResolvedValue(undefined);
  db.recordStudyActivity.mockReset().mockResolvedValue(undefined);
  db.updateQuestProgress.mockReset().mockResolvedValue(false);
  db.getMaterials.mockReset().mockResolvedValue([material]);
  localStorage.setItem('prof_materials_user-1', JSON.stringify([material]));
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('starting an old-format oral exam', () => {
  it('labels the professors and formats in words, without emoji (QA round 1)', async () => {
    saveState({});
    const { container } = renderExam();
    await screen.findByRole('button', { name: /Войти в аудиторию/ });
    expect(container.textContent).toContain('Экспресс-блиц');
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}]/u);
  });

  it('charges nothing when the first question fails', async () => {
    saveState({});
    fetchMock.mockResolvedValue(jsonResponse(502, { detail: 'ИИ-сервис сейчас не ответил. Попробуйте ещё раз.', code: 'ai_failed' }));
    const user = userEvent.setup();
    renderExam();

    await user.click(await screen.findByRole('button', { name: /Войти в аудиторию/ }));

    await waitFor(() => expect(db.alert).toHaveBeenCalled());
    expect(db.alert.mock.calls[0][0]).toMatchObject({ message: 'ИИ-сервис сейчас не ответил. Попробуйте ещё раз.' });
    expect(db.verifyEnergy).toHaveBeenCalledWith('user-1', 1, 'AI-Экзаменатор');
    expect(db.incrementAIUsage).not.toHaveBeenCalled();
  });

  it('charges once after the first question arrives', async () => {
    saveState({});
    fetchMock.mockResolvedValue(jsonResponse(200, { question: 'Что такое ключевая ставка?' }));
    const user = userEvent.setup();
    renderExam();

    await user.click(await screen.findByRole('button', { name: /Войти в аудиторию/ }));

    expect(await screen.findByText('Что такое ключевая ставка?')).toBeInTheDocument();
    expect(db.incrementAIUsage).toHaveBeenCalledTimes(1);
    expect(db.incrementAIUsage).toHaveBeenCalledWith('user-1', 1);
  });

  it('does not start or charge when the energy check says no', async () => {
    saveState({});
    db.verifyEnergy.mockResolvedValue(false);
    const user = userEvent.setup();
    renderExam();

    await user.click(await screen.findByRole('button', { name: /Войти в аудиторию/ }));

    await waitFor(() => expect(db.verifyEnergy).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.incrementAIUsage).not.toHaveBeenCalled();
  });

  it('reads only exams of the old format for history and adaptivity, and only their scores', async () => {
    saveState({});
    fetchMock.mockResolvedValue(jsonResponse(200, { question: 'Что такое ключевая ставка?' }));
    const user = userEvent.setup();
    renderExam();

    await user.click(await screen.findByRole('button', { name: /Войти в аудиторию/ }));
    await screen.findByText('Что такое ключевая ставка?');

    const reads = exam().filter((query) => args(query, 'select').length > 0 && args(query, 'insert').length === 0);
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const query of reads) expect(args(query, 'eq')).toContainEqual(['kind', 'professor']);
    const adaptivity = reads.find((query) => args(query, 'select')[0][0] !== '*');
    expect(adaptivity && args(adaptivity, 'select')[0][0]).toBe('score');
  });
});

describe('the last answer of an old-format oral exam', () => {
  const earlierStep = {
    question: 'Вопрос 1',
    studentAnswer: 'Ответ 1',
    answer: 'Ответ 1',
    evaluation: { score: 80, grade: '4', verdict: 'Хорошо', correct_points: [], errors: ['Спутал ставки'], missing_points: [] },
  };

  function lastQuestionState() {
    saveState({
      phase: 'question',
      currentStep: 2,
      examSteps: [earlierStep, { ...earlierStep, question: 'Вопрос 2' }],
      currentQuestion: 'Вопрос 3: что делает ЦБ при инфляции?',
      answerText: 'Повышает ставку',
    });
  }

  it('saves mistakes with the id of the saved exam session and counts the day without cards', async () => {
    lastQuestionState();
    fetchMock.mockResolvedValue(jsonResponse(200, {
      score: 40, grade: '2', verdict: 'Неполно', correct_points: [], errors: [], missing_points: ['Не назван канал кредита'],
    }));
    const user = userEvent.setup();
    renderExam();

    await user.click(await screen.findByRole('button', { name: /Ответить Профессору/ }));

    expect(await screen.findByText('Не сдан')).toBeInTheDocument();
    const mistakes = exam('mistake_diary').find((query) => args(query, 'insert').length > 0);
    expect(mistakes).toBeTruthy();
    const [rows] = args(mistakes!, 'insert')[0] as [Array<Record<string, unknown>>];
    expect(rows.length).toBe(3);
    for (const row of rows) expect(row.exam_session_id).toBe('session-1');
    expect(db.recordStudyActivity).toHaveBeenCalledWith('user-1', 0, 0);
    expect(db.incrementAIUsage).not.toHaveBeenCalled();
  });

  it('says «Билет сдан» from grade 3 up', async () => {
    lastQuestionState();
    fetchMock.mockResolvedValue(jsonResponse(200, {
      score: 55, grade: '3', verdict: 'Удовлетворительно', correct_points: ['Ставка'], errors: [], missing_points: [],
    }));
    const user = userEvent.setup();
    renderExam();

    await user.click(await screen.findByRole('button', { name: /Ответить Профессору/ }));

    expect(await screen.findByText('Билет сдан')).toBeInTheDocument();
    expect(ticketPassed('3')).toBe(true);
    expect(ticketPassed('2')).toBe(false);
  });

  it('shows the server\'s own message when the answer cannot be evaluated and keeps the answer', async () => {
    lastQuestionState();
    fetchMock.mockResolvedValue(jsonResponse(429, { detail: 'Сервис сейчас занят. Подождите минуту и попробуйте ещё раз.', code: 'ai_busy' }));
    const user = userEvent.setup();
    renderExam();

    await user.click(await screen.findByRole('button', { name: /Ответить Профессору/ }));

    await waitFor(() => expect(db.alert).toHaveBeenCalled());
    expect(db.alert.mock.calls[0][0]).toMatchObject({ message: 'Сервис сейчас занят. Подождите минуту и попробуйте ещё раз.' });
    expect(await screen.findByDisplayValue('Повышает ставку')).toBeInTheDocument();
    expect(exam().some((query) => args(query, 'insert').length > 0)).toBe(false);
    expect(db.recordStudyActivity).not.toHaveBeenCalled();
  });

  it('treats an answer without a usable grade as a failure, never as a default grade', async () => {
    lastQuestionState();
    fetchMock.mockResolvedValue(jsonResponse(200, { verdict: 'Что-то пошло не так' }));
    const user = userEvent.setup();
    renderExam();

    await user.click(await screen.findByRole('button', { name: /Ответить Профессору/ }));

    await waitFor(() => expect(db.alert).toHaveBeenCalled());
    expect(db.alert.mock.calls[0][0]).toMatchObject({ message: 'Не удалось оценить ответ. Попробуйте ещё раз.' });
    expect(exam().some((query) => args(query, 'insert').length > 0)).toBe(false);
  });
});
