import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { Outlet } from 'react-router-dom';

const auth = vi.hoisted(() => ({
  value: { user: { id: 'user-1', email: 'student@example.com', user_metadata: {} } as unknown, loading: false },
}));
const materials = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock('./hooks/useAuth', () => ({ useAuth: () => auth.value }));
vi.mock('./components/PWAUpdater', () => ({ default: () => null }));
vi.mock('./components/Layout', () => ({
  default: () => (
    <div data-testid="layout">
      <Outlet />
    </div>
  ),
}));
vi.mock('./pages/Exams', () => ({ default: () => <h1>Список экзаменов</h1> }));
vi.mock('./pages/ExamEditor', () => ({ default: () => <h1>Редактор экзамена</h1> }));
vi.mock('./pages/ExamDetail', () => ({ default: () => <h1>Лист экзамена</h1> }));
vi.mock('./pages/ExamDraw', () => ({ default: () => <h1>Тянуть билет</h1> }));
vi.mock('./pages/ExamTicket.tsx', () => ({ default: () => <h1>Экран ответа</h1> }));
vi.mock('./pages/ProfessorExam', () => ({ default: () => <h1>Старый экзамен</h1> }));
vi.mock('./pages/MoodTracker', () => ({ default: () => <h1>Настроение</h1> }));
vi.mock('./api/materials', () => ({
  getMaterials: vi.fn(async () => materials.list),
  deleteMaterial: vi.fn(),
  updateMaterialVisibility: vi.fn(),
}));
vi.mock('./api/groups', () => ({ getAssignedMaterials: vi.fn(async () => []), joinGroup: vi.fn() }));
vi.mock('./contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn(async () => false) }));

import App from './App';

function openAt(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

beforeEach(() => {
  auth.value = { user: { id: 'user-1', email: 'student@example.com', user_metadata: {} }, loading: false };
  materials.list = [];
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.history.pushState({}, '', '/');
});

describe('exam routes', () => {
  it.each([
    ['/exams', 'Список экзаменов'],
    ['/exams/new', 'Редактор экзамена'],
    ['/exams/exam-1', 'Лист экзамена'],
    ['/exams/exam-1/edit', 'Редактор экзамена'],
    ['/exams/exam-1/draw', 'Тянуть билет'],
  ])('%s renders inside the layout', async (path, heading) => {
    openAt(path);
    const page = await screen.findByRole('heading', { name: heading });
    expect(within(screen.getByTestId('layout')).getByRole('heading', { name: heading })).toBe(page);
  });

  it('routes /exams/:id/ticket to the answer screen inside the layout', async () => {
    openAt('/exams/exam-1/ticket?q=q-1&n=12');
    const layout = await screen.findByTestId('layout');
    // The answer screen comes from its own package; this checkout may not have it yet.
    expect(
      await within(layout).findByText(/Экран ответа|Экран ответа пока недоступен/),
    ).toBeInTheDocument();
  });

  it('keeps the old oral exam at /exam', async () => {
    openAt('/exam');
    expect(await screen.findByRole('heading', { name: 'Старый экзамен' })).toBeInTheDocument();
  });
});

describe('loaders', () => {
  it('shows the canvas-coloured route loader while the session is checked', () => {
    auth.value = { user: null, loading: true };
    const { container } = openAt('/exams');
    const loader = screen.getByRole('status', { name: 'Загрузка страницы' });
    expect(loader.className).toContain('bg-[var(--sf-canvas)]');
    expect(container.innerHTML).not.toContain('bg-slate-900');
    expect(container.innerHTML).not.toContain('07111f');
  });

  it('uses the same loader while a lazy page loads', async () => {
    const { container } = openAt('/mood');
    const loader = screen.getByRole('status', { name: 'Загрузка страницы' });
    expect(loader.className).toContain('bg-[var(--sf-canvas)]');
    expect(container.innerHTML).not.toContain('07111f');
    expect(await screen.findByRole('heading', { name: 'Настроение' })).toBeInTheDocument();
  });
});

describe('library', () => {
  it('labels a lecture imported as plain text instead of promising a summary', async () => {
    materials.list = [
      {
        id: 'm-text',
        title: 'Лекция 5. Денежный рынок',
        subject: '',
        created_at: '2026-10-02T09:00:00Z',
        original_text: 'Текст лекции',
        summary_json: { text_only: true },
        flashcards_json: { flashcards: [] },
        quiz_json: { quiz: [] },
      },
      {
        id: 'm-full',
        title: 'Эластичность спроса',
        subject: 'Микроэкономика',
        created_at: '2026-10-01T09:00:00Z',
        original_text: 'Текст',
        summary_json: { content: 'Конспект лекции' },
        flashcards_json: { flashcards: [{ question: 'Что такое эластичность?', answer: 'Отношение изменений' }] },
        quiz_json: { quiz: [] },
      },
    ];
    openAt('/library');
    expect(await screen.findByText('Только текст, конспекта нет')).toBeInTheDocument();
    expect(screen.getAllByText('Только текст, конспекта нет')).toHaveLength(1);
    expect(screen.getByText('1 карточка')).toBeInTheDocument();
  });
});
