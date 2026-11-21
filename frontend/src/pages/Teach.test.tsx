import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverviewContainer } from '../types/container';

const mocks = vi.hoisted(() => ({ containers: [] as unknown[], saveRole: vi.fn(async () => undefined) }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../lib/containers/hooks', () => ({
  useContainersOverview: () => ({ data: { v: 1, day: '', containers: mocks.containers, attached_exam_ids: [] }, loading: false, offline: false, unavailable: false, error: null, reload: () => undefined }),
}));
vi.mock('../components/quick/TestsView', () => ({
  default: ({ tests }: { tests: OverviewContainer[] }) => (
    <ul aria-label="Ваши тесты">
      {tests.map((test) => (
        <li key={test.id}>{test.title}</li>
      ))}
    </ul>
  ),
}));
vi.mock('../lib/role', () => ({ saveRole: mocks.saveRole }));

import Teach from './Teach';
import { TEACH } from '../components/teach/copyTeach';

let where = '';
function Where() {
  where = useLocation().pathname;
  return null;
}

function container(patch: Partial<OverviewContainer>): OverviewContainer {
  return { id: 'c', title: 'Без названия', kind: 'exam', exam_date: null, created_at: '2026-11-01T10:00:00Z', role: 'owner', items: 0, items_updated_at: null, subjects: [], answers_today: 0, settings: null, ...patch };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/teach']}>
      <Where />
      <Routes>
        <Route path="/teach" element={<Teach />} />
        <Route path="*" element={<p>другая страница</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.containers = [];
  mocks.saveRole.mockClear();
  where = '';
});
afterEach(() => cleanup());

describe('the teacher’s first screen', () => {
  it('names the three things a teacher comes for, each one press from its page', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Что будем делать?' })).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/tests/quick', '/games', '/exams/import']);
    expect(within(links[0]).getByText('Провести контрольную')).toBeInTheDocument();
    expect(within(links[1]).getByText('Сыграть на паре')).toBeInTheDocument();
    expect(within(links[2]).getByText('Подготовить группу к экзамену')).toBeInTheDocument();
    // nothing made yet: no empty lists under the three
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('says it in a staff room’s words: no «ИИ», no «контейнер», no dashes or exclamation marks', () => {
    const words = [TEACH.h1, TEACH.testsTitle, TEACH.examsTitle, TEACH.student, TEACH.studentGo, ...TEACH.actions.flatMap((action) => [action.name, action.text, action.go])];
    for (const line of words) {
      expect(line).not.toMatch(/ИИ|нейросет|контейнер|—|!|умн|мгновенн|легко|просто\b/i);
    }
  });

  it('lists the teacher’s own tests and the exams they gave a group, not the ones they only joined', () => {
    mocks.containers = [
      container({ id: 't1', title: 'Контрольная по истории', kind: 'test', items: 12 }),
      container({ id: 'e1', title: 'История Беларуси, 2 курс', items: 86 }),
      container({ id: 'e2', title: 'Чужой экзамен', role: 'member', items: 40 }),
    ];
    renderPage();
    expect(within(screen.getByRole('list', { name: 'Ваши тесты' })).getByText('Контрольная по истории')).toBeInTheDocument();
    const exam = screen.getByRole('link', { name: /История Беларуси, 2 курс/ });
    expect(exam).toHaveAttribute('href', '/exams/c/e1');
    expect(exam).toHaveTextContent('86 вопросов');
    expect(screen.queryByText('Чужой экзамен')).toBeNull();
  });

  it('lets a teacher who also studies go to the student’s page', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть страницу студента' }));
    expect(mocks.saveRole).toHaveBeenCalledWith('user-1', 'student');
    expect(where).toBe('/dashboard');
  });
});
