import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerSummary } from '../../types/container';

const api = vi.hoisted(() => ({
  listQuizzes: vi.fn(),
  reload: vi.fn(),
  state: { summary: null as unknown, items: new Map() as unknown, loading: false, gone: false, error: null as string | null },
}));

vi.mock('../../api/quizzes', () => ({ listQuizzes: api.listQuizzes }));
vi.mock('../../lib/containers/hooks', () => ({
  useContainerData: () => ({
    data: api.state.summary ? { summary: api.state.summary, items: api.state.items, planInput: null, oralWithoutPoints: 0 } : null,
    loading: api.state.loading,
    offline: false,
    unavailable: false,
    error: api.state.error,
    gone: api.state.gone,
    reload: api.reload,
  }),
}));

import QuizListPage from './QuizListPage';
import { QA_LIST } from '../../components/quiz/copyAuthor';
import { quizStateWords } from '../../lib/quizzes/quizModel';
import { EXAM, examSummary, listRow, QUIZ_ID } from '../../components/quiz/testkit';

const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ');

function renderAt() {
  return render(
    <MemoryRouter initialEntries={[`/exams/c/${EXAM}/quizzes`]}>
      <Routes>
        <Route path="/exams/c/:id/quizzes" element={<QuizListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.state.summary = examSummary();
  api.state.loading = false;
  api.state.gone = false;
  api.state.error = null;
  api.listQuizzes.mockReset().mockResolvedValue([
    listRow(),
    // Only the author tried it: writing and finished count the author's attempts, people and the average do not.
    listRow({ id: 'q-old', title: 'Пробный раунд', state: 'closed', people: 0, writing: 0, finished: 1, avg_percent: null, time_limit_s: null }),
  ]);
});
afterEach(() => cleanup());

describe('QuizListPage: the exam’s quizzes (spec 2026-10-16 §2.1)', () => {
  it('lists the quizzes, each a row to its stats, and «Новая контрольная» as the one blue pill', async () => {
    renderAt();
    expect(screen.getByRole('heading', { level: 1, name: QA_LIST.title })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: QA_LIST.title });
    const rows = within(list).getAllByRole('link');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('href')).toBe(`/exams/c/${EXAM}/quizzes/${QUIZ_ID}`);
    expect(plain(rows[0].textContent)).toContain('Контрольная · 16.10');
    expect(plain(rows[0].textContent)).toContain(quizStateWords(listRow()));
    expect(plain(rows[0].textContent)).toContain('3 вопроса · 20 минут');
    expect(plain(rows[0].textContent)).toContain('пишут 2 · сдали 5 · средний 71 %');
    expect(plain(rows[1].textContent)).toContain('Закрыта');
    expect(plain(rows[1].textContent)).toContain('без ограничения времени');
    expect(plain(rows[1].textContent)).toContain('пока никто не писал');
    expect(api.listQuizzes).toHaveBeenCalledWith(EXAM);
    const pill = screen.getByRole('link', { name: QA_LIST.newQuiz });
    expect(pill).toHaveClass('sf-primary');
    expect(pill.getAttribute('href')).toBe(`/exams/c/${EXAM}/quizzes/new`);
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
  });

  it('says what a quiz is for when there is none yet', async () => {
    api.listQuizzes.mockResolvedValue([]);
    renderAt();
    expect(await screen.findByText(QA_LIST.empty)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: QA_LIST.newQuiz })).toBeInTheDocument();
  });

  it('a member of the exam sees one line: quizzes are the author’s', () => {
    api.state.summary = examSummary({ role: 'member', owner: null } as Partial<ContainerSummary>);
    renderAt();
    expect(screen.getByText(QA_LIST.authorOnly)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: QA_LIST.newQuiz })).toBeNull();
    expect(api.listQuizzes).not.toHaveBeenCalled();
  });

  it('says a failure with «Повторить»', async () => {
    api.listQuizzes.mockRejectedValue(Object.assign(new Error('Нет связи с сервером.'), { code: 'network' }));
    renderAt();
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
    expect(screen.getByRole('button', { name: QA_LIST.retry })).toBeInTheDocument();
  });
});
