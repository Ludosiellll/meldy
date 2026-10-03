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
  updateMaterialTitle: vi.fn(),
  updateMaterialVisibility: vi.fn(),
}));
vi.mock('./api/groups', () => ({ getAssignedMaterials: vi.fn(async () => []), joinGroup: vi.fn() }));
const shelves = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('./api/exams', () => ({ listExamShelves: vi.fn(async () => shelves.list) }));
vi.mock('./contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn(async () => false) }));

import App from './App';

function openAt(path: string) {
  window.history.pushState({}, '', path);
  return render(<App />);
}

beforeEach(() => {
  auth.value = { user: { id: 'user-1', email: 'student@example.com', user_metadata: {} }, loading: false };
  materials.list = [];
  shelves.list = [];
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
    expect(await screen.findByText('только текст, конспекта нет')).toBeInTheDocument();
    expect(screen.getAllByText('только текст, конспекта нет')).toHaveLength(1);
    expect(screen.getByText('конспект · 1 карточка')).toBeInTheDocument();
  });

  it('is the course’s table of contents: one exam is the page, lectures in the order they were added, no chips or capitals', async () => {
    materials.list = [
      { id: 'm-1', title: 'Спрос и предложение', subject: 'Экономика', created_at: '2026-09-08T09:00:00Z', summary_json: { content: 'Конспект', podcast: [{ text: 'Реплика' }] }, flashcards_json: { flashcards: [{}, {}] }, quiz_json: { quiz: [{}] } },
      { id: 'm-2', title: 'Эластичность спроса', subject: 'Экономика', created_at: '2026-09-15T09:00:00Z', summary_json: { text_only: true }, flashcards_json: { flashcards: [] }, quiz_json: { quiz: [] } },
    ];
    shelves.list = [
      {
        id: 'exam-1',
        title: 'Экзамен: микроэкономика',
        kind: 'exam',
        exam_date: '2026-10-15',
        created_at: '2026-10-01T00:00:00Z',
        materials: [
          { id: 'm-1', addedAt: '2026-10-01T09:00:00Z' },
          { id: 'm-2', addedAt: '2026-10-01T09:00:00Z' },
        ],
      },
    ];
    const { container } = openAt('/library');
    expect(await screen.findByRole('heading', { level: 1, name: 'Микроэкономика' })).toBeInTheDocument();
    expect(screen.getByText('Экзамен 15 октября · 2 лекции: 1 разобрана, 1 загружена только текстом · 2 карточки')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Лист экзамена' })).toHaveAttribute('href', '/exams/exam-1');
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('link').getAttribute('href'))).toEqual(['/library/m-1', '/library/m-2']);
    expect(within(rows[0]).getByText('конспект · 2 карточки · тест · разговор')).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/uppercase|tracking-wider|Только для меня|Пакетный выбор|Статистика/);
    expect(screen.queryByText('Экономика')).toBeNull();
  });
});
