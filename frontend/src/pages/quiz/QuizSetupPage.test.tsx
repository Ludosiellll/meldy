import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  createQuiz: vi.fn(),
  updateQuiz: vi.fn(),
  listQuizzes: vi.fn(),
  reload: vi.fn(),
  state: { summary: null as unknown, items: null as unknown },
}));

vi.mock('../../api/quizzes', () => ({ createQuiz: api.createQuiz, updateQuiz: api.updateQuiz, listQuizzes: api.listQuizzes }));
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
import { ContainerApiError } from '../../api/containers';
import { QA_SETUP } from '../../components/quiz/copyAuthor';
import { localInput, weekOn } from '../../components/quiz/setupModel';
import { EXAM, examItems, examSummary, listRow, NOW, QUIZ_ID, quizRow, S1, S2 } from '../../components/quiz/testkit';

const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ');
const combo = (name: string) => screen.getByRole('combobox', { name });
const pick = (name: string, option: string) => {
  fireEvent.click(combo(name));
  fireEvent.click(screen.getByRole('option', { name: option }));
};

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}|${JSON.stringify(location.state)}`}</p>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exams/c/:id/quizzes/new" element={<QuizSetupPage />} />
        <Route path="/exams/c/:id/quizzes/:quizId/edit" element={<QuizSetupPage />} />
        <Route path="*" element={<Where />} />
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
  api.updateQuiz.mockReset().mockResolvedValue(quizRow());
  api.listQuizzes.mockReset().mockResolvedValue([listRow()]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('QuizSetupPage: a new quiz (spec 2026-10-16 §2.1)', () => {
  it('starts from the defaults: every subject with keyed questions, 20, about a minute a question, 1 attempt, a week', () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    expect(screen.getByRole('heading', { level: 1, name: QA_SETUP.newTitle })).toBeInTheDocument();
    expect(screen.getByLabelText(QA_SETUP.name)).toHaveValue('Контрольная · 16.10');
    const subjects = screen.getByRole('group', { name: QA_SETUP.subjects });
    expect(within(subjects).getByRole('checkbox', { name: /Вариант 1/ })).toBeChecked();
    expect(within(subjects).getByRole('checkbox', { name: /Вариант 2/ })).toBeChecked();
    // The oral-only subject has no questions for a quiz.
    expect(within(subjects).queryByRole('checkbox', { name: /Билеты/ })).toBeNull();
    expect(plain(subjects.textContent)).toContain('В контрольную идут только вопросы с ключом: в выбранных предметах их 30.');
    expect(combo(QA_SETUP.count)).toHaveTextContent('20');
    expect(combo(QA_SETUP.time)).toHaveTextContent('20 мин');
    expect(combo(QA_SETUP.set)).toHaveTextContent(QA_SETUP.setOwn);
    expect(combo(QA_SETUP.order)).toHaveTextContent(QA_SETUP.orderShuffle);
    expect(combo(QA_SETUP.options)).toHaveTextContent(QA_SETUP.optionsShuffle);
    expect(combo(QA_SETUP.opens)).toHaveTextContent(QA_SETUP.opensNow);
    expect(combo(QA_SETUP.closes)).toHaveTextContent(QA_SETUP.closesAt);
    expect(screen.getByLabelText(QA_SETUP.closesField)).toHaveValue(localInput(weekOn(NOW)));
    expect(combo(QA_SETUP.attempts)).toHaveTextContent('1');
    // «В зачёт» only matters with more than one attempt.
    expect(screen.queryByRole('combobox', { name: QA_SETUP.grading })).toBeNull();
    expect(combo(QA_SETUP.pass)).toHaveTextContent(QA_SETUP.passNone);
    expect(combo(QA_SETUP.review)).toHaveTextContent(QA_SETUP.reviewOption('mistakes_then_answers'));
    expect(combo(QA_SETUP.who)).toHaveTextContent(QA_SETUP.whoAll);
    expect(screen.getByRole('button', { name: QA_SETUP.create })).toHaveClass('sf-primary');
  });

  it('the count and the timer follow the subjects until the author picks them; «все» is the whole pool', () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    fireEvent.click(screen.getByRole('checkbox', { name: /Вариант 2/ }));
    expect(combo(QA_SETUP.count)).toHaveTextContent('все (15)');
    expect(combo(QA_SETUP.time)).toHaveTextContent('15 мин');
    pick(QA_SETUP.count, '10');
    expect(combo(QA_SETUP.time)).toHaveTextContent('10 мин');
    pick(QA_SETUP.attempts, '3');
    expect(combo(QA_SETUP.grading)).toHaveTextContent('лучшая попытка');
  });

  it('says what stops the form as lines, and the button waits', () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    fireEvent.change(screen.getByLabelText(QA_SETUP.name), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Вариант 1/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Вариант 2/ }));
    expect(screen.getByText(QA_SETUP.problems.title)).toBeInTheDocument();
    expect(screen.getByText(QA_SETUP.problems.subjects)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: QA_SETUP.create })).toBeDisabled();
    pick(QA_SETUP.opens, QA_SETUP.opensAt);
    fireEvent.change(screen.getByLabelText(QA_SETUP.opensField), { target: { value: '2026-10-30T10:00' } });
    expect(screen.getByText(QA_SETUP.problems.window)).toBeInTheDocument();
  });

  it('«Создать» sends the settings and opens the quiz’s stats', async () => {
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    pick(QA_SETUP.pass, '60 %');
    pick(QA_SETUP.closes, QA_SETUP.closesNever);
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    await waitFor(() => expect(api.createQuiz).toHaveBeenCalledTimes(1));
    expect(api.createQuiz).toHaveBeenCalledWith(EXAM, {
      title: 'Контрольная · 16.10',
      subject_ids: [S1, S2],
      item_count: 20,
      same_set: false,
      shuffle_items: true,
      shuffle_options: true,
      time_limit_min: 20,
      opens_at: null,
      closes_at: null,
      attempts: 1,
      grading: 'best',
      allow_back: true,
      pass_percent: 60,
      review: 'mistakes_then_answers',
      members_only: false,
      guests: true,
      cover_path: null,
      accent: 'blue',
      offer_practice: false,
    });
    expect(await screen.findByTestId('where')).toHaveTextContent(`/exams/c/${EXAM}/quizzes/new-quiz|{"quizNote":"created"}`);
  });

  it('says a refusal of the server and stays', async () => {
    api.createQuiz.mockRejectedValue(new ContainerApiError('MC010', 'В экзамене уже 50 контрольных. Удалите старые, чтобы создать новую.'));
    renderAt(`/exams/c/${EXAM}/quizzes/new`);
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.create }));
    expect(await screen.findByRole('alert')).toHaveTextContent('В экзамене уже 50 контрольных.');
    expect(screen.getByRole('button', { name: QA_SETUP.create })).toBeEnabled();
  });
});

describe('QuizSetupPage: changing a quiz', () => {
  it('after the first attempt the locked settings are disabled with the reason; only what changed is sent', async () => {
    renderAt(`/exams/c/${EXAM}/quizzes/${QUIZ_ID}/edit`);
    expect(await screen.findByText(QA_SETUP.locked)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: QA_SETUP.editTitle })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: QA_SETUP.subjects })).toBeDisabled();
    for (const name of [QA_SETUP.count, QA_SETUP.set, QA_SETUP.order, QA_SETUP.options, QA_SETUP.time]) expect(combo(name)).toBeDisabled();
    for (const name of [QA_SETUP.attempts, QA_SETUP.pass, QA_SETUP.review, QA_SETUP.who, QA_SETUP.closes]) expect(combo(name)).toBeEnabled();
    expect(combo(QA_SETUP.attempts)).toHaveTextContent('3');
    pick(QA_SETUP.attempts, '5');
    pick(QA_SETUP.grading, 'последняя попытка');
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.save }));
    await waitFor(() => expect(api.updateQuiz).toHaveBeenCalledWith(QUIZ_ID, { attempts: 5, grading: 'last' }));
    expect(await screen.findByTestId('where')).toHaveTextContent(`/exams/c/${EXAM}/quizzes/${QUIZ_ID}|{"quizNote":"saved"}`);
  });

  it('before anyone started every setting can change', async () => {
    api.listQuizzes.mockResolvedValue([listRow({ started: false })]);
    renderAt(`/exams/c/${EXAM}/quizzes/${QUIZ_ID}/edit`);
    await screen.findByRole('heading', { level: 2, name: QA_SETUP.partQuestions });
    expect(screen.queryByText(QA_SETUP.locked)).toBeNull();
    expect(combo(QA_SETUP.time)).toBeEnabled();
    pick(QA_SETUP.time, '45 мин');
    fireEvent.click(screen.getByRole('button', { name: QA_SETUP.save }));
    await waitFor(() => expect(api.updateQuiz).toHaveBeenCalledWith(QUIZ_ID, { time_limit_min: 45 }));
  });

  it('nothing changed: no request, back to the stats', async () => {
    renderAt(`/exams/c/${EXAM}/quizzes/${QUIZ_ID}/edit`);
    fireEvent.click(await screen.findByRole('button', { name: QA_SETUP.save }));
    expect(await screen.findByTestId('where')).toHaveTextContent(`/exams/c/${EXAM}/quizzes/${QUIZ_ID}|{"quizNote":null}`);
    expect(api.updateQuiz).not.toHaveBeenCalled();
  });

  it('a quiz that is not there any more says so', async () => {
    api.listQuizzes.mockResolvedValue([]);
    renderAt(`/exams/c/${EXAM}/quizzes/${QUIZ_ID}/edit`);
    expect(await screen.findByRole('alert')).toHaveTextContent(QA_SETUP.notFound);
    expect(screen.getByRole('link', { name: QA_SETUP.toList }).getAttribute('href')).toBe(`/exams/c/${EXAM}/quizzes`);
  });
});
