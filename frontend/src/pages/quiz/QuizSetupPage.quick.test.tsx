import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createQuiz: vi.fn(),
  updateQuiz: vi.fn(),
  listQuizzes: vi.fn(),
  reload: vi.fn(),
  fetchDoc: vi.fn(),
  state: { summary: null as unknown, items: null as unknown },
}));

vi.mock('../../api/quizzes', () => ({ createQuiz: api.createQuiz, updateQuiz: api.updateQuiz, listQuizzes: api.listQuizzes }));
vi.mock('../../components/test/bringIntoView', () => ({ bringIntoView: vi.fn() }));
vi.mock('../../api/testDocs', () => ({ fetchTestDoc: api.fetchDoc }));
vi.mock('../../lib/containers/hooks', () => ({
  useContainerData: () => ({
    data: api.state.summary ? { summary: api.state.summary, items: api.state.items, planInput: null, oralWithoutPoints: 0 } : null,
    loading: false,
    offline: false,
    unavailable: false,
    error: null,
    gone: false,
    reload: api.reload,
  }),
}));

import QuizSetupPage from './QuizSetupPage';
import { QA_SETUP } from '../../components/quiz/copyAuthor';
import { EXAM, examItems, examSummary, NOW, quizRow } from '../../components/quiz/testkit';

/* «Ещё настройки» of «Быстрая контрольная» (components/quick): the full form starts from the pills’ choices, unfolded. */

const combo = (name: string) => screen.getByRole('combobox', { name });

function renderWith(state: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/exams/c/${EXAM}/quizzes/new`, search: '?all=1', state }]}>
      <Routes>
        <Route path="/exams/c/:id/quizzes/new" element={<QuizSetupPage />} />
        <Route path="*" element={<p>дальше</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  api.state.summary = examSummary();
  api.state.items = examItems();
  api.createQuiz.mockReset().mockResolvedValue(quizRow({ id: 'new-quiz', started: false }));
  api.listQuizzes.mockReset().mockResolvedValue([]);
  api.fetchDoc.mockReset().mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('QuizSetupPage: the quick test’s «Ещё настройки»', () => {
  it('starts from the pills: no timer, no end, two attempts, signed in; the folded settings are open', async () => {
    renderWith({ preset: { time_limit_min: null, closes_at: null, attempts: 2, guests: false, members_only: false }, more: true });
    expect(combo(QA_SETUP.time)).toHaveTextContent(QA_SETUP.timeNone);
    expect(combo(QA_SETUP.closes)).toHaveTextContent(QA_SETUP.closesNever);
    expect(combo(QA_SETUP.attempts)).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /^Ещё настройки/ })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    await waitFor(() =>
      expect(api.createQuiz).toHaveBeenCalledWith(EXAM, expect.objectContaining({ time_limit_min: null, closes_at: null, attempts: 2, guests: false })),
    );
  });

  it('without the quick test’s state the form is as before', () => {
    renderWith(null);
    expect(combo(QA_SETUP.time)).toHaveTextContent('30 мин');
    expect(screen.getByRole('button', { name: /^Ещё настройки/ })).toHaveAttribute('aria-expanded', 'false');
  });
});
