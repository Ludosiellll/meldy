import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const db = vi.hoisted(() => ({
  courses: [] as unknown[],
  material: null as unknown,
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const result = () =>
        table === 'courses' ? { data: db.courses, error: null } : table === 'materials' ? { data: [], error: null } : { data: [], error: null };
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'in', 'update', 'insert', 'delete']) builder[method] = () => builder;
      builder.single = async () => ({ data: db.material, error: null });
      builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
      return builder;
    },
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: vi.fn(async () => false), alert: vi.fn(async () => undefined) }) }));
vi.mock('../hooks/useEnergyConfirm', () => ({ useEnergyConfirm: () => ({ verifyEnergy: vi.fn(async () => true) }) }));
vi.mock('../api/limits', () => ({ incrementAIUsage: vi.fn(async () => undefined) }));
vi.mock('../components/SummaryView', () => ({ default: () => <p>Конспект лекции</p> }));

import Courses from './Courses';

function renderCourses() {
  return render(
    <MemoryRouter initialEntries={['/courses']}>
      <Routes>
        <Route path="/courses" element={<Courses />} />
        <Route path="/exams" element={<h1>Экзамены</h1>} />
        <Route path="/exam" element={<h1>Старый экзамен</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  db.courses = [
    {
      id: 'c-1',
      user_id: 'user-1',
      title: 'Макроэкономика за семестр',
      description: 'Лекции по порядку',
      created_at: '2026-10-01T10:00:00Z',
      structure: [{ id: 's-1', title: 'Деньги', description: 'Денежный рынок', materials: [{ id: 'm-1', title: 'Денежный рынок', completed: false }] }],
    },
  ];
  db.material = { id: 'm-1', title: 'Денежный рынок', subject: 'Макроэкономика', summary_json: { content: 'Конспект' } };
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Courses: «Проверить себя»', () => {
  it('opens «Экзамены» and writes nothing to sessionStorage (the old /exam screen is not opened)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const user = userEvent.setup();
    renderCourses();

    await user.click(await screen.findByText('Макроэкономика за семестр'));
    await user.click(await screen.findByTitle('Быстрый просмотр конспекта'));
    const check = await screen.findByRole('button', { name: 'Проверить себя' });
    expect(screen.queryByRole('button', { name: /Устный экзамен/ })).toBeNull();

    await user.click(check);

    expect(await screen.findByRole('heading', { name: 'Экзамены' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Старый экзамен' })).toBeNull();
    expect(setItem).not.toHaveBeenCalledWith('studyforge_professor_exam_state', expect.anything());
    expect(setItem.mock.calls.filter(([key]) => String(key).startsWith('studyforge_'))).toHaveLength(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
